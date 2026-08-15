import type { CookieOptions } from '@supabase/ssr';

import type {
  CustomerWebAuthRequestContext,
  CustomerWebAuthResponseHeaderName,
  CustomerWebCookiePort,
  CustomerWebRequestCookie,
  CustomerWebResponseCookie,
} from './types.js';

const MAX_COOKIE_COUNT = 64;
const MAX_COOKIE_NAME_LENGTH = 128;
const MAX_COOKIE_VALUE_LENGTH = 4096;
const MAX_TOTAL_COOKIE_LENGTH = 16_384;
const MAX_COOKIE_AGE_SECONDS = 34_560_000;
const SAFE_COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const UNSAFE_COOKIE_VALUE = /[\u0000-\u0020\u007f;,]/u;
const ALLOWED_RESPONSE_HEADERS = new Set<CustomerWebAuthResponseHeaderName>([
  'cache-control',
  'expires',
  'pragma',
  'vary',
]);

export interface CustomerWebResponseEffectTransaction {
  readonly context: CustomerWebAuthRequestContext;
  commit(): void;
  commitDeletionsOnly(): void;
}

class InvalidCustomerWebCookiePortError extends Error {}

type DataRecord = Readonly<Record<string, unknown>>;

function readDataRecord(value: unknown): DataRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidCustomerWebCookiePortError();
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidCustomerWebCookiePortError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new InvalidCustomerWebCookiePortError();
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new InvalidCustomerWebCookiePortError();
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof InvalidCustomerWebCookiePortError) throw error;
    throw new InvalidCustomerWebCookiePortError();
  }
}

function readDataArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new InvalidCustomerWebCookiePortError();

  try {
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_COOKIE_COUNT
    ) {
      throw new InvalidCustomerWebCookiePortError();
    }

    const result: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[index.toString()];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new InvalidCustomerWebCookiePortError();
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof InvalidCustomerWebCookiePortError) throw error;
    throw new InvalidCustomerWebCookiePortError();
  }
}

function validateCookieName(name: unknown): string {
  if (
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > MAX_COOKIE_NAME_LENGTH ||
    !SAFE_COOKIE_NAME.test(name)
  ) {
    throw new InvalidCustomerWebCookiePortError();
  }
  return name;
}

function validateCookieValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_COOKIE_VALUE_LENGTH ||
    UNSAFE_COOKIE_VALUE.test(value)
  ) {
    throw new InvalidCustomerWebCookiePortError();
  }
  return value;
}

function readCookiePort(context: CustomerWebAuthRequestContext): CustomerWebCookiePort {
  const contextRecord = readDataRecord(context);
  const portRecord = readDataRecord(contextRecord.cookies);
  for (const method of ['readAll', 'appendSetCookie', 'appendResponseHeader'] as const) {
    if (typeof portRecord[method] !== 'function') {
      throw new InvalidCustomerWebCookiePortError();
    }
  }
  return portRecord as unknown as CustomerWebCookiePort;
}

export function readRequestCookies(
  context: CustomerWebAuthRequestContext,
): readonly CustomerWebRequestCookie[] {
  const port = readCookiePort(context);
  let rawCookies: unknown;
  try {
    rawCookies = port.readAll();
  } catch {
    throw new InvalidCustomerWebCookiePortError();
  }

  const cookies = readDataArray(rawCookies);
  const names = new Set<string>();
  let totalLength = 0;
  return cookies.map((rawCookie) => {
    const cookie = readDataRecord(rawCookie);
    if (Object.keys(cookie).sort().join(',') !== 'name,value') {
      throw new InvalidCustomerWebCookiePortError();
    }
    const name = validateCookieName(cookie.name);
    const value = validateCookieValue(cookie.value);
    if (names.has(name)) throw new InvalidCustomerWebCookiePortError();
    names.add(name);
    totalLength += name.length + value.length;
    if (totalLength > MAX_TOTAL_COOKIE_LENGTH) {
      throw new InvalidCustomerWebCookiePortError();
    }
    return { name, value };
  });
}

function sanitizeCookieOptions(
  rawOptions: unknown,
  value: string,
): Pick<CustomerWebResponseCookie, 'expires' | 'maxAge'> {
  const options = readDataRecord(rawOptions ?? {});
  const sanitized: { expires?: Date; maxAge?: number } = {};

  if (options.maxAge !== undefined) {
    if (
      typeof options.maxAge !== 'number' ||
      !Number.isSafeInteger(options.maxAge) ||
      options.maxAge < 0 ||
      options.maxAge > MAX_COOKIE_AGE_SECONDS
    ) {
      throw new InvalidCustomerWebCookiePortError();
    }
    sanitized.maxAge = options.maxAge;
  }
  if (options.expires !== undefined) {
    if (!(options.expires instanceof Date) || !Number.isFinite(options.expires.getTime())) {
      throw new InvalidCustomerWebCookiePortError();
    }
    sanitized.expires = new Date(options.expires.getTime());
  }

  if (value === '' && sanitized.maxAge === undefined && sanitized.expires === undefined) {
    sanitized.maxAge = 0;
    sanitized.expires = new Date(0);
  }
  return sanitized;
}

function sanitizeResponseHeaders(
  rawHeaders: unknown,
): readonly (readonly [CustomerWebAuthResponseHeaderName, string])[] {
  const headers = readDataRecord(rawHeaders);
  const sanitized: (readonly [CustomerWebAuthResponseHeaderName, string])[] = [];
  let hasPrivateNoStore = false;

  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!ALLOWED_RESPONSE_HEADERS.has(name as CustomerWebAuthResponseHeaderName)) continue;
    if (
      typeof rawValue !== 'string' ||
      rawValue.length < 1 ||
      rawValue.length > 1024 ||
      /[\r\n]/u.test(rawValue)
    ) {
      throw new InvalidCustomerWebCookiePortError();
    }
    if (
      name === 'cache-control' &&
      /(?:^|,)\s*private\s*(?:,|$)/iu.test(rawValue) &&
      /(?:^|,)\s*no-store\s*(?:,|$)/iu.test(rawValue)
    ) {
      hasPrivateNoStore = true;
    }
    sanitized.push([name as CustomerWebAuthResponseHeaderName, rawValue]);
  }

  if (!hasPrivateNoStore) sanitized.push(['cache-control', 'private, no-store']);
  return sanitized;
}

export function appendResponseEffects(
  context: CustomerWebAuthRequestContext,
  rawCookies: readonly {
    readonly name: string;
    readonly options: CookieOptions;
    readonly value: string;
  }[],
  rawHeaders: Readonly<Record<string, string>>,
): void {
  const port = readCookiePort(context);
  const cookies = readDataArray(rawCookies).map((rawCookie): CustomerWebResponseCookie => {
    const cookie = readDataRecord(rawCookie);
    const name = validateCookieName(cookie.name);
    const value = validateCookieValue(cookie.value);
    return {
      ...sanitizeCookieOptions(cookie.options, value),
      httpOnly: true,
      name,
      path: '/',
      sameSite: 'lax',
      secure: true,
      value,
    };
  });
  const headers = sanitizeResponseHeaders(rawHeaders);

  for (const cookie of cookies) port.appendSetCookie(cookie);
  for (const [name, value] of headers) port.appendResponseHeader(name, value);
}

function isDeletion(cookie: CustomerWebResponseCookie): boolean {
  return (
    cookie.maxAge === 0 ||
    (cookie.maxAge === undefined &&
      cookie.expires !== undefined &&
      cookie.expires.getTime() <= Date.now())
  );
}

export function createCustomerWebResponseEffectTransaction(
  destinationContext: CustomerWebAuthRequestContext,
): CustomerWebResponseEffectTransaction {
  const destination = readCookiePort(destinationContext);
  const requestCookies = readRequestCookies(destinationContext);
  const pendingCookies: CustomerWebResponseCookie[] = [];
  const pendingHeaders: (readonly [CustomerWebAuthResponseHeaderName, string])[] = [];
  let settled = false;

  const context: CustomerWebAuthRequestContext = {
    cookies: {
      appendResponseHeader(name, value) {
        if (settled) throw new InvalidCustomerWebCookiePortError();
        pendingHeaders.push([name, value]);
      },
      appendSetCookie(cookie) {
        if (settled) throw new InvalidCustomerWebCookiePortError();
        pendingCookies.push(cookie);
      },
      readAll() {
        return requestCookies;
      },
    },
  };

  function settle(deletionsOnly: boolean): void {
    if (settled) throw new InvalidCustomerWebCookiePortError();
    settled = true;
    const cookies = deletionsOnly ? pendingCookies.filter(isDeletion) : pendingCookies;
    if (deletionsOnly && cookies.length === 0) return;
    for (const cookie of cookies) destination.appendSetCookie(cookie);
    for (const [name, value] of pendingHeaders) {
      destination.appendResponseHeader(name, value);
    }
  }

  return {
    context,
    commit() {
      settle(false);
    },
    commitDeletionsOnly() {
      settle(true);
    },
  };
}
