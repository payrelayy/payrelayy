import { describe, expect, it, vi } from 'vitest';

import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';
import { loadTelegramWithdrawalContact } from './telegram-withdrawal-contact.js';

describe('Telegram manual withdrawal contact', () => {
  it('reads the current Owner setting server-side and returns only a direct Telegram chat', async () => {
    const fetchContact = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.redirect('https://t.me/balem18', 302))
      .mockResolvedValueOnce(Response.redirect('https://t.me/new_handler', 302));

    expect(await loadTelegramWithdrawalContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact)).toBe(
      'https://t.me/balem18',
    );
    expect(await loadTelegramWithdrawalContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact)).toBe(
      'https://t.me/new_handler',
    );
    expect(fetchContact).toHaveBeenCalledWith(
      'https://owner.fetanagent.com/v1/public/withdrawal-chat',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'manual',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('hides Withdraw if the contact is disabled, unavailable, or not an exact Telegram username', async () => {
    const fetchContact = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(Response.redirect('https://evil.example/handler', 302))
      .mockResolvedValueOnce(Response.redirect('https://t.me/balem18?next=evil', 302));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        await loadTelegramWithdrawalContact(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchContact),
      ).toBeNull();
    }
    expect(await loadTelegramWithdrawalContact(undefined, fetchContact)).toBeNull();
    expect(fetchContact).toHaveBeenCalledTimes(3);
  });
});
