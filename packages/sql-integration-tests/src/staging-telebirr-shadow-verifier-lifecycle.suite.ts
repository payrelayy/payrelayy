import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const stagingProjectRef = 'spzpiyxheappsfyswewl';
const productionProjectRef = 'xzztugbgtulptnbpoelr';
const verifierGroup = 'fetanagent_telebirr_shadow_verifier';
const verifierRuntime = 'fetanagent_telebirr_shadow_verifier_runtime';
const ownerControlRole = 'fetanagent_owner_control';
const lifecycleAdvisoryLockName = 'fetanagent:staging:telebirr-shadow-verifier-runtime';
const disposablePsqlApplicationName = 'fetanagent_shadow_lifecycle_psql';
const provisionScript = fileURLToPath(
  new URL('../../../infra/sql/staging-telebirr-shadow-verifier-provision.sql', import.meta.url),
);
const statusScript = fileURLToPath(
  new URL('../../../infra/sql/staging-telebirr-shadow-verifier-status.sql', import.meta.url),
);
const disableScript = fileURLToPath(
  new URL('../../../infra/sql/staging-telebirr-shadow-verifier-disable.sql', import.meta.url),
);
const exactVerifierFunctions = [
  'app.complete_private_telebirr_shadow_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)',
  'app.load_next_private_telebirr_shadow_staged_evidence()',
  'app.load_private_telebirr_shadow_verification_authority(uuid,uuid,timestamp with time zone)',
  'app.quarantine_private_telebirr_shadow_staged_evidence(uuid,uuid,text,text)',
].sort();
const exactVerifierFunctionOids = exactVerifierFunctions
  .map((signature) => `pg_catalog.to_regprocedure('${signature}')`)
  .join(', ');
const financialSwitches = [
  'payment_verification',
  'deposit_execution',
  'withdrawal_validation',
  'withdrawal_collection',
  'cbe_birr_authoritative_verification',
  'telebirr_authoritative_verification',
] as const;
const allBoundarySwitches = [...financialSwitches, 'private_live_deposit_pilot'] as const;

type PsqlOptions = {
  readonly projectRef?: string;
  readonly runtimePassword?: string;
  readonly setRole?: typeof ownerControlRole;
};

type LifecycleStatus = {
  readonly activeRuntimeSessions: number;
  readonly deploymentTarget: string;
  readonly executorBoundary: string;
  readonly financialBoundary: string;
  readonly operation: string;
  readonly runtimeLogin: string;
  readonly schemaVersion: number;
};

type FeatureSwitchSnapshotRow = {
  readonly feature_key: string;
  readonly mode: string;
  readonly settings: unknown;
};

type Fixture = {
  readonly agentCreated: boolean;
  readonly agentId: string;
  readonly originalSwitches: readonly FeatureSwitchSnapshotRow[];
  readonly pilotRevisionId: string;
};

type RuntimeStateRow = {
  readonly password_fingerprint: string;
  readonly password_is_null: boolean;
  readonly rolbypassrls: boolean;
  readonly rolcanlogin: boolean;
  readonly rolconnlimit: number;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolinherit: boolean;
  readonly rolreplication: boolean;
  readonly rolsuper: boolean;
  readonly rolvaliduntil: string | null;
};

function runPsql(
  script: string,
  administratorPassword: string,
  options: PsqlOptions = {},
): Promise<string> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
  };
  for (const name of Object.keys(environment)) {
    if (
      /^PG[A-Z0-9_]*$/iu.test(name) ||
      name === 'DATABASE_URL' ||
      name === 'NONCE_RETENTION_DATABASE_URL'
    ) {
      delete environment[name];
    }
  }
  Object.assign(environment, {
    PGAPPNAME: disposablePsqlApplicationName,
    PGPASSFILE: '/dev/null',
    PGPASSWORD: administratorPassword,
    PGSERVICEFILE: '/dev/null',
    PGSSLMODE: 'disable',
    STAGING_PROJECT_REF: options.projectRef ?? stagingProjectRef,
  });

  if (options.runtimePassword === undefined) {
    delete environment.TELEBIRR_SHADOW_VERIFIER_RUNTIME_PASSWORD;
  } else {
    environment.TELEBIRR_SHADOW_VERIFIER_RUNTIME_PASSWORD = options.runtimePassword;
  }

  const argumentsList = [
    '-X',
    '--host=postgres',
    '--port=5432',
    '--username=postgres',
    '--dbname=postgres',
    '--quiet',
    '--tuples-only',
    '--no-align',
  ];
  if (options.setRole !== undefined) {
    argumentsList.push('--command', `set role ${options.setRole}`);
  }
  argumentsList.push('--file', script);

  return new Promise((resolve, reject) => {
    execFile(
      'psql',
      argumentsList,
      {
        encoding: 'utf8',
        env: environment,
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new Error(`Disposable psql invocation failed: ${stderr.trim() || error.message}`, {
              cause: error,
            }),
          );
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function parseLastJsonLine<T>(output: string): T {
  const jsonLine = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .findLast((line) => line.startsWith('{'));
  if (jsonLine === undefined) {
    throw new Error(`The lifecycle script returned no JSON result: ${output}`);
  }
  return JSON.parse(jsonLine) as T;
}

async function readRuntimeState(client: Client): Promise<RuntimeStateRow> {
  const result = await client.query<RuntimeStateRow>(`
    select role.rolcanlogin,
           role.rolinherit,
           role.rolsuper,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolreplication,
           role.rolbypassrls,
           role.rolconnlimit,
           role.rolvaliduntil::text,
           auth.rolpassword is null as password_is_null,
           pg_catalog.md5(coalesce(auth.rolpassword, '')) as password_fingerprint
      from pg_catalog.pg_roles role
      join pg_catalog.pg_authid auth on auth.oid = role.oid
     where role.rolname = '${verifierRuntime}'
  `);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

async function readNoMoneySnapshot(client: Client): Promise<string> {
  const result = await client.query<{ readonly snapshot: string }>(
    `
    select pg_catalog.jsonb_build_object(
      'switches', (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(feature_key, mode, settings)
          order by feature_key
        )
          from app.feature_switches
         where feature_key = any($1::text[])
      ),
      'financialRows', pg_catalog.jsonb_build_object(
        'depositIntents', (select count(*) from app.deposit_intents),
        'paymentClaims', (select count(*) from app.deposit_payment_claims),
        'depositJobs', (select count(*) from app.deposit_jobs),
        'executionAttempts', (select count(*) from app.deposit_execution_attempts),
        'reconciliations', (select count(*) from app.execution_reconciliations),
        'privatePilotReservations', (
          select count(*) from app.private_live_deposit_pilot_reservations
        )
      )
    )::text as snapshot
  `,
    [allBoundarySwitches],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.snapshot;
}

async function readLifecycleStatus(
  administratorPassword: string,
  options: PsqlOptions = {},
): Promise<LifecycleStatus> {
  return parseLastJsonLine<LifecycleStatus>(
    await runPsql(statusScript, administratorPassword, options),
  );
}

async function waitForProvisionAdvisoryWaiter(client: Client): Promise<number> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const activity = await client.query<{ readonly pid: number }>(
      `
      select activity.pid
        from pg_catalog.pg_stat_activity activity
       where activity.datname = pg_catalog.current_database()
         and activity.usename = 'postgres'
         and activity.application_name = $1::text
         and activity.wait_event_type = 'Lock'
         and activity.wait_event = 'advisory'
         and activity.query like '%pg_advisory_xact_lock%'
         and activity.query like '%fetanagent:staging:telebirr-shadow-verifier-runtime%'
       order by activity.backend_start desc
       limit 1
    `,
      [disposablePsqlApplicationName],
    );
    if (activity.rows[0] !== undefined) {
      return activity.rows[0].pid;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Provisioning never reached the expected advisory-lock wait.');
}

async function disableRuntimeDirectly(client: Client): Promise<void> {
  await client.query(`
    select pg_catalog.pg_terminate_backend(activity.pid, 5000)
      from pg_catalog.pg_stat_activity activity
     where activity.usename in ('${verifierGroup}', '${verifierRuntime}')
       and activity.pid <> pg_catalog.pg_backend_pid()
  `);
  await client.query(`
    alter role ${verifierGroup} with
      nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
      connection limit 2 password null valid until 'infinity';
    alter role ${verifierRuntime} with
      nologin noinherit nocreatedb nocreaterole noreplication nobypassrls
      connection limit 1 password null valid until 'infinity';
  `);
}

async function createArmedBoundaryFixture(
  client: Client,
  ownerAdminId: string,
  unsafeFinancialBoundary = false,
): Promise<Fixture> {
  await disableRuntimeDirectly(client);
  const openPilots = await client.query<{ readonly count: number }>(`
    select count(*)::integer as count
      from app.private_live_deposit_pilot_revisions
     where status in ('draft', 'armed')
  `);
  expect(openPilots.rows).toEqual([{ count: 0 }]);

  const originalSwitches = await client.query<FeatureSwitchSnapshotRow>(
    `
    select feature_key, mode, settings
      from app.feature_switches
     where feature_key = any($1::text[])
     order by feature_key
  `,
    [allBoundarySwitches],
  );
  expect(originalSwitches.rows).toHaveLength(7);

  const fixtureNonce = randomUUID();
  const digest = (suffix: string): string =>
    `sha256:${createHash('sha256').update(`${fixtureNonce}:${suffix}`).digest('hex')}`;

  await client.query('begin');
  try {
    await client.query(`set local session_replication_role = 'replica'`);
    const existingAgent = await client.query<{ readonly id: string }>(`
      select account.id
        from app.platform_agent_accounts account
        join app.platforms platform on platform.id = account.platform_id
       where platform.code = 'kemerbet'
         and account.status = 'active'
       order by account.id
       limit 1
       for update of account
    `);
    expect(existingAgent.rows.length).toBeLessThanOrEqual(1);

    let agentCreated = false;
    let agentId = existingAgent.rows[0]?.id;
    if (agentId === undefined) {
      const agent = await client.query<{ readonly id: string }>(
        `
        insert into app.platform_agent_accounts (platform_id, label, credential_ref)
        select platform.id, $1::text, 'secret://disposable-shadow-lifecycle-only'
          from app.platforms platform
         where platform.code = 'kemerbet'
        returning id
      `,
        [`shadow-lifecycle-${fixtureNonce}`],
      );
      expect(agent.rows).toHaveLength(1);
      agentId = agent.rows[0]!.id;
      agentCreated = true;
    }

    const pilot = await client.query<{ readonly id: string }>(
      `
      insert into app.private_live_deposit_pilot_revisions (
        prepare_request_key,
        prepare_request_digest,
        configuration_digest,
        status,
        platform_id,
        platform_agent_account_id,
        platform_agent_label_snapshot,
        platform_agent_updated_at_snapshot,
        minimum_amount_minor,
        maximum_per_deposit_minor,
        maximum_per_player_minor,
        maximum_aggregate_minor,
        maximum_reservation_count,
        active_from,
        expires_at,
        created_by_admin_id,
        armed_by_admin_id,
        armed_at
      )
      select pg_catalog.gen_random_uuid(),
             $1::text,
             $2::text,
             'armed',
             account.platform_id,
             account.id,
             account.label,
             account.updated_at,
             2500,
             2500,
             2500,
             12500,
             5,
             pg_catalog.clock_timestamp() - interval '1 minute',
             pg_catalog.clock_timestamp() + interval '2 hours',
             $3::uuid,
             $3::uuid,
             pg_catalog.clock_timestamp()
        from app.platform_agent_accounts account
       where account.id = $4::uuid
      returning id
    `,
      [digest('request'), digest('configuration'), ownerAdminId, agentId],
    );
    expect(pilot.rows).toHaveLength(1);
    const pilotRevisionId = pilot.rows[0]!.id;

    await client.query(
      `
      update app.feature_switches
         set mode = 'disabled', settings = '{}'::jsonb
       where feature_key = any($1::text[])
    `,
      [financialSwitches],
    );
    await client.query(
      `
      update app.feature_switches
         set mode = 'dry_run',
             settings = pg_catalog.jsonb_build_object(
               'contract_version', 1,
               'pilot_revision_id', $2::uuid,
               'configuration_digest', $3::text
             )
       where feature_key = $1::text
    `,
      ['private_live_deposit_pilot', pilotRevisionId, digest('configuration')],
    );
    if (unsafeFinancialBoundary) {
      await client.query(`
        update app.feature_switches
           set mode = 'live', settings = '{}'::jsonb
         where feature_key = 'payment_verification'
      `);
    }

    await client.query('commit');
    return { agentCreated, agentId, originalSwitches: originalSwitches.rows, pilotRevisionId };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function removeFixture(client: Client, fixture: Fixture): Promise<void> {
  await disableRuntimeDirectly(client);
  await client.query('begin');
  try {
    await client.query(`set local session_replication_role = 'replica'`);
    for (const switchState of fixture.originalSwitches) {
      await client.query(
        `update app.feature_switches
            set mode = $2::app.feature_mode,
                settings = $3::jsonb
          where feature_key = $1::text`,
        [switchState.feature_key, switchState.mode, JSON.stringify(switchState.settings)],
      );
    }
    await client.query(`delete from app.private_live_deposit_pilot_revisions where id = $1::uuid`, [
      fixture.pilotRevisionId,
    ]);
    if (fixture.agentCreated) {
      await client.query(`delete from app.platform_agent_accounts where id = $1::uuid`, [
        fixture.agentId,
      ]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function withFixture(
  client: Client,
  ownerAdminId: string,
  testBody: (fixture: Fixture) => Promise<void>,
  unsafeFinancialBoundary = false,
): Promise<void> {
  const fixture = await createArmedBoundaryFixture(client, ownerAdminId, unsafeFinancialBoundary);
  try {
    await testBody(fixture);
  } finally {
    await removeFixture(client, fixture);
  }
}

async function expectExactLifecycleAcl(
  client: Client,
  runtimeLoginExpected: boolean,
): Promise<void> {
  const roles = await client.query<{
    readonly rolbypassrls: boolean;
    readonly rolcanlogin: boolean;
    readonly rolconnlimit: number;
    readonly rolcreatedb: boolean;
    readonly rolcreaterole: boolean;
    readonly rolinherit: boolean;
    readonly rolname: string;
    readonly rolreplication: boolean;
    readonly rolsuper: boolean;
  }>(`
    select role.rolname, role.rolcanlogin, role.rolinherit, role.rolsuper,
           role.rolcreatedb, role.rolcreaterole, role.rolreplication,
           role.rolbypassrls, role.rolconnlimit
      from pg_catalog.pg_roles role
     where role.rolname in ('${verifierGroup}', '${verifierRuntime}')
     order by role.rolname
  `);
  expect(roles.rows).toEqual([
    {
      rolbypassrls: false,
      rolcanlogin: false,
      rolconnlimit: 2,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolname: verifierGroup,
      rolreplication: false,
      rolsuper: false,
    },
    {
      rolbypassrls: false,
      rolcanlogin: runtimeLoginExpected,
      rolconnlimit: 1,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolname: verifierRuntime,
      rolreplication: false,
      rolsuper: false,
    },
  ]);

  const membership = await client.query<{
    readonly admin_option: boolean;
    readonly group_role: string;
    readonly inherit_option: boolean;
    readonly member_role: string;
    readonly set_option: boolean;
  }>(`
    select granted.rolname as group_role,
           member.rolname as member_role,
           membership.inherit_option,
           membership.set_option,
           membership.admin_option
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
     where granted.rolname in ('${verifierGroup}', '${verifierRuntime}')
        or member.rolname in ('${verifierGroup}', '${verifierRuntime}')
     order by group_role, member_role
  `);
  expect(membership.rows).toEqual([
    {
      admin_option: false,
      group_role: verifierGroup,
      inherit_option: true,
      member_role: verifierRuntime,
      set_option: false,
    },
  ]);

  const boundary = await client.query<{
    readonly app_schema_boundary_allowed: boolean;
    readonly database_boundary_allowed: boolean;
    readonly group_usage_allowed_set_denied: boolean;
    readonly no_non_system_schema_create: boolean;
    readonly non_system_schema_usage_exact: boolean;
  }>(`
    select pg_catalog.pg_has_role(
             '${verifierRuntime}', '${verifierGroup}', 'USAGE'
           )
           and not pg_catalog.pg_has_role(
             '${verifierRuntime}', '${verifierGroup}', 'SET'
           ) as group_usage_allowed_set_denied,
           pg_catalog.has_database_privilege(
             '${verifierRuntime}', pg_catalog.current_database(), 'CONNECT'
           )
           and pg_catalog.has_database_privilege(
             '${verifierRuntime}', pg_catalog.current_database(), 'TEMP'
           )
           and not pg_catalog.has_database_privilege(
             '${verifierRuntime}', pg_catalog.current_database(), 'CREATE'
           ) as database_boundary_allowed,
           pg_catalog.has_schema_privilege('${verifierRuntime}', 'app', 'USAGE')
           and not pg_catalog.has_schema_privilege(
             '${verifierRuntime}', 'app', 'CREATE'
           ) as app_schema_boundary_allowed,
           (
             select coalesce(
                pg_catalog.array_agg(
                  namespace.nspname::text order by namespace.nspname
                ),
               '{}'::text[]
             ) = array['app', 'public']::text[]
               from pg_catalog.pg_namespace namespace
              where namespace.nspname not in ('pg_catalog', 'information_schema')
                and namespace.nspname !~ '^pg_(toast|temp)'
                and pg_catalog.has_schema_privilege(
                  '${verifierRuntime}', namespace.oid, 'USAGE'
                )
           ) as non_system_schema_usage_exact,
           not exists (
             select 1
               from pg_catalog.pg_namespace namespace
              where namespace.nspname not in ('pg_catalog', 'information_schema')
                and namespace.nspname !~ '^pg_(toast|temp)'
                and pg_catalog.has_schema_privilege(
                  '${verifierRuntime}', namespace.oid, 'CREATE'
                )
           ) as no_non_system_schema_create
  `);
  expect(boundary.rows).toEqual([
    {
      app_schema_boundary_allowed: true,
      database_boundary_allowed: true,
      group_usage_allowed_set_denied: true,
      no_non_system_schema_create: true,
      non_system_schema_usage_exact: true,
    },
  ]);

  const functions = await client.query<{
    readonly hardened: boolean;
    readonly signature: string;
  }>(`
    select routine.oid::regprocedure::text as signature,
           routine.prosecdef
             and routine.proowner = 'postgres'::regrole
             and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
     where namespace.nspname not in ('pg_catalog', 'information_schema')
       and namespace.nspname !~ '^pg_(toast|temp)'
       and pg_catalog.has_schema_privilege('${verifierRuntime}', namespace.oid, 'USAGE')
       and pg_catalog.has_function_privilege('${verifierRuntime}', routine.oid, 'EXECUTE')
     order by signature
  `);
  expect(functions.rows).toEqual(
    exactVerifierFunctions.map((signature) => ({ hardened: true, signature })),
  );

  const forbiddenAccess = await client.query<{
    readonly relation_access_count: number;
  }>(`
    select (
             select count(*)::integer
               from pg_catalog.pg_class relation
               join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
              where namespace.nspname not in ('pg_catalog', 'information_schema')
                and namespace.nspname !~ '^pg_(toast|temp)'
                and pg_catalog.has_schema_privilege(
                  '${verifierRuntime}', namespace.oid, 'USAGE'
                )
                and relation.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
                and (
                  pg_catalog.has_table_privilege(
                    '${verifierRuntime}', relation.oid,
                    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
                  )
                  or pg_catalog.has_any_column_privilege(
                    '${verifierRuntime}', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
                  )
                  or (
                    relation.relkind = 'S'
                    and pg_catalog.has_sequence_privilege(
                      '${verifierRuntime}', relation.oid, 'USAGE,SELECT,UPDATE'
                    )
                  )
                )
           ) as relation_access_count
  `);
  expect(forbiddenAccess.rows).toEqual([{ relation_access_count: 0 }]);

  const functionAcl = await client.query<{
    readonly allowed_functions_execution_private: boolean;
    readonly default_function_execution_private: boolean;
  }>(`
    select not exists (
             select 1
               from pg_catalog.pg_proc routine
               cross join lateral pg_catalog.aclexplode(
                 coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) privilege
              where routine.oid in (${exactVerifierFunctionOids})
                and privilege.privilege_type = 'EXECUTE'
                and privilege.grantee not in (
                  routine.proowner,
                  (select role.oid from pg_catalog.pg_roles role
                    where role.rolname = '${verifierGroup}')
                )
           ) as allowed_functions_execution_private,
           exists (
             select 1
               from pg_catalog.pg_default_acl defaults
               join pg_catalog.pg_roles owner on owner.oid = defaults.defaclrole
              where owner.rolname = 'postgres'
                and defaults.defaclnamespace = 0
                and defaults.defaclobjtype = 'f'
                and not exists (
                  select 1
                    from pg_catalog.aclexplode(defaults.defaclacl) privilege
                   where privilege.grantee = 0
                     and privilege.privilege_type = 'EXECUTE'
                )
           ) and not exists (
             select 1
               from pg_catalog.pg_default_acl defaults
               join pg_catalog.pg_roles owner on owner.oid = defaults.defaclrole
               cross join lateral pg_catalog.aclexplode(defaults.defaclacl) privilege
              where owner.rolname = 'postgres'
                and defaults.defaclobjtype = 'f'
                and privilege.grantee = 0
                and privilege.privilege_type = 'EXECUTE'
           ) as default_function_execution_private
  `);
  expect(functionAcl.rows).toEqual([
    {
      allowed_functions_execution_private: true,
      default_function_execution_private: true,
    },
  ]);
}

export function registerStagingTelebirrShadowVerifierLifecycleSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
  getAdministratorPassword: () => string,
  createRuntimeClient: (password: string) => Client,
): void {
  describe('staging TeleBirr shadow-verifier operational SQL lifecycle', () => {
    const executePsql = (script: string, options: PsqlOptions = {}): Promise<string> =>
      runPsql(script, getAdministratorPassword(), options);
    const readStatus = (options: PsqlOptions = {}): Promise<LifecycleStatus> =>
      readLifecycleStatus(getAdministratorPassword(), options);

    it('requires the workflow staging assertion and exact postgres operator', async () => {
      const client = getClient();
      await withFixture(client, getOwnerAdminId(), async () => {
        expect(await readStatus()).toEqual({
          activeRuntimeSessions: 0,
          deploymentTarget: 'staging',
          executorBoundary: 'disabled',
          financialBoundary: 'dry_run',
          operation: 'shadow_verifier_status',
          runtimeLogin: 'disabled',
          schemaVersion: 1,
        });

        const beforeRuntime = await readRuntimeState(client);
        const beforeNoMoney = await readNoMoneySnapshot(client);
        for (const script of [provisionScript, statusScript, disableScript]) {
          await expect(
            executePsql(script, {
              projectRef: productionProjectRef,
              runtimePassword: '1'.repeat(64),
            }),
          ).rejects.toThrow(/workflow-supplied staging project assertion/iu);
          await expect(
            executePsql(script, {
              runtimePassword: '1'.repeat(64),
              setRole: ownerControlRole,
            }),
          ).rejects.toThrow(/administrator session identity is not exact/iu);
        }
        await expect(
          executePsql(provisionScript, {
            runtimePassword: 'not-a-canonical-runtime-credential',
          }),
        ).rejects.toThrow(/credential is not canonical/iu);
        expect(await readRuntimeState(client)).toEqual(beforeRuntime);
        expect(await readNoMoneySnapshot(client)).toBe(beforeNoMoney);
      });
    });

    it('refuses an unsafe financial precondition without changing role or no-money state', async () => {
      const client = getClient();
      await withFixture(
        client,
        getOwnerAdminId(),
        async () => {
          expect(await readStatus()).toMatchObject({
            activeRuntimeSessions: 0,
            executorBoundary: 'disabled',
            financialBoundary: 'unsafe',
            runtimeLogin: 'disabled',
          });
          const beforeRuntime = await readRuntimeState(client);
          const beforeNoMoney = await readNoMoneySnapshot(client);
          await expect(
            executePsql(provisionScript, {
              runtimePassword: '2'.repeat(64),
            }),
          ).rejects.toThrow(/disabled financial boundary/iu);
          expect(await readRuntimeState(client)).toEqual(beforeRuntime);
          expect(await readNoMoneySnapshot(client)).toBe(beforeNoMoney);
        },
        true,
      );
    });

    it('serializes provision behind the session-scoped disable lifecycle lock across transaction boundaries', async () => {
      const client = getClient();
      await withFixture(client, getOwnerAdminId(), async () => {
        const runtimePassword = '6'.repeat(64);
        const beforeRuntime = await readRuntimeState(client);
        const beforeNoMoney = await readNoMoneySnapshot(client);
        let lifecycleLockHeld = false;
        let provisionAttempt:
          | Promise<
              | { readonly kind: 'fulfilled'; readonly output: string }
              | { readonly error: unknown; readonly kind: 'rejected' }
            >
          | undefined;

        try {
          await client.query('begin');
          await client.query(
            `select pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1::text, 0))`,
            [lifecycleAdvisoryLockName],
          );
          lifecycleLockHeld = true;
          await client.query('commit');

          provisionAttempt = executePsql(provisionScript, { runtimePassword }).then(
            (output) => ({ kind: 'fulfilled' as const, output }),
            (error: unknown) => ({ error, kind: 'rejected' as const }),
          );
          const waiterPid = await waitForProvisionAdvisoryWaiter(client);

          // The lock was acquired in the prior transaction. A complete additional transaction must
          // not release it or allow the standalone provision script to cross its xact-lock fence.
          await client.query('begin');
          await client.query('select 1');
          await client.query('commit');
          const stillWaiting = await client.query<{ readonly waiting: boolean }>(
            `
            select activity.wait_event_type = 'Lock'
                     and activity.wait_event = 'advisory'
                     and pg_catalog.pg_backend_pid() = any (
                       pg_catalog.pg_blocking_pids(activity.pid)
                     ) as waiting
              from pg_catalog.pg_stat_activity activity
             where activity.pid = $1::integer
               and activity.application_name = $2::text
          `,
            [waiterPid, disposablePsqlApplicationName],
          );
          expect(stillWaiting.rows).toEqual([{ waiting: true }]);
          expect(await readRuntimeState(client)).toEqual(beforeRuntime);
          expect(await readNoMoneySnapshot(client)).toBe(beforeNoMoney);

          const unlocked = await client.query<{ readonly released: boolean }>(
            `
            select pg_catalog.pg_advisory_unlock(
              pg_catalog.hashtextextended($1::text, 0)
            ) as released
          `,
            [lifecycleAdvisoryLockName],
          );
          expect(unlocked.rows).toEqual([{ released: true }]);
          lifecycleLockHeld = false;

          const provisionOutcome = await provisionAttempt;
          if (provisionOutcome.kind === 'rejected') {
            throw provisionOutcome.error;
          }
          expect(parseLastJsonLine(provisionOutcome.output)).toMatchObject({
            operation: 'shadow_verifier_bounded_runtime_provision',
            runtimeLogin: 'bounded_24_hours',
          });
          expect(parseLastJsonLine(await executePsql(disableScript))).toEqual({
            deploymentTarget: 'staging',
            financialSwitchesChanged: false,
            operation: 'shadow_verifier_runtime_disable',
            runtimeLogin: 'disabled',
            schemaVersion: 1,
          });
          expect(await readRuntimeState(client)).toEqual(beforeRuntime);
          expect(await readNoMoneySnapshot(client)).toBe(beforeNoMoney);
        } finally {
          if (lifecycleLockHeld) {
            await client.query(
              `select pg_catalog.pg_advisory_unlock(
                pg_catalog.hashtextextended($1::text, 0)
              )`,
              [lifecycleAdvisoryLockName],
            );
          }
          if (provisionAttempt !== undefined) {
            await provisionAttempt;
          }
          await disableRuntimeDirectly(client);
        }
      });
    });

    it('provisions one bounded login, refuses replay, then revokes and terminates it without money changes', async () => {
      const client = getClient();
      await withFixture(client, getOwnerAdminId(), async () => {
        const runtimePassword = '3'.repeat(64);
        const beforeNoMoney = await readNoMoneySnapshot(client);
        expect(await readStatus()).toMatchObject({
          activeRuntimeSessions: 0,
          executorBoundary: 'disabled',
          financialBoundary: 'dry_run',
          runtimeLogin: 'disabled',
        });

        expect(parseLastJsonLine(await executePsql(provisionScript, { runtimePassword }))).toEqual({
          deploymentTarget: 'staging',
          financialBoundary: 'dry_run',
          operation: 'shadow_verifier_bounded_runtime_provision',
          runtimeLogin: 'bounded_24_hours',
          schemaVersion: 1,
        });

        expect(await readStatus()).toEqual({
          activeRuntimeSessions: 0,
          deploymentTarget: 'staging',
          executorBoundary: 'disabled',
          financialBoundary: 'dry_run',
          operation: 'shadow_verifier_status',
          runtimeLogin: 'bounded',
          schemaVersion: 1,
        });
        const bounded = await client.query<{
          readonly exact_shape: boolean;
          readonly expected_ttl: boolean;
          readonly password_scram: boolean;
        }>(`
          select role.rolcanlogin
                   and not role.rolinherit
                   and not role.rolsuper
                   and not role.rolcreatedb
                   and not role.rolcreaterole
                   and not role.rolreplication
                   and not role.rolbypassrls
                   and role.rolconnlimit = 1 as exact_shape,
                 role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '23 hours 55 minutes'
                   and role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'
                   as expected_ttl,
                 auth.rolpassword like 'SCRAM-SHA-256$%' as password_scram
            from pg_catalog.pg_roles role
            join pg_catalog.pg_authid auth on auth.oid = role.oid
           where role.rolname = '${verifierRuntime}'
        `);
        expect(bounded.rows).toEqual([
          { exact_shape: true, expected_ttl: true, password_scram: true },
        ]);
        await expectExactLifecycleAcl(client, true);

        const beforeReplay = await readRuntimeState(client);
        await expect(
          executePsql(provisionScript, { runtimePassword: '4'.repeat(64) }),
        ).rejects.toThrow(/not disabled cleanly/iu);
        expect(await readRuntimeState(client)).toEqual(beforeReplay);

        const wrongPasswordClient = createRuntimeClient('9'.repeat(64));
        try {
          await expect(wrongPasswordClient.connect()).rejects.toThrow(
            /password authentication failed/iu,
          );
        } finally {
          await wrongPasswordClient.end().catch(() => undefined);
        }

        const runtimeClient = createRuntimeClient(runtimePassword);
        const runtimeConnectionErrors: Error[] = [];
        runtimeClient.on('error', (error) => runtimeConnectionErrors.push(error));
        await runtimeClient.connect();
        const excessRuntimeClient = createRuntimeClient(runtimePassword);
        try {
          await expect(excessRuntimeClient.connect()).rejects.toThrow(/too many connections/iu);
        } finally {
          await excessRuntimeClient.end().catch(() => undefined);
        }

        expect(await readStatus()).toMatchObject({
          activeRuntimeSessions: 1,
          executorBoundary: 'disabled',
          financialBoundary: 'dry_run',
          runtimeLogin: 'bounded',
        });

        try {
          expect(parseLastJsonLine(await executePsql(disableScript))).toEqual({
            deploymentTarget: 'staging',
            financialSwitchesChanged: false,
            operation: 'shadow_verifier_runtime_disable',
            runtimeLogin: 'disabled',
            schemaVersion: 1,
          });
          await expect(runtimeClient.query('select 1')).rejects.toThrow();
        } finally {
          await runtimeClient.end().catch(() => undefined);
        }
        expect(runtimeConnectionErrors.length).toBeLessThanOrEqual(1);

        expect(await readStatus()).toEqual({
          activeRuntimeSessions: 0,
          deploymentTarget: 'staging',
          executorBoundary: 'disabled',
          financialBoundary: 'dry_run',
          operation: 'shadow_verifier_status',
          runtimeLogin: 'disabled',
          schemaVersion: 1,
        });
        expect(await readRuntimeState(client)).toMatchObject({
          password_is_null: true,
          rolbypassrls: false,
          rolcanlogin: false,
          rolconnlimit: 1,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolsuper: false,
          rolvaliduntil: 'infinity',
        });
        await expectExactLifecycleAcl(client, false);
        expect(await readNoMoneySnapshot(client)).toBe(beforeNoMoney);
      });
    });

    it('rejects the correct credential after VALID UNTIL expires, then disables cleanly', async () => {
      const client = getClient();
      await withFixture(client, getOwnerAdminId(), async () => {
        const runtimePassword = '5'.repeat(64);
        const beforeNoMoney = await readNoMoneySnapshot(client);
        expect(parseLastJsonLine(await executePsql(provisionScript, { runtimePassword }))).toEqual({
          deploymentTarget: 'staging',
          financialBoundary: 'dry_run',
          operation: 'shadow_verifier_bounded_runtime_provision',
          runtimeLogin: 'bounded_24_hours',
          schemaVersion: 1,
        });
        await expectExactLifecycleAcl(client, true);

        await client.query(`
          alter role ${verifierRuntime}
            valid until '2000-01-01 00:00:00+00'
        `);
        expect(await readStatus()).toMatchObject({
          activeRuntimeSessions: 0,
          executorBoundary: 'disabled',
          financialBoundary: 'dry_run',
          runtimeLogin: 'unsafe',
        });

        const expiredClient = createRuntimeClient(runtimePassword);
        try {
          await expect(expiredClient.connect()).rejects.toThrow(/password authentication failed/iu);
        } finally {
          await expiredClient.end().catch(() => undefined);
        }

        expect(parseLastJsonLine(await executePsql(disableScript))).toEqual({
          deploymentTarget: 'staging',
          financialSwitchesChanged: false,
          operation: 'shadow_verifier_runtime_disable',
          runtimeLogin: 'disabled',
          schemaVersion: 1,
        });
        await expectExactLifecycleAcl(client, false);
        expect(await readNoMoneySnapshot(client)).toBe(beforeNoMoney);
      });
    });
  });
}
