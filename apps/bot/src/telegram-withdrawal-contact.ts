import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';

const WITHDRAWAL_CHAT_LOOKUP_URL = 'https://owner.fetanagent.com/v1/public/withdrawal-chat';
const TELEGRAM_CHAT_URL = /^https:\/\/t\.me\/[a-z0-9_]{5,32}$/u;

/** Resolve the Owner setting before sending a menu; Telegram only receives a direct chat link. */
export async function loadTelegramWithdrawalContact(
  supportContactUrl: string | undefined,
  fetchContact: typeof fetch = fetch,
): Promise<string | null> {
  if (supportContactUrl !== BOT_PUBLIC_SUPPORT_CONTACT_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchContact(WITHDRAWAL_CHAT_LOOKUP_URL, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    const location = response.headers.get('location');
    if (response.status !== 302 || response.redirected || !location) return null;
    return TELEGRAM_CHAT_URL.test(location) ? location : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
