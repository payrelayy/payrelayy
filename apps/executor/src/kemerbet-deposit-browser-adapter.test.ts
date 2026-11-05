import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';
import { describe, expect, it, vi } from 'vitest';

import {
  createKemerBetDepositBrowser,
  createKemerBetDepositFinalActionFreshnessGuard,
  isKemerBetDepositFinalActionFresh,
  KemerBetDepositBrowserUnavailableError,
  type KemerBetAgentHistoryView,
  type KemerBetBrowserPage,
} from './kemerbet-deposit-browser-adapter.js';
import type {
  KemerBetDepositExecutionLease,
  KemerBetDepositReconciliationLease,
} from './kemerbet-deposit-types.js';

const AGENT_ACCOUNT_ID = '33333333-3333-4333-8333-333333333334';
const NOW = new Date('2030-01-02T03:04:20.000Z');
const FENCED_AT = new Date('2030-01-02T03:04:05.000Z');
const REQUIRED_AT = new Date('2030-01-02T03:04:15.000Z');
const FRESH_FENCED_AT = new Date(NOW);

const lease: KemerBetDepositExecutionLease = {
  disposition: 'execution',
  phase: 'execute',
  depositIntentId: '33333333-3333-4333-8333-333333333331',
  executionJobId: '33333333-3333-4333-8333-333333333332',
  executionAttemptId: '33333333-3333-4333-8333-333333333333',
  platformAgentAccountId: AGENT_ACCOUNT_ID,
  target: {
    operation: 'deposit',
    playerId: 'PLAYER-BETA',
    amountMinor: DEPOSIT_MINIMUM_MINOR,
    currencyCode: 'ETB',
  },
  leaseToken: '33333333-3333-4333-8333-333333333335',
  leaseExpiresAt: new Date('2030-01-02T03:10:00.000Z'),
  privateLiveDepositPilotAuthorization: {
    contractVersion: 1,
    pilotRevisionId: '33333333-3333-4333-8333-333333333338',
    pilotReservationId: '33333333-3333-4333-8333-333333333339',
    configurationDigest: `sha256:${'3'.repeat(64)}`,
    authorizationToken: '33333333-3333-4333-8333-333333333340',
  },
};

function reconciliationLease(
  exactPlayerCreditMatch: boolean | null = true,
): KemerBetDepositReconciliationLease {
  return {
    phase: 'reconcile',
    depositIntentId: lease.depositIntentId,
    reconciliationJobId: '33333333-3333-4333-8333-333333333336',
    executionAttemptId: lease.executionAttemptId,
    platformAgentAccountId: lease.platformAgentAccountId,
    target: lease.target,
    leaseToken: '33333333-3333-4333-8333-333333333337',
    leaseExpiresAt: new Date('2030-01-02T03:10:00.000Z'),
    recovery: {
      finalActionFencedAt: FENCED_AT,
      reconciliationRequiredAt: REQUIRED_AT,
      exactPlayerCreditMatch,
    },
  };
}

function exactHistoryRow(): KemerBetAgentHistoryView {
  return {
    stateLabel: 'Approved',
    operationLabel: 'Player Epos Deposit',
    paymentMethod: 'EPOS',
    playerId: lease.target.playerId,
    amountText: '25.00 ETB',
    currencyCode: 'ETB',
    occurredAt: '2030-01-02T03:04:10.000Z',
    externalReference: 'bounded-external-reference',
  };
}

class FakeAgentPage implements KemerBetBrowserPage {
  readonly sessionKey = 'agent-session';
  url = 'about:blank';
  amount = '';
  transfers = 0;
  preparedReads = 0;
  driftAfterFirstPreparedRead = false;
  transferResultText = 'Player Balance +25.00 ETB Success';
  history: readonly KemerBetAgentHistoryView[] = [];
  transferResultError: Error | null = null;
  historyError: Error | null = null;

  async goto(url: string) {
    this.url = url;
  }

  async currentUrl() {
    return this.url;
  }

  async openPlayerDeposit() {}

  async lookupPlayer() {}

  async fillDeposit(amount: string) {
    this.amount = amount;
  }

  async transferOnce(isFinalActionFresh: () => boolean) {
    if (!isFinalActionFresh()) throw new KemerBetDepositBrowserUnavailableError();
    this.transfers += 1;
  }

  async readAgentLookup() {
    return { playerId: lease.target.playerId, currencyCode: 'ETB' };
  }

  async readAgentPreparedDeposit() {
    this.preparedReads += 1;
    return {
      playerId: lease.target.playerId,
      amountText:
        this.driftAfterFirstPreparedRead && this.preparedReads > 1 ? '99.99' : this.amount,
      currencyCode: 'ETB',
    };
  }

  async readAgentTransferResult() {
    if (this.transferResultError !== null) throw this.transferResultError;
    return { playerId: lease.target.playerId, creditEvidenceText: this.transferResultText };
  }

  async readAgentHistory() {
    if (this.historyError !== null) throw this.historyError;
    return this.history;
  }
}

function dependencies(page = new FakeAgentPage()) {
  return {
    page,
    value: {
      platformAgentAccountId: AGENT_ACCOUNT_ID,
      agentPage: page,
      routes: {
        agentDepositUrl: 'https://agentsystem.admindigi.com/agents',
        agentHistoryUrl: 'https://agentsystem.admindigi.com/payments/history',
      },
      now: () => new Date(NOW),
      fingerprintExternalReference: () => `hmac-sha256-v1:${'b'.repeat(64)}`,
    },
  };
}

describe('KemerBet final-action freshness', () => {
  it.each([
    [0, true],
    [9_999, true],
    [10_000, false],
    [10_001, false],
    [-1, false],
  ])('accepts age %i ms only before crash-recovery eligibility', (ageMilliseconds, expected) => {
    expect(
      isKemerBetDepositFinalActionFresh(
        lease.leaseExpiresAt,
        FRESH_FENCED_AT,
        new Date(NOW.getTime() + ageMilliseconds),
      ),
    ).toBe(expected);
  });

  it('also rejects equality with an earlier original lease expiry', () => {
    const expiresAt = new Date(NOW.getTime() + 100);
    expect(isKemerBetDepositFinalActionFresh(expiresAt, FRESH_FENCED_AT, expiresAt)).toBe(false);
  });

  it.each(['lease', 'fence', 'clock'] as const)(
    'rejects a malformed %s timestamp, including a fake getTime method',
    (field) => {
      for (const malformed of [
        new Date(Number.NaN),
        NOW.toISOString(),
        null,
        { getTime: () => NOW.getTime() },
        Object.assign(new Date(Number.NaN), { getTime: () => NOW.getTime() }),
      ]) {
        expect(
          isKemerBetDepositFinalActionFresh(
            field === 'lease' ? (malformed as Date) : lease.leaseExpiresAt,
            field === 'fence' ? (malformed as Date) : FRESH_FENCED_AT,
            field === 'clock' ? (malformed as Date) : NOW,
          ),
        ).toBe(false);
      }
    },
  );

  it('snapshots mutable bounds before invoking the clock and never revives a rejected action', () => {
    const leaseExpiry = new Date(NOW.getTime() + 100);
    const fencedAt = new Date(NOW);
    let clock = new Date(NOW);
    const guard = createKemerBetDepositFinalActionFreshnessGuard(leaseExpiry, fencedAt, () => {
      fencedAt.setTime(clock.getTime());
      leaseExpiry.setTime(clock.getTime() + 300_000);
      return clock;
    });
    expect(guard()).toBe(true);
    clock = new Date(NOW.getTime() + 100);
    expect(guard()).toBe(false);
    clock = new Date(NOW);
    expect(guard()).toBe(false);
  });

  it('rejects an observed wall-clock regression and cannot revive when the clock catches up', () => {
    let clock = new Date(NOW.getTime() + 2_000);
    let monotonic = 0;
    const guard = createKemerBetDepositFinalActionFreshnessGuard(
      lease.leaseExpiresAt,
      FRESH_FENCED_AT,
      () => clock,
      () => monotonic,
    );
    expect(guard()).toBe(true);
    clock = new Date(NOW.getTime() + 1_000);
    monotonic = 500;
    expect(guard()).toBe(false);
    clock = new Date(NOW.getTime() + 3_000);
    expect(guard()).toBe(false);
  });

  it('uses monotonic elapsed time when a rollback is hidden between wall-clock observations', () => {
    let clock = new Date(NOW);
    let monotonic = 0;
    const guard = createKemerBetDepositFinalActionFreshnessGuard(
      lease.leaseExpiresAt,
      FRESH_FENCED_AT,
      () => clock,
      () => monotonic,
    );
    expect(guard()).toBe(true);
    // Ten real seconds elapsed, but a clock correction hides six seconds between observations.
    clock = new Date(NOW.getTime() + 4_000);
    monotonic = 10_000;
    expect(guard()).toBe(false);
    monotonic = 0;
    expect(guard()).toBe(false);
  });
});

describe('KemerBet deposit browser boundary', () => {
  it.each([
    'http://agentsystem.admindigi.com/agents',
    'https://agentsystem.admindigi.com.evil.example/agents',
    'https://user:pass@agentsystem.admindigi.com/agents',
  ])('rejects a non-allowlisted agent route: %s', (agentDepositUrl) => {
    const fixture = dependencies();
    expect(() =>
      createKemerBetDepositBrowser({
        ...fixture.value,
        routes: { ...fixture.value.routes, agentDepositUrl },
      }),
    ).toThrow(KemerBetDepositBrowserUnavailableError);
  });

  it('binds the browser session to the exact platform agent account', async () => {
    const fixture = dependencies();
    const browser = createKemerBetDepositBrowser(fixture.value);

    await expect(
      browser.prepare({
        ...lease,
        platformAgentAccountId: '33333333-3333-4333-8333-333333333339',
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
    expect(fixture.page.transfers).toBe(0);
  });

  it('proves an exact Player/ETB lookup without filling Amount or clicking Transfer', async () => {
    const fixture = dependencies();
    const browser = createKemerBetDepositBrowser(fixture.value);

    await expect(
      browser.probePlayerLookup({ playerId: lease.target.playerId, currencyCode: 'ETB' }),
    ).resolves.toEqual({
      exactPlayerMatch: true,
      exactCurrencyMatch: true,
      transferDisabled: true,
    });
    expect(fixture.page.amount).toBe('');
    expect(fixture.page.transfers).toBe(0);
  });

  it('reads back the immutable target and permits one Transfer after a first fence only', async () => {
    const fixture = dependencies();
    const browser = createKemerBetDepositBrowser(fixture.value);

    await expect(browser.prepare(lease)).resolves.toMatchObject({
      exactPlayerMatch: true,
      exactCurrencyMatch: true,
      amountFilledMinor: DEPOSIT_MINIMUM_MINOR,
    });
    expect(fixture.page.amount).toBe('25.00');
    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).resolves.toEqual({
      response: 'success_dialog_observed',
      exactPlayerCreditMatch: true,
    });
    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
    expect(fixture.page.transfers).toBe(1);
    expect(fixture.page.preparedReads).toBe(2);
  });

  it('normalizes and reads back the 25,000 ETB product maximum', async () => {
    const fixture = dependencies();
    fixture.page.transferResultText = 'Player Balance +25000.00 ETB Success';
    const browser = createKemerBetDepositBrowser(fixture.value);
    const maximumLease = {
      ...lease,
      target: { ...lease.target, amountMinor: DEPOSIT_MAXIMUM_MINOR },
    };

    await expect(browser.prepare(maximumLease)).resolves.toMatchObject({
      amountFilledMinor: DEPOSIT_MAXIMUM_MINOR,
    });
    expect(fixture.page.amount).toBe('25000.00');
    await expect(
      browser.submitOnceAfterFence(maximumLease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).resolves.toMatchObject({ exactPlayerCreditMatch: true });
  });

  it('consumes a stale first-fence permission without reading the form or allowing replay', async () => {
    const fixture = dependencies();
    const browser = createKemerBetDepositBrowser(fixture.value);
    await browser.prepare(lease);

    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FENCED_AT,
      }),
    ).resolves.toEqual({ response: 'response_uncertain', exactPlayerCreditMatch: false });
    expect(fixture.page.preparedReads).toBe(1);
    expect(fixture.page.transfers).toBe(0);
    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
  });

  it.each(['fence window', 'original lease'] as const)(
    'does not Transfer when the %s expires during the final prepared-form readback',
    async (boundary) => {
      const fixture = dependencies();
      let clock = new Date(NOW);
      fixture.value.now = () => new Date(clock);
      const browser = createKemerBetDepositBrowser(fixture.value);
      const targetLease = {
        ...lease,
        leaseExpiresAt:
          boundary === 'original lease' ? new Date(NOW.getTime() + 100) : lease.leaseExpiresAt,
      };
      await browser.prepare(targetLease);
      const readPrepared = fixture.page.readAgentPreparedDeposit.bind(fixture.page);
      vi.spyOn(fixture.page, 'readAgentPreparedDeposit').mockImplementation(async () => {
        const rendered = await readPrepared();
        clock = new Date(NOW.getTime() + (boundary === 'original lease' ? 100 : 10_000));
        return rendered;
      });
      const transfer = vi.spyOn(fixture.page, 'transferOnce');

      await expect(
        browser.submitOnceAfterFence(targetLease, {
          firstFenceAcquired: true,
          finalActionFencedAt: FRESH_FENCED_AT,
        }),
      ).resolves.toEqual({ response: 'response_uncertain', exactPlayerCreditMatch: false });
      expect(transfer).not.toHaveBeenCalled();
      clock = new Date(NOW);
      await expect(
        browser.submitOnceAfterFence(targetLease, {
          firstFenceAcquired: true,
          finalActionFencedAt: FRESH_FENCED_AT,
        }),
      ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
      expect(fixture.page.transfers).toBe(0);
    },
  );

  it('carries a live freshness guard through the driver boundary without refreshing the fence', async () => {
    const fixture = dependencies();
    let clock = new Date(NOW);
    fixture.value.now = () => new Date(clock);
    const browser = createKemerBetDepositBrowser(fixture.value);
    await browser.prepare(lease);
    vi.spyOn(fixture.page, 'transferOnce').mockImplementation(async (isFinalActionFresh) => {
      expect(isFinalActionFresh()).toBe(true);
      clock = new Date(NOW.getTime() + 10_000);
      expect(isFinalActionFresh()).toBe(false);
      throw new KemerBetDepositBrowserUnavailableError();
    });

    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
    expect(fixture.page.transfers).toBe(0);
  });

  it.each(['lease', 'fence'] as const)(
    'does not extend a mutable %s deadline during final readback',
    async (boundary) => {
      const fixture = dependencies();
      let clock = new Date(NOW);
      fixture.value.now = () => clock;
      const browser = createKemerBetDepositBrowser(fixture.value);
      const targetLease = {
        ...lease,
        leaseExpiresAt: new Date(NOW.getTime() + (boundary === 'lease' ? 100 : 300_000)),
      };
      const fencedAt = new Date(NOW);
      await browser.prepare(targetLease);
      const readPrepared = fixture.page.readAgentPreparedDeposit.bind(fixture.page);
      vi.spyOn(fixture.page, 'readAgentPreparedDeposit').mockImplementation(async () => {
        const rendered = await readPrepared();
        clock = new Date(NOW.getTime() + (boundary === 'lease' ? 100 : 10_000));
        targetLease.leaseExpiresAt.setTime(clock.getTime() + 300_000);
        fencedAt.setTime(clock.getTime());
        return rendered;
      });

      await expect(
        browser.submitOnceAfterFence(targetLease, {
          firstFenceAcquired: true,
          finalActionFencedAt: fencedAt,
        }),
      ).resolves.toEqual({ response: 'response_uncertain', exactPlayerCreditMatch: false });
      expect(fixture.page.transfers).toBe(0);
    },
  );

  it('rejects a leased target below the product minimum before touching the form', async () => {
    const fixture = dependencies();
    const browser = createKemerBetDepositBrowser(fixture.value);

    await expect(
      browser.prepare({
        ...lease,
        target: { ...lease.target, amountMinor: DEPOSIT_MINIMUM_MINOR - 1 },
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
    expect(fixture.page.amount).toBe('');
    expect(fixture.page.transfers).toBe(0);
  });

  it('does not Transfer when the rendered target drifts after the durable fence', async () => {
    const fixture = dependencies();
    fixture.page.driftAfterFirstPreparedRead = true;
    const browser = createKemerBetDepositBrowser(fixture.value);
    await browser.prepare(lease);

    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).resolves.toEqual({ response: 'response_uncertain', exactPlayerCreditMatch: false });
    expect(fixture.page.transfers).toBe(0);
  });

  it('requires the exact observed modal punctuation and case', async () => {
    const fixture = dependencies();
    fixture.page.transferResultText = 'Player Balance 25.00 ETB success';
    const browser = createKemerBetDepositBrowser(fixture.value);
    await browser.prepare(lease);

    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).resolves.toEqual({ response: 'response_uncertain', exactPlayerCreditMatch: false });
    expect(fixture.page.transfers).toBe(1);
  });

  it('propagates authenticated-page safety failures so the registry can evict the context', async () => {
    const transferFixture = dependencies();
    const transferBrowser = createKemerBetDepositBrowser(transferFixture.value);
    await transferBrowser.prepare(lease);
    transferFixture.page.transferResultError = new KemerBetDepositBrowserUnavailableError();
    await expect(
      transferBrowser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);

    const historyFixture = dependencies();
    historyFixture.page.historyError = new KemerBetDepositBrowserUnavailableError();
    await expect(
      createKemerBetDepositBrowser(historyFixture.value).reconcile(reconciliationLease(true)),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
  });

  it('keeps non-safety post-action and history failures observation-only', async () => {
    const transferFixture = dependencies();
    const transferBrowser = createKemerBetDepositBrowser(transferFixture.value);
    await transferBrowser.prepare(lease);
    transferFixture.page.transferResultError = new Error('transport feedback lost');
    await expect(
      transferBrowser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FRESH_FENCED_AT,
      }),
    ).resolves.toEqual({ response: 'response_lost', exactPlayerCreditMatch: false });

    const historyFixture = dependencies();
    historyFixture.page.historyError = new Error('history transport unavailable');
    await expect(
      createKemerBetDepositBrowser(historyFixture.value).reconcile(reconciliationLease(true)),
    ).resolves.toEqual({
      observation: 'not_observed',
      evidence: null,
      reasonCode: 'history_unavailable',
    });
  });

  it('confirms only exact Approved EPOS history with durable modal evidence', async () => {
    const fixture = dependencies();
    fixture.page.history = [exactHistoryRow()];
    const browser = createKemerBetDepositBrowser(fixture.value);

    await expect(browser.reconcile(reconciliationLease(true))).resolves.toMatchObject({
      observation: 'confirmed_executed',
      evidence: { exactPlayerCreditMatch: true, approvedHistoryMatchCount: 1 },
    });
  });

  it('treats same-target wrong payment method as ambiguous', async () => {
    const fixture = dependencies();
    fixture.page.history = [{ ...exactHistoryRow(), paymentMethod: 'OTHER' }];

    await expect(
      createKemerBetDepositBrowser(fixture.value).reconcile(reconciliationLease(true)),
    ).resolves.toEqual({
      observation: 'ambiguous',
      evidence: null,
      reasonCode: 'history_mismatch',
    });
  });

  it.each(['epos', 'Epos', ' EPOS', 'EPOS ', 'E POS'])(
    'rejects a non-exact EPOS payment-method rendering: %s',
    async (paymentMethod) => {
      const fixture = dependencies();
      fixture.page.history = [{ ...exactHistoryRow(), paymentMethod }];

      await expect(
        createKemerBetDepositBrowser(fixture.value).reconcile(reconciliationLease(true)),
      ).resolves.toEqual({
        observation: 'ambiguous',
        evidence: null,
        reasonCode: 'history_mismatch',
      });
    },
  );

  it('treats mixed exact and malformed rows in the same bounded window as ambiguous', async () => {
    const fixture = dependencies();
    fixture.page.history = [
      exactHistoryRow(),
      { ...exactHistoryRow(), paymentMethod: 'OTHER', externalReference: 'other-reference' },
    ];

    await expect(
      createKemerBetDepositBrowser(fixture.value).reconcile(reconciliationLease(true)),
    ).resolves.toEqual({
      observation: 'ambiguous',
      evidence: null,
      reasonCode: 'history_mismatch',
    });
  });

  it.each(['', 'x'.repeat(257)])(
    'treats an empty or oversized external reference as ambiguous',
    async (externalReference) => {
      const fixture = dependencies();
      fixture.page.history = [{ ...exactHistoryRow(), externalReference }];

      await expect(
        createKemerBetDepositBrowser(fixture.value).reconcile(reconciliationLease(true)),
      ).resolves.toEqual({
        observation: 'ambiguous',
        evidence: null,
        reasonCode: 'history_mismatch',
      });
    },
  );

  it('ignores unrelated Approved rows and keeps bounded not-observed follow-up', async () => {
    const fixture = dependencies();
    fixture.page.history = [{ ...exactHistoryRow(), playerId: 'UNRELATED-PLAYER' }];

    await expect(
      createKemerBetDepositBrowser(fixture.value).reconcile(reconciliationLease(true)),
    ).resolves.toEqual({
      observation: 'not_observed',
      evidence: null,
      reasonCode: 'history_missing',
    });
  });

  it('ignores old repeat-player history outside the server-authored window', async () => {
    const fixture = dependencies();
    fixture.page.history = [{ ...exactHistoryRow(), occurredAt: '2030-01-02T03:04:16.000Z' }];

    await expect(
      createKemerBetDepositBrowser(fixture.value).reconcile(reconciliationLease(true)),
    ).resolves.toEqual({
      observation: 'not_observed',
      evidence: null,
      reasonCode: 'history_missing',
    });
  });

  it('allows a delayed current row after old repeat-player history without an action retry', async () => {
    const fixture = dependencies();
    const oldRow = { ...exactHistoryRow(), occurredAt: '2030-01-02T03:04:04.999Z' };
    fixture.page.history = [oldRow];
    const browser = createKemerBetDepositBrowser(fixture.value);

    await expect(browser.reconcile(reconciliationLease(true))).resolves.toEqual({
      observation: 'not_observed',
      evidence: null,
      reasonCode: 'history_missing',
    });

    fixture.page.history = [oldRow, exactHistoryRow()];
    await expect(browser.reconcile(reconciliationLease(true))).resolves.toMatchObject({
      observation: 'confirmed_executed',
      evidence: { approvedHistoryMatchCount: 1, exactPlayerCreditMatch: true },
    });
    expect(fixture.page.transfers).toBe(0);
  });

  it('fails closed when crash recovery has no durably persisted modal fact', async () => {
    const fixture = dependencies();
    fixture.page.history = [exactHistoryRow()];

    await expect(
      createKemerBetDepositBrowser(fixture.value).reconcile(reconciliationLease(null)),
    ).resolves.toEqual({
      observation: 'ambiguous',
      evidence: null,
      reasonCode: 'player_credit_mismatch',
    });
  });
});
