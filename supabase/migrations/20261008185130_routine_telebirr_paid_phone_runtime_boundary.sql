-- A paid phone poll gets its own unprovisioned login scaffold. It can read an
-- enrolled public-key binding and atomically reserve one paid assignment, but
-- cannot see tables or create an observation, claim, job, wallet entry, or credit.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create role fetanagent_routine_telebirr_paid_poll
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 2;
create role fetanagent_routine_telebirr_paid_poll_runtime
  nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 1;
grant fetanagent_routine_telebirr_paid_poll
  to fetanagent_routine_telebirr_paid_poll_runtime
  with inherit true, set false, admin false;

alter default privileges for role postgres in schema app
  revoke execute on functions from public;

create function app.routine_telebirr_paid_poll_session_allowed()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_allowed boolean;
begin
  if session_user = 'postgres' then return true; end if;
  if session_user <> 'fetanagent_routine_telebirr_paid_poll_runtime' then
    return false;
  end if;
  select runtime.rolcanlogin and not runtime.rolinherit
         and not runtime.rolsuper and not runtime.rolcreatedb
         and not runtime.rolcreaterole and not runtime.rolreplication
         and not runtime.rolbypassrls and runtime.rolconnlimit = 1
         and runtime.rolvaliduntil is not null
         and runtime.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'
         and runtime.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '30 days 5 minutes'
         and pg_catalog.pg_has_role(session_user,
               'fetanagent_routine_telebirr_paid_poll', 'USAGE')
         and not pg_catalog.pg_has_role(session_user,
               'fetanagent_routine_telebirr_paid_poll', 'SET')
         and (
           select pg_catalog.count(*) = 1
                  and pg_catalog.bool_and(
                    granted.rolname = 'fetanagent_routine_telebirr_paid_poll'
                    and membership.inherit_option
                    and not membership.set_option
                    and not membership.admin_option)
             from pg_catalog.pg_auth_members membership
             join pg_catalog.pg_roles granted on granted.oid = membership.roleid
            where membership.member = runtime.oid)
    into v_allowed
    from pg_catalog.pg_roles runtime
   where runtime.rolname = 'fetanagent_routine_telebirr_paid_poll_runtime';
  return coalesce(v_allowed, false);
end;
$$;
alter function app.routine_telebirr_paid_poll_session_allowed() owner to postgres;
revoke all on function app.routine_telebirr_paid_poll_session_allowed()
  from public, anon, authenticated, service_role;

create function app.load_routine_telebirr_paid_poll_enrollment(p_enrollment_id uuid)
returns table (
  enrollment_id uuid, device_id text, device_key_id text,
  device_public_key_spki_sha256 text, valid_from timestamptz,
  valid_until timestamptz, receiver_revision_id uuid,
  receiver_profile_digest text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not app.routine_telebirr_paid_poll_session_allowed()
    or p_enrollment_id is null then
    raise exception using errcode = '42501',
      message = 'The routine paid phone enrollment is unavailable.';
  end if;
  return query
  select enrollment.id, enrollment.device_id, enrollment.device_key_id,
         enrollment.device_public_key_spki_sha256,
         enrollment.valid_from, enrollment.valid_until,
         receiver.id, enrollment.receiver_profile_digest
    from app.routine_telebirr_device_enrollments enrollment
    join app.receiver_accounts receiver
      on receiver.id = enrollment.receiver_account_id
     and receiver.version = enrollment.receiver_account_version
   where enrollment.id = p_enrollment_id
     and enrollment.valid_from <= v_now and enrollment.valid_until > v_now
     and not exists (select 1 from app.routine_telebirr_device_enrollment_revocations revoked
       where revoked.enrollment_id = enrollment.id)
     and receiver.status = 'active' and receiver.retired_at is null
     and receiver.active_from <= v_now
     and case
       when receiver.account_reference_fingerprint ~ '^[0-9a-f]{64}$'
         and receiver.account_holder_name is not null
         and pg_catalog.char_length(receiver.account_holder_name) between 2 and 160
         and receiver.account_holder_name !~ '[[:cntrl:]]'
       then app.routine_telebirr_receiver_name_digest(receiver.account_holder_name) =
         enrollment.expected_receiver_name_digest
         and app.routine_telebirr_receiver_profile_digest(
           receiver.id, receiver.version, receiver.account_reference_fingerprint,
           receiver.account_holder_name) = enrollment.receiver_profile_digest
       else false
     end;
end;
$$;
alter function app.load_routine_telebirr_paid_poll_enrollment(uuid) owner to postgres;
revoke all on function app.load_routine_telebirr_paid_poll_enrollment(uuid)
  from public, anon, authenticated, service_role,
    fetanagent_routine_telebirr_no_money,
    fetanagent_routine_telebirr_no_money_runtime;

-- Pin the three reviewed paid issuers before changing their postgres-only
-- session guard. A changed production definition aborts the whole migration.
do $allow_only_reviewed_paid_poll_routines$
declare
  expected record;
  routine_oid oid;
  source_body text;
  definition text;
  patched_body text;
  old_guard constant text := 'session_user <> ''postgres''';
  new_guard constant text := 'not app.routine_telebirr_paid_poll_session_allowed()';
begin
  for expected in
    select * from (values
      ('app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)',
       '06fbcd9a28b4d50a50dbab1ada0c0f1191b165432058248e95bc11171e3e3bdf'),
      ('app.issue_routine_telebirr_paid_lookup_assignment_material(uuid,uuid,uuid)',
       'bc7835805bf57a697c6da61c0438960d44910280e0537366c7d9bb00bc435ced'),
      ('app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)',
       '6779a0144acafee3e98cc3f820a1da32a7530852a6df9b6ab2d622040be7aebf')
    ) as reviewed(signature, source_sha256)
  loop
    routine_oid := pg_catalog.to_regprocedure(expected.signature);
    if routine_oid is null then
      raise exception 'A reviewed routine paid poll function is missing.';
    end if;
    select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
      into source_body, definition
      from pg_catalog.pg_proc routine
     where routine.oid = routine_oid
       and routine.proowner = 'postgres'::pg_catalog.regrole
       and routine.prosecdef and routine.prokind = 'f'
       and routine.proconfig = array['search_path=pg_catalog']::text[];
    if source_body is null or pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(source_body, 'UTF8')), 'hex'
      ) <> expected.source_sha256
      or (pg_catalog.length(source_body) -
          pg_catalog.length(pg_catalog.replace(source_body, old_guard, '')))
         <> pg_catalog.length(old_guard) then
      raise exception 'A reviewed routine paid poll function has drifted.';
    end if;
    patched_body := pg_catalog.replace(source_body, old_guard, new_guard);
    execute pg_catalog.replace(definition, old_guard, new_guard);
    if (select pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8'))
          from pg_catalog.pg_proc routine where routine.oid = routine_oid)
       <> pg_catalog.sha256(pg_catalog.convert_to(patched_body, 'UTF8')) then
      raise exception 'The routine paid poll guard replacement is incomplete.';
    end if;
  end loop;
end;
$allow_only_reviewed_paid_poll_routines$;

do $$
begin
  execute pg_catalog.format(
    'revoke all privileges on database %I from fetanagent_routine_telebirr_paid_poll, fetanagent_routine_telebirr_paid_poll_runtime',
    pg_catalog.current_database());
end;
$$;
revoke all privileges on schema app
  from fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;
revoke all privileges on all tables in schema app
  from fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;
revoke all privileges on all sequences in schema app
  from fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;
revoke all privileges on all functions in schema app
  from fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;
revoke all privileges on all procedures in schema app
  from fetanagent_routine_telebirr_paid_poll,
       fetanagent_routine_telebirr_paid_poll_runtime;

grant usage on schema app to fetanagent_routine_telebirr_paid_poll;
grant execute on function
  app.load_routine_telebirr_paid_poll_enrollment(uuid),
  app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)
to fetanagent_routine_telebirr_paid_poll;

comment on function app.load_routine_telebirr_paid_poll_enrollment(uuid) is
  'Private active phone public-key binding for a signed paid poll; no candidate, receipt, or credit.';
comment on function app.issue_routine_telebirr_paid_poll_assignment(
  uuid,uuid,text,timestamptz,uuid) is
  'Private one-use paid poll handoff after phone signature verification; no observation, payment claim, job, or credit.';
comment on function app.routine_telebirr_paid_poll_session_allowed() is
  'Owner-only operation-time guard for postgres maintenance or the exact separately provisioned paid poll runtime.';
comment on role fetanagent_routine_telebirr_paid_poll is
  'NOLOGIN group with only paid phone enrollment-read and one-use paid poll-issue privileges.';
comment on role fetanagent_routine_telebirr_paid_poll_runtime is
  'Unprovisioned NOLOGIN one-connection paid phone poll scaffold; no credential or financial write privilege.';
commit;
