import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createKemerBetAgentSessionRegistry,
  type KemerBetAgentSessionRegistryFileSystem,
  type KemerBetPersistentContextLauncher,
  type KemerBetPersistentContextPort,
} from './kemerbet-agent-session-registry.js';
import type { KemerBetAgentIdentityFingerprinter } from './kemerbet-agent-identity-fingerprint.js';
import type { KemerBetHistoryReferenceFingerprinter } from './kemerbet-history-reference-fingerprint.js';
import type { KemerBetDepositExecutionLease } from './kemerbet-deposit-types.js';
import {
  KEMERBET_AGENT_DEPOSIT_URL,
  type KemerBetAgentPageSelectorContractV2,
  type PlaywrightLocatorPort,
  type PlaywrightPagePort,
  type PlaywrightResponsePort,
  type PlaywrightRoutePort,
} from './playwright-kemerbet-agent-page.js';

const ACCOUNT_ONE = '44444444-4444-4444-8444-444444444441';
const ACCOUNT_TWO = '44444444-4444-4444-8444-444444444442';
const PROFILES_ROOT = resolve('test-kemerbet-agent-profiles');
const EXECUTABLE_PATH = resolve('test-browser', 'chromium');
const RAW_AGENT_IDENTITY = 'agent-one@example.invalid';
const RAW_AGENT_IDENTITY_TWO = 'agent-two@example.invalid';
const AGENT_IDENTITY_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'c'.repeat(64)}`;
const OTHER_AGENT_IDENTITY_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'d'.repeat(64)}`;
const INVALID_AGENT_IDENTITY_FINGERPRINT = `hmac-sha256-agent-identity-v1:${'e'.repeat(64)}`;

const selectorContract: KemerBetAgentPageSelectorContractV2 = {
  version: 2,
  depositWorkflow: {
    financialActionsTrigger: { by: 'css', selector: '#financial-actions' },
    depositMenuItem: { by: 'role', role: 'menuitem', name: 'Deposit' },
    toPlayerTile: { by: 'text', text: 'To Player' },
    findBySelectedValue: { by: 'css', selector: '#find-by' },
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
    resolvedIdentity: { selector: '#player', source: 'text' },
    currencyCode: { selector: '#currency', source: 'text' },
  },
  preparedDeposit: {
    root: '#prepared',
    resolvedIdentity: { selector: '#player', source: 'text' },
    amount: { selector: '#amount', source: 'input' },
    currencyCode: { selector: '#currency', source: 'text' },
  },
  transferResult: {
    dialog: '#dialog',
    title: { selector: '#title', source: 'text' },
    playerCreditFact: { selector: '#credit', source: 'text' },
  },
  history: {
    table: '#history',
    headerCells: 'th',
    bodyRows: 'tr',
    rowCells: 'td',
    nextButton: '#next',
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
  sessionFailure: { captcha: '#captcha', signInForm: '#sign-in' },
};

function pathFor(accountId: string) {
  return resolve(PROFILES_ROOT, accountId);
}

function executionLease(): KemerBetDepositExecutionLease {
  return {
    disposition: 'execution',
    phase: 'execute',
    depositIntentId: '11111111-1111-4111-8111-111111111111',
    executionJobId: '22222222-2222-4222-8222-222222222222',
    executionAttemptId: '33333333-3333-4333-8333-333333333333',
    platformAgentAccountId: ACCOUNT_ONE,
    leaseToken: '55555555-5555-4555-8555-555555555555',
    leaseExpiresAt: new Date('2030-01-02T03:09:05.000Z'),
    target: { operation: 'deposit', playerId: '90210473', amountMinor: 2_500, currencyCode: 'ETB' },
    privateLiveDepositPilotAuthorization: {
      contractVersion: 1,
      pilotRevisionId: '66666666-6666-4666-8666-666666666661',
      pilotReservationId: '66666666-6666-4666-8666-666666666662',
      configurationDigest: `sha256:${'6'.repeat(64)}`,
      authorizationToken: '66666666-6666-4666-8666-666666666663',
    },
  };
}

interface FakeFileSystemOptions {
  readonly accounts?: readonly string[];
  readonly profileSymlink?: boolean;
  readonly rootRealpath?: string;
  readonly profileRealpath?: string;
  readonly rootMode?: number;
  readonly rootUid?: number;
  readonly profileMode?: number;
  readonly profileUid?: number;
  readonly rootInode?: number;
  readonly profileInode?: number;
}

function fakeFileSystem(options: FakeFileSystemOptions = {}) {
  const accounts = new Set(options.accounts ?? [ACCOUNT_ONE]);
  let reads = 0;
  let rootMode = options.rootMode ?? 0o755;
  let rootInode = options.rootInode ?? 10;
  let profileMode = options.profileMode ?? 0o700;
  let profileInode = options.profileInode ?? 20;
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const directory = (symlink: boolean, uid: number, mode: number, inode: number) => ({
    size: 0,
    mode,
    uid,
    dev: 1,
    ino: inode,
    mtimeMs: inode * 100,
    isDirectory: () => !symlink,
    isFile: () => false,
    isSymbolicLink: () => symlink,
  });
  const fileSystem: KemerBetAgentSessionRegistryFileSystem = {
    async lstat(path) {
      reads += 1;
      if (path === PROFILES_ROOT) {
        return directory(false, options.rootUid ?? 1_000, rootMode, rootInode);
      }
      const accountId = [...accounts].find((candidate) => path === pathFor(candidate));
      if (accountId !== undefined) {
        return directory(
          options.profileSymlink ?? false,
          options.profileUid ?? 1_000,
          profileMode,
          profileInode,
        );
      }
      throw missing();
    },
    async realpath(path) {
      reads += 1;
      if (path === PROFILES_ROOT && options.rootRealpath !== undefined) {
        return options.rootRealpath;
      }
      if (path !== PROFILES_ROOT && options.profileRealpath !== undefined) {
        return options.profileRealpath;
      }
      return path;
    },
  };
  return {
    fileSystem,
    get reads() {
      return reads;
    },
    setRootInode(value: number) {
      rootInode = value;
    },
    setRootMode(value: number) {
      rootMode = value;
    },
    setProfileInode(value: number) {
      profileInode = value;
    },
    setProfileMode(value: number) {
      profileMode = value;
    },
    removeAccount(accountId: string) {
      accounts.delete(accountId);
    },
    addAccount(accountId: string) {
      accounts.add(accountId);
    },
  };
}

class EmptyLocator implements PlaywrightLocatorPort {
  locator(_selector: string): PlaywrightLocatorPort {
    return this;
  }
  nth(_index: number): PlaywrightLocatorPort {
    return this;
  }
  async count() {
    return 0;
  }
  async click() {}
  async fill() {}
  async selectOption() {
    return [];
  }
  async inputValue() {
    return '';
  }
  async innerText() {
    return '';
  }
  async isVisible() {
    return false;
  }
  async isEnabled() {
    return false;
  }
  async getAttribute() {
    return null;
  }
}

class VisibleTextLocator extends EmptyLocator {
  constructor(
    private readonly text: string,
    private readonly childSelector?: string,
  ) {
    super();
  }
  override locator(selector: string): PlaywrightLocatorPort {
    return selector === this.childSelector ? new VisibleTextLocator(this.text) : new EmptyLocator();
  }
  override nth(index: number): PlaywrightLocatorPort {
    return index === 0 ? this : new EmptyLocator();
  }
  override async count() {
    return 1;
  }
  override async innerText() {
    return this.text;
  }
  override async isVisible() {
    return true;
  }
  override async isEnabled() {
    return true;
  }
}

class FakePage implements PlaywrightPagePort {
  closed = 0;
  gotoCount = 0;
  financialLocatorRequests = 0;
  private currentUrl: string;
  constructor(
    initialUrl = 'about:blank',
    public rawAgentIdentity: string | null = RAW_AGENT_IDENTITY,
    private navigationUrlOverride: string | null = null,
    private visibleSessionFailureSelector: string | null = null,
  ) {
    this.currentUrl = initialUrl;
  }
  async goto(url: string) {
    this.gotoCount += 1;
    this.currentUrl = this.navigationUrlOverride ?? url;
  }
  url() {
    return this.currentUrl;
  }
  getByRole() {
    this.financialLocatorRequests += 1;
    return new EmptyLocator();
  }
  getByLabel() {
    this.financialLocatorRequests += 1;
    return new EmptyLocator();
  }
  getByText() {
    this.financialLocatorRequests += 1;
    return new EmptyLocator();
  }
  async waitForResponse(
    _predicate: (response: PlaywrightResponsePort) => boolean,
    _options: { readonly timeout: number },
  ): Promise<PlaywrightResponsePort> {
    throw new Error('not used by session registry tests');
  }
  async route(
    _url: string,
    _handler: (route: PlaywrightRoutePort) => Promise<void>,
  ): Promise<void> {}
  async unroute(
    _url: string,
    _handler: (route: PlaywrightRoutePort) => Promise<void>,
  ): Promise<void> {}
  locator(selector: string) {
    if (selector === this.visibleSessionFailureSelector) return new VisibleTextLocator('present');
    if (
      selector === selectorContract.signedInAgentIdentity.root &&
      this.rawAgentIdentity !== null
    ) {
      return new VisibleTextLocator(
        this.rawAgentIdentity,
        selectorContract.signedInAgentIdentity.value.selector,
      );
    }
    return new EmptyLocator();
  }
  async close() {
    this.closed += 1;
  }
  showSessionFailure(selector: string | null) {
    this.visibleSessionFailureSelector = selector;
  }
  overrideNavigationUrl(url: string | null) {
    this.navigationUrlOverride = url;
  }
}

class FakeContext implements KemerBetPersistentContextPort {
  closed = 0;
  readonly pageListeners: ((page: PlaywrightPagePort) => void)[] = [];
  readonly closeListeners: (() => void)[] = [];
  constructor(readonly pageList: FakePage[] = [new FakePage()]) {}
  pages() {
    return this.pageList;
  }
  async newPage() {
    const page = new FakePage();
    this.pageList.push(page);
    return page;
  }
  async close() {
    this.closed += 1;
    for (const listener of this.closeListeners) listener();
  }
  on(event: 'close' | 'page', listener: (() => void) | ((page: PlaywrightPagePort) => void)) {
    if (event === 'close') this.closeListeners.push(listener as () => void);
    else this.pageListeners.push(listener as (page: PlaywrightPagePort) => void);
  }
  openPopup(page = new FakePage()) {
    for (const listener of this.pageListeners) listener(page);
    return page;
  }
}

function fakeLauncher(
  contextFactory: (directory: string) => FakeContext = (directory) =>
    new FakeContext([
      new FakePage(
        'about:blank',
        directory === pathFor(ACCOUNT_TWO) ? RAW_AGENT_IDENTITY_TWO : RAW_AGENT_IDENTITY,
      ),
    ]),
) {
  let launches = 0;
  const directories: string[] = [];
  const contexts: FakeContext[] = [];
  const launchOptions: unknown[] = [];
  const launcher: KemerBetPersistentContextLauncher = {
    async launchPersistentContext(directory, options) {
      launches += 1;
      directories.push(directory);
      launchOptions.push(options);
      const context = contextFactory(directory);
      contexts.push(context);
      return context;
    },
  };
  return {
    launcher,
    directories,
    contexts,
    launchOptions,
    get launches() {
      return launches;
    },
  };
}

function registry(
  fileFixture = fakeFileSystem(),
  launcherFixture = fakeLauncher(),
  expectedAgentIdentityBindings: ReadonlyMap<string, string> = new Map([
    [ACCOUNT_ONE, AGENT_IDENTITY_FINGERPRINT],
  ]),
) {
  const fingerprintExternalReference: KemerBetHistoryReferenceFingerprinter = Object.assign(
    () => `hmac-sha256-v1:${'a'.repeat(64)}`,
    { keyFingerprint: '1'.repeat(64) },
  );
  const fingerprintAgentIdentity: KemerBetAgentIdentityFingerprinter = Object.assign(
    (accountId: string, value: string) => {
      if (accountId === ACCOUNT_ONE && value === RAW_AGENT_IDENTITY) {
        return AGENT_IDENTITY_FINGERPRINT;
      }
      if (accountId === ACCOUNT_TWO && value === RAW_AGENT_IDENTITY_TWO) {
        return OTHER_AGENT_IDENTITY_FINGERPRINT;
      }
      return INVALID_AGENT_IDENTITY_FINGERPRINT;
    },
    { keyFingerprint: '2'.repeat(64) },
  );
  return {
    fileFixture,
    launcherFixture,
    registry: createKemerBetAgentSessionRegistry({
      profilesRoot: PROFILES_ROOT,
      browserExecutablePath: EXECUTABLE_PATH,
      selectorContract,
      expectedAgentIdentityBindings,
      fingerprintExternalReference,
      fingerprintAgentIdentity,
      now: () => new Date('2030-01-02T03:04:05.000Z'),
      fileSystem: fileFixture.fileSystem,
      launcher: launcherFixture.launcher,
      pageTimeoutMs: 100,
      platform: 'linux',
      effectiveUserId: 1_000,
    }),
  };
}

describe('KemerBet agent session registry', () => {
  it('launches and probes a pre-provisioned exact-bound authenticated profile without financial actions', async () => {
    const fixture = registry();
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: true,
      reason: 'ready',
    });
    expect(fixture.fileFixture.reads).toBeGreaterThan(0);
    expect(fixture.launcherFixture.launches).toBe(1);
    expect(fixture.launcherFixture.contexts[0]?.pageList[0]?.gotoCount).toBe(2);
    expect(fixture.launcherFixture.contexts[0]?.pageList[0]?.financialLocatorRequests).toBe(0);
  });

  it.each([
    '../escape',
    `${ACCOUNT_ONE}/child`,
    'AAAAAAAA-4444-4444-8444-444444444441',
    'not-a-uuid',
  ])(
    'rejects traversal and noncanonical account paths before filesystem access: %s',
    async (accountId) => {
      const fixture = registry();
      const readsBefore = fixture.fileFixture.reads;
      await expect(fixture.registry.probeReadiness(accountId)).resolves.toEqual({
        ready: false,
        reason: 'invalid_account_id',
      });
      await expect(fixture.registry.resolveBrowser(accountId)).resolves.toBeNull();
      expect(fixture.fileFixture.reads).toBe(readsBefore);
      expect(fixture.launcherFixture.launches).toBe(0);
    },
  );

  it('rejects a profile symlink and root or profile realpath escape', async () => {
    const symlink = registry(fakeFileSystem({ profileSymlink: true }));
    await expect(symlink.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'unsafe_profile',
    });

    const escaped = registry(fakeFileSystem({ rootRealpath: resolve('elsewhere') }));
    await expect(escaped.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'unsafe_profile',
    });

    const profileEscaped = registry(
      fakeFileSystem({ profileRealpath: resolve('elsewhere', ACCOUNT_ONE) }),
    );
    await expect(profileEscaped.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'unsafe_profile',
    });
  });

  it.each([
    ['foreign profile owner', { profileUid: 2_000 }],
    ['group-writable profile', { profileMode: 0o720 }],
    ['non-0700 profile', { profileMode: 0o750 }],
    ['foreign root owner', { rootUid: 2_000 }],
    ['group-writable root', { rootMode: 0o775 }],
  ] as const)('rejects unsafe POSIX profile metadata: %s', async (_caseName, options) => {
    const fixture = registry(fakeFileSystem(options));
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'unsafe_profile',
    });
    expect(fixture.launcherFixture.launches).toBe(0);
  });

  it('accepts a root-owned non-writable profiles root with an euid-owned 0700 profile', async () => {
    const fixture = registry(fakeFileSystem({ rootUid: 0, rootMode: 0o755 }));
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toMatchObject({
      ready: true,
    });
  });

  it('closes and replaces an active context when the safe profile inode changes after startup', async () => {
    const fileFixture = fakeFileSystem();
    const fixture = registry(fileFixture);
    const firstBrowser = await fixture.registry.resolveBrowser(ACCOUNT_ONE);
    expect(firstBrowser).not.toBeNull();

    fileFixture.setProfileInode(21);
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: true,
      reason: 'ready',
    });
    expect(fixture.launcherFixture.contexts[0]?.closed).toBe(1);
    expect(fixture.launcherFixture.launches).toBe(2);
    await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.not.toBe(firstBrowser);
  });

  it('evicts an active context when profile permissions drift and never reuses it', async () => {
    const fileFixture = fakeFileSystem();
    const fixture = registry(fileFixture);
    const firstBrowser = await fixture.registry.resolveBrowser(ACCOUNT_ONE);
    expect(firstBrowser).not.toBeNull();

    fileFixture.setProfileMode(0o750);
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'unsafe_profile',
    });
    expect(fixture.launcherFixture.contexts[0]?.closed).toBe(1);
    await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.toBeNull();

    fileFixture.setProfileMode(0o700);
    const replacement = await fixture.registry.resolveBrowser(ACCOUNT_ONE);
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(firstBrowser);
    expect(fixture.launcherFixture.launches).toBe(2);
  });

  it('evicts an active context when its profile disappears before a readiness probe', async () => {
    const fileFixture = fakeFileSystem();
    const fixture = registry(fileFixture);
    const firstBrowser = await fixture.registry.resolveBrowser(ACCOUNT_ONE);
    expect(firstBrowser).not.toBeNull();

    fileFixture.removeAccount(ACCOUNT_ONE);
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'profile_missing',
    });
    expect(fixture.launcherFixture.contexts[0]?.closed).toBe(1);
    await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.toBeNull();

    fileFixture.addAccount(ACCOUNT_ONE);
    const replacement = await fixture.registry.resolveBrowser(ACCOUNT_ONE);
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(firstBrowser);
    expect(fixture.launcherFixture.launches).toBe(2);
  });

  it('rechecks immutable profile metadata inside the serialized no-transfer lookup lane', async () => {
    const fileFixture = fakeFileSystem();
    const fixture = registry(fileFixture);
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toMatchObject({
      ready: true,
    });

    fileFixture.setProfileMode(0o750);
    await expect(
      fixture.registry.probePlayerLookup(ACCOUNT_ONE, {
        playerId: 'PLAYER-ONE',
        currencyCode: 'ETB',
      }),
    ).resolves.toBeNull();
    expect(fixture.launcherFixture.contexts[0]?.closed).toBe(1);
  });

  it('rejects duplicate or wrong-version immutable external identity bindings before filesystem or browser access', () => {
    const fileFixture = fakeFileSystem({ accounts: [ACCOUNT_ONE, ACCOUNT_TWO] });
    const launcherFixture = fakeLauncher();
    expect(() =>
      registry(
        fileFixture,
        launcherFixture,
        new Map([
          [ACCOUNT_ONE, AGENT_IDENTITY_FINGERPRINT],
          [ACCOUNT_TWO, AGENT_IDENTITY_FINGERPRINT],
        ]),
      ),
    ).toThrow('Unsafe executor configuration.');
    expect(() =>
      registry(
        fileFixture,
        launcherFixture,
        new Map([[ACCOUNT_ONE, `hmac-sha256-v1:${'c'.repeat(64)}`]]),
      ),
    ).toThrow('Unsafe executor configuration.');
    expect(fileFixture.reads).toBe(0);
    expect(launcherFixture.launches).toBe(0);
  });

  it('fails closed when a whole authenticated profile is copied or swapped under another account UUID', async () => {
    const bindings = new Map([
      [ACCOUNT_ONE, AGENT_IDENTITY_FINGERPRINT],
      [ACCOUNT_TWO, OTHER_AGENT_IDENTITY_FINGERPRINT],
    ]);
    const contexts = new Map([
      [ACCOUNT_ONE, new FakeContext([new FakePage('about:blank', RAW_AGENT_IDENTITY_TWO)])],
      [ACCOUNT_TWO, new FakeContext([new FakePage('about:blank', RAW_AGENT_IDENTITY)])],
    ]);
    const fixture = registry(
      fakeFileSystem({ accounts: [ACCOUNT_ONE, ACCOUNT_TWO] }),
      fakeLauncher((directory) =>
        contexts.get(directory.endsWith(ACCOUNT_ONE) ? ACCOUNT_ONE : ACCOUNT_TWO)!,
      ),
      bindings,
    );
    await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.toBeNull();
    await expect(fixture.registry.resolveBrowser(ACCOUNT_TWO)).resolves.toBeNull();
    expect(fixture.launcherFixture.launches).toBe(2);
    expect(contexts.get(ACCOUNT_ONE)?.closed).toBe(1);
    expect(contexts.get(ACCOUNT_TWO)?.closed).toBe(1);
  });

  it.each([
    ['swapped profile identity', () => new FakePage('about:blank', 'agent-two@example.invalid')],
    ['stale profile without an identity marker', () => new FakePage('about:blank', null)],
    [
      'login redirect',
      () =>
        new FakePage('about:blank', RAW_AGENT_IDENTITY, 'https://agentsystem.admindigi.com/login'),
    ],
    ['CAPTCHA challenge', () => new FakePage('about:blank', RAW_AGENT_IDENTITY, null, '#captcha')],
  ])('fails live readiness closed for a %s', async (_caseName, pageFactory) => {
    const context = new FakeContext([pageFactory()]);
    const fixture = registry(
      fakeFileSystem(),
      fakeLauncher(() => context),
    );
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'authenticated_session_unavailable',
    });
    expect(context.closed).toBe(1);
    expect(context.pageList[0]?.financialLocatorRequests).toBe(0);
  });

  it.each([
    [
      'identity mismatch',
      (page: FakePage) => {
        page.rawAgentIdentity = RAW_AGENT_IDENTITY_TWO;
      },
    ],
    [
      'login redirect',
      (page: FakePage) => page.overrideNavigationUrl('https://agentsystem.admindigi.com/login'),
    ],
    ['CAPTCHA', (page: FakePage) => page.showSessionFailure('#captcha')],
    [
      'route drift',
      (page: FakePage) =>
        page.overrideNavigationUrl('https://agentsystem.admindigi.com/payments/requests'),
    ],
  ] as const)(
    'evicts the active context when a serialized browser operation detects %s',
    async (_caseName, makeUnsafe) => {
      const firstPage = new FakePage();
      const firstContext = new FakeContext([firstPage]);
      let launchNumber = 0;
      const fixture = registry(
        fakeFileSystem(),
        fakeLauncher(() => {
          launchNumber += 1;
          return launchNumber === 1 ? firstContext : new FakeContext([new FakePage()]);
        }),
      );
      const firstBrowser = await fixture.registry.resolveBrowser(ACCOUNT_ONE);
      expect(firstBrowser).not.toBeNull();
      makeUnsafe(firstPage);

      await expect(firstBrowser!.prepare(executionLease())).rejects.toThrow(
        'The supervised KemerBet deposit browser is unavailable.',
      );
      expect(firstContext.closed).toBe(1);
      const replacement = await fixture.registry.resolveBrowser(ACCOUNT_ONE);
      expect(replacement).not.toBeNull();
      expect(replacement).not.toBe(firstBrowser);
      expect(fixture.launcherFixture.launches).toBe(2);
    },
  );

  it('returns null for a missing profile and never creates it', async () => {
    const fixture = registry(fakeFileSystem({ accounts: [] }));
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'profile_missing',
    });
    await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.toBeNull();
    expect(fixture.launcherFixture.launches).toBe(0);
  });

  it('coalesces concurrent resolution to one persistent browser bound to one account', async () => {
    const fixture = registry();
    const [first, second] = await Promise.all([
      fixture.registry.resolveBrowser(ACCOUNT_ONE),
      fixture.registry.resolveBrowser(ACCOUNT_ONE),
    ]);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(first?.platformAgentAccountId).toBe(ACCOUNT_ONE);
    expect(fixture.launcherFixture.launches).toBe(1);
    expect(fixture.launcherFixture.directories).toEqual([pathFor(ACCOUNT_ONE)]);
    expect(fixture.launcherFixture.launchOptions[0]).toMatchObject({
      executablePath: EXECUTABLE_PATH,
      headless: true,
      chromiumSandbox: true,
      acceptDownloads: false,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      serviceWorkers: 'block',
    });
    expect(fixture.launcherFixture.launchOptions[0]).not.toHaveProperty('recordVideo');
  });

  it('uses separate persistent browsers for separate bound agent accounts', async () => {
    const fileFixture = fakeFileSystem({ accounts: [ACCOUNT_ONE, ACCOUNT_TWO] });
    const fixture = registry(
      fileFixture,
      fakeLauncher(),
      new Map([
        [ACCOUNT_ONE, AGENT_IDENTITY_FINGERPRINT],
        [ACCOUNT_TWO, OTHER_AGENT_IDENTITY_FINGERPRINT],
      ]),
    );
    const [first, second] = await Promise.all([
      fixture.registry.resolveBrowser(ACCOUNT_ONE),
      fixture.registry.resolveBrowser(ACCOUNT_TWO),
    ]);
    expect(first?.platformAgentAccountId).toBe(ACCOUNT_ONE);
    expect(second?.platformAgentAccountId).toBe(ACCOUNT_TWO);
    expect(first).not.toBe(second);
    expect(fixture.launcherFixture.launches).toBe(2);
  });

  it.each([
    'https://kemerbet.co/en/pages/9999/1',
    'https://agentsystem.admindigi.com/login',
    'https://agentsystem.admindigi.com/payments/requests',
  ])(
    'closes a restored customer, login, or drifted page instead of exposing it: %s',
    async (url) => {
      const context = new FakeContext([new FakePage(url)]);
      const fixture = registry(
        fakeFileSystem(),
        fakeLauncher(() => context),
      );
      await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.toBeNull();
      expect(context.closed).toBe(1);
    },
  );

  it('permits only one primary agent page and closes later popups', async () => {
    const context = new FakeContext([new FakePage(KEMERBET_AGENT_DEPOSIT_URL)]);
    const fixture = registry(
      fakeFileSystem(),
      fakeLauncher(() => context),
    );
    await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.not.toBeNull();
    const popup = context.openPopup(new FakePage('https://kemerbet.co/'));
    await Promise.resolve();
    expect(popup.closed).toBe(1);
  });

  it('closes every active context once and makes readiness fail closed', async () => {
    const fixture = registry();
    await fixture.registry.resolveBrowser(ACCOUNT_ONE);
    await fixture.registry.close();
    await fixture.registry.close();
    expect(fixture.launcherFixture.contexts[0]?.closed).toBe(1);
    await expect(fixture.registry.probeReadiness(ACCOUNT_ONE)).resolves.toEqual({
      ready: false,
      reason: 'registry_closed',
    });
    await expect(fixture.registry.resolveBrowser(ACCOUNT_ONE)).resolves.toBeNull();
  });
});
