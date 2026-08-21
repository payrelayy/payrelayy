import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION,
  AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_KEY_VERSION,
  AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_PROTECTION_PROFILE_VERSION,
  redactedAuthoritativeDepositProofOutcomeForLog,
  validatedAuthoritativeDepositProofOutcomeCandidate,
  type AuthoritativeDepositProofOutcomeCandidate,
  type AuthoritativeDepositProofOutcomeReasonCode,
  type AuthoritativeDepositProofProtectedCanonicalReference,
  type RedactedAuthoritativeDepositProofOutcomeLogProjection,
} from '@fetanagent/contracts';
import {
  DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION,
  DEPOSIT_PROOF_REFERENCE_KEY_VERSION,
  DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION,
  assessOfficialDepositProof,
  type DepositProofAssessmentDatabaseFacts,
  type DepositProofAssessmentDecision,
  type DepositProofAssessmentInput,
  type OfficialDepositProofObservation,
} from '@fetanagent/deposit-proof-assessment';
import {
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
  TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  decodeTelebirrLivePilotSignedAssignment,
  decodeTelebirrLivePilotSignedObservation,
  decodeTelebirrLivePilotTrustedRequestBinding,
  verifyTelebirrLivePrivatePilotEvidence,
  type TelebirrLivePilotFoundFacts,
  type TelebirrLivePilotReceiptFacts,
  type TelebirrLivePilotVerificationInput,
  type TelebirrLivePilotVerificationReason,
} from '@fetanagent/telebirr-verification-foundation';

/**
 * A pure composition boundary. This adapter can emit an advisory outcome candidate, but it cannot
 * read or mutate provider/database state and cannot authorize any later transition.
 */
export const TELEBIRR_LIVE_PILOT_OUTCOME_ADAPTER_CONTRACT_VERSION = 1 as const;
export const TELEBIRR_LIVE_PILOT_OUTCOME_ADAPTER_VERSION =
  'telebirr-live-pilot-outcome-adapter-v1' as const;
export const TELEBIRR_LIVE_PILOT_POLICY_DIGEST_PROFILE =
  'telebirr-live-pilot-policy-digest-v1' as const;
export const TELEBIRR_LIVE_PILOT_DATABASE_SNAPSHOT_DIGEST_PROFILE =
  'telebirr-live-pilot-database-snapshot-digest-v1' as const;
export const TELEBIRR_LIVE_PILOT_ASSESSMENT_INPUT_DIGEST_PROFILE =
  'telebirr-live-pilot-assessment-input-digest-v1' as const;

export interface TelebirrLivePilotOutcomeTrustedRequestBinding {
  readonly proofRequestId: string;
  readonly submittingCustomerId: string;
  readonly submittingCustomerMembershipState: 'included' | 'excluded';
  readonly submittingCustomerCurrentState: 'active' | 'inactive' | 'unavailable';
  readonly submittingCustomerSnapshotState: 'exact' | 'stale' | 'unavailable';
  readonly playerAccountId: string;
  readonly selectedPlayerId: string;
  readonly providerCode: 'telebirr';
  readonly referenceFingerprint: string;
  readonly submittedAt: string;
  readonly pilotRevisionId: string;
  readonly pilotConfigurationDigest: string;
  readonly receiverRevisionId: string;
  readonly policyVersion: string;
  readonly databaseSnapshotId: string;
}

export interface TelebirrLivePilotOutcomeTrustedPilotBinding {
  readonly contractVersion: 1;
  readonly revisionId: string;
  readonly configurationDigest: string;
  readonly state: 'armed' | 'stopped';
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface TelebirrLivePilotOutcomeTrustedPlayerBinding {
  readonly ownerCustomerId: string;
  readonly playerMembershipState: 'included' | 'excluded';
  readonly ownerCustomerBindingState: 'exact' | 'mismatched' | 'unavailable';
  readonly ownerCustomerCurrentState: 'active' | 'inactive' | 'unavailable';
  readonly ownerCustomerSnapshotState: 'exact' | 'stale' | 'unavailable';
  readonly playerAccountId: string;
  readonly selectedPlayerId: string;
  readonly eligibilityState: 'eligible' | 'ineligible' | 'unavailable' | 'ambiguous';
  readonly eligibilityDecisionVersion: string | null;
}

export interface TelebirrLivePilotOutcomeTrustedProviderBinding {
  readonly providerCode: 'telebirr';
  readonly state: 'active' | 'inactive';
  readonly source: 'telebirr_official_receipt';
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly adapterVersion: typeof TELEBIRR_LIVE_PILOT_ADAPTER_VERSION;
  readonly parserVersion: typeof TELEBIRR_LIVE_PILOT_PARSER_VERSION;
  readonly normalizerVersion: typeof TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION;
}

export interface TelebirrLivePilotOutcomeTrustedReferenceBinding extends AuthoritativeDepositProofProtectedCanonicalReference {
  readonly providerCode: 'telebirr';
}

export interface TelebirrLivePilotOutcomeTrustedReceiverBinding {
  readonly providerCode: 'telebirr';
  readonly revisionId: string;
  readonly revisionVersion: number;
  readonly profileId: string;
  readonly profileDigest: string;
  readonly configurationDigest: string;
  readonly identityDigest: string;
  readonly expectedReceiverNameDigest: string;
  readonly matchBasis: 'exact_full_name';
}

export interface TelebirrLivePilotOutcomeTrustedPolicyBinding {
  readonly providerCode: 'telebirr';
  readonly policyVersion: string;
  readonly policyDigest: string;
}

export interface TelebirrLivePilotDatabaseAuthorityFacts {
  readonly submittingCustomerId: string;
  readonly submittingCustomerMembershipState: 'included' | 'excluded';
  readonly submittingCustomerCurrentState: 'active' | 'inactive' | 'unavailable';
  readonly submittingCustomerSnapshotState: 'exact' | 'stale' | 'unavailable';
  readonly ownerCustomerId: string;
  readonly playerAccountId: string;
  readonly playerMembershipState: 'included' | 'excluded';
  readonly ownerCustomerBindingState: 'exact' | 'mismatched' | 'unavailable';
  readonly ownerCustomerCurrentState: 'active' | 'inactive' | 'unavailable';
  readonly ownerCustomerSnapshotState: 'exact' | 'stale' | 'unavailable';
}

export interface TelebirrLivePilotDatabaseSnapshotMaterial {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly authority: TelebirrLivePilotDatabaseAuthorityFacts;
  readonly facts: DepositProofAssessmentDatabaseFacts;
}

export interface TelebirrLivePilotOutcomeTrustedDatabaseSnapshot extends TelebirrLivePilotDatabaseSnapshotMaterial {
  readonly snapshotDigest: string;
}

export interface TelebirrLivePilotOutcomeAdapterInput {
  readonly contractVersion: typeof TELEBIRR_LIVE_PILOT_OUTCOME_ADAPTER_CONTRACT_VERSION;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof TELEBIRR_LIVE_PILOT_PROTOCOL_MODE;
  readonly assessedAt: string;
  readonly trustedRequest: TelebirrLivePilotOutcomeTrustedRequestBinding;
  readonly trustedPilot: TelebirrLivePilotOutcomeTrustedPilotBinding;
  readonly trustedPlayer: TelebirrLivePilotOutcomeTrustedPlayerBinding;
  readonly trustedProvider: TelebirrLivePilotOutcomeTrustedProviderBinding;
  readonly trustedReference: TelebirrLivePilotOutcomeTrustedReferenceBinding;
  readonly trustedReceiver: TelebirrLivePilotOutcomeTrustedReceiverBinding;
  readonly trustedPolicy: TelebirrLivePilotOutcomeTrustedPolicyBinding;
  readonly trustedDatabaseSnapshot: TelebirrLivePilotOutcomeTrustedDatabaseSnapshot;
  readonly verificationInput: TelebirrLivePilotVerificationInput;
}

type UnknownRecord = Record<string, unknown>;
type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | {
      readonly [key: string]: CanonicalJsonValue;
    };

interface ParsedInput {
  readonly assessedAt: string;
  readonly request: TelebirrLivePilotOutcomeTrustedRequestBinding;
  readonly pilot: TelebirrLivePilotOutcomeTrustedPilotBinding;
  readonly player: TelebirrLivePilotOutcomeTrustedPlayerBinding;
  readonly provider: TelebirrLivePilotOutcomeTrustedProviderBinding;
  readonly reference: TelebirrLivePilotOutcomeTrustedReferenceBinding;
  readonly receiver: TelebirrLivePilotOutcomeTrustedReceiverBinding;
  readonly policy: TelebirrLivePilotOutcomeTrustedPolicyBinding;
  readonly databaseSnapshot: TelebirrLivePilotOutcomeTrustedDatabaseSnapshot;
  readonly verificationInput: unknown;
}

const inputKeys = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'assessedAt',
  'trustedRequest',
  'trustedPilot',
  'trustedPlayer',
  'trustedProvider',
  'trustedReference',
  'trustedReceiver',
  'trustedPolicy',
  'trustedDatabaseSnapshot',
  'verificationInput',
] as const;
const requestKeys = [
  'proofRequestId',
  'submittingCustomerId',
  'submittingCustomerMembershipState',
  'submittingCustomerCurrentState',
  'submittingCustomerSnapshotState',
  'playerAccountId',
  'selectedPlayerId',
  'providerCode',
  'referenceFingerprint',
  'submittedAt',
  'pilotRevisionId',
  'pilotConfigurationDigest',
  'receiverRevisionId',
  'policyVersion',
  'databaseSnapshotId',
] as const;
const pilotKeys = [
  'contractVersion',
  'revisionId',
  'configurationDigest',
  'state',
  'validFrom',
  'validUntil',
] as const;
const playerKeys = [
  'ownerCustomerId',
  'playerMembershipState',
  'ownerCustomerBindingState',
  'ownerCustomerCurrentState',
  'ownerCustomerSnapshotState',
  'playerAccountId',
  'selectedPlayerId',
  'eligibilityState',
  'eligibilityDecisionVersion',
] as const;
const providerKeys = [
  'providerCode',
  'state',
  'source',
  'sourceProfile',
  'adapterVersion',
  'parserVersion',
  'normalizerVersion',
] as const;
const referenceKeys = [
  'providerCode',
  'protectionProfileVersion',
  'encryptionKeyVersion',
  'ciphertext',
  'fingerprint',
  'masked',
] as const;
const receiverKeys = [
  'providerCode',
  'revisionId',
  'revisionVersion',
  'profileId',
  'profileDigest',
  'configurationDigest',
  'identityDigest',
  'expectedReceiverNameDigest',
  'matchBasis',
] as const;
const policyBindingKeys = ['providerCode', 'policyVersion', 'policyDigest'] as const;
const databaseSnapshotKeys = [
  'snapshotId',
  'capturedAt',
  'authority',
  'facts',
  'snapshotDigest',
] as const;
const databaseSnapshotMaterialKeys = ['snapshotId', 'capturedAt', 'authority', 'facts'] as const;
const databaseAuthorityKeys = [
  'submittingCustomerId',
  'submittingCustomerMembershipState',
  'submittingCustomerCurrentState',
  'submittingCustomerSnapshotState',
  'ownerCustomerId',
  'playerAccountId',
  'playerMembershipState',
  'ownerCustomerBindingState',
  'ownerCustomerCurrentState',
  'ownerCustomerSnapshotState',
] as const;
const databaseFactsKeys = [
  'receiverAtOccurredAt',
  'currentPolicy',
  'currentEligibility',
  'duplicateState',
] as const;
const policyFactKeys = [
  'state',
  'providerCode',
  'checkedAt',
  'policyVersion',
  'currencyCode',
  'minimumPrincipalAmountMinor',
  'maximumPrincipalAmountMinor',
  'automaticFreshnessSeconds',
  'maximumFutureSkewSeconds',
  'allowedTransactionType',
  'acceptedSource',
  'acceptedSourceProfile',
  'acceptedAdapterVersion',
  'acceptedParserVersion',
  'acceptedNormalizerVersion',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const VERSION_PATTERN = /^[a-z][a-z0-9_-]{0,95}(?:[-_]v[0-9]+)$/u;
const CIPHERTEXT_PATTERN =
  /^v2\.telebirr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$/u;
const MASK_PATTERN = /^\*\*\*[A-Z0-9]{4}$/u;
const MAX_CANONICAL_DEPTH = 12;
const MAX_CANONICAL_NODES = 512;

const disabledCapabilities = Object.freeze({
  advisoryOnly: true as const,
  sqlAuthorizationAllowed: false as const,
  transportAllowed: false as const,
  networkAllowed: false as const,
  databaseReadAllowed: false as const,
  databaseWriteAllowed: false as const,
  persistenceAllowed: false as const,
  claimAllowed: false as const,
  settlementAllowed: false as const,
  enqueueAllowed: false as const,
  executionAllowed: false as const,
  financialActionAllowed: false as const,
  blindRetryAllowed: false as const,
});

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }
  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function parsePattern(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function parseNullableVersion(value: unknown): string | null | undefined {
  return value === null ? null : parsePattern(value, VERSION_PATTERN);
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function canonicalJson(value: unknown): string | undefined {
  const seen = new Set<object>();
  const budget = { nodes: 0 };

  function encode(candidate: unknown, depth: number): string | undefined {
    budget.nodes += 1;
    if (depth > MAX_CANONICAL_DEPTH || budget.nodes > MAX_CANONICAL_NODES) return undefined;
    if (candidate === null) return 'n';
    if (typeof candidate === 'boolean') return candidate ? 'b1' : 'b0';
    if (typeof candidate === 'string') {
      const encoded = JSON.stringify(candidate);
      return `s${Buffer.byteLength(candidate, 'utf8')}:${encoded}`;
    }
    if (typeof candidate === 'number') {
      return Number.isSafeInteger(candidate) && !Object.is(candidate, -0)
        ? `i${String(candidate)}`
        : undefined;
    }
    if (typeof candidate !== 'object' || isProxy(candidate)) return undefined;
    if (seen.has(candidate)) return undefined;
    seen.add(candidate);

    try {
      if (Array.isArray(candidate)) {
        const keys = Reflect.ownKeys(candidate);
        if (
          keys.some(
            (key) =>
              typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)),
          ) ||
          candidate.length > MAX_CANONICAL_NODES
        ) {
          return undefined;
        }
        const entries: string[] = [];
        for (let index = 0; index < candidate.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (
            !descriptor ||
            descriptor.enumerable !== true ||
            !Object.hasOwn(descriptor, 'value')
          ) {
            return undefined;
          }
          const entry = encode(descriptor.value, depth + 1);
          if (entry === undefined) return undefined;
          entries.push(entry);
        }
        return `a${candidate.length}[${entries.join('')}]`;
      }

      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) return undefined;
      const keys = Reflect.ownKeys(candidate);
      if (keys.length > 64 || keys.some((key) => typeof key !== 'string')) {
        return undefined;
      }
      const sortedKeys = (keys as string[]).sort();
      const entries: string[] = [];
      for (const key of sortedKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
          return undefined;
        }
        const encodedValue = encode(descriptor.value, depth + 1);
        if (encodedValue === undefined) return undefined;
        entries.push(`k${Buffer.byteLength(key, 'utf8')}:${JSON.stringify(key)}${encodedValue}`);
      }
      return `o${sortedKeys.length}{${entries.join('')}}`;
    } finally {
      seen.delete(candidate);
    }
  }

  try {
    return encode(value, 0);
  } catch {
    return undefined;
  }
}

function digestCanonical(domain: string, value: unknown): string | undefined {
  const canonical = canonicalJson(value);
  return canonical === undefined
    ? undefined
    : `sha256:${createHash('sha256').update(domain, 'utf8').update('\0').update(canonical, 'utf8').digest('hex')}`;
}

/** Derives a deterministic digest only for the exact assessment policy-fact shape. */
export function deriveTelebirrLivePilotPolicyDigest(policyCandidate: unknown): string | undefined {
  if (
    !isPlainNonProxyRecord(policyCandidate) ||
    !hasExactEnumerableDataKeys(policyCandidate, policyFactKeys)
  ) {
    return undefined;
  }

  // `checkedAt` is dynamic assessment evidence and is already bound (with the full policy fact)
  // by the independently captured database-snapshot digest. This digest is the immutable policy
  // binding provisioned in SQL receiver profiles, so hash only the exact static policy material.
  return digestCanonical(TELEBIRR_LIVE_PILOT_POLICY_DIGEST_PROFILE, {
    acceptedAdapterVersion: ownDataValue(policyCandidate, 'acceptedAdapterVersion'),
    acceptedNormalizerVersion: ownDataValue(policyCandidate, 'acceptedNormalizerVersion'),
    acceptedParserVersion: ownDataValue(policyCandidate, 'acceptedParserVersion'),
    acceptedSource: ownDataValue(policyCandidate, 'acceptedSource'),
    acceptedSourceProfile: ownDataValue(policyCandidate, 'acceptedSourceProfile'),
    allowedTransactionType: ownDataValue(policyCandidate, 'allowedTransactionType'),
    automaticFreshnessSeconds: ownDataValue(policyCandidate, 'automaticFreshnessSeconds'),
    currencyCode: ownDataValue(policyCandidate, 'currencyCode'),
    maximumFutureSkewSeconds: ownDataValue(policyCandidate, 'maximumFutureSkewSeconds'),
    maximumPrincipalAmountMinor: ownDataValue(policyCandidate, 'maximumPrincipalAmountMinor'),
    minimumPrincipalAmountMinor: ownDataValue(policyCandidate, 'minimumPrincipalAmountMinor'),
    policyVersion: ownDataValue(policyCandidate, 'policyVersion'),
    providerCode: ownDataValue(policyCandidate, 'providerCode'),
    state: ownDataValue(policyCandidate, 'state'),
  });
}

function parseDatabaseAuthority(
  candidate: unknown,
): TelebirrLivePilotDatabaseAuthorityFacts | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, databaseAuthorityKeys)
  ) {
    return undefined;
  }
  const submittingCustomerId = parsePattern(
    ownDataValue(candidate, 'submittingCustomerId'),
    UUID_PATTERN,
  );
  const ownerCustomerId = parsePattern(ownDataValue(candidate, 'ownerCustomerId'), UUID_PATTERN);
  const playerAccountId = parsePattern(ownDataValue(candidate, 'playerAccountId'), UUID_PATTERN);
  const submittingCustomerMembershipState = ownDataValue(
    candidate,
    'submittingCustomerMembershipState',
  );
  const submittingCustomerCurrentState = ownDataValue(candidate, 'submittingCustomerCurrentState');
  const submittingCustomerSnapshotState = ownDataValue(
    candidate,
    'submittingCustomerSnapshotState',
  );
  const playerMembershipState = ownDataValue(candidate, 'playerMembershipState');
  const ownerCustomerBindingState = ownDataValue(candidate, 'ownerCustomerBindingState');
  const ownerCustomerCurrentState = ownDataValue(candidate, 'ownerCustomerCurrentState');
  const ownerCustomerSnapshotState = ownDataValue(candidate, 'ownerCustomerSnapshotState');
  if (
    !submittingCustomerId ||
    !ownerCustomerId ||
    !playerAccountId ||
    (submittingCustomerMembershipState !== 'included' &&
      submittingCustomerMembershipState !== 'excluded') ||
    (submittingCustomerCurrentState !== 'active' &&
      submittingCustomerCurrentState !== 'inactive' &&
      submittingCustomerCurrentState !== 'unavailable') ||
    (submittingCustomerSnapshotState !== 'exact' &&
      submittingCustomerSnapshotState !== 'stale' &&
      submittingCustomerSnapshotState !== 'unavailable') ||
    (playerMembershipState !== 'included' && playerMembershipState !== 'excluded') ||
    (ownerCustomerBindingState !== 'exact' &&
      ownerCustomerBindingState !== 'mismatched' &&
      ownerCustomerBindingState !== 'unavailable') ||
    (ownerCustomerCurrentState !== 'active' &&
      ownerCustomerCurrentState !== 'inactive' &&
      ownerCustomerCurrentState !== 'unavailable') ||
    (ownerCustomerSnapshotState !== 'exact' &&
      ownerCustomerSnapshotState !== 'stale' &&
      ownerCustomerSnapshotState !== 'unavailable')
  ) {
    return undefined;
  }
  return Object.freeze({
    submittingCustomerId,
    submittingCustomerMembershipState,
    submittingCustomerCurrentState,
    submittingCustomerSnapshotState,
    ownerCustomerId,
    playerAccountId,
    playerMembershipState,
    ownerCustomerBindingState,
    ownerCustomerCurrentState,
    ownerCustomerSnapshotState,
  });
}

/** Derives the digest of the independently captured exact database snapshot material. */
export function deriveTelebirrLivePilotDatabaseSnapshotDigest(
  snapshotCandidate: unknown,
): string | undefined {
  if (
    !isPlainNonProxyRecord(snapshotCandidate) ||
    !hasExactEnumerableDataKeys(snapshotCandidate, databaseSnapshotMaterialKeys)
  ) {
    return undefined;
  }
  const snapshotId = parsePattern(ownDataValue(snapshotCandidate, 'snapshotId'), UUID_PATTERN);
  const capturedAt = parseTimestamp(ownDataValue(snapshotCandidate, 'capturedAt'));
  const authority = parseDatabaseAuthority(ownDataValue(snapshotCandidate, 'authority'));
  const facts = ownDataValue(snapshotCandidate, 'facts');
  if (
    !snapshotId ||
    !capturedAt ||
    !authority ||
    !isPlainNonProxyRecord(facts) ||
    !hasExactEnumerableDataKeys(facts, databaseFactsKeys)
  ) {
    return undefined;
  }
  return digestCanonical(TELEBIRR_LIVE_PILOT_DATABASE_SNAPSHOT_DIGEST_PROFILE, {
    snapshotId,
    capturedAt,
    authority,
    facts,
  });
}

function parseRequest(
  candidate: unknown,
): TelebirrLivePilotOutcomeTrustedRequestBinding | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, requestKeys)) {
    return undefined;
  }
  const proofRequestId = parsePattern(ownDataValue(candidate, 'proofRequestId'), UUID_PATTERN);
  const submittingCustomerId = parsePattern(
    ownDataValue(candidate, 'submittingCustomerId'),
    UUID_PATTERN,
  );
  const submittingCustomerMembershipState = ownDataValue(
    candidate,
    'submittingCustomerMembershipState',
  );
  const submittingCustomerCurrentState = ownDataValue(candidate, 'submittingCustomerCurrentState');
  const submittingCustomerSnapshotState = ownDataValue(
    candidate,
    'submittingCustomerSnapshotState',
  );
  const playerAccountId = parsePattern(ownDataValue(candidate, 'playerAccountId'), UUID_PATTERN);
  const selectedPlayerId = parsePattern(
    ownDataValue(candidate, 'selectedPlayerId'),
    PLAYER_ID_PATTERN,
  );
  const referenceFingerprint = parsePattern(
    ownDataValue(candidate, 'referenceFingerprint'),
    FINGERPRINT_PATTERN,
  );
  const submittedAt = parseTimestamp(ownDataValue(candidate, 'submittedAt'));
  const pilotRevisionId = parsePattern(ownDataValue(candidate, 'pilotRevisionId'), UUID_PATTERN);
  const pilotConfigurationDigest = parsePattern(
    ownDataValue(candidate, 'pilotConfigurationDigest'),
    SHA256_PATTERN,
  );
  const receiverRevisionId = parsePattern(
    ownDataValue(candidate, 'receiverRevisionId'),
    UUID_PATTERN,
  );
  const policyVersion = parsePattern(ownDataValue(candidate, 'policyVersion'), VERSION_PATTERN);
  const databaseSnapshotId = parsePattern(
    ownDataValue(candidate, 'databaseSnapshotId'),
    UUID_PATTERN,
  );
  if (
    !proofRequestId ||
    !submittingCustomerId ||
    (submittingCustomerMembershipState !== 'included' &&
      submittingCustomerMembershipState !== 'excluded') ||
    (submittingCustomerCurrentState !== 'active' &&
      submittingCustomerCurrentState !== 'inactive' &&
      submittingCustomerCurrentState !== 'unavailable') ||
    (submittingCustomerSnapshotState !== 'exact' &&
      submittingCustomerSnapshotState !== 'stale' &&
      submittingCustomerSnapshotState !== 'unavailable') ||
    !playerAccountId ||
    !selectedPlayerId ||
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    !referenceFingerprint ||
    !submittedAt ||
    !pilotRevisionId ||
    !pilotConfigurationDigest ||
    !receiverRevisionId ||
    !policyVersion ||
    !databaseSnapshotId
  ) {
    return undefined;
  }
  return Object.freeze({
    proofRequestId,
    submittingCustomerId,
    submittingCustomerMembershipState,
    submittingCustomerCurrentState,
    submittingCustomerSnapshotState,
    playerAccountId,
    selectedPlayerId,
    providerCode: 'telebirr',
    referenceFingerprint,
    submittedAt,
    pilotRevisionId,
    pilotConfigurationDigest,
    receiverRevisionId,
    policyVersion,
    databaseSnapshotId,
  });
}

function parsePilot(candidate: unknown): TelebirrLivePilotOutcomeTrustedPilotBinding | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, pilotKeys)) {
    return undefined;
  }
  const revisionId = parsePattern(ownDataValue(candidate, 'revisionId'), UUID_PATTERN);
  const configurationDigest = parsePattern(
    ownDataValue(candidate, 'configurationDigest'),
    SHA256_PATTERN,
  );
  const state = ownDataValue(candidate, 'state');
  const validFrom = parseTimestamp(ownDataValue(candidate, 'validFrom'));
  const validUntil = parseTimestamp(ownDataValue(candidate, 'validUntil'));
  if (
    ownDataValue(candidate, 'contractVersion') !== 1 ||
    !revisionId ||
    !configurationDigest ||
    (state !== 'armed' && state !== 'stopped') ||
    !validFrom ||
    !validUntil ||
    validFrom >= validUntil
  ) {
    return undefined;
  }
  return Object.freeze({
    contractVersion: 1,
    revisionId,
    configurationDigest,
    state,
    validFrom,
    validUntil,
  });
}

function parsePlayer(candidate: unknown): TelebirrLivePilotOutcomeTrustedPlayerBinding | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, playerKeys)) {
    return undefined;
  }
  const ownerCustomerId = parsePattern(ownDataValue(candidate, 'ownerCustomerId'), UUID_PATTERN);
  const playerMembershipState = ownDataValue(candidate, 'playerMembershipState');
  const ownerCustomerBindingState = ownDataValue(candidate, 'ownerCustomerBindingState');
  const ownerCustomerCurrentState = ownDataValue(candidate, 'ownerCustomerCurrentState');
  const ownerCustomerSnapshotState = ownDataValue(candidate, 'ownerCustomerSnapshotState');
  const playerAccountId = parsePattern(ownDataValue(candidate, 'playerAccountId'), UUID_PATTERN);
  const selectedPlayerId = parsePattern(
    ownDataValue(candidate, 'selectedPlayerId'),
    PLAYER_ID_PATTERN,
  );
  const eligibilityState = ownDataValue(candidate, 'eligibilityState');
  const eligibilityDecisionVersion = parseNullableVersion(
    ownDataValue(candidate, 'eligibilityDecisionVersion'),
  );
  if (
    !ownerCustomerId ||
    (playerMembershipState !== 'included' && playerMembershipState !== 'excluded') ||
    (ownerCustomerBindingState !== 'exact' &&
      ownerCustomerBindingState !== 'mismatched' &&
      ownerCustomerBindingState !== 'unavailable') ||
    (ownerCustomerCurrentState !== 'active' &&
      ownerCustomerCurrentState !== 'inactive' &&
      ownerCustomerCurrentState !== 'unavailable') ||
    (ownerCustomerSnapshotState !== 'exact' &&
      ownerCustomerSnapshotState !== 'stale' &&
      ownerCustomerSnapshotState !== 'unavailable') ||
    !playerAccountId ||
    !selectedPlayerId ||
    (eligibilityState !== 'eligible' &&
      eligibilityState !== 'ineligible' &&
      eligibilityState !== 'unavailable' &&
      eligibilityState !== 'ambiguous') ||
    eligibilityDecisionVersion === undefined ||
    (eligibilityState === 'eligible' || eligibilityState === 'ineligible') !==
      (eligibilityDecisionVersion !== null)
  ) {
    return undefined;
  }
  return Object.freeze({
    ownerCustomerId,
    playerMembershipState,
    ownerCustomerBindingState,
    ownerCustomerCurrentState,
    ownerCustomerSnapshotState,
    playerAccountId,
    selectedPlayerId,
    eligibilityState,
    eligibilityDecisionVersion,
  });
}

function parseProvider(
  candidate: unknown,
): TelebirrLivePilotOutcomeTrustedProviderBinding | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, providerKeys)) {
    return undefined;
  }
  const state = ownDataValue(candidate, 'state');
  if (
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    (state !== 'active' && state !== 'inactive') ||
    ownDataValue(candidate, 'source') !== 'telebirr_official_receipt' ||
    ownDataValue(candidate, 'sourceProfile') !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
    ownDataValue(candidate, 'adapterVersion') !== TELEBIRR_LIVE_PILOT_ADAPTER_VERSION ||
    ownDataValue(candidate, 'parserVersion') !== TELEBIRR_LIVE_PILOT_PARSER_VERSION ||
    ownDataValue(candidate, 'normalizerVersion') !== TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION
  ) {
    return undefined;
  }
  return Object.freeze({
    providerCode: 'telebirr',
    state,
    source: 'telebirr_official_receipt',
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    normalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  });
}

function parseReference(
  candidate: unknown,
): TelebirrLivePilotOutcomeTrustedReferenceBinding | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, referenceKeys)) {
    return undefined;
  }
  const ciphertext = parsePattern(ownDataValue(candidate, 'ciphertext'), CIPHERTEXT_PATTERN);
  const fingerprint = parsePattern(ownDataValue(candidate, 'fingerprint'), FINGERPRINT_PATTERN);
  const masked = parsePattern(ownDataValue(candidate, 'masked'), MASK_PATTERN);
  if (
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    ownDataValue(candidate, 'protectionProfileVersion') !==
      AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_PROTECTION_PROFILE_VERSION ||
    ownDataValue(candidate, 'encryptionKeyVersion') !==
      AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_KEY_VERSION ||
    !ciphertext ||
    !fingerprint ||
    !masked
  ) {
    return undefined;
  }
  return Object.freeze({
    providerCode: 'telebirr',
    protectionProfileVersion: 2,
    encryptionKeyVersion: 2,
    ciphertext,
    fingerprint,
    masked,
  });
}

function parseReceiver(
  candidate: unknown,
): TelebirrLivePilotOutcomeTrustedReceiverBinding | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, receiverKeys)) {
    return undefined;
  }
  const revisionId = parsePattern(ownDataValue(candidate, 'revisionId'), UUID_PATTERN);
  const revisionVersionValue = ownDataValue(candidate, 'revisionVersion');
  const profileId = parsePattern(ownDataValue(candidate, 'profileId'), UUID_PATTERN);
  const profileDigest = parsePattern(ownDataValue(candidate, 'profileDigest'), SHA256_PATTERN);
  const configurationDigest = parsePattern(
    ownDataValue(candidate, 'configurationDigest'),
    SHA256_PATTERN,
  );
  const identityDigest = parsePattern(ownDataValue(candidate, 'identityDigest'), SHA256_PATTERN);
  const expectedReceiverNameDigest = parsePattern(
    ownDataValue(candidate, 'expectedReceiverNameDigest'),
    SHA256_PATTERN,
  );
  if (
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    !revisionId ||
    !Number.isSafeInteger(revisionVersionValue) ||
    (revisionVersionValue as number) < 1 ||
    !profileId ||
    !profileDigest ||
    !configurationDigest ||
    !identityDigest ||
    !expectedReceiverNameDigest ||
    ownDataValue(candidate, 'matchBasis') !== 'exact_full_name'
  ) {
    return undefined;
  }
  return Object.freeze({
    providerCode: 'telebirr',
    revisionId,
    revisionVersion: revisionVersionValue as number,
    profileId,
    profileDigest,
    configurationDigest,
    identityDigest,
    expectedReceiverNameDigest,
    matchBasis: 'exact_full_name',
  });
}

function parsePolicyBinding(
  candidate: unknown,
): TelebirrLivePilotOutcomeTrustedPolicyBinding | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, policyBindingKeys)
  ) {
    return undefined;
  }
  const policyVersion = parsePattern(ownDataValue(candidate, 'policyVersion'), VERSION_PATTERN);
  const policyDigest = parsePattern(ownDataValue(candidate, 'policyDigest'), SHA256_PATTERN);
  return ownDataValue(candidate, 'providerCode') === 'telebirr' && policyVersion && policyDigest
    ? Object.freeze({ providerCode: 'telebirr' as const, policyVersion, policyDigest })
    : undefined;
}

function parseDatabaseSnapshot(
  candidate: unknown,
): TelebirrLivePilotOutcomeTrustedDatabaseSnapshot | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, databaseSnapshotKeys)
  ) {
    return undefined;
  }
  const snapshotId = parsePattern(ownDataValue(candidate, 'snapshotId'), UUID_PATTERN);
  const capturedAt = parseTimestamp(ownDataValue(candidate, 'capturedAt'));
  const authority = parseDatabaseAuthority(ownDataValue(candidate, 'authority'));
  const facts = ownDataValue(candidate, 'facts');
  const snapshotDigest = parsePattern(ownDataValue(candidate, 'snapshotDigest'), SHA256_PATTERN);
  if (
    !snapshotId ||
    !capturedAt ||
    !authority ||
    !isPlainNonProxyRecord(facts) ||
    !hasExactEnumerableDataKeys(facts, databaseFactsKeys) ||
    !snapshotDigest
  ) {
    return undefined;
  }
  return Object.freeze({
    snapshotId,
    capturedAt,
    authority,
    facts: facts as unknown as DepositProofAssessmentDatabaseFacts,
    snapshotDigest,
  });
}

function parseInput(candidate: unknown): ParsedInput | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, inputKeys)) {
    return undefined;
  }
  const assessedAt = parseTimestamp(ownDataValue(candidate, 'assessedAt'));
  const request = parseRequest(ownDataValue(candidate, 'trustedRequest'));
  const pilot = parsePilot(ownDataValue(candidate, 'trustedPilot'));
  const player = parsePlayer(ownDataValue(candidate, 'trustedPlayer'));
  const provider = parseProvider(ownDataValue(candidate, 'trustedProvider'));
  const reference = parseReference(ownDataValue(candidate, 'trustedReference'));
  const receiver = parseReceiver(ownDataValue(candidate, 'trustedReceiver'));
  const policy = parsePolicyBinding(ownDataValue(candidate, 'trustedPolicy'));
  const databaseSnapshot = parseDatabaseSnapshot(
    ownDataValue(candidate, 'trustedDatabaseSnapshot'),
  );
  const verificationInput = ownDataValue(candidate, 'verificationInput');
  if (
    ownDataValue(candidate, 'contractVersion') !==
      TELEBIRR_LIVE_PILOT_OUTCOME_ADAPTER_CONTRACT_VERSION ||
    ownDataValue(candidate, 'providerCode') !== 'telebirr' ||
    ownDataValue(candidate, 'protocolMode') !== TELEBIRR_LIVE_PILOT_PROTOCOL_MODE ||
    !assessedAt ||
    !request ||
    !pilot ||
    !player ||
    !provider ||
    !reference ||
    !receiver ||
    !policy ||
    !databaseSnapshot ||
    verificationInput === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    assessedAt,
    request,
    pilot,
    player,
    provider,
    reference,
    receiver,
    policy,
    databaseSnapshot,
    verificationInput,
  });
}

function copySpki(candidate: unknown): Uint8Array | undefined {
  try {
    return candidate instanceof Uint8Array && !isProxy(candidate) && candidate.byteLength <= 512
      ? Uint8Array.from(candidate)
      : undefined;
  } catch {
    return undefined;
  }
}

function noReceiptObservation(
  lookupOutcome: 'unavailable' | 'ambiguous',
  provenanceState: 'parser_uncertain' | 'source_uncertain',
  retrievedAt: string,
  evidenceDigest: string,
): OfficialDepositProofObservation {
  return Object.freeze({
    observationVersion: 1,
    providerCode: 'telebirr',
    lookupOutcome,
    provenanceState,
    canonicalReferenceFingerprint: null,
    receiptStatus: null,
    transactionType: null,
    principalAmountMinor: null,
    currencyCode: null,
    occurredAt: null,
    retrievedAt,
    receiver: null,
    evidenceDigest,
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    normalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    source: 'telebirr_official_receipt',
  });
}

function differentFingerprint(fingerprint: string): string {
  return fingerprint === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
}

function foundObservation(
  facts: TelebirrLivePilotFoundFacts,
  requestFingerprint: string,
  evidenceDigest: string,
  fallbackRetrievedAt: string,
): OfficialDepositProofObservation {
  if (
    !facts.canonicalReferencePresent ||
    facts.referenceMatch === 'unknown' ||
    facts.receiverMatch === 'unknown' ||
    facts.creditedPartyNameDigest === null ||
    facts.amountMinor === null ||
    !Number.isSafeInteger(facts.amountMinor) ||
    facts.amountMinor <= 0 ||
    facts.currencyCode === 'unknown' ||
    facts.occurredAt === null
  ) {
    return noReceiptObservation(
      'ambiguous',
      facts.currencyCode === 'unknown' ? 'source_uncertain' : 'parser_uncertain',
      facts.retrievedAt || fallbackRetrievedAt,
      evidenceDigest,
    );
  }
  const receiptStatus =
    facts.providerFinalStatus === 'reversed' ? 'unknown' : facts.providerFinalStatus;
  const transactionType =
    facts.paymentMode === 'telebirr' &&
    facts.paymentReason === 'send_money_to_registered_customer' &&
    facts.paymentChannel === 'api_app'
      ? 'send_money'
      : facts.paymentMode === 'unknown' ||
          facts.paymentReason === 'unknown' ||
          facts.paymentChannel === 'unknown'
        ? 'unknown'
        : 'unsupported';
  return Object.freeze({
    observationVersion: 1,
    providerCode: 'telebirr',
    lookupOutcome: 'found',
    provenanceState: 'exact',
    canonicalReferenceFingerprint:
      facts.referenceMatch === 'matched'
        ? requestFingerprint
        : differentFingerprint(requestFingerprint),
    receiptStatus,
    transactionType,
    principalAmountMinor: String(facts.amountMinor),
    currencyCode: 'ETB',
    occurredAt: facts.occurredAt,
    retrievedAt: facts.retrievedAt,
    receiver: Object.freeze({
      identityDigest: facts.creditedPartyNameDigest,
      matchBasis: 'exact_full_name' as const,
    }),
    evidenceDigest,
    adapterVersion: TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
    parserVersion: TELEBIRR_LIVE_PILOT_PARSER_VERSION,
    normalizerVersion: TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
    sourceProfile: TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
    source: 'telebirr_official_receipt',
  });
}

function observationFromSignedFacts(
  facts: TelebirrLivePilotReceiptFacts,
  requestFingerprint: string,
  evidenceDigest: string,
  observedAt: string,
): OfficialDepositProofObservation {
  if (facts.lookupOutcome === 'found') {
    return foundObservation(facts, requestFingerprint, evidenceDigest, observedAt);
  }
  const sourceUnavailable =
    facts.reviewReason === 'provider_unavailable' ||
    facts.reviewReason === 'network_unavailable' ||
    facts.reviewReason === 'device_error';
  const sourceUncertain = facts.reviewReason === 'provider_not_found_unattested';
  return noReceiptObservation(
    sourceUnavailable ? 'unavailable' : 'ambiguous',
    sourceUncertain || sourceUnavailable ? 'source_uncertain' : 'parser_uncertain',
    facts.retrievedAt ?? observedAt,
    evidenceDigest,
  );
}

function protocolReviewReason(
  reason: TelebirrLivePilotVerificationReason,
  facts: TelebirrLivePilotReceiptFacts,
): AuthoritativeDepositProofOutcomeReasonCode {
  if (reason === 'receipt_requires_review' && facts.lookupOutcome === 'review_required') {
    if (
      facts.reviewReason === 'provider_unavailable' ||
      facts.reviewReason === 'network_unavailable' ||
      facts.reviewReason === 'device_error'
    ) {
      return 'source_unavailable';
    }
    if (facts.reviewReason === 'provider_not_found_unattested') return 'source_uncertain';
    return 'parser_uncertain';
  }
  if (reason === 'provider_status_not_completed' && facts.lookupOutcome === 'found') {
    if (facts.providerFinalStatus === 'failed') return 'receipt_failed';
    if (facts.providerFinalStatus === 'pending') return 'receipt_pending';
    return 'receipt_status_unknown';
  }
  if (reason === 'reference_mismatch' && facts.lookupOutcome === 'found') {
    return facts.referenceMatch === 'mismatched' ? 'reference_mismatch' : 'source_uncertain';
  }
  if (reason === 'receiver_mismatch' && facts.lookupOutcome === 'found') {
    return facts.receiverMatch === 'mismatched' ? 'receiver_mismatch' : 'source_uncertain';
  }
  if (reason === 'receipt_semantics_incomplete' && facts.lookupOutcome === 'found') {
    if (facts.providerFinalStatus === 'failed') return 'receipt_failed';
    if (facts.providerFinalStatus === 'pending') return 'receipt_pending';
    if (
      facts.paymentMode !== 'telebirr' ||
      facts.paymentReason !== 'send_money_to_registered_customer' ||
      facts.paymentChannel !== 'api_app'
    ) {
      return 'transaction_type_unsupported';
    }
    return facts.currencyCode === 'unknown' ? 'source_uncertain' : 'parser_uncertain';
  }
  if (
    reason === 'binding_mismatch' ||
    reason === 'reference_binding_mismatch' ||
    reason === 'receiver_binding_mismatch'
  ) {
    return 'database_facts_unbound';
  }
  if (reason === 'source_profile_mismatch' || reason === 'version_mismatch') {
    return 'observation_version_unsupported';
  }
  if (
    reason === 'facts_digest_mismatch' ||
    reason === 'assignment_body_digest_mismatch' ||
    reason === 'observation_body_digest_mismatch'
  ) {
    return 'parser_uncertain';
  }
  if (reason === 'replay_detected') return 'duplicate_check_ambiguous';
  return 'source_uncertain';
}

function factRecord(candidate: unknown): UnknownRecord | undefined {
  return isPlainNonProxyRecord(candidate) ? candidate : undefined;
}

function bindingsMatch(
  input: ParsedInput,
  verificationAssessedAt: unknown,
  protocolRequest: ReturnType<typeof decodeTelebirrLivePilotTrustedRequestBinding>,
  assignment: NonNullable<ReturnType<typeof decodeTelebirrLivePilotSignedAssignment>>,
  observation: NonNullable<ReturnType<typeof decodeTelebirrLivePilotSignedObservation>>,
): boolean {
  const facts = factRecord(input.databaseSnapshot.facts);
  const currentPolicy = facts && factRecord(ownDataValue(facts, 'currentPolicy'));
  const currentEligibility = facts && factRecord(ownDataValue(facts, 'currentEligibility'));
  const receiverFact = facts && factRecord(ownDataValue(facts, 'receiverAtOccurredAt'));
  const authority = input.databaseSnapshot.authority;
  const policyDigest = currentPolicy && deriveTelebirrLivePilotPolicyDigest(currentPolicy);
  const snapshotDigest = deriveTelebirrLivePilotDatabaseSnapshotDigest({
    snapshotId: input.databaseSnapshot.snapshotId,
    capturedAt: input.databaseSnapshot.capturedAt,
    authority: input.databaseSnapshot.authority,
    facts: input.databaseSnapshot.facts,
  });
  const rawReference = assignment.body.rawReference;
  const expectedMask = `***${rawReference.slice(-4)}`;
  const assessedAtMs = Date.parse(input.assessedAt);

  return Boolean(
    protocolRequest &&
    verificationAssessedAt === input.assessedAt &&
    protocolRequest.requestId === input.request.proofRequestId &&
    protocolRequest.pilotRevisionId === input.request.pilotRevisionId &&
    protocolRequest.referenceFingerprint === `hmac-sha256:${input.request.referenceFingerprint}` &&
    protocolRequest.receiverRevisionId === input.request.receiverRevisionId &&
    authority.submittingCustomerId === input.request.submittingCustomerId &&
    authority.submittingCustomerMembershipState ===
      input.request.submittingCustomerMembershipState &&
    authority.submittingCustomerCurrentState === input.request.submittingCustomerCurrentState &&
    authority.submittingCustomerSnapshotState === input.request.submittingCustomerSnapshotState &&
    authority.ownerCustomerId === input.player.ownerCustomerId &&
    authority.playerAccountId === input.player.playerAccountId &&
    authority.playerMembershipState === input.player.playerMembershipState &&
    authority.ownerCustomerBindingState === input.player.ownerCustomerBindingState &&
    authority.ownerCustomerCurrentState === input.player.ownerCustomerCurrentState &&
    authority.ownerCustomerSnapshotState === input.player.ownerCustomerSnapshotState &&
    input.request.submittingCustomerMembershipState === 'included' &&
    input.request.submittingCustomerCurrentState === 'active' &&
    input.request.submittingCustomerSnapshotState === 'exact' &&
    input.player.playerMembershipState === 'included' &&
    input.player.ownerCustomerBindingState === 'exact' &&
    input.player.ownerCustomerCurrentState === 'active' &&
    input.player.ownerCustomerSnapshotState === 'exact' &&
    input.request.playerAccountId === input.player.playerAccountId &&
    input.request.selectedPlayerId === input.player.selectedPlayerId &&
    input.request.pilotRevisionId === input.pilot.revisionId &&
    input.request.pilotConfigurationDigest === input.pilot.configurationDigest &&
    input.request.referenceFingerprint === input.reference.fingerprint &&
    input.request.receiverRevisionId === input.receiver.revisionId &&
    input.request.policyVersion === input.policy.policyVersion &&
    input.request.databaseSnapshotId === input.databaseSnapshot.snapshotId &&
    input.pilot.state === 'armed' &&
    assessedAtMs >= Date.parse(input.pilot.validFrom) &&
    assessedAtMs < Date.parse(input.pilot.validUntil) &&
    input.provider.state === 'active' &&
    input.reference.masked === expectedMask &&
    input.receiver.revisionId === protocolRequest.receiverRevisionId &&
    input.receiver.profileId === protocolRequest.receiverProfileId &&
    input.receiver.profileDigest === protocolRequest.receiverProfileDigest &&
    input.receiver.configurationDigest === protocolRequest.receiverConfigurationDigest &&
    input.receiver.expectedReceiverNameDigest === protocolRequest.expectedReceiverNameDigest &&
    input.receiver.identityDigest === input.receiver.expectedReceiverNameDigest &&
    assignment.body.pilotRevisionId === input.pilot.revisionId &&
    observation.body.pilotRevisionId === input.pilot.revisionId &&
    input.databaseSnapshot.capturedAt === input.assessedAt &&
    snapshotDigest === input.databaseSnapshot.snapshotDigest &&
    policyDigest === input.policy.policyDigest &&
    currentPolicy &&
    ownDataValue(currentPolicy, 'providerCode') === 'telebirr' &&
    ownDataValue(currentPolicy, 'policyVersion') === input.policy.policyVersion &&
    currentEligibility &&
    ownDataValue(currentEligibility, 'selectedPlayerId') === input.player.selectedPlayerId &&
    ownDataValue(currentEligibility, 'state') === input.player.eligibilityState &&
    ownDataValue(currentEligibility, 'decisionVersion') ===
      input.player.eligibilityDecisionVersion &&
    (!receiverFact ||
      ownDataValue(receiverFact, 'state') !== 'exact' ||
      (ownDataValue(receiverFact, 'providerCode') === 'telebirr' &&
        ownDataValue(receiverFact, 'revisionId') === input.receiver.revisionId &&
        ownDataValue(receiverFact, 'identityDigest') === input.receiver.identityDigest &&
        ownDataValue(receiverFact, 'matchBasis') === 'exact_full_name')),
  );
}

function assessmentInput(
  input: ParsedInput,
  officialObservation: OfficialDepositProofObservation,
): DepositProofAssessmentInput {
  return {
    contractVersion: DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION,
    assessedAt: input.assessedAt,
    proofRequest: {
      proofRequestId: input.request.proofRequestId,
      providerCode: 'telebirr',
      referenceFingerprint: input.request.referenceFingerprint,
      referenceKeyVersion: DEPOSIT_PROOF_REFERENCE_KEY_VERSION,
      referenceProfileVersion: DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION,
      selectedPlayerId: input.request.selectedPlayerId,
      submittedAt: input.request.submittedAt,
    },
    officialObservation,
    databaseFacts: input.databaseSnapshot.facts,
  };
}

function outcomeReasonForAssessment(
  decision: DepositProofAssessmentDecision,
): AuthoritativeDepositProofOutcomeReasonCode {
  return decision.reasonCode;
}

function makeOutcome(
  input: ParsedInput,
  officialObservation: OfficialDepositProofObservation,
  assessmentDigest: string,
  disposition: 'settlement_candidate' | 'definite_reject' | 'review_required',
  reasonCode: AuthoritativeDepositProofOutcomeReasonCode,
): AuthoritativeDepositProofOutcomeCandidate | undefined {
  const common = {
    contractVersion: AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION,
    proofRequestId: input.request.proofRequestId,
    providerCode: 'telebirr' as const,
    assessmentContractVersion: DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION,
    assessmentInputDigest: assessmentDigest,
    assessedAt: input.assessedAt,
    source: 'telebirr_official_receipt' as const,
    sourceProfile: input.provider.sourceProfile,
    observationVersion: 1 as const,
    adapterVersion: input.provider.adapterVersion,
    parserVersion: input.provider.parserVersion,
    normalizerVersion: input.provider.normalizerVersion,
    evidenceDigest: officialObservation.evidenceDigest,
    retrievedAt: officialObservation.retrievedAt,
    ...disabledCapabilities,
  };

  if (disposition === 'settlement_candidate') {
    if (
      reasonCode !== 'exact_proof_match' ||
      officialObservation.lookupOutcome !== 'found' ||
      officialObservation.provenanceState !== 'exact' ||
      officialObservation.receiptStatus !== 'completed' ||
      officialObservation.transactionType !== 'send_money' ||
      officialObservation.principalAmountMinor === null ||
      officialObservation.currencyCode !== 'ETB' ||
      officialObservation.occurredAt === null ||
      officialObservation.receiver?.matchBasis !== 'exact_full_name' ||
      officialObservation.receiver.identityDigest !== input.receiver.identityDigest
    ) {
      return undefined;
    }
    return validatedAuthoritativeDepositProofOutcomeCandidate({
      ...common,
      disposition: 'settlement_candidate',
      reasonCode: 'exact_proof_match',
      lookupOutcome: 'found',
      provenanceState: 'exact',
      receiptStatus: 'completed',
      transactionType: 'send_money',
      principalAmountMinor: officialObservation.principalAmountMinor,
      currencyCode: 'ETB',
      occurredAt: officialObservation.occurredAt,
      receiverRevisionId: input.receiver.revisionId,
      receiverRevisionVersion: input.receiver.revisionVersion,
      receiverIdentityDigest: input.receiver.identityDigest,
      receiverMatchBasis: 'exact_full_name',
      canonicalReference: {
        protectionProfileVersion: input.reference.protectionProfileVersion,
        encryptionKeyVersion: input.reference.encryptionKeyVersion,
        ciphertext: input.reference.ciphertext,
        fingerprint: input.reference.fingerprint,
        masked: input.reference.masked,
      },
    });
  }

  return validatedAuthoritativeDepositProofOutcomeCandidate({
    ...common,
    disposition,
    reasonCode,
  });
}

function nonSettlementDisposition(
  reasonCode: AuthoritativeDepositProofOutcomeReasonCode,
): 'definite_reject' | 'review_required' {
  return [
    'player_ineligible',
    'duplicate_reference_reused',
    'reference_not_found',
    'provider_mismatch',
    'reference_mismatch',
    'receipt_failed',
    'currency_not_etb',
    'receiver_mismatch',
  ].includes(reasonCode)
    ? 'definite_reject'
    : 'review_required';
}

/**
 * Verifies signed TeleBirr evidence, rebinds every independent trusted snapshot, runs the existing
 * assessment contract, and returns only a revalidated advisory outcome candidate. Structural
 * failure returns `undefined`; callers must route it to review and must never retry blindly.
 */
export function adaptTelebirrLivePilotOutcome(
  inputCandidate: unknown,
  trustedAssignmentSignerSpkiDerCandidate: unknown,
  enrolledDeviceSpkiDerCandidate: unknown,
): AuthoritativeDepositProofOutcomeCandidate | undefined {
  try {
    const input = parseInput(inputCandidate);
    const signerSpki = copySpki(trustedAssignmentSignerSpkiDerCandidate);
    const deviceSpki = copySpki(enrolledDeviceSpkiDerCandidate);
    if (!input || !signerSpki || !deviceSpki) return undefined;

    const verification = verifyTelebirrLivePrivatePilotEvidence(
      input.verificationInput,
      signerSpki,
      deviceSpki,
    );
    if (verification.disposition === 'invalid_request') return undefined;

    const verificationRecord = factRecord(input.verificationInput);
    const protocolRequest =
      verificationRecord &&
      decodeTelebirrLivePilotTrustedRequestBinding(
        ownDataValue(verificationRecord, 'trustedRequestBinding'),
      );
    const assignment =
      verificationRecord &&
      decodeTelebirrLivePilotSignedAssignment(ownDataValue(verificationRecord, 'signedAssignment'));
    const observation =
      verificationRecord &&
      decodeTelebirrLivePilotSignedObservation(
        ownDataValue(verificationRecord, 'signedObservation'),
      );
    if (!verificationRecord || !protocolRequest || !assignment || !observation) return undefined;

    const officialObservation = observationFromSignedFacts(
      observation.body.facts,
      input.request.referenceFingerprint,
      observation.body.sourceDocumentDigest,
      observation.body.observedAt,
    );
    const assessment = assessmentInput(input, officialObservation);
    const assessmentDigest = digestCanonical(
      TELEBIRR_LIVE_PILOT_ASSESSMENT_INPUT_DIGEST_PROFILE,
      assessment,
    );
    if (!assessmentDigest) return undefined;
    const decision = assessOfficialDepositProof(assessment);
    if (decision.reasonCode === 'invalid_assessment_input') {
      return makeOutcome(
        input,
        officialObservation,
        assessmentDigest,
        'review_required',
        'invalid_assessment_input',
      );
    }

    const bindingMatch = bindingsMatch(
      input,
      ownDataValue(verificationRecord, 'assessedAt'),
      protocolRequest,
      assignment,
      observation,
    );
    if (!bindingMatch) {
      return makeOutcome(
        input,
        officialObservation,
        assessmentDigest,
        'review_required',
        'database_facts_unbound',
      );
    }

    if (verification.disposition !== 'would_forward_signed_evidence') {
      const reasonCode = protocolReviewReason(verification.reasonCode, observation.body.facts);
      return makeOutcome(
        input,
        officialObservation,
        assessmentDigest,
        nonSettlementDisposition(reasonCode),
        reasonCode,
      );
    }

    const reasonCode = outcomeReasonForAssessment(decision);
    if (decision.disposition !== 'would_verify') {
      return makeOutcome(
        input,
        officialObservation,
        assessmentDigest,
        decision.disposition === 'would_reject' ? 'definite_reject' : 'review_required',
        reasonCode,
      );
    }

    return makeOutcome(
      input,
      officialObservation,
      assessmentDigest,
      'settlement_candidate',
      'exact_proof_match',
    );
  } catch {
    return undefined;
  }
}

/** Fixed-key safe projection; it cannot expose request/player/pilot/reference/receiver material. */
export function redactedTelebirrLivePilotOutcomeForLog(
  candidate: unknown,
): RedactedAuthoritativeDepositProofOutcomeLogProjection {
  return redactedAuthoritativeDepositProofOutcomeForLog(candidate);
}
