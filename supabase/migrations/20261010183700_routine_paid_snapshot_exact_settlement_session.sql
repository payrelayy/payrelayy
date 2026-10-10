-- The isolated paid settlement login reaches the guarded claim producer through
-- its sole EXECUTE grant. Its nested intent-snapshot trigger must recognize the
-- same exact session without granting the login direct access to ledger tables.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $paid_snapshot_session$
declare
  snapshot_oid oid :=
    'app.populate_routine_telebirr_paid_intent_snapshot()'::pg_catalog.regprocedure;
  source_body text;
  definition text;
  expected_body text;
  old_guard constant text := '  if session_user <> ''postgres'' then';
  new_guard constant text :=
    '  if not app.routine_telebirr_paid_settlement_session_allowed() then';
begin
  select routine.prosrc, pg_catalog.pg_get_functiondef(routine.oid)
    into source_body, definition
    from pg_catalog.pg_proc routine
   where routine.oid = snapshot_oid
     and routine.proowner = 'postgres'::pg_catalog.regrole
     and routine.prosecdef and routine.prokind = 'f'
     and routine.proconfig = array['search_path=pg_catalog']::text[];
  if source_body is null
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_body, 'UTF8')), 'hex') <>
      '4d28312975c4e24e0e3c91ef49339c39b90868470bfe79fe8a8d487e6ec91446'
    or (pg_catalog.length(source_body) -
        pg_catalog.length(pg_catalog.replace(source_body, old_guard, '')))
       <> pg_catalog.length(old_guard)
    or exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
      where routine.oid = snapshot_oid
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee <> routine.proowner)
    or not exists (
      select 1 from pg_catalog.pg_proc routine
       where routine.oid =
         'app.routine_telebirr_paid_settlement_session_allowed()'
           ::pg_catalog.regprocedure
         and routine.proowner = 'postgres'::pg_catalog.regrole
         and routine.prosecdef and routine.prokind = 'f'
         and routine.proconfig = array['search_path=pg_catalog']::text[])
  then
    raise exception 'The paid intent snapshot is not the reviewed private definition.';
  end if;

  expected_body := pg_catalog.replace(source_body, old_guard, new_guard);
  execute pg_catalog.replace(definition, old_guard, new_guard);
  if not exists (
    select 1 from pg_catalog.pg_proc routine
     where routine.oid = snapshot_oid
       and routine.proowner = 'postgres'::pg_catalog.regrole
       and routine.prosecdef and routine.prokind = 'f'
       and routine.proconfig = array['search_path=pg_catalog']::text[]
       and routine.prosrc = expected_body)
    or exists (
      select 1 from pg_catalog.pg_proc routine
      cross join lateral pg_catalog.aclexplode(coalesce(
        routine.proacl, pg_catalog.acldefault('f', routine.proowner))) privilege
      where routine.oid = snapshot_oid
        and privilege.privilege_type = 'EXECUTE'
        and privilege.grantee <> routine.proowner)
  then
    raise exception 'The exact paid intent snapshot guard replacement is incomplete.';
  end if;
end;
$paid_snapshot_session$;

comment on function app.populate_routine_telebirr_paid_intent_snapshot() is
  'Private receipt-time snapshot for the guarded paid settlement producer: postgres or the exact isolated settlement login, never direct runtime table writes.';

commit;
