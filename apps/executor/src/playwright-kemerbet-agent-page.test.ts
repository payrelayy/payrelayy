import { describe, expect, it, vi } from 'vitest';

import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import { KemerBetDepositBrowserUnavailableError } from './kemerbet-deposit-browser-adapter.js';
import {
  assertKemerBetAgentPageSelectorContractV1,
  createPlaywrightKemerBetAgentPage,
  KEMERBET_AGENT_DEPOSIT_URL,
  KEMERBET_AGENT_HISTORY_URL,
  normalizeKemerBetAgentTimestamp,
  type KemerBetAgentPageSelectorContractV1,
  type PlaywrightLocatorPort,
  type PlaywrightPagePort,
} from './playwright-kemerbet-agent-page.js';

const contract: KemerBetAgentPageSelectorContractV1 = {
  version: 1,
  signedInAgentIdentity: {
    root: '#signed-in-agent',
    value: { selector: '#signed-in-agent-value', source: 'text' },
  },
  lookup: {
    root: '#lookup',
    playerId: { selector: '#lookup-player', source: 'text' },
    currencyCode: { selector: '#lookup-currency', source: 'text' },
  },
  preparedDeposit: {
    root: '#prepared',
    playerId: { selector: '#prepared-player', source: 'text' },
    amount: { selector: '#prepared-amount', source: 'input' },
    currencyCode: { selector: '#prepared-currency', source: 'text' },
  },
  transferResult: {
    dialog: '#success-dialog',
    title: { selector: '#dialog-title', source: 'text' },
    playerCreditFact: { selector: '#player-credit', source: 'text' },
  },
  history: {
    table: '#history',
    headerCells: 'thead th',
    bodyRows: 'tbody tr',
    rowCells: 'td',
    nextButton: '#history-next',
    columns: {
      stateLabel: 'State',
      operationLabel: 'Operation',
      paymentMethod: 'Payment Method',
      playerId: 'Player ID',
      amount: 'Amount',
      currencyCode: 'Currency',
      occurredAt: 'Occurred At',
      externalReference: 'Reference',
    },
  },
  sessionFailure: {
    captcha: '#captcha',
    signInForm: '#sign-in',
  },
};

const RAW_AGENT_IDENTITY = 'agent-one@example.invalid';
const PLATFORM_AGENT_ACCOUNT_ID = '44444444-4444-4444-8444-444444444441';
const AGENT_IDENTITY_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'c'.repeat(64)}`;
const OTHER_AGENT_IDENTITY_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'d'.repeat(64)}`;
const fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter = Object.assign(
  (platformAgentAccountId: string, rawIdentity: string) =>
    platformAgentAccountId === PLATFORM_AGENT_ACCOUNT_ID && rawIdentity === RAW_AGENT_IDENTITY
      ? AGENT_IDENTITY_FINGERPRINT
      : OTHER_AGENT_IDENTITY_FINGERPRINT,
  { keyFingerprint: 'e'.repeat(64) },
);

interface LocatorOptions {
  readonly text?: string;
  readonly input?: string;
  readonly visible?: boolean;
  readonly enabled?: boolean;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: Readonly<Record<string, FakeLocator>>;
  readonly items?: readonly FakeLocator[];
  readonly onClick?: () => void;
}

class FakeLocator implements PlaywrightLocatorPort {
  text: string;
  input: string;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: Readonly<Record<string, FakeLocator>>;
  readonly items: readonly FakeLocator[] | null;
  readonly onClick: (() => void) | undefined;

  constructor(options: LocatorOptions = {}) {
    this.text = options.text ?? '';
    this.input = options.input ?? '';
    this.visible = options.visible ?? true;
    this.enabled = options.enabled ?? true;
    this.attributes = options.attributes ?? {};
    this.children = options.children ?? {};
    this.items = options.items ?? null;
    this.onClick = options.onClick;
  }

  locator(selector: string) {
    return this.children[selector] ?? emptyLocator();
  }

  nth(index: number) {
    return this.items?.[index] ?? (index === 0 && this.items === null ? this : emptyLocator());
  }

  async count() {
    return this.items?.length ?? (this.visible ? 1 : 0);
  }

  async click() {
    this.onClick?.();
  }

  async fill(value: string) {
    this.input = value;
  }

  async selectOption(value: string) {
    this.input = value;
    return [value];
  }

  async inputValue() {
    return this.input;
  }

  async innerText() {
    return this.text;
  }

  async isVisible() {
    return this.visible;
  }

  async isEnabled() {
    return this.enabled;
  }

  async getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
}

function emptyLocator() {
  return new FakeLocator({ visible: false, items: [] });
}

const headers = [
  'State',
  'Operation',
  'Payment Method',
  'Player ID',
  'Amount',
  'Currency',
  'Occurred At',
  'Reference',
];

function historyRow(reference: string, localTime = '2030-01-02 06:04:10') {
  return [
    'Approved',
    'Player Epos Deposit',
    'EPOS',
    'PLAYER-ALPHA',
    '25.00 ETB',
    'ETB',
    localTime,
    reference,
  ];
}

function historyTable(
  rows: readonly (readonly string[])[],
  overrideHeaders: readonly string[] = headers,
) {
  return new FakeLocator({
    children: {
      'thead th': new FakeLocator({
        items: overrideHeaders.map((text) => new FakeLocator({ text })),
      }),
      'tbody tr': new FakeLocator({
        items: rows.map(
          (row) =>
            new FakeLocator({
              children: {
                td: new FakeLocator({ items: row.map((text) => new FakeLocator({ text })) }),
              },
            }),
        ),
      }),
    },
  });
}

class FakePage implements PlaywrightPagePort {
  urlValue = 'about:blank';
  redirectTo: string | null = null;
  captcha = false;
  signIn = false;
  transferClicks = 0;
  historyPage = 0;
  readonly historyPages: (readonly (readonly string[])[])[] = [[historyRow('reference-one')]];
  historyHeaders: readonly string[] = headers;
  showHistoryNext = true;
  dialogCredit = 'Player Balance +25.00 ETB Success';
  rawAgentIdentity = RAW_AGENT_IDENTITY;
  identityDelayPolls = 0;
  lookupDelayPolls = 0;
  historyDelayPolls = 0;
  dialogDelayPolls = 0;

  readonly lookup = new FakeLocator({
    children: {
      '#lookup-player': new FakeLocator({ text: 'PLAYER-ALPHA' }),
      '#lookup-currency': new FakeLocator({ text: 'ETB' }),
    },
  });
  readonly preparedAmount = new FakeLocator({ input: '25.00' });
  readonly prepared = new FakeLocator({
    children: {
      '#prepared-player': new FakeLocator({ text: 'PLAYER-ALPHA' }),
      '#prepared-amount': this.preparedAmount,
      '#prepared-currency': new FakeLocator({ text: 'ETB' }),
    },
  });
  readonly labels = new Map<string, FakeLocator>([
    ['Player ID', new FakeLocator({ input: 'PLAYER-ALPHA' })],
    ['Amount', this.preparedAmount],
    ['Notes', new FakeLocator()],
    ['Find By', new FakeLocator({ input: 'Player ID' })],
  ]);

  async goto(url: string) {
    this.urlValue = this.redirectTo ?? url;
  }

  url() {
    return this.urlValue;
  }

  getByRole(role: 'button' | 'link' | 'tab', options: { name: string; exact: true }) {
    if (role === 'button' && options.name === 'Transfer') {
      return new FakeLocator({ onClick: () => (this.transferClicks += 1) });
    }
    return new FakeLocator();
  }

  getByLabel(text: string) {
    return this.labels.get(text) ?? emptyLocator();
  }

  locator(selector: string): FakeLocator {
    if (selector === '#captcha') return this.captcha ? new FakeLocator() : emptyLocator();
    if (selector === '#sign-in') return this.signIn ? new FakeLocator() : emptyLocator();
    if (selector === '#signed-in-agent') {
      if (this.identityDelayPolls > 0) {
        this.identityDelayPolls -= 1;
        return emptyLocator();
      }
      return new FakeLocator({
        children: {
          '#signed-in-agent-value': new FakeLocator({ text: this.rawAgentIdentity }),
        },
      });
    }
    if (selector === '#lookup') {
      if (this.lookupDelayPolls > 0) {
        this.lookupDelayPolls -= 1;
        return emptyLocator();
      }
      return this.lookup;
    }
    if (selector === '#prepared') return this.prepared;
    if (selector === '#success-dialog') {
      if (this.dialogDelayPolls > 0) {
        this.dialogDelayPolls -= 1;
        return emptyLocator();
      }
      return new FakeLocator({
        children: {
          '#dialog-title': new FakeLocator({ text: 'Transfer Successful!' }),
          '#player-credit': new FakeLocator({ text: this.dialogCredit }),
        },
      });
    }
    if (selector === '#history') {
      if (this.historyDelayPolls > 0) {
        this.historyDelayPolls -= 1;
        return emptyLocator();
      }
      return historyTable(this.historyPages[this.historyPage] ?? [], this.historyHeaders);
    }
    if (selector === '#history-next') {
      if (!this.showHistoryNext) return emptyLocator();
      const last = this.historyPage >= this.historyPages.length - 1;
      return new FakeLocator({
        enabled: !last,
        attributes: last ? { 'aria-disabled': 'true' } : {},
        onClick: () => {
          this.historyPage += 1;
        },
      });
    }
    return emptyLocator();
  }
}

function driver(page = new FakePage(), overrides = {}) {
  return {
    page,
    driver: createPlaywrightKemerBetAgentPage({
      page,
      platformAgentAccountId: PLATFORM_AGENT_ACCOUNT_ID,
      sessionKey: 'kemerbet-agent-session-v1:test',
      selectorContract: contract,
      expectedAgentIdentityFingerprint: AGENT_IDENTITY_FINGERPRINT,
      fingerprintAgentIdentity,
      timeoutMs: 100,
      pollDelay: async () => undefined,
      ...overrides,
    }),
  };
}

describe('Playwright KemerBet agent page', () => {
  it('validates an untrusted selector contract without opening a browser', () => {
    expect(() => assertKemerBetAgentPageSelectorContractV1(contract)).not.toThrow();
    expect(() =>
      assertKemerBetAgentPageSelectorContractV1({
        ...contract,
        history: { ...contract.history, columns: { ...contract.history.columns, amount: '' } },
      }),
    ).toThrow(KemerBetDepositBrowserUnavailableError);
    expect(() => assertKemerBetAgentPageSelectorContractV1(null)).toThrow(
      KemerBetDepositBrowserUnavailableError,
    );
    expect(() =>
      assertKemerBetAgentPageSelectorContractV1({ ...contract, unexpectedFallback: '#body' }),
    ).toThrow(KemerBetDepositBrowserUnavailableError);
  });

  it.each([
    'https://agentsystem.admindigi.com/payments/requests',
    'https://agentsystem.admindigi.com/payments/requests#tab=2',
    'https://agentsystem.admindigi.com/login',
    'https://kemerbet.co/en/pages/9999/1',
  ])('rejects every route outside the two exact agent routes: %s', async (url) => {
    const fixture = driver();
    await expect(fixture.driver.goto(url)).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('rejects a redirect to login and a CAPTCHA on an otherwise exact route', async () => {
    const redirected = driver();
    redirected.page.redirectTo = 'https://agentsystem.admindigi.com/login';
    await expect(redirected.driver.goto(KEMERBET_AGENT_DEPOSIT_URL)).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    const challenged = driver();
    challenged.page.captcha = true;
    await expect(challenged.driver.goto(KEMERBET_AGENT_DEPOSIT_URL)).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('waits for a delayed signed-in identity marker and rejects a swapped identity', async () => {
    const delayed = driver();
    delayed.page.identityDelayPolls = 2;
    await expect(delayed.driver.goto(KEMERBET_AGENT_DEPOSIT_URL)).resolves.toBeUndefined();

    const swapped = driver();
    swapped.page.rawAgentIdentity = 'different-agent@example.invalid';
    await expect(swapped.driver.goto(KEMERBET_AGENT_DEPOSIT_URL)).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('rechecks identity before fill and fails closed if the session changes', async () => {
    const fixture = driver();
    await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    fixture.page.rawAgentIdentity = 'different-agent@example.invalid';
    await expect(fixture.driver.fillByLabel('Amount', '25.00')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('reads only structured lookup, prepared-target, and success-modal facts', async () => {
    const fixture = driver();
    await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await expect(fixture.driver.readAgentLookup()).resolves.toEqual({
      playerId: 'PLAYER-ALPHA',
      currencyCode: 'ETB',
    });
    await expect(fixture.driver.readAgentPreparedDeposit()).resolves.toEqual({
      playerId: 'PLAYER-ALPHA',
      amountText: '25.00',
      currencyCode: 'ETB',
    });
    await fixture.driver.clickByRole('button', 'Transfer');
    await expect(fixture.driver.readAgentTransferResult()).resolves.toEqual({
      playerId: 'PLAYER-ALPHA',
      creditEvidenceText: 'Player Balance +25.00 ETB Success',
    });
    expect(fixture.page.transferClicks).toBe(1);
  });

  it('waits for delayed lookup and modal observations without another click', async () => {
    const fixture = driver();
    fixture.page.lookupDelayPolls = 2;
    fixture.page.dialogDelayPolls = 2;
    await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-ALPHA',
    });
    await fixture.driver.readAgentPreparedDeposit();
    await expect(fixture.driver.readAgentTransferResult()).resolves.toMatchObject({
      creditEvidenceText: 'Player Balance +25.00 ETB Success',
    });
    expect(fixture.page.transferClicks).toBe(0);
  });

  it('returns no modal fact after the bounded observation-only wait', async () => {
    const fixture = driver();
    fixture.page.dialogDelayPolls = 100;
    await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await fixture.driver.readAgentLookup();
    await fixture.driver.readAgentPreparedDeposit();
    await expect(fixture.driver.readAgentTransferResult()).resolves.toBeNull();
    expect(fixture.page.transferClicks).toBe(0);
  });

  it.each(['Player balance +25 ETB success', ' Player Balance +25.00 ETB Success'])(
    'fails closed on modal punctuation, case, or whitespace drift',
    async (creditFact) => {
      const fixture = driver();
      fixture.page.dialogCredit = creditFact;
      await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
      await fixture.driver.readAgentLookup();
      await fixture.driver.readAgentPreparedDeposit();
      await expect(fixture.driver.readAgentTransferResult()).rejects.toBeInstanceOf(
        KemerBetDepositBrowserUnavailableError,
      );
    },
  );

  it('normalizes naive Addis Ababa history time and explicit offsets to UTC', () => {
    expect(normalizeKemerBetAgentTimestamp('2030-01-02 06:04:10')).toBe('2030-01-02T03:04:10.000Z');
    expect(normalizeKemerBetAgentTimestamp('2030-01-02T06:04:10+03:00')).toBe(
      '2030-01-02T03:04:10.000Z',
    );
    expect(() => normalizeKemerBetAgentTimestamp('2030-02-30 06:04:10')).toThrow(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('reads every page in a complete bounded history window with exact labels', async () => {
    const fixture = driver();
    fixture.page.historyPages.splice(
      0,
      1,
      [historyRow('reference-one')],
      [historyRow('reference-two', '2030-01-02T03:04:11.000Z')],
    );
    await fixture.driver.goto(KEMERBET_AGENT_HISTORY_URL);
    await expect(fixture.driver.readAgentHistory()).resolves.toEqual([
      {
        stateLabel: 'Approved',
        operationLabel: 'Player Epos Deposit',
        paymentMethod: 'EPOS',
        playerId: 'PLAYER-ALPHA',
        amountText: '25.00 ETB',
        currencyCode: 'ETB',
        occurredAt: '2030-01-02T03:04:10.000Z',
        externalReference: 'reference-one',
      },
      expect.objectContaining({
        stateLabel: 'Approved',
        operationLabel: 'Player Epos Deposit',
        paymentMethod: 'EPOS',
        occurredAt: '2030-01-02T03:04:11.000Z',
        externalReference: 'reference-two',
      }),
    ]);
  });

  it('waits for a delayed history table and rejects route drift during polling', async () => {
    const delayed = driver();
    delayed.page.historyDelayPolls = 2;
    await delayed.driver.goto(KEMERBET_AGENT_HISTORY_URL);
    await expect(delayed.driver.readAgentHistory()).resolves.toHaveLength(1);

    const driftingPage = new FakePage();
    driftingPage.lookupDelayPolls = 10;
    const drifting = driver(driftingPage, {
      pollDelay: async () => {
        driftingPage.urlValue = KEMERBET_AGENT_HISTORY_URL;
      },
    });
    await drifting.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await expect(drifting.driver.readAgentLookup()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('never logs or returns the raw signed-in agent identity', async () => {
    const fixture = driver();
    fixture.page.rawAgentIdentity = 'private-swapped-agent@example.invalid';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let observed: unknown;
    try {
      await fixture.driver.goto(KEMERBET_AGENT_HISTORY_URL);
    } catch (failure) {
      observed = failure;
    }
    expect(String(observed)).not.toContain(fixture.page.rawAgentIdentity);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('rejects a partial history result when an enabled next page exceeds the cap', async () => {
    const fixture = driver(new FakePage(), { maxHistoryPages: 1 });
    fixture.page.historyPages.push([historyRow('reference-two')]);
    await fixture.driver.goto(KEMERBET_AGENT_HISTORY_URL);
    await expect(fixture.driver.readAgentHistory()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('rejects history when the reviewed completion control disappears', async () => {
    const fixture = driver();
    fixture.page.showHistoryNext = false;
    await fixture.driver.goto(KEMERBET_AGENT_HISTORY_URL);
    await expect(fixture.driver.readAgentHistory()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it.each(['', ` ${'x'.repeat(2)}`, 'x'.repeat(257)])(
    'rejects an empty, untrimmed, or oversized reference without returning partial history',
    async (reference) => {
      const fixture = driver();
      fixture.page.historyPages.splice(0, 1, [historyRow(reference)]);
      await fixture.driver.goto(KEMERBET_AGENT_HISTORY_URL);
      await expect(fixture.driver.readAgentHistory()).rejects.toBeInstanceOf(
        KemerBetDepositBrowserUnavailableError,
      );
    },
  );

  it('rejects exact-column drift and route drift after an action', async () => {
    const columns = driver();
    columns.page.historyHeaders = headers.map((header) =>
      header === 'Payment Method' ? 'Method' : header,
    );
    await columns.driver.goto(KEMERBET_AGENT_HISTORY_URL);
    await expect(columns.driver.readAgentHistory()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    const route = driver();
    await route.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    route.page.urlValue = KEMERBET_AGENT_HISTORY_URL;
    await expect(route.driver.fillByLabel('Amount', '25.00')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });
});
