-- A routine execution job must be tied to a durable, signed paid-phone observation.
-- This is a provenance fence, not a producer: no application role can insert a row,
-- and this migration cannot create a claim, job, payment, or financial activation.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.routine_telebirr_paid_observation_lineages (
  challenge_id uuid primary key,
  candidate_id uuid not null unique,
  payment_provider_id uuid not null references app.payment_providers(id) on delete restrict,
  reference_fingerprint text not null check (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  observation_body_digest text not null unique
    check (observation_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_document_digest text not null
    check (source_document_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_observation jsonb not null,
  submitted_at timestamptz not null,
  challenge_issued_at timestamptz not null,
  observed_at timestamptz not null,
  occurred_at timestamptz not null,
  amount_minor bigint not null check (amount_minor between 2500 and 2500000),
  provider_payment_evidence_id uuid not null unique
    references app.provider_payment_evidence(id) on delete restrict,
  deposit_intent_id uuid not null unique references app.deposit_intents(id) on delete restrict,
  deposit_submission_id uuid not null unique
    references app.deposit_submissions(id) on delete restrict,
  deposit_payment_claim_id uuid not null unique
    references app.deposit_payment_claims(id) on delete restrict,
  execution_job_id uuid not null unique references app.deposit_jobs(id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint routine_paid_lineage_provider_reference_unique
    unique (payment_provider_id, reference_fingerprint),
  constraint routine_paid_lineage_provider_document_unique
    unique (payment_provider_id, source_document_digest),
  constraint routine_paid_lineage_signed_observation_check check (
    pg_catalog.jsonb_typeof(signed_observation) = 'object'
    and pg_catalog.octet_length(signed_observation::text) <= 16384
    and coalesce(signed_observation ->> 'providerCode', '') = 'telebirr'
    and coalesce(signed_observation ->> 'protocolMode', '') = 'routine_signed_observation_v1'
    and coalesce(signed_observation ->> 'bodyDigest', '') = observation_body_digest
    and coalesce(signed_observation ->> 'signature', '') ~ '^[A-Za-z0-9_-]{86}$'
    and coalesce(signed_observation #>> '{body,challengeId}', '') = challenge_id::text
    and coalesce(signed_observation #>> '{body,candidateId}', '') = candidate_id::text
    and coalesce(signed_observation #>> '{body,referenceFingerprint}', '') = reference_fingerprint
    and coalesce(signed_observation #>> '{body,sourceDocumentDigest}', '') = source_document_digest
    and coalesce(signed_observation #>> '{body,facts,amountMinor}', '') = amount_minor::text
    and signed_observation::text !~ '"rawReference"'
  ),
  constraint routine_paid_lineage_job_intent_fkey
    foreign key (execution_job_id, deposit_intent_id)
    references app.deposit_jobs(id, deposit_intent_id) on delete restrict,
  constraint routine_paid_lineage_claim_intent_fkey
    foreign key (deposit_payment_claim_id, deposit_intent_id)
    references app.deposit_payment_claims(id, deposit_intent_id) on delete restrict,
  constraint routine_paid_lineage_submission_intent_fkey
    foreign key (deposit_submission_id, deposit_intent_id)
    references app.deposit_submissions(id, deposit_intent_id) on delete restrict,
  constraint routine_paid_lineage_time_check check (
    challenge_issued_at >= submitted_at
    and observed_at >= challenge_issued_at
    and occurred_at between submitted_at - interval '1 hour'
                        and submitted_at + interval '5 minutes'
    and occurred_at <= observed_at
    and observed_at <= challenge_issued_at + interval '5 minutes'
    and recorded_at >= observed_at - interval '5 minutes'
  )
);

create trigger routine_paid_lineage_immutable
before update or delete on app.routine_telebirr_paid_observation_lineages
for each row execute function app.reject_routine_telebirr_untrusted_proof_mutation();
create trigger routine_paid_lineage_no_truncate
before truncate on app.routine_telebirr_paid_observation_lineages
for each statement execute function app.reject_routine_telebirr_untrusted_proof_mutation();

alter table app.routine_telebirr_paid_observation_lineages owner to postgres;
alter table app.routine_telebirr_paid_observation_lineages enable row level security;
alter table app.routine_telebirr_paid_observation_lineages force row level security;
revoke all on table app.routine_telebirr_paid_observation_lineages
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_api, fetanagent_api_runtime,
    fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
    fetanagent_routine_telebirr_no_money, fetanagent_routine_telebirr_no_money_runtime,
    fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on table app.routine_telebirr_paid_observation_lineages is
  'Durable paid-phone provenance for one routine verified job and global payment claim. Only a later reviewed atomic producer may write it; no application grant exists.';

-- A generic verified TeleBirr job is not a routine phone job. The paid producer must
-- first retain an exact, one-use observation-to-submission-to-claim lineage.
-- In particular, freshness is measured from the customer's actual submission,
-- not from a later retrospective intent/submission row creation timestamp.
create or replace function app.assess_routine_telebirr_execution_job(p_execution_job_id uuid)
returns table (
  authorization_id uuid, platform_agent_account_id uuid, deposit_intent_id uuid,
  deposit_payment_claim_id uuid, player_id text, amount_minor bigint, currency_code text
)
language sql
stable
security definer
set search_path = ''
as $$
  select authority.id, authority.platform_agent_account_id, intent.id, claim.id,
    player.player_id, evidence.amount_minor, evidence.currency_code::text
  from app.routine_telebirr_processing_events event
  join app.routine_telebirr_processing_authorizations authority on authority.id = event.authorization_id
  join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    and owner_user.role = 'owner' and owner_user.status = 'active'
  join app.platform_agent_accounts agent on agent.id = authority.platform_agent_account_id
    and agent.status = 'active'
  join app.platforms platform on platform.id = agent.platform_id
    and platform.code = 'kemerbet' and platform.status = 'active'
  join app.deposit_jobs job on job.id = p_execution_job_id and job.job_kind = 'execute_deposit'
    and job.status = 'queued' and job.max_attempts = 1 and job.attempt_count = 0
    and job.lease_token is null and job.created_at >= authority.authorized_at
  join app.deposit_intents intent on intent.id = job.deposit_intent_id
    and intent.platform_id = platform.id and intent.status = 'execution_pending'
    and intent.verified_at is not null and intent.opened_at >= authority.authorized_at
  join app.payment_providers provider on provider.id = intent.payment_provider_id
    and provider.code = 'telebirr' and provider.status = 'active'
  join app.deposit_policy_versions policy on policy.id = authority.deposit_policy_version_id
    and policy.id = intent.deposit_policy_version_id and policy.version = intent.deposit_policy_version
    and policy.status = 'active' and policy.minimum_amount_minor = authority.minimum_amount_minor
    and policy.maximum_amount_minor = authority.maximum_amount_minor
    and policy.freshness_window_seconds = authority.freshness_window_seconds
    and intent.minimum_amount_minor = policy.minimum_amount_minor
    and intent.maximum_amount_minor = policy.maximum_amount_minor
    and intent.freshness_window_seconds = policy.freshness_window_seconds
  join app.customer_platform_players player on player.id = intent.player_account_id
    and player.platform_id = platform.id and player.status = 'active' and player.validation_status = 'valid'
  join app.player_deposit_eligibility_decisions eligibility on eligibility.player_account_id = player.id
    and eligibility.decision_version = (
      select pg_catalog.max(decision.decision_version) from app.player_deposit_eligibility_decisions decision
        where decision.player_account_id = player.id
    ) and eligibility.decision_version = (
      select pg_catalog.count(*) from app.player_deposit_eligibility_decisions decision
        where decision.player_account_id = player.id
    ) and eligibility.decision = 'eligible' and eligibility.decided_at <= pg_catalog.statement_timestamp()
    and eligibility.player_account_updated_at_snapshot is not distinct from player.updated_at
  join app.deposit_payment_claims claim on claim.deposit_intent_id = intent.id
  join app.deposit_verification_attempts verification on verification.id = claim.verification_attempt_id
    and verification.deposit_intent_id = intent.id and verification.outcome = 'verified'
    and verification.provider_payment_evidence_id = claim.provider_payment_evidence_id
  join app.deposit_submissions submission on submission.id = verification.deposit_submission_id
    and submission.deposit_intent_id = intent.id and submission.status = 'verified'
    and submission.submitted_at >= authority.authorized_at
    and submission.submitted_at <= submission.created_at
  join app.provider_payment_evidence evidence on evidence.id = claim.provider_payment_evidence_id
    and evidence.payment_provider_id = provider.id and evidence.provider_final_status = 'completed'
    and evidence.canonical_reference_fingerprint = submission.submitted_reference_fingerprint
    and evidence.evidence_source = 'provider_receipt_lookup'
    and evidence.amount_minor = intent.expected_amount_minor and evidence.currency_code = intent.currency_code
    and evidence.amount_minor between authority.minimum_amount_minor and authority.maximum_amount_minor
    and evidence.occurred_at >= submission.submitted_at - interval '1 hour'
    and evidence.occurred_at <= submission.submitted_at + interval '5 minutes'
    and evidence.matched_receiver_account_id = intent.receiver_account_id
    and evidence.matched_receiver_account_version = intent.receiver_account_version
  join app.receiver_accounts receiver on receiver.id = intent.receiver_account_id
    and receiver.provider_id = provider.id and receiver.version = intent.receiver_account_version
    and receiver.account_holder_name = intent.receiver_account_holder_name_snapshot
    and receiver.status = 'active'
  join app.routine_telebirr_paid_observation_lineages lineage
    on lineage.execution_job_id = job.id
    and lineage.deposit_intent_id = intent.id
    and lineage.deposit_submission_id = submission.id
    and lineage.deposit_payment_claim_id = claim.id
    and lineage.provider_payment_evidence_id = evidence.id
    and lineage.payment_provider_id = provider.id
    and lineage.reference_fingerprint = evidence.canonical_reference_fingerprint
    and lineage.submitted_at = submission.submitted_at
    and lineage.occurred_at = evidence.occurred_at
    and lineage.amount_minor = evidence.amount_minor
    and lineage.challenge_issued_at >= authority.authorized_at
    and lineage.recorded_at >= authority.authorized_at
    and lineage.signed_observation #>> '{body,receiverRevisionId}' = receiver.id::text
    and lineage.signed_observation #>> '{body,receiverVersion}' = receiver.version::text
    and lineage.signed_observation #>> '{body,facts,amountMinor}' = evidence.amount_minor::text
    and lineage.signed_observation #>> '{body,facts,currencyCode}' = 'ETB'
    and lineage.signed_observation #>> '{body,facts,evidenceSource}' = 'provider_receipt_lookup'
    and lineage.signed_observation #>> '{body,facts,providerFinalStatus}' = 'completed'
    and lineage.signed_observation #>> '{body,facts,providerIdentity}' = 'matched'
    and lineage.signed_observation #>> '{body,facts,receiverMatch}' = 'matched'
    and lineage.signed_observation #>> '{body,facts,referenceMatch}' = 'matched'
    and (lineage.signed_observation #>> '{body,observedAt}')::timestamptz =
      pg_catalog.date_trunc('milliseconds', lineage.observed_at)
    and (lineage.signed_observation #>> '{body,facts,occurredAt}')::timestamptz =
      pg_catalog.date_trunc('milliseconds', evidence.occurred_at)
  where event.event_sequence = (
    select pg_catalog.max(latest.event_sequence) from app.routine_telebirr_processing_events latest
  ) and event.event_kind = 'authorize'
    and not exists (
      select 1 from app.private_live_deposit_pilot_reservations reservation
        where reservation.deposit_intent_id = intent.id
    ) and not exists (
      select 1 from app.deposit_execution_attempts attempt where attempt.deposit_intent_id = intent.id
    ) and not exists (
      select 1 from app.deposit_review_cases review where review.deposit_intent_id = intent.id
        and review.status in ('open', 'assigned')
    );
$$;

commit;
