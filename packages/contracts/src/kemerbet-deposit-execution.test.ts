import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';

import {
  KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
  KEMERBET_DEPOSIT_FAKE_FIXTURE_VERSION,
  kemerBetDepositFakeScenarios,
  planKemerBetDepositAgentLane,
  planKemerBetDepositAttempt,
  planKemerBetDepositReconciliation,
  projectKemerBetDepositAgentLaneLog,
  projectKemerBetDepositAttemptLog,
  projectKemerBetDepositObservationLog,
  projectKemerBetDepositReconciliationLog,
  simulateKemerBetDepositFakeObservation,
  type KemerBetDepositAgentLaneState,
  type KemerBetDepositAttemptPlan,
  type KemerBetDepositFakeScenario,
} from './kemerbet-deposit-execution.js';

const executionAttemptId = '11111111-1111-4111-8111-111111111111';
const otherExecutionAttemptId = '22222222-2222-4222-8222-222222222222';
const agentAccountId = '33333333-3333-4333-8333-333333333333';
const playerAccountId = '44444444-4444-4444-8444-444444444444';
const otherPlayerAccountId = '55555555-5555-4555-8555-555555555555';
const attemptObservedAt = '2026-08-15T10:00:00.000Z';
const reconciliationObservedAt = '2026-08-15T10:01:00.000Z';

function fakeObservation(scenario: KemerBetDepositFakeScenario, observedAt = attemptObservedAt) {
  return simulateKemerBetDepositFakeObservation({ contractVersion: 1, scenario, observedAt });
}

function attemptCandidate(
  scenario: KemerBetDepositFakeScenario,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    contractVersion: 1,
    executionAttemptId,
    attemptVersion: 1,
    agentAccountId,
    playerAccountId,
    expectedAmountMinor: DEPOSIT_MINIMUM_MINOR,
    expectedCurrencyCode: 'ETB',
    observation: fakeObservation(scenario),
    priorReceipt: null,
    ...overrides,
  };
}

function reconcilableAttempt(
  scenario: KemerBetDepositFakeScenario = 'success_dialog_lost',
): KemerBetDepositAttemptPlan {
  const plan = planKemerBetDepositAttempt(attemptCandidate(scenario));
  expect(plan.disposition).toBe('would_require_reconciliation');
  expect(plan.receipt).not.toBeNull();
  return plan;
}

function reconciliationCandidate(
  scenario: KemerBetDepositFakeScenario,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    contractVersion: 1,
    attemptReceipt: reconcilableAttempt().receipt,
    observation: fakeObservation(scenario, reconciliationObservedAt),
    priorReceipt: null,
    ...overrides,
  };
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
      assertDeepFrozen(descriptor.value, seen);
    }
  }
}

function expectNoRetryAuthority(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) continue;
    if (key === 'retryAllowed') expect(descriptor.value).toBe(false);
    expectNoRetryAuthority(descriptor.value);
  }
}

describe('deterministic fake KemerBet observation contract', () => {
  it('freezes the contract, fixture, and exact closed scenario catalog', () => {
    expect(KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION).toBe(1);
    expect(KEMERBET_DEPOSIT_FAKE_FIXTURE_VERSION).toBe('kemerbet-deposit-fake-v1');
    expect(kemerBetDepositFakeScenarios).toEqual([
      'lookup_not_found',
      'lookup_player_mismatch',
      'lookup_currency_mismatch',
      'selector_unavailable_before_final_action',
      'selector_unavailable_after_final_action',
      'session_expired_before_final_action',
      'session_expired_after_final_action',
      'captcha_before_final_action',
      'captcha_after_final_action',
      'timeout_before_final_action',
      'timeout_after_final_action',
      'success_dialog_lost',
      'history_delayed',
      'history_missing',
      'history_duplicate',
      'history_non_approved',
      'history_non_deposit_operation',
      'history_operation_unknown',
      'history_player_mismatch',
      'history_amount_mismatch',
      'history_currency_mismatch',
      'history_before_execution_window',
      'history_after_execution_window',
      'history_execution_window_unknown',
      'player_credit_mismatch',
      'approved_exact_deposit_in_window_player_credit',
    ]);
    expect(Object.isFrozen(kemerBetDepositFakeScenarios)).toBe(true);
  });

  it.each(kemerBetDepositFakeScenarios)(
    'reconstructs %s deterministically and deeply freezes the result',
    (scenario) => {
      const first = fakeObservation(scenario);
      const second = fakeObservation(scenario);

      expect(first).toEqual(second);
      expect(first).toMatchObject({
        contractVersion: 1,
        platformCode: 'kemerbet',
        source: 'deterministic_fake',
        fixtureVersion: 'kemerbet-deposit-fake-v1',
        scenario,
        observedAt: attemptObservedAt,
        retryAllowed: false,
      });
      assertDeepFrozen(first);
      expectNoRetryAuthority(first);
    },
  );

  it('fails closed without reading accessors or proxy traps and rejects non-exact objects', () => {
    let accessorReads = 0;
    let proxyTrapCalls = 0;
    const accessorCandidate = { contractVersion: 1, scenario: 'history_delayed' } as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessorCandidate, 'observedAt', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return attemptObservedAt;
      },
    });
    const symbolCandidate = {
      contractVersion: 1,
      scenario: 'history_delayed',
      observedAt: attemptObservedAt,
      [Symbol('private')]: 'do-not-read',
    };
    const proxyCandidate = new Proxy(
      { contractVersion: 1, scenario: 'history_delayed', observedAt: attemptObservedAt },
      {
        ownKeys() {
          proxyTrapCalls += 1;
          throw new Error('caller-controlled-secret');
        },
      },
    );
    const customObject = Object.assign(Object.create({ inherited: true }) as object, {
      contractVersion: 1,
      scenario: 'history_delayed',
      observedAt: attemptObservedAt,
    });
    const candidates = [
      null,
      [],
      {},
      { contractVersion: 1, scenario: 'history_delayed', observedAt: attemptObservedAt, extra: 1 },
      { contractVersion: 2, scenario: 'history_delayed', observedAt: attemptObservedAt },
      { contractVersion: 1, scenario: 'open_ended', observedAt: attemptObservedAt },
      { contractVersion: 1, scenario: 'history_delayed', observedAt: '2026-08-15' },
      accessorCandidate,
      symbolCandidate,
      proxyCandidate,
      customObject,
    ];

    for (const candidate of candidates) {
      expect(simulateKemerBetDepositFakeObservation(candidate)).toMatchObject({
        scenario: 'invalid_candidate',
        observedAt: null,
      });
    }
    expect(accessorReads).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });
});

describe('KemerBet deposit attempt planner', () => {
  it.each([
    ['lookup_not_found', 'player_not_found'],
    ['lookup_player_mismatch', 'executor_player_mismatch'],
    ['lookup_currency_mismatch', 'executor_currency_mismatch'],
    ['selector_unavailable_before_final_action', 'executor_selector_uncertain'],
    ['session_expired_before_final_action', 'executor_session_uncertain'],
    ['captcha_before_final_action', 'executor_captcha_detected'],
    ['timeout_before_final_action', 'executor_timeout_before_final_action'],
  ] as const)('stops %s before the final action with %s', (scenario, reasonCode) => {
    const plan = planKemerBetDepositAttempt(attemptCandidate(scenario));

    expect(plan).toMatchObject({
      advisoryOnly: true,
      transportMode: 'deterministic_fake',
      networkEnabled: false,
      browserEnabled: false,
      finalActionEnabled: false,
      databaseEnabled: false,
      retryAllowed: false,
      disposition: 'would_stop_before_final_action',
      reasonCode,
      replayed: false,
    });
    expect(plan.receipt).toMatchObject({ retryAllowed: false, disposition: plan.disposition });
    assertDeepFrozen(plan);
    expectNoRetryAuthority(plan);
  });

  it.each([
    'selector_unavailable_after_final_action',
    'session_expired_after_final_action',
    'captcha_after_final_action',
    'timeout_after_final_action',
    'success_dialog_lost',
    'history_delayed',
    'history_missing',
    'history_duplicate',
    'history_non_approved',
    'history_non_deposit_operation',
    'history_operation_unknown',
    'history_player_mismatch',
    'history_amount_mismatch',
    'history_currency_mismatch',
    'history_before_execution_window',
    'history_after_execution_window',
    'history_execution_window_unknown',
    'player_credit_mismatch',
    'approved_exact_deposit_in_window_player_credit',
  ] as const)('requires reconciliation for %s and never completes execution', (scenario) => {
    const plan = planKemerBetDepositAttempt(attemptCandidate(scenario));

    expect(plan).toMatchObject({
      disposition: 'would_require_reconciliation',
      reasonCode: 'reconciliation_required',
      retryAllowed: false,
      finalActionEnabled: false,
    });
    expect(plan).not.toHaveProperty('outcome');
    expect(JSON.stringify(plan)).not.toContain('completed');
    expectNoRetryAuthority(plan);
  });

  it('accepts only policy-valid ETB minor amounts from 25 through 25,000 ETB', () => {
    for (const expectedAmountMinor of [DEPOSIT_MINIMUM_MINOR, DEPOSIT_MAXIMUM_MINOR]) {
      expect(
        planKemerBetDepositAttempt(attemptCandidate('success_dialog_lost', { expectedAmountMinor }))
          .receipt,
      ).not.toBeNull();
    }

    for (const expectedAmountMinor of [
      1_000,
      DEPOSIT_MINIMUM_MINOR - 1,
      DEPOSIT_MAXIMUM_MINOR + 1,
      2_500.5,
    ]) {
      expect(
        planKemerBetDepositAttempt(
          attemptCandidate('success_dialog_lost', { expectedAmountMinor }),
        ),
      ).toMatchObject({
        disposition: 'would_require_reconciliation',
        reasonCode: 'fake_observation_invalid',
        receipt: null,
        retryAllowed: false,
      });
    }
  });

  it('replays only an exact receipt and sends every conflict to reconciliation', () => {
    const first = reconcilableAttempt();
    const replay = planKemerBetDepositAttempt(
      attemptCandidate('success_dialog_lost', { priorReceipt: first.receipt }),
    );
    expect(replay).toMatchObject({ replayed: true, receipt: first.receipt });

    const conflicts = [
      attemptCandidate('success_dialog_lost', {
        expectedAmountMinor: DEPOSIT_MINIMUM_MINOR + 100,
        priorReceipt: first.receipt,
      }),
      attemptCandidate('success_dialog_lost', {
        playerAccountId: otherPlayerAccountId,
        priorReceipt: first.receipt,
      }),
      attemptCandidate('timeout_after_final_action', { priorReceipt: first.receipt }),
      attemptCandidate('success_dialog_lost', {
        priorReceipt: { ...(first.receipt as object), callerField: 'not-accepted' },
      }),
    ];
    for (const conflict of conflicts) {
      expect(planKemerBetDepositAttempt(conflict)).toMatchObject({
        disposition: 'would_require_reconciliation',
        reasonCode: 'execution_replay_conflict',
        receipt: null,
        replayed: false,
        retryAllowed: false,
      });
    }
  });

  it('rejects hostile roots and nested observations without reading attacker-controlled values', () => {
    let rootTrapCalls = 0;
    let nestedAccessorReads = 0;
    const rootProxy = new Proxy(attemptCandidate('success_dialog_lost') as object, {
      ownKeys() {
        rootTrapCalls += 1;
        throw new Error('root-secret');
      },
    });
    const observationWithAccessor = {
      ...fakeObservation('success_dialog_lost'),
    } as Record<string, unknown>;
    Object.defineProperty(observationWithAccessor, 'historyOutcome', {
      enumerable: true,
      get() {
        nestedAccessorReads += 1;
        return 'not_checked';
      },
    });
    const observationWithSymbol = {
      ...fakeObservation('success_dialog_lost'),
      [Symbol('secret')]: 'never-log-me',
    };
    const customObservation = Object.assign(Object.create({ inherited: true }) as object, {
      ...fakeObservation('success_dialog_lost'),
    });
    const revokedRoot = Proxy.revocable(attemptCandidate('success_dialog_lost') as object, {});
    const revokedObservation = Proxy.revocable(
      fakeObservation('success_dialog_lost') as object,
      {},
    );
    revokedRoot.revoke();
    revokedObservation.revoke();

    for (const candidate of [
      rootProxy,
      revokedRoot.proxy,
      attemptCandidate('success_dialog_lost', { observation: observationWithAccessor }),
      attemptCandidate('success_dialog_lost', { observation: observationWithSymbol }),
      attemptCandidate('success_dialog_lost', { observation: customObservation }),
      attemptCandidate('success_dialog_lost', { observation: revokedObservation.proxy }),
    ]) {
      expect(planKemerBetDepositAttempt(candidate)).toMatchObject({
        disposition: 'would_require_reconciliation',
        reasonCode: 'fake_observation_invalid',
        receipt: null,
      });
    }
    expect(rootTrapCalls).toBe(0);
    expect(nestedAccessorReads).toBe(0);
  });
});

describe('KemerBet deposit reconciliation planner', () => {
  it('confirms only one Approved deposit in the bounded window with every exact match', () => {
    const plan = planKemerBetDepositReconciliation(
      reconciliationCandidate('approved_exact_deposit_in_window_player_credit'),
    );

    expect(plan).toMatchObject({
      advisoryOnly: true,
      networkEnabled: false,
      browserEnabled: false,
      finalActionEnabled: false,
      databaseEnabled: false,
      disposition: 'would_confirm_observed_execution',
      reasonCode: 'execution_observed_confirmed',
      retryAllowed: false,
      replayed: false,
    });
    expect(plan.receipt).toMatchObject({
      disposition: 'would_confirm_observed_execution',
      observation: {
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'within_window',
      },
      retryAllowed: false,
    });
    expect(JSON.stringify(plan)).not.toContain('completed');
    assertDeepFrozen(plan);
    expectNoRetryAuthority(plan);
  });

  it.each([
    ['success_dialog_lost', 'reconciliation_required'],
    ['selector_unavailable_after_final_action', 'reconciliation_required'],
    ['session_expired_after_final_action', 'reconciliation_required'],
    ['captcha_after_final_action', 'reconciliation_required'],
    ['timeout_after_final_action', 'reconciliation_required'],
    ['history_delayed', 'executor_history_delayed'],
    ['history_missing', 'executor_history_missing'],
    ['history_operation_unknown', 'executor_operation_type_unknown'],
    ['history_execution_window_unknown', 'executor_history_window_unknown'],
  ] as const)(
    'continues reconciliation for %s without authorizing a retry',
    (scenario, reasonCode) => {
      const plan = planKemerBetDepositReconciliation(reconciliationCandidate(scenario));
      expect(plan).toMatchObject({
        disposition: 'would_continue_reconciliation',
        reasonCode,
        retryAllowed: false,
      });
      expectNoRetryAuthority(plan);
    },
  );

  it.each([
    ['history_duplicate', 'executor_history_ambiguous'],
    ['history_non_approved', 'executor_history_non_approved'],
    ['history_non_deposit_operation', 'executor_operation_type_mismatch'],
    ['history_player_mismatch', 'executor_player_mismatch'],
    ['history_amount_mismatch', 'executor_amount_mismatch'],
    ['history_currency_mismatch', 'executor_currency_mismatch'],
    ['history_before_execution_window', 'executor_history_outside_execution_window'],
    ['history_after_execution_window', 'executor_history_outside_execution_window'],
    ['player_credit_mismatch', 'executor_player_credit_mismatch'],
  ] as const)('requires review for %s without authorizing a retry', (scenario, reasonCode) => {
    const plan = planKemerBetDepositReconciliation(reconciliationCandidate(scenario));
    expect(plan).toMatchObject({
      disposition: 'would_require_review',
      reasonCode,
      retryAllowed: false,
    });
    expectNoRetryAuthority(plan);
  });

  it.each(kemerBetDepositFakeScenarios)(
    'never confirms or enables retry for any non-positive scenario: %s',
    (scenario) => {
      const plan = planKemerBetDepositReconciliation(reconciliationCandidate(scenario));
      const isPositive = scenario === 'approved_exact_deposit_in_window_player_credit';

      expect(plan.disposition === 'would_confirm_observed_execution').toBe(isPositive);
      expect(plan.retryAllowed).toBe(false);
      expectNoRetryAuthority(plan);
    },
  );

  it('rejects caller-tampered operation and execution-window facts as invalid observations', () => {
    const positive = fakeObservation(
      'approved_exact_deposit_in_window_player_credit',
      reconciliationObservedAt,
    );
    for (const observation of [
      { ...positive, historyOperationType: 'unknown' },
      { ...positive, historyOperationType: null },
      { ...positive, historyExecutionWindowMatch: 'unknown' },
      { ...positive, historyExecutionWindowMatch: null },
    ]) {
      expect(
        planKemerBetDepositReconciliation({
          contractVersion: 1,
          attemptReceipt: reconcilableAttempt().receipt,
          observation,
          priorReceipt: null,
        }),
      ).toMatchObject({
        disposition: 'would_require_review',
        reasonCode: 'fake_observation_invalid',
        receipt: null,
        retryAllowed: false,
      });
    }
  });

  it('keeps immediate success provisional until a later exact observation confirms it', () => {
    const provisionalAttempt = reconcilableAttempt('history_delayed');
    expect(provisionalAttempt.receipt?.observation.immediateResult).toBe('success');

    const delayed = planKemerBetDepositReconciliation({
      contractVersion: 1,
      attemptReceipt: provisionalAttempt.receipt,
      observation: fakeObservation('history_delayed', reconciliationObservedAt),
      priorReceipt: null,
    });
    expect(delayed.disposition).toBe('would_continue_reconciliation');

    const confirmed = planKemerBetDepositReconciliation({
      contractVersion: 1,
      attemptReceipt: provisionalAttempt.receipt,
      observation: fakeObservation(
        'approved_exact_deposit_in_window_player_credit',
        reconciliationObservedAt,
      ),
      priorReceipt: null,
    });
    expect(confirmed.disposition).toBe('would_confirm_observed_execution');
  });

  it('rejects pre-attempt observations and stop-before-action receipts', () => {
    const attempt = reconcilableAttempt();
    const olderObservation = fakeObservation(
      'approved_exact_deposit_in_window_player_credit',
      '2026-08-15T09:59:59.999Z',
    );
    expect(
      planKemerBetDepositReconciliation({
        contractVersion: 1,
        attemptReceipt: attempt.receipt,
        observation: olderObservation,
        priorReceipt: null,
      }),
    ).toMatchObject({
      disposition: 'would_require_review',
      reasonCode: 'fake_observation_invalid',
      receipt: null,
    });

    const stoppedAttempt = planKemerBetDepositAttempt(attemptCandidate('lookup_not_found'));
    expect(
      planKemerBetDepositReconciliation({
        contractVersion: 1,
        attemptReceipt: stoppedAttempt.receipt,
        observation: fakeObservation(
          'approved_exact_deposit_in_window_player_credit',
          reconciliationObservedAt,
        ),
        priorReceipt: null,
      }),
    ).toMatchObject({
      disposition: 'would_require_review',
      reasonCode: 'fake_observation_invalid',
      receipt: null,
    });
  });

  it('replays only an exact reconciliation receipt and reviews conflicts', () => {
    const first = planKemerBetDepositReconciliation(
      reconciliationCandidate('approved_exact_deposit_in_window_player_credit'),
    );
    const replay = planKemerBetDepositReconciliation(
      reconciliationCandidate('approved_exact_deposit_in_window_player_credit', {
        priorReceipt: first.receipt,
      }),
    );
    expect(replay).toMatchObject({ replayed: true, receipt: first.receipt });

    const conflict = planKemerBetDepositReconciliation(
      reconciliationCandidate('player_credit_mismatch', { priorReceipt: first.receipt }),
    );
    expect(conflict).toMatchObject({
      disposition: 'would_require_review',
      reasonCode: 'execution_replay_conflict',
      receipt: null,
      replayed: false,
      retryAllowed: false,
    });

    const differentInitialObservation = reconcilableAttempt('timeout_after_final_action');
    expect(
      planKemerBetDepositReconciliation(
        reconciliationCandidate('approved_exact_deposit_in_window_player_credit', {
          attemptReceipt: differentInitialObservation.receipt,
          priorReceipt: first.receipt,
        }),
      ),
    ).toMatchObject({
      disposition: 'would_require_review',
      reasonCode: 'execution_replay_conflict',
      receipt: null,
      replayed: false,
    });
  });

  it('fails closed on hostile reconciliation roots and nested values without reading traps', () => {
    let proxyTrapCalls = 0;
    let accessorReads = 0;
    const base = reconciliationCandidate(
      'approved_exact_deposit_in_window_player_credit',
    ) as Record<string, unknown>;
    const rootProxy = new Proxy(base, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('reconciliation-secret');
      },
    });
    const accessorCandidate = {
      contractVersion: 1,
      attemptReceipt: base.attemptReceipt,
      priorReceipt: null,
    } as Record<string, unknown>;
    Object.defineProperty(accessorCandidate, 'observation', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return base.observation;
      },
    });
    const symbolCandidate = { ...base, [Symbol('private')]: 'never-read' };
    const customCandidate = Object.assign(Object.create({ inherited: true }) as object, base);
    const revokedReceipt = Proxy.revocable(base.attemptReceipt as object, {});
    revokedReceipt.revoke();

    for (const candidate of [
      rootProxy,
      accessorCandidate,
      symbolCandidate,
      customCandidate,
      { ...base, attemptReceipt: revokedReceipt.proxy },
    ]) {
      const plan = planKemerBetDepositReconciliation(candidate);
      expect(plan).toMatchObject({
        disposition: 'would_require_review',
        reasonCode: 'fake_observation_invalid',
        receipt: null,
        retryAllowed: false,
      });
      assertDeepFrozen(plan);
    }
    expect(proxyTrapCalls).toBe(0);
    expect(accessorReads).toBe(0);
  });
});

describe('per-agent KemerBet advisory lane planner', () => {
  function laneCandidate(
    laneState: KemerBetDepositAgentLaneState,
    queuedAttempts: readonly unknown[],
  ): unknown {
    return { contractVersion: 1, agentAccountId, laneState, queuedAttempts };
  }

  const unsortedQueue = [
    { executionAttemptId: otherExecutionAttemptId, laneSequence: 2 },
    { executionAttemptId, laneSequence: 1 },
  ];

  it('sorts a valid available lane and starts only the first advisory attempt', () => {
    const plan = planKemerBetDepositAgentLane(laneCandidate('available', unsortedQueue));

    expect(plan).toMatchObject({
      directExecutionEnabled: false,
      disposition: 'would_start_first',
      retryAllowed: false,
      steps: [
        {
          executionAttemptId,
          laneSequence: 1,
          action: 'would_start_advisory_attempt',
          retryAllowed: false,
        },
        {
          executionAttemptId: otherExecutionAttemptId,
          laneSequence: 2,
          action: 'would_wait',
          retryAllowed: false,
        },
      ],
    });
    assertDeepFrozen(plan);
    expectNoRetryAuthority(plan);
  });

  it.each([
    'execution_in_progress',
    'execution_uncertain',
    'execution_reconciliation',
    'execution_review',
  ] as const)('keeps every queued attempt blocked while the lane is %s', (laneState) => {
    const plan = planKemerBetDepositAgentLane(laneCandidate(laneState, unsortedQueue));

    expect(plan.disposition).toBe('would_keep_blocked');
    expect(plan.steps.map((step) => step.action)).toEqual(['would_wait', 'would_wait']);
    expect(plan.directExecutionEnabled).toBe(false);
    expectNoRetryAuthority(plan);
  });

  it('keeps an empty available lane idle', () => {
    expect(planKemerBetDepositAgentLane(laneCandidate('available', []))).toMatchObject({
      disposition: 'would_remain_idle',
      steps: [],
      directExecutionEnabled: false,
      retryAllowed: false,
    });
  });

  it('rejects duplicate, gapped, hostile, symbolic, and custom queue shapes', () => {
    let proxyTrapCalls = 0;
    let accessorReads = 0;
    const proxyQueue = new Proxy(unsortedQueue, {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error('queue-secret');
      },
    });
    const accessorItem = { executionAttemptId } as Record<string, unknown>;
    Object.defineProperty(accessorItem, 'laneSequence', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 1;
      },
    });
    const customItem = Object.assign(Object.create({ inherited: true }) as object, {
      executionAttemptId,
      laneSequence: 1,
    });
    const cases = [
      [
        { executionAttemptId, laneSequence: 1 },
        { executionAttemptId, laneSequence: 2 },
      ],
      [
        { executionAttemptId, laneSequence: 1 },
        { executionAttemptId: otherExecutionAttemptId, laneSequence: 3 },
      ],
      [{ executionAttemptId, laneSequence: 1, [Symbol('secret')]: true }],
      [accessorItem],
      [customItem],
      proxyQueue,
    ];

    for (const queue of cases) {
      expect(planKemerBetDepositAgentLane(laneCandidate('available', queue))).toMatchObject({
        disposition: 'invalid_lane',
        agentAccountId: null,
        steps: [],
        directExecutionEnabled: false,
        retryAllowed: false,
      });
    }
    expect(proxyTrapCalls).toBe(0);
    expect(accessorReads).toBe(0);
  });
});

describe('redacted projections and capability boundary', () => {
  it('emits deeply frozen logs with no identifiers, amounts, timestamps, or raw fields', () => {
    const attempt = reconcilableAttempt();
    const reconciliation = planKemerBetDepositReconciliation(
      reconciliationCandidate('approved_exact_deposit_in_window_player_credit'),
    );
    const lane = {
      contractVersion: 1,
      agentAccountId,
      laneState: 'execution_uncertain',
      queuedAttempts: [{ executionAttemptId, laneSequence: 1 }],
    };
    const logs = [
      projectKemerBetDepositObservationLog(fakeObservation('success_dialog_lost')),
      projectKemerBetDepositAttemptLog(attempt.receipt),
      projectKemerBetDepositReconciliationLog(reconciliation.receipt),
      projectKemerBetDepositAgentLaneLog(lane),
    ];
    const serialized = JSON.stringify(logs);

    for (const log of logs) {
      assertDeepFrozen(log);
      expectNoRetryAuthority(log);
    }
    for (const forbidden of [
      executionAttemptId,
      agentAccountId,
      playerAccountId,
      attemptObservedAt,
      reconciliationObservedAt,
      String(DEPOSIT_MINIMUM_MINOR),
      'playerId',
      'username',
      'externalReference',
      'https://',
      'responseBody',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('never copies hostile values or thrown messages into invalid projections', () => {
    const secret = 'CALLER-CONTROLLED-SECRET';
    let proxyTrapCalls = 0;
    const hostile = new Proxy(
      { contractVersion: 1 },
      {
        ownKeys() {
          proxyTrapCalls += 1;
          throw new Error(secret);
        },
      },
    );
    const serialized = JSON.stringify([
      projectKemerBetDepositObservationLog(hostile),
      projectKemerBetDepositAttemptLog(hostile),
      projectKemerBetDepositReconciliationLog(hostile),
      projectKemerBetDepositAgentLaneLog(hostile),
    ]);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('contractVersion":1,"caller');
    expect(proxyTrapCalls).toBe(0);
  });

  it('has only the pure validator and domain-policy imports and no direct execution primitives', () => {
    const source = readFileSync(
      new URL('./kemerbet-deposit-execution.ts', import.meta.url),
      'utf8',
    );
    const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const importedModules = [...source.matchAll(/from ['"]([^'"]+)['"]/gu)].map(
      (match) => match[1],
    );

    expect(importedModules).toEqual(['node:util/types', '@fetanagent/domain']);
    expect(source).not.toMatch(
      /\b(?:async|Promise|fetch|XMLHttpRequest|WebSocket|setTimeout|setInterval)\b|Math\.random|process\.env/u,
    );
    expect(source).not.toMatch(/['"]completed['"]/u);
    expect(indexSource).not.toContain('PlatformDepositRequest');
    expect(indexSource).not.toContain('PlatformDepositResult');
    expect(indexSource).not.toContain('PlatformDepositExecutor');
    expect(indexSource).not.toContain('playerId');
  });
});
