import {
  digestKemerBetPlayerValidationAssignmentBody,
  type CompanionNoMoneySafety,
  type KemerBetPlayerValidationAssignmentBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedKemerBetPlayerValidationAssignment,
  type SignedKemerBetPlayerValidationResult,
} from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCEPT_COMPANION_PLAYER_VALIDATION_RESULT_SQL,
  CLAIM_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL,
  COMPLETE_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL,
  CompanionDeviceStateUnavailableError,
  PostgresCompanionDeviceState,
  RELEASE_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL,
} from './postgres-state.js';

const signerKeyId = 'server-signing-key-0001';
const assessedAt = '2026-10-16T12:00:10.000Z';
const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const safe: CompanionNoMoneySafety = Object.freeze({
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
const assignmentBody: KemerBetPlayerValidationAssignmentBody = Object.freeze({
  contractVersion: 1,
  protocolMode: 'local_companion_no_transfer_v1',
  assignmentId: '11111111-1111-4111-8111-111111111111',
  validationRequestId: '22222222-2222-4222-8222-222222222222',
  certificateId: '33333333-3333-4333-8333-333333333333',
  deviceId: 'windows-device-0001',
  deviceKeyId: 'windows-device-key-0001',
  platformCode: 'kemerbet',
  assignmentKind: 'single_telegram_player_validation',
  lookupMode: 'find_only',
  playerId: '28379330',
  currencyCode: 'ETB',
  leaseNonceDigest: sha('1'),
  oneUse: true,
  issuedAt: '2026-10-16T12:00:00.000Z',
  expiresAt: '2026-10-16T12:05:00.000Z',
  ...safe,
});
const certificate = {
  body: {
    certificateId: assignmentBody.certificateId,
    deviceId: assignmentBody.deviceId,
    deviceKeyId: assignmentBody.deviceKeyId,
  },
} as SignedCompanionEnrollmentCertificate;
const httpRequest = {
  bodyDigest: sha('2'),
  body: {
    requestId: 'validation-http-request-0001',
    issuedAt: '2026-10-16T12:00:05.000Z',
    expiresAt: '2026-10-16T12:00:35.000Z',
  },
} as SignedCompanionHttpRequest;
const assignment = {
  contractVersion: 1,
  protocolMode: 'local_companion_no_transfer_v1',
  transcriptVersion: 'agent-platform-companion-player-validation-assignment-transcript-v1',
  bodyDigestAlgorithm: 'sha256',
  bodyDigest: digestKemerBetPlayerValidationAssignmentBody(assignmentBody),
  signatureAlgorithm: 'ecdsa-p256-sha256',
  signatureEncoding: 'ieee-p1363-base64url',
  signerKeyId,
  signature: 'A'.repeat(86),
  body: assignmentBody,
} as SignedKemerBetPlayerValidationAssignment;
const result = {
  bodyDigest: sha('4'),
  body: { resultId: 'validation-result-0001' },
} as SignedKemerBetPlayerValidationResult;

describe('private companion Player validation PostgreSQL adapter (dormant)', () => {
  it('uses only the reviewed one-use functions with the exact ordered arguments', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === CLAIM_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL) {
        return {
          rows: [
            { claim_state: 'claimed', assignment_body: assignmentBody, signed_assignment: null },
          ],
        };
      }
      if (sql === COMPLETE_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL) {
        return { rows: [{ completed: true }] };
      }
      if (sql === RELEASE_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL) {
        return { rows: [{ released: true }] };
      }
      if (sql === ACCEPT_COMPANION_PLAYER_VALIDATION_RESULT_SQL) {
        return { rows: [{ accepted: true, replayed: false, finalization_state: 'selected' }] };
      }
      throw new Error('unexpected SQL');
    });
    const state = new PostgresCompanionDeviceState({ query }, signerKeyId);
    await expect(
      state.claimPlayerValidationAssignment(certificate, httpRequest, sha('5'), assessedAt),
    ).resolves.toEqual({ kind: 'claimed', assignmentBody });
    await expect(
      state.completePlayerValidationAssignment(assignment.bodyDigest, assignment),
    ).resolves.toBe(true);
    await expect(
      state.releasePlayerValidationAssignment(assignmentBody.assignmentId),
    ).resolves.toBeUndefined();
    await expect(
      state.acceptPlayerValidationResult(
        certificate,
        httpRequest,
        sha('6'),
        assignment,
        result,
        sha('7'),
        assessedAt,
      ),
    ).resolves.toEqual({ accepted: true, replayed: false });
    expect(query.mock.calls).toEqual([
      [
        CLAIM_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL,
        [
          sha('5'),
          httpRequest.bodyDigest,
          httpRequest.body.requestId,
          assignmentBody.certificateId,
          assignmentBody.deviceId,
          assignmentBody.deviceKeyId,
          httpRequest.body.issuedAt,
          httpRequest.body.expiresAt,
          assessedAt,
          signerKeyId,
        ],
      ],
      [
        COMPLETE_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL,
        [assignment.bodyDigest, JSON.stringify(assignment)],
      ],
      [RELEASE_COMPANION_PLAYER_VALIDATION_ASSIGNMENT_SQL, [assignmentBody.assignmentId]],
      [
        ACCEPT_COMPANION_PLAYER_VALIDATION_RESULT_SQL,
        [
          sha('6'),
          httpRequest.bodyDigest,
          httpRequest.body.requestId,
          sha('7'),
          assignmentBody.assignmentId,
          assignment.bodyDigest,
          result.body.resultId,
          result.bodyDigest,
          assignmentBody.certificateId,
          assignmentBody.deviceId,
          assignmentBody.deviceKeyId,
          httpRequest.body.issuedAt,
          httpRequest.body.expiresAt,
          assessedAt,
          JSON.stringify(assignment),
          JSON.stringify(result),
        ],
      ],
    ]);
  });

  it('decodes every claim state and fails closed for malformed or contradictory rows', async () => {
    for (const [row, expected] of [
      [{ claim_state: 'none', assignment_body: null, signed_assignment: null }, { kind: 'none' }],
      [
        { claim_state: 'in_progress', assignment_body: null, signed_assignment: null },
        { kind: 'in_progress' },
      ],
      [
        {
          claim_state: 'completed',
          assignment_body: assignmentBody,
          signed_assignment: assignment,
        },
        { kind: 'completed', assignment },
      ],
    ] as const) {
      const state = new PostgresCompanionDeviceState(
        { query: async () => ({ rows: [row] }) },
        signerKeyId,
      );
      await expect(
        state.claimPlayerValidationAssignment(certificate, httpRequest, sha('8'), assessedAt),
      ).resolves.toEqual(expected);
    }
    for (const row of [
      { claim_state: 'none', assignment_body: assignmentBody, signed_assignment: null },
      {
        claim_state: 'claimed',
        assignment_body: { ...assignmentBody, transferDisabled: false },
        signed_assignment: null,
      },
      {
        claim_state: 'completed',
        assignment_body: { ...assignmentBody, playerId: '99999999' },
        signed_assignment: assignment,
      },
      { claim_state: 'completed', assignment_body: assignmentBody, signed_assignment: {} },
      { claim_state: 'none', assignment_body: null, signed_assignment: null, extra: true },
      new Proxy({ claim_state: 'none', assignment_body: null, signed_assignment: null }, {}),
    ]) {
      const state = new PostgresCompanionDeviceState(
        { query: async () => ({ rows: [row] }) },
        signerKeyId,
      );
      await expect(
        state.claimPlayerValidationAssignment(certificate, httpRequest, sha('9'), assessedAt),
      ).rejects.toThrow(CompanionDeviceStateUnavailableError);
    }
  });

  it('never treats a malformed acknowledgement as accepted', async () => {
    for (const row of [
      { accepted: false, replayed: false },
      { accepted: true, replayed: 'false' },
      { accepted: true, replayed: false, extra: true },
      { accepted: true, replayed: false, finalization_state: 'pending' },
      { accepted: true, replayed: false, finalization_state: null },
    ]) {
      const state = new PostgresCompanionDeviceState(
        { query: async () => ({ rows: [row] }) },
        signerKeyId,
      );
      await expect(
        state.acceptPlayerValidationResult(
          certificate,
          httpRequest,
          sha('a'),
          assignment,
          result,
          sha('b'),
          assessedAt,
        ),
      ).resolves.toBeUndefined();
    }
  });
});
