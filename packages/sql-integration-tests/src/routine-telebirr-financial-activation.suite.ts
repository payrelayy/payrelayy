import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

export function registerRoutineTelebirrFinancialActivationSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
): void {
  describe('dormant routine TeleBirr financial activation boundary', () => {
    it('installs private SMS cutover actions without enabling money or matching', async () => {
      const client = getClient();
      const catalog = await client.query<{
        name: string;
        owner: string;
        security_definer: boolean;
        public_execute: boolean;
        authenticated_execute: boolean;
      }>(`select routine.proname as name, owner.rolname as owner,
                 routine.prosecdef as security_definer,
                 pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                   as public_execute,
                 pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
                   as authenticated_execute
            from pg_catalog.pg_proc routine
            join pg_catalog.pg_roles owner on owner.oid = routine.proowner
           where routine.oid in (
             'app.activate_receiver_sms_financial_gates(uuid,uuid)'::pg_catalog.regprocedure,
             'app.stop_receiver_sms_financial_gates(uuid,text)'::pg_catalog.regprocedure)
           order by routine.proname`);
      expect(catalog.rows).toEqual([
        {
          name: 'activate_receiver_sms_financial_gates',
          owner: 'postgres',
          security_definer: false,
          public_execute: false,
          authenticated_execute: false,
        },
        {
          name: 'stop_receiver_sms_financial_gates',
          owner: 'postgres',
          security_definer: false,
          public_execute: false,
          authenticated_execute: false,
        },
      ]);
      const state = await client.query<{ live: string; enabled: boolean; cutover: boolean }>(
        `select (select count(*)::text from app.feature_switches
                  where mode = 'live') as live,
                enabled, cutover_at is not null as cutover
           from app.receiver_sms_route_control where singleton`,
      );
      expect(state.rows).toEqual([{ live: '0', enabled: false, cutover: false }]);
    });

    it('fails closed when SMS activation prerequisites are absent', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        await client.query('savepoint rejected_sms_activation');
        await expect(
          client.query('select app.activate_receiver_sms_financial_gates($1::uuid,$2::uuid)', [
            getOwnerAuthUserId(),
            randomUUID(),
          ]),
        ).rejects.toThrow();
        await client.query('rollback to savepoint rejected_sms_activation');
        const state = await client.query<{ live: string; enabled: boolean }>(
          `select (select count(*)::text from app.feature_switches
                    where mode = 'live') as live, enabled
             from app.receiver_sms_route_control where singleton`,
        );
        expect(state.rows).toEqual([{ live: '0', enabled: false }]);
        const stopped = await client.query<{ changed: boolean }>(
          `select app.stop_receiver_sms_financial_gates(
             $1::uuid, 'operator_requested') as changed`,
          [randomUUID()],
        );
        expect(stopped.rows).toEqual([{ changed: false }]);
      } finally {
        await client.query('rollback');
      }
    });

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

    it('keeps the guarded TeleBirr stop available with CBE independently live', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        // Disposable database only: model the later independent CBE activation.
        await client.query('alter table app.feature_switches disable trigger user');
        await client.query(`update app.feature_switches set mode = 'live'
          where feature_key = 'cbe_birr_authoritative_verification'`);
        await client.query('alter table app.feature_switches enable trigger user');
        const stopped = await client.query<{ changed: boolean }>(
          `select app.stop_routine_telebirr_financial_gates(
             $1::uuid, 'operator_requested') as changed`,
          [randomUUID()],
        );
        expect(stopped.rows).toEqual([{ changed: false }]);
        const switches = await client.query<{ cbe_mode: string; shared_live_count: string }>(
          `select max(mode::text) filter (
                    where feature_key = 'cbe_birr_authoritative_verification') as cbe_mode,
                  count(*) filter (where feature_key in (
                    'payment_verification', 'deposit_execution') and mode = 'live')::text
                    as shared_live_count
             from app.feature_switches`,
        );
        expect(switches.rows).toEqual([{ cbe_mode: 'live', shared_live_count: '0' }]);

        await client.query('savepoint activation');
        let activationError: unknown;
        try {
          await client.query(
            'select app.activate_routine_telebirr_financial_gates($1::uuid,$2::uuid)',
            [getOwnerAuthUserId(), randomUUID()],
          );
        } catch (error) {
          activationError = error;
        }
        expect(String(activationError)).toContain(
          'The Owner-approved routine execution lane is not current and exact.',
        );
        await client.query('rollback to savepoint activation');
      } finally {
        await client.query('rollback');
      }
    });

    it('installs the postgres-only worker probe without turning deposits on', async () => {
      const client = getClient();
      const catalog = await client.query<{
        name: string;
        owner: string;
        public_execute: boolean;
        authenticated_execute: boolean;
      }>(`select routine.proname as name, owner.rolname as owner,
                 pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
                   as public_execute,
                 pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE')
                   as authenticated_execute
            from pg_catalog.pg_proc routine
            join pg_catalog.pg_roles owner on owner.oid = routine.proowner
           where routine.oid in (
             'app.routine_telebirr_signed_worker_recent(interval)'::pg_catalog.regprocedure,
             'app.require_routine_telebirr_worker_at_activation()'::pg_catalog.regprocedure,
             'app.observe_routine_telebirr_worker_liveness()'::pg_catalog.regprocedure)
           order by routine.proname`);
      expect(catalog.rows).toEqual([
        {
          name: 'observe_routine_telebirr_worker_liveness',
          owner: 'postgres',
          public_execute: false,
          authenticated_execute: false,
        },
        {
          name: 'require_routine_telebirr_worker_at_activation',
          owner: 'postgres',
          public_execute: false,
          authenticated_execute: false,
        },
        {
          name: 'routine_telebirr_signed_worker_recent',
          owner: 'postgres',
          public_execute: false,
          authenticated_execute: false,
        },
      ]);
      const result = await client.query<{ recent: boolean; observed: boolean }>(
        `select app.routine_telebirr_signed_worker_recent(interval '45 seconds') as recent,
                app.observe_routine_telebirr_worker_liveness() as observed`,
      );
      expect(result.rows).toEqual([{ recent: false, observed: false }]);
    });

    it('keeps verification and the durable execution queue live when the worker is absent', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        // Disposable database only: force the two switches live, then restore
        // triggers before invoking the read-only postgres liveness probe.
        await client.query('alter table app.feature_switches disable trigger user');
        await client.query(`update app.feature_switches set mode = 'live'
          where feature_key in ('payment_verification', 'deposit_execution')`);
        await client.query('alter table app.feature_switches enable trigger user');
        const result = await client.query<{ observed: boolean }>(
          'select app.observe_routine_telebirr_worker_liveness() as observed',
        );
        expect(result.rows).toEqual([{ observed: false }]);
        const switches = await client.query<{ live_count: string; disabled_count: string }>(
          `select count(*) filter (where mode = 'live')::text as live_count,
                  count(*) filter (where mode = 'disabled')::text as disabled_count
             from app.feature_switches
            where feature_key in (
              'cbe_birr_authoritative_verification', 'deposit_execution',
              'payment_verification', 'private_live_deposit_pilot',
              'telebirr_authoritative_verification', 'withdrawal_collection',
              'withdrawal_validation')`,
        );
        expect(switches.rows).toEqual([{ live_count: '2', disabled_count: '5' }]);
        const legacyStop = await client.query<{ exists: boolean }>(
          `select pg_catalog.to_regprocedure(
            'app.stop_stale_routine_telebirr_financial_gates()') is not null as exists`,
        );
        expect(legacyStop.rows).toEqual([{ exists: false }]);
      } finally {
        await client.query('rollback');
      }
    });

    it('yields no no-money poll assignment in exact live mode without weakening mixed-state rejection', async () => {
      const client = getClient();
      const enrollmentId = randomUUID();
      const requestId = randomUUID();
      const signerId = randomUUID();
      const poll = `select * from app.issue_routine_telebirr_no_money_poll_assignment(
        $1::uuid, $2::uuid, $3::text, pg_catalog.clock_timestamp() + interval '30 seconds',
        $4::uuid)`;
      const input = [enrollmentId, requestId, `sha256:${'a'.repeat(64)}`, signerId];
      await client.query('begin');
      try {
        // Disposable database only; rollback restores both the switches and trigger state.
        await client.query('alter table app.feature_switches disable trigger user');
        await client.query(`update app.feature_switches set mode = 'live'
          where feature_key in ('payment_verification', 'deposit_execution')`);
        const livePoll = await client.query(poll, input);
        expect(livePoll.rows).toEqual([]);
        const claims = await client.query<{ claim_count: string }>(
          `select count(*)::text as claim_count
             from app.routine_telebirr_no_money_poll_claims
            where request_id = $1::uuid`,
          [requestId],
        );
        expect(claims.rows).toEqual([{ claim_count: '0' }]);

        await client.query(`update app.feature_switches set mode = 'disabled'
          where feature_key = 'deposit_execution'`);
        await client.query('savepoint mixed_switch_set');
        await expect(client.query(poll, input)).rejects.toThrow(
          'The routine no-money boundary is unavailable.',
        );
        await client.query('rollback to savepoint mixed_switch_set');
      } finally {
        await client.query('rollback');
      }
    });
  });
}
