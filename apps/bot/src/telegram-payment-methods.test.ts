import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';
import { describe, expect, it, vi } from 'vitest';

import { loadTelegramPaymentMethods } from './telegram-payment-methods.js';

const endpoint = 'https://owner.fetanagent.com/v1/public/payment-methods';
const on = { methods: { telebirr: true, cbe_birr: true } };

describe('Telegram payment-method availability', () => {
  it('reads only the approved public endpoint and respects the CBE candidate switch', async () => {
    const fetchMethods = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(on))
      .mockResolvedValueOnce(Response.json(on));
    expect(
      await loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, true, fetchMethods),
    ).toEqual({ telebirr: true, cbe_birr: true });
    expect(
      await loadTelegramPaymentMethods(BOT_PUBLIC_SUPPORT_CONTACT_URL, false, fetchMethods),
    ).toEqual({ telebirr: true, cbe_birr: false });
    expect(fetchMethods).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      }),
    );
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
