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
    it('keeps signed terminal negatives private and tied to seven-day retention', async () => {
      const client = getClient();
      const table = await client.query<{
        owner: string;
        row_security: boolean;
        forced: boolean;
        cascade_foreign_keys: string;
      }>(`select owner.rolname as owner, relation.relrowsecurity as row_security,
                 relation.relforcerowsecurity as forced,
                 count(*) filter (where fk_constraint.confdeltype = 'c')::text
                   as cascade_foreign_keys
            from pg_catalog.pg_class relation
            join pg_catalog.pg_roles owner on owner.oid = relation.relowner
            join pg_catalog.pg_constraint fk_constraint on fk_constraint.conrelid = relation.oid
           where relation.oid = 'app.routine_telebirr_paid_terminal_rejections'::regclass
           group by owner.rolname, relation.relrowsecurity, relation.relforcerowsecurity`);
      expect(table.rows).toEqual([
        {
          owner: 'postgres',
          row_security: true,
          forced: true,
          cascade_foreign_keys: '2',
        },
      ]);
      const source = await client.query<{ body: string }>(
        `select pg_catalog.pg_get_functiondef(
          'app.record_routine_telebirr_paid_terminal_result(uuid,jsonb)'::regprocedure) as body`,
      );
      expect(source.rows[0]?.body).toContain("feature_switch.mode = 'live'");
      expect(source.rows[0]?.body).toContain("'explicit_invalid_reference'");
      expect(source.rows[0]?.body).toContain("'invalid_reference'");
      const constraints = await client.query<{ name: string; definition: string }>(`
        select conname as name, pg_catalog.pg_get_constraintdef(oid) as definition
          from pg_catalog.pg_constraint
         where conrelid = 'app.routine_telebirr_paid_terminal_rejections'::regclass
           and conname in ('routine_paid_terminal_signed_shape',
             'routine_telebirr_paid_terminal_rejections_reason_code_check')
         order by conname`);
      expect(constraints.rows).toHaveLength(2);
      expect(
        constraints.rows.every((row) => row.definition.includes('explicit_invalid_reference')),
      ).toBe(true);
    });

    it('cannot place one candidate in another lane while its first upload is still acceptable', async () => {
      const client = getClient();
      const sources = await client.query<{ poll: string; nested: string }>(`
        select pg_catalog.pg_get_functiondef(
                 'app.issue_routine_telebirr_paid_poll_assignment(uuid,uuid,text,timestamptz,uuid)'
                   ::pg_catalog.regprocedure) as poll,
               pg_catalog.pg_get_functiondef(
                 'app.issue_routine_telebirr_paid_lookup_challenge(uuid,uuid,uuid)'
                   ::pg_catalog.regprocedure) as nested`);
      expect(sources.rows).toHaveLength(1);
      expect(sources.rows[0]?.poll).toContain(
        "challenge.expires_at + interval '15 minutes' > v_now",
      );
      expect(sources.rows[0]?.nested).toContain(
        "challenge.expires_at + interval '15 minutes' > v_now",
      );
      expect(sources.rows[0]?.nested).toContain("challenge.issuance_mode = 'paid'");
    });

    it('starts without a login or password and inherits only six paid functions', async () => {
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
        'classify_routine_telebirr_paid_upload_terminal',
        'issue_routine_telebirr_paid_poll_assignment',
        'load_routine_telebirr_paid_observation_material',
        'load_routine_telebirr_paid_poll_enrollment',
        'record_routine_telebirr_paid_terminal_result',
        'stage_routine_telebirr_paid_signed_observation',
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
          'EXECUTE') as paid_can_issue_no_money,
        pg_catalog.has_function_privilege('public',
          'app.stage_routine_telebirr_paid_signed_observation(uuid,text,text,text,text,jsonb)',
          'EXECUTE') as public_paid_stage,
        pg_catalog.has_function_privilege('public',
          'app.classify_routine_telebirr_paid_upload_terminal(uuid,text,text)',
          'EXECUTE') as public_terminal,
        pg_catalog.has_function_privilege('fetanagent_routine_telebirr_no_money_runtime',
          'app.classify_routine_telebirr_paid_upload_terminal(uuid,text,text)',
          'EXECUTE') as no_money_terminal,
        pg_catalog.has_function_privilege('fetanagent_routine_telebirr_no_money_runtime',
          'app.stage_routine_telebirr_paid_signed_observation(uuid,text,text,text,text,jsonb)',
          'EXECUTE') as no_money_paid_stage,
        pg_catalog.has_function_privilege('public',
          'app.record_routine_telebirr_paid_terminal_result(uuid,jsonb)',
          'EXECUTE') as public_wrong_receiver,
        pg_catalog.has_function_privilege('fetanagent_routine_telebirr_no_money_runtime',
          'app.record_routine_telebirr_paid_terminal_result(uuid,jsonb)',
          'EXECUTE') as no_money_wrong_receiver`);
      expect(access.rows).toEqual([
        {
          public_enrollment: false,
          runtime_guard: false,
          nested_challenge: false,
          no_money_enrollment: false,
          no_money_issue: false,
          paid_can_issue_no_money: false,
          public_paid_stage: false,
          public_terminal: false,
          no_money_terminal: false,
          no_money_paid_stage: false,
          public_wrong_receiver: false,
          no_money_wrong_receiver: false,
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
            'load_routine_telebirr_paid_observation_material',
            'classify_routine_telebirr_paid_upload_terminal',
            'stage_routine_telebirr_paid_signed_observation',
            'record_routine_telebirr_paid_terminal_result',
          ],
        ],
      );
      expect(guards.rows).toHaveLength(8);
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
          const terminal = await client.query<{ terminal: boolean }>(
            `select app.classify_routine_telebirr_paid_upload_terminal(
              $1::uuid,$2::text,$3::text) as terminal`,
            [randomUUID(), `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`],
          );
          expect(terminal.rows).toEqual([{ terminal: false }]);
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

    it('keeps the paid observation inbox private, immutable, and without settlement access', async () => {
      const client = getClient();
      const result = await client.query<Record<string, boolean>>(`select
        (select relrowsecurity and relforcerowsecurity
          from pg_catalog.pg_class
         where oid = 'app.routine_telebirr_paid_observation_staging'::pg_catalog.regclass)
          as forced_rls,
        pg_catalog.has_table_privilege('${runtime}',
          'app.routine_telebirr_paid_observation_staging', 'SELECT') as runtime_select,
        pg_catalog.has_table_privilege('${runtime}',
          'app.routine_telebirr_paid_observation_staging', 'INSERT') as runtime_insert,
        pg_catalog.has_table_privilege('service_role',
          'app.routine_telebirr_paid_observation_staging', 'SELECT') as service_select`);
      expect(result.rows).toEqual([
        {
          forced_rls: true,
          runtime_select: false,
          runtime_insert: false,
          service_select: false,
        },
      ]);
      const trigger = await client.query<{ enabled: string }>(`select tgenabled as enabled
        from pg_catalog.pg_trigger where tgrelid =
          'app.routine_telebirr_paid_observation_staging'::pg_catalog.regclass
          and tgname = 'routine_paid_staging_no_update'`);
      expect(trigger.rows).toEqual([{ enabled: 'O' }]);
    });
  });
}
