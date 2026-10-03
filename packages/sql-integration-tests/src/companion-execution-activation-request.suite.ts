import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import {
  loadCompanionActivationDatabaseSnapshot,
  retainCompanionActivationAttestationRow,
} from '@fetanagent/agent-platform-companion-activation-issuer';
import { prepareGuardedCompanionEmergencyStopRehearsal } from '@fetanagent/agent-platform-companion-activation-issuer/guarded-emergency-stop-rehearsal';

import {
  completeVerification,
  prepareTelebirrPilot,
  prepareVerification,
} from './private-live-telebirr-proof-lineage.suite.js';

function digest(): string {
  return `sha256:${createHash('sha256').update(randomUUID()).digest('hex')}`;
}

const emergencyStopScript = fileURLToPath(
  new URL(
    '../../../infra/sql/production-companion-execution-emergency-disable.sql',
    import.meta.url,
  ),
);

// Read the diagnostic SELECT as source only. The integration image never loads
// the operator entry point, its credentials, signing key, or runtime dependencies.
const diagnosticSource = await readFile(
  new URL(
    '../../agent-platform-companion-operator-host/src/activation-diagnostic.ts',
    import.meta.url,
  ),
  'utf8',
);
const activationDiagnosticSql = (() => {
  const sql = diagnosticSource.match(/export const ACTIVATION_DIAGNOSTIC_SQL = `([^`]+)`;/u)?.[1];
  if (!sql) throw new Error('Activation diagnostic SELECT is missing.');
  return sql;
})();

function runDisposableStop(administratorPassword: string, projectRef: string): Promise<string> {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/^PG[A-Z0-9_]*$/iu.test(name) || name === 'DATABASE_URL') {
      delete environment[name];
    }
  }
  Object.assign(environment, {
    PGAPPNAME: 'fetanagent_companion_execution_disposable_stop',
    PGPASSFILE: '/dev/null',
    PGPASSWORD: administratorPassword,
    PGSERVICEFILE: '/dev/null',
    PGSSLMODE: 'disable',
    PRODUCTION_PROJECT_REF: projectRef,
  });
  return new Promise((resolve, reject) => {
    execFile(
      'psql',
      [
        '-X',
        '--host=postgres',
        '--port=5432',
        '--username=postgres',
        '--dbname=postgres',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--file',
        emergencyStopScript,
      ],
      { encoding: 'utf8', env: environment, maxBuffer: 64 * 1024, timeout: 30_000 },
      (error, stdout) => {
        if (error !== null) {
          reject(new Error('The disposable companion stop failed closed.', { cause: error }));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function registerCompanionExecutionActivationRequestSqlTests(
  getClient: () => Client,
  getOwnerAuthUserId: () => string,
  getOwnerAdminId: () => string,
  getAdministratorPassword: () => string,
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
        readonly attestation_rows: string;
        readonly consumption_rows: string;
        readonly attestation_rls: boolean;
        readonly attestation_handoff_not_null: boolean;
        readonly attestation_owner_insert: boolean;
        readonly attestation_bridge_insert: boolean;
        readonly consumption_rls: boolean;
        readonly public_arm_execute: boolean;
        readonly owner_arm_execute: boolean;
        readonly runtime_arm_execute: boolean;
      }>(`
        select
          (select count(*) from app.agent_platform_companion_execution_activation_requests)
            as row_count,
          relation.relrowsecurity as rls_enabled,
          relation.relforcerowsecurity as rls_forced,
          has_function_privilege('fetanagent_owner_control',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,text,uuid)',
            'execute') as owner_execute,
          has_function_privilege('public',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,text,uuid)',
            'execute') as public_execute,
          has_function_privilege('fetanagent_companion_execution_bridge',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,text,uuid)',
            'execute') as bridge_execute,
          has_function_privilege('fetanagent_deposit_executor_runtime',
            'app.prepare_agent_platform_companion_execution_activation_request(uuid,uuid,bigint,uuid,text,text,text,uuid)',
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
            where singleton) as control_state,
          (select count(*) from app.agent_platform_companion_execution_activation_attestations)
            as attestation_rows,
          (select count(*) from app.agent_platform_companion_execution_activation_consumptions)
            as consumption_rows,
          (select relrowsecurity and relforcerowsecurity from pg_class
            where oid = 'app.agent_platform_companion_execution_activation_attestations'::regclass)
            as attestation_rls,
          (select attnotnull from pg_attribute
            where attrelid =
              'app.agent_platform_companion_execution_activation_attestations'::regclass
              and attname = 'execution_handoff_sha256') as attestation_handoff_not_null,
          has_table_privilege('fetanagent_owner_control',
            'app.agent_platform_companion_execution_activation_attestations', 'insert')
            as attestation_owner_insert,
          has_table_privilege('fetanagent_companion_execution_bridge_runtime',
            'app.agent_platform_companion_execution_activation_attestations', 'insert')
            as attestation_bridge_insert,
          (select relrowsecurity and relforcerowsecurity from pg_class
            where oid = 'app.agent_platform_companion_execution_activation_consumptions'::regclass)
            as consumption_rls,
          has_function_privilege('public',
            'app.activate_agent_platform_companion_execution_once(uuid,uuid,text)',
            'execute') as public_arm_execute,
          has_function_privilege('fetanagent_owner_control',
            'app.activate_agent_platform_companion_execution_once(uuid,uuid,text)',
            'execute') as owner_arm_execute,
          has_function_privilege('fetanagent_companion_execution_bridge_runtime',
            'app.activate_agent_platform_companion_execution_once(uuid,uuid,text)',
            'execute') as runtime_arm_execute
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
          attestation_rows: '0',
          consumption_rows: '0',
          attestation_rls: true,
          attestation_handoff_not_null: true,
          attestation_owner_insert: false,
          attestation_bridge_insert: false,
          consumption_rls: true,
          public_arm_execute: false,
          owner_arm_execute: false,
          runtime_arm_execute: false,
        },
      ]);
    });

    it('rejects preparation without current authority and leaves all money state inert', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const call = async (release: string, tree = `sha256:${'c'.repeat(64)}`) =>
          client.query(
            `select * from app.prepare_agent_platform_companion_execution_activation_request(
            $1::uuid, $2::uuid, 1::bigint, $3::uuid, $4::text, $5::text,
            $6::text, $7::uuid
          )`,
            [
              getOwnerAuthUserId(),
              randomUUID(),
              randomUUID(),
              release,
              `sha256:${'b'.repeat(64)}`,
              tree,
              randomUUID(),
            ],
          );
        await client.query('savepoint invalid_release');
        await expect(call('unreviewed')).rejects.toThrow(
          'The companion execution activation request is invalid.',
        );
        await client.query('rollback to savepoint invalid_release');

        await client.query('savepoint invalid_tree');
        await expect(call('a'.repeat(40), 'not-a-digest')).rejects.toThrow(
          'The companion execution activation request is invalid.',
        );
        await client.query('rollback to savepoint invalid_tree');

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

    it('keeps the execution runtime memberless, passwordless, and without a stop grant', async () => {
      const result = await getClient().query<{
        readonly runtime_roles: string;
        readonly non_admin_members: string;
        readonly public_execute: boolean;
        readonly runtime_execute: boolean;
      }>(`
        select
          (select count(*) from pg_authid role
            where role.rolname in (
              'fetanagent_companion_execution_bridge',
              'fetanagent_companion_execution_bridge_runtime'
            )
              and not role.rolcanlogin and not role.rolinherit
              and not role.rolsuper and not role.rolcreatedb
              and not role.rolcreaterole and not role.rolreplication
              and not role.rolbypassrls and role.rolpassword is null)
            as runtime_roles,
          (select count(*) from pg_auth_members membership
            join pg_roles granted on granted.oid = membership.roleid
            join pg_roles member on member.oid = membership.member
            where granted.rolname = 'fetanagent_companion_execution_bridge'
              and member.rolname <> 'postgres') as non_admin_members,
          has_function_privilege('public',
            'app.disable_agent_platform_companion_execution_transport()',
            'EXECUTE') as public_execute,
          has_function_privilege('fetanagent_companion_execution_bridge_runtime',
            'app.disable_agent_platform_companion_execution_transport()',
            'EXECUTE') as runtime_execute
      `);
      expect(result.rows).toEqual([
        {
          runtime_roles: '2',
          non_admin_members: '0',
          public_execute: false,
          runtime_execute: false,
        },
      ]);
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
        const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        const publicKeyBytes = publicKey.export({ type: 'spki', format: 'der' });
        const devicePublicKeySpki = publicKeyBytes.toString('base64url');
        const deviceKeyDigest = `sha256:${createHash('sha256').update(publicKeyBytes).digest('hex')}`;
        const certificateBody = {
          certificateId,
          deviceKeyId,
          devicePublicKeySpki,
          devicePublicKeySpkiSha256: deviceKeyDigest,
        };
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
            $7::text, $8::uuid, $9::text, $10::text, $11::text,
            $12::text, '0.1.10', clock_timestamp() - interval '90 seconds',
            clock_timestamp() + interval '3 minutes',
            clock_timestamp() - interval '1 minute',
            clock_timestamp() - interval '1 minute',
            clock_timestamp() + interval '1 hour', $13::jsonb,
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
            devicePublicKeySpki,
            deviceKeyDigest,
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
            $7::text, $8::text, $9::text, $10::text,
            $11::jsonb, '{}'::jsonb,
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
            JSON.stringify(certificateBody),
          ],
        );

        const requestKey = randomUUID();
        const releaseSha = 'a'.repeat(40);
        const archiveDigest = digest();
        const treeDigest = digest();
        const prepare = (key: string, release: string, tree = treeDigest) =>
          client.query<{
            readonly valid_until: Date;
            readonly replayed: boolean;
          }>(
            `select * from app.prepare_agent_platform_companion_execution_activation_request(
            $1::uuid, $2::uuid, $3::bigint, $4::uuid, $5::text, $6::text,
            $7::text, $8::uuid
          )`,
            [
              getOwnerAuthUserId(),
              pilot.pilotRevisionId,
              activationEpoch,
              certificateId,
              release,
              archiveDigest,
              tree,
              key,
            ],
          );
        const created = await prepare(requestKey, releaseSha);
        expect(created.rows).toHaveLength(1);
        expect(created.rows[0]!.replayed).toBe(false);
        const snapshot = await loadCompanionActivationDatabaseSnapshot(requestKey, client);
        expect(snapshot.request.requestKey).toBe(requestKey);
        expect(snapshot.request.pilotRevisionId).toBe(pilot.pilotRevisionId);
        expect(snapshot.request.activationEpoch).toBe(activationEpoch);
        expect(snapshot.currentIdentity).toEqual({
          pilotRevisionId: pilot.pilotRevisionId,
          activationEpoch,
          certificateId,
          platformAgentAccountId: snapshot.request.platformAgentAccountId,
        });
        expect(snapshot.certificate.devicePublicKeySpki).toBe(devicePublicKeySpki);
        await client.query('savepoint activation_diagnostic');
        // This deliberately non-TLS disposable client must NOT pass the real
        // database boundary, but all other columns are evaluated by PostgreSQL.
        const beforeDiagnostic = await client.query(activationDiagnosticSql, [requestKey]);
        expect(beforeDiagnostic.rows).toHaveLength(1);
        expect(beforeDiagnostic.rows[0]).toMatchObject({
          request_key: requestKey,
          database_boundary: false,
          financial_state: false,
          request_binding: true,
          historical_window: true,
          certificate_binding: true,
          device_public_key_spki: devicePublicKeySpki,
        });
        expect(beforeDiagnostic.rows[0]!.requested_at).toBeInstanceOf(Date);
        expect(beforeDiagnostic.rows[0]!.request_expires_at).toBeInstanceOf(Date);
        await client.query(`update app.feature_switches set mode = 'disabled'
          where feature_key::text in ('deposit_execution', 'payment_verification',
            'withdrawal_collection', 'withdrawal_validation', 'private_live_deposit_pilot',
            'cbe_birr_authoritative_verification', 'telebirr_authoritative_verification')`);
        await client.query(
          `update app.private_live_deposit_pilot_revisions
          set status = 'stopped', stopped_at = clock_timestamp(),
            stopped_by_admin_id = $2::uuid, stop_reason_code = 'execution_uncertainty'
          where id = $1::uuid`,
          [pilot.pilotRevisionId, ownerAdminId],
        );
        await expect(loadCompanionActivationDatabaseSnapshot(requestKey, client)).rejects.toThrow(
          'The companion activation database snapshot is unavailable.',
        );
        const stoppedDiagnostic = await client.query(activationDiagnosticSql, [requestKey]);
        expect(stoppedDiagnostic.rows[0]).toMatchObject({
          request_key: requestKey,
          database_boundary: false,
          financial_state: true,
          request_binding: true,
          historical_window: true,
          certificate_binding: true,
        });
        expect((await client.query(activationDiagnosticSql, [randomUUID()])).rows).toEqual([]);
        const noDiagnosticAuthority = await client.query(`select
          (select count(*) from app.agent_platform_companion_execution_activation_requests) as requests,
          (select count(*) from app.agent_platform_companion_execution_activation_attestations) as attestations,
          (select count(*) from app.agent_platform_companion_execution_activation_consumptions) as consumptions,
          (select control_state from app.agent_platform_companion_execution_control where singleton) as control`);
        expect(noDiagnosticAuthority.rows).toEqual([
          { requests: '1', attestations: '0', consumptions: '0', control: 'disabled' },
        ]);
        await client.query('rollback to savepoint activation_diagnostic');
        await expect(loadCompanionActivationDatabaseSnapshot(randomUUID(), client)).rejects.toThrow(
          'The companion activation database snapshot is unavailable.',
        );
        await client.query('savepoint revoked_snapshot');
        await client.query(
          `insert into app.agent_platform_companion_device_revocations (
            certificate_id, revocation_request_key, revoked_by_admin_id,
            revoked_at, reason
          ) values ($1::uuid, $2::uuid, $3::uuid, clock_timestamp(), 'owner_requested')`,
          [certificateId, randomUUID(), ownerAdminId],
        );
        await expect(loadCompanionActivationDatabaseSnapshot(requestKey, client)).rejects.toThrow(
          'The companion activation database snapshot is unavailable.',
        );
        await client.query('rollback to savepoint revoked_snapshot');
        expect(
          (await loadCompanionActivationDatabaseSnapshot(requestKey, client)).request.requestKey,
        ).toBe(requestKey);
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
        await client.query('savepoint changed_tree_replay');
        await expect(prepare(requestKey, releaseSha, digest())).rejects.toThrow(
          'The companion execution activation request replay conflicts.',
        );
        await client.query('rollback to savepoint changed_tree_replay');

        const retained = await client.query<{
          readonly count: string;
          readonly tree_digest_matches: boolean;
        }>(
          `select count(*), bool_and(companion_installation_tree_sha256 = $1::text)
             as tree_digest_matches
             from app.agent_platform_companion_execution_activation_requests`,
          [treeDigest],
        );
        expect(retained.rows).toEqual([{ count: '1', tree_digest_matches: true }]);
        const dormant = await client.query<{ readonly control_state: string }>(
          'select control_state from app.agent_platform_companion_execution_control where singleton',
        );
        expect(dormant.rows).toEqual([{ control_state: 'disabled' }]);

        const activate = (password: string) =>
          client.query<{ readonly valid_until: Date }>(
            `select app.activate_agent_platform_companion_execution_once(
              $1::uuid, $2::uuid, $3::text
            ) as valid_until`,
            [getOwnerAuthUserId(), requestKey, password],
          );
        await client.query('savepoint missing_attestation');
        await expect(activate('e'.repeat(64))).rejects.toThrow(
          'The one-use companion execution request is unavailable.',
        );
        await client.query('rollback to savepoint missing_attestation');

        const certificateDigest = await client.query<{
          readonly certificate_body_digest: string;
        }>(
          `select certificate_body_digest
             from app.agent_platform_companion_enrollment_certificates
            where certificate_id = $1::uuid`,
          [certificateId],
        );
        expect(certificateDigest.rows).toHaveLength(1);
        const attest = (archive: string) =>
          client.query(
            `insert into app.agent_platform_companion_execution_activation_attestations (
            request_key, certificate_body_digest, companion_release_sha,
            companion_archive_sha256, companion_installation_tree_sha256,
            challenge_digest, launch_proof_digest, execution_handoff_sha256,
            process_id, process_started_at,
            challenge_issued_at, release_observed_at, process_observed_at, verified_at
          ) values (
            $1::uuid, $2::text, $3::text, $4::text, $5::text,
            $6::text, $7::text, $8::text, 4242,
            clock_timestamp() - interval '10 minutes',
            clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp()
          )`,
            [
              requestKey,
              certificateDigest.rows[0]!.certificate_body_digest,
              releaseSha,
              archive,
              treeDigest,
              digest(),
              digest(),
              digest(),
            ],
          );

        await client.query('savepoint mismatched_attestation');
        await attest(digest());
        await expect(activate('e'.repeat(64))).rejects.toThrow(
          'The companion execution activation lineage is not current.',
        );
        await client.query('rollback to savepoint mismatched_attestation');

        const witnessTime = await client.query<{ readonly now: Date }>(
          'select clock_timestamp() as now',
        );
        const observedAt = witnessTime.rows[0]!.now.toISOString();
        const handoffDigest = digest();
        const witness = {
          requestKey,
          certificateBodyDigest: certificateDigest.rows[0]!.certificate_body_digest,
          companionReleaseSha: releaseSha,
          companionArchiveSha256: archiveDigest,
          companionInstallationTreeSha256: treeDigest,
          challengeDigest: digest(),
          launchProofDigest: digest(),
          executionHandoffSha256: handoffDigest,
          processId: 4242,
          processStartedAt: new Date(witnessTime.rows[0]!.now.getTime() - 600_000).toISOString(),
          challengeIssuedAt: observedAt,
          releaseObservedAt: observedAt,
          processObservedAt: observedAt,
          verifiedAt: observedAt,
        };
        await expect(
          retainCompanionActivationAttestationRow(
            { ...witness, companionArchiveSha256: digest() },
            client,
          ),
        ).rejects.toThrow('The companion activation attestation could not be retained.');
        await retainCompanionActivationAttestationRow(witness, client);
        const attestationRow = await client.query<{
          readonly handoff_matches: boolean;
          readonly retained_rows: string;
        }>(
          `
          select
            (select count(*) from app.agent_platform_companion_execution_activation_attestations)
              as retained_rows,
            (select execution_handoff_sha256 = $1::text
               from app.agent_platform_companion_execution_activation_attestations
              where request_key = $2::uuid) as handoff_matches
        `,
          [handoffDigest, requestKey],
        );
        expect(attestationRow.rows).toEqual([{ handoff_matches: true, retained_rows: '1' }]);

        await client.query('savepoint invalid_password');
        await expect(activate('not-a-runtime-password')).rejects.toThrow(
          'The companion execution activation input is invalid.',
        );
        await client.query('rollback to savepoint invalid_password');

        await client.query('savepoint revoked_certificate');
        await client.query(
          `insert into app.agent_platform_companion_device_revocations (
            certificate_id, revocation_request_key, revoked_by_admin_id,
            revoked_at, reason
          ) values ($1::uuid, $2::uuid, $3::uuid, clock_timestamp(), 'owner_requested')`,
          [certificateId, randomUUID(), ownerAdminId],
        );
        await expect(activate('e'.repeat(64))).rejects.toThrow(
          'The companion execution activation lineage is not current.',
        );
        await client.query('rollback to savepoint revoked_certificate');

        const preparedProof = await prepareVerification(client, pilot);
        const verifiedProof = await completeVerification(client, pilot, preparedProof, {
          disposition: 'settlement_candidate',
          reasonCode: 'exact_proof_match',
        });
        expect(verifiedProof.row.execution_job_id).toEqual(expect.any(String));

        await client.query('savepoint competing_verified_job');
        const competingProof = await prepareVerification(client, pilot, 1);
        await completeVerification(client, pilot, competingProof, {
          disposition: 'settlement_candidate',
          reasonCode: 'exact_proof_match',
        });
        await expect(activate('e'.repeat(64))).rejects.toThrow(
          'An execution or reconciliation boundary is already open.',
        );
        await client.query('rollback to savepoint competing_verified_job');

        const queuedBoundary = await client.query<{
          readonly job_ready: boolean;
          readonly intent_ready: boolean;
          readonly reservation_ready: boolean;
          readonly outcome_ready: boolean;
          readonly platform_ready: boolean;
        }>(
          `select
             job.job_kind = 'execute_deposit' and job.status = 'queued'
               and job.attempt_count = 0 and job.max_attempts = 1
               and job.lease_token is null and job.leased_by is null
               and job.lease_expires_at is null
               and job.run_after <= clock_timestamp() as job_ready,
             intent.status = 'execution_pending' and intent.verified_at is not null
               and intent.expected_amount_minor = 2500
               and intent.currency_code = 'ETB' as intent_ready,
             exists (
               select 1 from app.private_live_deposit_pilot_reservations reservation
                where reservation.deposit_intent_id = intent.id
                  and reservation.pilot_revision_id = $2::uuid
                  and reservation.player_owner_customer_id_snapshot = intent.customer_id
                  and reservation.player_account_id = intent.player_account_id
                  and reservation.payment_provider_id = intent.payment_provider_id
                  and reservation.amount_minor = intent.expected_amount_minor
                  and reservation.currency_code = intent.currency_code
             ) as reservation_ready,
             exists (
               select 1 from app.private_live_deposit_pilot_reservations reservation
               join app.private_live_telebirr_verification_outcomes outcome
                 on outcome.deposit_intent_id = intent.id
                and outcome.private_live_deposit_pilot_proof_id =
                    reservation.private_live_deposit_pilot_proof_id
                and outcome.provider_payment_evidence_id =
                    reservation.provider_payment_evidence_id
                and outcome.pilot_revision_id = $2::uuid
                and outcome.player_account_id = intent.player_account_id
                and outcome.payment_provider_id = intent.payment_provider_id
                and outcome.submitting_customer_id = reservation.submitting_customer_id
                and outcome.player_owner_customer_id_snapshot = intent.customer_id
                where reservation.deposit_intent_id = intent.id
                  and outcome.disposition = 'settlement_candidate'
                  and outcome.reason_code = 'exact_proof_match'
                  and outcome.principal_amount_minor = intent.expected_amount_minor
                  and outcome.currency_code = intent.currency_code
             ) as outcome_ready,
             exists (
               select 1 from app.payment_providers provider
               join app.platform_agent_accounts account
                 on account.id = $3::uuid
                and account.platform_id = intent.platform_id
                where provider.id = intent.payment_provider_id
                  and provider.code = 'telebirr' and provider.status = 'active'
             ) as platform_ready
           from app.deposit_jobs job
           join app.deposit_intents intent on intent.id = job.deposit_intent_id
          where job.id = $1::uuid`,
          [
            verifiedProof.row.execution_job_id,
            pilot.pilotRevisionId,
            snapshot.request.platformAgentAccountId,
          ],
        );
        expect(queuedBoundary.rows).toEqual([
          {
            job_ready: true,
            intent_ready: true,
            reservation_ready: true,
            outcome_ready: true,
            platform_ready: true,
          },
        ]);

        const activated = await activate('e'.repeat(64));
        expect(activated.rows).toHaveLength(1);
        expect(activated.rows[0]!.valid_until.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
        const armed = await client.query<{
          readonly control_state: string;
          readonly consumed: string;
          readonly runtime_login: boolean;
          readonly runtime_passworded: boolean;
          readonly has_runtime_member: boolean;
          readonly valid_until_matches: boolean;
          readonly open_jobs: string;
        }>(`
          select
            (select control_state from app.agent_platform_companion_execution_control
              where singleton) as control_state,
            (select count(*) from app.agent_platform_companion_execution_activation_consumptions)
              as consumed,
            (select role.rolcanlogin from pg_authid role
              where role.rolname = 'fetanagent_companion_execution_bridge_runtime')
              as runtime_login,
            (select role.rolpassword like 'SCRAM-SHA-256$%' from pg_authid role
              where role.rolname = 'fetanagent_companion_execution_bridge_runtime')
              as runtime_passworded,
            pg_has_role('fetanagent_companion_execution_bridge_runtime',
              'fetanagent_companion_execution_bridge', 'member')
              as has_runtime_member,
            (select role.rolvaliduntil = control.expires_at
              from pg_authid role
              cross join app.agent_platform_companion_execution_control control
              where role.rolname = 'fetanagent_companion_execution_bridge_runtime'
                and control.singleton) as valid_until_matches,
            (select count(*) from app.deposit_jobs job
              where job.status in ('queued', 'leased', 'retry_wait')) as open_jobs
        `);
        expect(armed.rows).toEqual([
          {
            control_state: 'active',
            consumed: '1',
            runtime_login: true,
            runtime_passworded: true,
            has_runtime_member: true,
            valid_until_matches: true,
            open_jobs: '1',
          },
        ]);

        const watchdog = await client.query<{
          readonly lease_count: string;
          readonly initial_deadline_bounded: boolean;
        }>(`
          select count(*) as lease_count,
                 bool_and(lease_expires_at <= heartbeat_at + interval '45 seconds'
                   and lease_expires_at <= hard_expires_at)
                   as initial_deadline_bounded
            from app.agent_platform_companion_execution_watchdog_leases
        `);
        expect(watchdog.rows).toEqual([{ lease_count: '1', initial_deadline_bounded: true }]);
        const renewed = await client.query<{ readonly deadline: Date }>(
          `select app.renew_agent_platform_companion_execution_watchdog($1::bigint)
             as deadline`,
          [activationEpoch],
        );
        expect(renewed.rows[0]!.deadline.getTime()).toBeGreaterThan(Date.now() + 30_000);

        await client.query('savepoint expired_watchdog');
        await client.query(
          `update app.agent_platform_companion_execution_watchdog_leases
              set heartbeat_at = activated_at,
                  lease_expires_at = activated_at + interval '1 millisecond'
            where activation_epoch = $1::bigint`,
          [activationEpoch],
        );
        await expect(
          client.query(`select app.renew_agent_platform_companion_execution_watchdog($1::bigint)`, [
            activationEpoch,
          ]),
        ).rejects.toThrow('The execution watchdog lease is not renewable.');
        await client.query('rollback to savepoint expired_watchdog');
        await client.query('savepoint tripped_watchdog');
        await client.query(
          `update app.agent_platform_companion_execution_watchdog_leases
              set heartbeat_at = activated_at,
                  lease_expires_at = activated_at + interval '1 millisecond'
            where activation_epoch = $1::bigint`,
          [activationEpoch],
        );
        const credentialFence = await client.query<{ readonly fenced: boolean }>(
          'select app.watchdog_fence_companion_execution_credentials() as fenced',
        );
        expect(credentialFence.rows).toEqual([{ fenced: true }]);
        const financialFence = await client.query<{ readonly fenced: boolean }>(
          'select app.watchdog_fence_companion_execution_financial_authority() as fenced',
        );
        expect(financialFence.rows).toEqual([{ fenced: true }]);
        const sessionFence = await client.query<{ readonly drained: number }>(
          'select app.watchdog_drain_companion_execution_sessions() as drained',
        );
        expect(sessionFence.rows).toEqual([{ drained: 0 }]);
        const watchdogStopped = await client.query<{
          readonly control_disabled: boolean;
          readonly financial_disabled: boolean;
          readonly runtime_password_cleared: boolean;
        }>(`
          select
            (select control_state = 'disabled'
               from app.agent_platform_companion_execution_control
              where singleton) as control_disabled,
            app.current_private_trusted_telebirr_activation_epoch() is null
              as financial_disabled,
            (select not rolcanlogin and rolpassword is null
               from pg_authid
              where rolname = 'fetanagent_companion_execution_bridge_runtime')
              as runtime_password_cleared
        `);
        expect(watchdogStopped.rows).toEqual([
          {
            control_disabled: true,
            financial_disabled: true,
            runtime_password_cleared: true,
          },
        ]);
        await client.query('rollback to savepoint tripped_watchdog');

        await client.query('savepoint immutable_consumption');
        await expect(
          client.query(
            `update app.agent_platform_companion_execution_activation_consumptions
                set valid_until = valid_until + interval '1 minute'`,
          ),
        ).rejects.toThrow('Trusted TeleBirr activation history is append-only.');
        await client.query('rollback to savepoint immutable_consumption');

        await client.query('savepoint used_request');
        await expect(activate('e'.repeat(64))).rejects.toThrow(
          'The one-use companion execution request is unavailable.',
        );
        await client.query('rollback to savepoint used_request');

        // The independent stop fences the real disposable activation, not a direct table update.
        const stopped = await client.query<{ readonly was_active: boolean }>(
          'select app.disable_agent_platform_companion_execution_transport() as was_active',
        );
        expect(stopped.rows).toEqual([{ was_active: true }]);
        const stoppedAgain = await client.query<{ readonly was_active: boolean }>(
          'select app.disable_agent_platform_companion_execution_transport() as was_active',
        );
        expect(stoppedAgain.rows).toEqual([{ was_active: false }]);
        const fenced = await client.query<{
          readonly control_state: string;
          readonly has_runtime_member: boolean;
          readonly runtime_login_disabled: boolean;
        }>(`
          select
            (select control_state from app.agent_platform_companion_execution_control
              where singleton) as control_state,
            pg_has_role('fetanagent_companion_execution_bridge_runtime',
              'fetanagent_companion_execution_bridge', 'member')
              as has_runtime_member,
            (select not role.rolcanlogin and role.rolpassword is null
               from pg_authid role
              where role.rolname = 'fetanagent_companion_execution_bridge_runtime')
              as runtime_login_disabled
        `);
        expect(fenced.rows).toEqual([
          {
            control_state: 'disabled',
            has_runtime_member: false,
            runtime_login_disabled: true,
          },
        ]);
        await client.query('savepoint stopped_request');
        await expect(activate('e'.repeat(64))).rejects.toThrow(
          'The one-use companion execution request is unavailable.',
        );
        await client.query('rollback to savepoint stopped_request');
      } finally {
        await client.query('rollback');
      }
    });

    it('rejects the wrong target and rehearses the dormant independent stop twice', async () => {
      await expect(runDisposableStop(getAdministratorPassword(), 'wrong-project')).rejects.toThrow(
        'The disposable companion stop failed closed.',
      );
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const output = await runDisposableStop(getAdministratorPassword(), 'xzztugbgtulptnbpoelr');
        const finalLine = output.trim().split('\n').at(-1);
        expect(JSON.parse(finalLine ?? '')).toEqual({
          schemaVersion: 1,
          operation: 'companion_execution_emergency_disable',
          deploymentTarget: 'production',
          runtimeLogin: 'disabled',
          companionExecution: 'disabled',
          financialAuthority: 'disabled',
          providerOutcomeRequiresReconciliation: true,
        });
      }
      const result = await getClient().query<{
        readonly control_state: string;
        readonly runtime_sessions: string;
      }>(`
        select
          (select control_state from app.agent_platform_companion_execution_control
            where singleton) as control_state,
          (select count(*) from pg_stat_activity activity
            where activity.usename in (
              'fetanagent_companion_execution_bridge',
              'fetanagent_companion_execution_bridge_runtime'
            )) as runtime_sessions
      `);
      expect(result.rows).toEqual([{ control_state: 'disabled', runtime_sessions: '0' }]);
    });

    it('rehearses the independent database and exact-host stops together without resolving provider outcome', async () => {
      let hostStops = 0;
      let databaseStops = 0;
      const stop = prepareGuardedCompanionEmergencyStopRehearsal({
        child: {
          processId: 411,
          stopped: Promise.resolve(),
          stop: async () => undefined,
          stopAfterPermit: async () => {
            hostStops += 1;
            return { processStopped: true, providerOutcomeRequiresReconciliation: true };
          },
        },
        disableDatabase: async () => {
          databaseStops += 1;
          const output = await runDisposableStop(
            getAdministratorPassword(),
            'xzztugbgtulptnbpoelr',
          );
          return JSON.parse(output.trim().split('\n').at(-1) ?? '');
        },
      });

      await expect(stop()).resolves.toEqual({
        databaseCredentialsAndSessionsRevoked: true,
        financialAuthorityDisabled: true,
        companionExecutionDisabled: true,
        exactHostStopped: true,
        providerOutcomeRequiresReconciliation: true,
      });
      expect(hostStops).toBe(1);
      expect(databaseStops).toBe(1);
      await expect(stop()).rejects.toMatchObject({
        requiresIndependentStopAndReconciliation: true,
      });
      expect(hostStops).toBe(1);
      expect(databaseStops).toBe(1);

      const state = await getClient().query<{
        readonly control_state: string;
        readonly runtime_sessions: string;
        readonly disabled_roles: string;
      }>(`
        select
          (select control_state from app.agent_platform_companion_execution_control
            where singleton) as control_state,
          (select count(*) from pg_stat_activity activity
            where activity.usename in (
              'fetanagent_companion_execution_bridge',
              'fetanagent_companion_execution_bridge_runtime'
            )) as runtime_sessions,
          (select count(*) from pg_authid role
            where role.rolname in (
              'fetanagent_companion_execution_bridge',
              'fetanagent_companion_execution_bridge_runtime'
            ) and not role.rolcanlogin and role.rolpassword is null) as disabled_roles
      `);
      expect(state.rows).toEqual([
        { control_state: 'disabled', runtime_sessions: '0', disabled_roles: '2' },
      ]);
    });
  });
}
