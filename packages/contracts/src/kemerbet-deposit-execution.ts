import { isProxy } from 'node:util/types';

import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';

/**
 * Pure, deterministic contract for designing the KemerBet deposit boundary. This module does not
 * execute a deposit. It has no transport, browser, persistence, scheduling, or retry capability.
 */
export const KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION = 1 as const;
export const KEMERBET_DEPOSIT_FAKE_FIXTURE_VERSION = 'kemerbet-deposit-fake-v1' as const;

export const kemerBetDepositFakeScenarios = Object.freeze([
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
] as const);

export type KemerBetDepositFakeScenario = (typeof kemerBetDepositFakeScenarios)[number];

export interface KemerBetDepositFakeScenarioCandidate {
  readonly contractVersion: 1;
  readonly scenario: KemerBetDepositFakeScenario;
  /** Strict millisecond UTC ISO timestamp supplied by the deterministic fixture. */
  readonly observedAt: string;
}

type LookupOutcome =
  'matched' | 'not_found' | 'player_mismatch' | 'currency_mismatch' | 'unavailable';
type SelectorState = 'compatible' | 'unavailable';
type SessionState = 'active' | 'expired' | 'unknown';
type CaptchaState = 'absent' | 'present' | 'unknown';
type FailurePhase = 'none' | 'before_final_action' | 'after_final_action' | 'reconciliation';
type FinalActionState = 'not_attempted' | 'acknowledged' | 'uncertain';
type ImmediateResult = 'not_observed' | 'success' | 'lost' | 'timeout';
type HistoryOutcome =
  'not_checked' | 'delayed' | 'missing' | 'duplicate' | 'non_approved' | 'one_approved';
type MatchOutcome = 'not_checked' | 'matched' | 'mismatched';
type HistoryOperationType = 'not_checked' | 'deposit' | 'non_deposit' | 'unknown';
type HistoryExecutionWindowMatch =
  'not_checked' | 'within_window' | 'before_window' | 'after_window' | 'unknown';
type PlayerCreditOutcome = 'not_checked' | 'exact_credit' | 'mismatch' | 'unavailable';

export interface KemerBetDepositFakeObservation {
  readonly contractVersion: 1;
  readonly platformCode: 'kemerbet';
  readonly source: 'deterministic_fake';
  readonly fixtureVersion: 'kemerbet-deposit-fake-v1';
  readonly scenario: KemerBetDepositFakeScenario | 'invalid_candidate';
  readonly lookupOutcome: LookupOutcome;
  readonly selectorState: SelectorState;
  readonly sessionState: SessionState;
  readonly captchaState: CaptchaState;
  readonly failurePhase: FailurePhase;
  readonly finalActionState: FinalActionState;
  readonly immediateResult: ImmediateResult;
  readonly historyOutcome: HistoryOutcome;
  readonly historyOperationType: HistoryOperationType;
  readonly historyExecutionWindowMatch: HistoryExecutionWindowMatch;
  readonly historyPlayerMatch: MatchOutcome;
  readonly historyAmountMatch: MatchOutcome;
  readonly historyCurrencyMatch: MatchOutcome;
  readonly playerCreditOutcome: PlayerCreditOutcome;
  readonly observedAt: string | null;
  readonly retryAllowed: false;
}

interface ObservationDescriptor {
  readonly lookupOutcome: LookupOutcome;
  readonly selectorState: SelectorState;
  readonly sessionState: SessionState;
  readonly captchaState: CaptchaState;
  readonly failurePhase: FailurePhase;
  readonly finalActionState: FinalActionState;
  readonly immediateResult: ImmediateResult;
  readonly historyOutcome: HistoryOutcome;
  readonly historyOperationType: HistoryOperationType;
  readonly historyExecutionWindowMatch: HistoryExecutionWindowMatch;
  readonly historyPlayerMatch: MatchOutcome;
  readonly historyAmountMatch: MatchOutcome;
  readonly historyCurrencyMatch: MatchOutcome;
  readonly playerCreditOutcome: PlayerCreditOutcome;
}

const observationKeys = [
  'contractVersion',
  'platformCode',
  'source',
  'fixtureVersion',
  'scenario',
  'lookupOutcome',
  'selectorState',
  'sessionState',
  'captchaState',
  'failurePhase',
  'finalActionState',
  'immediateResult',
  'historyOutcome',
  'historyOperationType',
  'historyExecutionWindowMatch',
  'historyPlayerMatch',
  'historyAmountMatch',
  'historyCurrencyMatch',
  'playerCreditOutcome',
  'observedAt',
  'retryAllowed',
] as const;

const fakeScenarioCandidateKeys = ['contractVersion', 'scenario', 'observedAt'] as const;

type UnknownRecord = Record<string, unknown>;

function isPlainNonProxyRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactEnumerableDataKeys(
  value: UnknownRecord,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !expectedKeys.every((key) => actualKeys.includes(key))
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable === true &&
      Object.hasOwn(descriptor, 'value')
    );
  });
}

function ownDataValue(value: UnknownRecord, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
}

function isExactDataArray(value: unknown): value is readonly unknown[] {
  if (typeof value !== 'object' || value === null || isProxy(value) || !Array.isArray(value)) {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) return false;

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')) return false;
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 1_000) return false;

  const actualKeys = Reflect.ownKeys(value);
  if (
    actualKeys.length !== length + 1 ||
    actualKeys.some((key) => typeof key !== 'string') ||
    !actualKeys.includes('length')
  ) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return false;
    }
  }
  return true;
}

function arrayDataValue(value: readonly unknown[], index: number): unknown {
  return Object.getOwnPropertyDescriptor(value, String(index))?.value as unknown;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value);
    }
  }
  return Object.freeze(value);
}

function isStrictUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isInternalUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value) &&
    value !== '00000000-0000-0000-0000-000000000000'
  );
}

function isPolicyAmountMinor(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= DEPOSIT_MINIMUM_MINOR &&
    value <= DEPOSIT_MAXIMUM_MINOR
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isFakeScenario(value: unknown): value is KemerBetDepositFakeScenario {
  return (
    typeof value === 'string' && (kemerBetDepositFakeScenarios as readonly string[]).includes(value)
  );
}

const baseObservationDescriptor: ObservationDescriptor = {
  lookupOutcome: 'matched',
  selectorState: 'compatible',
  sessionState: 'active',
  captchaState: 'absent',
  failurePhase: 'none',
  finalActionState: 'uncertain',
  immediateResult: 'not_observed',
  historyOutcome: 'not_checked',
  historyOperationType: 'not_checked',
  historyExecutionWindowMatch: 'not_checked',
  historyPlayerMatch: 'not_checked',
  historyAmountMatch: 'not_checked',
  historyCurrencyMatch: 'not_checked',
  playerCreditOutcome: 'not_checked',
};

function descriptorForScenario(scenario: KemerBetDepositFakeScenario): ObservationDescriptor {
  switch (scenario) {
    case 'lookup_not_found':
      return {
        ...baseObservationDescriptor,
        lookupOutcome: 'not_found',
        failurePhase: 'before_final_action',
        finalActionState: 'not_attempted',
      };
    case 'lookup_player_mismatch':
      return {
        ...baseObservationDescriptor,
        lookupOutcome: 'player_mismatch',
        failurePhase: 'before_final_action',
        finalActionState: 'not_attempted',
      };
    case 'lookup_currency_mismatch':
      return {
        ...baseObservationDescriptor,
        lookupOutcome: 'currency_mismatch',
        failurePhase: 'before_final_action',
        finalActionState: 'not_attempted',
      };
    case 'selector_unavailable_before_final_action':
      return {
        ...baseObservationDescriptor,
        lookupOutcome: 'unavailable',
        selectorState: 'unavailable',
        failurePhase: 'before_final_action',
        finalActionState: 'not_attempted',
      };
    case 'selector_unavailable_after_final_action':
      return {
        ...baseObservationDescriptor,
        lookupOutcome: 'unavailable',
        selectorState: 'unavailable',
        sessionState: 'unknown',
        captchaState: 'unknown',
        failurePhase: 'after_final_action',
      };
    case 'session_expired_before_final_action':
      return {
        ...baseObservationDescriptor,
        sessionState: 'expired',
        failurePhase: 'before_final_action',
        finalActionState: 'not_attempted',
      };
    case 'session_expired_after_final_action':
      return {
        ...baseObservationDescriptor,
        sessionState: 'expired',
        failurePhase: 'after_final_action',
      };
    case 'captcha_before_final_action':
      return {
        ...baseObservationDescriptor,
        captchaState: 'present',
        failurePhase: 'before_final_action',
        finalActionState: 'not_attempted',
      };
    case 'captcha_after_final_action':
      return {
        ...baseObservationDescriptor,
        captchaState: 'present',
        failurePhase: 'after_final_action',
      };
    case 'timeout_before_final_action':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'before_final_action',
        finalActionState: 'not_attempted',
        immediateResult: 'timeout',
      };
    case 'timeout_after_final_action':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'after_final_action',
        immediateResult: 'timeout',
      };
    case 'success_dialog_lost':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'after_final_action',
        immediateResult: 'lost',
      };
    case 'history_delayed':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'delayed',
      };
    case 'history_missing':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'missing',
      };
    case 'history_duplicate':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'duplicate',
      };
    case 'history_non_approved':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'non_approved',
      };
    case 'history_non_deposit_operation':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'non_deposit',
        historyExecutionWindowMatch: 'within_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'exact_credit',
      };
    case 'history_operation_unknown':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'unknown',
        historyExecutionWindowMatch: 'within_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'exact_credit',
      };
    case 'history_player_mismatch':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'within_window',
        historyPlayerMatch: 'mismatched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'not_checked',
      };
    case 'history_amount_mismatch':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'within_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'mismatched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'not_checked',
      };
    case 'history_currency_mismatch':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'within_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'mismatched',
        playerCreditOutcome: 'not_checked',
      };
    case 'history_before_execution_window':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'before_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'exact_credit',
      };
    case 'history_after_execution_window':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'after_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'exact_credit',
      };
    case 'history_execution_window_unknown':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'unknown',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'exact_credit',
      };
    case 'player_credit_mismatch':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'within_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'mismatch',
      };
    case 'approved_exact_deposit_in_window_player_credit':
      return {
        ...baseObservationDescriptor,
        failurePhase: 'reconciliation',
        finalActionState: 'acknowledged',
        immediateResult: 'success',
        historyOutcome: 'one_approved',
        historyOperationType: 'deposit',
        historyExecutionWindowMatch: 'within_window',
        historyPlayerMatch: 'matched',
        historyAmountMatch: 'matched',
        historyCurrencyMatch: 'matched',
        playerCreditOutcome: 'exact_credit',
      };
  }
}

function makeObservation(
  scenario: KemerBetDepositFakeScenario,
  observedAt: string,
): KemerBetDepositFakeObservation {
  return deepFreeze({
    contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    source: 'deterministic_fake' as const,
    fixtureVersion: KEMERBET_DEPOSIT_FAKE_FIXTURE_VERSION,
    scenario,
    ...descriptorForScenario(scenario),
    observedAt,
    retryAllowed: false as const,
  });
}

const invalidObservation: KemerBetDepositFakeObservation = deepFreeze({
  contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
  platformCode: 'kemerbet' as const,
  source: 'deterministic_fake' as const,
  fixtureVersion: KEMERBET_DEPOSIT_FAKE_FIXTURE_VERSION,
  scenario: 'invalid_candidate' as const,
  lookupOutcome: 'unavailable' as const,
  selectorState: 'unavailable' as const,
  sessionState: 'unknown' as const,
  captchaState: 'unknown' as const,
  failurePhase: 'none' as const,
  finalActionState: 'not_attempted' as const,
  immediateResult: 'not_observed' as const,
  historyOutcome: 'not_checked' as const,
  historyOperationType: 'unknown' as const,
  historyExecutionWindowMatch: 'unknown' as const,
  historyPlayerMatch: 'not_checked' as const,
  historyAmountMatch: 'not_checked' as const,
  historyCurrencyMatch: 'not_checked' as const,
  playerCreditOutcome: 'unavailable' as const,
  observedAt: null,
  retryAllowed: false as const,
});

function validatedFakeScenarioCandidate(
  candidate: unknown,
): KemerBetDepositFakeScenarioCandidate | null {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, fakeScenarioCandidateKeys)
  ) {
    return null;
  }

  const contractVersion = ownDataValue(candidate, 'contractVersion');
  const scenario = ownDataValue(candidate, 'scenario');
  const observedAt = ownDataValue(candidate, 'observedAt');
  if (
    contractVersion !== KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION ||
    !isFakeScenario(scenario) ||
    !isStrictUtcTimestamp(observedAt)
  ) {
    return null;
  }

  return { contractVersion, scenario, observedAt };
}

/** Returns a canonical, deeply frozen fake observation or a fixed redacted invalid observation. */
export function simulateKemerBetDepositFakeObservation(
  candidate: unknown,
): KemerBetDepositFakeObservation {
  try {
    const validated = validatedFakeScenarioCandidate(candidate);
    return validated === null
      ? invalidObservation
      : makeObservation(validated.scenario, validated.observedAt);
  } catch {
    return invalidObservation;
  }
}

function observationsEqual(
  left: KemerBetDepositFakeObservation,
  right: KemerBetDepositFakeObservation,
): boolean {
  return observationKeys.every((key) => left[key] === right[key]);
}

function validatedObservation(candidate: unknown): KemerBetDepositFakeObservation | null {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, observationKeys)
  ) {
    return null;
  }

  const scenario = ownDataValue(candidate, 'scenario');
  const observedAt = ownDataValue(candidate, 'observedAt');
  if (!isFakeScenario(scenario) || !isStrictUtcTimestamp(observedAt)) return null;

  const expected = makeObservation(scenario, observedAt);
  return observationKeys.every((key) => ownDataValue(candidate, key) === expected[key])
    ? expected
    : null;
}

export type KemerBetDepositAttemptDisposition =
  'would_stop_before_final_action' | 'would_require_reconciliation';

export type KemerBetDepositAttemptReasonCode =
  | 'fake_observation_invalid'
  | 'execution_replay_conflict'
  | 'player_not_found'
  | 'executor_player_mismatch'
  | 'executor_currency_mismatch'
  | 'executor_selector_uncertain'
  | 'executor_session_uncertain'
  | 'executor_captcha_detected'
  | 'executor_timeout_before_final_action'
  | 'reconciliation_required';

export interface KemerBetDepositAttemptCandidate {
  readonly contractVersion: 1;
  readonly executionAttemptId: string;
  readonly attemptVersion: number;
  readonly agentAccountId: string;
  readonly playerAccountId: string;
  readonly expectedAmountMinor: number;
  readonly expectedCurrencyCode: 'ETB';
  readonly observation: unknown;
  readonly priorReceipt: unknown | null;
}

export interface KemerBetDepositAttemptReceipt {
  readonly contractVersion: 1;
  readonly platformCode: 'kemerbet';
  readonly advisoryOnly: true;
  readonly transportMode: 'deterministic_fake';
  readonly executionAttemptId: string;
  readonly attemptVersion: number;
  readonly agentAccountId: string;
  readonly playerAccountId: string;
  readonly expectedAmountMinor: number;
  readonly expectedCurrencyCode: 'ETB';
  readonly observation: KemerBetDepositFakeObservation;
  readonly disposition: KemerBetDepositAttemptDisposition;
  readonly reasonCode: KemerBetDepositAttemptReasonCode;
  readonly retryAllowed: false;
}

interface AdvisoryPlanBoundary {
  readonly contractVersion: 1;
  readonly platformCode: 'kemerbet';
  readonly advisoryOnly: true;
  readonly transportMode: 'deterministic_fake';
  readonly networkEnabled: false;
  readonly browserEnabled: false;
  readonly finalActionEnabled: false;
  readonly databaseEnabled: false;
  readonly retryAllowed: false;
}

export interface KemerBetDepositAttemptPlan extends AdvisoryPlanBoundary {
  readonly disposition: KemerBetDepositAttemptDisposition;
  readonly reasonCode: KemerBetDepositAttemptReasonCode;
  readonly receipt: KemerBetDepositAttemptReceipt | null;
  readonly replayed: boolean;
}

const advisoryBoundary = {
  contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
  platformCode: 'kemerbet' as const,
  advisoryOnly: true as const,
  transportMode: 'deterministic_fake' as const,
  networkEnabled: false as const,
  browserEnabled: false as const,
  finalActionEnabled: false as const,
  databaseEnabled: false as const,
  retryAllowed: false as const,
};

const attemptCandidateKeys = [
  'contractVersion',
  'executionAttemptId',
  'attemptVersion',
  'agentAccountId',
  'playerAccountId',
  'expectedAmountMinor',
  'expectedCurrencyCode',
  'observation',
  'priorReceipt',
] as const;

const attemptReceiptKeys = [
  'contractVersion',
  'platformCode',
  'advisoryOnly',
  'transportMode',
  'executionAttemptId',
  'attemptVersion',
  'agentAccountId',
  'playerAccountId',
  'expectedAmountMinor',
  'expectedCurrencyCode',
  'observation',
  'disposition',
  'reasonCode',
  'retryAllowed',
] as const;

interface ValidatedAttemptCandidate {
  readonly executionAttemptId: string;
  readonly attemptVersion: number;
  readonly agentAccountId: string;
  readonly playerAccountId: string;
  readonly expectedAmountMinor: number;
  readonly expectedCurrencyCode: 'ETB';
  readonly observation: KemerBetDepositFakeObservation;
  readonly priorReceipt: unknown | null;
}

function attemptDecision(observation: KemerBetDepositFakeObservation): {
  readonly disposition: KemerBetDepositAttemptDisposition;
  readonly reasonCode: KemerBetDepositAttemptReasonCode;
} {
  if (observation.finalActionState !== 'not_attempted') {
    return {
      disposition: 'would_require_reconciliation',
      reasonCode: 'reconciliation_required',
    };
  }

  switch (observation.scenario) {
    case 'lookup_not_found':
      return { disposition: 'would_stop_before_final_action', reasonCode: 'player_not_found' };
    case 'lookup_player_mismatch':
      return {
        disposition: 'would_stop_before_final_action',
        reasonCode: 'executor_player_mismatch',
      };
    case 'lookup_currency_mismatch':
      return {
        disposition: 'would_stop_before_final_action',
        reasonCode: 'executor_currency_mismatch',
      };
    case 'selector_unavailable_before_final_action':
      return {
        disposition: 'would_stop_before_final_action',
        reasonCode: 'executor_selector_uncertain',
      };
    case 'session_expired_before_final_action':
      return {
        disposition: 'would_stop_before_final_action',
        reasonCode: 'executor_session_uncertain',
      };
    case 'captcha_before_final_action':
      return {
        disposition: 'would_stop_before_final_action',
        reasonCode: 'executor_captcha_detected',
      };
    case 'timeout_before_final_action':
      return {
        disposition: 'would_stop_before_final_action',
        reasonCode: 'executor_timeout_before_final_action',
      };
    default:
      return {
        disposition: 'would_require_reconciliation',
        reasonCode: 'reconciliation_required',
      };
  }
}

function validatedAttemptCandidate(candidate: unknown): ValidatedAttemptCandidate | null {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, attemptCandidateKeys)
  ) {
    return null;
  }

  const contractVersion = ownDataValue(candidate, 'contractVersion');
  const executionAttemptId = ownDataValue(candidate, 'executionAttemptId');
  const attemptVersion = ownDataValue(candidate, 'attemptVersion');
  const agentAccountId = ownDataValue(candidate, 'agentAccountId');
  const playerAccountId = ownDataValue(candidate, 'playerAccountId');
  const expectedAmountMinor = ownDataValue(candidate, 'expectedAmountMinor');
  const expectedCurrencyCode = ownDataValue(candidate, 'expectedCurrencyCode');
  const observation = validatedObservation(ownDataValue(candidate, 'observation'));
  const priorReceipt = ownDataValue(candidate, 'priorReceipt');

  if (
    contractVersion !== KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION ||
    !isInternalUuid(executionAttemptId) ||
    !isPositiveSafeInteger(attemptVersion) ||
    !isInternalUuid(agentAccountId) ||
    !isInternalUuid(playerAccountId) ||
    !isPolicyAmountMinor(expectedAmountMinor) ||
    expectedCurrencyCode !== 'ETB' ||
    observation === null
  ) {
    return null;
  }

  return {
    executionAttemptId,
    attemptVersion,
    agentAccountId,
    playerAccountId,
    expectedAmountMinor,
    expectedCurrencyCode,
    observation,
    priorReceipt,
  };
}

function makeAttemptReceipt(
  candidate: ValidatedAttemptCandidate,
  disposition: KemerBetDepositAttemptDisposition,
  reasonCode: KemerBetDepositAttemptReasonCode,
): KemerBetDepositAttemptReceipt {
  return deepFreeze({
    contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    advisoryOnly: true as const,
    transportMode: 'deterministic_fake' as const,
    executionAttemptId: candidate.executionAttemptId,
    attemptVersion: candidate.attemptVersion,
    agentAccountId: candidate.agentAccountId,
    playerAccountId: candidate.playerAccountId,
    expectedAmountMinor: candidate.expectedAmountMinor,
    expectedCurrencyCode: candidate.expectedCurrencyCode,
    observation: candidate.observation,
    disposition,
    reasonCode,
    retryAllowed: false as const,
  });
}

function validatedAttemptReceipt(candidate: unknown): KemerBetDepositAttemptReceipt | null {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, attemptReceiptKeys)
  ) {
    return null;
  }

  const observation = validatedObservation(ownDataValue(candidate, 'observation'));
  const executionAttemptId = ownDataValue(candidate, 'executionAttemptId');
  const attemptVersion = ownDataValue(candidate, 'attemptVersion');
  const agentAccountId = ownDataValue(candidate, 'agentAccountId');
  const playerAccountId = ownDataValue(candidate, 'playerAccountId');
  const expectedAmountMinor = ownDataValue(candidate, 'expectedAmountMinor');
  const expectedCurrencyCode = ownDataValue(candidate, 'expectedCurrencyCode');
  if (
    ownDataValue(candidate, 'contractVersion') !== KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION ||
    ownDataValue(candidate, 'platformCode') !== 'kemerbet' ||
    ownDataValue(candidate, 'advisoryOnly') !== true ||
    ownDataValue(candidate, 'transportMode') !== 'deterministic_fake' ||
    !isInternalUuid(executionAttemptId) ||
    !isPositiveSafeInteger(attemptVersion) ||
    !isInternalUuid(agentAccountId) ||
    !isInternalUuid(playerAccountId) ||
    !isPolicyAmountMinor(expectedAmountMinor) ||
    expectedCurrencyCode !== 'ETB' ||
    observation === null ||
    ownDataValue(candidate, 'retryAllowed') !== false
  ) {
    return null;
  }

  const expectedDecision = attemptDecision(observation);
  if (
    ownDataValue(candidate, 'disposition') !== expectedDecision.disposition ||
    ownDataValue(candidate, 'reasonCode') !== expectedDecision.reasonCode
  ) {
    return null;
  }

  return makeAttemptReceipt(
    {
      executionAttemptId,
      attemptVersion,
      agentAccountId,
      playerAccountId,
      expectedAmountMinor,
      expectedCurrencyCode,
      observation,
      priorReceipt: null,
    },
    expectedDecision.disposition,
    expectedDecision.reasonCode,
  );
}

function attemptReceiptsEqual(
  left: KemerBetDepositAttemptReceipt,
  right: KemerBetDepositAttemptReceipt,
): boolean {
  return (
    left.contractVersion === right.contractVersion &&
    left.platformCode === right.platformCode &&
    left.advisoryOnly === right.advisoryOnly &&
    left.transportMode === right.transportMode &&
    left.executionAttemptId === right.executionAttemptId &&
    left.attemptVersion === right.attemptVersion &&
    left.agentAccountId === right.agentAccountId &&
    left.playerAccountId === right.playerAccountId &&
    left.expectedAmountMinor === right.expectedAmountMinor &&
    left.expectedCurrencyCode === right.expectedCurrencyCode &&
    observationsEqual(left.observation, right.observation) &&
    left.disposition === right.disposition &&
    left.reasonCode === right.reasonCode &&
    left.retryAllowed === right.retryAllowed
  );
}

function makeAttemptPlan(
  disposition: KemerBetDepositAttemptDisposition,
  reasonCode: KemerBetDepositAttemptReasonCode,
  receipt: KemerBetDepositAttemptReceipt | null,
  replayed: boolean,
): KemerBetDepositAttemptPlan {
  return deepFreeze({
    ...advisoryBoundary,
    disposition,
    reasonCode,
    receipt,
    replayed,
  });
}

/**
 * Produces only a stop-before-action or reconciliation requirement. Even an immediate fake
 * success remains provisional and can never become an execution-completed action result here.
 */
export function planKemerBetDepositAttempt(candidate: unknown): KemerBetDepositAttemptPlan {
  try {
    const validated = validatedAttemptCandidate(candidate);
    if (validated === null) {
      return makeAttemptPlan(
        'would_require_reconciliation',
        'fake_observation_invalid',
        null,
        false,
      );
    }

    const decision = attemptDecision(validated.observation);
    const receipt = makeAttemptReceipt(validated, decision.disposition, decision.reasonCode);
    if (validated.priorReceipt !== null) {
      const priorReceipt = validatedAttemptReceipt(validated.priorReceipt);
      if (priorReceipt === null || !attemptReceiptsEqual(receipt, priorReceipt)) {
        return makeAttemptPlan(
          'would_require_reconciliation',
          'execution_replay_conflict',
          null,
          false,
        );
      }
      return makeAttemptPlan(decision.disposition, decision.reasonCode, receipt, true);
    }

    return makeAttemptPlan(decision.disposition, decision.reasonCode, receipt, false);
  } catch {
    return makeAttemptPlan('would_require_reconciliation', 'fake_observation_invalid', null, false);
  }
}

export type KemerBetDepositReconciliationDisposition =
  'would_confirm_observed_execution' | 'would_continue_reconciliation' | 'would_require_review';

export type KemerBetDepositReconciliationReasonCode =
  | 'execution_observed_confirmed'
  | 'reconciliation_required'
  | 'executor_history_delayed'
  | 'executor_history_missing'
  | 'executor_history_ambiguous'
  | 'executor_history_non_approved'
  | 'executor_operation_type_mismatch'
  | 'executor_operation_type_unknown'
  | 'executor_history_outside_execution_window'
  | 'executor_history_window_unknown'
  | 'executor_player_mismatch'
  | 'executor_amount_mismatch'
  | 'executor_currency_mismatch'
  | 'executor_player_credit_mismatch'
  | 'fake_observation_invalid'
  | 'execution_replay_conflict';

export interface KemerBetDepositReconciliationCandidate {
  readonly contractVersion: 1;
  readonly attemptReceipt: unknown;
  readonly observation: unknown;
  readonly priorReceipt: unknown | null;
}

export interface KemerBetDepositReconciliationReceipt {
  readonly contractVersion: 1;
  readonly platformCode: 'kemerbet';
  readonly advisoryOnly: true;
  readonly transportMode: 'deterministic_fake';
  readonly executionAttemptId: string;
  readonly attemptVersion: number;
  readonly agentAccountId: string;
  readonly playerAccountId: string;
  readonly expectedAmountMinor: number;
  readonly expectedCurrencyCode: 'ETB';
  readonly attemptObservation: KemerBetDepositFakeObservation;
  readonly observation: KemerBetDepositFakeObservation;
  readonly disposition: KemerBetDepositReconciliationDisposition;
  readonly reasonCode: KemerBetDepositReconciliationReasonCode;
  readonly retryAllowed: false;
}

export interface KemerBetDepositReconciliationPlan extends AdvisoryPlanBoundary {
  readonly disposition: KemerBetDepositReconciliationDisposition;
  readonly reasonCode: KemerBetDepositReconciliationReasonCode;
  readonly receipt: KemerBetDepositReconciliationReceipt | null;
  readonly replayed: boolean;
}

const reconciliationCandidateKeys = [
  'contractVersion',
  'attemptReceipt',
  'observation',
  'priorReceipt',
] as const;

const reconciliationReceiptKeys = [
  'contractVersion',
  'platformCode',
  'advisoryOnly',
  'transportMode',
  'executionAttemptId',
  'attemptVersion',
  'agentAccountId',
  'playerAccountId',
  'expectedAmountMinor',
  'expectedCurrencyCode',
  'attemptObservation',
  'observation',
  'disposition',
  'reasonCode',
  'retryAllowed',
] as const;

function reconciliationDecision(observation: KemerBetDepositFakeObservation): {
  readonly disposition: KemerBetDepositReconciliationDisposition;
  readonly reasonCode: KemerBetDepositReconciliationReasonCode;
} {
  if (
    observation.historyOutcome === 'one_approved' &&
    observation.historyOperationType === 'deposit' &&
    observation.historyExecutionWindowMatch === 'within_window' &&
    observation.historyPlayerMatch === 'matched' &&
    observation.historyAmountMatch === 'matched' &&
    observation.historyCurrencyMatch === 'matched' &&
    observation.playerCreditOutcome === 'exact_credit'
  ) {
    return {
      disposition: 'would_confirm_observed_execution',
      reasonCode: 'execution_observed_confirmed',
    };
  }

  if (observation.historyOutcome === 'duplicate') {
    return {
      disposition: 'would_require_review',
      reasonCode: 'executor_history_ambiguous',
    };
  }
  if (observation.historyOutcome === 'non_approved') {
    return {
      disposition: 'would_require_review',
      reasonCode: 'executor_history_non_approved',
    };
  }
  if (observation.historyOperationType === 'non_deposit') {
    return {
      disposition: 'would_require_review',
      reasonCode: 'executor_operation_type_mismatch',
    };
  }
  if (
    observation.historyExecutionWindowMatch === 'before_window' ||
    observation.historyExecutionWindowMatch === 'after_window'
  ) {
    return {
      disposition: 'would_require_review',
      reasonCode: 'executor_history_outside_execution_window',
    };
  }
  if (observation.historyPlayerMatch === 'mismatched') {
    return { disposition: 'would_require_review', reasonCode: 'executor_player_mismatch' };
  }
  if (observation.historyAmountMatch === 'mismatched') {
    return { disposition: 'would_require_review', reasonCode: 'executor_amount_mismatch' };
  }
  if (observation.historyCurrencyMatch === 'mismatched') {
    return { disposition: 'would_require_review', reasonCode: 'executor_currency_mismatch' };
  }
  if (observation.playerCreditOutcome === 'mismatch') {
    return {
      disposition: 'would_require_review',
      reasonCode: 'executor_player_credit_mismatch',
    };
  }
  if (observation.historyOperationType === 'unknown') {
    return {
      disposition: 'would_continue_reconciliation',
      reasonCode: 'executor_operation_type_unknown',
    };
  }
  if (observation.historyExecutionWindowMatch === 'unknown') {
    return {
      disposition: 'would_continue_reconciliation',
      reasonCode: 'executor_history_window_unknown',
    };
  }
  if (observation.historyOutcome === 'delayed') {
    return {
      disposition: 'would_continue_reconciliation',
      reasonCode: 'executor_history_delayed',
    };
  }
  if (observation.historyOutcome === 'missing') {
    return {
      disposition: 'would_continue_reconciliation',
      reasonCode: 'executor_history_missing',
    };
  }

  return {
    disposition: 'would_continue_reconciliation',
    reasonCode: 'reconciliation_required',
  };
}

function makeReconciliationReceipt(
  attemptReceipt: KemerBetDepositAttemptReceipt,
  observation: KemerBetDepositFakeObservation,
  disposition: KemerBetDepositReconciliationDisposition,
  reasonCode: KemerBetDepositReconciliationReasonCode,
): KemerBetDepositReconciliationReceipt {
  return deepFreeze({
    contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    advisoryOnly: true as const,
    transportMode: 'deterministic_fake' as const,
    executionAttemptId: attemptReceipt.executionAttemptId,
    attemptVersion: attemptReceipt.attemptVersion,
    agentAccountId: attemptReceipt.agentAccountId,
    playerAccountId: attemptReceipt.playerAccountId,
    expectedAmountMinor: attemptReceipt.expectedAmountMinor,
    expectedCurrencyCode: attemptReceipt.expectedCurrencyCode,
    attemptObservation: attemptReceipt.observation,
    observation,
    disposition,
    reasonCode,
    retryAllowed: false as const,
  });
}

function validatedReconciliationReceipt(
  candidate: unknown,
): KemerBetDepositReconciliationReceipt | null {
  if (
    !isPlainNonProxyRecord(candidate) ||
    !hasExactEnumerableDataKeys(candidate, reconciliationReceiptKeys)
  ) {
    return null;
  }

  const executionAttemptId = ownDataValue(candidate, 'executionAttemptId');
  const attemptVersion = ownDataValue(candidate, 'attemptVersion');
  const agentAccountId = ownDataValue(candidate, 'agentAccountId');
  const playerAccountId = ownDataValue(candidate, 'playerAccountId');
  const expectedAmountMinor = ownDataValue(candidate, 'expectedAmountMinor');
  const expectedCurrencyCode = ownDataValue(candidate, 'expectedCurrencyCode');
  const attemptObservation = validatedObservation(ownDataValue(candidate, 'attemptObservation'));
  const observation = validatedObservation(ownDataValue(candidate, 'observation'));
  if (
    ownDataValue(candidate, 'contractVersion') !== KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION ||
    ownDataValue(candidate, 'platformCode') !== 'kemerbet' ||
    ownDataValue(candidate, 'advisoryOnly') !== true ||
    ownDataValue(candidate, 'transportMode') !== 'deterministic_fake' ||
    !isInternalUuid(executionAttemptId) ||
    !isPositiveSafeInteger(attemptVersion) ||
    !isInternalUuid(agentAccountId) ||
    !isInternalUuid(playerAccountId) ||
    !isPolicyAmountMinor(expectedAmountMinor) ||
    expectedCurrencyCode !== 'ETB' ||
    attemptObservation === null ||
    observation === null ||
    attemptDecision(attemptObservation).disposition !== 'would_require_reconciliation' ||
    attemptObservation.observedAt === null ||
    observation.observedAt === null ||
    Date.parse(observation.observedAt) < Date.parse(attemptObservation.observedAt) ||
    ownDataValue(candidate, 'retryAllowed') !== false
  ) {
    return null;
  }

  const decision = reconciliationDecision(observation);
  if (
    ownDataValue(candidate, 'disposition') !== decision.disposition ||
    ownDataValue(candidate, 'reasonCode') !== decision.reasonCode
  ) {
    return null;
  }

  const syntheticAttemptReceipt = makeAttemptReceipt(
    {
      executionAttemptId,
      attemptVersion,
      agentAccountId,
      playerAccountId,
      expectedAmountMinor,
      expectedCurrencyCode,
      observation: attemptObservation,
      priorReceipt: null,
    },
    'would_require_reconciliation',
    'reconciliation_required',
  );
  return makeReconciliationReceipt(
    syntheticAttemptReceipt,
    observation,
    decision.disposition,
    decision.reasonCode,
  );
}

function reconciliationReceiptsEqual(
  left: KemerBetDepositReconciliationReceipt,
  right: KemerBetDepositReconciliationReceipt,
): boolean {
  return (
    left.contractVersion === right.contractVersion &&
    left.platformCode === right.platformCode &&
    left.advisoryOnly === right.advisoryOnly &&
    left.transportMode === right.transportMode &&
    left.executionAttemptId === right.executionAttemptId &&
    left.attemptVersion === right.attemptVersion &&
    left.agentAccountId === right.agentAccountId &&
    left.playerAccountId === right.playerAccountId &&
    left.expectedAmountMinor === right.expectedAmountMinor &&
    left.expectedCurrencyCode === right.expectedCurrencyCode &&
    observationsEqual(left.attemptObservation, right.attemptObservation) &&
    observationsEqual(left.observation, right.observation) &&
    left.disposition === right.disposition &&
    left.reasonCode === right.reasonCode &&
    left.retryAllowed === right.retryAllowed
  );
}

function makeReconciliationPlan(
  disposition: KemerBetDepositReconciliationDisposition,
  reasonCode: KemerBetDepositReconciliationReasonCode,
  receipt: KemerBetDepositReconciliationReceipt | null,
  replayed: boolean,
): KemerBetDepositReconciliationPlan {
  return deepFreeze({ ...advisoryBoundary, disposition, reasonCode, receipt, replayed });
}

/** Confirms only one exact Approved deposit inside the bounded window plus player credit. */
export function planKemerBetDepositReconciliation(
  candidate: unknown,
): KemerBetDepositReconciliationPlan {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, reconciliationCandidateKeys) ||
      ownDataValue(candidate, 'contractVersion') !== KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION
    ) {
      return makeReconciliationPlan(
        'would_require_review',
        'fake_observation_invalid',
        null,
        false,
      );
    }

    const attemptReceipt = validatedAttemptReceipt(ownDataValue(candidate, 'attemptReceipt'));
    const observation = validatedObservation(ownDataValue(candidate, 'observation'));
    const priorReceiptCandidate = ownDataValue(candidate, 'priorReceipt');
    if (
      attemptReceipt === null ||
      attemptReceipt.disposition !== 'would_require_reconciliation' ||
      observation === null ||
      attemptReceipt.observation.observedAt === null ||
      observation.observedAt === null ||
      Date.parse(observation.observedAt) < Date.parse(attemptReceipt.observation.observedAt)
    ) {
      return makeReconciliationPlan(
        'would_require_review',
        'fake_observation_invalid',
        null,
        false,
      );
    }

    const decision = reconciliationDecision(observation);
    const receipt = makeReconciliationReceipt(
      attemptReceipt,
      observation,
      decision.disposition,
      decision.reasonCode,
    );
    if (priorReceiptCandidate !== null) {
      const priorReceipt = validatedReconciliationReceipt(priorReceiptCandidate);
      if (priorReceipt === null || !reconciliationReceiptsEqual(receipt, priorReceipt)) {
        return makeReconciliationPlan(
          'would_require_review',
          'execution_replay_conflict',
          null,
          false,
        );
      }
      return makeReconciliationPlan(decision.disposition, decision.reasonCode, receipt, true);
    }

    return makeReconciliationPlan(decision.disposition, decision.reasonCode, receipt, false);
  } catch {
    return makeReconciliationPlan('would_require_review', 'fake_observation_invalid', null, false);
  }
}

export type KemerBetDepositAgentLaneState =
  | 'available'
  | 'execution_in_progress'
  | 'execution_uncertain'
  | 'execution_reconciliation'
  | 'execution_review';

export interface KemerBetDepositAgentLaneQueueCandidate {
  readonly executionAttemptId: string;
  readonly laneSequence: number;
}

export interface KemerBetDepositAgentLaneCandidate {
  readonly contractVersion: 1;
  readonly agentAccountId: string;
  readonly laneState: KemerBetDepositAgentLaneState;
  readonly queuedAttempts: readonly KemerBetDepositAgentLaneQueueCandidate[];
}

export interface KemerBetDepositAgentLaneStep {
  readonly executionAttemptId: string;
  readonly laneSequence: number;
  readonly action: 'would_start_advisory_attempt' | 'would_wait';
  readonly retryAllowed: false;
}

export type KemerBetDepositAgentLaneDisposition =
  'would_start_first' | 'would_keep_blocked' | 'would_remain_idle' | 'invalid_lane';

export interface KemerBetDepositAgentLanePlan extends AdvisoryPlanBoundary {
  readonly directExecutionEnabled: false;
  readonly agentAccountId: string | null;
  readonly laneState: KemerBetDepositAgentLaneState | 'invalid';
  readonly disposition: KemerBetDepositAgentLaneDisposition;
  readonly steps: readonly KemerBetDepositAgentLaneStep[];
}

const laneCandidateKeys = [
  'contractVersion',
  'agentAccountId',
  'laneState',
  'queuedAttempts',
] as const;
const laneQueueCandidateKeys = ['executionAttemptId', 'laneSequence'] as const;
const laneStates = Object.freeze([
  'available',
  'execution_in_progress',
  'execution_uncertain',
  'execution_reconciliation',
  'execution_review',
] as const);

function isLaneState(value: unknown): value is KemerBetDepositAgentLaneState {
  return typeof value === 'string' && (laneStates as readonly string[]).includes(value);
}

function invalidLanePlan(): KemerBetDepositAgentLanePlan {
  return deepFreeze({
    ...advisoryBoundary,
    directExecutionEnabled: false as const,
    agentAccountId: null,
    laneState: 'invalid' as const,
    disposition: 'invalid_lane' as const,
    steps: [],
  });
}

/**
 * Orders one advisory attempt lane per internal agent account. Any active, uncertain,
 * reconciliation, or review state keeps every queued attempt blocked.
 */
export function planKemerBetDepositAgentLane(candidate: unknown): KemerBetDepositAgentLanePlan {
  try {
    if (
      !isPlainNonProxyRecord(candidate) ||
      !hasExactEnumerableDataKeys(candidate, laneCandidateKeys) ||
      ownDataValue(candidate, 'contractVersion') !== KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION
    ) {
      return invalidLanePlan();
    }

    const agentAccountId = ownDataValue(candidate, 'agentAccountId');
    const laneState = ownDataValue(candidate, 'laneState');
    const queue = ownDataValue(candidate, 'queuedAttempts');
    if (!isInternalUuid(agentAccountId) || !isLaneState(laneState) || !isExactDataArray(queue)) {
      return invalidLanePlan();
    }

    const validatedQueue: Array<{ executionAttemptId: string; laneSequence: number }> = [];
    for (let index = 0; index < queue.length; index += 1) {
      const item = arrayDataValue(queue, index);
      if (
        !isPlainNonProxyRecord(item) ||
        !hasExactEnumerableDataKeys(item, laneQueueCandidateKeys)
      ) {
        return invalidLanePlan();
      }
      const executionAttemptId = ownDataValue(item, 'executionAttemptId');
      const laneSequence = ownDataValue(item, 'laneSequence');
      if (!isInternalUuid(executionAttemptId) || !isPositiveSafeInteger(laneSequence)) {
        return invalidLanePlan();
      }
      validatedQueue.push({ executionAttemptId, laneSequence });
    }

    validatedQueue.sort((left, right) => left.laneSequence - right.laneSequence);
    if (
      new Set(validatedQueue.map((item) => item.executionAttemptId)).size !==
        validatedQueue.length ||
      validatedQueue.some((item, index) => item.laneSequence !== index + 1)
    ) {
      return invalidLanePlan();
    }

    const isAvailable = laneState === 'available';
    const steps = validatedQueue.map((item, index): KemerBetDepositAgentLaneStep =>
      deepFreeze({
        executionAttemptId: item.executionAttemptId,
        laneSequence: item.laneSequence,
        action:
          isAvailable && index === 0
            ? ('would_start_advisory_attempt' as const)
            : ('would_wait' as const),
        retryAllowed: false as const,
      }),
    );
    const disposition: KemerBetDepositAgentLaneDisposition =
      steps.length === 0
        ? 'would_remain_idle'
        : isAvailable
          ? 'would_start_first'
          : 'would_keep_blocked';

    return deepFreeze({
      ...advisoryBoundary,
      directExecutionEnabled: false as const,
      agentAccountId,
      laneState,
      disposition,
      steps,
    });
  } catch {
    return invalidLanePlan();
  }
}

export interface KemerBetDepositObservationLogProjection {
  readonly contractVersion: 1;
  readonly platformCode: 'kemerbet';
  readonly source: 'deterministic_fake';
  readonly fixtureVersion: 'kemerbet-deposit-fake-v1';
  readonly scenario: KemerBetDepositFakeScenario | 'invalid_candidate';
  readonly retryAllowed: false;
}

export interface KemerBetDepositAdvisoryLogProjection {
  readonly contractVersion: 1;
  readonly platformCode: 'kemerbet';
  readonly advisoryOnly: true;
  readonly transportMode: 'deterministic_fake';
  readonly disposition:
    | KemerBetDepositAttemptDisposition
    | KemerBetDepositReconciliationDisposition
    | KemerBetDepositAgentLaneDisposition
    | 'invalid_projection_candidate';
  readonly reasonCode:
    | KemerBetDepositAttemptReasonCode
    | KemerBetDepositReconciliationReasonCode
    | 'lane_available'
    | 'lane_blocked'
    | 'lane_idle'
    | 'invalid_projection_candidate';
  readonly queueLength: number | null;
  readonly retryAllowed: false;
}

/** Projects only closed, non-identifying fake-observation fields. */
export function projectKemerBetDepositObservationLog(
  candidate: unknown,
): KemerBetDepositObservationLogProjection {
  try {
    const observation = validatedObservation(candidate);
    return deepFreeze({
      contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
      platformCode: 'kemerbet' as const,
      source: 'deterministic_fake' as const,
      fixtureVersion: KEMERBET_DEPOSIT_FAKE_FIXTURE_VERSION,
      scenario: observation?.scenario ?? ('invalid_candidate' as const),
      retryAllowed: false as const,
    });
  } catch {
    return deepFreeze({
      contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
      platformCode: 'kemerbet' as const,
      source: 'deterministic_fake' as const,
      fixtureVersion: KEMERBET_DEPOSIT_FAKE_FIXTURE_VERSION,
      scenario: 'invalid_candidate' as const,
      retryAllowed: false as const,
    });
  }
}

function invalidAdvisoryLog(): KemerBetDepositAdvisoryLogProjection {
  return deepFreeze({
    contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    advisoryOnly: true as const,
    transportMode: 'deterministic_fake' as const,
    disposition: 'invalid_projection_candidate' as const,
    reasonCode: 'invalid_projection_candidate' as const,
    queueLength: null,
    retryAllowed: false as const,
  });
}

/** Projects an exact attempt receipt without identifiers, amounts, timestamps, or observations. */
export function projectKemerBetDepositAttemptLog(
  candidate: unknown,
): KemerBetDepositAdvisoryLogProjection {
  try {
    const receipt = validatedAttemptReceipt(candidate);
    return receipt === null
      ? invalidAdvisoryLog()
      : deepFreeze({
          contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
          platformCode: 'kemerbet' as const,
          advisoryOnly: true as const,
          transportMode: 'deterministic_fake' as const,
          disposition: receipt.disposition,
          reasonCode: receipt.reasonCode,
          queueLength: null,
          retryAllowed: false as const,
        });
  } catch {
    return invalidAdvisoryLog();
  }
}

/** Projects an exact reconciliation receipt without identifying or financial fields. */
export function projectKemerBetDepositReconciliationLog(
  candidate: unknown,
): KemerBetDepositAdvisoryLogProjection {
  try {
    const receipt = validatedReconciliationReceipt(candidate);
    return receipt === null
      ? invalidAdvisoryLog()
      : deepFreeze({
          contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
          platformCode: 'kemerbet' as const,
          advisoryOnly: true as const,
          transportMode: 'deterministic_fake' as const,
          disposition: receipt.disposition,
          reasonCode: receipt.reasonCode,
          queueLength: null,
          retryAllowed: false as const,
        });
  } catch {
    return invalidAdvisoryLog();
  }
}

/** Plans the lane first, then emits only its closed disposition and queue size. */
export function projectKemerBetDepositAgentLaneLog(
  candidate: unknown,
): KemerBetDepositAdvisoryLogProjection {
  const plan = planKemerBetDepositAgentLane(candidate);
  const reasonCode =
    plan.disposition === 'would_start_first'
      ? ('lane_available' as const)
      : plan.disposition === 'would_keep_blocked'
        ? ('lane_blocked' as const)
        : plan.disposition === 'would_remain_idle'
          ? ('lane_idle' as const)
          : ('invalid_projection_candidate' as const);
  return deepFreeze({
    contractVersion: KEMERBET_DEPOSIT_EXECUTION_CONTRACT_VERSION,
    platformCode: 'kemerbet' as const,
    advisoryOnly: true as const,
    transportMode: 'deterministic_fake' as const,
    disposition:
      plan.disposition === 'invalid_lane'
        ? ('invalid_projection_candidate' as const)
        : plan.disposition,
    reasonCode,
    queueLength: plan.disposition === 'invalid_lane' ? null : plan.steps.length,
    retryAllowed: false as const,
  });
}
