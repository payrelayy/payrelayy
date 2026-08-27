import type { Browser, BrowserContext, CDPSession, Page } from 'playwright-core';

import { describe, expect, it, vi } from 'vitest';

import { KemerBetChromiumProfileUnavailableError } from './kemerbet-chromium-profile.js';
import {
  closeKemerBetPersistentBrowserForRestorableCheckpoint,
  KemerBetPersistentBrowserCheckpointUnavailableError,
} from './kemerbet-persistent-browser-checkpoint.js';

interface BrowserHarnessOptions {
  readonly closeContextOnDisconnect?: boolean;
  readonly closePageOnDisconnect?: boolean;
  readonly contextCount?: number;
  readonly cdpCommandError?: Error;
  readonly cdpCommandErrorAfterDisconnect?: Error;
  readonly cdpSessionError?: Error;
  readonly disconnectOnCommand?: boolean;
  readonly pageContextMismatch?: boolean;
  readonly pageCount?: number;
}

function browserHarness(options: BrowserHarnessOptions = {}) {
  let connected = true;
  let contextClosed = false;
  let pageClosed = false;
  const listeners = new Set<() => void>();
  const order: string[] = [];
  const browserClose = vi.fn(async () => {
    throw new Error('browser.close must not be used');
  });
  const contextClose = vi.fn(async () => {
    throw new Error('context.close must not be used');
  });
  const detach = vi.fn(async () => undefined);
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  const send = vi.fn(async (method: string) => {
    order.push(`cdp:${method}`);
    if (method !== 'Browser.close') throw new Error('unexpected CDP method');
    if (options.cdpCommandError !== undefined) throw options.cdpCommandError;
    if (options.disconnectOnCommand !== false) {
      connected = false;
      contextClosed = options.closeContextOnDisconnect !== false;
      pageClosed = options.closePageOnDisconnect !== false;
      order.push('disconnected');
      for (const listener of [...listeners]) listener();
    }
    if (options.cdpCommandErrorAfterDisconnect !== undefined) {
      throw options.cdpCommandErrorAfterDisconnect;
    }
  });
  const closeSession = { detach, send } as unknown as CDPSession;
  const newBrowserCDPSession = vi.fn(async () => {
    if (options.cdpSessionError !== undefined) throw options.cdpSessionError;
    return closeSession;
  });

  browser = {
    close: browserClose,
    contexts: () => {
      const count = options.contextCount ?? 1;
      return Array.from({ length: count }, (_unused, index) =>
        index === 0 ? context : ({} as BrowserContext),
      );
    },
    isConnected: () => connected,
    newBrowserCDPSession,
    off: (_event: string, listener: () => void) => {
      listeners.delete(listener);
      return browser;
    },
    once: (_event: string, listener: () => void) => {
      listeners.add(listener);
      return browser;
    },
  } as unknown as Browser;
  context = {
    browser: () => browser,
    close: contextClose,
    isClosed: () => contextClosed,
    pages: () => {
      const count = options.pageCount ?? 1;
      return Array.from({ length: count }, (_unused, index) => (index === 0 ? page : ({} as Page)));
    },
  } as unknown as BrowserContext;
  page = {
    context: () => (options.pageContextMismatch === true ? ({} as BrowserContext) : context),
    isClosed: () => pageClosed,
  } as unknown as Page;

  return {
    browserClose,
    context,
    contextClose,
    detach,
    isClosed: () => ({ connected, contextClosed, pageClosed }),
    newBrowserCDPSession,
    order,
    page,
    send,
  };
}

async function expectCheckpointUnavailable(
  action: Promise<void>,
  redactedValues: readonly string[] = [],
): Promise<void> {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(KemerBetPersistentBrowserCheckpointUnavailableError);
  expect((caught as Error).message).toBe(
    'The private KemerBet persistent-browser checkpoint is unavailable.',
  );
  for (const value of redactedValues) {
    expect(String(caught)).not.toContain(value);
  }
}

describe('KemerBet persistent-browser restorable checkpoint', () => {
  it('uses direct CDP Browser.close and attests only after exact disconnection', async () => {
    const harness = browserHarness();
    const assertProfileCleanlyClosed = vi.fn(
      async (profilePath: string, effectiveUserId: number) => {
        harness.order.push('profile-attested');
        expect(profilePath).toBe('opaque-profile-v10');
        expect(effectiveUserId).toBe(10_001);
        expect(harness.isClosed()).toEqual({
          connected: false,
          contextClosed: true,
          pageClosed: true,
        });
      },
    );

    await closeKemerBetPersistentBrowserForRestorableCheckpoint(
      {
        context: harness.context,
        effectiveUserId: 10_001,
        page: harness.page,
        profilePath: 'opaque-profile-v10',
      },
      { assertProfileCleanlyClosed },
    );

    expect(harness.newBrowserCDPSession).toHaveBeenCalledTimes(1);
    expect(harness.send).toHaveBeenCalledExactlyOnceWith('Browser.close');
    expect(harness.order).toEqual(['cdp:Browser.close', 'disconnected', 'profile-attested']);
    expect(assertProfileCleanlyClosed).toHaveBeenCalledExactlyOnceWith(
      'opaque-profile-v10',
      10_001,
    );
    expect(harness.contextClose).not.toHaveBeenCalled();
    expect(harness.browserClose).not.toHaveBeenCalled();
    expect(harness.detach).not.toHaveBeenCalled();
  });

  it('retries only the generic clean-profile attestation after disconnect', async () => {
    const harness = browserHarness();
    const assertProfileCleanlyClosed = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new KemerBetChromiumProfileUnavailableError())
      .mockResolvedValueOnce(undefined);

    await closeKemerBetPersistentBrowserForRestorableCheckpoint(
      {
        context: harness.context,
        effectiveUserId: 10_001,
        page: harness.page,
        profilePath: 'opaque-profile-v10',
      },
      {
        assertProfileCleanlyClosed,
        profileAttestationAttempts: 2,
        profileAttestationIntervalMs: 0,
      },
    );

    expect(assertProfileCleanlyClosed).toHaveBeenCalledTimes(2);
    expect(harness.send).toHaveBeenCalledTimes(1);
  });

  it('fails closed after the bounded clean-profile attestation attempts are exhausted', async () => {
    const harness = browserHarness();
    const assertProfileCleanlyClosed = vi.fn(async () => {
      throw new KemerBetChromiumProfileUnavailableError();
    });

    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: harness.context,
          effectiveUserId: 10_001,
          page: harness.page,
          profilePath: 'opaque-profile-v10',
        },
        {
          assertProfileCleanlyClosed,
          profileAttestationAttempts: 2,
          profileAttestationIntervalMs: 0,
        },
      ),
    );

    expect(assertProfileCleanlyClosed).toHaveBeenCalledTimes(2);
    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.contextClose).not.toHaveBeenCalled();
    expect(harness.browserClose).not.toHaveBeenCalled();
  });

  it.each([
    ['multiple browser contexts', { contextCount: 2 }],
    ['multiple context pages', { pageCount: 2 }],
    ['a page from another context', { pageContextMismatch: true }],
  ])('rejects %s before creating a CDP session', async (_label, options) => {
    const harness = browserHarness(options);

    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: harness.context,
          effectiveUserId: 10_001,
          page: harness.page,
          profilePath: 'opaque-profile-v10',
        },
        { assertProfileCleanlyClosed: vi.fn(async () => undefined) },
      ),
    );

    expect(harness.newBrowserCDPSession).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
    expect(harness.contextClose).not.toHaveBeenCalled();
    expect(harness.browserClose).not.toHaveBeenCalled();
  });

  it('rejects an unexpected effective user before creating a CDP session', async () => {
    const harness = browserHarness();

    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: harness.context,
          effectiveUserId: 10_002,
          page: harness.page,
          profilePath: 'opaque-profile-v10',
        },
        { assertProfileCleanlyClosed: vi.fn(async () => undefined) },
      ),
    );

    expect(harness.newBrowserCDPSession).not.toHaveBeenCalled();
  });

  it('fails closed when disconnect does not close the exact page and context', async () => {
    const harness = browserHarness({ closeContextOnDisconnect: false });
    const assertProfileCleanlyClosed = vi.fn(async () => undefined);

    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: harness.context,
          effectiveUserId: 10_001,
          page: harness.page,
          profilePath: 'opaque-profile-v10',
        },
        { assertProfileCleanlyClosed },
      ),
    );

    expect(harness.send).toHaveBeenCalledExactlyOnceWith('Browser.close');
    expect(assertProfileCleanlyClosed).not.toHaveBeenCalled();
    expect(harness.contextClose).not.toHaveBeenCalled();
    expect(harness.browserClose).not.toHaveBeenCalled();
  });

  it('fails closed and redacts CDP-session and live command rejections', async () => {
    const sessionSecret = 'secret-cdp-session-detail';
    const noSession = browserHarness({ cdpSessionError: new Error(sessionSecret) });
    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: noSession.context,
          effectiveUserId: 10_001,
          page: noSession.page,
          profilePath: 'opaque-profile-v10',
        },
        { assertProfileCleanlyClosed: vi.fn(async () => undefined) },
      ),
      [sessionSecret],
    );

    const commandSecret = 'secret-browser-close-detail';
    const commandRejected = browserHarness({ cdpCommandError: new Error(commandSecret) });
    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: commandRejected.context,
          effectiveUserId: 10_001,
          page: commandRejected.page,
          profilePath: 'opaque-profile-v10',
        },
        {
          assertProfileCleanlyClosed: vi.fn(async () => undefined),
          disconnectTimeoutMs: 10,
        },
      ),
      [commandSecret],
    );
  });

  it('accepts a CDP rejection caused by the accepted command closing its transport', async () => {
    const harness = browserHarness({
      cdpCommandErrorAfterDisconnect: new Error('transport closed after Browser.close'),
    });
    const assertProfileCleanlyClosed = vi.fn(async () => undefined);

    await closeKemerBetPersistentBrowserForRestorableCheckpoint(
      {
        context: harness.context,
        effectiveUserId: 10_001,
        page: harness.page,
        profilePath: 'opaque-profile-v10',
      },
      { assertProfileCleanlyClosed },
    );

    expect(harness.send).toHaveBeenCalledExactlyOnceWith('Browser.close');
    expect(assertProfileCleanlyClosed).toHaveBeenCalledExactlyOnceWith(
      'opaque-profile-v10',
      10_001,
    );
    expect(harness.contextClose).not.toHaveBeenCalled();
    expect(harness.browserClose).not.toHaveBeenCalled();
  });

  it('fails closed on a bounded disconnect timeout without attesting the profile', async () => {
    const harness = browserHarness({ disconnectOnCommand: false });
    const assertProfileCleanlyClosed = vi.fn(async () => undefined);

    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: harness.context,
          effectiveUserId: 10_001,
          page: harness.page,
          profilePath: 'opaque-profile-v10',
        },
        {
          assertProfileCleanlyClosed,
          disconnectTimeoutMs: 1,
        },
      ),
    );

    expect(harness.send).toHaveBeenCalledExactlyOnceWith('Browser.close');
    expect(assertProfileCleanlyClosed).not.toHaveBeenCalled();
    expect(harness.contextClose).not.toHaveBeenCalled();
    expect(harness.browserClose).not.toHaveBeenCalled();
  });

  it('redacts unexpected post-disconnect profile-attestation failures', async () => {
    const harness = browserHarness();
    const attestationSecret = 'secret-profile-attestation-detail';

    await expectCheckpointUnavailable(
      closeKemerBetPersistentBrowserForRestorableCheckpoint(
        {
          context: harness.context,
          effectiveUserId: 10_001,
          page: harness.page,
          profilePath: 'opaque-profile-v10',
        },
        {
          assertProfileCleanlyClosed: vi.fn(async () => {
            throw new Error(attestationSecret);
          }),
          profileAttestationAttempts: 1,
        },
      ),
      [attestationSecret],
    );

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.contextClose).not.toHaveBeenCalled();
    expect(harness.browserClose).not.toHaveBeenCalled();
  });
});
