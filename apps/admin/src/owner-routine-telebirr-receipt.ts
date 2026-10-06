import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

import {
  canonicalRoutineTelebirrEnrollmentReceiptSignatureBytes,
  digestRoutineTelebirrEnrollmentReceiptBody,
  verifySignedRoutineTelebirrEnrollmentReceipt,
  type RoutineTelebirrEnrollmentReceiptBody,
} from '@fetanagent/telebirr-verification-foundation';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const PACKAGE_PREFIX = 'fetanagent-routine-enrollment-receipt-v1.';
const MATERIAL_SQL = `
  select enrollment_id, pairing_evidence_digest, device_id, device_key_id,
         device_public_key_spki_sha256, receiver_revision_id, receiver_version,
         receiver_profile_digest, expected_receiver_name_digest, valid_from,
         valid_until, issued_at, signer_valid_from, signer_valid_until
    from app.get_owner_routine_telebirr_enrollment_receipt_material($1::uuid, $2::text, $3::text)
`;

export interface OwnerRoutineTelebirrReceiptDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface OwnerRoutineTelebirrSignedReceipt {
  readonly assignmentPollingAllowed: false;
  readonly financialActionAllowed: false;
  readonly moneyMovementAllowed: false;
  readonly receiptPackage: string;
  readonly validUntil: string;
}

export class OwnerRoutineTelebirrReceiptRejectedError extends Error {
  constructor() {
    super('The routine enrollment receipt request was rejected.');
    this.name = 'OwnerRoutineTelebirrReceiptRejectedError';
  }
}

export class OwnerRoutineTelebirrReceiptNotReadyError extends Error {
  constructor() {
    super('The routine enrollment receipt is not ready.');
    this.name = 'OwnerRoutineTelebirrReceiptNotReadyError';
  }
}

export class OwnerRoutineTelebirrReceiptUnavailableError extends Error {
  constructor() {
    super('The routine enrollment receipt service is unavailable.');
    this.name = 'OwnerRoutineTelebirrReceiptUnavailableError';
  }
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Signs only the existing Owner-linked no-money enrollment. No key is generated here. */
export class PostgresOwnerRoutineTelebirrReceipt {
  private readonly privateKey;
  private readonly publicKeySpki: string;
  private readonly publicKeySpkiSha256: string;

  constructor(
    private readonly database: OwnerRoutineTelebirrReceiptDatabase,
    private readonly signerKeyId: string,
    privateKeyPkcs8: string,
  ) {
    if (!/^telebirr-routine-enrollment-(staging|production)-v[1-9][0-9]*$/u.test(signerKeyId)) {
      throw new OwnerRoutineTelebirrReceiptUnavailableError();
    }
    try {
      const der = Buffer.from(privateKeyPkcs8, 'base64url');
      if (der.length < 100 || der.length > 512 || der.toString('base64url') !== privateKeyPkcs8) {
        throw new Error('noncanonical key');
      }
      this.privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
      if (
        this.privateKey.asymmetricKeyType !== 'ec' ||
        this.privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
        !this.privateKey.export({ format: 'der', type: 'pkcs8' }).equals(der)
      ) {
        throw new Error('wrong key');
      }
      const spki = createPublicKey(this.privateKey).export({ format: 'der', type: 'spki' });
      this.publicKeySpki = spki.toString('base64url');
      this.publicKeySpkiSha256 = `sha256:${createHash('sha256').update(spki).digest('hex')}`;
    } catch {
      throw new OwnerRoutineTelebirrReceiptUnavailableError();
    }
  }

  async issue(authUserId: string): Promise<OwnerRoutineTelebirrSignedReceipt> {
    if (!UUID_V4.test(authUserId)) throw new OwnerRoutineTelebirrReceiptRejectedError();
    try {
      const result = await this.database.query(MATERIAL_SQL, [
        authUserId,
        this.signerKeyId,
        this.publicKeySpkiSha256,
      ]);
      const row = result.rows.length === 1 ? result.rows[0] : undefined;
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new OwnerRoutineTelebirrReceiptNotReadyError();
      }
      const value = row as Record<string, unknown>;
      if (
        typeof value.enrollment_id !== 'string' ||
        !UUID_V4.test(value.enrollment_id) ||
        typeof value.pairing_evidence_digest !== 'string' ||
        !DIGEST.test(value.pairing_evidence_digest) ||
        typeof value.device_id !== 'string' ||
        !OPAQUE_ID.test(value.device_id) ||
        typeof value.device_key_id !== 'string' ||
        !OPAQUE_ID.test(value.device_key_id) ||
        typeof value.device_public_key_spki_sha256 !== 'string' ||
        !DIGEST.test(value.device_public_key_spki_sha256) ||
        typeof value.receiver_revision_id !== 'string' ||
        !UUID_V4.test(value.receiver_revision_id) ||
        typeof value.receiver_version !== 'number' ||
        !Number.isSafeInteger(value.receiver_version) ||
        value.receiver_version < 1 ||
        typeof value.receiver_profile_digest !== 'string' ||
        !DIGEST.test(value.receiver_profile_digest) ||
        typeof value.expected_receiver_name_digest !== 'string' ||
        !DIGEST.test(value.expected_receiver_name_digest) ||
        !validDate(value.valid_from) ||
        !validDate(value.valid_until) ||
        !validDate(value.issued_at) ||
        !validDate(value.signer_valid_from) ||
        !validDate(value.signer_valid_until) ||
        value.signer_valid_from.getTime() > value.issued_at.getTime() ||
        value.signer_valid_until.getTime() <= value.issued_at.getTime() ||
        value.valid_from.getTime() > value.issued_at.getTime() ||
        value.valid_until.getTime() <= value.issued_at.getTime()
      ) {
        throw new OwnerRoutineTelebirrReceiptUnavailableError();
      }
      const body: RoutineTelebirrEnrollmentReceiptBody = {
        contractVersion: 1,
        providerCode: 'telebirr',
        protocolMode: 'routine_enrollment_receipt_v1',
        enrollmentId: value.enrollment_id,
        pairingEvidenceDigest: value.pairing_evidence_digest,
        deviceId: value.device_id,
        keyId: value.device_key_id,
        devicePublicKeySpkiSha256: value.device_public_key_spki_sha256,
        receiverRevisionId: value.receiver_revision_id,
        receiverVersion: value.receiver_version,
        receiverProfileDigest: value.receiver_profile_digest,
        expectedReceiverNameDigest: value.expected_receiver_name_digest,
        validFrom: value.valid_from.toISOString(),
        validUntil: value.valid_until.toISOString(),
        issuedAt: value.issued_at.toISOString(),
        assignmentPollingAllowed: false,
        financialActionAllowed: false,
        moneyMovementAllowed: false,
      };
      const bodyDigest = digestRoutineTelebirrEnrollmentReceiptBody(body);
      const bytes = canonicalRoutineTelebirrEnrollmentReceiptSignatureBytes(body, this.signerKeyId);
      if (!bodyDigest || !bytes) throw new OwnerRoutineTelebirrReceiptUnavailableError();
      const receipt = {
        contractVersion: 1,
        providerCode: 'telebirr',
        protocolMode: 'routine_enrollment_receipt_v1',
        transcriptVersion: 'telebirr-routine-enrollment-receipt-transcript-v1',
        bodyDigestAlgorithm: 'sha256',
        bodyDigest,
        signatureAlgorithm: 'ecdsa-p256-sha256',
        signatureEncoding: 'ieee-p1363-base64url',
        signerKeyId: this.signerKeyId,
        body,
        signature: sign('sha256', bytes, {
          key: this.privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url'),
      };
      const expectedBinding = {
        pairingEvidenceDigest: body.pairingEvidenceDigest,
        deviceId: body.deviceId,
        keyId: body.keyId,
        devicePublicKeySpkiSha256: body.devicePublicKeySpkiSha256,
        receiverRevisionId: body.receiverRevisionId,
        receiverVersion: body.receiverVersion,
        receiverProfileDigest: body.receiverProfileDigest,
        expectedReceiverNameDigest: body.expectedReceiverNameDigest,
      };
      if (
        !verifySignedRoutineTelebirrEnrollmentReceipt(
          receipt,
          {
            signerKeyId: this.signerKeyId,
            publicKeySpki: this.publicKeySpki,
            publicKeySpkiSha256: this.publicKeySpkiSha256,
            validFrom: value.signer_valid_from.toISOString(),
            validUntil: value.signer_valid_until.toISOString(),
            state: 'active',
          },
          expectedBinding,
          body.issuedAt,
        )
      )
        throw new OwnerRoutineTelebirrReceiptUnavailableError();
      const receiptPackage =
        PACKAGE_PREFIX + Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64url');
      if (receiptPackage.length > 4_096) throw new OwnerRoutineTelebirrReceiptUnavailableError();
      return {
        assignmentPollingAllowed: false,
        financialActionAllowed: false,
        moneyMovementAllowed: false,
        receiptPackage,
        validUntil: body.validUntil as string,
      };
    } catch (error) {
      if (
        error instanceof OwnerRoutineTelebirrReceiptRejectedError ||
        error instanceof OwnerRoutineTelebirrReceiptNotReadyError ||
        error instanceof OwnerRoutineTelebirrReceiptUnavailableError
      )
        throw error;
      if (databaseErrorCode(error) === '42501')
        throw new OwnerRoutineTelebirrReceiptRejectedError();
      if (
        databaseErrorCode(error) === 'P0001' ||
        databaseErrorCode(error) === 'P0002' ||
        databaseErrorCode(error) === 'P0003'
      )
        throw new OwnerRoutineTelebirrReceiptNotReadyError();
      throw new OwnerRoutineTelebirrReceiptUnavailableError();
    }
  }
}
