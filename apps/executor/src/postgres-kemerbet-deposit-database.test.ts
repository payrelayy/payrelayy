import { DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';
import { describe, expect, it } from 'vitest';

import type {
  KemerBetDepositExecutionLease,
  KemerBetDepositReconciliationLease,
} from './kemerbet-deposit-types.js';
import {
  CANCEL_DEPOSIT_EXECUTION_BEFORE_ACTION_SQL,
  FENCE_DEPOSIT_EXECUTION_FINAL_ACTION_SQL,
  KemerBetDepositDatabaseUnavailableError,
  LEASE_NEXT_DEPOSIT_EXECUTION_RECONCILIATION_SQL,
  LEASE_NEXT_DEPOSIT_EXECUTION_SQL,
  PostgresKemerBetDepositExecutionDatabase,
  RECORD_DEPOSIT_EXECUTION_RECONCILIATION_SQL,
  REQUIRE_DEPOSIT_EXECUTION_RECONCILIATION_SQL,
  type KemerBetDepositPostgresQuery,
} from './postgres-kemerbet-deposit-database.js';

const ids = {
  intent: '44444444-4444-4444-8444-444444444441',
  executionJob: '44444444-4444-4444-8444-444444444442',
  attempt: '44444444-4444-4444-8444-444444444443',
  agent: '44444444-4444-4444-8444-444444444444',
  executionToken: '44444444-4444-4444-8444-444444444445',
  reconciliationJob: '44444444-4444-4444-8444-444444444446',
  reconciliationToken: '44444444-4444-4444-8444-444444444447',
  reconciliation: '44444444-4444-4444-8444-444444444448',
  worker: '44444444-4444-4444-8444-444444444449',
  pilotRevision: '44444444-4444-4444-8444-444444444450',
  pilotReservation: '44444444-4444-4444-8444-444444444451',
  pilotAuthorization: '44444444-4444-4444-8444-444444444452',
} as const;
const pilotConfigurationDigest = `sha256:${'4'.repeat(64)}`;
const pilotManifest = Object.freeze({
  contractVersion: 1 as const,
  pilotRevisionId: ids.pilotRevision,
  configurationDigest: pilotConfigurationDigest,
});

function pilotEnvelope() {
  return {
    pilot_contract_version: 1,
    pilot_revision_id: ids.pilotRevision,
    pilot_reservation_id: ids.pilotReservation,
    pilot_configuration_digest: pilotConfigurationDigest,
    pilot_authorization_token: ids.pilotAuthorization,
  };
}

function createDatabase(query: KemerBetDepositPostgresQuery) {
  return new PostgresKemerBetDepositExecutionDatabase(query, pilotManifest);
}

const capturedAt = new Date('2030-01-02T03:04:05.000Z');
const requiredAt = new Date('2030-01-02T03:04:15.000Z');
const expiresAt = new Date('2030-01-02T03:09:15.000Z');

function executionLease(): KemerBetDepositExecutionLease {
  return {
    disposition: 'execution',
    phase: 'execute',
    depositIntentId: ids.intent,
    executionJobId: ids.executionJob,
    executionAttemptId: ids.attempt,
    platformAgentAccountId: ids.agent,
    target: {
      operation: 'deposit',
      playerId: 'PLAYER GAMMA',
      amountMinor: DEPOSIT_MINIMUM_MINOR,
      currencyCode: 'ETB',
    },
    leaseToken: ids.executionToken,
    leaseExpiresAt: expiresAt,
    privateLiveDepositPilotAuthorization: {
      contractVersion: 1,
      pilotRevisionId: ids.pilotRevision,
      pilotReservationId: ids.pilotReservation,
      configurationDigest: pilotConfigurationDigest,
      authorizationToken: ids.pilotAuthorization,
    },
  };
}

function reconciliationLease(
  exactPlayerCreditMatch: boolean | null = true,
): KemerBetDepositReconciliationLease {
  return {
    phase: 'reconcile',
    depositIntentId: ids.intent,
    reconciliationJobId: ids.reconciliationJob,
    executionAttemptId: ids.attempt,
    platformAgentAccountId: ids.agent,
    target: {
      operation: 'deposit',
      playerId: 'PLAYER GAMMA',
      amountMinor: DEPOSIT_MINIMUM_MINOR,
      currencyCode: 'ETB',
    },
    leaseToken: ids.reconciliationToken,
    leaseExpiresAt: expiresAt,
    recovery: {
      finalActionFencedAt: capturedAt,
      reconciliationRequiredAt: requiredAt,
      exactPlayerCreditMatch,
    },
  };
}

describe('production KemerBet deposit PostgreSQL adapter', () => {
  it('leases an immutable dynamic target only within product limits', async () => {
    const calls: Array<{ query: string; values: readonly unknown[] }> = [];
    const database = createDatabase({
      async query(query, values) {
        calls.push({ query, values });
        return {
          rows: [
            {
              deposit_intent_id: ids.intent,
              execution_job_id: ids.executionJob,
              execution_attempt_id: ids.attempt,
              platform_agent_account_id: ids.agent,
              player_id: 'PLAYER GAMMA',
              amount_minor: String(DEPOSIT_MINIMUM_MINOR),
              currency_code: 'ETB',
              lease_token: ids.executionToken,
              lease_expires_at: expiresAt,
              lease_disposition: 'execution',
              ...pilotEnvelope(),
            },
          ],
        };
      },
    });

    await expect(database.leaseNextExecution(ids.worker, 300)).resolves.toMatchObject({
      phase: 'execute',
      depositIntentId: ids.intent,
      target: { playerId: 'PLAYER GAMMA', amountMinor: DEPOSIT_MINIMUM_MINOR },
    });
    expect(calls).toEqual([{ query: LEASE_NEXT_DEPOSIT_EXECUTION_SQL, values: [ids.worker, 300] }]);
  });

  it('rejects a database target below the product minimum', async () => {
    const database = createDatabase({
      async query() {
        return {
          rows: [
            {
              deposit_intent_id: ids.intent,
              execution_job_id: ids.executionJob,
              execution_attempt_id: ids.attempt,
              platform_agent_account_id: ids.agent,
              player_id: 'PLAYER GAMMA',
              amount_minor: String(DEPOSIT_MINIMUM_MINOR - 1),
              currency_code: 'ETB',
              lease_token: ids.executionToken,
              lease_expires_at: expiresAt,
              lease_disposition: 'execution',
              ...pilotEnvelope(),
            },
          ],
        };
      },
    });

    await expect(database.leaseNextExecution(ids.worker, 300)).rejects.toBeInstanceOf(
      KemerBetDepositDatabaseUnavailableError,
    );
  });

  it('rejects an execution lease without the exact configured pilot envelope', async () => {
    for (const pilotOverride of [
      { pilot_authorization_token: null },
      { pilot_revision_id: '55555555-5555-4555-8555-555555555555' },
      { pilot_configuration_digest: `sha256:${'5'.repeat(64)}` },
      { pilot_contract_version: 2 },
    ]) {
      const database = createDatabase({
        async query() {
          return {
            rows: [
              {
                deposit_intent_id: ids.intent,
                execution_job_id: ids.executionJob,
                execution_attempt_id: ids.attempt,
                platform_agent_account_id: ids.agent,
                player_id: 'PLAYER GAMMA',
                amount_minor: String(DEPOSIT_MINIMUM_MINOR),
                currency_code: 'ETB',
                lease_token: ids.executionToken,
                lease_expires_at: expiresAt,
                lease_disposition: 'execution',
                ...pilotEnvelope(),
                ...pilotOverride,
              },
            ],
          };
        },
      });

      await expect(database.leaseNextExecution(ids.worker, 300)).rejects.toBeInstanceOf(
        KemerBetDepositDatabaseUnavailableError,
      );
    }
  });

  it('returns a strict recovery sentinel without constructing an execution lease', async () => {
    const calls: Array<{ query: string; values: readonly unknown[] }> = [];
    const database = createDatabase({
      async query(query, values) {
        calls.push({ query, values });
        return {
          rows: [
            {
              deposit_intent_id: ids.intent,
              execution_job_id: null,
              execution_attempt_id: ids.attempt,
              platform_agent_account_id: null,
              player_id: null,
              amount_minor: null,
              currency_code: null,
              lease_token: null,
              lease_expires_at: null,
              lease_disposition: 'recovered_expired_prepared',
              pilot_contract_version: null,
              pilot_revision_id: null,
              pilot_reservation_id: null,
              pilot_configuration_digest: null,
              pilot_authorization_token: null,
            },
          ],
        };
      },
    });

    await expect(database.leaseNextExecution(ids.worker, 300)).resolves.toEqual({
      disposition: 'recovered_expired_prepared',
      depositIntentId: ids.intent,
      executionAttemptId: ids.attempt,
    });
    expect(calls).toEqual([{ query: LEASE_NEXT_DEPOSIT_EXECUTION_SQL, values: [ids.worker, 300] }]);
  });

  it('routes the exact execution-attempt ID into the durable first-only fence', async () => {
    const calls: Array<{ query: string; values: readonly unknown[] }> = [];
    const database = createDatabase({
      async query(query, values) {
        calls.push({ query, values });
        return {
          rows: [
            {
              deposit_intent_id: ids.intent,
              execution_attempt_id: ids.attempt,
              final_action_fenced_at: capturedAt,
              first_fence_acquired: true,
              ...pilotEnvelope(),
            },
          ],
        };
      },
    });
    const lease = executionLease();

    await expect(database.fenceFinalAction(lease)).resolves.toMatchObject({
      firstFenceAcquired: true,
    });
    expect(calls).toEqual([
      {
        query: FENCE_DEPOSIT_EXECUTION_FINAL_ACTION_SQL,
        values: [
          ids.attempt,
          ids.executionToken,
          ids.pilotRevision,
          ids.pilotReservation,
          ids.pilotAuthorization,
        ],
      },
    ]);
  });

  it('rejects a fence that does not repeat the leased reservation authorization', async () => {
    const database = createDatabase({
      async query() {
        return {
          rows: [
            {
              deposit_intent_id: ids.intent,
              execution_attempt_id: ids.attempt,
              final_action_fenced_at: capturedAt,
              first_fence_acquired: true,
              ...pilotEnvelope(),
              pilot_authorization_token: '55555555-5555-4555-8555-555555555555',
            },
          ],
        };
      },
    });

    await expect(database.fenceFinalAction(executionLease())).rejects.toBeInstanceOf(
      KemerBetDepositDatabaseUnavailableError,
    );
  });

  it('uses the execution-attempt ID for cancellation and reconciliation handoff', async () => {
    const calls: Array<{ query: string; values: readonly unknown[] }> = [];
    const database = createDatabase({
      async query(query, values) {
        calls.push({ query, values });
        return query === CANCEL_DEPOSIT_EXECUTION_BEFORE_ACTION_SQL
          ? {
              rows: [
                {
                  deposit_intent_id: ids.intent,
                  execution_job_id: ids.executionJob,
                  execution_attempt_id: ids.attempt,
                  attempt_status: 'cancelled_before_action',
                  deposit_status: 'execution_review',
                  cancelled_at: capturedAt,
                },
              ],
            }
          : {
              rows: [
                {
                  deposit_intent_id: ids.intent,
                  execution_attempt_id: ids.attempt,
                  reconciliation_job_id: ids.reconciliationJob,
                  attempt_status: 'reconciliation_required',
                  deposit_status: 'execution_reconciliation',
                  recovery_handoff: false,
                },
              ],
            };
      },
    });
    const lease = executionLease();

    await database.cancelBeforeAction(lease, 'preparation_failed');
    await database.requireReconciliation(lease, true);
    expect(calls).toEqual([
      {
        query: CANCEL_DEPOSIT_EXECUTION_BEFORE_ACTION_SQL,
        values: [ids.attempt, ids.executionToken, 'preparation_failed'],
      },
      {
        query: REQUIRE_DEPOSIT_EXECUTION_RECONCILIATION_SQL,
        values: [ids.attempt, ids.executionToken, true],
      },
    ]);
  });

  it('parses recovery evidence and sends only normalized exact-match facts', async () => {
    const calls: Array<{ query: string; values: readonly unknown[] }> = [];
    const database = createDatabase({
      async query(query, values) {
        calls.push({ query, values });
        if (query === LEASE_NEXT_DEPOSIT_EXECUTION_RECONCILIATION_SQL) {
          return {
            rows: [
              {
                deposit_intent_id: ids.intent,
                reconciliation_job_id: ids.reconciliationJob,
                execution_attempt_id: ids.attempt,
                platform_agent_account_id: ids.agent,
                player_id: 'PLAYER GAMMA',
                amount_minor: String(DEPOSIT_MINIMUM_MINOR),
                currency_code: 'ETB',
                lease_token: ids.reconciliationToken,
                lease_expires_at: expiresAt,
                final_action_fenced_at: capturedAt,
                reconciliation_required_at: requiredAt,
                exact_player_credit_match: true,
              },
            ],
          };
        }
        return {
          rows: [
            {
              deposit_intent_id: ids.intent,
              reconciliation_job_id: ids.reconciliationJob,
              execution_attempt_id: ids.attempt,
              reconciliation_id: ids.reconciliation,
              outcome: 'confirmed_executed',
              reason_code: 'agent_deposit_history_in_window_and_player_credit_confirmed',
              attempt_status: 'confirmed_executed',
              deposit_status: 'executed',
              follow_up_job_id: null,
            },
          ],
        };
      },
    });

    const lease = await database.leaseNextReconciliation(ids.worker, 300);
    expect(lease).toMatchObject({
      target: { amountMinor: DEPOSIT_MINIMUM_MINOR },
      recovery: { exactPlayerCreditMatch: true },
    });
    await database.recordReconciliation(lease!, {
      observation: 'confirmed_executed',
      reasonCode: 'exact_history_and_player_credit',
      evidence: {
        keyedExternalReferenceFingerprint: `hmac-sha256-v1:${'c'.repeat(64)}`,
        approvedHistoryMatchCount: 1,
        normalizedOperationType: 'deposit',
        matchedHistoryOccurredAt: requiredAt,
        exactPlayerMatch: true,
        exactAmountMatch: true,
        exactCurrencyMatch: true,
        exactPlayerCreditMatch: true,
      },
    });
    expect(calls.at(-1)).toEqual({
      query: RECORD_DEPOSIT_EXECUTION_RECONCILIATION_SQL,
      values: [
        ids.reconciliationJob,
        ids.reconciliationToken,
        'confirmed_executed',
        `hmac-sha256-v1:${'c'.repeat(64)}`,
        1,
        'deposit',
        requiredAt,
        true,
        true,
        true,
        true,
      ],
    });
  });

  it('discards caller evidence for nonpositive observations and preserves a null crash fact', async () => {
    const database = createDatabase({
      async query(_query, values) {
        expect(values.slice(3)).toEqual([null, null, null, null, null, null, null, null]);
        return {
          rows: [
            {
              deposit_intent_id: ids.intent,
              reconciliation_job_id: ids.reconciliationJob,
              execution_attempt_id: ids.attempt,
              reconciliation_id: ids.reconciliation,
              outcome: 'ambiguous',
              reason_code: 'agent_history_ambiguous',
              attempt_status: 'review_required',
              deposit_status: 'execution_review',
              follow_up_job_id: null,
            },
          ],
        };
      },
    });

    await expect(
      database.recordReconciliation(reconciliationLease(null), {
        observation: 'ambiguous',
        evidence: null,
        reasonCode: 'history_mismatch',
      }),
    ).resolves.toMatchObject({ outcome: 'ambiguous', depositStatus: 'execution_review' });
  });
});
