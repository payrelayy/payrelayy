import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
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
        readonly relforcerowsecurity: boolean;
        readonly relname: string;
        readonly relrowsecurity: boolean;
      }>(`
        select relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
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
      expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

      const activationSurface = await client.query<{ readonly routine: string | null }>(`
        select to_regprocedure(
          'app.activate_private_trusted_telebirr_epoch(uuid,uuid,uuid)'
        )::text as routine
      `);
      expect(activationSurface.rows).toEqual([{ routine: null }]);

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
          await client.query(
            'set constraints feature_switches_trusted_telebirr_complete_set immediate',
          );
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
  });
}
