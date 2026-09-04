import { createHash, createPublicKey } from 'node:crypto';

import {
  AGENT_PLATFORM_COMPANION_PAIRING_PACKAGE_PREFIX,
  AGENT_PLATFORM_COMPANION_PAIRING_PATH,
  AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
  type CompanionNoMoneySafety,
} from '@fetanagent/agent-platform-companion-contracts';

export const OWNER_COMPANION_MINIMUM_VERSION = '0.1.4' as const;
export const OWNER_COMPANION_PAIRING_ENDPOINT =
  `https://device.fetanagent.com${AGENT_PLATFORM_COMPANION_PAIRING_PATH}` as const;

const noMoneySafety: CompanionNoMoneySafety = Object.freeze({
  accountMutationAllowed: false,
  balanceMutationAllowed: false,
  providerMutationAllowed: false,
  paymentAllowed: false,
  depositAllowed: false,
  withdrawAllowed: false,
  transferAllowed: false,
  settlementAllowed: false,
  finalActionAllowed: false,
  financialActionAllowed: false,
  moneyMovementAllowed: false,
  transferDisabled: true,
  identifiersRedacted: true,
  moneyMoved: false,
});

export interface OwnerCompanionDevicePairingReceipt {
  readonly alreadyIssued: boolean;
  readonly devicePlatform: 'windows';
  readonly expiresAt: string;
  readonly lookupAllowed: false;
  readonly moneyMovementAllowed: false;
  readonly pairingOnly: true;
  readonly pairingPackage: string;
  readonly transferDisabled: true;
}

export interface OwnerCompanionDevicePairingDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerCompanionDevicePairingRejectedError extends Error {
  constructor() {
    super('The Owner companion device pairing request was rejected.');
    this.name = 'OwnerCompanionDevicePairingRejectedError';
  }
}

export class OwnerCompanionDevicePairingNotReadyError extends Error {
  constructor() {
    super('The Owner companion device pairing authority is not ready.');
    this.name = 'OwnerCompanionDevicePairingNotReadyError';
  }
}

export class OwnerCompanionDevicePairingUnavailableError extends Error {
  constructor() {
    super('The Owner companion device pairing service is unavailable.');
    this.name = 'OwnerCompanionDevicePairingUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SIGNER_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export const ISSUE_OWNER_COMPANION_PAIRING_SQL = `
  select pairing_id,
         pairing_nonce_digest,
         issued_at,
         expires_at,
         signer_key_id,
         server_signing_public_key_spki,
         server_signing_public_key_spki_sha256,
         minimum_companion_version,
         replayed
    from app.issue_agent_platform_companion_pairing(
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
    throw new OwnerCompanionDevicePairingUnavailableError();
  }
  return row as Record<string, unknown>;
}

function canonicalP256Spki(
  encoded: unknown,
  expectedDigest: unknown,
): { readonly encoded: string; readonly digest: string } {
  if (
    typeof encoded !== 'string' ||
    !/^[A-Za-z0-9_-]+$/u.test(encoded) ||
    encoded.length > 684 ||
    typeof expectedDigest !== 'string' ||
    !DIGEST_PATTERN.test(expectedDigest)
  ) {
    throw new OwnerCompanionDevicePairingUnavailableError();
  }
  const bytes = Buffer.from(encoded, 'base64url');
  try {
    if (bytes.toString('base64url') !== encoded) {
      throw new OwnerCompanionDevicePairingUnavailableError();
    }
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    const canonical = Buffer.from(key.export({ format: 'der', type: 'spki' }));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !canonical.equals(bytes) ||
      digest !== expectedDigest
    ) {
      canonical.fill(0);
      throw new OwnerCompanionDevicePairingUnavailableError();
    }
    canonical.fill(0);
    return Object.freeze({ encoded, digest });
  } catch (error) {
    if (error instanceof OwnerCompanionDevicePairingUnavailableError) throw error;
    throw new OwnerCompanionDevicePairingUnavailableError();
  } finally {
    bytes.fill(0);
  }
}

function pairingPackage(row: Record<string, unknown>): string {
  const issuedAt = (row.issued_at as Date).toISOString();
  const expiresAt = (row.expires_at as Date).toISOString();
  const publicKey = canonicalP256Spki(
    row.server_signing_public_key_spki,
    row.server_signing_public_key_spki_sha256,
  );
  const canonical = JSON.stringify({
    schemaVersion: 1,
    protocolMode: AGENT_PLATFORM_COMPANION_PROTOCOL_MODE,
    pairingId: row.pairing_id,
    pairingNonceDigest: row.pairing_nonce_digest,
    issuedAt,
    expiresAt,
    endpoint: OWNER_COMPANION_PAIRING_ENDPOINT,
    signerKeyId: row.signer_key_id,
    serverSigningPublicKeySpki: publicKey.encoded,
    serverSigningPublicKeySpkiSha256: publicKey.digest,
    minimumCompanionVersion: row.minimum_companion_version,
    oneUse: true,
    ...noMoneySafety,
  });
  const value =
    AGENT_PLATFORM_COMPANION_PAIRING_PACKAGE_PREFIX +
    Buffer.from(canonical, 'utf8').toString('base64url');
  if (value.length > 8_192) throw new OwnerCompanionDevicePairingUnavailableError();
  return value;
}

export class PostgresOwnerCompanionDevicePairing {
  constructor(
    private readonly database: OwnerCompanionDevicePairingDatabase,
    private readonly serverSignerKeyId: string,
  ) {
    if (!SIGNER_KEY_ID_PATTERN.test(serverSignerKeyId)) {
      throw new OwnerCompanionDevicePairingRejectedError();
    }
  }

  async issue(authUserId: string, requestId: string): Promise<OwnerCompanionDevicePairingReceipt> {
    if (!UUID_PATTERN.test(authUserId) || !UUID_V4_PATTERN.test(requestId)) {
      throw new OwnerCompanionDevicePairingRejectedError();
    }
    try {
      const result = await this.database.query(ISSUE_OWNER_COMPANION_PAIRING_SQL, [
        authUserId,
        requestId,
        this.serverSignerKeyId,
        OWNER_COMPANION_MINIMUM_VERSION,
      ]);
      const row = result.rows.length === 1 ? rowObject(result.rows[0]) : undefined;
      if (
        !row ||
        typeof row.pairing_id !== 'string' ||
        !UUID_V4_PATTERN.test(row.pairing_id) ||
        typeof row.pairing_nonce_digest !== 'string' ||
        !DIGEST_PATTERN.test(row.pairing_nonce_digest) ||
        !(row.issued_at instanceof Date) ||
        !(row.expires_at instanceof Date) ||
        !Number.isFinite(row.issued_at.getTime()) ||
        !Number.isFinite(row.expires_at.getTime()) ||
        row.expires_at.getTime() <= row.issued_at.getTime() ||
        row.expires_at.getTime() - row.issued_at.getTime() > 10 * 60 * 1_000 ||
        typeof row.signer_key_id !== 'string' ||
        row.signer_key_id !== this.serverSignerKeyId ||
        typeof row.minimum_companion_version !== 'string' ||
        row.minimum_companion_version !== OWNER_COMPANION_MINIMUM_VERSION ||
        typeof row.replayed !== 'boolean'
      ) {
        throw new OwnerCompanionDevicePairingUnavailableError();
      }
      return Object.freeze({
        alreadyIssued: row.replayed,
        devicePlatform: 'windows',
        expiresAt: row.expires_at.toISOString(),
        lookupAllowed: false,
        moneyMovementAllowed: false,
        pairingOnly: true,
        pairingPackage: pairingPackage(row),
        transferDisabled: true,
      });
    } catch (error) {
      if (
        error instanceof OwnerCompanionDevicePairingRejectedError ||
        error instanceof OwnerCompanionDevicePairingNotReadyError ||
        error instanceof OwnerCompanionDevicePairingUnavailableError
      ) {
        throw error;
      }
      if (databaseErrorCode(error) === 'P0001') {
        throw new OwnerCompanionDevicePairingNotReadyError();
      }
      throw new OwnerCompanionDevicePairingUnavailableError();
    }
  }
}
