-- Private replay boundaries for the evidence-only routine phone rehearsal. A signed
-- phone request must be verified by the server before either function is called.
-- No application role can call these functions, and neither creates a payment claim.
begin;

set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_no_money_poll_claims (
  enrollment_id uuid not null references app.routine_telebirr_device_enrollments (id)
    on delete restrict,
  request_id uuid not null,
  replay_identity text not null unique
    check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  request_expires_at timestamptz not null,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (enrollment_id, request_id),
  check (request_expires_at > claimed_at
    and request_expires_at <= claimed_at + interval '1 minute')
);
create index routine_telebirr_no_money_poll_claims_retention_idx
  on app.routine_telebirr_no_money_poll_claims (claimed_at, enrollment_id, request_id);
alter table app.routine_telebirr_no_money_poll_claims owner to postgres;
alter table app.routine_telebirr_no_money_poll_claims enable row level security;
alter table app.routine_telebirr_no_money_poll_claims force row level security;
revoke all on table app.routine_telebirr_no_money_poll_claims
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

-- Keep the older digest-only receipt shape readable for rollback and existing
-- administrator diagnostics. New uploads additionally pin their assignment and
-- observation replay identity; no raw reference or receipt body is stored.
alter table app.routine_telebirr_observation_receipts
  add column assignment_body_digest text
    check (assignment_body_digest is null
      or assignment_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  add column replay_identity text
    check (replay_identity is null
      or replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  add constraint routine_telebirr_observation_replay_pair_check
    check ((assignment_body_digest is null) = (replay_identity is null));
create unique index routine_telebirr_observation_replay_identity_idx
  on app.routine_telebirr_observation_receipts (replay_identity)
  where replay_identity is not null;

create function app.claim_routine_telebirr_no_money_poll(
  p_enrollment_id uuid, p_request_id uuid, p_replay_identity text,
  p_request_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
  v_inserted integer;
begin
  if session_user <> 'postgres'
    or p_enrollment_id is null or p_request_id is null
    or p_request_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_request_expires_at is null then
    raise exception using errcode = '42501',
      message = 'The routine no-money poll request is invalid.';
  end if;

  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count
    from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or v_disabled_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
    where enrollment.id = p_enrollment_id for share;
  if v_enrollment.id is null or v_enrollment.valid_from > v_now
    or v_enrollment.valid_until <= p_request_expires_at
    or p_request_expires_at <= v_now
    or p_request_expires_at > v_now + interval '1 minute'
    or exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
      where revocation.enrollment_id = v_enrollment.id) then
    raise exception 'The routine no-money device is unavailable.';
  end if;

  insert into app.routine_telebirr_no_money_poll_claims (
    enrollment_id, request_id, replay_identity, request_expires_at, claimed_at
  ) values (
    p_enrollment_id, p_request_id, p_replay_identity, p_request_expires_at, v_now
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create function app.stage_routine_telebirr_no_money_observation_digest(
  p_challenge_id uuid, p_assignment_body_digest text,
  p_observation_body_digest text, p_observation_signature_digest text,
  p_replay_identity text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_challenge app.routine_telebirr_lookup_challenges%rowtype;
  v_receipt app.routine_telebirr_observation_receipts%rowtype;
  v_now timestamptz;
  v_switch_count integer;
  v_disabled_count integer;
  v_inserted integer;
begin
  if session_user <> 'postgres' or p_challenge_id is null
    or p_assignment_body_digest is null
    or p_assignment_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observation_body_digest is null
    or p_observation_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_observation_signature_digest is null
    or p_observation_signature_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '42501',
      message = 'The routine observation digest request is invalid.';
  end if;

  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine no-money boundary is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
    order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_disabled_count
    from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification',
      'withdrawal_collection', 'withdrawal_validation')
      and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb;
  if v_switch_count <> 7 or v_disabled_count <> 7 then
    raise exception 'The routine no-money boundary is unavailable.';
  end if;

  select challenge.* into v_challenge
    from app.routine_telebirr_lookup_challenges challenge
    where challenge.challenge_id = p_challenge_id for share;
  if v_challenge.challenge_id is null then return 'conflict'; end if;
  select receipt.* into v_receipt
    from app.routine_telebirr_observation_receipts receipt
    where receipt.challenge_id = p_challenge_id for update;
  if v_receipt.challenge_id is not null then
    if v_receipt.assignment_body_digest = p_assignment_body_digest
      and v_receipt.observation_body_digest = p_observation_body_digest
      and v_receipt.observation_signature_digest = p_observation_signature_digest
      and v_receipt.replay_identity = p_replay_identity then
      return 'exact_replay';
    end if;
    return 'conflict';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_now < v_challenge.issued_at or v_now >= v_challenge.expires_at then
    return 'conflict';
  end if;
  insert into app.routine_telebirr_observation_receipts (
    challenge_id, assignment_body_digest, observation_body_digest,
    observation_signature_digest, replay_identity, received_at
  ) values (
    p_challenge_id, p_assignment_body_digest, p_observation_body_digest,
    p_observation_signature_digest, p_replay_identity, v_now
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then return 'recorded'; end if;
  select receipt.* into v_receipt
    from app.routine_telebirr_observation_receipts receipt
    where receipt.challenge_id = p_challenge_id for update;
  if v_receipt.challenge_id is not null
    and v_receipt.assignment_body_digest = p_assignment_body_digest
    and v_receipt.observation_body_digest = p_observation_body_digest
    and v_receipt.observation_signature_digest = p_observation_signature_digest
    and v_receipt.replay_identity = p_replay_identity then
    return 'exact_replay';
  end if;
  return 'conflict';
end;
$$;

-- Reuse the already-installed fifteen-minute retention schedule, preserving its
-- public return value as the number of expired candidate rows removed.
create or replace function app.purge_expired_routine_telebirr_untrusted_proofs()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_deleted_count integer;
begin
  with due_polls as (
    select poll.enrollment_id, poll.request_id
      from app.routine_telebirr_no_money_poll_claims poll
     where poll.claimed_at <= pg_catalog.statement_timestamp() - interval '7 days'
     order by poll.claimed_at, poll.enrollment_id, poll.request_id
     limit 1000 for update of poll skip locked
  )
  delete from app.routine_telebirr_no_money_poll_claims poll using due_polls due
   where poll.enrollment_id = due.enrollment_id and poll.request_id = due.request_id;

  with due as (
    select candidate.id
      from app.routine_telebirr_untrusted_proof_requests candidate
     where candidate.submitted_at <= pg_catalog.statement_timestamp() - interval '7 days'
     order by candidate.submitted_at, candidate.id
     limit 1000 for update of candidate skip locked
  )
  delete from app.routine_telebirr_untrusted_proof_requests candidate using due
   where candidate.id = due.id;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

alter function app.claim_routine_telebirr_no_money_poll(uuid, uuid, text, timestamptz)
  owner to postgres;
alter function app.stage_routine_telebirr_no_money_observation_digest(
  uuid, text, text, text, text) owner to postgres;
revoke all on function
  app.claim_routine_telebirr_no_money_poll(uuid, uuid, text, timestamptz),
  app.stage_routine_telebirr_no_money_observation_digest(uuid, text, text, text, text)
from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_api, fetanagent_api_runtime,
  fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
  fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
  fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
  fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on table app.routine_telebirr_no_money_poll_claims is
  'Seven-day private replay identifiers for signed no-money phone polls; no reference, provider receipt, amount, or financial claim.';
comment on function app.claim_routine_telebirr_no_money_poll(uuid, uuid, text, timestamptz) is
  'Postgres-only one-use phone poll claim after external signature verification, active enrollment recheck, and disabled financial switches.';
comment on function app.stage_routine_telebirr_no_money_observation_digest(uuid, text, text, text, text) is
  'Postgres-only exact replay check and digest-only observation staging; not source authentication or a payment claim.';
comment on function app.purge_expired_routine_telebirr_untrusted_proofs() is
  'Postgres-only fixed-batch 7-day deletion of untrusted candidates and no-money poll claims; the return value counts candidate rows only.';

commit;
