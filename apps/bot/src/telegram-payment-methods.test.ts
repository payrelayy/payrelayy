import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';
import { describe, expect, it, vi } from 'vitest';

import { loadTelegramPaymentMethods } from './telegram-payment-methods.js';

const endpoint = 'https://owner.fetanagent.com/v1/public/payment-methods';
const catalogEndpoint = 'https://owner.fetanagent.com/v1/public/deposit-catalog';
const on = { methods: { telebirr: true, cbe_birr: true } };
const catalog = {
  version: 1,
  platforms: [{ code: 'kemerbet', displayName: 'KemerBet', available: true }],
  methods: [
    { code: 'cbe_birr', displayName: 'CBE Birr', accepting: true, implemented: true },
    { code: 'telebirr', displayName: 'TeleBirr', accepting: true, implemented: true },
  ],
};

describe('Telegram payment-method availability', () => {
  it('reads the validated catalog and respects the CBE candidate switch', async () => {
    const fetchMethods = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValueOnce(Response.json(catalog));
    expect(
      await loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, fetchMethods),
    ).toEqual({ telebirr: true, cbe_birr: true });
    expect(
      await loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, false, fetchMethods),
    ).toEqual({ telebirr: true, cbe_birr: false });
    expect(fetchMethods).toHaveBeenCalledWith(
      catalogEndpoint,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      }),
    );
    expect(fetchMethods).toHaveBeenCalledTimes(2);
  });

  it('uses the current availability endpoint while the catalog is unavailable', async () => {
    const fetchMethods = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: 'not_found' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(on));
    await expect(
      loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, fetchMethods),
    ).resolves.toEqual({ telebirr: true, cbe_birr: true });
    expect(fetchMethods.mock.calls.map(([url]) => url)).toEqual([catalogEndpoint, endpoint]);
  });

  it('does not expose an unimplemented method or trust an inconsistent catalog', async () => {
    const future = {
      code: 'future_bank',
      displayName: 'Future Bank',
      accepting: false,
      implemented: false,
    };
    const fetchMethods = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        ...catalog,
        methods: [...catalog.methods, future],
      }),
    );
    await expect(
      loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, fetchMethods),
    ).resolves.toEqual({ telebirr: true, cbe_birr: true });
    expect(fetchMethods).toHaveBeenCalledTimes(1);

    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...catalog,
          methods: [...catalog.methods, { ...future, accepting: true }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ methods: { telebirr: false, cbe_birr: false } }));
    await expect(
      loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, malformed),
    ).resolves.toEqual({ telebirr: false, cbe_birr: false });
  });

  it('hides methods when the owner endpoint is unavailable or malformed', async () => {
    for (const response of [
      Response.json({ methods: { telebirr: true } }),
      Response.json({ methods: { telebirr: true, cbe_birr: true, extra: true } }),
      Response.json(on, { status: 503 }),
      new Response('not JSON', { headers: { 'content-type': 'text/plain' } }),
    ]) {
      const fetchMethods = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(
        await loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, fetchMethods),
      ).toEqual({ telebirr: false, cbe_birr: false });
    }
    const fetchMethods = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    expect(
      await loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, fetchMethods),
    ).toEqual({ telebirr: false, cbe_birr: false });
  });

  it('does not call an unapproved address', async () => {
    const fetchMethods = vi.fn<typeof fetch>();
    expect(
      await loadTelegramPaymentMethods('https://other.example/support', true, fetchMethods),
    ).toEqual({ telebirr: false, cbe_birr: false });
    expect(fetchMethods).not.toHaveBeenCalled();
  });

  it('bounds a response even when the server omits content-length', async () => {
    const fetchMethods = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(' '.repeat(513), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(
      await loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, fetchMethods),
    ).toEqual({ telebirr: false, cbe_birr: false });
  });
});
