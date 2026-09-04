import {
  type CompanionNoMoneySafety,
  type KemerBetExactFiveLookupAssignmentBody,
  type SignedCompanionEnrollmentCertificate,
  type SignedCompanionHttpRequest,
  type SignedKemerBetExactFiveLookupAssignment,
  type SignedKemerBetExactFiveLookupResult,
} from '@fetanagent/agent-platform-companion-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCEPT_COMPANION_LOOKUP_RESULT_SQL,
  CLAIM_COMPANION_LOOKUP_ASSIGNMENT_SQL,
  COMPLETE_COMPANION_LOOKUP_ASSIGNMENT_SQL,
  CompanionDeviceStateUnavailableError,
  PostgresCompanionDeviceState,
  RELEASE_COMPANION_LOOKUP_ASSIGNMENT_SQL,
} from './postgres-state.js';

const signerKeyId = 'server-signing-key-0001';
const assessedAt = '2026-09-05T12:00:10.000Z';
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

const assignmentBody: KemerBetExactFiveLookupAssignmentBody = Object.freeze({
  contractVersion: 1,
  protocolMode: 'local_companion_no_transfer_v1',
  assignmentId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  certificateId: '33333333-3333-4333-8333-333333333333',
  deviceId: 'windows-device-0001',
  deviceKeyId: 'windows-device-key-0001',
  platformCode: 'kemerbet',
  assignmentKind: 'exact_five_player_lookup',
  lookupMode: 'find_only',
  playerIds: ['28379330', '28379331', '28379332', '28379333', '28379334'] as const,
  currencyCode: 'ETB',
  leaseNonceDigest: `sha256:${'1'.repeat(64)}`,
  oneUse: true,
  issuedAt: '2026-09-05T12:00:00.000Z',
  expiresAt: '2026-09-05T12:05:00.000Z',
  ...safe,
});

const certificate = {
  body: {
    certificateId: assignmentBody.certificateId,
    deviceId: assignmentBody.deviceId,
    deviceKeyId: assignmentBody.deviceKeyId,
  },
} as unknown as SignedCompanionEnrollmentCertificate;

const httpRequest = {
  bodyDigest: `sha256:${'2'.repeat(64)}`,
  body: {
    requestId: 'http-request-0001',
    issuedAt: '2026-09-05T12:00:05.000Z',
    expiresAt: '2026-09-05T12:00:35.000Z',
  },
} as SignedCompanionHttpRequest;

const assignment = {
  contractVersion: 1,
  protocolMode: 'local_companion_no_transfer_v1',
  transcriptVersion: 'agent-platform-companion-lookup-assignment-transcript-v1',
  bodyDigestAlgorithm: 'sha256',
  bodyDigest: `sha256:${'3'.repeat(64)}`,
  signatureAlgorithm: 'ecdsa-p256-sha256',
  signatureEncoding: 'ieee-p1363-base64url',
  signerKeyId,
  signature: 'A'.repeat(86),
  body: assignmentBody,
} as SignedKemerBetExactFiveLookupAssignment;

const result = {
  bodyDigest: `sha256:${'4'.repeat(64)}`,
  body: {
    resultId: 'lookup-result-0001',
  },
} as SignedKemerBetExactFiveLookupResult;

describe('companion device lookup PostgreSQL state adapter', () => {
  it('binds every lookup operation to the exact reviewed function and ordered arguments', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === CLAIM_COMPANION_LOOKUP_ASSIGNMENT_SQL) {
        return {
          rows: [
            {
              claim_state: 'claimed',
              assignment_body: assignmentBody,
              signed_assignment: null,
            },
          ],
        };
      }
      if (sql === COMPLETE_COMPANION_LOOKUP_ASSIGNMENT_SQL) {
        return { rows: [{ completed: true }] };
      }
      if (sql === RELEASE_COMPANION_LOOKUP_ASSIGNMENT_SQL) {
        return { rows: [{ released: true }] };
      }
      if (sql === ACCEPT_COMPANION_LOOKUP_RESULT_SQL) {
        return { rows: [{ accepted: true, replayed: false }] };
      }
      throw new Error('unexpected query');
    });
    const state = new PostgresCompanionDeviceState({ query }, signerKeyId);

    await expect(
      state.claimLookupAssignment(certificate, httpRequest, `sha256:${'5'.repeat(64)}`, assessedAt),
    ).resolves.toEqual({ kind: 'claimed', assignmentBody });
    await expect(state.completeLookupAssignment(assignment.bodyDigest, assignment)).resolves.toBe(
      true,
    );
    await expect(
      state.releaseLookupAssignment(assignmentBody.assignmentId),
    ).resolves.toBeUndefined();
    await expect(
      state.acceptLookupResult(
        certificate,
        httpRequest,
        `sha256:${'6'.repeat(64)}`,
        assignment,
        result,
        `sha256:${'7'.repeat(64)}`,
        assessedAt,
      ),
    ).resolves.toEqual({ accepted: true, replayed: false });

    expect(query.mock.calls).toEqual([
      [
        CLAIM_COMPANION_LOOKUP_ASSIGNMENT_SQL,
        [
          `sha256:${'5'.repeat(64)}`,
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
        COMPLETE_COMPANION_LOOKUP_ASSIGNMENT_SQL,
        [assignment.bodyDigest, signerKeyId, assignment.signature, JSON.stringify(assignment)],
      ],
      [RELEASE_COMPANION_LOOKUP_ASSIGNMENT_SQL, [assignmentBody.assignmentId]],
      [
        ACCEPT_COMPANION_LOOKUP_RESULT_SQL,
        [
          `sha256:${'6'.repeat(64)}`,
          httpRequest.bodyDigest,
          httpRequest.body.requestId,
          `sha256:${'7'.repeat(64)}`,
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

  it('decodes every fixed claim state and rejects non-exact database rows', async () => {
    const rows = [
      {
        row: { claim_state: 'none', assignment_body: null, signed_assignment: null },
        expected: { kind: 'none' },
      },
      {
        row: { claim_state: 'in_progress', assignment_body: null, signed_assignment: null },
        expected: { kind: 'in_progress' },
      },
      {
        row: {
          claim_state: 'completed',
          assignment_body: assignmentBody,
          signed_assignment: assignment,
        },
        expected: { kind: 'completed', assignment },
      },
    ] as const;
    for (const candidate of rows) {
      const state = new PostgresCompanionDeviceState(
        { query: async () => ({ rows: [candidate.row] }) },
        signerKeyId,
      );
      await expect(
        state.claimLookupAssignment(
          certificate,
          httpRequest,
          `sha256:${'8'.repeat(64)}`,
          assessedAt,
        ),
      ).resolves.toEqual(candidate.expected);
    }

    for (const malformed of [
      { claim_state: 'none', assignment_body: null, signed_assignment: null, extra: true },
      { claim_state: 'completed', assignment_body: assignmentBody, signed_assignment: {} },
      new Proxy({ claim_state: 'none', assignment_body: null, signed_assignment: null }, {}),
    ]) {
      const state = new PostgresCompanionDeviceState(
        { query: async () => ({ rows: [malformed] }) },
        signerKeyId,
      );
      await expect(
        state.claimLookupAssignment(
          certificate,
          httpRequest,
          `sha256:${'9'.repeat(64)}`,
          assessedAt,
        ),
      ).rejects.toThrow(CompanionDeviceStateUnavailableError);
    }
  });

  it('fails closed on malformed result acknowledgements and signer identities', async () => {
    expect(
      () => new PostgresCompanionDeviceState({ query: async () => ({ rows: [] }) }, 'short'),
    ).toThrow(CompanionDeviceStateUnavailableError);
    for (const row of [
      { accepted: true, replayed: 'false' },
      { accepted: false, replayed: false },
      { accepted: true, replayed: false, extra: true },
    ]) {
      const state = new PostgresCompanionDeviceState(
        { query: async () => ({ rows: [row] }) },
        signerKeyId,
      );
      await expect(
        state.acceptLookupResult(
          certificate,
          httpRequest,
          `sha256:${'a'.repeat(64)}`,
          assignment,
          result,
          `sha256:${'b'.repeat(64)}`,
          assessedAt,
        ),
      ).resolves.toBeUndefined();
    }
  });
});
