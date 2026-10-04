import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { armPilot } from './private-live-money-pilot.suite.js';
import {
  activateTrustedTelebirrEpoch,
  prepareTelebirrPilot,
} from './private-live-telebirr-proof-lineage.suite.js';

async function withRollback(client: Client, operation: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await operation();
  } finally {
    await client.query('rollback');
  }
}

async function expectRejected(client: Client, operation: () => Promise<unknown>): Promise<void> {
  await client.query('savepoint predecessor_rejected');
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  await client.query('rollback to savepoint predecessor_rejected');
  await client.query('release savepoint predecessor_rejected');
  expect(failure).toBeInstanceOf(Error);
}

async function prepareRenewal(client: Client, ownerAdminId: string) {
  const previous = await prepareTelebirrPilot(client, ownerAdminId);
  const epoch = await client.query<{ readonly current_epoch: string }>(`
    select current_epoch from app.private_trusted_telebirr_activation_control
     where control_key = 'trusted_telebirr_financial_authority'
  `);
  // Model natural expiry without waiting twelve hours. This is confined to the disposable fixture.
  await client.query("set local session_replication_role = 'replica'");
  await client.query(
    `update app.private_trusted_telebirr_activation_epochs
        set active_from = clock_timestamp() - interval '12 hours 1 minute',
            activated_at = clock_timestamp() - interval '12 hours',
            expires_at = clock_timestamp() - interval '1 minute'
      where epoch = $1::bigint`,
    [epoch.rows[0]!.current_epoch],
  );
  await client.query(
    `update app.private_live_deposit_pilot_revisions
        set active_from = clock_timestamp() - interval '12 hours 1 minute',
            armed_at = clock_timestamp() - interval '12 hours',
            expires_at = clock_timestamp() - interval '1 minute'
      where id = $1::uuid`,
    [previous.pilotRevisionId],
  );
  await client.query("set local session_replication_role = 'origin'");
  await client.query(
    `select app.stop_private_live_deposit_pilot($1::uuid, $2::uuid, 'owner_stop')`,
    [ownerAdminId, previous.pilotRevisionId],
  );

  const activeFrom = new Date(Date.now() - 1000);
  const expiresAt = new Date(activeFrom.getTime() + 12 * 60 * 60 * 1000);
  const prepared = await client.query<{ readonly id: string }>(
    `select app.prepare_private_live_deposit_pilot(
       $1::uuid, $2::uuid, array['telebirr']::text[], $3::text[], $4::uuid[],
       2500::bigint, 2500::bigint, 2500::bigint, 12500::bigint, 5::smallint,
       $5::timestamptz, $6::timestamptz
     ) as id`,
    [
      ownerAdminId,
      randomUUID(),
      previous.playerIds,
      [previous.submittingCustomerId],
      activeFrom,
      expiresAt,
    ],
  );
  const replacementId = prepared.rows[0]!.id;
  await armPilot(client, ownerAdminId, {
    ...previous,
    pilotRevisionId: replacementId,
    activeFrom,
    expiresAt,
  });
  const digest = await client.query<{ readonly configuration_digest: string }>(
    'select configuration_digest from app.private_live_deposit_pilot_revisions where id = $1::uuid',
    [replacementId],
  );
  const replacement = {
    ...previous,
    pilotRevisionId: replacementId,
    activeFrom,
    expiresAt,
    configurationDigest: digest.rows[0]!.configuration_digest,
  };

  const receiverProfileId = randomUUID();
  await client.query(
    `insert into app.private_live_telebirr_receiver_profiles (
       id, pilot_revision_id, payment_provider_id, receiver_account_id,
       receiver_account_version, pilot_configuration_digest, receiver_profile_digest,
       receiver_configuration_digest, receiver_identity_digest, expected_receiver_name_digest,
       deposit_policy_version_id, deposit_policy_version, minimum_principal_amount_minor,
       maximum_principal_amount_minor, policy_digest, valid_from, valid_until
     ) select $1::uuid, $2::uuid, payment_provider_id, receiver_account_id,
       receiver_account_version, $3::text, 'sha256:' || repeat('f', 64),
       receiver_configuration_digest, receiver_identity_digest, expected_receiver_name_digest,
       deposit_policy_version_id, deposit_policy_version, 2500::bigint,
       2500::bigint, app.private_live_telebirr_policy_digest(2500, 2500), $4::timestamptz, $5::timestamptz
     from app.private_live_telebirr_receiver_profiles where id = $6::uuid`,
    [
      receiverProfileId,
      replacementId,
      replacement.configurationDigest,
      activeFrom,
      expiresAt,
      previous.receiverProfileId,
    ],
  );
  await client.query(
    `insert into app.private_live_telebirr_device_enrollments (
       id, pilot_revision_id, receiver_profile_id, device_id, key_id,
       public_key_spki_sha256, valid_from, valid_until
     ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::timestamptz, $8::timestamptz)`,
    [
      randomUUID(),
      replacementId,
      receiverProfileId,
      `sql-renewal-${randomUUID()}`,
      `sql-key-${randomUUID()}`,
      `sha256:${'e'.repeat(64)}`,
      activeFrom,
      expiresAt,
    ],
  );
  await client.query(`alter role fetanagent_trusted_telebirr_verifier_runtime
    login password null valid until '2000-01-01T00:00:00Z'`);
  const requestKey = randomUUID();
  const retire = (pilotId = replacementId, key = requestKey, actor = ownerAdminId) =>
    client.query<{
      readonly activation_epoch: string;
      readonly replayed: boolean;
    }>(
      'select * from app.retire_expired_trusted_telebirr_predecessor($1::uuid, $2::bigint, $3::uuid, $4::uuid)',
      [actor, epoch.rows[0]!.current_epoch, pilotId, key],
    );
  return { epoch: epoch.rows[0]!.current_epoch, previous, replacement, retire };
}

async function snapshotRenewal(client: Client, replacementId: string): Promise<unknown> {
  const snapshot = await client.query<{ readonly boundary: unknown }>(
    `select jsonb_build_object(
       'pilot', (select to_jsonb(p) from app.private_live_deposit_pilot_revisions p where p.id = $1::uuid),
       'switches', (select jsonb_agg(to_jsonb(s) order by s.feature_key) from app.feature_switches s),
       'enrollments', (select jsonb_agg(to_jsonb(e) order by e.id)
         from app.private_live_telebirr_device_enrollments e where e.pilot_revision_id = $1::uuid),
       'jobs', (select count(*) from app.deposit_jobs),
       'attempts', (select count(*) from app.deposit_execution_attempts)
     ) as boundary`,
    [replacementId],
  );
  return snapshot.rows[0]!.boundary;
}

export function registerExpiredTelebirrPredecessorSqlTests(
  getClient: () => Client,
  getOwnerAdminId: () => string,
): void {
  describe('expired TeleBirr verifier predecessor renewal', () => {
    it('is postgres-only and grants no new runtime or Owner-control capability', async () => {
      const result = await getClient().query<{
        readonly invoker: boolean;
        readonly private_acl: boolean;
      }>(`
        select not routine.prosecdef as invoker,
               not exists (select 1 from aclexplode(coalesce(routine.proacl,
                 acldefault('f', routine.proowner))) acl where acl.grantee <> routine.proowner) as private_acl
          from pg_proc routine where routine.oid =
            'app.retire_expired_trusted_telebirr_predecessor(uuid,bigint,uuid,uuid)'::regprocedure
      `);
      expect(result.rows).toEqual([{ invoker: true, private_acl: true }]);
    });

    it('retires only the expired predecessor while preserving its new pilot, phone, switches and jobs', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const renewal = await prepareRenewal(client, getOwnerAdminId());
        const before = await snapshotRenewal(client, renewal.replacement.pilotRevisionId);
        expect((await renewal.retire()).rows).toEqual([
          { activation_epoch: renewal.epoch, replayed: false },
        ]);
        expect((await renewal.retire()).rows).toEqual([
          { activation_epoch: renewal.epoch, replayed: true },
        ]);
        expect(await snapshotRenewal(client, renewal.replacement.pilotRevisionId)).toEqual(before);
        const retired = await client.query<{
          readonly revoked: boolean;
          readonly inert_roles: string;
        }>(`
          select (select revoked_at is not null from app.private_trusted_telebirr_activation_epochs
                   where epoch = ${Number(renewal.epoch)}) as revoked,
                 (select count(*) from pg_authid where rolname in (
                   'fetanagent_trusted_telebirr_verifier', 'fetanagent_trusted_telebirr_verifier_runtime'
                 ) and not rolcanlogin and rolpassword is null) as inert_roles
        `);
        expect(retired.rows).toEqual([{ revoked: true, inert_roles: '2' }]);
        await expectRejected(client, () => renewal.retire(randomUUID()));
        await expectRejected(client, () =>
          renewal.retire(renewal.replacement.pilotRevisionId, randomUUID()),
        );

        const nextEpoch = await activateTrustedTelebirrEpoch(
          client,
          getOwnerAdminId(),
          renewal.replacement,
        );
        await client.query(`alter role fetanagent_trusted_telebirr_verifier_runtime
          login password null valid until 'infinity'`);
        expect((await renewal.retire()).rows).toEqual([
          { activation_epoch: renewal.epoch, replayed: true },
        ]);
        const advanced = await client.query<{
          readonly untouched: boolean;
          readonly login: boolean;
        }>(
          `select (select revoked_at is null from app.private_trusted_telebirr_activation_epochs
                    where epoch = $1::bigint) as untouched,
                  (select rolcanlogin from pg_roles
                    where rolname = 'fetanagent_trusted_telebirr_verifier_runtime') as login`,
          [nextEpoch],
        );
        expect(advanced.rows).toEqual([{ untouched: true, login: true }]);
        await client.query('set constraints all immediate');
      });
    });

    it('rejects a wrong Owner/pilot and refuses an unexpired verifier login without side effects', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const renewal = await prepareRenewal(client, getOwnerAdminId());
        const before = await snapshotRenewal(client, renewal.replacement.pilotRevisionId);
        await expectRejected(client, () => renewal.retire(undefined, undefined, randomUUID()));
        await expectRejected(client, () => renewal.retire(renewal.previous.pilotRevisionId));
        await expectRejected(client, () => renewal.retire(randomUUID()));
        await client.query(`alter role fetanagent_trusted_telebirr_verifier_runtime
          login password null valid until 'infinity'`);
        await expectRejected(client, () => renewal.retire());
        expect(await snapshotRenewal(client, renewal.replacement.pilotRevisionId)).toEqual(before);
        const retained = await client.query<{
          readonly unrevoked: boolean;
          readonly intents: string;
        }>(
          `select revoked_at is null as unrevoked,
                  (select count(*) from app.private_trusted_telebirr_emergency_disable_intents
                    where expected_epoch = $1::bigint) as intents
             from app.private_trusted_telebirr_activation_epochs where epoch = $1::bigint`,
          [renewal.epoch],
        );
        expect(retained.rows).toEqual([{ unrevoked: true, intents: '0' }]);
      });
    });

    it('rejects an unexpired predecessor and a live/drifted replacement switch', async () => {
      const client = getClient();
      await withRollback(client, async () => {
        const renewal = await prepareRenewal(client, getOwnerAdminId());
        await client.query('savepoint predecessor_future');
        await client.query("set local session_replication_role = 'replica'");
        await client.query(
          `update app.private_trusted_telebirr_activation_epochs
          set expires_at = clock_timestamp() + interval '1 hour' where epoch = $1::bigint`,
          [renewal.epoch],
        );
        await client.query("set local session_replication_role = 'origin'");
        await expectRejected(client, () => renewal.retire());
        await client.query('rollback to savepoint predecessor_future');
        await client.query('release savepoint predecessor_future');

        for (const mode of ['live', 'disabled']) {
          await client.query('savepoint predecessor_switch');
          await client.query("set local session_replication_role = 'replica'");
          await client.query(
            `update app.feature_switches set mode = $1::app.feature_mode
            where feature_key = 'private_live_deposit_pilot'`,
            [mode],
          );
          await client.query("set local session_replication_role = 'origin'");
          await expectRejected(client, () => renewal.retire());
          await client.query('rollback to savepoint predecessor_switch');
          await client.query('release savepoint predecessor_switch');
        }
      });
    });
  });
}
