export const OWNER_TELEBIRR_MINIMUM_ANDROID_APP_VERSION = '0.5.0';

export interface OwnerTelebirrDevicePairingReceipt {
  readonly alreadyIssued: boolean;
  readonly assignmentPollingAllowed: false;
  readonly expiresAt: string;
  readonly moneyMovementAllowed: false;
  readonly pairingOnly: true;
  readonly pairingPackage: string;
}

export interface OwnerTelebirrDevicePairingDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerTelebirrDevicePairingRejectedError extends Error {
  constructor() {
    super('The Owner TeleBirr device pairing request was rejected.');
    this.name = 'OwnerTelebirrDevicePairingRejectedError';
  }
}

export class OwnerTelebirrDevicePairingNotReadyError extends Error {
  constructor() {
    super('The Owner TeleBirr device pairing authority is not ready.');
    this.name = 'OwnerTelebirrDevicePairingNotReadyError';
  }
}

export class OwnerTelebirrDevicePairingUnavailableError extends Error {
  constructor() {
    super('The Owner TeleBirr device pairing service is unavailable.');
    this.name = 'OwnerTelebirrDevicePairingUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SIGNER_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PAIRING_PACKAGE_PREFIX = 'fetanagent-pairing-v1.';

const ISSUE_SQL = `
  select pairing_id,
         pairing_nonce_digest,
         expires_at,
         replayed
    from app.issue_current_private_telebirr_device_pairing(
      $1::uuid,
      $2::uuid,
      $3::text,
      $4::text
    )
`;

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new OwnerTelebirrDevicePairingUnavailableError();
  }
  return row as Record<string, unknown>;
}

function pairingPackage(pairingId: string, pairingNonceDigest: string, expiresAt: string): string {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    pairingId,
    pairingNonceDigest,
    expiresAt,
  });
  const value = PAIRING_PACKAGE_PREFIX + Buffer.from(canonical, 'utf8').toString('base64url');
  if (value.length > 1_024) throw new OwnerTelebirrDevicePairingUnavailableError();
  return value;
}

export class PostgresOwnerTelebirrDevicePairing {
  constructor(
    private readonly database: OwnerTelebirrDevicePairingDatabase,
    private readonly assignmentSignerKeyId: string,
  ) {
    if (!SIGNER_KEY_ID_PATTERN.test(assignmentSignerKeyId)) {
      throw new OwnerTelebirrDevicePairingRejectedError();
    }
  }

  async issue(authUserId: string, requestId: string): Promise<OwnerTelebirrDevicePairingReceipt> {
    if (!UUID_PATTERN.test(authUserId) || !UUID_V4_PATTERN.test(requestId)) {
      throw new OwnerTelebirrDevicePairingRejectedError();
    }

    try {
      const result = await this.database.query(ISSUE_SQL, [
        authUserId,
        requestId,
        this.assignmentSignerKeyId,
        OWNER_TELEBIRR_MINIMUM_ANDROID_APP_VERSION,
      ]);
      const row = result.rows.length === 1 ? rowObject(result.rows[0]) : undefined;
      if (
        !row ||
        typeof row.pairing_id !== 'string' ||
        !UUID_V4_PATTERN.test(row.pairing_id) ||
        typeof row.pairing_nonce_digest !== 'string' ||
        !DIGEST_PATTERN.test(row.pairing_nonce_digest) ||
        !(row.expires_at instanceof Date) ||
        !Number.isFinite(row.expires_at.getTime()) ||
        typeof row.replayed !== 'boolean'
      ) {
        throw new OwnerTelebirrDevicePairingUnavailableError();
      }
      const expiresAt = row.expires_at.toISOString();
      return {
        alreadyIssued: row.replayed,
        assignmentPollingAllowed: false,
        expiresAt,
        moneyMovementAllowed: false,
        pairingOnly: true,
        pairingPackage: pairingPackage(row.pairing_id, row.pairing_nonce_digest, expiresAt),
      };
    } catch (error) {
      if (
        error instanceof OwnerTelebirrDevicePairingRejectedError ||
        error instanceof OwnerTelebirrDevicePairingNotReadyError ||
        error instanceof OwnerTelebirrDevicePairingUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerTelebirrDevicePairingNotReadyError();
      }
      throw new OwnerTelebirrDevicePairingUnavailableError();
    }
  }
}
