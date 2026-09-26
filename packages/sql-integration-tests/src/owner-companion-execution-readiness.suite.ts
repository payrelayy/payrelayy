import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

export function registerOwnerCompanionExecutionReadinessSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
): void {
  describe('Owner companion execution readiness preview', () => {
    it('has exactly one Owner grant and no public, customer, worker, or execution grant', async () => {
      const result = await getClient().query<{
        readonly owner_allowed: boolean;
        readonly public_allowed: boolean;
        readonly customer_allowed: boolean;
        readonly executor_allowed: boolean;
        readonly bridge_allowed: boolean;
        readonly security_definer: boolean;
      }>(`
        select
          has_function_privilege('fetanagent_owner_control',
            'app.get_owner_companion_execution_readiness(uuid)', 'execute') as owner_allowed,
          has_function_privilege('public',
            'app.get_owner_companion_execution_readiness(uuid)', 'execute') as public_allowed,
          has_function_privilege('authenticated',
            'app.get_owner_companion_execution_readiness(uuid)', 'execute') as customer_allowed,
          has_function_privilege('fetanagent_deposit_executor_runtime',
            'app.get_owner_companion_execution_readiness(uuid)', 'execute') as executor_allowed,
          has_function_privilege('fetanagent_companion_execution_bridge',
            'app.get_owner_companion_execution_readiness(uuid)', 'execute') as bridge_allowed,
          routine.prosecdef as security_definer
        from pg_proc routine
        where routine.oid = 'app.get_owner_companion_execution_readiness(uuid)'::regprocedure
      `);
      expect(result.rows).toEqual([
        {
          owner_allowed: true,
          public_allowed: false,
          customer_allowed: false,
          executor_allowed: false,
          bridge_allowed: false,
          security_definer: true,
        },
      ]);
    });

    it('returns a redacted, non-activating snapshot inside a read-only transaction', async () => {
      const client = getClient();
      await client.query('begin read only');
      try {
        const result = await client.query<{ readonly readiness: Record<string, unknown> }>(
          'select app.get_owner_companion_execution_readiness($1::uuid) as readiness',
          [getOwnerAuthUserId()],
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]?.readiness).toMatchObject({
          activationAvailable: false,
          identifiersRedacted: true,
          readOnly: true,
        });
        expect(Object.keys(result.rows[0]!.readiness).sort()).toEqual([
          'activationAvailable',
          'cancelledUntouchedJobs',
          'companionExecutionDisabled',
          'customerResolutionPending',
          'effectiveTrustedEpochAvailable',
          'executionCapabilityDormant',
          'financialSwitchesDisabled',
          'identifiersRedacted',
          'nextAction',
          'openExecutionReviews',
          'openJobs',
          'pilotState',
          'readOnly',
          'untouchedQueuedJobs',
        ]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
