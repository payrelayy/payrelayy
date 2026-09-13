-- Keep the clear runtime password outside PostgreSQL and the Management API query text.
--
-- PostgreSQL accepts an already encrypted SCRAM verifier in ALTER ROLE ... PASSWORD and stores
-- it as-is. The production workflow can therefore derive the verifier locally, send only that
-- verifier to this boundary, and retain the clear random password solely in a protected runtime
-- credential file. This migration changes no authority, role login, feature switch, or pilot.

begin;

lock table app.private_trusted_telebirr_activation_control in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_epochs in share row exclusive mode;
lock table app.private_trusted_telebirr_activation_requests in share row exclusive mode;
lock table app.feature_switches in share row exclusive mode;

do $trusted_telebirr_scram_adapter_preflight$
declare
  safe_switch_count integer;
begin
  if exists (
    select 1
      from app.private_trusted_telebirr_activation_requests
  ) or not exists (
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
      'The SCRAM activation adapter can be installed only before the first production activation.';
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
     and feature_switch.mode in ('disabled', 'dry_run')
   );

  if safe_switch_count <> 7
    or exists (
      select 1
        from pg_catalog.pg_roles role
       where role.rolname in (
         'fetanagent_trusted_telebirr_verifier',
         'fetanagent_trusted_telebirr_verifier_runtime',
         'fetanagent_deposit_executor',
         'fetanagent_deposit_executor_runtime'
       )
         and role.rolcanlogin
    )
    or exists (
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
      'The SCRAM activation adapter requires the complete inert production boundary.';
  end if;
end;
$trusted_telebirr_scram_adapter_preflight$;

alter function app.activate_private_trusted_telebirr_verification(
  uuid,
  uuid,
  uuid,
  text
) rename to activate_private_trusted_telebirr_verification_v1_surrogate;

create function app.activate_private_trusted_telebirr_verification(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid,
  p_request_key uuid,
  p_verifier_scram_secret text
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
  existing_request app.private_trusted_telebirr_activation_requests%rowtype;
  legacy_surrogate text;
  credential_digest text;
  legacy_activation_epoch bigint;
  legacy_valid_until timestamptz;
  legacy_replayed boolean;
  matching_request_count integer;
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
    or p_verifier_scram_secret is null
    or p_verifier_scram_secret
       !~ '^SCRAM-SHA-256[$]4096:[A-Za-z0-9+/]{22}==[$][A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$' then
    raise exception 'The trusted TeleBirr activation request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'fetanagent:production:trusted-telebirr-verifier-runtime',
      0
    )
  );

  -- Freeze the identity namespace while the compatibility boundary resolves the exact Owner.
  -- This also removes the cross-column UUID collision ambiguity from the original implementation.
  lock table app.admin_users in share mode;

  select admin_user.id
    into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;

  if actor_admin_id is null then
    select admin_user.id
      into actor_admin_id
      from app.admin_users admin_user
     where admin_user.id = p_actor_auth_user_id
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
     for share;
  end if;

  if actor_admin_id is null or (
    select pg_catalog.count(*)
      from app.admin_users admin_user
     where (
       admin_user.auth_user_id = p_actor_auth_user_id
       or admin_user.id = p_actor_auth_user_id
     )
       and admin_user.role = 'owner'
       and admin_user.status = 'active'
  ) <> 1 then
    raise exception using
      errcode = '42501',
      message = 'Only one exact active Owner can authorize trusted TeleBirr verification.';
  end if;

  -- The surrogate is not a usable production credential. It exists only inside this transaction
  -- so the already reviewed v1 boundary can retain all of its lock ordering and switch invariants.
  legacy_surrogate := pg_catalog.substr(
    app.private_live_deposit_pilot_sha256(
      'fetanagent:trusted-telebirr-verifier-scram-surrogate:v2:'
      || p_verifier_scram_secret
    ),
    8
  );
  credential_digest := app.private_live_deposit_pilot_sha256(
    'fetanagent:trusted-telebirr-verifier-credential:v1:' || legacy_surrogate
  );

  select pg_catalog.count(*)::integer
    into matching_request_count
    from app.private_trusted_telebirr_activation_requests activation_request
   where activation_request.request_key = p_request_key
      or activation_request.pilot_revision_id = p_pilot_revision_id;

  if matching_request_count > 1 then
    raise exception 'The trusted TeleBirr activation replay conflicts.';
  end if;

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

  -- Require the complete direct membership graph, not merely the expected runtime-to-group edge.
  if (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
  ) <> 1
  or not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where member_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
       and membership.inherit_option
       and not membership.set_option
       and not membership.admin_option
  )
  or (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
  ) <> 2
  or not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier'
       and member_role.rolname = 'postgres'
       and not membership.inherit_option
       and not membership.set_option
       and membership.admin_option
  )
  or (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where member_role.rolname = 'fetanagent_trusted_telebirr_verifier'
  ) <> 0
  or (
    select pg_catalog.count(*)
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
  ) <> 1
  or not exists (
    select 1
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
     where granted_role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and member_role.rolname = 'postgres'
       and not membership.inherit_option
       and not membership.set_option
       and membership.admin_option
  ) then
    raise exception 'The trusted TeleBirr verifier role membership graph is not exact.';
  end if;

  select activation_result.activation_epoch,
         activation_result.verifier_valid_until,
         activation_result.replayed
    into legacy_activation_epoch,
         legacy_valid_until,
         legacy_replayed
    from app.activate_private_trusted_telebirr_verification_v1_surrogate(
      p_actor_auth_user_id,
      p_pilot_revision_id,
      p_request_key,
      legacy_surrogate
    ) activation_result;

  if legacy_activation_epoch is null
    or legacy_valid_until is null
    or legacy_replayed then
    raise exception 'The trusted TeleBirr activation adapter did not create fresh authority.';
  end if;

  execute pg_catalog.format(
    'alter role fetanagent_trusted_telebirr_verifier_runtime with '
    || 'login noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password %L valid until %L',
    p_verifier_scram_secret,
    legacy_valid_until
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
       and role.rolvaliduntil is not distinct from legacy_valid_until
       and role.rolpassword is not distinct from p_verifier_scram_secret
  ) then
    raise exception 'The bounded trusted TeleBirr SCRAM login was not provisioned exactly.';
  end if;

  return query select legacy_activation_epoch, legacy_valid_until, false;
end;
$$;

alter function app.activate_private_trusted_telebirr_verification_v1_surrogate(
  uuid,
  uuid,
  uuid,
  text
) owner to postgres;
alter function app.activate_private_trusted_telebirr_verification(
  uuid,
  uuid,
  uuid,
  text
) owner to postgres;

revoke all on function
  app.activate_private_trusted_telebirr_verification_v1_surrogate(uuid, uuid, uuid, text),
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

comment on function app.activate_private_trusted_telebirr_verification_v1_surrogate(
  uuid, uuid, uuid, text
) is
  'Internal compatibility boundary. Production automation must call only the SCRAM-verifier adapter; its 64-hex input is a one-way surrogate and never the runtime password.';
comment on function app.activate_private_trusted_telebirr_verification(
  uuid, uuid, uuid, text
) is
  'Postgres-only, idempotent production boundary. Accepts only a precomputed 4096-iteration SCRAM-SHA-256 verifier, never the clear runtime password, then atomically establishes one pilot-bounded verification epoch without enabling the executor or withdrawals.';
comment on table app.private_trusted_telebirr_activation_requests is
  'Append-only, one-pilot/one-epoch production activation receipt. Stores only a one-way digest derived from the verifier; never the SCRAM verifier or clear runtime password.';

commit;
