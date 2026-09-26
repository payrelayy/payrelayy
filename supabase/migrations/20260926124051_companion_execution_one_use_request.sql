-- Inert, one-use Owner request record for a future paired Windows execution activation.
-- This migration does not arm the companion control, create a runtime login, grant the
-- execution capability, enable a switch, lease a job, or authorize a provider action.
-- A later separately reviewed transition must recheck every binding and consume the
-- request atomically; the presence of a row is never itself financial authority.
begin;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create table app.agent_platform_companion_execution_activation_requests (
  request_key uuid primary key,
  pilot_revision_id uuid not null
    references app.private_live_deposit_pilot_revisions (id) on delete restrict,
  activation_epoch bigint not null
    references app.private_trusted_telebirr_activation_epochs (epoch) on delete restrict,
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  platform_agent_account_id uuid not null
    references app.platform_agent_accounts (id) on delete restrict,
  execution_signer_key_id text not null
    check (execution_signer_key_id = 'companion-execution-production-v1'),
  execution_signer_public_key_spki_sha256 text not null
    check (
      execution_signer_public_key_spki_sha256 =
        'sha256:c7028976e436f39a10634631a9e0e610b2b054d78cc7c89f115d6260371d21e2'
    ),
  -- These digests are Owner/operator claims, not proof that the release was installed.
  -- A future transition must independently attest both the archive and the running image.
  companion_release_sha text not null check (companion_release_sha ~ '^[0-9a-f]{40}$'),
  companion_archive_sha256 text not null
    check (companion_archive_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  requested_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  constraint companion_execution_activation_request_key_v4 check (
    request_key::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint companion_execution_activation_request_window check (
    expires_at > requested_at
    and expires_at <= requested_at + interval '10 minutes'
  )
);

create index companion_execution_activation_request_epoch_expiry_idx
  on app.agent_platform_companion_execution_activation_requests
  (activation_epoch, expires_at desc);
create index companion_execution_activation_request_pilot_expiry_idx
  on app.agent_platform_companion_execution_activation_requests
  (pilot_revision_id, expires_at desc);

create trigger companion_execution_activation_requests_immutable
before update or delete on app.agent_platform_companion_execution_activation_requests
for each row
execute function app.reject_private_trusted_telebirr_activation_retained_mutation();

create trigger companion_execution_activation_requests_no_truncate
before truncate on app.agent_platform_companion_execution_activation_requests
for each statement
execute function app.reject_private_trusted_telebirr_activation_truncate();

create function app.prepare_agent_platform_companion_execution_activation_request(
  p_actor_auth_user_id uuid,
  p_pilot_revision_id uuid,
  p_activation_epoch bigint,
  p_certificate_id uuid,
  p_companion_release_sha text,
  p_companion_archive_sha256 text,
  p_request_key uuid
)
returns table (
  valid_until timestamptz,
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
  certificate app.agent_platform_companion_enrollment_certificates%rowtype;
  existing_request app.agent_platform_companion_execution_activation_requests%rowtype;
  requested_time timestamptz;
  request_expiry timestamptz;
  switch_count integer;
begin
  -- A privileged production workflow may prepare a request only on behalf of the exact
  -- active Owner. No application/runtime role receives EXECUTE in this migration.
  if session_user <> 'postgres' then
    raise exception using errcode = '42501',
      message = 'Only the production database administrator can prepare execution activation.';
  end if;

  if p_actor_auth_user_id is null
    or p_pilot_revision_id is null
    or p_activation_epoch is null or p_activation_epoch <= 0
    or p_certificate_id is null
    or p_companion_release_sha is null
    or p_companion_release_sha !~ '^[0-9a-f]{40}$'
    or p_companion_archive_sha256 is null
    or p_companion_archive_sha256 !~ '^sha256:[0-9a-f]{64}$'
    or p_request_key is null
    or p_request_key::text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'The companion execution activation request is invalid.';
  end if;

  select owner_user.id into actor_admin_id
    from app.admin_users owner_user
   where owner_user.auth_user_id = p_actor_auth_user_id
     and owner_user.role = 'owner'
     and owner_user.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception using errcode = '42501',
      message = 'Only the active Owner can authorize companion execution preparation.';
  end if;

  -- An exact replay is read-only, even after authority expires; changed inputs conflict.
  select request.* into existing_request
    from app.agent_platform_companion_execution_activation_requests request
   where request.request_key = p_request_key
   for share;
  if existing_request.request_key is not null then
    if existing_request.request_key = p_request_key
      and existing_request.pilot_revision_id = p_pilot_revision_id
      and existing_request.activation_epoch = p_activation_epoch
      and existing_request.certificate_id = p_certificate_id
      and existing_request.companion_release_sha = p_companion_release_sha
      and existing_request.companion_archive_sha256 = p_companion_archive_sha256
      and existing_request.requested_by_admin_id = actor_admin_id then
      return query select existing_request.expires_at, true;
      return;
    end if;
    raise exception 'The companion execution activation request replay conflicts.';
  end if;
  if exists (
    select 1 from app.agent_platform_companion_execution_activation_requests request
    where (request.pilot_revision_id = p_pilot_revision_id
       or request.activation_epoch = p_activation_epoch)
      and request.expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception 'The companion execution activation request replay conflicts.';
  end if;

  -- Preserve the financial lock order: activation control, epoch, sorted switches,
  -- then pilot. The future consuming transition must take these locks again.
  perform control.control_key
    from app.private_trusted_telebirr_activation_control control
   where control.control_key = 'trusted_telebirr_financial_authority'
     and control.current_epoch = p_activation_epoch
   for share;
  if not found then
    raise exception 'The trusted TeleBirr authority changed before execution preparation.';
  end if;

  select epoch.* into authority
    from app.private_trusted_telebirr_activation_epochs epoch
   where epoch.epoch = p_activation_epoch
   for share;

  perform switch.feature_key
    from app.feature_switches switch
   where switch.feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   )
   order by switch.feature_key
   for share;
  get diagnostics switch_count = row_count;
  if switch_count <> 7 then
    raise exception 'The financial switch boundary is unavailable.';
  end if;

  select revision.* into pilot
    from app.private_live_deposit_pilot_revisions revision
   where revision.id = p_pilot_revision_id
   for share;

  select enrollment.* into certificate
    from app.agent_platform_companion_enrollment_certificates enrollment
   where enrollment.certificate_id = p_certificate_id
   for share;

  -- Serialize against another preparer and require the companion to remain dormant.
  perform control.singleton
    from app.agent_platform_companion_execution_control control
   where control.singleton and control.control_state = 'disabled'
   for update;
  if not found then
    raise exception 'Companion execution is not dormant.';
  end if;

  -- Recheck after serialization; at most one unexpired request may cover this
  -- epoch/pilot. An expired request remains immutable and a separately authorized
  -- new request can be prepared without replacing the twelve-hour pilot.
  if exists (
    select 1 from app.agent_platform_companion_execution_activation_requests request
    where request.request_key = p_request_key
       or ((request.pilot_revision_id = p_pilot_revision_id
         or request.activation_epoch = p_activation_epoch)
         and request.expires_at > pg_catalog.clock_timestamp())
  ) then
    raise exception 'A companion execution activation request already exists.';
  end if;

  requested_time := pg_catalog.clock_timestamp();
  request_expiry := least(
    requested_time + interval '10 minutes',
    authority.expires_at, pilot.expires_at, certificate.valid_until
  );
  if authority.epoch is null or authority.authority_state <> 'active'
    or authority.revoked_at is not null
    or authority.pilot_revision_id <> p_pilot_revision_id
    or authority.configuration_digest is distinct from pilot.configuration_digest
    or pilot.id is null or pilot.status <> 'armed'
    or pilot.platform_agent_account_id is null
    or pilot.armed_by_admin_id <> actor_admin_id
    or requested_time < pilot.active_from
    or requested_time < authority.active_from
    or request_expiry <= requested_time + interval '5 minutes'
    or certificate.certificate_id is null
    or not app.agent_platform_companion_execution_certificate_is_active(
      p_certificate_id, certificate.device_id, certificate.device_key_id,
      certificate.certificate_signer_key_id, requested_time
    )
    or not exists (
      select 1 from app.agent_platform_companion_pairing_challenges pairing
      where pairing.pairing_id = certificate.pairing_id
        and pairing.state = 'completed'
        and pairing.created_by_admin_id = actor_admin_id
    )
    or (
      select pg_catalog.count(*)
      from app.feature_switches switch
      where switch.feature_key in ('withdrawal_collection', 'withdrawal_validation')
        and switch.mode = 'disabled' and switch.settings = '{}'::jsonb
    ) <> 2
    or not exists (
      select 1 from app.platform_agent_accounts account
      join app.platforms platform on platform.id = account.platform_id
      where account.id = pilot.platform_agent_account_id
        and account.status = 'active' and platform.status = 'active'
        and platform.code = 'kemerbet'
    )
    or app.current_private_trusted_telebirr_activation_epoch()
      is distinct from p_activation_epoch then
    raise exception 'The companion execution preparation lineage is not current.';
  end if;

  insert into app.agent_platform_companion_execution_activation_requests (
    request_key, pilot_revision_id, activation_epoch, certificate_id,
    platform_agent_account_id, execution_signer_key_id,
    execution_signer_public_key_spki_sha256, companion_release_sha,
    companion_archive_sha256, requested_by_admin_id, requested_at, expires_at
  ) values (
    p_request_key, pilot.id, authority.epoch, certificate.certificate_id,
    pilot.platform_agent_account_id, 'companion-execution-production-v1',
    'sha256:c7028976e436f39a10634631a9e0e610b2b054d78cc7c89f115d6260371d21e2',
    p_companion_release_sha, p_companion_archive_sha256,
    actor_admin_id, requested_time, request_expiry
  );

  return query select request_expiry, false;
end;
$$;

alter table app.agent_platform_companion_execution_activation_requests
  enable row level security;
alter table app.agent_platform_companion_execution_activation_requests
  force row level security;
alter table app.agent_platform_companion_execution_activation_requests
  owner to postgres;
alter function app.prepare_agent_platform_companion_execution_activation_request(
  uuid, uuid, bigint, uuid, text, text, uuid
) owner to postgres;

revoke all on table app.agent_platform_companion_execution_activation_requests
  from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;
revoke all on function app.prepare_agent_platform_companion_execution_activation_request(
  uuid, uuid, bigint, uuid, text, text, uuid
) from public, anon, authenticated, service_role,
  fetanagent_owner_control, fetanagent_owner_control_runtime,
  fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime,
  fetanagent_companion_execution_bridge,
  fetanagent_deposit_executor, fetanagent_deposit_executor_runtime;

comment on table app.agent_platform_companion_execution_activation_requests is
  'Immutable, inert one-use preparation records. No row is an execution grant; an independently reviewed, atomic consuming transition is still required.';

commit;
