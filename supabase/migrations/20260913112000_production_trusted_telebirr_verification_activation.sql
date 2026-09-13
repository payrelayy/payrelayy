-- Separately reviewed production activation boundary for the trusted TeleBirr verifier.
--
-- This migration adds the database half of activation only. It does not invoke the routine,
-- provision a credential, arm a pilot, enable a switch, start a container, or move money. The
-- activation routine is owned by postgres and intentionally granted to no application role. A
-- production operator must supply one exact, already armed companion-verified pilot and a fresh
-- one-use runtime credential through the protected production workflow. Login provisioning, the
-- activation epoch, the singleton pointer, and the complete switch transition then commit (or
-- roll back) together.

begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

-- Installation is intentionally allowed only from the inert epoch-zero baseline. This prevents a
-- release migration from silently acquiring or rewriting authority that was already active.
lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;
lock table app.private_live_deposit_pilot_revisions in share row exclusive mode;

do $trusted_telebirr_activation_writer_preflight$
declare
  safe_switch_count integer;
begin
  if not exists (
    select 1
      from app.private_trusted_telebirr_activation_control activation_control
      join app.private_trusted_telebirr_activation_epochs activation_epoch
        on activation_epoch.epoch = activation_control.current_epoch
     where activation_control.control_key = 'trusted_telebirr_financial_authority'
       and activation_control.current_epoch = 0
       and activation_epoch.authority_state = 'disabled'
       and activation_epoch.revoked_at is null
  ) then
    raise exception
      'Trusted TeleBirr activation installation requires the inert epoch-zero authority.';
  end if;

  select pg_catalog.count(*)::integer
    into safe_switch_count
    from app.feature_switches feature_switch
   where (
     feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     )
     and feature_switch.mode = 'disabled'
     and feature_switch.settings = '{}'::jsonb
   ) or (
     feature_switch.feature_key = 'private_live_deposit_pilot'
     and (
       (
         feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb
       )
       or (
         feature_switch.mode = 'dry_run'
         and exists (
           select 1
             from app.private_live_deposit_pilot_revisions pilot
            where pilot.status = 'armed'
              and feature_switch.settings = pg_catalog.jsonb_build_object(
                'contract_version', 1,
                'pilot_revision_id', pilot.id,
                'configuration_digest', pilot.configuration_digest
              )
         )
       )
     )
   );

  if safe_switch_count <> 7 then
    raise exception
      'Trusted TeleBirr activation installation requires an inert or exact dry-run boundary.';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_roles role
     where role.rolname in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime',
       'fetanagent_deposit_executor',
       'fetanagent_deposit_executor_runtime'
     )
       and role.rolcanlogin
  ) or exists (
    select 1
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime',
       'fetanagent_deposit_executor',
       'fetanagent_deposit_executor_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception
      'Trusted TeleBirr activation installation requires verifier and executor logins disabled.';
  end if;
end;
$trusted_telebirr_activation_writer_preflight$;

create table app.private_trusted_telebirr_activation_requests (
  request_key uuid primary key,
  activation_epoch bigint not null unique
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  pilot_revision_id uuid not null unique
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  configuration_digest text not null
    check (configuration_digest ~ '^sha256:[0-9a-f]{64}$'),
  companion_assignment_id uuid not null
    references app.agent_platform_companion_lookup_assignments (assignment_id)
    on delete restrict,
  receiver_profile_id uuid not null
    references app.private_live_telebirr_receiver_profiles (id) on delete restrict,
  requested_by_admin_id uuid not null
    references app.admin_users (id) on delete restrict,
  verifier_credential_digest text not null
    check (verifier_credential_digest ~ '^sha256:[0-9a-f]{64}$'),
  verifier_valid_until timestamptz not null,
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint private_trusted_telebirr_activation_request_key_v4 check (
    request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

create trigger private_trusted_telebirr_activation_requests_immutable
before update or delete on app.private_trusted_telebirr_activation_requests
for each row
execute function app.reject_private_trusted_telebirr_activation_retained_mutation();

create trigger private_trusted_telebirr_activation_requests_no_truncate
before truncate on app.private_trusted_telebirr_activation_requests
for each statement
execute function app.reject_private_trusted_telebirr_activation_truncate();

create function app.disable_private_trusted_telebirr_verifier_login()
returns table (
  verifier_login text,
  terminated_session_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_pid integer;
  terminated_count integer := 0;
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'Only the production database administrator can disable the verifier login.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:production:trusted-telebirr-verifier-runtime',
      0
    )
  );

  execute 'alter role fetanagent_trusted_telebirr_verifier with '
    || 'nologin noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 2 password null valid until ''infinity''';
  execute 'alter role fetanagent_trusted_telebirr_verifier_runtime with '
    || 'nologin noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password null valid until ''infinity''';

  for activity_pid in
    select activity.pid
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  loop
    if not pg_catalog.pg_terminate_backend(activity_pid, 5000) then
      raise exception 'A production verifier session could not be terminated safely.';
    end if;
    terminated_count := terminated_count + 1;
  end loop;

  perform pg_catalog.pg_stat_clear_snapshot();
  if exists (
    select 1
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) or (
    select pg_catalog.count(*)
      from pg_catalog.pg_authid role
     where role.rolname in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and not role.rolcanlogin
       and role.rolpassword is null
  ) <> 2 then
    raise exception 'The production verifier role disablement is incomplete.';
  end if;

  return query select 'disabled'::text, terminated_count;
end;
$$;

create function app.activate_private_trusted_telebirr_verification(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid,
  p_request_key uuid,
  p_verifier_password text
)
returns table (
  activation_epoch bigint,
  verifier_valid_until timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_admin_id uuid;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  existing_request app.private_trusted_telebirr_activation_requests%rowtype;
  companion_assignment_id uuid;
  receiver_profile_id uuid;
  credential_digest text;
  activated_at timestamptz;
  next_epoch bigint;
  switch_count integer;
  context_count integer;
  role_count integer;
  membership_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'Only the production database administrator can activate trusted TeleBirr verification.';
  end if;

  perform app.require_private_live_deposit_pilot_owner_controller();

  if p_actor_auth_user_id is null
    or p_pilot_revision_id is null
    or p_request_key is null
    or p_request_key::text
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_verifier_password is null
    or p_verifier_password !~ '^[0-9a-f]{64}$' then
    raise exception 'The trusted TeleBirr activation request is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where (
       admin_user.auth_user_id = p_actor_auth_user_id
       or admin_user.id = p_actor_auth_user_id
     )
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null then
    raise exception using
      errcode = '42501',
      message = 'Only the active Owner can authorize trusted TeleBirr verification.';
  end if;

  credential_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:trusted-telebirr-verifier-credential:v1:' || p_verifier_password
  );

  -- Resolve an already committed request before consulting moving authority. An exact retry is a
  -- read-only replay; it never recreates a login or resurrects an expired/revoked epoch.
  select activation_request.*
    into existing_request
    from app.private_trusted_telebirr_activation_requests activation_request
   where activation_request.request_key = p_request_key
      or activation_request.pilot_revision_id = p_pilot_revision_id
   for share;

  if existing_request.request_key is not null then
    if existing_request.request_key = p_request_key
      and existing_request.pilot_revision_id = p_pilot_revision_id
      and existing_request.requested_by_admin_id = actor_admin_id
      and existing_request.verifier_credential_digest = credential_digest then
      return query
      select existing_request.activation_epoch,
             existing_request.verifier_valid_until,
             true;
      return;
    end if;
    raise exception 'The trusted TeleBirr activation replay conflicts.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:production:trusted-telebirr-verifier-runtime',
      0
    )
  );

  select activation_epoch.*
    into authority
    from app.private_trusted_telebirr_activation_control activation_control
    join app.private_trusted_telebirr_activation_epochs activation_epoch
      on activation_epoch.epoch = activation_control.current_epoch
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
   for update of activation_control, activation_epoch;

  if authority.epoch is null then
    raise exception 'Trusted TeleBirr activation authority is unavailable.';
  end if;

  -- Recheck after the authority lock so concurrent identical requests replay and conflicting
  -- requests cannot race through either unique key.
  select activation_request.*
    into existing_request
    from app.private_trusted_telebirr_activation_requests activation_request
   where activation_request.request_key = p_request_key
      or activation_request.pilot_revision_id = p_pilot_revision_id
   for share;

  if existing_request.request_key is not null then
    if existing_request.request_key = p_request_key
      and existing_request.pilot_revision_id = p_pilot_revision_id
      and existing_request.requested_by_admin_id = actor_admin_id
      and existing_request.verifier_credential_digest = credential_digest then
      return query
      select existing_request.activation_epoch,
             existing_request.verifier_valid_until,
             true;
      return;
    end if;
    raise exception 'The trusted TeleBirr activation replay conflicts.';
  end if;

  if authority.epoch > 0 and authority.revoked_at is null then
    raise exception
      'The current trusted TeleBirr epoch must be emergency-disabled before another activation.';
  end if;

  perform gate.singleton
    from app.private_owner_kemerbet_readiness_cohort_gate gate
   where gate.singleton
   for update;
  if not found then
    raise exception 'The companion-verified readiness gate is unavailable.';
  end if;

  perform feature_switch.feature_key
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
   order by feature_switch.feature_key
   for update;
  get diagnostics switch_count = row_count;

  select pilot_revision.*
    into pilot
    from app.private_live_deposit_pilot_revisions pilot_revision
   where pilot_revision.id = p_pilot_revision_id
   for update;

  -- Authority time is evaluated only after every potentially blocking shared boundary is held.
  activated_at := pg_catalog.clock_timestamp();

  if pilot.id is null
    or pilot.status <> 'armed'
    or pilot.created_by_admin_id <> actor_admin_id
    or pilot.armed_by_admin_id <> actor_admin_id
    or pilot.contract_version <> 1
    or pilot.currency_code <> 'ETB'
    or pilot.configuration_digest is null
    or pilot.configuration_digest !~ '^sha256:[0-9a-f]{64}$'
    or pilot.minimum_amount_minor <> 2500
    or pilot.maximum_per_deposit_minor <> 2500
    or pilot.maximum_per_player_minor <> 2500
    or pilot.maximum_aggregate_minor <> 12500
    or pilot.maximum_reservation_count <> 5
    or pilot.expires_at is distinct from pilot.active_from + interval '2 hours'
    or activated_at < pilot.active_from
    or pilot.expires_at <= activated_at + interval '15 minutes' then
    raise exception 'The fixed companion-verified TeleBirr pilot is not activation-ready.';
  end if;

  if switch_count <> 7
    or (
      select pg_catalog.count(*)
        from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'cbe_birr_authoritative_verification',
         'deposit_execution',
         'payment_verification',
         'telebirr_authoritative_verification',
         'withdrawal_collection',
         'withdrawal_validation'
       )
         and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb
    ) <> 6
    or not exists (
      select 1
        from app.feature_switches pilot_switch
       where pilot_switch.feature_key = 'private_live_deposit_pilot'
         and pilot_switch.mode = 'dry_run'
         and pilot_switch.settings = pg_catalog.jsonb_build_object(
           'contract_version', 1,
           'pilot_revision_id', pilot.id,
           'configuration_digest', pilot.configuration_digest
         )
    ) then
    raise exception
      'Trusted TeleBirr activation requires the complete dormant pilot switch boundary.';
  end if;

  if exists (
    select 1
      from app.deposit_jobs job
     where job.job_kind in ('execute_deposit', 'reconcile_execution')
       and job.status in ('queued', 'leased', 'retry_wait')
  ) or exists (
    select 1
      from app.deposit_execution_attempts attempt
     where attempt.status in (
       'prepared',
       'final_action_fenced',
       'reconciliation_required',
       'review_required'
     )
  ) then
    raise exception 'Trusted TeleBirr activation cannot cross blocking execution state.';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_roles role
     where role.rolname in (
       'fetanagent_deposit_executor',
       'fetanagent_deposit_executor_runtime'
     )
       and role.rolcanlogin
  ) or exists (
    select 1
      from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_deposit_executor',
       'fetanagent_deposit_executor_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then
    raise exception 'The deposit executor must remain disabled during verifier activation.';
  end if;

  select pg_catalog.count(*)::integer
    into role_count
    from pg_catalog.pg_authid role
   where (
       role.rolname = 'fetanagent_trusted_telebirr_verifier'
       and not role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 2
       and role.rolpassword is null
     ) or (
       role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and not role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolpassword is null
     );

  select pg_catalog.count(*)::integer
    into membership_count
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role on member_role.oid = membership.member
   where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
     and granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
     and membership.inherit_option
     and not membership.set_option
     and not membership.admin_option;

  if role_count <> 2
    or membership_count <> 1
    or exists (
      select 1
        from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime'
       )
         and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception 'The trusted TeleBirr verifier role boundary is not inert and exact.';
  end if;

  companion_assignment_id := app.require_companion_verified_private_live_telebirr_pilot(
    p_actor_auth_user_id,
    p_pilot_revision_id
  );
  receiver_profile_id := app.ensure_private_live_telebirr_receiver_profile(
    p_pilot_revision_id
  );

  if companion_assignment_id is null or receiver_profile_id is null then
    raise exception 'The trusted TeleBirr activation evidence is incomplete.';
  end if;

  next_epoch := authority.epoch + 1;

  insert into app.private_trusted_telebirr_activation_epochs (
    epoch,
    authority_state,
    pilot_revision_id,
    configuration_digest,
    active_from,
    expires_at,
    activated_by_admin_id,
    activated_at
  ) values (
    next_epoch,
    'active',
    pilot.id,
    pilot.configuration_digest,
    pilot.active_from,
    pilot.expires_at,
    actor_admin_id,
    activated_at
  );

  update app.private_trusted_telebirr_activation_control activation_control
     set current_epoch = next_epoch
   where activation_control.control_key = 'trusted_telebirr_financial_authority'
     and activation_control.current_epoch = authority.epoch;
  if not found then
    raise exception 'Trusted TeleBirr activation authority changed before commit.';
  end if;

  perform pg_catalog.set_config('password_encryption', 'scram-sha-256', true);
  execute pg_catalog.format(
    'alter role fetanagent_trusted_telebirr_verifier_runtime with '
    || 'login noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password %L valid until %L',
    p_verifier_password,
    pilot.expires_at
  );

  if not exists (
    select 1
      from pg_catalog.pg_authid role
     where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and role.rolcanlogin
       and not role.rolinherit
       and not role.rolsuper
       and not role.rolcreatedb
       and not role.rolcreaterole
       and not role.rolreplication
       and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not distinct from pilot.expires_at
       and role.rolpassword like 'SCRAM-SHA-256$%'
  ) then
    raise exception 'The bounded trusted TeleBirr verifier login was not provisioned exactly.';
  end if;

  -- Reuse the already reviewed frozen-cohort arm context for the second, financial half of the
  -- same pilot arm. It permits only the feature-switch UPDATE performed by this transaction.
  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = pg_catalog.pg_backend_pid(),
         pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id(),
         pilot_mutation_mode = 'arm'
   where gate.singleton
     and gate.pilot_mutation_backend_pid is null
     and gate.pilot_mutation_transaction_id is null
     and gate.pilot_mutation_mode is null;
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot activation context is unavailable.';
  end if;

  begin
    update app.feature_switches feature_switch
       set mode = case
             when feature_switch.feature_key in (
               'deposit_execution',
               'payment_verification',
               'private_live_deposit_pilot',
               'telebirr_authoritative_verification'
             ) then 'live'::app.feature_mode
             else 'disabled'::app.feature_mode
           end,
           settings = case
             when feature_switch.feature_key = 'private_live_deposit_pilot'
               then pg_catalog.jsonb_build_object(
                 'contract_version', 1,
                 'pilot_revision_id', pilot.id,
                 'configuration_digest', pilot.configuration_digest
               )
             else '{}'::jsonb
           end,
           updated_by_admin_id = actor_admin_id
     where feature_switch.feature_key in (
       'cbe_birr_authoritative_verification',
       'deposit_execution',
       'payment_verification',
       'private_live_deposit_pilot',
       'telebirr_authoritative_verification',
       'withdrawal_collection',
       'withdrawal_validation'
     );
    get diagnostics switch_count = row_count;
    if switch_count <> 7 then
      raise exception 'The trusted TeleBirr activation switch set is incomplete.';
    end if;
  exception when others then
    update app.private_owner_kemerbet_readiness_cohort_gate gate
       set pilot_mutation_backend_pid = null,
           pilot_mutation_transaction_id = null,
           pilot_mutation_mode = null
     where gate.singleton
       and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
       and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
       and gate.pilot_mutation_mode = 'arm';
    raise;
  end;

  update app.private_owner_kemerbet_readiness_cohort_gate gate
     set pilot_mutation_backend_pid = null,
         pilot_mutation_transaction_id = null,
         pilot_mutation_mode = null
   where gate.singleton
     and gate.pilot_mutation_backend_pid = pg_catalog.pg_backend_pid()
     and gate.pilot_mutation_transaction_id = pg_catalog.pg_current_xact_id()
     and gate.pilot_mutation_mode = 'arm';
  get diagnostics context_count = row_count;
  if context_count <> 1 then
    raise exception 'The companion-verified pilot activation context did not close.';
  end if;

  if app.current_private_trusted_telebirr_activation_epoch() is distinct from next_epoch then
    raise exception 'The trusted TeleBirr activation did not establish exact current authority.';
  end if;

  insert into app.private_trusted_telebirr_activation_requests (
    request_key,
    activation_epoch,
    pilot_revision_id,
    configuration_digest,
    companion_assignment_id,
    receiver_profile_id,
    requested_by_admin_id,
    verifier_credential_digest,
    verifier_valid_until,
    requested_at
  ) values (
    p_request_key,
    next_epoch,
    pilot.id,
    pilot.configuration_digest,
    companion_assignment_id,
    receiver_profile_id,
    actor_admin_id,
    credential_digest,
    pilot.expires_at,
    activated_at
  );

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    'admin',
    actor_admin_id,
    'deposit.trusted_telebirr_verification_activated',
    'private_live_deposit_pilot',
    pilot.id,
    pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'activation_epoch', next_epoch,
      'configuration_digest', pilot.configuration_digest,
      'companion_assignment_id', companion_assignment_id,
      'receiver_profile_id', receiver_profile_id,
      'verifier_valid_until', pilot.expires_at,
      'executor_enabled', false,
      'withdrawals_enabled', false
    )
  );

  return query select next_epoch, pilot.expires_at, false;
end;
$$;

alter table app.private_trusted_telebirr_activation_requests enable row level security;
alter table app.private_trusted_telebirr_activation_requests force row level security;
alter table app.private_trusted_telebirr_activation_requests owner to postgres;

alter function app.disable_private_trusted_telebirr_verifier_login() owner to postgres;
alter function app.activate_private_trusted_telebirr_verification(uuid, uuid, uuid, text)
  owner to postgres;

revoke all privileges on table app.private_trusted_telebirr_activation_requests
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

revoke all on function
  app.disable_private_trusted_telebirr_verifier_login(),
  app.activate_private_trusted_telebirr_verification(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role,
     fetanagent_api, fetanagent_api_runtime,
     fetanagent_worker,
     fetanagent_beta_admission, fetanagent_beta_admission_runtime,
     fetanagent_nonce_retention, fetanagent_nonce_retention_runtime,
     fetanagent_owner_control, fetanagent_owner_control_runtime,
     fetanagent_player_actions, fetanagent_player_actions_runtime,
     fetanagent_cbe_birr_shadow_worker,
     fetanagent_customer_web, fetanagent_customer_web_runtime,
     fetanagent_deposit_executor, fetanagent_deposit_executor_runtime,
     fetanagent_verification_settlement, fetanagent_verification_settlement_runtime,
     fetanagent_trusted_telebirr_verifier, fetanagent_trusted_telebirr_verifier_runtime,
     fetanagent_telebirr_shadow_verifier, fetanagent_telebirr_shadow_verifier_runtime,
     fetanagent_telebirr_assignment_broker, fetanagent_telebirr_assignment_broker_runtime,
     fetanagent_telebirr_device_state, fetanagent_telebirr_device_state_runtime,
     fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

comment on table app.private_trusted_telebirr_activation_requests is
  'Append-only, one-pilot/one-epoch production activation receipt. Stores only a credential digest; never the runtime credential.';
comment on function app.activate_private_trusted_telebirr_verification(
  uuid, uuid, uuid, text
) is
  'Postgres-only, idempotent production boundary. Atomically provisions one pilot-bounded verifier login and establishes the exact epoch-bound TeleBirr verification switch set; it never enables the executor login or withdrawals.';
comment on function app.disable_private_trusted_telebirr_verifier_login() is
  'Postgres-only independent kill switch. Revokes both verifier logins, clears credentials, and terminates verifier sessions without requiring the production VM.';
comment on table app.private_trusted_telebirr_activation_epochs is
  'Database-owned, bounded trusted TeleBirr authority epochs. Epoch zero is permanently disabled; nonzero epochs can be created only by the postgres-only production activation boundary.';

commit;
