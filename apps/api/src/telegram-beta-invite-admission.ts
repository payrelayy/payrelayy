import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import {
  TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
  TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS,
  TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
  TELEGRAM_BETA_INVITE_REDEMPTION_MAX_BODY_BYTES,
  TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS,
  TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
  isTelegramBetaInviteToken,
  redactTelegramBetaInviteRedemptionForLog,
  telegramBetaInviteRedemptionNonceDigestInput,
  telegramBetaInviteRedemptionSignatureInput,
  telegramBetaInviteTokenDigestInput,
  type TelegramBetaInviteRedemption,
} from '@payreplayy/contracts';

export interface TelegramBetaInviteAdmissionRequest {
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly method: string;
  readonly url: string | undefined;
}

/**
 * A future durable implementation must coordinate across every API replica. It receives only a
 * domain-separated nonce digest and must never persist the raw transport nonce.
 */
export interface TelegramBetaInviteAdmissionNonceStore {
  /**
   * The admission verifier accepts only a store that can reserve nonces atomically across every
   * API replica and restart for the entire acceptance window. A test-only in-memory store is
   * deliberately not assignable to this production boundary.
   */
  readonly durable: true;
  reserve(nonceDigest: string, expiresAtMs: number, nowMs: number): Promise<boolean>;
}

/** Test-only non-durable nonce store; it is not wired to API startup or Fastify. */
export class InMemoryTelegramBetaInviteAdmissionNonceStore {
  readonly durable = false as const;
  private readonly entries = new Map<string, number>();

  constructor(private readonly maximumEntries = 10_000) {}

  async reserve(nonceDigest: string, expiresAtMs: number, nowMs: number): Promise<boolean> {
    for (const [recordedDigest, expiry] of this.entries) {
      if (expiry <= nowMs) this.entries.delete(recordedDigest);
    }

    if (this.entries.has(nonceDigest) || this.entries.size >= this.maximumEntries) return false;
    this.entries.set(nonceDigest, expiresAtMs);
    return true;
  }
}

export interface TelegramBetaInviteAdmissionVerificationOptions {
  readonly transportHmacSecret: string;
  readonly now: Date;
  readonly nonceStore: TelegramBetaInviteAdmissionNonceStore;
}

/**
 * This value is not loaded here and must stay separate from the admission transport HMAC, the
 * generic Telegram inbox keys, and customer-action transport keys.
 */
export interface TelegramBetaInviteAdmissionDigestOptions {
  readonly payloadHmacSecret: string;
}

/**
 * The planned database procedures accept this redacted command shape. It intentionally has no
 * raw invite-token property: the adapter must derive the domain-separated token digest in API
 * memory first.
 */
export interface TelegramBetaInviteRedemptionDatabaseInput {
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly inviteTokenDigest: string;
  readonly payloadHmac: string;
  readonly preferredLocale: 'en';
}

/** Planned input for the admitted-only generic private inbox procedure. */
export interface AdmittedTelegramPrivateInboundDatabaseInput {
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly payloadHmac: string;
  readonly preferredLocale: 'en';
}

export interface TelegramBetaInviteAdmissionDatabase {
  query(query: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface TelegramBetaInviteRedemptionReceipt {
  readonly inboundEventId: string;
  readonly receivedAt: Date;
  readonly inboundEventAlreadyRecorded: boolean;
}

export type AdmittedTelegramPrivateInboundReceipt = TelegramBetaInviteRedemptionReceipt;

/** Never expose database, request-body, or admission detail to a caller. */
export class TelegramBetaInviteAdmissionUnavailableError extends Error {
  constructor() {
    super('The beta invite admission boundary is unavailable.');
    this.name = 'TelegramBetaInviteAdmissionUnavailableError';
  }
}

const MAXIMUM_TELEGRAM_IDENTIFIER = 9_007_199_254_740_991n;
const SIGNATURE_PATTERN = /^v1\.([A-Za-z0-9_-]{43})$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const TIMESTAMP_PATTERN = /^[1-9][0-9]{9,12}$/;
const HMAC_SECRET_PATTERN = /^[0-9a-f]{64}$/i;
const INVITE_TOKEN_DIGEST_PATTERN = /^sha256-v1:[0-9a-f]{64}$/;
const PAYLOAD_HMAC_PATTERN = /^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$/;
const REDEMPTION_KEYS = new Set([
  'version',
  'kind',
  'updateId',
  'telegramUserId',
  'privateChatId',
  'inviteToken',
  'preferredLocale',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REDEEM_TELEGRAM_BETA_INVITE_SQL = `
  select
    inbound_event_id,
    received_at,
    inbound_event_already_recorded
  from app.redeem_telegram_beta_invite(
    $1::bigint,
    $2::bigint,
    $3::bigint,
    $4::text,
    $5::text,
    $6::text
  )
`;

const RECORD_ADMITTED_TELEGRAM_PRIVATE_INBOUND_EVENT_SQL = `
  select
    inbound_event_id,
    received_at,
    inbound_event_already_recorded
  from app.record_admitted_telegram_private_inbound_event(
    $1::bigint,
    $2::bigint,
    $3::bigint,
    $4::text,
    $5::text
  )
`;

function oneHeaderValue(
  request: TelegramBetaInviteAdmissionRequest,
  name: string,
): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const headerName = request.rawHeaders[index];
    const headerValue = request.rawHeaders[index + 1];
    if (headerName?.toLowerCase() === name && headerValue !== undefined) values.push(headerValue);
  }

  if (values.length > 0) return values.length === 1 ? values[0] : undefined;

  const value = request.headers[name];
  if (Array.isArray(value)) return undefined;
  return typeof value === 'string' ? value : undefined;
}

function hasDuplicateHeader(request: TelegramBetaInviteAdmissionRequest, name: string): boolean {
  let rawHeaderCount = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) rawHeaderCount += 1;
  }

  if (rawHeaderCount > 0) return rawHeaderCount > 1;
  return Array.isArray(request.headers[name]);
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

function hasCanonicalTelegramIdentifier(value: string, permitsZero: boolean): boolean {
  return canonicalTelegramIdentifier(value, permitsZero) === value;
}

function validRedemptionDatabaseInput(input: TelegramBetaInviteRedemptionDatabaseInput): boolean {
  return (
    hasCanonicalTelegramIdentifier(input.updateId, true) &&
    hasCanonicalTelegramIdentifier(input.telegramUserId, false) &&
    hasCanonicalTelegramIdentifier(input.privateChatId, false) &&
    input.telegramUserId === input.privateChatId &&
    INVITE_TOKEN_DIGEST_PATTERN.test(input.inviteTokenDigest) &&
    PAYLOAD_HMAC_PATTERN.test(input.payloadHmac) &&
    input.preferredLocale === 'en'
  );
}

function validAdmittedInboundDatabaseInput(
  input: AdmittedTelegramPrivateInboundDatabaseInput,
): boolean {
  return (
    hasCanonicalTelegramIdentifier(input.updateId, true) &&
    hasCanonicalTelegramIdentifier(input.telegramUserId, false) &&
    hasCanonicalTelegramIdentifier(input.privateChatId, false) &&
    input.telegramUserId === input.privateChatId &&
    PAYLOAD_HMAC_PATTERN.test(input.payloadHmac) &&
    input.preferredLocale === 'en'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyRedemptionKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => REDEMPTION_KEYS.has(key));
}

/**
 * Strictly parse the signed admission envelope. It does not authorize an invite or create any
 * record; malformed input returns undefined without surfacing token material.
 */
export function parseTelegramBetaInviteRedemption(
  rawBody: Buffer,
): TelegramBetaInviteRedemption | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !hasOnlyRedemptionKeys(parsed)) return undefined;

  const updateId = canonicalTelegramIdentifier(parsed.updateId, true);
  const telegramUserId = canonicalTelegramIdentifier(parsed.telegramUserId, false);
  const privateChatId = canonicalTelegramIdentifier(parsed.privateChatId, false);

  if (
    parsed.version !== 1 ||
    parsed.kind !== 'beta_invite_redemption' ||
    updateId === undefined ||
    telegramUserId === undefined ||
    privateChatId === undefined ||
    telegramUserId !== privateChatId ||
    !isTelegramBetaInviteToken(parsed.inviteToken) ||
    parsed.preferredLocale !== 'en'
  ) {
    return undefined;
  }

  return {
    version: 1,
    kind: 'beta_invite_redemption',
    updateId,
    telegramUserId,
    privateChatId,
    inviteToken: parsed.inviteToken,
    preferredLocale: 'en',
  };
}

function bodyDigest(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

function nonceDigest(nonce: string): string {
  return createHash('sha256')
    .update(telegramBetaInviteRedemptionNonceDigestInput(nonce), 'utf8')
    .digest('hex');
}

function hmacSha256Hex(secret: string, domainSeparatedInput: string): string {
  if (!HMAC_SECRET_PATTERN.test(secret)) {
    throw new TelegramBetaInviteAdmissionUnavailableError();
  }
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(domainSeparatedInput, 'utf8')
    .digest('hex');
}

function transportSignature(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  if (!HMAC_SECRET_PATTERN.test(transportHmacSecret)) {
    throw new TelegramBetaInviteAdmissionUnavailableError();
  }
  return createHmac('sha256', Buffer.from(transportHmacSecret, 'hex'))
    .update(
      telegramBetaInviteRedemptionSignatureInput({
        timestamp,
        nonce,
        bodyByteLength: rawBody.byteLength,
        bodySha256: bodyDigest(rawBody),
      }),
      'utf8',
    )
    .digest('base64url');
}

/**
 * Authenticate an inert admission request. There is no Fastify route, database pool, dispatch,
 * or application startup wiring for this function in the current stage.
 */
export async function verifyTelegramBetaInviteAdmissionRequest(
  request: TelegramBetaInviteAdmissionRequest,
  rawBody: Buffer,
  options: TelegramBetaInviteAdmissionVerificationOptions,
): Promise<TelegramBetaInviteRedemption | undefined> {
  // Keep the runtime guard in addition to the `durable: true` type contract: JavaScript callers
  // and unsafe casts must fail closed before a signed request can consume a local-only nonce.
  if (options.nonceStore.durable !== true) return undefined;

  const requiredOrOptionalHeaders = [
    'content-type',
    'content-encoding',
    TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.keyId,
    TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.timestamp,
    TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce,
    TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature,
  ];

  if (
    requiredOrOptionalHeaders.some((name) => hasDuplicateHeader(request, name)) ||
    request.method !== 'POST' ||
    request.url !== TELEGRAM_BETA_INVITE_REDEMPTION_PATH ||
    rawBody.byteLength > TELEGRAM_BETA_INVITE_REDEMPTION_MAX_BODY_BYTES ||
    oneHeaderValue(request, 'content-type') !== TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE ||
    oneHeaderValue(request, 'content-encoding') !== undefined ||
    oneHeaderValue(request, TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.keyId) !==
      TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID
  ) {
    return undefined;
  }

  if (!HMAC_SECRET_PATTERN.test(options.transportHmacSecret)) return undefined;

  const timestamp = oneHeaderValue(request, TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.timestamp);
  const nonce = oneHeaderValue(request, TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce);
  const presentedSignature = oneHeaderValue(
    request,
    TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature,
  );
  if (!timestamp || !TIMESTAMP_PATTERN.test(timestamp) || !nonce || !NONCE_PATTERN.test(nonce)) {
    return undefined;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) >
      TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS
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

  const redemption = parseTelegramBetaInviteRedemption(rawBody);
  if (!redemption) return undefined;

  const nowMs = options.now.getTime();
  const expiresAtMs = Math.max(
    nowMs + TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS * 1000,
    (timestampSeconds + TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS) * 1000,
  );
  if (!(await options.nonceStore.reserve(nonceDigest(nonce), expiresAtMs, nowMs))) return undefined;

  return redemption;
}

/**
 * Converts the authenticated envelope to the planned SQL-only shape. The raw invitation is
 * deliberately discarded after deriving its domain-separated digest and cannot be supplied to the
 * adapter.
 */
export function toTelegramBetaInviteRedemptionDatabaseInput(
  redemption: TelegramBetaInviteRedemption,
  options: TelegramBetaInviteAdmissionDigestOptions,
): TelegramBetaInviteRedemptionDatabaseInput {
  const inviteTokenDigest = `sha256-v1:${createHash('sha256')
    .update(telegramBetaInviteTokenDigestInput(redemption.inviteToken), 'utf8')
    .digest('hex')}`;
  const canonicalPayload = JSON.stringify({
    version: redemption.version,
    kind: redemption.kind,
    updateId: redemption.updateId,
    telegramUserId: redemption.telegramUserId,
    privateChatId: redemption.privateChatId,
    inviteTokenDigest,
    preferredLocale: redemption.preferredLocale,
  });
  const payloadHmac = `hmac-sha256-v1:${hmacSha256Hex(
    options.payloadHmacSecret,
    `payreplayy:telegram:beta-invite:payload:v1\n${canonicalPayload}`,
  )}`;

  return {
    updateId: redemption.updateId,
    telegramUserId: redemption.telegramUserId,
    privateChatId: redemption.privateChatId,
    inviteTokenDigest,
    payloadHmac,
    preferredLocale: 'en',
  };
}

/**
 * Local adapter for planned SECURITY DEFINER procedures. It owns no connection and cannot create
 * a pool. A later reviewed runtime must inject a dedicated database client and gate composition.
 */
export class PostgresTelegramBetaInviteAdmissionAdapter {
  constructor(private readonly database: TelegramBetaInviteAdmissionDatabase) {}

  async redeem(
    input: TelegramBetaInviteRedemptionDatabaseInput,
  ): Promise<TelegramBetaInviteRedemptionReceipt> {
    if (!validRedemptionDatabaseInput(input)) {
      throw new TelegramBetaInviteAdmissionUnavailableError();
    }

    try {
      const result = await this.database.query(REDEEM_TELEGRAM_BETA_INVITE_SQL, [
        input.updateId,
        input.telegramUserId,
        input.privateChatId,
        input.inviteTokenDigest,
        input.payloadHmac,
        input.preferredLocale,
      ]);
      const receipt = parseAdmissionReceipt(result.rows);
      if (!receipt) throw new TelegramBetaInviteAdmissionUnavailableError();
      return receipt;
    } catch (error) {
      if (error instanceof TelegramBetaInviteAdmissionUnavailableError) throw error;
      throw new TelegramBetaInviteAdmissionUnavailableError();
    }
  }

  async recordAdmittedInbound(
    input: AdmittedTelegramPrivateInboundDatabaseInput,
  ): Promise<AdmittedTelegramPrivateInboundReceipt> {
    if (!validAdmittedInboundDatabaseInput(input)) {
      throw new TelegramBetaInviteAdmissionUnavailableError();
    }

    try {
      const result = await this.database.query(RECORD_ADMITTED_TELEGRAM_PRIVATE_INBOUND_EVENT_SQL, [
        input.updateId,
        input.telegramUserId,
        input.privateChatId,
        input.payloadHmac,
        input.preferredLocale,
      ]);
      const receipt = parseAdmissionReceipt(result.rows);
      if (!receipt) throw new TelegramBetaInviteAdmissionUnavailableError();
      return receipt;
    } catch (error) {
      if (error instanceof TelegramBetaInviteAdmissionUnavailableError) throw error;
      throw new TelegramBetaInviteAdmissionUnavailableError();
    }
  }
}

function parseAdmissionReceipt(
  rows: readonly unknown[],
): TelegramBetaInviteRedemptionReceipt | undefined {
  if (rows.length !== 1 || !isRecord(rows[0])) return undefined;
  const row = rows[0];
  const inboundEventId =
    typeof row.inbound_event_id === 'string' && UUID_PATTERN.test(row.inbound_event_id)
      ? row.inbound_event_id
      : undefined;
  const receivedAt =
    row.received_at instanceof Date && !Number.isNaN(row.received_at.getTime())
      ? row.received_at
      : undefined;

  if (
    inboundEventId === undefined ||
    receivedAt === undefined ||
    typeof row.inbound_event_already_recorded !== 'boolean'
  ) {
    return undefined;
  }

  return {
    inboundEventId,
    receivedAt,
    inboundEventAlreadyRecorded: row.inbound_event_already_recorded,
  };
}

export function createTelegramBetaInviteAdmissionSignatureForTest(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  return `${TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID}.${transportSignature(
    transportHmacSecret,
    timestamp,
    nonce,
    rawBody,
  )}`;
}

export { redactTelegramBetaInviteRedemptionForLog };
