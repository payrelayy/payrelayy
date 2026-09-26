-- Display-only Owner projection of the dormant companion execution boundary.
-- This function never grants activation, leases a job, or changes a payment.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.get_owner_companion_execution_readiness(
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null or not exists (
    select 1
    from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner'
      and owner_user.status = 'active'
  ) then
    raise exception using errcode = '42501',
      message = 'Only the active Owner can read execution readiness.';
  end if;

  with latest_pilot as materialized (
    select pilot.id, pilot.status
    from app.private_live_deposit_pilot_revisions pilot
    order by pilot.created_at desc, pilot.revision desc
    limit 1
  ), jobs as materialized (
    select
      pg_catalog.count(*) filter (
        where job.status in ('queued', 'leased', 'retry_wait')
      )::integer as open_count,
      pg_catalog.count(*) filter (
        where job.status = 'queued' and job.attempt_count = 0
          and job.lease_token is null and job.leased_by is null
          and job.lease_expires_at is null
      )::integer as untouched_count,
      pg_catalog.count(*) filter (
        where job.status = 'cancelled' and job.attempt_count = 0
          and job.lease_token is null and job.leased_by is null
          and job.lease_expires_at is null
      )::integer as cancelled_untouched_count
    from app.deposit_jobs job
  ), reviews as materialized (
    select
      (select pg_catalog.count(*)::integer
       from app.deposit_review_cases review_case
       where review_case.review_kind = 'execution'
         and review_case.status in ('open', 'assigned')) as open_count,
      (select pg_catalog.count(*)::integer
       from app.stopped_pilot_paid_execution_reviews receipt
       join app.deposit_review_cases review_case
         on review_case.deposit_intent_id = receipt.deposit_intent_id
        and review_case.review_kind = 'execution'
        and review_case.reason_code = 'stopped_pilot_paid_proof_review'
        and review_case.status in ('open', 'assigned')
       join app.deposit_jobs job
         on job.id = receipt.deposit_job_id
        and job.deposit_intent_id = receipt.deposit_intent_id
        and job.status = 'cancelled' and job.attempt_count = 0
        and job.lease_token is null and job.leased_by is null
        and job.lease_expires_at is null
       join app.deposit_intents intent
         on intent.id = receipt.deposit_intent_id
        and intent.status = 'execution_review'
       join app.private_live_deposit_pilot_reservations reservation
         on reservation.id = receipt.reservation_id
        and reservation.deposit_intent_id = intent.id
        and reservation.pilot_revision_id = receipt.pilot_revision_id
       join app.deposit_payment_claims claim
         on claim.id = receipt.payment_claim_id
        and claim.id = reservation.deposit_payment_claim_id
        and claim.deposit_intent_id = intent.id
        and claim.provider_payment_evidence_id = reservation.provider_payment_evidence_id
       where not exists (
         select 1 from app.deposit_execution_attempts attempt
         where attempt.deposit_job_id = job.id
       )) as protected_count
  ), switches as materialized (
    select
      pg_catalog.count(*)::integer as total_count,
      pg_catalog.count(*) filter (
        where switch.mode = 'disabled' and switch.settings = '{}'::jsonb
      )::integer as disabled_count
    from app.feature_switches switch
    where switch.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution',
      'payment_verification', 'private_live_deposit_pilot',
      'telebirr_authoritative_verification', 'withdrawal_collection',
      'withdrawal_validation'
    )
  ), companion as materialized (
    select
      pg_catalog.count(*)::integer as total_count,
      pg_catalog.count(*) filter (
        where control.singleton and control.control_state = 'disabled'
          and control.certificate_id is null and control.device_id is null
          and control.pilot_revision_id is null and control.activation_epoch is null
          and control.execution_signer_key_id is null
          and control.device_key_id is null and control.no_money_signer_key_id is null
          and control.execution_signer_public_key_spki is null
          and control.execution_signer_public_key_spki_sha256 is null
          and control.platform_agent_account_id is null
          and control.pilot_revision is null
          and control.pilot_configuration_digest is null
          and control.active_from is null and control.expires_at is null
          and control.activated_by_admin_id is null
          and control.activated_at is null and control.disabled_at is null
          and control.disable_reason_code is null
      )::integer as disabled_count
    from app.agent_platform_companion_execution_control control
  ), capability as materialized (
    select
      pg_catalog.count(*)::integer as role_count,
      pg_catalog.count(*) filter (
        where not capability_role.rolcanlogin and not capability_role.rolinherit
          and not capability_role.rolbypassrls
      )::integer as dormant_count,
      (select pg_catalog.count(*)::integer
       from pg_catalog.pg_auth_members membership
       join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
       join pg_catalog.pg_roles member_role on member_role.oid = membership.member
       where granted_role.rolname = 'fetanagent_companion_execution_bridge'
         and member_role.rolname <> 'postgres') as runtime_members
    from pg_catalog.pg_roles capability_role
    where capability_role.rolname = 'fetanagent_companion_execution_bridge'
  ), trusted_epoch as materialized (
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
  ), execution_records as materialized (
    select
      (select pg_catalog.count(*) from app.agent_platform_companion_execution_http_requests)
      + (select pg_catalog.count(*) from app.agent_platform_companion_execution_assignments)
      + (select pg_catalog.count(*) from app.agent_platform_companion_execution_statuses)
      + (select pg_catalog.count(*) from app.deposit_execution_attempts) as total_count
  )
  select pg_catalog.jsonb_build_object(
    'readOnly', true,
    'identifiersRedacted', true,
    'activationAvailable', false,
    'pilotState', pg_catalog.coalesce((select status from latest_pilot), 'none'),
    'openJobs', pg_catalog.least(jobs.open_count, 2),
    'untouchedQueuedJobs', pg_catalog.least(jobs.untouched_count, 2),
    'cancelledUntouchedJobs', pg_catalog.least(jobs.cancelled_untouched_count, 2),
    'openExecutionReviews', pg_catalog.least(reviews.open_count, 2),
    'customerResolutionPending',
      reviews.open_count = 1 and reviews.protected_count = 1
        and jobs.open_count = 0,
    'financialSwitchesDisabled',
      switches.total_count = 7 and switches.disabled_count = 7,
    'companionExecutionDisabled',
      companion.total_count = 1 and companion.disabled_count = 1,
    'executionCapabilityDormant',
      capability.role_count = 1 and capability.dormant_count = 1
        and capability.runtime_members = 0,
    'effectiveTrustedEpochAvailable', trusted_epoch.available,
    'nextAction', case
      when switches.total_count <> 7 or switches.disabled_count <> 7
        or companion.total_count <> 1 or companion.disabled_count <> 1
        or capability.role_count <> 1 or capability.dormant_count <> 1
        or capability.runtime_members <> 0
        or execution_records.total_count <> 0 then 'safety_review'
      when jobs.open_count > 0 then 'queue_reconciliation'
      when reviews.open_count > 0 and (
        reviews.open_count <> 1 or reviews.protected_count <> 1
      ) then 'safety_review'
      when reviews.open_count = 1 then 'customer_resolution_pending'
      when pg_catalog.coalesce((select status from latest_pilot), 'none') <> 'armed'
        then 'pilot_review'
      when not trusted_epoch.available then 'trusted_activation_review'
      else 'release_and_owner_review'
    end
  ) into result
  from jobs cross join reviews cross join switches cross join companion
    cross join capability cross join trusted_epoch cross join execution_records;

  return result;
end;
$$;

alter function app.get_owner_companion_execution_readiness(uuid) owner to postgres;
revoke all on function app.get_owner_companion_execution_readiness(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_api, fetanagent_api_runtime, fetanagent_worker,
    fetanagent_owner_control, fetanagent_owner_control_runtime,
    fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
    fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
    fetanagent_companion_execution_bridge;
grant execute on function app.get_owner_companion_execution_readiness(uuid)
  to fetanagent_owner_control;

comment on function app.get_owner_companion_execution_readiness(uuid) is
  'Identifier-free, read-only Owner preview of execution blockers. Never arms execution or changes a payment.';

commit;
