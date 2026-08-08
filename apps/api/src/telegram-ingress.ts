import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import {
  TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
  TELEGRAM_PRIVATE_INGRESS_HEADERS,
  TELEGRAM_PRIVATE_INGRESS_KEY_ID,
  TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES,
  TELEGRAM_PRIVATE_INGRESS_MAX_TIMESTAMP_SKEW_SECONDS,
  TELEGRAM_PRIVATE_INGRESS_PATH,
  telegramPrivateIngressSignatureInput,
  type TelegramPrivateInboundEvent,
} from '@payreplayy/contracts';

export interface TelegramPrivateInboundRecord {
  readonly event: TelegramPrivateInboundEvent;
  /** API-only database integrity value, never supplied by the bot. */
  readonly payloadHmac: string;
}

export interface TelegramPrivateInboundRecorder {
  record(input: TelegramPrivateInboundRecord): Promise<void>;
}

/**
 * Production activation needs a durable implementation shared by every API replica. The in-memory
 * implementation exists only for non-production tests and local scaffolding.
 */
export interface TelegramIngressNonceStore {
  readonly durable: boolean;
  /**
   * Atomically reserves a nonce through its expiry. Durable implementations are intentionally
   * asynchronous because they must coordinate across API replicas.
   */
  reserve(nonce: string, expiresAtMs: number, nowMs: number): Promise<boolean>;
}

export class InMemoryTelegramIngressNonceStore implements TelegramIngressNonceStore {
  readonly durable = false;
  private readonly entries = new Map<string, number>();

  constructor(private readonly maximumEntries = 10_000) {}

  async reserve(nonce: string, expiresAtMs: number, nowMs: number): Promise<boolean> {
    for (const [recordedNonce, expiry] of this.entries) {
      if (expiry <= nowMs) this.entries.delete(recordedNonce);
    }

    if (this.entries.has(nonce) || this.entries.size >= this.maximumEntries) {
      return false;
    }

    this.entries.set(nonce, expiresAtMs);
    return true;
  }
}

export interface TelegramIngressRequest {
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly method: string;
  readonly url: string | undefined;
}

export interface TelegramIngressVerificationOptions {
  readonly transportHmacSecret: string;
  readonly payloadHmacSecret: string;
  readonly now: Date;
  readonly nonceStore: TelegramIngressNonceStore;
}

const MAXIMUM_TELEGRAM_IDENTIFIER = 9_007_199_254_740_991n;
const SIGNATURE_PATTERN = /^v1\.([A-Za-z0-9_-]{43})$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const TIMESTAMP_PATTERN = /^[1-9][0-9]{9,12}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const EVENT_KEYS = new Set([
  'version',
  'updateId',
  'telegramUserId',
  'privateChatId',
  'firstName',
  'lastName',
  'username',
  'preferredLocale',
]);

function oneHeaderValue(request: TelegramIngressRequest, name: string): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const headerName = request.rawHeaders[index];
    const headerValue = request.rawHeaders[index + 1];
    if (headerName?.toLowerCase() === name && headerValue !== undefined) {
      values.push(headerValue);
    }
  }

  if (values.length > 0) {
    return values.length === 1 ? values[0] : undefined;
  }

  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function hasDuplicateHeader(request: TelegramIngressRequest, name: string): boolean {
  let rawHeaderCount = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      rawHeaderCount += 1;
    }
  }

  if (rawHeaderCount > 0) return rawHeaderCount > 1;

  const value = request.headers[name];
  return Array.isArray(value) && value.length !== 1;
}

function canonicalTelegramIdentifier(value: unknown, permitsZero: boolean): string | undefined {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/.test(value)) {
    return undefined;
  }

  const numericValue = BigInt(value);
  if (numericValue > MAXIMUM_TELEGRAM_IDENTIFIER || (!permitsZero && numericValue === 0n)) {
    return undefined;
  }

  return value;
}

function validProfileText(value: unknown, required: boolean): string | null | undefined {
  if (value === null && !required) return null;
  if (typeof value !== 'string') return undefined;
  if (value.length > 256 || value.trim().length === 0 || CONTROL_CHARACTER_PATTERN.test(value)) {
    return undefined;
  }
  return value;
}

function validUsername(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !USERNAME_PATTERN.test(value)) return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTelegramPrivateInboundEvent(
  rawBody: Buffer,
): TelegramPrivateInboundEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !EVENT_KEYS.has(key))) {
    return undefined;
  }

  const updateId = canonicalTelegramIdentifier(parsed.updateId, true);
  const telegramUserId = canonicalTelegramIdentifier(parsed.telegramUserId, false);
  const privateChatId = canonicalTelegramIdentifier(parsed.privateChatId, false);
  const firstName = validProfileText(parsed.firstName, true);
  const lastName = validProfileText(parsed.lastName, false);
  const username = validUsername(parsed.username);
  const preferredLocale =
    parsed.preferredLocale === 'en' || parsed.preferredLocale === 'am'
      ? parsed.preferredLocale
      : undefined;

  if (
    parsed.version !== 1 ||
    updateId === undefined ||
    telegramUserId === undefined ||
    privateChatId === undefined ||
    typeof firstName !== 'string' ||
    lastName === undefined ||
    username === undefined ||
    preferredLocale === undefined
  ) {
    return undefined;
  }

  return {
    version: 1,
    updateId,
    telegramUserId,
    privateChatId,
    firstName,
    lastName,
    username,
    preferredLocale,
  };
}

function bodyDigest(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

function transportSignature(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  return createHmac('sha256', Buffer.from(transportHmacSecret, 'hex'))
    .update(
      telegramPrivateIngressSignatureInput({
        timestamp,
        nonce,
        bodyByteLength: rawBody.byteLength,
        bodySha256: bodyDigest(rawBody),
      }),
      'utf8',
    )
    .digest('base64url');
}

function payloadHmac(event: TelegramPrivateInboundEvent, payloadHmacSecret: string): string {
  const canonicalPayload = JSON.stringify({
    version: event.version,
    updateId: event.updateId,
    telegramUserId: event.telegramUserId,
    privateChatId: event.privateChatId,
    firstName: event.firstName,
    lastName: event.lastName,
    username: event.username,
    preferredLocale: event.preferredLocale,
  });

  return `hmac-sha256-v1:${createHmac('sha256', Buffer.from(payloadHmacSecret, 'hex'))
    .update('payreplayy-telegram-inbound-payload-v1\n', 'utf8')
    .update(canonicalPayload, 'utf8')
    .digest('hex')}`;
}

/**
 * Authenticate the internal request before decoding the JSON body. Every failure intentionally
 * returns undefined so the API exposes no signature, parser, or nonce details to a caller.
 */
export async function verifyTelegramIngressRequest(
  request: TelegramIngressRequest,
  rawBody: Buffer,
  options: TelegramIngressVerificationOptions,
): Promise<TelegramPrivateInboundRecord | undefined> {
  const requiredOrOptionalHeaders = [
    'content-type',
    'content-encoding',
    TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId,
    TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp,
    TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce,
    TELEGRAM_PRIVATE_INGRESS_HEADERS.signature,
  ];

  if (
    requiredOrOptionalHeaders.some((name) => hasDuplicateHeader(request, name)) ||
    request.method !== 'POST' ||
    request.url !== TELEGRAM_PRIVATE_INGRESS_PATH ||
    rawBody.byteLength > TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES ||
    oneHeaderValue(request, 'content-type') !== TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE ||
    oneHeaderValue(request, 'content-encoding') !== undefined ||
    oneHeaderValue(request, TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId) !==
      TELEGRAM_PRIVATE_INGRESS_KEY_ID
  ) {
    return undefined;
  }

  const timestamp = oneHeaderValue(request, TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp);
  const nonce = oneHeaderValue(request, TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce);
  const presentedSignature = oneHeaderValue(request, TELEGRAM_PRIVATE_INGRESS_HEADERS.signature);

  if (!timestamp || !TIMESTAMP_PATTERN.test(timestamp) || !nonce || !NONCE_PATTERN.test(nonce)) {
    return undefined;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > TELEGRAM_PRIVATE_INGRESS_MAX_TIMESTAMP_SKEW_SECONDS
  ) {
    return undefined;
  }

  const signatureMatch = presentedSignature?.match(SIGNATURE_PATTERN);
  if (!signatureMatch?.[1]) return undefined;

  const expectedSignature = transportSignature(
    options.transportHmacSecret,
    timestamp,
    nonce,
    rawBody,
  );
  if (
    !timingSafeEqual(Buffer.from(expectedSignature, 'utf8'), Buffer.from(signatureMatch[1], 'utf8'))
  ) {
    return undefined;
  }

  const event = parseTelegramPrivateInboundEvent(rawBody);
  if (!event) return undefined;

  const nowMs = options.now.getTime();
  const expiresAtMs = Math.max(
    nowMs + TELEGRAM_PRIVATE_INGRESS_MAX_TIMESTAMP_SKEW_SECONDS * 1000,
    (timestampSeconds + TELEGRAM_PRIVATE_INGRESS_MAX_TIMESTAMP_SKEW_SECONDS) * 1000,
  );
  if (!(await options.nonceStore.reserve(nonce, expiresAtMs, nowMs))) return undefined;

  return {
    event,
    payloadHmac: payloadHmac(event, options.payloadHmacSecret),
  };
}

export function createTelegramIngressSignatureForTest(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  return `${TELEGRAM_PRIVATE_INGRESS_KEY_ID}.${transportSignature(
    transportHmacSecret,
    timestamp,
    nonce,
    rawBody,
  )}`;
}
