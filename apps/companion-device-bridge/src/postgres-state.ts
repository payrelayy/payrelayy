import {
  decodeCompanionEnrollmentCertificateBody,
  decodeSignedCompanionEnrollmentCertificate,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionPairingRequest,
} from '@fetanagent/agent-platform-companion-contracts';

import type { CompanionPairingClaim } from './pairing-handler.js';

export interface CompanionDeviceStateDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class CompanionDeviceStateUnavailableError extends Error {
  constructor() {
    super('The private companion device-state boundary is unavailable.');
    this.name = 'CompanionDeviceStateUnavailableError';
  }
}

export const CLAIM_COMPANION_PAIRING_SQL = `
  select claim_state,
         certificate_body,
         signed_certificate
    from app.claim_agent_platform_companion_pairing(
      $1::uuid,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::text,
      $8::text,
      $9::timestamptz,
      $10::timestamptz,
      $11::timestamptz,
      $12::text
    )
`;

export const COMPLETE_COMPANION_PAIRING_SQL = `
  select app.complete_agent_platform_companion_pairing(
    $1::text,
    $2::text,
    $3::text,
    $4::text,
    $5::jsonb
  ) as completed
`;

export const RELEASE_COMPANION_PAIRING_SQL = `
  select app.release_agent_platform_companion_pairing($1::text) as released
`;

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new CompanionDeviceStateUnavailableError();
  }
  const prototype = Object.getPrototypeOf(row);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CompanionDeviceStateUnavailableError();
  }
  return row as Record<string, unknown>;
}

function exactKeys(row: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(row).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

export class PostgresCompanionDeviceState {
  constructor(
    private readonly database: CompanionDeviceStateDatabase,
    private readonly signerKeyId: string,
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(signerKeyId)) {
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async claimPairing(
    request: SignedCompanionPairingRequest,
    assessedAt: string,
  ): Promise<CompanionPairingClaim | undefined> {
    try {
      const result = await this.database.query(CLAIM_COMPANION_PAIRING_SQL, [
        request.body.pairingId,
        request.body.pairingNonceDigest,
        request.bodyDigest,
        request.body.deviceId,
        request.body.deviceKeyId,
        request.body.devicePublicKeySpki,
        request.body.devicePublicKeySpkiSha256,
        request.body.companionVersion,
        request.body.issuedAt,
        request.body.expiresAt,
        assessedAt,
        this.signerKeyId,
      ]);
      if (result.rows.length !== 1) return undefined;
      const row = rowObject(result.rows[0]);
      if (!exactKeys(row, ['claim_state', 'certificate_body', 'signed_certificate'])) {
        throw new CompanionDeviceStateUnavailableError();
      }
      if (
        row.claim_state === 'in_progress' &&
        row.certificate_body === null &&
        row.signed_certificate === null
      ) {
        return Object.freeze({ kind: 'in_progress' });
      }
      if (row.claim_state === 'claimed' && row.signed_certificate === null) {
        const certificateBody = decodeCompanionEnrollmentCertificateBody(row.certificate_body);
        return certificateBody
          ? Object.freeze({ kind: 'claimed', certificateBody })
          : (() => {
              throw new CompanionDeviceStateUnavailableError();
            })();
      }
      if (row.claim_state === 'completed' && row.certificate_body !== null) {
        const certificate = decodeSignedCompanionEnrollmentCertificate(row.signed_certificate);
        return certificate
          ? Object.freeze({ kind: 'completed', certificate })
          : (() => {
              throw new CompanionDeviceStateUnavailableError();
            })();
      }
      throw new CompanionDeviceStateUnavailableError();
    } catch (error) {
      if (error instanceof CompanionDeviceStateUnavailableError) throw error;
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async completePairing(
    pairingRequestBodyDigest: string,
    certificate: SignedCompanionEnrollmentCertificate,
  ): Promise<boolean> {
    try {
      const result = await this.database.query(COMPLETE_COMPANION_PAIRING_SQL, [
        pairingRequestBodyDigest,
        certificate.bodyDigest,
        certificate.signerKeyId,
        certificate.signature,
        JSON.stringify(certificate),
      ]);
      if (result.rows.length !== 1) return false;
      const row = rowObject(result.rows[0]);
      return exactKeys(row, ['completed']) && row.completed === true;
    } catch {
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async releasePairing(pairingRequestBodyDigest: string): Promise<void> {
    try {
      const result = await this.database.query(RELEASE_COMPANION_PAIRING_SQL, [
        pairingRequestBodyDigest,
      ]);
      if (result.rows.length !== 1) throw new CompanionDeviceStateUnavailableError();
      const row = rowObject(result.rows[0]);
      if (!exactKeys(row, ['released']) || typeof row.released !== 'boolean') {
        throw new CompanionDeviceStateUnavailableError();
      }
    } catch (error) {
      if (error instanceof CompanionDeviceStateUnavailableError) throw error;
      throw new CompanionDeviceStateUnavailableError();
    }
  }
}
