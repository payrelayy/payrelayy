import { Bot, type ApiClientOptions, type PollingOptions } from 'grammy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTelegramPolling } from './telegram-polling-lifecycle.js';

const signals = ['SIGINT', 'SIGTERM'] as const;
const botInfo: Bot['botInfo'] = {
  id: 123456,
  is_bot: true as const,
  first_name: 'Lifecycle test',
  username: 'lifecycle_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function testBot() {
  return {
    init: vi.fn<Bot['init']>(async () => {}),
    start: vi.fn<Bot['start']>(async () => {}),
    stop: vi.fn<Bot['stop']>(async () => {}),
  };
}

let originalExitCode: typeof process.exitCode;
let originalListeners = signals.map((signal) => process.rawListeners(signal));

function lifecycleListeners(signal: (typeof signals)[number]) {
  const original = originalListeners[signals.indexOf(signal)];
  return process.rawListeners(signal).filter((listener) => !original?.includes(listener));
}

function requestShutdown(signal: (typeof signals)[number] = 'SIGTERM') {
  const listeners = lifecycleListeners(signal);
  expect(listeners).toHaveLength(1);
  // Invoke only this lifecycle's listener; never signal the test process or other listeners.
  (listeners[0] as () => void)();
}

function expectListenersRemoved() {
  for (const [index, signal] of signals.entries()) {
    expect(process.rawListeners(signal)).toEqual(originalListeners[index]);
  }
}

beforeEach(() => {
  originalExitCode = process.exitCode;
  originalListeners = signals.map((signal) => process.rawListeners(signal));
  process.exitCode = undefined;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const signal of signals) {
    for (const listener of lifecycleListeners(signal)) {
      process.removeListener(signal, listener as () => void);
    }
  }
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe('Telegram polling lifecycle', () => {
  it('initializes before polling and preserves polling options and the startup callback', async () => {
    const bot = testBot();
    const onStart = vi.fn(async () => {});
    bot.start.mockImplementation(async (options) => {
      expect(bot.init).toHaveBeenCalledOnce();
      expect(options).toMatchObject({ allowed_updates: ['message'], timeout: 15 });
      await options?.onStart?.(botInfo);
    });

    await runTelegramPolling(bot, { allowed_updates: ['message'], timeout: 15, onStart });

    expect(bot.init.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(onStart).toHaveBeenCalledExactlyOnceWith(botInfo);
    expect(bot.stop).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expectListenersRemoved();
  });

  it.each([
    { error: { error_code: 401, description: 'secret-token' }, reason: 'telegram_unauthorized' },
    { error: { error_code: 409, description: 'private-request' }, reason: 'telegram_conflict' },
    { error: new Error('https://example.invalid/bot/private-token'), reason: 'unexpected_error' },
    { error: 'private non-Error failure', reason: 'unexpected_error' },
  ])(
    'reports $reason during initialization without logging the raw failure',
    async ({ error, reason }) => {
      const bot = testBot();
      bot.init.mockRejectedValue(error);

      await runTelegramPolling(bot, {});

      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        { phase: 'initializing', reason },
        'Telegram bot lifecycle failed.',
      );
      expect(process.exitCode).toBe(1);
      expect(bot.start).not.toHaveBeenCalled();
      expectListenersRemoved();
    },
  );

  it.each(['starting', 'polling'] as const)('handles a failure while %s', async (phase) => {
    const bot = testBot();
    bot.start.mockImplementation(async (options) => {
      if (phase === 'polling') await options?.onStart?.(botInfo);
      throw { error_code: 409, description: 'private conflict details' };
    });

    await runTelegramPolling(bot, {});

    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      { phase, reason: 'telegram_conflict' },
      'Telegram bot lifecycle failed.',
    );
    expect(process.exitCode).toBe(1);
    expectListenersRemoved();
  });

  it('classifies a rejected startup callback as a startup failure', async () => {
    const bot = testBot();
    bot.start.mockImplementation(async (options) => {
      await options?.onStart?.(botInfo);
    });

    await runTelegramPolling(bot, {
      onStart: async () => {
        throw new Error('private startup callback failure');
      },
    });

    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      { phase: 'starting', reason: 'unexpected_error' },
      'Telegram bot lifecycle failed.',
    );
    expect(process.exitCode).toBe(1);
    expectListenersRemoved();
  });

  it.each([
    new DOMException('cancelled', 'AbortError'),
    new Error('Aborted delay'),
    Object.assign(new Error('HTTP request failed'), {
      error: new DOMException('cancelled', 'AbortError'),
    }),
  ])('cancels pending initialization on shutdown without starting polling', async (error) => {
    const bot = testBot();
    bot.init.mockImplementation(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(error), { once: true });
        }),
    );

    const running = runTelegramPolling(bot, {});
    requestShutdown('SIGINT');
    requestShutdown('SIGTERM');
    await running;

    expect(bot.init.mock.calls[0]?.[0]?.aborted).toBe(true);
    expect(bot.start).not.toHaveBeenCalled();
    expect(bot.stop).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledExactlyOnceWith('Telegram bot shutdown requested.');
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expectListenersRemoved();
  });

  it('does not start polling when initialization succeeds after a shutdown request', async () => {
    const bot = testBot();
    const initialized = deferred();
    bot.init.mockReturnValue(initialized.promise);

    const running = runTelegramPolling(bot, {});
    requestShutdown();
    initialized.resolve();
    await running;

    expect(bot.start).not.toHaveBeenCalled();
    expect(bot.stop).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expectListenersRemoved();
  });

  it('cancels the installed grammY client using the native initialization signal', async () => {
    const requested = deferred();
    const fetch = vi.fn<NonNullable<ApiClientOptions['fetch']>>(
      (...[_url, options]: Parameters<NonNullable<ApiClientOptions['fetch']>>) =>
        new Promise<never>((_resolve, reject) => {
          const abort = () => reject(new DOMException('cancelled', 'AbortError'));
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener('abort', abort, { once: true });
          requested.resolve();
        }),
    );
    // All SDK requests terminate at this local fetch stub; no Telegram traffic is possible.
    const bot = new Bot('123456:local-test-token', { client: { fetch } });
    const start = vi.spyOn(bot, 'start');
    const stop = vi.spyOn(bot, 'stop');

    const running = runTelegramPolling(bot, {});
    await requested.promise;
    requestShutdown();
    await running;

    expect(fetch).toHaveBeenCalled();
    for (const [url, options] of fetch.mock.calls) {
      expect(String(url)).toMatch(/\/getMe$/);
      expect(options?.signal?.aborted).toBe(true);
    }
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expectListenersRemoved();
  });

  it('does not suppress unrelated initialization failures after a shutdown request', async () => {
    const bot = testBot();
    const initialized = deferred();
    bot.init.mockReturnValue(initialized.promise);

    const running = runTelegramPolling(bot, {});
    requestShutdown();
    initialized.reject(new Error('private unexpected error'));
    await running;

    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      { phase: 'initializing', reason: 'unexpected_error' },
      'Telegram bot lifecycle failed.',
    );
    expect(process.exitCode).toBe(1);
    expectListenersRemoved();
  });

  it('reports an abort as a failure when shutdown was not requested', async () => {
    const bot = testBot();
    bot.init.mockRejectedValue(new DOMException('unexpected cancellation', 'AbortError'));

    await runTelegramPolling(bot, {});

    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      { phase: 'initializing', reason: 'unexpected_error' },
      'Telegram bot lifecycle failed.',
    );
    expect(process.exitCode).toBe(1);
    expectListenersRemoved();
  });

  it.each(['polling', 'shutdown'] as const)(
    'waits for both middleware and the stop acknowledgement when %s settles first',
    async (first) => {
      const bot = testBot();
      const started = deferred();
      const polling = deferred();
      const stopped = deferred();
      bot.start.mockImplementation(async (options) => {
        await options?.onStart?.(botInfo);
        started.resolve();
        await polling.promise;
      });
      bot.stop.mockReturnValue(stopped.promise);

      let completed = false;
      const running = runTelegramPolling(bot, {}).then(() => {
        completed = true;
      });
      await started.promise;
      requestShutdown('SIGTERM');
      requestShutdown('SIGINT');
      (first === 'polling' ? polling : stopped).resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(completed).toBe(false);
      requestShutdown();
      expect(bot.stop).toHaveBeenCalledOnce();
      expect(console.info).toHaveBeenCalledOnce();
      (first === 'polling' ? stopped : polling).resolve();
      await running;

      expect(completed).toBe(true);
      expect(console.error).not.toHaveBeenCalled();
      expectListenersRemoved();
    },
  );

  it('records a failed final acknowledgement even after the polling promise resolves', async () => {
    const bot = testBot();
    const started = deferred();
    const polling = deferred();
    const stopped = deferred();
    bot.start.mockImplementation(async () => {
      started.resolve();
      await polling.promise;
    });
    bot.stop.mockReturnValue(stopped.promise);

    const running = runTelegramPolling(bot, {});
    await started.promise;
    requestShutdown();
    polling.resolve();
    await Promise.resolve();
    stopped.reject({ error_code: 401, description: 'private stop request' });
    await running;

    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      { phase: 'shutdown', reason: 'telegram_unauthorized' },
      'Telegram bot lifecycle failed.',
    );
    expect(process.exitCode).toBe(1);
    expectListenersRemoved();
  });

  it('suppresses a delayed startup callback after shutdown was requested', async () => {
    const bot = testBot();
    const onStart = vi.fn();
    bot.start.mockImplementation(async (options?: PollingOptions) => {
      requestShutdown();
      await options?.onStart?.(botInfo);
    });

    await runTelegramPolling(bot, { onStart });

    expect(onStart).not.toHaveBeenCalled();
    expect(bot.stop).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
    expectListenersRemoved();
  });

  it('catches synchronous stop failures and still drains middleware', async () => {
    const bot = testBot();
    let drained = false;
    bot.start.mockImplementation(async () => {
      requestShutdown();
      drained = true;
    });
    bot.stop.mockImplementation(() => {
      throw new Error('private shutdown failure');
    });

    await runTelegramPolling(bot, {});

    expect(drained).toBe(true);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      { phase: 'shutdown', reason: 'unexpected_error' },
      'Telegram bot lifecycle failed.',
    );
    expect(process.exitCode).toBe(1);
    expectListenersRemoved();
  });
});
