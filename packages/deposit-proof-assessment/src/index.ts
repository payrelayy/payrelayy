import { isProxy } from 'node:util/types';

export const DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION = 1 as const;
export const DEPOSIT_PROOF_REFERENCE_KEY_VERSION = 2 as const;
export const DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION = 2 as const;
export const DEPOSIT_PROOF_MINIMUM_PRINCIPAL_MINOR = '2500' as const;
export const DEPOSIT_PROOF_MAXIMUM_PRINCIPAL_MINOR = '2500000' as const;
export const DEPOSIT_PROOF_AUTOMATIC_FRESHNESS_SECONDS = 3600 as const;
export const DEPOSIT_PROOF_MAXIMUM_FUTURE_SKEW_SECONDS = 300 as const;

export const DEPOSIT_PROOF_ASSESSMENT_PROVIDERS = Object.freeze(['cbe_birr', 'telebirr'] as const);

export type DepositProofAssessmentProvider = (typeof DEPOSIT_PROOF_ASSESSMENT_PROVIDERS)[number];

export type DepositProofAssessmentReasonCode =
  | 'exact_proof_match'
  | 'invalid_assessment_input'
  | 'database_facts_unbound'
  | 'policy_unavailable'
  | 'policy_contract_mismatch'
  | 'eligibility_unavailable'
  | 'eligibility_ambiguous'
  | 'player_ineligible'
  | 'duplicate_reference_reused'
  | 'duplicate_check_unavailable'
  | 'duplicate_check_ambiguous'
  | 'source_unavailable'
  | 'source_ambiguous'
  | 'source_uncertain'
  | 'source_unsupported'
  | 'observation_version_unsupported'
  | 'parser_uncertain'
  | 'reference_not_found'
  | 'provider_mismatch'
  | 'reference_mismatch'
  | 'receipt_failed'
  | 'receipt_pending'
  | 'receipt_status_unknown'
  | 'transaction_type_unsupported'
  | 'currency_not_etb'
  | 'receiver_history_gap'
  | 'receiver_history_overlap'
  | 'receiver_history_unavailable'
  | 'receiver_match_basis_unsupported'
  | 'receiver_mismatch'
  | 'amount_out_of_range'
  | 'receipt_too_old'
  | 'receipt_after_submission'
  | 'future_skew_exceeded';

export type DepositProofAssessmentDisposition = 'would_verify' | 'would_reject' | 'would_review';

interface DisabledAssessmentCapabilities {
  readonly transportAllowed: false;
  readonly networkAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly settlementAllowed: false;
  readonly claimAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly blindRetryAllowed: false;
}

interface DepositProofAssessmentDecisionBase extends DisabledAssessmentCapabilities {
  readonly contractVersion: typeof DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION;
  readonly providerCode: DepositProofAssessmentProvider | 'unknown';
  readonly advisoryOnly: true;
}

export interface DepositProofWouldVerifyDecision extends DepositProofAssessmentDecisionBase {
  readonly disposition: 'would_verify';
  readonly reasonCode: 'exact_proof_match';
}

export interface DepositProofWouldRejectDecision extends DepositProofAssessmentDecisionBase {
  readonly disposition: 'would_reject';
  readonly reasonCode:
    | 'player_ineligible'
    | 'duplicate_reference_reused'
    | 'reference_not_found'
    | 'provider_mismatch'
    | 'reference_mismatch'
    | 'receipt_failed'
    | 'currency_not_etb'
    | 'receiver_mismatch';
}

export interface DepositProofWouldReviewDecision extends DepositProofAssessmentDecisionBase {
  readonly disposition: 'would_review';
  readonly reasonCode: Exclude<
    DepositProofAssessmentReasonCode,
    DepositProofWouldVerifyDecision['reasonCode'] | DepositProofWouldRejectDecision['reasonCode']
  >;
}

export type DepositProofAssessmentDecision =
  | DepositProofWouldVerifyDecision
  | DepositProofWouldRejectDecision
  | DepositProofWouldReviewDecision;

export type RedactedDepositProofAssessmentLogProjection = DepositProofAssessmentDecision;

export interface DepositProofAssessmentRequestBinding {
  readonly proofRequestId: string;
  readonly providerCode: DepositProofAssessmentProvider;
  readonly referenceFingerprint: string;
  readonly referenceKeyVersion: typeof DEPOSIT_PROOF_REFERENCE_KEY_VERSION;
  readonly referenceProfileVersion: typeof DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION;
  readonly selectedPlayerId: string;
  readonly submittedAt: string;
}

export interface OfficialDepositProofReceiverObservation {
  readonly identityDigest: string;
  readonly matchBasis: 'exact_account_identifier' | 'exact_full_name';
}

export interface OfficialDepositProofObservation {
  readonly observationVersion: 1;
  readonly providerCode: DepositProofAssessmentProvider;
  readonly lookupOutcome: 'found' | 'not_found' | 'unavailable' | 'ambiguous';
  readonly provenanceState: 'exact' | 'parser_uncertain' | 'source_uncertain' | 'unsupported';
  readonly canonicalReferenceFingerprint: string | null;
  readonly receiptStatus: 'completed' | 'pending' | 'failed' | 'unknown' | null;
  readonly transactionType: 'send_money' | 'unsupported' | 'unknown' | null;
  readonly principalAmountMinor: string | null;
  readonly currencyCode: string | null;
  readonly occurredAt: string | null;
  readonly retrievedAt: string;
  readonly receiver: OfficialDepositProofReceiverObservation | null;
  readonly evidenceDigest: string;
  readonly adapterVersion: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  readonly sourceProfile: string;
  readonly source: 'cbe_birr_official_receipt' | 'telebirr_official_receipt';
}

export interface DepositProofReceiverRevisionFact {
  readonly state: 'exact' | 'gap' | 'overlap' | 'unavailable';
  readonly providerCode: DepositProofAssessmentProvider;
  readonly resolvedForOccurredAt: string | null;
  readonly revisionId: string | null;
  readonly identityDigest: string | null;
  readonly matchBasis: 'exact_account_identifier' | 'exact_full_name' | null;
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
}

export interface DepositProofCurrentPolicyFact {
  readonly state: 'available' | 'unavailable';
  readonly providerCode: DepositProofAssessmentProvider;
  readonly checkedAt: string;
  readonly policyVersion: string | null;
  readonly currencyCode: 'ETB' | null;
  readonly minimumPrincipalAmountMinor: string | null;
  readonly maximumPrincipalAmountMinor: string | null;
  readonly automaticFreshnessSeconds: number | null;
  readonly maximumFutureSkewSeconds: number | null;
  readonly allowedTransactionType: 'send_money' | null;
  readonly acceptedSource: OfficialDepositProofObservation['source'] | null;
  readonly acceptedSourceProfile: string | null;
  readonly acceptedAdapterVersion: string | null;
  readonly acceptedParserVersion: string | null;
  readonly acceptedNormalizerVersion: string | null;
}

export interface DepositProofCurrentEligibilityFact {
  readonly state: 'eligible' | 'ineligible' | 'unavailable' | 'ambiguous';
  readonly selectedPlayerId: string;
  readonly checkedAt: string;
  readonly decisionVersion: string | null;
}

export interface DepositProofDuplicateStateFact {
  readonly state: 'unused' | 'reused' | 'unavailable' | 'ambiguous';
  readonly providerCode: DepositProofAssessmentProvider;
  readonly canonicalReferenceFingerprint: string;
  readonly checkedAt: string;
}

export interface DepositProofAssessmentDatabaseFacts {
  readonly receiverAtOccurredAt: DepositProofReceiverRevisionFact;
  readonly currentPolicy: DepositProofCurrentPolicyFact;
  readonly currentEligibility: DepositProofCurrentEligibilityFact;
  readonly duplicateState: DepositProofDuplicateStateFact;
}

export interface DepositProofAssessmentInput {
  readonly contractVersion: typeof DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION;
  readonly assessedAt: string;
  readonly proofRequest: DepositProofAssessmentRequestBinding;
  readonly officialObservation: OfficialDepositProofObservation;
  readonly databaseFacts: DepositProofAssessmentDatabaseFacts;
}

type UnknownRecord = Record<string, unknown>;

interface ParsedRequestBinding {
  readonly proofRequestId: string;
  readonly providerCode: DepositProofAssessmentProvider;
  readonly referenceFingerprint: string;
  readonly selectedPlayerId: string;
  readonly submittedAt: string;
}

interface ParsedReceiverObservation {
  readonly identityDigest: string;
  readonly matchBasis: 'exact_account_identifier' | 'exact_full_name';
}

interface ParsedOfficialObservation {
  readonly providerCode: DepositProofAssessmentProvider;
  readonly lookupOutcome: OfficialDepositProofObservation['lookupOutcome'];
  readonly provenanceState: OfficialDepositProofObservation['provenanceState'];
  readonly canonicalReferenceFingerprint: string | null;
  readonly receiptStatus: OfficialDepositProofObservation['receiptStatus'];
  readonly transactionType: OfficialDepositProofObservation['transactionType'];
  readonly principalAmountMinor: string | null;
  readonly currencyCode: string | null;
  readonly occurredAt: string | null;
  readonly retrievedAt: string;
  readonly receiver: ParsedReceiverObservation | null;
  readonly evidenceDigest: string;
  readonly adapterVersion: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  readonly sourceProfile: string;
  readonly source: OfficialDepositProofObservation['source'];
}

interface ParsedReceiverRevisionFact {
  readonly state: DepositProofReceiverRevisionFact['state'];
  readonly providerCode: DepositProofAssessmentProvider;
  readonly resolvedForOccurredAt: string | null;
  readonly revisionId: string | null;
  readonly identityDigest: string | null;
  readonly matchBasis: DepositProofReceiverRevisionFact['matchBasis'];
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
}

interface ParsedCurrentPolicyFact {
  readonly state: DepositProofCurrentPolicyFact['state'];
  readonly providerCode: DepositProofAssessmentProvider;
  readonly checkedAt: string;
  readonly policyVersion: string | null;
  readonly currencyCode: 'ETB' | null;
  readonly minimumPrincipalAmountMinor: string | null;
  readonly maximumPrincipalAmountMinor: string | null;
  readonly automaticFreshnessSeconds: number | null;
  readonly maximumFutureSkewSeconds: number | null;
  readonly allowedTransactionType: 'send_money' | null;
  readonly acceptedSource: OfficialDepositProofObservation['source'] | null;
  readonly acceptedSourceProfile: string | null;
  readonly acceptedAdapterVersion: string | null;
  readonly acceptedParserVersion: string | null;
  readonly acceptedNormalizerVersion: string | null;
}

interface ParsedCurrentEligibilityFact {
  readonly state: DepositProofCurrentEligibilityFact['state'];
  readonly selectedPlayerId: string;
  readonly checkedAt: string;
  readonly decisionVersion: string | null;
}

interface ParsedDuplicateStateFact {
  readonly state: DepositProofDuplicateStateFact['state'];
  readonly providerCode: DepositProofAssessmentProvider;
  readonly canonicalReferenceFingerprint: string;
  readonly checkedAt: string;
}

interface ParsedAssessmentInput {
  readonly assessedAt: string;
  readonly proofRequest: ParsedRequestBinding;
  readonly officialObservation: ParsedOfficialObservation;
  readonly databaseFacts: {
    readonly receiverAtOccurredAt: ParsedReceiverRevisionFact;
    readonly currentPolicy: ParsedCurrentPolicyFact;
    readonly currentEligibility: ParsedCurrentEligibilityFact;
    readonly duplicateState: ParsedDuplicateStateFact;
  };
}

const inputKeys = [
  'contractVersion',
  'assessedAt',
  'proofRequest',
  'officialObservation',
  'databaseFacts',
] as const;
const proofRequestKeys = [
  'proofRequestId',
  'providerCode',
  'referenceFingerprint',
  'referenceKeyVersion',
  'referenceProfileVersion',
  'selectedPlayerId',
  'submittedAt',
] as const;
const observationKeys = [
  'observationVersion',
  'providerCode',
  'lookupOutcome',
  'provenanceState',
  'canonicalReferenceFingerprint',
  'receiptStatus',
  'transactionType',
  'principalAmountMinor',
  'currencyCode',
  'occurredAt',
  'retrievedAt',
  'receiver',
  'evidenceDigest',
  'adapterVersion',
  'parserVersion',
  'normalizerVersion',
  'sourceProfile',
  'source',
] as const;
const receiverObservationKeys = ['identityDigest', 'matchBasis'] as const;
const databaseFactKeys = [
  'receiverAtOccurredAt',
  'currentPolicy',
  'currentEligibility',
  'duplicateState',
] as const;
const receiverRevisionKeys = [
  'state',
  'providerCode',
  'resolvedForOccurredAt',
  'revisionId',
  'identityDigest',
  'matchBasis',
  'effectiveFrom',
  'effectiveUntil',
] as const;
const policyKeys = [
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
const eligibilityKeys = ['state', 'selectedPlayerId', 'checkedAt', 'decisionVersion'] as const;
const duplicateKeys = [
  'state',
  'providerCode',
  'canonicalReferenceFingerprint',
  'checkedAt',
] as const;
const decisionKeys = [
  'contractVersion',
  'providerCode',
  'advisoryOnly',
  'disposition',
  'reasonCode',
  'transportAllowed',
  'networkAllowed',
  'databaseWriteAllowed',
  'settlementAllowed',
  'claimAllowed',
  'enqueueAllowed',
  'executionAllowed',
  'financialActionAllowed',
  'blindRetryAllowed',
] as const;

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const VERSION_PATTERN = /^[a-z][a-z0-9_-]{0,95}(?:[-_]v[0-9]+)$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const PRINCIPAL_MINOR_PATTERN = /^(?:0|[1-9][0-9]{0,15})$/u;

const disabledCapabilities: DisabledAssessmentCapabilities = Object.freeze({
  transportAllowed: false as const,
  networkAllowed: false as const,
  databaseWriteAllowed: false as const,
  settlementAllowed: false as const,
  claimAllowed: false as const,
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

function parseProvider(value: unknown): DepositProofAssessmentProvider | undefined {
  return value === 'cbe_birr' || value === 'telebirr' ? value : undefined;
}

function parseCanonicalUtcTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function parsePattern(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function parseNullablePattern(value: unknown, pattern: RegExp): string | null | undefined {
  return value === null ? null : parsePattern(value, pattern);
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : undefined;
}

function parseRequestBinding(candidate: unknown): ParsedRequestBinding | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, proofRequestKeys)
  ) {
    return undefined;
  }
  const proofRequestId = parsePattern(ownDataValue(candidate, 'proofRequestId'), OPAQUE_ID_PATTERN);
  const providerCode = parseProvider(ownDataValue(candidate, 'providerCode'));
  const referenceFingerprint = parsePattern(
    ownDataValue(candidate, 'referenceFingerprint'),
    FINGERPRINT_PATTERN,
  );
  const selectedPlayerId = parsePattern(
    ownDataValue(candidate, 'selectedPlayerId'),
    PLAYER_ID_PATTERN,
  );
  const submittedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'submittedAt'));
  if (
    !proofRequestId ||
    !providerCode ||
    !referenceFingerprint ||
    ownDataValue(candidate, 'referenceKeyVersion') !== DEPOSIT_PROOF_REFERENCE_KEY_VERSION ||
    ownDataValue(candidate, 'referenceProfileVersion') !==
      DEPOSIT_PROOF_REFERENCE_PROFILE_VERSION ||
    !selectedPlayerId ||
    !submittedAt
  ) {
    return undefined;
  }
  return Object.freeze({
    proofRequestId,
    providerCode,
    referenceFingerprint,
    selectedPlayerId,
    submittedAt,
  });
}

function parseReceiverObservation(
  candidate: unknown,
): ParsedReceiverObservation | null | undefined {
  if (candidate === null) return null;
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, receiverObservationKeys)
  ) {
    return undefined;
  }
  const identityDigest = parsePattern(ownDataValue(candidate, 'identityDigest'), DIGEST_PATTERN);
  const matchBasis = parseEnum(ownDataValue(candidate, 'matchBasis'), [
    'exact_account_identifier',
    'exact_full_name',
  ] as const);
  return identityDigest && matchBasis ? Object.freeze({ identityDigest, matchBasis }) : undefined;
}

function sourceForProvider(
  provider: DepositProofAssessmentProvider,
): OfficialDepositProofObservation['source'] {
  return provider === 'cbe_birr' ? 'cbe_birr_official_receipt' : 'telebirr_official_receipt';
}

function parseOfficialObservation(candidate: unknown): ParsedOfficialObservation | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, observationKeys)
  ) {
    return undefined;
  }
  const providerCode = parseProvider(ownDataValue(candidate, 'providerCode'));
  const lookupOutcome = parseEnum(ownDataValue(candidate, 'lookupOutcome'), [
    'found',
    'not_found',
    'unavailable',
    'ambiguous',
  ] as const);
  const provenanceState = parseEnum(ownDataValue(candidate, 'provenanceState'), [
    'exact',
    'parser_uncertain',
    'source_uncertain',
    'unsupported',
  ] as const);
  const canonicalReferenceFingerprint = parseNullablePattern(
    ownDataValue(candidate, 'canonicalReferenceFingerprint'),
    FINGERPRINT_PATTERN,
  );
  const receiptStatusValue = ownDataValue(candidate, 'receiptStatus');
  const receiptStatus =
    receiptStatusValue === null
      ? null
      : parseEnum(receiptStatusValue, ['completed', 'pending', 'failed', 'unknown'] as const);
  const transactionTypeValue = ownDataValue(candidate, 'transactionType');
  const transactionType =
    transactionTypeValue === null
      ? null
      : parseEnum(transactionTypeValue, ['send_money', 'unsupported', 'unknown'] as const);
  const principalAmountMinor = parseNullablePattern(
    ownDataValue(candidate, 'principalAmountMinor'),
    PRINCIPAL_MINOR_PATTERN,
  );
  const currencyCode = parseNullablePattern(
    ownDataValue(candidate, 'currencyCode'),
    CURRENCY_PATTERN,
  );
  const occurredAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'occurredAt'));
  const retrievedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'retrievedAt'));
  const receiver = parseReceiverObservation(ownDataValue(candidate, 'receiver'));
  const evidenceDigest = parsePattern(ownDataValue(candidate, 'evidenceDigest'), DIGEST_PATTERN);
  const adapterVersion = parsePattern(ownDataValue(candidate, 'adapterVersion'), VERSION_PATTERN);
  const parserVersion = parsePattern(ownDataValue(candidate, 'parserVersion'), VERSION_PATTERN);
  const normalizerVersion = parsePattern(
    ownDataValue(candidate, 'normalizerVersion'),
    VERSION_PATTERN,
  );
  const sourceProfile = parsePattern(ownDataValue(candidate, 'sourceProfile'), VERSION_PATTERN);
  const source = parseEnum(ownDataValue(candidate, 'source'), [
    'cbe_birr_official_receipt',
    'telebirr_official_receipt',
  ] as const);
  if (
    ownDataValue(candidate, 'observationVersion') !== 1 ||
    !providerCode ||
    !lookupOutcome ||
    !provenanceState ||
    canonicalReferenceFingerprint === undefined ||
    receiptStatus === undefined ||
    transactionType === undefined ||
    principalAmountMinor === undefined ||
    currencyCode === undefined ||
    occurredAt === undefined ||
    !retrievedAt ||
    receiver === undefined ||
    !evidenceDigest ||
    !adapterVersion ||
    !parserVersion ||
    !normalizerVersion ||
    !sourceProfile ||
    !source
  ) {
    return undefined;
  }

  const hasFoundFacts =
    canonicalReferenceFingerprint !== null &&
    receiptStatus !== null &&
    transactionType !== null &&
    principalAmountMinor !== null &&
    currencyCode !== null &&
    occurredAt !== null &&
    receiver !== null;
  const hasNoReceiptFacts =
    canonicalReferenceFingerprint === null &&
    receiptStatus === null &&
    transactionType === null &&
    principalAmountMinor === null &&
    currencyCode === null &&
    occurredAt === null &&
    receiver === null;
  if (
    (lookupOutcome === 'found' && !hasFoundFacts) ||
    (lookupOutcome !== 'found' && !hasNoReceiptFacts)
  ) {
    return undefined;
  }
  if (source !== sourceForProvider(providerCode)) return undefined;

  return Object.freeze({
    providerCode,
    lookupOutcome,
    provenanceState,
    canonicalReferenceFingerprint,
    receiptStatus,
    transactionType,
    principalAmountMinor,
    currencyCode,
    occurredAt,
    retrievedAt,
    receiver,
    evidenceDigest,
    adapterVersion,
    parserVersion,
    normalizerVersion,
    sourceProfile,
    source,
  });
}

function parseReceiverRevisionFact(candidate: unknown): ParsedReceiverRevisionFact | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, receiverRevisionKeys)
  ) {
    return undefined;
  }
  const state = parseEnum(ownDataValue(candidate, 'state'), [
    'exact',
    'gap',
    'overlap',
    'unavailable',
  ] as const);
  const providerCode = parseProvider(ownDataValue(candidate, 'providerCode'));
  const resolvedForOccurredAt = parseCanonicalUtcTimestamp(
    ownDataValue(candidate, 'resolvedForOccurredAt'),
  );
  const revisionId = parseNullablePattern(ownDataValue(candidate, 'revisionId'), OPAQUE_ID_PATTERN);
  const identityDigest = parseNullablePattern(
    ownDataValue(candidate, 'identityDigest'),
    DIGEST_PATTERN,
  );
  const matchBasisValue = ownDataValue(candidate, 'matchBasis');
  const matchBasis =
    matchBasisValue === null
      ? null
      : parseEnum(matchBasisValue, ['exact_account_identifier', 'exact_full_name'] as const);
  const effectiveFrom = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'effectiveFrom'));
  const effectiveUntil = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'effectiveUntil'));
  if (
    !state ||
    !providerCode ||
    resolvedForOccurredAt === undefined ||
    revisionId === undefined ||
    identityDigest === undefined ||
    matchBasis === undefined ||
    effectiveFrom === undefined ||
    effectiveUntil === undefined
  ) {
    return undefined;
  }
  const hasExactRevision =
    resolvedForOccurredAt !== null &&
    revisionId !== null &&
    identityDigest !== null &&
    matchBasis !== null &&
    effectiveFrom !== null &&
    (effectiveUntil === null || effectiveFrom < effectiveUntil);
  const hasNoRevision =
    revisionId === null &&
    identityDigest === null &&
    matchBasis === null &&
    effectiveFrom === null &&
    effectiveUntil === null;
  if ((state === 'exact' && !hasExactRevision) || (state !== 'exact' && !hasNoRevision)) {
    return undefined;
  }
  return Object.freeze({
    state,
    providerCode,
    resolvedForOccurredAt,
    revisionId,
    identityDigest,
    matchBasis,
    effectiveFrom,
    effectiveUntil,
  });
}

function parsePolicy(candidate: unknown): ParsedCurrentPolicyFact | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, policyKeys)) {
    return undefined;
  }
  const state = parseEnum(ownDataValue(candidate, 'state'), ['available', 'unavailable'] as const);
  const providerCode = parseProvider(ownDataValue(candidate, 'providerCode'));
  const checkedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'checkedAt'));
  const policyVersion = parseNullablePattern(
    ownDataValue(candidate, 'policyVersion'),
    VERSION_PATTERN,
  );
  const currencyCodeValue = ownDataValue(candidate, 'currencyCode');
  const currencyCode =
    currencyCodeValue === null ? null : currencyCodeValue === 'ETB' ? 'ETB' : undefined;
  const minimumPrincipalAmountMinor = parseNullablePattern(
    ownDataValue(candidate, 'minimumPrincipalAmountMinor'),
    PRINCIPAL_MINOR_PATTERN,
  );
  const maximumPrincipalAmountMinor = parseNullablePattern(
    ownDataValue(candidate, 'maximumPrincipalAmountMinor'),
    PRINCIPAL_MINOR_PATTERN,
  );
  const automaticFreshnessSecondsValue = ownDataValue(candidate, 'automaticFreshnessSeconds');
  const automaticFreshnessSeconds =
    automaticFreshnessSecondsValue === null
      ? null
      : Number.isSafeInteger(automaticFreshnessSecondsValue) &&
          (automaticFreshnessSecondsValue as number) >= 0
        ? (automaticFreshnessSecondsValue as number)
        : undefined;
  const maximumFutureSkewSecondsValue = ownDataValue(candidate, 'maximumFutureSkewSeconds');
  const maximumFutureSkewSeconds =
    maximumFutureSkewSecondsValue === null
      ? null
      : Number.isSafeInteger(maximumFutureSkewSecondsValue) &&
          (maximumFutureSkewSecondsValue as number) >= 0
        ? (maximumFutureSkewSecondsValue as number)
        : undefined;
  const allowedTransactionTypeValue = ownDataValue(candidate, 'allowedTransactionType');
  const allowedTransactionType =
    allowedTransactionTypeValue === null
      ? null
      : allowedTransactionTypeValue === 'send_money'
        ? 'send_money'
        : undefined;
  const acceptedSourceValue = ownDataValue(candidate, 'acceptedSource');
  const acceptedSource =
    acceptedSourceValue === null
      ? null
      : parseEnum(acceptedSourceValue, [
          'cbe_birr_official_receipt',
          'telebirr_official_receipt',
        ] as const);
  const acceptedSourceProfile = parseNullablePattern(
    ownDataValue(candidate, 'acceptedSourceProfile'),
    VERSION_PATTERN,
  );
  const acceptedAdapterVersion = parseNullablePattern(
    ownDataValue(candidate, 'acceptedAdapterVersion'),
    VERSION_PATTERN,
  );
  const acceptedParserVersion = parseNullablePattern(
    ownDataValue(candidate, 'acceptedParserVersion'),
    VERSION_PATTERN,
  );
  const acceptedNormalizerVersion = parseNullablePattern(
    ownDataValue(candidate, 'acceptedNormalizerVersion'),
    VERSION_PATTERN,
  );
  if (
    !state ||
    !providerCode ||
    !checkedAt ||
    policyVersion === undefined ||
    currencyCode === undefined ||
    minimumPrincipalAmountMinor === undefined ||
    maximumPrincipalAmountMinor === undefined ||
    automaticFreshnessSeconds === undefined ||
    maximumFutureSkewSeconds === undefined ||
    allowedTransactionType === undefined ||
    acceptedSource === undefined ||
    acceptedSourceProfile === undefined ||
    acceptedAdapterVersion === undefined ||
    acceptedParserVersion === undefined ||
    acceptedNormalizerVersion === undefined
  ) {
    return undefined;
  }
  const hasAvailablePolicy =
    policyVersion !== null &&
    currencyCode !== null &&
    minimumPrincipalAmountMinor !== null &&
    maximumPrincipalAmountMinor !== null &&
    automaticFreshnessSeconds !== null &&
    maximumFutureSkewSeconds !== null &&
    allowedTransactionType !== null &&
    acceptedSource !== null &&
    acceptedSourceProfile !== null &&
    acceptedAdapterVersion !== null &&
    acceptedParserVersion !== null &&
    acceptedNormalizerVersion !== null;
  const hasNoPolicy =
    policyVersion === null &&
    currencyCode === null &&
    minimumPrincipalAmountMinor === null &&
    maximumPrincipalAmountMinor === null &&
    automaticFreshnessSeconds === null &&
    maximumFutureSkewSeconds === null &&
    allowedTransactionType === null &&
    acceptedSource === null &&
    acceptedSourceProfile === null &&
    acceptedAdapterVersion === null &&
    acceptedParserVersion === null &&
    acceptedNormalizerVersion === null;
  if ((state === 'available' && !hasAvailablePolicy) || (state === 'unavailable' && !hasNoPolicy)) {
    return undefined;
  }
  if (
    hasAvailablePolicy &&
    BigInt(minimumPrincipalAmountMinor) > BigInt(maximumPrincipalAmountMinor)
  ) {
    return undefined;
  }
  return Object.freeze({
    state,
    providerCode,
    checkedAt,
    policyVersion,
    currencyCode,
    minimumPrincipalAmountMinor,
    maximumPrincipalAmountMinor,
    automaticFreshnessSeconds,
    maximumFutureSkewSeconds,
    allowedTransactionType,
    acceptedSource,
    acceptedSourceProfile,
    acceptedAdapterVersion,
    acceptedParserVersion,
    acceptedNormalizerVersion,
  });
}

function parseEligibility(candidate: unknown): ParsedCurrentEligibilityFact | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, eligibilityKeys)
  ) {
    return undefined;
  }
  const state = parseEnum(ownDataValue(candidate, 'state'), [
    'eligible',
    'ineligible',
    'unavailable',
    'ambiguous',
  ] as const);
  const selectedPlayerId = parsePattern(
    ownDataValue(candidate, 'selectedPlayerId'),
    PLAYER_ID_PATTERN,
  );
  const checkedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'checkedAt'));
  const decisionVersion = parseNullablePattern(
    ownDataValue(candidate, 'decisionVersion'),
    VERSION_PATTERN,
  );
  if (!state || !selectedPlayerId || !checkedAt || decisionVersion === undefined) return undefined;
  if (
    ((state === 'eligible' || state === 'ineligible') && decisionVersion === null) ||
    ((state === 'unavailable' || state === 'ambiguous') && decisionVersion !== null)
  ) {
    return undefined;
  }
  return Object.freeze({ state, selectedPlayerId, checkedAt, decisionVersion });
}

function parseDuplicate(candidate: unknown): ParsedDuplicateStateFact | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, duplicateKeys)) {
    return undefined;
  }
  const state = parseEnum(ownDataValue(candidate, 'state'), [
    'unused',
    'reused',
    'unavailable',
    'ambiguous',
  ] as const);
  const providerCode = parseProvider(ownDataValue(candidate, 'providerCode'));
  const canonicalReferenceFingerprint = parsePattern(
    ownDataValue(candidate, 'canonicalReferenceFingerprint'),
    FINGERPRINT_PATTERN,
  );
  const checkedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'checkedAt'));
  return state && providerCode && canonicalReferenceFingerprint && checkedAt
    ? Object.freeze({ state, providerCode, canonicalReferenceFingerprint, checkedAt })
    : undefined;
}

function parseDatabaseFacts(
  candidate: unknown,
): ParsedAssessmentInput['databaseFacts'] | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, databaseFactKeys)
  ) {
    return undefined;
  }
  const receiverAtOccurredAt = parseReceiverRevisionFact(
    ownDataValue(candidate, 'receiverAtOccurredAt'),
  );
  const currentPolicy = parsePolicy(ownDataValue(candidate, 'currentPolicy'));
  const currentEligibility = parseEligibility(ownDataValue(candidate, 'currentEligibility'));
  const duplicateState = parseDuplicate(ownDataValue(candidate, 'duplicateState'));
  return receiverAtOccurredAt && currentPolicy && currentEligibility && duplicateState
    ? Object.freeze({ receiverAtOccurredAt, currentPolicy, currentEligibility, duplicateState })
    : undefined;
}

function parseInput(candidate: unknown): ParsedAssessmentInput | undefined {
  if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, inputKeys)) {
    return undefined;
  }
  const assessedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'assessedAt'));
  const proofRequest = parseRequestBinding(ownDataValue(candidate, 'proofRequest'));
  const officialObservation = parseOfficialObservation(
    ownDataValue(candidate, 'officialObservation'),
  );
  const databaseFacts = parseDatabaseFacts(ownDataValue(candidate, 'databaseFacts'));
  if (
    ownDataValue(candidate, 'contractVersion') !== DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION ||
    !assessedAt ||
    !proofRequest ||
    !officialObservation ||
    !databaseFacts
  ) {
    return undefined;
  }
  return Object.freeze({ assessedAt, proofRequest, officialObservation, databaseFacts });
}

function decisionBase(providerCode: DepositProofAssessmentProvider | 'unknown') {
  return {
    contractVersion: DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION,
    providerCode,
    advisoryOnly: true as const,
    ...disabledCapabilities,
  } as const;
}

function reviewDecision(
  providerCode: DepositProofAssessmentProvider | 'unknown',
  reasonCode: DepositProofWouldReviewDecision['reasonCode'],
): DepositProofWouldReviewDecision {
  return Object.freeze({
    ...decisionBase(providerCode),
    disposition: 'would_review' as const,
    reasonCode,
  });
}

function rejectDecision(
  providerCode: DepositProofAssessmentProvider,
  reasonCode: DepositProofWouldRejectDecision['reasonCode'],
): DepositProofWouldRejectDecision {
  return Object.freeze({
    ...decisionBase(providerCode),
    disposition: 'would_reject' as const,
    reasonCode,
  });
}

function verifyDecision(
  providerCode: DepositProofAssessmentProvider,
): DepositProofWouldVerifyDecision {
  return Object.freeze({
    ...decisionBase(providerCode),
    disposition: 'would_verify' as const,
    reasonCode: 'exact_proof_match' as const,
  });
}

function policyIsPinned(policy: ParsedCurrentPolicyFact): boolean {
  return (
    policy.currencyCode === 'ETB' &&
    policy.minimumPrincipalAmountMinor === DEPOSIT_PROOF_MINIMUM_PRINCIPAL_MINOR &&
    policy.maximumPrincipalAmountMinor === DEPOSIT_PROOF_MAXIMUM_PRINCIPAL_MINOR &&
    policy.automaticFreshnessSeconds === DEPOSIT_PROOF_AUTOMATIC_FRESHNESS_SECONDS &&
    policy.maximumFutureSkewSeconds !== null &&
    policy.maximumFutureSkewSeconds <= DEPOSIT_PROOF_MAXIMUM_FUTURE_SKEW_SECONDS &&
    policy.allowedTransactionType === 'send_money'
  );
}

/**
 * Evaluates only already-normalized, explicitly supplied facts. This pure contract performs no
 * lookup, persistence, claim, settlement, enqueue, execution, retry, or financial action.
 */
export function assessOfficialDepositProof(
  inputCandidate: unknown,
): DepositProofAssessmentDecision {
  try {
    const input = parseInput(inputCandidate);
    if (!input) return reviewDecision('unknown', 'invalid_assessment_input');

    const provider = input.proofRequest.providerCode;
    const observation = input.officialObservation;
    const facts = input.databaseFacts;
    const policy = facts.currentPolicy;
    const eligibility = facts.currentEligibility;
    const duplicate = facts.duplicateState;
    const receiverFact = facts.receiverAtOccurredAt;

    if (
      policy.providerCode !== provider ||
      policy.checkedAt !== input.assessedAt ||
      eligibility.selectedPlayerId !== input.proofRequest.selectedPlayerId ||
      eligibility.checkedAt !== input.assessedAt ||
      duplicate.providerCode !== provider ||
      duplicate.canonicalReferenceFingerprint !== input.proofRequest.referenceFingerprint ||
      duplicate.checkedAt !== input.assessedAt
    ) {
      return reviewDecision(provider, 'database_facts_unbound');
    }

    if (policy.state === 'unavailable') return reviewDecision(provider, 'policy_unavailable');
    if (!policyIsPinned(policy)) return reviewDecision(provider, 'policy_contract_mismatch');

    if (eligibility.state === 'unavailable') {
      return reviewDecision(provider, 'eligibility_unavailable');
    }
    if (eligibility.state === 'ambiguous') {
      return reviewDecision(provider, 'eligibility_ambiguous');
    }
    if (eligibility.state === 'ineligible') return rejectDecision(provider, 'player_ineligible');

    if (duplicate.state === 'reused') {
      return rejectDecision(provider, 'duplicate_reference_reused');
    }
    if (duplicate.state === 'unavailable') {
      return reviewDecision(provider, 'duplicate_check_unavailable');
    }
    if (duplicate.state === 'ambiguous') {
      return reviewDecision(provider, 'duplicate_check_ambiguous');
    }

    if (observation.providerCode !== provider) {
      return rejectDecision(provider, 'provider_mismatch');
    }
    if (observation.lookupOutcome === 'unavailable') {
      return reviewDecision(provider, 'source_unavailable');
    }
    if (observation.lookupOutcome === 'ambiguous') {
      return reviewDecision(provider, 'source_ambiguous');
    }
    if (observation.provenanceState === 'source_uncertain') {
      return reviewDecision(provider, 'source_uncertain');
    }
    if (observation.provenanceState === 'unsupported') {
      return reviewDecision(provider, 'source_unsupported');
    }
    if (observation.provenanceState === 'parser_uncertain') {
      return reviewDecision(provider, 'parser_uncertain');
    }
    if (observation.lookupOutcome === 'not_found') {
      return rejectDecision(provider, 'reference_not_found');
    }

    if (
      observation.source !== policy.acceptedSource ||
      observation.sourceProfile !== policy.acceptedSourceProfile ||
      observation.adapterVersion !== policy.acceptedAdapterVersion ||
      observation.parserVersion !== policy.acceptedParserVersion ||
      observation.normalizerVersion !== policy.acceptedNormalizerVersion
    ) {
      return reviewDecision(provider, 'observation_version_unsupported');
    }
    if (observation.canonicalReferenceFingerprint !== input.proofRequest.referenceFingerprint) {
      return rejectDecision(provider, 'reference_mismatch');
    }
    if (observation.receiptStatus === 'failed') return rejectDecision(provider, 'receipt_failed');
    if (observation.receiptStatus === 'pending') return reviewDecision(provider, 'receipt_pending');
    if (observation.receiptStatus === 'unknown') {
      return reviewDecision(provider, 'receipt_status_unknown');
    }
    if (observation.transactionType !== policy.allowedTransactionType) {
      return reviewDecision(provider, 'transaction_type_unsupported');
    }
    if (observation.currencyCode !== policy.currencyCode) {
      return rejectDecision(provider, 'currency_not_etb');
    }

    if (receiverFact.providerCode !== provider) {
      return reviewDecision(provider, 'database_facts_unbound');
    }
    if (receiverFact.state === 'gap') return reviewDecision(provider, 'receiver_history_gap');
    if (receiverFact.state === 'overlap') {
      return reviewDecision(provider, 'receiver_history_overlap');
    }
    if (receiverFact.state === 'unavailable') {
      return reviewDecision(provider, 'receiver_history_unavailable');
    }

    if (
      observation.occurredAt === null ||
      observation.receiver === null ||
      receiverFact.resolvedForOccurredAt !== observation.occurredAt ||
      receiverFact.effectiveFrom === null ||
      observation.occurredAt < receiverFact.effectiveFrom ||
      (receiverFact.effectiveUntil !== null &&
        observation.occurredAt >= receiverFact.effectiveUntil)
    ) {
      return reviewDecision(provider, 'database_facts_unbound');
    }
    const requiredReceiverMatchBasis =
      provider === 'cbe_birr' ? 'exact_account_identifier' : 'exact_full_name';
    if (
      observation.receiver.matchBasis !== requiredReceiverMatchBasis ||
      receiverFact.matchBasis !== requiredReceiverMatchBasis
    ) {
      return reviewDecision(provider, 'receiver_match_basis_unsupported');
    }
    if (observation.receiver.identityDigest !== receiverFact.identityDigest) {
      return rejectDecision(provider, 'receiver_mismatch');
    }

    if (
      observation.principalAmountMinor === null ||
      policy.minimumPrincipalAmountMinor === null ||
      policy.maximumPrincipalAmountMinor === null
    ) {
      return reviewDecision(provider, 'invalid_assessment_input');
    }
    const principal = BigInt(observation.principalAmountMinor);
    if (
      principal < BigInt(policy.minimumPrincipalAmountMinor) ||
      principal > BigInt(policy.maximumPrincipalAmountMinor)
    ) {
      return reviewDecision(provider, 'amount_out_of_range');
    }

    if (policy.maximumFutureSkewSeconds === null || policy.automaticFreshnessSeconds === null) {
      return reviewDecision(provider, 'policy_contract_mismatch');
    }
    const assessedAtMs = Date.parse(input.assessedAt);
    const submittedAtMs = Date.parse(input.proofRequest.submittedAt);
    const occurredAtMs = Date.parse(observation.occurredAt);
    const retrievedAtMs = Date.parse(observation.retrievedAt);
    const futureSkewMs = policy.maximumFutureSkewSeconds * 1000;
    if (
      submittedAtMs > assessedAtMs + futureSkewMs ||
      retrievedAtMs > assessedAtMs + futureSkewMs ||
      occurredAtMs > retrievedAtMs + futureSkewMs
    ) {
      return reviewDecision(provider, 'future_skew_exceeded');
    }
    const ageAtSubmissionMs = submittedAtMs - occurredAtMs;
    if (ageAtSubmissionMs < 0) return reviewDecision(provider, 'receipt_after_submission');
    if (ageAtSubmissionMs > policy.automaticFreshnessSeconds * 1000) {
      return reviewDecision(provider, 'receipt_too_old');
    }

    return verifyDecision(provider);
  } catch {
    return reviewDecision('unknown', 'invalid_assessment_input');
  }
}

function isReasonCode(value: unknown): value is DepositProofAssessmentReasonCode {
  return (
    typeof value === 'string' &&
    [
      'exact_proof_match',
      'invalid_assessment_input',
      'database_facts_unbound',
      'policy_unavailable',
      'policy_contract_mismatch',
      'eligibility_unavailable',
      'eligibility_ambiguous',
      'player_ineligible',
      'duplicate_reference_reused',
      'duplicate_check_unavailable',
      'duplicate_check_ambiguous',
      'source_unavailable',
      'source_ambiguous',
      'source_uncertain',
      'source_unsupported',
      'observation_version_unsupported',
      'parser_uncertain',
      'reference_not_found',
      'provider_mismatch',
      'reference_mismatch',
      'receipt_failed',
      'receipt_pending',
      'receipt_status_unknown',
      'transaction_type_unsupported',
      'currency_not_etb',
      'receiver_history_gap',
      'receiver_history_overlap',
      'receiver_history_unavailable',
      'receiver_match_basis_unsupported',
      'receiver_mismatch',
      'amount_out_of_range',
      'receipt_too_old',
      'receipt_after_submission',
      'future_skew_exceeded',
    ].includes(value)
  );
}

function hasDisabledCapabilities(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'transportAllowed') === false &&
    ownDataValue(candidate, 'networkAllowed') === false &&
    ownDataValue(candidate, 'databaseWriteAllowed') === false &&
    ownDataValue(candidate, 'settlementAllowed') === false &&
    ownDataValue(candidate, 'claimAllowed') === false &&
    ownDataValue(candidate, 'enqueueAllowed') === false &&
    ownDataValue(candidate, 'executionAllowed') === false &&
    ownDataValue(candidate, 'financialActionAllowed') === false &&
    ownDataValue(candidate, 'blindRetryAllowed') === false
  );
}

/** Revalidates and projects only fixed, allowlisted, non-sensitive decision fields. */
export function redactedDepositProofAssessmentForLog(
  decisionCandidate: unknown,
): RedactedDepositProofAssessmentLogProjection {
  try {
    if (
      !isPlainNonProxyRecord(decisionCandidate) ||
      !hasExactEnumerableDataKeys(decisionCandidate, decisionKeys) ||
      ownDataValue(decisionCandidate, 'contractVersion') !==
        DEPOSIT_PROOF_ASSESSMENT_CONTRACT_VERSION ||
      ownDataValue(decisionCandidate, 'advisoryOnly') !== true ||
      !hasDisabledCapabilities(decisionCandidate)
    ) {
      return reviewDecision('unknown', 'invalid_assessment_input');
    }
    const providerCode = ownDataValue(decisionCandidate, 'providerCode');
    const parsedProvider = providerCode === 'unknown' ? 'unknown' : parseProvider(providerCode);
    const disposition = ownDataValue(decisionCandidate, 'disposition');
    const reasonCode = ownDataValue(decisionCandidate, 'reasonCode');
    if (!parsedProvider || !isReasonCode(reasonCode)) {
      return reviewDecision('unknown', 'invalid_assessment_input');
    }
    if (disposition === 'would_verify' && reasonCode === 'exact_proof_match') {
      if (parsedProvider === 'unknown')
        return reviewDecision('unknown', 'invalid_assessment_input');
      return verifyDecision(parsedProvider);
    }
    if (
      disposition === 'would_reject' &&
      parsedProvider !== 'unknown' &&
      [
        'player_ineligible',
        'duplicate_reference_reused',
        'reference_not_found',
        'provider_mismatch',
        'reference_mismatch',
        'receipt_failed',
        'currency_not_etb',
        'receiver_mismatch',
      ].includes(reasonCode)
    ) {
      return rejectDecision(
        parsedProvider,
        reasonCode as DepositProofWouldRejectDecision['reasonCode'],
      );
    }
    if (
      disposition === 'would_review' &&
      reasonCode !== 'exact_proof_match' &&
      ![
        'player_ineligible',
        'duplicate_reference_reused',
        'reference_not_found',
        'provider_mismatch',
        'reference_mismatch',
        'receipt_failed',
        'currency_not_etb',
        'receiver_mismatch',
      ].includes(reasonCode)
    ) {
      return reviewDecision(
        parsedProvider,
        reasonCode as DepositProofWouldReviewDecision['reasonCode'],
      );
    }
    return reviewDecision('unknown', 'invalid_assessment_input');
  } catch {
    return reviewDecision('unknown', 'invalid_assessment_input');
  }
}
