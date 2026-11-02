-- Signed no-money liveness reports. No KemerBet identity, credential, SMS, or
-- payment reference is stored in these status tables.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table app.companion_kemerbet_session_status (
  certificate_id uuid primary key references
    app.agent_platform_companion_enrollment_certificates(certificate_id) on delete restrict,
  platform_agent_account_id uuid not null references
    app.platform_agent_accounts(id) on delete restrict,
  state text not null check (state in
    ('signed_in_verified','sign_in_needed','checking','review_paused')),
  request_id text not null check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'),
  replay_identity text not null check (replay_identity ~ '^sha256:[0-9a-f]{64}$'),
  content_digest text not null check (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  received_at timestamptz not null,
  constraint companion_kemerbet_session_status_time_check
    check (received_at >= issued_at - interval '30 seconds'
      and received_at < issued_at + interval '60 seconds')
);
alter table app.companion_kemerbet_session_status owner to postgres;
alter table app.companion_kemerbet_session_status enable row level security;
alter table app.companion_kemerbet_session_status force row level security;
revoke all on app.companion_kemerbet_session_status
  from public, anon, authenticated, service_role;

create function app.record_companion_kemerbet_session_status(
  p_certificate_id uuid, p_device_id text, p_device_key_id text,
  p_request_id text, p_replay_identity text,
  p_issued_at timestamptz, p_expires_at timestamptz,
  p_assessed_at timestamptz, p_platform_agent_account_id uuid,
  p_state text, p_content_digest text
) returns boolean language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if session_user <> 'fetanagent_companion_device_bridge_runtime'
    or not pg_catalog.pg_has_role(session_user,
      'fetanagent_companion_device_bridge', 'member')
    or p_certificate_id is null or p_device_id is null or p_device_key_id is null
    or p_platform_agent_account_id is null
    or p_request_id is null or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$'
    or p_replay_identity is null or p_replay_identity !~ '^sha256:[0-9a-f]{64}$'
    or p_content_digest is null or p_content_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_state is null or p_state not in
      ('signed_in_verified','sign_in_needed','checking','review_paused')
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
        and profile.retired_at is null and account.status = 'active'
        and cert.valid_from <= p_assessed_at and cert.valid_until > p_assessed_at
        and signer.valid_from <= p_assessed_at and signer.valid_until > p_assessed_at
        and revoked.certificate_id is null and signer_revoked.server_signer_id is null
    ) then
    return false;
  end if;
  insert into app.companion_kemerbet_session_status
    (certificate_id, platform_agent_account_id, state,
     request_id, replay_identity, content_digest,
     issued_at, received_at)
    values (p_certificate_id, p_platform_agent_account_id, p_state,
      p_request_id, p_replay_identity,
      p_content_digest, p_issued_at, p_assessed_at)
  on conflict (certificate_id) do update
    set platform_agent_account_id = excluded.platform_agent_account_id,
        state = excluded.state, request_id = excluded.request_id,
        replay_identity = excluded.replay_identity,
        content_digest = excluded.content_digest,
        issued_at = excluded.issued_at, received_at = excluded.received_at
    where excluded.issued_at > companion_kemerbet_session_status.issued_at;
  return true;
end;
$$;
alter function app.record_companion_kemerbet_session_status(
  uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,text,text)
  owner to postgres;
revoke all on function app.record_companion_kemerbet_session_status(
  uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,text,text)
  from public, anon, authenticated, service_role,
    fetanagent_companion_device_bridge_runtime;
grant execute on function app.record_companion_kemerbet_session_status(
  uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,text,text)
  to fetanagent_companion_device_bridge;

create function app.get_owner_companion_kemerbet_session_status(p_actor_auth_user_id uuid)
returns table(state text, reported_at timestamptz, checked_at timestamptz)
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_actor_id uuid;
declare v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  if session_user not in ('postgres', 'fetanagent_owner_control_runtime') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active';
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
    select latest.state, latest.received_at, v_now
      from (select true) dummy
      left join lateral (
        select report.state, report.received_at
          from app.companion_kemerbet_session_status report
          join app.agent_platform_companion_enrollment_certificates cert
            on cert.certificate_id = report.certificate_id
          join app.agent_platform_companion_pairing_challenges pairing
            on pairing.pairing_id = cert.pairing_id
          join app.agent_platform_companion_server_signers signer
            on signer.id = cert.server_signer_id
          join app.private_owner_kemerbet_agent_profile_revisions profile
            on profile.platform_agent_account_id = report.platform_agent_account_id
          join app.platform_agent_accounts account
            on account.id = profile.platform_agent_account_id
          left join app.agent_platform_companion_device_revocations revoked
            on revoked.certificate_id = cert.certificate_id
          left join app.agent_platform_companion_server_signer_revocations signer_revoked
            on signer_revoked.server_signer_id = signer.id
         where pairing.created_by_admin_id = v_actor_id
           and profile.configured_by_admin_id = v_actor_id
           and profile.retired_at is null and account.status = 'active'
           and pairing.state = 'completed'
           and cert.valid_from <= v_now and cert.valid_until > v_now
           and signer.valid_from <= v_now and signer.valid_until > v_now
           and revoked.certificate_id is null and signer_revoked.server_signer_id is null
         order by report.received_at desc limit 1
      ) latest on true;
end;
$$;
alter function app.get_owner_companion_kemerbet_session_status(uuid) owner to postgres;
revoke all on function app.get_owner_companion_kemerbet_session_status(uuid)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.get_owner_companion_kemerbet_session_status(uuid)
  to fetanagent_owner_control;

create table app.receiver_sms_device_status (
  enrollment_id uuid primary key references app.routine_telebirr_device_enrollments(id)
    on delete restrict,
  state text not null check (state in ('ready','attention')),
  body_digest text not null check (body_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  received_at timestamptz not null,
  constraint receiver_sms_device_status_time_check
    check (received_at >= observed_at - interval '60 seconds'
      and received_at <= observed_at + interval '60 seconds')
);
alter table app.receiver_sms_device_status owner to postgres;
alter table app.receiver_sms_device_status enable row level security;
alter table app.receiver_sms_device_status force row level security;
revoke all on app.receiver_sms_device_status
  from public, anon, authenticated, service_role;

create function app.record_receiver_sms_device_status(
  p_device_id text, p_key_id text, p_state text,
  p_observed_at timestamptz, p_body_digest text,
  p_public_key_digest text
) returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_enrollment_id uuid;
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user <> 'fetanagent_receiver_sms_ingest_runtime'
    or not pg_catalog.pg_has_role(session_user,
      'fetanagent_receiver_sms_ingest', 'member')
    or p_device_id is null or p_key_id is null
    or p_state is null or p_state not in ('ready','attention')
    or p_observed_at is null or p_body_digest is null
    or p_body_digest !~ '^sha256:[0-9a-f]{64}$'
    or p_public_key_digest is null
    or p_public_key_digest !~ '^sha256:[0-9a-f]{64}$'
    or v_now < p_observed_at - interval '60 seconds'
    or v_now > p_observed_at + interval '60 seconds'
  then return false;
  end if;
  select enrollment.id into v_enrollment_id
    from app.routine_telebirr_device_enrollments enrollment
    where enrollment.device_id = p_device_id
      and enrollment.device_key_id = p_key_id
      and enrollment.device_public_key_spki_sha256 = p_public_key_digest
      and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
      and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
        where revoked.enrollment_id = enrollment.id)
    order by enrollment.valid_from desc limit 1;
  if v_enrollment_id is null then return false; end if;
  insert into app.receiver_sms_device_status
    (enrollment_id,state,body_digest,observed_at,received_at)
    values (v_enrollment_id,p_state,p_body_digest,p_observed_at,v_now)
    on conflict (enrollment_id) do update
      set state = excluded.state,
          body_digest = excluded.body_digest,
          observed_at = excluded.observed_at,
          received_at = excluded.received_at
      where excluded.observed_at > receiver_sms_device_status.observed_at;
  return true;
end;
$$;
alter function app.record_receiver_sms_device_status(
  text,text,text,timestamptz,text,text) owner to postgres;
revoke all on function app.record_receiver_sms_device_status(
  text,text,text,timestamptz,text,text)
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest_runtime;
grant execute on function app.record_receiver_sms_device_status(
  text,text,text,timestamptz,text,text) to fetanagent_receiver_sms_ingest;

create function app.get_owner_receiver_sms_device_status(p_actor_auth_user_id uuid)
returns table(state text, reported_at timestamptz, checked_at timestamptz)
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_actor_id uuid;
declare v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  if session_user not in ('postgres', 'fetanagent_owner_control_runtime') then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  select owner_user.id into v_actor_id from app.admin_users owner_user
    where owner_user.auth_user_id = p_actor_auth_user_id
      and owner_user.role = 'owner' and owner_user.status = 'active';
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active Owner is required.';
  end if;
  return query
    select latest.state, latest.received_at, v_now
      from (select true) dummy
      left join lateral (
        select report.state, report.received_at
          from app.receiver_sms_device_status report
          join app.routine_telebirr_device_enrollments enrollment
            on enrollment.id = report.enrollment_id
          left join app.routine_telebirr_device_enrollment_revocations revoked
            on revoked.enrollment_id = enrollment.id
         where enrollment.valid_from <= v_now and enrollment.valid_until > v_now
           and revoked.enrollment_id is null
         order by report.received_at desc limit 1
      ) latest on true;
end;
$$;
alter function app.get_owner_receiver_sms_device_status(uuid) owner to postgres;
revoke all on function app.get_owner_receiver_sms_device_status(uuid)
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.get_owner_receiver_sms_device_status(uuid)
  to fetanagent_owner_control;

commit;
