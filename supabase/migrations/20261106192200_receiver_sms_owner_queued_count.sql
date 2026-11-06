begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- A queue count is advisory phone health, never payment evidence or credit authority.
alter table app.receiver_sms_device_status
  add column queued_sms_count integer
  check (queued_sms_count between 0 and 100000);

create function app.record_receiver_sms_device_status_with_queue(
  p_device_id text, p_key_id text, p_state text,
  p_observed_at timestamptz, p_body_digest text,
  p_public_key_digest text, p_queued_sms_count integer
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
    or (p_queued_sms_count is not null
      and p_queued_sms_count not between 0 and 100000)
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
    (enrollment_id,state,body_digest,observed_at,received_at,queued_sms_count)
    values (v_enrollment_id,p_state,p_body_digest,p_observed_at,v_now,p_queued_sms_count)
    on conflict (enrollment_id) do update
      set state = excluded.state,
          body_digest = excluded.body_digest,
          observed_at = excluded.observed_at,
          received_at = excluded.received_at,
          queued_sms_count = excluded.queued_sms_count
      where excluded.observed_at > receiver_sms_device_status.observed_at;
  return true;
end;
$$;
alter function app.record_receiver_sms_device_status_with_queue(
  text,text,text,timestamptz,text,text,integer) owner to postgres;
revoke all on function app.record_receiver_sms_device_status_with_queue(
  text,text,text,timestamptz,text,text,integer)
  from public, anon, authenticated, service_role,
    fetanagent_receiver_sms_ingest_runtime;
grant execute on function app.record_receiver_sms_device_status_with_queue(
  text,text,text,timestamptz,text,text,integer)
  to fetanagent_receiver_sms_ingest;

-- Old signed reports remain accepted during the server-first, phone-second rollout.
create or replace function app.record_receiver_sms_device_status(
  p_device_id text, p_key_id text, p_state text,
  p_observed_at timestamptz, p_body_digest text,
  p_public_key_digest text
) returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  return app.record_receiver_sms_device_status_with_queue(
    p_device_id,p_key_id,p_state,p_observed_at,p_body_digest,
    p_public_key_digest,null);
end;
$$;
alter function app.record_receiver_sms_device_status(
  text,text,text,timestamptz,text,text) owner to postgres;

drop function app.get_owner_receiver_sms_device_status(uuid);
create function app.get_owner_receiver_sms_device_status(p_actor_auth_user_id uuid)
returns table(state text, reported_at timestamptz, checked_at timestamptz,
  queued_sms_count integer)
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
    select latest.state, latest.received_at, v_now, latest.queued_sms_count
      from (select true) dummy
      left join lateral (
        select report.state, report.received_at, report.queued_sms_count
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
