-- Owner manual review shares the provider/reference one-use boundary with all
-- automatic payment evidence. This migration does not create an execution job.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.owner_manual_payment_cases (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider_code text not null check (provider_code in ('telebirr','cbe_birr')),
  payment_provider_id uuid not null,
  reference_fingerprint text not null check (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  reference_masked text check (reference_masked ~ '^\*{3}[A-Z0-9]{4}$'),
  candidate_id uuid unique references app.receiver_sms_deposit_candidates(id) on delete restrict,
  legacy_candidate_id uuid unique references app.routine_telebirr_untrusted_proof_requests(id)
    on delete restrict,
  payment_event_id uuid unique references app.receiver_sms_payment_events(id) on delete restrict,
  status text not null check (status in ('awaiting_manual_credit','manually_credited','rejected')),
  amount_minor bigint check (amount_minor between 2500 and 2500000),
  receiver_account_id uuid,
  receiver_account_version integer,
  rejection_reason text check (rejection_reason is null or
    (pg_catalog.char_length(rejection_reason) between 10 and 240 and
      rejection_reason = pg_catalog.btrim(rejection_reason) and
      rejection_reason !~ '[[:cntrl:]]')),
  decided_by_admin_id uuid not null references app.admin_users(id) on delete restrict,
  decided_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_by_admin_id uuid references app.admin_users(id) on delete restrict,
  completed_at timestamptz,
  bank_payment_confirmed boolean not null default false,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (payment_provider_id, reference_fingerprint),
  foreign key (payment_provider_id, provider_code)
    references app.payment_providers(id, code) on delete restrict,
  foreign key (receiver_account_id, payment_provider_id, receiver_account_version)
    references app.receiver_accounts(id, provider_id, version) on delete restrict,
  check (pg_catalog.num_nonnulls(candidate_id,legacy_candidate_id,payment_event_id) >= 1
    and not (candidate_id is not null and legacy_candidate_id is not null)),
  check ((receiver_account_id is null) = (receiver_account_version is null)),
  check ((status = 'rejected' and rejection_reason is not null and
      completed_at is null and completed_by_admin_id is null)
    or (status = 'awaiting_manual_credit' and rejection_reason is null and
      completed_at is null and completed_by_admin_id is null)
    or (status = 'manually_credited' and
      completed_at is not null and completed_by_admin_id is not null and
      amount_minor is not null and receiver_account_id is not null))
);
create index owner_manual_payment_cases_status_idx
  on app.owner_manual_payment_cases(status, decided_at desc, id);
alter table app.owner_manual_payment_cases owner to postgres;
alter table app.owner_manual_payment_cases enable row level security;
alter table app.owner_manual_payment_cases force row level security;
revoke all on app.owner_manual_payment_cases
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

-- Every producer of automatic evidence passes this trigger, including legacy
-- TeleBirr paths. The same advisory key serializes reservations and evidence.
create function app.block_automatic_evidence_for_owner_case()
returns trigger language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (select provider.code from app.payment_providers provider
      where provider.id = new.payment_provider_id) || ':' ||
    new.canonical_reference_fingerprint, 20261021));
  if exists (select 1 from app.owner_manual_payment_cases owner_case
      where owner_case.payment_provider_id = new.payment_provider_id
        and owner_case.reference_fingerprint = new.canonical_reference_fingerprint) then
    raise exception 'The payment reference is reserved for Owner resolution.';
  end if;
  return new;
end;
$$;
alter function app.block_automatic_evidence_for_owner_case() owner to postgres;
revoke all on function app.block_automatic_evidence_for_owner_case()
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;
create trigger block_automatic_evidence_for_owner_case
before insert on app.provider_payment_evidence
for each row execute function app.block_automatic_evidence_for_owner_case();

-- Existing older-payment approvals start automatic credit. Withdraw both
-- obsolete powers; all Owner decisions below use the manual queue instead.
revoke all on function app.decide_owner_receiver_sms_old_payment(uuid,uuid,text)
  from fetanagent_owner_control, fetanagent_owner_control_runtime;
drop function app.decide_owner_receiver_sms_old_payment(uuid,uuid,text);
revoke all on function app.decide_owner_routine_telebirr_old_payment(uuid,uuid,text)
  from fetanagent_owner_control, fetanagent_owner_control_runtime;
drop function app.decide_owner_routine_telebirr_old_payment(uuid,uuid,text);
revoke execute on function app.finalize_routine_telebirr_paid_observation(uuid)
  from fetanagent_owner_control;

-- A prior pending or leased review message must not arrive after the Owner's
-- final decision. A message already sent remains in the customer's history.
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_stage_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_stage_check
  check (notification_stage in
    ('checking','waiting','old_pending','final','manual_final','manual_correction'));
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_stage_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_stage_code_check check (
    (notification_stage = 'checking' and outcome_code = 'checking')
    or (notification_stage = 'waiting' and outcome_code = 'verified_waiting')
    or (notification_stage = 'old_pending' and outcome_code = 'older_pending')
    or (notification_stage = 'manual_final' and outcome_code in ('credited','rejected'))
    or (notification_stage = 'manual_correction' and outcome_code = 'credited')
    or (notification_stage = 'final' and outcome_code not in
      ('checking','verified_waiting','older_pending'))
  );

create function app.queue_owner_manual_payment_outcome(
  p_candidate_id uuid, p_outcome text, p_amount_minor bigint
) returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_legacy app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_chat_id bigint;
  v_reference_masked text;
begin
  if p_candidate_id is null or
    not ((p_outcome = 'credited' and p_amount_minor between 2500 and 2500000)
      or (p_outcome = 'rejected' and p_amount_minor is null)) then
    raise exception 'The Owner customer outcome is invalid.';
  end if;
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id;
  if v_candidate.id is null then
    select * into v_legacy from app.routine_telebirr_untrusted_proof_requests candidate
      where candidate.id = p_candidate_id and candidate.origin_channel = 'telegram';
  end if;
  select telegram_identity.private_chat_id into v_chat_id
    from app.telegram_identities telegram_identity
    where telegram_identity.customer_identity_id =
      coalesce(v_candidate.origin_identity_id,v_legacy.origin_identity_id)
      and telegram_identity.private_chat_id = telegram_identity.telegram_user_id;
  v_reference_masked := coalesce(v_candidate.reference_masked,
    v_legacy.candidate_reference_masked);
  if v_reference_masked is null or v_chat_id is null then
    raise exception 'The Owner customer delivery is unavailable.';
  end if;
  update app.telegram_deposit_outcome_deliveries delivery
    set status = 'unavailable', lease_token = null, lease_expires_at = null,
      updated_at = pg_catalog.clock_timestamp()
    where delivery.candidate_id = p_candidate_id
      and delivery.notification_stage in ('checking','waiting','old_pending','final')
      and delivery.status in ('pending','leased');
  if p_outcome = 'credited' and exists (
      select 1 from app.telegram_deposit_outcome_deliveries delivery
      where delivery.candidate_id = p_candidate_id
        and delivery.notification_stage = 'manual_final'
        and delivery.outcome_code = 'rejected') then
    update app.telegram_deposit_outcome_deliveries delivery
      set status = 'unavailable', lease_token = null, lease_expires_at = null,
        updated_at = pg_catalog.clock_timestamp()
      where delivery.candidate_id = p_candidate_id
        and delivery.notification_stage = 'manual_final'
        and delivery.status in ('pending','leased');
    insert into app.telegram_deposit_outcome_deliveries
      (candidate_id, notification_stage, private_chat_id, reference_masked,
        outcome_code, amount_minor)
    values (p_candidate_id, 'manual_correction', v_chat_id,
      v_reference_masked, 'credited', p_amount_minor)
    on conflict (candidate_id, notification_stage) do nothing;
  else
    insert into app.telegram_deposit_outcome_deliveries
      (candidate_id, notification_stage, private_chat_id, reference_masked,
        outcome_code, amount_minor)
    values (p_candidate_id, 'manual_final', v_chat_id,
      v_reference_masked, p_outcome, p_amount_minor)
    on conflict (candidate_id, notification_stage) do nothing;
  end if;
end;
$$;
alter function app.queue_owner_manual_payment_outcome(uuid,text,bigint) owner to postgres;
revoke all on function app.queue_owner_manual_payment_outcome(uuid,text,bigint)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

create function app.decide_owner_manual_payment_case(
  p_actor_auth_user_id uuid, p_candidate_id uuid,
  p_decision text, p_rejection_reason text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_actor_id uuid;
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_legacy app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_old app.routine_telebirr_old_payment_observations%rowtype;
  v_event app.receiver_sms_payment_events%rowtype;
  v_case app.owner_manual_payment_cases%rowtype;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_candidate_id is null
    or p_decision is null or p_decision not in ('approve','reject')
    or (p_decision = 'approve' and p_rejection_reason is not null)
    or (p_decision = 'reject' and (p_rejection_reason is null
      or p_rejection_reason <> pg_catalog.btrim(p_rejection_reason)
      or p_rejection_reason ~ '[[:cntrl:]]'
      or pg_catalog.char_length(p_rejection_reason) not between 10 and 240)) then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active'
    for share;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id for share;
  if v_candidate.id is null then
    select * into v_legacy from app.routine_telebirr_untrusted_proof_requests candidate
      where candidate.id = p_candidate_id and candidate.provider_code = 'telebirr'
        and candidate.intake_mode = 'paid' and candidate.origin_channel = 'telegram'
      for share;
    select * into v_old from app.routine_telebirr_old_payment_observations observation
      where observation.candidate_id = p_candidate_id for share;
    if v_legacy.id is null or v_old.challenge_id is null
      or v_old.occurred_at >= v_legacy.submitted_at - interval '1 hour'
      or exists (select 1 from app.routine_telebirr_old_payment_decisions decision
        where decision.candidate_id = p_candidate_id)
      or exists (select 1 from app.routine_telebirr_fast_results result
        where result.candidate_id = p_candidate_id) then
      raise exception 'The older payment is unavailable for manual review.';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'telebirr:' || v_old.reference_fingerprint, 20261021));
    select * into v_case from app.owner_manual_payment_cases owner_case
      where owner_case.legacy_candidate_id = p_candidate_id for share;
    if v_case.id is not null then
      if (p_decision = 'approve' and v_case.status = 'awaiting_manual_credit')
        or (p_decision = 'reject' and v_case.status = 'rejected'
          and v_case.rejection_reason = p_rejection_reason) then
        return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
      end if;
      raise exception 'The Owner payment decision already exists.';
    end if;
    if exists (select 1 from app.owner_manual_payment_cases owner_case
        where owner_case.payment_provider_id = v_old.payment_provider_id
          and owner_case.reference_fingerprint = v_old.reference_fingerprint)
      or exists (select 1 from app.provider_payment_evidence evidence
        where evidence.payment_provider_id = v_old.payment_provider_id
          and evidence.canonical_reference_fingerprint = v_old.reference_fingerprint)
      or exists (select 1 from app.routine_telebirr_paid_intent_openings opening
        where opening.payment_provider_id = v_old.payment_provider_id
          and opening.reference_fingerprint = v_old.reference_fingerprint) then
      raise exception 'The older payment reference cannot be reserved.';
    end if;
    insert into app.owner_manual_payment_cases
      (provider_code,payment_provider_id,reference_fingerprint,reference_masked,
        legacy_candidate_id,status,amount_minor,rejection_reason,decided_by_admin_id)
    values ('telebirr',v_old.payment_provider_id,v_old.reference_fingerprint,
      v_legacy.candidate_reference_masked,p_candidate_id,
      case when p_decision = 'approve' then 'awaiting_manual_credit' else 'rejected' end,
      v_old.amount_minor,p_rejection_reason,v_actor_id)
    returning * into v_case;
    if p_decision = 'reject' then
      perform app.queue_owner_manual_payment_outcome(p_candidate_id,'rejected',null);
    end if;
    return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_candidate.provider_code || ':' || v_candidate.reference_fingerprint, 20261021));
  select * into v_case from app.owner_manual_payment_cases owner_case
    where owner_case.candidate_id = p_candidate_id for share;
  if v_case.id is not null then
    if (p_decision = 'approve' and v_case.status = 'awaiting_manual_credit')
      or (p_decision = 'reject' and v_case.status = 'rejected'
        and v_case.rejection_reason = p_rejection_reason) then
      return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
    end if;
    raise exception 'The Owner payment decision already exists.';
  end if;
  if exists (select 1 from app.owner_manual_payment_cases owner_case
      where owner_case.payment_provider_id = v_candidate.payment_provider_id
        and owner_case.reference_fingerprint = v_candidate.reference_fingerprint)
    or exists (select 1 from app.provider_payment_evidence evidence
      where evidence.payment_provider_id = v_candidate.payment_provider_id
        and evidence.canonical_reference_fingerprint = v_candidate.reference_fingerprint)
    or exists (select 1 from app.receiver_sms_intent_openings opening
      where opening.candidate_id = p_candidate_id)
    or exists (select 1 from app.receiver_sms_owner_decisions old_decision
      where old_decision.candidate_id = p_candidate_id)
    or exists (select 1 from app.receiver_sms_deposit_candidates earlier
      where earlier.provider_code = v_candidate.provider_code
        and earlier.reference_fingerprint = v_candidate.reference_fingerprint
        and (earlier.submitted_at, earlier.id) <
          (v_candidate.submitted_at, v_candidate.id)) then
    raise exception 'The payment reference cannot be reserved for manual review.';
  end if;
  select sms.* into v_event from app.receiver_sms_payment_events sms
    where sms.provider_code = v_candidate.provider_code
      and sms.reference_fingerprint = v_candidate.reference_fingerprint for share;
  insert into app.owner_manual_payment_cases
    (provider_code, payment_provider_id, reference_fingerprint, reference_masked,
      candidate_id, payment_event_id, status, amount_minor,
      receiver_account_id, receiver_account_version, rejection_reason,
      decided_by_admin_id)
  values (v_candidate.provider_code,v_candidate.payment_provider_id,
    v_candidate.reference_fingerprint,v_candidate.reference_masked,
    v_candidate.id,v_event.id,
    case when p_decision = 'approve' then 'awaiting_manual_credit' else 'rejected' end,
    v_event.amount_minor,v_event.receiver_account_id,v_event.receiver_account_version,
    p_rejection_reason,v_actor_id)
  returning * into v_case;
  if p_decision = 'reject' then
    perform app.queue_owner_manual_payment_outcome(v_candidate.id,'rejected',null);
  end if;
  return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
end;
$$;
alter function app.decide_owner_manual_payment_case(uuid,uuid,text,text) owner to postgres;
revoke all on function app.decide_owner_manual_payment_case(uuid,uuid,text,text)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.decide_owner_manual_payment_case(uuid,uuid,text,text)
  to fetanagent_owner_control;

create function app.complete_owner_manual_payment_case(
  p_actor_auth_user_id uuid, p_case_id uuid, p_payment_event_id uuid,
  p_amount_minor bigint, p_receiver_account_id uuid,
  p_bank_payment_confirmed boolean, p_player_credited_confirmed boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_actor_id uuid;
  v_case app.owner_manual_payment_cases%rowtype;
  v_event app.receiver_sms_payment_events%rowtype;
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_receiver app.receiver_accounts%rowtype;
  v_amount bigint;
  v_receiver_id uuid;
  v_receiver_version integer;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or ((p_case_id is null) = (p_payment_event_id is null))
    or p_player_credited_confirmed is distinct from true then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active'
    for share;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  if p_case_id is not null then
    select * into v_case from app.owner_manual_payment_cases owner_case
      where owner_case.id = p_case_id for update;
    if v_case.id is null then raise exception 'The Owner case is unavailable.'; end if;
  else
    select * into v_event from app.receiver_sms_payment_events sms
      where sms.id = p_payment_event_id for share;
    if v_event.id is null then raise exception 'The receiving-phone payment is unavailable.'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    coalesce(v_case.provider_code,v_event.provider_code) || ':' ||
    coalesce(v_case.reference_fingerprint,v_event.reference_fingerprint), 20261021));
  if v_case.id is not null and v_case.status = 'manually_credited' then
    return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
  end if;
  if v_case.id is not null and v_case.status not in
    ('awaiting_manual_credit','rejected') then
    raise exception 'The Owner case is not available for manual resolution.';
  end if;
  if v_case.id is null then
    if exists (select 1 from app.owner_manual_payment_cases owner_case
        where owner_case.payment_provider_id = v_event.payment_provider_id
          and owner_case.reference_fingerprint = v_event.reference_fingerprint) then
      raise exception 'The payment already has an Owner case.';
    end if;
    select * into v_candidate from app.receiver_sms_deposit_candidates candidate
      where candidate.provider_code = v_event.provider_code
        and candidate.reference_fingerprint = v_event.reference_fingerprint
      order by candidate.submitted_at,candidate.id limit 1 for share;
    if v_candidate.id is not null and (
      not exists (select 1 from app.receiver_sms_settlement_lineages lineage
        join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
        where lineage.candidate_id = v_candidate.id
          and intent.status in ('rejected','cancelled'))
      or exists (select 1 from app.receiver_sms_settlement_lineages lineage
        join app.deposit_jobs job on job.deposit_intent_id = lineage.deposit_intent_id
        where lineage.candidate_id = v_candidate.id
          and job.status not in ('cancelled','dead'))
      or exists (select 1 from app.receiver_sms_settlement_lineages lineage
        join app.deposit_execution_attempts attempt
          on attempt.deposit_intent_id = lineage.deposit_intent_id
        where lineage.candidate_id = v_candidate.id
          and attempt.status <> 'cancelled_before_action')) then
      raise exception 'The automatic credit is not proven stopped before manual resolution.';
    end if;
  else
    select * into v_event from app.receiver_sms_payment_events sms
      where sms.provider_code = v_case.provider_code
        and sms.reference_fingerprint = v_case.reference_fingerprint for share;
  end if;
  if v_case.id is not null or v_candidate.id is null then
    if exists (select 1 from app.provider_payment_evidence evidence
      where evidence.payment_provider_id =
        coalesce(v_case.payment_provider_id,v_event.payment_provider_id)
        and evidence.canonical_reference_fingerprint =
          coalesce(v_case.reference_fingerprint,v_event.reference_fingerprint)) then
      raise exception 'The payment reference already entered automatic credit.';
    end if;
  end if;
  if v_event.id is not null then
    if p_amount_minor is not null or p_receiver_account_id is not null then
      raise exception 'Signed SMS details cannot be overridden.';
    end if;
    v_amount := v_event.amount_minor;
    v_receiver_id := v_event.receiver_account_id;
    v_receiver_version := v_event.receiver_account_version;
  else
    if p_bank_payment_confirmed is distinct from true
      or p_amount_minor is null or p_amount_minor not between 2500 and 2500000
      or p_receiver_account_id is null then
      raise exception 'Amount, receiving account and bank confirmation are required.';
    end if;
    if v_case.legacy_candidate_id is not null
      and p_amount_minor is distinct from v_case.amount_minor then
      raise exception 'The entered amount differs from the signed older receipt.';
    end if;
    select * into v_receiver from app.receiver_accounts receiver
      where receiver.id = p_receiver_account_id
        and receiver.provider_id = v_case.payment_provider_id for share;
    if v_receiver.id is null then raise exception 'The receiving account is unavailable.'; end if;
    v_amount := p_amount_minor;
    v_receiver_id := v_receiver.id;
    v_receiver_version := v_receiver.version;
  end if;
  if v_amount not between 2500 and 2500000 then
    raise exception 'The payment amount is outside supported limits.';
  end if;
  if v_case.id is null then
    insert into app.owner_manual_payment_cases
      (provider_code,payment_provider_id,reference_fingerprint,reference_masked,
        candidate_id,payment_event_id,
        status,amount_minor,receiver_account_id,receiver_account_version,
        decided_by_admin_id,completed_by_admin_id,completed_at,bank_payment_confirmed)
    values (v_event.provider_code,v_event.payment_provider_id,
      v_event.reference_fingerprint,v_candidate.reference_masked,v_candidate.id,
      v_event.id,'manually_credited',v_amount,
      v_receiver_id,v_receiver_version,v_actor_id,v_actor_id,
      pg_catalog.clock_timestamp(),p_bank_payment_confirmed is true)
    returning * into v_case;
  else
    update app.owner_manual_payment_cases owner_case
      set status = 'manually_credited', amount_minor = v_amount,
        receiver_account_id = v_receiver_id,
        receiver_account_version = v_receiver_version,
        payment_event_id = v_event.id,
        completed_by_admin_id = v_actor_id,
        completed_at = pg_catalog.clock_timestamp(),
        bank_payment_confirmed = p_bank_payment_confirmed is true,
        updated_at = pg_catalog.clock_timestamp()
      where owner_case.id = v_case.id and owner_case.status in
        ('awaiting_manual_credit','rejected')
      returning * into v_case;
    if v_case.id is null then raise exception 'The Owner case changed.'; end if;
  end if;
  if coalesce(v_case.candidate_id,v_case.legacy_candidate_id) is not null then
    perform app.queue_owner_manual_payment_outcome(
      coalesce(v_case.candidate_id,v_case.legacy_candidate_id),'credited',v_amount);
  end if;
  return pg_catalog.jsonb_build_object('caseId',v_case.id,'status',v_case.status);
end;
$$;
alter function app.complete_owner_manual_payment_case(uuid,uuid,uuid,bigint,uuid,boolean,boolean)
  owner to postgres;
revoke all on function app.complete_owner_manual_payment_case(uuid,uuid,uuid,bigint,uuid,boolean,boolean)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.complete_owner_manual_payment_case(uuid,uuid,uuid,bigint,uuid,boolean,boolean)
  to fetanagent_owner_control;

create function app.list_owner_manual_payment_cases(
  p_actor_auth_user_id uuid, p_status text, p_limit integer, p_offset integer
) returns table (
  case_id uuid, candidate_id uuid, legacy_candidate_id uuid,
  payment_event_id uuid, provider_code text,
  reference_masked text, submitted_at timestamptz, payment_at timestamptz,
  amount_minor bigint, receiver_account_id uuid, receiver_account_masked text,
  player_masked text, case_status text, rejection_reason text,
  decided_at timestamptz, completed_at timestamptz
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or p_status is null
    or p_status not in ('pending','awaiting_manual_credit','manually_credited','rejected')
    or p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  if p_status = 'pending' then
    return query
    select pending.* from (
      select null::uuid as case_id, candidate.id as candidate_id,
        null::uuid as legacy_candidate_id, sms.id as payment_event_id,
        candidate.provider_code, candidate.reference_masked,
        candidate.submitted_at, sms.occurred_at as payment_at,
        sms.amount_minor, sms.receiver_account_id,
        receiver.account_reference_masked as receiver_account_masked,
        '***' || pg_catalog.right(player.player_id,4) as player_masked,
        'pending'::text as case_status, null::text as rejection_reason,
        null::timestamptz as decided_at, null::timestamptz as completed_at
      from app.receiver_sms_deposit_candidates candidate
      join app.customer_platform_players player on player.id = candidate.player_account_id
      left join app.receiver_sms_payment_events sms
        on sms.provider_code = candidate.provider_code
          and sms.reference_fingerprint = candidate.reference_fingerprint
      left join app.receiver_accounts receiver on receiver.id = sms.receiver_account_id
      where not exists (select 1 from app.owner_manual_payment_cases owner_case
          where owner_case.payment_provider_id = candidate.payment_provider_id
            and owner_case.reference_fingerprint = candidate.reference_fingerprint)
        and not exists (select 1 from app.provider_payment_evidence evidence
          where evidence.payment_provider_id = candidate.payment_provider_id
            and evidence.canonical_reference_fingerprint = candidate.reference_fingerprint)
        and not exists (select 1 from app.receiver_sms_intent_openings opening
          where opening.candidate_id = candidate.id)
        and not exists (select 1 from app.receiver_sms_owner_decisions old_decision
          where old_decision.candidate_id = candidate.id)
        and not exists (select 1 from app.receiver_sms_deposit_candidates earlier
          where earlier.provider_code = candidate.provider_code
            and earlier.reference_fingerprint = candidate.reference_fingerprint
            and (earlier.submitted_at,earlier.id) <
              (candidate.submitted_at,candidate.id))
      union all
      select null::uuid, null::uuid, legacy.id, null::uuid,
        'telebirr'::text, legacy.candidate_reference_masked,
        legacy.submitted_at, observation.occurred_at, observation.amount_minor,
        null::uuid, null::text,
        '***' || pg_catalog.right(player.player_id,4),
        'pending'::text, null::text, null::timestamptz, null::timestamptz
      from app.routine_telebirr_old_payment_observations observation
      join app.routine_telebirr_untrusted_proof_requests legacy
        on legacy.id = observation.candidate_id and legacy.origin_channel = 'telegram'
      join app.customer_platform_players player on player.id = legacy.player_account_id
      where not exists (select 1 from app.owner_manual_payment_cases owner_case
          where owner_case.payment_provider_id = observation.payment_provider_id
            and owner_case.reference_fingerprint = observation.reference_fingerprint)
        and not exists (select 1 from app.provider_payment_evidence evidence
          where evidence.payment_provider_id = observation.payment_provider_id
            and evidence.canonical_reference_fingerprint = observation.reference_fingerprint)
        and not exists (select 1 from app.routine_telebirr_old_payment_decisions decision
          where decision.candidate_id = legacy.id)
        and not exists (select 1 from app.routine_telebirr_fast_results result
          where result.candidate_id = legacy.id)
        and not exists (select 1 from app.routine_telebirr_paid_intent_openings opening
          where opening.payment_provider_id = observation.payment_provider_id
            and opening.reference_fingerprint = observation.reference_fingerprint)
    ) pending
    order by pending.submitted_at desc,
      coalesce(pending.candidate_id,pending.legacy_candidate_id) desc
    limit p_limit offset p_offset;
  else
    return query
    select owner_case.id, owner_case.candidate_id, owner_case.legacy_candidate_id, sms.id,
      owner_case.provider_code, owner_case.reference_masked,
      coalesce(candidate.submitted_at,legacy.submitted_at),
      coalesce(sms.occurred_at,observation.occurred_at),
      coalesce(sms.amount_minor,owner_case.amount_minor),
      coalesce(sms.receiver_account_id,owner_case.receiver_account_id),
      receiver.account_reference_masked,
      case when player.id is not null then '***' || pg_catalog.right(player.player_id,4)
        else null::text end,
      owner_case.status, owner_case.rejection_reason,
      owner_case.decided_at, owner_case.completed_at
    from app.owner_manual_payment_cases owner_case
    left join app.receiver_sms_deposit_candidates candidate
      on candidate.id = owner_case.candidate_id
    left join app.routine_telebirr_untrusted_proof_requests legacy
      on legacy.id = owner_case.legacy_candidate_id
    left join app.routine_telebirr_old_payment_observations observation
      on observation.candidate_id = legacy.id
    left join app.customer_platform_players player
      on player.id = coalesce(candidate.player_account_id,legacy.player_account_id)
    left join app.receiver_sms_payment_events sms
      on sms.provider_code = owner_case.provider_code
        and sms.reference_fingerprint = owner_case.reference_fingerprint
    left join app.receiver_accounts receiver
      on receiver.id = coalesce(sms.receiver_account_id,owner_case.receiver_account_id)
    where owner_case.status = p_status
    order by owner_case.decided_at desc, owner_case.id desc
    limit p_limit offset p_offset;
  end if;
end;
$$;
alter function app.list_owner_manual_payment_cases(uuid,text,integer,integer) owner to postgres;
revoke all on function app.list_owner_manual_payment_cases(uuid,text,integer,integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.list_owner_manual_payment_cases(uuid,text,integer,integer)
  to fetanagent_owner_control;

create function app.list_owner_receiver_sms_inbox(
  p_actor_auth_user_id uuid, p_limit integer, p_offset integer
) returns table (
  payment_event_id uuid, provider_code text, payment_at timestamptz,
  received_at timestamptz, amount_minor bigint, receiver_account_masked text,
  receiver_holder_name text, reference_masked text, candidate_id uuid,
  player_masked text, payment_status text, case_id uuid,
  can_mark_manually_credited boolean
) language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select sms.id, sms.provider_code, sms.occurred_at, sms.received_at,
    sms.amount_minor, receiver.account_reference_masked,
    receiver.account_holder_name, candidate.reference_masked,
    candidate.id,
    case when player.id is not null then '***' || pg_catalog.right(player.player_id,4)
      else null::text end,
    case when owner_case.id is not null then owner_case.status
      when intent.status = 'executed' then 'auto_credited'
      when intent.status in ('rejected','expired','cancelled') then 'auto_not_credited'
      when lineage.candidate_id is not null then 'auto_processing'
      when evidence.id is not null then 'auto_used'
      when matched.disposition in ('older_review','held_review') then 'pending_review'
      when candidate.id is not null then 'submission_waiting'
      else 'unmatched' end,
    owner_case.id,
    owner_case.id is null and (
      (candidate.id is null and evidence.id is null)
      or (candidate.id is not null
        and coalesce(intent.status in ('rejected','cancelled'),false)
        and not exists (select 1 from app.deposit_jobs job
          where job.deposit_intent_id = lineage.deposit_intent_id
            and job.status not in ('cancelled','dead'))
        and not exists (select 1 from app.deposit_execution_attempts attempt
          where attempt.deposit_intent_id = lineage.deposit_intent_id
            and attempt.status <> 'cancelled_before_action')))
  from app.receiver_sms_payment_events sms
  join app.receiver_accounts receiver on receiver.id = sms.receiver_account_id
  left join app.owner_manual_payment_cases owner_case
    on owner_case.payment_provider_id = sms.payment_provider_id
      and owner_case.reference_fingerprint = sms.reference_fingerprint
  left join lateral (
    select first_candidate.* from app.receiver_sms_deposit_candidates first_candidate
      where first_candidate.provider_code = sms.provider_code
        and first_candidate.reference_fingerprint = sms.reference_fingerprint
      order by first_candidate.submitted_at, first_candidate.id limit 1
  ) candidate on true
  left join app.customer_platform_players player on player.id = candidate.player_account_id
  left join app.receiver_sms_payment_matches matched
    on matched.candidate_id = candidate.id
  left join app.receiver_sms_settlement_lineages lineage
    on lineage.candidate_id = candidate.id
  left join app.deposit_intents intent on intent.id = lineage.deposit_intent_id
  left join app.provider_payment_evidence evidence
    on evidence.payment_provider_id = sms.payment_provider_id
      and evidence.canonical_reference_fingerprint = sms.reference_fingerprint
  order by sms.received_at desc, sms.id desc
  limit p_limit offset p_offset;
end;
$$;
alter function app.list_owner_receiver_sms_inbox(uuid,integer,integer) owner to postgres;
revoke all on function app.list_owner_receiver_sms_inbox(uuid,integer,integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.list_owner_receiver_sms_inbox(uuid,integer,integer)
  to fetanagent_owner_control;

-- Keep later phone delivery and the settlement poller from revisiting a
-- reference already under Owner control. Both patches require an exact source.
do $patch$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.match_receiver_sms_payment(text,text)'::pg_catalog.regprocedure);
  v_old := '  if v_candidate.id is null or v_event.id is null then return ''waiting''; end if;';
  v_new := '  if exists (select 1 from app.owner_manual_payment_cases owner_case'
    || E'\n' || '      where owner_case.provider_code = p_provider_code'
    || E'\n' || '        and owner_case.reference_fingerprint = p_reference_fingerprint) then'
    || E'\n' || '    return ''owner_review'';'
    || E'\n' || '  end if;'
    || E'\n' || v_old;
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'Receiver SMS matching source changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);

  v_source := pg_catalog.pg_get_functiondef(
    'app.settle_next_receiver_sms_match()'::pg_catalog.regprocedure);
  v_old := '      and not exists (select 1 from app.receiver_sms_settlement_holds held'
    || E'\n' || '        where held.candidate_id = candidate.id)';
  v_new := v_old || E'\n' ||
    '      and not exists (select 1 from app.owner_manual_payment_cases owner_case'
    || E'\n' || '        where owner_case.payment_provider_id = candidate.payment_provider_id'
    || E'\n' || '          and owner_case.reference_fingerprint = candidate.reference_fingerprint)';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> 2 * pg_catalog.length(v_old) then
    raise exception 'Receiver SMS settlement poller source changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);

  v_source := pg_catalog.pg_get_functiondef(
    'app.capture_telegram_receiver_sms_candidate(uuid,text,text,text,text,text,smallint,smallint,text)'
      ::pg_catalog.regprocedure);
  v_old := '    return query select v_existing.id, v_status, v_existing.submitted_at, true;';
  v_new := '    v_status := coalesce((select case'
    || E'\n' || '      when owner_case.status = ''awaiting_manual_credit'' then ''held_review'''
    || E'\n' || '      else ''already_used'' end'
    || E'\n' || '      from app.owner_manual_payment_cases owner_case'
    || E'\n' || '      where owner_case.payment_provider_id = v_existing.payment_provider_id'
    || E'\n' || '        and owner_case.reference_fingerprint = v_existing.reference_fingerprint),'
    || E'\n' || '      v_status);'
    || E'\n' || v_old;
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'Receiver SMS candidate replay source changed.';
  end if;
  v_source := pg_catalog.replace(v_source,v_old,v_new);
  v_old := '  return query select v_existing.id, v_status, v_existing.submitted_at, false;';
  v_new := '  v_status := coalesce((select case'
    || E'\n' || '    when owner_case.status = ''awaiting_manual_credit'' then ''held_review'''
    || E'\n' || '    else ''already_used'' end'
    || E'\n' || '    from app.owner_manual_payment_cases owner_case'
    || E'\n' || '    where owner_case.payment_provider_id = v_existing.payment_provider_id'
    || E'\n' || '      and owner_case.reference_fingerprint = v_existing.reference_fingerprint),'
    || E'\n' || '    v_status);'
    || E'\n' || v_old;
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'Receiver SMS candidate result source changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$patch$;

-- The older TeleBirr inbox remains read-only and must stop listing cases once
-- the unified manual queue has recorded an Owner decision.
do $old_list_patch$
declare
  v_source text;
  v_old text;
  v_new text;
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.list_owner_routine_telebirr_old_payments(uuid,integer)'::pg_catalog.regprocedure);
  v_old := '  where not exists (select 1 from app.routine_telebirr_old_payment_decisions decision'
    || E'\n' || '    where decision.candidate_id = candidate.id)';
  v_new := v_old || E'\n' ||
    '    and not exists (select 1 from app.owner_manual_payment_cases owner_case'
    || E'\n' || '      where owner_case.legacy_candidate_id = candidate.id)';
  if pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source,v_old,''))
      <> pg_catalog.length(v_old) then
    raise exception 'Older TeleBirr inbox source changed.';
  end if;
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$old_list_patch$;

-- Keep the read-only historical TeleBirr view consistent with the manual
-- case ledger. It must not show an already handled receipt as waiting approval.
do $transactions_patch$
declare
  v_source text;
  v_old text;
  v_new text;
  v_pairs text[][];
  v_pair text[];
begin
  v_source := pg_catalog.pg_get_functiondef(
    'app.list_owner_routine_telebirr_transactions(uuid,text,date,date,text,integer,integer)'
      ::pg_catalog.regprocedure);
  v_pairs := array[
    array[
      '      old_decision.decided_at as old_decided_at,',
      '      old_decision.decided_at as old_decided_at,' || E'\n' ||
        '      owner_case.status as owner_manual_status,' || E'\n' ||
        '      owner_case.rejection_reason as owner_manual_reason,' || E'\n' ||
        '      owner_case.decided_at as owner_manual_decided_at,' || E'\n' ||
        '      owner_case.completed_at as owner_manual_completed_at,'
    ],
    array[
      '    left join app.routine_telebirr_old_payment_decisions old_decision' || E'\n' ||
        '      on old_decision.candidate_id = candidate.id',
      '    left join app.routine_telebirr_old_payment_decisions old_decision' || E'\n' ||
        '      on old_decision.candidate_id = candidate.id' || E'\n' ||
        '    left join app.owner_manual_payment_cases owner_case' || E'\n' ||
        '      on owner_case.legacy_candidate_id = candidate.id'
    ],
    array[
      '  ), classified as materialized (' || E'\n' ||
        '    select base.*,' || E'\n' || '      case' || E'\n' ||
        '        when old_decision = ''rejected'' then ''rejected''',
      '  ), classified as materialized (' || E'\n' ||
        '    select base.*,' || E'\n' || '      case' || E'\n' ||
        '        when owner_manual_status = ''manually_credited'' then ''credited''' || E'\n' ||
        '        when owner_manual_status = ''rejected'' then ''rejected''' || E'\n' ||
        '        when owner_manual_status = ''awaiting_manual_credit'' then ''pending''' || E'\n' ||
        '        when old_decision = ''rejected'' then ''rejected'''
    ],
    array[
      '      end as status_group,' || E'\n' || '      case' || E'\n' ||
        '        when old_decision = ''rejected'' then ''rejected''',
      '      end as status_group,' || E'\n' || '      case' || E'\n' ||
        '        when owner_manual_status = ''manually_credited'' then ''manually_credited''' || E'\n' ||
        '        when owner_manual_status = ''rejected'' then ''rejected''' || E'\n' ||
        '        when owner_manual_status = ''awaiting_manual_credit'' then ''awaiting_manual_credit''' || E'\n' ||
        '        when old_decision = ''rejected'' then ''rejected'''
    ],
    array[
      '      end as status_detail,' || E'\n' || '      case' || E'\n' ||
        '        when old_decision = ''rejected'' then ''Payment older than 1 hour''',
      '      end as status_detail,' || E'\n' || '      case' || E'\n' ||
        '        when owner_manual_status = ''manually_credited'' then ''Owner marked manually credited''' || E'\n' ||
        '        when owner_manual_status = ''rejected'' then owner_manual_reason' || E'\n' ||
        '        when owner_manual_status = ''awaiting_manual_credit'' then ''Awaiting manual credit''' || E'\n' ||
        '        when old_decision = ''rejected'' then ''Payment older than 1 hour'''
    ],
    array[
      '      end as reason,' || E'\n' || '      case' || E'\n' ||
        '        when old_decision is not null then old_decided_by',
      '      end as reason,' || E'\n' || '      case' || E'\n' ||
        '        when owner_manual_status is not null then ''Owner''' || E'\n' ||
        '        when old_decision is not null then old_decided_by'
    ],
    array[
      '      end as decided_by,' || E'\n' || '      case' || E'\n' ||
        '        when old_decision is not null then old_decided_at',
      '      end as decided_by,' || E'\n' || '      case' || E'\n' ||
        '        when owner_manual_status is not null then' || E'\n' ||
        '          coalesce(owner_manual_completed_at,owner_manual_decided_at)' || E'\n' ||
        '        when old_decision is not null then old_decided_at'
    ],
    array[
      'where status_detail in (''waiting_approval'',''held_review'')',
      'where status_detail in (''waiting_approval'',''held_review'',''awaiting_manual_credit'')'
    ]
  ];
  foreach v_pair slice 1 in array v_pairs loop
    v_old := v_pair[1];
    v_new := v_pair[2];
    if pg_catalog.length(v_source) -
      pg_catalog.length(pg_catalog.replace(v_source,v_old,'')) <>
      pg_catalog.length(v_old) then
      raise exception 'Owner TeleBirr history source changed.';
    end if;
    v_source := pg_catalog.replace(v_source,v_old,v_new);
  end loop;
  execute v_source;
end;
$transactions_patch$;

commit;
