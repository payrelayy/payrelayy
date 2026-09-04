import { isProxy } from 'node:util/types';

import {
  decodeCompanionEnrollmentCertificateBody,
  decodeKemerBetExactFiveLookupAssignmentBody,
  decodeSignedCompanionEnrollmentCertificate,
  decodeSignedKemerBetExactFiveLookupAssignment,
  type SignedCompanionHttpRequest,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionPairingRequest,
  type SignedKemerBetExactFiveLookupAssignment,
  type SignedKemerBetExactFiveLookupResult,
} from '@fetanagent/agent-platform-companion-contracts';

import type {
  CompanionLookupAcceptance,
  CompanionLookupAssignmentClaim,
} from './lookup-handler.js';
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

export const CLAIM_COMPANION_LOOKUP_ASSIGNMENT_SQL = `
  select claim_state,
         assignment_body,
         signed_assignment
    from app.claim_agent_platform_companion_lookup_assignment(
      $1::text,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::timestamptz,
      $8::timestamptz,
      $9::timestamptz,
      $10::text
    )
`;

export const COMPLETE_COMPANION_LOOKUP_ASSIGNMENT_SQL = `
  select app.complete_agent_platform_companion_lookup_assignment(
    $1::text,
    $2::text,
    $3::text,
    $4::jsonb
  ) as completed
`;

export const RELEASE_COMPANION_LOOKUP_ASSIGNMENT_SQL = `
  select app.release_agent_platform_companion_lookup_assignment($1::text) as released
`;

export const ACCEPT_COMPANION_LOOKUP_RESULT_SQL = `
  select accepted,
         replayed
    from app.accept_agent_platform_companion_lookup_result(
      $1::text,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::text,
      $8::text,
      $9::text,
      $10::text,
      $11::text,
      $12::timestamptz,
      $13::timestamptz,
      $14::timestamptz,
      $15::jsonb,
      $16::jsonb
    )
`;

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row) || isProxy(row)) {
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

  async claimLookupAssignment(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    assessedAt: string,
  ): Promise<CompanionLookupAssignmentClaim | undefined> {
    try {
      const result = await this.database.query(CLAIM_COMPANION_LOOKUP_ASSIGNMENT_SQL, [
        httpReplayIdentity,
        request.bodyDigest,
        request.body.requestId,
        certificate.body.certificateId,
        certificate.body.deviceId,
        certificate.body.deviceKeyId,
        request.body.issuedAt,
        request.body.expiresAt,
        assessedAt,
        this.signerKeyId,
      ]);
      if (result.rows.length !== 1) return undefined;
      const row = rowObject(result.rows[0]);
      if (!exactKeys(row, ['claim_state', 'assignment_body', 'signed_assignment'])) {
        throw new CompanionDeviceStateUnavailableError();
      }
      if (
        row.claim_state === 'none' &&
        row.assignment_body === null &&
        row.signed_assignment === null
      ) {
        return Object.freeze({ kind: 'none' });
      }
      if (
        row.claim_state === 'in_progress' &&
        row.assignment_body === null &&
        row.signed_assignment === null
      ) {
        return Object.freeze({ kind: 'in_progress' });
      }
      if (row.claim_state === 'claimed' && row.signed_assignment === null) {
        const assignmentBody = decodeKemerBetExactFiveLookupAssignmentBody(row.assignment_body);
        if (!assignmentBody) throw new CompanionDeviceStateUnavailableError();
        return Object.freeze({ kind: 'claimed', assignmentBody });
      }
      if (row.claim_state === 'completed' && row.assignment_body !== null) {
        const assignment = decodeSignedKemerBetExactFiveLookupAssignment(row.signed_assignment);
        if (!assignment) throw new CompanionDeviceStateUnavailableError();
        return Object.freeze({ kind: 'completed', assignment });
      }
      throw new CompanionDeviceStateUnavailableError();
    } catch (error) {
      if (error instanceof CompanionDeviceStateUnavailableError) throw error;
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async completeLookupAssignment(
    assignmentBodyDigest: string,
    assignment: SignedKemerBetExactFiveLookupAssignment,
  ): Promise<boolean> {
    try {
      const result = await this.database.query(COMPLETE_COMPANION_LOOKUP_ASSIGNMENT_SQL, [
        assignmentBodyDigest,
        assignment.signerKeyId,
        assignment.signature,
        JSON.stringify(assignment),
      ]);
      if (result.rows.length !== 1) return false;
      const row = rowObject(result.rows[0]);
      return exactKeys(row, ['completed']) && row.completed === true;
    } catch {
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async releaseLookupAssignment(assignmentId: string): Promise<void> {
    try {
      const result = await this.database.query(RELEASE_COMPANION_LOOKUP_ASSIGNMENT_SQL, [
        assignmentId,
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

  async acceptLookupResult(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    assignment: SignedKemerBetExactFiveLookupAssignment,
    resultEnvelope: SignedKemerBetExactFiveLookupResult,
    resultReplayIdentity: string,
    assessedAt: string,
  ): Promise<CompanionLookupAcceptance | undefined> {
    try {
      const result = await this.database.query(ACCEPT_COMPANION_LOOKUP_RESULT_SQL, [
        httpReplayIdentity,
        request.bodyDigest,
        request.body.requestId,
        resultReplayIdentity,
        assignment.body.assignmentId,
        assignment.bodyDigest,
        resultEnvelope.body.resultId,
        resultEnvelope.bodyDigest,
        certificate.body.certificateId,
        certificate.body.deviceId,
        certificate.body.deviceKeyId,
        request.body.issuedAt,
        request.body.expiresAt,
        assessedAt,
        JSON.stringify(assignment),
        JSON.stringify(resultEnvelope),
      ]);
      if (result.rows.length !== 1) return undefined;
      const row = rowObject(result.rows[0]);
      return exactKeys(row, ['accepted', 'replayed']) &&
        row.accepted === true &&
        typeof row.replayed === 'boolean'
        ? Object.freeze({ accepted: true, replayed: row.replayed })
        : undefined;
    } catch (error) {
      if (error instanceof CompanionDeviceStateUnavailableError) throw error;
      throw new CompanionDeviceStateUnavailableError();
    }
  }
}
