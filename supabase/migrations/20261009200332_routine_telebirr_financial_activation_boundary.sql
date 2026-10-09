-- A dormant, postgres-only route from the reviewed routine transport to the two
-- shared deposit gates. Migration never enables a financial switch.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

alter table app.private_owner_kemerbet_readiness_cohort_gate
  drop constraint private_owner_kemerbet_readiness_pilot_mutation_context_check,
  add constraint private_owner_kemerbet_readiness_pilot_mutation_context_check check (
    (pilot_mutation_backend_pid is null
      and pilot_mutation_transaction_id is null
      and pilot_mutation_mode is null)
    or (pilot_mutation_backend_pid is not null
      and pilot_mutation_transaction_id is not null
      and pilot_mutation_mode in (
        'prepare', 'arm', 'stop', 'routine_activate', 'routine_stop'
      ))
  );

create or replace function app.serialize_private_owner_kemerbet_readiness_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  pilot_mutation_backend_pid integer;
  pilot_mutation_transaction_id pg_catalog.xid8;
  pilot_mutation text;
  reviewed_mutation boolean := false;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The private KemerBet readiness gate requires read committed isolation.';
  end if;

  select gate.pilot_mutation_backend_pid,
         gate.pilot_mutation_transaction_id,
         gate.pilot_mutation_mode
    into pilot_mutation_backend_pid,
         pilot_mutation_transaction_id,
         pilot_mutation
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then
    raise exception 'The private KemerBet readiness serialization gate is unavailable.';
  end if;

  if exists (
    select 1 from app.private_owner_kemerbet_readiness_cohort_claims claim
    where claim.claim_state in ('prepared', 'exported', 'imported')
  ) then
    reviewed_mutation :=
      pg_catalog.pg_has_role(session_user, 'fetanagent_owner_control', 'member')
      and pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
      and pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
      and tg_table_schema = 'app'
      and tg_op <> 'TRUNCATE'
      and (
        (pilot_mutation = 'prepare'
          and tg_table_name = 'private_live_deposit_pilot_revisions'
          and tg_op in ('INSERT', 'UPDATE'))
        or (pilot_mutation in ('arm', 'stop')
          and tg_table_name in ('private_live_deposit_pilot_revisions', 'feature_switches')
          and tg_op = 'UPDATE')
        or (session_user = 'postgres'
          and pilot_mutation in ('routine_activate', 'routine_stop')
          and tg_table_name = 'feature_switches'
          and tg_op = 'UPDATE')
      );
    if reviewed_mutation is not true then
      raise exception 'The fixed KemerBet readiness cohort is frozen.';
    end if;
  end if;
  return null;
end;
$$;

-- Even a postgres session holding the routine gate context cannot change a
-- third switch, settings, or unrelated fields under that context.
create function app.enforce_routine_telebirr_financial_switch_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare gate_mode text;
begin
  select gate.pilot_mutation_mode into gate_mode
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id();
  if gate_mode not in ('routine_activate', 'routine_stop') or gate_mode is null then
    return new;
  end if;
  if session_user <> 'postgres' or tg_op <> 'UPDATE'
    or old.feature_key not in ('payment_verification', 'deposit_execution')
    or new.feature_key is distinct from old.feature_key
    or old.settings <> '{}'::jsonb or new.settings <> '{}'::jsonb
    or (gate_mode = 'routine_stop'
      and new.updated_by_admin_id is distinct from old.updated_by_admin_id)
    or (gate_mode = 'routine_activate'
      and (old.mode <> 'disabled' or new.mode <> 'live'))
    or (gate_mode = 'routine_stop'
      and (old.mode <> 'live' or new.mode <> 'disabled')) then
    raise exception 'The routine financial switch mutation is outside its exact scope.';
  end if;
  return new;
end;
$$;

create trigger feature_switches_routine_financial_scope
before update on app.feature_switches
for each row
execute function app.enforce_routine_telebirr_financial_switch_scope();

create function app.activate_routine_telebirr_financial_gates(
  p_owner_auth_user_id uuid, p_request_key uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
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
      message = 'The routine financial activation requires the production administrator.';
  end if;
  -- Same order as paid intake, Owner stop, and the legacy pilot: routine
  -- advisory lock, TeleBirr authority, cohort gate, then switch rows.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  perform 1 from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The TeleBirr financial authority is unavailable.'; end if;
  actor_id := app.require_routine_telebirr_owner(p_owner_auth_user_id);
  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then raise exception 'The KemerBet readiness gate is unavailable.'; end if;
  perform switch.feature_key from app.feature_switches switch
   where switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation')
   order by switch.feature_key for update;
  get diagnostics switch_count = row_count;
  checked_at := pg_catalog.clock_timestamp();
  if switch_count <> 7 or (
    select pg_catalog.count(*) from app.feature_switches switch
     where switch.feature_key in (
       'cbe_birr_authoritative_verification', 'deposit_execution',
       'payment_verification', 'private_live_deposit_pilot',
       'telebirr_authoritative_verification', 'withdrawal_collection',
       'withdrawal_validation')
       and switch.mode = 'disabled' and switch.settings = '{}'::jsonb
  ) <> 7 then
    raise exception 'All seven financial switches must be disabled before routine activation.';
  end if;
  select event.* into latest from app.routine_telebirr_processing_events event
   order by event.event_sequence desc limit 1 for share;
  select saved.* into authority
    from app.routine_telebirr_processing_authorizations saved
   where saved.id = latest.authorization_id for share;
  if latest.event_kind is distinct from 'authorize'
    or authority.authorized_by_admin_id is distinct from actor_id
    or authority.provider_code <> 'telebirr'
    or authority.platform_code <> 'kemerbet'
    or authority.currency_code <> 'ETB'
    or authority.minimum_amount_minor <> 2500
    or authority.maximum_amount_minor <> 2500000
    or authority.freshness_window_seconds <> 3600
    or authority.max_concurrent_deposits <> 1
    or authority.player_scope <> 'all_active_deposit_eligible'
    or authority.player_ownership_required
    or authority.daily_quota_minor is not null
    or authority.successful_deposit_quota is not null
    or authority.amount_source <> 'official_receipt_settled_amount'
    or not app.routine_telebirr_runtime_is_active(authority.id)
    or not exists (
      select 1 from app.platform_agent_accounts agent
      join app.platforms platform on platform.id = agent.platform_id
      join app.deposit_policy_versions policy
        on policy.id = authority.deposit_policy_version_id
      where agent.id = authority.platform_agent_account_id
        and agent.status = 'active'
        and platform.code = 'kemerbet' and platform.status = 'active'
        and policy.status = 'active'
        and policy.minimum_amount_minor = authority.minimum_amount_minor
        and policy.maximum_amount_minor = authority.maximum_amount_minor
        and policy.freshness_window_seconds = authority.freshness_window_seconds
    )
    or exists (
      select 1 from app.routine_telebirr_runtime_pauses pause
       where pause.authorization_event_sequence = latest.event_sequence
    ) then
    raise exception 'The Owner-approved routine execution lane is not current and exact.';
  end if;
  if exists (
    select 1 from app.private_trusted_telebirr_activation_control control
    join app.private_trusted_telebirr_activation_epochs epoch
      on epoch.epoch = control.current_epoch
    where control.control_key = 'trusted_telebirr_financial_authority'
      and epoch.authority_state = 'active' and epoch.revoked_at is null
  ) or exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in ('fetanagent_deposit_executor',
       'fetanagent_deposit_executor_runtime') and role.rolcanlogin
  ) then
    raise exception 'The retired financial executor or TeleBirr pilot is not dormant.';
  end if;
  if not exists (
    select 1 from app.routine_telebirr_signed_observation_payloads observation
    join app.routine_telebirr_lookup_challenges challenge
      on challenge.challenge_id = observation.challenge_id
    join app.routine_telebirr_device_enrollments enrollment
      on enrollment.id = challenge.device_enrollment_id
    where observation.recorded_at >= checked_at - interval '24 hours'
      and observation.server_policy_result = 'signed_evidence_matches_policy'
      and observation.signed_observation ->> 'contractVersion' = '2'
      and observation.signed_observation #>> '{body,facts,sourceOriginAttestation}'
        = 'official_tls_origin'
      and challenge.issuance_mode = 'no_money'
      and enrollment.valid_until > checked_at + interval '1 hour'
      and not exists (
        select 1 from app.routine_telebirr_device_enrollment_revocations revocation
        where revocation.enrollment_id = enrollment.id)
  ) then
    raise exception 'A recent signed no-money official-origin phone proof is required.';
  end if;
  if (
    select pg_catalog.count(*) = 4 and pg_catalog.bool_and(
      role.rolcanlogin and coalesce(
        role.rolvaliduntil > checked_at + interval '1 hour', false))
    from pg_catalog.pg_roles role where role.rolname in (
      'fetanagent_routine_deposit_broker_runtime',
      'fetanagent_routine_telebirr_no_money_runtime',
      'fetanagent_routine_telebirr_paid_poll_runtime',
      'fetanagent_routine_telebirr_paid_settlement_runtime')
  ) is not true or exists (
    select 1 from app.deposit_jobs job
     where job.job_kind in ('execute_deposit', 'reconcile_execution')
       and job.status in ('queued', 'leased', 'retry_wait')
  ) or exists (
    select 1 from app.deposit_execution_attempts attempt
     where attempt.status in ('prepared', 'final_action_fenced',
       'reconciliation_required', 'review_required')
  ) then
    raise exception 'The routine financial roles or execution ledger are not activation-ready.';
  end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'routine_activate'
   where gate.singleton and gate.pilot_mutation_mode is null
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The routine activation context is unavailable.'; end if;
  update app.feature_switches switch
     set mode = 'live', updated_by_admin_id = actor_id
   where switch.feature_key in ('payment_verification', 'deposit_execution')
     and switch.mode = 'disabled' and switch.settings = '{}'::jsonb;
  get diagnostics switch_count = row_count;
  if switch_count <> 2 then raise exception 'The two routine financial gates did not activate.'; end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'routine_activate';
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The routine activation context did not close.'; end if;
  insert into app.audit_events (
    actor_kind, actor_admin_id, action, resource_type, resource_id, metadata
  ) values (
    'admin', actor_id, 'routine_telebirr.financial_gates_activated',
    'routine_telebirr_processing_authorization', authority.id,
    pg_catalog.jsonb_build_object('requestKey', p_request_key,
      'featureKeys', pg_catalog.jsonb_build_array('payment_verification', 'deposit_execution'))
  );
  return true;
end;
$$;

create function app.stop_routine_telebirr_financial_gates(
  p_request_key uuid, p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  switch_count integer;
  context_count integer;
begin
  if session_user <> 'postgres' or current_user <> 'postgres'
    or p_request_key is null or p_request_key::text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_reason is null
    or p_reason not in ('operator_requested', 'incident_stop')
    or current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '42501',
      message = 'The production administrator and an exact stop reason are required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:routine-telebirr-processing', 20261004));
  perform 1 from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority' for share;
  if not found then raise exception 'The TeleBirr financial authority is unavailable.'; end if;
  perform 1 from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton for update;
  if not found then raise exception 'The KemerBet readiness gate is unavailable.'; end if;
  perform switch.feature_key from app.feature_switches switch
   where switch.feature_key in ('deposit_execution', 'payment_verification')
   order by switch.feature_key for update;
  get diagnostics switch_count = row_count;
  if switch_count <> 2 or exists (
    select 1 from app.feature_switches switch
     where switch.feature_key in ('deposit_execution', 'payment_verification')
       and (switch.mode not in ('live', 'disabled')
         or switch.settings <> '{}'::jsonb)
  ) or (
    select pg_catalog.count(*) from app.feature_switches switch
     where switch.feature_key in (
       'cbe_birr_authoritative_verification', 'private_live_deposit_pilot',
       'telebirr_authoritative_verification', 'withdrawal_collection',
       'withdrawal_validation')
       and switch.mode = 'disabled' and switch.settings = '{}'::jsonb
  ) <> 5
  ) then raise exception 'The routine financial stop set is incomplete.'; end if;
  if not exists (
    select 1 from app.feature_switches switch
     where switch.feature_key in ('deposit_execution', 'payment_verification')
       and switch.mode = 'live'
  ) then return false; end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'routine_stop'
   where gate.singleton and gate.pilot_mutation_mode is null
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The routine stop context is unavailable.'; end if;
  update app.feature_switches switch set mode = 'disabled'
   where switch.feature_key in ('deposit_execution', 'payment_verification')
     and switch.mode = 'live' and switch.settings = '{}'::jsonb;
  get diagnostics switch_count = row_count;
  if switch_count not between 1 and 2 then
    raise exception 'The routine financial gates did not stop.';
  end if;
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'routine_stop';
  get diagnostics context_count = row_count;
  if context_count <> 1 then raise exception 'The routine stop context did not close.'; end if;
  insert into app.audit_events (
    actor_kind, actor_label, action, resource_type, metadata
  ) values (
    'system', 'production-database-administrator',
    'routine_telebirr.financial_gates_stopped', 'feature_switch',
    pg_catalog.jsonb_build_object('requestKey', p_request_key,
      'reason', p_reason, 'disabledCount', switch_count)
  );
  return true;
end;
$$;

alter function app.serialize_private_owner_kemerbet_readiness_source_mutation() owner to postgres;
alter function app.enforce_routine_telebirr_financial_switch_scope() owner to postgres;
alter function app.activate_routine_telebirr_financial_gates(uuid,uuid) owner to postgres;
alter function app.stop_routine_telebirr_financial_gates(uuid,text) owner to postgres;
revoke all on function
  app.enforce_routine_telebirr_financial_switch_scope(),
  app.activate_routine_telebirr_financial_gates(uuid,uuid),
  app.stop_routine_telebirr_financial_gates(uuid,text)
from public, anon, authenticated, service_role;

comment on function app.activate_routine_telebirr_financial_gates(uuid,uuid) is
  'Postgres-only operator action, never run by migration. Activates only shared verification and execution after exact routine and no-money phone checks; legacy TeleBirr pilot and CBE remain off.';
comment on function app.stop_routine_telebirr_financial_gates(uuid,text) is
  'Postgres-only operator stop of the two shared routine financial gates. Does not erase or reconcile an execution attempt.';
commit;
