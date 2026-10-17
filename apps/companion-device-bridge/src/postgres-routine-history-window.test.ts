import { describe, expect, it, vi } from 'vitest';
import {
  ROUTINE_DEPOSIT_CAPABILITY,
  ROUTINE_DEPOSIT_CONTRACT_VERSION,
  ROUTINE_DEPOSIT_PROTOCOL_MODE,
  type RoutineDepositCommand,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import type {
  SignedCompanionEnrollmentCertificate,
  SignedCompanionHttpRequest,
} from '@fetanagent/agent-platform-companion-contracts';

import {
  CompanionDeviceStateUnavailableError,
  EXECUTE_ROUTINE_DEPOSIT_COMMAND_SQL,
  PENDING_ROUTINE_HISTORY_WINDOW_SQL,
  PostgresCompanionDeviceState,
} from './postgres-state.js';

const certificate = {
  body: {
    certificateId: '11111111-1111-4111-8111-111111111111',
    deviceId: 'test-device-0001',
    deviceKeyId: 'test-device-key-0001',
  },
} as unknown as SignedCompanionEnrollmentCertificate;
const request = {
  bodyDigest: `sha256:${'a'.repeat(64)}`,
  body: {
    requestId: '22222222-2222-4222-8222-222222222222',
    issuedAt: '2026-10-17T14:01:00.000Z',
    expiresAt: '2026-10-17T14:01:10.000Z',
  },
} as unknown as SignedCompanionHttpRequest;
const command: RoutineDepositCommand = {
  contractVersion: ROUTINE_DEPOSIT_CONTRACT_VERSION,
  protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE,
  capability: ROUTINE_DEPOSIT_CAPABILITY,
  requestId: '33333333-3333-4333-8333-333333333333',
  workerInstanceId: '44444444-4444-4444-8444-444444444444',
  operation: 'reconcile',
  binding: {
    jobId: '55555555-5555-4555-8555-555555555555',
    intentId: '66666666-6666-4666-8666-666666666666',
    attemptId: '77777777-7777-4777-8777-777777777777',
    paymentClaimId: '88888888-8888-4888-8888-888888888888',
    platformAgentAccountId: '99999999-9999-4999-8999-999999999999',
    playerId: '32227462',
    amountMinor: 10000,
    currencyCode: 'ETB',
  },
};

describe('pending routine history fence', () => {
  it('adds only the server-authored fence to a signed pending reconciliation', async () => {
    const query = vi.fn(async (sql: string, _values?: readonly string[]) => {
      if (sql === EXECUTE_ROUTINE_DEPOSIT_COMMAND_SQL)
        return { rows: [{ result: { outcome: 'pending' } }] };
      if (sql === PENDING_ROUTINE_HISTORY_WINDOW_SQL)
        return {
          rows: [
            {
              history_window: {
                from: '2026-10-17T14:00:20.845915Z',
                until: '2026-10-17T14:00:21.785742Z',
              },
            },
          ],
        };
      throw new Error('Unexpected database query.');
    });
    const state = new PostgresCompanionDeviceState(
      { query },
      'no-money-signer-0001',
      'execution-signer-0001',
    );
    await expect(
      state.executeRoutineDepositCommand(
        certificate,
        request,
        'replay-identity',
        command,
        '2026-10-17T14:01:01.000Z',
      ),
    ).resolves.toEqual({
      outcome: 'pending',
      historyWindow: {
        from: '2026-10-17T14:00:20.845915Z',
        until: '2026-10-17T14:00:21.785742Z',
      },
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      EXECUTE_ROUTINE_DEPOSIT_COMMAND_SQL,
      PENDING_ROUTINE_HISTORY_WINDOW_SQL,
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([
      command.binding.attemptId,
      certificate.body.certificateId,
    ]);
  });

  it('fails closed when the server fence cannot be obtained', async () => {
    const query = vi.fn(async (sql: string) =>
      sql === EXECUTE_ROUTINE_DEPOSIT_COMMAND_SQL
        ? { rows: [{ result: { outcome: 'pending' } }] }
        : { rows: [{ history_window: null }] },
    );
    const state = new PostgresCompanionDeviceState(
      { query },
      'no-money-signer-0001',
      'execution-signer-0001',
    );
    await expect(
      state.executeRoutineDepositCommand(
        certificate,
        request,
        'replay-identity',
        command,
        '2026-10-17T14:01:01.000Z',
      ),
    ).resolves.toBeUndefined();
    // A missing fence is never turned into a recent, unbounded history search.
  });
});
