import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';

const MAX_RESPONSE_BYTES = 2048;
const REQUEST_TIMEOUT_MS = 3000;

export const TELEGRAM_SUPPORT_HELP_TEXT = 'For app or account-access help, use /support.';
export const TELEGRAM_SUPPORT_UNAVAILABLE_TEXT =
  'FetanAgent support contact is not available right now. Please try /support again later.\nNever share your password or one-time code (OTP).';

interface SupportMessage {
  readonly text?: string | undefined;
  readonly chat?: { readonly id: number; readonly type: string } | undefined;
  readonly from?: { readonly id: number; readonly isBot: boolean } | undefined;
}

function hasOnlyKey(value: unknown, key: string): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    Object.hasOwn(value, key)
  );
}

function parseContact(value: unknown): string | null {
  if (
    !hasOnlyKey(value, 'supportContact') ||
    !hasOnlyKey(value.supportContact, 'telegramUsername')
  ) {
    throw new Error('Invalid public support response.');
  }
  const username = value.supportContact.telegramUsername;
  if (username === null) return null;
  if (
    typeof username !== 'string' ||
    username.length < 5 ||
    username.length > 32 ||
    /[^a-z0-9_]/u.test(username)
  ) {
    throw new Error('Invalid public support response.');
  }
  return `https://t.me/${username}`;
}

async function readContact(response: Response, signal: AbortSignal): Promise<string | null> {
  if (response.status !== 200 || response.redirected || !response.body) {
    throw new Error('Public support response unavailable.');
  }
  const contentType = response.headers.get('content-type');
  if (!contentType || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new Error('Invalid public support response.');
  }
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error('Public support response too large.');
  }
  const reader = response.body.getReader();
  const cancelRead = () => {
    // Cancellation is best-effort and must never extend the overall deadline.
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelRead, { once: true });
  const bytes = new Uint8Array(MAX_RESPONSE_BYTES);
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Public support request timed out.');
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > MAX_RESPONSE_BYTES - length) {
        throw new Error('Public support response too large.');
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    if (signal.aborted) throw new Error('Public support request timed out.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    return parseContact(JSON.parse(text) as unknown);
  } finally {
    signal.removeEventListener('abort', cancelRead);
    cancelRead();
  }
}

export async function loadTelegramSupportContact(
  url: string | undefined,
  fetchContact: typeof fetch = fetch,
): Promise<string | null> {
  // Defense in depth: even a caller bypassing configuration cannot choose an origin.
  if (url !== BOT_PUBLIC_SUPPORT_CONTACT_URL) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Public support request timed out.'));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchContact(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: controller.signal,
        });
        return readContact(response, controller.signal);
      })(),
      deadline,
    ]);
  } catch {
    // Never expose transport errors, response bodies or a fallback contact to users.
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

/** Public help is consumed before customer, admission and payment pipelines. */
export async function handleTelegramSupportMessage(
  metadata: SupportMessage,
  url: string | undefined,
  dependencies: {
    readonly reply: (text: string) => Promise<unknown>;
    readonly fetchContact?: typeof fetch;
    readonly botUsername?: string | undefined;
  },
): Promise<'ignored' | 'handled'> {
  if (typeof metadata.text !== 'string' || !/^\/support(?=@|\s|$)/u.test(metadata.text)) {
    return 'ignored';
  }
  if (metadata.text.startsWith('/support@')) {
    const addressedUsername = /^\/support@([A-Za-z0-9_]{5,32})(?:\s|$)/u.exec(metadata.text)?.[1];
    const botUsername = dependencies.botUsername;
    // Consume malformed or other-bot support commands without entering customer pipelines.
    // The current identity comes from grammY's initialized bot info, not message content.
    if (
      !addressedUsername ||
      typeof botUsername !== 'string' ||
      botUsername.length < 5 ||
      botUsername.length > 32 ||
      /[^A-Za-z0-9_]/u.test(botUsername) ||
      addressedUsername.toLowerCase() !== botUsername.toLowerCase()
    ) {
      return 'handled';
    }
  }
  const { chat, from } = metadata;
  if (
    chat?.type !== 'private' ||
    !from ||
    from.isBot !== false ||
    !Number.isSafeInteger(chat.id) ||
    chat.id <= 0 ||
    !Number.isSafeInteger(from.id) ||
    from.id !== chat.id
  ) {
    return 'handled';
  }
  const contact = await loadTelegramSupportContact(url, dependencies.fetchContact);
  await dependencies.reply(
    contact
      ? `For FetanAgent app or account-access help, contact support:\n${contact}\nNever share your password or one-time code (OTP).`
      : TELEGRAM_SUPPORT_UNAVAILABLE_TEXT,
  );
  return 'handled';
}
