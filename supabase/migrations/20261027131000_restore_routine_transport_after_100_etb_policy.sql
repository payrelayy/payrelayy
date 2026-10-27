-- The 100 ETB policy created a new Owner authorization while the still-valid
-- signed Windows transport remained bound to the preceding 25 ETB authorization.
-- Append one transport event for the same certificate and runtime credential.
-- Never revive a stopped, expired, changed, or uncertain execution lane.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('fetanagent:production:routine-telebirr-runtime', 20261005));
lock table app.routine_telebirr_processing_events,
  app.routine_telebirr_runtime_events, app.deposit_jobs,
  app.deposit_execution_attempts in share row exclusive mode;

do $restore$
declare
  v_current_event app.routine_telebirr_processing_events%rowtype;
  v_prior_event app.routine_telebirr_processing_events%rowtype;
  v_runtime app.routine_telebirr_runtime_events%rowtype;
  v_current_authority app.routine_telebirr_processing_authorizations%rowtype;
  v_prior_authority app.routine_telebirr_processing_authorizations%rowtype;
  v_policy app.deposit_policy_versions%rowtype;
  v_certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  v_role record;
begin
  select * into v_current_event from app.routine_telebirr_processing_events
    order by event_sequence desc limit 1;
  select * into v_prior_event from app.routine_telebirr_processing_events
    order by event_sequence desc offset 1 limit 1;
  select * into v_runtime from app.routine_telebirr_runtime_events
    order by event_sequence desc limit 1;
  select * into v_current_authority
    from app.routine_telebirr_processing_authorizations
    where id = v_current_event.authorization_id;
  select * into v_prior_authority
    from app.routine_telebirr_processing_authorizations
    where id = v_prior_event.authorization_id;
  select * into v_policy from app.deposit_policy_versions
    where id = v_current_authority.deposit_policy_version_id;
  select * into v_certificate
    from app.agent_platform_companion_enrollment_certificates
    where certificate_id = v_runtime.certificate_id;
  select rolcanlogin, rolvaliduntil into v_role from pg_catalog.pg_roles
    where rolname = 'fetanagent_routine_deposit_broker_runtime';

  -- Fresh and deliberately stopped environments have no live credit lane to
  -- restore. In production all three shared switches were already live.
  if v_runtime.id is null and v_current_event.id is null then return; end if;
  if (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in ('payment_verification','deposit_execution',
        'cbe_birr_authoritative_verification') and feature.mode = 'live') <> 3
    or not exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and control.enabled) then
    return;
  end if;

  if v_runtime.authorization_id = v_current_authority.id then
    if not app.routine_telebirr_runtime_is_active(v_current_authority.id) then
      raise exception 'The current routine transport is paused; do not restore it.';
    end if;
    return;
  end if;

  if v_current_event.event_kind is distinct from 'authorize'
    or v_prior_event.event_kind is distinct from 'authorize'
    or v_runtime.event_kind is distinct from 'activate'
    or v_runtime.authorization_id is distinct from v_prior_authority.id
    or v_runtime.reason_code is not null
    or v_runtime.valid_until <= pg_catalog.clock_timestamp() + interval '1 hour'
    or v_certificate.certificate_id is null
    or v_runtime.valid_until is distinct from v_certificate.valid_until
    or v_runtime.device_id is distinct from v_certificate.device_id
    or v_runtime.device_key_id is distinct from v_certificate.device_key_id
    or v_runtime.no_money_signer_key_id is distinct from
      v_certificate.certificate_signer_key_id
    or v_runtime.execution_signer_key_id <> 'companion-execution-production-v1'
    or not app.agent_platform_companion_execution_certificate_is_active(
      v_runtime.certificate_id, v_runtime.device_id, v_runtime.device_key_id,
      v_runtime.no_money_signer_key_id, pg_catalog.clock_timestamp())
    or v_role.rolcanlogin is distinct from true
    or v_role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '1 hour'
    or not pg_catalog.pg_has_role(
      'fetanagent_routine_deposit_broker_runtime',
      'fetanagent_routine_deposit_broker', 'member')
    or v_prior_authority.minimum_amount_minor <> 2500
    or v_prior_authority.maximum_amount_minor <> 2500000
    or v_current_authority.minimum_amount_minor <> 10000
    or v_current_authority.maximum_amount_minor <> 2500000
    or v_current_authority.platform_agent_account_id is distinct from
      v_prior_authority.platform_agent_account_id
    or v_current_authority.authorized_by_admin_id is distinct from
      v_prior_authority.authorized_by_admin_id
    or v_runtime.platform_agent_account_id is distinct from
      v_current_authority.platform_agent_account_id
    or v_policy.id is null or v_policy.version <> 2
    or v_policy.status <> 'active'
    or v_policy.minimum_amount_minor <> 10000
    or v_policy.maximum_amount_minor <> 2500000
    or v_policy.freshness_window_seconds <> 3600
    or not exists (select 1 from app.admin_users owner_user
      where owner_user.id = v_current_authority.authorized_by_admin_id
        and owner_user.role = 'owner' and owner_user.status = 'active')
    or not exists (select 1 from app.platform_agent_accounts agent
      where agent.id = v_current_authority.platform_agent_account_id
        and agent.status = 'active')
    or exists (select 1 from app.routine_telebirr_runtime_pauses pause
      where pause.authorization_event_sequence in
        (v_prior_event.event_sequence, v_current_event.event_sequence))
    or not app.routine_telebirr_signed_worker_recent(interval '45 seconds')
    or not exists (select 1 from app.routine_telebirr_broker_requests request
      where request.certificate_id = v_runtime.certificate_id
        and request.operation = 'lease'
        and request.assessed_at > pg_catalog.clock_timestamp() - interval '45 seconds')
    or exists (select 1 from app.deposit_jobs job
      where job.status not in ('succeeded','cancelled','dead'))
    or exists (select 1 from app.deposit_intents intent
      where intent.status in ('execution_pending','execution_in_progress',
        'execution_reconciliation','execution_uncertain'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared','final_action_fenced',
        'reconciliation_required') or (attempt.status = 'review_required'
          and not attempt.routine_review_isolated))
    or (select pg_catalog.count(*) from app.owner_provider_deposit_controls control
      where control.provider_code in ('telebirr','cbe_birr')
        and control.enabled) <> 2
    or not exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and control.enabled)
    or (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in ('payment_verification','deposit_execution',
        'cbe_birr_authoritative_verification') and feature.mode = 'live') <> 3 then
    raise exception 'The 100 ETB routine transport restoration preflight failed.';
  end if;

  insert into app.routine_telebirr_runtime_events (
    request_key, event_kind, authorization_id, certificate_id, device_id,
    device_key_id, no_money_signer_key_id, execution_signer_key_id,
    platform_agent_account_id, valid_until
  ) values (
    pg_catalog.gen_random_uuid(), 'activate', v_current_authority.id,
    v_runtime.certificate_id, v_runtime.device_id, v_runtime.device_key_id,
    v_runtime.no_money_signer_key_id, v_runtime.execution_signer_key_id,
    v_runtime.platform_agent_account_id, v_runtime.valid_until
  );

  -- Readiness includes a signed lease after this event's recorded_at. The
  -- worker can issue that lease only after this transaction commits.
  if not app.routine_telebirr_runtime_is_active(v_current_authority.id) then
    raise exception 'The restored routine transport is not ready.';
  end if;
end;
$restore$;
commit;
