import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
} from './exact-data-record.js';
import { assessRoutineTelebirrNoMoneyEvidence } from './routine-no-money-evidence.js';

/**
 * A provider-specific adapter result for the shared, provider-neutral deposit ledger.
 * It is not a payment claim: the database must recheck the paid challenge, current
 * Owner authorization, reference uniqueness, policy, and financial switches in
 * the same transaction that creates an intent/evidence/claim/job.
 */
export interface RoutineTelebirrPaidPhoneEvidence {
  readonly providerCode: 'telebirr';
  readonly candidateId: string;
  readonly challengeId: string;
  readonly referenceFingerprint: string;
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly submittedAt: string;
  readonly observedAt: string;
  readonly occurredAt: string;
  readonly retrievedAt: string;
  readonly amountMinor: number;
  readonly currencyCode: 'ETB';
  readonly sourceDocumentDigest: string;
  readonly observationBodyDigest: string;
  readonly replayIdentity: string;
}

export type RoutineTelebirrPaidPhoneAssessment =
  | Readonly<{
      disposition: 'review';
      reasonCode: string;
      financialActionAllowed: false;
      evidence: null;
      /** All assignment, enrollment, and phone signatures matched before policy review. */
      authenticatedPhoneCheck: boolean;
      /** Only an authenticated, immutable receipt mismatch can retire this sealed upload. */
      terminalReview?: true;
      terminalReasonCode?:
        | 'receiver_mismatch'
        | 'reference_mismatch'
        | 'old_receipt'
        | 'explicit_invalid_reference'
        | 'provider_status_not_completed'
        | 'amount_out_of_range';
    }>
  | Readonly<{
      disposition: 'paid_phone_observation_matches_policy';
      reasonCode: 'signed_paid_phone_receipt_matches_policy';
      financialActionAllowed: false;
      evidence: RoutineTelebirrPaidPhoneEvidence;
    }>
  | Readonly<{
      disposition: 'paid_phone_observation_requires_owner_approval';
      reasonCode: 'old_receipt';
      financialActionAllowed: false;
      evidence: RoutineTelebirrPaidPhoneEvidence;
    }>;

const INPUT_KEYS = [
  'assessedAt',
  'trustedLookup',
  'trustedRawReference',
  'trustedSigner',
  'deviceEnrollment',
  'signedAssignment',
  'signedObservation',
  'trustedIssuanceMode',
] as const;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
// The two exact public official HTML error pages attested by the paired phone
// (305 and 300 bytes). Keep this in sync with OfficialReceiptTransport and the
// terminal-result database constraint. Changed pages remain review-only.
const EXPLICIT_INVALID_PAGE_DIGESTS = new Set([
  'sha256:91afbccab306bb594b924b41b38a065c02e39e8ef89f97c2edd21b1b1006b3b2',
  'sha256:cdc7494ceb7b145858e52bef7f76607373b8c523b2430590859066ac3ae2b707',
]);
const NO_RECEIVER_DIGEST = `sha256:${'0'.repeat(64)}`;

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function review(
  reasonCode: string,
  terminalReasonCode:
    | 'receiver_mismatch'
    | 'reference_mismatch'
    | 'old_receipt'
    | 'explicit_invalid_reference'
    | 'provider_status_not_completed'
    | 'amount_out_of_range'
    | null = null,
  authenticatedPhoneCheck = false,
): RoutineTelebirrPaidPhoneAssessment {
  return Object.freeze({
    disposition: 'review',
    reasonCode,
    financialActionAllowed: false,
    evidence: null,
    authenticatedPhoneCheck,
    ...(terminalReasonCode ? { terminalReview: true as const, terminalReasonCode } : {}),
  });
}

function immutableReceiptMismatch(
  lookupCandidate: unknown,
  observationCandidate: unknown,
):
  | 'receiver_mismatch'
  | 'reference_mismatch'
  | 'old_receipt'
  | 'explicit_invalid_reference'
  | 'provider_status_not_completed'
  | 'amount_out_of_range'
  | null {
  if (!isPlainNonProxyRecord(lookupCandidate) || !isPlainNonProxyRecord(observationCandidate))
    return null;
  const body = ownDataValue(observationCandidate, 'body');
  if (!isPlainNonProxyRecord(body)) return null;
  const facts = ownDataValue(body, 'facts');
  if (!isPlainNonProxyRecord(facts)) return null;
  const submittedAt = ownDataValue(lookupCandidate, 'submittedAt');
  const occurredAt = ownDataValue(facts, 'occurredAt');
  const retrievedAt = ownDataValue(facts, 'retrievedAt');
  const sourceDocumentDigest = ownDataValue(body, 'sourceDocumentDigest');
  if (
    ownDataValue(body, 'contractVersion') === 2 &&
    typeof sourceDocumentDigest === 'string' &&
    EXPLICIT_INVALID_PAGE_DIGESTS.has(sourceDocumentDigest) &&
    ownDataValue(facts, 'sourceOriginAttestation') === 'official_tls_origin' &&
    ownDataValue(facts, 'sourceProfile') === 'telebirr_official_receipt_v1' &&
    ownDataValue(facts, 'amountMinor') === 0 &&
    ownDataValue(facts, 'canonicalReferencePresent') === false &&
    ownDataValue(facts, 'creditedPartyNameDigest') === NO_RECEIVER_DIGEST &&
    ownDataValue(facts, 'currencyCode') === 'unknown' &&
    ownDataValue(facts, 'evidenceSource') === 'provider_receipt_lookup' &&
    occurredAt === retrievedAt &&
    retrievedAt === ownDataValue(body, 'observedAt') &&
    ownDataValue(facts, 'paymentChannel') === 'unknown' &&
    ownDataValue(facts, 'paymentMode') === 'unknown' &&
    ownDataValue(facts, 'paymentReason') === 'unknown' &&
    ownDataValue(facts, 'providerFinalStatus') === 'unknown' &&
    ownDataValue(facts, 'providerIdentity') === 'matched' &&
    ownDataValue(facts, 'receiverMatch') === 'unknown' &&
    ownDataValue(facts, 'referenceMatch') === 'unknown'
  )
    return 'explicit_invalid_reference';
  if (
    ownDataValue(facts, 'sourceProfile') !== 'telebirr_official_receipt_v1' ||
    ownDataValue(facts, 'evidenceSource') !== 'provider_receipt_lookup' ||
    ownDataValue(facts, 'providerIdentity') !== 'matched' ||
    ownDataValue(facts, 'canonicalReferencePresent') !== true
  )
    return null;
  if (ownDataValue(facts, 'referenceMatch') === 'mismatched') return 'reference_mismatch';
  if (
    ownDataValue(facts, 'referenceMatch') === 'matched' &&
    ownDataValue(facts, 'receiverMatch') === 'mismatched' &&
    ownDataValue(facts, 'creditedPartyNameDigest') !==
      ownDataValue(lookupCandidate, 'expectedReceiverNameDigest')
  )
    return 'receiver_mismatch';
  if (ownDataValue(facts, 'referenceMatch') !== 'matched') return null;
  const providerStatus = ownDataValue(facts, 'providerFinalStatus');
  if (providerStatus === 'pending' || providerStatus === 'failed' || providerStatus === 'reversed')
    return 'provider_status_not_completed';
  if (ownDataValue(facts, 'currencyCode') !== 'ETB') return null;
  const amountMinor = ownDataValue(facts, 'amountMinor');
  if (typeof amountMinor === 'number' && Number.isSafeInteger(amountMinor)) {
    if (amountMinor < 2500 || amountMinor > 2_500_000) return 'amount_out_of_range';
  }
  if (
    utc(submittedAt) &&
    utc(occurredAt) &&
    Date.parse(occurredAt) < Date.parse(submittedAt) - 3_600_000
  )
    return 'old_receipt';
  return null;
}

/**
 * The issuance mode must come from the protected challenge row, not an upload.
 * The paired phone's signed official-receipt reading is the TeleBirr authority
 * chosen by the Owner; this does not confer authority on CBE Birr or CBE bank.
 */
export function assessRoutineTelebirrPaidPhoneEvidence(
  candidate: unknown,
  trustedSignerSpkiDer: unknown,
  enrolledDeviceSpkiDer: unknown,
): RoutineTelebirrPaidPhoneAssessment {
  try {
    if (!isPlainNonProxyRecord(candidate) || !hasExactEnumerableDataKeys(candidate, INPUT_KEYS)) {
      return review('invalid_request');
    }
    if (ownDataValue(candidate, 'trustedIssuanceMode') !== 'paid') {
      return review('no_money_challenge');
    }
    const observation = ownDataValue(candidate, 'signedObservation');
    const body = isPlainNonProxyRecord(observation) && ownDataValue(observation, 'body');
    const observedAt = isPlainNonProxyRecord(body) && ownDataValue(body, 'observedAt');
    const assessedAt = ownDataValue(candidate, 'assessedAt');
    if (!utc(observedAt) || !utc(assessedAt)) return review('invalid_request');
    const assessedMillis = Date.parse(assessedAt);
    const observedMillis = Date.parse(observedAt);
    // A signed phone read may be retried after the five-minute lookup expires.
    // Authenticate it at its signed observation time, but separately bound the
    // server upload delay and one-hour funding window at the real server time.
    if (observedMillis > assessedMillis + 5_000 || assessedMillis >= observedMillis + 15 * 60_000)
      return review('upload_expired');
    const checked = assessRoutineTelebirrNoMoneyEvidence(
      {
        assessedAt: observedAt,
        trustedLookup: ownDataValue(candidate, 'trustedLookup'),
        trustedRawReference: ownDataValue(candidate, 'trustedRawReference'),
        trustedSigner: ownDataValue(candidate, 'trustedSigner'),
        deviceEnrollment: ownDataValue(candidate, 'deviceEnrollment'),
        signedAssignment: ownDataValue(candidate, 'signedAssignment'),
        signedObservation: ownDataValue(candidate, 'signedObservation'),
      },
      trustedSignerSpkiDer,
      enrolledDeviceSpkiDer,
      true,
    );
    if (
      checked.disposition !== 'would_forward_signed_evidence' ||
      !checked.serverSignatureVerified ||
      !checked.deviceSignatureVerified ||
      !checked.providedSnapshotMatched ||
      !checked.replayIdentity
    ) {
      const terminalReasonCode =
        checked.reasonCode === 'receipt_policy_review' &&
        checked.serverSignatureVerified &&
        checked.deviceSignatureVerified &&
        checked.providedSnapshotMatched &&
        checked.phoneOfficialOriginAttested &&
        immutableReceiptMismatch(
          ownDataValue(candidate, 'trustedLookup'),
          ownDataValue(candidate, 'signedObservation'),
        );
      return review(
        checked.reasonCode,
        terminalReasonCode || null,
        checked.serverSignatureVerified &&
          checked.deviceSignatureVerified &&
          checked.providedSnapshotMatched,
      );
    }
    // Version 1 remains usable for no-money review, never for a paid decision.
    // Version 2 signs the fixed official TLS-origin assertion in the same fact
    // transcript as the receipt and is accepted only with the enrolled key.
    if (!checked.phoneOfficialOriginAttested) {
      return review('official_origin_attestation_missing', null, true);
    }

    const lookup = ownDataValue(candidate, 'trustedLookup');
    if (!isPlainNonProxyRecord(lookup) || !isPlainNonProxyRecord(observation)) {
      return review('invalid_request');
    }
    if (!isPlainNonProxyRecord(body)) return review('invalid_request');
    const facts = ownDataValue(body, 'facts');
    if (!isPlainNonProxyRecord(facts)) return review('invalid_request');
    const sourceDocumentDigest = ownDataValue(body, 'sourceDocumentDigest');
    const observationBodyDigest = ownDataValue(observation, 'bodyDigest');
    const occurredAt = ownDataValue(facts, 'occurredAt');
    if (
      typeof sourceDocumentDigest !== 'string' ||
      !DIGEST.test(sourceDocumentDigest) ||
      typeof observationBodyDigest !== 'string' ||
      !DIGEST.test(observationBodyDigest) ||
      typeof occurredAt !== 'string'
    ) {
      return review('invalid_request');
    }
    const submittedAt = ownDataValue(lookup, 'submittedAt');
    if (!utc(submittedAt)) return review('invalid_request');
    const olderThanHourAtSubmission = Date.parse(occurredAt) < Date.parse(submittedAt) - 3_600_000;
    // A receipt that was fresh at submission but expired before upload is an
    // inconclusive check. Only an already-old, otherwise valid signed receipt
    // enters the separate Owner-approval inbox.
    if (
      !olderThanHourAtSubmission &&
      Date.parse(assessedAt) >= Date.parse(occurredAt) + 3_600_000
    ) {
      return review('payment_expired', null, true);
    }

    const evidence = Object.freeze({
      providerCode: 'telebirr',
      candidateId: ownDataValue(body, 'candidateId') as string,
      challengeId: ownDataValue(body, 'challengeId') as string,
      referenceFingerprint: ownDataValue(body, 'referenceFingerprint') as string,
      receiverRevisionId: ownDataValue(body, 'receiverRevisionId') as string,
      receiverVersion: ownDataValue(body, 'receiverVersion') as number,
      submittedAt: ownDataValue(lookup, 'submittedAt') as string,
      observedAt: ownDataValue(body, 'observedAt') as string,
      occurredAt,
      retrievedAt: ownDataValue(facts, 'retrievedAt') as string,
      amountMinor: ownDataValue(facts, 'amountMinor') as number,
      currencyCode: 'ETB',
      sourceDocumentDigest,
      observationBodyDigest,
      replayIdentity: checked.replayIdentity,
    });
    if (olderThanHourAtSubmission)
      return Object.freeze({
        disposition: 'paid_phone_observation_requires_owner_approval',
        reasonCode: 'old_receipt',
        financialActionAllowed: false,
        evidence,
      });
    return Object.freeze({
      disposition: 'paid_phone_observation_matches_policy',
      reasonCode: 'signed_paid_phone_receipt_matches_policy',
      financialActionAllowed: false,
      evidence,
    });
  } catch {
    return review('invalid_request');
  }
}
