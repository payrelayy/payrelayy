\set ON_ERROR_STOP on

-- Read-only, identifier-free inventory for reviewing a future Windows execution activation.
-- This is a status check, not an authorization or an activation operation.
begin isolation level repeatable read read only;
set local search_path = pg_catalog;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local idle_in_transaction_session_timeout = '10s';

with latest_pilot as materialized (
  select pilot.id, pilot.status, pilot.stop_reason_code
  from app.private_live_deposit_pilot_revisions pilot
  order by pilot.created_at desc, pilot.revision desc
  limit 1
), queue_state as materialized (
  select
    pg_catalog.count(*)::integer as total_jobs,
    pg_catalog.count(*) filter (
      where job.status in ('queued', 'leased', 'retry_wait')
    )::integer as open_jobs,
    pg_catalog.count(*) filter (
      where job.status = 'queued'
        and job.attempt_count = 0
        and job.lease_token is null
        and job.leased_by is null
        and job.lease_expires_at is null
    )::integer as untouched_jobs,
    pg_catalog.count(*) filter (
      where job.status = 'cancelled'
        and job.attempt_count = 0
        and job.lease_token is null
        and job.leased_by is null
        and job.lease_expires_at is null
    )::integer as cancelled_untouched_jobs,
    pg_catalog.count(*) filter (
      where reservation.id is not null
    )::integer as reservation_bound_jobs,
    pg_catalog.count(*) filter (
      where reservation.pilot_revision_id = (select id from latest_pilot)
    )::integer as latest_pilot_jobs,
    pg_catalog.count(*) filter (
      where reservation.pilot_revision_id = (select id from latest_pilot)
        and reservation.amount_minor = 2500
        and reservation.currency_code = 'ETB'
        and claim.id is not null
        and claim.provider_payment_evidence_id = reservation.provider_payment_evidence_id
        and job.job_kind = 'execute_deposit'
        and job.status = 'queued'
        and job.attempt_count = 0
        and job.lease_token is null
        and job.leased_by is null
        and job.lease_expires_at is null
    )::integer as latest_pilot_paid_untouched_jobs
  from app.deposit_jobs job
  left join app.private_live_deposit_pilot_reservations reservation
    on reservation.deposit_intent_id = job.deposit_intent_id
  left join app.deposit_payment_claims claim
    on claim.id = reservation.deposit_payment_claim_id
   and claim.deposit_intent_id = job.deposit_intent_id
), reservation_state as materialized (
  select pg_catalog.count(*)::integer as total_reservations
  from app.private_live_deposit_pilot_reservations
), customer_review_state as materialized (
  select
    (
      select pg_catalog.count(*)::integer
      from app.deposit_review_cases review_case
      where review_case.review_kind = 'execution'
        and review_case.status in ('open', 'assigned')
    ) as open_cases,
    (
      select pg_catalog.count(*)::integer
      from app.stopped_pilot_paid_execution_reviews review_receipt
      join app.deposit_review_cases review_case
        on review_case.deposit_intent_id = review_receipt.deposit_intent_id
       and review_case.review_kind = 'execution'
       and review_case.reason_code = 'stopped_pilot_paid_proof_review'
       and review_case.status in ('open', 'assigned')
      join app.deposit_jobs job
        on job.id = review_receipt.deposit_job_id
       and job.deposit_intent_id = review_receipt.deposit_intent_id
       and job.status = 'cancelled'
       and job.attempt_count = 0
       and job.lease_token is null
       and job.leased_by is null
       and job.lease_expires_at is null
      join app.deposit_intents intent
        on intent.id = review_receipt.deposit_intent_id
       and intent.status = 'execution_review'
      join app.private_live_deposit_pilot_reservations reservation
        on reservation.id = review_receipt.reservation_id
       and reservation.deposit_intent_id = intent.id
       and reservation.pilot_revision_id = review_receipt.pilot_revision_id
      join app.deposit_payment_claims claim
        on claim.id = review_receipt.payment_claim_id
       and claim.id = reservation.deposit_payment_claim_id
       and claim.deposit_intent_id = intent.id
       and claim.provider_payment_evidence_id = reservation.provider_payment_evidence_id
      where not exists (
        select 1 from app.deposit_execution_attempts attempt
        where attempt.deposit_job_id = job.id
      )
    ) as protected_open_cases
), switch_state as materialized (
  select
    pg_catalog.count(*)::integer as switch_count,
    pg_catalog.count(*) filter (
      where feature_switch.mode = 'disabled'
        and feature_switch.settings = '{}'::jsonb
    )::integer as disabled_count
  from app.feature_switches feature_switch
  where feature_switch.feature_key in (
    'cbe_birr_authoritative_verification',
    'deposit_execution',
    'payment_verification',
    'private_live_deposit_pilot',
    'telebirr_authoritative_verification',
    'withdrawal_collection',
    'withdrawal_validation'
  )
), execution_control as materialized (
  select
    pg_catalog.count(*)::integer as control_count,
    pg_catalog.count(*) filter (
      where control.singleton
        and control.control_state = 'disabled'
        and control.certificate_id is null
        and control.device_id is null
        and control.device_key_id is null
        and control.no_money_signer_key_id is null
        and control.execution_signer_key_id is null
        and control.execution_signer_public_key_spki is null
        and control.execution_signer_public_key_spki_sha256 is null
        and control.platform_agent_account_id is null
        and control.pilot_revision_id is null
        and control.pilot_revision is null
        and control.pilot_configuration_digest is null
        and control.activation_epoch is null
        and control.active_from is null
        and control.expires_at is null
        and control.activated_by_admin_id is null
        and control.activated_at is null
        and control.disabled_at is null
        and control.disable_reason_code is null
    )::integer as disabled_count
  from app.agent_platform_companion_execution_control control
), capability as materialized (
  select
    pg_catalog.count(*)::integer as role_count,
    pg_catalog.count(*) filter (
      where not role.rolcanlogin and not role.rolinherit and not role.rolbypassrls
    )::integer as dormant_role_count,
    (
      select pg_catalog.count(*)::integer
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where granted.rolname = 'fetanagent_companion_execution_bridge'
        and member.rolname <> 'postgres'
    ) as non_admin_members
  from pg_catalog.pg_roles role
  where role.rolname = 'fetanagent_companion_execution_bridge'
), execution_records as materialized (
  select
    (select pg_catalog.count(*) from app.agent_platform_companion_execution_http_requests)
    + (select pg_catalog.count(*) from app.agent_platform_companion_execution_assignments)
    + (select pg_catalog.count(*) from app.agent_platform_companion_execution_statuses)
      as total_records
), effective_epoch as materialized (
  select exists (
    select 1
    from app.private_trusted_telebirr_activation_control current_control
    join app.private_trusted_telebirr_activation_epochs authority
      on authority.epoch = current_control.current_epoch
    join app.private_live_deposit_pilot_revisions pilot
      on pilot.id = authority.pilot_revision_id
    where current_control.control_key = 'trusted_telebirr_financial_authority'
      and authority.authority_state = 'active'
      and authority.revoked_at is null
      and authority.active_from <= pg_catalog.clock_timestamp()
      and authority.expires_at > pg_catalog.clock_timestamp()
      and pilot.status = 'armed'
      and pilot.active_from <= pg_catalog.clock_timestamp()
      and pilot.expires_at > pg_catalog.clock_timestamp()
      and pilot.configuration_digest = authority.configuration_digest
  ) as available
)
select pg_catalog.jsonb_build_object(
  'readOnly', true,
  'identifiersRedacted', true,
  'readinessOnly', true,
  'activationAvailable', false,
  'pilotState', coalesce((select status from latest_pilot), 'none'),
  'pilotStopReason', (select stop_reason_code from latest_pilot),
  'totalJobs', least(queue_state.total_jobs, 2),
  'openJobs', least(queue_state.open_jobs, 2),
  'untouchedQueuedJobs', least(queue_state.untouched_jobs, 2),
  'cancelledUntouchedJobs', least(queue_state.cancelled_untouched_jobs, 2),
  'changedJobs', least(queue_state.total_jobs - queue_state.untouched_jobs, 2),
  'totalReservations', least(reservation_state.total_reservations, 2),
  'openExecutionReviewCases', least(customer_review_state.open_cases, 2),
  'customerResolutionPending',
    customer_review_state.open_cases = 1
      and customer_review_state.protected_open_cases = 1
      and queue_state.open_jobs = 0,
  'reservationBoundJobs', least(queue_state.reservation_bound_jobs, 2),
  'latestPilotJobs', least(queue_state.latest_pilot_jobs, 2),
  'allFinancialSwitchesDisabled',
    switch_state.switch_count = 7 and switch_state.disabled_count = 7,
  'effectiveTrustedEpochAvailable', effective_epoch.available,
  'companionExecutionControlDisabled',
    execution_control.control_count = 1 and execution_control.disabled_count = 1,
  'executionCapabilityDormant',
    capability.role_count = 1 and capability.dormant_role_count = 1
      and capability.non_admin_members = 0,
  'companionExecutionRecords', least(execution_records.total_records, 2),
  'stoppedPilotUntouchedJob',
    coalesce((select status from latest_pilot), 'none') = 'stopped'
      and queue_state.open_jobs = 1
      and queue_state.untouched_jobs = 1
      and queue_state.latest_pilot_paid_untouched_jobs = 1,
  'nextAction', case
    when switch_state.switch_count <> 7 or switch_state.disabled_count <> 7
      or execution_control.control_count <> 1 or execution_control.disabled_count <> 1
      or capability.role_count <> 1 or capability.dormant_role_count <> 1
      or capability.non_admin_members <> 0 or execution_records.total_records <> 0
      then 'safety_review'
    when coalesce((select status from latest_pilot), 'none') = 'stopped'
      and queue_state.open_jobs = 1
      and queue_state.untouched_jobs = 1
      and queue_state.latest_pilot_paid_untouched_jobs = 1
      then 'paid_stopped_pilot_review'
    when queue_state.open_jobs > 0 then 'queue_reconciliation'
    when customer_review_state.open_cases > 0
      and (
        customer_review_state.open_cases <> 1
        or customer_review_state.protected_open_cases <> 1
      ) then 'safety_review'
    when customer_review_state.open_cases = 1 then 'customer_resolution_pending'
    when coalesce((select status from latest_pilot), 'none') <> 'armed'
      then 'pilot_review'
    when not effective_epoch.available then 'trusted_activation_review'
    else 'release_and_owner_review'
  end
) as redacted_status
from queue_state
cross join reservation_state
cross join customer_review_state
cross join switch_state
cross join execution_control
cross join capability
cross join execution_records
cross join effective_epoch;

commit;
