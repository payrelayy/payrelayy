import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { isProxy } from 'node:util/types';

import {
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  decodeSignedExecutionAssignment,
  decodeSignedExecutionResult,
  decodeSignedOneUseActionAuthority,
  deriveExecutionAssignmentReplayIdentity,
  deriveOneUseActionAuthorityReplayIdentity,
  digestExecutionAssignmentBody,
  digestExecutionResultBody,
  digestOneUseActionAuthorityBody,
  type ExecutionResultOutcome,
  type ExternalAtomicReplayConsumptionReceipt,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import {
  createWindowsCurrentUserDataProtector,
  type WindowsCurrentUserDataProtector,
} from './windows-data-protection.js';

/**
 * Dormant local crash evidence for execution-contract v2.
 *
 * This module is intentionally not imported by the companion entry point or provider route. A
 * journal snapshot is local, rollbackable evidence only. It never establishes replay freshness,
 * proves a database transition, grants action authority, or permits a provider mutation/retry.
 */
export const WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_RUNTIME_ENABLED = false as const;
export const WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_KIND =
  'windows_companion_execution_v2_local_crash_evidence' as const;
export const WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_RELATIVE_PATH =
  'device/execution-v2/crash-evidence.secure.json' as const;

const JOURNAL_FILE = 'crash-evidence.secure.json';
const JOURNAL_DIRECTORY = 'execution-v2';
const MAXIMUM_CLEAR_JOURNAL_BYTES = 4_096;
const MAXIMUM_STORED_JOURNAL_BYTES = 16_384;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const POSTGRES_BIGINT_MAX = BigInt('9223372036854775807');

export type WindowsCompanionExecutionV2JournalPhase =
  | 'assignment_observed'
  | 'fence_consumed_reconciliation_required'
  | 'final_action_started_reconciliation_required'
  | 'signed_result_recorded_reconciliation_required';

type RecordedPostFenceOutcome = Exclude<ExecutionResultOutcome, 'refused_before_fence'>;

export interface WindowsCompanionExecutionV2CrashEvidence {
  readonly journalVersion: 2;
  readonly contractVersion: typeof COMPANION_EXECUTION_CONTRACT_VERSION;
  readonly protocolMode: typeof COMPANION_EXECUTION_PROTOCOL_MODE;
  readonly journalKind: typeof WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_KIND;
  readonly journalRevision: number;
  readonly phase: WindowsCompanionExecutionV2JournalPhase;
  readonly assignmentId: string;
  readonly assignmentBodyDigest: string;
  readonly assignmentReplayIdentity: string;
  readonly activationEpoch: string;
  readonly intentId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly authorityId: string | null;
  readonly authorityBodyDigest: string | null;
  readonly authorityReplayIdentity: string | null;
  readonly fenceId: string | null;
  readonly databaseFencedAt: string | null;
  readonly databaseAuthorityIssuedAt: string | null;
  readonly serverValidUntil: string | null;
  readonly finalActionStartedAt: string | null;
  readonly resultBodyDigest: string | null;
  readonly resultOutcome: RecordedPostFenceOutcome | null;
  readonly locallyRecordedAt: string;
  readonly localEvidenceOnly: true;
  readonly grantsActionAuthority: false;
  readonly replayStateAuthoritative: false;
  readonly requiresServerReconciliation: true;
  readonly providerMutationAllowed: false;
  readonly automaticDepositAllowed: false;
  readonly blindRetryAllowed: false;
}

export interface WindowsCompanionExecutionV2JournalOptions {
  readonly dataRoot: string;
  readonly protector?: WindowsCurrentUserDataProtector;
}

export interface WindowsCompanionExecutionV2PersistenceResult {
  readonly journalRevision: number;
  readonly fileContentsFlushed: true;
  readonly directoryMetadataFlushed: boolean;
  readonly grantsActionAuthority: false;
  readonly requiresServerReconciliation: true;
}

export type WindowsCompanionExecutionV2LocalEvidenceState =
  'missing' | 'corrupt' | 'stale' | 'locally_consistent_untrusted';

export interface WindowsCompanionExecutionV2RecoveryAssessment {
  readonly localEvidenceState: WindowsCompanionExecutionV2LocalEvidenceState;
  readonly localEvidence: WindowsCompanionExecutionV2CrashEvidence | null;
  readonly recoveryDisposition: 'server_database_reconciliation_required';
  readonly localEvidenceFreshnessProven: false;
  readonly requiresServerReplayCheck: true;
  readonly requiresSignedAuthoritativeStatus: true;
  readonly grantsActionAuthority: false;
  readonly providerMutationAllowed: false;
  readonly automaticDepositAllowed: false;
  readonly blindRetryAllowed: false;
}

export interface AssessWindowsCompanionExecutionV2RecoveryOptions extends WindowsCompanionExecutionV2JournalOptions {
  /** A lower bound obtained from durable server/database recovery state, never local storage. */
  readonly minimumExpectedJournalRevision: number;
}

interface ProtectedJournalEnvelope {
  readonly envelopeVersion: 2;
  readonly protection: 'windows-dpapi-current-user';
  readonly purposeDomain: 'execution-v2-crash-evidence';
  readonly protectedPayloadBase64: string;
}

type UnknownRecord = Record<string, unknown>;

const journalKeys = [
  'journalVersion',
  'contractVersion',
  'protocolMode',
  'journalKind',
  'journalRevision',
  'phase',
  'assignmentId',
  'assignmentBodyDigest',
  'assignmentReplayIdentity',
  'activationEpoch',
  'intentId',
  'jobId',
  'attemptId',
  'authorityId',
  'authorityBodyDigest',
  'authorityReplayIdentity',
  'fenceId',
  'databaseFencedAt',
  'databaseAuthorityIssuedAt',
  'serverValidUntil',
  'finalActionStartedAt',
  'resultBodyDigest',
  'resultOutcome',
  'locallyRecordedAt',
  'localEvidenceOnly',
  'grantsActionAuthority',
  'replayStateAuthoritative',
  'requiresServerReconciliation',
  'providerMutationAllowed',
  'automaticDepositAllowed',
  'blindRetryAllowed',
] as const;

const envelopeKeys = [
  'envelopeVersion',
  'protection',
  'purposeDomain',
  'protectedPayloadBase64',
] as const;

const immutableAssignmentKeys = [
  'assignmentId',
  'assignmentBodyDigest',
  'assignmentReplayIdentity',
  'activationEpoch',
  'intentId',
  'jobId',
  'attemptId',
] as const;

const immutableAuthorityKeys = [
  'authorityId',
  'authorityBodyDigest',
  'authorityReplayIdentity',
  'fenceId',
  'databaseFencedAt',
  'databaseAuthorityIssuedAt',
  'serverValidUntil',
] as const;

export class WindowsCompanionExecutionV2JournalUnavailableError extends Error {
  constructor() {
    super('Windows companion execution-v2 local crash evidence is unavailable.');
    this.name = 'WindowsCompanionExecutionV2JournalUnavailableError';
  }
}

function unavailable(): never {
  throw new WindowsCompanionExecutionV2JournalUnavailableError();
}

function plainRecord(candidate: unknown): candidate is UnknownRecord {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    !isProxy(candidate) &&
    Object.getPrototypeOf(candidate) === Object.prototype
  );
}

function exactDataKeys(candidate: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(candidate);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== 'string' || !expected.includes(key))
  ) {
    return false;
  }
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function own(candidate: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function digest(candidate: unknown): string | undefined {
  return typeof candidate === 'string' && DIGEST_PATTERN.test(candidate) ? candidate : undefined;
}

function opaque(candidate: unknown): string | undefined {
  return typeof candidate === 'string' && OPAQUE_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function activationEpoch(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(candidate)) return undefined;
  try {
    return BigInt(candidate) <= POSTGRES_BIGINT_MAX ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function timestamp(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string' || candidate.length > 32) return undefined;
  const milliseconds = Date.parse(candidate);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === candidate
    ? candidate
    : undefined;
}

function nullable<T>(
  candidate: unknown,
  decode: (value: unknown) => T | undefined,
): T | null | undefined {
  return candidate === null ? null : decode(candidate);
}

function postFenceOutcome(candidate: unknown): RecordedPostFenceOutcome | undefined {
  return candidate === 'submission_attempted' ||
    candidate === 'local_uncertain' ||
    candidate === 'post_fence_no_local_action'
    ? candidate
    : undefined;
}

function hasAuthority(evidence: WindowsCompanionExecutionV2CrashEvidence): boolean {
  return (
    evidence.authorityId !== null &&
    evidence.authorityBodyDigest !== null &&
    evidence.authorityReplayIdentity !== null &&
    evidence.fenceId !== null &&
    evidence.databaseFencedAt !== null &&
    evidence.databaseAuthorityIssuedAt !== null &&
    evidence.serverValidUntil !== null
  );
}

export function decodeWindowsCompanionExecutionV2CrashEvidence(
  candidate: unknown,
): WindowsCompanionExecutionV2CrashEvidence | undefined {
  try {
    if (!plainRecord(candidate) || !exactDataKeys(candidate, journalKeys)) return undefined;
    const journalRevision = own(candidate, 'journalRevision');
    const phase = own(candidate, 'phase');
    const assignmentId = opaque(own(candidate, 'assignmentId'));
    const assignmentBodyDigest = digest(own(candidate, 'assignmentBodyDigest'));
    const assignmentReplayIdentity = digest(own(candidate, 'assignmentReplayIdentity'));
    const selectedActivationEpoch = activationEpoch(own(candidate, 'activationEpoch'));
    const intentId = opaque(own(candidate, 'intentId'));
    const jobId = opaque(own(candidate, 'jobId'));
    const attemptId = opaque(own(candidate, 'attemptId'));
    const authorityId = nullable(own(candidate, 'authorityId'), opaque);
    const authorityBodyDigest = nullable(own(candidate, 'authorityBodyDigest'), digest);
    const authorityReplayIdentity = nullable(own(candidate, 'authorityReplayIdentity'), digest);
    const fenceId = nullable(own(candidate, 'fenceId'), opaque);
    const databaseFencedAt = nullable(own(candidate, 'databaseFencedAt'), timestamp);
    const databaseAuthorityIssuedAt = nullable(
      own(candidate, 'databaseAuthorityIssuedAt'),
      timestamp,
    );
    const serverValidUntil = nullable(own(candidate, 'serverValidUntil'), timestamp);
    const finalActionStartedAt = nullable(own(candidate, 'finalActionStartedAt'), timestamp);
    const resultBodyDigest = nullable(own(candidate, 'resultBodyDigest'), digest);
    const resultOutcomeCandidate = own(candidate, 'resultOutcome');
    const resultOutcome =
      resultOutcomeCandidate === null ? null : postFenceOutcome(resultOutcomeCandidate);
    const locallyRecordedAt = timestamp(own(candidate, 'locallyRecordedAt'));
    if (
      own(candidate, 'journalVersion') !== 2 ||
      own(candidate, 'contractVersion') !== COMPANION_EXECUTION_CONTRACT_VERSION ||
      own(candidate, 'protocolMode') !== COMPANION_EXECUTION_PROTOCOL_MODE ||
      own(candidate, 'journalKind') !== WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_KIND ||
      typeof journalRevision !== 'number' ||
      !Number.isSafeInteger(journalRevision) ||
      journalRevision < 1 ||
      (phase !== 'assignment_observed' &&
        phase !== 'fence_consumed_reconciliation_required' &&
        phase !== 'final_action_started_reconciliation_required' &&
        phase !== 'signed_result_recorded_reconciliation_required') ||
      !assignmentId ||
      !assignmentBodyDigest ||
      !assignmentReplayIdentity ||
      !selectedActivationEpoch ||
      !intentId ||
      !jobId ||
      !attemptId ||
      authorityId === undefined ||
      authorityBodyDigest === undefined ||
      authorityReplayIdentity === undefined ||
      fenceId === undefined ||
      databaseFencedAt === undefined ||
      databaseAuthorityIssuedAt === undefined ||
      serverValidUntil === undefined ||
      finalActionStartedAt === undefined ||
      resultBodyDigest === undefined ||
      resultOutcome === undefined ||
      !locallyRecordedAt ||
      own(candidate, 'localEvidenceOnly') !== true ||
      own(candidate, 'grantsActionAuthority') !== false ||
      own(candidate, 'replayStateAuthoritative') !== false ||
      own(candidate, 'requiresServerReconciliation') !== true ||
      own(candidate, 'providerMutationAllowed') !== false ||
      own(candidate, 'automaticDepositAllowed') !== false ||
      own(candidate, 'blindRetryAllowed') !== false
    ) {
      return undefined;
    }
    const evidence = Object.freeze({
      journalVersion: 2 as const,
      contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
      protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
      journalKind: WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_KIND,
      journalRevision,
      phase,
      assignmentId,
      assignmentBodyDigest,
      assignmentReplayIdentity,
      activationEpoch: selectedActivationEpoch,
      intentId,
      jobId,
      attemptId,
      authorityId,
      authorityBodyDigest,
      authorityReplayIdentity,
      fenceId,
      databaseFencedAt,
      databaseAuthorityIssuedAt,
      serverValidUntil,
      finalActionStartedAt,
      resultBodyDigest,
      resultOutcome,
      locallyRecordedAt,
      localEvidenceOnly: true as const,
      grantsActionAuthority: false as const,
      replayStateAuthoritative: false as const,
      requiresServerReconciliation: true as const,
      providerMutationAllowed: false as const,
      automaticDepositAllowed: false as const,
      blindRetryAllowed: false as const,
    });
    const authorityPresent = hasAuthority(evidence);
    const authorityAbsent =
      authorityId === null &&
      authorityBodyDigest === null &&
      authorityReplayIdentity === null &&
      fenceId === null &&
      databaseFencedAt === null &&
      databaseAuthorityIssuedAt === null &&
      serverValidUntil === null;
    if (!authorityPresent && !authorityAbsent) return undefined;
    if (
      (phase === 'assignment_observed' &&
        (!authorityAbsent ||
          finalActionStartedAt !== null ||
          resultBodyDigest !== null ||
          resultOutcome !== null)) ||
      (phase === 'fence_consumed_reconciliation_required' &&
        (!authorityPresent ||
          finalActionStartedAt !== null ||
          resultBodyDigest !== null ||
          resultOutcome !== null)) ||
      (phase === 'final_action_started_reconciliation_required' &&
        (!authorityPresent ||
          finalActionStartedAt === null ||
          resultBodyDigest !== null ||
          resultOutcome !== null)) ||
      (phase === 'signed_result_recorded_reconciliation_required' &&
        (!authorityPresent || resultBodyDigest === null || resultOutcome === null)) ||
      (resultOutcome === 'post_fence_no_local_action' && finalActionStartedAt !== null) ||
      ((resultOutcome === 'submission_attempted' || resultOutcome === 'local_uncertain') &&
        finalActionStartedAt === null)
    ) {
      return undefined;
    }
    return evidence;
  } catch {
    return undefined;
  }
}

function baseEvidence(
  assignment: NonNullable<ReturnType<typeof decodeSignedExecutionAssignment>>,
  assignmentReplayIdentity: string,
  locallyRecordedAt: string,
): WindowsCompanionExecutionV2CrashEvidence {
  return Object.freeze({
    journalVersion: 2,
    contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
    protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
    journalKind: WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_KIND,
    journalRevision: 1,
    phase: 'assignment_observed',
    assignmentId: assignment.body.assignmentId,
    assignmentBodyDigest: assignment.bodyDigest,
    assignmentReplayIdentity,
    activationEpoch: assignment.body.activationEpoch,
    intentId: assignment.body.intentId,
    jobId: assignment.body.jobId,
    attemptId: assignment.body.attemptId,
    authorityId: null,
    authorityBodyDigest: null,
    authorityReplayIdentity: null,
    fenceId: null,
    databaseFencedAt: null,
    databaseAuthorityIssuedAt: null,
    serverValidUntil: null,
    finalActionStartedAt: null,
    resultBodyDigest: null,
    resultOutcome: null,
    locallyRecordedAt,
    localEvidenceOnly: true,
    grantsActionAuthority: false,
    replayStateAuthoritative: false,
    requiresServerReconciliation: true,
    providerMutationAllowed: false,
    automaticDepositAllowed: false,
    blindRetryAllowed: false,
  });
}

export function createWindowsCompanionExecutionV2AssignmentEvidence(
  signedAssignmentCandidate: unknown,
  locallyRecordedAtCandidate: unknown,
): WindowsCompanionExecutionV2CrashEvidence | undefined {
  const assignment = decodeSignedExecutionAssignment(signedAssignmentCandidate);
  const replayIdentity = deriveExecutionAssignmentReplayIdentity(signedAssignmentCandidate);
  const locallyRecordedAt = timestamp(locallyRecordedAtCandidate);
  const computedDigest = assignment && digestExecutionAssignmentBody(assignment.body);
  if (
    !assignment ||
    !replayIdentity ||
    !locallyRecordedAt ||
    computedDigest !== assignment.bodyDigest
  ) {
    return undefined;
  }
  return baseEvidence(assignment, replayIdentity, locallyRecordedAt);
}

function matchingReceipt(
  candidate: unknown,
  replayIdentity: string,
  authorityBodyDigest: string,
): candidate is ExternalAtomicReplayConsumptionReceipt {
  return (
    plainRecord(candidate) &&
    exactDataKeys(candidate, [
      'receiptKind',
      'replayIdentity',
      'authorityBodyDigest',
      'consumedExactlyOnce',
    ]) &&
    own(candidate, 'receiptKind') === 'external_atomic_replay_consumption' &&
    own(candidate, 'replayIdentity') === replayIdentity &&
    own(candidate, 'authorityBodyDigest') === authorityBodyDigest &&
    own(candidate, 'consumedExactlyOnce') === true
  );
}

export function recordWindowsCompanionExecutionV2FenceConsumptionEvidence(
  previousCandidate: unknown,
  signedAuthorityCandidate: unknown,
  atomicConsumptionReceiptCandidate: unknown,
  locallyRecordedAtCandidate: unknown,
): WindowsCompanionExecutionV2CrashEvidence | undefined {
  const previous = decodeWindowsCompanionExecutionV2CrashEvidence(previousCandidate);
  const authority = decodeSignedOneUseActionAuthority(signedAuthorityCandidate);
  const authorityReplayIdentity =
    deriveOneUseActionAuthorityReplayIdentity(signedAuthorityCandidate);
  const locallyRecordedAt = timestamp(locallyRecordedAtCandidate);
  const computedDigest = authority && digestOneUseActionAuthorityBody(authority.body);
  if (
    !previous ||
    previous.phase !== 'assignment_observed' ||
    !authority ||
    computedDigest !== authority.bodyDigest ||
    !authorityReplayIdentity ||
    !locallyRecordedAt ||
    authority.body.assignmentId !== previous.assignmentId ||
    authority.body.assignmentBodyDigest !== previous.assignmentBodyDigest ||
    authority.body.activationEpoch !== previous.activationEpoch ||
    authority.body.intentId !== previous.intentId ||
    authority.body.jobId !== previous.jobId ||
    authority.body.attemptId !== previous.attemptId ||
    !matchingReceipt(
      atomicConsumptionReceiptCandidate,
      authorityReplayIdentity,
      authority.bodyDigest,
    ) ||
    previous.journalRevision >= Number.MAX_SAFE_INTEGER
  ) {
    return undefined;
  }
  const next = {
    ...previous,
    journalRevision: previous.journalRevision + 1,
    phase: 'fence_consumed_reconciliation_required' as const,
    authorityId: authority.body.authorityId,
    authorityBodyDigest: authority.bodyDigest,
    authorityReplayIdentity,
    fenceId: authority.body.fenceId,
    databaseFencedAt: authority.body.databaseFencedAt,
    databaseAuthorityIssuedAt: authority.body.databaseAuthorityIssuedAt,
    serverValidUntil: authority.body.serverValidUntil,
    locallyRecordedAt,
  };
  return isLegalWindowsCompanionExecutionV2JournalTransition(previous, next)
    ? Object.freeze(next)
    : undefined;
}

export function recordWindowsCompanionExecutionV2FinalActionStartedEvidence(
  previousCandidate: unknown,
  finalActionStartedAtCandidate: unknown,
  locallyRecordedAtCandidate: unknown,
): WindowsCompanionExecutionV2CrashEvidence | undefined {
  const previous = decodeWindowsCompanionExecutionV2CrashEvidence(previousCandidate);
  const finalActionStartedAt = timestamp(finalActionStartedAtCandidate);
  const locallyRecordedAt = timestamp(locallyRecordedAtCandidate);
  if (
    !previous ||
    previous.phase !== 'fence_consumed_reconciliation_required' ||
    !finalActionStartedAt ||
    !locallyRecordedAt ||
    previous.journalRevision >= Number.MAX_SAFE_INTEGER
  ) {
    return undefined;
  }
  const next = {
    ...previous,
    journalRevision: previous.journalRevision + 1,
    phase: 'final_action_started_reconciliation_required' as const,
    finalActionStartedAt,
    locallyRecordedAt,
  };
  return isLegalWindowsCompanionExecutionV2JournalTransition(previous, next)
    ? Object.freeze(next)
    : undefined;
}

export function recordWindowsCompanionExecutionV2SignedResultEvidence(
  previousCandidate: unknown,
  signedResultCandidate: unknown,
  locallyRecordedAtCandidate: unknown,
): WindowsCompanionExecutionV2CrashEvidence | undefined {
  const previous = decodeWindowsCompanionExecutionV2CrashEvidence(previousCandidate);
  const result = decodeSignedExecutionResult(signedResultCandidate);
  const locallyRecordedAt = timestamp(locallyRecordedAtCandidate);
  const computedDigest = result && digestExecutionResultBody(result.body);
  if (
    !previous ||
    (previous.phase !== 'fence_consumed_reconciliation_required' &&
      previous.phase !== 'final_action_started_reconciliation_required') ||
    !result ||
    computedDigest !== result.bodyDigest ||
    !locallyRecordedAt ||
    result.body.assignmentId !== previous.assignmentId ||
    result.body.assignmentBodyDigest !== previous.assignmentBodyDigest ||
    result.body.activationEpoch !== previous.activationEpoch ||
    result.body.intentId !== previous.intentId ||
    result.body.jobId !== previous.jobId ||
    result.body.attemptId !== previous.attemptId ||
    result.body.authorityId !== previous.authorityId ||
    result.body.authorityBodyDigest !== previous.authorityBodyDigest ||
    result.body.fenceId !== previous.fenceId ||
    result.body.outcome === 'refused_before_fence' ||
    (previous.phase === 'fence_consumed_reconciliation_required' &&
      (result.body.outcome !== 'post_fence_no_local_action' ||
        result.body.finalActionStarted !== false ||
        result.body.finalActionStartedAt !== null)) ||
    (previous.phase === 'final_action_started_reconciliation_required' &&
      ((result.body.outcome !== 'submission_attempted' &&
        result.body.outcome !== 'local_uncertain') ||
        result.body.finalActionStarted !== true ||
        result.body.finalActionStartedAt !== previous.finalActionStartedAt)) ||
    previous.journalRevision >= Number.MAX_SAFE_INTEGER
  ) {
    return undefined;
  }
  const next = {
    ...previous,
    journalRevision: previous.journalRevision + 1,
    phase: 'signed_result_recorded_reconciliation_required' as const,
    resultBodyDigest: result.bodyDigest,
    resultOutcome: result.body.outcome,
    locallyRecordedAt,
  };
  return isLegalWindowsCompanionExecutionV2JournalTransition(previous, next)
    ? Object.freeze(next)
    : undefined;
}

function sameFields(
  previous: WindowsCompanionExecutionV2CrashEvidence,
  next: WindowsCompanionExecutionV2CrashEvidence,
  keys: readonly (keyof WindowsCompanionExecutionV2CrashEvidence)[],
): boolean {
  return keys.every((key) => previous[key] === next[key]);
}

export function isLegalWindowsCompanionExecutionV2JournalTransition(
  previousCandidate: unknown | null,
  nextCandidate: unknown,
): boolean {
  const previous =
    previousCandidate === null
      ? null
      : decodeWindowsCompanionExecutionV2CrashEvidence(previousCandidate);
  const next = decodeWindowsCompanionExecutionV2CrashEvidence(nextCandidate);
  if (!next) return false;
  if (previousCandidate === null) {
    return next.journalRevision === 1 && next.phase === 'assignment_observed';
  }
  if (
    !previous ||
    next.journalRevision !== previous.journalRevision + 1 ||
    Date.parse(next.locallyRecordedAt) < Date.parse(previous.locallyRecordedAt) ||
    !sameFields(previous, next, immutableAssignmentKeys)
  ) {
    return false;
  }
  if (previous.phase === 'assignment_observed') {
    return next.phase === 'fence_consumed_reconciliation_required';
  }
  if (!sameFields(previous, next, immutableAuthorityKeys)) return false;
  if (previous.phase === 'fence_consumed_reconciliation_required') {
    return (
      next.phase === 'final_action_started_reconciliation_required' ||
      (next.phase === 'signed_result_recorded_reconciliation_required' &&
        next.resultOutcome === 'post_fence_no_local_action')
    );
  }
  if (previous.phase === 'final_action_started_reconciliation_required') {
    return (
      next.phase === 'signed_result_recorded_reconciliation_required' &&
      next.finalActionStartedAt === previous.finalActionStartedAt &&
      (next.resultOutcome === 'submission_attempted' || next.resultOutcome === 'local_uncertain')
    );
  }
  return false;
}

function canonicalJournalBytes(evidence: WindowsCompanionExecutionV2CrashEvidence): Buffer {
  return Buffer.from(`${JSON.stringify(evidence)}\n`, 'utf8');
}

function decodeEnvelope(candidate: unknown): ProtectedJournalEnvelope | undefined {
  if (!plainRecord(candidate) || !exactDataKeys(candidate, envelopeKeys)) return undefined;
  const encoded = own(candidate, 'protectedPayloadBase64');
  if (
    own(candidate, 'envelopeVersion') !== 2 ||
    own(candidate, 'protection') !== 'windows-dpapi-current-user' ||
    own(candidate, 'purposeDomain') !== 'execution-v2-crash-evidence' ||
    typeof encoded !== 'string' ||
    encoded.length < 4 ||
    encoded.length > MAXIMUM_STORED_JOURNAL_BYTES ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    return undefined;
  }
  const protectedBytes = Buffer.from(encoded, 'base64');
  try {
    if (
      protectedBytes.length < 1 ||
      protectedBytes.length > MAXIMUM_STORED_JOURNAL_BYTES ||
      protectedBytes.toString('base64') !== encoded
    ) {
      return undefined;
    }
  } finally {
    protectedBytes.fill(0);
  }
  return Object.freeze({
    envelopeVersion: 2,
    protection: 'windows-dpapi-current-user',
    purposeDomain: 'execution-v2-crash-evidence',
    protectedPayloadBase64: encoded,
  });
}

type ReadJournalResult =
  | { readonly state: 'missing' }
  | { readonly state: 'corrupt' }
  | {
      readonly state: 'locally_consistent_untrusted';
      readonly evidence: WindowsCompanionExecutionV2CrashEvidence;
    };

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function stableJournalRoot(dataRoot: string): Promise<string> {
  const deviceRoot = resolve(dataRoot, 'device');
  const journalRoot = resolve(deviceRoot, JOURNAL_DIRECTORY);
  await mkdir(journalRoot, { recursive: true, mode: 0o700 });
  const [deviceStat, journalStat, canonicalDataRoot, canonicalDeviceRoot, canonicalJournalRoot] =
    await Promise.all([
      lstat(deviceRoot),
      lstat(journalRoot),
      realpath(dataRoot),
      realpath(deviceRoot),
      realpath(journalRoot),
    ]);
  const normalize = (value: string) =>
    process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
  if (
    !deviceStat.isDirectory() ||
    deviceStat.isSymbolicLink() ||
    !journalStat.isDirectory() ||
    journalStat.isSymbolicLink() ||
    normalize(canonicalDeviceRoot) !== normalize(resolve(canonicalDataRoot, 'device')) ||
    normalize(canonicalJournalRoot) !== normalize(resolve(canonicalDeviceRoot, JOURNAL_DIRECTORY))
  ) {
    return unavailable();
  }
  return canonicalJournalRoot;
}

async function readJournal(
  journalPath: string,
  protector: WindowsCurrentUserDataProtector,
): Promise<ReadJournalResult> {
  let raw: string;
  try {
    const stat = await lstat(journalPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAXIMUM_STORED_JOURNAL_BYTES
    ) {
      return { state: 'corrupt' };
    }
    raw = await readFile(journalPath, 'utf8');
  } catch (error) {
    return hasCode(error, 'ENOENT') ? { state: 'missing' } : { state: 'corrupt' };
  }
  let envelope: ProtectedJournalEnvelope | undefined;
  try {
    envelope = decodeEnvelope(JSON.parse(raw) as unknown);
  } catch {
    return { state: 'corrupt' };
  }
  if (!envelope || `${JSON.stringify(envelope)}\n` !== raw) return { state: 'corrupt' };
  const protectedBytes = Buffer.from(envelope.protectedPayloadBase64, 'base64');
  let cleartext: Buffer | undefined;
  try {
    cleartext = await protector.unprotect(protectedBytes);
    if (
      !Buffer.isBuffer(cleartext) ||
      cleartext.length < 1 ||
      cleartext.length > MAXIMUM_CLEAR_JOURNAL_BYTES
    ) {
      return { state: 'corrupt' };
    }
    const evidence = decodeWindowsCompanionExecutionV2CrashEvidence(
      JSON.parse(cleartext.toString('utf8')) as unknown,
    );
    if (!evidence || !canonicalJournalBytes(evidence).equals(cleartext)) {
      return { state: 'corrupt' };
    }
    return { state: 'locally_consistent_untrusted', evidence };
  } catch {
    return { state: 'corrupt' };
  } finally {
    protectedBytes.fill(0);
    cleartext?.fill(0);
  }
}

async function syncDirectoryBestEffort(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
    return true;
  } catch {
    // Windows/Node may not expose a flushable directory handle. The renamed file itself is synced,
    // but sudden power loss can still lose directory metadata; server recovery remains mandatory.
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function atomicReplaceAndFlush(destination: string, contents: string): Promise<boolean> {
  const parent = dirname(destination);
  const temporary = resolve(
    parent,
    `.${basename(destination)}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`,
  );
  let temporaryHandle;
  let renamed = false;
  try {
    try {
      const existing = await lstat(destination);
      if (!existing.isFile() || existing.isSymbolicLink()) unavailable();
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    temporaryHandle = await open(temporary, 'wx', 0o600);
    await temporaryHandle.writeFile(contents, 'utf8');
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await rename(temporary, destination);
    renamed = true;
    let destinationHandle;
    try {
      destinationHandle = await open(destination, 'r+');
      await destinationHandle.sync();
    } finally {
      await destinationHandle?.close().catch(() => undefined);
    }
    return await syncDirectoryBestEffort(parent);
  } catch (error) {
    if (error instanceof WindowsCompanionExecutionV2JournalUnavailableError) throw error;
    return unavailable();
  } finally {
    await temporaryHandle?.close().catch(() => undefined);
    if (!renamed) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function persistWindowsCompanionExecutionV2CrashEvidence(
  nextCandidate: unknown,
  options: WindowsCompanionExecutionV2JournalOptions,
): Promise<WindowsCompanionExecutionV2PersistenceResult> {
  const next = decodeWindowsCompanionExecutionV2CrashEvidence(nextCandidate);
  if (!next || WINDOWS_COMPANION_EXECUTION_V2_JOURNAL_RUNTIME_ENABLED !== false) {
    return unavailable();
  }
  const protector =
    options.protector ??
    createWindowsCurrentUserDataProtector(process.env, 'execution-v2-crash-evidence');
  const journalRoot = await stableJournalRoot(options.dataRoot);
  const journalPath = resolve(journalRoot, JOURNAL_FILE);
  const current = await readJournal(journalPath, protector);
  if (
    current.state === 'corrupt' ||
    !isLegalWindowsCompanionExecutionV2JournalTransition(
      current.state === 'missing' ? null : current.evidence,
      next,
    )
  ) {
    return unavailable();
  }
  const cleartext = canonicalJournalBytes(next);
  let protectedBytes: Buffer | undefined;
  try {
    if (cleartext.length > MAXIMUM_CLEAR_JOURNAL_BYTES) return unavailable();
    protectedBytes = await protector.protect(cleartext);
    if (
      !Buffer.isBuffer(protectedBytes) ||
      protectedBytes.length < 1 ||
      protectedBytes.length > MAXIMUM_STORED_JOURNAL_BYTES
    ) {
      return unavailable();
    }
    const envelope: ProtectedJournalEnvelope = Object.freeze({
      envelopeVersion: 2,
      protection: 'windows-dpapi-current-user',
      purposeDomain: 'execution-v2-crash-evidence',
      protectedPayloadBase64: protectedBytes.toString('base64'),
    });
    const serializedEnvelope = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(serializedEnvelope, 'utf8') > MAXIMUM_STORED_JOURNAL_BYTES) {
      return unavailable();
    }
    const directoryMetadataFlushed = await atomicReplaceAndFlush(journalPath, serializedEnvelope);
    return Object.freeze({
      journalRevision: next.journalRevision,
      fileContentsFlushed: true,
      directoryMetadataFlushed,
      grantsActionAuthority: false,
      requiresServerReconciliation: true,
    });
  } catch (error) {
    if (error instanceof WindowsCompanionExecutionV2JournalUnavailableError) throw error;
    return unavailable();
  } finally {
    cleartext.fill(0);
    protectedBytes?.fill(0);
  }
}

function recoveryAssessment(
  state: WindowsCompanionExecutionV2LocalEvidenceState,
  localEvidence: WindowsCompanionExecutionV2CrashEvidence | null,
): WindowsCompanionExecutionV2RecoveryAssessment {
  return Object.freeze({
    localEvidenceState: state,
    localEvidence,
    recoveryDisposition: 'server_database_reconciliation_required',
    localEvidenceFreshnessProven: false,
    requiresServerReplayCheck: true,
    requiresSignedAuthoritativeStatus: true,
    grantsActionAuthority: false,
    providerMutationAllowed: false,
    automaticDepositAllowed: false,
    blindRetryAllowed: false,
  });
}

/**
 * Reads local evidence only. The mandatory minimum revision must come from durable server recovery
 * state, but even a locally consistent snapshot never proves freshness. The caller must query the
 * server/database replay state and verify a fresh signed authoritative status before recovery.
 */
export async function assessWindowsCompanionExecutionV2Recovery(
  options: AssessWindowsCompanionExecutionV2RecoveryOptions,
): Promise<WindowsCompanionExecutionV2RecoveryAssessment> {
  if (
    !Number.isSafeInteger(options.minimumExpectedJournalRevision) ||
    options.minimumExpectedJournalRevision < 0
  ) {
    return unavailable();
  }
  const protector =
    options.protector ??
    createWindowsCurrentUserDataProtector(process.env, 'execution-v2-crash-evidence');
  const journalRoot = await stableJournalRoot(options.dataRoot);
  const result = await readJournal(resolve(journalRoot, JOURNAL_FILE), protector);
  if (result.state === 'missing') return recoveryAssessment('missing', null);
  if (result.state === 'corrupt') return recoveryAssessment('corrupt', null);
  if (result.evidence.journalRevision < options.minimumExpectedJournalRevision) {
    return recoveryAssessment('stale', result.evidence);
  }
  return recoveryAssessment('locally_consistent_untrusted', result.evidence);
}
