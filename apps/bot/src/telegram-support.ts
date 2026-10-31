import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';

const MAX_RESPONSE_BYTES = 2048;
const REQUEST_TIMEOUT_MS = 3000;

export type TelegramSupportLookupFailure =
  'not_configured' | 'timeout' | 'http_unavailable' | 'invalid_response' | 'transport_unavailable';

class SupportLookupError extends Error {
  constructor(readonly reason: TelegramSupportLookupFailure) {
    super(reason);
  }
}

export const TELEGRAM_SUPPORT_HELP_TEXT = 'Help: /support.';
export const TELEGRAM_SUPPORT_UNAVAILABLE_TEXT =
  'Support is unavailable right now. Please try again later.';

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
    throw new SupportLookupError('invalid_response');
  }
  const username = value.supportContact.telegramUsername;
  if (username === null) return null;
  if (
    typeof username !== 'string' ||
    username.length < 5 ||
    username.length > 32 ||
    /[^a-z0-9_]/u.test(username)
  ) {
    throw new SupportLookupError('invalid_response');
  }
  return `https://t.me/${username}`;
}

async function readContact(response: Response, signal: AbortSignal): Promise<string | null> {
  if (response.status !== 200 || response.redirected || !response.body) {
    throw new SupportLookupError('http_unavailable');
  }
  const contentType = response.headers.get('content-type');
  if (!contentType || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new SupportLookupError('invalid_response');
  }
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new SupportLookupError('invalid_response');
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
      if (signal.aborted) throw new SupportLookupError('timeout');
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > MAX_RESPONSE_BYTES - length) {
        throw new SupportLookupError('invalid_response');
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    if (signal.aborted) throw new SupportLookupError('timeout');
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
      return parseContact(JSON.parse(text) as unknown);
    } catch {
      throw new SupportLookupError('invalid_response');
    }
  } finally {
    signal.removeEventListener('abort', cancelRead);
    cancelRead();
  }
}

async function lookupTelegramSupportContact(
  url: string | undefined,
  fetchContact: typeof fetch = fetch,
): Promise<
  | { readonly kind: 'verified'; readonly contact: string | null }
  | { readonly kind: 'failed'; readonly reason: TelegramSupportLookupFailure }
> {
  // Defense in depth: even a caller bypassing configuration cannot choose an origin.
  if (url !== BOT_PUBLIC_SUPPORT_CONTACT_URL) return { kind: 'failed', reason: 'not_configured' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new SupportLookupError('timeout'));
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    const contact = await Promise.race([
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
    return { kind: 'verified', contact };
  } catch (error) {
    // Never expose transport errors or response bodies to customers or diagnostics.
    return {
      kind: 'failed',
      reason: timedOut
        ? 'timeout'
        : error instanceof SupportLookupError
          ? error.reason
          : 'transport_unavailable',
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

export async function loadTelegramSupportContact(
  url: string | undefined,
  fetchContact: typeof fetch = fetch,
): Promise<string | null> {
  const result = await lookupTelegramSupportContact(url, fetchContact);
  return result.kind === 'verified' ? result.contact : null;
}

/** Keep the last verified contact while the running bot is serving an Owner API outage. */
export function createTelegramSupportContactResolver(
  url: string | undefined,
  dependencies: {
    readonly fetchContact?: typeof fetch;
    readonly reportFailure?: (
      reason: TelegramSupportLookupFailure,
      cachedContactUsed: boolean,
    ) => void;
  } = {},
): { readonly resolve: () => Promise<string | null> } {
  let lastVerifiedContact: string | null = null;
  let hasVerifiedResponse = false;
  let pending: Promise<string | null> | undefined;
  return {
    resolve() {
      if (pending) return pending;
      pending = (async () => {
        const result = await lookupTelegramSupportContact(url, dependencies.fetchContact);
        if (result.kind === 'verified') {
          // A deliberate Owner disable is a verified null and clears the fallback.
          hasVerifiedResponse = true;
          lastVerifiedContact = result.contact;
          return result.contact;
        }
        const cachedContactUsed = hasVerifiedResponse && lastVerifiedContact !== null;
        if (result.reason !== 'not_configured')
          dependencies.reportFailure?.(result.reason, cachedContactUsed);
        return cachedContactUsed ? lastVerifiedContact : null;
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}

/** Public help is consumed before customer, admission and payment pipelines. */
export async function handleTelegramSupportMessage(
  metadata: SupportMessage,
  url: string | undefined,
  dependencies: {
    readonly reply: (text: string) => Promise<unknown>;
    readonly fetchContact?: typeof fetch;
    readonly resolveContact?: () => Promise<string | null>;
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
  const contact = dependencies.resolveContact
    ? await dependencies.resolveContact()
    : await loadTelegramSupportContact(url, dependencies.fetchContact);
  await dependencies.reply(
    contact ? `Contact support: ${contact}` : TELEGRAM_SUPPORT_UNAVAILABLE_TEXT,
  );
  return 'handled';
}
