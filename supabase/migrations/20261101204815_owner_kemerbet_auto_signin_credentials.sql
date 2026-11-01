-- Owner-managed KemerBet sign-in for the paired Windows Companion.
-- Passwords live only in Supabase Vault. Owner reads return metadata, never the password.
begin;

create table app.private_kemerbet_signin_credentials (
  platform_agent_account_id uuid primary key
    references app.platform_agent_accounts (id) on delete restrict,
  username text not null check (
    pg_catalog.length(username) between 1 and 128
    and username = pg_catalog.btrim(username)
    and username !~ '[[:cntrl:]]'
  ),
  vault_secret_id uuid not null unique,
  revision integer not null check (revision > 0),
  updated_by_admin_id uuid not null references app.admin_users (id) on delete restrict,
  updated_at timestamptz not null
);
alter table app.private_kemerbet_signin_credentials owner to postgres;
alter table app.private_kemerbet_signin_credentials enable row level security;
alter table app.private_kemerbet_signin_credentials force row level security;
revoke all on table app.private_kemerbet_signin_credentials
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

create table app.private_kemerbet_signin_access (
  request_id text primary key,
  replay_identity text not null unique check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  certificate_id uuid not null
    references app.agent_platform_companion_enrollment_certificates (certificate_id)
    on delete restrict,
  platform_agent_account_id uuid not null
    references app.platform_agent_accounts (id) on delete restrict,
  received_at timestamptz not null
);
alter table app.private_kemerbet_signin_access owner to postgres;
alter table app.private_kemerbet_signin_access enable row level security;
alter table app.private_kemerbet_signin_access force row level security;
revoke all on table app.private_kemerbet_signin_access
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;

create function app.get_owner_kemerbet_signin_credentials(p_actor_auth_user_id uuid)
returns table (platform_agent_account_id uuid, username text, revision integer, updated_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform app.require_owner_kemerbet_agent_profile_controller();
  if not exists (
    select 1 from app.admin_users a
     where a.auth_user_id = p_actor_auth_user_id and a.role = 'owner' and a.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active Owner required.';
  end if;
  return query
    select c.platform_agent_account_id, c.username, c.revision, c.updated_at
      from app.private_kemerbet_signin_credentials c
      join app.private_owner_kemerbet_agent_profile_revisions p
        on p.platform_agent_account_id = c.platform_agent_account_id
      join app.platform_agent_accounts a
        on a.id = p.platform_agent_account_id
     where p.retired_at is null and a.status = 'active';
end;
$$;

create function app.set_owner_kemerbet_signin_credentials(
  p_actor_auth_user_id uuid, p_platform_agent_account_id uuid,
  p_username text, p_password text, p_expected_revision integer
)
returns table (platform_agent_account_id uuid, username text, revision integer, updated_at timestamptz)
language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor_admin_id uuid;
  current_record app.private_kemerbet_signin_credentials%rowtype;
  secret_id uuid;
  changed_at timestamptz;
begin
  perform app.require_owner_kemerbet_agent_profile_controller();
  select a.id into actor_admin_id from app.admin_users a
   where a.auth_user_id = p_actor_auth_user_id and a.role = 'owner' and a.status = 'active'
   for share;
  if actor_admin_id is null then
    raise exception using errcode = '42501', message = 'Active Owner required.';
  end if;
  if p_platform_agent_account_id is null
    or p_username is null or pg_catalog.length(p_username) not between 1 and 128
    or p_username <> pg_catalog.btrim(p_username) or p_username ~ '[[:cntrl:]]'
    or p_password is null or pg_catalog.length(p_password) not between 1 and 256
    or p_password ~ '[[:cntrl:]]'
    or p_expected_revision is null or p_expected_revision < 0
    or p_expected_revision >= 2147483647 then
    raise exception using errcode = '22023', message = 'Invalid sign-in configuration.';
  end if;
  if not exists (
    select 1 from app.private_owner_kemerbet_agent_profile_revisions p
    join app.platform_agent_accounts a on a.id = p.platform_agent_account_id
     where p.platform_agent_account_id = p_platform_agent_account_id
       and p.retired_at is null and a.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'Active KemerBet account required.';
  end if;
  select c.* into current_record from app.private_kemerbet_signin_credentials c
   where c.platform_agent_account_id = p_platform_agent_account_id for update;
  if (current_record.platform_agent_account_id is null and p_expected_revision <> 0)
     or (current_record.platform_agent_account_id is not null
         and current_record.revision <> p_expected_revision) then
    raise exception using errcode = '40001', message = 'Sign-in settings changed.';
  end if;
  changed_at := pg_catalog.clock_timestamp();
  if current_record.platform_agent_account_id is null then
    secret_id := vault.create_secret(
      p_password, 'fetanagent-kemerbet-' || p_platform_agent_account_id::text,
      'Owner-managed paired Companion sign-in'
    );
    insert into app.private_kemerbet_signin_credentials (
      platform_agent_account_id, username, vault_secret_id, revision,
      updated_by_admin_id, updated_at
    ) values (
      p_platform_agent_account_id, p_username, secret_id, 1, actor_admin_id, changed_at
    );
  else
    perform vault.update_secret(current_record.vault_secret_id, p_password);
    update app.private_kemerbet_signin_credentials c
       set username = p_username, revision = current_record.revision + 1,
           updated_by_admin_id = actor_admin_id, updated_at = changed_at
     where c.platform_agent_account_id = p_platform_agent_account_id;
  end if;
  return query
    select c.platform_agent_account_id, c.username, c.revision, c.updated_at
      from app.private_kemerbet_signin_credentials c
     where c.platform_agent_account_id = p_platform_agent_account_id;
end;
$$;

create function app.get_companion_kemerbet_signin_credentials(
  p_certificate_id uuid, p_device_id text, p_device_key_id text,
  p_replay_identity text, p_request_id text,
  p_issued_at timestamptz, p_expires_at timestamptz,
  p_assessed_at timestamptz, p_platform_agent_account_id uuid
)
returns table (username text, password text, revision integer)
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if session_user <> 'fetanagent_companion_device_bridge_runtime'
    or not pg_catalog.pg_has_role(
      session_user, 'fetanagent_companion_device_bridge', 'member'
    ) then
    raise exception using errcode = '42501', message = 'Paired Companion required.';
  end if;
  if p_replay_identity is null or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_request_id is null or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_certificate_id is null or p_device_id is null or p_device_key_id is null
    or p_platform_agent_account_id is null
    or p_issued_at is null or p_expires_at is null or p_assessed_at is null
    or p_assessed_at < pg_catalog.clock_timestamp() - interval '30 seconds'
    or p_assessed_at > pg_catalog.clock_timestamp() + interval '30 seconds'
    or p_assessed_at < p_issued_at - interval '30 seconds'
    or p_assessed_at >= p_expires_at
    or p_expires_at <= p_issued_at
    or p_expires_at > p_issued_at + interval '60 seconds'
    or not exists (
      select 1 from app.agent_platform_companion_enrollment_certificates cert
      join app.agent_platform_companion_pairing_challenges pairing
        on pairing.pairing_id = cert.pairing_id
      join app.agent_platform_companion_server_signers signer
        on signer.id = cert.server_signer_id
      join app.private_owner_kemerbet_agent_profile_revisions profile
        on profile.platform_agent_account_id = p_platform_agent_account_id
      join app.platform_agent_accounts account
        on account.id = profile.platform_agent_account_id
      left join app.agent_platform_companion_device_revocations revoked
        on revoked.certificate_id = cert.certificate_id
      left join app.agent_platform_companion_server_signer_revocations signer_revoked
        on signer_revoked.server_signer_id = signer.id
      where cert.certificate_id = p_certificate_id
        and cert.device_id = p_device_id and cert.device_key_id = p_device_key_id
        and pairing.state = 'completed'
        and pairing.created_by_admin_id = profile.configured_by_admin_id
        and profile.retired_at is null
        and account.status = 'active'
        and cert.valid_from <= p_assessed_at and cert.valid_until > p_assessed_at
        and signer.valid_from <= p_assessed_at and signer.valid_until > p_assessed_at
        and revoked.certificate_id is null and signer_revoked.server_signer_id is null
    ) then
    return;
  end if;
  insert into app.private_kemerbet_signin_access (
    request_id, replay_identity, certificate_id, platform_agent_account_id, received_at
  ) values (
    p_request_id, p_replay_identity, p_certificate_id,
    p_platform_agent_account_id, p_assessed_at
  );
  return query
    select c.username, s.decrypted_secret, c.revision
      from app.private_kemerbet_signin_credentials c
      join vault.decrypted_secrets s on s.id = c.vault_secret_id
     where c.platform_agent_account_id = p_platform_agent_account_id;
end;
$$;

alter function app.get_owner_kemerbet_signin_credentials(uuid) owner to postgres;
alter function app.set_owner_kemerbet_signin_credentials(uuid,uuid,text,text,integer) owner to postgres;
alter function app.get_companion_kemerbet_signin_credentials(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid) owner to postgres;
revoke all on function app.get_owner_kemerbet_signin_credentials(uuid),
  app.set_owner_kemerbet_signin_credentials(uuid,uuid,text,text,integer),
  app.get_companion_kemerbet_signin_credentials(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid)
  from public, anon, authenticated, service_role,
       fetanagent_owner_control, fetanagent_owner_control_runtime,
       fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;
grant execute on function app.get_owner_kemerbet_signin_credentials(uuid),
  app.set_owner_kemerbet_signin_credentials(uuid,uuid,text,text,integer)
  to fetanagent_owner_control;
grant execute on function app.get_companion_kemerbet_signin_credentials(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid)
  to fetanagent_companion_device_bridge;
commit;
