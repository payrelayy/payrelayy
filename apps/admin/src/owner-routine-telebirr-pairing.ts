import { assessRoutineTelebirrDevicePairingProof } from '@fetanagent/telebirr-verification-foundation';

export interface OwnerRoutineTelebirrPairingReceipt {
  readonly alreadyIssued: boolean;
  readonly assignmentPollingAllowed: false;
  readonly challengePackage: string;
  readonly enrollmentAllowed: false;
  readonly expiresAt: string;
  readonly moneyMovementAllowed: false;
  readonly pairingOnly: true;
}

export interface OwnerRoutineTelebirrEnrollmentReceipt {
  readonly alreadyEnrolled: boolean;
  readonly assignmentPollingAllowed: false;
  readonly enrollmentId: string;
  readonly moneyMovementAllowed: false;
  readonly pairingOnly: true;
  readonly validUntil: string;
}

export interface OwnerRoutineTelebirrRevocationReceipt {
  readonly alreadyRevoked: boolean;
  readonly assignmentPollingAllowed: false;
  readonly enrollmentId: string;
  readonly moneyMovementAllowed: false;
  readonly revokedAt: string;
}

export interface OwnerRoutineTelebirrActivePhoneInventory {
  readonly assignmentPollingAllowed: false;
  readonly moneyMovementAllowed: false;
  readonly phones: readonly {
    readonly deviceId: string;
    readonly deviceKeyId: string;
    readonly enrollmentId: string;
    readonly validUntil: string;
  }[];
}

export interface OwnerRoutineTelebirrPairingDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerRoutineTelebirrPairingRejectedError extends Error {
  constructor() {
    super('The routine TeleBirr pairing challenge request was rejected.');
    this.name = 'OwnerRoutineTelebirrPairingRejectedError';
  }
}

export class OwnerRoutineTelebirrPairingNotReadyError extends Error {
  constructor() {
    super('The routine TeleBirr pairing challenge is not ready.');
    this.name = 'OwnerRoutineTelebirrPairingNotReadyError';
  }
}

export class OwnerRoutineTelebirrPairingUnavailableError extends Error {
  constructor() {
    super('The routine TeleBirr pairing challenge service is unavailable.');
    this.name = 'OwnerRoutineTelebirrPairingUnavailableError';
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PREFIX = 'fetanagent-routine-pairing-v1.';
const ISSUE_SQL = `
  select pairing_id, pairing_nonce_digest, receiver_revision_id, receiver_version,
         receiver_profile_digest, expected_receiver_name_digest,
         issued_at, expires_at, replayed
    from app.issue_owner_routine_telebirr_device_pairing_challenge($1::uuid, $2::uuid)
`;
const TRUSTED_CHALLENGE_SQL = `
  select pairing_id, pairing_nonce_digest, receiver_revision_id, receiver_version,
         receiver_profile_digest, expected_receiver_name_digest, issued_at, expires_at
    from app.get_owner_routine_telebirr_device_pairing_challenge($1::uuid, $2::uuid)
`;
const ENROLL_SQL = `
  select enrollment_id, valid_from, valid_until, replayed
    from app.enroll_owner_routine_telebirr_device_pairing_proof(
      $1::uuid, $2::uuid, $3::text, $4::uuid, $5::integer,
      $6::text, $7::text, $8::text, $9::text, $10::text,
      $11::text, $12::timestamptz, $13::timestamptz)
`;
const REVOKE_SQL = `
  select enrollment_id, revoked_at, already_revoked
    from app.revoke_owner_routine_telebirr_device_enrollment($1::uuid, $2::uuid)
`;
const LIST_ACTIVE_PHONES_SQL = `
  select enrollment_id, device_id, device_key_id, valid_until
    from app.list_owner_routine_telebirr_active_phone_enrollments($1::uuid)
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Builds only the untrusted phone-facing challenge shape, never a certificate. */
export class PostgresOwnerRoutineTelebirrPairing {
  constructor(
    private readonly database: OwnerRoutineTelebirrPairingDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(authUserId: string, requestId: string): Promise<OwnerRoutineTelebirrPairingReceipt> {
    if (!UUID_V4.test(authUserId) || !UUID_V4.test(requestId)) {
      throw new OwnerRoutineTelebirrPairingRejectedError();
    }
    try {
      const result = await this.database.query(ISSUE_SQL, [authUserId, requestId]);
      const row = result.rows.length === 1 ? result.rows[0] : undefined;
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      const value = row as Record<string, unknown>;
      if (
        typeof value.pairing_id !== 'string' ||
        !UUID_V4.test(value.pairing_id) ||
        typeof value.pairing_nonce_digest !== 'string' ||
        !DIGEST.test(value.pairing_nonce_digest) ||
        typeof value.receiver_revision_id !== 'string' ||
        !UUID_V4.test(value.receiver_revision_id) ||
        typeof value.receiver_version !== 'number' ||
        !Number.isInteger(value.receiver_version) ||
        value.receiver_version < 1 ||
        typeof value.receiver_profile_digest !== 'string' ||
        !DIGEST.test(value.receiver_profile_digest) ||
        typeof value.expected_receiver_name_digest !== 'string' ||
        !DIGEST.test(value.expected_receiver_name_digest) ||
        !(value.issued_at instanceof Date) ||
        !Number.isFinite(value.issued_at.getTime()) ||
        !(value.expires_at instanceof Date) ||
        !Number.isFinite(value.expires_at.getTime()) ||
        value.expires_at.getTime() <= value.issued_at.getTime() ||
        value.expires_at.getTime() - value.issued_at.getTime() > 43_200_000 ||
        typeof value.replayed !== 'boolean'
      ) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      const challengePackage =
        PREFIX +
        Buffer.from(
          JSON.stringify({
            contractVersion: 1,
            providerCode: 'telebirr',
            protocolMode: 'routine_device_pairing_v1',
            pairingId: value.pairing_id,
            pairingNonceDigest: value.pairing_nonce_digest,
            receiverRevisionId: value.receiver_revision_id,
            receiverVersion: value.receiver_version,
            receiverProfileDigest: value.receiver_profile_digest,
            expectedReceiverNameDigest: value.expected_receiver_name_digest,
            issuedAt: value.issued_at.toISOString(),
            expiresAt: value.expires_at.toISOString(),
          }),
          'utf8',
        ).toString('base64url');
      if (challengePackage.length > 1_024) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      return {
        alreadyIssued: value.replayed,
        assignmentPollingAllowed: false,
        challengePackage,
        enrollmentAllowed: false,
        expiresAt: value.expires_at.toISOString(),
        moneyMovementAllowed: false,
        pairingOnly: true,
      };
    } catch (error) {
      if (
        error instanceof OwnerRoutineTelebirrPairingRejectedError ||
        error instanceof OwnerRoutineTelebirrPairingUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === '42501') {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerRoutineTelebirrPairingNotReadyError();
      }
      throw new OwnerRoutineTelebirrPairingUnavailableError();
    }
  }

  /** Owner-mediated proof transfer only; no pilot certificate or financial action is accepted. */
  async enroll(
    authUserId: string,
    signedRequest: unknown,
  ): Promise<OwnerRoutineTelebirrEnrollmentReceipt> {
    if (!UUID_V4.test(authUserId)) throw new OwnerRoutineTelebirrPairingRejectedError();
    try {
      if (
        typeof signedRequest !== 'object' ||
        signedRequest === null ||
        Array.isArray(signedRequest) ||
        Buffer.byteLength(JSON.stringify(signedRequest), 'utf8') > 4_096
      ) {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      const envelope = signedRequest as Record<string, unknown>;
      const candidateBody = envelope.body;
      if (
        typeof candidateBody !== 'object' ||
        candidateBody === null ||
        Array.isArray(candidateBody)
      ) {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      const body = candidateBody as Record<string, unknown>;
      if (typeof body.pairingId !== 'string' || !UUID_V4.test(body.pairingId)) {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      const trusted = await this.database.query(TRUSTED_CHALLENGE_SQL, [
        authUserId,
        body.pairingId,
      ]);
      const row = trusted.rows.length === 1 ? trusted.rows[0] : undefined;
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new OwnerRoutineTelebirrPairingNotReadyError();
      }
      const challenge = row as Record<string, unknown>;
      if (
        challenge.pairing_id !== body.pairingId ||
        typeof challenge.pairing_nonce_digest !== 'string' ||
        !DIGEST.test(challenge.pairing_nonce_digest) ||
        typeof challenge.receiver_revision_id !== 'string' ||
        !UUID_V4.test(challenge.receiver_revision_id) ||
        typeof challenge.receiver_version !== 'number' ||
        !Number.isInteger(challenge.receiver_version) ||
        challenge.receiver_version < 1 ||
        typeof challenge.receiver_profile_digest !== 'string' ||
        !DIGEST.test(challenge.receiver_profile_digest) ||
        typeof challenge.expected_receiver_name_digest !== 'string' ||
        !DIGEST.test(challenge.expected_receiver_name_digest) ||
        !(challenge.issued_at instanceof Date) ||
        !(challenge.expires_at instanceof Date) ||
        !Number.isFinite(challenge.issued_at.getTime()) ||
        !Number.isFinite(challenge.expires_at.getTime())
      ) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      const assessedAt = this.now().toISOString();
      const assessment = assessRoutineTelebirrDevicePairingProof({
        assessedAt,
        trustedChallenge: {
          contractVersion: 1,
          providerCode: 'telebirr',
          protocolMode: 'routine_device_pairing_v1',
          pairingId: challenge.pairing_id,
          pairingNonceDigest: challenge.pairing_nonce_digest,
          receiverRevisionId: challenge.receiver_revision_id,
          receiverVersion: challenge.receiver_version,
          receiverProfileDigest: challenge.receiver_profile_digest,
          expectedReceiverNameDigest: challenge.expected_receiver_name_digest,
          issuedAt: challenge.issued_at.toISOString(),
          expiresAt: challenge.expires_at.toISOString(),
          state: 'issued',
        },
        signedRequest,
      });
      if (!assessment.deviceSignatureVerified || !assessment.pairingEvidenceDigest) {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      const values = [
        authUserId,
        body.pairingId as string,
        body.pairingNonceDigest as string,
        body.receiverRevisionId as string,
        String(body.receiverVersion),
        body.receiverProfileDigest as string,
        body.expectedReceiverNameDigest as string,
        assessment.pairingEvidenceDigest,
        body.deviceId as string,
        body.keyId as string,
        body.devicePublicKeySpkiSha256 as string,
        body.issuedAt as string,
        body.expiresAt as string,
      ];
      const enrolled = await this.database.query(ENROLL_SQL, values);
      const receipt = enrolled.rows.length === 1 ? enrolled.rows[0] : undefined;
      if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      const result = receipt as Record<string, unknown>;
      if (
        typeof result.enrollment_id !== 'string' ||
        !UUID_V4.test(result.enrollment_id) ||
        !(result.valid_from instanceof Date) ||
        !(result.valid_until instanceof Date) ||
        !Number.isFinite(result.valid_from.getTime()) ||
        !Number.isFinite(result.valid_until.getTime()) ||
        result.valid_until.getTime() <= result.valid_from.getTime() ||
        result.valid_until.getTime() - result.valid_from.getTime() > 30 * 86_400_000 ||
        typeof result.replayed !== 'boolean'
      ) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      return {
        alreadyEnrolled: result.replayed,
        assignmentPollingAllowed: false,
        enrollmentId: result.enrollment_id,
        moneyMovementAllowed: false,
        pairingOnly: true,
        validUntil: result.valid_until.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof OwnerRoutineTelebirrPairingRejectedError ||
        error instanceof OwnerRoutineTelebirrPairingNotReadyError ||
        error instanceof OwnerRoutineTelebirrPairingUnavailableError
      )
        throw error;
      if (databaseErrorCode(error) === '42501') {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerRoutineTelebirrPairingNotReadyError();
      }
      throw new OwnerRoutineTelebirrPairingUnavailableError();
    }
  }

  /** Stops one exact Owner-linked routine enrollment; never selects a replacement phone. */
  async revoke(
    authUserId: string,
    enrollmentId: string,
  ): Promise<OwnerRoutineTelebirrRevocationReceipt> {
    if (!UUID_V4.test(authUserId) || !UUID_V4.test(enrollmentId)) {
      throw new OwnerRoutineTelebirrPairingRejectedError();
    }
    try {
      const revoked = await this.database.query(REVOKE_SQL, [authUserId, enrollmentId]);
      const row = revoked.rows.length === 1 ? revoked.rows[0] : undefined;
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      const value = row as Record<string, unknown>;
      if (
        value.enrollment_id !== enrollmentId ||
        !(value.revoked_at instanceof Date) ||
        !Number.isFinite(value.revoked_at.getTime()) ||
        typeof value.already_revoked !== 'boolean'
      ) {
        throw new OwnerRoutineTelebirrPairingUnavailableError();
      }
      return {
        alreadyRevoked: value.already_revoked,
        assignmentPollingAllowed: false,
        enrollmentId,
        moneyMovementAllowed: false,
        revokedAt: value.revoked_at.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof OwnerRoutineTelebirrPairingRejectedError ||
        error instanceof OwnerRoutineTelebirrPairingUnavailableError
      )
        throw error;
      if (databaseErrorCode(error) === '42501') {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      throw new OwnerRoutineTelebirrPairingUnavailableError();
    }
  }

  /** Lists only current Owner-linked routine phones, without requiring a receipt signer. */
  async listActivePhones(authUserId: string): Promise<OwnerRoutineTelebirrActivePhoneInventory> {
    if (!UUID_V4.test(authUserId)) throw new OwnerRoutineTelebirrPairingRejectedError();
    try {
      const result = await this.database.query(LIST_ACTIVE_PHONES_SQL, [authUserId]);
      if (result.rows.length > 100) throw new OwnerRoutineTelebirrPairingUnavailableError();
      const seen = new Set<string>();
      const phones = result.rows.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          throw new OwnerRoutineTelebirrPairingUnavailableError();
        }
        const value = row as Record<string, unknown>;
        if (
          typeof value.enrollment_id !== 'string' ||
          !UUID_V4.test(value.enrollment_id) ||
          typeof value.device_id !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(value.device_id) ||
          typeof value.device_key_id !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(value.device_key_id) ||
          !(value.valid_until instanceof Date) ||
          !Number.isFinite(value.valid_until.getTime()) ||
          seen.has(value.enrollment_id)
        ) {
          throw new OwnerRoutineTelebirrPairingUnavailableError();
        }
        seen.add(value.enrollment_id);
        return {
          deviceId: value.device_id,
          deviceKeyId: value.device_key_id,
          enrollmentId: value.enrollment_id,
          validUntil: value.valid_until.toISOString(),
        };
      });
      return { assignmentPollingAllowed: false, moneyMovementAllowed: false, phones };
    } catch (error) {
      if (
        error instanceof OwnerRoutineTelebirrPairingRejectedError ||
        error instanceof OwnerRoutineTelebirrPairingUnavailableError
      )
        throw error;
      if (databaseErrorCode(error) === '42501') {
        throw new OwnerRoutineTelebirrPairingRejectedError();
      }
      throw new OwnerRoutineTelebirrPairingUnavailableError();
    }
  }
}
