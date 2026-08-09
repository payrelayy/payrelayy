import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createSqlIntegrationClient,
  readSqlIntegrationEnvironment,
  type SqlIntegrationEnvironment,
} from './environment.js';
import { applyMigrationsLexically, listMigrationsLexically } from './migration-runner.js';
import { applySyntheticSupabaseBootstrap } from './synthetic-bootstrap.js';

type RoleRow = {
  readonly rolbypassrls: boolean;
  readonly rolcanlogin: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolinherit: boolean;
  readonly rolname: string;
  readonly rolreplication: boolean;
  readonly rolsuper: boolean;
};

type MembershipRow = {
  readonly admin_option: boolean;
  readonly group_role: string;
  readonly inherit_option: boolean;
  readonly member_role: string;
  readonly set_option: boolean;
};

type RlsRow = {
  readonly relforcerowsecurity: boolean;
  readonly relname: string;
  readonly relrowsecurity: boolean;
};

let environment: SqlIntegrationEnvironment;
let client: ReturnType<typeof createSqlIntegrationClient>;
let appliedMigrationNames: readonly string[];

beforeAll(async () => {
  environment = readSqlIntegrationEnvironment();
  client = createSqlIntegrationClient(environment);

  await client.connect();
  await applySyntheticSupabaseBootstrap(client);
  appliedMigrationNames = await applyMigrationsLexically(client, environment.migrationsDirectory);
});

afterAll(async () => {
  await client?.end();
});

describe('disposable SQL migration baseline', () => {
  it('applies every checked-in migration in lexical filename order', async () => {
    const expectedMigrationNames = await listMigrationsLexically(environment.migrationsDirectory);
    const appliedRows = await client.query<{ readonly filename: string }>(`
      select filename
      from sql_integration.applied_migrations
      order by filename
    `);

    expect(appliedMigrationNames).toEqual(expectedMigrationNames);
    expect(appliedRows.rows.map((row) => row.filename)).toEqual(expectedMigrationNames);
    expect(expectedMigrationNames).toEqual([...expectedMigrationNames].sort());
  });

  it('keeps the app schema unavailable to public and Data API roles', async () => {
    const result = await client.query<{ readonly has_public_privilege: boolean }>(`
      select exists (
        select 1
        from pg_namespace as namespace
        cross join lateral aclexplode(
          coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))
        ) as privilege
        where namespace.nspname = 'app'
          and privilege.grantee = 0
          and privilege.privilege_type in ('USAGE', 'CREATE')
      ) as has_public_privilege
    `);
    const directRolePrivileges = await client.query<{
      readonly allowed: boolean;
      readonly role_name: string;
    }>(`
      select role_name, has_schema_privilege(role_name, 'app', 'USAGE') as allowed
      from unnest(array['anon', 'authenticated', 'service_role']) as candidate(role_name)
      order by role_name
    `);

    expect(result.rows).toEqual([{ has_public_privilege: false }]);
    expect(directRolePrivileges.rows).toEqual([
      { allowed: false, role_name: 'anon' },
      { allowed: false, role_name: 'authenticated' },
      { allowed: false, role_name: 'service_role' },
    ]);
  });

  it('preserves the no-login runtime-role scaffold and constrained memberships', async () => {
    const roleNames = [
      'payreplayy_api',
      'payreplayy_api_runtime',
      'payreplayy_nonce_retention',
      'payreplayy_nonce_retention_runtime',
      'payreplayy_worker',
    ];
    const roles = await client.query<RoleRow>(
      `
        select
          rolname,
          rolcanlogin,
          rolsuper,
          rolcreatedb,
          rolcreaterole,
          rolreplication,
          rolinherit,
          rolbypassrls
        from pg_roles
        where rolname = any($1::text[])
        order by rolname
      `,
      [roleNames],
    );
    const memberships = await client.query<MembershipRow>(
      `
      select
        member_role.rolname as member_role,
        group_role.rolname as group_role,
        membership.inherit_option,
        membership.set_option,
        membership.admin_option
      from pg_auth_members as membership
      join pg_roles as group_role on group_role.oid = membership.roleid
      join pg_roles as member_role on member_role.oid = membership.member
      where member_role.rolname = any($1::text[])
         or group_role.rolname = any($1::text[])
      order by member_role, group_role
    `,
      [roleNames],
    );

    expect(roles.rows).toHaveLength(roleNames.length);
    expect(
      roles.rows.every(
        (role) =>
          !role.rolcanlogin &&
          !role.rolsuper &&
          !role.rolcreatedb &&
          !role.rolcreaterole &&
          !role.rolreplication &&
          !role.rolinherit &&
          !role.rolbypassrls,
      ),
    ).toBe(true);
    expect(memberships.rows).toEqual([
      {
        admin_option: false,
        group_role: 'payreplayy_api',
        inherit_option: true,
        member_role: 'payreplayy_api_runtime',
        set_option: false,
      },
      {
        admin_option: false,
        group_role: 'payreplayy_nonce_retention',
        inherit_option: true,
        member_role: 'payreplayy_nonce_retention_runtime',
        set_option: false,
      },
    ]);
  });

  it('keeps every private app table under forced row-level security', async () => {
    const tables = await client.query<RlsRow>(`
      select class.relname, class.relrowsecurity, class.relforcerowsecurity
      from pg_class as class
      join pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'app'
        and class.relkind = 'r'
      order by class.relname
    `);

    expect(tables.rows.length).toBeGreaterThan(0);
    expect(tables.rows.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(
      true,
    );
  });

  it('does not leave private app functions executable by public', async () => {
    const publiclyExecutableFunctions = await client.query<{ readonly signature: string }>(`
      select procedure.oid::regprocedure::text as signature
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'app'
        and exists (
          select 1
          from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      order by signature
    `);

    expect(publiclyExecutableFunctions.rows).toEqual([]);
  });

  it('keeps postgres function default privileges closed to public execution', async () => {
    const defaultFunctionAcls = await client.query<{
      readonly public_execute_allowed: boolean;
      readonly scope: string;
    }>(`
      select
        case
          when default_acl.defaclnamespace = 0 then 'global'
          else namespace.nspname
        end as scope,
        exists (
          select 1
          from aclexplode(
            coalesce(default_acl.defaclacl, acldefault('f', default_acl.defaclrole))
          ) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ) as public_execute_allowed
      from pg_default_acl as default_acl
      left join pg_namespace as namespace on namespace.oid = default_acl.defaclnamespace
      where default_acl.defaclrole = 'postgres'::regrole
        and default_acl.defaclobjtype = 'f'
      order by scope
    `);

    expect(defaultFunctionAcls.rows).toContainEqual({
      public_execute_allowed: false,
      scope: 'global',
    });
    expect(defaultFunctionAcls.rows.every((defaultAcl) => !defaultAcl.public_execute_allowed)).toBe(
      true,
    );
  });

  it('keeps Player-ID action procedures ungranted to the API runtime scaffold', async () => {
    const actionProcedureGrants = await client.query<{
      readonly allowed: boolean;
      readonly procedure_name: string;
    }>(`
      select
        procedure_name,
        has_function_privilege(
          'payreplayy_api_runtime',
          procedure_name::regprocedure,
          'EXECUTE'
        ) as allowed
      from unnest(array[
        'app.issue_telegram_player_registration_capability(uuid,uuid,text,text)',
        'app.start_telegram_player_registration_action(uuid,uuid,text,text)',
        'app.submit_telegram_player_registration_input(uuid,text,text)',
        'app.expire_telegram_player_registration_action(uuid,text)'
      ]) as candidate(procedure_name)
      order by procedure_name
    `);

    expect(actionProcedureGrants.rows.every((procedure) => !procedure.allowed)).toBe(true);
  });
});
