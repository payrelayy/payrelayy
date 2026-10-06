export interface OwnerRoutineTelebirrPairingReceipt {
  readonly alreadyIssued: boolean;
  readonly assignmentPollingAllowed: false;
  readonly challengePackage: string;
  readonly enrollmentAllowed: false;
  readonly expiresAt: string;
  readonly moneyMovementAllowed: false;
  readonly pairingOnly: true;
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

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Builds only the untrusted phone-facing challenge shape, never a certificate. */
export class PostgresOwnerRoutineTelebirrPairing {
  constructor(private readonly database: OwnerRoutineTelebirrPairingDatabase) {}

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
        value.expires_at.getTime() - value.issued_at.getTime() > 600_000 ||
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
}
