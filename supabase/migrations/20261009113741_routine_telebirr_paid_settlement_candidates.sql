-- Private bounded scan for signed paid observations awaiting the one-use claim.
-- The dedicated settlement runtime gains no table access or credentials here.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create index routine_paid_staging_settlement_scan
  on app.routine_telebirr_paid_observation_staging (occurred_at, challenge_id);

create function app.list_routine_telebirr_paid_settlement_candidates(
  p_after_occurred_at timestamptz,
  p_after_challenge_id uuid,
  p_limit integer
)
returns table (challenge_id uuid, occurred_at_utc text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not app.routine_telebirr_paid_settlement_session_allowed()
    or p_limit is null or p_limit not between 1 and 32
    or (p_after_occurred_at is null) <> (p_after_challenge_id is null) then
    raise exception using errcode = '42501',
      message = 'The routine paid settlement scan is unavailable.';
  end if;

  return query
  select staged.challenge_id,
         pg_catalog.to_char(staged.occurred_at at time zone 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    from app.routine_telebirr_paid_observation_staging staged
   where staged.occurred_at > pg_catalog.clock_timestamp() - interval '1 hour'
     and staged.occurred_at <= pg_catalog.clock_timestamp()
     and staged.recorded_at <= pg_catalog.clock_timestamp()
     and (p_after_occurred_at is null or
       (staged.occurred_at, staged.challenge_id) >
       (p_after_occurred_at, p_after_challenge_id))
     and not exists (
       select 1 from app.routine_telebirr_paid_intent_openings opening
        where opening.challenge_id = staged.challenge_id)
   order by staged.occurred_at, staged.challenge_id
   limit p_limit;
end;
$$;
alter function app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)
  owner to postgres;
revoke all on function
  app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)
  to fetanagent_routine_telebirr_paid_settlement;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(coalesce(
      routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
    where routine.oid =
      'app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer)'
        ::pg_catalog.regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee not in (
        routine.proowner,
        'fetanagent_routine_telebirr_paid_settlement'::pg_catalog.regrole)) then
    raise exception 'The paid settlement scan has an unexpected execute grant.';
  end if;
end;
$$;

comment on function
  app.list_routine_telebirr_paid_settlement_candidates(timestamptz,uuid,integer) is
  'Bounded, private, cursor-paginated IDs of fresh staged paid observations without a claim. No raw receipt or reference is returned.';
commit;
