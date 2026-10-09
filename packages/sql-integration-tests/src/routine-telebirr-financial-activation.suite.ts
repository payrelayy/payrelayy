import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

export function registerRoutineTelebirrFinancialActivationSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
): void {
  describe('dormant routine TeleBirr financial activation boundary', () => {
    it('installs only postgres-owned private operator actions and keeps money off', async () => {
      const client = getClient();
      const catalog = await client.query<{
        name: string;
        owner: string;
        security_definer: boolean;
        config: string[];
        public_execute: boolean;
        authenticated_execute: boolean;
      }>(`select routine.proname as name, owner.rolname as owner,
                 routine.prosecdef as security_definer, routine.proconfig as config,
                 pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                   as public_execute,
                 pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
                   as authenticated_execute
            from pg_catalog.pg_proc routine
            join pg_catalog.pg_roles owner on owner.oid = routine.proowner
           where routine.oid in (
             'app.activate_routine_telebirr_financial_gates(uuid,uuid)'::pg_catalog.regprocedure,
             'app.stop_routine_telebirr_financial_gates(uuid,text)'::pg_catalog.regprocedure)
           order by routine.proname`);
      expect(catalog.rows).toEqual([
        {
          name: 'activate_routine_telebirr_financial_gates',
          owner: 'postgres',
          security_definer: false,
          config: ['search_path=pg_catalog'],
          public_execute: false,
          authenticated_execute: false,
        },
        {
          name: 'stop_routine_telebirr_financial_gates',
          owner: 'postgres',
          security_definer: false,
          config: ['search_path=pg_catalog'],
          public_execute: false,
          authenticated_execute: false,
        },
      ]);
      const switches = await client.query<{ disabled_count: string; total: string }>(
        `select count(*)::text as total,
                count(*) filter (where mode = 'disabled' and settings = '{}'::jsonb)::text
                  as disabled_count
           from app.feature_switches
          where feature_key in (
            'cbe_birr_authoritative_verification', 'deposit_execution',
            'payment_verification', 'private_live_deposit_pilot',
            'telebirr_authoritative_verification', 'withdrawal_collection',
            'withdrawal_validation')`,
      );
      expect(switches.rows).toEqual([{ total: '7', disabled_count: '7' }]);
    });

    it('rejects activation without a current paired transport and changes no switch', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query('savepoint rejected_activation');
        await expect(
          client.query('select app.activate_routine_telebirr_financial_gates($1::uuid,$2::uuid)', [
            getOwnerAuthUserId(),
            randomUUID(),
          ]),
        ).rejects.toThrow();
        await client.query('rollback to savepoint rejected_activation');
        const switches = await client.query<{ live_count: string }>(
          `select count(*) filter (where mode = 'live')::text as live_count
             from app.feature_switches
            where feature_key in ('payment_verification', 'deposit_execution')`,
        );
        expect(switches.rows).toEqual([{ live_count: '0' }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('makes an already stopped financial gate stop idempotent', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const stopped = await client.query<{ changed: boolean }>(
          `select app.stop_routine_telebirr_financial_gates(
             $1::uuid, 'operator_requested') as changed`,
          [randomUUID()],
        );
        expect(stopped.rows).toEqual([{ changed: false }]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
