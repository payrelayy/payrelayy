import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  createDeterministicKemerBetDepositFixture,
  deterministicKemerBetDepositIds,
  deterministicKemerBetPrivateLiveDepositPilotManifest,
} from './deterministic-kemerbet-deposit-fixture.js';
import {
  createKemerBetDepositRuntime,
  KemerBetDepositRuntimeBusyError,
  type KemerBetDepositRunResult,
} from './kemerbet-deposit-runtime.js';

function runtime(
  fixture: ReturnType<typeof createDeterministicKemerBetDepositFixture>,
  browser = fixture.browser,
  finalActionEnabled = true,
  monotonicNow?: () => number,
) {
  const logs: KemerBetDepositRunResult[] = [];
  return {
    logs,
    runtime: createKemerBetDepositRuntime({
      database: fixture.database,
      browserForAgentAccount: async () => browser,
      workerInstanceId: deterministicKemerBetDepositIds.workerInstanceId,
      leaseSeconds: 300,
      finalActionEnabled,
      privateLiveDepositPilotManifest: deterministicKemerBetPrivateLiveDepositPilotManifest,
      now: fixture.now,
      ...(monotonicNow === undefined ? {} : { monotonicNow }),
      log: (event) => logs.push(event),
    }),
  };
}

describe('KemerBet deposit execution runtime', () => {
  it('circuit-opens an expired-prepared recovery sentinel without another lease or browser action', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      recoveredExpiredPrepared: true,
    });
    let browserResolutions = 0;
    const logs: KemerBetDepositRunResult[] = [];
    const worker = createKemerBetDepositRuntime({
      database: fixture.database,
      browserForAgentAccount: async () => {
        browserResolutions += 1;
        return fixture.browser;
      },
      workerInstanceId: deterministicKemerBetDepositIds.workerInstanceId,
      leaseSeconds: 300,
      finalActionEnabled: true,
      privateLiveDepositPilotManifest: deterministicKemerBetPrivateLiveDepositPilotManifest,
      now: fixture.now,
      log: (event) => logs.push(event),
    });

    await expect(worker.runOnce()).resolves.toEqual({
      component: 'kemerbet_deposit_executor',
      event: 'recovery_circuit_open',
      phase: 'prepare',
      actionRetryAllowed: false,
      financialDetailsRedacted: true,
      workerDisposition: 'pause',
    });
    expect(browserResolutions).toBe(0);
    expect(fixture.stats).toMatchObject({
      executionLeaseCalls: 1,
      fenceCalls: 0,
      transferClicks: 0,
    });
    expect(logs).toHaveLength(1);
  });

  it('stops before preparation, fence, and Transfer when the final-action gate is disabled', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    const worker = runtime(fixture, fixture.browser, false);

    await expect(worker.runtime.runOnce()).resolves.toMatchObject({
      event: 'cancelled_before_action',
      phase: 'prepare',
      actionRetryAllowed: false,
    });
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 0, cancelled: true });
  });

  it('opens to attention before browser preparation when the lease lacks the configured pilot', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      mismatchedLeasePilotAuthorization: true,
    });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'needs_attention',
      phase: 'prepare',
      actionRetryAllowed: false,
    });
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 0 });
  });

  it('never clicks when the fence does not repeat the exact leased pilot authorization', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      mismatchedFencePilotAuthorization: true,
    });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'needs_attention',
      phase: 'execute',
      actionRetryAllowed: false,
    });
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1 });
  });

  it.each([10_000, 10_001, 301_000])(
    'reconciles without Transfer when the fence acknowledgement arrives after %i ms',
    async (delayMilliseconds) => {
      const fixture = createDeterministicKemerBetDepositFixture();
      const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
      vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => {
        const fenced = await fenceFinalAction(lease);
        fixture.advance(delayMilliseconds);
        return fenced;
      });
      const submit = vi.spyOn(fixture.browser, 'submitOnceAfterFence');
      const reconcile = vi.spyOn(fixture.database, 'requireReconciliation');
      const cancel = vi.spyOn(fixture.database, 'cancelBeforeAction');

      await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
        event: 'reconciliation_required',
        actionRetryAllowed: false,
      });
      expect(submit).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
      expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1 });
      await runtime(fixture, fixture.freshBrowser()).runtime.runOnce();
      expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1 });
    },
  );

  it('passes the eligible first action to the browser just before the ten-second fence deadline', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
    vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => {
      const fenced = await fenceFinalAction(lease);
      fixture.advance(9_999);
      return fenced;
    });
    const submit = vi.spyOn(fixture.browser, 'submitOnceAfterFence').mockResolvedValue({
      response: 'success_dialog_observed',
      exactPlayerCreditMatch: true,
    });

    await expect(
      runtime(fixture, fixture.browser, true, () => 0).runtime.runOnce(),
    ).resolves.toMatchObject({
      event: 'reconciliation_required',
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(fixture.stats.fenceCalls).toBe(1);
  });

  it('does not extend an original lease that expires before the ten-second fence deadline', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    const leaseNextExecution = fixture.database.leaseNextExecution.bind(fixture.database);
    vi.spyOn(fixture.database, 'leaseNextExecution').mockImplementation(async () => {
      const leased = await leaseNextExecution();
      if (leased?.disposition !== 'execution') throw new Error('fixture requires execution');
      return { ...leased, leaseExpiresAt: new Date(fixture.now().getTime() + 1_000) };
    });
    const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
    vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => {
      const fenced = await fenceFinalAction(lease);
      fixture.advance(1_000);
      return fenced;
    });
    const reconcile = vi.spyOn(fixture.database, 'requireReconciliation');
    const cancel = vi.spyOn(fixture.database, 'cancelBeforeAction');

    await runtime(fixture).runtime.runOnce();
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
    expect(cancel).not.toHaveBeenCalled();
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1 });
  });

  it.each([
    ['invalid timestamp', () => new Date(Number.NaN)],
    ['future timestamp', (now: Date) => new Date(now.getTime() + 1)],
    ['non-Date timestamp', (now: Date) => now.toISOString() as unknown as Date],
  ] as const)(
    'reconciles a fence with an %s without any browser submission',
    async (_name, timestamp) => {
      const fixture = createDeterministicKemerBetDepositFixture();
      const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
      vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => ({
        ...(await fenceFinalAction(lease)),
        finalActionFencedAt: timestamp(fixture.now()),
      }));
      const submit = vi.spyOn(fixture.browser, 'submitOnceAfterFence');
      const reconcile = vi.spyOn(fixture.database, 'requireReconciliation');

      await runtime(fixture).runtime.runOnce();
      expect(submit).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
      expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1, cancelled: false });
    },
  );

  it.each([
    'depositIntentId',
    'executionAttemptId',
    'privateLiveDepositPilotAuthorization',
  ] as const)(
    'hands off a mismatched or malformed fence %s for reconciliation without cancelling',
    async (field) => {
      const fixture = createDeterministicKemerBetDepositFixture();
      const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
      vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => ({
        ...(await fenceFinalAction(lease)),
        [field]: null,
      }));
      const reconcile = vi.spyOn(fixture.database, 'requireReconciliation');
      const cancel = vi.spyOn(fixture.database, 'cancelBeforeAction');

      await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
        event: 'needs_attention',
      });
      expect(reconcile).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
      expect(cancel).not.toHaveBeenCalled();
      expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1 });
    },
  );

  it('retains the durable fence when the stale-action reconciliation handoff fails', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      requireReconciliationFails: true,
    });
    const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
    vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => {
      const fenced = await fenceFinalAction(lease);
      fixture.advance(10_000);
      return fenced;
    });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'final_action_fenced',
      actionRetryAllowed: false,
    });
    await runtime(fixture, fixture.freshBrowser()).runtime.runOnce();
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1, cancelled: false });
  });

  it('rechecks the action deadline after waiting to acquire the browser submission lane', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    const submitOnceAfterFence = fixture.browser.submitOnceAfterFence.bind(fixture.browser);
    vi.spyOn(fixture.browser, 'submitOnceAfterFence').mockImplementation(async (lease, fence) => {
      fixture.advance(10_000);
      return submitOnceAfterFence(lease, fence);
    });
    const reconcile = vi.spyOn(fixture.database, 'requireReconciliation');

    await runtime(fixture).runtime.runOnce();
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1, cancelled: false });
  });

  it.each(['acknowledgement', 'browser lane'] as const)(
    'keeps the original monotonic deadline across the %s even if the wall clock hides elapsed time',
    async (delayedBoundary) => {
      const fixture = createDeterministicKemerBetDepositFixture();
      let monotonic = 0;
      if (delayedBoundary === 'acknowledgement') {
        const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
        vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => {
          const fenced = await fenceFinalAction(lease);
          monotonic = 10_000;
          return fenced;
        });
      } else {
        const submitOnceAfterFence = fixture.browser.submitOnceAfterFence.bind(fixture.browser);
        vi.spyOn(fixture.browser, 'submitOnceAfterFence').mockImplementation(
          async (lease, fence) => {
            monotonic = 10_000;
            return submitOnceAfterFence(lease, fence);
          },
        );
      }
      const reconcile = vi.spyOn(fixture.database, 'requireReconciliation');

      await runtime(fixture, fixture.browser, true, () => monotonic).runtime.runOnce();
      expect(reconcile).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
      expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1, cancelled: false });
    },
  );

  it('caps monotonic elapsed time by the original server lease even when its Date is mutated', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    let monotonic = 0;
    const leaseNextExecution = fixture.database.leaseNextExecution.bind(fixture.database);
    vi.spyOn(fixture.database, 'leaseNextExecution').mockImplementation(async () => {
      const leased = await leaseNextExecution();
      if (leased?.disposition !== 'execution') throw new Error('fixture requires execution');
      return { ...leased, leaseExpiresAt: new Date(fixture.now().getTime() + 100) };
    });
    const fenceFinalAction = fixture.database.fenceFinalAction.bind(fixture.database);
    vi.spyOn(fixture.database, 'fenceFinalAction').mockImplementation(async (lease) => {
      const fenced = await fenceFinalAction(lease);
      lease.leaseExpiresAt.setTime(fixture.now().getTime() + 300_000);
      monotonic = 100;
      return fenced;
    });
    const reconcile = vi.spyOn(fixture.database, 'requireReconciliation');

    await runtime(fixture, fixture.browser, true, () => monotonic).runtime.runOnce();
    expect(reconcile).toHaveBeenCalledExactlyOnceWith(expect.anything(), false);
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 1, cancelled: false });
  });

  it('uses the dynamic minimum product amount and completes only after exact reconciliation', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      amountMinor: DEPOSIT_MINIMUM_MINOR,
    });
    const executionWorker = runtime(fixture);

    await expect(executionWorker.runtime.runOnce()).resolves.toMatchObject({
      event: 'reconciliation_required',
      phase: 'execute',
    });
    expect(fixture.stats).toMatchObject({
      amountMinor: DEPOSIT_MINIMUM_MINOR,
      transferClicks: 1,
      fenceCalls: 1,
    });
    const serializedLogs = JSON.stringify(executionWorker.logs);
    expect(serializedLogs).not.toContain(String(DEPOSIT_MINIMUM_MINOR));
    expect(serializedLogs).not.toContain('22222222');
    expect(serializedLogs).not.toContain(
      deterministicKemerBetPrivateLiveDepositPilotManifest.configurationDigest,
    );
    expect(executionWorker.logs.every((entry) => entry.financialDetailsRedacted)).toBe(true);

    const reconciliationWorker = runtime(fixture, fixture.freshBrowser());
    await expect(reconciliationWorker.runtime.runOnce()).resolves.toMatchObject({
      event: 'completed',
      phase: 'reconcile',
    });
    expect(fixture.stats.transferClicks).toBe(1);
  });

  it('fills and reconciles an immutable leased amount above the product minimum', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({ amountMinor: 12_345 });

    await runtime(fixture).runtime.runOnce();
    await expect(runtime(fixture, fixture.freshBrowser()).runtime.runOnce()).resolves.toMatchObject(
      {
        event: 'completed',
      },
    );
    expect(fixture.stats).toMatchObject({ amountMinor: 12_345, transferClicks: 1 });
  });

  it('never clicks again when the Transfer response is lost', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({ loseTransferResponse: true });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'reconciliation_required',
    });
    await expect(runtime(fixture, fixture.freshBrowser()).runtime.runOnce()).resolves.toMatchObject(
      {
        event: 'needs_attention',
      },
    );
    expect(fixture.stats.transferClicks).toBe(1);
  });

  it('executes the immutable 25,000 ETB maximum with one Transfer total', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      amountMinor: DEPOSIT_MAXIMUM_MINOR,
    });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'reconciliation_required',
    });
    await expect(runtime(fixture, fixture.freshBrowser()).runtime.runOnce()).resolves.toMatchObject(
      {
        event: 'completed',
      },
    );
    expect(fixture.stats).toMatchObject({
      amountMinor: DEPOSIT_MAXIMUM_MINOR,
      transferClicks: 1,
    });
  });

  it('fails closed after a crash before modal evidence is durably handed off', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      requireReconciliationFails: true,
    });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'final_action_fenced',
    });
    expect(fixture.stats.transferClicks).toBe(1);

    await expect(runtime(fixture, fixture.freshBrowser()).runtime.runOnce()).resolves.toMatchObject(
      {
        event: 'idle',
      },
    );
    fixture.advance(10_000);
    await expect(runtime(fixture, fixture.freshBrowser()).runtime.runOnce()).resolves.toMatchObject(
      {
        event: 'needs_attention',
      },
    );
    expect(fixture.stats).toMatchObject({ transferClicks: 1, fenceCalls: 1 });
  });

  it('fails closed to attention on duplicate Approved history with one Transfer total', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      duplicateApprovedHistory: true,
    });

    await runtime(fixture).runtime.runOnce();
    await expect(runtime(fixture, fixture.freshBrowser()).runtime.runOnce()).resolves.toMatchObject(
      {
        event: 'needs_attention',
        actionRetryAllowed: false,
      },
    );
    expect(fixture.stats.transferClicks).toBe(1);
  });

  it('recovers a crashed fenced attempt to attention when evidence is ambiguous', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      duplicateApprovedHistory: true,
      requireReconciliationFails: true,
    });

    await runtime(fixture).runtime.runOnce();
    fixture.advance(10_000);
    await expect(runtime(fixture, fixture.freshBrowser()).runtime.runOnce()).resolves.toMatchObject(
      {
        event: 'needs_attention',
        actionRetryAllowed: false,
      },
    );
    expect(fixture.stats).toMatchObject({ transferClicks: 1, fenceCalls: 1 });
  });

  it('cancels stale or unavailable preparation before creating a fence', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({ failPreparation: true });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'cancelled_before_action',
    });
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 0, cancelled: true });
  });

  it('cancels a rendered amount mismatch before fence or Transfer', async () => {
    const fixture = createDeterministicKemerBetDepositFixture({
      mismatchedPreparedAmount: true,
    });

    await expect(runtime(fixture).runtime.runOnce()).resolves.toMatchObject({
      event: 'cancelled_before_action',
    });
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 0 });
  });

  it('independently rejects stale prepared readback before fence or Transfer', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    const staleBrowser = {
      ...fixture.browser,
      async prepare(lease: Parameters<typeof fixture.browser.prepare>[0]) {
        const prepared = await fixture.browser.prepare(lease);
        return { ...prepared, preparedAt: new Date(prepared.preparedAt.getTime() - 5_001) };
      },
    };

    await expect(runtime(fixture, staleBrowser).runtime.runOnce()).resolves.toMatchObject({
      event: 'cancelled_before_action',
    });
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 0 });
  });

  it('rejects a browser session bound to a different platform agent account', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    const wrongAccountBrowser = {
      ...fixture.browser,
      platformAgentAccountId: '55555555-5555-4555-8555-555555555555',
    };

    await expect(runtime(fixture, wrongAccountBrowser).runtime.runOnce()).resolves.toMatchObject({
      event: 'cancelled_before_action',
    });
    expect(fixture.stats).toMatchObject({ transferClicks: 0, fenceCalls: 0 });
  });

  it('rejects a concurrent browser workflow so shared page state cannot interleave', async () => {
    const fixture = createDeterministicKemerBetDepositFixture();
    const worker = runtime(fixture).runtime;

    const [first, second] = await Promise.allSettled([worker.runOnce(), worker.runOnce()]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') {
      expect(second.reason).toBeInstanceOf(KemerBetDepositRuntimeBusyError);
    }
    expect(fixture.stats).toMatchObject({ transferClicks: 1, fenceCalls: 1 });
  });
});
