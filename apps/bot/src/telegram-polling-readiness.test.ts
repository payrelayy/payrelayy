import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bot, type ApiClientOptions } from 'grammy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTelegramPollingReadiness,
  isTelegramPollingReady,
  TELEGRAM_POLLING_READINESS_MAX_AGE_MS,
} from './telegram-polling-readiness.js';

let directory: string;
let path: string;
let now: number;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fetanagent-polling-readiness-'));
  path = join(directory, 'readiness.json');
  now = 1_800_000_000_000;
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function indicator(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, processId: process.pid, lastSuccessfulPollAtMs: now, ...overrides };
}

function client(response: unknown = { ok: true, result: [] }) {
  const fetch = vi.fn<NonNullable<ApiClientOptions['fetch']>>(
    async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  // Every SDK request terminates at this local fetch stub; no Telegram traffic is possible.
  const bot = new Bot('123456:local-readiness-test-token', { client: { fetch } });
  const readiness = createTelegramPollingReadiness({ path, now: () => now });
  bot.api.config.use(readiness.transformer);
  return { bot, fetch, readiness };
}

describe('private Telegram polling readiness', () => {
  it('starts unready and removes a previous process indicator', () => {
    writeFileSync(path, JSON.stringify(indicator()));
    expect(isTelegramPollingReady(path, now)).toBe(true);
    createTelegramPollingReadiness({ path, now: () => now });
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });

  it('becomes ready after a successful zero-update poll, without extra requests', async () => {
    const { bot, fetch } = client();
    expect(isTelegramPollingReady(path, now)).toBe(false);
    await expect(bot.api.getUpdates({ timeout: 30 })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/getUpdates$/u);
    expect(isTelegramPollingReady(path, now)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(indicator());
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('records no message data from a successful poll', async () => {
    const updates = [{ update_id: 123456, message: { text: 'private message marker' } }];
    const { bot } = client({ ok: true, result: updates });
    await expect(bot.api.getUpdates({})).resolves.toEqual(updates);
    expect(readFileSync(path, 'utf8')).not.toContain('private message marker');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(indicator());
  });

  it('does not authorize readiness from initialization or unrelated API success', async () => {
    const { bot, fetch } = client({ ok: true, result: true });
    await bot.api.deleteWebhook();
    expect(fetch).toHaveBeenCalledOnce();
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });

  it('expires when polling stalls, including while middleware is hung, and recovers on new success', async () => {
    const { bot, fetch } = client();
    await bot.api.getUpdates({});
    now += TELEGRAM_POLLING_READINESS_MAX_AGE_MS;
    expect(isTelegramPollingReady(path, now)).toBe(true);
    now += 1;
    expect(isTelegramPollingReady(path, now)).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
    await bot.api.getUpdates({});
    expect(isTelegramPollingReady(path, now)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not refresh readiness for Telegram error responses', async () => {
    const { bot, fetch } = client();
    await bot.api.getUpdates({});
    fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: 'private Telegram error marker',
          }),
          { status: 200 },
        ),
    );
    now += TELEGRAM_POLLING_READINESS_MAX_AGE_MS + 1;
    await expect(bot.api.getUpdates({})).rejects.toThrow();
    expect(isTelegramPollingReady(path, now)).toBe(false);
    expect(JSON.parse(readFileSync(path, 'utf8')).lastSuccessfulPollAtMs).toBe(
      now - TELEGRAM_POLLING_READINESS_MAX_AGE_MS - 1,
    );
    expect(readFileSync(path, 'utf8')).not.toContain('private Telegram error marker');
  });

  it('does not refresh readiness after a network failure', async () => {
    const { bot, fetch } = client();
    await bot.api.getUpdates({});
    fetch.mockRejectedValue(new Error('private URL marker'));
    now += TELEGRAM_POLLING_READINESS_MAX_AGE_MS + 1;
    await expect(bot.api.getUpdates({})).rejects.toThrow();
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });

  it('clears on shutdown and ignores the final successful getUpdates acknowledgement', async () => {
    const { bot, readiness, fetch } = client();
    await bot.api.getUpdates({});
    readiness.stop();
    expect(isTelegramPollingReady(path, now)).toBe(false);
    await bot.api.getUpdates({ offset: 1, limit: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });

  it('does not revive readiness when an in-flight poll succeeds after shutdown', async () => {
    const { bot, readiness, fetch } = client();
    let complete!: (response: Response) => void;
    fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const request = bot.api.getUpdates({ timeout: 30 });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    readiness.stop();
    complete(new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }));
    await request;
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });

  it('never breaks successful polling if the indicator cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bot, fetch } = client();
    rmSync(directory, { recursive: true });
    await expect(bot.api.getUpdates({})).resolves.toEqual([]);
    await expect(bot.api.getUpdates({})).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(isTelegramPollingReady(path, now)).toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Telegram polling readiness indicator could not be written.',
    );
  });

  it('fails closed for an invalid clock without interrupting a successful poll', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bot } = client();
    now = Number.NaN;
    await expect(bot.api.getUpdates({})).resolves.toEqual([]);
    expect(isTelegramPollingReady(path, now)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([
    ['', 'empty'],
    ['{', 'truncated'],
    ['null', 'null'],
    ['[]', 'array'],
    ['x'.repeat(257), 'oversized'],
  ])('rejects a %s indicator (%s)', (contents) => {
    writeFileSync(path, contents);
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });

  it.each([
    { schemaVersion: 2 },
    { processId: 0 },
    { processId: -1 },
    { processId: 1.5 },
    { processId: '123' },
    { lastSuccessfulPollAtMs: 0 },
    { lastSuccessfulPollAtMs: '123' },
    { lastSuccessfulPollAtMs: Number.MAX_SAFE_INTEGER + 1 },
    { unexpected: 'private marker' },
  ])('rejects malformed metadata %#', (overrides) => {
    writeFileSync(path, JSON.stringify(indicator(overrides)));
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });

  it('rejects missing fields, future timestamps, dead processes, and non-files', () => {
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, lastSuccessfulPollAtMs: now }));
    expect(isTelegramPollingReady(path, now)).toBe(false);
    writeFileSync(path, JSON.stringify(indicator()));
    expect(isTelegramPollingReady(path, now - 1)).toBe(false);
    expect(isTelegramPollingReady(path, now, () => false)).toBe(false);
    expect(isTelegramPollingReady(path, Number.NaN)).toBe(false);
    expect(isTelegramPollingReady(directory, now)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('rejects symlinks without following their target', () => {
    const target = join(directory, 'other-file.json');
    writeFileSync(target, JSON.stringify(indicator()));
    symlinkSync(target, path);
    expect(isTelegramPollingReady(path, now)).toBe(false);
    createTelegramPollingReadiness({ path, now: () => now });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual(indicator());
    expect(isTelegramPollingReady(path, now)).toBe(false);
  });
});
