-- A compact, read-only Owner snapshot. These are configuration and ledger
-- facts, not a claim that a phone or Windows Companion is currently online.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create index receiver_sms_payment_events_provider_received_idx
  on app.receiver_sms_payment_events (provider_code, received_at desc);

create function app.get_owner_system_overview(p_actor_auth_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pg_temp as $$
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
    'telebirrSmsLastReceivedAt', (select sms.received_at from app.receiver_sms_payment_events sms
      where sms.provider_code = 'telebirr' order by sms.received_at desc limit 1),
    'cbeSmsLastReceivedAt', (select sms.received_at from app.receiver_sms_payment_events sms
      where sms.provider_code = 'cbe_birr' order by sms.received_at desc limit 1),
    'openDepositJobs', (select pg_catalog.count(*) from app.deposit_jobs job
      where job.status in ('queued','leased','retry_wait')),
    'deadDepositJobs', (select pg_catalog.count(*) from app.deposit_jobs job
      where job.status = 'dead'),
    'awaitingManualCredits', (select pg_catalog.count(*)
      from app.owner_manual_payment_cases owner_case
      where owner_case.status = 'awaiting_manual_credit'),
    'checkedAt', pg_catalog.statement_timestamp()
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
