import { DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';

import {
  createKemerBetDepositBrowser,
  type KemerBetBrowserPage,
  type KemerBetDepositBrowser,
} from './kemerbet-deposit-browser-adapter.js';
import type {
  KemerBetDepositCancelReason,
  KemerBetDepositExecutionDatabase,
  KemerBetDepositExecutionLease,
  KemerBetDepositPageObservation,
  KemerBetDepositReconciliationLease,
} from './kemerbet-deposit-types.js';

const DEPOSIT_INTENT_ID = '22222222-2222-4222-8222-222222222221';
const EXECUTION_JOB_ID = '22222222-2222-4222-8222-222222222222';
const EXECUTION_ATTEMPT_ID = '22222222-2222-4222-8222-222222222223';
const AGENT_ACCOUNT_ID = '22222222-2222-4222-8222-222222222224';
const EXECUTION_LEASE_TOKEN = '22222222-2222-4222-8222-222222222225';
const RECONCILIATION_JOB_ID = '22222222-2222-4222-8222-222222222226';
const RECONCILIATION_LEASE_TOKEN = '22222222-2222-4222-8222-222222222227';
const RECONCILIATION_ID = '22222222-2222-4222-8222-222222222228';
const FOLLOW_UP_JOB_ID = '22222222-2222-4222-8222-222222222229';
const PLAYER_ID = 'PLAYER-ALPHA';

export interface DeterministicKemerBetDepositOptions {
  readonly amountMinor?: number;
  readonly duplicateApprovedHistory?: boolean;
  readonly emptyExternalReference?: boolean;
  readonly failPreparation?: boolean;
  readonly loseTransferResponse?: boolean;
  readonly mismatchedPreparedAmount?: boolean;
  readonly recoveredExpiredPrepared?: boolean;
  readonly requireReconciliationFails?: boolean;
  readonly wrongPaymentMethod?: boolean;
}

interface HistoryRow {
  stateLabel: string;
  operationLabel: string;
  paymentMethod: string;
  playerId: string;
  amountText: string;
  currencyCode: string;
  occurredAt: string;
  externalReference: string;
}

interface World {
  now: Date;
  transferClicks: number;
  fenceCalls: number;
  executionLeaseCalls: number;
  cancelled: boolean;
  fenced: boolean;
  reconciliationRequired: boolean;
  finalActionFencedAt: Date | null;
  reconciliationRequiredAt: Date | null;
  exactPlayerCreditMatch: boolean | null;
  history: HistoryRow[];
}

function executionLease(world: World, amountMinor: number): KemerBetDepositExecutionLease {
  return {
    disposition: 'execution',
    phase: 'execute',
    depositIntentId: DEPOSIT_INTENT_ID,
    executionJobId: EXECUTION_JOB_ID,
    executionAttemptId: EXECUTION_ATTEMPT_ID,
    platformAgentAccountId: AGENT_ACCOUNT_ID,
    target: { operation: 'deposit', playerId: PLAYER_ID, amountMinor, currencyCode: 'ETB' },
    leaseToken: EXECUTION_LEASE_TOKEN,
    leaseExpiresAt: new Date(world.now.getTime() + 300_000),
  };
}

function reconciliationLease(
  world: World,
  amountMinor: number,
): KemerBetDepositReconciliationLease {
  return {
    phase: 'reconcile',
    depositIntentId: DEPOSIT_INTENT_ID,
    reconciliationJobId: RECONCILIATION_JOB_ID,
    executionAttemptId: EXECUTION_ATTEMPT_ID,
    platformAgentAccountId: AGENT_ACCOUNT_ID,
    target: { operation: 'deposit', playerId: PLAYER_ID, amountMinor, currencyCode: 'ETB' },
    leaseToken: RECONCILIATION_LEASE_TOKEN,
    leaseExpiresAt: new Date(world.now.getTime() + 300_000),
    recovery: {
      finalActionFencedAt: new Date(world.finalActionFencedAt!),
      reconciliationRequiredAt: new Date(world.reconciliationRequiredAt!),
      exactPlayerCreditMatch: world.exactPlayerCreditMatch,
    },
  };
}

export class DeterministicKemerBetDepositDatabase implements KemerBetDepositExecutionDatabase {
  readonly #world: World;
  readonly #amountMinor: number;
  readonly #recoveredExpiredPrepared: boolean;
  #requireFailureAvailable: boolean;
  #reconciliationCount = 0;

  constructor(world: World, options: DeterministicKemerBetDepositOptions) {
    this.#world = world;
    this.#amountMinor = options.amountMinor ?? DEPOSIT_MINIMUM_MINOR;
    this.#recoveredExpiredPrepared = options.recoveredExpiredPrepared === true;
    this.#requireFailureAvailable = options.requireReconciliationFails === true;
  }

  async leaseNextExecution() {
    this.#world.executionLeaseCalls += 1;
    if (this.#recoveredExpiredPrepared) {
      return {
        disposition: 'recovered_expired_prepared' as const,
        depositIntentId: DEPOSIT_INTENT_ID,
        executionAttemptId: EXECUTION_ATTEMPT_ID,
      };
    }
    return this.#world.fenced || this.#world.cancelled
      ? null
      : executionLease(this.#world, this.#amountMinor);
  }

  async cancelBeforeAction(
    lease: KemerBetDepositExecutionLease,
    _reasonCode: KemerBetDepositCancelReason,
  ) {
    this.#requireExecutionLease(lease);
    if (this.#world.fenced) throw new Error('post-fence cancellation forbidden');
    this.#world.cancelled = true;
    return {
      depositIntentId: DEPOSIT_INTENT_ID,
      executionJobId: EXECUTION_JOB_ID,
      executionAttemptId: EXECUTION_ATTEMPT_ID,
      attemptStatus: 'cancelled_before_action' as const,
      depositStatus: 'execution_review' as const,
      cancelledAt: new Date(this.#world.now),
    };
  }

  async fenceFinalAction(lease: KemerBetDepositExecutionLease) {
    this.#requireExecutionLease(lease);
    this.#world.fenceCalls += 1;
    const firstFenceAcquired = !this.#world.fenced;
    if (firstFenceAcquired) {
      this.#world.fenced = true;
      this.#world.finalActionFencedAt = new Date(this.#world.now);
    }
    return {
      depositIntentId: DEPOSIT_INTENT_ID,
      executionAttemptId: EXECUTION_ATTEMPT_ID,
      finalActionFencedAt: new Date(this.#world.finalActionFencedAt!),
      firstFenceAcquired,
    };
  }

  async requireReconciliation(
    lease: KemerBetDepositExecutionLease,
    exactPlayerCreditMatch: boolean,
  ) {
    this.#requireExecutionLease(lease);
    if (!this.#world.fenced) throw new Error('reconciliation cannot be required');
    if (this.#requireFailureAvailable) {
      this.#requireFailureAvailable = false;
      throw new Error('simulated post-fence database loss');
    }
    this.#world.reconciliationRequired = true;
    this.#world.reconciliationRequiredAt = new Date(this.#world.now);
    this.#world.exactPlayerCreditMatch = exactPlayerCreditMatch;
    return {
      depositIntentId: DEPOSIT_INTENT_ID,
      executionAttemptId: EXECUTION_ATTEMPT_ID,
      reconciliationJobId: RECONCILIATION_JOB_ID,
      attemptStatus: 'reconciliation_required' as const,
      depositStatus: 'execution_reconciliation' as const,
      recoveryHandoff: false,
    };
  }

  async leaseNextReconciliation() {
    const recoveryEligible =
      this.#world.fenced &&
      this.#world.finalActionFencedAt !== null &&
      this.#world.now.getTime() >= this.#world.finalActionFencedAt.getTime() + 10_000;
    if (!this.#world.reconciliationRequired && recoveryEligible) {
      this.#world.reconciliationRequired = true;
      this.#world.reconciliationRequiredAt = new Date(this.#world.now);
      this.#world.exactPlayerCreditMatch = null;
    }
    return this.#world.reconciliationRequired
      ? reconciliationLease(this.#world, this.#amountMinor)
      : null;
  }

  async recordReconciliation(
    lease: KemerBetDepositReconciliationLease,
    observation: KemerBetDepositPageObservation,
  ) {
    if (lease.reconciliationJobId !== RECONCILIATION_JOB_ID) throw new Error('unexpected lease');
    this.#reconciliationCount += 1;
    this.#world.reconciliationRequired = false;
    if (observation.observation === 'confirmed_executed') {
      return {
        depositIntentId: DEPOSIT_INTENT_ID,
        reconciliationJobId: RECONCILIATION_JOB_ID,
        executionAttemptId: EXECUTION_ATTEMPT_ID,
        reconciliationId: RECONCILIATION_ID,
        outcome: 'confirmed_executed' as const,
        reasonCode: 'agent_deposit_history_in_window_and_player_credit_confirmed' as const,
        attemptStatus: 'confirmed_executed' as const,
        depositStatus: 'executed' as const,
        followUpJobId: null,
      };
    }
    if (observation.observation === 'not_observed' && this.#reconciliationCount < 6) {
      return {
        depositIntentId: DEPOSIT_INTENT_ID,
        reconciliationJobId: RECONCILIATION_JOB_ID,
        executionAttemptId: EXECUTION_ATTEMPT_ID,
        reconciliationId: RECONCILIATION_ID,
        outcome: 'not_observed' as const,
        reasonCode: 'agent_history_not_observed' as const,
        attemptStatus: 'reconciliation_required' as const,
        depositStatus: 'execution_reconciliation' as const,
        followUpJobId: FOLLOW_UP_JOB_ID,
      };
    }
    return {
      depositIntentId: DEPOSIT_INTENT_ID,
      reconciliationJobId: RECONCILIATION_JOB_ID,
      executionAttemptId: EXECUTION_ATTEMPT_ID,
      reconciliationId: RECONCILIATION_ID,
      outcome: 'ambiguous' as const,
      reasonCode: 'agent_history_ambiguous' as const,
      attemptStatus: 'review_required' as const,
      depositStatus: 'execution_review' as const,
      followUpJobId: null,
    };
  }

  #requireExecutionLease(lease: KemerBetDepositExecutionLease) {
    if (
      lease.depositIntentId !== DEPOSIT_INTENT_ID ||
      lease.executionAttemptId !== EXECUTION_ATTEMPT_ID ||
      lease.leaseToken !== EXECUTION_LEASE_TOKEN
    ) {
      throw new Error('unexpected lease');
    }
  }
}

class DeterministicPage implements KemerBetBrowserPage {
  readonly sessionKey = 'agent-session';
  readonly #world: World;
  readonly #options: DeterministicKemerBetDepositOptions;
  readonly #amountMinor: number;
  #url = 'about:blank';
  #filledAmount = '';

  constructor(world: World, options: DeterministicKemerBetDepositOptions) {
    this.#world = world;
    this.#options = options;
    this.#amountMinor = options.amountMinor ?? DEPOSIT_MINIMUM_MINOR;
  }

  async goto(url: string) {
    if (this.#options.failPreparation && url.includes('/requests')) {
      throw new Error('simulated unavailable session');
    }
    this.#url = url;
  }

  async currentUrl() {
    return this.#url;
  }

  async clickByRole(_role: 'button' | 'link' | 'tab', name: string) {
    if (name !== 'Transfer') return;
    if (this.#filledAmount !== (this.#amountMinor / 100).toFixed(2)) {
      throw new Error('amount was not filled from the immutable target');
    }
    this.#world.transferClicks += 1;
    const row: HistoryRow = {
      stateLabel: 'Approved',
      operationLabel: 'Player Epos Deposit',
      paymentMethod: this.#options.wrongPaymentMethod ? 'OTHER' : 'EPOS',
      playerId: PLAYER_ID,
      amountText: `${(this.#amountMinor / 100).toFixed(2)} ETB`,
      currencyCode: 'ETB',
      occurredAt: this.#world.now.toISOString(),
      externalReference: this.#options.emptyExternalReference
        ? ''
        : `fake-reference-${this.#world.transferClicks}`,
    };
    this.#world.history.push(row);
    if (this.#options.duplicateApprovedHistory) this.#world.history.push({ ...row });
    if (this.#options.loseTransferResponse) throw new Error('simulated response loss');
  }

  async fillByLabel(label: string, value: string) {
    if (label === 'Amount') this.#filledAmount = value;
  }

  async selectByLabel() {}

  async readAgentLookup() {
    return { playerId: PLAYER_ID, currencyCode: 'ETB' };
  }

  async readAgentPreparedDeposit() {
    return {
      playerId: PLAYER_ID,
      amountText: this.#options.mismatchedPreparedAmount ? '99.99 ETB' : this.#filledAmount,
      currencyCode: 'ETB',
    };
  }

  async readAgentTransferResult() {
    return {
      playerId: PLAYER_ID,
      creditEvidenceText: `Player Balance +${(this.#amountMinor / 100).toFixed(2)} ETB Success`,
    };
  }

  async readAgentHistory() {
    return this.#world.history;
  }
}

export interface DeterministicKemerBetDepositFixture {
  readonly database: DeterministicKemerBetDepositDatabase;
  readonly browser: KemerBetDepositBrowser;
  freshBrowser(): KemerBetDepositBrowser;
  now(): Date;
  advance(milliseconds: number): void;
  readonly stats: {
    readonly amountMinor: number;
    readonly transferClicks: number;
    readonly fenceCalls: number;
    readonly executionLeaseCalls: number;
    readonly cancelled: boolean;
  };
}

export function createDeterministicKemerBetDepositFixture(
  options: DeterministicKemerBetDepositOptions = {},
): DeterministicKemerBetDepositFixture {
  const amountMinor = options.amountMinor ?? DEPOSIT_MINIMUM_MINOR;
  const world: World = {
    now: new Date('2030-01-02T03:04:05.000Z'),
    transferClicks: 0,
    fenceCalls: 0,
    executionLeaseCalls: 0,
    cancelled: false,
    fenced: false,
    reconciliationRequired: false,
    finalActionFencedAt: null,
    reconciliationRequiredAt: null,
    exactPlayerCreditMatch: null,
    history: [],
  };
  const database = new DeterministicKemerBetDepositDatabase(world, options);
  const freshBrowser = () =>
    createKemerBetDepositBrowser({
      platformAgentAccountId: AGENT_ACCOUNT_ID,
      agentPage: new DeterministicPage(world, options),
      routes: {
        agentDepositUrl: 'https://agentsystem.admindigi.com/payments/requests',
        agentHistoryUrl: 'https://agentsystem.admindigi.com/payments/history',
      },
      now: () => new Date(world.now),
      fingerprintExternalReference: () => `hmac-sha256-v1:${'a'.repeat(64)}`,
    });
  return {
    database,
    browser: freshBrowser(),
    freshBrowser,
    now: () => new Date(world.now),
    advance: (milliseconds) => {
      world.now = new Date(world.now.getTime() + milliseconds);
    },
    get stats() {
      return {
        amountMinor,
        transferClicks: world.transferClicks,
        fenceCalls: world.fenceCalls,
        executionLeaseCalls: world.executionLeaseCalls,
        cancelled: world.cancelled,
      };
    },
  };
}

export const deterministicKemerBetDepositIds = {
  depositIntentId: DEPOSIT_INTENT_ID,
  platformAgentAccountId: AGENT_ACCOUNT_ID,
  workerInstanceId: '22222222-2222-4222-8222-222222222230',
} as const;
