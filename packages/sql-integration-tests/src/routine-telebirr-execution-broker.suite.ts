import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { paidJob, persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';

const runtimeRole = 'fetanagent_routine_deposit_broker_runtime';
const brokerRole = 'fetanagent_routine_deposit_broker';
const commandSignature =
  'app.execute_agent_platform_routine_deposit_command(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,text,text,jsonb)';
const digest = (seed = randomUUID()): string =>
  `sha256:${createHash('sha256').update(seed, 'utf8').digest('hex')}`;

interface CertificateFixture {
  readonly certificateId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly signerKeyId: string;
}

async function activeCertificate(
  client: Client,
  ownerAdminId: string,
): Promise<CertificateFixture> {
  const signerId = randomUUID();
  const signerKeyId = `routine-signer-${randomUUID().slice(0, 8)}`;
  const { publicKey: signerPublicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signerPublicKeyBytes = signerPublicKey.export({ type: 'spki', format: 'der' });
  await client.query(
    `insert into app.agent_platform_companion_server_signers (
      id, signer_key_id, public_key_spki, public_key_spki_sha256,
      signature_algorithm, signature_encoding, valid_from, valid_until
    ) values (
      $1::uuid, $2::text, $3::text, $4::text,
      'ecdsa-p256-sha256', 'ieee-p1363-base64url',
      clock_timestamp() - interval '1 day', clock_timestamp() + interval '730 days'
    )`,
    [
      signerId,
      signerKeyId,
      signerPublicKeyBytes.toString('base64url'),
      `sha256:${createHash('sha256').update(signerPublicKeyBytes).digest('hex')}`,
    ],
  );
  const pairingId = randomUUID();
  const certificateId = randomUUID();
  const deviceId = `routine-device-${randomUUID().slice(0, 8)}`;
  const deviceKeyId = `routine-key-${randomUUID().slice(0, 8)}`;
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyBytes = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeySpki = publicKeyBytes.toString('base64url');
  const publicKeyDigest = `sha256:${createHash('sha256').update(publicKeyBytes).digest('hex')}`;
  const certificateBody = { certificateId, deviceKeyId, devicePublicKeySpki: publicKeySpki };
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
      clock_timestamp() - interval '2 minutes', clock_timestamp() + interval '8 minutes',
      $6::uuid, 'completed', $7::text, $8::uuid, $9::text, $10::text, $11::text,
      $12::text, '0.1.10', clock_timestamp() - interval '90 seconds',
      clock_timestamp() + interval '3 minutes', clock_timestamp() - interval '1 minute',
      clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour',
      $13::jsonb, clock_timestamp() - interval '90 seconds',
      clock_timestamp() - interval '1 minute', clock_timestamp() - interval '1 minute'
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
      publicKeySpki,
      publicKeyDigest,
      JSON.stringify(certificateBody),
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
      $7::text, $8::text, $9::text, $10::text, $11::jsonb, '{}'::jsonb,
      clock_timestamp() - interval '1 minute', clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '1 hour', clock_timestamp() - interval '1 minute'
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
      publicKeyDigest,
      JSON.stringify(certificateBody),
    ],
  );
  return { certificateId, deviceId, deviceKeyId, signerKeyId };
}

function leaseCommand(accountId: string, requestId = randomUUID()) {
  return {
    contractVersion: 1,
    protocolMode: 'windows_companion_routine_deposit_execution_v1',
    capability: 'kemerbet.deposit.submit.verified_receipt_amount.routine.v1',
    requestId,
    workerInstanceId: randomUUID(),
    operation: 'lease',
    expectedPlatformAgentAccountId: accountId,
  };
}

async function execute(
  client: Client,
  certificate: CertificateFixture,
  command: ReturnType<typeof leaseCommand>,
  identities = {
    replayIdentity: digest(),
    bodyDigest: digest(),
    commandDigest: digest(),
    httpRequestId: randomUUID(),
  },
) {
  const assessedAt = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const issuedAt = new Date(assessedAt.getTime() - 1_000);
  const expiresAt = new Date(assessedAt.getTime() + 30_000);
  const result = await client.query<{ result: unknown }>(
    `select app.execute_agent_platform_routine_deposit_command(
      $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
      $7::timestamptz, $8::timestamptz, $9::timestamptz,
      $10::text, $11::text, $12::text, $13::jsonb
    ) as result`,
    [
      identities.replayIdentity,
      identities.bodyDigest,
      identities.httpRequestId,
      certificate.certificateId,
      certificate.deviceId,
      certificate.deviceKeyId,
      issuedAt,
      expiresAt,
      assessedAt,
      certificate.signerKeyId,
      'companion-execution-production-v1',
      identities.commandDigest,
      JSON.stringify(command),
    ],
  );
  return { identities, result: result.rows[0]!.result };
}

export function registerRoutineTelebirrExecutionBrokerSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
  getOwnerAdminId: () => string,
  createRuntimeClient: (password: string) => Client,
): void {
  describe('routine TeleBirr execution broker', () => {
    it('is dormant after migration and exposes one hardened function only', async () => {
      const client = getClient();
      const roles = await client.query<{
        rolcanlogin: boolean;
        rolconnlimit: number;
        rolinherit: boolean;
        rolname: string;
        rolpassword: string | null;
      }>(
        `select rolname, rolcanlogin, rolinherit, rolconnlimit, rolpassword
           from pg_authid where rolname in ($1::text, $2::text) order by rolname`,
        [brokerRole, runtimeRole],
      );
      expect(roles.rows).toEqual([
        {
          rolcanlogin: false,
          rolconnlimit: 1,
          rolinherit: false,
          rolname: brokerRole,
          rolpassword: null,
        },
        {
          rolcanlogin: false,
          rolconnlimit: 1,
          rolinherit: false,
          rolname: runtimeRole,
          rolpassword: null,
        },
      ]);
      const privileges = await client.query<{
        base_tables: string;
        broker_execute: boolean;
        hardened: boolean;
        public_execute: boolean;
        runtime_execute: boolean;
        schema_usage: boolean;
      }>(
        `select
          has_schema_privilege($1::text, 'app', 'usage') as schema_usage,
          has_function_privilege($1::text, $3::text, 'execute') as broker_execute,
          has_function_privilege($2::text, $3::text, 'execute') as runtime_execute,
          has_function_privilege('public', $3::text, 'execute') as public_execute,
          (select procedure.prosecdef and procedure.proowner = 'postgres'::regrole
             and procedure.proconfig = array['search_path=pg_catalog']::text[]
             from pg_proc procedure where procedure.oid = $3::regprocedure) as hardened,
          (select count(*)::text from pg_class relation
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           where namespace.nspname = 'app'
             and case
               when relation.relkind in ('r','p','v','m','f') then has_table_privilege(
                 $1::text, relation.oid, 'select,insert,update,delete,truncate'
               )
               when relation.relkind = 'S' then has_sequence_privilege(
                 $1::text, relation.oid, 'usage,select,update'
               )
               else false
             end) as base_tables`,
        [brokerRole, runtimeRole, commandSignature],
      );
      expect(privileges.rows).toEqual([
        {
          base_tables: '0',
          broker_execute: true,
          hardened: true,
          public_execute: false,
          runtime_execute: false,
          schema_usage: true,
        },
      ]);
      const ledgers = await client.query<{
        relforcerowsecurity: boolean;
        relname: string;
        relrowsecurity: boolean;
      }>(`select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relnamespace = 'app'::regnamespace and relname = any(array[
            'routine_telebirr_runtime_events', 'routine_telebirr_broker_requests',
            'routine_telebirr_dispatch_evidence', 'routine_telebirr_runtime_pauses'
          ]) order by relname`);
      expect(ledgers.rows).toHaveLength(4);
      expect(ledgers.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    });

    it('requires explicit activation, serves replay-safe idle commands, and disables immediately', async () => {
      const client = getClient();
      const policy = await persistentPolicyFixture(client, getOwnerAuthUserId());
      const certificate = await activeCertificate(client, getOwnerAdminId());
      const password = randomBytes(32).toString('hex');
      const activationKey = randomUUID();
      const activated = await client.query<{ valid_until: Date }>(
        `select app.activate_routine_telebirr_execution_transport(
          $1::uuid, $2::uuid, $3::uuid, $4::text
        ) as valid_until`,
        [getOwnerAuthUserId(), certificate.certificateId, activationKey, password],
      );
      expect(activated.rows[0]!.valid_until.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
      const runtime = createRuntimeClient(password);
      let disabled = false;
      try {
        await runtime.connect();
        const command = leaseCommand(policy.accountId);
        const first = await execute(runtime, certificate, command);
        expect(first.result).toBeNull();
        expect((await execute(runtime, certificate, command, first.identities)).result).toBeNull();
        expect(
          (
            await client.query<{ count: number }>(
              `select count(*)::integer as count from app.routine_telebirr_broker_requests
                where request_id = $1::uuid`,
              [command.requestId],
            )
          ).rows,
        ).toEqual([{ count: 1 }]);
        expect(
          (
            await client.query<{ configuration: { executionEnabled: boolean } }>(
              `select app.get_owner_routine_telebirr_processing($1::uuid) as configuration`,
              [getOwnerAuthUserId()],
            )
          ).rows[0]!.configuration.executionEnabled,
        ).toBe(true);

        await client.query(
          `select app.disable_routine_telebirr_execution_transport($1::uuid, 'operator_requested')`,
          [randomUUID()],
        );
        disabled = true;
        await expect(
          execute(runtime, certificate, leaseCommand(policy.accountId)),
        ).rejects.toThrow();
        const role = await client.query<{ rolcanlogin: boolean; rolpassword: string | null }>(
          `select rolcanlogin, rolpassword from pg_authid where rolname = $1::text`,
          [runtimeRole],
        );
        expect(role.rows).toEqual([{ rolcanlogin: false, rolpassword: null }]);
      } finally {
        await runtime.end().catch(() => undefined);
        if (!disabled) {
          await client
            .query(
              `select app.disable_routine_telebirr_execution_transport($1::uuid, 'incident_stop')`,
              [randomUUID()],
            )
            .catch(() => undefined);
        }
      }
    });

    it('leases one eligible non-pilot job without a v2 approval and preserves one-use replay', async () => {
      const client = getClient();
      const originalModes = await client.query<{ feature_key: string; mode: string }>(
        `select feature_key, mode::text from app.feature_switches
          where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')
          order by feature_key`,
      );
      let attemptId: string | undefined;
      let leaseToken: string | undefined;
      let disabled = false;
      const password = randomBytes(32).toString('hex');
      const runtime = createRuntimeClient(password);
      try {
        await client.query(
          `update app.feature_switches set mode = case
            when feature_key in ('payment_verification', 'deposit_execution') then 'live'::app.feature_mode
            else 'disabled'::app.feature_mode end
           where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')`,
        );
        const policy = await persistentPolicyFixture(client, getOwnerAuthUserId());
        const deposit = await paidJob(client, 2501);
        const certificate = await activeCertificate(client, getOwnerAdminId());
        await client.query(
          `select app.activate_routine_telebirr_execution_transport(
            $1::uuid, $2::uuid, $3::uuid, $4::text
          )`,
          [getOwnerAuthUserId(), certificate.certificateId, randomUUID(), password],
        );
        await runtime.connect();
        const command = leaseCommand(policy.accountId);
        const first = await execute(runtime, certificate, command);
        expect(first.result).toMatchObject({
          jobId: deposit.jobId,
          intentId: deposit.depositIntentId,
          paymentClaimId: deposit.claimId,
          platformAgentAccountId: policy.accountId,
          playerId: deposit.playerId,
          amountMinor: 2501,
          currencyCode: 'ETB',
          phase: 'execute',
          paymentVerified: true,
          playerActive: true,
          playerDepositEligible: true,
          attemptNumber: 1,
          finalActionFenced: false,
        });
        expect((await execute(runtime, certificate, command, first.identities)).result).toEqual(
          first.result,
        );
        const leased = await client.query<{
          attempt_id: string;
          lease_token: string;
          owner_approvals: number;
          status: string;
        }>(
          `select attempt.id as attempt_id, job.lease_token::text,
             job.status::text, count(approval.id)::integer as owner_approvals
           from app.deposit_jobs job
           join app.deposit_execution_attempts attempt on attempt.deposit_job_id = job.id
           left join app.deposit_execution_owner_approvals approval on approval.execution_job_id = job.id
          where job.id = $1::uuid
          group by attempt.id, job.lease_token, job.status`,
          [deposit.jobId],
        );
        expect(leased.rows).toHaveLength(1);
        expect(leased.rows[0]).toMatchObject({ status: 'leased', owner_approvals: 0 });
        attemptId = leased.rows[0]!.attempt_id;
        leaseToken = leased.rows[0]!.lease_token;

        await client.query(
          `select app.disable_routine_telebirr_execution_transport($1::uuid, 'operator_requested')`,
          [randomUUID()],
        );
        disabled = true;
        await expect(
          execute(runtime, certificate, leaseCommand(policy.accountId)),
        ).rejects.toThrow();
      } finally {
        await runtime.end().catch(() => undefined);
        if (attemptId && leaseToken) {
          await client
            .query(
              `select * from app.cancel_deposit_execution_before_action(
                $1::uuid, $2::uuid, 'operator_stopped_before_action'
              )`,
              [attemptId, leaseToken],
            )
            .catch(() => undefined);
        }
        if (!disabled) {
          await client
            .query(
              `select app.disable_routine_telebirr_execution_transport($1::uuid, 'incident_stop')`,
              [randomUUID()],
            )
            .catch(() => undefined);
        }
        for (const row of originalModes.rows) {
          await client.query(
            `update app.feature_switches set mode = $2::app.feature_mode where feature_key = $1::text`,
            [row.feature_key, row.mode],
          );
        }
      }
    });
  });
}
