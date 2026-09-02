import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import {
  TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
  TELEGRAM_PRIVATE_ACTION_DEPOSIT_TOKEN_LENGTH,
  TELEGRAM_PRIVATE_ACTION_HEADERS,
  TELEGRAM_PRIVATE_ACTION_KEY_ID,
  TELEGRAM_PRIVATE_ACTION_MAX_BODY_BYTES,
  TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS,
  TELEGRAM_PRIVATE_ACTION_PATH,
  TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MAX_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MIN_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_REFERENCE_MAX_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_REFERENCE_MIN_CODE_POINTS,
  isTelegramDepositProofToken,
  parseTelegramPlayerRegistrationCapabilityCallback,
  redactTelegramPrivateActionForLog,
  telegramPrivateActionNonceDigestInput,
  telegramPrivateActionSignatureInput,
  type TelegramPrivateActionEnvelope,
} from '@fetanagent/contracts';

export interface TelegramPrivateActionRequest {
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly method: string;
  readonly url: string | undefined;
}

/**
 * The store receives only a domain-separated SHA-256 digest. A durable implementation belongs to
 * a later approved runtime and must not share the private-inbox nonce table or digest namespace.
 */
export interface TelegramPrivateActionNonceStore {
  readonly durable: true;
  reserve(nonceDigest: string, expiresAtMs: number, nowMs: number): Promise<boolean>;
}

/** Test-only replay store. It is intentionally not wired to application startup or Fastify. */
export class InMemoryTelegramPrivateActionNonceStore {
  readonly durable = false;
  private readonly entries = new Map<string, number>();

  constructor(private readonly maximumEntries = 10_000) {}

  async reserve(nonceDigest: string, expiresAtMs: number, nowMs: number): Promise<boolean> {
    for (const [recordedDigest, expiry] of this.entries) {
      if (expiry <= nowMs) this.entries.delete(recordedDigest);
    }

    if (this.entries.has(nonceDigest) || this.entries.size >= this.maximumEntries) {
      return false;
    }

    this.entries.set(nonceDigest, expiresAtMs);
    return true;
  }
}

/**
 * This dispatch interface exists solely as a test seam for the local contract. It is not a
 * database capability, no implementation calls SQL, and production has no composed dispatcher.
 */
export interface TelegramPrivateActionDispatcher {
  dispatch(action: TelegramPrivateActionEnvelope): Promise<void>;
}

/**
 * Test-only in-memory dispatcher. Its raw action snapshot must not be logged; use
 * `redactedTelegramPrivateActionForLog` for any diagnostic projection instead.
 */
export class InMemoryTelegramPrivateActionDispatcher implements TelegramPrivateActionDispatcher {
  private readonly recordedActions: TelegramPrivateActionEnvelope[] = [];

  async dispatch(action: TelegramPrivateActionEnvelope): Promise<void> {
    this.recordedActions.push(action);
  }

  snapshotForTest(): readonly TelegramPrivateActionEnvelope[] {
    return [...this.recordedActions];
  }
}

export interface TelegramPrivateActionVerificationOptions {
  readonly transportHmacSecret: string;
  readonly now: Date;
  readonly nonceStore: TelegramPrivateActionNonceStore;
}

const MAXIMUM_TELEGRAM_IDENTIFIER = 9_007_199_254_740_991n;
const SIGNATURE_PATTERN = /^v1\.([A-Za-z0-9_-]{43})$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const TIMESTAMP_PATTERN = /^[1-9][0-9]{9,12}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const ROOT_MENU_KEYS = new Set([
  'version',
  'kind',
  'updateId',
  'telegramUserId',
  'privateChatId',
  'preferredLocale',
]);
const CALLBACK_KEYS = new Set([...ROOT_MENU_KEYS, 'callbackData']);
const PLAYER_ID_TEXT_KEYS = new Set([...ROOT_MENU_KEYS, 'playerId']);
const DEPOSIT_INTENT_KEYS = new Set([...ROOT_MENU_KEYS, 'playerId', 'amountEtb']);
const DEPOSIT_REFERENCE_KEYS = new Set([...ROOT_MENU_KEYS, 'depositToken', 'transactionReference']);
const DEPOSIT_PROOF_KEYS = new Set([
  ...ROOT_MENU_KEYS,
  'providerCode',
  'playerId',
  'transactionReference',
]);
const DEPOSIT_STATUS_KEYS = new Set([...ROOT_MENU_KEYS, 'depositToken']);
const DEPOSIT_PROOF_STATUS_KEYS = new Set([...ROOT_MENU_KEYS, 'proofToken']);
const ETB_AMOUNT_PATTERN = /^(?:[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/u;
const COMPACT_UUID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const DIRECT_PROOF_REFERENCE_PATTERN = /^[A-Za-z0-9]+$/u;

function oneHeaderValue(request: TelegramPrivateActionRequest, name: string): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const headerName = request.rawHeaders[index];
    const headerValue = request.rawHeaders[index + 1];
    if (headerName?.toLowerCase() === name && headerValue !== undefined) {
      values.push(headerValue);
    }
  }

  if (values.length > 0) return values.length === 1 ? values[0] : undefined;

  const value = request.headers[name];
  if (Array.isArray(value)) return undefined;
  return typeof value === 'string' ? value : undefined;
}

function hasDuplicateHeader(request: TelegramPrivateActionRequest, name: string): boolean {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function parseActionIdentity(value: Record<string, unknown>):
  | {
      readonly version: 1;
      readonly updateId: string;
      readonly telegramUserId: string;
      readonly privateChatId: string;
      readonly preferredLocale: 'en';
    }
  | undefined {
  const updateId = canonicalTelegramIdentifier(value.updateId, true);
  const telegramUserId = canonicalTelegramIdentifier(value.telegramUserId, false);
  const privateChatId = canonicalTelegramIdentifier(value.privateChatId, false);

  if (
    value.version !== 1 ||
    updateId === undefined ||
    telegramUserId === undefined ||
    privateChatId === undefined ||
    telegramUserId !== privateChatId ||
    value.preferredLocale !== 'en'
  ) {
    return undefined;
  }

  return { version: 1, updateId, telegramUserId, privateChatId, preferredLocale: 'en' };
}

function validPlayerIdText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Array.from(value).length <= TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function validDepositReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    Array.from(value).length >= TELEGRAM_PRIVATE_ACTION_REFERENCE_MIN_CODE_POINTS &&
    Array.from(value).length <= TELEGRAM_PRIVATE_ACTION_REFERENCE_MAX_CODE_POINTS &&
    /^[A-Za-z0-9._-]+$/u.test(value)
  );
}

function validDepositProofReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    Array.from(value).length >= TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MIN_CODE_POINTS &&
    Array.from(value).length <= TELEGRAM_PRIVATE_ACTION_PROOF_REFERENCE_MAX_CODE_POINTS &&
    DIRECT_PROOF_REFERENCE_PATTERN.test(value)
  );
}

/**
 * Strictly parse the versioned action envelope after transport authentication. It intentionally
 * performs only structural safety validation; platform and database authorization do not exist at
 * this stage.
 */
export function parseTelegramPrivateActionEnvelope(
  rawBody: Buffer,
): TelegramPrivateActionEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || typeof parsed.kind !== 'string') return undefined;

  switch (parsed.kind) {
    case 'root_menu': {
      if (!hasOnlyKeys(parsed, ROOT_MENU_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      return identity ? { ...identity, kind: 'root_menu' } : undefined;
    }
    case 'player_registration_callback': {
      if (!hasOnlyKeys(parsed, CALLBACK_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      if (
        !identity ||
        typeof parsed.callbackData !== 'string' ||
        !parseTelegramPlayerRegistrationCapabilityCallback(parsed.callbackData)
      ) {
        return undefined;
      }

      return {
        ...identity,
        kind: 'player_registration_callback',
        callbackData: parsed.callbackData,
      };
    }
    case 'player_id_text': {
      if (!hasOnlyKeys(parsed, PLAYER_ID_TEXT_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      if (!identity || !validPlayerIdText(parsed.playerId)) return undefined;

      return { ...identity, kind: 'player_id_text', playerId: parsed.playerId };
    }
    case 'deposit_intent_command': {
      if (!hasOnlyKeys(parsed, DEPOSIT_INTENT_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      if (
        !identity ||
        !validPlayerIdText(parsed.playerId) ||
        typeof parsed.amountEtb !== 'string' ||
        !ETB_AMOUNT_PATTERN.test(parsed.amountEtb)
      ) {
        return undefined;
      }
      return {
        ...identity,
        kind: 'deposit_intent_command',
        playerId: parsed.playerId,
        amountEtb: parsed.amountEtb,
      };
    }
    case 'deposit_reference_command': {
      if (!hasOnlyKeys(parsed, DEPOSIT_REFERENCE_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      if (
        !identity ||
        typeof parsed.depositToken !== 'string' ||
        parsed.depositToken.length !== TELEGRAM_PRIVATE_ACTION_DEPOSIT_TOKEN_LENGTH ||
        !COMPACT_UUID_PATTERN.test(parsed.depositToken) ||
        !validDepositReference(parsed.transactionReference)
      ) {
        return undefined;
      }
      return {
        ...identity,
        kind: 'deposit_reference_command',
        depositToken: parsed.depositToken,
        transactionReference: parsed.transactionReference,
      };
    }
    case 'deposit_proof_command': {
      if (!hasOnlyKeys(parsed, DEPOSIT_PROOF_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      if (
        !identity ||
        (parsed.providerCode !== 'cbe_birr' && parsed.providerCode !== 'telebirr') ||
        !validPlayerIdText(parsed.playerId) ||
        !validDepositProofReference(parsed.transactionReference)
      ) {
        return undefined;
      }
      return {
        ...identity,
        kind: 'deposit_proof_command',
        providerCode: parsed.providerCode,
        playerId: parsed.playerId,
        transactionReference: parsed.transactionReference,
      };
    }
    case 'deposit_proof_status_command': {
      if (!hasOnlyKeys(parsed, DEPOSIT_PROOF_STATUS_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      if (!identity || !isTelegramDepositProofToken(parsed.proofToken)) return undefined;
      return { ...identity, kind: 'deposit_proof_status_command', proofToken: parsed.proofToken };
    }
    case 'deposit_status_command': {
      if (!hasOnlyKeys(parsed, DEPOSIT_STATUS_KEYS)) return undefined;
      const identity = parseActionIdentity(parsed);
      if (
        !identity ||
        typeof parsed.depositToken !== 'string' ||
        parsed.depositToken.length !== TELEGRAM_PRIVATE_ACTION_DEPOSIT_TOKEN_LENGTH ||
        !COMPACT_UUID_PATTERN.test(parsed.depositToken)
      ) {
        return undefined;
      }
      return { ...identity, kind: 'deposit_status_command', depositToken: parsed.depositToken };
    }
    default:
      return undefined;
  }
}

function bodyDigest(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

function nonceDigest(nonce: string): string {
  return createHash('sha256')
    .update(telegramPrivateActionNonceDigestInput(nonce), 'utf8')
    .digest('hex');
}

function transportSignature(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  return createHmac('sha256', Buffer.from(transportHmacSecret, 'hex'))
    .update(
      telegramPrivateActionSignatureInput({
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
 * Verify an inert action request without registering an HTTP route, creating a pool, accessing a
 * credential other than the supplied test key, or dispatching an action. Every rejected request
 * returns `undefined` so raw callback/text material cannot surface through error messages.
 */
export async function verifyTelegramPrivateActionRequest(
  request: TelegramPrivateActionRequest,
  rawBody: Buffer,
  options: TelegramPrivateActionVerificationOptions,
): Promise<TelegramPrivateActionEnvelope | undefined> {
  if (options.nonceStore.durable !== true) return undefined;

  const requiredOrOptionalHeaders = [
    'content-type',
    'content-encoding',
    TELEGRAM_PRIVATE_ACTION_HEADERS.keyId,
    TELEGRAM_PRIVATE_ACTION_HEADERS.timestamp,
    TELEGRAM_PRIVATE_ACTION_HEADERS.nonce,
    TELEGRAM_PRIVATE_ACTION_HEADERS.signature,
  ];

  if (
    requiredOrOptionalHeaders.some((name) => hasDuplicateHeader(request, name)) ||
    request.method !== 'POST' ||
    request.url !== TELEGRAM_PRIVATE_ACTION_PATH ||
    rawBody.byteLength > TELEGRAM_PRIVATE_ACTION_MAX_BODY_BYTES ||
    oneHeaderValue(request, 'content-type') !== TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE ||
    oneHeaderValue(request, 'content-encoding') !== undefined ||
    oneHeaderValue(request, TELEGRAM_PRIVATE_ACTION_HEADERS.keyId) !==
      TELEGRAM_PRIVATE_ACTION_KEY_ID
  ) {
    return undefined;
  }

  const timestamp = oneHeaderValue(request, TELEGRAM_PRIVATE_ACTION_HEADERS.timestamp);
  const nonce = oneHeaderValue(request, TELEGRAM_PRIVATE_ACTION_HEADERS.nonce);
  const presentedSignature = oneHeaderValue(request, TELEGRAM_PRIVATE_ACTION_HEADERS.signature);
  if (!timestamp || !TIMESTAMP_PATTERN.test(timestamp) || !nonce || !NONCE_PATTERN.test(nonce)) {
    return undefined;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS
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

  const action = parseTelegramPrivateActionEnvelope(rawBody);
  if (!action) return undefined;

  const nowMs = options.now.getTime();
  const expiresAtMs = Math.max(
    nowMs + TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS * 1000,
    (timestampSeconds + TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS) * 1000,
  );
  if (!(await options.nonceStore.reserve(nonceDigest(nonce), expiresAtMs, nowMs))) return undefined;

  return action;
}

/** Test-only composition helper. It is deliberately not imported by Fastify application startup. */
export async function verifyAndDispatchTelegramPrivateActionForTest(
  request: TelegramPrivateActionRequest,
  rawBody: Buffer,
  options: TelegramPrivateActionVerificationOptions,
  dispatcher: TelegramPrivateActionDispatcher,
): Promise<boolean> {
  const action = await verifyTelegramPrivateActionRequest(request, rawBody, options);
  if (!action) return false;

  await dispatcher.dispatch(action);
  return true;
}

export function createTelegramPrivateActionSignatureForTest(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  return `${TELEGRAM_PRIVATE_ACTION_KEY_ID}.${transportSignature(
    transportHmacSecret,
    timestamp,
    nonce,
    rawBody,
  )}`;
}

export { redactTelegramPrivateActionForLog };
