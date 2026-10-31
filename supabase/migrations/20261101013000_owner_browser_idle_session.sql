-- Owner page activity is separate from automatic Supabase token refresh and
-- dashboard polling. Only the narrow Owner-control runtime can call this gate.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table app.owner_browser_sessions (
  session_id uuid primary key,
  auth_user_id uuid not null,
  auth_created_at timestamptz not null,
  last_activity_at timestamptz not null
);
alter table app.owner_browser_sessions owner to postgres;
alter table app.owner_browser_sessions enable row level security;
revoke all on table app.owner_browser_sessions
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;

create function app.owner_browser_session(
  p_actor_auth_user_id uuid,
  p_session_id uuid,
  p_action text
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_auth_created_at timestamptz;
  v_last_activity_at timestamptz;
begin
  if session_user <> 'fetanagent_owner_control_runtime'
    or p_actor_auth_user_id is null or p_session_id is null
    or p_action is null or p_action not in ('start', 'check', 'touch')
    or not exists (
      select 1 from app.admin_users owner_user
      where owner_user.auth_user_id = p_actor_auth_user_id
        and owner_user.role = 'owner' and owner_user.status = 'active'
    ) then
    raise exception using errcode = '42501', message = 'Owner session is unavailable.';
  end if;

  -- The verified JWT session_id must still belong to this exact Auth user.
  select auth_session.created_at into v_auth_created_at
  from auth.sessions auth_session
  where auth_session.id = p_session_id
    and auth_session.user_id = p_actor_auth_user_id;
  if v_auth_created_at is null or v_auth_created_at > v_now
    or v_now >= v_auth_created_at + interval '7 days' then
    raise exception using errcode = '42501', message = 'Owner session is unavailable.';
  end if;

  if p_action = 'start' then
    -- A new browser session is registered promptly after password sign-in.
    -- Replaying start cannot reset an existing idle deadline.
    if v_now >= v_auth_created_at + interval '12 hours' then
      raise exception using errcode = '42501', message = 'Owner session is unavailable.';
    end if;
    delete from app.owner_browser_sessions old_session
    where old_session.auth_created_at < v_now - interval '8 days';
    insert into app.owner_browser_sessions
      (session_id, auth_user_id, auth_created_at, last_activity_at)
    values (p_session_id, p_actor_auth_user_id, v_auth_created_at, v_now)
    on conflict (session_id) do nothing;
  elsif p_action = 'touch' then
    update app.owner_browser_sessions browser_session
    set last_activity_at = greatest(browser_session.last_activity_at, v_now)
    where browser_session.session_id = p_session_id
      and browser_session.auth_user_id = p_actor_auth_user_id
      and browser_session.auth_created_at = v_auth_created_at
      and v_now < browser_session.last_activity_at + interval '12 hours';
  end if;

  select browser_session.last_activity_at into v_last_activity_at
  from app.owner_browser_sessions browser_session
  where browser_session.session_id = p_session_id
    and browser_session.auth_user_id = p_actor_auth_user_id
    and browser_session.auth_created_at = v_auth_created_at;
  if v_last_activity_at is null
    or v_now >= v_last_activity_at + interval '12 hours' then
    raise exception using errcode = '42501', message = 'Owner session is unavailable.';
  end if;

  return pg_catalog.jsonb_build_object(
    'idleExpiresAt', v_last_activity_at + interval '12 hours',
    'absoluteExpiresAt', v_auth_created_at + interval '7 days'
  );
end;
$$;
alter function app.owner_browser_session(uuid,uuid,text) owner to postgres;
revoke all on function app.owner_browser_session(uuid,uuid,text)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control, fetanagent_owner_control_runtime;
grant execute on function app.owner_browser_session(uuid,uuid,text)
  to fetanagent_owner_control_runtime;

commit;
