-- Restore the two receiver SMS database logins after their bounded validity expired.
-- The existing passwords, memberships, grants, payment claims, and final-action fences stay intact.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $renew$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_until timestamptz := v_now + interval '29 days';
  v_role record;
  v_count integer := 0;
begin
  for v_role in
    select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
      rolcreaterole, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
    from pg_catalog.pg_roles
    where rolname in (
      'fetanagent_receiver_sms_ingest_runtime',
      'fetanagent_receiver_sms_settlement_runtime'
    )
  loop
    v_count := v_count + 1;
    if v_role.rolinherit or v_role.rolsuper
      or v_role.rolcreatedb or v_role.rolcreaterole or v_role.rolreplication
      or v_role.rolbypassrls or v_role.rolconnlimit <> 1
    then
      raise exception 'Receiver SMS runtime role state changed; renewal stopped.';
    end if;
    -- New databases have inactive roles; the production repair only renewed
    -- expired logins. A later migration changes active roles to continuous use.
    if v_role.rolcanlogin and v_role.rolvaliduntil <= v_now then
      execute pg_catalog.format(
        'alter role %I valid until %L', v_role.rolname, v_until
      );
    end if;
  end loop;
  if v_count <> 2 then
    raise exception 'Receiver SMS runtime role set changed; renewal stopped.';
  end if;
end;
$renew$;

commit;
