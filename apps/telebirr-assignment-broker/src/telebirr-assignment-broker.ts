import { createHash, createPublicKey } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import {
  TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION,
  TELEBIRR_REFERENCE_OPENING_KEY_VERSION,
  withOpenedTelebirrDepositProofReference,
  type TelebirrScopedReferenceOpeningKey,
} from '@fetanagent/telebirr-reference-opening';
import {
  TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION,
  TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE,
  TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE,
  TELEBIRR_LIVE_PILOT_ADAPTER_VERSION,
  TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
  TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
  TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM,
  TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_PARSER_VERSION,
  TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
  TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
  TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
  TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM,
  TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING,
  TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE,
  canonicalTelebirrLivePilotAssignmentSignatureBytes,
  decodeTelebirrDeviceBridgeEnrollmentCertificateBody,
  decodeTelebirrLivePilotAssignmentBody,
  decodeTelebirrLivePilotSignedAssignment,
  deriveTelebirrLivePilotReferenceBindingDigest,
  digestTelebirrLivePilotAssignmentBody,
  digestTelebirrLivePilotReceiverName,
  normalizeTelebirrCreditedPartyFullName,
  verifyTelebirrLivePilotSignedAssignmentSignature,
  type TelebirrDeviceBridgeEnrollmentCertificateBody,
  type TelebirrLivePilotSignedAssignment,
} from '@fetanagent/telebirr-verification-foundation';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BARE_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const P1363_PATTERN = /^[A-Za-z0-9_-]{86}$/u;

export interface TelebirrAssignmentReceiverManifest {
  readonly contractVersion: 1;
  readonly providerCode: 'telebirr';
  readonly pilotRevisionId: string;
  readonly receiverRevisionId: string;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly receiverConfigurationDigest: string;
  readonly receiverNameNormalizerVersion: typeof TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION;
  readonly expectedReceiverNameNormalized: string;
  readonly expectedReceiverNameDigest: string;
}

export interface TelebirrAssignmentLease {
  readonly verificationAttemptId: string;
  readonly leaseToken: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly requestId: string;
  readonly assignmentId: string;
  readonly leaseNonceDigest: string;
  readonly challengeId: string;
  readonly challengeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly pilotRevisionId: string;
  readonly deviceEnrollmentId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly devicePublicKeySpkiSha256: string;
  readonly receiverRevisionId: string;
  readonly receiverProfileId: string;
  readonly receiverProfileDigest: string;
  readonly receiverConfigurationDigest: string;
  readonly expectedReceiverNameDigest: string;
  readonly receiverNameNormalizerVersion: typeof TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION;
  readonly sourceProfile: typeof TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE;
  readonly adapterVersion: typeof TELEBIRR_LIVE_PILOT_ADAPTER_VERSION;
  readonly parserVersion: typeof TELEBIRR_LIVE_PILOT_PARSER_VERSION;
  readonly factsNormalizerVersion: typeof TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION;
  readonly candidateReferenceCiphertext: string;
  readonly candidateReferenceFingerprint: string;
  readonly referenceEncryptionKeyVersion: typeof TELEBIRR_REFERENCE_OPENING_KEY_VERSION;
  readonly referenceProfileVersion: typeof TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION;
  readonly replayed: boolean;
}

export interface TelebirrAssignmentLeaseRequest {
  readonly deviceEnrollmentId: string;
  readonly leasedBy: string;
  readonly leaseRequestKey: string;
  readonly requestedLeaseSeconds: number;
}

export interface TelebirrAssignmentPersistenceRequest {
  readonly verificationAttemptId: string;
  readonly leaseToken: string;
  readonly assignmentSignerId: string;
  readonly assignmentBodyDigest: string;
  readonly proposedAssignmentSignature: string;
  readonly proposedAssignmentSignatureDigest: string;
  readonly referenceBindingDigest: string;
}

export interface TelebirrPersistedAssignmentSignature {
  readonly assignmentSignature: string;
  readonly assignmentSignatureDigest: string;
  readonly replayed: boolean;
}

export interface TelebirrAssignmentBrokerDatabase {
  leaseAssignment(request: TelebirrAssignmentLeaseRequest): Promise<TelebirrAssignmentLease | null>;
  persistAssignmentSignature(
    request: TelebirrAssignmentPersistenceRequest,
  ): Promise<TelebirrPersistedAssignmentSignature>;
}

export interface TelebirrAssignmentSigner {
  readonly assignmentSignerId: string;
  readonly keyId: string;
  readonly publicKeySpkiDer: Uint8Array;
  signP1363(transcript: Uint8Array): Promise<string>;
}

export interface TelebirrAssignmentBrokerPollInput {
  readonly certificate: TelebirrDeviceBridgeEnrollmentCertificateBody;
  readonly bridgeRequestBodyDigest: string;
  readonly requestedLeaseSeconds: number;
}

export type TelebirrAssignmentBrokerPollResult =
  | { readonly kind: 'assignment'; readonly assignment: TelebirrLivePilotSignedAssignment }
  | { readonly kind: 'no_assignment' };

export interface TelebirrAssignmentBrokerDependencies {
  readonly database: TelebirrAssignmentBrokerDatabase;
  readonly openingKey: TelebirrScopedReferenceOpeningKey;
  readonly receiverManifest: TelebirrAssignmentReceiverManifest;
  readonly signer: TelebirrAssignmentSigner;
}

export class TelebirrAssignmentBrokerError extends Error {
  constructor() {
    super('The private TeleBirr assignment is unavailable.');
    this.name = 'TelebirrAssignmentBrokerError';
  }
}

function exactDataProperties(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    nodeUtilTypes.isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  ) {
    return undefined;
  }
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function spkiDigest(spki: Uint8Array): string {
  return `sha256:${createHash('sha256').update(spki).digest('hex')}`;
}

function signatureDigest(signature: string): string | undefined {
  if (!P1363_PATTERN.test(signature)) return undefined;
  const bytes = Buffer.from(signature, 'base64url');
  try {
    return bytes.byteLength === 64 && bytes.toString('base64url') === signature
      ? `sha256:${createHash('sha256').update(bytes).digest('hex')}`
      : undefined;
  } finally {
    bytes.fill(0);
  }
}

function deterministicLeaseRequestKey(
  certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
  requestBodyDigest: string,
): string {
  const bytes = createHash('sha256')
    .update('fetanagent:telebirr:assignment-broker:lease-request:v1\n', 'utf8')
    .update(`enrollment:${certificate.enrollmentId}\n`, 'utf8')
    .update(`request:${requestBodyDigest}`, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  bytes.fill(0);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeReceiverManifest(
  candidate: unknown,
): TelebirrAssignmentReceiverManifest | undefined {
  const value = exactDataProperties(candidate, [
    'contractVersion',
    'providerCode',
    'pilotRevisionId',
    'receiverRevisionId',
    'receiverProfileId',
    'receiverProfileDigest',
    'receiverConfigurationDigest',
    'receiverNameNormalizerVersion',
    'expectedReceiverNameNormalized',
    'expectedReceiverNameDigest',
  ]);
  if (
    value === undefined ||
    value.contractVersion !== 1 ||
    value.providerCode !== 'telebirr' ||
    typeof value.pilotRevisionId !== 'string' ||
    !UUID_V4_PATTERN.test(value.pilotRevisionId) ||
    typeof value.receiverRevisionId !== 'string' ||
    !UUID_V4_PATTERN.test(value.receiverRevisionId) ||
    typeof value.receiverProfileId !== 'string' ||
    !UUID_V4_PATTERN.test(value.receiverProfileId) ||
    typeof value.receiverProfileDigest !== 'string' ||
    !SHA256_PATTERN.test(value.receiverProfileDigest) ||
    typeof value.receiverConfigurationDigest !== 'string' ||
    !SHA256_PATTERN.test(value.receiverConfigurationDigest) ||
    value.receiverNameNormalizerVersion !== TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION ||
    typeof value.expectedReceiverNameNormalized !== 'string' ||
    normalizeTelebirrCreditedPartyFullName(value.expectedReceiverNameNormalized) !==
      value.expectedReceiverNameNormalized ||
    typeof value.expectedReceiverNameDigest !== 'string' ||
    value.expectedReceiverNameDigest !==
      digestTelebirrLivePilotReceiverName(value.expectedReceiverNameNormalized)
  ) {
    return undefined;
  }
  return Object.freeze({
    contractVersion: 1,
    providerCode: 'telebirr',
    pilotRevisionId: value.pilotRevisionId,
    receiverRevisionId: value.receiverRevisionId,
    receiverProfileId: value.receiverProfileId,
    receiverProfileDigest: value.receiverProfileDigest,
    receiverConfigurationDigest: value.receiverConfigurationDigest,
    receiverNameNormalizerVersion: TELEBIRR_LIVE_PILOT_RECEIVER_NAME_NORMALIZER_VERSION,
    expectedReceiverNameNormalized: value.expectedReceiverNameNormalized,
    expectedReceiverNameDigest: value.expectedReceiverNameDigest,
  });
}

function validLease(
  lease: TelebirrAssignmentLease,
  certificate: TelebirrDeviceBridgeEnrollmentCertificateBody,
  manifest: TelebirrAssignmentReceiverManifest,
): boolean {
  const value = exactDataProperties(lease, [
    'verificationAttemptId',
    'leaseToken',
    'jobId',
    'attemptNumber',
    'requestId',
    'assignmentId',
    'leaseNonceDigest',
    'challengeId',
    'challengeDigest',
    'issuedAt',
    'expiresAt',
    'pilotRevisionId',
    'deviceEnrollmentId',
    'deviceId',
    'deviceKeyId',
    'devicePublicKeySpkiSha256',
    'receiverRevisionId',
    'receiverProfileId',
    'receiverProfileDigest',
    'receiverConfigurationDigest',
    'expectedReceiverNameDigest',
    'receiverNameNormalizerVersion',
    'sourceProfile',
    'adapterVersion',
    'parserVersion',
    'factsNormalizerVersion',
    'candidateReferenceCiphertext',
    'candidateReferenceFingerprint',
    'referenceEncryptionKeyVersion',
    'referenceProfileVersion',
    'replayed',
  ]);
  if (value === undefined) return false;
  const uuidKeys = [
    'verificationAttemptId',
    'leaseToken',
    'jobId',
    'requestId',
    'assignmentId',
    'challengeId',
    'pilotRevisionId',
    'deviceEnrollmentId',
    'receiverRevisionId',
    'receiverProfileId',
  ] as const;
  if (uuidKeys.some((key) => typeof value[key] !== 'string' || !UUID_V4_PATTERN.test(value[key]))) {
    return false;
  }
  return (
    Number.isSafeInteger(value.attemptNumber) &&
    (value.attemptNumber as number) >= 1 &&
    (value.attemptNumber as number) <= 100 &&
    typeof value.leaseNonceDigest === 'string' &&
    SHA256_PATTERN.test(value.leaseNonceDigest) &&
    typeof value.challengeDigest === 'string' &&
    SHA256_PATTERN.test(value.challengeDigest) &&
    canonicalTimestamp(value.issuedAt) &&
    canonicalTimestamp(value.expiresAt) &&
    Date.parse(value.issuedAt) < Date.parse(value.expiresAt) &&
    Date.parse(value.issuedAt) >= Date.parse(certificate.validFrom) &&
    Date.parse(value.expiresAt) <= Date.parse(certificate.validUntil) &&
    value.deviceEnrollmentId === certificate.enrollmentId &&
    value.deviceId === certificate.deviceId &&
    value.deviceKeyId === certificate.keyId &&
    value.devicePublicKeySpkiSha256 === certificate.devicePublicKeySpkiSha256 &&
    value.pilotRevisionId === certificate.pilotRevisionId &&
    value.pilotRevisionId === manifest.pilotRevisionId &&
    value.receiverRevisionId === certificate.receiverRevisionId &&
    value.receiverRevisionId === manifest.receiverRevisionId &&
    value.receiverProfileId === certificate.receiverProfileId &&
    value.receiverProfileId === manifest.receiverProfileId &&
    value.receiverProfileDigest === certificate.receiverProfileDigest &&
    value.receiverProfileDigest === manifest.receiverProfileDigest &&
    value.receiverConfigurationDigest === certificate.receiverConfigurationDigest &&
    value.receiverConfigurationDigest === manifest.receiverConfigurationDigest &&
    value.expectedReceiverNameDigest === manifest.expectedReceiverNameDigest &&
    value.receiverNameNormalizerVersion === manifest.receiverNameNormalizerVersion &&
    value.sourceProfile === TELEBIRR_OFFICIAL_RECEIPT_SOURCE_PROFILE &&
    value.adapterVersion === TELEBIRR_LIVE_PILOT_ADAPTER_VERSION &&
    value.parserVersion === TELEBIRR_LIVE_PILOT_PARSER_VERSION &&
    value.factsNormalizerVersion === TELEBIRR_LIVE_PILOT_FACTS_NORMALIZER_VERSION &&
    typeof value.candidateReferenceCiphertext === 'string' &&
    value.candidateReferenceCiphertext.length <= 512 &&
    typeof value.candidateReferenceFingerprint === 'string' &&
    BARE_SHA256_PATTERN.test(value.candidateReferenceFingerprint) &&
    value.referenceEncryptionKeyVersion === TELEBIRR_REFERENCE_OPENING_KEY_VERSION &&
    value.referenceProfileVersion === TELEBIRR_REFERENCE_OPENING_CIPHERTEXT_PROFILE_VERSION &&
    typeof value.replayed === 'boolean'
  );
}

function validSigner(signer: TelebirrAssignmentSigner): Uint8Array | undefined {
  const value = exactDataProperties(signer, [
    'assignmentSignerId',
    'keyId',
    'publicKeySpkiDer',
    'signP1363',
  ]);
  if (
    value === undefined ||
    typeof value.assignmentSignerId !== 'string' ||
    !UUID_V4_PATTERN.test(value.assignmentSignerId) ||
    typeof value.keyId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(value.keyId) ||
    !(value.publicKeySpkiDer instanceof Uint8Array) ||
    value.publicKeySpkiDer.byteLength !== 91 ||
    typeof value.signP1363 !== 'function'
  ) {
    return undefined;
  }
  const spki = Uint8Array.from(value.publicKeySpkiDer);
  try {
    const key = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
    const canonical = Buffer.from(key.export({ format: 'der', type: 'spki' }));
    try {
      return key.type === 'public' &&
        key.asymmetricKeyType === 'ec' &&
        key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
        canonical.equals(spki)
        ? spki
        : undefined;
    } finally {
      canonical.fill(0);
    }
  } catch {
    spki.fill(0);
    return undefined;
  }
}

export function createTelebirrAssignmentBroker(
  dependencies: TelebirrAssignmentBrokerDependencies,
): (input: TelebirrAssignmentBrokerPollInput) => Promise<TelebirrAssignmentBrokerPollResult> {
  const dependencyValues = exactDataProperties(dependencies, [
    'database',
    'openingKey',
    'receiverManifest',
    'signer',
  ]);
  const manifest = decodeReceiverManifest(dependencyValues?.receiverManifest);
  const signer = dependencyValues?.signer as TelebirrAssignmentSigner | undefined;
  const signerSpki = signer && validSigner(signer);
  if (
    dependencyValues === undefined ||
    manifest === undefined ||
    signer === undefined ||
    signerSpki === undefined ||
    typeof (dependencyValues.database as TelebirrAssignmentBrokerDatabase | undefined)
      ?.leaseAssignment !== 'function' ||
    typeof (dependencyValues.database as TelebirrAssignmentBrokerDatabase | undefined)
      ?.persistAssignmentSignature !== 'function'
  ) {
    signerSpki?.fill(0);
    throw new TelebirrAssignmentBrokerError();
  }
  const database = dependencyValues.database as TelebirrAssignmentBrokerDatabase;
  const openingKey = dependencyValues.openingKey as TelebirrScopedReferenceOpeningKey;
  const signerPublicDigest = spkiDigest(signerSpki);

  return async (inputCandidate) => {
    try {
      const input = exactDataProperties(inputCandidate, [
        'certificate',
        'bridgeRequestBodyDigest',
        'requestedLeaseSeconds',
      ]);
      const certificate = decodeTelebirrDeviceBridgeEnrollmentCertificateBody(input?.certificate);
      if (
        input === undefined ||
        certificate === undefined ||
        certificate.contractVersion !== TELEBIRR_DEVICE_BRIDGE_CONTRACT_VERSION ||
        certificate.providerCode !== TELEBIRR_DEVICE_BRIDGE_PROVIDER_CODE ||
        certificate.protocolMode !== TELEBIRR_DEVICE_BRIDGE_PROTOCOL_MODE ||
        certificate.state !== 'active' ||
        typeof input.bridgeRequestBodyDigest !== 'string' ||
        !SHA256_PATTERN.test(input.bridgeRequestBodyDigest) ||
        !Number.isSafeInteger(input.requestedLeaseSeconds) ||
        (input.requestedLeaseSeconds as number) < 30 ||
        (input.requestedLeaseSeconds as number) > 300 ||
        certificate.assignmentSignerKeyId !== signer.keyId ||
        certificate.assignmentSignerPublicKeySpkiSha256 !== signerPublicDigest ||
        certificate.pilotRevisionId !== manifest.pilotRevisionId ||
        certificate.receiverRevisionId !== manifest.receiverRevisionId ||
        certificate.receiverProfileId !== manifest.receiverProfileId ||
        certificate.receiverProfileDigest !== manifest.receiverProfileDigest ||
        certificate.receiverConfigurationDigest !== manifest.receiverConfigurationDigest
      ) {
        throw new Error();
      }

      const lease = await database.leaseAssignment({
        deviceEnrollmentId: certificate.enrollmentId,
        leasedBy: `telebirr-bridge:${certificate.enrollmentId}`,
        leaseRequestKey: deterministicLeaseRequestKey(certificate, input.bridgeRequestBodyDigest),
        requestedLeaseSeconds: input.requestedLeaseSeconds as number,
      });
      if (lease === null) return Object.freeze({ kind: 'no_assignment' as const });
      if (!validLease(lease, certificate, manifest)) throw new Error();

      const referenceFingerprint = `hmac-sha256:${lease.candidateReferenceFingerprint}`;
      const body = withOpenedTelebirrDepositProofReference(
        {
          ciphertext: lease.candidateReferenceCiphertext,
          ciphertextProfileVersion: lease.referenceProfileVersion,
          encryptionKeyVersion: lease.referenceEncryptionKeyVersion,
          providerCode: 'telebirr',
        },
        openingKey,
        (rawReference) =>
          decodeTelebirrLivePilotAssignmentBody({
            contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
            providerCode: 'telebirr',
            protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
            assignmentId: lease.assignmentId,
            requestId: lease.requestId,
            jobId: lease.jobId,
            attemptNumber: lease.attemptNumber,
            pilotRevisionId: lease.pilotRevisionId,
            deviceId: lease.deviceId,
            keyId: lease.deviceKeyId,
            leaseNonceDigest: lease.leaseNonceDigest,
            challengeId: lease.challengeId,
            challengeDigest: lease.challengeDigest,
            rawReference,
            referenceFingerprint,
            referenceBindingProfile: TELEBIRR_LIVE_PILOT_REFERENCE_BINDING_PROFILE,
            referenceBindingDigest: deriveTelebirrLivePilotReferenceBindingDigest({
              rawReference,
              referenceFingerprint,
            }),
            sourceProfile: lease.sourceProfile,
            receiverRevisionId: lease.receiverRevisionId,
            receiverProfileId: lease.receiverProfileId,
            receiverProfileDigest: lease.receiverProfileDigest,
            receiverConfigurationDigest: lease.receiverConfigurationDigest,
            receiverNameNormalizerVersion: lease.receiverNameNormalizerVersion,
            expectedReceiverNameNormalized: manifest.expectedReceiverNameNormalized,
            expectedReceiverNameDigest: manifest.expectedReceiverNameDigest,
            adapterVersion: lease.adapterVersion,
            parserVersion: lease.parserVersion,
            factsNormalizerVersion: lease.factsNormalizerVersion,
            issuedAt: lease.issuedAt,
            expiresAt: lease.expiresAt,
          }),
      );
      if (body === undefined) throw new Error();
      const bodyDigest = digestTelebirrLivePilotAssignmentBody(body);
      const transcript = canonicalTelebirrLivePilotAssignmentSignatureBytes(body);
      if (bodyDigest === undefined || transcript === undefined) throw new Error();

      const proposedSignature = await signer.signP1363(transcript);
      const proposedSignatureDigest = signatureDigest(proposedSignature);
      if (proposedSignatureDigest === undefined) throw new Error();
      const proposedAssignment = decodeTelebirrLivePilotSignedAssignment({
        contractVersion: TELEBIRR_LIVE_PILOT_CONTRACT_VERSION,
        providerCode: 'telebirr',
        protocolMode: TELEBIRR_LIVE_PILOT_PROTOCOL_MODE,
        transcriptVersion: TELEBIRR_LIVE_PILOT_ASSIGNMENT_TRANSCRIPT_VERSION,
        bodyDigestAlgorithm: TELEBIRR_LIVE_PILOT_DIGEST_ALGORITHM,
        bodyDigest,
        signatureAlgorithm: TELEBIRR_LIVE_PILOT_SIGNATURE_ALGORITHM,
        signatureEncoding: TELEBIRR_LIVE_PILOT_SIGNATURE_ENCODING,
        signerKeyId: signer.keyId,
        body,
        signature: proposedSignature,
      });
      if (
        proposedAssignment === undefined ||
        !verifyTelebirrLivePilotSignedAssignmentSignature(proposedAssignment, signerSpki)
      ) {
        throw new Error();
      }

      const persisted = await database.persistAssignmentSignature({
        verificationAttemptId: lease.verificationAttemptId,
        leaseToken: lease.leaseToken,
        assignmentSignerId: signer.assignmentSignerId,
        assignmentBodyDigest: bodyDigest,
        proposedAssignmentSignature: proposedSignature,
        proposedAssignmentSignatureDigest: proposedSignatureDigest,
        referenceBindingDigest: body.referenceBindingDigest,
      });
      const persistedValues = exactDataProperties(persisted, [
        'assignmentSignature',
        'assignmentSignatureDigest',
        'replayed',
      ]);
      if (
        persistedValues === undefined ||
        typeof persistedValues.assignmentSignature !== 'string' ||
        typeof persistedValues.assignmentSignatureDigest !== 'string' ||
        persistedValues.assignmentSignatureDigest !==
          signatureDigest(persistedValues.assignmentSignature) ||
        typeof persistedValues.replayed !== 'boolean'
      ) {
        throw new Error();
      }

      const assignment = decodeTelebirrLivePilotSignedAssignment({
        ...proposedAssignment,
        signature: persistedValues.assignmentSignature,
      });
      if (
        assignment === undefined ||
        !verifyTelebirrLivePilotSignedAssignmentSignature(assignment, signerSpki)
      ) {
        throw new Error();
      }
      return Object.freeze({ kind: 'assignment' as const, assignment });
    } catch {
      throw new TelebirrAssignmentBrokerError();
    }
  };
}

/** Safe diagnostic projection: no reference, ciphertext, fingerprint, receiver name, or signature. */
export function telebirrAssignmentBrokerLogProjection(
  result: TelebirrAssignmentBrokerPollResult,
): Readonly<Record<'assignmentIssued' | 'outcome', boolean | string>> {
  return Object.freeze({
    outcome: result.kind,
    assignmentIssued: result.kind === 'assignment',
  });
}
