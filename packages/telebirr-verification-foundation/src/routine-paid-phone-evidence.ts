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
    }>
  | Readonly<{
      disposition: 'paid_phone_observation_matches_policy';
      reasonCode: 'signed_paid_phone_receipt_matches_policy';
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

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function review(reasonCode: string): RoutineTelebirrPaidPhoneAssessment {
  return Object.freeze({
    disposition: 'review',
    reasonCode,
    financialActionAllowed: false,
    evidence: null,
  });
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
    );
    if (
      checked.disposition !== 'would_forward_signed_evidence' ||
      !checked.serverSignatureVerified ||
      !checked.deviceSignatureVerified ||
      !checked.providedSnapshotMatched ||
      !checked.replayIdentity
    ) {
      return review(checked.reasonCode);
    }
    // Version 1 remains usable for no-money review, never for a paid decision.
    // Version 2 signs the fixed official TLS-origin assertion in the same fact
    // transcript as the receipt and is accepted only with the enrolled key.
    if (!checked.phoneOfficialOriginAttested) {
      return review('official_origin_attestation_missing');
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
    // No-money observation review permits a seven-day candidate. A paid claim
    // must still be within the receipt's one-hour funding window at decision time.
    if (Date.parse(assessedAt) >= Date.parse(occurredAt) + 3_600_000) {
      return review('payment_expired');
    }

    return Object.freeze({
      disposition: 'paid_phone_observation_matches_policy',
      reasonCode: 'signed_paid_phone_receipt_matches_policy',
      financialActionAllowed: false,
      evidence: Object.freeze({
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
      }),
    });
  } catch {
    return review('invalid_request');
  }
}
