import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/u;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const TRANSCRIPT_DOMAIN = 'fetanagent:receiver-sms:phone-pairing:v1';

export interface OwnerReceiverSmsSimplePairingDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class ReceiverSmsSimplePairingRejectedError extends Error {
  constructor() {
    super('Receiver SMS phone pairing was rejected.');
    this.name = 'ReceiverSmsSimplePairingRejectedError';
  }
}

export class ReceiverSmsSimplePairingUnavailableError extends Error {
  constructor() {
    super('Receiver SMS phone pairing is unavailable.');
    this.name = 'ReceiverSmsSimplePairingUnavailableError';
  }
}

export interface ReceiverSmsSimplePairingRequest {
  readonly code: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly signature: string;
}

export interface ReceiverSmsSimplePairingResult {
  readonly enrollmentId: string;
  readonly deviceId: string;
  readonly keyId: string;
  readonly alreadyEnrolled: boolean;
}

function digest(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

export function receiverSmsPairingTranscript(request: ReceiverSmsSimplePairingRequest): Buffer {
  return Buffer.from(
    `${TRANSCRIPT_DOMAIN}\n${request.code}\n${request.deviceId}\n${request.keyId}\n${request.publicKeySpki}`,
    'utf8',
  );
}

/** A code is one-use but has no clock-based expiry. Only its SHA-256 digest is stored. */
export class PostgresOwnerReceiverSmsSimplePairing {
  constructor(private readonly database: OwnerReceiverSmsSimplePairingDatabase) {}

  async issue(authUserId: string): Promise<{ readonly code: string }> {
    if (!UUID_V4.test(authUserId)) throw new ReceiverSmsSimplePairingRejectedError();
    const entropy = randomBytes(12);
    const code = Array.from(entropy, (value) => CODE_ALPHABET[value & 31]).join('');
    try {
      const result = await this.database.query(
        'select app.issue_owner_receiver_sms_pairing_code($1::uuid,$2::text) as pairing_id',
        [authUserId, digest(code)],
      );
      const row = result.rows.length === 1 ? result.rows[0] : undefined;
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        !('pairing_id' in row) ||
        typeof row.pairing_id !== 'string' ||
        !UUID_V4.test(row.pairing_id)
      )
        throw new ReceiverSmsSimplePairingUnavailableError();
      return { code };
    } catch (error) {
      if (error instanceof ReceiverSmsSimplePairingUnavailableError) throw error;
      if (databaseErrorCode(error) === '42501') throw new ReceiverSmsSimplePairingRejectedError();
      throw new ReceiverSmsSimplePairingUnavailableError();
    }
  }

  async activate(
    request: ReceiverSmsSimplePairingRequest,
  ): Promise<ReceiverSmsSimplePairingResult> {
    if (
      !request ||
      !CODE.test(request.code) ||
      !OPAQUE.test(request.deviceId) ||
      !OPAQUE.test(request.keyId) ||
      typeof request.publicKeySpki !== 'string' ||
      request.publicKeySpki.length > 684 ||
      !BASE64URL.test(request.publicKeySpki) ||
      typeof request.signature !== 'string' ||
      request.signature.length !== 86 ||
      !BASE64URL.test(request.signature)
    )
      throw new ReceiverSmsSimplePairingRejectedError();
    let keyDigest: string;
    try {
      const spki = Buffer.from(request.publicKeySpki, 'base64url');
      const signature = Buffer.from(request.signature, 'base64url');
      if (
        spki.length < 64 ||
        spki.length > 512 ||
        spki.toString('base64url') !== request.publicKeySpki ||
        signature.length !== 64 ||
        signature.toString('base64url') !== request.signature
      )
        throw new Error();
      const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
        throw new Error();
      keyDigest = digest(spki);
      const fingerprint = keyDigest.slice('sha256:'.length);
      if (
        request.deviceId !== `routine_device_${fingerprint}` ||
        request.keyId !== `routine_key_${fingerprint}` ||
        !verify(
          'sha256',
          receiverSmsPairingTranscript(request),
          { key, dsaEncoding: 'ieee-p1363' },
          signature,
        )
      )
        throw new Error();
    } catch {
      throw new ReceiverSmsSimplePairingRejectedError();
    }
    try {
      const result = await this.database.query(
        `select enrollment_id, already_enrolled from app.consume_receiver_sms_pairing_code(
           $1::text,$2::text,$3::text,$4::text,$5::text)`,
        [
          digest(request.code),
          digest(receiverSmsPairingTranscript(request)),
          request.deviceId,
          request.keyId,
          keyDigest,
        ],
      );
      const row = result.rows.length === 1 ? result.rows[0] : undefined;
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        !('enrollment_id' in row) ||
        typeof row.enrollment_id !== 'string' ||
        !UUID_V4.test(row.enrollment_id) ||
        !('already_enrolled' in row) ||
        typeof row.already_enrolled !== 'boolean'
      )
        throw new ReceiverSmsSimplePairingUnavailableError();
      return {
        enrollmentId: row.enrollment_id,
        deviceId: request.deviceId,
        keyId: request.keyId,
        alreadyEnrolled: row.already_enrolled,
      };
    } catch (error) {
      if (error instanceof ReceiverSmsSimplePairingUnavailableError) throw error;
      if (databaseErrorCode(error) === '42501') throw new ReceiverSmsSimplePairingRejectedError();
      throw new ReceiverSmsSimplePairingUnavailableError();
    }
  }
}
