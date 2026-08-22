import { randomUUID } from 'node:crypto';

import type { Client, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

type SqlValue = boolean | number | string | null;

async function queryAsOwnerControl<T extends QueryResultRow>(
  client: Client,
  query: string,
  values: readonly SqlValue[] = [],
): Promise<readonly T[]> {
  const savepoint = `owner_agent_query_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query('set local role fetanagent_owner_control');
    const result = await client.query<T>(query, [...values]);
    await client.query('reset role');
    await client.query(`release savepoint ${savepoint}`);
    return result.rows;
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    throw error;
  }
}

async function expectOwnerFailure(
  client: Client,
  query: string,
  values: readonly SqlValue[],
  pattern: RegExp,
): Promise<void> {
  let failure: unknown;
  try {
    await queryAsOwnerControl(client, query, values);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toMatch(pattern);
}

export function registerOwnerKemerbetAgentProfileControlSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('Owner-controlled KemerBet agent browser profile', () => {
    it('grants only redacted list and prepare routines without base-table authority', async () => {
      const client = getClient();
      const routines = await client.query<{
        readonly group_execute: boolean;
        readonly hardened: boolean;
        readonly public_execute: boolean;
        readonly runtime_execute: boolean;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               routine.prosecdef
                 and routine.proowner = 'postgres'::regrole
                 and routine.proconfig = array['search_path=pg_catalog']::text[] as hardened,
               has_function_privilege('fetanagent_owner_control', routine.oid, 'EXECUTE') as group_execute,
               has_function_privilege('fetanagent_owner_control_runtime', routine.oid, 'EXECUTE') as runtime_execute,
               exists (
                 select 1 from aclexplode(coalesce(routine.proacl, acldefault('f', routine.proowner))) acl
                  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
               ) as public_execute
          from pg_proc routine
         where routine.oid = any(array[
           'app.list_owner_kemerbet_agent_profiles(uuid)'::regprocedure,
           'app.prepare_owner_kemerbet_agent_profile(uuid,uuid,text)'::regprocedure
         ])
         order by signature
      `);
      expect(routines.rows).toHaveLength(2);
      expect(routines.rows.every((row) => row.hardened)).toBe(true);
      expect(routines.rows.every((row) => row.group_execute && row.runtime_execute)).toBe(true);
      expect(routines.rows.every((row) => !row.public_execute)).toBe(true);

      const boundary = await client.query<{
        readonly helpers_denied: boolean;
        readonly no_agent_table_access: boolean;
        readonly no_profile_table_access: boolean;
        readonly sealed_profile_table: boolean;
      }>(`
        select not has_table_privilege(
                 'fetanagent_owner_control_runtime', 'app.platform_agent_accounts',
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               ) as no_agent_table_access,
               not has_table_privilege(
                 'fetanagent_owner_control_runtime',
                 'app.private_owner_kemerbet_agent_profile_revisions',
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
               ) as no_profile_table_access,
               not has_function_privilege(
                 'fetanagent_owner_control_runtime',
                 'app.require_owner_kemerbet_agent_profile_controller()', 'EXECUTE'
               ) and not has_function_privilege(
                 'fetanagent_owner_control_runtime',
                 'app.enforce_owner_kemerbet_agent_profile_revision_immutable()', 'EXECUTE'
               ) and not has_function_privilege(
                 'fetanagent_owner_control_runtime',
                 'app.enforce_owner_configured_kemerbet_agent_account_immutable()', 'EXECUTE'
               ) as helpers_denied,
               relation.relrowsecurity and relation.relforcerowsecurity and not exists (
                 select 1 from pg_policy policy where policy.polrelid = relation.oid
               ) as sealed_profile_table
          from pg_class relation
         where relation.oid = 'app.private_owner_kemerbet_agent_profile_revisions'::regclass
      `);
      expect(boundary.rows).toEqual([
        {
          helpers_denied: true,
          no_agent_table_access: true,
          no_profile_table_access: true,
          sealed_profile_table: true,
        },
      ]);
    });

    it('prepares, exactly replays, rotates, and redacts immutable profile revisions', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id from app.admin_users
            where id = $1::uuid and role = 'owner' and status = 'active'`,
          [getOwnerAdminId()],
        );
        expect(owner.rows).toHaveLength(1);
        const authUserId = owner.rows[0]!.auth_user_id;
        const firstRequest = randomUUID();
        const prepareSql = `select * from app.prepare_owner_kemerbet_agent_profile(
          $1::uuid, $2::uuid, $3::text
        )`;
        const first = await queryAsOwnerControl<{
          readonly platform_agent_account_id: string;
          readonly profile_label: string;
          readonly profile_revision: number;
          readonly profile_status: string;
        }>(client, prepareSql, [authUserId, firstRequest, 'initial_configuration']);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
          profile_label: 'Primary KemerBet agent revision 1',
          profile_revision: 1,
          profile_status: 'active',
        });
        expect(
          await queryAsOwnerControl(client, prepareSql, [
            authUserId,
            firstRequest,
            'initial_configuration',
          ]),
        ).toEqual(first);
        await expectOwnerFailure(
          client,
          prepareSql,
          [authUserId, firstRequest, 'owner_correction'],
          /conflicts with its original use/u,
        );

        const second = await queryAsOwnerControl<{
          readonly platform_agent_account_id: string;
          readonly profile_revision: number;
          readonly profile_status: string;
        }>(client, prepareSql, [authUserId, randomUUID(), 'agent_rotation']);
        expect(second).toHaveLength(1);
        expect(second[0]).toMatchObject({ profile_revision: 2, profile_status: 'active' });

        const history = await queryAsOwnerControl(
          client,
          `
          select * from app.list_owner_kemerbet_agent_profiles($1::uuid)
        `,
          [authUserId],
        );
        expect(history).toHaveLength(2);
        expect(Object.keys(history[0] ?? {}).sort()).toEqual([
          'configuration_reason',
          'configured_at',
          'platform_agent_account_id',
          'platform_code',
          'profile_contract_version',
          'profile_label',
          'profile_revision',
          'profile_status',
          'retired_at',
        ]);
        expect(JSON.stringify(history)).not.toMatch(
          /credential|browser-profile-v1|password|cookie|otp/iu,
        );

        const lineage = await client.query<{
          readonly active_count: number;
          readonly audit_redacted: boolean;
          readonly exact_opaque_refs: boolean;
          readonly retired_count: number;
        }>(`
          select count(*) filter (where agent.status = 'active')::integer as active_count,
                 count(*) filter (where agent.status = 'inactive' and profile.retired_at is not null)::integer as retired_count,
                 bool_and(agent.credential_ref = 'kemerbet-browser-profile-v1:' || agent.id::text) as exact_opaque_refs,
                 not exists (
                   select 1
                     from app.audit_events audit
                     join app.private_owner_kemerbet_agent_profile_revisions audited_profile
                       on audited_profile.platform_agent_account_id = audit.resource_id
                    where audit.action = 'configuration.kemerbet_agent_profile_prepared'
                      and audit.metadata::text ~* '(credential|password|cookie|otp|session)'
                 ) as audit_redacted
            from app.private_owner_kemerbet_agent_profile_revisions profile
            join app.platform_agent_accounts agent on agent.id = profile.platform_agent_account_id
        `);
        expect(lineage.rows).toEqual([
          { active_count: 1, audit_redacted: true, exact_opaque_refs: true, retired_count: 1 },
        ]);

        await expect(
          client.query(
            `update app.platform_agent_accounts set credential_ref = 'mutated'
              where id = $1::uuid`,
            [second[0]!.platform_agent_account_id],
          ),
        ).rejects.toThrow(/immutable/u);
      } finally {
        await client.query('rollback');
      }
    });

    it('rejects preparation while any money switch or private pilot is active', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const owner = await client.query<{ readonly auth_user_id: string }>(
          `select auth_user_id from app.admin_users where id = $1::uuid`,
          [getOwnerAdminId()],
        );
        await client.query(`update app.feature_switches set mode = 'dry_run'
          where feature_key = 'payment_verification'`);
        await expectOwnerFailure(
          client,
          `select * from app.prepare_owner_kemerbet_agent_profile($1::uuid,$2::uuid,'owner_correction')`,
          [owner.rows[0]!.auth_user_id, randomUUID()],
          /requires every money switch to be disabled/u,
        );
      } finally {
        await client.query('rollback');
      }
    });
  });
}
