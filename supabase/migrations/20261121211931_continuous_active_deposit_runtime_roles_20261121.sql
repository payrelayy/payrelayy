-- Remove calendar expiry from the three active, dedicated production service logins.
-- No password, membership, grant, switch, payment claim, or final-action fence changes.
-- On a fresh database all three roles are inactive, so this is a no-op.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $continuous$
declare
  v_role record;
  v_active_count integer := 0;
  v_role_count integer := 0;
  v_member_count integer;
begin
  for v_role in
    select expected.runtime_role, expected.group_role, role.oid, role.rolname,
      role.rolcanlogin, role.rolinherit, role.rolsuper, role.rolcreatedb,
      role.rolcreaterole, role.rolreplication, role.rolbypassrls,
      role.rolconnlimit, role.rolvaliduntil
    from (values
      ('fetanagent_receiver_sms_ingest_runtime', 'fetanagent_receiver_sms_ingest'),
      ('fetanagent_receiver_sms_settlement_runtime', 'fetanagent_receiver_sms_settlement'),
      ('fetanagent_routine_deposit_broker_runtime', 'fetanagent_routine_deposit_broker')
    ) expected(runtime_role, group_role)
    left join pg_catalog.pg_roles role on role.rolname = expected.runtime_role
  loop
    v_role_count := v_role_count + 1;
    if v_role.oid is null or v_role.rolinherit or v_role.rolsuper
      or v_role.rolcreatedb or v_role.rolcreaterole or v_role.rolreplication
      or v_role.rolbypassrls or v_role.rolconnlimit <> 1
    then
      raise exception 'Dedicated deposit service role state changed; migration stopped.';
    end if;

    select count(*) into v_member_count
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles parent on parent.oid = membership.roleid
    where membership.member = v_role.oid
      and parent.rolname = v_role.group_role;
    if v_member_count <> 1 or (
      select count(*) from pg_catalog.pg_auth_members membership
      where membership.member = v_role.oid
    ) <> 1 then
      raise exception 'Dedicated deposit service membership changed; migration stopped.';
    end if;

    if v_role.rolcanlogin then
      v_active_count := v_active_count + 1;
      if v_role.rolvaliduntil is null or
        v_role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '1 day'
      then
        raise exception 'Active deposit service login is not healthy; migration stopped.';
      end if;
    end if;
  end loop;

  if v_role_count <> 3 or v_active_count not in (0, 3) then
    raise exception 'Deposit service role set is mixed; migration stopped.';
  end if;

  if v_active_count = 3 then
    execute 'alter role fetanagent_receiver_sms_ingest_runtime valid until ''infinity''';
    execute 'alter role fetanagent_receiver_sms_settlement_runtime valid until ''infinity''';
    execute 'alter role fetanagent_routine_deposit_broker_runtime valid until ''infinity''';
  end if;
end;
$continuous$;

commit;
