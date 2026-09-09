import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type SqlValue = number | string | null;
type ContactRow = {
  readonly telegram_username: string | null;
  readonly revision: number;
  readonly updated_at: Date | null;
};

const readContactSql = 'select * from app.get_owner_support_contact($1::uuid)';
const saveContactSql =
  'select * from app.set_owner_support_contact($1::uuid, $2::text, $3::integer)';

const supportRoutines = [
  ['app.get_owner_support_contact(uuid)', 'support_contact_read_allowed'],
  ['app.set_owner_support_contact(uuid,text,integer)', 'support_contact_write_allowed'],
  ['app.get_public_support_contact()', 'support_contact_public_projection_allowed'],
] as const;

async function actualOwnerPreflightSql(): Promise<string> {
  // Read the production export itself: importing the application would require unrelated
  // runtime dependencies in this deliberately isolated, credential-free SQL test image.
  const source = await readFile(
    new URL('../../../apps/admin/src/postgres-runtime.ts', import.meta.url),
    'utf8',
  );
  const matches = [...source.matchAll(/export const OWNER_CONTROL_PREFLIGHT_SQL = `([^`]+)`;/gu)];
  expect(matches).toHaveLength(1);
  const sql = matches[0]![1]!;
  // The export is a literal. Fail instead of executing a differently interpreted template.
  expect(sql).not.toContain('${');
  expect(sql).not.toContain('\\');
  return sql;
}

async function runActualOwnerPreflight(client: Client): Promise<Record<string, boolean>> {
  const sql = await actualOwnerPreflightSql();
  await client.query('set session authorization fetanagent_owner_control_runtime');
  try {
    await client.query("set local search_path = 'pg_catalog'");
    const result = await client.query<Record<string, boolean>>(sql);
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  } finally {
    await client.query('reset session authorization');
  }
}

function expectEveryPreflightCheckReady(row: Record<string, boolean>): void {
  expect(Object.keys(row).length).toBeGreaterThan(30);
  expect(Object.entries(row).filter(([, value]) => value !== true)).toEqual([]);
}

async function executableOwnerFunctionCount(client: Client): Promise<number> {
  const result = await client.query<{ readonly count: number }>(`
    select count(*)::integer as count
      from pg_proc routine join pg_namespace namespace on namespace.oid = routine.pronamespace
     where namespace.nspname = 'app'
       and has_function_privilege('fetanagent_owner_control_runtime', routine.oid, 'EXECUTE')
  `);
  return result.rows[0]!.count;
}

async function queryWithSavepoint<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
  asOwner = true,
): Promise<readonly T[]> {
  await client.query('savepoint support_contact_query');
  try {
    if (asOwner) await client.query('set local role fetanagent_owner_control');
    const result = await client.query<T>(query, [...values]);
    if (asOwner) await client.query('reset role');
    await client.query('release savepoint support_contact_query');
    return result.rows;
  } catch (error) {
    await client.query('rollback to savepoint support_contact_query');
    await client.query('release savepoint support_contact_query');
    throw error;
  }
}

async function withRollback(client: Client, operation: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await operation();
  } finally {
    await client.query('rollback');
  }
}

async function ownerAuthId(client: Client, adminId: string): Promise<string> {
  const owner = await client.query<{ readonly auth_user_id: string }>(
    'select auth_user_id from app.admin_users where id = $1::uuid',
    [adminId],
  );
  expect(owner.rows).toHaveLength(1);
  return owner.rows[0]!.auth_user_id;
}

export function registerOwnerSupportContactSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
  createClient: () => Client,
): void {
  describe('Owner-controlled public Telegram support contact', () => {
    it('executes the actual startup preflight before and after the three support RPCs exist', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        // Only the disposable role is made login-capable, matching the production catalog
        // shape. No connection credentials or application functions are executed.
        await client.query('alter role fetanagent_owner_control_runtime login');
        await client.query('savepoint support_pre_migration_catalog');
        for (const [signature] of supportRoutines) {
          await client.query(`drop function ${signature}`);
        }
        expect(await executableOwnerFunctionCount(client)).toBe(33);
        expectEveryPreflightCheckReady(await runActualOwnerPreflight(client));

        // Restore the actual checked-in migration's functions and ACLs, not test doubles.
        // This models the formerly healthy process restarting after that additive migration.
        await client.query('rollback to savepoint support_pre_migration_catalog');
        await client.query('release savepoint support_pre_migration_catalog');
        expect(await executableOwnerFunctionCount(client)).toBe(36);
        expectEveryPreflightCheckReady(await runActualOwnerPreflight(client));
      });
    });

    it.each(supportRoutines)(
      'rejects a missing support grant for %s at actual startup',
      async (signature, check) => {
        const client = getClient();
        await withRollback(client, async () => {
          await client.query('alter role fetanagent_owner_control_runtime login');
          await client.query(
            `revoke execute on function ${signature} from fetanagent_owner_control`,
          );
          expect(await executableOwnerFunctionCount(client)).toBe(35);
          const row = await runActualOwnerPreflight(client);
          expect(row[check]).toBe(false);
          expect(row.exact_app_execute_count).toBe(false);
          expect(row.all_other_app_functions_denied).toBe(true);
        });
      },
    );

    it('rejects one unexpected executable function without weakening the support checks', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        await client.query('alter role fetanagent_owner_control_runtime login');
        await client.query(`
          create function app.sql_integration_unexpected_support_probe() returns boolean
          language sql set search_path = pg_catalog as 'select true';
          revoke all on function app.sql_integration_unexpected_support_probe() from public;
          grant execute on function app.sql_integration_unexpected_support_probe() to fetanagent_owner_control;
        `);
        expect(await executableOwnerFunctionCount(client)).toBe(37);
        const row = await runActualOwnerPreflight(client);
        expect(row.exact_app_execute_count).toBe(false);
        expect(row.all_other_app_functions_denied).toBe(false);
        for (const [, check] of supportRoutines) expect(row[check]).toBe(true);
      });
    });

    it('exposes only the three hardened RPCs to the Owner role and seals both tables', async () => {
      const client = getClient();
      const routines = await client.query<{
        readonly hardened: boolean;
        readonly owner_execute: boolean;
        readonly runtime_execute: boolean;
        readonly unwanted_grant: boolean;
      }>(`
        select routine.prosecdef and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened,
               has_function_privilege('fetanagent_owner_control', routine.oid, 'EXECUTE') as owner_execute,
               has_function_privilege('fetanagent_owner_control_runtime', routine.oid, 'EXECUTE') as runtime_execute,
               exists (
                 select 1 from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) acl
                  where acl.grantee not in ('postgres'::regrole, 'fetanagent_owner_control'::regrole)
               ) as unwanted_grant
          from pg_proc routine
         where routine.oid = any(array[
           'app.get_owner_support_contact(uuid)'::regprocedure,
           'app.set_owner_support_contact(uuid,text,integer)'::regprocedure,
           'app.get_public_support_contact()'::regprocedure
         ])
      `);
      expect(routines.rows).toHaveLength(3);
      expect(
        routines.rows.every((row) => row.hardened && row.owner_execute && row.runtime_execute),
      ).toBe(true);
      expect(routines.rows.every((row) => !row.unwanted_grant)).toBe(true);

      const tables = await client.query<{
        readonly sealed: boolean;
        readonly unwanted_grant: boolean;
      }>(`
        select relation.relrowsecurity and relation.relforcerowsecurity
                 and relation.relowner = 'postgres'::regrole
                 and not exists (select 1 from pg_policy policy where policy.polrelid = relation.oid) as sealed,
               exists (
                 select 1 from aclexplode(coalesce(relation.relacl, acldefault('r', relation.relowner))) acl
                  where acl.grantee <> 'postgres'::regrole
               ) as unwanted_grant
          from pg_class relation where relation.oid = any(array[
            'app.private_support_contact'::regclass,
            'app.private_support_contact_revisions'::regclass
          ])
      `);
      expect(tables.rows).toEqual([
        { sealed: true, unwanted_grant: false },
        { sealed: true, unwanted_grant: false },
      ]);
      const grants = await client.query<{ readonly role_name: string }>(`
        select role.rolname as role_name from pg_roles role
         where (role.rolname like 'fetanagent_%' or role.rolname in ('anon', 'authenticated', 'service_role'))
           and (
             has_table_privilege(role.oid, 'app.private_support_contact', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             or has_table_privilege(role.oid, 'app.private_support_contact_revisions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             or has_function_privilege(role.oid, 'app.reject_support_contact_revision_mutation()', 'EXECUTE')
           )
      `);
      expect(grants.rows).toEqual([]);
    });

    it('starts disabled at revision zero and redacts public output to the username only', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const authId = await ownerAuthId(client, getOwnerAdminId());
        const before = await queryWithSavepoint<ContactRow>(client, readContactSql, [authId]);
        expect(before).toHaveLength(1);
        expect(before[0]).toEqual({
          telegram_username: null,
          revision: 0,
          updated_at: null,
        });
        expect(Object.keys(before[0]!).sort()).toEqual([
          'revision',
          'telegram_username',
          'updated_at',
        ]);
        expect(
          await queryWithSavepoint(client, 'select * from app.get_public_support_contact()'),
        ).toEqual([{ telegram_username: null }]);
        expect(await queryWithSavepoint(client, saveContactSql, [authId, null, 0])).toEqual(before);
        for (const invalidBaseline of [
          "update app.private_support_contact set telegram_username = 'test_support'",
          'update app.private_support_contact set updated_at = clock_timestamp()',
          'update app.private_support_contact set revision = 1',
          'insert into app.private_support_contact values (false, null, 0, null)',
        ]) {
          await expect(
            queryWithSavepoint(client, invalidBaseline, [], false),
          ).rejects.toMatchObject({ code: '23514' });
        }
        expect(
          (await client.query('select * from app.private_support_contact_revisions')).rows,
        ).toEqual([]);
      });
    });

    it('saves, exactly replays, and disables with one immutable attributed revision per real change', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const authId = await ownerAuthId(client, getOwnerAdminId());
        const first = await queryWithSavepoint<ContactRow>(client, saveContactSql, [
          authId,
          'test_support',
          0,
        ]);
        expect(first[0]).toEqual({
          telegram_username: 'test_support',
          revision: 1,
          updated_at: expect.any(Date),
        });
        expect(
          await queryWithSavepoint(client, saveContactSql, [authId, 'test_support', 1]),
        ).toEqual(first);
        await expect(
          queryWithSavepoint(client, saveContactSql, [authId, 'test_support', 0]),
        ).rejects.toMatchObject({ code: '40001' });
        expect(
          await queryWithSavepoint(client, 'select * from app.get_public_support_contact()'),
        ).toEqual([{ telegram_username: 'test_support' }]);
        const disabled = await queryWithSavepoint<ContactRow>(client, saveContactSql, [
          authId,
          null,
          1,
        ]);
        expect(disabled[0]).toMatchObject({ telegram_username: null, revision: 2 });
        expect(await queryWithSavepoint(client, saveContactSql, [authId, null, 2])).toEqual(
          disabled,
        );
        const history = await client.query(`
          select revision, previous_username, telegram_username, changed_by_admin_id, changed_at
            from app.private_support_contact_revisions order by revision
        `);
        expect(history.rows).toEqual([
          {
            revision: 1,
            previous_username: null,
            telegram_username: 'test_support',
            changed_by_admin_id: getOwnerAdminId(),
            changed_at: first[0]!.updated_at,
          },
          {
            revision: 2,
            previous_username: 'test_support',
            telegram_username: null,
            changed_by_admin_id: getOwnerAdminId(),
            changed_at: disabled[0]!.updated_at,
          },
        ]);
        for (const mutation of [
          'update app.private_support_contact_revisions set changed_at = now()',
          'delete from app.private_support_contact_revisions',
          'truncate app.private_support_contact_revisions',
        ]) {
          await expect(queryWithSavepoint(client, mutation, [], false)).rejects.toMatchObject({
            code: '42501',
          });
        }
        await expect(
          queryWithSavepoint(
            client,
            `
          insert into app.private_support_contact_revisions
          select * from app.private_support_contact_revisions where revision = 1
        `,
            [],
            false,
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          queryWithSavepoint(
            client,
            `
          insert into app.private_support_contact select * from app.private_support_contact
        `,
            [],
            false,
          ),
        ).rejects.toMatchObject({ code: '23505' });
      });
    });

    it('rejects noncanonical input, invalid revisions and stale writes without changing state', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const authId = await ownerAuthId(client, getOwnerAdminId());
        const before = await queryWithSavepoint(client, readContactSql, [authId]);
        for (const username of [
          '',
          'abcd',
          'a'.repeat(33),
          'MixedCase',
          '@support',
          ' support',
          'support ',
          'https://t.me/support',
          'test-support',
          'test.support',
          'support\n',
          'suppört',
          '支持团队',
        ]) {
          await expect(
            queryWithSavepoint(client, saveContactSql, [authId, username, 0]),
          ).rejects.toMatchObject({ code: '22023' });
        }
        for (const revision of [null, -1]) {
          await expect(
            queryWithSavepoint(client, saveContactSql, [authId, 'test_support', revision]),
          ).rejects.toMatchObject({ code: '22023' });
        }
        await expect(
          queryWithSavepoint(client, saveContactSql, [authId, null, 1]),
        ).rejects.toMatchObject({ code: '40001' });
        // SQL has a text-only signature; it does not accept a numeric username overload.
        await expect(
          queryWithSavepoint(
            client,
            'select * from app.set_owner_support_contact($1::uuid, 12345, 0)',
            [authId],
          ),
        ).rejects.toMatchObject({ code: '42883' });
        expect(await queryWithSavepoint(client, readContactSql, [authId])).toEqual(before);
        expect(
          (await client.query('select * from app.private_support_contact_revisions')).rows,
        ).toEqual([]);
        expect(
          (await queryWithSavepoint<ContactRow>(client, saveContactSql, [authId, '1_234', 0]))[0],
        ).toMatchObject({ telegram_username: '1_234', revision: 1 });
        expect(
          (
            await queryWithSavepoint<ContactRow>(client, saveContactSql, [
              authId,
              'a'.repeat(32),
              1,
            ])
          )[0],
        ).toMatchObject({ telegram_username: 'a'.repeat(32), revision: 2 });
      });
    });

    it('requires an active Owner identity for both Owner RPCs', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const inactiveOwner = randomUUID();
        const administrator = randomUUID();
        await client.query('insert into auth.users (id) values ($1::uuid), ($2::uuid)', [
          inactiveOwner,
          administrator,
        ]);
        await client.query(
          `
          insert into app.admin_users (auth_user_id, role, status)
          values ($1::uuid, 'owner', 'inactive'), ($2::uuid, 'administrator', 'active')
        `,
          [inactiveOwner, administrator],
        );
        for (const deniedId of [null, randomUUID(), inactiveOwner, administrator]) {
          await expect(
            queryWithSavepoint(client, readContactSql, [deniedId]),
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            queryWithSavepoint(client, saveContactSql, [deniedId, 'test_support', 0]),
          ).rejects.toMatchObject({ code: '42501' });
        }
        expect(
          (await client.query('select * from app.private_support_contact_revisions')).rows,
        ).toEqual([]);
      });
    });

    it('checks the exact session role instead of accepting group membership alone', async () => {
      const client = createClient();
      await client.connect();
      const authId = await ownerAuthId(getClient(), getOwnerAdminId());
      try {
        await client.query('set session authorization fetanagent_owner_control');
        for (const [query, values] of [
          [readContactSql, [authId]],
          [saveContactSql, [authId, 'test_support', 0]],
          ['select * from app.get_public_support_contact()', []],
        ] as const) {
          await expect(client.query(query, [...values])).rejects.toMatchObject({ code: '42501' });
        }
        await client.query('reset session authorization');
        await client.query('set session authorization fetanagent_owner_control_runtime');
        expect((await client.query(readContactSql, [authId])).rows[0]).toMatchObject({
          telegram_username: null,
          revision: 0,
        });
        expect((await client.query('select * from app.get_public_support_contact()')).rows).toEqual(
          [{ telegram_username: null }],
        );
        await expect(
          client.query('select * from app.private_support_contact'),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('select * from app.private_support_contact_revisions'),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await client.end();
      }
    });

    it('rolls back the history insert when the singleton update fails', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const authId = await ownerAuthId(client, getOwnerAdminId());
        const before = await queryWithSavepoint(client, readContactSql, [authId]);
        await client.query(`
          create function sql_integration.reject_support_contact_update() returns trigger
          language plpgsql set search_path = pg_catalog as $$
          begin raise exception using errcode = '23514', message = 'Test update rejection'; end; $$;
          create trigger test_support_contact_update_failure
          before update on app.private_support_contact
          for each row execute function sql_integration.reject_support_contact_update();
        `);
        await expect(
          queryWithSavepoint(client, saveContactSql, [authId, 'test_support', 0]),
        ).rejects.toMatchObject({ code: '23514' });
        expect(await queryWithSavepoint(client, readContactSql, [authId])).toEqual(before);
        expect(
          (await client.query('select * from app.private_support_contact_revisions')).rows,
        ).toEqual([]);
      });
    });

    it('rejects revision overflow without partial writes', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const authId = await ownerAuthId(client, getOwnerAdminId());
        await client.query(
          'update app.private_support_contact set revision = 2147483647, updated_at = clock_timestamp()',
        );
        await expect(
          queryWithSavepoint(client, saveContactSql, [authId, 'test_support', 2147483647]),
        ).rejects.toMatchObject({ code: '22023' });
        expect(
          (await client.query('select * from app.private_support_contact_revisions')).rows,
        ).toEqual([]);
        expect(
          (await queryWithSavepoint<ContactRow>(client, readContactSql, [authId]))[0],
        ).toMatchObject({ telegram_username: null, revision: 2147483647 });
      });
    });

    it.each(['test_support', 'other_support'])(
      'serializes concurrent saves and rejects the stale %s request',
      async (secondUsername) => {
        const observer = getClient();
        const authId = await ownerAuthId(observer, getOwnerAdminId());
        const baseline = (await observer.query<ContactRow>(readContactSql, [authId])).rows[0]!;
        const historyBefore = await observer.query<{ readonly count: number }>(
          'select count(*)::integer as count from app.private_support_contact_revisions',
        );
        const left = createClient();
        const right = createClient();
        let pending: Promise<unknown> | undefined;
        await Promise.all([left.connect(), right.connect()]);
        try {
          for (const client of [left, right]) {
            await client.query('set session authorization fetanagent_owner_control_runtime');
            await client.query('begin');
            await client.query("set local statement_timeout = '8s'");
          }
          const leftPid = (
            await left.query<{ readonly pid: number }>('select pg_backend_pid() as pid')
          ).rows[0]!.pid;
          const rightPid = (
            await right.query<{ readonly pid: number }>('select pg_backend_pid() as pid')
          ).rows[0]!.pid;
          const saved = (
            await left.query<ContactRow>(saveContactSql, [
              authId,
              'test_support',
              baseline.revision,
            ])
          ).rows;
          const secondSave = right.query(saveContactSql, [
            authId,
            secondUsername,
            baseline.revision,
          ]);
          pending = secondSave;
          void secondSave.catch(() => undefined);
          let blockedByFirst = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const blocker = await observer.query<{ readonly blocked: boolean }>(
              'select $1::integer = any(pg_blocking_pids($2::integer)) as blocked',
              [leftPid, rightPid],
            );
            if (blocker.rows[0]!.blocked) {
              blockedByFirst = true;
              break;
            }
            await delay(20);
          }
          expect(blockedByFirst).toBe(true);
          expect((await observer.query<ContactRow>(readContactSql, [authId])).rows).toEqual([
            baseline,
          ]);
          expect(
            (
              await observer.query(
                'select count(*)::integer as count from app.private_support_contact_revisions',
              )
            ).rows,
          ).toEqual(historyBefore.rows);
          await left.query('commit');
          await expect(secondSave).rejects.toMatchObject({ code: '40001' });
          await right.query('rollback');
          expect((await observer.query<ContactRow>(readContactSql, [authId])).rows).toEqual(saved);
          const history = await observer.query(
            `
          select revision, previous_username, telegram_username, changed_by_admin_id, changed_at
            from app.private_support_contact_revisions where revision > $1::integer
        `,
            [baseline.revision],
          );
          expect(history.rows).toEqual([
            {
              revision: baseline.revision + 1,
              previous_username: baseline.telegram_username,
              telegram_username: 'test_support',
              changed_by_admin_id: getOwnerAdminId(),
              changed_at: saved[0]!.updated_at,
            },
          ]);
        } finally {
          // Release the blocker first so failure cleanup cannot wait on the blocked connection.
          await left.query('rollback');
          await pending?.catch(() => undefined);
          await right.query('rollback');
          await Promise.all([left.end(), right.end()]);
          // Keep the shared disposable fixture disabled using the same audited setter.
          const current = (await observer.query<ContactRow>(readContactSql, [authId])).rows[0]!;
          await observer.query(saveContactSql, [authId, null, current.revision]);
        }
      },
    );
  });
}
