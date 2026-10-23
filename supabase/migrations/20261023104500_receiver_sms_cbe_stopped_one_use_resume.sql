-- Install a dormant, one-use recovery from the exact CBE-live/SMS-route-on
-- incident stop. Applying this migration changes no financial state.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $preflight$
declare settlement_source text;
begin
  if to_regprocedure('app.activate_receiver_sms_financial_gates(uuid,uuid)') is null
    or to_regprocedure('app.stop_receiver_sms_financial_gates(uuid,text)') is null
    or to_regprocedure('app.settle_next_receiver_sms_match()') is null then
    raise exception 'The reviewed SMS activation and settlement catalog is absent.';
  end if;
  settlement_source := pg_get_functiondef(
    'app.settle_next_receiver_sms_match()'::regprocedure);
  if strpos(settlement_source, 'candidate.submitted_at >= v_cutover_at') = 0
    or strpos(settlement_source, 'matched.matched_at >= v_cutover_at') = 0
    or strpos(settlement_source, 'event.received_at >= v_cutover_at') = 0
    or strpos(settlement_source, 'event.recorded_at >= v_cutover_at') = 0 then
    raise exception 'The SMS settlement cutoff contract has changed.';
  end if;
end;
$preflight$;

create function app.resume_receiver_sms_cbe_stopped_financial_gates(
  p_owner_auth_user_id uuid, p_request_key uuid
)
returns timestamptz language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  actor_id uuid;
  latest app.routine_telebirr_processing_events%rowtype;
  authority app.routine_telebirr_processing_authorizations%rowtype;
  checked_at timestamptz;
  old_cutover timestamptz;
  switch_count integer;
  context_count integer;
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or p_owner_auth_user_id is null or p_request_key is null
    or p_request_key::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '42501',
      message = 'SMS incident recovery requires the production administrator.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The financial authority is unavailable.'; end if;
  actor_id := app.require_routine_telebirr_owner(p_owner_auth_user_id);
  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
    where gate.singleton for update;
  if not found then raise exception 'The readiness gate is unavailable.'; end if;
  select cutover_at into old_cutover from app.receiver_sms_route_control control
    where control.singleton and control.enabled for update;
  if not found or old_cutover is null then
    raise exception 'The previously live SMS route is unavailable.';
  end if;
  perform feature.feature_key from app.feature_switches feature
    where feature.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution',
      'payment_verification', 'private_live_deposit_pilot',
      'telebirr_authoritative_verification', 'withdrawal_collection',
      'withdrawal_validation') order by feature.feature_key for update;
  get diagnostics switch_count = row_count;
  checked_at := clock_timestamp();
  if switch_count <> 7 or old_cutover >= checked_at
    or (select count(*) from app.feature_switches feature
      where feature.feature_key = 'cbe_birr_authoritative_verification'
        and feature.mode = 'live' and feature.settings = '{}'::jsonb) <> 1
    or (select count(*) from app.feature_switches feature
      where feature.feature_key in (
        'deposit_execution', 'payment_verification',
        'private_live_deposit_pilot', 'telebirr_authoritative_verification',
        'withdrawal_collection', 'withdrawal_validation')
        and feature.mode = 'disabled' and feature.settings = '{}'::jsonb) <> 6 then
    raise exception 'The exact CBE-live, SMS-route-on incident profile is absent.';
  end if;
  select event.* into latest from app.routine_telebirr_processing_events event
    order by event.event_sequence desc limit 1 for share;
  select saved.* into authority from app.routine_telebirr_processing_authorizations saved
    where saved.id = latest.authorization_id for share;
  if latest.event_kind is distinct from 'authorize'
    or authority.authorized_by_admin_id is distinct from actor_id
    or authority.platform_code <> 'kemerbet' or authority.currency_code <> 'ETB'
    or authority.minimum_amount_minor <> 2500
    or authority.maximum_amount_minor <> 2500000
    or authority.freshness_window_seconds <> 3600
    or authority.max_concurrent_deposits <> 1
    or authority.player_scope <> 'all_active_deposit_eligible'
    or authority.player_ownership_required
    or authority.daily_quota_minor is not null
    or authority.successful_deposit_quota is not null
    or not app.routine_telebirr_runtime_is_active(authority.id)
    or exists (select 1 from app.routine_telebirr_runtime_pauses pause
      where pause.authorization_event_sequence = latest.event_sequence)
    or not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    raise exception 'The Owner policy or signed credit worker is not current.';
  end if;
  if (select count(distinct event.provider_code) = 2
      and count(distinct enrollment.id) = 1
      from app.receiver_sms_payment_events event
      join app.routine_telebirr_device_enrollments enrollment
        on enrollment.id = event.device_enrollment_id
      join app.receiver_accounts receiver
        on receiver.id = event.receiver_account_id
        and receiver.version = event.receiver_account_version
      where event.recorded_at >= checked_at - interval '24 hours'
        and event.received_at >= checked_at - interval '24 hours'
        and enrollment.valid_until > checked_at + interval '1 hour'
        and not exists (select 1
          from app.routine_telebirr_device_enrollment_revocations revocation
          where revocation.enrollment_id = enrollment.id)
        and receiver.status = 'active' and receiver.retired_at is null
    ) is not true then
    raise exception 'Current signed SMS intake for both receivers is required.';
  end if;
  if (select count(*) = 4 and bool_and(
      role.rolcanlogin and role.rolvaliduntil > checked_at + interval '1 hour')
      from pg_roles role where role.rolname in (
        'fetanagent_receiver_sms_ingest_runtime',
        'fetanagent_receiver_sms_settlement_runtime',
        'fetanagent_routine_deposit_broker_runtime',
        'fetanagent_routine_telebirr_no_money_runtime')) is not true
    or (select count(*) = 2 and bool_and(role.rolcanlogin)
      from pg_roles role where role.rolname in (
        'fetanagent_routine_telebirr_paid_poll_runtime',
        'fetanagent_routine_telebirr_paid_settlement_runtime')) is not true
    or exists (select 1 from pg_stat_activity activity
      where activity.usename in (
        'fetanagent_routine_telebirr_paid_poll_runtime',
        'fetanagent_routine_telebirr_paid_settlement_runtime'))
    or exists (select 1 from app.routine_telebirr_paid_poll_claims claim
      where claim.claimed_at >= checked_at - interval '5 minutes')
    or exists (select 1 from app.deposit_jobs job
      where job.job_kind in ('execute_deposit', 'reconcile_execution')
        and job.status in ('queued', 'leased', 'retry_wait'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then
    raise exception 'The SMS runtimes or execution ledger are not activation-ready.';
  end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
    set pilot_mutation_backend_pid = pg_backend_pid(),
        pilot_mutation_transaction_id = pg_current_xact_id(),
        pilot_mutation_mode = 'routine_activate'
    where gate.singleton and gate.pilot_mutation_mode is null
      and gate.pilot_mutation_backend_pid is null
      and gate.pilot_mutation_transaction_id is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The activation context is unavailable.'; end if;
  execute 'alter role fetanagent_routine_telebirr_paid_poll_runtime nologin password null valid until ''1970-01-01 00:00:00+00''';
  execute 'alter role fetanagent_routine_telebirr_paid_settlement_runtime nologin password null valid until ''1970-01-01 00:00:00+00''';
  perform pg_stat_clear_snapshot();
  if exists (select 1 from pg_stat_activity activity
      where activity.usename in (
        'fetanagent_routine_telebirr_paid_poll_runtime',
        'fetanagent_routine_telebirr_paid_settlement_runtime')) then
    raise exception 'A paid receipt session appeared during retirement.';
  end if;
  update app.receiver_sms_route_control control
    set cutover_at = checked_at, changed_at = checked_at
    where control.singleton and control.enabled and control.cutover_at = old_cutover;
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The SMS cutoff did not advance.'; end if;
  update app.feature_switches feature
    set mode = 'live', updated_by_admin_id = actor_id
    where feature.feature_key in ('payment_verification', 'deposit_execution')
      and feature.mode = 'disabled' and feature.settings = '{}'::jsonb;
  get diagnostics switch_count = row_count;
  if switch_count <> 2 then raise exception 'The shared deposit gates did not activate.'; end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
    set pilot_mutation_backend_pid = null,
        pilot_mutation_transaction_id = null, pilot_mutation_mode = null
    where gate.singleton and gate.pilot_mutation_backend_pid = pg_backend_pid()
      and gate.pilot_mutation_transaction_id = pg_current_xact_id()
      and gate.pilot_mutation_mode = 'routine_activate';
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The activation context did not close.'; end if;
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values ('admin', actor_id, 'receiver_sms.cbe_stopped_incident_resumed',
    'routine_telebirr_processing_authorization', authority.id,
    jsonb_build_object('requestKey', p_request_key,
      'previousCutoverAt', old_cutover, 'cutoverAt', checked_at,
      'retiredReceiptRoles', 2,
      'featureKeys', jsonb_build_array('payment_verification', 'deposit_execution')));
  return checked_at;
end;
$$;

alter function app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid)
  owner to postgres;
revoke all on function app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid)
  from public, anon, authenticated, service_role;
comment on function app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid) is
  'One-use production recovery from CBE-live/SMS-route-on stopped state. Requires signed SMS intake for both providers and a fresh signed idle worker, retires paid receipt roles, and advances the SMS cutoff before enabling only the two shared gates.';
commit;
