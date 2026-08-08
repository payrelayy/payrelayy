-- PayReplayy Stage 2: indexes that cover ledger foreign keys and expected review paths.
-- These are separate from the ledger migration because the ledger is already recorded remotely.

begin;

create index deposit_intents_payment_provider_idx
  on app.deposit_intents (payment_provider_id);
create index deposit_intents_player_customer_platform_idx
  on app.deposit_intents (player_account_id, customer_id, platform_id);
create index deposit_intents_receiver_provider_version_idx
  on app.deposit_intents (receiver_account_id, payment_provider_id, receiver_account_version);
create index deposit_intents_policy_version_idx
  on app.deposit_intents (deposit_policy_version_id, deposit_policy_version);

create index deposit_jobs_submission_intent_idx
  on app.deposit_jobs (deposit_submission_id, deposit_intent_id);
create index deposit_payment_claims_verification_proof_idx
  on app.deposit_payment_claims (
    verification_attempt_id,
    deposit_intent_id,
    provider_payment_evidence_id
  );
create index deposit_state_events_actor_admin_idx
  on app.deposit_state_events (actor_admin_id);
create index deposit_state_events_actor_customer_idx
  on app.deposit_state_events (actor_customer_id);
create index deposit_verification_attempts_evidence_idx
  on app.deposit_verification_attempts (provider_payment_evidence_id);
create index deposit_verification_attempts_submission_intent_idx
  on app.deposit_verification_attempts (deposit_submission_id, deposit_intent_id);
create index provider_payment_evidence_receiver_version_idx
  on app.provider_payment_evidence (
    matched_receiver_account_id,
    payment_provider_id,
    matched_receiver_account_version
  );

commit;
