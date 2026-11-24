import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';

// Menus keep this stable link, so an Owner edit also applies to older Play buttons.
export const KEMERBET_PLAY_LINK = 'https://owner.fetanagent.com/v1/public/play/kemerbet';

/** Only offer Play when the Owner has a live destination for this verified platform. */
export async function loadTelegramKemerbetPlayLink(
  supportContactUrl: string | undefined,
  fetchDestination: typeof fetch = fetch,
): Promise<string | null> {
  if (supportContactUrl !== BOT_PUBLIC_SUPPORT_CONTACT_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchDestination(KEMERBET_PLAY_LINK, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.status === 302 && !response.redirected && response.headers.has('location')
      ? KEMERBET_PLAY_LINK
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
