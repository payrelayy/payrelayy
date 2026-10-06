import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import {
  TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  withOpenedTelebirrDepositProofReference,
  type TelebirrScopedReferenceOpeningKey,
} from '@fetanagent/telebirr-reference-opening';
import {
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_CONTRACT_VERSION,
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
  ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
  ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  canonicalRoutineTelebirrLookupAssignmentSignatureBytes,
  digestRoutineTelebirrLookupAssignmentBody,
  digestRoutineTelebirrReceiverName,
  digestRoutineTelebirrReceiverProfile,
  normalizeTelebirrCreditedPartyFullName,
} from '@fetanagent/telebirr-verification-foundation';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const CIPHERTEXT = /^v2\.telebirr\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11,43}$/u;
const P1363 = /^[A-Za-z0-9_-]{86}$/u;
const MAX_LEASE_MS = 5 * 60 * 1_000;

const rowFields = [
  ['challenge_id', 'challengeId'],
  ['challenge_digest', 'challengeDigest'],
  ['issued_at', 'issuedAt'],
  ['expires_at', 'expiresAt'],
  ['candidate_id', 'candidateId'],
  ['candidate_submitted_at', 'candidateSubmittedAt'],
  ['candidate_reference_ciphertext', 'candidateReferenceCiphertext'],
  ['candidate_reference_fingerprint', 'candidateReferenceFingerprint'],
  ['reference_encryption_key_version', 'referenceEncryptionKeyVersion'],
  ['reference_profile_version', 'referenceProfileVersion'],
  ['receiver_revision_id', 'receiverRevisionId'],
  ['receiver_version', 'receiverVersion'],
  ['receiver_reference_fingerprint', 'receiverReferenceFingerprint'],
  ['receiver_profile_digest', 'receiverProfileDigest'],
  ['receiver_name', 'receiverName'],
  ['expected_receiver_name_digest', 'expectedReceiverNameDigest'],
  ['device_enrollment_id', 'deviceEnrollmentId'],
  ['device_id', 'deviceId'],
  ['device_key_id', 'deviceKeyId'],
  ['device_public_key_spki_sha256', 'devicePublicKeySpkiSha256'],
  ['device_valid_from', 'deviceValidFrom'],
  ['device_valid_until', 'deviceValidUntil'],
  ['assignment_signer_id', 'assignmentSignerId'],
  ['assignment_signer_key_id', 'assignmentSignerKeyId'],
  ['assignment_signer_public_key_spki_sha256', 'assignmentSignerPublicKeySpkiSha256'],
  ['signer_valid_from', 'signerValidFrom'],
  ['signer_valid_until', 'signerValidUntil'],
  ['source_profile', 'sourceProfile'],
] as const;
const materialKeys = rowFields.map(([, key]) => key);
const dateKeys = new Set([
  'issuedAt',
  'expiresAt',
  'candidateSubmittedAt',
  'deviceValidFrom',
  'deviceValidUntil',
  'signerValidFrom',
  'signerValidUntil',
]);
const signerKeys = ['assignmentSignerId', 'keyId', 'publicKeySpkiDer', 'signP1363'] as const;

export interface RoutineTelebirrAssignmentMaterial {
  readonly challengeId: string;
  readonly challengeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly candidateId: string;
  readonly candidateSubmittedAt: string;
  readonly candidateReferenceCiphertext: string;
  readonly candidateReferenceFingerprint: string;
  readonly referenceEncryptionKeyVersion: 2;
  readonly referenceProfileVersion: 2;
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly receiverReferenceFingerprint: string;
  readonly receiverProfileDigest: string;
  readonly receiverName: string;
  readonly expectedReceiverNameDigest: string;
  readonly deviceEnrollmentId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly deviceValidFrom: string;
  readonly deviceValidUntil: string;
  readonly assignmentSignerId: string;
  readonly assignmentSignerKeyId: string;
  readonly assignmentSignerPublicKeySpkiSha256: string;
  readonly signerValidFrom: string;
  readonly signerValidUntil: string;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
}

export interface RoutineTelebirrAssignmentSigner {
  readonly assignmentSignerId: string;
  readonly keyId: string;
  readonly publicKeySpkiDer: Uint8Array;
  signP1363(transcript: Uint8Array): Promise<string>;
}

export interface RoutineTelebirrSignedLookupAssignment {
  readonly contractVersion: 1;
  readonly providerCode: 'telebirr';
  readonly protocolMode: typeof ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE;
  readonly transcriptVersion: typeof ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION;
  readonly bodyDigestAlgorithm: 'sha256';
  readonly bodyDigest: string;
  readonly signatureAlgorithm: 'ecdsa-p256-sha256';
  readonly signatureEncoding: 'ieee-p1363-base64url';
  readonly signerKeyId: string;
  readonly body: Readonly<Record<string, string | number>>;
  readonly signature: string;
}

export class RoutineTelebirrAssignmentUnavailableError extends Error {
  constructor() {
    super('The routine TeleBirr lookup assignment is unavailable.');
    this.name = 'RoutineTelebirrAssignmentUnavailableError';
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    nodeUtilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function rowTimestamp(value: unknown): string | undefined {
  if (timestamp(value)) return value;
  if (!nodeUtilTypes.isProxy(value) && nodeUtilTypes.isDate(value)) {
    const milliseconds = Date.prototype.getTime.call(value);
    return Number.isFinite(milliseconds) ? Date.prototype.toISOString.call(value) : undefined;
  }
  return undefined;
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function validMaterial(candidate: unknown): RoutineTelebirrAssignmentMaterial | undefined {
  const value = exactRecord(candidate, materialKeys);
  if (!value) return undefined;
  const uuidKeys = [
    'challengeId',
    'candidateId',
    'receiverRevisionId',
    'deviceEnrollmentId',
    'assignmentSignerId',
  ];
  const digestKeys = [
    'challengeDigest',
    'receiverProfileDigest',
    'expectedReceiverNameDigest',
    'devicePublicKeySpkiSha256',
    'assignmentSignerPublicKeySpkiSha256',
  ];
  if (
    uuidKeys.some((key) => typeof value[key] !== 'string' || !UUID_V4.test(value[key])) ||
    digestKeys.some((key) => typeof value[key] !== 'string' || !DIGEST.test(value[key])) ||
    [...dateKeys].some((key) => !timestamp(value[key])) ||
    typeof value.candidateReferenceCiphertext !== 'string' ||
    !CIPHERTEXT.test(value.candidateReferenceCiphertext) ||
    typeof value.candidateReferenceFingerprint !== 'string' ||
    !FINGERPRINT.test(value.candidateReferenceFingerprint) ||
    value.referenceEncryptionKeyVersion !== TELEBIRR_REFERENCE_OPENING_KEY_VERSION ||
    value.referenceProfileVersion !== TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION ||
    typeof value.receiverVersion !== 'number' ||
    !Number.isSafeInteger(value.receiverVersion) ||
    value.receiverVersion < 1 ||
    typeof value.receiverReferenceFingerprint !== 'string' ||
    !FINGERPRINT.test(value.receiverReferenceFingerprint) ||
    typeof value.receiverName !== 'string' ||
    typeof value.deviceId !== 'string' ||
    !OPAQUE_ID.test(value.deviceId) ||
    typeof value.deviceKeyId !== 'string' ||
    !OPAQUE_ID.test(value.deviceKeyId) ||
    typeof value.assignmentSignerKeyId !== 'string' ||
    !OPAQUE_ID.test(value.assignmentSignerKeyId) ||
    value.sourceProfile !== TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE ||
    value.deviceKeyId === value.assignmentSignerKeyId ||
    value.devicePublicKeySpkiSha256 === value.assignmentSignerPublicKeySpkiSha256 ||
    digestRoutineTelebirrReceiverName(value.receiverName) !== value.expectedReceiverNameDigest ||
    digestRoutineTelebirrReceiverProfile({
      receiverRevisionId: value.receiverRevisionId,
      receiverVersion: value.receiverVersion,
      receiverReferenceFingerprint: value.receiverReferenceFingerprint,
      receiverName: value.receiverName,
    }) !== value.receiverProfileDigest
  ) {
    return undefined;
  }
  const issued = Date.parse(value.issuedAt as string);
  const expires = Date.parse(value.expiresAt as string);
  if (
    Date.parse(value.candidateSubmittedAt as string) > issued ||
    expires <= issued ||
    expires - issued > MAX_LEASE_MS ||
    issued < Date.parse(value.deviceValidFrom as string) ||
    expires > Date.parse(value.deviceValidUntil as string) ||
    issued < Date.parse(value.signerValidFrom as string) ||
    expires > Date.parse(value.signerValidUntil as string)
  ) {
    return undefined;
  }
  return Object.freeze({ ...value }) as unknown as RoutineTelebirrAssignmentMaterial;
}

/** Accepts only the exact row shape returned by the administrator-only SQL issuer. */
export function decodeRoutineTelebirrAssignmentMaterialRow(
  rowCandidate: unknown,
): RoutineTelebirrAssignmentMaterial | undefined {
  try {
    const row = exactRecord(
      rowCandidate,
      rowFields.map(([key]) => key),
    );
    if (!row) return undefined;
    const material: Record<string, unknown> = {};
    for (const [sqlKey, key] of rowFields) {
      material[key] = dateKeys.has(key) ? rowTimestamp(row[sqlKey]) : row[sqlKey];
    }
    return validMaterial(material);
  } catch {
    return undefined;
  }
}

function signerKey(candidate: unknown):
  | {
      readonly signer: RoutineTelebirrAssignmentSigner;
      readonly der: Buffer;
      readonly publicKey: ReturnType<typeof createPublicKey>;
    }
  | undefined {
  const value = exactRecord(candidate, signerKeys);
  if (
    !value ||
    typeof value.assignmentSignerId !== 'string' ||
    !UUID_V4.test(value.assignmentSignerId) ||
    typeof value.keyId !== 'string' ||
    !OPAQUE_ID.test(value.keyId) ||
    !(value.publicKeySpkiDer instanceof Uint8Array) ||
    nodeUtilTypes.isProxy(value.publicKeySpkiDer) ||
    typeof value.signP1363 !== 'function' ||
    nodeUtilTypes.isProxy(value.signP1363)
  ) {
    return undefined;
  }
  const der = Buffer.from(value.publicKeySpkiDer);
  try {
    const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
    const canonical = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }));
    if (
      publicKey.asymmetricKeyType !== 'ec' ||
      publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !canonical.equals(der)
    ) {
      return undefined;
    }
    return { signer: candidate as RoutineTelebirrAssignmentSigner, der, publicKey };
  } catch {
    return undefined;
  }
}

/**
 * Dormant protected-process builder. The material must come from the exact SQL issuer;
 * this function has no database credentials, endpoint, device transport, or payment authority.
 */
export async function buildRoutineTelebirrSignedLookupAssignment(
  materialCandidate: unknown,
  openingKey: TelebirrScopedReferenceOpeningKey,
  signerCandidate: unknown,
  now: () => string,
): Promise<RoutineTelebirrSignedLookupAssignment> {
  try {
    const material = validMaterial(materialCandidate);
    const signing = signerKey(signerCandidate);
    if (
      !material ||
      !signing ||
      signing.signer.assignmentSignerId !== material.assignmentSignerId ||
      signing.signer.keyId !== material.assignmentSignerKeyId ||
      digest(signing.der) !== material.assignmentSignerPublicKeySpkiSha256 ||
      typeof now !== 'function' ||
      nodeUtilTypes.isProxy(now)
    ) {
      throw new Error();
    }
    const assessedAt = now();
    if (
      !timestamp(assessedAt) ||
      assessedAt < material.issuedAt ||
      assessedAt >= material.expiresAt
    ) {
      throw new Error();
    }
    const normalizedName = normalizeTelebirrCreditedPartyFullName(material.receiverName);
    if (!normalizedName) throw new Error();
    const body = withOpenedTelebirrDepositProofReference(
      {
        ciphertext: material.candidateReferenceCiphertext,
        ciphertextProfileVersion: material.referenceProfileVersion,
        encryptionKeyVersion: material.referenceEncryptionKeyVersion,
        providerCode: 'telebirr',
      },
      openingKey,
      (rawReference) =>
        Object.freeze({
          contractVersion: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_CONTRACT_VERSION,
          providerCode: 'telebirr' as const,
          protocolMode: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
          candidateId: material.candidateId,
          rawReference,
          referenceFingerprint: material.candidateReferenceFingerprint,
          referenceKeyVersion: material.referenceEncryptionKeyVersion,
          referenceProfileVersion: material.referenceProfileVersion,
          submittedAt: material.candidateSubmittedAt,
          receiverRevisionId: material.receiverRevisionId,
          receiverVersion: material.receiverVersion,
          receiverProfileDigest: material.receiverProfileDigest,
          receiverNameNormalizerVersion: ROUTINE_TELEBIRR_RECEIVER_NAME_NORMALIZER_VERSION,
          expectedReceiverNameNormalized: normalizedName,
          expectedReceiverNameDigest: material.expectedReceiverNameDigest,
          deviceId: material.deviceId,
          keyId: material.deviceKeyId,
          challengeId: material.challengeId,
          challengeDigest: material.challengeDigest,
          sourceProfile: material.sourceProfile,
          issuedAt: material.issuedAt,
          expiresAt: material.expiresAt,
        }),
    );
    const bodyDigest = digestRoutineTelebirrLookupAssignmentBody(body);
    const transcript = canonicalRoutineTelebirrLookupAssignmentSignatureBytes(body);
    if (!bodyDigest || !transcript) throw new Error();
    const signature = await signing.signer.signP1363(transcript);
    if (typeof signature !== 'string' || !P1363.test(signature)) throw new Error();
    const signatureBytes = Buffer.from(signature, 'base64url');
    if (
      signatureBytes.byteLength !== 64 ||
      signatureBytes.toString('base64url') !== signature ||
      !verifySignature(
        'sha256',
        transcript,
        {
          key: signing.publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        signatureBytes,
      )
    ) {
      throw new Error();
    }
    const afterSigning = now();
    if (
      !timestamp(afterSigning) ||
      afterSigning < material.issuedAt ||
      afterSigning >= material.expiresAt
    ) {
      throw new Error();
    }
    return Object.freeze({
      contractVersion: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_CONTRACT_VERSION,
      providerCode: 'telebirr',
      protocolMode: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
      transcriptVersion: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_TRANSCRIPT_VERSION,
      bodyDigestAlgorithm: 'sha256',
      bodyDigest,
      signatureAlgorithm: 'ecdsa-p256-sha256',
      signatureEncoding: 'ieee-p1363-base64url',
      signerKeyId: material.assignmentSignerKeyId,
      body,
      signature,
    });
  } catch {
    throw new RoutineTelebirrAssignmentUnavailableError();
  }
}
