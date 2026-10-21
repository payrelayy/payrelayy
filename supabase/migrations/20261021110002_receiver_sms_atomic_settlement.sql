-- Atomic SMS payment to existing one-use claim and one-shot execution queue.
-- The runtime role remains NOLOGIN and this producer remains ungranted until
-- the phone, bot, broker, and companion cutover have been reviewed together.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create role fetanagent_receiver_sms_settlement
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
create role fetanagent_receiver_sms_settlement_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
grant fetanagent_receiver_sms_settlement
  to fetanagent_receiver_sms_settlement_runtime
  with inherit true, set false, admin false;

create table app.receiver_sms_settlement_lineages (
  candidate_id uuid primary key
    references app.receiver_sms_deposit_candidates (id) on delete restrict,
  payment_event_id uuid not null unique
    references app.receiver_sms_payment_events (id) on delete restrict,
  opening_id uuid not null unique
    references app.receiver_sms_intent_openings (id) on delete restrict,
  provider_payment_evidence_id uuid not null unique
    references app.provider_payment_evidence (id) on delete restrict,
  deposit_intent_id uuid not null unique
    references app.deposit_intents (id) on delete restrict,
  deposit_submission_id uuid not null unique
    references app.deposit_submissions (id) on delete restrict,
  deposit_payment_claim_id uuid not null unique
    references app.deposit_payment_claims (id) on delete restrict,
  execution_job_id uuid not null unique
    references app.deposit_jobs (id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (candidate_id, payment_event_id)
    references app.receiver_sms_payment_matches (candidate_id, payment_event_id)
    on delete restrict
);
create trigger receiver_sms_settlement_lineages_immutable
before update or delete on app.receiver_sms_settlement_lineages
for each row execute function app.reject_provider_payment_evidence_mutation();
alter table app.receiver_sms_settlement_lineages enable row level security;
alter table app.receiver_sms_settlement_lineages force row level security;
alter table app.receiver_sms_settlement_lineages owner to postgres;
revoke all on app.receiver_sms_settlement_lineages
  from public, anon, authenticated, service_role;

create function app.finalize_receiver_sms_match(p_candidate_id uuid)
returns table (
  deposit_intent_id uuid, payment_claim_id uuid, execution_job_id uuid,
  already_finalized boolean
)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_candidate app.receiver_sms_deposit_candidates%rowtype;
  v_match app.receiver_sms_payment_matches%rowtype;
  v_event app.receiver_sms_payment_events%rowtype;
  v_control app.receiver_sms_route_control%rowtype;
  v_authority app.routine_telebirr_processing_authorizations%rowtype;
  v_opening app.receiver_sms_intent_openings%rowtype;
  v_lineage app.receiver_sms_settlement_lineages%rowtype;
  v_intent_id uuid;
  v_submission_id uuid;
  v_evidence_id uuid;
  v_attempt_id uuid;
  v_settled record;
  v_now timestamptz;
  v_switch_count integer;
begin
  if session_user not in ('postgres', 'fetanagent_receiver_sms_settlement_runtime',
    'fetanagent_owner_control_runtime')
    or p_candidate_id is null then
    raise exception using errcode = '42501',
      message = 'Receiver SMS settlement is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select * into v_candidate from app.receiver_sms_deposit_candidates candidate
    where candidate.id = p_candidate_id for share;
  if v_candidate.id is null then
    raise exception 'The receiver SMS candidate is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_candidate.provider_code || ':' || v_candidate.reference_fingerprint, 20261021));
  select * into v_match from app.receiver_sms_payment_matches matched
    where matched.candidate_id = v_candidate.id for share;
  select * into v_event from app.receiver_sms_payment_events event
    where event.id = v_match.payment_event_id for share;
  select * into v_opening from app.receiver_sms_intent_openings opening
    where opening.candidate_id = p_candidate_id for share;
  if v_opening.id is not null then
    select * into v_lineage from app.receiver_sms_settlement_lineages lineage
      where lineage.candidate_id = p_candidate_id
        and lineage.payment_event_id = v_event.id
        and lineage.opening_id = v_opening.id for share;
    if v_lineage.candidate_id is null
      or not exists (select 1 from app.deposit_payment_claims claim
        where claim.id = v_lineage.deposit_payment_claim_id
          and claim.deposit_intent_id = v_lineage.deposit_intent_id
          and claim.provider_payment_evidence_id = v_lineage.provider_payment_evidence_id)
      or not exists (select 1 from app.deposit_jobs job
        where job.id = v_lineage.execution_job_id
          and job.deposit_intent_id = v_lineage.deposit_intent_id
          and job.job_kind = 'execute_deposit' and job.max_attempts = 1) then
      raise exception 'The receiver SMS settlement replay is incomplete.';
    end if;
    return query select v_lineage.deposit_intent_id,
      v_lineage.deposit_payment_claim_id, v_lineage.execution_job_id, true;
    return;
  end if;

  select * into v_control from app.receiver_sms_route_control where singleton for share;
  perform feature.feature_key from app.feature_switches feature
    where feature.feature_key in ('payment_verification','deposit_execution',
      'cbe_birr_authoritative_verification')
    order by feature.feature_key for update;
  select pg_catalog.count(*)::integer into v_switch_count
    from app.feature_switches feature
    where (feature.feature_key in ('payment_verification','deposit_execution')
      and feature.mode = 'live')
      or (v_candidate.provider_code = 'cbe_birr'
        and feature.feature_key = 'cbe_birr_authoritative_verification'
        and feature.mode = 'live');
  select authority.* into v_authority
    from app.routine_telebirr_processing_events policy_event
    join app.routine_telebirr_processing_authorizations authority
      on authority.id = policy_event.authorization_id
    join app.admin_users owner_user
      on owner_user.id = authority.authorized_by_admin_id
    join app.platform_agent_accounts agent
      on agent.id = authority.platform_agent_account_id
    join app.platforms platform on platform.id = agent.platform_id
    join app.deposit_policy_versions policy
      on policy.id = authority.deposit_policy_version_id
    where policy_event.event_sequence = (select pg_catalog.max(latest.event_sequence)
      from app.routine_telebirr_processing_events latest)
      and policy_event.event_kind = 'authorize'
      and owner_user.role = 'owner' and owner_user.status = 'active'
      and agent.status = 'active' and platform.code = 'kemerbet'
      and platform.status = 'active' and agent.platform_id = v_candidate.platform_id
      and policy.status = 'active'
      and policy.minimum_amount_minor = authority.minimum_amount_minor
      and policy.maximum_amount_minor = authority.maximum_amount_minor
      and policy.freshness_window_seconds = authority.freshness_window_seconds
      and policy.minimum_amount_minor = 2500
      and policy.maximum_amount_minor = 2500000
      and policy.freshness_window_seconds = 3600
    for share of authority, owner_user, agent, platform, policy;
  v_now := pg_catalog.clock_timestamp();
  if v_control.enabled is distinct from true or v_match.candidate_id is null
    or (v_match.disposition <> 'ready' and not
      app.receiver_sms_owner_approved_for_candidate(v_candidate.id))
    or v_event.id is null
    or v_event.provider_code <> v_candidate.provider_code
    or v_event.payment_provider_id <> v_candidate.payment_provider_id
    or v_event.reference_fingerprint <> v_candidate.reference_fingerprint
    or v_event.received_at < v_control.cutover_at
    or v_event.recorded_at < v_control.cutover_at
    or v_candidate.submitted_at < v_control.cutover_at
    or (v_event.occurred_at < v_candidate.submitted_at - interval '1 hour'
      and not app.receiver_sms_owner_approved_for_candidate(v_candidate.id))
    or v_event.occurred_at > v_candidate.submitted_at + interval '5 minutes'
    or v_event.occurred_at > v_now
    or (v_now >= v_event.occurred_at + interval '1 hour'
      and not app.receiver_sms_owner_approved_for_candidate(v_candidate.id))
    or (v_now > v_candidate.submitted_at + interval '5 minutes'
      and not app.receiver_sms_owner_approved_for_candidate(v_candidate.id))
    or v_event.amount_minor not between 2500 and 2500000
    or exists (select 1 from app.receiver_sms_payment_conflicts conflict
      where conflict.existing_event_id = v_event.id)
    or v_authority.id is null
    or v_authority.authorized_at > v_event.occurred_at
    or v_authority.authorized_at > v_candidate.submitted_at
    or (v_candidate.provider_code = 'cbe_birr' and v_switch_count <> 3)
    or (v_candidate.provider_code = 'telebirr' and v_switch_count <> 2)
    or not exists (select 1 from app.inbound_events inbound
      join app.customer_identities identity
        on identity.id = inbound.customer_identity_id
      join app.customers customer on customer.id = identity.customer_id
      where inbound.id = v_candidate.origin_inbound_event_id
        and inbound.channel = 'telegram'
        and inbound.customer_identity_id = v_candidate.origin_identity_id
        and inbound.processed_at = v_candidate.submitted_at
        and identity.customer_id = v_candidate.submitting_customer_id
        and identity.status = 'active' and customer.status = 'active')
    or not exists (select 1 from app.routine_telebirr_device_enrollments enrollment
      where enrollment.id = v_event.device_enrollment_id
        and enrollment.device_id = v_event.device_id
        and enrollment.device_key_id = v_event.device_key_id
        and enrollment.device_public_key_spki_sha256 =
          v_event.device_public_key_spki_sha256
        and enrollment.valid_from <= v_event.observed_at
        and enrollment.valid_until > v_now
        and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revocation
          where revocation.enrollment_id = enrollment.id)) then
    raise exception 'The receiver SMS match is not eligible for automatic settlement.';
  end if;

  v_intent_id := pg_catalog.gen_random_uuid();
  insert into app.receiver_sms_intent_openings (
    candidate_id, payment_event_id, deposit_intent_id, authorization_id
  ) values (v_candidate.id, v_event.id, v_intent_id, v_authority.id)
  returning * into v_opening;
  insert into app.deposit_intents (
    id, customer_id, platform_id, player_account_id, payment_provider_id,
    receiver_account_id, expected_amount_minor, receiver_sms_opening_id
  ) values (
    v_intent_id, v_candidate.submitting_customer_id, v_candidate.platform_id,
    v_candidate.player_account_id, v_event.payment_provider_id,
    v_event.receiver_account_id, v_event.amount_minor, v_opening.id
  );
  update app.deposit_intents set status = 'verification_pending'
    where id = v_intent_id and status = 'intake_received';
  if not found then raise exception 'The receiver SMS intent did not enter verification.'; end if;

  insert into app.deposit_submissions (
    deposit_intent_id, submission_number, submitted_reference_ciphertext,
    submitted_reference_fingerprint, submitted_reference_masked,
    reference_encryption_key_version, submitted_at, created_at
  ) values (
    v_intent_id, 1, v_candidate.reference_ciphertext,
    v_candidate.reference_fingerprint, v_candidate.reference_masked,
    v_candidate.reference_key_version, v_candidate.submitted_at,
    v_candidate.submitted_at
  ) returning id into v_submission_id;
  update app.deposit_submissions set status = 'verification_enqueued'
    where id = v_submission_id and status = 'received';
  if not found then raise exception 'The receiver SMS submission did not enter verification.'; end if;

  insert into app.provider_payment_evidence (
    payment_provider_id, canonical_reference_ciphertext,
    canonical_reference_fingerprint, canonical_reference_masked,
    reference_encryption_key_version, evidence_source, provider_final_status,
    amount_minor, currency_code, occurred_at, matched_receiver_account_id,
    matched_receiver_account_version, evidence_digest, adapter_version,
    normalization_version, retrieved_at
  ) values (
    v_event.payment_provider_id, v_candidate.reference_ciphertext,
    v_candidate.reference_fingerprint, v_candidate.reference_masked,
    v_candidate.reference_key_version, 'receiver_sms', 'completed',
    v_event.amount_minor, 'ETB', v_event.occurred_at,
    v_event.receiver_account_id, v_event.receiver_account_version,
    v_event.event_body_digest, 'receiver-sms-paired-phone-v1',
    'receiver-sms-v1', v_now
  ) returning id into v_evidence_id;
  insert into app.deposit_verification_attempts (
    deposit_intent_id, deposit_submission_id, attempt_number, outcome,
    provider_payment_evidence_id, adapter_version, response_digest,
    started_at, completed_at
  ) values (
    v_intent_id, v_submission_id, 1, 'verified', v_evidence_id,
    'receiver-sms-paired-phone-v1', v_event.event_body_digest,
    v_candidate.submitted_at, v_now
  ) returning id into v_attempt_id;

  select * into v_settled
    from app.finalize_verified_deposit_and_enqueue_execution(
      v_intent_id, v_attempt_id, v_evidence_id);
  if v_settled.deposit_intent_id is distinct from v_intent_id
    or v_settled.payment_claim_id is null or v_settled.execution_job_id is null
    or v_settled.deposit_status <> 'execution_pending'
    or v_settled.execution_job_status <> 'queued'
    or v_settled.already_finalized is not false then
    raise exception 'The receiver SMS claim-to-job transaction is incomplete.';
  end if;
  insert into app.receiver_sms_settlement_lineages (
    candidate_id, payment_event_id, opening_id, provider_payment_evidence_id,
    deposit_intent_id, deposit_submission_id, deposit_payment_claim_id,
    execution_job_id
  ) values (
    v_candidate.id, v_event.id, v_opening.id, v_evidence_id,
    v_intent_id, v_submission_id, v_settled.payment_claim_id,
    v_settled.execution_job_id
  );
  if app.admit_routine_telebirr_execution_job(v_settled.execution_job_id)
    is distinct from v_settled.execution_job_id then
    raise exception 'The receiver SMS job admission is incomplete.';
  end if;
  return query select v_intent_id, v_settled.payment_claim_id,
    v_settled.execution_job_id, false;
end;
$$;
alter function app.finalize_receiver_sms_match(uuid) owner to postgres;
revoke all on function app.finalize_receiver_sms_match(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime,
    fetanagent_receiver_sms_settlement,
    fetanagent_receiver_sms_settlement_runtime,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;

comment on function app.finalize_receiver_sms_match(uuid) is
  'Ungrantable until route cutover: atomically converts one recent, conflict-free, signed receiver SMS match to existing one-use claim and fenced execution job.';
comment on table app.receiver_sms_settlement_lineages is
  'Immutable phone event to customer submission to global claim and one-shot job provenance.';
commit;
