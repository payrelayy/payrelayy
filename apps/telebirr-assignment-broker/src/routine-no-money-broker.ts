import { createHash, createPublicKey } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import {
  withOpenedTelebirrDepositProofReference,
  type TelebirrScopedReferenceOpeningKey,
} from '@fetanagent/telebirr-reference-opening';
import { ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE } from '@fetanagent/telebirr-verification-foundation';

import {
  buildRoutineTelebirrSignedLookupAssignment,
  decodeRoutineTelebirrAssignmentMaterialRow,
  type RoutineTelebirrAssignmentMaterial,
  type RoutineTelebirrAssignmentSigner,
} from './routine-telebirr-assignment-builder.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const HEADER = Object.freeze({
  contractVersion: 1,
  providerCode: 'telebirr',
  protocolMode: ROUTINE_TELEBIRR_LOOKUP_ASSIGNMENT_PROTOCOL_MODE,
});

/** Each method must call only the matching app.* no-money SQL function, under a separate private role. */
export interface RoutineNoMoneyBrokerDatabase {
  loadEnrollment(enrollmentId: string): Promise<unknown | undefined>;
  issuePollAssignment(input: {
    readonly enrollmentId: string;
    readonly requestId: string;
    readonly replayIdentity: string;
    readonly requestExpiresAt: string;
    readonly signerId: string;
  }): Promise<unknown | undefined>;
  loadObservationMaterial(challengeId: string): Promise<unknown | undefined>;
  stageObservationDigest(input: {
    readonly challengeId: string;
    readonly assignmentBodyDigest: string;
    readonly observationBodyDigest: string;
    readonly observationSignatureDigest: string;
    readonly replayIdentity: string;
    readonly signedObservation: unknown;
    readonly serverPolicyResult: 'signed_evidence_matches_policy' | 'receipt_policy_review';
  }): Promise<unknown>;
}

export interface RoutineNoMoneyBrokerDependencies {
  readonly database: RoutineNoMoneyBrokerDatabase;
  readonly openingKey: TelebirrScopedReferenceOpeningKey;
  readonly signer: RoutineTelebirrAssignmentSigner;
  readonly now: () => string;
}

export class RoutineNoMoneyBrokerUnavailableError extends Error {
  constructor() {
    super('The private routine no-money broker is unavailable.');
    this.name = 'RoutineNoMoneyBrokerUnavailableError';
  }
}

function utc(value: unknown): value is string {
  return typeof value === 'string' && UTC.test(value) && new Date(value).toISOString() === value;
}

function rowTimestamp(value: unknown): string | undefined {
  if (utc(value)) return value;
  if (nodeUtilTypes.isProxy(value) || !nodeUtilTypes.isDate(value)) return undefined;
  const milliseconds = Date.prototype.getTime.call(value);
  return Number.isFinite(milliseconds) ? Date.prototype.toISOString.call(value) : undefined;
}

function exactRow(
  candidate: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    nodeUtilTypes.isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  )
    return undefined;
  const actual = Reflect.ownKeys(candidate);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const field = descriptors[key];
    if (!field || !field.enumerable || !Object.hasOwn(field, 'value')) return undefined;
    result[key] = field.value;
  }
  return result;
}

const enrollmentRowKeys = [
  'enrollment_id',
  'device_id',
  'device_key_id',
  'device_public_key_spki_sha256',
  'valid_from',
  'valid_until',
  'receiver_revision_id',
  'receiver_profile_digest',
] as const;

export function enrollmentFromRow(
  candidate: unknown,
  now: string,
): Record<string, unknown> | undefined {
  const row = exactRow(candidate, enrollmentRowKeys);
  if (!row) return undefined;
  const validFrom = rowTimestamp(row.valid_from);
  const validUntil = rowTimestamp(row.valid_until);
  if (
    typeof row.enrollment_id !== 'string' ||
    !UUID_V4.test(row.enrollment_id) ||
    typeof row.receiver_revision_id !== 'string' ||
    !UUID_V4.test(row.receiver_revision_id) ||
    typeof row.device_id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(row.device_id) ||
    typeof row.device_key_id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(row.device_key_id) ||
    typeof row.device_public_key_spki_sha256 !== 'string' ||
    !DIGEST.test(row.device_public_key_spki_sha256) ||
    typeof row.receiver_profile_digest !== 'string' ||
    !DIGEST.test(row.receiver_profile_digest) ||
    !validFrom ||
    !validUntil ||
    validFrom > now ||
    validUntil <= now
  )
    return undefined;
  return Object.freeze({
    enrollmentId: row.enrollment_id,
    deviceId: row.device_id,
    keyId: row.device_key_id,
    publicKeySpkiSha256: row.device_public_key_spki_sha256,
    state: 'active',
    validFrom,
    validUntil,
    receiverRevisionId: row.receiver_revision_id,
    receiverProfileDigest: row.receiver_profile_digest,
  });
}

export function contextFromMaterial(
  material: RoutineTelebirrAssignmentMaterial,
  rawReference: string,
  signerSpkiDer: Uint8Array,
) {
  const trustedLookup = Object.freeze({
    ...HEADER,
    candidateId: material.candidateId,
    referenceFingerprint: material.candidateReferenceFingerprint,
    referenceKeyVersion: material.referenceEncryptionKeyVersion,
    referenceProfileVersion: material.referenceProfileVersion,
    submittedAt: material.candidateSubmittedAt,
    receiverRevisionId: material.receiverRevisionId,
    receiverVersion: material.receiverVersion,
    receiverProfileDigest: material.receiverProfileDigest,
    expectedReceiverNameDigest: material.expectedReceiverNameDigest,
    deviceId: material.deviceId,
    keyId: material.deviceKeyId,
    challengeId: material.challengeId,
    challengeDigest: material.challengeDigest,
    issuedAt: material.issuedAt,
    expiresAt: material.expiresAt,
  });
  return Object.freeze({
    enrollmentId: material.deviceEnrollmentId,
    trustedLookup,
    trustedRawReference: rawReference,
    trustedSigner: Object.freeze({
      ...HEADER,
      signerKeyId: material.assignmentSignerKeyId,
      publicKeySpkiSha256: material.assignmentSignerPublicKeySpkiSha256,
      state: 'active',
      validFrom: material.signerValidFrom,
      validUntil: material.signerValidUntil,
    }),
    deviceEnrollment: Object.freeze({
      ...HEADER,
      deviceId: material.deviceId,
      keyId: material.deviceKeyId,
      publicKeySpkiSha256: material.devicePublicKeySpkiSha256,
      state: 'active',
      validFrom: material.deviceValidFrom,
      validUntil: material.deviceValidUntil,
      receiverRevisionId: material.receiverRevisionId,
      receiverVersion: material.receiverVersion,
      receiverProfileDigest: material.receiverProfileDigest,
    }),
    trustedSignerSpkiDer: Buffer.from(signerSpkiDer),
  });
}

export function signerMatches(
  material: RoutineTelebirrAssignmentMaterial,
  signer: RoutineTelebirrAssignmentSigner,
): boolean {
  try {
    const der = Buffer.from(signer.publicKeySpkiDer);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return (
      signer.assignmentSignerId === material.assignmentSignerId &&
      signer.keyId === material.assignmentSignerKeyId &&
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      Buffer.from(key.export({ format: 'der', type: 'spki' })).equals(der) &&
      `sha256:${createHash('sha256').update(der).digest('hex')}` ===
        material.assignmentSignerPublicKeySpkiSha256
    );
  } catch {
    return false;
  }
}

/** Private core only: no listener, database credential, payment claim, or production mount. */
export function createRoutineNoMoneyBroker(dependencies: RoutineNoMoneyBrokerDependencies) {
  const { database, openingKey, signer, now } = dependencies;
  if (!database || !openingKey || !signer || typeof now !== 'function') {
    throw new RoutineNoMoneyBrokerUnavailableError();
  }
  return Object.freeze({
    now,
    async loadEnrollment(enrollmentId: string) {
      try {
        const assessedAt = now();
        if (!UUID_V4.test(enrollmentId) || !utc(assessedAt)) throw new Error();
        const row = await database.loadEnrollment(enrollmentId);
        if (row === undefined) return undefined;
        const enrollment = enrollmentFromRow(row, assessedAt);
        if (!enrollment || enrollment.enrollmentId !== enrollmentId) throw new Error();
        return Object.freeze({ enrollment });
      } catch {
        throw new RoutineNoMoneyBrokerUnavailableError();
      }
    },
    async claimAndIssuePoll(input: {
      readonly enrollmentId: string;
      readonly requestId: string;
      readonly replayIdentity: string;
      readonly requestExpiresAt: string;
    }) {
      try {
        if (
          !UUID_V4.test(input.enrollmentId) ||
          !UUID_V4.test(input.requestId) ||
          !DIGEST.test(input.replayIdentity) ||
          !utc(input.requestExpiresAt) ||
          !UUID_V4.test(signer.assignmentSignerId)
        )
          throw new Error();
        const row = await database.issuePollAssignment({
          ...input,
          signerId: signer.assignmentSignerId,
        });
        if (row === undefined) return Object.freeze({ kind: 'none' as const });
        const material = decodeRoutineTelebirrAssignmentMaterialRow(row);
        if (
          !material ||
          material.deviceEnrollmentId !== input.enrollmentId ||
          !signerMatches(material, signer)
        ) {
          throw new Error();
        }
        const signedAssignment = await buildRoutineTelebirrSignedLookupAssignment(
          material,
          openingKey,
          signer,
          now,
        );
        return Object.freeze({
          kind: 'assignment' as const,
          context: Object.freeze({
            ...contextFromMaterial(
              material,
              signedAssignment.body.rawReference as string,
              signer.publicKeySpkiDer,
            ),
            signedAssignment,
          }),
        });
      } catch {
        throw new RoutineNoMoneyBrokerUnavailableError();
      }
    },
    async loadObservation(challengeId: string) {
      try {
        const assessedAt = now();
        if (!UUID_V4.test(challengeId) || !utc(assessedAt)) throw new Error();
        const row = await database.loadObservationMaterial(challengeId);
        if (row === undefined) return undefined;
        const material = decodeRoutineTelebirrAssignmentMaterialRow(row);
        if (
          !material ||
          material.challengeId !== challengeId ||
          !signerMatches(material, signer) ||
          assessedAt < material.issuedAt ||
          assessedAt >= material.expiresAt
        )
          throw new Error();
        return withOpenedTelebirrDepositProofReference(
          {
            ciphertext: material.candidateReferenceCiphertext,
            ciphertextProfileVersion: material.referenceProfileVersion,
            encryptionKeyVersion: material.referenceEncryptionKeyVersion,
            providerCode: 'telebirr',
          },
          openingKey,
          (rawReference) => contextFromMaterial(material, rawReference, signer.publicKeySpkiDer),
        );
      } catch {
        throw new RoutineNoMoneyBrokerUnavailableError();
      }
    },
    async stageObservationDigest(input: {
      readonly challengeId: string;
      readonly assignmentBodyDigest: string;
      readonly observationBodyDigest: string;
      readonly observationSignatureDigest: string;
      readonly replayIdentity: string;
      readonly signedObservation: unknown;
      readonly serverPolicyResult: 'signed_evidence_matches_policy' | 'receipt_policy_review';
    }) {
      try {
        if (
          !UUID_V4.test(input.challengeId) ||
          !DIGEST.test(input.assignmentBodyDigest) ||
          !DIGEST.test(input.observationBodyDigest) ||
          !DIGEST.test(input.observationSignatureDigest) ||
          !DIGEST.test(input.replayIdentity) ||
          !['signed_evidence_matches_policy', 'receipt_policy_review'].includes(
            input.serverPolicyResult,
          ) ||
          !exactRow(input.signedObservation, [
            'contractVersion',
            'providerCode',
            'protocolMode',
            'transcriptVersion',
            'bodyDigestAlgorithm',
            'bodyDigest',
            'signatureAlgorithm',
            'signatureEncoding',
            'body',
            'signature',
          ]) ||
          (input.signedObservation as Record<string, unknown>).bodyDigest !==
            input.observationBodyDigest ||
          JSON.stringify(input.signedObservation).length > 16384
        )
          throw new Error();
        const result = await database.stageObservationDigest(input);
        if (result !== 'recorded' && result !== 'exact_replay' && result !== 'conflict') {
          throw new Error();
        }
        return result;
      } catch {
        throw new RoutineNoMoneyBrokerUnavailableError();
      }
    },
  });
}
