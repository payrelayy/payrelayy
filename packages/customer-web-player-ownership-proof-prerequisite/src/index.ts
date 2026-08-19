import { isProxy } from 'node:util/types';

/**
 * Pure prerequisite inventory for customer-web Player-ID ownership proof. This package cannot
 * issue or deliver a challenge, accept or verify evidence, persist proof material, review a
 * request, associate a Player ID, make a Player ID ready or deposit-eligible, contact KemerBet,
 * mutate schema, wire a runtime, or perform a financial action. It only records why the separately
 * reviewed proof boundary cannot begin.
 */
export const CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION = 3 as const;

export const CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS = Object.freeze([
  'authoritative_platform_control_signal_unproven',
  'challenge_profile_unselected',
  'challenge_delivery_path_unselected',
  'evidence_profile_unselected',
  'evidence_freshness_replay_attempt_and_abuse_policy_unreviewed',
  'verification_adapter_absent',
  'neutral_staff_proof_review_capability_absent',
  'ownership_conflict_recovery_and_reassignment_policy_unreviewed',
  'owner_deposit_eligibility_decision_required',
] as const);

export type CustomerWebPlayerOwnershipProofRemainingBlocker =
  (typeof CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS)[number];

export interface CustomerWebPlayerOwnershipProofPrerequisiteRequest {
  readonly contractVersion: typeof CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION;
  readonly platformCode: 'kemerbet';
  readonly requestOrigin: 'customer_web';
  readonly challengeProfile: 'unselected';
  readonly evidenceProfile: 'unselected';
}

interface CustomerWebPlayerOwnershipProofDisabledCapabilities {
  readonly challengeIssuanceAllowed: false;
  readonly challengeDeliveryAllowed: false;
  readonly evidenceAcceptanceAllowed: false;
  readonly evidenceVerificationAllowed: false;
  readonly evidencePersistenceAllowed: false;
  readonly passwordAcceptanceAllowed: false;
  readonly otpAcceptanceAllowed: false;
  readonly recoveryCodeAcceptanceAllowed: false;
  readonly providerSessionAcceptanceAllowed: false;
  readonly staffReviewAllowed: false;
  readonly ownershipAssociationAllowed: false;
  readonly playerBindingAllowed: false;
  readonly readyStatusAllowed: false;
  readonly depositEligibilityAllowed: false;
  readonly databaseAllowed: false;
  readonly networkAllowed: false;
  readonly schemaMutationAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly financialActionAllowed: false;
}

export interface CustomerWebPlayerOwnershipProofBlockedResult
  extends
    CustomerWebPlayerOwnershipProofPrerequisiteRequest,
    CustomerWebPlayerOwnershipProofDisabledCapabilities {
  readonly advisoryOnly: true;
  readonly disposition: 'blocked';
  readonly reasonCode: 'customer_web_player_ownership_proof_prerequisites_incomplete';
  readonly remainingBlockers: typeof CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS;
}

export interface CustomerWebPlayerOwnershipProofInvalidResult extends CustomerWebPlayerOwnershipProofDisabledCapabilities {
  readonly contractVersion: typeof CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION;
  readonly platformCode: 'kemerbet';
  readonly requestOrigin: 'customer_web';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_request';
  readonly reasonCode: 'invalid_request';
}

export type CustomerWebPlayerOwnershipProofPrerequisiteResult =
  CustomerWebPlayerOwnershipProofBlockedResult | CustomerWebPlayerOwnershipProofInvalidResult;

export type RedactedCustomerWebPlayerOwnershipProofBlockedLogProjection =
  CustomerWebPlayerOwnershipProofBlockedResult;

export interface RedactedCustomerWebPlayerOwnershipProofInvalidLogProjection {
  readonly contractVersion: typeof CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION;
  readonly platformCode: 'kemerbet';
  readonly requestOrigin: 'customer_web';
  readonly advisoryOnly: true;
  readonly disposition: 'invalid_result';
  readonly reasonCode: 'invalid_result';
}

export type RedactedCustomerWebPlayerOwnershipProofPrerequisiteLogProjection =
  | RedactedCustomerWebPlayerOwnershipProofBlockedLogProjection
  | RedactedCustomerWebPlayerOwnershipProofInvalidLogProjection;

type UnknownRecord = Record<string, unknown>;

const requestKeys = [
  'contractVersion',
  'platformCode',
  'requestOrigin',
  'challengeProfile',
  'evidenceProfile',
] as const;

const disabledCapabilityKeys = [
  'challengeIssuanceAllowed',
  'challengeDeliveryAllowed',
  'evidenceAcceptanceAllowed',
  'evidenceVerificationAllowed',
  'evidencePersistenceAllowed',
  'passwordAcceptanceAllowed',
  'otpAcceptanceAllowed',
  'recoveryCodeAcceptanceAllowed',
  'providerSessionAcceptanceAllowed',
  'staffReviewAllowed',
  'ownershipAssociationAllowed',
  'playerBindingAllowed',
  'readyStatusAllowed',
  'depositEligibilityAllowed',
  'databaseAllowed',
  'networkAllowed',
  'schemaMutationAllowed',
  'runtimeWiringAllowed',
  'financialActionAllowed',
] as const;

const blockedResultKeys = [
  ...requestKeys,
  'advisoryOnly',
  'disposition',
  'reasonCode',
  'remainingBlockers',
  ...disabledCapabilityKeys,
] as const;

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
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
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value')
    );
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function isExactBlockerTuple(
  candidate: unknown,
): candidate is typeof CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    isProxy(candidate) ||
    !Array.isArray(candidate) ||
    Object.getPrototypeOf(candidate) !== Array.prototype
  ) {
    return false;
  }

  const expectedKeys = [
    ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS.map((_, index) => String(index)),
    'length',
  ];
  const actualKeys = Reflect.ownKeys(candidate);
  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
  if (
    lengthDescriptor === undefined ||
    lengthDescriptor.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS.length
  ) {
    return false;
  }

  return CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS.every((blocker, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value') &&
      descriptor.value === blocker
    );
  });
}

function hasAllDisabledCapabilities(candidate: UnknownRecord): boolean {
  return disabledCapabilityKeys.every((key) => ownDataValue(candidate, key) === false);
}

function isExactRequest(
  candidate: unknown,
): candidate is CustomerWebPlayerOwnershipProofPrerequisiteRequest {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, requestKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION &&
    ownDataValue(candidate, 'platformCode') === 'kemerbet' &&
    ownDataValue(candidate, 'requestOrigin') === 'customer_web' &&
    ownDataValue(candidate, 'challengeProfile') === 'unselected' &&
    ownDataValue(candidate, 'evidenceProfile') === 'unselected'
  );
}

function isExactBlockedResult(
  candidate: unknown,
): candidate is CustomerWebPlayerOwnershipProofBlockedResult {
  return (
    isPlainNonProxyRecord(candidate) &&
    hasExactEnumerableDataKeys(candidate, blockedResultKeys) &&
    ownDataValue(candidate, 'contractVersion') ===
      CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION &&
    ownDataValue(candidate, 'platformCode') === 'kemerbet' &&
    ownDataValue(candidate, 'requestOrigin') === 'customer_web' &&
    ownDataValue(candidate, 'challengeProfile') === 'unselected' &&
    ownDataValue(candidate, 'evidenceProfile') === 'unselected' &&
    ownDataValue(candidate, 'advisoryOnly') === true &&
    ownDataValue(candidate, 'disposition') === 'blocked' &&
    ownDataValue(candidate, 'reasonCode') ===
      'customer_web_player_ownership_proof_prerequisites_incomplete' &&
    isExactBlockerTuple(ownDataValue(candidate, 'remainingBlockers')) &&
    hasAllDisabledCapabilities(candidate)
  );
}

const disabledCapabilities: CustomerWebPlayerOwnershipProofDisabledCapabilities = {
  challengeIssuanceAllowed: false,
  challengeDeliveryAllowed: false,
  evidenceAcceptanceAllowed: false,
  evidenceVerificationAllowed: false,
  evidencePersistenceAllowed: false,
  passwordAcceptanceAllowed: false,
  otpAcceptanceAllowed: false,
  recoveryCodeAcceptanceAllowed: false,
  providerSessionAcceptanceAllowed: false,
  staffReviewAllowed: false,
  ownershipAssociationAllowed: false,
  playerBindingAllowed: false,
  readyStatusAllowed: false,
  depositEligibilityAllowed: false,
  databaseAllowed: false,
  networkAllowed: false,
  schemaMutationAllowed: false,
  runtimeWiringAllowed: false,
  financialActionAllowed: false,
};

/** The sole result for the exact metadata request. Every operational capability remains off. */
export const CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT: CustomerWebPlayerOwnershipProofBlockedResult =
  Object.freeze({
    contractVersion: CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    requestOrigin: 'customer_web' as const,
    challengeProfile: 'unselected' as const,
    evidenceProfile: 'unselected' as const,
    advisoryOnly: true as const,
    disposition: 'blocked' as const,
    reasonCode: 'customer_web_player_ownership_proof_prerequisites_incomplete' as const,
    remainingBlockers: CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_REMAINING_BLOCKERS,
    ...disabledCapabilities,
  });

/** A distinct fixed, fail-closed result for every malformed or hostile request. */
export const CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT: CustomerWebPlayerOwnershipProofInvalidResult =
  Object.freeze({
    contractVersion: CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    requestOrigin: 'customer_web' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_request' as const,
    reasonCode: 'invalid_request' as const,
    ...disabledCapabilities,
  });

const blockedLogProjection: RedactedCustomerWebPlayerOwnershipProofBlockedLogProjection =
  Object.freeze({ ...CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT });

const invalidLogProjection: RedactedCustomerWebPlayerOwnershipProofInvalidLogProjection =
  Object.freeze({
    contractVersion: CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_PREREQUISITE_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    requestOrigin: 'customer_web' as const,
    advisoryOnly: true as const,
    disposition: 'invalid_result' as const,
    reasonCode: 'invalid_result' as const,
  });

/** Evaluates untrusted metadata without accepting, reading, or echoing proof material. */
export function evaluateCustomerWebPlayerOwnershipProofPrerequisites(
  requestCandidate: unknown,
): CustomerWebPlayerOwnershipProofPrerequisiteResult {
  try {
    return isExactRequest(requestCandidate)
      ? CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_BLOCKED_RESULT
      : CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT;
  } catch {
    return CUSTOMER_WEB_PLAYER_OWNERSHIP_PROOF_INVALID_RESULT;
  }
}

/** Revalidates an untrusted result and returns only one fixed, allowlisted log projection. */
export function redactedCustomerWebPlayerOwnershipProofPrerequisiteForLog(
  resultCandidate: unknown,
): RedactedCustomerWebPlayerOwnershipProofPrerequisiteLogProjection {
  try {
    return isExactBlockedResult(resultCandidate) ? blockedLogProjection : invalidLogProjection;
  } catch {
    return invalidLogProjection;
  }
}
