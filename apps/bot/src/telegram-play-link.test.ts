import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';
import { describe, expect, it, vi } from 'vitest';

import { KEMERBET_PLAY_LINK, loadTelegramKemerbetPlayLink } from './telegram-play-link.js';

describe('Telegram KemerBet Play availability', () => {
  it('offers the stable link when the Owner has a destination, including after an edit', async () => {
    const fetchDestination = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.redirect('https://kemer.co/', 302))
      .mockResolvedValueOnce(Response.redirect('https://new.example/path', 302));

    expect(
      await loadTelegramKemerbetPlayLink(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchDestination),
    ).toBe(KEMERBET_PLAY_LINK);
    expect(
      await loadTelegramKemerbetPlayLink(BOT_PUBLIC_SUPPORT_CONTACT_URL, fetchDestination),
    ).toBe(KEMERBET_PLAY_LINK);
    expect(fetchDestination).toHaveBeenCalledWith(
      KEMERBET_PLAY_LINK,
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
});
