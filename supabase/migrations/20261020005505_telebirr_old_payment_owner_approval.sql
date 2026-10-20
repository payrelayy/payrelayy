-- Rule 5: an authenticated, otherwise valid old receipt needs an immutable
-- Owner decision. The fresh automatic staging window remains unchanged.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_old_payment_cutover (
  singleton boolean primary key default true check (singleton),
  enabled_at timestamptz not null
);
insert into app.routine_telebirr_old_payment_cutover (singleton, enabled_at)
values (true, pg_catalog.clock_timestamp());
alter table app.routine_telebirr_old_payment_cutover owner to postgres;
alter table app.routine_telebirr_old_payment_cutover enable row level security;
alter table app.routine_telebirr_old_payment_cutover force row level security;
revoke all on app.routine_telebirr_old_payment_cutover
  from public, anon, authenticated, service_role;

create table app.routine_telebirr_old_payment_observations
  (like app.routine_telebirr_paid_observation_staging including all);
alter table app.routine_telebirr_old_payment_observations
  add constraint routine_old_payment_challenge_fk foreign key (challenge_id)
    references app.routine_telebirr_lookup_challenges(challenge_id) on delete restrict,
  add constraint routine_old_payment_candidate_fk foreign key (candidate_id)
    references app.routine_telebirr_untrusted_proof_requests(id) on delete restrict,
  add constraint routine_old_payment_challenge_candidate_key unique (challenge_id, candidate_id);
create trigger routine_old_payment_observation_immutable
before update or delete on app.routine_telebirr_old_payment_observations
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
alter table app.routine_telebirr_old_payment_observations owner to postgres;
alter table app.routine_telebirr_old_payment_observations enable row level security;
alter table app.routine_telebirr_old_payment_observations force row level security;
revoke all on app.routine_telebirr_old_payment_observations
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_paid_poll,
    fetanagent_routine_telebirr_paid_poll_runtime,
    fetanagent_owner_control,
    fetanagent_owner_control_runtime;

create table app.routine_telebirr_old_payment_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  candidate_id uuid not null unique,
  challenge_id uuid not null unique,
  decision text not null check (decision in ('approved', 'rejected')),
  reason_code text not null check (reason_code in
    ('owner_approved_old_payment', 'payment_older_than_one_hour')),
  actor_admin_id uuid not null references app.admin_users(id) on delete restrict,
  decided_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_old_payment_decision_shape check (
    (decision = 'approved' and reason_code = 'owner_approved_old_payment')
    or (decision = 'rejected' and reason_code = 'payment_older_than_one_hour')
  ),
  constraint routine_old_payment_decision_observation_fk
    foreign key (challenge_id, candidate_id)
    references app.routine_telebirr_old_payment_observations(challenge_id, candidate_id)
    on delete restrict
);
create trigger routine_old_payment_decision_immutable
before update or delete on app.routine_telebirr_old_payment_decisions
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
alter table app.routine_telebirr_old_payment_decisions owner to postgres;
alter table app.routine_telebirr_old_payment_decisions enable row level security;
alter table app.routine_telebirr_old_payment_decisions force row level security;
revoke all on app.routine_telebirr_old_payment_decisions
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_paid_poll,
    fetanagent_routine_telebirr_paid_poll_runtime,
    fetanagent_owner_control,
    fetanagent_owner_control_runtime;

-- Clone the exact reviewed staging validator, preserving its signed-device,
-- current-policy, stop-lock and replay checks. Change only the destination and
-- the two receipt-age predicates. There is no general age bypass on the normal
-- staging function. This new function still requires the paired broker login.
do $old_stage$
declare
  v_def text;
  v_proc pg_catalog.pg_proc%rowtype;
  v_old text;
  v_new text;
begin
  select * into v_proc from pg_catalog.pg_proc
    where oid = 'app.stage_routine_telebirr_paid_signed_observation(uuid,text,text,text,text,jsonb)'::pg_catalog.regprocedure;
  if v_proc.oid is null or v_proc.proowner <> 'postgres'::pg_catalog.regrole
    or not v_proc.prosecdef or v_proc.proconfig <> array['search_path=pg_catalog']::text[] then
    raise exception 'The paid staging validator changed.';
  end if;
  v_def := pg_catalog.pg_get_functiondef(v_proc.oid);
  v_old := 'stage_routine_telebirr_paid_signed_observation';
  if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,'')))
      <> pg_catalog.length(v_old) then raise exception 'Paid staging name drift.'; end if;
  v_def := pg_catalog.replace(v_def,v_old,'stage_routine_telebirr_old_signed_observation');
  v_old := 'routine_telebirr_paid_observation_staging';
  if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,'')))
      <> 3*pg_catalog.length(v_old) then raise exception 'Paid staging table drift.'; end if;
  v_def := pg_catalog.replace(v_def,v_old,'routine_telebirr_old_payment_observations');
  v_old := 'or v_occurred_at < v_candidate.submitted_at - interval ''1 hour''';
  v_new := 'or v_occurred_at >= v_candidate.submitted_at - interval ''1 hour''';
  if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,'')))
      <> pg_catalog.length(v_old) then raise exception 'Paid staging age drift.'; end if;
  v_def := pg_catalog.replace(v_def,v_old,v_new);
  v_old := 'or v_occurred_at + interval ''1 hour'' <= v_now';
  if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,'')))
      <> pg_catalog.length(v_old) then raise exception 'Paid staging expiry drift.'; end if;
  v_def := pg_catalog.replace(v_def,v_old,'or false');
  v_old := 'or v_candidate.submitted_at < v_authorized_at';
  v_new := 'or v_candidate.submitted_at < v_authorized_at'
    || E'\n    or v_candidate.submitted_at < ('
    || E'\n      select cutover.enabled_at from app.routine_telebirr_old_payment_cutover cutover'
    || E'\n      where cutover.singleton)';
  if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,'')))
      <> pg_catalog.length(v_old) then raise exception 'Old payment cutover drift.'; end if;
  v_def := pg_catalog.replace(v_def,v_old,v_new);
  v_old := 'or not exists (select 1 from app.routine_telebirr_device_enrollments enrollment';
  v_new := 'or exists (select 1 from app.routine_telebirr_fast_results result'
    || E'\n       where result.candidate_id = v_candidate.id)'
    || E'\n    or exists (select 1 from app.routine_telebirr_paid_observation_staging staged'
    || E'\n       where staged.payment_provider_id = v_candidate.payment_provider_id'
    || E'\n         and staged.reference_fingerprint = v_candidate.candidate_reference_fingerprint)'
    || E'\n    or exists (select 1 from app.routine_telebirr_paid_intent_openings opening'
    || E'\n       where opening.payment_provider_id = v_candidate.payment_provider_id'
    || E'\n         and opening.reference_fingerprint = v_candidate.candidate_reference_fingerprint)'
    || E'\n    ' || v_old;
  if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,'')))
      <> pg_catalog.length(v_old) then raise exception 'Paid staging identity drift.'; end if;
  v_def := pg_catalog.replace(v_def,v_old,v_new);
  execute v_def;
end;
$old_stage$;
alter function app.stage_routine_telebirr_old_signed_observation(uuid,text,text,text,text,jsonb)
  owner to postgres;
revoke all on function app.stage_routine_telebirr_old_signed_observation(uuid,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_paid_poll,
    fetanagent_routine_telebirr_paid_poll_runtime;
grant execute on function app.stage_routine_telebirr_old_signed_observation(uuid,text,text,text,text,jsonb)
  to fetanagent_routine_telebirr_paid_poll;

alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_stage_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_stage_check
  check (notification_stage in ('checking','waiting','old_pending','final'));
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_code_check check (outcome_code in (
    'checking','verified_waiting','credited','rejected','not_credited',
    'not_verified','already_used','wrong_receiver','invalid_reference',
    'manual_review','unrelated_receipt','held_review',
    'older_pending','old_rejected'
  ));
alter table app.telegram_deposit_outcome_deliveries
  drop constraint telegram_outcome_stage_code_check;
alter table app.telegram_deposit_outcome_deliveries
  add constraint telegram_outcome_stage_code_check check (
    (notification_stage = 'checking' and outcome_code = 'checking')
    or (notification_stage = 'waiting' and outcome_code = 'verified_waiting')
    or (notification_stage = 'old_pending' and outcome_code = 'older_pending')
    or (notification_stage = 'final' and outcome_code not in
      ('checking','verified_waiting','older_pending'))
  );

create function app.announce_routine_telebirr_old_payment()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_chat_id bigint;
begin
  insert into app.routine_telebirr_paid_check_audit
    (candidate_id, challenge_id, source, reason_code, classification_code,
     evidence_digest, checked_at)
  values (new.candidate_id, new.challenge_id, 'signed_observation',
    'old_receipt', 'pending_owner_approval', new.observation_body_digest,
    new.observed_at)
  on conflict (source, evidence_digest) do nothing;
  select telegram.private_chat_id into v_chat_id
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.telegram_identities telegram
      on telegram.customer_identity_id = candidate.origin_identity_id
      and telegram.private_chat_id = telegram.telegram_user_id
    join app.inbound_events inbound_event
      on inbound_event.id = candidate.origin_request_key
      and inbound_event.customer_identity_id = candidate.origin_identity_id
      and inbound_event.channel = 'telegram'
    where candidate.id = new.candidate_id;
  if v_chat_id is not null then
    insert into app.telegram_deposit_outcome_deliveries
      (candidate_id, notification_stage, private_chat_id, reference_masked,
       outcome_code, amount_minor)
    select candidate.id, 'old_pending', v_chat_id,
      candidate.candidate_reference_masked, 'older_pending', null
      from app.routine_telebirr_untrusted_proof_requests candidate
      where candidate.id = new.candidate_id
    on conflict (candidate_id, notification_stage) do nothing;
  end if;
  return new;
end;
$$;
alter function app.announce_routine_telebirr_old_payment() owner to postgres;
revoke all on function app.announce_routine_telebirr_old_payment()
  from public, anon, authenticated, service_role;
create trigger routine_old_payment_announce
after insert on app.routine_telebirr_old_payment_observations
for each row execute function app.announce_routine_telebirr_old_payment();

-- A verified old observation is not a failed phone check. It is kept out of
-- the five-minute inconclusive resolver and also proves cross-customer reuse.
do $fast_old$
declare v_def text; v_old text; v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'app.resolve_routine_telebirr_fast_results()'::pg_catalog.regprocedure)
    into v_def;
  v_old := 'and not exists (select 1 from app.routine_telebirr_paid_intent_openings opening';
  v_new := 'and not exists (select 1 from app.routine_telebirr_old_payment_observations old_payment'
    || E'\n        where old_payment.candidate_id = candidate.id)'
    || E'\n      ' || v_old;
  if v_def is null or pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,''))
      <> pg_catalog.length(v_old) then raise exception 'Fast resolver candidate drift.'; end if;
  v_def := pg_catalog.replace(v_def,v_old,v_new);
  v_old := 'or exists (' || E'\n      select 1 from app.routine_telebirr_paid_observation_staging staged';
  v_new := 'or exists (' || E'\n      select 1 from app.routine_telebirr_old_payment_observations old_payment'
    || E'\n      where old_payment.payment_provider_id = v_candidate.payment_provider_id'
    || E'\n        and old_payment.reference_fingerprint = v_candidate.candidate_reference_fingerprint'
    || E'\n        and old_payment.candidate_id <> v_candidate.id'
    || E'\n    ) ' || v_old;
  if pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old,''))
      <> pg_catalog.length(v_old) then raise exception 'Fast resolver duplicate drift.'; end if;
  execute pg_catalog.replace(v_def,v_old,v_new);
end;
$fast_old$;

alter table app.routine_telebirr_paid_intent_openings
  add column old_payment_decision_id uuid unique
    references app.routine_telebirr_old_payment_decisions(id) on delete restrict;
alter table app.routine_telebirr_paid_intent_openings
  drop constraint routine_paid_opening_time_check;
alter table app.routine_telebirr_paid_intent_openings
  add constraint routine_paid_opening_time_check check (
    challenge_issued_at >= submitted_at
    and observed_at >= challenge_issued_at
    and observed_at <= challenge_issued_at + interval '5 minutes'
    and occurred_at <= submitted_at + interval '5 minutes'
    and occurred_at <= observed_at
    and recorded_at >= observed_at - interval '5 minutes'
    and (
      (old_payment_decision_id is null
        and occurred_at >= submitted_at - interval '1 hour'
        and recorded_at < occurred_at + interval '1 hour')
      or (old_payment_decision_id is not null
        and occurred_at < submitted_at - interval '1 hour')
    )
  ) not valid;

alter table app.routine_telebirr_paid_observation_lineages
  add column old_payment_decision_id uuid unique
    references app.routine_telebirr_old_payment_decisions(id) on delete restrict;
alter table app.routine_telebirr_paid_observation_lineages
  drop constraint routine_paid_lineage_time_check;
alter table app.routine_telebirr_paid_observation_lineages
  add constraint routine_paid_lineage_time_check check (
    challenge_issued_at >= submitted_at
    and observed_at >= challenge_issued_at
    and occurred_at <= submitted_at + interval '5 minutes'
    and occurred_at <= observed_at
    and observed_at <= challenge_issued_at + interval '5 minutes'
    and recorded_at >= observed_at - interval '5 minutes'
    and (
      (old_payment_decision_id is null and
        occurred_at >= submitted_at - interval '1 hour')
      or (old_payment_decision_id is not null and
        occurred_at < submitted_at - interval '1 hour')
    )
  ) not valid;

-- A decision ID alone cannot lift a payment-age guard. Every downstream
-- exception checks this complete immutable chain, including the signed phone
-- body, current staged row, candidate, challenge, and exact opening.
create function app.owner_approved_old_payment_for_intent(p_intent_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select exists (
    select 1
    from app.routine_telebirr_paid_intent_openings opening
    join app.routine_telebirr_old_payment_decisions decision
      on decision.id = opening.old_payment_decision_id
      and decision.decision = 'approved'
      and decision.candidate_id = opening.candidate_id
      and decision.challenge_id = opening.challenge_id
    join app.routine_telebirr_old_payment_observations old_payment
      on old_payment.candidate_id = decision.candidate_id
      and old_payment.challenge_id = decision.challenge_id
    join app.routine_telebirr_paid_observation_staging staged
      on staged.candidate_id = old_payment.candidate_id
      and staged.challenge_id = old_payment.challenge_id
      and staged.signed_observation = old_payment.signed_observation
      and staged.observation_body_digest = old_payment.observation_body_digest
      and staged.replay_identity = old_payment.replay_identity
    join app.routine_telebirr_untrusted_proof_requests candidate
      on candidate.id = old_payment.candidate_id
      and candidate.payment_provider_id = opening.payment_provider_id
      and candidate.candidate_reference_fingerprint = opening.reference_fingerprint
    where opening.deposit_intent_id = p_intent_id
      and opening.observation_body_digest = old_payment.observation_body_digest
      and opening.source_document_digest = old_payment.source_document_digest
      and opening.occurred_at = old_payment.occurred_at
      and opening.amount_minor = old_payment.amount_minor
      and opening.submitted_at = candidate.submitted_at
      and old_payment.occurred_at < candidate.submitted_at - interval '1 hour'
  );
$$;
alter function app.owner_approved_old_payment_for_intent(uuid) owner to postgres;
revoke all on function app.owner_approved_old_payment_for_intent(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_routine_telebirr_paid_poll,
    fetanagent_routine_telebirr_paid_poll_runtime;

do $old_finalizer$
declare
  v_def text;
  v_old text[];
  v_new text[];
  i integer;
begin
  select pg_catalog.pg_get_functiondef(
    'app.finalize_routine_telebirr_paid_observation(uuid)'::pg_catalog.regprocedure)
    into v_def;
  v_old := array[
    '  v_staged app.routine_telebirr_paid_observation_staging%rowtype;',
    'if not app.routine_telebirr_paid_settlement_session_allowed()',
    '  if v_staged.challenge_id is null then',
    'or v_staged.occurred_at < v_authority.authorized_at',
    'or v_staged.occurred_at < v_candidate.submitted_at - interval ''1 hour''',
    'or v_now >= v_staged.occurred_at + interval ''1 hour''',
    '    occurred_at, amount_minor' || E'\n  ) values (',
    '    v_staged.occurred_at, v_staged.amount_minor' || E'\n  );',
    '    deposit_payment_claim_id, execution_job_id' || E'\n  ) values (',
    '    v_submission_id, v_claim_id, v_job_id' || E'\n  );'
  ];
  v_new := array[
    '  v_staged app.routine_telebirr_paid_observation_staging%rowtype;'
      || E'\n  v_old_approval_id uuid;',
    'if (not app.routine_telebirr_paid_settlement_session_allowed()'
      || E'\n    and not (session_user = ''fetanagent_owner_control_runtime'' and exists ('
      || E'\n      select 1 from app.routine_telebirr_old_payment_decisions decision'
      || E'\n      where decision.challenge_id = p_challenge_id and decision.decision = ''approved'')))',
    '  select decision.id into v_old_approval_id'
      || E'\n    from app.routine_telebirr_old_payment_decisions decision'
      || E'\n    join app.routine_telebirr_old_payment_observations old_payment'
      || E'\n      on old_payment.challenge_id = decision.challenge_id'
      || E'\n     and old_payment.candidate_id = decision.candidate_id'
      || E'\n     and old_payment.signed_observation = v_staged.signed_observation'
      || E'\n     and old_payment.observation_body_digest = v_staged.observation_body_digest'
      || E'\n   where decision.challenge_id = p_challenge_id'
      || E'\n     and decision.candidate_id = v_staged.candidate_id'
      || E'\n     and decision.decision = ''approved'';'
      || E'\n  if v_staged.challenge_id is null then',
    'or (v_staged.occurred_at < v_authority.authorized_at'
      || E'\n      and v_old_approval_id is null)',
    'or (v_staged.occurred_at < v_candidate.submitted_at - interval ''1 hour'''
      || E'\n      and v_old_approval_id is null)',
    'or (v_now >= v_staged.occurred_at + interval ''1 hour'''
      || E'\n      and v_old_approval_id is null)',
    '    occurred_at, amount_minor, old_payment_decision_id' || E'\n  ) values (',
    '    v_staged.occurred_at, v_staged.amount_minor, v_old_approval_id' || E'\n  );',
    '    deposit_payment_claim_id, execution_job_id, old_payment_decision_id'
      || E'\n  ) values (',
    '    v_submission_id, v_claim_id, v_job_id, v_old_approval_id' || E'\n  );'
  ];
  if v_def is null or pg_catalog.array_length(v_old,1) <> pg_catalog.array_length(v_new,1)
    then raise exception 'Paid finalizer unavailable.'; end if;
  for i in 1..pg_catalog.array_length(v_old,1) loop
    if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,v_old[i],'')))
      <> pg_catalog.length(v_old[i]) then
      raise exception 'Paid finalizer drift at %.', i;
    end if;
    v_def := pg_catalog.replace(v_def,v_old[i],v_new[i]);
  end loop;
  execute v_def;
end;
$old_finalizer$;

-- Each exception is restricted to the single signed, Owner-approved lineage.
-- No historical or ordinary deposit obtains an expired-window exception.
create function pg_temp.patch_old_payment_function(
  p_function pg_catalog.regprocedure, p_old text[], p_new text[]
) returns void language plpgsql as $$
declare v_def text; v_proc pg_catalog.pg_proc%rowtype; i integer;
begin
  select * into v_proc from pg_catalog.pg_proc where oid = p_function;
  if v_proc.oid is null or v_proc.proowner <> 'postgres'::pg_catalog.regrole
    or v_proc.prokind <> 'f' or pg_catalog.array_length(p_old,1) is null
    or pg_catalog.array_length(p_old,1) <> pg_catalog.array_length(p_new,1) then
    raise exception 'Old payment patch target changed.';
  end if;
  v_def := pg_catalog.pg_get_functiondef(p_function);
  for i in 1..pg_catalog.array_length(p_old,1) loop
    if (pg_catalog.length(v_def)-pg_catalog.length(pg_catalog.replace(v_def,p_old[i],'')))
      <> pg_catalog.length(p_old[i]) then
      raise exception 'Old payment patch drift at %, %.', p_function, i;
    end if;
    v_def := pg_catalog.replace(v_def,p_old[i],p_new[i]);
  end loop;
  execute v_def;
end;
$$;

select pg_temp.patch_old_payment_function(
  'app.populate_routine_telebirr_paid_intent_snapshot()'::pg_catalog.regprocedure,
  array[
    'if not app.routine_telebirr_paid_settlement_session_allowed() then',
    'or opening.occurred_at < authority.authorized_at',
    'or assessed_at >= opening.occurred_at + interval ''1 hour'''
  ],
  array[
    'if not app.routine_telebirr_paid_settlement_session_allowed()'
      || E'\n    and not (session_user = ''fetanagent_owner_control_runtime'''
      || E'\n      and app.owner_approved_old_payment_for_intent(new.id)) then',
    'or (opening.occurred_at < authority.authorized_at'
      || E'\n      and not app.owner_approved_old_payment_for_intent(new.id))',
    'or (assessed_at >= opening.occurred_at + interval ''1 hour'''
      || E'\n      and not app.owner_approved_old_payment_for_intent(new.id))'
  ]
);

select pg_temp.patch_old_payment_function(
  'app.claim_verified_deposit_payment(uuid,uuid,uuid)'::pg_catalog.regprocedure,
  array[
    'if claim_time > deposit_row.payment_deadline_at'
      || E'\n    and not app.is_private_live_telebirr_historical_intent_authorized('
      || E'\n      p_deposit_intent_id'
      || E'\n    ) then'
  ],
  array[
    'if claim_time > deposit_row.payment_deadline_at'
      || E'\n    and not app.is_private_live_telebirr_historical_intent_authorized('
      || E'\n      p_deposit_intent_id'
      || E'\n    )'
      || E'\n    and not app.owner_approved_old_payment_for_intent(p_deposit_intent_id) then'
  ]
);

select pg_temp.patch_old_payment_function(
  'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)'::pg_catalog.regprocedure,
  array['or submission_submitted_at > intent_row.payment_deadline_at'],
  array['or (submission_submitted_at > intent_row.payment_deadline_at'
    || E'\n      and not app.owner_approved_old_payment_for_intent(intent_row.id))']
);

select pg_temp.patch_old_payment_function(
  'app.assess_routine_telebirr_execution_job(uuid)'::pg_catalog.regprocedure,
  array[
    'and intent.verified_at is not null and intent.opened_at >= authority.authorized_at',
    'and evidence.occurred_at >= submission.submitted_at - interval ''1 hour'''
  ],
  array[
    'and intent.verified_at is not null'
      || E'\n    and (intent.opened_at >= authority.authorized_at'
      || E'\n      or app.owner_approved_old_payment_for_intent(intent.id))',
    'and (evidence.occurred_at >= submission.submitted_at - interval ''1 hour'''
      || E'\n      or app.owner_approved_old_payment_for_intent(intent.id))'
  ]
);

drop function pg_temp.patch_old_payment_function(pg_catalog.regprocedure,text[],text[]);

-- A narrow Owner inbox is useful for the PR 3 API. PR 4 supplies the readable
-- Transactions page; neither the inbox nor decision response exposes a full
-- reference, Player ID, receiver phone, or signed receipt.
create function app.list_owner_routine_telebirr_old_payments(
  p_actor_auth_user_id uuid, p_limit integer default 25
) returns table (
  candidate_id uuid, submitted_at timestamptz, payment_at timestamptz,
  amount_minor bigint, reference_masked text, player_masked text
) language plpgsql security definer set search_path = pg_catalog as $$
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_limit is null or p_limit not between 1 and 50
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
  select candidate.id, candidate.submitted_at, old_payment.occurred_at,
    old_payment.amount_minor, candidate.candidate_reference_masked,
    '***' || pg_catalog.right(player.player_id, 4)
  from app.routine_telebirr_old_payment_observations old_payment
  join app.routine_telebirr_untrusted_proof_requests candidate
    on candidate.id = old_payment.candidate_id
  join app.customer_platform_players player
    on player.id = candidate.player_account_id
  where not exists (select 1 from app.routine_telebirr_old_payment_decisions decision
    where decision.candidate_id = candidate.id)
  order by candidate.submitted_at, candidate.id
  limit p_limit;
end;
$$;
alter function app.list_owner_routine_telebirr_old_payments(uuid,integer) owner to postgres;
revoke all on function app.list_owner_routine_telebirr_old_payments(uuid,integer)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;
grant execute on function app.list_owner_routine_telebirr_old_payments(uuid,integer)
  to fetanagent_owner_control;

create function app.decide_owner_routine_telebirr_old_payment(
  p_actor_auth_user_id uuid, p_candidate_id uuid, p_decision text
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_actor_id uuid;
  v_old app.routine_telebirr_old_payment_observations%rowtype;
  v_candidate app.routine_telebirr_untrusted_proof_requests%rowtype;
  v_decision app.routine_telebirr_old_payment_decisions%rowtype;
  v_settled record;
  v_chat_id bigint;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_candidate_id is null
    or p_decision is null or p_decision not in ('approve','reject') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active'
    for share;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing',20261004));
  select candidate.* into v_candidate
    from app.routine_telebirr_untrusted_proof_requests candidate
    join app.routine_telebirr_old_payment_cutover cutover
      on cutover.singleton and candidate.submitted_at >= cutover.enabled_at
    where candidate.id = p_candidate_id and candidate.intake_mode = 'paid'
      and candidate.provider_code = 'telebirr'
    for update of candidate;
  select old_payment.* into v_old
    from app.routine_telebirr_old_payment_observations old_payment
    where old_payment.candidate_id = p_candidate_id for share;
  if v_candidate.id is null or v_old.challenge_id is null
    or v_old.occurred_at >= v_candidate.submitted_at - interval '1 hour'
    or exists (select 1 from app.routine_telebirr_old_payment_decisions decision
      where decision.candidate_id = p_candidate_id)
    or exists (select 1 from app.routine_telebirr_fast_results result
      where result.candidate_id = p_candidate_id)
    or exists (select 1 from app.routine_telebirr_paid_intent_openings opening
      where opening.payment_provider_id = v_old.payment_provider_id
        and opening.reference_fingerprint = v_old.reference_fingerprint)
    or exists (select 1 from app.deposit_payment_claims claim
      join app.provider_payment_evidence evidence
        on evidence.id = claim.provider_payment_evidence_id
      where evidence.payment_provider_id = v_old.payment_provider_id
        and evidence.canonical_reference_fingerprint = v_old.reference_fingerprint) then
    raise exception 'The old payment is no longer eligible for a decision.';
  end if;
  insert into app.routine_telebirr_old_payment_decisions
    (candidate_id, challenge_id, decision, reason_code, actor_admin_id)
  values (p_candidate_id, v_old.challenge_id,
    case when p_decision = 'approve' then 'approved' else 'rejected' end,
    case when p_decision = 'approve' then 'owner_approved_old_payment'
      else 'payment_older_than_one_hour' end, v_actor_id)
  returning * into v_decision;
  if p_decision = 'reject' then
    select telegram.private_chat_id into v_chat_id
      from app.telegram_identities telegram
      where telegram.customer_identity_id = v_candidate.origin_identity_id
        and telegram.private_chat_id = telegram.telegram_user_id;
    if v_chat_id is not null then
      insert into app.telegram_deposit_outcome_deliveries
        (candidate_id, notification_stage, private_chat_id,
         reference_masked, outcome_code)
      values (p_candidate_id, 'final', v_chat_id,
        v_candidate.candidate_reference_masked, 'old_rejected');
    end if;
    return pg_catalog.jsonb_build_object(
      'decision','rejected','decidedAt',v_decision.decided_at);
  end if;

  -- Reinsert the *same* signed body, never a constructed receipt. The existing
  -- producer rechecks current policy, receiver, amount, Player, uniqueness,
  -- switches and job admission within this one transaction.
  insert into app.routine_telebirr_paid_observation_staging
    (challenge_id,candidate_id,payment_provider_id,reference_fingerprint,
     source_document_digest,assignment_body_digest,observation_body_digest,
     observation_signature_digest,replay_identity,signed_observation,
     observed_at,occurred_at,amount_minor,recorded_at)
  select old_payment.challenge_id,old_payment.candidate_id,
    old_payment.payment_provider_id,old_payment.reference_fingerprint,
    old_payment.source_document_digest,old_payment.assignment_body_digest,
    old_payment.observation_body_digest,old_payment.observation_signature_digest,
    old_payment.replay_identity,old_payment.signed_observation,
    old_payment.observed_at,old_payment.occurred_at,old_payment.amount_minor,
    old_payment.recorded_at
  from app.routine_telebirr_old_payment_observations old_payment
  where old_payment.challenge_id = v_old.challenge_id;
  select settled.* into v_settled
    from app.finalize_routine_telebirr_paid_observation(v_old.challenge_id) settled;
  if v_settled.payment_claim_id is null or v_settled.execution_job_id is null
    or v_settled.already_finalized is distinct from false then
    raise exception 'The approved payment was not admitted to the normal credit path.';
  end if;
  return pg_catalog.jsonb_build_object('decision','approved',
    'decidedAt',v_decision.decided_at,
    'depositIntentId',v_settled.deposit_intent_id,
    'executionJobId',v_settled.execution_job_id);
end;
$$;
alter function app.decide_owner_routine_telebirr_old_payment(uuid,uuid,text)
  owner to postgres;
revoke all on function app.decide_owner_routine_telebirr_old_payment(uuid,uuid,text)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;
grant execute on function app.decide_owner_routine_telebirr_old_payment(uuid,uuid,text)
  to fetanagent_owner_control;
grant execute on function app.finalize_routine_telebirr_paid_observation(uuid)
  to fetanagent_owner_control;

commit;
