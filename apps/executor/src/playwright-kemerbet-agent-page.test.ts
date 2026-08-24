import { describe, expect, it, vi } from 'vitest';

import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import { KemerBetDepositBrowserUnavailableError } from './kemerbet-deposit-browser-adapter.js';
import {
  assertKemerBetAgentPageSelectorContractV2,
  createPlaywrightKemerBetAgentPage,
  KEMERBET_AGENT_DEPOSIT_URL,
  KEMERBET_AGENT_HISTORY_URL,
  KEMERBET_AGENT_PLAYER_DEPOSIT_URL,
  KEMERBET_AGENT_PLAYER_LOOKUP_URL,
  normalizeKemerBetAgentTimestamp,
  observeKemerBetAgentIdentityFingerprint,
  type KemerBetAgentPageSelectorContractV2,
  type PlaywrightDomControlPort,
  type PlaywrightLocatorPort,
  type PlaywrightPagePort,
  type PlaywrightRequestPort,
  type PlaywrightResponsePort,
  type PlaywrightRoutePort,
} from './playwright-kemerbet-agent-page.js';

const contract: KemerBetAgentPageSelectorContractV2 = {
  version: 2,
  depositWorkflow: {
    financialActionsTrigger: { by: 'css', selector: '#financial-actions' },
    depositMenuItem: { by: 'role', role: 'menuitem', name: 'Deposit' },
    toPlayerTile: { by: 'text', text: 'To Player' },
    findBySelectedValue: { by: 'css', selector: '#find-by-selected-value' },
    findByPlayerIdLabel: 'Player ID',
    playerIdInput: { by: 'label', label: 'Player ID *' },
    findButton: { by: 'role', role: 'button', name: 'Find' },
    amountInput: { by: 'label', label: 'Amount *' },
    notesInput: { by: 'label', label: 'Notes' },
    transferButton: { by: 'role', role: 'button', name: 'Transfer' },
  },
  signedInAgentIdentity: {
    root: '#signed-in-agent',
    value: { selector: '#signed-in-agent-value', source: 'text' },
  },
  lookup: {
    root: '#lookup',
    resolvedIdentity: { selector: '#lookup-identity', source: 'text' },
    currencyCode: { selector: '#lookup-currency', source: 'text' },
  },
  preparedDeposit: {
    root: '#prepared',
    resolvedIdentity: { selector: '#prepared-identity', source: 'text' },
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
const exactLookupBody = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  value: {
    id: 78123,
    externalId: 'PLAYER-ALPHA',
    userName: 'player@example.invalid',
    email: 'player@example.invalid',
    currencyCode: 'ETB',
    ...overrides,
  },
});
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
  readonly tagName?: string;
  readonly connected?: boolean;
  readonly onDocumentEvent?: (type: string, detail: unknown) => void;
  readonly onEvaluateResult?: (result: unknown) => void;
  readonly onBlur?: (options?: { readonly timeout?: number }) => void | Promise<void>;
  readonly documentDispatchResult?: boolean;
  readonly defaultViewAvailable?: boolean;
  readonly onTrialClick?: (options?: {
    readonly timeout?: number;
    readonly trial?: boolean;
  }) => void | Promise<void>;
  readonly onClick?: (options?: {
    readonly timeout?: number;
    readonly trial?: boolean;
  }) => void | Promise<void>;
}

class FakeLocator implements PlaywrightLocatorPort {
  text: string;
  input: string;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: Readonly<Record<string, FakeLocator>>;
  readonly items: readonly FakeLocator[] | null;
  readonly tagName: string;
  readonly connected: boolean;
  readonly onDocumentEvent: ((type: string, detail: unknown) => void) | undefined;
  readonly onEvaluateResult: ((result: unknown) => void) | undefined;
  readonly onBlur: ((options?: { readonly timeout?: number }) => void | Promise<void>) | undefined;
  readonly documentDispatchResult: boolean;
  readonly defaultViewAvailable: boolean;
  readonly onTrialClick:
    | ((options?: { readonly timeout?: number; readonly trial?: boolean }) => void | Promise<void>)
    | undefined;
  readonly onClick:
    | ((options?: { readonly timeout?: number; readonly trial?: boolean }) => void | Promise<void>)
    | undefined;
  readonly fillCalls: Array<{
    readonly value: string;
    readonly options?: { readonly timeout?: number };
  }> = [];
  readonly pressSequentiallyCalls: Array<{
    readonly text: string;
    readonly options?: { readonly delay?: number; readonly timeout?: number };
  }> = [];
  readonly blurCalls: Array<{ readonly timeout?: number } | undefined> = [];

  constructor(options: LocatorOptions = {}) {
    this.text = options.text ?? '';
    this.input = options.input ?? '';
    this.visible = options.visible ?? true;
    this.enabled = options.enabled ?? true;
    this.attributes = options.attributes ?? {};
    this.children = options.children ?? {};
    this.items = options.items ?? null;
    this.tagName = options.tagName ?? 'DIV';
    this.connected = options.connected ?? true;
    this.onDocumentEvent = options.onDocumentEvent;
    this.onEvaluateResult = options.onEvaluateResult;
    this.onBlur = options.onBlur;
    this.documentDispatchResult = options.documentDispatchResult ?? true;
    this.defaultViewAvailable = options.defaultViewAvailable ?? true;
    this.onTrialClick = options.onTrialClick;
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

  async click(options?: { readonly timeout?: number; readonly trial?: boolean }) {
    if (options?.trial === true) {
      await this.onTrialClick?.(options);
      return;
    }
    await this.onClick?.(options);
  }

  async evaluate<Result>(
    pageFunction: (element: PlaywrightDomControlPort) => Result | Promise<Result>,
  ) {
    const onDocumentEvent = this.onDocumentEvent;
    const result = await pageFunction({
      isConnected: this.connected,
      tagName: this.tagName,
      ownerDocument: {
        defaultView: this.defaultViewAvailable
          ? {
              CustomEvent: class {
                readonly type: string;
                readonly detail: unknown;

                constructor(type: string, init?: { readonly detail?: unknown }) {
                  this.type = type;
                  this.detail = init?.detail;
                }
              },
            }
          : null,
        dispatchEvent: (event) => {
          onDocumentEvent?.(event.type, event.detail);
          return this.documentDispatchResult;
        },
      },
      getAttribute: (name) => this.attributes[name] ?? null,
    });
    this.onEvaluateResult?.(result);
    return result;
  }

  async pressSequentially(
    text: string,
    options?: { readonly delay?: number; readonly timeout?: number },
  ) {
    this.pressSequentiallyCalls.push(options === undefined ? { text } : { text, options });
    this.input += text;
  }

  async blur(options?: { readonly timeout?: number }) {
    this.blurCalls.push(options);
    await this.onBlur?.(options);
  }

  async fill(value: string, options?: { readonly timeout?: number }) {
    this.fillCalls.push(options === undefined ? { value } : { value, options });
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

class FakeRequest implements PlaywrightRequestPort {
  constructor(
    private readonly requestUrl: string,
    private readonly requestMethod: string,
    private readonly body: unknown = null,
  ) {}
  method() {
    return this.requestMethod;
  }
  url() {
    return this.requestUrl;
  }
  postDataJSON() {
    return this.body;
  }
}

class FakeResponse implements PlaywrightResponsePort {
  constructor(
    private readonly responseUrl: string,
    private readonly responseMethod: string,
    private readonly responseStatus: number,
    private readonly body: unknown,
  ) {}
  url() {
    return this.responseUrl;
  }
  status() {
    return this.responseStatus;
  }
  request() {
    return new FakeRequest(this.responseUrl, this.responseMethod);
  }
  async json() {
    if (this.body instanceof Error) throw this.body;
    return this.body;
  }
}

class FakeRoute implements PlaywrightRoutePort {
  continued = 0;
  aborted = 0;
  constructor(private readonly routeRequest: PlaywrightRequestPort) {}
  request() {
    return this.routeRequest;
  }
  async continue() {
    this.continued += 1;
  }
  async abort() {
    this.aborted += 1;
  }
}

function emptyLocator() {
  return new FakeLocator({ visible: false, items: [] });
}

function hiddenExistingLocator() {
  return new FakeLocator({
    visible: false,
    items: [new FakeLocator({ visible: false })],
  });
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
  gotoCalls = 0;
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
  workflowClicks: string[] = [];
  findButtonTrialClickOptions: Array<{
    readonly timeout?: number;
    readonly trial?: boolean;
  }> = [];
  findButtonRealClickOptions: Array<{
    readonly timeout?: number;
    readonly trial?: boolean;
  }> = [];
  resetDocumentEvents: Array<{ readonly type: string; readonly detail: unknown }> = [];
  lookupRequestPlayerIds: string[] = [];
  lookupResponseWaits = 0;
  findButtonTagName = 'BUTTON';
  findButtonConnected = true;
  findButtonEnabled = true;
  findButtonAttributes: Readonly<Record<string, string>> = {};
  findButtonTrialFails = false;
  findButtonNativeValidationCount = 0;
  showFinancialControlsAfterFindValidationCount: number | null = null;
  playerIdPressSequentiallyAvailable = true;
  playerIdBlurAvailable = true;
  playerIdBlurCommits = true;
  playerIdCommittedValue: string | null = null;
  playerDepositOpen = false;
  lookupResolved = false;
  showFinancialControlsDuringSearch = false;
  hiddenFinancialControlDuringSearch: 'amount' | 'notes' | 'transfer' | null = null;
  hideFindBy = false;
  hidePlayerIdInput = false;
  hideFindButton = false;
  identityControlDuplicates: 'hidden' | 'visible' | null = null;
  lookupControlDuplicates: 'hidden' | 'visible' | null = null;
  lookupResponseUrl: string | null = null;
  lookupResponseMethod = 'GET';
  lookupResponseStatus = 200;
  lookupResponseBody: unknown | null = null;
  depositRequestUrl: string = KEMERBET_AGENT_PLAYER_DEPOSIT_URL;
  depositRequestMethod = 'POST';
  depositRequestBody: unknown = { playerId: 78123, amount: 25, notes: '' };
  emitDepositRequest = true;
  lastRoute: FakeRoute | null = null;
  private transferRoute: {
    readonly url: string;
    readonly handler: (route: PlaywrightRoutePort) => Promise<void>;
  } | null = null;
  private pendingLookupResponse: {
    readonly predicate: (response: PlaywrightResponsePort) => boolean;
    readonly resolve: (response: PlaywrightResponsePort) => void;
    readonly reject: (error: Error) => void;
  } | null = null;

  readonly lookup = new FakeLocator({
    children: {
      '#lookup-identity': new FakeLocator({ text: 'player@example.invalid' }),
      '#lookup-currency': new FakeLocator({ text: 'ETB' }),
    },
    onDocumentEvent: (type, detail) => {
      this.resetDocumentEvents.push({ type, detail });
      if (
        type === 'onTransferEposPlayerFoundEvent' &&
        typeof detail === 'object' &&
        detail !== null &&
        !Array.isArray(detail) &&
        Object.keys(detail).length === 1 &&
        'info' in detail &&
        detail.info === null
      ) {
        this.lookupResolved = false;
      }
    },
  });
  readonly preparedAmount = new FakeLocator();
  readonly prepared = new FakeLocator({
    children: {
      '#prepared-identity': new FakeLocator({ text: 'player@example.invalid' }),
      '#prepared-amount': this.preparedAmount,
      '#prepared-currency': new FakeLocator({ text: 'ETB' }),
    },
  });
  readonly findBy = new FakeLocator({ text: 'Player ID' });
  readonly playerIdInput = new FakeLocator({
    onBlur: () => {
      if (this.playerIdBlurCommits) this.playerIdCommittedValue = this.playerIdInput.input;
    },
  });
  readonly notesInput = new FakeLocator();

  private rejectPendingLookupResponse(message: string): void {
    const pending = this.pendingLookupResponse;
    if (pending === null) return;
    this.pendingLookupResponse = null;
    pending.reject(new Error(message));
  }

  private emitLookupResponse(): void {
    const pending = this.pendingLookupResponse;
    if (pending === null) return;
    this.pendingLookupResponse = null;
    const submittedPlayerId = this.playerIdInput.input;
    this.lookupRequestPlayerIds.push(submittedPlayerId);
    const url =
      this.lookupResponseUrl ??
      `${KEMERBET_AGENT_PLAYER_LOOKUP_URL}?externalId=${encodeURIComponent(submittedPlayerId)}`;
    const body =
      this.lookupResponseBody ??
      ({
        value: {
          id: 78123,
          externalId: submittedPlayerId,
          userName: 'player@example.invalid',
          email: 'player@example.invalid',
          currencyCode: 'ETB',
        },
      } as const);
    const response = new FakeResponse(
      url,
      this.lookupResponseMethod,
      this.lookupResponseStatus,
      body,
    );
    if (!pending.predicate(response)) {
      pending.reject(new Error('response did not match'));
      return;
    }
    this.lookupResolved = true;
    pending.resolve(response);
  }

  private withControlDuplicates(
    locator: FakeLocator,
    duplicates: 'hidden' | 'visible' | null,
  ): FakeLocator {
    if (duplicates === null) return locator;
    return new FakeLocator({
      items: [
        new FakeLocator({
          text: locator.text,
          visible: duplicates === 'visible',
        }),
        locator,
      ],
    });
  }

  private withLookupControlDuplicates(locator: FakeLocator): FakeLocator {
    return this.withControlDuplicates(locator, this.lookupControlDuplicates);
  }

  async goto(url: string) {
    this.gotoCalls += 1;
    this.urlValue = this.redirectTo ?? url;
  }

  url() {
    return this.urlValue;
  }

  getByLabel(label: string) {
    if (label === 'Player ID *') {
      if (!this.playerIdPressSequentiallyAvailable) {
        Object.defineProperty(this.playerIdInput, 'pressSequentially', {
          configurable: true,
          value: undefined,
        });
      }
      if (!this.playerIdBlurAvailable) {
        Object.defineProperty(this.playerIdInput, 'blur', {
          configurable: true,
          value: undefined,
        });
      }
      return this.playerDepositOpen && !this.lookupResolved && !this.hidePlayerIdInput
        ? this.withLookupControlDuplicates(this.playerIdInput)
        : emptyLocator();
    }
    if (label === 'Amount *') {
      if (this.lookupResolved || this.showFinancialControlsDuringSearch) {
        return this.preparedAmount;
      }
      return this.hiddenFinancialControlDuringSearch === 'amount'
        ? hiddenExistingLocator()
        : emptyLocator();
    }
    if (label === 'Notes') {
      if (this.lookupResolved || this.showFinancialControlsDuringSearch) return this.notesInput;
      return this.hiddenFinancialControlDuringSearch === 'notes'
        ? hiddenExistingLocator()
        : emptyLocator();
    }
    return emptyLocator();
  }

  getByRole(role: 'button' | 'menuitem', options: { readonly name: string }) {
    if (role === 'menuitem' && options.name === 'Deposit') {
      return new FakeLocator({
        onClick: () => {
          this.workflowClicks.push('menuitem:Deposit');
        },
      });
    }
    if (role === 'button' && options.name === 'Find') {
      if (!this.playerDepositOpen || this.lookupResolved || this.hideFindButton)
        return emptyLocator();
      return this.withLookupControlDuplicates(
        new FakeLocator({
          tagName: this.findButtonTagName,
          connected: this.findButtonConnected,
          enabled: this.findButtonEnabled,
          attributes: this.findButtonAttributes,
          onEvaluateResult: () => {
            this.findButtonNativeValidationCount += 1;
            if (
              this.showFinancialControlsAfterFindValidationCount ===
              this.findButtonNativeValidationCount
            ) {
              this.showFinancialControlsDuringSearch = true;
            }
          },
          onTrialClick: (options) => {
            this.findButtonTrialClickOptions.push(options ?? {});
            if (this.findButtonTrialFails) {
              throw new Error('persistent overlay prevented the trial Find click');
            }
          },
          onClick: (options) => {
            const followsGuardedTrial =
              this.findButtonTrialClickOptions.length > this.findButtonRealClickOptions.length;
            this.findButtonRealClickOptions.push(options ?? {});
            if (followsGuardedTrial && this.playerIdCommittedValue !== this.playerIdInput.input) {
              this.rejectPendingLookupResponse('Player ID form value was not committed');
              return;
            }
            this.workflowClicks.push('button:Find');
            this.emitLookupResponse();
          },
        }),
      );
    }
    if (role === 'button' && options.name === 'Transfer') {
      if (!this.lookupResolved && !this.showFinancialControlsDuringSearch) {
        return this.hiddenFinancialControlDuringSearch === 'transfer'
          ? hiddenExistingLocator()
          : emptyLocator();
      }
      return new FakeLocator({
        onClick: async () => {
          this.transferClicks += 1;
          if (!this.emitDepositRequest) return;
          const registration = this.transferRoute;
          if (registration === null || registration.url !== KEMERBET_AGENT_PLAYER_DEPOSIT_URL)
            return;
          const route = new FakeRoute(
            new FakeRequest(
              this.depositRequestUrl,
              this.depositRequestMethod,
              this.depositRequestBody,
            ),
          );
          this.lastRoute = route;
          await registration.handler(route);
        },
      });
    }
    return emptyLocator();
  }

  getByText(text: string) {
    return text === 'To Player'
      ? new FakeLocator({
          onClick: () => {
            this.workflowClicks.push('text:To Player');
            this.playerDepositOpen = true;
            this.lookupResolved = false;
          },
        })
      : emptyLocator();
  }

  waitForResponse(predicate: (response: PlaywrightResponsePort) => boolean) {
    this.lookupResponseWaits += 1;
    if (this.pendingLookupResponse !== null) {
      return Promise.reject(new Error('lookup response already pending'));
    }
    return new Promise<PlaywrightResponsePort>((resolve, reject) => {
      this.pendingLookupResponse = { predicate, resolve, reject };
    });
  }

  async route(url: string, handler: (route: PlaywrightRoutePort) => Promise<void>) {
    this.transferRoute = { url, handler };
  }

  async unroute(url: string, handler: (route: PlaywrightRoutePort) => Promise<void>) {
    if (this.transferRoute?.url === url && this.transferRoute.handler === handler) {
      this.transferRoute = null;
    }
  }

  locator(selector: string): FakeLocator {
    if (selector === '#captcha') return this.captcha ? new FakeLocator() : emptyLocator();
    if (selector === '#sign-in') return this.signIn ? new FakeLocator() : emptyLocator();
    if (selector === '#signed-in-agent') {
      if (this.identityDelayPolls > 0) {
        this.identityDelayPolls -= 1;
        return emptyLocator();
      }
      return this.withControlDuplicates(
        new FakeLocator({
          children: {
            '#signed-in-agent-value': new FakeLocator({ text: this.rawAgentIdentity }),
          },
        }),
        this.identityControlDuplicates,
      );
    }
    if (selector === '#financial-actions') {
      return new FakeLocator({
        onClick: () => {
          this.workflowClicks.push(selector);
        },
      });
    }
    if (selector === '#find-by-selected-value') {
      return this.playerDepositOpen && !this.lookupResolved && !this.hideFindBy
        ? this.withLookupControlDuplicates(this.findBy)
        : emptyLocator();
    }
    if (selector === '#lookup') {
      if (!this.lookupResolved) return emptyLocator();
      if (this.lookupDelayPolls > 0) {
        this.lookupDelayPolls -= 1;
        return emptyLocator();
      }
      return this.lookup;
    }
    if (selector === '#prepared') return this.lookupResolved ? this.prepared : emptyLocator();
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

async function prepareExactPlayer(fixture: ReturnType<typeof driver>) {
  await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
  await fixture.driver.openPlayerDeposit();
  await fixture.driver.lookupPlayer('PLAYER-ALPHA');
  await fixture.driver.readAgentLookup();
  await fixture.driver.fillDeposit('25.00', '');
  await fixture.driver.readAgentPreparedDeposit();
}

describe('Playwright KemerBet agent page', () => {
  it('adopts the current authenticated deposit page without navigation or reload', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    const fixture = driver(page);

    await expect(
      fixture.driver.adoptCurrentDepositPageWithoutNavigation(),
    ).resolves.toBeUndefined();

    expect(page.gotoCalls).toBe(0);
    await expect(fixture.driver.currentUrl()).resolves.toBe(KEMERBET_AGENT_DEPOSIT_URL);
  });

  it('reuses an already-open exact Player-ID lookup surface without reopening the workflow', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    const fixture = driver(page);

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await fixture.driver.openPlayerDeposit();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-ALPHA',
    });
    await fixture.driver.openPlayerDeposit();
    await fixture.driver.lookupPlayer('PLAYER-BETA');
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-BETA',
    });

    expect(page.gotoCalls).toBe(0);
    expect(page.workflowClicks).toEqual([
      'button:Find',
      '#financial-actions',
      'menuitem:Deposit',
      'text:To Player',
      'button:Find',
    ]);
    expect(page.findButtonTrialClickOptions).toEqual([]);
    expect(page.findButtonRealClickOptions).toEqual([{ timeout: 100 }, { timeout: 100 }]);
    expect(page.playerIdInput.fillCalls).toEqual([
      { value: 'PLAYER-ALPHA', options: { timeout: 100 } },
      { value: 'PLAYER-BETA', options: { timeout: 100 } },
    ]);
    expect(page.playerIdInput.pressSequentiallyCalls).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it('keystroke-feeds, blur-commits, actionability-checks, and performs one reviewed native Find click when explicitly requested', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    const stages: string[] = [];
    const fixture = driver(page, {
      activateReadOnlyLookupWithGuardedNativeClick: true,
      reportLookupStage: (stage: string) => stages.push(stage),
    });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-ALPHA',
    });

    expect(page.findButtonTrialClickOptions).toEqual([{ timeout: 100, trial: true }]);
    expect(page.findButtonRealClickOptions).toEqual([{ timeout: 100 }]);
    expect(page.playerIdInput.fillCalls).toEqual([{ value: '', options: { timeout: 100 } }]);
    expect(page.playerIdInput.pressSequentiallyCalls).toEqual([
      { text: 'PLAYER-ALPHA', options: { delay: 10, timeout: 100 } },
    ]);
    expect(page.playerIdInput.blurCalls).toEqual([{ timeout: 100 }]);
    expect(page.playerIdCommittedValue).toBe('PLAYER-ALPHA');
    expect(page.lookupRequestPlayerIds).toEqual(['PLAYER-ALPHA']);
    expect(page.lookupResponseWaits).toBe(1);
    expect(page.workflowClicks).toEqual(['button:Find']);
    expect(stages).toEqual([
      'lookup_input',
      'lookup_input_blurred',
      'lookup_action',
      'lookup_click_actionability',
      'lookup_native_click',
      'lookup_response',
      'lookup_contract',
    ]);
    expect(page.transferClicks).toBe(0);
  });

  it('performs two consecutive readiness lookups by clearing, keystroke-feeding, and exactly resetting without financial input', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.playerIdInput.input = 'STALE-PLAYER';
    const fixture = driver(page, { activateReadOnlyLookupWithGuardedNativeClick: true });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-ALPHA',
    });
    await fixture.driver.resetReadOnlyPlayerLookup();
    await fixture.driver.lookupPlayer('PLAYER-BETA');
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-BETA',
    });

    expect(page.playerIdInput.fillCalls).toEqual([
      { value: '', options: { timeout: 100 } },
      { value: '', options: { timeout: 100 } },
    ]);
    expect(page.playerIdInput.pressSequentiallyCalls).toEqual([
      { text: 'PLAYER-ALPHA', options: { delay: 10, timeout: 100 } },
      { text: 'PLAYER-BETA', options: { delay: 10, timeout: 100 } },
    ]);
    expect(page.playerIdInput.blurCalls).toEqual([{ timeout: 100 }, { timeout: 100 }]);
    expect(page.lookupRequestPlayerIds).toEqual(['PLAYER-ALPHA', 'PLAYER-BETA']);
    expect(page.workflowClicks).toEqual(['button:Find', 'button:Find']);
    expect(page.findButtonTrialClickOptions).toEqual([
      { timeout: 100, trial: true },
      { timeout: 100, trial: true },
    ]);
    expect(page.findButtonRealClickOptions).toEqual([{ timeout: 100 }, { timeout: 100 }]);
    expect(page.lookupResponseWaits).toBe(2);
    expect(page.resetDocumentEvents).toEqual([
      { type: 'onTransferEposPlayerFoundEvent', detail: { info: null } },
    ]);
    expect(page.preparedAmount.fillCalls).toEqual([]);
    expect(page.preparedAmount.input).toBe('');
    expect(page.notesInput.fillCalls).toEqual([]);
    expect(page.notesInput.input).toBe('');
    expect(page.transferClicks).toBe(0);
  });

  it('fails closed instead of clicking Find from a non-native role', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.findButtonTagName = 'DIV';
    const fixture = driver(page, { activateReadOnlyLookupWithGuardedNativeClick: true });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.findButtonTrialClickOptions).toEqual([]);
    expect(page.findButtonRealClickOptions).toEqual([]);
    expect(page.lookupResponseWaits).toBe(0);
    expect(page.transferClicks).toBe(0);
  });

  it('fails closed before creating a lookup response wait when keystroke input is unavailable', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.playerIdPressSequentiallyAvailable = false;
    const fixture = driver(page, { activateReadOnlyLookupWithGuardedNativeClick: true });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.playerIdInput.fillCalls).toEqual([]);
    expect(page.playerIdInput.pressSequentiallyCalls).toEqual([]);
    expect(page.findButtonTrialClickOptions).toEqual([]);
    expect(page.findButtonRealClickOptions).toEqual([]);
    expect(page.lookupResponseWaits).toBe(0);
    expect(page.lookupRequestPlayerIds).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it('fails closed before activation when the exact Player-ID input cannot be blurred', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.playerIdBlurAvailable = false;
    const fixture = driver(page, { activateReadOnlyLookupWithGuardedNativeClick: true });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.playerIdInput.fillCalls).toEqual([]);
    expect(page.playerIdInput.pressSequentiallyCalls).toEqual([]);
    expect(page.playerIdInput.blurCalls).toEqual([]);
    expect(page.findButtonTrialClickOptions).toEqual([]);
    expect(page.findButtonRealClickOptions).toEqual([]);
    expect(page.lookupResponseWaits).toBe(0);
    expect(page.lookupRequestPlayerIds).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it('keeps the trial click actionability-only and fails closed when blur does not commit the exact Player-ID form value', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.playerIdBlurCommits = false;
    const fixture = driver(page, { activateReadOnlyLookupWithGuardedNativeClick: true });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.playerIdInput.blurCalls).toEqual([{ timeout: 100 }]);
    expect(page.playerIdCommittedValue).toBeNull();
    expect(page.findButtonTrialClickOptions).toEqual([{ timeout: 100, trial: true }]);
    expect(page.findButtonRealClickOptions).toEqual([{ timeout: 100 }]);
    expect(page.lookupResponseWaits).toBe(1);
    expect(page.lookupRequestPlayerIds).toEqual([]);
    expect(page.workflowClicks).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it('fails closed without activating Find when financial controls share the search phase', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.showFinancialControlsDuringSearch = true;
    const fixture = driver(page, { activateReadOnlyLookupWithGuardedNativeClick: true });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.findButtonTrialClickOptions).toEqual([]);
    expect(page.findButtonRealClickOptions).toEqual([]);
    expect(page.lookupResponseWaits).toBe(0);
    expect(page.lookupRequestPlayerIds).toEqual([]);
    expect(page.preparedAmount.fillCalls).toEqual([]);
    expect(page.notesInput.fillCalls).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it.each<readonly ['amount' | 'notes' | 'transfer']>([['amount'], ['notes'], ['transfer']])(
    'fails closed before actionability when the hidden %s financial control remains in the search DOM',
    async (hiddenControl) => {
      const page = new FakePage();
      page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
      page.playerDepositOpen = true;
      page.hiddenFinancialControlDuringSearch = hiddenControl;
      const fixture = driver(page, {
        activateReadOnlyLookupWithGuardedNativeClick: true,
      });

      await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
      await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
        KemerBetDepositBrowserUnavailableError,
      );

      expect(page.findButtonTrialClickOptions).toEqual([]);
      expect(page.findButtonRealClickOptions).toEqual([]);
      expect(page.lookupResponseWaits).toBe(0);
      expect(page.lookupRequestPlayerIds).toEqual([]);
      expect(page.preparedAmount.fillCalls).toEqual([]);
      expect(page.notesInput.fillCalls).toEqual([]);
      expect(page.transferClicks).toBe(0);
    },
  );

  it('fails closed when a persistent overlay blocks the trial click and never starts the response waiter or real click', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.findButtonTrialFails = true;
    const stages: string[] = [];
    const fixture = driver(page, {
      activateReadOnlyLookupWithGuardedNativeClick: true,
      reportLookupStage: (stage: string) => stages.push(stage),
    });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.findButtonTrialClickOptions).toEqual([{ timeout: 100, trial: true }]);
    expect(page.findButtonRealClickOptions).toEqual([]);
    expect(page.lookupResponseWaits).toBe(0);
    expect(page.lookupRequestPlayerIds).toEqual([]);
    expect(page.workflowClicks).toEqual([]);
    expect(stages).toEqual([
      'lookup_input',
      'lookup_input_blurred',
      'lookup_action',
      'lookup_click_actionability',
    ]);
    expect(page.transferClicks).toBe(0);
  });

  it('re-proves financial-control absence after the final native validation and before the real click', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.showFinancialControlsAfterFindValidationCount = 2;
    const fixture = driver(page, {
      activateReadOnlyLookupWithGuardedNativeClick: true,
    });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.findButtonNativeValidationCount).toBe(2);
    expect(page.findButtonTrialClickOptions).toEqual([{ timeout: 100, trial: true }]);
    expect(page.findButtonRealClickOptions).toEqual([]);
    expect(page.lookupResponseWaits).toBe(0);
    expect(page.lookupRequestPlayerIds).toEqual([]);
    expect(page.workflowClicks).toEqual([]);
    expect(page.preparedAmount.fillCalls).toEqual([]);
    expect(page.notesInput.fillCalls).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it.each<readonly [string, (page: FakePage) => void]>([
    [
      'a disconnected native Find control',
      (page) => {
        page.findButtonConnected = false;
      },
    ],
    [
      'a disabled native Find control',
      (page) => {
        page.findButtonAttributes = { disabled: '' };
      },
    ],
    [
      'a native Find control Playwright reports as disabled',
      (page) => {
        page.findButtonEnabled = false;
      },
    ],
    [
      'an aria-disabled native Find control',
      (page) => {
        page.findButtonAttributes = { 'aria-disabled': 'true' };
      },
    ],
  ])('fails closed for %s', async (_name, mutate) => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    mutate(page);
    const fixture = driver(page, { activateReadOnlyLookupWithGuardedNativeClick: true });

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.findButtonTrialClickOptions).toEqual([]);
    expect(page.findButtonRealClickOptions).toEqual([]);
    expect(page.lookupResponseWaits).toBe(0);
    expect(page.lookupRequestPlayerIds).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it('uses the one visible reviewed lookup control when Ant retains hidden duplicates', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.lookupControlDuplicates = 'hidden';
    const fixture = driver(page);

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await fixture.driver.openPlayerDeposit();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-ALPHA',
    });

    expect(page.gotoCalls).toBe(0);
    expect(page.workflowClicks).toEqual(['button:Find']);
    expect(page.transferClicks).toBe(0);
  });

  it('fails closed when more than one reviewed lookup control is visible', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.lookupControlDuplicates = 'visible';
    const fixture = driver(page);

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.openPlayerDeposit()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.gotoCalls).toBe(0);
    expect(page.workflowClicks).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it('fails closed on a partial Player-ID lookup surface instead of clicking through it', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.playerDepositOpen = true;
    page.hideFindButton = true;
    const fixture = driver(page);

    await fixture.driver.adoptCurrentDepositPageWithoutNavigation();
    await expect(fixture.driver.openPlayerDeposit()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    expect(page.gotoCalls).toBe(0);
    expect(page.workflowClicks).toEqual([]);
    expect(page.transferClicks).toBe(0);
  });

  it('returns only a stable keyed identity fingerprint from the exact authenticated route', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;

    await expect(
      observeKemerBetAgentIdentityFingerprint({
        page,
        platformAgentAccountId: PLATFORM_AGENT_ACCOUNT_ID,
        selectorContract: contract,
        fingerprintAgentIdentity,
        timeoutMs: 100,
        pollDelay: async () => undefined,
      }),
    ).resolves.toBe(AGENT_IDENTITY_FINGERPRINT);
  });

  it('reports only fixed identity-observation stages', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    const stages: string[] = [];

    await observeKemerBetAgentIdentityFingerprint({
      page,
      platformAgentAccountId: PLATFORM_AGENT_ACCOUNT_ID,
      selectorContract: contract,
      fingerprintAgentIdentity,
      reportStage: (stage) => stages.push(stage),
      timeoutMs: 100,
      pollDelay: async () => undefined,
    });

    expect(stages).toEqual([
      'session_guard',
      'identity_marker',
      'identity_value',
      'session_guard',
      'identity_marker',
      'identity_value',
      'identity_stability',
      'session_guard',
    ]);
    expect(JSON.stringify(stages)).not.toMatch(/agent-one|hmac-sha256|44444444/iu);
  });

  it('accepts one visible authenticated identity marker beside hidden retained markup', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.identityControlDuplicates = 'hidden';

    await expect(
      observeKemerBetAgentIdentityFingerprint({
        page,
        platformAgentAccountId: PLATFORM_AGENT_ACCOUNT_ID,
        selectorContract: contract,
        fingerprintAgentIdentity,
        timeoutMs: 100,
        pollDelay: async () => undefined,
      }),
    ).resolves.toBe(AGENT_IDENTITY_FINGERPRINT);
  });

  it('rejects more than one visible authenticated identity marker', async () => {
    const page = new FakePage();
    page.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    page.identityControlDuplicates = 'visible';

    await expect(
      observeKemerBetAgentIdentityFingerprint({
        page,
        platformAgentAccountId: PLATFORM_AGENT_ACCOUNT_ID,
        selectorContract: contract,
        fingerprintAgentIdentity,
        timeoutMs: 100,
        pollDelay: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
  });

  it('rejects a session-failure surface or identity drift while sealing a binding', async () => {
    const challenged = new FakePage();
    challenged.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    challenged.signIn = true;
    await expect(
      observeKemerBetAgentIdentityFingerprint({
        page: challenged,
        platformAgentAccountId: PLATFORM_AGENT_ACCOUNT_ID,
        selectorContract: contract,
        fingerprintAgentIdentity,
        timeoutMs: 100,
        pollDelay: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);

    const drifting = new FakePage();
    drifting.urlValue = KEMERBET_AGENT_DEPOSIT_URL;
    let observations = 0;
    const driftingFingerprinter = Object.assign(
      () => {
        observations += 1;
        return observations === 1 ? AGENT_IDENTITY_FINGERPRINT : OTHER_AGENT_IDENTITY_FINGERPRINT;
      },
      { keyFingerprint: 'f'.repeat(64) },
    ) as KemerBetAgentIdentityFingerprinter;
    await expect(
      observeKemerBetAgentIdentityFingerprint({
        page: drifting,
        platformAgentAccountId: PLATFORM_AGENT_ACCOUNT_ID,
        selectorContract: contract,
        fingerprintAgentIdentity: driftingFingerprinter,
        timeoutMs: 100,
        pollDelay: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(KemerBetDepositBrowserUnavailableError);
  });

  it('validates an untrusted selector contract without opening a browser', () => {
    expect(() => assertKemerBetAgentPageSelectorContractV2(contract)).not.toThrow();
    expect(() =>
      assertKemerBetAgentPageSelectorContractV2({
        ...contract,
        history: { ...contract.history, columns: { ...contract.history.columns, amount: '' } },
      }),
    ).toThrow(KemerBetDepositBrowserUnavailableError);
    expect(() => assertKemerBetAgentPageSelectorContractV2(null)).toThrow(
      KemerBetDepositBrowserUnavailableError,
    );
    expect(() =>
      assertKemerBetAgentPageSelectorContractV2({ ...contract, unexpectedFallback: '#body' }),
    ).toThrow(KemerBetDepositBrowserUnavailableError);
  });

  it.each([
    'https://agentsystem.admindigi.com/payments/requests',
    'https://agentsystem.admindigi.com/agents/',
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

  it('uses only the reviewed /agents controls and can stop after an exact no-transfer lookup', async () => {
    const fixture = driver();
    await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await fixture.driver.openPlayerDeposit();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');

    await expect(fixture.driver.readAgentLookup()).resolves.toEqual({
      playerId: 'PLAYER-ALPHA',
      currencyCode: 'ETB',
    });
    expect(fixture.page.workflowClicks).toEqual([
      '#financial-actions',
      'menuitem:Deposit',
      'text:To Player',
      'button:Find',
    ]);
    expect(fixture.page.transferClicks).toBe(0);
  });

  it.each<readonly [string, (page: FakePage) => void]>([
    [
      'wrong API origin',
      (page) => {
        page.lookupResponseUrl =
          'https://untrusted.invalid/Player/GeneralInfoByExternalId?externalId=PLAYER-ALPHA';
      },
    ],
    [
      'wrong API path',
      (page) => {
        page.lookupResponseUrl =
          'https://admin-api.agt-digi.com/Player/Other?externalId=PLAYER-ALPHA';
      },
    ],
    [
      'wrong method',
      (page) => {
        page.lookupResponseMethod = 'POST';
      },
    ],
    [
      'non-success status',
      (page) => {
        page.lookupResponseStatus = 404;
      },
    ],
    [
      'duplicate query key',
      (page) => {
        page.lookupResponseUrl = `${KEMERBET_AGENT_PLAYER_LOOKUP_URL}?externalId=PLAYER-ALPHA&externalId=PLAYER-ALPHA`;
      },
    ],
    [
      'mismatched external Player ID',
      (page) => {
        page.lookupResponseBody = exactLookupBody({ externalId: 'PLAYER-SWAPPED' });
      },
    ],
    [
      'invalid internal player ID',
      (page) => {
        page.lookupResponseBody = exactLookupBody({ id: 0 });
      },
    ],
    [
      'wrong currency',
      (page) => {
        page.lookupResponseBody = exactLookupBody({ currencyCode: 'USD' });
      },
    ],
    [
      'missing resolved identities',
      (page) => {
        page.lookupResponseBody = exactLookupBody({ userName: null, email: null });
      },
    ],
    [
      'invalid JSON',
      (page) => {
        page.lookupResponseBody = new Error('invalid JSON');
      },
    ],
  ])('rejects an authoritative lookup response with %s', async (_name, mutate) => {
    const fixture = driver();
    mutate(fixture.page);
    await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await fixture.driver.openPlayerDeposit();
    await expect(fixture.driver.lookupPlayer('PLAYER-ALPHA')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
    expect(fixture.page.transferClicks).toBe(0);
  });

  it('rejects a visible resolved identity or Find By label that drifts from authority', async () => {
    const identity = driver();
    await identity.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await identity.driver.openPlayerDeposit();
    await identity.driver.lookupPlayer('PLAYER-ALPHA');
    identity.page.lookup.children['#lookup-identity']!.text = 'swapped@example.invalid';
    await expect(identity.driver.readAgentLookup()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );

    const findBy = driver();
    findBy.page.findBy.text = 'Email';
    await findBy.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await expect(findBy.driver.openPlayerDeposit()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('continues only the exact internal-player ETB deposit request after the final click', async () => {
    const fixture = driver();
    await prepareExactPlayer(fixture);
    await fixture.driver.transferOnce();
    expect(fixture.page.lastRoute).toMatchObject({ continued: 1, aborted: 0 });
  });

  it.each<readonly [string, (page: FakePage) => void]>([
    [
      'wrong internal player',
      (page) => {
        page.depositRequestBody = { playerId: 78124, amount: 25, notes: '' };
      },
    ],
    [
      'wrong amount',
      (page) => {
        page.depositRequestBody = { playerId: 78123, amount: 26, notes: '' };
      },
    ],
    [
      'nonempty notes',
      (page) => {
        page.depositRequestBody = { playerId: 78123, amount: 25, notes: 'unsafe' };
      },
    ],
    [
      'extra body field',
      (page) => {
        page.depositRequestBody = { playerId: 78123, amount: 25, notes: '', extra: true };
      },
    ],
    [
      'wrong method',
      (page) => {
        page.depositRequestMethod = 'PUT';
      },
    ],
    [
      'wrong endpoint',
      (page) => {
        page.depositRequestUrl = 'https://admin-api.agt-digi.com/Wallet/Other';
      },
    ],
  ])('aborts a transfer request with %s before network continuation', async (_name, mutate) => {
    const fixture = driver();
    mutate(fixture.page);
    await prepareExactPlayer(fixture);
    await expect(fixture.driver.transferOnce()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
    expect(fixture.page.lastRoute).toMatchObject({ continued: 0, aborted: 1 });
  });

  it('fails closed when the Transfer click produces no exact request', async () => {
    const fixture = driver();
    fixture.page.emitDepositRequest = false;
    await prepareExactPlayer(fixture);
    await expect(fixture.driver.transferOnce()).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
    expect(fixture.page.lastRoute).toBeNull();
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
    await expect(fixture.driver.fillDeposit('25.00', '')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });

  it('reads only structured lookup, prepared-target, and success-modal facts', async () => {
    const fixture = driver();
    await fixture.driver.goto(KEMERBET_AGENT_DEPOSIT_URL);
    await fixture.driver.openPlayerDeposit();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');
    await expect(fixture.driver.readAgentLookup()).resolves.toEqual({
      playerId: 'PLAYER-ALPHA',
      currencyCode: 'ETB',
    });
    await fixture.driver.fillDeposit('25.00', '');
    await expect(fixture.driver.readAgentPreparedDeposit()).resolves.toEqual({
      playerId: 'PLAYER-ALPHA',
      amountText: '25.00',
      currencyCode: 'ETB',
    });
    await fixture.driver.transferOnce();
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
    await fixture.driver.openPlayerDeposit();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');
    await expect(fixture.driver.readAgentLookup()).resolves.toMatchObject({
      playerId: 'PLAYER-ALPHA',
    });
    await fixture.driver.fillDeposit('25.00', '');
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
    await fixture.driver.openPlayerDeposit();
    await fixture.driver.lookupPlayer('PLAYER-ALPHA');
    await fixture.driver.readAgentLookup();
    await fixture.driver.fillDeposit('25.00', '');
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
      await fixture.driver.openPlayerDeposit();
      await fixture.driver.lookupPlayer('PLAYER-ALPHA');
      await fixture.driver.readAgentLookup();
      await fixture.driver.fillDeposit('25.00', '');
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
    await expect(route.driver.fillDeposit('25.00', '')).rejects.toBeInstanceOf(
      KemerBetDepositBrowserUnavailableError,
    );
  });
});
