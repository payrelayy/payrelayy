import {
  withOpenedTelebirrDepositProofReference,
  type TelebirrScopedReferenceOpeningKey,
} from '@fetanagent/telebirr-reference-opening';
import type { RoutineTelebirrPaidPhoneEvidence } from '@fetanagent/telebirr-verification-foundation';

import {
  buildRoutineTelebirrSignedLookupAssignment,
  decodeRoutineTelebirrAssignmentMaterialRow,
  type RoutineTelebirrAssignmentSigner,
} from './routine-telebirr-assignment-builder.js';
import {
  contextFromMaterial,
  enrollmentFromRow,
  signerMatches,
} from './routine-no-money-broker.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;

/** The paid role has four exact SQL entry points and no table grants. */
export interface RoutinePaidPollBrokerDatabase {
  loadEnrollment(enrollmentId: string): Promise<unknown | undefined>;
  issuePollAssignment(input: {
    readonly enrollmentId: string;
    readonly requestId: string;
    readonly replayIdentity: string;
    readonly requestExpiresAt: string;
    readonly signerId: string;
  }): Promise<unknown | undefined>;
  loadObservationMaterial(challengeId: string): Promise<unknown | undefined>;
  stageObservation(input: {
    readonly challengeId: string;
    readonly assignmentBodyDigest: string;
    readonly observationBodyDigest: string;
    readonly observationSignatureDigest: string;
    readonly replayIdentity: string;
    readonly signedObservation: unknown;
  }): Promise<unknown>;
}

export interface RoutinePaidPollBrokerDependencies {
  readonly database: RoutinePaidPollBrokerDatabase;
  readonly openingKey: TelebirrScopedReferenceOpeningKey;
  readonly signer: RoutineTelebirrAssignmentSigner;
  readonly now: () => string;
}

export class RoutinePaidPollBrokerUnavailableError extends Error {
  constructor() {
    super('The private routine paid poll broker is unavailable.');
    this.name = 'RoutinePaidPollBrokerUnavailableError';
  }
}

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

/** Pure broker core; no listener, credential loading, receipt write, or payment operation. */
export function createRoutinePaidPollBroker(dependencies: RoutinePaidPollBrokerDependencies) {
  const { database, openingKey, signer, now } = dependencies;
  if (!database || !openingKey || !signer || typeof now !== 'function') {
    throw new RoutinePaidPollBrokerUnavailableError();
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
        throw new RoutinePaidPollBrokerUnavailableError();
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
        )
          throw new Error();
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
        throw new RoutinePaidPollBrokerUnavailableError();
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
          Date.parse(assessedAt) >= Date.parse(material.expiresAt) + 15 * 60_000 ||
          Date.parse(assessedAt) >= Date.parse(material.candidateSubmittedAt) + 60 * 60_000
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
          (rawReference) =>
            Object.freeze({
              ...contextFromMaterial(material, rawReference, signer.publicKeySpkiDer),
              trustedIssuanceMode: 'paid' as const,
            }),
        );
      } catch {
        throw new RoutinePaidPollBrokerUnavailableError();
      }
    },
    async stageObservation(input: {
      readonly evidence: RoutineTelebirrPaidPhoneEvidence;
      readonly assignmentBodyDigest: string;
      readonly observationSignatureDigest: string;
      readonly signedObservation: unknown;
    }) {
      try {
        const { evidence } = input;
        if (
          !evidence ||
          evidence.providerCode !== 'telebirr' ||
          !UUID_V4.test(evidence.challengeId) ||
          !UUID_V4.test(evidence.candidateId) ||
          !DIGEST.test(evidence.observationBodyDigest) ||
          !DIGEST.test(evidence.replayIdentity) ||
          !DIGEST.test(input.assignmentBodyDigest) ||
          !DIGEST.test(input.observationSignatureDigest) ||
          typeof input.signedObservation !== 'object' ||
          input.signedObservation === null ||
          JSON.stringify(input.signedObservation).length > 16384
        )
          throw new Error();
        const result = await database.stageObservation({
          challengeId: evidence.challengeId,
          assignmentBodyDigest: input.assignmentBodyDigest,
          observationBodyDigest: evidence.observationBodyDigest,
          observationSignatureDigest: input.observationSignatureDigest,
          replayIdentity: evidence.replayIdentity,
          signedObservation: input.signedObservation,
        });
        if (result !== 'recorded' && result !== 'exact_replay' && result !== 'conflict')
          throw new Error();
        return result;
      } catch {
        throw new RoutinePaidPollBrokerUnavailableError();
      }
    },
  });
}
