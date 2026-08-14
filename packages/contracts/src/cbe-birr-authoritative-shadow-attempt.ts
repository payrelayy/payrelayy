import { isProxy } from 'node:util/types';

import {
  validatedCbeBirrAuthoritativeAdapterResult,
  type CbeBirrAuthoritativeAdapterEvidence,
} from './cbe-birr-authoritative-adapter.js';
import {
  CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
  evaluateCbeBirrAuthoritativeShadow,
  type CbeBirrAuthoritativeShadowDecision,
  type CbeBirrAuthoritativeShadowIntentFacts,
  type CbeBirrAuthoritativeShadowEvidence,
} from './cbe-birr-authoritative-shadow.js';

/**
 * Pure Stage 1C composition contract. It validates safe adapter facts and plans only an advisory
 * outcome. It has no provider transport, duplicate-reference reader, persistence, job, claim, or
 * financial-execution capability.
 */
export const CBE_BIRR_AUTHORITATIVE_SHADOW_ATTEMPT_CONTRACT_VERSION = 1 as const;

export const cbeBirrAuthoritativeShadowRetryCandidateReasonCodes = [
  'authoritative_receipt_unavailable',
  'provider_network_uncertain',
  'receipt_parse_uncertain',
] as const;

export type CbeBirrAuthoritativeShadowRetryCandidateReasonCode =
  (typeof cbeBirrAuthoritativeShadowRetryCandidateReasonCodes)[number];

type ShadowReviewDecision = Extract<
  CbeBirrAuthoritativeShadowDecision,
  { readonly outcome: 'would_review' }
>;
type ShadowRejectDecision = Extract<
  CbeBirrAuthoritativeShadowDecision,
  { readonly outcome: 'would_reject' }
>;

export type CbeBirrAuthoritativeShadowNonVerifyingDecision = Exclude<
  CbeBirrAuthoritativeShadowDecision,
  { readonly outcome: 'would_verify' }
>;

export type CbeBirrAuthoritativeShadowRetryCandidateDecision = {
  readonly contractVersion: 1;
  readonly outcome: 'would_review';
  readonly reasonCode: CbeBirrAuthoritativeShadowRetryCandidateReasonCode;
};

type CbeBirrAuthoritativeShadowTerminalReviewReasonCode = Exclude<
  ShadowReviewDecision['reasonCode'],
  CbeBirrAuthoritativeShadowRetryCandidateReasonCode
>;

export type CbeBirrAuthoritativeShadowCompleteAdvisoryDecision =
  | ShadowRejectDecision
  | {
      readonly contractVersion: 1;
      readonly outcome: 'would_review';
      readonly reasonCode: CbeBirrAuthoritativeShadowTerminalReviewReasonCode;
    };

export interface CbeBirrAuthoritativeShadowAttemptCandidate {
  readonly contractVersion: 1;
  readonly intent: CbeBirrAuthoritativeShadowIntentFacts;
  /** Strict millisecond UTC ISO timestamp. */
  readonly assessedAt: string;
  /** Treated as unknown at runtime and reconstructed by the Stage 1B safe-result validator. */
  readonly adapterResult: unknown;
}

export type CbeBirrAuthoritativeShadowAttemptPlan =
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'complete_advisory';
      readonly decision: CbeBirrAuthoritativeShadowCompleteAdvisoryDecision;
    }
  | {
      readonly contractVersion: 1;
      readonly providerCode: 'cbe_birr';
      readonly advisoryOnly: true;
      readonly disposition: 'retry_candidate';
      readonly decision: CbeBirrAuthoritativeShadowRetryCandidateDecision;
    };

type UnknownRecord = Record<string, unknown>;

const attemptCandidateKeys = ['contractVersion', 'intent', 'assessedAt', 'adapterResult'] as const;

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

function shadowEvidenceFromAdapter(
  evidence: CbeBirrAuthoritativeAdapterEvidence,
): CbeBirrAuthoritativeShadowEvidence {
  if (evidence.lookupOutcome === 'not_found') {
    return Object.freeze({ lookupOutcome: 'not_found' as const });
  }

  if (evidence.lookupOutcome === 'unavailable') {
    return Object.freeze({
      lookupOutcome: 'unavailable' as const,
      uncertainty: evidence.uncertainty,
    });
  }

  return Object.freeze({
    lookupOutcome: 'found' as const,
    evidenceSource: evidence.evidenceSource,
    providerIdentity: evidence.providerIdentity,
    providerFinalStatus: evidence.providerFinalStatus,
    canonicalReferencePresent: evidence.canonicalReferencePresent,
    amountMinor: evidence.amountMinor,
    currencyCode: evidence.currencyCode,
    receiverMatch: evidence.receiverMatch,
    paymentType: evidence.paymentType,
    occurredAt: evidence.occurredAt,
    retrievedAt: evidence.retrievedAt,
    provenance: Object.freeze({
      adapterVersionPresent: evidence.provenance.adapterVersionPresent,
      normalizationVersionPresent: evidence.provenance.normalizationVersionPresent,
      evidenceDigestPresent: evidence.provenance.evidenceDigestPresent,
    }),
    // Stage 1C has no duplicate-reference read boundary. This value is deliberately not injectable.
    duplicateCheck: 'unavailable' as const,
  });
}

function isRetryCandidateReasonCode(
  reasonCode: ShadowReviewDecision['reasonCode'],
): reasonCode is CbeBirrAuthoritativeShadowRetryCandidateReasonCode {
  return (
    reasonCode === 'authoritative_receipt_unavailable' ||
    reasonCode === 'provider_network_uncertain' ||
    reasonCode === 'receipt_parse_uncertain'
  );
}

function nonVerifyingDecision(
  decision: CbeBirrAuthoritativeShadowDecision,
): CbeBirrAuthoritativeShadowNonVerifyingDecision {
  if (decision.outcome === 'would_verify') {
    return Object.freeze({
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
      outcome: 'would_review' as const,
      reasonCode: 'duplicate_check_unavailable' as const,
    });
  }

  if (decision.outcome === 'would_reject') {
    return Object.freeze({
      contractVersion: decision.contractVersion,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    });
  }

  return Object.freeze({
    contractVersion: decision.contractVersion,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
  });
}

function planFromDecision(
  candidate: CbeBirrAuthoritativeShadowDecision,
): CbeBirrAuthoritativeShadowAttemptPlan {
  const decision = nonVerifyingDecision(candidate);
  if (decision.outcome === 'would_reject') {
    return Object.freeze({
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_ATTEMPT_CONTRACT_VERSION,
      providerCode: 'cbe_birr' as const,
      advisoryOnly: true as const,
      disposition: 'complete_advisory' as const,
      decision,
    });
  }

  const reasonCode = decision.reasonCode;
  if (isRetryCandidateReasonCode(reasonCode)) {
    const retryDecision: CbeBirrAuthoritativeShadowRetryCandidateDecision = Object.freeze({
      contractVersion: decision.contractVersion,
      outcome: decision.outcome,
      reasonCode,
    });
    return Object.freeze({
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_ATTEMPT_CONTRACT_VERSION,
      providerCode: 'cbe_birr' as const,
      advisoryOnly: true as const,
      disposition: 'retry_candidate' as const,
      decision: retryDecision,
    });
  }

  const completeDecision: CbeBirrAuthoritativeShadowCompleteAdvisoryDecision = Object.freeze({
    contractVersion: decision.contractVersion,
    outcome: decision.outcome,
    reasonCode,
  });
  return Object.freeze({
    contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_ATTEMPT_CONTRACT_VERSION,
    providerCode: 'cbe_birr' as const,
    advisoryOnly: true as const,
    disposition: 'complete_advisory' as const,
    decision: completeDecision,
  });
}

const malformedCandidateDecision: CbeBirrAuthoritativeShadowDecision = Object.freeze({
  contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
  outcome: 'would_review' as const,
  reasonCode: 'payment_fields_missing' as const,
});

/**
 * Composes a Stage 1B safe adapter result with the Stage 1A advisory evaluator. A found result is
 * always assessed with an unavailable duplicate check, so this contract cannot return
 * `would_verify`. Retry output is classification only; it does not schedule or persist anything.
 */
export function planCbeBirrAuthoritativeShadowAttempt(
  candidate: unknown,
): CbeBirrAuthoritativeShadowAttemptPlan {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, attemptCandidateKeys) ||
      ownDataValue(candidate, 'contractVersion') !==
        CBE_BIRR_AUTHORITATIVE_SHADOW_ATTEMPT_CONTRACT_VERSION
    ) {
      return planFromDecision(malformedCandidateDecision);
    }

    const intent = ownDataValue(candidate, 'intent');
    if (!isPlainNonProxyRecord(intent)) return planFromDecision(malformedCandidateDecision);

    const adapterResult = validatedCbeBirrAuthoritativeAdapterResult(
      ownDataValue(candidate, 'adapterResult'),
    );
    const decision = evaluateCbeBirrAuthoritativeShadow({
      contractVersion: CBE_BIRR_AUTHORITATIVE_SHADOW_CONTRACT_VERSION,
      intent,
      assessedAt: ownDataValue(candidate, 'assessedAt'),
      evidence: shadowEvidenceFromAdapter(adapterResult.evidence),
    });

    return planFromDecision(decision);
  } catch {
    return planFromDecision(malformedCandidateDecision);
  }
}
