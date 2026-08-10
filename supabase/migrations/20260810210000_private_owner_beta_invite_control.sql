-- PayReplayy Stage 16: disabled Owner-only Telegram beta invite control boundary.
--
-- This migration adds no credential, HTTP route, browser grant, scheduler, Telegram polling,
-- payment flow, or KemerBet action. The dedicated NOLOGIN role pair can only issue or revoke a
-- digest-only beta invite after a trusted server has verified the Supabase Auth subject. Raw
-- invite tokens never enter PostgreSQL and are returned only once by the future Owner service.

begin;

create role payreplayy_owner_control
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

create role payreplayy_owner_control_runtime
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1;

grant payreplayy_owner_control to payreplayy_owner_control_runtime
  with inherit true, set false, admin false;

-- No invite could be issued through a reviewed runtime before this migration. Fail closed if a
-- privileged manual write bypassed that boundary instead of inventing missing actor attribution.
do $$
begin
  if exists (
    select 1
    from app.telegram_beta_invites
    where issued_by_admin_id is null
  ) then
    raise exception 'Cannot enable Owner invite control while an unattributed beta invite exists.';
  end if;
end;
$$;

alter table app.telegram_beta_invites
  add column invite_id uuid not null default gen_random_uuid(),
  add column revoked_by_admin_id uuid references app.admin_users (id) on delete restrict,
  add column revocation_reason_code text;

alter table app.telegram_beta_invites
  alter column issued_by_admin_id set not null,
  add constraint telegram_beta_invites_invite_id_key unique (invite_id),
  add constraint telegram_beta_invites_revocation_actor_shape_check check (
    (
      status in ('active', 'redeemed')
      and revoked_by_admin_id is null
      and revocation_reason_code is null
    )
    or (
      status = 'revoked'
      and revoked_by_admin_id is not null
      and revocation_reason_code in ('owner_cancelled', 'security_rotation', 'staging_reset')
    )
  );

create function app.enforce_telegram_beta_invite_control_metadata()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, app, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.invite_id is distinct from old.invite_id then
    raise exception 'The Telegram beta invite identifier is immutable.';
  end if;

  return new;
end;
$$;

create trigger telegram_beta_invites_enforce_control_metadata
before insert or update on app.telegram_beta_invites
for each row
execute function app.enforce_telegram_beta_invite_control_metadata();

create function app.issue_telegram_beta_invite(
  p_actor_auth_user_id uuid,
  p_token_digest text,
  p_expires_at timestamptz
)
returns table (
  issued_invite_id uuid,
  issued_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
  issued_at timestamptz := clock_timestamp();
begin
  if p_actor_auth_user_id is null then
    raise exception 'The authenticated Owner subject is required.';
  end if;

  select admin_user.id
    into actor_admin_id
  from app.admin_users admin_user
  where admin_user.auth_user_id = p_actor_auth_user_id
    and admin_user.role = 'owner'
    and admin_user.status = 'active'
  for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can issue a Telegram beta invite.';
  end if;

  if p_token_digest is null
    or p_token_digest <> lower(btrim(p_token_digest))
    or p_token_digest !~ '^sha256-v1:[0-9a-f]{64}$' then
    raise exception 'The Telegram beta invite digest is invalid.';
  end if;

  if p_expires_at is null
    or not isfinite(p_expires_at)
    or p_expires_at < issued_at + interval '5 minutes'
    or p_expires_at > issued_at + interval '7 days' then
    raise exception 'A Telegram beta invite must expire between five minutes and seven days from issuance.';
  end if;

  insert into app.telegram_beta_invites as beta_invite (
    token_digest,
    expires_at,
    issued_by_admin_id,
    created_at
  )
  values (
    p_token_digest,
    p_expires_at,
    actor_admin_id,
    issued_at
  )
  returning beta_invite.invite_id, beta_invite.expires_at
    into issued_invite_id, issued_expires_at;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'admin',
    actor_admin_id,
    'telegram.beta_invite_issued',
    'telegram_beta_invite',
    issued_invite_id,
    jsonb_build_object('expires_at', issued_expires_at)
  );

  return next;
end;
$$;

create function app.revoke_telegram_beta_invite(
  p_actor_auth_user_id uuid,
  p_invite_id uuid,
  p_reason_code text
)
returns table (
  revoked_invite_id uuid,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app, pg_temp
as $$
declare
  actor_admin_id uuid;
  current_status text;
  current_revoked_at timestamptz;
  normalized_reason_code text := lower(btrim(p_reason_code));
begin
  if p_actor_auth_user_id is null or p_invite_id is null then
    raise exception 'The authenticated Owner subject and invite identifier are required.';
  end if;

  if normalized_reason_code is null
    or normalized_reason_code not in ('owner_cancelled', 'security_rotation', 'staging_reset') then
    raise exception 'The Telegram beta invite revocation reason is invalid.';
  end if;

  select admin_user.id
    into actor_admin_id
  from app.admin_users admin_user
  where admin_user.auth_user_id = p_actor_auth_user_id
    and admin_user.role = 'owner'
    and admin_user.status = 'active'
  for share;

  if actor_admin_id is null then
    raise exception 'Only an active Owner can revoke a Telegram beta invite.';
  end if;

  select beta_invite.status, beta_invite.revoked_at
    into current_status, current_revoked_at
  from app.telegram_beta_invites beta_invite
  where beta_invite.invite_id = p_invite_id
  for update;

  if current_status is null or current_status = 'redeemed' then
    raise exception 'The Telegram beta invite cannot be revoked.';
  end if;

  if current_status = 'revoked' then
    revoked_invite_id := p_invite_id;
    revoked_at := current_revoked_at;
    return next;
    return;
  end if;

  update app.telegram_beta_invites as beta_invite
  set status = 'revoked',
      revoked_by_admin_id = actor_admin_id,
      revocation_reason_code = normalized_reason_code,
      revoked_at = clock_timestamp()
  where beta_invite.invite_id = p_invite_id
    and beta_invite.status = 'active'
  returning beta_invite.invite_id, beta_invite.revoked_at
    into revoked_invite_id, revoked_at;

  if revoked_invite_id is null then
    raise exception 'The Telegram beta invite cannot be revoked.';
  end if;

  insert into app.audit_events (
    actor_kind,
    actor_admin_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    'admin',
    actor_admin_id,
    'telegram.beta_invite_revoked',
    'telegram_beta_invite',
    revoked_invite_id,
    jsonb_build_object('reason_code', normalized_reason_code)
  );

  return next;
end;
$$;

revoke all privileges on schema app
  from payreplayy_owner_control, payreplayy_owner_control_runtime;
revoke all privileges on all tables in schema app
  from payreplayy_owner_control, payreplayy_owner_control_runtime;
revoke all privileges on all sequences in schema app
  from payreplayy_owner_control, payreplayy_owner_control_runtime;
revoke all privileges on all functions in schema app
  from payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all privileges on table app.telegram_beta_invites
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.enforce_telegram_beta_invite_control_metadata()
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.issue_telegram_beta_invite(uuid, text, timestamptz)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

revoke all on function app.revoke_telegram_beta_invite(uuid, uuid, text)
  from public, anon, authenticated, service_role,
       payreplayy_api, payreplayy_api_runtime, payreplayy_worker,
       payreplayy_nonce_retention, payreplayy_nonce_retention_runtime,
       payreplayy_beta_admission, payreplayy_beta_admission_runtime,
       payreplayy_owner_control, payreplayy_owner_control_runtime;

grant usage on schema app to payreplayy_owner_control;
grant execute on function app.issue_telegram_beta_invite(uuid, text, timestamptz)
  to payreplayy_owner_control;
grant execute on function app.revoke_telegram_beta_invite(uuid, uuid, text)
  to payreplayy_owner_control;

comment on role payreplayy_owner_control is
  'PayReplayy Owner-control group. NOLOGIN; only authenticated Owner beta-invite issuance and revocation.';

comment on role payreplayy_owner_control_runtime is
  'PayReplayy Owner-control runtime scaffold. NOLOGIN until separately provisioned; inherits only the Owner-control group and cannot SET ROLE.';

comment on function app.issue_telegram_beta_invite(uuid, text, timestamptz) is
  'Issues one digest-only beta invite after a trusted server supplies its verified Supabase Auth Owner subject. The raw token never enters PostgreSQL.';

comment on function app.revoke_telegram_beta_invite(uuid, uuid, text) is
  'Revokes one unredeemed beta invite by opaque identifier after a trusted server supplies its verified Supabase Auth Owner subject.';

commit;
