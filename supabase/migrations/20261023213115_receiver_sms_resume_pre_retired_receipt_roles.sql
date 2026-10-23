-- The first signed-SMS cutover already retired both paid-receipt identities.
-- Keep the CBE-stopped resume dormant while requiring that exact retired state.
-- Applying this migration changes no payment switch, SMS cutoff, or role.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $pre_retired_receipt_resume$
declare
  routine record;
  old_role_guard text;
  new_role_guard text;
  old_role_mutation text;
  new_role_mutation text;
  old_session_error text;
  new_session_error text;
  new_source text;
  new_definition text;
begin
  select p.oid, p.prosrc, pg_catalog.pg_get_functiondef(p.oid) as definition,
         p.proowner, p.prosecdef, p.proconfig, p.proacl
    into routine
    from pg_catalog.pg_proc p
   where p.oid = pg_catalog.to_regprocedure(
     'app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid)')::oid;
  if routine.oid is null
    or routine.proowner <> 'postgres'::pg_catalog.regrole
    or routine.prosecdef
    or routine.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(routine.prosrc, 'UTF8')), 'hex')
      <> 'd23e26e1dcd7d6aa8a6ac07fbddfda6bdfe3873920e0f6713a4a4d8805aa18f7'
    or pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', routine.oid, 'EXECUTE') then
    raise exception 'The stopped SMS resume is not the reviewed private definition.';
  end if;

  old_role_guard := $old$or (select count(*) = 2 and bool_and(role.rolcanlogin)
      from pg_roles role where role.rolname in (
        'fetanagent_routine_telebirr_paid_poll_runtime',
        'fetanagent_routine_telebirr_paid_settlement_runtime')) is not true$old$;
  new_role_guard := $new$or (select count(*) = 2 and bool_and(
        not role.rolcanlogin and role.rolvaliduntil <= checked_at)
      from pg_roles role where role.rolname in (
        'fetanagent_routine_telebirr_paid_poll_runtime',
        'fetanagent_routine_telebirr_paid_settlement_runtime')) is not true$new$;
  old_role_mutation := $old$  execute 'alter role fetanagent_routine_telebirr_paid_poll_runtime nologin password null valid until ''1970-01-01 00:00:00+00''';
  execute 'alter role fetanagent_routine_telebirr_paid_settlement_runtime nologin password null valid until ''1970-01-01 00:00:00+00''';$old$;
  new_role_mutation := $new$  -- Earlier signed-SMS cutover already retired both receipt roles.$new$;
  old_session_error := 'A paid receipt session appeared during retirement.';
  new_session_error := 'A retired paid receipt session appeared during recovery.';

  if (pg_catalog.length(routine.prosrc) - pg_catalog.length(
        pg_catalog.replace(routine.prosrc, old_role_guard, '')))
       <> pg_catalog.length(old_role_guard)
    or (pg_catalog.length(routine.prosrc) - pg_catalog.length(
        pg_catalog.replace(routine.prosrc, old_role_mutation, '')))
       <> pg_catalog.length(old_role_mutation)
    or (pg_catalog.length(routine.prosrc) - pg_catalog.length(
        pg_catalog.replace(routine.prosrc, old_session_error, '')))
       <> pg_catalog.length(old_session_error) then
    raise exception 'The stopped SMS resume role boundary is not unique.';
  end if;

  new_source := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    routine.prosrc, old_role_guard, new_role_guard),
    old_role_mutation, new_role_mutation), old_session_error, new_session_error);
  new_definition := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    routine.definition, old_role_guard, new_role_guard),
    old_role_mutation, new_role_mutation), old_session_error, new_session_error);
  if new_definition is not distinct from routine.definition then
    raise exception 'The stopped SMS resume definition did not change.';
  end if;
  execute new_definition;
  if not exists (
    select 1 from pg_catalog.pg_proc p where p.oid = routine.oid
      and p.prosrc = new_source
      and p.proowner = routine.proowner
      and p.prosecdef = routine.prosecdef
      and p.proconfig is not distinct from routine.proconfig
      and p.proacl is not distinct from routine.proacl
  ) then
    raise exception 'The stopped SMS resume replacement changed another boundary.';
  end if;
end;
$pre_retired_receipt_resume$;

comment on function app.resume_receiver_sms_cbe_stopped_financial_gates(uuid,uuid) is
  'One-use CBE-stopped signed-SMS recovery. Requires both paid receipt roles already retired and expired, current signed SMS intake and idle worker, and an empty execution ledger; advances the SMS cutoff before enabling only the two shared gates.';

commit;
