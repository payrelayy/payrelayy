import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';

// Resolve this server-side lookup before sending a menu. The Telegram button itself
// contains only the destination website, never the Owner service URL.
export const KEMERBET_PLAY_LOOKUP_URL = 'https://owner.fetanagent.com/v1/public/play/kemerbet';

function directPlayDestination(value: string | null): string | null {
  if (!value || /[\x00-\x20\x7f\\]/u.test(value) || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.href !== value ||
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== '' ||
      url.port !== '' ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(url.hostname) ||
      !url.hostname.includes('.') ||
      url.hostname.includes('..') ||
      /^\d+(?:\.\d+){3}$/u.test(url.hostname) ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === 'fetanagent.com' ||
      url.hostname.endsWith('.fetanagent.com')
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

/** Only offer Play when the Owner has a live destination for this verified platform. */
export async function loadTelegramKemerbetPlayLink(
  supportContactUrl: string | undefined,
  fetchDestination: typeof fetch = fetch,
): Promise<string | null> {
  if (supportContactUrl !== BOT_PUBLIC_SUPPORT_CONTACT_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchDestination(KEMERBET_PLAY_LOOKUP_URL, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.status === 302 && !response.redirected
      ? directPlayDestination(response.headers.get('location'))
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
