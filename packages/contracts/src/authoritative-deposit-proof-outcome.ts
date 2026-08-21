import { isProxy } from 'node:util/types';

/**
 * Pure, non-authoritative boundary for an already assessed provider proof outcome.
 *
 * A value accepted by this module is only a candidate for a later, independently authorized
 * database transition. It cannot authorize SQL, perform I/O, persist or claim state, settle a
 * deposit, enqueue work, execute a provider action, or move money.
 */
export const AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION = 1 as const;
export const AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CAN_AUTHORIZE_SQL = false as const;
export const AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_PROTECTION_PROFILE_VERSION = 2 as const;
export const AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_KEY_VERSION = 2 as const;

export const AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_PROVIDERS = Object.freeze([
  'cbe_birr',
  'telebirr',
] as const);

export type AuthoritativeDepositProofOutcomeProvider =
  (typeof AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_PROVIDERS)[number];

export type AuthoritativeDepositProofOutcomeSource =
  'cbe_birr_official_receipt' | 'telebirr_official_receipt';

export const AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REJECT_REASON_CODES = Object.freeze([
  'player_ineligible',
  'duplicate_reference_reused',
  'reference_not_found',
  'provider_mismatch',
  'reference_mismatch',
  'receipt_failed',
  'currency_not_etb',
  'receiver_mismatch',
] as const);

export type AuthoritativeDepositProofOutcomeRejectReasonCode =
  (typeof AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REJECT_REASON_CODES)[number];

export const AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REVIEW_REASON_CODES = Object.freeze([
  'invalid_assessment_input',
  'database_facts_unbound',
  'policy_unavailable',
  'policy_contract_mismatch',
  'eligibility_unavailable',
  'eligibility_ambiguous',
  'duplicate_check_unavailable',
  'duplicate_check_ambiguous',
  'source_unavailable',
  'source_ambiguous',
  'source_uncertain',
  'source_unsupported',
  'observation_version_unsupported',
  'parser_uncertain',
  'receipt_pending',
  'receipt_status_unknown',
  'transaction_type_unsupported',
  'receiver_history_gap',
  'receiver_history_overlap',
  'receiver_history_unavailable',
  'receiver_match_basis_unsupported',
  'amount_out_of_range',
  'receipt_too_old',
  'receipt_after_submission',
  'future_skew_exceeded',
] as const);

export type AuthoritativeDepositProofOutcomeReviewReasonCode =
  (typeof AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REVIEW_REASON_CODES)[number];

export type AuthoritativeDepositProofOutcomeReasonCode =
  | 'exact_proof_match'
  | AuthoritativeDepositProofOutcomeRejectReasonCode
  | AuthoritativeDepositProofOutcomeReviewReasonCode;

export type AuthoritativeDepositProofOutcomeDisposition =
  'settlement_candidate' | 'definite_reject' | 'review_required';

export interface AuthoritativeDepositProofProtectedCanonicalReference {
  readonly protectionProfileVersion: 2;
  readonly encryptionKeyVersion: 2;
  readonly ciphertext: string;
  readonly fingerprint: string;
  readonly masked: string;
}

interface DisabledAuthoritativeDepositProofOutcomeCapabilities {
  readonly advisoryOnly: true;
  readonly sqlAuthorizationAllowed: false;
  readonly transportAllowed: false;
  readonly networkAllowed: false;
  readonly databaseReadAllowed: false;
  readonly databaseWriteAllowed: false;
  readonly persistenceAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly blindRetryAllowed: false;
}

type SourceForProvider<Provider extends AuthoritativeDepositProofOutcomeProvider> =
  Provider extends 'cbe_birr' ? 'cbe_birr_official_receipt' : 'telebirr_official_receipt';

interface AuthoritativeDepositProofOutcomeCommon<
  Provider extends AuthoritativeDepositProofOutcomeProvider,
> extends DisabledAuthoritativeDepositProofOutcomeCapabilities {
  readonly contractVersion: 1;
  readonly proofRequestId: string;
  readonly providerCode: Provider;
  readonly assessmentContractVersion: 1;
  readonly assessmentInputDigest: string;
  readonly assessedAt: string;
  readonly source: SourceForProvider<Provider>;
  readonly sourceProfile: string;
  readonly observationVersion: 1;
  readonly adapterVersion: string;
  readonly parserVersion: string;
  readonly normalizerVersion: string;
  readonly evidenceDigest: string;
  readonly retrievedAt: string;
}

type AuthoritativeDepositProofSettlementCandidateFor<
  Provider extends AuthoritativeDepositProofOutcomeProvider,
  MatchBasis extends 'exact_account_identifier' | 'exact_full_name',
> = AuthoritativeDepositProofOutcomeCommon<Provider> & {
  readonly disposition: 'settlement_candidate';
  readonly reasonCode: 'exact_proof_match';
  readonly lookupOutcome: 'found';
  readonly provenanceState: 'exact';
  readonly receiptStatus: 'completed';
  readonly transactionType: 'send_money';
  readonly principalAmountMinor: string;
  readonly currencyCode: 'ETB';
  readonly occurredAt: string;
  readonly receiverRevisionId: string;
  readonly receiverRevisionVersion: number;
  readonly receiverIdentityDigest: string;
  readonly receiverMatchBasis: MatchBasis;
  readonly canonicalReference: AuthoritativeDepositProofProtectedCanonicalReference;
};

export type AuthoritativeDepositProofSettlementCandidate =
  | AuthoritativeDepositProofSettlementCandidateFor<'cbe_birr', 'exact_account_identifier'>
  | AuthoritativeDepositProofSettlementCandidateFor<'telebirr', 'exact_full_name'>;

type AuthoritativeDepositProofDefiniteRejectCandidateFor<
  Provider extends AuthoritativeDepositProofOutcomeProvider,
> = AuthoritativeDepositProofOutcomeCommon<Provider> & {
  readonly disposition: 'definite_reject';
  readonly reasonCode: AuthoritativeDepositProofOutcomeRejectReasonCode;
};

export type AuthoritativeDepositProofDefiniteRejectCandidate =
  | AuthoritativeDepositProofDefiniteRejectCandidateFor<'cbe_birr'>
  | AuthoritativeDepositProofDefiniteRejectCandidateFor<'telebirr'>;

type AuthoritativeDepositProofReviewCandidateFor<
  Provider extends AuthoritativeDepositProofOutcomeProvider,
> = AuthoritativeDepositProofOutcomeCommon<Provider> & {
  readonly disposition: 'review_required';
  readonly reasonCode: AuthoritativeDepositProofOutcomeReviewReasonCode;
};

export type AuthoritativeDepositProofReviewCandidate =
  | AuthoritativeDepositProofReviewCandidateFor<'cbe_birr'>
  | AuthoritativeDepositProofReviewCandidateFor<'telebirr'>;

/**
 * Exact version-1 outcome-candidate union. Even the settlement-candidate member is advisory and
 * cannot authorize SQL; a separate future authority boundary must re-establish every invariant.
 */
export type AuthoritativeDepositProofOutcomeCandidate =
  | AuthoritativeDepositProofSettlementCandidate
  | AuthoritativeDepositProofDefiniteRejectCandidate
  | AuthoritativeDepositProofReviewCandidate;

export interface RedactedAuthoritativeDepositProofOutcomeLogProjection extends DisabledAuthoritativeDepositProofOutcomeCapabilities {
  readonly contractVersion: 1;
  readonly providerCode: AuthoritativeDepositProofOutcomeProvider | 'unknown';
  readonly safeFactsOnly: true;
  readonly disposition: AuthoritativeDepositProofOutcomeDisposition;
  readonly reasonCode: AuthoritativeDepositProofOutcomeReasonCode;
}

type UnknownRecord = Record<string, unknown>;

type ParsedCommon = Omit<
  AuthoritativeDepositProofOutcomeCommon<AuthoritativeDepositProofOutcomeProvider>,
  'providerCode' | 'source'
> & {
  readonly providerCode: AuthoritativeDepositProofOutcomeProvider;
  readonly source: AuthoritativeDepositProofOutcomeSource;
};

const commonKeys = [
  'contractVersion',
  'proofRequestId',
  'providerCode',
  'assessmentContractVersion',
  'assessmentInputDigest',
  'assessedAt',
  'disposition',
  'reasonCode',
  'source',
  'sourceProfile',
  'observationVersion',
  'adapterVersion',
  'parserVersion',
  'normalizerVersion',
  'evidenceDigest',
  'retrievedAt',
  'advisoryOnly',
  'sqlAuthorizationAllowed',
  'transportAllowed',
  'networkAllowed',
  'databaseReadAllowed',
  'databaseWriteAllowed',
  'persistenceAllowed',
  'claimAllowed',
  'settlementAllowed',
  'enqueueAllowed',
  'executionAllowed',
  'financialActionAllowed',
  'blindRetryAllowed',
] as const;

const settlementKeys = [
  ...commonKeys,
  'lookupOutcome',
  'provenanceState',
  'receiptStatus',
  'transactionType',
  'principalAmountMinor',
  'currencyCode',
  'occurredAt',
  'receiverRevisionId',
  'receiverRevisionVersion',
  'receiverIdentityDigest',
  'receiverMatchBasis',
  'canonicalReference',
] as const;

const protectedReferenceKeys = [
  'protectionProfileVersion',
  'encryptionKeyVersion',
  'ciphertext',
  'fingerprint',
  'masked',
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_LABEL_PATTERN = /^[a-z][a-z0-9_-]{0,95}(?:[-_]v[0-9]+)$/u;
const PRINCIPAL_MINOR_PATTERN = /^[1-9][0-9]{0,15}$/u;
const PROTECTED_REFERENCE_MASK_PATTERN = /^\*\*\*[A-Z0-9]{4}$/u;
const PROTECTED_REFERENCE_CIPHERTEXT_PATTERN =
  /^v2\.(cbe_birr|telebirr)\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$/u;

const rejectReasonCodes = new Set<AuthoritativeDepositProofOutcomeRejectReasonCode>(
  AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REJECT_REASON_CODES,
);
const reviewReasonCodes = new Set<AuthoritativeDepositProofOutcomeReviewReasonCode>(
  AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_REVIEW_REASON_CODES,
);

const disabledCapabilities: DisabledAuthoritativeDepositProofOutcomeCapabilities = Object.freeze({
  advisoryOnly: true as const,
  sqlAuthorizationAllowed: AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CAN_AUTHORIZE_SQL,
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

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function parseCanonicalUtcTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : undefined;
}

function parsePattern(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function sourceForProvider(
  providerCode: AuthoritativeDepositProofOutcomeProvider,
): AuthoritativeDepositProofOutcomeSource {
  return providerCode === 'cbe_birr' ? 'cbe_birr_official_receipt' : 'telebirr_official_receipt';
}

function hasDisabledCapabilities(candidate: UnknownRecord): boolean {
  return (
    ownDataValue(candidate, 'advisoryOnly') === true &&
    ownDataValue(candidate, 'sqlAuthorizationAllowed') === false &&
    ownDataValue(candidate, 'transportAllowed') === false &&
    ownDataValue(candidate, 'networkAllowed') === false &&
    ownDataValue(candidate, 'databaseReadAllowed') === false &&
    ownDataValue(candidate, 'databaseWriteAllowed') === false &&
    ownDataValue(candidate, 'persistenceAllowed') === false &&
    ownDataValue(candidate, 'claimAllowed') === false &&
    ownDataValue(candidate, 'settlementAllowed') === false &&
    ownDataValue(candidate, 'enqueueAllowed') === false &&
    ownDataValue(candidate, 'executionAllowed') === false &&
    ownDataValue(candidate, 'financialActionAllowed') === false &&
    ownDataValue(candidate, 'blindRetryAllowed') === false
  );
}

function parseCommon(candidate: UnknownRecord): ParsedCommon | undefined {
  const proofRequestId = parsePattern(ownDataValue(candidate, 'proofRequestId'), UUID_PATTERN);
  const providerCodeValue = ownDataValue(candidate, 'providerCode');
  const providerCode =
    providerCodeValue === 'cbe_birr' || providerCodeValue === 'telebirr'
      ? providerCodeValue
      : undefined;
  const assessmentInputDigest = parsePattern(
    ownDataValue(candidate, 'assessmentInputDigest'),
    SHA256_DIGEST_PATTERN,
  );
  const assessedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'assessedAt'));
  const sourceProfile = parsePattern(
    ownDataValue(candidate, 'sourceProfile'),
    VERSION_LABEL_PATTERN,
  );
  const adapterVersion = parsePattern(
    ownDataValue(candidate, 'adapterVersion'),
    VERSION_LABEL_PATTERN,
  );
  const parserVersion = parsePattern(
    ownDataValue(candidate, 'parserVersion'),
    VERSION_LABEL_PATTERN,
  );
  const normalizerVersion = parsePattern(
    ownDataValue(candidate, 'normalizerVersion'),
    VERSION_LABEL_PATTERN,
  );
  const evidenceDigest = parsePattern(
    ownDataValue(candidate, 'evidenceDigest'),
    SHA256_DIGEST_PATTERN,
  );
  const retrievedAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'retrievedAt'));

  if (
    ownDataValue(candidate, 'contractVersion') !==
      AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION ||
    !proofRequestId ||
    !providerCode ||
    ownDataValue(candidate, 'assessmentContractVersion') !== 1 ||
    !assessmentInputDigest ||
    !assessedAt ||
    ownDataValue(candidate, 'source') !== sourceForProvider(providerCode) ||
    !sourceProfile ||
    ownDataValue(candidate, 'observationVersion') !== 1 ||
    !adapterVersion ||
    !parserVersion ||
    !normalizerVersion ||
    !evidenceDigest ||
    !retrievedAt ||
    !hasDisabledCapabilities(candidate)
  ) {
    return undefined;
  }

  return {
    contractVersion: AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION,
    proofRequestId,
    providerCode,
    assessmentContractVersion: 1 as const,
    assessmentInputDigest,
    assessedAt,
    source: sourceForProvider(providerCode),
    sourceProfile,
    observationVersion: 1 as const,
    adapterVersion,
    parserVersion,
    normalizerVersion,
    evidenceDigest,
    retrievedAt,
    ...disabledCapabilities,
  };
}

function parseProtectedCanonicalReference(
  candidate: unknown,
  providerCode: AuthoritativeDepositProofOutcomeProvider,
): AuthoritativeDepositProofProtectedCanonicalReference | undefined {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, protectedReferenceKeys)
  ) {
    return undefined;
  }

  const ciphertext = parsePattern(
    ownDataValue(candidate, 'ciphertext'),
    PROTECTED_REFERENCE_CIPHERTEXT_PATTERN,
  );
  const fingerprint = parsePattern(ownDataValue(candidate, 'fingerprint'), FINGERPRINT_PATTERN);
  const masked = parsePattern(ownDataValue(candidate, 'masked'), PROTECTED_REFERENCE_MASK_PATTERN);
  if (
    ownDataValue(candidate, 'protectionProfileVersion') !==
      AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_PROTECTION_PROFILE_VERSION ||
    ownDataValue(candidate, 'encryptionKeyVersion') !==
      AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_KEY_VERSION ||
    !ciphertext ||
    ciphertext.split('.', 3)[1] !== providerCode ||
    !fingerprint ||
    !masked
  ) {
    return undefined;
  }

  return {
    protectionProfileVersion: AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_PROTECTION_PROFILE_VERSION,
    encryptionKeyVersion: AUTHORITATIVE_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_KEY_VERSION,
    ciphertext,
    fingerprint,
    masked,
  };
}

function parseSettlementCandidate(
  candidate: UnknownRecord,
): AuthoritativeDepositProofSettlementCandidate | undefined {
  if (!hasExactEnumerableDataKeys(candidate, settlementKeys)) return undefined;
  const common = parseCommon(candidate);
  if (!common) return undefined;

  const principalAmountMinor = parsePattern(
    ownDataValue(candidate, 'principalAmountMinor'),
    PRINCIPAL_MINOR_PATTERN,
  );
  const occurredAt = parseCanonicalUtcTimestamp(ownDataValue(candidate, 'occurredAt'));
  const receiverRevisionId = parsePattern(
    ownDataValue(candidate, 'receiverRevisionId'),
    UUID_PATTERN,
  );
  const receiverRevisionVersion = ownDataValue(candidate, 'receiverRevisionVersion');
  const receiverIdentityDigest = parsePattern(
    ownDataValue(candidate, 'receiverIdentityDigest'),
    SHA256_DIGEST_PATTERN,
  );
  const receiverMatchBasis = ownDataValue(candidate, 'receiverMatchBasis');
  const canonicalReference = parseProtectedCanonicalReference(
    ownDataValue(candidate, 'canonicalReference'),
    common.providerCode,
  );
  const requiredReceiverMatchBasis =
    common.providerCode === 'cbe_birr' ? 'exact_account_identifier' : 'exact_full_name';

  if (
    ownDataValue(candidate, 'disposition') !== 'settlement_candidate' ||
    ownDataValue(candidate, 'reasonCode') !== 'exact_proof_match' ||
    ownDataValue(candidate, 'lookupOutcome') !== 'found' ||
    ownDataValue(candidate, 'provenanceState') !== 'exact' ||
    ownDataValue(candidate, 'receiptStatus') !== 'completed' ||
    ownDataValue(candidate, 'transactionType') !== 'send_money' ||
    !principalAmountMinor ||
    ownDataValue(candidate, 'currencyCode') !== 'ETB' ||
    !occurredAt ||
    !receiverRevisionId ||
    !Number.isSafeInteger(receiverRevisionVersion) ||
    (receiverRevisionVersion as number) <= 0 ||
    !receiverIdentityDigest ||
    receiverMatchBasis !== requiredReceiverMatchBasis ||
    !canonicalReference
  ) {
    return undefined;
  }

  return deepFreeze({
    ...common,
    disposition: 'settlement_candidate' as const,
    reasonCode: 'exact_proof_match' as const,
    lookupOutcome: 'found' as const,
    provenanceState: 'exact' as const,
    receiptStatus: 'completed' as const,
    transactionType: 'send_money' as const,
    principalAmountMinor,
    currencyCode: 'ETB' as const,
    occurredAt,
    receiverRevisionId,
    receiverRevisionVersion: receiverRevisionVersion as number,
    receiverIdentityDigest,
    receiverMatchBasis: requiredReceiverMatchBasis,
    canonicalReference,
  }) as AuthoritativeDepositProofSettlementCandidate;
}

function parseNonSettlementCandidate(
  candidate: UnknownRecord,
):
  | AuthoritativeDepositProofDefiniteRejectCandidate
  | AuthoritativeDepositProofReviewCandidate
  | undefined {
  if (!hasExactEnumerableDataKeys(candidate, commonKeys)) return undefined;
  const common = parseCommon(candidate);
  if (!common) return undefined;
  const disposition = ownDataValue(candidate, 'disposition');
  const reasonCode = ownDataValue(candidate, 'reasonCode');

  if (
    disposition === 'definite_reject' &&
    typeof reasonCode === 'string' &&
    rejectReasonCodes.has(reasonCode as AuthoritativeDepositProofOutcomeRejectReasonCode)
  ) {
    return deepFreeze({
      ...common,
      disposition: 'definite_reject' as const,
      reasonCode: reasonCode as AuthoritativeDepositProofOutcomeRejectReasonCode,
    }) as AuthoritativeDepositProofDefiniteRejectCandidate;
  }

  if (
    disposition === 'review_required' &&
    typeof reasonCode === 'string' &&
    reviewReasonCodes.has(reasonCode as AuthoritativeDepositProofOutcomeReviewReasonCode)
  ) {
    return deepFreeze({
      ...common,
      disposition: 'review_required' as const,
      reasonCode: reasonCode as AuthoritativeDepositProofOutcomeReviewReasonCode,
    }) as AuthoritativeDepositProofReviewCandidate;
  }

  return undefined;
}

/**
 * Reconstructs an exact, deeply frozen candidate or returns `undefined`. Callers must route
 * `undefined` to review. Neither a returned candidate nor this validator can authorize SQL.
 */
export function validatedAuthoritativeDepositProofOutcomeCandidate(
  candidate: unknown,
): AuthoritativeDepositProofOutcomeCandidate | undefined {
  try {
    if (!isPlainNonProxyRecord(candidate)) return undefined;
    const dispositionDescriptor = Object.getOwnPropertyDescriptor(candidate, 'disposition');
    if (
      dispositionDescriptor?.enumerable !== true ||
      !Object.hasOwn(dispositionDescriptor, 'value')
    ) {
      return undefined;
    }
    return dispositionDescriptor.value === 'settlement_candidate'
      ? parseSettlementCandidate(candidate)
      : parseNonSettlementCandidate(candidate);
  } catch {
    return undefined;
  }
}

const invalidLogProjection: RedactedAuthoritativeDepositProofOutcomeLogProjection = deepFreeze({
  contractVersion: AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION,
  providerCode: 'unknown' as const,
  safeFactsOnly: true as const,
  disposition: 'review_required' as const,
  reasonCode: 'invalid_assessment_input' as const,
  ...disabledCapabilities,
});

/**
 * Constant-key, deeply frozen projection that omits proof IDs, amounts, timestamps, digests,
 * receiver facts, ciphertext, fingerprints, masks, and all provider material. Invalid input is a
 * fixed fail-closed review projection with blind retries disabled.
 */
export function redactedAuthoritativeDepositProofOutcomeForLog(
  candidate: unknown,
): RedactedAuthoritativeDepositProofOutcomeLogProjection {
  const parsed = validatedAuthoritativeDepositProofOutcomeCandidate(candidate);
  if (!parsed) return invalidLogProjection;
  return deepFreeze({
    contractVersion: AUTHORITATIVE_DEPOSIT_PROOF_OUTCOME_CONTRACT_VERSION,
    providerCode: parsed.providerCode,
    safeFactsOnly: true as const,
    disposition: parsed.disposition,
    reasonCode: parsed.reasonCode,
    ...disabledCapabilities,
  });
}
