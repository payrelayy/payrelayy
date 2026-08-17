-- Private atomic verified-payment settlement boundary.
--
-- This procedure is the only runtime-granted path from one exact authoritative verification
-- attempt/evidence pair to one immutable payment claim and one queued deposit-execution command.
-- A failure at either legacy transition rolls the whole statement back. Complete exact replays
-- return the existing pair; partial or mismatched historical state is never repaired here.

begin;

create role fetanagent_verification_settlement
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

create role fetanagent_verification_settlement_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant fetanagent_verification_settlement
  to fetanagent_verification_settlement_runtime
  with inherit true, set false, admin false;

-- Preserve the private-function default before this narrowly scoped role receives schema usage.
-- The owner-wide default was hardened by an earlier migration; repeating it here makes the
-- settlement capability self-auditing if this migration is reviewed or replayed independently.
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.finalize_verified_deposit_and_enqueue_execution(
  p_deposit_intent_id uuid,
  p_verification_attempt_id uuid,
  p_provider_payment_evidence_id uuid
)
returns table (
  deposit_intent_id uuid,
  payment_claim_id uuid,
  execution_job_id uuid,
  deposit_status text,
  execution_job_status text,
  already_finalized boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  claim_count integer;
  created_claim_id uuid;
  enqueue_already_enqueued boolean;
  enqueue_deposit_intent_id uuid;
  enqueue_deposit_status text;
  enqueue_execution_job_id uuid;
  enqueue_execution_job_status text;
  enqueue_updated_at timestamptz;
  evidence_amount_minor bigint;
  evidence_canonical_reference_fingerprint text;
  evidence_currency_code character(3);
  evidence_id uuid;
  evidence_matched_receiver_account_id uuid;
  evidence_matched_receiver_account_version integer;
  evidence_occurred_at timestamptz;
  evidence_payment_provider_id uuid;
  evidence_provider_final_status text;
  evidence_retrieved_at timestamptz;
  execution_job_count integer;
  existing_claim app.deposit_payment_claims%rowtype;
  existing_execution_job app.deposit_jobs%rowtype;
  intent_row app.deposit_intents%rowtype;
  settlement_time timestamptz := clock_timestamp();
  submission_deposit_intent_id uuid;
  submission_id uuid;
  submission_status app.deposit_submission_status;
  submission_submitted_at timestamptz;
  submission_submitted_reference_fingerprint text;
  switch_count integer;
  verification_attempt_completed_at timestamptz;
  verification_attempt_deposit_intent_id uuid;
  verification_attempt_evidence_id uuid;
  verification_attempt_id uuid;
  verification_attempt_outcome app.verification_attempt_outcome;
  verification_attempt_submission_id uuid;
begin
  if p_deposit_intent_id is null
    or p_verification_attempt_id is null
    or p_provider_payment_evidence_id is null then
    raise exception 'The verified deposit settlement request is invalid.';
  end if;

  -- This is the same intent-scoped lock used by the executor enqueue command. Acquiring it first
  -- prevents a separately invoked enqueue from interleaving between claim and command creation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_deposit_intent_id::text, 20260815203606)
  );

  -- Claim creation locks payment_verification and enqueue reads both switches. Take the two rows
  -- in one deterministic order before any ledger row to avoid an intent/switch lock inversion.
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
   order by feature_switch.feature_key
   for update;

  select intent.*
    into intent_row
    from app.deposit_intents intent
   where intent.id = p_deposit_intent_id
   for update;

  if not found then
    raise exception 'The verified deposit settlement proof is unavailable.';
  end if;

  select attempt.id,
         attempt.deposit_intent_id,
         attempt.deposit_submission_id,
         attempt.outcome,
         attempt.provider_payment_evidence_id,
         attempt.completed_at
    into verification_attempt_id,
         verification_attempt_deposit_intent_id,
         verification_attempt_submission_id,
         verification_attempt_outcome,
         verification_attempt_evidence_id,
         verification_attempt_completed_at
    from app.deposit_verification_attempts attempt
   where attempt.id = p_verification_attempt_id
   for key share;

  select evidence.id,
         evidence.provider_final_status,
         evidence.canonical_reference_fingerprint,
         evidence.payment_provider_id,
         evidence.currency_code,
         evidence.amount_minor,
         evidence.matched_receiver_account_id,
         evidence.matched_receiver_account_version,
         evidence.occurred_at,
         evidence.retrieved_at
    into evidence_id,
         evidence_provider_final_status,
         evidence_canonical_reference_fingerprint,
         evidence_payment_provider_id,
         evidence_currency_code,
         evidence_amount_minor,
         evidence_matched_receiver_account_id,
         evidence_matched_receiver_account_version,
         evidence_occurred_at,
         evidence_retrieved_at
    from app.provider_payment_evidence evidence
   where evidence.id = p_provider_payment_evidence_id
   for key share;

  if verification_attempt_id is not null then
    select submission.id,
           submission.deposit_intent_id,
           submission.status,
           submission.submitted_at,
           submission.submitted_reference_fingerprint
      into submission_id,
           submission_deposit_intent_id,
           submission_status,
           submission_submitted_at,
           submission_submitted_reference_fingerprint
      from app.deposit_submissions submission
     where submission.id = verification_attempt_submission_id
     for key share;
  end if;

  -- The customer-supplied protected fingerprint and the provider's canonical fingerprint must be
  -- the same bounded keyed value. No raw reference is selected, returned, logged, or embedded in
  -- an exception. The remaining predicates bind the immutable proof to one intent snapshot.
  if verification_attempt_id is null
    or verification_attempt_deposit_intent_id is distinct from intent_row.id
    or verification_attempt_outcome <> 'verified'
    or verification_attempt_evidence_id is distinct from p_provider_payment_evidence_id
    or verification_attempt_completed_at > settlement_time + interval '5 minutes'
    or submission_id is null
    or submission_deposit_intent_id is distinct from intent_row.id
    or submission_status not in ('verification_enqueued', 'verified')
    or submission_submitted_at > intent_row.payment_deadline_at
    or submission_submitted_reference_fingerprint is null
    or submission_submitted_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or evidence_id is null
    or evidence_provider_final_status <> 'completed'
    or evidence_canonical_reference_fingerprint !~ '^[0-9a-f]{64}$'
    or evidence_canonical_reference_fingerprint
       is distinct from submission_submitted_reference_fingerprint
    or evidence_payment_provider_id is distinct from intent_row.payment_provider_id
    or evidence_currency_code is distinct from intent_row.currency_code
    or evidence_amount_minor is distinct from intent_row.expected_amount_minor
    or evidence_matched_receiver_account_id is distinct from intent_row.receiver_account_id
    or evidence_matched_receiver_account_version
       is distinct from intent_row.receiver_account_version
    or evidence_occurred_at < intent_row.opened_at
    or evidence_occurred_at > intent_row.payment_deadline_at
    or evidence_occurred_at > settlement_time + interval '5 minutes'
    or evidence_retrieved_at > settlement_time + interval '5 minutes' then
    raise exception 'The verified deposit settlement proof is invalid.';
  end if;

  select count(*)::integer
    into claim_count
    from app.deposit_payment_claims claim
   where claim.deposit_intent_id = intent_row.id;

  select claim.*
    into existing_claim
    from app.deposit_payment_claims claim
   where claim.deposit_intent_id = intent_row.id
   order by claim.claimed_at, claim.id
   limit 1
   for share;

  select count(*)::integer
    into execution_job_count
    from app.deposit_jobs job
   where job.deposit_intent_id = intent_row.id
     and job.job_kind = 'execute_deposit';

  select job.*
    into existing_execution_job
    from app.deposit_jobs job
   where job.deposit_intent_id = intent_row.id
     and job.job_kind = 'execute_deposit'
   order by job.created_at, job.id
   limit 1
   for update;

  if claim_count > 0 or execution_job_count > 0 then
    if claim_count <> 1
      or execution_job_count <> 1
      or existing_claim.id is null
      or existing_claim.deposit_intent_id is distinct from intent_row.id
      or existing_claim.verification_attempt_id is distinct from verification_attempt_id
      or existing_claim.provider_payment_evidence_id is distinct from evidence_id
      or existing_execution_job.id is null
      or existing_execution_job.deposit_submission_id is not null
      or existing_execution_job.job_kind <> 'execute_deposit'
      or existing_execution_job.job_key
         is distinct from 'deposit-execution:v1:' || intent_row.id::text
      or existing_execution_job.payload <> '{}'::jsonb
      or existing_execution_job.priority <> 0
      or existing_execution_job.max_attempts <> 1
      or submission_status <> 'verified'
      or not (
        (intent_row.status = 'execution_pending'
          and existing_execution_job.status in ('queued', 'leased'))
        or (intent_row.status = 'execution_in_progress'
          and existing_execution_job.status = 'leased')
        or (intent_row.status in ('execution_reconciliation', 'executed')
          and existing_execution_job.status = 'succeeded')
        or (intent_row.status = 'execution_review'
          and existing_execution_job.status in ('cancelled', 'succeeded'))
      ) then
      raise exception 'The verified deposit settlement state is inconsistent.';
    end if;

    return query
    select intent_row.id,
           existing_claim.id,
           existing_execution_job.id,
           intent_row.status::text,
           existing_execution_job.status::text,
           true,
           intent_row.updated_at;
    return;
  end if;

  select count(*)::integer
    into switch_count
    from app.feature_switches feature_switch
   where feature_switch.feature_key in ('payment_verification', 'deposit_execution')
     and feature_switch.mode = 'live';

  if switch_count <> 2 then
    raise exception 'Verified deposit settlement requires both live financial switches.';
  end if;

  -- Both nested SECURITY DEFINER procedures are deliberately ungranted to this runtime role. A
  -- failure in enqueue (policy, player eligibility, or any execution invariant) aborts this outer
  -- statement and rolls the preceding claim/submission/intent transition back atomically.
  created_claim_id := app.claim_verified_deposit_payment(
    intent_row.id,
    verification_attempt_id,
    evidence_id
  );

  select enqueue.deposit_intent_id,
         enqueue.execution_job_id,
         enqueue.deposit_status,
         enqueue.execution_job_status,
         enqueue.already_enqueued,
         enqueue.updated_at
    into enqueue_deposit_intent_id,
         enqueue_execution_job_id,
         enqueue_deposit_status,
         enqueue_execution_job_status,
         enqueue_already_enqueued,
         enqueue_updated_at
    from app.enqueue_verified_deposit_execution(intent_row.id) enqueue;

  if created_claim_id is null
    or enqueue_deposit_intent_id is distinct from intent_row.id
    or enqueue_execution_job_id is null
    or enqueue_deposit_status <> 'execution_pending'
    or enqueue_execution_job_status <> 'queued'
    or enqueue_already_enqueued is not false then
    raise exception 'The verified deposit settlement did not create one atomic command.';
  end if;

  return query
  select intent_row.id,
         created_claim_id,
         enqueue_execution_job_id,
         enqueue_deposit_status,
         enqueue_execution_job_status,
         false,
         enqueue_updated_at;
end;
$$;

alter function app.finalize_verified_deposit_and_enqueue_execution(uuid, uuid, uuid)
  owner to postgres;

revoke all privileges on all tables in schema app
  from fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;
revoke all privileges on all functions in schema app
  from fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;
revoke all privileges on schema app
  from fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

revoke all on function app.finalize_verified_deposit_and_enqueue_execution(uuid, uuid, uuid)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime;

grant usage on schema app to fetanagent_verification_settlement;
grant execute on function app.finalize_verified_deposit_and_enqueue_execution(uuid, uuid, uuid)
  to fetanagent_verification_settlement;

comment on function app.finalize_verified_deposit_and_enqueue_execution(uuid, uuid, uuid) is
  'Atomically claims one exact authoritative verified payment and enqueues one one-shot deposit execution command; exact complete replays return the existing pair and partial state fails closed.';

comment on role fetanagent_verification_settlement is
  'FetanAgent verification-settlement group. NOLOGIN; may execute only the atomic verified-payment claim-to-execution boundary.';

comment on role fetanagent_verification_settlement_runtime is
  'FetanAgent verification-settlement runtime scaffold. NOLOGIN and unprovisioned; inherits only the verification-settlement group and cannot SET ROLE.';

commit;
