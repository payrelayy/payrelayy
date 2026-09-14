import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  COMPANION_EXECUTION_ACTION_KIND,
  COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
  COMPANION_EXECUTION_CAPABILITY,
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_CURRENCY_CODE,
  COMPANION_EXECUTION_PLATFORM_CODE,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  signExecutionAssignment,
  signExecutionEnrollment,
  signExecutionResult,
  signOneUseActionAuthority,
  type ExecutionAssignmentBody,
  type ExecutionEnrollmentBody,
  type ExecutionResultBody,
  type OneUseActionAuthorityBody,
  type SignedExecutionAssignment,
  type SignedOneUseActionAuthority,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it } from 'vitest';

import {
  WindowsCompanionExecutionV2AttemptStoreUnavailableError,
  clearWindowsCompanionExecutionV2PreFenceAttemptChain,
  clearWindowsCompanionExecutionV2TerminalAttemptChain,
  loadWindowsCompanionExecutionV2AttemptChain,
  persistWindowsCompanionExecutionV2AttemptAuthority,
  persistWindowsCompanionExecutionV2AttemptResult,
  persistWindowsCompanionExecutionV2InitialAttemptChain,
} from './execution-v2-attempt-store.js';
import type { WindowsCurrentUserDataProtector } from './windows-data-protection.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

function protector(): WindowsCurrentUserDataProtector {
  const prefix = Buffer.from('test-dpapi-execution-v2-attempt:', 'utf8');
  return Object.freeze({
    protect: async (cleartext: Buffer) => Buffer.concat([prefix, cleartext]),
    unprotect: async (ciphertext: Buffer) => {
      if (
        ciphertext.length <= prefix.length ||
        !ciphertext.subarray(0, prefix.length).equals(prefix)
      ) {
        throw new Error('Wrong protected-attempt test domain.');
      }
      return Buffer.from(ciphertext.subarray(prefix.length));
    },
  });
}

async function withDataRoot(run: (dataRoot: string) => Promise<void>): Promise<void> {
  const dataRoot = await mkdtemp(resolve(tmpdir(), 'fetanagent-execution-attempt-'));
  try {
    await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function fixture() {
  const executionSigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const deviceSigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const executionSpki = Buffer.from(
    executionSigner.publicKey.export({ format: 'der', type: 'spki' }),
  );
  const enrollmentBody: ExecutionEnrollmentBody = {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    enrollmentId: 'execution-enrollment-0001',
    noMoneyCertificateId: 'no-money-certificate-0001',
    noMoneyCertificateBodyDigest: sha('1'),
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    devicePublicKeySpkiSha256: sha('2'),
    platformAgentAccountId: 'platform-agent-account-0001',
    accountBindingCount: 1,
    platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
    pilotId: 'private-pilot-0001',
    pilotRevision: '7',
    pilotConfigDigest: sha('3'),
    amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
    currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
    maxActionsPerAssignment: 1,
    maxAssignmentLifetimeMs: 60_000,
    maxAuthorityLifetimeMs: 10_000,
    maxStatusLifetimeMs: 8_000,
    maxRoundTripTimeMs: 5_000,
    executionSignerKeyId: 'execution-signer-production-0001',
    executionSignerPublicKeySpki: executionSpki.toString('base64url'),
    executionSignerPublicKeySpkiSha256: `sha256:${createHash('sha256')
      .update(executionSpki)
      .digest('hex')}`,
    capabilityState: 'active',
    issuedAt: '2026-09-10T11:59:00.000Z',
    validFrom: '2026-09-10T11:59:00.000Z',
    validUntil: '2026-09-10T13:00:00.000Z',
  };
  const enrollment = signExecutionEnrollment(enrollmentBody, executionSigner.privateKey)!;
  const assignmentBody: ExecutionAssignmentBody = {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    assignmentId: 'execution-assignment-0001',
    assignmentNonceDigest: sha('4'),
    activationEpoch: '11',
    intentId: 'deposit-intent-0001',
    jobId: 'deposit-job-0001',
    attemptId: 'deposit-attempt-0001',
    platformAgentAccountId: enrollment.body.platformAgentAccountId,
    enrollmentId: enrollment.body.enrollmentId,
    enrollmentBodyDigest: enrollment.bodyDigest,
    noMoneyCertificateId: enrollment.body.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: enrollment.body.noMoneyCertificateBodyDigest,
    deviceId: enrollment.body.deviceId,
    deviceKeyId: enrollment.body.deviceKeyId,
    executionSignerKeyId: enrollment.body.executionSignerKeyId,
    platformCode: enrollment.body.platformCode,
    pilotId: enrollment.body.pilotId,
    pilotRevision: enrollment.body.pilotRevision,
    pilotConfigDigest: enrollment.body.pilotConfigDigest,
    pilotReservationId: 'pilot-reservation-0001',
    pilotReservationDigest: sha('5'),
    amountMinorUnits: enrollment.body.amountMinorUnits,
    currencyCode: enrollment.body.currencyCode,
    playerIdDigest: sha('6'),
    oneUse: true,
    serverIssuedAt: '2026-09-10T12:00:00.000Z',
    serverNotBefore: '2026-09-10T12:00:00.000Z',
    serverValidUntil: '2026-09-10T12:01:00.000Z',
  };
  const assignment = signExecutionAssignment(assignmentBody, executionSigner.privateKey)!;
  const authorityBody = exactAuthorityBody(assignment);
  const authority = signOneUseActionAuthority(authorityBody, executionSigner.privateKey)!;
  const result = signExecutionResult(
    exactResultBody(assignment, authority),
    deviceSigner.privateKey,
  )!;
  executionSpki.fill(0);
  return { enrollment, assignment, authority, result };
}

function exactAuthorityBody(assignment: SignedExecutionAssignment): OneUseActionAuthorityBody {
  const body = assignment.body;
  return {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    authorityId: 'one-use-authority-0001',
    assignmentId: body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    activationEpoch: body.activationEpoch,
    intentId: body.intentId,
    jobId: body.jobId,
    attemptId: body.attemptId,
    platformAgentAccountId: body.platformAgentAccountId,
    enrollmentId: body.enrollmentId,
    enrollmentBodyDigest: body.enrollmentBodyDigest,
    noMoneyCertificateId: body.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: body.noMoneyCertificateBodyDigest,
    deviceId: body.deviceId,
    deviceKeyId: body.deviceKeyId,
    executionSignerKeyId: body.executionSignerKeyId,
    platformCode: body.platformCode,
    pilotId: body.pilotId,
    pilotRevision: body.pilotRevision,
    pilotConfigDigest: body.pilotConfigDigest,
    pilotReservationId: body.pilotReservationId,
    pilotReservationDigest: body.pilotReservationDigest,
    amountMinorUnits: body.amountMinorUnits,
    currencyCode: body.currencyCode,
    playerIdDigest: body.playerIdDigest,
    fenceId: 'database-fence-0001',
    fenceNonceDigest: sha('7'),
    databaseFenceState: 'first_fence_acquired',
    firstFenceAcquired: true,
    requestNonceDigest: sha('8'),
    oneUse: true,
    databaseFencedAt: '2026-09-10T12:00:04.000Z',
    databaseAuthorityIssuedAt: '2026-09-10T12:00:04.100Z',
    serverValidUntil: '2026-09-10T12:00:10.000Z',
  };
}

function exactResultBody(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority,
): ExecutionResultBody {
  const body = assignment.body;
  return {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    resultId: 'execution-result-0001',
    assignmentId: body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    authorityId: authority.body.authorityId,
    authorityBodyDigest: authority.bodyDigest,
    activationEpoch: body.activationEpoch,
    intentId: body.intentId,
    jobId: body.jobId,
    attemptId: body.attemptId,
    platformAgentAccountId: body.platformAgentAccountId,
    enrollmentId: body.enrollmentId,
    enrollmentBodyDigest: body.enrollmentBodyDigest,
    noMoneyCertificateId: body.noMoneyCertificateId,
    noMoneyCertificateBodyDigest: body.noMoneyCertificateBodyDigest,
    deviceId: body.deviceId,
    deviceKeyId: body.deviceKeyId,
    executionSignerKeyId: body.executionSignerKeyId,
    platformCode: body.platformCode,
    pilotId: body.pilotId,
    pilotRevision: body.pilotRevision,
    pilotConfigDigest: body.pilotConfigDigest,
    pilotReservationId: body.pilotReservationId,
    pilotReservationDigest: body.pilotReservationDigest,
    amountMinorUnits: body.amountMinorUnits,
    currencyCode: body.currencyCode,
    playerIdDigest: body.playerIdDigest,
    fenceId: authority.body.fenceId,
    fenceNonceDigest: authority.body.fenceNonceDigest,
    requestNonceDigest: authority.body.requestNonceDigest,
    outcome: 'submission_attempted',
    finalActionStarted: true,
    finalActionStartedAt: '2026-09-10T12:00:05.000Z',
    providerResponseDigest: sha('9'),
    evidenceDigest: sha('a'),
    reportedAt: '2026-09-10T12:00:06.000Z',
  };
}

describe('Windows companion execution-v2 protected attempt store', () => {
  it('persists the exact signed chain once, hides cleartext, and clears only terminal state', async () => {
    await withDataRoot(async (dataRoot) => {
      const selected = fixture();
      const options = { dataRoot, protector: protector() };
      await expect(loadWindowsCompanionExecutionV2AttemptChain(options)).resolves.toEqual({
        state: 'missing',
      });
      const initial = await persistWindowsCompanionExecutionV2InitialAttemptChain(
        selected.enrollment,
        selected.assignment,
        options,
      );
      await expect(
        persistWindowsCompanionExecutionV2InitialAttemptChain(
          selected.enrollment,
          selected.assignment,
          options,
        ),
      ).rejects.toBeInstanceOf(WindowsCompanionExecutionV2AttemptStoreUnavailableError);
      const storedEnrollment = await readFile(
        resolve(dataRoot, 'device', 'execution-v2', 'attempt-enrollment.secure.json'),
        'utf8',
      );
      expect(storedEnrollment).not.toContain(selected.enrollment.body.enrollmentId);
      const withAuthority = await persistWindowsCompanionExecutionV2AttemptAuthority(
        initial,
        selected.authority,
        options,
      );
      await expect(
        persistWindowsCompanionExecutionV2AttemptAuthority(initial, selected.authority, options),
      ).rejects.toBeInstanceOf(WindowsCompanionExecutionV2AttemptStoreUnavailableError);
      const complete = await persistWindowsCompanionExecutionV2AttemptResult(
        withAuthority,
        selected.result,
        options,
      );
      await expect(loadWindowsCompanionExecutionV2AttemptChain(options)).resolves.toEqual({
        state: 'available',
        chain: complete,
      });
      await clearWindowsCompanionExecutionV2TerminalAttemptChain(complete, options);
      await expect(loadWindowsCompanionExecutionV2AttemptChain(options)).resolves.toEqual({
        state: 'missing',
      });
    });
  });

  it('allows pre-fence cleanup but reports partial or malformed state as corrupt', async () => {
    await withDataRoot(async (dataRoot) => {
      const selected = fixture();
      const options = { dataRoot, protector: protector() };
      const initial = await persistWindowsCompanionExecutionV2InitialAttemptChain(
        selected.enrollment,
        selected.assignment,
        options,
      );
      await clearWindowsCompanionExecutionV2PreFenceAttemptChain(initial, options);
      await expect(loadWindowsCompanionExecutionV2AttemptChain(options)).resolves.toEqual({
        state: 'missing',
      });

      await persistWindowsCompanionExecutionV2InitialAttemptChain(
        selected.enrollment,
        selected.assignment,
        options,
      );
      await writeFile(
        resolve(dataRoot, 'device', 'execution-v2', 'attempt-assignment.secure.json'),
        '{"truncated":',
        'utf8',
      );
      await expect(loadWindowsCompanionExecutionV2AttemptChain(options)).resolves.toEqual({
        state: 'corrupt',
      });
      await expect(
        persistWindowsCompanionExecutionV2AttemptAuthority(initial, selected.authority, options),
      ).rejects.toBeInstanceOf(WindowsCompanionExecutionV2AttemptStoreUnavailableError);
    });
  });
});
