import { generateKeyPairSync, type KeyObject } from 'node:crypto';
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
  deriveOneUseActionAuthorityReplayIdentity,
  signExecutionAssignment,
  signExecutionResult,
  signOneUseActionAuthority,
  type ExecutionAssignmentBody,
  type ExecutionResultBody,
  type OneUseActionAuthorityBody,
  type SignedExecutionAssignment,
  type SignedOneUseActionAuthority,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { describe, expect, it } from 'vitest';

import {
  WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_KIND,
  WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_RELATIVE_PATH,
  WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_RUNTIME_ENABLED,
  WindowsCompanionExecutionV2JournalUnavailableError,
  assessWindowsCompanionExecutionV2Recovery,
  createWindowsCompanionExecutionV2AssignmentEvidence,
  decodeWindowsCompanionExecutionV2CrashEvidence,
  isLegalWindowsCompanionExecutionV2JournalTransition,
  persistWindowsCompanionExecutionV2CrashEvidence,
  recordWindowsCompanionExecutionV2FenceConsumptionEvidence,
  recordWindowsCompanionExecutionV2FinalActionStartedEvidence,
  recordWindowsCompanionExecutionV2SignedResultEvidence,
  type WindowsCompanionExecutionV2CrashEvidence,
} from './execution-v2-crash-journal.js';
import type { WindowsCurrentUserDataProtector } from './windows-data-protection.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function p256PrivateKey(): KeyObject {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Invalid execution-v2 test fixture: ${label}.`);
  return value;
}

function assignmentBody(): ExecutionAssignmentBody {
  return {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    assignmentId: 'execution-assignment-0001',
    assignmentNonceDigest: sha('1'),
    activationEpoch: '11',
    intentId: 'deposit-intent-0001',
    jobId: 'deposit-job-0001',
    attemptId: 'deposit-attempt-0001',
    platformAgentAccountId: 'platform-agent-account-0001',
    enrollmentId: 'execution-enrollment-0001',
    enrollmentBodyDigest: sha('2'),
    noMoneyCertificateId: 'no-money-certificate-0001',
    noMoneyCertificateBodyDigest: sha('3'),
    deviceId: 'windows-device-0001',
    deviceKeyId: 'windows-device-key-0001',
    executionSignerKeyId: 'execution-signer-0001',
    platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
    pilotId: 'private-pilot-0001',
    pilotRevision: '7',
    pilotConfigDigest: sha('4'),
    pilotReservationId: 'pilot-reservation-0001',
    pilotReservationDigest: sha('5'),
    amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
    currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
    playerIdDigest: sha('6'),
    oneUse: true,
    serverIssuedAt: '2026-09-10T12:00:00.000Z',
    serverNotBefore: '2026-09-10T12:00:00.000Z',
    serverValidUntil: '2026-09-10T12:01:00.000Z',
  };
}

function authorityBody(assignment: SignedExecutionAssignment): OneUseActionAuthorityBody {
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

function executionResultBody(
  assignment: SignedExecutionAssignment,
  authority: SignedOneUseActionAuthority,
  outcome: 'submission_attempted' | 'local_uncertain' | 'post_fence_no_local_action',
): ExecutionResultBody {
  const body = assignment.body;
  const finalActionStarted = outcome !== 'post_fence_no_local_action';
  return {
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    capability: COMPANION_EXECUTION_CAPABILITY,
    actionKind: COMPANION_EXECUTION_ACTION_KIND,
    resultId: `execution-result-${outcome}`,
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
    outcome,
    finalActionStarted,
    finalActionStartedAt: finalActionStarted ? '2026-09-10T12:00:05.000Z' : null,
    providerResponseDigest: outcome === 'submission_attempted' ? sha('9') : null,
    evidenceDigest: sha('a'),
    reportedAt: '2026-09-10T12:00:06.000Z',
  };
}

interface JournalFixture {
  readonly assignment: SignedExecutionAssignment;
  readonly authority: SignedOneUseActionAuthority;
  readonly assignmentEvidence: WindowsCompanionExecutionV2CrashEvidence;
  readonly fenceEvidence: WindowsCompanionExecutionV2CrashEvidence;
  readonly startedEvidence: WindowsCompanionExecutionV2CrashEvidence;
  readonly submissionResultEvidence: WindowsCompanionExecutionV2CrashEvidence;
  readonly noLocalActionResultEvidence: WindowsCompanionExecutionV2CrashEvidence;
}

function fixture(): JournalFixture {
  const executionSignerKey = p256PrivateKey();
  const deviceKey = p256PrivateKey();
  const assignment = required(
    signExecutionAssignment(assignmentBody(), executionSignerKey),
    'assignment',
  );
  const authority = required(
    signOneUseActionAuthority(authorityBody(assignment), executionSignerKey),
    'authority',
  );
  const assignmentEvidence = required(
    createWindowsCompanionExecutionV2AssignmentEvidence(assignment, '2026-09-10T12:00:02.000Z'),
    'assignment evidence',
  );
  const authorityReplayIdentity = required(
    deriveOneUseActionAuthorityReplayIdentity(authority),
    'authority replay identity',
  );
  const fenceEvidence = required(
    recordWindowsCompanionExecutionV2FenceConsumptionEvidence(
      assignmentEvidence,
      authority,
      {
        receiptKind: 'external_atomic_replay_consumption',
        replayIdentity: authorityReplayIdentity,
        authorityBodyDigest: authority.bodyDigest,
        consumedExactlyOnce: true,
      },
      '2026-09-10T12:00:04.500Z',
    ),
    'fence evidence',
  );
  const startedEvidence = required(
    recordWindowsCompanionExecutionV2FinalActionStartedEvidence(
      fenceEvidence,
      '2026-09-10T12:00:05.000Z',
      '2026-09-10T12:00:05.000Z',
    ),
    'final-action-started evidence',
  );
  const submissionResult = required(
    signExecutionResult(
      executionResultBody(assignment, authority, 'submission_attempted'),
      deviceKey,
    ),
    'submission result',
  );
  const noLocalActionResult = required(
    signExecutionResult(
      executionResultBody(assignment, authority, 'post_fence_no_local_action'),
      deviceKey,
    ),
    'no-local-action result',
  );
  return {
    assignment,
    authority,
    assignmentEvidence,
    fenceEvidence,
    startedEvidence,
    submissionResultEvidence: required(
      recordWindowsCompanionExecutionV2SignedResultEvidence(
        startedEvidence,
        submissionResult,
        '2026-09-10T12:00:06.500Z',
      ),
      'submission-result evidence',
    ),
    noLocalActionResultEvidence: required(
      recordWindowsCompanionExecutionV2SignedResultEvidence(
        fenceEvidence,
        noLocalActionResult,
        '2026-09-10T12:00:06.500Z',
      ),
      'no-local-action-result evidence',
    ),
  };
}

const TEST_PROTECTION_PREFIX = Buffer.from('test-dpapi-execution-v2:', 'utf8');

function testProtector(): WindowsCurrentUserDataProtector {
  return Object.freeze({
    protect: async (cleartext: Buffer): Promise<Buffer> =>
      Buffer.concat([TEST_PROTECTION_PREFIX, cleartext]),
    unprotect: async (ciphertext: Buffer): Promise<Buffer> => {
      if (
        ciphertext.length <= TEST_PROTECTION_PREFIX.length ||
        !ciphertext.subarray(0, TEST_PROTECTION_PREFIX.length).equals(TEST_PROTECTION_PREFIX)
      ) {
        throw new Error('Wrong test protection domain.');
      }
      return Buffer.from(ciphertext.subarray(TEST_PROTECTION_PREFIX.length));
    },
  });
}

async function withDataRoot(run: (dataRoot: string) => Promise<void>): Promise<void> {
  const dataRoot = await mkdtemp(resolve(tmpdir(), 'fetanagent-execution-v2-'));
  try {
    await run(dataRoot);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
}

function journalPath(dataRoot: string): string {
  return resolve(dataRoot, ...WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_RELATIVE_PATH.split('/'));
}

describe('Windows companion execution-v2 crash evidence', () => {
  it('is a dormant, reconciliation-only adapter with no local action authority', () => {
    const value = fixture();
    expect(WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_RUNTIME_ENABLED).toBe(false);
    expect(WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_KIND).toBe(
      'windows_companion_execution_v2_local_crash_evidence',
    );
    for (const evidence of [
      value.assignmentEvidence,
      value.fenceEvidence,
      value.startedEvidence,
      value.submissionResultEvidence,
      value.noLocalActionResultEvidence,
    ]) {
      expect(evidence).toMatchObject({
        localEvidenceOnly: true,
        grantsActionAuthority: false,
        replayStateAuthoritative: false,
        requiresServerReconciliation: true,
        providerMutationAllowed: false,
        automaticDepositAllowed: false,
        blindRetryAllowed: false,
      });
    }
  });

  it('records only the legal assignment, fence, action-start, and result sequence', () => {
    const value = fixture();
    expect(value.assignmentEvidence).toMatchObject({
      journalRevision: 1,
      phase: 'assignment_observed',
      authorityId: null,
    });
    expect(value.fenceEvidence).toMatchObject({
      journalRevision: 2,
      phase: 'fence_consumed_reconciliation_required',
      authorityId: value.authority.body.authorityId,
    });
    expect(value.startedEvidence).toMatchObject({
      journalRevision: 3,
      phase: 'final_action_started_reconciliation_required',
      finalActionStartedAt: '2026-09-10T12:00:05.000Z',
    });
    expect(value.submissionResultEvidence).toMatchObject({
      journalRevision: 4,
      phase: 'signed_result_recorded_reconciliation_required',
      resultOutcome: 'submission_attempted',
    });
    expect(value.noLocalActionResultEvidence).toMatchObject({
      journalRevision: 3,
      phase: 'signed_result_recorded_reconciliation_required',
      finalActionStartedAt: null,
      resultOutcome: 'post_fence_no_local_action',
    });
  });

  it('rejects mismatched replay receipts and every illegal or regressive transition', () => {
    const value = fixture();
    const replayIdentity = required(
      deriveOneUseActionAuthorityReplayIdentity(value.authority),
      'authority replay identity',
    );
    expect(
      recordWindowsCompanionExecutionV2FenceConsumptionEvidence(
        value.assignmentEvidence,
        value.authority,
        {
          receiptKind: 'external_atomic_replay_consumption',
          replayIdentity: sha('b'),
          authorityBodyDigest: value.authority.bodyDigest,
          consumedExactlyOnce: true,
        },
        '2026-09-10T12:00:04.500Z',
      ),
    ).toBeUndefined();
    expect(
      recordWindowsCompanionExecutionV2FenceConsumptionEvidence(
        value.assignmentEvidence,
        value.authority,
        {
          receiptKind: 'external_atomic_replay_consumption',
          replayIdentity,
          authorityBodyDigest: sha('c'),
          consumedExactlyOnce: true,
        },
        '2026-09-10T12:00:04.500Z',
      ),
    ).toBeUndefined();
    expect(
      isLegalWindowsCompanionExecutionV2JournalTransition(
        value.assignmentEvidence,
        value.submissionResultEvidence,
      ),
    ).toBe(false);
    expect(
      isLegalWindowsCompanionExecutionV2JournalTransition(
        value.submissionResultEvidence,
        value.submissionResultEvidence,
      ),
    ).toBe(false);
    expect(
      isLegalWindowsCompanionExecutionV2JournalTransition(value.assignmentEvidence, {
        ...value.fenceEvidence,
        intentId: 'different-intent-0001',
      }),
    ).toBe(false);
    expect(
      isLegalWindowsCompanionExecutionV2JournalTransition(value.assignmentEvidence, {
        ...value.fenceEvidence,
        locallyRecordedAt: '2026-09-10T12:00:01.000Z',
      }),
    ).toBe(false);
  });

  it('rejects malformed evidence and keeps raw Player IDs, envelopes, and signatures out', () => {
    const value = fixture();
    expect(
      decodeWindowsCompanionExecutionV2CrashEvidence({
        ...clone(value.assignmentEvidence),
        automaticDepositAllowed: true,
      }),
    ).toBeUndefined();
    expect(
      decodeWindowsCompanionExecutionV2CrashEvidence({
        ...clone(value.assignmentEvidence),
        unexpected: true,
      }),
    ).toBeUndefined();
    const serialized = JSON.stringify(value.submissionResultEvidence);
    expect(serialized).not.toContain('28379330');
    expect(serialized).not.toContain('playerIdDigest');
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain('credential');
  });

  it('atomically persists monotonic encrypted evidence and always requires server recovery', async () => {
    await withDataRoot(async (dataRoot) => {
      const value = fixture();
      const protector = testProtector();
      await expect(
        persistWindowsCompanionExecutionV2CrashEvidence(value.assignmentEvidence, {
          dataRoot,
          protector,
        }),
      ).resolves.toMatchObject({
        journalRevision: 1,
        fileContentsFlushed: true,
        grantsActionAuthority: false,
        requiresServerReconciliation: true,
      });
      const revisionOneRaw = await readFile(journalPath(dataRoot), 'utf8');
      expect(revisionOneRaw).not.toContain(value.assignment.body.assignmentId);
      expect(revisionOneRaw).not.toContain('28379330');

      await expect(
        persistWindowsCompanionExecutionV2CrashEvidence(value.fenceEvidence, {
          dataRoot,
          protector,
        }),
      ).resolves.toMatchObject({ journalRevision: 2, fileContentsFlushed: true });
      await expect(
        persistWindowsCompanionExecutionV2CrashEvidence(value.fenceEvidence, {
          dataRoot,
          protector,
        }),
      ).rejects.toBeInstanceOf(WindowsCompanionExecutionV2JournalUnavailableError);

      await expect(
        assessWindowsCompanionExecutionV2Recovery({
          dataRoot,
          protector,
          minimumExpectedJournalRevision: 2,
        }),
      ).resolves.toMatchObject({
        localEvidenceState: 'locally_consistent_untrusted',
        recoveryDisposition: 'server_database_reconciliation_required',
        localEvidenceFreshnessProven: false,
        requiresServerReplayCheck: true,
        requiresSignedAuthoritativeStatus: true,
        grantsActionAuthority: false,
        providerMutationAllowed: false,
        automaticDepositAllowed: false,
        blindRetryAllowed: false,
      });

      await writeFile(journalPath(dataRoot), revisionOneRaw, 'utf8');
      await expect(
        assessWindowsCompanionExecutionV2Recovery({
          dataRoot,
          protector,
          minimumExpectedJournalRevision: 2,
        }),
      ).resolves.toMatchObject({
        localEvidenceState: 'stale',
        localEvidence: { journalRevision: 1 },
        recoveryDisposition: 'server_database_reconciliation_required',
        grantsActionAuthority: false,
      });
    });
  });

  it('fails closed on partial, corrupt, and oversized protected snapshots', async () => {
    await withDataRoot(async (dataRoot) => {
      const value = fixture();
      const protector = testProtector();
      await persistWindowsCompanionExecutionV2CrashEvidence(value.assignmentEvidence, {
        dataRoot,
        protector,
      });
      await writeFile(journalPath(dataRoot), '{"envelopeVersion":2', 'utf8');
      await expect(
        assessWindowsCompanionExecutionV2Recovery({
          dataRoot,
          protector,
          minimumExpectedJournalRevision: 0,
        }),
      ).resolves.toMatchObject({
        localEvidenceState: 'corrupt',
        localEvidence: null,
        recoveryDisposition: 'server_database_reconciliation_required',
        providerMutationAllowed: false,
      });
      await expect(
        persistWindowsCompanionExecutionV2CrashEvidence(value.fenceEvidence, {
          dataRoot,
          protector,
        }),
      ).rejects.toBeInstanceOf(WindowsCompanionExecutionV2JournalUnavailableError);
    });

    await withDataRoot(async (dataRoot) => {
      const oversizedProtector: WindowsCurrentUserDataProtector = {
        protect: async () => Buffer.alloc(16_384, 7),
        unprotect: async () => {
          throw new Error('Not reachable.');
        },
      };
      await expect(
        persistWindowsCompanionExecutionV2CrashEvidence(fixture().assignmentEvidence, {
          dataRoot,
          protector: oversizedProtector,
        }),
      ).rejects.toBeInstanceOf(WindowsCompanionExecutionV2JournalUnavailableError);
      await expect(readFile(journalPath(dataRoot), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });

  it('remains absent from the live companion entry point and provider route', async () => {
    const runtimeSources = await Promise.all(
      ['./index.ts', './provider-route.ts'].map(
        async (relativePath) => await readFile(new URL(relativePath, import.meta.url), 'utf8'),
      ),
    );
    expect(runtimeSources.join('\n')).not.toContain('execution-v2-crash-journal');
  });
});
