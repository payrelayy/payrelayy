import { randomUUID } from 'node:crypto';

import type { Client, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  completeVerification,
  prepareTelebirrPilot,
  prepareVerification,
  type PreparedVerification,
  type TelebirrPilot,
} from './private-live-telebirr-proof-lineage.suite.js';

async function withRollback(client: Client, operation: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await operation();
  } finally {
    await client.query('rollback');
  }
}

async function failureAtSavepoint(
  client: Client,
  operation: () => Promise<unknown>,
): Promise<Error> {
  await client.query('savepoint activation_epoch_expected_failure');
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
    await client.query('rollback to savepoint activation_epoch_expected_failure');
  }
  await client.query('release savepoint activation_epoch_expected_failure');
  expect(failure).toBeInstanceOf(Error);
  return failure as Error;
}

async function readAuthority(
  client: Client,
  attemptId: string,
  leaseToken: string,
  occurredAt: Date,
): Promise<unknown> {
  const result = await client.query<{ readonly authority: unknown }>(
    `select app.load_private_live_telebirr_verification_authority(
       $1::uuid, $2::uuid, $3::timestamptz
     ) as authority`,
    [attemptId, leaseToken, occurredAt],
  );
  return result.rows[0]?.authority;
}

async function expectOperationInterlockClosed(
  client: Client,
  pilot: TelebirrPilot,
  prepared: PreparedVerification,
): Promise<void> {
  const loader = await client.query(
    'select * from app.load_next_private_live_telebirr_staged_evidence()',
  );
  expect(loader.rows).toEqual([]);

  const authorityFailure = await failureAtSavepoint(client, () =>
    readAuthority(
      client,
      prepared.lease.verification_attempt_id,
      prepared.lease.lease_token,
      prepared.proof.submitted_at,
    ),
  );
  expect(authorityFailure.message).toContain(
    'The trusted TeleBirr activation epoch is not currently authorized.',
  );

  const completionFailure = await failureAtSavepoint(client, () =>
    completeVerification(client, pilot, prepared, {
      disposition: 'review_required',
      reasonCode: 'source_uncertain',
    }),
  );
  expect(completionFailure.message).toContain(
    'The trusted TeleBirr activation epoch is not currently authorized.',
  );
}

export function registerTrustedTelebirrActivationEpochSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
  createSession: () => Client,
): void {
  describe('trusted TeleBirr activation epoch foundation', () => {
    it('starts at immutable epoch zero with private tables and no activation routine', async () => {
      const client = getClient();
      const state = await client.query<{
        readonly authority_state: string;
        readonly current_epoch: string;
      }>(`
        select activation_epoch.authority_state,
               activation_control.current_epoch
          from app.private_trusted_telebirr_activation_control activation_control
          join app.private_trusted_telebirr_activation_epochs activation_epoch
            on activation_epoch.epoch = activation_control.current_epoch
         where activation_control.control_key = 'trusted_telebirr_financial_authority'
      `);
      expect(state.rows).toEqual([{ authority_state: 'disabled', current_epoch: '0' }]);

      const rls = await client.query<{
        readonly owner_only_acl: boolean;
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
      }>(`
        select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity,
               not exists (
                 select 1
                   from aclexplode(coalesce(
                     relation.relacl, acldefault('r', relation.relowner)
                   )) privilege
                  where privilege.grantee <> relation.relowner
               ) as owner_only_acl
          from pg_class relation
          join pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relname in (
             'private_trusted_telebirr_activation_control',
             'private_trusted_telebirr_activation_epochs',
             'private_trusted_telebirr_emergency_disable_intents'
           )
         order by relation.relname
      `);
      expect(rls.rows).toHaveLength(3);
      expect(
        rls.rows.every(
          (row) => row.relrowsecurity && row.relforcerowsecurity && row.owner_only_acl,
        ),
      ).toBe(true);

      const policies = await client.query<{ readonly policyname: string }>(`
        select policyname
          from pg_policies
         where schemaname = 'app'
           and tablename in (
             'private_trusted_telebirr_activation_control',
             'private_trusted_telebirr_activation_epochs',
             'private_trusted_telebirr_emergency_disable_intents'
           )
      `);
      expect(policies.rows).toEqual([]);

      const emergencyBoundary = await client.query<{
        readonly anon_execute: boolean;
        readonly configuration: readonly string[] | null;
        readonly hardened: boolean;
        readonly owner_control_execute: boolean;
        readonly owner_runtime_execute: boolean;
        readonly public_execute: boolean;
        readonly service_execute: boolean;
        readonly verifier_execute: boolean;
      }>(`
        select routine.prosecdef and routine.proowner = 'postgres'::regrole as hardened,
               routine.proconfig as configuration,
               exists (
                 select 1
                   from aclexplode(coalesce(
                     routine.proacl, acldefault('f', routine.proowner)
                   )) privilege
                  where privilege.grantee = 0
                    and privilege.privilege_type = 'EXECUTE'
               ) as public_execute,
               has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_execute,
               has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_execute,
               has_function_privilege(
                 'fetanagent_trusted_telebirr_verifier', routine.oid, 'EXECUTE'
               ) as verifier_execute,
               has_function_privilege(
                 'fetanagent_owner_control', routine.oid, 'EXECUTE'
               ) as owner_control_execute,
               has_function_privilege(
                 'fetanagent_owner_control_runtime', routine.oid, 'EXECUTE'
               ) as owner_runtime_execute
          from pg_proc routine
         where routine.oid =
           'app.request_private_trusted_telebirr_emergency_disable(uuid,bigint,uuid,text)'
             ::regprocedure
      `);
      expect(emergencyBoundary.rows).toEqual([
        {
          hardened: true,
          configuration: ['search_path=""'],
          public_execute: false,
          anon_execute: false,
          service_execute: false,
          verifier_execute: false,
          owner_control_execute: true,
          owner_runtime_execute: true,
        },
      ]);

      const activationSurface = await client.query<{ readonly routine: string }>(`
        select routine.oid::regprocedure::text as routine
          from pg_proc routine
          join pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'app'
           and routine.proname like 'activate_private_trusted_telebirr%'
      `);
      expect(activationSurface.rows).toEqual([]);

      const ownerLockOrder = await client.query<{
        readonly authority_first: boolean;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               position(
                 'lock_private_trusted_telebirr_activation_authority()'
                 in pg_get_functiondef(routine.oid)
               ) > 0
               and position('_by_admin_id' in pg_get_functiondef(routine.oid)) > 0
               and position(
                 'perform gate.singleton'
                 in pg_get_functiondef(routine.oid)
               ) > position(
                 'lock_private_trusted_telebirr_activation_authority()'
                 in pg_get_functiondef(routine.oid)
               )
               and position(
                 'perform gate.singleton'
                 in pg_get_functiondef(routine.oid)
               ) < position('_by_admin_id' in pg_get_functiondef(routine.oid))
                 as authority_first
          from pg_proc routine
         where routine.oid in (
           'app.arm_private_live_deposit_pilot(uuid,uuid)'::regprocedure,
           'app.stop_private_live_deposit_pilot(uuid,uuid,text)'::regprocedure
         )
         order by signature
      `);
      expect(ownerLockOrder.rows).toEqual([
        {
          signature: 'app.arm_private_live_deposit_pilot(uuid,uuid)',
          authority_first: true,
        },
        {
          signature: 'app.stop_private_live_deposit_pilot(uuid,uuid,text)',
          authority_first: true,
        },
      ]);

      const explicitFinancialOrder = await client.query<{
        readonly ordered: boolean;
        readonly signature: string;
      }>(`
        select routine.oid::regprocedure::text as signature,
               position(
                 'lock_private_trusted_telebirr_activation_authority()'
                 in pg_get_functiondef(routine.oid)
               ) > 0
               and position(
                 'perform gate.singleton'
                 in pg_get_functiondef(routine.oid)
               ) > position(
                 'lock_private_trusted_telebirr_activation_authority()'
                 in pg_get_functiondef(routine.oid)
               )
               and position(
                 'perform feature_switch.feature_key'
                 in pg_get_functiondef(routine.oid)
               ) > position(
                 'perform gate.singleton'
                 in pg_get_functiondef(routine.oid)
               )
               and position(
                 'perform pilot_revision.id'
                 in pg_get_functiondef(routine.oid)
               ) > position(
                 'perform feature_switch.feature_key'
                 in pg_get_functiondef(routine.oid)
               )
               and position(
                 'update app.private_owner_kemerbet_readiness_cohort_gate'
                 in pg_get_functiondef(routine.oid)
               ) > position(
                 'perform pilot_revision.id'
                 in pg_get_functiondef(routine.oid)
               ) as ordered
          from pg_proc routine
         where routine.oid in (
           'app.arm_companion_verified_private_live_telebirr_pilot(uuid,uuid)'
             ::regprocedure,
           'app.stop_private_live_deposit_pilot(uuid,uuid,text)'::regprocedure
         )
         order by signature
      `);
      expect(explicitFinancialOrder.rows).toEqual([
        {
          signature: 'app.arm_companion_verified_private_live_telebirr_pilot(uuid,uuid)',
          ordered: true,
        },
        {
          signature: 'app.stop_private_live_deposit_pilot(uuid,uuid,text)',
          ordered: true,
        },
      ]);

      const loader = await client.query(
        'select * from app.load_next_private_live_telebirr_staged_evidence()',
      );
      expect(loader.rows).toEqual([]);
    });

    it('rejects live TeleBirr without an epoch and rejects a partial live set at commit', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const missingEpoch = await failureAtSavepoint(client, () =>
          client.query(`
            update app.feature_switches
               set mode = 'live'
             where feature_key = 'telebirr_authoritative_verification'
          `),
        );
        expect(missingEpoch.message).toContain(
          'A current trusted TeleBirr activation epoch is required for live switches.',
        );

        await prepareTelebirrPilot(client, getOwnerAdminId());
        const partialSet = await failureAtSavepoint(client, async () => {
          await client.query(`
            update app.feature_switches
               set mode = 'disabled', settings = '{}'::jsonb
             where feature_key = 'payment_verification'
          `);
          await client.query('set constraints all immediate');
        });
        expect(partialSet.message).toContain(
          'Live TeleBirr authority requires the complete epoch-bound financial switch set.',
        );
      });
    });

    it('fails closed at operation time for pilot, digest, provider, and settings drift', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const prepared = await prepareVerification(client, pilot, 0);
        const driftCases: readonly {
          readonly name: string;
          readonly mutate: () => Promise<unknown>;
        }[] = [
          {
            name: 'wrong pilot revision',
            mutate: () =>
              client.query(
                `update app.feature_switches
                    set settings = jsonb_set(
                      settings,
                      '{pilot_revision_id}',
                      to_jsonb($1::text)
                    )
                  where feature_key = 'private_live_deposit_pilot'`,
                [randomUUID()],
              ),
          },
          {
            name: 'wrong configuration digest',
            mutate: () =>
              client.query(
                `update app.feature_switches
                    set settings = jsonb_set(
                      settings,
                      '{configuration_digest}',
                      to_jsonb($1::text)
                    )
                  where feature_key = 'private_live_deposit_pilot'`,
                [`sha256:${'b'.repeat(64)}`],
              ),
          },
          {
            name: 'CBE live provider mismatch',
            mutate: () =>
              client.query(`
                update app.feature_switches
                   set mode = case
                     when feature_key = 'cbe_birr_authoritative_verification'
                       then 'live'::app.feature_mode
                     else 'disabled'::app.feature_mode
                   end
                 where feature_key in (
                   'cbe_birr_authoritative_verification',
                   'telebirr_authoritative_verification'
                 )
              `),
          },
          {
            name: 'payment switch settings drift',
            mutate: () =>
              client.query(`
                update app.feature_switches
                   set settings = jsonb_build_object('unexpected', true)
                 where feature_key = 'payment_verification'
              `),
          },
        ];

        for (const drift of driftCases) {
          await client.query('savepoint activation_epoch_drift_case');
          try {
            // Model an out-of-band superuser/catalog restore error. Ordinary writers are
            // stopped earlier by the row and deferred complete-set triggers.
            await client.query("set local session_replication_role = 'replica'");
            await drift.mutate();
            await client.query("set local session_replication_role = 'origin'");

            await expectOperationInterlockClosed(client, pilot, prepared);
          } catch (error) {
            throw new Error(`Operation interlock did not close for ${drift.name}`, {
              cause: error,
            });
          } finally {
            await client.query('rollback to savepoint activation_epoch_drift_case');
            await client.query('release savepoint activation_epoch_drift_case');
          }
        }
      });
    });

    it('blocks pre-existing leases at authority and completion after epoch expiry', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const pilot = await prepareTelebirrPilot(client, getOwnerAdminId());
        const authorityToCompletion = await prepareVerification(client, pilot, 0);
        const leaseToAuthority = await prepareVerification(client, pilot, 1);
        expect(
          await readAuthority(
            client,
            authorityToCompletion.lease.verification_attempt_id,
            authorityToCompletion.lease.lease_token,
            authorityToCompletion.proof.submitted_at,
          ),
        ).not.toBeNull();

        const expiresAt = new Date(Date.now() + 250);
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
              set expires_at = $1::timestamptz
            where epoch = (
              select current_epoch
                from app.private_trusted_telebirr_activation_control
               where control_key = 'trusted_telebirr_financial_authority'
            )`,
          [expiresAt],
        );
        await client.query(
          `update app.private_live_deposit_pilot_revisions
              set expires_at = $1::timestamptz
            where id = $2::uuid`,
          [expiresAt, pilot.pilotRevisionId],
        );
        await client.query("set local session_replication_role = 'origin'");
        await client.query('select pg_sleep(0.35)');

        const authorityFailure = await failureAtSavepoint(client, () =>
          readAuthority(
            client,
            leaseToAuthority.lease.verification_attempt_id,
            leaseToAuthority.lease.lease_token,
            leaseToAuthority.proof.submitted_at,
          ),
        );
        expect(authorityFailure.message).toContain(
          'The trusted TeleBirr activation epoch is not currently authorized.',
        );

        const completionFailure = await failureAtSavepoint(client, () =>
          completeVerification(client, pilot, authorityToCompletion, {
            disposition: 'review_required',
            reasonCode: 'source_uncertain',
          }),
        );
        expect(completionFailure.message).toContain(
          'The trusted TeleBirr activation epoch is not currently authorized.',
        );
      });
    });

    it('atomically records and replays emergency intent, revokes, stops, and disables', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const ownerAdminId = getOwnerAdminId();
        const pilot = await prepareTelebirrPilot(client, ownerAdminId);
        const authorityToCompletion = await prepareVerification(client, pilot, 0);
        const leaseToAuthority = await prepareVerification(client, pilot, 1);
        expect(
          await readAuthority(
            client,
            authorityToCompletion.lease.verification_attempt_id,
            authorityToCompletion.lease.lease_token,
            authorityToCompletion.proof.submitted_at,
          ),
        ).not.toBeNull();

        const epoch = await client.query<{ readonly current_epoch: string }>(`
          select current_epoch
            from app.private_trusted_telebirr_activation_control
           where control_key = 'trusted_telebirr_financial_authority'
        `);
        const requestKey = randomUUID();
        const disable = async () =>
          client.query<{ readonly activation_epoch: string; readonly replayed: boolean }>(
            `select * from app.request_private_trusted_telebirr_emergency_disable(
               $1::uuid, $2::bigint, $3::uuid, 'execution_uncertainty'
             )`,
            [ownerAdminId, epoch.rows[0]!.current_epoch, requestKey],
          );
        expect((await disable()).rows).toEqual([
          { activation_epoch: epoch.rows[0]!.current_epoch, replayed: false },
        ]);
        expect((await disable()).rows).toEqual([
          { activation_epoch: epoch.rows[0]!.current_epoch, replayed: true },
        ]);

        const terminal = await client.query<{
          readonly current_authority: string | null;
          readonly intent_count: string;
          readonly live_switch_count: string;
          readonly pilot_status: string;
          readonly revoked: boolean;
        }>(
          `select app.current_private_trusted_telebirr_activation_epoch()::text
                    as current_authority,
                  (select count(*)::text
                     from app.private_trusted_telebirr_emergency_disable_intents
                    where expected_epoch = $1::bigint) as intent_count,
                  (select count(*)::text
                     from app.feature_switches
                    where feature_key in (
                      'cbe_birr_authoritative_verification', 'deposit_execution',
                      'payment_verification', 'private_live_deposit_pilot',
                      'telebirr_authoritative_verification'
                    ) and mode = 'live') as live_switch_count,
                  (select status
                     from app.private_live_deposit_pilot_revisions
                    where id = $2::uuid) as pilot_status,
                  (select revoked_at is not null
                     from app.private_trusted_telebirr_activation_epochs
                    where epoch = $1::bigint) as revoked`,
          [epoch.rows[0]!.current_epoch, pilot.pilotRevisionId],
        );
        expect(terminal.rows).toEqual([
          {
            current_authority: null,
            intent_count: '1',
            live_switch_count: '0',
            pilot_status: 'stopped',
            revoked: true,
          },
        ]);

        const advancedEpoch = String(Number(epoch.rows[0]!.current_epoch) + 1);
        await client.query(
          `insert into app.private_trusted_telebirr_activation_epochs (
             epoch, authority_state, pilot_revision_id, configuration_digest,
             active_from, expires_at, activated_by_admin_id, activated_at
           ) values (
             $1::bigint, 'active', $2::uuid, $3::text,
             clock_timestamp() - interval '1 second',
             clock_timestamp() + interval '1 hour',
             $4::uuid, clock_timestamp()
           )`,
          [advancedEpoch, pilot.pilotRevisionId, pilot.configurationDigest, ownerAdminId],
        );
        await client.query(
          `update app.private_trusted_telebirr_activation_control
              set current_epoch = $1::bigint
            where control_key = 'trusted_telebirr_financial_authority'`,
          [advancedEpoch],
        );

        expect((await disable()).rows).toEqual([
          { activation_epoch: epoch.rows[0]!.current_epoch, replayed: true },
        ]);
        const changedReason = await failureAtSavepoint(client, () =>
          client.query(
            `select * from app.request_private_trusted_telebirr_emergency_disable(
               $1::uuid, $2::bigint, $3::uuid, 'provider_incident'
             )`,
            [ownerAdminId, epoch.rows[0]!.current_epoch, requestKey],
          ),
        );
        expect(changedReason.message).toContain(
          'The trusted TeleBirr emergency-disable replay conflicts.',
        );
        const changedRequestKey = await failureAtSavepoint(client, () =>
          client.query(
            `select * from app.request_private_trusted_telebirr_emergency_disable(
               $1::uuid, $2::bigint, $3::uuid, 'execution_uncertainty'
             )`,
            [ownerAdminId, epoch.rows[0]!.current_epoch, randomUUID()],
          ),
        );
        expect(changedRequestKey.message).toContain(
          'The trusted TeleBirr emergency-disable replay conflicts.',
        );

        const authorityFailure = await failureAtSavepoint(client, () =>
          readAuthority(
            client,
            leaseToAuthority.lease.verification_attempt_id,
            leaseToAuthority.lease.lease_token,
            leaseToAuthority.proof.submitted_at,
          ),
        );
        expect(authorityFailure.message).toContain(
          'The trusted TeleBirr activation epoch is not currently authorized.',
        );

        const completionFailure = await failureAtSavepoint(client, () =>
          completeVerification(client, pilot, authorityToCompletion, {
            disposition: 'review_required',
            reasonCode: 'source_uncertain',
          }),
        );
        expect(completionFailure.message).toContain(
          'The trusted TeleBirr activation epoch is not currently authorized.',
        );
      });
    });

    it('rechecks authority time after waiting for the control lock', async () => {
      const client = getClient();
      const ownerAdminId = getOwnerAdminId();
      let pilot: TelebirrPilot | undefined;
      let currentEpoch: string | undefined;
      let cleanupRequestKey: string | undefined;

      try {
        pilot = await prepareTelebirrPilot(client, ownerAdminId);
        const epoch = await client.query<{ readonly current_epoch: string }>(`
          select current_epoch
            from app.private_trusted_telebirr_activation_control
           where control_key = 'trusted_telebirr_financial_authority'
        `);
        currentEpoch = epoch.rows[0]!.current_epoch;
        cleanupRequestKey = randomUUID();

        const expiresAt = new Date(Date.now() + 2_000);
        await client.query('begin');
        try {
          await client.query("set local session_replication_role = 'replica'");
          await client.query(
            `update app.private_trusted_telebirr_activation_epochs
                set expires_at = $1::timestamptz
              where epoch = $2::bigint`,
            [expiresAt, currentEpoch],
          );
          await client.query(
            `update app.private_live_deposit_pilot_revisions
                set expires_at = $1::timestamptz
              where id = $2::uuid`,
            [expiresAt, pilot.pilotRevisionId],
          );
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        }

        const locker = createSession();
        const reader = createSession();
        let lockerCommitted = false;
        let readerRolledBack = false;
        let readerAttempt:
          Promise<QueryResult<{ readonly current_epoch: string | null }>> | undefined;
        await Promise.all([locker.connect(), reader.connect()]);
        try {
          await Promise.all([locker.query('begin'), reader.query('begin')]);
          await locker.query("set local lock_timeout = '8s'");
          await reader.query("set local lock_timeout = '8s'");
          await reader.query("set local statement_timeout = '12s'");
          await reader.query("set local application_name = 'trusted_telebirr_epoch_expiry_wait'");
          await locker.query(`
            select current_epoch
              from app.private_trusted_telebirr_activation_control
             where control_key = 'trusted_telebirr_financial_authority'
             for update
          `);

          readerAttempt = reader.query<{ readonly current_epoch: string | null }>(`
            select app.current_private_trusted_telebirr_activation_epoch()::text
                     as current_epoch
          `);

          let observedControlWait = false;
          for (let attempt = 0; attempt < 80; attempt += 1) {
            const lockState = await client.query<{ readonly waiting: boolean }>(`
              select exists (
                select 1
                  from pg_stat_activity activity
                 where activity.application_name = 'trusted_telebirr_epoch_expiry_wait'
                   and activity.wait_event_type = 'Lock'
              ) as waiting
            `);
            if (lockState.rows[0]!.waiting) {
              observedControlWait = true;
              break;
            }
            await client.query('select pg_sleep(0.025)');
          }
          expect(observedControlWait).toBe(true);

          await client.query('select pg_sleep(2.1)');
          await locker.query('commit');
          lockerCommitted = true;
          expect((await readerAttempt).rows).toEqual([{ current_epoch: null }]);
          readerAttempt = undefined;
          await reader.query('rollback');
          readerRolledBack = true;
        } finally {
          if (!lockerCommitted) {
            await Promise.allSettled([locker.query('rollback')]);
          }
          if (readerAttempt) {
            await Promise.allSettled([readerAttempt]);
          }
          if (!readerRolledBack) {
            await Promise.allSettled([reader.query('rollback')]);
          }
          await Promise.allSettled([locker.end(), reader.end()]);
        }
      } finally {
        if (pilot && currentEpoch && cleanupRequestKey) {
          await client.query(
            `select * from app.request_private_trusted_telebirr_emergency_disable(
               $1::uuid, $2::bigint, $3::uuid, 'owner_stop'
             )`,
            [ownerAdminId, currentEpoch, cleanupRequestKey],
          );
        }
      }
    });
  });
}
