-- Resume SMS deposits without deleting old claims, matches, conflicts, or audit.
-- A fresh cutoff excludes every submission and phone event from an earlier live
-- window. Both the private poller and finalizer enforce that same boundary.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $preflight$
begin
  if (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation')
        and feature.mode = 'disabled' and feature.settings = '{}'::jsonb) <> 7
    or not exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and not control.enabled)
    or exists (select 1 from app.deposit_jobs job
      where job.status in ('queued','leased','retry_wait'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared','final_action_fenced',
        'reconciliation_required','review_required')) then
    raise exception 'SMS resume patch requires a stopped financial ledger.';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc routine
      where routine.oid =
        'app.activate_receiver_sms_financial_gates(uuid,uuid)'::pg_catalog.regprocedure
        and not routine.prosecdef
        and routine.proowner = 'postgres'::pg_catalog.regrole)
    or not exists (select 1 from pg_catalog.pg_proc routine
      where routine.oid =
        'app.settle_next_receiver_sms_match()'::pg_catalog.regprocedure
        and routine.prosecdef
        and routine.proowner = 'postgres'::pg_catalog.regrole)
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
        'app.activate_receiver_sms_financial_gates(uuid,uuid)'::pg_catalog.regprocedure),
        'or exists (select 1 from app.receiver_sms_deposit_candidates)') = 0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
        'app.settle_next_receiver_sms_match()'::pg_catalog.regprocedure),
        'candidate.submitted_at <= pg_catalog.clock_timestamp()') = 0 then
    raise exception 'The SMS resume function catalog is not the reviewed predecessor.';
  end if;
end;
$preflight$;
create or replace function app.activate_receiver_sms_financial_gates(
  p_owner_auth_user_id uuid, p_request_key uuid
)
returns timestamptz language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  actor_id uuid;
  latest app.routine_telebirr_processing_events%rowtype;
  authority app.routine_telebirr_processing_authorizations%rowtype;
  checked_at timestamptz;
  switch_count integer;
  context_count integer;
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or p_owner_auth_user_id is null or p_request_key is null
    or p_request_key::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '42501',
      message = 'Receiver SMS activation requires the production administrator.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  perform 1 from app.private_trusted_telebirr_activation_control control
    where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The financial authority is unavailable.'; end if;
  actor_id := app.require_routine_telebirr_owner(p_owner_auth_user_id);
  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
    where gate.singleton for update;
  if not found then raise exception 'The readiness gate is unavailable.'; end if;
  perform 1 from app.receiver_sms_route_control control
    where control.singleton for update;
  if not found then raise exception 'The SMS route is unavailable.'; end if;
  perform feature.feature_key from app.feature_switches feature
    where feature.feature_key in (
      'cbe_birr_authoritative_verification', 'deposit_execution',
      'payment_verification', 'private_live_deposit_pilot',
      'telebirr_authoritative_verification', 'withdrawal_collection',
      'withdrawal_validation')
    order by feature.feature_key for update;
  get diagnostics switch_count = row_count;
  checked_at := pg_catalog.clock_timestamp();
  if switch_count <> 7 or
    (select pg_catalog.count(*) from app.feature_switches feature
      where feature.feature_key in (
        'cbe_birr_authoritative_verification', 'deposit_execution',
        'payment_verification', 'private_live_deposit_pilot',
        'telebirr_authoritative_verification', 'withdrawal_collection',
        'withdrawal_validation')
        and feature.mode = 'disabled' and feature.settings = '{}'::jsonb) <> 7
    or not exists (select 1 from app.receiver_sms_route_control control
      where control.singleton and not control.enabled) then
    raise exception 'The SMS route or switch set is not stopped.';
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
    or not app.routine_telebirr_signed_worker_recent(interval '45 seconds') then
    raise exception 'The Owner policy or signed credit worker is not current.';
  end if;
  if (select pg_catalog.count(distinct event.provider_code) = 2
      and pg_catalog.count(distinct enrollment.id) = 1
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
  if (select pg_catalog.count(*) = 3 and pg_catalog.bool_and(
      role.rolcanlogin and role.rolvaliduntil > checked_at + interval '1 hour')
      from pg_catalog.pg_roles role where role.rolname in (
        'fetanagent_receiver_sms_ingest_runtime',
        'fetanagent_receiver_sms_settlement_runtime',
        'fetanagent_routine_deposit_broker_runtime')) is not true
    or exists (select 1 from pg_catalog.pg_roles role
      where role.rolname in ('fetanagent_routine_telebirr_no_money_runtime',
        'fetanagent_routine_telebirr_paid_poll_runtime',
        'fetanagent_routine_telebirr_paid_settlement_runtime')
        and role.rolcanlogin)
    or exists (select 1 from app.deposit_jobs job
      where job.job_kind in ('execute_deposit', 'reconcile_execution')
        and job.status in ('queued', 'leased', 'retry_wait'))
    or exists (select 1 from app.deposit_execution_attempts attempt
      where attempt.status in ('prepared', 'final_action_fenced',
        'reconciliation_required', 'review_required')) then
    raise exception 'The SMS runtimes or execution ledger are not activation-ready.';
  end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
    set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
        pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
        pilot_mutation_mode = 'routine_activate'
    where gate.singleton and gate.pilot_mutation_mode is null
      and gate.pilot_mutation_backend_pid is null
      and gate.pilot_mutation_transaction_id is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The activation context is unavailable.'; end if;
  update app.receiver_sms_route_control control
    set enabled = true, cutover_at = checked_at, changed_at = checked_at
    where control.singleton and not control.enabled;
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The SMS route did not activate.'; end if;
  update app.feature_switches feature
    set mode = 'live', updated_by_admin_id = actor_id
    where feature.feature_key in (
      'cbe_birr_authoritative_verification', 'payment_verification',
      'deposit_execution')
      and feature.mode = 'disabled' and feature.settings = '{}'::jsonb;
  get diagnostics switch_count = row_count;
  if switch_count <> 3 then raise exception 'The SMS financial gates did not activate.'; end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
    set pilot_mutation_backend_pid = null,
        pilot_mutation_transaction_id = null, pilot_mutation_mode = null
    where gate.singleton and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
      and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
      and gate.pilot_mutation_mode = 'routine_activate';
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The activation context did not close.'; end if;
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values ('admin', actor_id, 'receiver_sms.financial_route_activated',
    'routine_telebirr_processing_authorization', authority.id,
    pg_catalog.jsonb_build_object('requestKey', p_request_key,
      'cutoverAt', checked_at,
      'featureKeys', pg_catalog.jsonb_build_array(
        'payment_verification', 'deposit_execution',
        'cbe_birr_authoritative_verification')));
  return checked_at;
end;
$$;

create or replace function app.settle_next_receiver_sms_match()
returns text language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_candidate_id uuid;
  v_cutover_at timestamptz;
  v_result record;
begin
  if session_user not in ('postgres', 'fetanagent_receiver_sms_settlement_runtime') then
    raise exception using errcode = '42501',
      message = 'Receiver SMS settlement is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'fetanagent:routine-telebirr-processing', 20261004));
  select control.cutover_at into v_cutover_at
    from app.receiver_sms_route_control control
    where control.singleton and control.enabled for share;
  if v_cutover_at is null then return 'disabled'; end if;
  -- A missing receiving-phone SMS is uncertain, never proof of an invalid payment.
  select candidate.id into v_candidate_id
    from app.receiver_sms_deposit_candidates candidate
    where candidate.submitted_at >= v_cutover_at
      and candidate.submitted_at <= pg_catalog.clock_timestamp() - interval '5 minutes'
      and not exists (select 1 from app.receiver_sms_payment_matches matched
        where matched.candidate_id = candidate.id)
      and not exists (select 1 from app.receiver_sms_settlement_holds held
        where held.candidate_id = candidate.id)
    order by candidate.submitted_at, candidate.id
    for update of candidate skip locked
    limit 1;
  if v_candidate_id is not null then
    insert into app.receiver_sms_settlement_holds (candidate_id, reason_code)
      values (v_candidate_id, 'no_receiver_sms_after_5m');
    return 'held_review';
  end if;
  select candidate.id into v_candidate_id
    from app.receiver_sms_deposit_candidates candidate
    join app.receiver_sms_payment_matches matched
      on matched.candidate_id = candidate.id and matched.disposition = 'ready'
    join app.receiver_sms_payment_events event
      on event.id = matched.payment_event_id
    where candidate.submitted_at >= v_cutover_at
      and matched.matched_at >= v_cutover_at
      and event.received_at >= v_cutover_at
      and event.recorded_at >= v_cutover_at
      and not exists (select 1 from app.receiver_sms_settlement_lineages lineage
        where lineage.candidate_id = candidate.id)
      and not exists (select 1 from app.receiver_sms_settlement_holds held
        where held.candidate_id = candidate.id)
    order by candidate.submitted_at, candidate.id
    for update of candidate skip locked
    limit 1;
  if v_candidate_id is null then return 'empty'; end if;
  begin
    select * into v_result from app.finalize_receiver_sms_match(v_candidate_id);
    if v_result.execution_job_id is null or v_result.already_finalized is not false then
      raise exception 'The receiver SMS job was not queued.';
    end if;
  exception when others then
    insert into app.receiver_sms_settlement_holds (candidate_id, reason_code)
      values (v_candidate_id, 'settlement_preflight_failed')
      on conflict (candidate_id) do nothing;
    return 'held_review';
  end;
  return 'queued';
end;
$$;
alter function app.activate_receiver_sms_financial_gates(uuid,uuid) owner to postgres;
revoke all on function app.activate_receiver_sms_financial_gates(uuid,uuid)
  from public, anon, authenticated, service_role;

alter function app.settle_next_receiver_sms_match() owner to postgres;
revoke all on function app.settle_next_receiver_sms_match()
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest, fetanagent_receiver_sms_ingest_runtime,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_routine_deposit_broker, fetanagent_routine_deposit_broker_runtime;
grant execute on function app.settle_next_receiver_sms_match()
  to fetanagent_receiver_sms_settlement;
comment on function app.activate_receiver_sms_financial_gates(uuid,uuid) is
  'Guarded SMS resume keeps historical evidence and selects a fresh cutoff; prior payments cannot automatically credit again.';
comment on function app.settle_next_receiver_sms_match() is
  'Private one-at-a-time settlement; ignores candidates and payment events from earlier cutovers without changing their records.';
commit;
