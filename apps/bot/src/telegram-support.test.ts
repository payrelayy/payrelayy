import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleTelegramSupportMessage,
  loadTelegramSupportContact,
  TELEGRAM_SUPPORT_UNAVAILABLE_TEXT,
} from './telegram-support.js';

const contact = (telegramUsername: unknown) => ({ supportContact: { telegramUsername } });
const json = (value: unknown) => Response.json(value);
const privateMessage = {
  text: '/support',
  chat: { id: 123456789, type: 'private' },
  from: { id: 123456789, isBot: false },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('public Telegram support contact transport', () => {
  it('uses only an anonymous, uncached GET to the exact approved URL', async () => {
    const fetchContact = vi.fn<typeof fetch>().mockResolvedValue(json(contact('help_team')));
    expect(await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact)).toBe(
      'https://t.me/help_team',
    );
    expect(fetchContact).toHaveBeenCalledOnce();
    expect(fetchContact).toHaveBeenCalledWith(BOT_PUBLIC_SUPPORT_CONTACT_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([undefined, '', 'http://localhost/', `${BOT_PUBLIC_SUPPORT_CONTACT_URL}?id=123`])(
    'does not request an absent or unapproved URL: %s',
    async (url) => {
      const fetchContact = vi.fn<typeof fetch>();
      expect(await loadTelegramSupportContact(url, fetchContact)).toBeNull();
      expect(fetchContact).not.toHaveBeenCalled();
    },
  );

  it('fetches contact changes on the next request and never retains removed contacts', async () => {
    const fetchContact = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(contact('first_team')))
      .mockResolvedValueOnce(json(contact('second_team')))
      .mockResolvedValueOnce(json(contact(null)))
      .mockRejectedValueOnce(new Error('private transport detail'));
    expect(await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact)).toBe(
      'https://t.me/first_team',
    );
    expect(await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact)).toBe(
      'https://t.me/second_team',
    );
    expect(
      await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact),
    ).toBeNull();
    expect(
      await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact),
    ).toBeNull();
    expect(fetchContact).toHaveBeenCalledTimes(4);
  });

  it.each([
    {},
    null,
    [],
    { supportContact: null },
    { supportContact: { telegramUsername: 'valid_name', unexpected: true } },
    { supportContact: { telegramUsername: 'valid_name' }, unexpected: true },
    contact('UPPER_NAME'),
    contact('@username'),
    contact('https://evil.example'),
    contact('abcd'),
    contact('a'.repeat(33)),
    contact('valid_name\n'),
    contact('hello world'),
    contact('tеam_name'),
    contact(123456),
    contact({ username: 'valid_name' }),
  ])('rejects malformed or noncanonical contact response %#', async (body) => {
    const fetchContact = vi.fn<typeof fetch>().mockResolvedValue(json(body));
    expect(
      await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact),
    ).toBeNull();
  });

  it.each(['abcde', 'a'.repeat(32), 'team_123'])(
    'accepts valid boundary username %s',
    async (name) => {
      const fetchContact = vi.fn<typeof fetch>().mockResolvedValue(json(contact(name)));
      expect(await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact)).toBe(
        `https://t.me/${name}`,
      );
    },
  );

  it.each([
    () => new Response('private error', { status: 503 }),
    () => new Response(null, { status: 204 }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify(contact('valid_name'))),
    () => new Response('x'.repeat(2049), { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response(JSON.stringify(contact('valid_name')), {
        headers: { 'content-type': 'application/json', 'content-length': '2049' },
      }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  ])('returns unavailable for failed or invalid HTTP response %#', async (createResponse) => {
    const fetchContact = vi.fn<typeof fetch>().mockResolvedValue(createResponse());
    expect(
      await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact),
    ).toBeNull();
  });

  it('rejects a response that reports a redirect even if fetch fails to enforce redirect:error', async () => {
    const response = json(contact('valid_name'));
    Object.defineProperty(response, 'redirected', { value: true });
    const fetchContact = vi.fn<typeof fetch>().mockResolvedValue(response);
    expect(
      await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact),
    ).toBeNull();
  });

  it('caps streamed response bytes even with a false Content-Length header', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
        controller.enqueue(new Uint8Array(1025));
        controller.close();
      },
    });
    const fetchContact = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream, {
        headers: { 'content-type': 'application/json', 'content-length': '2' },
      }),
    );
    expect(
      await loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact),
    ).toBeNull();
  });

  it('bounds a fetch that never settles and aborts the request', async () => {
    vi.useFakeTimers();
    const fetchContact = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const result = loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBeNull();
    expect(fetchContact.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one total deadline across response headers and a stalled body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start() {}, cancel });
    const fetchContact = vi.fn<typeof fetch>().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return new Response(stream, { headers: { 'content-type': 'application/json' } });
    });
    const result = loadTelegramSupportContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBeNull();
    expect(fetchContact.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('private human /support routing', () => {
  it('sends a generic access-help message without adding Telegram metadata to the request', async () => {
    const reply = vi.fn(async () => {});
    const fetchContact = vi.fn<typeof fetch>().mockResolvedValue(json(contact('help_team')));
    expect(
      await handleTelegramSupportMessage(privateMessage, BOT_PUBLIC_SUPPORT_CONTACT_URL, {
        reply,
        fetchContact,
      }),
    ).toBe('handled');
    expect(reply).toHaveBeenCalledWith(
      'For FetanAgent app or account-access help, contact support:\nhttps://t.me/help_team\nNever share your password or one-time code (OTP).',
    );
    expect(JSON.stringify(fetchContact.mock.calls)).not.toContain('123456789');
  });

  it('honestly reports unavailable with no configuration and no network request', async () => {
    const reply = vi.fn(async () => {});
    const fetchContact = vi.fn<typeof fetch>();
    await handleTelegramSupportMessage(privateMessage, undefined, { reply, fetchContact });
    expect(reply).toHaveBeenCalledWith(TELEGRAM_SUPPORT_UNAVAILABLE_TEXT);
    expect(fetchContact).not.toHaveBeenCalled();
  });

  it.each([
    { ...privateMessage, chat: { id: 123456789, type: 'group' } },
    { ...privateMessage, chat: { id: 123456789, type: 'supergroup' } },
    { ...privateMessage, chat: { id: 123456789, type: 'channel' } },
    { ...privateMessage, from: { id: 123456789, isBot: true } },
    { ...privateMessage, from: { id: 987654321, isBot: false } },
    { ...privateMessage, from: undefined },
    { ...privateMessage, chat: undefined },
    { ...privateMessage, chat: { id: 1.5, type: 'private' } },
  ])(
    'consumes unsupported identities without replying or entering another pipeline %#',
    async (input) => {
      const reply = vi.fn(async () => {});
      const fetchContact = vi.fn<typeof fetch>();
      expect(
        await handleTelegramSupportMessage(input, BOT_PUBLIC_SUPPORT_CONTACT_URL, {
          reply,
          fetchContact,
        }),
      ).toBe('handled');
      expect(reply).not.toHaveBeenCalled();
      expect(fetchContact).not.toHaveBeenCalled();
    },
  );

  it.each(['/help', '/deposit', '/menu', '/supporter', 'support', undefined])(
    'leaves unrelated messages unchanged: %s',
    async (text) => {
      const reply = vi.fn(async () => {});
      const fetchContact = vi.fn<typeof fetch>();
      expect(
        await handleTelegramSupportMessage(
          { ...privateMessage, text },
          BOT_PUBLIC_SUPPORT_CONTACT_URL,
          {
            reply,
            fetchContact,
          },
        ),
      ).toBe('ignored');
      expect(reply).not.toHaveBeenCalled();
      expect(fetchContact).not.toHaveBeenCalled();
    },
  );
});
