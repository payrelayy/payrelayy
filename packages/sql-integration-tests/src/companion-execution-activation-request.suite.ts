import { createHash, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { prepareTelebirrPilot } from './private-live-telebirr-proof-lineage.suite.js';

function digest(): string {
  return `sha256:${createHash('sha256').update(randomUUID()).digest('hex')}`;
}

export function registerCompanionExecutionActivationRequestSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
  getOwnerAdminId: () => string,
): void {
  describe('dormant companion execution activation request', () => {
    it('is immutable, empty, and inaccessible to application and execution roles', async () => {
      const result = await getClient().query<{
        readonly row_count: string;
        readonly rls_enabled: boolean;
        readonly rls_forced: boolean;
        readonly owner_execute: boolean;
        readonly public_execute: boolean;
        readonly bridge_execute: boolean;
        readonly executor_execute: boolean;
        readonly owner_insert: boolean;
        readonly immutable_triggers: string;
        readonly control_state: string;
      }>(`
        select
          (select count(*) from app.agent_platform_companion_execution_activation_requests)
            as row_count,
          relation.relrowsecurity as rls_enabled,
          relation.relforcerowsecurity as rls_forced,
          has_function_privilege('fetanagent_owner_control',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,uuid)',
            'execute') as owner_execute,
          has_function_privilege('public',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,uuid)',
            'execute') as public_execute,
          has_function_privilege('fetanagent_companion_execution_bridge',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,uuid)',
            'execute') as bridge_execute,
          has_function_privilege('fetanagent_deposit_executor_runtime',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,uuid)',
            'execute') as executor_execute,
          has_table_privilege('fetanagent_owner_control',
            'app.agent_platform_companion_execution_activation_requests', 'insert')
            as owner_insert,
          (select count(*)
             from pg_trigger trigger
            where trigger.tgrelid =
              'app.agent_platform_companion_execution_activation_requests'::regclass
              and not trigger.tgisinternal) as immutable_triggers,
          (select control_state
             from app.agent_platform_companion_execution_control
            where singleton) as control_state
        from pg_class relation
        where relation.oid =
          'app.agent_platform_companion_execution_activation_requests'::regclass
      `);
      expect(result.rows).toEqual([
        {
          row_count: '0',
          rls_enabled: true,
          rls_forced: true,
          owner_execute: false,
          public_execute: false,
          bridge_execute: false,
          executor_execute: false,
          owner_insert: false,
          immutable_triggers: '2',
          control_state: 'disabled',
        },
      ]);
    });

    it('rejects preparation without current authority and leaves all money state inert', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const call = async (release: string) =>
          client.query(
            `select * from app.prepare_agent_platform_companion_execution_activation_request(
            $1::uuid, $2::uuid, 1::bigint, $3::uuid, $4::text, $5::text, $6::uuid
          )`,
            [
              getOwnerAuthUserId(),
              randomUUID(),
              randomUUID(),
              release,
              `sha256:${'b'.repeat(64)}`,
              randomUUID(),
            ],
          );
        await client.query('savepoint invalid_release');
        await expect(call('unreviewed')).rejects.toThrow(
          'The companion execution activation request is invalid.',
        );
        await client.query('rollback to savepoint invalid_release');

        await client.query('savepoint no_epoch');
        await expect(call('a'.repeat(40))).rejects.toThrow(
          'The trusted TeleBirr authority changed before execution preparation.',
        );
        await client.query('rollback to savepoint no_epoch');

        const result = await client.query<{
          readonly requests: string;
          readonly control_state: string;
          readonly current_epoch: string;
          readonly live_switches: string;
        }>(`
          select
            (select count(*) from app.agent_platform_companion_execution_activation_requests)
              as requests,
            (select control_state from app.agent_platform_companion_execution_control
              where singleton) as control_state,
            (select current_epoch from app.private_trusted_telebirr_activation_control
              where control_key = 'trusted_telebirr_financial_authority') as current_epoch,
            (select count(*) from app.feature_switches where mode = 'live') as live_switches
        `);
        expect(result.rows).toEqual([
          {
            requests: '0',
            control_state: 'disabled',
            current_epoch: '0',
            live_switches: '0',
          },
        ]);
      } finally {
        await client.query('rollback');
      }
    });

    it('binds one current request, replays exactly, and refuses an overlapping request', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const ownerAdminId = getOwnerAdminId();
        const pilot = await prepareTelebirrPilot(client, ownerAdminId, {
          maximumPerDepositMinor: 2500,
          maximumPerPlayerMinor: 2500,
          maximumAggregateMinor: 12500,
        });
        const epochResult = await client.query<{ readonly current_epoch: string }>(`
          select current_epoch from app.private_trusted_telebirr_activation_control
          where control_key = 'trusted_telebirr_financial_authority'
        `);
        const activationEpoch = epochResult.rows[0]!.current_epoch;

        const signerId = randomUUID();
        const signerKeyId = `sql-signer-${randomUUID().slice(0, 8)}`;
        await client.query(
          `insert into app.agent_platform_companion_server_signers (
            id, signer_key_id, public_key_spki, public_key_spki_sha256,
            signature_algorithm, signature_encoding, valid_from, valid_until
          ) values (
            $1::uuid, $2::text, 'MFkwSyntheticSignerKey', $3::text,
            'ecdsa-p256-sha256', 'ieee-p1363-base64url',
            clock_timestamp() - interval '1 day', clock_timestamp() + interval '730 days'
          )`,
          [signerId, signerKeyId, digest()],
        );

        const pairingId = randomUUID();
        const certificateId = randomUUID();
        const deviceId = `sql-device-${randomUUID().slice(0, 8)}`;
        const deviceKeyId = `sql-key-${randomUUID().slice(0, 8)}`;
        const deviceKeyDigest = digest();
        const pairingRequestDigest = digest();
        await client.query(
          `insert into app.agent_platform_companion_pairing_challenges (
            pairing_id, issue_request_key, issue_request_digest, server_signer_id,
            pairing_nonce_digest, minimum_companion_version, issued_at, expires_at,
            created_by_admin_id, state, pairing_request_body_digest,
            reserved_certificate_id, device_id, device_key_id, device_public_key_spki,
            device_public_key_spki_sha256, companion_version,
            pairing_request_issued_at, pairing_request_expires_at,
            certificate_issued_at, certificate_valid_from, certificate_valid_until,
            certificate_body, first_claimed_at, last_claimed_at, completed_at
          ) values (
            $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, '0.1.10',
            clock_timestamp() - interval '2 minutes',
            clock_timestamp() + interval '8 minutes', $6::uuid, 'completed',
            $7::text, $8::uuid, $9::text, $10::text, 'MFkwSyntheticDeviceKey',
            $11::text, '0.1.10', clock_timestamp() - interval '90 seconds',
            clock_timestamp() + interval '3 minutes',
            clock_timestamp() - interval '1 minute',
            clock_timestamp() - interval '1 minute',
            clock_timestamp() + interval '1 hour', '{}'::jsonb,
            clock_timestamp() - interval '90 seconds',
            clock_timestamp() - interval '1 minute',
            clock_timestamp() - interval '1 minute'
          )`,
          [
            pairingId,
            randomUUID(),
            digest(),
            signerId,
            digest(),
            ownerAdminId,
            pairingRequestDigest,
            certificateId,
            deviceId,
            deviceKeyId,
            deviceKeyDigest,
          ],
        );
        await client.query(
          `insert into app.agent_platform_companion_enrollment_certificates (
            certificate_id, pairing_id, server_signer_id,
            pairing_request_body_digest, certificate_body_digest,
            certificate_signer_key_id, certificate_signature,
            device_id, device_key_id, device_public_key_spki_sha256,
            certificate_body, signed_certificate,
            issued_at, valid_from, valid_until, completed_at
          ) values (
            $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
            $7::text, $8::text, $9::text, $10::text,
            '{}'::jsonb, '{}'::jsonb,
            clock_timestamp() - interval '1 minute',
            clock_timestamp() - interval '1 minute',
            clock_timestamp() + interval '1 hour',
            clock_timestamp() - interval '1 minute'
          )`,
          [
            certificateId,
            pairingId,
            signerId,
            pairingRequestDigest,
            digest(),
            signerKeyId,
            'A'.repeat(86),
            deviceId,
            deviceKeyId,
            deviceKeyDigest,
          ],
        );

        const requestKey = randomUUID();
        const releaseSha = 'a'.repeat(40);
        const archiveDigest = digest();
        const prepare = (key: string, release: string) =>
          client.query<{
            readonly valid_until: Date;
            readonly replayed: boolean;
          }>(
            `select * from app.prepare_agent_platform_companion_execution_activation_request(
            $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text, $6::text, $7::uuid
          )`,
            [
              getOwnerAuthUserId(),
              pilot.pilotRevisionId,
              activationEpoch,
              certificateId,
              release,
              archiveDigest,
              key,
            ],
          );
        const created = await prepare(requestKey, releaseSha);
        expect(created.rows).toHaveLength(1);
        expect(created.rows[0]!.replayed).toBe(false);
        expect(created.rows[0]!.valid_until.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
        expect(created.rows[0]!.valid_until.getTime()).toBeLessThanOrEqual(
          Date.now() + 10 * 60_000,
        );
        const replay = await prepare(requestKey, releaseSha);
        expect(replay.rows).toEqual([
          {
            valid_until: created.rows[0]!.valid_until,
            replayed: true,
          },
        ]);

        await client.query('savepoint overlapping_request');
        await expect(prepare(randomUUID(), releaseSha)).rejects.toThrow(
          'The companion execution activation request replay conflicts.',
        );
        await client.query('rollback to savepoint overlapping_request');
        await client.query('savepoint changed_replay');
        await expect(prepare(requestKey, 'b'.repeat(40))).rejects.toThrow(
          'The companion execution activation request replay conflicts.',
        );
        await client.query('rollback to savepoint changed_replay');

        const retained = await client.query<{ readonly count: string }>(
          'select count(*) from app.agent_platform_companion_execution_activation_requests',
        );
        expect(retained.rows).toEqual([{ count: '1' }]);
        const dormant = await client.query<{ readonly control_state: string }>(
          'select control_state from app.agent_platform_companion_execution_control where singleton',
        );
        expect(dormant.rows).toEqual([{ control_state: 'disabled' }]);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
