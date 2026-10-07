import {
  hasExactEnumerableDataKeys,
  isPlainNonProxyRecord,
  ownDataValue,
  type UnknownRecord,
} from './exact-data-record.js';
import { verifyRoutineTelebirrSignedLookupAssignment } from './routine-signed-lookup-assignment.js';
import { verifyRoutineTelebirrSignedObservation } from './routine-signed-observation.js';

/**
 * Composes the two routine signatures against one independently loaded lookup snapshot.
 * This is only a no-money review boundary: a signed phone report is not proof that
 * TeleBirr issued the receipt, and this function has no database or payment capability.
 */
const INPUT_KEYS = [
  'assessedAt',
  'trustedLookup',
  'trustedRawReference',
  'trustedSigner',
  'deviceEnrollment',
  'signedAssignment',
  'signedObservation',
] as const;
const LOOKUP_KEYS = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'candidateId',
  'referenceFingerprint',
  'referenceKeyVersion',
  'referenceProfileVersion',
  'submittedAt',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'expectedReceiverNameDigest',
  'deviceId',
  'keyId',
  'challengeId',
  'challengeDigest',
  'issuedAt',
  'expiresAt',
] as const;
const ASSIGNMENT_KEYS = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'transcriptVersion',
  'bodyDigestAlgorithm',
  'bodyDigest',
  'signatureAlgorithm',
  'signatureEncoding',
  'signerKeyId',
  'body',
  'signature',
] as const;
const ASSIGNMENT_BODY_KEYS = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'candidateId',
  'rawReference',
  'referenceFingerprint',
  'referenceKeyVersion',
  'referenceProfileVersion',
  'submittedAt',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'receiverNameNormalizerVersion',
  'expectedReceiverNameNormalized',
  'expectedReceiverNameDigest',
  'deviceId',
  'keyId',
  'challengeId',
  'challengeDigest',
  'sourceProfile',
  'issuedAt',
  'expiresAt',
] as const;

const LOOKUP_BINDINGS = [
  'contractVersion',
  'providerCode',
  'protocolMode',
  'candidateId',
  'referenceFingerprint',
  'referenceKeyVersion',
  'referenceProfileVersion',
  'submittedAt',
  'receiverRevisionId',
  'receiverVersion',
  'receiverProfileDigest',
  'expectedReceiverNameDigest',
  'deviceId',
  'keyId',
  'challengeId',
  'challengeDigest',
  'issuedAt',
  'expiresAt',
] as const;

export interface RoutineNoMoneyEvidenceAssessment {
  readonly advisoryOnly: true;
  readonly serverSignatureVerified: boolean;
  readonly deviceSignatureVerified: boolean;
  readonly providedSnapshotMatched: boolean;
  readonly sourceAuthenticationPerformed: false;
  readonly databaseWriteAllowed: false;
  readonly claimAllowed: false;
  readonly settlementAllowed: false;
  readonly enqueueAllowed: false;
  readonly executionAllowed: false;
  readonly financialActionAllowed: false;
  readonly disposition: 'would_review' | 'would_forward_signed_evidence';
  readonly reasonCode:
    | 'invalid_request'
    | 'assignment_invalid'
    | 'lookup_snapshot_mismatch'
    | 'observation_invalid'
    | 'receipt_policy_review'
    | 'signed_evidence_matches_policy';
  /** Advisory digest only. A database constraint must enforce one observation per challenge. */
  readonly replayIdentity: string | null;
}

function result(
  disposition: RoutineNoMoneyEvidenceAssessment['disposition'],
  reasonCode: RoutineNoMoneyEvidenceAssessment['reasonCode'],
  serverSignatureVerified = false,
  deviceSignatureVerified = false,
  providedSnapshotMatched = false,
  replayIdentity: string | null = null,
): RoutineNoMoneyEvidenceAssessment {
  return Object.freeze({
    advisoryOnly: true,
    serverSignatureVerified,
    deviceSignatureVerified,
    providedSnapshotMatched,
    sourceAuthenticationPerformed: false,
    databaseWriteAllowed: false,
    claimAllowed: false,
    settlementAllowed: false,
    enqueueAllowed: false,
    executionAllowed: false,
    financialActionAllowed: false,
    disposition,
    reasonCode,
    replayIdentity,
  });
}

function record(value: unknown, keys: readonly string[]): UnknownRecord | undefined {
  if (!isPlainNonProxyRecord(value) || !hasExactEnumerableDataKeys(value, keys)) return undefined;
  return Object.fromEntries(keys.map((key) => [key, ownDataValue(value, key)]));
}

/**
 * The caller must load trustedLookup and trustedRawReference from the same protected
 * candidate/challenge transaction, and load both public keys from independent trust stores.
 * A successful result still grants no source, database, or financial authority.
 */
export function assessRoutineTelebirrNoMoneyEvidence(
  inputCandidate: unknown,
  trustedSignerSpkiDer: unknown,
  enrolledDeviceSpkiDer: unknown,
): RoutineNoMoneyEvidenceAssessment {
  try {
    const input = record(inputCandidate, INPUT_KEYS);
    const lookup = input && record(input.trustedLookup, LOOKUP_KEYS);
    const assignment = input && record(input.signedAssignment, ASSIGNMENT_KEYS);
    const assignmentBody = assignment && record(assignment.body, ASSIGNMENT_BODY_KEYS);
    if (
      !input ||
      !lookup ||
      !assignmentBody ||
      typeof input.trustedRawReference !== 'string' ||
      !/^[A-Z0-9]{8,32}$/u.test(input.trustedRawReference)
    ) {
      return result('would_review', 'invalid_request');
    }

    const assignmentCheck = verifyRoutineTelebirrSignedLookupAssignment(
      {
        assessedAt: input.assessedAt,
        trustedSigner: input.trustedSigner,
        deviceEnrollment: input.deviceEnrollment,
        localDevicePublicKeySpkiDer: enrolledDeviceSpkiDer,
        signedAssignment: input.signedAssignment,
      },
      trustedSignerSpkiDer,
    );
    if (assignmentCheck.disposition !== 'would_accept_signed_assignment') {
      return result('would_review', 'assignment_invalid', assignmentCheck.serverSignatureVerified);
    }
    if (
      assignmentBody.rawReference !== input.trustedRawReference ||
      LOOKUP_BINDINGS.some((key) => assignmentBody[key] !== lookup[key])
    ) {
      return result('would_review', 'lookup_snapshot_mismatch', true);
    }

    const observationCheck = verifyRoutineTelebirrSignedObservation(
      {
        assessedAt: input.assessedAt,
        trustedLookup: input.trustedLookup,
        deviceEnrollment: input.deviceEnrollment,
        signedObservation: input.signedObservation,
      },
      enrolledDeviceSpkiDer,
    );
    if (observationCheck.disposition !== 'would_forward_signed_observation') {
      return result(
        'would_review',
        observationCheck.deviceSignatureVerified ? 'receipt_policy_review' : 'observation_invalid',
        true,
        observationCheck.deviceSignatureVerified,
        true,
        observationCheck.replayIdentity,
      );
    }
    return result(
      'would_forward_signed_evidence',
      'signed_evidence_matches_policy',
      true,
      true,
      true,
      observationCheck.replayIdentity,
    );
  } catch {
    return result('would_review', 'invalid_request');
  }
}
