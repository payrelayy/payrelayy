import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';

export interface TelegramPaymentMethods {
  readonly telebirr: boolean;
  readonly cbe_birr: boolean;
}

const PAYMENT_METHODS_URL = 'https://owner.fetanagent.com/v1/public/payment-methods';
const OFF: TelegramPaymentMethods = Object.freeze({ telebirr: false, cbe_birr: false });

/** Read only the public availability flags; a failure hides payable methods. */
export async function loadTelegramPaymentMethods(
  supportContactUrl: string | undefined,
  receiverSmsCandidateEnabled: boolean,
  fetchMethods: typeof fetch = fetch,
): Promise<TelegramPaymentMethods> {
  // Local development without an Owner public URL keeps its existing test menu.
  if (supportContactUrl === undefined)
    return { telebirr: true, cbe_birr: receiverSmsCandidateEnabled };
  if (supportContactUrl !== BOT_PUBLIC_SUPPORT_CONTACT_URL) return OFF;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetchMethods(PAYMENT_METHODS_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') ||
      Number(response.headers.get('content-length') ?? '0') > 512
    )
      return OFF;
    const reader = response.body?.getReader();
    if (!reader) return OFF;
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      byteLength += part.value.byteLength;
      if (byteLength > 512) {
        await reader.cancel();
        return OFF;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return OFF;
    const envelope = payload as Record<string, unknown>;
    if (Object.keys(envelope).join() !== 'methods') return OFF;
    const methods = envelope.methods;
    if (!methods || typeof methods !== 'object' || Array.isArray(methods)) return OFF;
    const flags = methods as Record<string, unknown>;
    if (
      Object.keys(flags).sort().join() !== 'cbe_birr,telebirr' ||
      typeof flags.telebirr !== 'boolean' ||
      typeof flags.cbe_birr !== 'boolean'
    )
      return OFF;
    return Object.freeze({
      telebirr: flags.telebirr,
      cbe_birr: receiverSmsCandidateEnabled && flags.cbe_birr,
    });
  } catch {
    return OFF;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
