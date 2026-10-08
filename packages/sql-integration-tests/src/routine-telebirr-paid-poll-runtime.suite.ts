import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  ROUTINE_PAID_POLL_CATALOG_PREFLIGHT_SQL,
  ROUTINE_PAID_POLL_PREFLIGHT_KEYS,
} from '../../../apps/telebirr-assignment-broker/src/routine-paid-poll-runtime.js';

const group = 'fetanagent_routine_telebirr_paid_poll';
const runtime = 'fetanagent_routine_telebirr_paid_poll_runtime';

async function asRuntime<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query(`set session authorization ${runtime}`);
  try {
    return await work();
  } finally {
    await client.query('reset session authorization');
  }
}

export function registerRoutineTelebirrPaidPollRuntimeSqlTests(getClient: () => Client): void {
  describe('separate paid TeleBirr phone poll runtime boundary', () => {
    it('starts without a login or password and inherits only two paid functions', async () => {
      const client = getClient();
      const roles = await client.query<{
        name: string;
        login: boolean;
        inherits: boolean;
        superuser: boolean;
        bypassrls: boolean;
        connection_limit: number;
        password_absent: boolean;
      }>(`select rolname as name, rolcanlogin as login, rolinherit as inherits,
                 rolsuper as superuser, rolbypassrls as bypassrls,
                 rolconnlimit as connection_limit, rolpassword is null as password_absent
            from pg_catalog.pg_authid where rolname in ('${group}', '${runtime}')
           order by rolname`);
      expect(roles.rows).toEqual([
        {
          name: group,
          login: false,
          inherits: false,
          superuser: false,
          bypassrls: false,
          connection_limit: 2,
          password_absent: true,
        },
        {
          name: runtime,
          login: false,
          inherits: false,
          superuser: false,
          bypassrls: false,
          connection_limit: 1,
          password_absent: true,
        },
      ]);
      const memberships = await client.query<{
        granted: string;
        inherited: boolean;
        settable: boolean;
        admin: boolean;
      }>(
        `select granted.rolname as granted, membership.inherit_option as inherited,
                membership.set_option as settable, membership.admin_option as admin
           from pg_catalog.pg_auth_members membership
           join pg_catalog.pg_roles granted on granted.oid = membership.roleid
           join pg_catalog.pg_roles member on member.oid = membership.member
          where member.rolname = '${runtime}'`,
      );
      expect(memberships.rows).toEqual([
        { granted: group, inherited: true, settable: false, admin: false },
      ]);
      const functions = await client.query<{ name: string }>(
        `select routine.proname as name from pg_catalog.pg_proc routine
          where routine.pronamespace = 'app'::pg_catalog.regnamespace
            and pg_catalog.has_function_privilege('${runtime}', routine.oid, 'EXECUTE')
          order by routine.proname`,
      );
      expect(functions.rows.map((row) => row.name)).toEqual([
        'issue_routine_telebirr_paid_poll_assignment',
        'load_routine_telebirr_paid_poll_enrollment',
      ]);
      const baseAccess = await client.query<{ accessible: string }>(
        `select count(*)::text as accessible from pg_catalog.pg_class relation
          where relation.relnamespace = 'app'::pg_catalog.regnamespace
            and ((relation.relkind in ('r','p','v','m','f') and
              pg_catalog.has_table_privilege('${runtime}', relation.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
              or (relation.relkind = 'S' and
                pg_catalog.has_sequence_privilege('${runtime}', relation.oid,
                  'USAGE,SELECT,UPDATE')))`,
      );
      expect(baseAccess.rows).toEqual([{ accessible: '0' }]);
    });

    it('keeps nested paid issuers, session guard, and other runtimes private', async () => {
      const client = getClient();
      const access = await client.query<Record<string, boolean>>(`select
        pg_catalog.has_function_privilege('public',
          'app.load_routine_telebirr_paid_poll_enrollment(uuid)', 'EXECUTE') as public_enrollment,
        pg_catalog.has_function_privilege('${runtime}',
          'app.routine_telebirr_paid_poll_session_allowed()', 'EXECUTE') as runtime_guard,
        pg_catalog.has_function_privilege('${runtime}',
          'app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)', 'EXECUTE') as nested_challenge,
        pg_catalog.has_function_privilege('fetanagent_routine_telebirr_no_money_runtime',
          'app.load_routine_telebirr_paid_poll_enrollment(uuid)', 'EXECUTE') as no_money_enrollment,
        pg_catalog.has_function_privilege('fetanagent_routine_telebirr_no_money_runtime',
          'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)',
          'EXECUTE') as no_money_issue,
        pg_catalog.has_function_privilege('${runtime}',
          'app.issue_routine_telebirr_no_money_poll_assignment(uuid,uuid,text,timestamptz,uuid)',
          'EXECUTE') as paid_can_issue_no_money`);
      expect(access.rows).toEqual([
        {
          public_enrollment: false,
          runtime_guard: false,
          nested_challenge: false,
          no_money_enrollment: false,
          no_money_issue: false,
          paid_can_issue_no_money: false,
        },
      ]);
      const guards = await client.query<{ name: string; guard_count: number }>(
        `select routine.proname as name,
           (pg_catalog.length(routine.prosrc) - pg_catalog.length(pg_catalog.replace(
             routine.prosrc, 'not app.routine_telebirr_paid_poll_session_allowed()', '')))
           / pg_catalog.length('not app.routine_telebirr_paid_poll_session_allowed()') as guard_count
         from pg_catalog.pg_proc routine
        where routine.pronamespace = 'app'::pg_catalog.regnamespace
          and routine.proname = any($1::text[]) order by routine.proname`,
        [
          [
            'load_routine_telebirr_paid_poll_enrollment',
            'issue_routine_telebirr_paid_poll_assignment',
            'issue_routine_telebirr_paid_lookup_assignment_material',
            'issue_routine_telebirr_paid_lookup_challenge',
          ],
        ],
      );
      expect(guards.rows).toHaveLength(4);
      expect(guards.rows.every((row) => row.guard_count === 1)).toBe(true);
    });

    it('rejects an unprovisioned identity but accepts a temporarily bounded login', async () => {
      const client = getClient();
      await expect(
        asRuntime(client, async () =>
          client.query('select * from app.load_routine_telebirr_paid_poll_enrollment($1::uuid)', [
            randomUUID(),
          ]),
        ),
      ).rejects.toThrow(/routine paid phone enrollment is unavailable/iu);
      await client.query('begin');
      try {
        const validUntil = new Date(Date.now() + 60 * 60_000).toISOString();
        await client.query(`alter role ${runtime} login valid until '${validUntil}'`);
        await asRuntime(client, async () => {
          const result = await client.query(
            'select * from app.load_routine_telebirr_paid_poll_enrollment($1::uuid)',
            [randomUUID()],
          );
          expect(result.rows).toEqual([]);
          const preflight = await client.query<Record<string, boolean>>(
            ROUTINE_PAID_POLL_CATALOG_PREFLIGHT_SQL,
            [],
          );
          expect(preflight.rows).toHaveLength(1);
          for (const key of ROUTINE_PAID_POLL_PREFLIGHT_KEYS) {
            expect(preflight.rows[0]?.[key], key).toBe(true);
          }
        });
      } finally {
        await client.query('rollback');
        await client.query('reset session authorization');
      }
    });
  });
}
