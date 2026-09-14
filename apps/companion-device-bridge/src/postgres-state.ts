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
import {
  COMPANION_EXECUTION_ACTION_KIND,
  COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
  COMPANION_EXECUTION_CAPABILITY,
  COMPANION_EXECUTION_CONTRACT_VERSION,
  COMPANION_EXECUTION_CURRENCY_CODE,
  COMPANION_EXECUTION_MAX_ASSIGNMENT_LIFETIME_MS,
  COMPANION_EXECUTION_MAX_AUTHORITY_LIFETIME_MS,
  COMPANION_EXECUTION_MAX_ROUND_TRIP_TIME_MS,
  COMPANION_EXECUTION_MAX_STATUS_LIFETIME_MS,
  COMPANION_EXECUTION_PLATFORM_CODE,
  COMPANION_EXECUTION_PROTOCOL_MODE,
  decodeAuthoritativeExecutionStatusBody,
  decodeExecutionAssignmentBody,
  decodeExecutionEnrollmentBody,
  decodeOneUseActionAuthorityBody,
  decodeSignedAuthoritativeExecutionStatus,
  decodeSignedExecutionAssignment,
  decodeSignedExecutionEnrollment,
  decodeSignedExecutionResult,
  decodeSignedOneUseActionAuthority,
  digestCompanionExecutionPlayerId,
  digestExecutionEnrollmentBody,
  type SignedAuthoritativeExecutionStatus,
  type SignedExecutionAssignment,
  type SignedExecutionEnrollment,
  type SignedExecutionResult,
  type SignedOneUseActionAuthority,
} from '@fetanagent/agent-platform-companion-execution-contracts';

import type {
  CompanionLookupAcceptance,
  CompanionLookupAssignmentClaim,
} from './lookup-handler.js';
import type {
  CompanionExecutionAcceptance,
  CompanionExecutionAssignmentClaim,
  CompanionExecutionAuthorityClaim,
  CompanionExecutionStatusClaim,
} from './execution-handler.js';
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

export const CLAIM_COMPANION_EXECUTION_ASSIGNMENT_SQL = `
  select claim_state,
         claim_material,
         signed_enrollment,
         signed_assignment,
         player_id,
         signed_authority,
         signed_result
    from app.claim_agent_platform_companion_execution_assignment(
      $1::text,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::timestamptz,
      $8::timestamptz,
      $9::timestamptz,
      $10::text,
      $11::text,
      $12::text,
      $13::text
    )
`;

export const COMPLETE_COMPANION_EXECUTION_ASSIGNMENT_SQL = `
  select app.complete_agent_platform_companion_execution_assignment(
    $1::text,
    $2::jsonb,
    $3::text,
    $4::jsonb
  ) as completed
`;

export const CLAIM_COMPANION_EXECUTION_AUTHORITY_SQL = `
  select claim_state,
         authority_body,
         signed_authority
    from app.claim_agent_platform_companion_execution_authority(
      $1::text,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::timestamptz,
      $8::timestamptz,
      $9::timestamptz,
      $10::text,
      $11::jsonb,
      $12::jsonb
    )
`;

export const COMPLETE_COMPANION_EXECUTION_AUTHORITY_SQL = `
  select app.complete_agent_platform_companion_execution_authority(
    $1::text,
    $2::jsonb
  ) as completed
`;

export const ACCEPT_COMPANION_EXECUTION_RESULT_SQL = `
  select accepted,
         replayed
    from app.accept_agent_platform_companion_execution_result(
      $1::text,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::timestamptz,
      $8::timestamptz,
      $9::timestamptz,
      $10::jsonb,
      $11::jsonb,
      $12::jsonb,
      $13::jsonb
    )
`;

export const CLAIM_COMPANION_EXECUTION_STATUS_SQL = `
  select claim_state,
         status_body,
         signed_status
    from app.claim_agent_platform_companion_execution_status(
      $1::text,
      $2::text,
      $3::text,
      $4::text,
      $5::text,
      $6::text,
      $7::timestamptz,
      $8::timestamptz,
      $9::timestamptz,
      $10::text,
      $11::jsonb,
      $12::jsonb,
      $13::jsonb,
      $14::jsonb
    )
`;

export const COMPLETE_COMPANION_EXECUTION_STATUS_SQL = `
  select app.complete_agent_platform_companion_execution_status(
    $1::text,
    $2::jsonb
  ) as completed
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
    private readonly executionSignerKeyId?: string,
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(signerKeyId)) {
      throw new CompanionDeviceStateUnavailableError();
    }
    if (
      executionSignerKeyId !== undefined &&
      (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(executionSignerKeyId) ||
        executionSignerKeyId === signerKeyId)
    ) {
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  private requireExecutionSignerKeyId(): string {
    if (!this.executionSignerKeyId) throw new CompanionDeviceStateUnavailableError();
    return this.executionSignerKeyId;
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

  async claimExecutionAssignment(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    assessedAt: string,
    executionSignerPublicKeySpki: string,
    executionSignerPublicKeySpkiSha256: string,
  ): Promise<CompanionExecutionAssignmentClaim | undefined> {
    try {
      const result = await this.database.query(CLAIM_COMPANION_EXECUTION_ASSIGNMENT_SQL, [
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
        this.requireExecutionSignerKeyId(),
        executionSignerPublicKeySpki,
        executionSignerPublicKeySpkiSha256,
      ]);
      if (result.rows.length !== 1) return undefined;
      const row = rowObject(result.rows[0]);
      if (
        !exactKeys(row, [
          'claim_state',
          'claim_material',
          'signed_enrollment',
          'signed_assignment',
          'player_id',
          'signed_authority',
          'signed_result',
        ])
      ) {
        throw new CompanionDeviceStateUnavailableError();
      }
      if (
        (row.claim_state === 'none' || row.claim_state === 'in_progress') &&
        row.claim_material === null &&
        row.signed_enrollment === null &&
        row.signed_assignment === null &&
        row.player_id === null &&
        row.signed_authority === null &&
        row.signed_result === null
      ) {
        return Object.freeze({ kind: row.claim_state });
      }
      if (
        row.claim_state === 'claimed' &&
        typeof row.player_id === 'string' &&
        row.signed_enrollment === null &&
        row.signed_assignment === null &&
        row.signed_authority === null &&
        row.signed_result === null
      ) {
        const material = rowObject(row.claim_material);
        if (
          !exactKeys(material, [
            'activationEpoch',
            'assignmentId',
            'assignmentNonceDigest',
            'attemptId',
            'enrollmentId',
            'enrollmentIssuedAt',
            'enrollmentValidFrom',
            'enrollmentValidUntil',
            'intentId',
            'jobId',
            'pilotConfigDigest',
            'pilotId',
            'pilotReservationDigest',
            'pilotReservationId',
            'pilotRevision',
            'platformAgentAccountId',
            'serverIssuedAt',
            'serverNotBefore',
            'serverValidUntil',
          ])
        ) {
          throw new CompanionDeviceStateUnavailableError();
        }
        const executionSignerKeyId = this.requireExecutionSignerKeyId();
        const enrollmentBody = decodeExecutionEnrollmentBody({
          contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
          protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
          capability: COMPANION_EXECUTION_CAPABILITY,
          enrollmentId: material.enrollmentId,
          noMoneyCertificateId: certificate.body.certificateId,
          noMoneyCertificateBodyDigest: certificate.bodyDigest,
          deviceId: certificate.body.deviceId,
          deviceKeyId: certificate.body.deviceKeyId,
          devicePublicKeySpkiSha256: certificate.body.devicePublicKeySpkiSha256,
          platformAgentAccountId: material.platformAgentAccountId,
          accountBindingCount: 1,
          platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
          pilotId: material.pilotId,
          pilotRevision: material.pilotRevision,
          pilotConfigDigest: material.pilotConfigDigest,
          amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
          currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
          maxActionsPerAssignment: 1,
          maxAssignmentLifetimeMs: COMPANION_EXECUTION_MAX_ASSIGNMENT_LIFETIME_MS,
          maxAuthorityLifetimeMs: COMPANION_EXECUTION_MAX_AUTHORITY_LIFETIME_MS,
          maxStatusLifetimeMs: COMPANION_EXECUTION_MAX_STATUS_LIFETIME_MS,
          maxRoundTripTimeMs: COMPANION_EXECUTION_MAX_ROUND_TRIP_TIME_MS,
          executionSignerKeyId,
          executionSignerPublicKeySpki,
          executionSignerPublicKeySpkiSha256,
          capabilityState: 'active',
          issuedAt: material.enrollmentIssuedAt,
          validFrom: material.enrollmentValidFrom,
          validUntil: material.enrollmentValidUntil,
        });
        const enrollmentBodyDigest =
          enrollmentBody && digestExecutionEnrollmentBody(enrollmentBody);
        const assignmentBody = decodeExecutionAssignmentBody({
          contractVersion: COMPANION_EXECUTION_CONTRACT_VERSION,
          protocolMode: COMPANION_EXECUTION_PROTOCOL_MODE,
          capability: COMPANION_EXECUTION_CAPABILITY,
          actionKind: COMPANION_EXECUTION_ACTION_KIND,
          assignmentId: material.assignmentId,
          assignmentNonceDigest: material.assignmentNonceDigest,
          activationEpoch: material.activationEpoch,
          intentId: material.intentId,
          jobId: material.jobId,
          attemptId: material.attemptId,
          platformAgentAccountId: material.platformAgentAccountId,
          enrollmentId: material.enrollmentId,
          enrollmentBodyDigest,
          noMoneyCertificateId: certificate.body.certificateId,
          noMoneyCertificateBodyDigest: certificate.bodyDigest,
          deviceId: certificate.body.deviceId,
          deviceKeyId: certificate.body.deviceKeyId,
          executionSignerKeyId,
          platformCode: COMPANION_EXECUTION_PLATFORM_CODE,
          pilotId: material.pilotId,
          pilotRevision: material.pilotRevision,
          pilotConfigDigest: material.pilotConfigDigest,
          pilotReservationId: material.pilotReservationId,
          pilotReservationDigest: material.pilotReservationDigest,
          amountMinorUnits: COMPANION_EXECUTION_AMOUNT_MINOR_UNITS,
          currencyCode: COMPANION_EXECUTION_CURRENCY_CODE,
          playerIdDigest: digestCompanionExecutionPlayerId(row.player_id),
          oneUse: true,
          serverIssuedAt: material.serverIssuedAt,
          serverNotBefore: material.serverNotBefore,
          serverValidUntil: material.serverValidUntil,
        });
        if (!enrollmentBody || !enrollmentBodyDigest || !assignmentBody) {
          throw new CompanionDeviceStateUnavailableError();
        }
        return Object.freeze({
          kind: 'claimed',
          enrollmentBody,
          assignmentBody,
          playerId: row.player_id,
        });
      }
      if (
        row.claim_state === 'completed' &&
        typeof row.player_id === 'string' &&
        row.claim_material !== null
      ) {
        const enrollment = decodeSignedExecutionEnrollment(row.signed_enrollment);
        const assignment = decodeSignedExecutionAssignment(row.signed_assignment);
        const authority =
          row.signed_authority === null
            ? null
            : decodeSignedOneUseActionAuthority(row.signed_authority);
        const executionResult =
          row.signed_result === null ? null : decodeSignedExecutionResult(row.signed_result);
        if (
          !enrollment ||
          !assignment ||
          (row.signed_authority !== null && !authority) ||
          (row.signed_result !== null && !executionResult)
        ) {
          throw new CompanionDeviceStateUnavailableError();
        }
        return Object.freeze({
          kind: 'completed',
          enrollment,
          assignment,
          playerId: row.player_id,
          authority: authority ?? null,
          result: executionResult ?? null,
        });
      }
      throw new CompanionDeviceStateUnavailableError();
    } catch (error) {
      if (error instanceof CompanionDeviceStateUnavailableError) throw error;
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async completeExecutionAssignment(
    enrollmentBodyDigest: string,
    enrollment: SignedExecutionEnrollment,
    assignmentBodyDigest: string,
    assignment: SignedExecutionAssignment,
  ): Promise<boolean> {
    try {
      const result = await this.database.query(COMPLETE_COMPANION_EXECUTION_ASSIGNMENT_SQL, [
        enrollmentBodyDigest,
        JSON.stringify(enrollment),
        assignmentBodyDigest,
        JSON.stringify(assignment),
      ]);
      if (result.rows.length !== 1) return false;
      const row = rowObject(result.rows[0]);
      return exactKeys(row, ['completed']) && row.completed === true;
    } catch {
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async claimExecutionAuthority(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    enrollment: SignedExecutionEnrollment,
    assignment: SignedExecutionAssignment,
    requestNonceDigest: string,
    assessedAt: string,
  ): Promise<CompanionExecutionAuthorityClaim | undefined> {
    try {
      const result = await this.database.query(CLAIM_COMPANION_EXECUTION_AUTHORITY_SQL, [
        httpReplayIdentity,
        request.bodyDigest,
        request.body.requestId,
        certificate.body.certificateId,
        certificate.body.deviceId,
        certificate.body.deviceKeyId,
        request.body.issuedAt,
        request.body.expiresAt,
        assessedAt,
        requestNonceDigest,
        JSON.stringify(enrollment),
        JSON.stringify(assignment),
      ]);
      if (result.rows.length !== 1) return undefined;
      const row = rowObject(result.rows[0]);
      if (!exactKeys(row, ['claim_state', 'authority_body', 'signed_authority'])) {
        throw new CompanionDeviceStateUnavailableError();
      }
      if (
        row.claim_state === 'in_progress' &&
        row.authority_body === null &&
        row.signed_authority === null
      ) {
        return Object.freeze({ kind: 'in_progress' });
      }
      if (row.claim_state === 'claimed' && row.signed_authority === null) {
        const authorityBody = decodeOneUseActionAuthorityBody(row.authority_body);
        if (!authorityBody) throw new CompanionDeviceStateUnavailableError();
        return Object.freeze({ kind: 'claimed', authorityBody });
      }
      if (row.claim_state === 'completed' && row.authority_body !== null) {
        const authority = decodeSignedOneUseActionAuthority(row.signed_authority);
        if (!authority) throw new CompanionDeviceStateUnavailableError();
        return Object.freeze({ kind: 'completed', authority });
      }
      throw new CompanionDeviceStateUnavailableError();
    } catch (error) {
      if (error instanceof CompanionDeviceStateUnavailableError) throw error;
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async completeExecutionAuthority(
    authorityBodyDigest: string,
    authority: SignedOneUseActionAuthority,
  ): Promise<boolean> {
    try {
      const result = await this.database.query(COMPLETE_COMPANION_EXECUTION_AUTHORITY_SQL, [
        authorityBodyDigest,
        JSON.stringify(authority),
      ]);
      if (result.rows.length !== 1) return false;
      const row = rowObject(result.rows[0]);
      return exactKeys(row, ['completed']) && row.completed === true;
    } catch {
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async acceptExecutionResult(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    enrollment: SignedExecutionEnrollment,
    assignment: SignedExecutionAssignment,
    authority: SignedOneUseActionAuthority,
    resultEnvelope: SignedExecutionResult,
    assessedAt: string,
  ): Promise<CompanionExecutionAcceptance | undefined> {
    try {
      const result = await this.database.query(ACCEPT_COMPANION_EXECUTION_RESULT_SQL, [
        httpReplayIdentity,
        request.bodyDigest,
        request.body.requestId,
        certificate.body.certificateId,
        certificate.body.deviceId,
        certificate.body.deviceKeyId,
        request.body.issuedAt,
        request.body.expiresAt,
        assessedAt,
        JSON.stringify(enrollment),
        JSON.stringify(assignment),
        JSON.stringify(authority),
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

  async claimExecutionStatus(
    certificate: SignedCompanionEnrollmentCertificate,
    request: SignedCompanionHttpRequest,
    httpReplayIdentity: string,
    enrollment: SignedExecutionEnrollment,
    assignment: SignedExecutionAssignment,
    authority: SignedOneUseActionAuthority | null,
    resultEnvelope: SignedExecutionResult | null,
    queryNonceDigest: string,
    assessedAt: string,
  ): Promise<CompanionExecutionStatusClaim | undefined> {
    try {
      const result = await this.database.query(CLAIM_COMPANION_EXECUTION_STATUS_SQL, [
        httpReplayIdentity,
        request.bodyDigest,
        request.body.requestId,
        certificate.body.certificateId,
        certificate.body.deviceId,
        certificate.body.deviceKeyId,
        request.body.issuedAt,
        request.body.expiresAt,
        assessedAt,
        queryNonceDigest,
        JSON.stringify(enrollment),
        JSON.stringify(assignment),
        JSON.stringify(authority),
        JSON.stringify(resultEnvelope),
      ]);
      if (result.rows.length !== 1) return undefined;
      const row = rowObject(result.rows[0]);
      if (!exactKeys(row, ['claim_state', 'status_body', 'signed_status'])) {
        throw new CompanionDeviceStateUnavailableError();
      }
      if (row.claim_state === 'claimed' && row.signed_status === null) {
        const statusBody = decodeAuthoritativeExecutionStatusBody(row.status_body);
        if (!statusBody) throw new CompanionDeviceStateUnavailableError();
        return Object.freeze({ kind: 'claimed', statusBody });
      }
      if (row.claim_state === 'completed' && row.status_body !== null) {
        const status = decodeSignedAuthoritativeExecutionStatus(row.signed_status);
        if (!status) throw new CompanionDeviceStateUnavailableError();
        return Object.freeze({ kind: 'completed', status });
      }
      throw new CompanionDeviceStateUnavailableError();
    } catch (error) {
      if (error instanceof CompanionDeviceStateUnavailableError) throw error;
      throw new CompanionDeviceStateUnavailableError();
    }
  }

  async completeExecutionStatus(
    statusBodyDigest: string,
    status: SignedAuthoritativeExecutionStatus,
  ): Promise<boolean> {
    try {
      const result = await this.database.query(COMPLETE_COMPANION_EXECUTION_STATUS_SQL, [
        statusBodyDigest,
        JSON.stringify(status),
      ]);
      if (result.rows.length !== 1) return false;
      const row = rowObject(result.rows[0]);
      return exactKeys(row, ['completed']) && row.completed === true;
    } catch {
      throw new CompanionDeviceStateUnavailableError();
    }
  }
}
