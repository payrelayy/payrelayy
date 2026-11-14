import { BOT_PUBLIC_SUPPORT_CONTACT_URL } from '@fetanagent/config/bot';

export interface TelegramPaymentMethods {
  readonly telebirr: boolean;
  readonly cbe_birr: boolean;
}

const CATALOG_URL = 'https://owner.fetanagent.com/v1/public/deposit-catalog';
const PAYMENT_METHODS_URL = 'https://owner.fetanagent.com/v1/public/payment-methods';
const OFF: TelegramPaymentMethods = Object.freeze({ telebirr: false, cbe_birr: false });
const CODE = /^[a-z0-9_]{1,48}$/u;

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  if (
    response.status !== 200 ||
    response.redirected ||
    !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') ||
    Number(response.headers.get('content-length') ?? '0') > maximumBytes
  )
    return undefined;
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    byteLength += part.value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function legacyFlags(value: unknown): TelegramPaymentMethods | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const envelope = value as Record<string, unknown>;
  if (Object.keys(envelope).join() !== 'methods') return undefined;
  const methods = envelope.methods;
  if (!methods || typeof methods !== 'object' || Array.isArray(methods)) return undefined;
  const flags = methods as Record<string, unknown>;
  if (
    Object.keys(flags).sort().join() !== 'cbe_birr,telebirr' ||
    typeof flags.telebirr !== 'boolean' ||
    typeof flags.cbe_birr !== 'boolean'
  )
    return undefined;
  return { telebirr: flags.telebirr, cbe_birr: flags.cbe_birr };
}

function catalogFlags(value: unknown): TelegramPaymentMethods | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const catalog = value as Record<string, unknown>;
  if (
    Object.keys(catalog).sort().join() !== 'methods,platforms,version' ||
    catalog.version !== 1 ||
    !Array.isArray(catalog.platforms) ||
    !Array.isArray(catalog.methods) ||
    catalog.platforms.length < 1 ||
    catalog.platforms.length > 32 ||
    catalog.methods.length < 2 ||
    catalog.methods.length > 32
  )
    return undefined;
  const platformCodes = new Set<string>();
  let kemerbetAvailable = false;
  for (const item of catalog.platforms) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const platform = item as Record<string, unknown>;
    if (
      Object.keys(platform).sort().join() !== 'available,code,displayName' ||
      typeof platform.code !== 'string' ||
      !CODE.test(platform.code) ||
      typeof platform.displayName !== 'string' ||
      !platform.displayName.trim() ||
      platform.displayName.length > 80 ||
      typeof platform.available !== 'boolean' ||
      platformCodes.has(platform.code) ||
      (platform.code !== 'kemerbet' && platform.available)
    )
      return undefined;
    platformCodes.add(platform.code);
    if (platform.code === 'kemerbet') kemerbetAvailable = platform.available;
  }
  if (!platformCodes.has('kemerbet')) return undefined;
  const methodCodes = new Set<string>();
  const flags = new Map<string, boolean>();
  for (const item of catalog.methods) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const method = item as Record<string, unknown>;
    if (
      Object.keys(method).sort().join() !== 'accepting,code,displayName,implemented' ||
      typeof method.code !== 'string' ||
      !CODE.test(method.code) ||
      typeof method.displayName !== 'string' ||
      !method.displayName.trim() ||
      method.displayName.length > 80 ||
      typeof method.accepting !== 'boolean' ||
      typeof method.implemented !== 'boolean' ||
      methodCodes.has(method.code) ||
      (method.code !== 'telebirr' &&
        method.code !== 'cbe_birr' &&
        (method.implemented || method.accepting)) ||
      (method.accepting && (!method.implemented || !kemerbetAvailable))
    )
      return undefined;
    methodCodes.add(method.code);
    flags.set(method.code, method.accepting);
  }
  if (!methodCodes.has('telebirr') || !methodCodes.has('cbe_birr')) return undefined;
  return { telebirr: flags.get('telebirr')!, cbe_birr: flags.get('cbe_birr')! };
}

/** A malformed or unavailable catalog falls back to the existing validated endpoint. */
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
  const request = (url: string) =>
    fetchMethods(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
  try {
    try {
      const catalog = catalogFlags(await boundedJson(await request(CATALOG_URL), 4096));
      if (catalog)
        return Object.freeze({
          telebirr: catalog.telebirr,
          cbe_birr: receiverSmsCandidateEnabled && catalog.cbe_birr,
        });
    } catch {
      // The old endpoint stays authoritative while the catalog is rolled out.
    }
    const flags = legacyFlags(await boundedJson(await request(PAYMENT_METHODS_URL), 512));
    if (!flags) return OFF;
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
