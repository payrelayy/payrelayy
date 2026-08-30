import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { OWNER_DASHBOARD_JAVASCRIPT } from './owner-dashboard.js';

type BrowserEvent = Readonly<{ preventDefault(): void }>;
type BrowserListener = (event: BrowserEvent) => Promise<void> | void;

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, BrowserListener>();
  elements = Object.assign([] as FakeElement[], {}) as FakeElement[] & Record<string, FakeElement>;
  checked = false;
  className = '';
  disabled = false;
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

  focus(): void {}

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

function ownerBrowserHarness(dashboardStatus: 401 | 403 | 503) {
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
  const window = {
    clearTimeout: (_timer: number) => undefined,
    confirm: (_message: string) => false,
    sessionStorage,
    setTimeout: (_callback: () => void, _delay: number) => 1,
  };
  const fetchImplementation = async (input: unknown) => {
    const url = String(input);
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

  runInNewContext(OWNER_DASHBOARD_JAVASCRIPT, {
    URL,
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    createImageBitmap: async () => ({ close() {} }),
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    document: {
      createElement: (_name: string) => new FakeElement(),
      querySelector: element,
      querySelectorAll: (_selector: string) => [] as FakeElement[],
    },
    encodeURIComponent,
    fetch: fetchImplementation,
    navigator: { clipboard: { writeText: async (_value: string) => undefined } },
    window,
  });

  return {
    element,
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
});
