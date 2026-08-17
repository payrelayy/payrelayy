import { DEPOSIT_MAXIMUM_MINOR, DEPOSIT_MINIMUM_MINOR } from '@fetanagent/domain';
import { describe, expect, it } from 'vitest';

import {
  createKemerBetDepositBrowser,
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

  async clickByRole(_role: 'button' | 'link' | 'tab', name: string) {
    if (name === 'Transfer') this.transfers += 1;
  }

  async fillByLabel(label: string, value: string) {
    if (label === 'Amount') this.amount = value;
  }

  async selectByLabel() {}

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
        agentDepositUrl: 'https://agentsystem.admindigi.com/payments/requests',
        agentHistoryUrl: 'https://agentsystem.admindigi.com/payments/history',
      },
      now: () => new Date(NOW),
      fingerprintExternalReference: () => `hmac-sha256-v1:${'b'.repeat(64)}`,
    },
  };
}

describe('KemerBet deposit browser boundary', () => {
  it.each([
    'http://agentsystem.admindigi.com/payments/requests',
    'https://agentsystem.admindigi.com.evil.example/payments/requests',
    'https://user:pass@agentsystem.admindigi.com/payments/requests',
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
        finalActionFencedAt: FENCED_AT,
      }),
    ).resolves.toEqual({
      response: 'success_dialog_observed',
      exactPlayerCreditMatch: true,
    });
    await expect(
      browser.submitOnceAfterFence(lease, {
        firstFenceAcquired: true,
        finalActionFencedAt: FENCED_AT,
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
        finalActionFencedAt: FENCED_AT,
      }),
    ).resolves.toMatchObject({ exactPlayerCreditMatch: true });
  });

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
        finalActionFencedAt: FENCED_AT,
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
        finalActionFencedAt: FENCED_AT,
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
        finalActionFencedAt: FENCED_AT,
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
        finalActionFencedAt: FENCED_AT,
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
