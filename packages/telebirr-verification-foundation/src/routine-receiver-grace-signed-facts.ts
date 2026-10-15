import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
} from './exact-data-record.js';
import { assessRoutineTelebirrNoMoneyEvidence } from './routine-no-money-evidence.js';
import { ROUTINE_TELEBIRR_RECEIVER_SUFFIX_OBSERVATION_TRANSCRIPT_VERSION } from './routine-signed-observation.js';

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
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SUFFIX = /^[0-9]{4}$/u;

function utcMs(value: unknown): number | null {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

/**
 * A signed phone reading of the official TLS origin is not independent server-side
 * receipt authentication. The paid database must still bind an instruction and
 * recheck all financial predicates under its one-use claim lock.
 */
export interface RoutineTelebirrReceiverGraceSignedFacts {
  readonly candidateId: string;
  readonly challengeId: string;
  readonly referenceFingerprint: string;
  readonly creditedPartyNameDigest: string;
  readonly creditedPartyVisibleSuffix: string;
  readonly occurredAt: string;
  readonly submittedAt: string;
  readonly amountMinor: number;
  readonly sourceDocumentDigest: string;
  readonly observationBodyDigest: string;
  readonly replayIdentity: string;
}

export interface RoutineTelebirrReceiverGraceSignedAssessment {
  readonly advisoryOnly: true;
  readonly sourceAuthenticationPerformed: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_preview_receiver_grace';
  readonly reasonCode:
    | 'invalid_request'
    | 'no_money_challenge'
    | 'upload_expired'
    | 'signed_evidence_unverified'
    | 'version_3_required'
    | 'receipt_not_qualifying'
    | 'payment_expired'
    | 'signed_grace_facts_available';
  readonly facts: RoutineTelebirrReceiverGraceSignedFacts | null;
}

function review(
  reasonCode: Exclude<
    RoutineTelebirrReceiverGraceSignedAssessment['reasonCode'],
    'signed_grace_facts_available'
  >,
): RoutineTelebirrReceiverGraceSignedAssessment {
  return Object.freeze({
    advisoryOnly: true,
    sourceAuthenticationPerformed: false,
    financialActionAllowed: false,
    disposition: 'would_review',
    reasonCode,
    facts: null,
  });
}

/**
 * Extracts only reviewable v3 receipt facts after both signatures, the trusted
 * challenge snapshot, and the phone's official-origin attestation have been
 * checked. A receiver mismatch against the *currently bound* wallet is allowed
 * here because the old wallet is selected later from immutable instructions and
 * all receiver revisions. No production paid path calls this helper.
 */
export function assessRoutineTelebirrReceiverGraceSignedFacts(
  inputCandidate: unknown,
  trustedSignerSpkiDer: unknown,
  enrolledDeviceSpkiDer: unknown,
): RoutineTelebirrReceiverGraceSignedAssessment {
  try {
    if (
      !isPlainNonProxyRecord(inputCandidate) ||
      !hasExactEnumerableDataKeys(inputCandidate, INPUT_KEYS)
    )
      return review('invalid_request');
    if (ownDataValue(inputCandidate, 'trustedIssuanceMode') !== 'paid') {
      return review('no_money_challenge');
    }
    const observation = ownDataValue(inputCandidate, 'signedObservation');
    const body = isPlainNonProxyRecord(observation) && ownDataValue(observation, 'body');
    const facts = isPlainNonProxyRecord(body) && ownDataValue(body, 'facts');
    const lookup = ownDataValue(inputCandidate, 'trustedLookup');
    if (
      !isPlainNonProxyRecord(observation) ||
      !isPlainNonProxyRecord(body) ||
      !isPlainNonProxyRecord(facts) ||
      !isPlainNonProxyRecord(lookup)
    )
      return review('invalid_request');
    const assessedMs = utcMs(ownDataValue(inputCandidate, 'assessedAt'));
    const observedMs = utcMs(ownDataValue(body, 'observedAt'));
    if (assessedMs === null || observedMs === null) return review('invalid_request');
    if (observedMs > assessedMs + 5_000 || assessedMs >= observedMs + 15 * 60_000) {
      return review('upload_expired');
    }

    // The existing verifier checks canonical transcripts, both signatures,
    // independent keys and challenge/enrollment bindings before receipt policy.
    // Its signed receiver-policy review is intentional here: the receipt may
    // belong to the old wallet, not the currently bound one.
    const checked = assessRoutineTelebirrNoMoneyEvidence(
      {
        assessedAt: ownDataValue(body, 'observedAt'),
        trustedLookup: lookup,
        trustedRawReference: ownDataValue(inputCandidate, 'trustedRawReference'),
        trustedSigner: ownDataValue(inputCandidate, 'trustedSigner'),
        deviceEnrollment: ownDataValue(inputCandidate, 'deviceEnrollment'),
        signedAssignment: ownDataValue(inputCandidate, 'signedAssignment'),
        signedObservation: observation,
      },
      trustedSignerSpkiDer,
      enrolledDeviceSpkiDer,
    );
    if (
      !checked.serverSignatureVerified ||
      !checked.deviceSignatureVerified ||
      !checked.providedSnapshotMatched ||
      !checked.phoneOfficialOriginAttested ||
      !checked.replayIdentity ||
      (checked.reasonCode !== 'signed_evidence_matches_policy' &&
        checked.reasonCode !== 'receipt_policy_review')
    )
      return review('signed_evidence_unverified');
    if (
      ownDataValue(observation, 'contractVersion') !== 3 ||
      ownDataValue(body, 'contractVersion') !== 3 ||
      ownDataValue(observation, 'transcriptVersion') !==
        ROUTINE_TELEBIRR_RECEIVER_SUFFIX_OBSERVATION_TRANSCRIPT_VERSION
    )
      return review('version_3_required');

    const occurredAt = ownDataValue(facts, 'occurredAt');
    const submittedAt = ownDataValue(lookup, 'submittedAt');
    const occurredMs = utcMs(occurredAt);
    const submittedMs = utcMs(submittedAt);
    const amountMinor = ownDataValue(facts, 'amountMinor');
    const nameDigest = ownDataValue(facts, 'creditedPartyNameDigest');
    const suffix = ownDataValue(facts, 'creditedPartyVisibleSuffix');
    const sourceDocumentDigest = ownDataValue(body, 'sourceDocumentDigest');
    const observationBodyDigest = ownDataValue(observation, 'bodyDigest');
    if (
      occurredMs === null ||
      submittedMs === null ||
      typeof amountMinor !== 'number' ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor < 2_500 ||
      amountMinor > 2_500_000 ||
      typeof nameDigest !== 'string' ||
      !DIGEST.test(nameDigest) ||
      typeof suffix !== 'string' ||
      !SUFFIX.test(suffix) ||
      typeof sourceDocumentDigest !== 'string' ||
      !DIGEST.test(sourceDocumentDigest) ||
      typeof observationBodyDigest !== 'string' ||
      !DIGEST.test(observationBodyDigest) ||
      ownDataValue(facts, 'canonicalReferencePresent') !== true ||
      ownDataValue(facts, 'currencyCode') !== 'ETB' ||
      ownDataValue(facts, 'evidenceSource') !== 'provider_receipt_lookup' ||
      ownDataValue(facts, 'paymentChannel') !== 'api_app' ||
      ownDataValue(facts, 'paymentMode') !== 'telebirr' ||
      ownDataValue(facts, 'paymentReason') !== 'send_money_to_registered_customer' ||
      ownDataValue(facts, 'providerFinalStatus') !== 'completed' ||
      ownDataValue(facts, 'providerIdentity') !== 'matched' ||
      !['matched', 'mismatched'].includes(ownDataValue(facts, 'receiverMatch') as string) ||
      ownDataValue(facts, 'referenceMatch') !== 'matched' ||
      ownDataValue(facts, 'retrievedAt') !== ownDataValue(body, 'observedAt') ||
      ownDataValue(facts, 'sourceProfile') !== 'telebirr_official_receipt_v1' ||
      ownDataValue(facts, 'sourceOriginAttestation') !== 'official_tls_origin' ||
      occurredMs > submittedMs ||
      occurredMs > observedMs ||
      assessedMs < submittedMs
    )
      return review('receipt_not_qualifying');
    if (submittedMs >= occurredMs + 3_600_000 || assessedMs >= occurredMs + 3_600_000) {
      return review('payment_expired');
    }

    return Object.freeze({
      advisoryOnly: true,
      sourceAuthenticationPerformed: false,
      financialActionAllowed: false,
      disposition: 'would_preview_receiver_grace',
      reasonCode: 'signed_grace_facts_available',
      facts: Object.freeze({
        candidateId: ownDataValue(body, 'candidateId') as string,
        challengeId: ownDataValue(body, 'challengeId') as string,
        referenceFingerprint: ownDataValue(body, 'referenceFingerprint') as string,
        creditedPartyNameDigest: nameDigest,
        creditedPartyVisibleSuffix: suffix,
        occurredAt: occurredAt as string,
        submittedAt: submittedAt as string,
        amountMinor,
        sourceDocumentDigest,
        observationBodyDigest,
        replayIdentity: checked.replayIdentity,
      }),
    });
  } catch {
    return review('invalid_request');
  }
}
