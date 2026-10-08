-- A paid lookup needs a separate, one-use signed-phone poll claim. This is
-- deliberately administrator-only until a paid phone verifier and private
-- runtime authenticate the distinct paid poll transcript. No receipt, claim,
-- execution job, or Player credit is created here.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_paid_poll_claims (
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
create index routine_telebirr_paid_poll_claims_retention_idx
  on app.routine_telebirr_paid_poll_claims (claimed_at, enrollment_id, request_id);
alter table app.routine_telebirr_paid_poll_claims owner to postgres;
alter table app.routine_telebirr_paid_poll_claims enable row level security;
alter table app.routine_telebirr_paid_poll_claims force row level security;
revoke all on table app.routine_telebirr_paid_poll_claims
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

create function app.issue_routine_telebirr_paid_poll_assignment(
  p_enrollment_id uuid, p_request_id uuid, p_replay_identity text,
  p_request_expires_at timestamptz, p_signer_id uuid
)
returns table (
  challenge_id uuid, challenge_digest text, issued_at timestamptz,
  expires_at timestamptz, candidate_id uuid, candidate_submitted_at timestamptz,
  candidate_reference_ciphertext text, candidate_reference_fingerprint text,
  reference_encryption_key_version smallint, reference_profile_version smallint,
  receiver_revision_id uuid, receiver_version integer,
  receiver_reference_fingerprint text, receiver_profile_digest text,
  receiver_name text, expected_receiver_name_digest text,
  device_enrollment_id uuid, device_id text, device_key_id text,
  device_public_key_spki_sha256 text, device_valid_from timestamptz,
  device_valid_until timestamptz, assignment_signer_id uuid,
  assignment_signer_key_id text, assignment_signer_public_key_spki_sha256 text,
  signer_valid_from timestamptz, signer_valid_until timestamptz,
  source_profile text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_candidate_id uuid;
  v_authorization_id uuid;
  v_authorized_at timestamptz;
  v_now timestamptz;
  v_switch_count integer;
  v_live_count integer;
  v_inserted integer;
  v_returned integer;
begin
  if session_user <> 'postgres'
    or p_enrollment_id is null or p_request_id is null or p_signer_id is null
    or p_request_id::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_replay_identity is null
    or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_request_expires_at is null then
    raise exception using errcode = '42501',
      message = 'The routine paid poll request is invalid.';
  end if;

  -- Serialize with the Owner's stop/save path before the established financial
  -- authority and ordered switches. The paid issuer repeats every check while
  -- these locks remain held. No no-money function or role is reused.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004)
  );
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The routine paid poll is unavailable.'; end if;
  perform feature_switch.feature_key from app.feature_switches feature_switch
    where feature_switch.feature_key in (
      'deposit_execution', 'payment_verification',
      'private_live_deposit_pilot', 'telebirr_authoritative_verification'
    ) order by feature_switch.feature_key for update;
  get diagnostics v_switch_count = row_count;
  select pg_catalog.count(*)::integer into v_live_count
    from app.feature_switches feature_switch
   where (feature_switch.feature_key in ('deposit_execution', 'payment_verification')
      and feature_switch.mode = 'live')
      or (feature_switch.feature_key in (
        'private_live_deposit_pilot', 'telebirr_authoritative_verification')
        and feature_switch.mode = 'disabled');
  if v_switch_count <> 4 or v_live_count <> 4 then
    raise exception 'The routine paid poll requires live generic deposit gates and no legacy TeleBirr pilot.';
  end if;
  select authority.id, authority.authorized_at
    into v_authorization_id, v_authorized_at
    from app.routine_telebirr_processing_events event
    join app.routine_telebirr_processing_authorizations authority
      on authority.id = event.authorization_id
    join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    join app.platform_agent_accounts agent
      on agent.id = authority.platform_agent_account_id
    join app.platforms platform on platform.id = agent.platform_id
    join app.deposit_policy_versions policy
      on policy.id = authority.deposit_policy_version_id
   where event.event_sequence = (
      select pg_catalog.max(latest.event_sequence)
        from app.routine_telebirr_processing_events latest)
     and event.event_kind = 'authorize'
     and owner_user.role = 'owner' and owner_user.status = 'active'
     and agent.status = 'active'
     and platform.code = 'kemerbet' and platform.status = 'active'
     and policy.status = 'active'
     and policy.minimum_amount_minor = authority.minimum_amount_minor
     and policy.maximum_amount_minor = authority.maximum_amount_minor
     and policy.freshness_window_seconds = authority.freshness_window_seconds
     and policy.minimum_amount_minor = 2500
     and policy.maximum_amount_minor = 2500000
     and policy.freshness_window_seconds = 3600
   for share of authority, owner_user, agent, platform, policy;
  if v_authorization_id is null or v_authorized_at is null then
    raise exception 'The current routine Owner authorization is unavailable.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  -- Read only the receiver binding here; the paid issuer later locks and
  -- rechecks the enrollment after locking the selected candidate.
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
   where enrollment.id = p_enrollment_id;
  if v_enrollment.id is null or v_enrollment.valid_from > v_now
    or v_enrollment.valid_until <= p_request_expires_at
    or p_request_expires_at <= v_now
    or p_request_expires_at > v_now + interval '1 minute'
    or exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
      where revocation.enrollment_id = v_enrollment.id) then
    raise exception 'The routine paid device is unavailable.';
  end if;

  -- A bad candidate cannot become a no-money assignment. The paid issuer
  -- checks Player eligibility, receiver, current Owner policy, and signer again.
  select candidate.id into v_candidate_id
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.receiver_account_id = v_enrollment.receiver_account_id
     and candidate.receiver_account_version = v_enrollment.receiver_account_version
     and candidate.provider_code = 'telebirr' and candidate.intake_mode = 'paid'
     and candidate.submitted_at >= v_authorized_at
     and candidate.submitted_at <= v_now
     and candidate.submitted_at + interval '1 hour 5 minutes' > v_now
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
        where challenge.candidate_id = candidate.id
          and challenge.expires_at > v_now
     )
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
         join app.routine_telebirr_paid_observation_lineages lineage
           on lineage.challenge_id = challenge.challenge_id
        where challenge.candidate_id = candidate.id
     )
     and (select pg_catalog.count(*)
       from app.routine_telebirr_lookup_challenges challenge
       where challenge.candidate_id = candidate.id) < 5
   order by candidate.submitted_at, candidate.id
   limit 1 for update of candidate skip locked;

  -- Claim every valid signed poll, even when there is no candidate. A failed
  -- issuer rolls this insert back together with its challenge reservation.
  insert into app.routine_telebirr_paid_poll_claims (
    enrollment_id, request_id, replay_identity, request_expires_at, claimed_at
  ) values (
    p_enrollment_id, p_request_id, p_replay_identity, p_request_expires_at, v_now
  ) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception using errcode = '42501',
      message = 'The routine paid poll was already used.';
  end if;
  if v_candidate_id is null then return; end if;

  return query select material.*
    from app.issue_routine_telebirr_paid_lookup_assignment_material(
      v_candidate_id, p_enrollment_id, p_signer_id) material;
  get diagnostics v_returned = row_count;
  if v_returned <> 1 then
    raise exception 'The routine paid assignment is unavailable.';
  end if;
end;
$$;
alter function app.issue_routine_telebirr_paid_poll_assignment(
  uuid, uuid, text, timestamptz, uuid) owner to postgres;
revoke all on function app.issue_routine_telebirr_paid_poll_assignment(
  uuid, uuid, text, timestamptz, uuid)
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

-- Paid captures can remain in the seven-day candidate store if the Owner
-- subsequently disables live deposits. Do not let a dormant paid candidate
-- block no-money rehearsals: select only the no-money intake mode there.
create or replace function app.issue_routine_telebirr_no_money_poll_assignment(
  p_enrollment_id uuid, p_request_id uuid, p_replay_identity text,
  p_request_expires_at timestamptz, p_signer_id uuid
)
returns table (
  challenge_id uuid, challenge_digest text, issued_at timestamptz,
  expires_at timestamptz, candidate_id uuid, candidate_submitted_at timestamptz,
  candidate_reference_ciphertext text, candidate_reference_fingerprint text,
  reference_encryption_key_version smallint, reference_profile_version smallint,
  receiver_revision_id uuid, receiver_version integer,
  receiver_reference_fingerprint text, receiver_profile_digest text,
  receiver_name text, expected_receiver_name_digest text,
  device_enrollment_id uuid, device_id text, device_key_id text,
  device_public_key_spki_sha256 text, device_valid_from timestamptz,
  device_valid_until timestamptz, assignment_signer_id uuid,
  assignment_signer_key_id text, assignment_signer_public_key_spki_sha256 text,
  signer_valid_from timestamptz, signer_valid_until timestamptz,
  source_profile text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_enrollment app.routine_telebirr_device_enrollments%rowtype;
  v_candidate_id uuid;
  v_claimed boolean;
  v_returned integer;
  v_now timestamptz;
begin
  if not app.routine_telebirr_no_money_session_allowed() or p_signer_id is null then
    raise exception using errcode = '42501',
      message = 'The routine no-money assignment is unavailable.';
  end if;
  select app.claim_routine_telebirr_no_money_poll(
    p_enrollment_id, p_request_id, p_replay_identity, p_request_expires_at
  ) into v_claimed;
  if v_claimed is not true then
    raise exception using errcode = '42501',
      message = 'The routine no-money poll was already used.';
  end if;
  select enrollment.* into v_enrollment
    from app.routine_telebirr_device_enrollments enrollment
   where enrollment.id = p_enrollment_id for share;
  if v_enrollment.id is null then
    raise exception 'The routine no-money device is unavailable.';
  end if;
  v_now := pg_catalog.clock_timestamp();
  select candidate.id into v_candidate_id
    from app.routine_telebirr_untrusted_proof_requests candidate
   where candidate.receiver_account_id = v_enrollment.receiver_account_id
     and candidate.receiver_account_version = v_enrollment.receiver_account_version
     and candidate.provider_code = 'telebirr'
     and candidate.intake_mode = 'no_money'
     and candidate.submitted_at <= v_now
     and candidate.submitted_at + interval '7 days' > v_now + interval '5 minutes'
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
        where challenge.candidate_id = candidate.id
          and challenge.expires_at > v_now
     )
     and not exists (
       select 1 from app.routine_telebirr_lookup_challenges challenge
         join app.routine_telebirr_observation_receipts receipt
           on receipt.challenge_id = challenge.challenge_id
        where challenge.candidate_id = candidate.id
     )
     and (select pg_catalog.count(*)
       from app.routine_telebirr_lookup_challenges challenge
       where challenge.candidate_id = candidate.id) < 5
   order by candidate.submitted_at, candidate.id
   limit 1 for update of candidate skip locked;
  if v_candidate_id is null then return; end if;
  return query select material.*
    from app.issue_routine_telebirr_lookup_assignment_material(
      v_candidate_id, p_enrollment_id, p_signer_id) material;
  get diagnostics v_returned = row_count;
  if v_returned <> 1 then
    raise exception 'The routine no-money assignment is unavailable.';
  end if;
end;
$$;

-- Reuse the existing fifteen-minute, fixed-batch purge, keeping its historical
-- return value as the number of expired candidate rows removed.
create or replace function app.purge_expired_routine_telebirr_untrusted_proofs()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_deleted_count integer;
begin
  with due_paid_polls as (
    select poll.enrollment_id, poll.request_id
      from app.routine_telebirr_paid_poll_claims poll
     where poll.claimed_at <= pg_catalog.statement_timestamp() - interval '7 days'
     order by poll.claimed_at, poll.enrollment_id, poll.request_id
     limit 1000 for update of poll skip locked
  )
  delete from app.routine_telebirr_paid_poll_claims poll using due_paid_polls due
   where poll.enrollment_id = due.enrollment_id and poll.request_id = due.request_id;

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

comment on table app.routine_telebirr_paid_poll_claims is
  'Seven-day one-use identifiers for a future separately authenticated paid phone poll; never a payment claim.';
comment on function app.issue_routine_telebirr_paid_poll_assignment(
  uuid, uuid, text, timestamptz, uuid) is
  'Postgres-only atomic paid poll replay claim and paid challenge reservation after external phone signature verification. No runtime grant, provider receipt, payment claim, job, or credit.';
comment on function app.purge_expired_routine_telebirr_untrusted_proofs() is
  'Postgres-only fixed-batch 7-day deletion of untrusted candidates and both no-money and paid poll replay claims; returns candidate count only.';

commit;
