-- Dormant, Postgres-only one-use companion execution activation transition.
-- Installation alone does not create an attestation, activate control, grant a login,
-- start an execution container, lease a job, or enable a financial switch.
-- A separate trusted evidence issuer and guarded production operation are required
-- before this function can ever be invoked outside disposable integration tests.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

do $companion_activation_preflight$
begin
  if (
    select pg_catalog.count(*) from app.agent_platform_companion_execution_control control
     where control.singleton and control.control_state = 'disabled'
  ) <> 1 or (
    select pg_catalog.count(*) from pg_catalog.pg_authid role
     where role.rolname in (
       'fetanagent_companion_execution_bridge',
       'fetanagent_companion_execution_bridge_runtime'
     ) and not role.rolcanlogin and role.rolpassword is null
  ) <> 2 or exists (
    select 1 from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member on member.oid = membership.member
     where member.rolname = 'fetanagent_companion_execution_bridge_runtime'
  ) then
    raise exception 'Companion activation migration requires the dormant role and control boundary.';
  end if;
end;
$companion_activation_preflight$;

-- The issuer must have verified the database-bound request, archive and installation
-- tree, and fresh paired-process signature outside PostgreSQL. The row retains only
-- digests and time/identity bindings, never the proof, challenge, or credentials.
create table app.agent_platform_companion_execution_activation_attestations (
  request_key uuid primary key references
    app.agent_platform_companion_execution_activation_requests (request_key)
    on delete restrict,
  certificate_body_digest text not null
    check (certificate_body_digest ~ '^sha256:[0-9a-f]{64}$'),
  companion_release_sha text not null check (companion_release_sha ~ '^[0-9a-f]{40}$'),
  companion_archive_sha256 text not null
    check (companion_archive_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  companion_installation_tree_sha256 text not null
    check (companion_installation_tree_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  challenge_digest text not null unique
    check (challenge_digest ~ '^sha256:[0-9a-f]{64}$'),
  launch_proof_digest text not null unique
    check (launch_proof_digest ~ '^sha256:[0-9a-f]{64}$'),
  process_id integer not null check (process_id > 0),
  process_started_at timestamptz not null,
  challenge_issued_at timestamptz not null,
  release_observed_at timestamptz not null,
  process_observed_at timestamptz not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint companion_execution_activation_attestation_window check (
    process_started_at <= process_observed_at
    and challenge_issued_at <= process_observed_at
    and process_observed_at <= verified_at
    and release_observed_at <= verified_at
    and verified_at <= created_at + interval '30 seconds'
    and verified_at > created_at - interval '2 minutes'
  )
);

create table app.agent_platform_companion_execution_activation_consumptions (
  request_key uuid primary key references
    app.agent_platform_companion_execution_activation_requests (request_key)
    on delete restrict,
  activation_epoch bigint not null unique references
    app.private_trusted_telebirr_activation_epochs (epoch)
    on delete restrict,
  pilot_revision_id uuid not null references
    app.private_live_deposit_pilot_revisions (id)
    on delete restrict,
  certificate_id uuid not null references
    app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  attestation_launch_proof_digest text not null unique
    check (attestation_launch_proof_digest ~ '^sha256:[0-9a-f]{64}$'),
  activated_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  activated_at timestamptz not null,
  valid_until timestamptz not null,
  constraint companion_execution_activation_consumption_window check (
    valid_until > activated_at
    and valid_until <= activated_at + interval '2 hours'
  )
);

create trigger companion_execution_activation_attestations_immutable
before update or delete on app.agent_platform_companion_execution_activation_attestations
for each row execute function app.reject_private_trusted_telebirr_activation_retained_mutation();
create trigger companion_execution_activation_attestations_no_truncate
before truncate on app.agent_platform_companion_execution_activation_attestations
for each statement execute function app.reject_private_trusted_telebirr_activation_truncate();
create trigger companion_execution_activation_consumptions_immutable
before update or delete on app.agent_platform_companion_execution_activation_consumptions
for each row execute function app.reject_private_trusted_telebirr_activation_retained_mutation();
create trigger companion_execution_activation_consumptions_no_truncate
before truncate on app.agent_platform_companion_execution_activation_consumptions
for each statement execute function app.reject_private_trusted_telebirr_activation_truncate();

-- The seven execution wrappers enter the established private lease/fence functions
-- through this helper. Admit only the dedicated, capability-bearing runtime identity;
-- the existing deposit executor and no-money bridge memberships remain unchanged.
create or replace function app.require_private_live_deposit_pilot_executor()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not pg_catalog.pg_has_role(session_user, 'fetanagent_deposit_executor', 'member')
    and not pg_catalog.pg_has_role(
      session_user, 'fetanagent_companion_device_bridge', 'member'
    )
    and not (
      session_user = 'fetanagent_companion_execution_bridge_runtime'
      and pg_catalog.pg_has_role(
        session_user, 'fetanagent_companion_execution_bridge', 'member'
      )
    ) then
    raise exception 'The private live-deposit pilot executor role is required.';
  end if;
end;
$$;

create function app.activate_agent_platform_companion_execution_once(
  p_actor_auth_user_id uuid,
  p_request_key uuid,
  p_runtime_password text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_admin_id uuid;
  request app.agent_platform_companion_execution_activation_requests%rowtype;
  attestation app.agent_platform_companion_execution_activation_attestations%rowtype;
  authority app.private_trusted_telebirr_activation_epochs%rowtype;
  pilot app.private_live_deposit_pilot_revisions%rowtype;
  certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  companion_control app.agent_platform_companion_execution_control%rowtype;
  selected_at timestamptz;
  bounded_until timestamptz;
  switch_count integer;
  role_count integer;
  membership_count integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can activate companion execution.';
  end if;
  if p_actor_auth_user_id is null
    or p_request_key is null
    or p_runtime_password is null
    or p_runtime_password !~ '^[0-9a-f]{64}$' then
    raise exception 'The companion execution activation input is invalid.';
  end if;

  -- The independent emergency stop takes this same transaction-level lock before
  -- changing roles or control. No external operation occurs while rows are locked.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('fetanagent:production:companion-execution-runtime', 0)
  );

  select owner_user.id into actor_admin_id
    from app.admin_users owner_user
   where owner_user.auth_user_id = p_actor_auth_user_id
     and owner_user.role = 'owner'
     and owner_user.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception using errcode = '42501',
      message = 'Only the active Owner can activate companion execution.';
  end if;

  select prepared.* into request
    from app.agent_platform_companion_execution_activation_requests prepared
   where prepared.request_key = p_request_key
   for share;
  select verified.* into attestation
    from app.agent_platform_companion_execution_activation_attestations verified
   where verified.request_key = p_request_key
   for share;
  if request.request_key is null or attestation.request_key is null
    or request.requested_by_admin_id <> actor_admin_id
    or exists (
      select 1 from app.agent_platform_companion_execution_activation_consumptions consumed
       where consumed.request_key = p_request_key
          or consumed.activation_epoch = request.activation_epoch
    ) then
    raise exception 'The one-use companion execution request is unavailable.';
  end if;

  -- Follow the financial order: authority control, epoch, sorted switches,
  -- pilot, certificate, then companion execution control.
  perform current_control.control_key
    from app.private_trusted_telebirr_activation_control current_control
   where current_control.control_key = 'trusted_telebirr_financial_authority'
     and current_control.current_epoch = request.activation_epoch
   for share;
  if not found then
    raise exception 'The trusted TeleBirr activation authority changed.';
  end if;
  select current_epoch.* into authority
    from app.private_trusted_telebirr_activation_epochs current_epoch
   where current_epoch.epoch = request.activation_epoch
   for share;
  perform feature_switch.feature_key
    from app.feature_switches feature_switch
   where feature_switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   )
   order by feature_switch.feature_key
   for share;
  get diagnostics switch_count = row_count;
  select revision.* into pilot
    from app.private_live_deposit_pilot_revisions revision
   where revision.id = request.pilot_revision_id
   for share;
  select enrollment.* into certificate
    from app.agent_platform_companion_enrollment_certificates enrollment
   where enrollment.certificate_id = request.certificate_id
   for share;
  select execution_control.* into companion_control
    from app.agent_platform_companion_execution_control execution_control
   where execution_control.singleton
   for update;

  -- Evaluate time only after all potentially blocking locks have been acquired.
  selected_at := pg_catalog.clock_timestamp();
  bounded_until := least(
    selected_at + interval '2 hours', authority.expires_at,
    pilot.expires_at, certificate.valid_until
  );
  if companion_control.singleton is null
    or companion_control.control_state <> 'disabled'
    or authority.epoch is null
    or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or authority.pilot_revision_id <> request.pilot_revision_id
    or authority.configuration_digest is distinct from pilot.configuration_digest
    or request.activation_epoch <= 0
    or request.expires_at <= selected_at + interval '30 seconds'
    or request.requested_at > attestation.challenge_issued_at
    or request.requested_at > attestation.release_observed_at
    or attestation.verified_at < request.requested_at
    or attestation.verified_at > attestation.created_at + interval '30 seconds'
    or attestation.created_at > selected_at
    or attestation.verified_at > selected_at
    or attestation.verified_at <= selected_at - interval '2 minutes'
    or attestation.challenge_issued_at <= selected_at - interval '2 minutes'
    or attestation.release_observed_at <= selected_at - interval '2 minutes'
    or attestation.process_observed_at <= selected_at - interval '2 minutes'
    or attestation.process_observed_at < attestation.challenge_issued_at
    or attestation.process_observed_at < attestation.process_started_at
    or attestation.process_observed_at - attestation.process_started_at > interval '12 hours'
    or attestation.certificate_body_digest <> certificate.certificate_body_digest
    or attestation.companion_release_sha <> request.companion_release_sha
    or attestation.companion_archive_sha256 <> request.companion_archive_sha256
    or attestation.companion_installation_tree_sha256 <>
       request.companion_installation_tree_sha256
    or request.execution_signer_key_id <> 'companion-execution-production-v1'
    or request.execution_signer_public_key_spki_sha256 <>
       'sha256:c7028976e436f39a10634631a9e0e610b2b054d78cc7c89f115d6260371d21e2'
    or pilot.id is null
    or pilot.status <> 'armed'
    or pilot.armed_by_admin_id <> actor_admin_id
    or pilot.platform_agent_account_id <> request.platform_agent_account_id
    or pilot.configuration_digest !~ '^sha256:[0-9a-f]{64}$'
    or pilot.active_from > selected_at
    or certificate.certificate_id is null
    or not app.agent_platform_companion_execution_certificate_is_active(
      certificate.certificate_id, certificate.device_id,
      certificate.device_key_id, certificate.certificate_signer_key_id,
      selected_at
    )
    or not exists (
      select 1 from app.agent_platform_companion_pairing_challenges pairing
       where pairing.pairing_id = certificate.pairing_id
         and pairing.state = 'completed'
         and pairing.created_by_admin_id = actor_admin_id
    )
    or switch_count <> 7
    or app.current_private_trusted_telebirr_activation_epoch()
       is distinct from request.activation_epoch
    or (
      select pg_catalog.count(*) from app.feature_switches feature_switch
       where feature_switch.feature_key in (
         'withdrawal_collection', 'withdrawal_validation'
       ) and feature_switch.mode = 'disabled'
         and feature_switch.settings = '{}'::jsonb
    ) <> 2
    or not exists (
      select 1 from app.platform_agent_accounts account
      join app.platforms platform on platform.id = account.platform_id
       where account.id = request.platform_agent_account_id
         and account.status = 'active' and platform.status = 'active'
         and platform.code = 'kemerbet'
    )
    or bounded_until <= selected_at + interval '5 minutes' then
    raise exception 'The companion execution activation lineage is not current.';
  end if;

  if exists (
    select 1 from app.deposit_jobs job
     where job.job_kind in ('execute_deposit', 'reconcile_execution')
       and job.status in ('queued', 'leased', 'retry_wait')
  ) or exists (
    select 1 from app.deposit_execution_attempts attempt
     where attempt.status in (
       'prepared', 'final_action_fenced', 'reconciliation_required', 'review_required'
     )
  ) or exists (
    select 1 from app.agent_platform_companion_execution_assignments assignment
     where assignment.state in (
       'claimed', 'signed', 'authority_claimed', 'authority_signed'
     )
  ) then
    raise exception 'An execution or reconciliation boundary is already open.';
  end if;

  select pg_catalog.count(*)::integer into role_count
    from pg_catalog.pg_authid role
   where (
     role.rolname = 'fetanagent_companion_execution_bridge_runtime'
     and not role.rolcanlogin and not role.rolinherit
     and not role.rolsuper and not role.rolcreatedb and not role.rolcreaterole
     and not role.rolreplication and not role.rolbypassrls
     and role.rolconnlimit = 1 and role.rolpassword is null
     and role.rolvaliduntil = 'infinity'::timestamptz
   ) or (
     role.rolname = 'fetanagent_companion_execution_bridge'
     and not role.rolcanlogin and not role.rolinherit
     and not role.rolsuper and not role.rolcreatedb and not role.rolcreaterole
     and not role.rolreplication and not role.rolbypassrls
     and role.rolconnlimit = 1 and role.rolpassword is null
     and role.rolvaliduntil = 'infinity'::timestamptz
   );
  select pg_catalog.count(*)::integer into membership_count
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles member on member.oid = membership.member
   where member.rolname = 'fetanagent_companion_execution_bridge_runtime';
  if role_count <> 2 or membership_count <> 0
    or exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
       where granted.rolname = 'fetanagent_companion_execution_bridge'
         and member.rolname <> 'postgres'
    )
    or exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member on member.oid = membership.member
       where member.rolname = 'fetanagent_companion_execution_bridge'
    )
    or exists (
      select 1 from pg_catalog.pg_stat_activity activity
       where activity.usename in (
         'fetanagent_companion_execution_bridge_runtime',
         'fetanagent_companion_execution_bridge'
       ) and activity.pid <> pg_catalog.pg_backend_pid()
    ) then
    raise exception 'The companion execution credential boundary is not dormant.';
  end if;

  insert into app.agent_platform_companion_execution_activation_consumptions (
    request_key, activation_epoch, pilot_revision_id, certificate_id,
    attestation_launch_proof_digest, activated_by_admin_id,
    activated_at, valid_until
  ) values (
    request.request_key, request.activation_epoch, pilot.id,
    certificate.certificate_id, attestation.launch_proof_digest,
    actor_admin_id, selected_at, bounded_until
  );

  perform pg_catalog.set_config('password_encryption', 'scram-sha-256', true);
  execute 'grant fetanagent_companion_execution_bridge '
    || 'to fetanagent_companion_execution_bridge_runtime '
    || 'with inherit true, set false, admin false';
  execute pg_catalog.format(
    'alter role fetanagent_companion_execution_bridge_runtime with '
    || 'login noinherit nocreatedb nocreaterole noreplication nobypassrls '
    || 'connection limit 1 password %L valid until %L',
    p_runtime_password, bounded_until
  );

  update app.agent_platform_companion_execution_control execution_control
     set control_state = 'active',
         certificate_id = certificate.certificate_id,
         device_id = certificate.device_id,
         device_key_id = certificate.device_key_id,
         no_money_signer_key_id = certificate.certificate_signer_key_id,
         execution_signer_key_id = request.execution_signer_key_id,
         execution_signer_public_key_spki =
           'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7NAIqUp1BqgN1d5qzvSGT_WbZ1Z_LmUSAvI_eUs_OzIeaVtLMKfEzCjg9iqiLy_RQiU-4-WaY8XMtHbEkd6z0g',
         execution_signer_public_key_spki_sha256 =
           request.execution_signer_public_key_spki_sha256,
         platform_agent_account_id = request.platform_agent_account_id,
         pilot_revision_id = pilot.id,
         pilot_revision = pilot.revision,
         pilot_configuration_digest = pilot.configuration_digest,
         activation_epoch = request.activation_epoch,
         active_from = selected_at,
         expires_at = bounded_until,
         activated_by_admin_id = actor_admin_id,
         activated_at = selected_at,
         updated_at = selected_at
   where execution_control.singleton
     and execution_control.control_state = 'disabled';
  if not found then
    raise exception 'The companion execution control changed before activation.';
  end if;

  if not exists (
    select 1 from app.agent_platform_companion_execution_control execution_control
     where execution_control.singleton
       and execution_control.control_state = 'active'
       and execution_control.activation_epoch = request.activation_epoch
       and execution_control.pilot_revision_id = pilot.id
       and execution_control.certificate_id = certificate.certificate_id
       and execution_control.expires_at = bounded_until
  ) or not exists (
    select 1 from pg_catalog.pg_authid role
     where role.rolname = 'fetanagent_companion_execution_bridge_runtime'
       and role.rolcanlogin and not role.rolinherit
       and not role.rolsuper and not role.rolcreatedb and not role.rolcreaterole
       and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not distinct from bounded_until
       and role.rolpassword like 'SCRAM-SHA-256$%'
  ) or not exists (
    select 1 from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted on granted.oid = membership.roleid
    join pg_catalog.pg_roles member on member.oid = membership.member
     where granted.rolname = 'fetanagent_companion_execution_bridge'
       and member.rolname = 'fetanagent_companion_execution_bridge_runtime'
       and membership.inherit_option
       and not membership.set_option
       and not membership.admin_option
  ) then
    raise exception 'The bounded companion execution activation did not commit exactly.';
  end if;

  return bounded_until;
end;
$$;

alter table app.agent_platform_companion_execution_activation_attestations
  enable row level security;
alter table app.agent_platform_companion_execution_activation_attestations
  force row level security;
alter table app.agent_platform_companion_execution_activation_consumptions
  enable row level security;
alter table app.agent_platform_companion_execution_activation_consumptions
  force row level security;
alter table app.agent_platform_companion_execution_activation_attestations owner to postgres;
alter table app.agent_platform_companion_execution_activation_consumptions owner to postgres;
alter function app.activate_agent_platform_companion_execution_once(uuid, uuid, text)
  owner to postgres;
alter function app.require_private_live_deposit_pilot_executor() owner to postgres;

revoke all on table
  app.agent_platform_companion_execution_activation_attestations,
  app.agent_platform_companion_execution_activation_consumptions
from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke all on function app.activate_agent_platform_companion_execution_once(uuid, uuid, text)
from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_companion_execution_bridge_runtime,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on function app.activate_agent_platform_companion_execution_once(uuid, uuid, text) is
  'Postgres-only atomic one-use request consumption, bounded execution control, and SCRAM runtime login. No production caller or evidence issuer is provided by this migration.';
comment on table app.agent_platform_companion_execution_activation_attestations is
  'Append-only digest witness for externally verified release and paired-process evidence. No application insert grant and no production issuer exists.';
comment on table app.agent_platform_companion_execution_activation_consumptions is
  'Append-only one-use activation history. One request and one trusted epoch can be consumed only once.';

commit;
