import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  retainCompanionActivationAttestation,
  signCompanionExecutionActivationHandoff,
  signCompanionExecutionLaunchProof,
  type CompanionActivationDatabaseSnapshot,
  type SignedCompanionExecutionLaunchProof,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { invokeCompanionActivationTransitionInternal } from './activation-transition.js';
import { retainCompanionActivationAttestationRow } from './attestation-retention.js';
import { prepareGuardedCompanionEmergencyStopRehearsal } from './guarded-emergency-stop-rehearsal.js';
import {
  deriveGuardedCompanionHandoffBody,
  publishGuardedCompanionHandoffWithSigner,
} from './guarded-handoff-publication.js';
import { runGuardedOneJobLifecycle } from './guarded-one-job-lifecycle.js';
import { runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters } from './guarded-operator-activation.js';
import { acquireGuardedOperatorLifecycleLock } from './guarded-operator-lifecycle-lock.js';
import type { GuardedOperatorRemoteSession } from './guarded-operator-query-client.js';
import { runGuardedOperatorActivationOverSshWithAdapters } from './guarded-operator-ssh-activation.js';
import type { GuardedLocalActivationChannel } from './guarded-local-activation-channel.js';
import type { ProtectedOperatorDeviceSigner } from './protected-operator-query-http-client.js';
import type { ProtectedOperatorSshConnection } from './protected-operator-query-ssh-client.js';
import { loadCompanionActivationDatabaseSnapshot } from './snapshot.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
type Scenario =
  'confirmed' | 'review_required' | 'no_approval' | 'two_approvals' | 'bad_proof' | 'stop_failure';

/**
 * Real signing, file publication, proof verification, catalog adapters,
 * approval/outcome watchers and stop composition; synthetic database rows,
 * child and permit transport. No SSH process, database, provider or credential.
 */
async function rehearsal(scenario: Scenario = 'confirmed', delayMs = 20_000) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'fetanagent-activation-rehearsal-')));
  roots.push(root);
  await mkdir(resolve(root, 'execution-v2'));
  const serverKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serverSpki = Buffer.from(serverKey.publicKey.export({ format: 'der', type: 'spki' }));
  const deviceSpki = Buffer.from(deviceKey.publicKey.export({ format: 'der', type: 'spki' }));
  const digest = (value: string | Buffer) =>
    'sha256:' + createHash('sha256').update(value).digest('hex');
  const signer = {
    keyId: 'synthetic-execution-signer-v1',
    publicKeySpki: serverSpki.toString('base64url'),
    publicKeySpkiSha256: digest(serverSpki),
  };
  let clock = Date.now();
  const base = clock;
  const trustedNow = () => new Date(clock);
  const requestKey = randomUUID(),
    actorAuthUserId = randomUUID(),
    jobId = randomUUID();
  const identity = {
    pilotRevisionId: randomUUID(),
    activationEpoch: '123',
    certificateId: randomUUID(),
    platformAgentAccountId: randomUUID(),
  };
  const snapshot: CompanionActivationDatabaseSnapshot = {
    request: {
      requestKey,
      ...identity,
      companionReleaseSha: 'a'.repeat(40),
      companionArchiveSha256: digest('synthetic archive'),
      companionInstallationTreeSha256: digest('synthetic tree'),
      requestedAt: new Date(base - 60_000).toISOString(),
      expiresAt: new Date(base + 9 * 60_000).toISOString(),
    },
    currentIdentity: identity,
    certificate: {
      certificateId: identity.certificateId,
      certificateBodyDigest: digest('synthetic certificate'),
      deviceKeyId: 'synthetic-device-key-v1',
      devicePublicKeySpki: deviceSpki.toString('base64url'),
      devicePublicKeySpkiSha256: digest(deviceSpki),
      validFrom: new Date(base - 60 * 60_000).toISOString(),
      validUntil: new Date(base + 60 * 60_000).toISOString(),
    },
  };
  const release = () => ({
    releaseSha: snapshot.request.companionReleaseSha,
    archiveSha256: snapshot.request.companionArchiveSha256,
    installationTreeSha256: snapshot.request.companionInstallationTreeSha256,
    observedAt: trustedNow().toISOString(),
  });
  const order: string[] = [];
  const counts = { activation: 0, permit: 0, databaseStop: 0, childStop: 0, outcome: 0 };
  let lockHeld = false,
    closed = false,
    activated = false,
    approved = false;
  let retainedProofDigest: string | undefined, handoffDigest: string | undefined;
  let proof: SignedCompanionExecutionLaunchProof | undefined, startedAt: string | undefined;
  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const validUntil = new Date(base + 15 * 60_000).toISOString();
  const remote: GuardedOperatorRemoteSession = {
    backendPid: 417,
    lost: new Promise<never>(() => undefined),
    async execute(name, values) {
      if (closed) throw new Error('Synthetic catalog is closed.');
      order.push(name);
      if (name === 'acquire' || name === 'release') {
        expect(lockHeld).toBe(name === 'release');
        lockHeld = name === 'acquire';
        return { rows: [name === 'acquire' ? { acquired: true } : { released: true }] };
      }
      expect(lockHeld).toBe(true);
      if (name === 'snapshot') {
        expect(values).toEqual([requestKey]);
        const { request, certificate } = snapshot;
        return {
          rows: [
            {
              request_key: requestKey,
              request_pilot_revision_id: identity.pilotRevisionId,
              request_activation_epoch: identity.activationEpoch,
              request_certificate_id: identity.certificateId,
              request_account_id: identity.platformAgentAccountId,
              companion_release_sha: request.companionReleaseSha,
              companion_archive_sha256: request.companionArchiveSha256,
              companion_installation_tree_sha256: request.companionInstallationTreeSha256,
              requested_at: new Date(request.requestedAt),
              request_expires_at: new Date(request.expiresAt),
              current_pilot_revision_id: identity.pilotRevisionId,
              current_activation_epoch: identity.activationEpoch,
              current_certificate_id: identity.certificateId,
              current_account_id: identity.platformAgentAccountId,
              certificate_body_digest: certificate.certificateBodyDigest,
              device_key_id: certificate.deviceKeyId,
              device_public_key_spki: certificate.devicePublicKeySpki,
              device_public_key_spki_sha256: certificate.devicePublicKeySpkiSha256,
              certificate_valid_from: new Date(certificate.validFrom),
              certificate_valid_until: new Date(certificate.validUntil),
            },
          ],
        };
      }
      if (name === 'retain') {
        expect(values[0]).toBe(requestKey);
        expect(retainedProofDigest).toBeUndefined();
        retainedProofDigest = values[6] as string;
        expect(values[7]).toBe(handoffDigest);
        return { rows: [{ request_key: requestKey }] };
      }
      if (name === 'activate') {
        expect(values.slice(0, 2)).toEqual([actorAuthUserId, requestKey]);
        expect(values[2]).toMatch(/^[0-9a-f]{64}$/u);
        expect(retainedProofDigest).toBeDefined();
        expect(approved).toBe(false);
        expect(counts.activation++).toBe(0);
        activated = true;
        return { rows: [{ valid_until: new Date(validUntil) }] };
      }
      if (name === 'approvedJob') {
        expect(values).toEqual([requestKey]);
        expect(activated).toBe(true);
        expect(counts.permit).toBe(1);
        if (!approved) {
          order.push('waiting_for_separate_owner_approval');
          if (scenario === 'no_approval') clock = Date.parse(validUntil) - 29_000;
          else
            queueMicrotask(() => {
              approved = true;
              order.push('synthetic_owner_approval');
            });
          return { rows: [] };
        }
        const row = { job_id: jobId, approval_current: true, job_status: 'queued' };
        return {
          rows: scenario === 'two_approvals' ? [row, { ...row, job_id: randomUUID() }] : [row],
        };
      }
      if (name === 'outcome') {
        expect(values).toEqual([requestKey, jobId]);
        expect(approved).toBe(true);
        if (++counts.outcome === 2) expect(counts.childStop).toBe(1);
        const confirmed = scenario === 'confirmed' || scenario === 'stop_failure';
        return {
          rows: [
            {
              job_status: confirmed ? 'succeeded' : 'dead',
              intent_status: confirmed ? 'executed' : 'execution_review',
              attempt_status: confirmed ? 'confirmed_executed' : 'review_required',
              attempt_agent_match: true,
              assignment_state: 'result_recorded',
              assignment_epoch_match: true,
              reconciliation_outcome: confirmed ? 'confirmed_executed' : 'ambiguous',
              reconciliation_job_status: 'succeeded',
              history_match_count: confirmed ? 1 : 2,
              exact_player_match: true,
              exact_amount_match: true,
              exact_currency_match: true,
              exact_player_credit_match: confirmed,
            },
          ],
        };
      }
      throw new Error('Unexpected synthetic catalog operation.');
    },
    async close() {
      if (closed) return;
      closed = true;
      order.push('remote_close');
      expect(lockHeld).toBe(false);
    },
  };
  const child = {
    processId: 4242,
    stopped,
    async stop() {
      counts.childStop++;
      order.push('pre_permit_child_stop');
      resolveStopped();
    },
    async stopAfterPermit() {
      counts.childStop++;
      order.push('exact_child_stop');
      resolveStopped();
      return {
        processStopped: true as const,
        providerOutcomeRequiresReconciliation: true as const,
      };
    },
  };
  const channel: GuardedLocalActivationChannel = {
    pipePath: 'synthetic-in-memory-channel',
    async receiveProof() {
      if (!proof) throw new Error();
      return proof;
    },
    async commitAndPermit(input) {
      expect(input.verifiedProofDigest).toBe(retainedProofDigest);
      await input.independentStop.confirmReady();
      const expiry = await invokeCompanionActivationTransitionInternal(
        {
          actorAuthUserId: input.actorAuthUserId,
          requestKey: input.requestKey,
          runtimePassword: input.runtimePassword,
        },
        input.administrator,
      );
      await input.independentStop.onActivated(expiry);
      expect(approved).toBe(false);
      counts.permit++;
      order.push('synthetic_permit_ack');
      return {
        validUntil: expiry,
        permitAcknowledged: true,
        runtimeConfirmationRequired: true,
        independentStopLoss: new Promise<never>(() => undefined),
      };
    },
    async close() {
      order.push('channel_close');
    },
  };
  type Coordinator = Parameters<
    typeof runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters
  >[2];
  const coordinator: Coordinator = {
    acquireLock: acquireGuardedOperatorLifecycleLock,
    attest: retainCompanionActivationAttestation,
    loadSnapshot: loadCompanionActivationDatabaseSnapshot,
    async verifyRelease() {
      // A local measurement happens AFTER the server signs, even on a fast link.
      clock += 2_000;
      order.push('local_release_measurement');
      return release();
    },
    async publishHandoff(input) {
      const result = await publishGuardedCompanionHandoffWithSigner(input, signer);
      handoffDigest = result.handoffSha256;
      order.push('handoff_published');
      return result;
    },
    async openChannel() {
      return channel;
    },
    start(input, launch) {
      if (!handoffDigest) throw new Error();
      startedAt = trustedNow().toISOString();
      const signed = signCompanionExecutionLaunchProof(
        {
          challenge: launch.challenge,
          certificateBodyDigest: snapshot.certificate.certificateBodyDigest,
          deviceKeyId: snapshot.certificate.deviceKeyId,
          devicePublicKeySpki: snapshot.certificate.devicePublicKeySpki,
          releaseSha: input.release.releaseSha,
          installationTreeSha256: input.release.installationTreeSha256,
          requestKey,
          activationEpoch: identity.activationEpoch,
          platformAgentAccountId: identity.platformAgentAccountId,
          executionHandoffSha256: handoffDigest,
          processId: child.processId,
          startedAt,
          observedAt: trustedNow().toISOString(),
        },
        deviceKey.privateKey,
      );
      if (!signed) throw new Error('Synthetic launch proof could not be signed.');
      proof = scenario === 'bad_proof' ? { ...signed, signature: 'A'.repeat(86) } : signed;
      return child;
    },
    async observe(input) {
      if (!startedAt || !handoffDigest) throw new Error();
      return {
        processId: child.processId,
        startedAt,
        observedAt: trustedNow().toISOString(),
        executionHandoffSha256: handoffDigest,
        proof: input.proof,
      };
    },
    retainRow: retainCompanionActivationAttestationRow,
    prepareSupervisor(input) {
      const emergencyStop = prepareGuardedCompanionEmergencyStopRehearsal(input);
      let stopPromise: ReturnType<typeof emergencyStop> | undefined;
      return {
        lost: new Promise<never>(() => undefined),
        async confirmReady() {
          order.push('synthetic_supervisor_ready');
        },
        async onActivated() {
          order.push('synthetic_supervisor_armed');
        },
        stopOnUncertainty() {
          stopPromise ??= emergencyStop();
          return stopPromise;
        },
      };
    },
    runLifecycle: runGuardedOneJobLifecycle,
  };
  const run = () =>
    runGuardedOperatorActivationOverSshWithAdapters(
      {
        requestKey,
        actorAuthUserId,
        releaseInputs: {} as Parameters<
          typeof runGuardedOperatorActivationOverSshWithAdapters
        >[0]['releaseInputs'],
        dataRoot: root,
        processVerifierScriptPath: resolve(root, 'synthetic-observer.ps1'),
        windowsEnvironment: {},
        trustedNow,
      },
      {} as ProtectedOperatorDeviceSigner,
      {} as ProtectedOperatorSshConnection,
      {
        sign: () => async (key) => {
          expect(key).toBe(requestKey);
          order.push('server_sign_once');
          const signed = signCompanionExecutionActivationHandoff(
            deriveGuardedCompanionHandoffBody({ ...snapshot, release: release(), trustedNow }),
            serverKey.privateKey,
            signer.keyId,
            signer.publicKeySpkiSha256,
          );
          if (!signed) throw new Error('Synthetic server signing failed.');
          return signed;
        },
        stop: () => async () => {
          counts.databaseStop++;
          order.push('independent_database_stop');
          if (scenario === 'stop_failure') throw new Error('Sensitive stop failure.');
          activated = false;
        },
        open: async () => {
          order.push('remote_open');
          clock += delayMs;
          return remote;
        },
        activate: (input, session) =>
          runGuardedOperatorActivationWithProtectedRemoteSessionAndAdapters(
            input,
            session,
            coordinator,
          ),
      },
    );
  return { run, order, counts, root };
}

describe('joined no-payment signed activation and later Owner approval rehearsal', () => {
  it.each([0, 20_000])('confirms one exact job despite a %i ms connection delay', async (delay) => {
    const fixture = await rehearsal('confirmed', delay);
    await expect(fixture.run()).resolves.toBe('confirmed');
    expect(fixture.order.indexOf('server_sign_once')).toBeLessThan(
      fixture.order.indexOf('remote_open'),
    );
    expect(fixture.order.indexOf('remote_open')).toBeLessThan(fixture.order.indexOf('acquire'));
    expect(fixture.order.indexOf('synthetic_permit_ack')).toBeLessThan(
      fixture.order.indexOf('waiting_for_separate_owner_approval'),
    );
    expect(fixture.order.indexOf('synthetic_owner_approval')).toBeLessThan(
      fixture.order.indexOf('outcome'),
    );
    expect(fixture.order.filter((step) => step === 'server_sign_once')).toHaveLength(1);
    expect(fixture.order.slice(-3)).toEqual(['channel_close', 'release', 'remote_close']);
    expect(fixture.counts).toEqual({
      activation: 1,
      permit: 1,
      databaseStop: 1,
      childStop: 1,
      outcome: 2,
    });
    const handoff = JSON.parse(
      await readFile(resolve(fixture.root, 'execution-v2', 'activation-handoff.v1.json'), 'utf8'),
    );
    expect(handoff.body.issuedAt).toBe(handoff.body.notBefore);
    expect(handoff.signerKeyId).toBe('synthetic-execution-signer-v1');
  });
  it.each(['no_approval', 'two_approvals'] as const)(
    'stops without observing or retrying a job for %s',
    async (scenario) => {
      const fixture = await rehearsal(scenario);
      await expect(fixture.run()).rejects.toMatchObject({ activationStage: 'one_job_lifecycle' });
      expect(fixture.counts).toEqual({
        activation: 1,
        permit: 1,
        databaseStop: 1,
        childStop: 1,
        outcome: 0,
      });
      expect(fixture.order).not.toContain('outcome');
    },
  );
  it('keeps an uncertain synthetic result in review without a second activation', async () => {
    const fixture = await rehearsal('review_required');
    await expect(fixture.run()).resolves.toBe('review_required');
    expect(fixture.counts).toEqual({
      activation: 1,
      permit: 1,
      databaseStop: 1,
      childStop: 1,
      outcome: 2,
    });
  });
  it('rejects an altered device proof before activation or Owner approval', async () => {
    const fixture = await rehearsal('bad_proof');
    await expect(fixture.run()).rejects.toMatchObject({ activationStage: 'database_snapshot' });
    expect(fixture.counts).toEqual({
      activation: 0,
      permit: 0,
      databaseStop: 0,
      childStop: 1,
      outcome: 0,
    });
    expect(fixture.order).not.toContain('retain');
    expect(fixture.order).not.toContain('approvedJob');
  });
  it('does not turn a failed remote stop into a successful stop receipt or retry', async () => {
    const fixture = await rehearsal('stop_failure');
    const error = await fixture.run().catch((value: unknown) => value);
    expect(error).toMatchObject({ activationStage: 'one_job_lifecycle' });
    expect(JSON.stringify(error)).not.toContain('Sensitive');
    expect(fixture.counts).toEqual({
      activation: 1,
      permit: 1,
      databaseStop: 1,
      childStop: 1,
      outcome: 1,
    });
  });
});
