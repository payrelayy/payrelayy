-- The existing fenced Companion lane accepts an SMS-backed job only when its
-- complete one-use lineage and current policy still match. Receipt jobs retain
-- their original assessment while the new route is disabled.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.assess_receiver_sms_execution_job(p_execution_job_id uuid)
returns table (
  authorization_id uuid, platform_agent_account_id uuid, deposit_intent_id uuid,
  deposit_payment_claim_id uuid, player_id text, amount_minor bigint,
  currency_code text
)
language sql stable security definer
set search_path = ''
as $$
  select authority.id, authority.platform_agent_account_id, intent.id, claim.id,
    player.player_id, evidence.amount_minor, evidence.currency_code::text
  from app.receiver_sms_route_control control
  join app.routine_telebirr_processing_events policy_event
    on policy_event.event_sequence = (select pg_catalog.max(latest.event_sequence)
      from app.routine_telebirr_processing_events latest)
    and policy_event.event_kind = 'authorize'
  join app.routine_telebirr_processing_authorizations authority
    on authority.id = policy_event.authorization_id
  join app.admin_users owner_user on owner_user.id = authority.authorized_by_admin_id
    and owner_user.role = 'owner' and owner_user.status = 'active'
  join app.platform_agent_accounts agent
    on agent.id = authority.platform_agent_account_id and agent.status = 'active'
  join app.platforms platform on platform.id = agent.platform_id
    and platform.code = 'kemerbet' and platform.status = 'active'
  join app.deposit_jobs job on job.id = p_execution_job_id
    and job.job_kind = 'execute_deposit' and job.status = 'queued'
    and job.max_attempts = 1 and job.attempt_count = 0
    and job.lease_token is null and job.created_at >= authority.authorized_at
  join app.receiver_sms_settlement_lineages lineage on lineage.execution_job_id = job.id
  join app.receiver_sms_intent_openings opening on opening.id = lineage.opening_id
    and opening.deposit_intent_id = lineage.deposit_intent_id
    and opening.candidate_id = lineage.candidate_id
    and opening.payment_event_id = lineage.payment_event_id
    and opening.authorization_id = authority.id
  join app.receiver_sms_payment_matches matched
    on matched.candidate_id = lineage.candidate_id
    and matched.payment_event_id = lineage.payment_event_id
    and matched.disposition = 'ready'
  join app.receiver_sms_deposit_candidates candidate on candidate.id = lineage.candidate_id
  join app.receiver_sms_payment_events sms on sms.id = lineage.payment_event_id
    and sms.provider_code = candidate.provider_code
    and sms.reference_fingerprint = candidate.reference_fingerprint
    and sms.payment_provider_id = candidate.payment_provider_id
  join app.deposit_intents intent on intent.id = job.deposit_intent_id
    and intent.id = lineage.deposit_intent_id
    and intent.receiver_sms_opening_id = opening.id
    and intent.platform_id = platform.id
    and intent.status = 'execution_pending' and intent.verified_at is not null
    and intent.opened_at = sms.occurred_at
    and intent.payment_deadline_at = sms.occurred_at + interval '1 hour'
    and intent.expected_amount_minor = sms.amount_minor
    and intent.payment_provider_id = sms.payment_provider_id
    and intent.receiver_account_id = sms.receiver_account_id
    and intent.receiver_account_version = sms.receiver_account_version
    and intent.player_account_id = candidate.player_account_id
    and intent.customer_id = candidate.submitting_customer_id
  join app.payment_providers provider on provider.id = intent.payment_provider_id
    and provider.code = sms.provider_code and provider.status = 'active'
  join app.deposit_policy_versions policy on policy.id = authority.deposit_policy_version_id
    and policy.id = intent.deposit_policy_version_id
    and policy.version = intent.deposit_policy_version
    and policy.status = 'active'
    and policy.minimum_amount_minor = authority.minimum_amount_minor
    and policy.maximum_amount_minor = authority.maximum_amount_minor
    and policy.freshness_window_seconds = authority.freshness_window_seconds
    and intent.minimum_amount_minor = policy.minimum_amount_minor
    and intent.maximum_amount_minor = policy.maximum_amount_minor
    and intent.freshness_window_seconds = policy.freshness_window_seconds
  join app.customer_platform_players player on player.id = intent.player_account_id
    and player.platform_id = platform.id and player.status = 'active'
    and player.validation_status = 'valid'
  join app.player_deposit_eligibility_decisions eligibility
    on eligibility.id = intent.player_deposit_eligibility_decision_id
    and eligibility.player_account_id = player.id
    and eligibility.decision_version = (select pg_catalog.max(decision.decision_version)
      from app.player_deposit_eligibility_decisions decision
      where decision.player_account_id = player.id)
    and eligibility.decision_version = (select pg_catalog.count(*)
      from app.player_deposit_eligibility_decisions decision
      where decision.player_account_id = player.id)
    and eligibility.decision = 'eligible'
    and eligibility.player_account_updated_at_snapshot is not distinct from player.updated_at
  join app.deposit_payment_claims claim on claim.id = lineage.deposit_payment_claim_id
    and claim.deposit_intent_id = intent.id
    and claim.provider_payment_evidence_id = lineage.provider_payment_evidence_id
  join app.deposit_verification_attempts verification
    on verification.id = claim.verification_attempt_id
    and verification.deposit_intent_id = intent.id
    and verification.outcome = 'verified'
    and verification.provider_payment_evidence_id = claim.provider_payment_evidence_id
  join app.deposit_submissions submission on submission.id = lineage.deposit_submission_id
    and submission.id = verification.deposit_submission_id
    and submission.deposit_intent_id = intent.id
    and submission.status = 'verified'
    and submission.submitted_at = candidate.submitted_at
    and submission.submitted_reference_fingerprint = candidate.reference_fingerprint
  join app.provider_payment_evidence evidence
    on evidence.id = lineage.provider_payment_evidence_id
    and evidence.payment_provider_id = provider.id
    and evidence.evidence_source = 'receiver_sms'
    and evidence.provider_final_status = 'completed'
    and evidence.canonical_reference_fingerprint = sms.reference_fingerprint
    and evidence.evidence_digest = sms.event_body_digest
    and evidence.amount_minor = sms.amount_minor
    and evidence.currency_code = intent.currency_code
    and evidence.occurred_at = sms.occurred_at
    and evidence.matched_receiver_account_id = sms.receiver_account_id
    and evidence.matched_receiver_account_version = sms.receiver_account_version
  join app.receiver_accounts receiver on receiver.id = sms.receiver_account_id
    and receiver.provider_id = provider.id
    and receiver.version = sms.receiver_account_version
    and receiver.status = 'active' and receiver.retired_at is null
    and receiver.account_holder_name = intent.receiver_account_holder_name_snapshot
  where control.singleton and control.enabled
    and sms.received_at >= control.cutover_at
    and sms.recorded_at >= control.cutover_at
    and candidate.submitted_at >= control.cutover_at
    and sms.occurred_at between candidate.submitted_at - interval '1 hour'
      and candidate.submitted_at + interval '5 minutes'
    and pg_catalog.statement_timestamp() < sms.occurred_at + interval '1 hour'
    and sms.amount_minor between authority.minimum_amount_minor
      and authority.maximum_amount_minor
    and authority.authorized_at <= sms.occurred_at
    and not exists (select 1 from app.receiver_sms_payment_conflicts conflict
      where conflict.existing_event_id = sms.id)
    and (provider.code <> 'cbe_birr' or exists (
      select 1 from app.feature_switches feature
      where feature.feature_key = 'cbe_birr_authoritative_verification'
        and feature.mode = 'live'))
    and not exists (select 1 from app.private_live_deposit_pilot_reservations reservation
      where reservation.deposit_intent_id = intent.id)
    and not exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.deposit_intent_id = intent.id)
    and not exists (select 1 from app.deposit_review_cases review
      where review.deposit_intent_id = intent.id and review.status in ('open','assigned'));
$$;
alter function app.assess_receiver_sms_execution_job(uuid) owner to postgres;
revoke all on function app.assess_receiver_sms_execution_job(uuid)
  from public, anon, authenticated, service_role;

-- Clone the exact current receipt assessor once so CREATE OR REPLACE can keep
-- the original function OID, grants, and dependent broker procedures intact.
do $clone_legacy$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'app.assess_routine_telebirr_execution_job(uuid)'::pg_catalog.regprocedure);
  v_clone text;
begin
  v_clone := pg_catalog.regexp_replace(v_definition,
    'app[.]assess_routine_telebirr_execution_job[(]',
    'app.assess_routine_telebirr_execution_job_legacy(');
  if v_clone = v_definition then
    raise exception 'The current routine assessor could not be preserved.';
  end if;
  execute v_clone;
end;
$clone_legacy$;
alter function app.assess_routine_telebirr_execution_job_legacy(uuid) owner to postgres;
revoke all on function app.assess_routine_telebirr_execution_job_legacy(uuid)
  from public, anon, authenticated, service_role;

create or replace function app.assess_routine_telebirr_execution_job(p_execution_job_id uuid)
returns table (
  authorization_id uuid, platform_agent_account_id uuid, deposit_intent_id uuid,
  deposit_payment_claim_id uuid, player_id text, amount_minor bigint,
  currency_code text
)
language sql stable security definer
set search_path = ''
as $$
  select * from app.assess_routine_telebirr_execution_job_legacy(p_execution_job_id)
    where not exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and control.enabled)
  union all
  select * from app.assess_receiver_sms_execution_job(p_execution_job_id)
    where exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and control.enabled)
$$;

create or replace function app.routine_telebirr_runtime_policy_json()
returns jsonb language sql stable security definer
set search_path = pg_catalog
as $$
  select pg_catalog.jsonb_build_object(
    'mode', 'routine_production', 'status', 'active', 'version', 1,
    'provider', case when control.enabled then 'receiver_sms' else 'telebirr' end,
    'platformCode', 'kemerbet', 'currencyCode', 'ETB',
    'minimumAmountMinor', 2500, 'maximumAmountMinor', 2500000,
    'playerScope', 'all_active_deposit_eligible', 'playerOwnershipRequired', false,
    'dailyQuotaMinor', null, 'successfulDepositQuota', null,
    'maxConcurrentDeposits', 1,
    'amountSource', case when control.enabled then 'receiver_sms_amount'
      else 'official_receipt_settled_amount' end
  ) from app.receiver_sms_route_control control where control.singleton
$$;

comment on function app.assess_receiver_sms_execution_job(uuid) is
  'Private admission assessment for an exact SMS event, first submission, global claim and one-shot job.';
comment on function app.assess_routine_telebirr_execution_job_legacy(uuid) is
  'Exact pre-cutover receipt assessment retained while the SMS route is disabled.';
commit;
