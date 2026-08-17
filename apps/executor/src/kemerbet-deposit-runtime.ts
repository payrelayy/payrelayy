import type { KemerBetDepositBrowser } from './kemerbet-deposit-browser-adapter.js';
import type {
  KemerBetDepositCancelReason,
  KemerBetDepositExecutionDatabase,
  KemerBetDepositExecutionLease,
  KemerBetDepositPageObservation,
  KemerBetDepositPreparedPage,
  KemerBetDepositReconciliationLease,
  KemerBetDepositRedactedLog,
} from './kemerbet-deposit-types.js';

export interface KemerBetDepositRuntimeDependencies {
  readonly database: KemerBetDepositExecutionDatabase;
  readonly browserForAgentAccount: (
    platformAgentAccountId: string,
  ) => Promise<KemerBetDepositBrowser | null>;
  readonly workerInstanceId: string;
  readonly leaseSeconds: number;
  readonly finalActionEnabled: boolean;
  readonly now: () => Date;
  readonly log: (event: KemerBetDepositRunResult) => void;
}

export interface KemerBetDepositRecoveryCircuitOpenResult {
  readonly component: 'kemerbet_deposit_executor';
  readonly event: 'recovery_circuit_open';
  readonly phase: 'prepare';
  readonly actionRetryAllowed: false;
  readonly financialDetailsRedacted: true;
  readonly workerDisposition: 'pause';
}

export type KemerBetDepositRunResult =
  KemerBetDepositRedactedLog | KemerBetDepositRecoveryCircuitOpenResult;

export class KemerBetDepositRuntimeBusyError extends Error {
  constructor() {
    super('The KemerBet deposit executor already has an active browser workflow.');
    this.name = 'KemerBetDepositRuntimeBusyError';
  }
}

function redacted(
  event: KemerBetDepositRedactedLog['event'],
  phase: KemerBetDepositRedactedLog['phase'],
): KemerBetDepositRedactedLog {
  return Object.freeze({
    component: 'kemerbet_deposit_executor' as const,
    event,
    phase,
    actionRetryAllowed: false as const,
    financialDetailsRedacted: true as const,
  });
}

function recoveryCircuitOpen(): KemerBetDepositRecoveryCircuitOpenResult {
  return Object.freeze({
    component: 'kemerbet_deposit_executor' as const,
    event: 'recovery_circuit_open' as const,
    phase: 'prepare' as const,
    actionRetryAllowed: false as const,
    financialDetailsRedacted: true as const,
    workerDisposition: 'pause' as const,
  });
}

function leaseExpired(
  lease: KemerBetDepositExecutionLease | KemerBetDepositReconciliationLease,
  now: Date,
): boolean {
  return lease.leaseExpiresAt.getTime() <= now.getTime();
}

async function cancelBeforeFence(
  dependencies: KemerBetDepositRuntimeDependencies,
  lease: KemerBetDepositExecutionLease,
  reasonCode: KemerBetDepositCancelReason,
): Promise<KemerBetDepositRunResult> {
  await dependencies.database.cancelBeforeAction(lease, reasonCode);
  const result = redacted('cancelled_before_action', 'prepare');
  dependencies.log(result);
  return result;
}

async function reconcileWithoutActionRetry(
  dependencies: KemerBetDepositRuntimeDependencies,
  lease: KemerBetDepositReconciliationLease,
): Promise<KemerBetDepositRunResult> {
  if (leaseExpired(lease, dependencies.now())) {
    const result = redacted('reconciliation_follow_up', 'reconcile');
    dependencies.log(result);
    return result;
  }

  let observation: KemerBetDepositPageObservation;
  try {
    const browser = await dependencies.browserForAgentAccount(lease.platformAgentAccountId);
    if (browser?.platformAgentAccountId !== lease.platformAgentAccountId) {
      throw new Error('The exact agent session is unavailable.');
    }
    observation = await browser.reconcile(lease);
  } catch {
    observation = {
      observation: 'not_observed',
      evidence: null,
      reasonCode: 'history_unavailable',
    };
  }

  const recorded = await dependencies.database.recordReconciliation(lease, observation);
  if (
    recorded.outcome === 'confirmed_executed' &&
    recorded.attemptStatus === 'confirmed_executed' &&
    recorded.depositStatus === 'executed'
  ) {
    const result = redacted('completed', 'reconcile');
    dependencies.log(result);
    return result;
  }
  if (
    recorded.outcome === 'not_observed' &&
    recorded.attemptStatus === 'reconciliation_required' &&
    recorded.depositStatus === 'execution_reconciliation' &&
    recorded.followUpJobId !== null
  ) {
    const result = redacted('reconciliation_follow_up', 'reconcile');
    dependencies.log(result);
    return result;
  }

  const result = redacted('needs_attention', 'reconcile');
  dependencies.log(result);
  return result;
}

async function executeOnceAfterFreshPreparation(
  dependencies: KemerBetDepositRuntimeDependencies,
  lease: KemerBetDepositExecutionLease,
): Promise<KemerBetDepositRunResult> {
  if (leaseExpired(lease, dependencies.now())) {
    return cancelBeforeFence(dependencies, lease, 'execution_lease_expired_before_action');
  }
  if (!dependencies.finalActionEnabled) {
    return cancelBeforeFence(dependencies, lease, 'operator_stopped_before_action');
  }

  let browser: KemerBetDepositBrowser;
  try {
    const selected = await dependencies.browserForAgentAccount(lease.platformAgentAccountId);
    if (selected?.platformAgentAccountId !== lease.platformAgentAccountId) {
      return cancelBeforeFence(dependencies, lease, 'agent_unavailable_before_action');
    }
    browser = selected;
  } catch {
    return cancelBeforeFence(dependencies, lease, 'agent_unavailable_before_action');
  }

  let prepared: KemerBetDepositPreparedPage;
  try {
    // Preparation is deliberately local and short-lived: reopen the exact route, repeat lookup,
    // verify ETB, and read back the immutable leased target immediately before the durable fence.
    // No earlier tab state is trusted.
    prepared = await browser.prepare(lease);
  } catch {
    return cancelBeforeFence(dependencies, lease, 'preparation_failed');
  }

  const preparedAgeMilliseconds = dependencies.now().getTime() - prepared.preparedAt.getTime();
  if (
    prepared.exactPlayerMatch !== true ||
    prepared.exactCurrencyMatch !== true ||
    prepared.amountFilledMinor !== lease.target.amountMinor ||
    !Number.isFinite(preparedAgeMilliseconds) ||
    preparedAgeMilliseconds < 0 ||
    preparedAgeMilliseconds > 5_000
  ) {
    return cancelBeforeFence(dependencies, lease, 'preparation_failed');
  }

  const preparedLog = redacted('prepared_before_action', 'prepare');
  dependencies.log(preparedLog);
  if (leaseExpired(lease, dependencies.now())) {
    return cancelBeforeFence(dependencies, lease, 'execution_lease_expired_before_action');
  }

  const fence = await dependencies.database.fenceFinalAction(lease);
  const fencedLog = redacted('final_action_fenced', 'execute');
  dependencies.log(fencedLog);

  let exactPlayerCreditMatch = false;
  if (fence.firstFenceAcquired) {
    try {
      const immediate = await browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: fence.finalActionFencedAt,
      });
      exactPlayerCreditMatch = immediate.exactPlayerCreditMatch;
    } catch {
      // A throw cannot distinguish before-click, in-flight, or response-loss. The durable fence
      // makes every later execution click illegal; only evidence reconciliation may continue.
    }
  }

  try {
    await dependencies.database.requireReconciliation(lease, exactPlayerCreditMatch);
    const result = redacted('reconciliation_required', 'execute');
    dependencies.log(result);
    return result;
  } catch {
    // A crash or database outage after the fence cannot authorize another click. Reconciliation
    // leasing discovers the fenced attempt after the server-authored recovery handoff.
    return fencedLog;
  }
}

export function createKemerBetDepositRuntime(dependencies: KemerBetDepositRuntimeDependencies): {
  runOnce(): Promise<KemerBetDepositRunResult>;
} {
  let running = false;
  return {
    async runOnce() {
      if (running) throw new KemerBetDepositRuntimeBusyError();
      running = true;
      try {
        // Reconciliation has priority so an uncertain fenced attempt keeps its agent lane blocked
        // until exact evidence resolves it.
        const reconciliationLease = await dependencies.database.leaseNextReconciliation(
          dependencies.workerInstanceId,
          dependencies.leaseSeconds,
        );
        if (reconciliationLease !== null) {
          const requiredLog = redacted('reconciliation_required', 'reconcile');
          dependencies.log(requiredLog);
          return await reconcileWithoutActionRetry(dependencies, reconciliationLease);
        }

        const executionLeaseResult = await dependencies.database.leaseNextExecution(
          dependencies.workerInstanceId,
          dependencies.leaseSeconds,
        );
        if (executionLeaseResult === null) {
          const result = redacted('idle', 'none');
          dependencies.log(result);
          return result;
        }
        if (executionLeaseResult.disposition === 'recovered_expired_prepared') {
          const result = recoveryCircuitOpen();
          dependencies.log(result);
          return result;
        }

        return await executeOnceAfterFreshPreparation(dependencies, executionLeaseResult);
      } finally {
        running = false;
      }
    },
  };
}
