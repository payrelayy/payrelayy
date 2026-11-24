import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';
import { describe, expect, it, vi } from 'vitest';

import { KEMERBET_PLAY_LOOKUP_URL, loadTelegramKemerbetPlayLink } from './telegram-play-link.js';

describe('Telegram KemerBet Play availability', () => {
  it('puts only the current destination in each new menu, including after an Owner edit', async () => {
    const fetchDestination = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.redirect('https://kemer.co/', 302))
      .mockResolvedValueOnce(Response.redirect('https://new.example/path', 302));

    expect(
      await loadTelegramKemerbetPlayLink(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchDestination),
    ).toBe('https://kemer.co/');
    expect(
      await loadTelegramKemerbetPlayLink(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchDestination),
    ).toBe('https://new.example/path');
    expect(fetchDestination).toHaveBeenCalledWith(
      KEMERBET_PLAY_LOOKUP_URL,
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('omits Play when the setting or Owner service is unavailable', async () => {
    const fetchDestination = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('disabled', { status: 503 }))
      .mockRejectedValueOnce(new Error('network'));
    expect(
      await loadTelegramKemerbetPlayLink(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchDestination),
    ).toBeNull();
    expect(
      await loadTelegramKemerbetPlayLink(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchDestination),
    ).toBeNull();
    expect(await loadTelegramKemerbetPlayLink(undefined, fetchDestination)).toBeNull();
    expect(fetchDestination).toHaveBeenCalledTimes(2);
  });

  it('never places an Owner URL or an unsafe destination in a Telegram button', async () => {
    for (const destination of [
      'https://owner.fetanagent.com/owner',
      'https://fetanagent.com/',
      'http://kemer.co/',
      'https://user:secret@kemer.co/',
      'https://127.0.0.1/',
      'https://kemer.co\\@evil.example/',
    ]) {
      const fetchDestination = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 302, headers: { location: destination } }));
      expect(
        await loadTelegramKemerbetPlayLink(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchDestination),
      ).toBeNull();
    }
  });
});
