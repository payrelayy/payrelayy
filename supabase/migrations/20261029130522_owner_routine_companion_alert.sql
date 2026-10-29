-- Use authenticated routine-deposit lease requests for the Owner Home
-- Companion alert. The older read-only lookup poll is a separate channel and
-- cannot establish whether the live deposit Companion is connected.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function app.get_owner_system_overview(p_actor_auth_user_id uuid)
returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_checked_at timestamptz := pg_catalog.statement_timestamp();
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;

  return pg_catalog.jsonb_build_object(
    'paymentVerificationMode', (select feature.mode::text from app.feature_switches feature
      where feature.feature_key = 'payment_verification'),
    'depositExecutionMode', (select feature.mode::text from app.feature_switches feature
      where feature.feature_key = 'deposit_execution'),
    'telebirrReceiptLookupMode', (select feature.mode::text from app.feature_switches feature
      where feature.feature_key = 'telebirr_authoritative_verification'),
    'paymentMethods', (select coalesce(
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'providerCode', control.provider_code,
        'ownerEnabled', control.enabled,
        'readiness', app.owner_provider_deposit_readiness(control.provider_code)
      ) order by control.provider_code), '[]'::jsonb)
      from app.owner_provider_deposit_controls control
      where control.provider_code in ('telebirr','cbe_birr')),
    'routineCompanionLastSeenAt', (
      select pg_catalog.max(recent_lease.completed_at)
      from app.admin_users owner_user
      join app.agent_platform_companion_pairing_challenges challenge
        on challenge.created_by_admin_id = owner_user.id
      join app.agent_platform_companion_enrollment_certificates certificate
        on certificate.pairing_id = challenge.pairing_id
      join app.agent_platform_companion_server_signers signer
        on signer.id = certificate.server_signer_id
      left join app.agent_platform_companion_device_revocations device_revocation
        on device_revocation.certificate_id = certificate.certificate_id
      left join app.agent_platform_companion_server_signer_revocations signer_revocation
        on signer_revocation.server_signer_id = signer.id
      left join lateral (
        select broker.completed_at
        from app.routine_telebirr_broker_requests broker
        where broker.certificate_id = certificate.certificate_id
          and broker.operation = 'lease'
          and broker.completed_at <= v_checked_at
        order by broker.completed_at desc
        limit 1
      ) recent_lease on true
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active'
        and certificate.valid_from <= v_checked_at
        and certificate.valid_until > v_checked_at
        and signer.valid_from <= v_checked_at
        and signer.valid_until > v_checked_at
        and device_revocation.certificate_id is null
        and signer_revocation.server_signer_id is null),
    'telebirrSmsLastReceivedAt', (select sms.received_at from app.receiver_sms_payment_events sms
      where sms.provider_code = 'telebirr' order by sms.received_at desc limit 1),
    'cbeSmsLastReceivedAt', (select sms.received_at from app.receiver_sms_payment_events sms
      where sms.provider_code = 'cbe_birr' order by sms.received_at desc limit 1),
    'openDepositJobs', (select pg_catalog.count(*) from app.deposit_jobs job
      where job.status in ('queued','leased','retry_wait')),
    'readyDepositJobs', (select pg_catalog.count(*) from app.deposit_jobs job
      where job.status in ('queued','retry_wait') and job.run_after <= v_checked_at),
    'oldestReadyDepositJobAt', (select pg_catalog.min(job.run_after) from app.deposit_jobs job
      where job.status in ('queued','retry_wait') and job.run_after <= v_checked_at),
    'leasedDepositJobs', (select pg_catalog.count(*) from app.deposit_jobs job
      where job.status = 'leased'),
    'overdueLeasedDepositJobs', (select pg_catalog.count(*) from app.deposit_jobs job
      where job.status = 'leased' and job.lease_expires_at < v_checked_at),
    'deadDepositJobs', (select pg_catalog.count(*) from app.deposit_jobs job
      where job.status = 'dead'),
    'awaitingManualCredits', (select pg_catalog.count(*)
      from app.owner_manual_payment_cases owner_case
      where owner_case.status = 'awaiting_manual_credit'),
    'pendingPlayerValidations', (select pg_catalog.count(*)
      from app.telegram_player_validation_requests request
      where request.status = 'pending'),
    'oldestPendingPlayerValidationAt', (select pg_catalog.min(request.requested_at)
      from app.telegram_player_validation_requests request
      where request.status = 'pending'),
    'checkedAt', v_checked_at
  );
end;
$$;
alter function app.get_owner_system_overview(uuid) owner to postgres;
revoke all on function app.get_owner_system_overview(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime;
grant execute on function app.get_owner_system_overview(uuid)
  to fetanagent_owner_control;

commit;
