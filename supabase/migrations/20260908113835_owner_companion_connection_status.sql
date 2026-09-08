-- Owner-only, redacted connection telemetry. No enrollment, commands, or money authority.
create index companion_http_poll_last_seen_idx
  on app.agent_platform_companion_http_request_replays (certificate_id, received_at desc)
  where canonical_path = '/v1/companion/device/lookup-assignments:poll';

create function app.get_owner_companion_connection_status(p_actor_auth_user_id uuid)
returns table (
  paired_device_count integer,
  valid_device_count integer,
  connected_device_count integer,
  last_seen_at timestamptz,
  checked_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  actor_admin_id uuid;
  now_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
begin
  perform app.require_owner_kemerbet_agent_profile_controller();
  select admin_user.id into actor_admin_id
    from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner' and admin_user.status = 'active';
  if actor_admin_id is null then
    raise exception using errcode = '42501', message = 'The active Owner is required.';
  end if;

  return query
  with devices as (
    select certificate.certificate_id,
           certificate.valid_from <= now_at and certificate.valid_until > now_at
             and signer.valid_from <= now_at and signer.valid_until > now_at
             and device_revocation.certificate_id is null
             and signer_revocation.server_signer_id is null as valid,
           poll.received_at
      from app.agent_platform_companion_enrollment_certificates certificate
      join app.agent_platform_companion_pairing_challenges challenge
        on challenge.pairing_id = certificate.pairing_id
      join app.agent_platform_companion_server_signers signer
        on signer.id = certificate.server_signer_id
      left join app.agent_platform_companion_device_revocations device_revocation
        on device_revocation.certificate_id = certificate.certificate_id
      left join app.agent_platform_companion_server_signer_revocations signer_revocation
        on signer_revocation.server_signer_id = signer.id
      left join lateral (
        select replay.received_at
          from app.agent_platform_companion_http_request_replays replay
         where replay.certificate_id = certificate.certificate_id
           and replay.canonical_path = '/v1/companion/device/lookup-assignments:poll'
           and replay.received_at <= now_at
         order by replay.received_at desc limit 1
      ) poll on true
     where challenge.created_by_admin_id = actor_admin_id
  )
  select count(*)::integer,
         count(*) filter (where devices.valid)::integer,
         count(*) filter (where devices.valid and devices.received_at > now_at - interval '60 seconds')::integer,
         coalesce(max(devices.received_at) filter (where devices.valid), max(devices.received_at)), now_at
    from devices;
end;
$$;

alter function app.get_owner_companion_connection_status(uuid) owner to postgres;
revoke all on function app.get_owner_companion_connection_status(uuid) from public, anon, authenticated;
grant execute on function app.get_owner_companion_connection_status(uuid) to fetanagent_owner_control;
comment on function app.get_owner_companion_connection_status(uuid) is
  'Read-only Owner-scoped authenticated companion check-ins; not provider sign-in or financial readiness.';
