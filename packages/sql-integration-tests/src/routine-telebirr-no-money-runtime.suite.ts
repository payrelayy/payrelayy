import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL,
  ROUTINE_NO_MONEY_PREFLIGHT_KEYS,
} from '../../../apps/telebirr-assignment-broker/src/routine-no-money-runtime.js';

const group = 'fetanagent_routine_telebirr_no_money';
const runtime = 'fetanagent_routine_telebirr_no_money_runtime';
const allowed = [
  'load_routine_telebirr_no_money_enrollment',
  'issue_routine_telebirr_no_money_poll_assignment',
  'load_routine_telebirr_no_money_observation_material',
  'stage_routine_telebirr_no_money_observation_digest',
  'stage_routine_telebirr_no_money_signed_observation',
] as const;
const guarded = [
  ...allowed,
  'claim_routine_telebirr_no_money_poll',
  'issue_routine_telebirr_lookup_assignment_material',
  'issue_routine_telebirr_lookup_challenge',
] as const;

async function asRuntime<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query(`set session authorization ${runtime}`);
  try {
    return await work();
  } finally {
    await client.query('reset session authorization');
  }
}

export function registerRoutineTelebirrNoMoneyRuntimeSqlTests(getClient: () => Client): void {
  describe('separate no-money TeleBirr runtime boundary', () => {
    it('starts NOLOGIN/passwordless with one-way membership and no base object access', async () => {
      const client = getClient();
      const roles = await client.query<{
        name: string;
        login: boolean;
        inherits: boolean;
        superuser: boolean;
        bypassrls: boolean;
        createdb: boolean;
        createrole: boolean;
        replication: boolean;
        connection_limit: number;
        password_absent: boolean;
      }>(`
        select role.rolname as name, role.rolcanlogin as login,
               role.rolinherit as inherits, role.rolsuper as superuser,
               role.rolbypassrls as bypassrls, role.rolcreatedb as createdb,
               role.rolcreaterole as createrole, role.rolreplication as replication,
               role.rolconnlimit as connection_limit,
               role.rolpassword is null as password_absent
          from pg_catalog.pg_authid role
         where role.rolname in ('${group}', '${runtime}')
         order by role.rolname
      `);
      expect(roles.rows).toEqual([
        {
          name: group,
          login: false,
          inherits: false,
          superuser: false,
          bypassrls: false,
          createdb: false,
          createrole: false,
          replication: false,
          connection_limit: 2,
          password_absent: true,
        },
        {
          name: runtime,
          login: false,
          inherits: false,
          superuser: false,
          bypassrls: false,
          createdb: false,
          createrole: false,
          replication: false,
          connection_limit: 1,
          password_absent: true,
        },
      ]);
      const membership = await client.query<{
        granted: string;
        inherited: boolean;
        settable: boolean;
        admin: boolean;
      }>(`
        select granted.rolname as granted, membership.inherit_option as inherited,
               membership.set_option as settable, membership.admin_option as admin
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles granted on granted.oid = membership.roleid
          join pg_catalog.pg_roles member on member.oid = membership.member
         where member.rolname = '${runtime}'
      `);
      expect(membership.rows).toEqual([
        {
          granted: group,
          inherited: true,
          settable: false,
          admin: false,
        },
      ]);
      const baseAccess = await client.query<{ accessible: string }>(`
        select count(*)::text as accessible
          from pg_catalog.pg_class relation
         where relation.relnamespace = 'app'::pg_catalog.regnamespace
           and (
             (relation.relkind in ('r','p','v','m','f') and
               pg_catalog.has_table_privilege('${runtime}', relation.oid,
                 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
             or (relation.relkind = 'S' and
               pg_catalog.has_sequence_privilege('${runtime}', relation.oid,
                 'USAGE,SELECT,UPDATE'))
           )
      `);
      expect(baseAccess.rows).toEqual([{ accessible: '0' }]);
    });

    it('inherits exactly five external function grants and keeps nested issuers owner-only', async () => {
      const client = getClient();
      const grants = await client.query<{ name: string }>(`
        select routine.proname as name
          from pg_catalog.pg_proc routine
         where routine.pronamespace = 'app'::pg_catalog.regnamespace
           and pg_catalog.has_function_privilege('${runtime}', routine.oid, 'EXECUTE')
         order by routine.proname
      `);
      expect(grants.rows.map((row) => row.name)).toEqual([...allowed].sort());
      const functions = await client.query<{
        name: string;
        owner: string;
        definer: boolean;
        search_path: string[];
        guard_references: number;
      }>(
        `
        select routine.proname as name,
               routine.proowner::pg_catalog.regrole::text as owner,
               routine.prosecdef as definer,
               routine.proconfig as search_path,
               (pg_catalog.length(routine.prosrc) -
                pg_catalog.length(pg_catalog.replace(routine.prosrc,
                  'not app.routine_telebirr_no_money_session_allowed()', '')))
                / pg_catalog.length('not app.routine_telebirr_no_money_session_allowed()')
                 as guard_references
          from pg_catalog.pg_proc routine
         where routine.pronamespace = 'app'::pg_catalog.regnamespace
           and routine.proname = any($1::text[])
         order by routine.proname
      `,
        [[...guarded]],
      );
      expect(functions.rows).toHaveLength(8);
      expect(functions.rows.map((row) => row.name)).toEqual([...guarded].sort());
      for (const row of functions.rows) {
        expect(row).toMatchObject({
          owner: 'postgres',
          definer: true,
          search_path: ['search_path=pg_catalog'],
          guard_references: 1,
        });
      }
      const helperGrant = await client.query<{
        runtime_allowed: boolean;
        public_allowed: boolean;
      }>(`
        select pg_catalog.has_function_privilege('${runtime}',
                 'app.routine_telebirr_no_money_session_allowed()'::pg_catalog.regprocedure,
                 'EXECUTE') as runtime_allowed,
               pg_catalog.has_function_privilege('public',
                 'app.routine_telebirr_no_money_session_allowed()'::pg_catalog.regprocedure,
                 'EXECUTE') as public_allowed
      `);
      expect(helperGrant.rows).toEqual([{ runtime_allowed: false, public_allowed: false }]);
    });

    it('rejects the unprovisioned runtime even with an inherited function grant', async () => {
      const client = getClient();
      let rejected: unknown;
      try {
        await asRuntime(client, async () => {
          await client.query(
            'select * from app.load_routine_telebirr_no_money_enrollment($1::uuid)',
            [randomUUID()],
          );
        });
      } catch (error) {
        rejected = error;
      }
      expect(rejected).toBeInstanceOf(Error);
      expect(String(rejected)).toMatch(/no-money enrollment is unavailable/iu);
    });

    it('allows only a temporarily provisioned exact login to read and stage no-money data', async () => {
      const client = getClient();
      const validUntil = new Date(Date.now() + 60 * 60_000).toISOString();
      const digest = `sha256:${'a'.repeat(64)}`;
      await client.query('begin');
      try {
        await client.query(`alter role ${runtime} login valid until '${validUntil}'`);
        await asRuntime(client, async () => {
          expect(
            (
              await client.query(
                'select * from app.load_routine_telebirr_no_money_enrollment($1::uuid)',
                [randomUUID()],
              )
            ).rows,
          ).toEqual([]);
          expect(
            (
              await client.query(
                'select * from app.load_routine_telebirr_no_money_observation_material($1::uuid)',
                [randomUUID()],
              )
            ).rows,
          ).toEqual([]);
          expect(
            (
              await client.query<{ status: string }>(
                `select app.stage_routine_telebirr_no_money_observation_digest(
               $1::uuid,$2::text,$2::text,$2::text,$2::text) as status`,
                [randomUUID(), digest],
              )
            ).rows,
          ).toEqual([{ status: 'conflict' }]);
          expect(
            (
              await client.query<{ status: string }>(
                `select app.stage_routine_telebirr_no_money_signed_observation(
               $1::uuid,$2::text,$2::text,$2::text,$2::text,$3::jsonb,$4::text) as status`,
                [
                  randomUUID(),
                  digest,
                  JSON.stringify({ bodyDigest: digest }),
                  'receipt_policy_review',
                ],
              )
            ).rows,
          ).toEqual([{ status: 'conflict' }]);
        });
      } finally {
        await client.query('rollback');
        await client.query('reset session authorization');
      }
      const role = await client.query<{ login: boolean }>(
        `select rolcanlogin as login from pg_catalog.pg_roles where rolname = '${runtime}'`,
      );
      expect(role.rows).toEqual([{ login: false }]);
    });

    it('passes the runtime catalog preflight only during a bounded no-money login', async () => {
      const client = getClient();
      const validUntil = new Date(Date.now() + 60 * 60_000).toISOString();
      await client.query('begin');
      try {
        await client.query(`alter role ${runtime} login valid until '${validUntil}'`);
        await asRuntime(client, async () => {
          const result = await client.query<Record<string, boolean>>(
            ROUTINE_NO_MONEY_CATALOG_PREFLIGHT_SQL,
            [],
          );
          expect(result.rows).toHaveLength(1);
          for (const key of ROUTINE_NO_MONEY_PREFLIGHT_KEYS) {
            expect(result.rows[0]?.[key], key).toBe(true);
          }
        });
      } finally {
        await client.query('rollback');
        await client.query('reset session authorization');
      }
    });
  });
}
