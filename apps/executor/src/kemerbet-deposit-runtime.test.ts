import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';
import { describe, expect, it } from 'vitest';

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
