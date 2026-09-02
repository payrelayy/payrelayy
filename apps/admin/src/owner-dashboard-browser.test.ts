import { createContext, runInContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { OWNER_DASHBOARD_JAVASCRIPT } from './owner-dashboard.js';

type BrowserEvent = Readonly<{ preventDefault(): void }>;
type BrowserListener = (event: BrowserEvent) => Promise<void> | void;
type BrowserFetchInit = Readonly<{ signal?: AbortSignal }> & Record<string, unknown>;
type BrowserFetchOverride = (
  url: string,
  init: BrowserFetchInit,
) => Promise<unknown> | unknown | undefined;

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, BrowserListener>();
  elements = Object.assign([] as FakeElement[], {}) as FakeElement[] & Record<string, FakeElement>;
  checked = false;
  className = '';
  disabled = false;
  focused = false;
  height = 720;
  hidden = false;
  href = '';
  tabIndex = 0;
  textContent = '';
  type = '';
  value = '';
  width = 1280;

  addEventListener(type: string, listener: BrowserListener): void {
    this.listeners.set(type, listener);
  }

  append(..._children: unknown[]): void {}

  focus(): void {
    this.focused = true;
  }

  getBoundingClientRect(): Readonly<{
    height: number;
    left: number;
    top: number;
    width: number;
  }> {
    return { height: this.height, left: 0, top: 0, width: this.width };
  }

  getContext(): Readonly<{ clearRect(): void; drawImage(): void }> {
    return { clearRect() {}, drawImage() {} };
  }

  removeAttribute(name: string): void {
    if (name === 'href') this.href = '';
  }

  replaceChildren(..._children: unknown[]): void {}
}

function response(status: number, body: unknown) {
  const value = {
    clone: () => value,
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
  return value;
}

function ownerBrowserHarness(
  dashboardStatus: 401 | 403 | 503,
  options: Readonly<{
    confirm?: boolean;
    fetchOverride?: BrowserFetchOverride;
    randomUUID?: () => string;
  }> = {},
) {
  const elements = new Map<string, FakeElement>();
  const element = (selector: string) => {
    const current = elements.get(selector);
    if (current) return current;
    const created = new FakeElement();
    elements.set(selector, created);
    return created;
  };
  const namedElements = (values: Record<string, FakeElement>) => {
    const list = Object.values(values) as FakeElement[] & Record<string, FakeElement>;
    Object.assign(list, values);
    return list;
  };

  const email = element('#email');
  const password = element('#password');
  element('#login-form').elements = namedElements({ email, password });
  element('#invite-form').elements = namedElements({ expiry: new FakeElement() });
  element('#receiver-form').elements = namedElements({
    accountHolderName: new FakeElement(),
    accountReference: new FakeElement(),
    providerCode: new FakeElement(),
    rotationReason: new FakeElement(),
  });
  element('#kemerbet-agent-profile-form').elements = namedElements({
    configurationReason: new FakeElement(),
  });

  const stored = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: (key: string) => void stored.delete(key),
    setItem: (key: string, value: string) => void stored.set(key, value),
  };
  let nextTimer = 0;
  const timers = new Map<number, Readonly<{ callback: () => void; delay: number }>>();
  const window = {
    clearTimeout: (timer: number) => void timers.delete(timer),
    confirm: (_message: string) => options.confirm ?? false,
    sessionStorage,
    setTimeout: (callback: () => void, delay: number) => {
      nextTimer += 1;
      timers.set(nextTimer, { callback, delay });
      return nextTimer;
    },
  };
  const fetchCalls: Array<Readonly<{ init: BrowserFetchInit; url: string }>> = [];
  const fetchImplementation = async (input: unknown, init: BrowserFetchInit = {}) => {
    const url = String(input);
    fetchCalls.push({ init, url });
    const overridden = options.fetchOverride?.(url, init);
    if (overridden !== undefined) return overridden;
    if (url === '/owner/config.json') {
      return response(200, {
        publishableKey: `sb_publishable_${'a'.repeat(32)}`,
        supabaseUrl: 'https://spzpiyxheappsfyswewl.supabase.co',
      });
    }
    if (url.endsWith('/auth/v1/token?grant_type=password')) {
      return response(200, {
        access_token: 'header.payload.signature-with-safe-characters',
        expires_in: 3600,
        refresh_token: 'abcdefghijkl',
      });
    }
    return response(dashboardStatus, { error: 'test_dashboard_failure' });
  };

  const context = createContext({
    AbortController,
    URL,
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    createImageBitmap: async () => ({ close() {} }),
    crypto: {
      randomUUID: options.randomUUID ?? (() => '11111111-1111-4111-8111-111111111111'),
    },
    document: {
      createElement: (_name: string) => new FakeElement(),
      querySelector: element,
      querySelectorAll: (_selector: string) => [] as FakeElement[],
    },
    encodeURIComponent,
    fetch: fetchImplementation,
    navigator: { clipboard: { writeText: async (_value: string) => undefined } },
    window,
  } as Record<string, unknown>);
  runInContext(OWNER_DASHBOARD_JAVASCRIPT, context);

  return {
    call<T>(name: string, ...args: unknown[]): Promise<T> {
      const value = context[name];
      if (typeof value !== 'function') throw new Error(`Missing browser function: ${name}`);
      return Promise.resolve((value as (...values: unknown[]) => T)(...args));
    },
    element,
    evaluate(source: string) {
      return runInContext(source, context);
    },
    expireLatestTimer(delay: number) {
      const match = [...timers.entries()].filter(([, timer]) => timer.delay === delay).at(-1);
      if (!match) throw new Error(`No active ${delay}ms browser timer.`);
      timers.delete(match[0]);
      match[1].callback();
    },
    fetchCalls,
    sessionStorage,
    async signIn() {
      email.value = 'owner@example.test';
      password.value = 'correct-private-password';
      const submit = element('#login-form').listeners.get('submit');
      if (!submit) throw new Error('Owner submit listener was not installed.');
      await submit({ preventDefault() {} });
    },
  };
}

describe('Owner dashboard browser authentication boundary', () => {
  it('keeps the valid session when post-authentication dashboard hydration fails', async () => {
    const browser = ownerBrowserHarness(503);

    await browser.signIn();

    expect(browser.element('#login-panel').hidden).toBe(true);
    expect(browser.element('#invite-panel').hidden).toBe(false);
    expect(browser.element('#notice').textContent).toBe(
      'Owner authentication succeeded, but dashboard data is temporarily unavailable. ' +
        'Your session remains active; select Refresh to retry.',
    );
    expect(browser.element('#notice').textContent).not.toContain('Sign-in failed');
    expect(browser.sessionStorage.getItem('fetanagent.owner.session.v1')).not.toBeNull();
  });

  it.each([401, 403] as const)(
    'still clears the session when an authenticated Owner request returns %s',
    async (status) => {
      const browser = ownerBrowserHarness(status);

      await browser.signIn();

      expect(browser.element('#login-panel').hidden).toBe(false);
      expect(browser.element('#invite-panel').hidden).toBe(true);
      expect(browser.element('#notice').textContent).toBe(
        'Your session is unavailable or is not an active Owner.',
      );
      expect(browser.sessionStorage.getItem('fetanagent.owner.session.v1')).toBeNull();
    },
  );

  it('keeps the valid Owner session when a KemerBet operation returns a domain conflict', async () => {
    const browser = ownerBrowserHarness(503, {
      fetchOverride: (url) =>
        url === '/v1/owner/test-kemerbet-domain-conflict'
          ? response(409, { error: 'kemerbet_session_rejected' })
          : undefined,
    });
    await browser.signIn();

    const result = await browser.call<Readonly<{ status: number }>>(
      'ownerRequest',
      '/v1/owner/test-kemerbet-domain-conflict',
      { method: 'POST', headers: {} },
    );

    expect(result.status).toBe(409);
    expect(browser.element('#login-panel').hidden).toBe(true);
    expect(browser.element('#invite-panel').hidden).toBe(false);
    expect(browser.sessionStorage.getItem('fetanagent.owner.session.v1')).not.toBeNull();
  });

  it('bounds token refresh and preserves the valid twelve-hour credential on timeout', async () => {
    let refreshSignal: AbortSignal | undefined;
    const browser = ownerBrowserHarness(503, {
      fetchOverride: (url, init) => {
        if (!url.endsWith('/auth/v1/token?grant_type=refresh_token')) return undefined;
        refreshSignal = init.signal;
        return new Promise(() => undefined);
      },
    });
    await browser.signIn();

    const refresh = browser.call('refreshOwnerSession');
    await Promise.resolve();
    await Promise.resolve();
    browser.expireLatestTimer(10_000);

    await expect(refresh).rejects.toThrow('owner_transport_timeout');
    expect(refreshSignal?.aborted).toBe(true);
    expect(browser.element('#login-panel').hidden).toBe(true);
    expect(browser.element('#invite-panel').hidden).toBe(false);
    expect(browser.sessionStorage.getItem('fetanagent.owner.session.v1')).not.toBeNull();
  });

  it('preserves the valid twelve-hour credential on a transient refresh network failure', async () => {
    const browser = ownerBrowserHarness(503, {
      fetchOverride: (url) => {
        if (!url.endsWith('/auth/v1/token?grant_type=refresh_token')) return undefined;
        throw new TypeError('simulated network disconnect');
      },
    });
    await browser.signIn();

    await expect(browser.call('refreshOwnerSession')).rejects.toThrow('owner_transport_network');
    expect(browser.element('#login-panel').hidden).toBe(true);
    expect(browser.element('#invite-panel').hidden).toBe(false);
    expect(browser.sessionStorage.getItem('fetanagent.owner.session.v1')).not.toBeNull();
  });

  it('bounds Owner response-body parsing without signing out a valid session', async () => {
    let ownerSignal: AbortSignal | undefined;
    const browser = ownerBrowserHarness(503, {
      fetchOverride: (url, init) => {
        if (url !== '/v1/owner/test-hanging-body') return undefined;
        ownerSignal = init.signal;
        const value = {
          clone: () => value,
          headers: { get: (_name: string) => 'application/json' },
          json: () => new Promise(() => undefined),
          ok: true,
          status: 200,
        };
        return value;
      },
    });
    await browser.signIn();

    const result = await browser.call<Readonly<{ json(): Promise<unknown> }>>(
      'ownerRequest',
      '/v1/owner/test-hanging-body',
      { method: 'GET', headers: {} },
    );
    const parsing = result.json();
    await Promise.resolve();
    browser.expireLatestTimer(25_000);

    await expect(parsing).rejects.toThrow('owner_transport_timeout');
    expect(ownerSignal?.aborted).toBe(true);
    expect(browser.element('#login-panel').hidden).toBe(true);
    expect(browser.sessionStorage.getItem('fetanagent.owner.session.v1')).not.toBeNull();
  });

  it('signs out only after a confirmed refresh-token rejection', async () => {
    const browser = ownerBrowserHarness(503, {
      fetchOverride: (url) =>
        url.endsWith('/auth/v1/token?grant_type=refresh_token')
          ? response(400, { error: 'confirmed_test_rejection' })
          : undefined,
    });
    await browser.signIn();

    await expect(browser.call('refreshOwnerSession')).rejects.toThrow('signed_out');
    expect(browser.element('#login-panel').hidden).toBe(false);
    expect(browser.element('#invite-panel').hidden).toBe(true);
    expect(browser.sessionStorage.getItem('fetanagent.owner.session.v1')).toBeNull();
  });
});

describe('Owner dashboard readiness mutation transport boundary', () => {
  it('enables only the exact recovery private-session controls while ordinary mutations stay disabled', async () => {
    let activeTest = false;
    let startPosts = 0;
    const inactiveSession = {
      active: false,
      loginRequired: false,
      phase: 'idle',
      signedIn: false,
      transferDisabled: true,
    };
    const startingSession = {
      active: true,
      expiresAt: '2026-08-30T22:00:00.000Z',
      frameSequence: 0,
      generation: '11111111-1111-4111-8111-111111111111',
      loginRequired: false,
      phase: 'starting',
      signedIn: false,
      transferDisabled: true,
    };
    const browser = ownerBrowserHarness(503, {
      fetchOverride: (url, init) => {
        if (!activeTest || url !== '/v1/owner/kemerbet-session/start') return undefined;
        startPosts += 1;
        expect(init.method).toBe('POST');
        return response(202, {
          securityRecoverySessionAllowed: true,
          session: startingSession,
        });
      },
    });
    await browser.signIn();
    activeTest = true;
    browser.evaluate("activeKemerbetAgentProfileId = '77777777-7777-4777-8777-777777777777';");

    await browser.call('renderKemerbetSession', inactiveSession, true);

    const confirmation = browser.element('#kemerbet-session-confirmation');
    const start = browser.element('#kemerbet-session-start-button');
    const stop = browser.element('#kemerbet-session-stop-button');
    expect(confirmation.disabled).toBe(false);
    expect(start.disabled).toBe(false);
    expect(stop.disabled).toBe(true);
    expect(browser.element('#receiver-form').elements.accountReference!.disabled).toBe(true);
    expect(
      browser.element('#kemerbet-agent-profile-form').elements.configurationReason!.disabled,
    ).toBe(true);

    await browser.call('startKemerbetSession');
    expect(startPosts).toBe(0);
    expect(confirmation.focused).toBe(true);
    expect(browser.element('#kemerbet-session-status').textContent).toBe(
      'Check the approval box first. No private browser was started. Transfer remains disabled and no money moved.',
    );

    confirmation.checked = true;
    await confirmation.listeners.get('change')?.({ preventDefault() {} });
    expect(start.disabled).toBe(false);

    await browser.call('startKemerbetSession');

    expect(startPosts).toBe(1);
    expect(confirmation.disabled).toBe(true);
    expect(start.disabled).toBe(true);
    expect(stop.disabled).toBe(false);
    expect(browser.element('#receiver-form').elements.accountReference!.disabled).toBe(true);
  });

  it('renders only a fixed redacted startup failure after clean coordinator shutdown', async () => {
    const browser = ownerBrowserHarness(503);
    await browser.signIn();
    const failedSession = {
      active: false,
      loginRequired: false,
      phase: 'idle',
      signedIn: false,
      startup: {
        detailsRedacted: true,
        failureCode: 'contract_mismatch',
        schemaVersion: 1,
        stage: 'recaptcha_asset',
        status: 'failed',
      },
      transferDisabled: true,
    };

    expect(await browser.call('validKemerbetSession', failedSession)).toEqual(failedSession);
    await browser.call('renderKemerbetSession', failedSession, true);

    const status = browser.element('#kemerbet-session-status').textContent;
    expect(status).toBe(
      'Private KemerBet sign-in stopped during the reviewed reCAPTCHA assets because ' +
        'the reviewed public-resource contract changed. Transfer, final action, and money movement remain disabled. ' +
        'Check the approval box again before retrying.',
    );
    expect(status).not.toMatch(/https?:|password|token|stack|player/iu);
  });

  it.each([
    [
      'credential_released',
      'Credential input was released after submission. Waiting for the bounded post-login reload…',
    ],
    [
      'post_login_reload',
      'KemerBet completed the post-login reload. Verifying the reviewed root transition…',
    ],
    [
      'post_login_root',
      'KemerBet reached the reviewed post-login root. Verifying the bounded read-only bootstrap…',
    ],
    [
      'post_login_ready',
      'KemerBet completed the reviewed post-login bootstrap. Waiting for the Agents page…',
    ],
    [
      'agents_candidate',
      'KemerBet opened the signed-in Agents candidate page. Verifying the sealed agent identity…',
    ],
    [
      'session_guard',
      'KemerBet signed-in session guard passed. Verifying the sealed agent identity marker…',
    ],
    [
      'identity_marker',
      'KemerBet agent identity marker was found. Verifying the sealed identity value…',
    ],
    [
      'identity_value',
      'KemerBet sealed agent identity value matched. Confirming identity stability…',
    ],
    [
      'identity_stability',
      'KemerBet sealed agent identity is stable. Finalizing the retained session…',
    ],
  ])('renders fixed redacted authentication progress for %s', async (stage, expectedMessage) => {
    const browser = ownerBrowserHarness(503);
    await browser.signIn();
    const verifyingSession = {
      active: true,
      authentication: {
        detailsRedacted: true,
        schemaVersion: 1,
        stage,
        status: 'verifying',
      },
      expiresAt: '2026-08-30T22:00:00.000Z',
      frameSequence: 0,
      generation: '11111111-1111-4111-8111-111111111111',
      loginRequired: false,
      phase: 'authenticating',
      signedIn: false,
      transferDisabled: true,
    };

    expect(await browser.call('validKemerbetSession', verifyingSession)).toEqual(verifyingSession);
    await browser.call('renderKemerbetSession', verifyingSession, true);

    const status = browser.element('#kemerbet-session-status').textContent;
    expect(status).toBe(expectedMessage);
    expect(status).not.toMatch(/https?:|password|token|stack|player/iu);
  });

  it.each([
    {
      active: false,
      expectedSuffix: ' Check the approval box again before retrying.',
      failureCode: 'identity_unavailable',
      failureMessage: 'the sealed agent identity could not be verified',
      phase: 'idle',
      stage: 'identity_value',
      stageMessage: 'sealed identity-value verification',
    },
    {
      active: true,
      expectedSuffix: '',
      failureCode: 'transition_deadline_exceeded',
      failureMessage: 'the bounded signed-in transition deadline expired',
      phase: 'faulted',
      stage: 'post_login_reload',
      stageMessage: 'the post-login reload',
    },
    {
      active: true,
      expectedSuffix: '',
      failureCode: 'identity_deadline_exceeded',
      failureMessage: 'the bounded sealed-identity deadline expired',
      phase: 'stopping',
      stage: 'identity_stability',
      stageMessage: 'sealed identity-stability verification',
    },
  ])(
    'renders a fixed redacted $phase authentication failure',
    async ({ active, expectedSuffix, failureCode, failureMessage, phase, stage, stageMessage }) => {
      const browser = ownerBrowserHarness(503);
      await browser.signIn();
      const failedSession = {
        active,
        authentication: {
          detailsRedacted: true,
          failureCode,
          schemaVersion: 1,
          stage,
          status: 'failed',
        },
        ...(active
          ? {
              expiresAt: '2026-08-30T22:00:00.000Z',
              frameSequence: 0,
              generation: '11111111-1111-4111-8111-111111111111',
            }
          : {}),
        loginRequired: false,
        phase,
        signedIn: false,
        transferDisabled: true,
      };

      expect(await browser.call('validKemerbetSession', failedSession)).toEqual(failedSession);
      await browser.call('renderKemerbetSession', failedSession, true);

      const status = browser.element('#kemerbet-session-status').textContent;
      expect(status).toBe(
        'Private KemerBet sign-in stopped during ' +
          stageMessage +
          ' because ' +
          failureMessage +
          '. No credential was retained. Transfer remains disabled and no money moved.' +
          expectedSuffix,
      );
      expect(status).not.toMatch(/https?:|password|token|stack|player/iu);
    },
  );

  it.each([
    {
      detailsRedacted: true,
      failureCode: 'identity_unavailable',
      schemaVersion: 1,
      stage: 'identity_value',
      status: 'verifying',
    },
    {
      detailsRedacted: true,
      schemaVersion: 1,
      stage: 'identity_value',
      status: 'failed',
    },
    {
      detailsRedacted: true,
      failureCode: 'identity_unavailable',
      providerDetail: 'forbidden',
      schemaVersion: 1,
      stage: 'identity_value',
      status: 'failed',
    },
  ])('rejects malformed browser authentication status objects', async (authentication) => {
    const browser = ownerBrowserHarness(503);
    await browser.signIn();

    await expect(
      browser.call('validKemerbetSession', {
        active: true,
        authentication,
        expiresAt: '2026-08-30T22:00:00.000Z',
        frameSequence: 0,
        generation: '11111111-1111-4111-8111-111111111111',
        loginRequired: false,
        phase: authentication.status === 'verifying' ? 'authenticating' : 'faulted',
        signedIn: false,
        transferDisabled: true,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      failureCode: 'dependency_unavailable',
      expectedMessage:
        'Private KemerBet sign-in stopped during KemerBet login navigation because ' +
        'a required dependency was unavailable. Transfer, final action, and money movement remain disabled.',
      phase: 'faulted',
      stage: 'provider_navigation',
      stopDisabled: false,
    },
    {
      failureCode: 'cleanup_unverified',
      expectedMessage:
        'Private KemerBet sign-in stopped during isolated browser cleanup because ' +
        'clean browser shutdown could not be verified. Transfer, final action, and money movement remain disabled.',
      phase: 'stopping',
      stage: 'cleanup',
      stopDisabled: true,
    },
  ])(
    'renders a fixed redacted $phase startup failure while retaining cleanup controls',
    async ({ expectedMessage, failureCode, phase, stage, stopDisabled }) => {
      const browser = ownerBrowserHarness(503);
      await browser.signIn();
      browser.evaluate("activeKemerbetAgentProfileId = '77777777-7777-4777-8777-777777777777';");
      const failedSession = {
        active: true,
        expiresAt: '2026-08-30T22:00:00.000Z',
        frameSequence: 0,
        generation: '11111111-1111-4111-8111-111111111111',
        loginRequired: false,
        phase,
        signedIn: false,
        startup: {
          detailsRedacted: true,
          failureCode,
          schemaVersion: 1,
          stage,
          status: 'failed',
        },
        transferDisabled: true,
      };

      expect(await browser.call('validKemerbetSession', failedSession)).toEqual(failedSession);
      await browser.call('renderKemerbetSession', failedSession, true);

      const status = browser.element('#kemerbet-session-status').textContent;
      expect(status).toBe(expectedMessage);
      expect(status).not.toMatch(/https?:|password|token|stack|player/iu);
      expect(browser.element('#kemerbet-session-confirmation').disabled).toBe(true);
      expect(browser.element('#kemerbet-session-start-button').disabled).toBe(true);
      expect(browser.element('#kemerbet-session-stop-button').disabled).toBe(stopDisabled);
      expect(browser.element('#kemerbet-session-canvas').hidden).toBe(true);
    },
  );

  it.each([
    ['cleanup', 'contract_mismatch'],
    ['recaptcha_asset', 'cleanup_unverified'],
    ['preview_ready', 'contract_mismatch'],
  ])('rejects the incoherent browser startup failure pair %s/%s', async (stage, failureCode) => {
    const browser = ownerBrowserHarness(503);
    await browser.signIn();

    await expect(
      browser.call('validKemerbetSession', {
        active: false,
        loginRequired: false,
        phase: 'idle',
        signedIn: false,
        startup: {
          detailsRedacted: true,
          failureCode,
          schemaVersion: 1,
          stage,
          status: 'failed',
        },
        transferDisabled: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('does not run a pilot refresh for a non-open-pilot failure', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111';
    let activeTest = false;
    let pilotRefreshes = 0;
    let statusReconciliations = 0;
    const browser = ownerBrowserHarness(503, {
      confirm: true,
      randomUUID: () => requestId,
      fetchOverride: (url) => {
        if (!activeTest) return undefined;
        if (url === '/v1/owner/private-live-deposit-pilots/current') {
          pilotRefreshes += 1;
          return response(200, { pilot: null });
        }
        if (url === '/v1/owner/kemerbet-session') {
          statusReconciliations += 1;
          return response(200, {
            session: {
              active: false,
              loginRequired: false,
              phase: 'idle',
              quarantine: {
                reasonCode: 'security_recovery_cohort_required',
                recoveryRequired: true,
              },
              signedIn: false,
              transferDisabled: true,
            },
          });
        }
        if (url === '/v1/owner/kemerbet-readiness-cohort/prepare') {
          return response(503, { error: 'owner_control_unavailable' });
        }
        return undefined;
      },
    });
    await browser.signIn();
    activeTest = true;
    browser.evaluate(
      'currentPilotLoaded = true; eligibleReadinessCohortPlayerCount = 5; ' +
        'kemerbetSecurityRecoveryRequired = true; ' +
        'kemerbetSecurityRecoveryCohortRequired = true;',
    );
    browser.element('#kemerbet-readiness-cohort-confirmation').checked = true;

    await browser.call('prepareKemerbetReadinessCohort');

    expect(pilotRefreshes).toBe(0);
    expect(statusReconciliations).toBe(1);
    expect(browser.sessionStorage.getItem('fetanagent.owner.kemerbet-readiness-request.v1')).toBe(
      requestId,
    );
  });

  it('reconciles an uncertain request and retries only the same one-use request ID', async () => {
    const requestIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    let randomUUIDCalls = 0;
    let readinessPosts = 0;
    let activeTest = false;
    const orderedRequests: string[] = [];
    const postedRequestIds: string[] = [];
    const cohortRequiredSession = {
      session: {
        active: false,
        loginRequired: false,
        phase: 'idle',
        quarantine: {
          reasonCode: 'security_recovery_cohort_required',
          recoveryRequired: true,
        },
        signedIn: false,
        transferDisabled: true,
      },
    };
    const browser = ownerBrowserHarness(503, {
      confirm: true,
      randomUUID: () => requestIds[randomUUIDCalls++] ?? requestIds.at(-1)!,
      fetchOverride: (url, init) => {
        if (!activeTest) return undefined;
        if (url === '/v1/owner/kemerbet-session') {
          orderedRequests.push('GET status');
          return response(200, cohortRequiredSession);
        }
        if (url === '/v1/owner/private-live-deposit-pilots/current') {
          return response(200, { pilot: null });
        }
        if (url !== '/v1/owner/kemerbet-readiness-cohort/prepare') return undefined;
        readinessPosts += 1;
        orderedRequests.push(`POST ${readinessPosts}`);
        const parsed = JSON.parse(String(init.body)) as { requestId: string };
        postedRequestIds.push(parsed.requestId);
        if (readinessPosts === 1) return new Promise(() => undefined);
        return response(200, {
          alreadyPrepared: true,
          identifiersRedacted: true,
          moneyMoved: false,
          playersPrepared: 5,
          transferDisabled: true,
        });
      },
    });
    await browser.signIn();
    activeTest = true;
    browser.evaluate(
      'currentPilotLoaded = true; eligibleReadinessCohortPlayerCount = 5; ' +
        'kemerbetSecurityRecoveryRequired = true; ' +
        'kemerbetSecurityRecoveryCohortRequired = true;',
    );
    // Top-level lexical state remains in the dashboard realm; its exported preparation function
    // is invoked after setting the same UI gates a signed-in recovery page would expose.
    browser.element('#kemerbet-readiness-cohort-confirmation').checked = true;
    const firstAttempt = browser.call('prepareKemerbetReadinessCohort');
    await Promise.resolve();
    await Promise.resolve();
    browser.expireLatestTimer(25_000);
    await firstAttempt;

    expect(browser.sessionStorage.getItem('fetanagent.owner.kemerbet-readiness-request.v1')).toBe(
      requestIds[0],
    );

    browser.element('#kemerbet-readiness-cohort-confirmation').checked = true;
    await browser.call('prepareKemerbetReadinessCohort');

    expect(orderedRequests).toEqual(['POST 1', 'GET status', 'GET status', 'POST 2']);
    expect(postedRequestIds).toEqual([requestIds[0], requestIds[0]]);
    expect(randomUUIDCalls).toBe(1);
    expect(
      browser.sessionStorage.getItem('fetanagent.owner.kemerbet-readiness-request.v1'),
    ).toBeNull();
    expect(browser.element('#notice').textContent).toContain(
      'Transfer is disabled, and no money moved.',
    );
  });
});
