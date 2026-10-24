import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { paidJob, persistentPolicyFixture } from './routine-telebirr-processing-policy.suite.js';

const runtimeRole = 'fetanagent_routine_deposit_broker_runtime';
const brokerRole = 'fetanagent_routine_deposit_broker';
const commandSignature =
  'app.execute_agent_platform_routine_deposit_command(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,text,text,jsonb)';
const historyCommandSignature =
  'app.execute_agent_platform_routine_deposit_history_confirmation(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,text,text,jsonb)';
const historyWindowSignature = 'app.routine_telebirr_pending_history_window(uuid,uuid)';
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

function boundCommand(
  lease: ReturnType<typeof leaseCommand>,
  operation: string,
  binding: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractVersion: 1,
    protocolMode: lease.protocolMode,
    capability: lease.capability,
    requestId: randomUUID(),
    workerInstanceId: lease.workerInstanceId,
    operation,
    binding,
    ...extra,
  };
}

async function execute(
  client: Client,
  certificate: CertificateFixture,
  command: Record<string, unknown>,
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
  const functionName =
    command.operation === 'confirm_history'
      ? 'app.execute_agent_platform_routine_deposit_history_confirmation'
      : 'app.execute_agent_platform_routine_deposit_command';
  const result = await client.query<{ result: unknown }>(
    `select ${functionName}(
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
    it('is dormant after migration and exposes only three hardened routine functions', async () => {
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
      const historyPrivileges = await client.query<{
        broker_execute: boolean;
        runtime_execute: boolean;
        public_execute: boolean;
        hardened: boolean;
      }>(
        `select
        has_function_privilege($1::text, $3::text, 'execute') as broker_execute,
        has_function_privilege($2::text, $3::text, 'execute') as runtime_execute,
        has_function_privilege('public', $3::text, 'execute') as public_execute,
        (select procedure.prosecdef and procedure.proowner = 'postgres'::regrole
          and procedure.proconfig = array['search_path=pg_catalog']::text[]
          from pg_proc procedure where procedure.oid = $3::regprocedure) as hardened`,
        [brokerRole, runtimeRole, historyCommandSignature],
      );
      expect(historyPrivileges.rows).toEqual([
        {
          broker_execute: true,
          runtime_execute: false,
          public_execute: false,
          hardened: true,
        },
      ]);
      const windowPrivileges = await client.query<{
        broker_execute: boolean;
        runtime_execute: boolean;
        public_execute: boolean;
        hardened: boolean;
      }>(
        `select
        has_function_privilege($1::text, $3::text, 'execute') as broker_execute,
        has_function_privilege($2::text, $3::text, 'execute') as runtime_execute,
        has_function_privilege('public', $3::text, 'execute') as public_execute,
        (select procedure.prosecdef and procedure.proowner = 'postgres'::regrole
          and procedure.proconfig = array['search_path=pg_catalog']::text[]
          from pg_proc procedure where procedure.oid = $3::regprocedure) as hardened`,
        [brokerRole, runtimeRole, historyWindowSignature],
      );
      expect(windowPrivileges.rows).toEqual([
        {
          broker_execute: true,
          runtime_execute: false,
          public_execute: false,
          hardened: true,
        },
      ]);
      const ledgers = await client.query<{
        relforcerowsecurity: boolean;
        relname: string;
        relrowsecurity: boolean;
      }>(`select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relnamespace = 'app'::regnamespace and relname = any(array[
            'routine_telebirr_runtime_events', 'routine_telebirr_broker_requests',
            'routine_telebirr_dispatch_evidence', 'routine_telebirr_runtime_pauses',
            'routine_telebirr_history_confirmations'
          ]) order by relname`);
      expect(ledgers.rows).toHaveLength(5);
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
        const runtimeSurface = await runtime.query<{
          callable_functions: number;
          relation_privileges: number;
        }>(`
          select
            (select count(*)::integer from pg_proc routine
              join pg_namespace namespace on namespace.oid = routine.pronamespace
             where namespace.nspname not in ('pg_catalog', 'information_schema')
               and namespace.nspname !~ '^pg_(toast|temp)'
               and has_schema_privilege(current_user, namespace.oid, 'usage')
               and has_function_privilege(current_user, routine.oid, 'execute')
            ) as callable_functions,
            (select count(*)::integer from pg_class relation
              join pg_namespace namespace on namespace.oid = relation.relnamespace
             where namespace.nspname not in ('pg_catalog', 'information_schema')
               and namespace.nspname !~ '^pg_(toast|temp)'
               and has_schema_privilege(current_user, namespace.oid, 'usage')
               and case
                 when relation.relkind = 'S' then has_sequence_privilege(
                   current_user, relation.oid, 'usage,select,update'
                 )
                 when relation.relkind in ('r','p','v','m','f') then
                   has_table_privilege(
                     current_user, relation.oid,
                     'select,insert,update,delete,truncate,references,trigger,maintain'
                   ) or has_any_column_privilege(
                     current_user, relation.oid, 'select,insert,update,references'
                   )
                 else false
               end
            ) as relation_privileges
        `);
        expect(runtimeSurface.rows).toEqual([{ callable_functions: 3, relation_privileges: 0 }]);
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

    it('moves a paused unfenced lease to review without permitting a later Transfer', async () => {
      const client = getClient();
      const originalModes = await client.query<{ feature_key: string; mode: string }>(
        `select feature_key, mode::text from app.feature_switches
          where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')
          order by feature_key`,
      );
      let jobId: string | undefined;
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
        jobId = deposit.jobId;
        const certificate = await activeCertificate(client, getOwnerAdminId());
        await client.query(
          `select app.activate_routine_telebirr_execution_transport(
            $1::uuid, $2::uuid, $3::uuid, $4::text
          )`,
          [getOwnerAuthUserId(), certificate.certificateId, randomUUID(), password],
        );
        await runtime.connect();
        const command = leaseCommand(policy.accountId);
        const leased = (await execute(runtime, certificate, command)).result as Record<
          string,
          unknown
        >;
        const binding = {
          jobId: deposit.jobId,
          intentId: deposit.depositIntentId,
          attemptId: leased.attemptId,
          paymentClaimId: deposit.claimId,
          platformAgentAccountId: policy.accountId,
          playerId: deposit.playerId,
          amountMinor: 2501,
          currencyCode: 'ETB',
        };
        expect(leased).toMatchObject({ ...binding, phase: 'execute', finalActionFenced: false });
        const pauseCommand = boundCommand(command, 'pause', binding, {
          reason: 'execution_uncertain',
        });
        const paused = await execute(runtime, certificate, pauseCommand);
        expect(paused.result).toBeNull();
        expect(
          (await execute(runtime, certificate, pauseCommand, paused.identities)).result,
        ).toBeNull();
        const state = await client.query<{
          attempt_status: string;
          fence_count: number;
          intent_status: string;
          job_status: string;
          claim_count: number;
          review_count: number;
        }>(
          `select attempt.status::text as attempt_status,
             (attempt.final_action_fenced_at is not null)::integer as fence_count,
             intent.status::text as intent_status, job.status::text as job_status,
             (select count(*)::integer from app.deposit_payment_claims claim
               where claim.deposit_intent_id = intent.id) as claim_count,
             (select count(*)::integer from app.deposit_review_cases review
               where review.deposit_intent_id = intent.id and review.review_kind = 'execution'
                 and review.status = 'open') as review_count
           from app.deposit_jobs job
           join app.deposit_execution_attempts attempt on attempt.deposit_job_id = job.id
           join app.deposit_intents intent on intent.id = job.deposit_intent_id
           where job.id = $1::uuid`,
          [deposit.jobId],
        );
        expect(state.rows).toEqual([
          {
            attempt_status: 'cancelled_before_action',
            fence_count: 0,
            intent_status: 'execution_review',
            job_status: 'cancelled',
            claim_count: 1,
            review_count: 1,
          },
        ]);
        await expect(
          execute(runtime, certificate, boundCommand(command, 'fence', binding)),
        ).rejects.toThrow();
        await client.query(
          `select app.disable_routine_telebirr_execution_transport($1::uuid, 'operator_requested')`,
          [randomUUID()],
        );
        disabled = true;
      } finally {
        await runtime.end().catch(() => undefined);
        try {
          if (jobId) {
            const prepared = await client.query<{ attempt_id: string; lease_token: string }>(
              `select attempt.id as attempt_id, job.lease_token::text
                 from app.deposit_execution_attempts attempt
                 join app.deposit_jobs job on job.id = attempt.deposit_job_id
                where job.id = $1::uuid and attempt.status = 'prepared'
                  and job.status = 'leased' and job.lease_token is not null`,
              [jobId],
            );
            for (const row of prepared.rows) {
              await client.query(
                `select * from app.cancel_deposit_execution_before_action(
                  $1::uuid, $2::uuid, 'operator_stopped_before_action'
                )`,
                [row.attempt_id, row.lease_token],
              );
            }
          }
        } finally {
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
      }
    });

    it('reviews a fenced uncertain credit, skips that Player, and leases another payment', async () => {
      const client = getClient();
      const originalModes = await client.query<{ feature_key: string; mode: string }>(
        `select feature_key, mode::text from app.feature_switches
          where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')
          order by feature_key`,
      );
      const password = randomBytes(32).toString('hex');
      const runtime = createRuntimeClient(password);
      let disabled = false;
      try {
        await client.query(
          `update app.feature_switches set mode = case
            when feature_key in ('payment_verification', 'deposit_execution') then 'live'::app.feature_mode
            else 'disabled'::app.feature_mode end
           where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')`,
        );
        const policy = await persistentPolicyFixture(client, getOwnerAuthUserId());
        const first = await paidJob(client, 2501);
        const firstPlayer = await client.query<{
          customer_id: string;
          player_account_id: string;
        }>(`select customer_id, player_account_id from app.deposit_intents where id = $1::uuid`, [
          first.depositIntentId,
        ]);
        const samePlayer = await paidJob(client, 2502, 'telebirr', true, {
          customerId: firstPlayer.rows[0]!.customer_id,
          playerAccountId: firstPlayer.rows[0]!.player_account_id,
          playerId: first.playerId,
        });
        const otherPlayer = await paidJob(client, 2503);
        const certificate = await activeCertificate(client, getOwnerAdminId());
        await client.query(
          `select app.activate_routine_telebirr_execution_transport(
            $1::uuid, $2::uuid, $3::uuid, $4::text
          )`,
          [getOwnerAuthUserId(), certificate.certificateId, randomUUID(), password],
        );
        await runtime.connect();
        const worker = leaseCommand(policy.accountId);
        const leased = (await execute(runtime, certificate, worker)).result as Record<
          string,
          unknown
        >;
        expect(leased.jobId).toBe(first.jobId);
        const firstBinding = {
          jobId: first.jobId,
          intentId: first.depositIntentId,
          attemptId: leased.attemptId,
          paymentClaimId: first.claimId,
          platformAgentAccountId: policy.accountId,
          playerId: first.playerId,
          amountMinor: 2501,
          currencyCode: 'ETB',
        };
        await execute(runtime, certificate, boundCommand(worker, 'fence', firstBinding));
        const reviewCommand = boundCommand(worker, 'pause', firstBinding, {
          reason: 'execution_uncertain',
        });
        const reviewed = await execute(runtime, certificate, reviewCommand);
        expect(reviewed.result).toBeNull();
        expect(
          (await execute(runtime, certificate, reviewCommand, reviewed.identities)).result,
        ).toBeNull();
        const state = await client.query<{
          attempt_status: string;
          intent_status: string;
          exact_player_credit_match: boolean;
          routine_review_isolated: boolean;
          reconciliation_outcome: string;
          review_count: number;
          runtime_pause_count: number;
          claim_count: number;
        }>(
          `select attempt.status::text as attempt_status,
             intent.status::text as intent_status,
             attempt.exact_player_credit_match,
             attempt.routine_review_isolated,
             reconciliation.outcome::text as reconciliation_outcome,
             (select count(*)::integer from app.deposit_review_cases review
               where review.deposit_intent_id = intent.id
                 and review.review_kind = 'execution' and review.status = 'open') as review_count,
             (select count(*)::integer from app.routine_telebirr_runtime_pauses) as runtime_pause_count,
             (select count(*)::integer from app.deposit_payment_claims claim
               where claim.deposit_intent_id = intent.id) as claim_count
           from app.deposit_intents intent
           join app.deposit_execution_attempts attempt on attempt.deposit_intent_id = intent.id
           join app.execution_reconciliations reconciliation
             on reconciliation.deposit_execution_attempt_id = attempt.id
           where intent.id = $1::uuid`,
          [first.depositIntentId],
        );
        expect(state.rows).toEqual([
          {
            attempt_status: 'review_required',
            intent_status: 'execution_review',
            exact_player_credit_match: false,
            routine_review_isolated: true,
            reconciliation_outcome: 'ambiguous',
            review_count: 1,
            runtime_pause_count: 0,
            claim_count: 1,
          },
        ]);
        expect(
          (await execute(runtime, certificate, boundCommand(worker, 'reconcile', firstBinding)))
            .result,
        ).toEqual({ outcome: 'uncertain' });
        await expect(
          execute(runtime, certificate, boundCommand(worker, 'fence', firstBinding)),
        ).rejects.toThrow();

        const next = (
          await execute(runtime, certificate, {
            ...leaseCommand(policy.accountId),
            workerInstanceId: worker.workerInstanceId,
          })
        ).result as Record<string, unknown>;
        expect(next.jobId).toBe(otherPlayer.jobId);
        expect(next.playerId).toBe(otherPlayer.playerId);
        const samePlayerState = await client.query<{ status: string; attempt_count: number }>(
          `select job.status::text as status,
             (select count(*)::integer from app.deposit_execution_attempts attempt
               where attempt.deposit_intent_id = job.deposit_intent_id) as attempt_count
           from app.deposit_jobs job where job.id = $1::uuid`,
          [samePlayer.jobId],
        );
        expect(samePlayerState.rows).toEqual([{ status: 'queued', attempt_count: 0 }]);
        const nextBinding = {
          jobId: otherPlayer.jobId,
          intentId: otherPlayer.depositIntentId,
          attemptId: next.attemptId,
          paymentClaimId: otherPlayer.claimId,
          platformAgentAccountId: policy.accountId,
          playerId: otherPlayer.playerId,
          amountMinor: 2503,
          currencyCode: 'ETB',
        };
        expect(
          (
            await execute(
              runtime,
              certificate,
              boundCommand(worker, 'pause', nextBinding, {
                reason: 'execution_uncertain',
              }),
            )
          ).result,
        ).toBeNull();
        await client.query(
          `select app.disable_routine_telebirr_execution_transport($1::uuid, 'operator_requested')`,
          [randomUUID()],
        );
        disabled = true;
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
        for (const row of originalModes.rows) {
          await client.query(
            `update app.feature_switches set mode = $2::app.feature_mode where feature_key = $1::text`,
            [row.feature_key, row.mode],
          );
        }
      }
    });

    it('leases and reconciles one non-pilot job without a v2 approval or Transfer retry', async () => {
      const client = getClient();
      const originalModes = await client.query<{ feature_key: string; mode: string }>(
        `select feature_key, mode::text from app.feature_switches
          where feature_key in ('payment_verification', 'deposit_execution', 'private_live_deposit_pilot')
          order by feature_key`,
      );
      let jobId: string | undefined;
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
        jobId = deposit.jobId;
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
        const recovered = await execute(runtime, certificate, {
          ...leaseCommand(policy.accountId),
          workerInstanceId: command.workerInstanceId,
        });
        expect(recovered.result).toEqual(first.result);
        const otherWorker = await execute(runtime, certificate, leaseCommand(policy.accountId));
        expect(otherWorker.result).toBeNull();
        const leased = await client.query<{
          attempt_id: string;
          lease_token: string;
          owner_approvals: number;
          attempt_count: number;
          status: string;
        }>(
          `select attempt.id as attempt_id, job.lease_token::text,
             job.status::text, job.attempt_count,
             count(approval.execution_job_id)::integer as owner_approvals
           from app.deposit_jobs job
           join app.deposit_execution_attempts attempt on attempt.deposit_job_id = job.id
           left join app.deposit_execution_owner_approvals approval on approval.execution_job_id = job.id
          where job.id = $1::uuid
          group by attempt.id, job.lease_token, job.status, job.attempt_count`,
          [deposit.jobId],
        );
        expect(leased.rows).toHaveLength(1);
        expect(leased.rows[0]).toMatchObject({
          status: 'leased',
          attempt_count: 1,
          owner_approvals: 0,
        });
        const binding = {
          jobId: deposit.jobId,
          intentId: deposit.depositIntentId,
          attemptId: leased.rows[0]!.attempt_id,
          paymentClaimId: deposit.claimId,
          platformAgentAccountId: policy.accountId,
          playerId: deposit.playerId,
          amountMinor: 2501,
          currencyCode: 'ETB',
        };
        const fenced = await execute(runtime, certificate, boundCommand(command, 'fence', binding));
        expect(fenced.result).toMatchObject({ ...binding, firstFenceAcquired: true });
        const fenceTimes = fenced.result as { issuedAtMs: number; validUntilMs: number };
        expect(fenceTimes.validUntilMs - fenceTimes.issuedAtMs).toBe(10_000);

        const dispatchCommand = boundCommand(command, 'record_dispatch', binding, {
          dispatch: {
            outcome: 'submission_attempted',
            providerResponseDigest: digest(),
            exactPlayerCreditMatch: true,
          },
        });
        const dispatched = await execute(runtime, certificate, dispatchCommand);
        expect(dispatched.result).toEqual(binding);
        expect(
          (await execute(runtime, certificate, dispatchCommand, dispatched.identities)).result,
        ).toEqual(binding);
        expect(
          (
            await client.query<{ count: number }>(
              `select count(*)::integer as count from app.routine_telebirr_dispatch_evidence
                where broker_request_id = $1::uuid`,
              [dispatchCommand.requestId],
            )
          ).rows,
        ).toEqual([{ count: 1 }]);
        expect(
          (await execute(runtime, certificate, boundCommand(command, 'reconcile', binding))).result,
        ).toEqual({ outcome: 'pending' });

        const fencedWindow = await client.query<{ from: string; until: string }>(
          `select
             to_char(attempt.final_action_fenced_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "from",
             to_char(attempt.reconciliation_required_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "until"
           from app.deposit_execution_attempts attempt where attempt.id = $1::uuid`,
          [binding.attemptId],
        );
        const signedWindow = await runtime.query<{
          history_window: { from: string; until: string };
        }>(
          `select app.routine_telebirr_pending_history_window($1::uuid, $2::uuid)
             as history_window`,
          [binding.attemptId, certificate.certificateId],
        );
        expect(signedWindow.rows[0]!.history_window).toEqual(fencedWindow.rows[0]);
        await expect(
          runtime.query(`select app.routine_telebirr_pending_history_window($1::uuid, $2::uuid)`, [
            binding.attemptId,
            randomUUID(),
          ]),
        ).rejects.toThrow('activation is unavailable');

        const matchedHistory = await client.query<{ matched_at: string }>(
          `select to_char(
              (attempt.final_action_fenced_at
                + (attempt.reconciliation_required_at - attempt.final_action_fenced_at) / 2
              ) at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) as matched_at
             from app.deposit_execution_attempts attempt where attempt.id = $1::uuid`,
          [binding.attemptId],
        );
        expect(matchedHistory.rows).toHaveLength(1);
        await expect(
          execute(
            runtime,
            certificate,
            boundCommand(command, 'confirm_history', binding, {
              observation: {
                transactionId: '110891902',
                requestId: '19686411',
                occurredAt: '2026-10-11T18:33:14.257728Z',
                playerId: deposit.playerId,
                amountMinor: 2501,
                currencyCode: 'ETB',
                approvedHistoryMatchCount: 1,
              },
            }),
          ),
        ).rejects.toThrow('outside the server-authored final action');
        await expect(
          execute(
            runtime,
            certificate,
            boundCommand(command, 'confirm_history', binding, {
              observation: {
                transactionId: '110891902',
                requestId: '19686411',
                occurredAt: matchedHistory.rows[0]!.matched_at,
                playerId: deposit.playerId,
                amountMinor: 2502,
                currencyCode: 'ETB',
                approvedHistoryMatchCount: 1,
              },
            }),
          ),
        ).rejects.toThrow('binding does not match');
        const historyCommand = boundCommand(command, 'confirm_history', binding, {
          observation: {
            transactionId: '110891902',
            requestId: '19686411',
            occurredAt: matchedHistory.rows[0]!.matched_at,
            playerId: deposit.playerId,
            amountMinor: 2501,
            currencyCode: 'ETB',
            approvedHistoryMatchCount: 1,
          },
        });
        const settled = await execute(runtime, certificate, historyCommand);
        expect(settled.result).toMatchObject({
          ...binding,
          outcome: 'confirmed_executed',
          exactHistoryMatchCount: 1,
          playerCreditConfirmed: true,
        });
        expect(
          (await execute(runtime, certificate, historyCommand, settled.identities)).result,
        ).toEqual(settled.result);
        const protectedReceipt = await client.query<{ count: number }>(
          `select count(*)::integer as count from app.routine_telebirr_history_confirmations
            where execution_attempt_id = $1::uuid`,
          [binding.attemptId],
        );
        expect(protectedReceipt.rows).toEqual([{ count: 1 }]);
        const confirmed = await execute(
          runtime,
          certificate,
          boundCommand(command, 'reconcile', binding),
        );
        expect(confirmed.result).toMatchObject({
          ...binding,
          outcome: 'confirmed_executed',
          exactHistoryMatchCount: 1,
          playerCreditConfirmed: true,
          reconciliationId: expect.any(String),
        });
        const reconciliationId = (confirmed.result as { reconciliationId: string })
          .reconciliationId;
        expect(
          (
            await execute(
              runtime,
              certificate,
              boundCommand(command, 'complete', binding, { reconciliationId }),
            )
          ).result,
        ).toEqual(binding);
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
        try {
          if (jobId) {
            const prepared = await client.query<{ attempt_id: string; lease_token: string }>(
              `select attempt.id as attempt_id, job.lease_token::text
                 from app.deposit_execution_attempts attempt
                 join app.deposit_jobs job on job.id = attempt.deposit_job_id
                where job.id = $1::uuid and attempt.status = 'prepared'
                  and job.status = 'leased' and job.lease_token is not null`,
              [jobId],
            );
            for (const row of prepared.rows) {
              await client.query(
                `select * from app.cancel_deposit_execution_before_action(
                  $1::uuid, $2::uuid, 'operator_stopped_before_action'
                )`,
                [row.attempt_id, row.lease_token],
              );
            }
          }
        } finally {
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
      }
    });
  });
}
