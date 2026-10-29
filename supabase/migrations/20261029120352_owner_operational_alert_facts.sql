-- Read-only, Owner-scoped work-age facts for the Home attention panel.  An old
-- SMS is not treated as a phone-offline signal, and a paused switch is not an
-- outage.  These facts cannot claim or change financial work.
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
