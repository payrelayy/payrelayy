import { createHmac } from 'node:crypto';

import {
  formatTelegramPlayerRegistrationCapabilityCallback,
  parseTelegramPlayerRegistrationCapabilityCallback,
} from '@payreplayy/contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HMAC_SECRET_PATTERN = /^[0-9a-f]{64}$/;
const HMAC_VALUE_PATTERN = /^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$/;
const COMPACT_PART_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type TelegramActionSemanticConsumer =
  'issue_player_registration_capability' | 'start_player_registration';

export interface TelegramActionCapabilityKeys {
  /** API-only 32-byte hexadecimal key; never send it to the bot or database. */
  readonly capabilityHmacSecret: string;
  /** API-only 32-byte hexadecimal key; distinct from the capability and ingress keys. */
  readonly semanticHmacSecret: string;
}

export interface PlayerRegistrationCapabilityPresentation {
  readonly capabilityId: string;
  readonly callbackData: string;
  readonly tokenFingerprint: string;
  readonly issueSemanticInputHmac: string;
}

export interface DecodedPlayerRegistrationCapabilityCallback {
  readonly capabilityId: string;
  readonly tokenFingerprint: string;
}

function canonicalUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical lowercase UUID.`);
  }
  return value;
}

function requiredHmacSecret(value: string, label: string): Buffer {
  if (!HMAC_SECRET_PATTERN.test(value)) {
    throw new Error(`${label} must be a 32-byte lowercase hexadecimal secret.`);
  }
  return Buffer.from(value, 'hex');
}

function requiredHmacValue(value: string, label: string): string {
  if (!HMAC_VALUE_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical versioned HMAC value.`);
  }
  return value;
}

function hmacHex(secret: Buffer, domain: string, value: string): string {
  return createHmac('sha256', secret).update(domain, 'utf8').update(value, 'utf8').digest('hex');
}

function uuidFromBytes(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derives a canonical UUIDv8 from a recorded inbound event. The future database issuer accepts
 * this API-derived identifier together with the blinded token fingerprint in one transaction,
 * avoiding a follow-up write of sensitive capability material.
 */
export function deriveTelegramPlayerRegistrationCapabilityId(
  originInboundEventId: string,
  capabilityHmacSecret: string,
): string {
  const canonicalOriginInboundEventId = canonicalUuid(
    originInboundEventId,
    'The origin inbound event ID',
  );
  const bytes = createHmac(
    'sha256',
    requiredHmacSecret(capabilityHmacSecret, 'The capability HMAC secret'),
  )
    .update('payreplayy:telegram:player-registration:capability-id:v1\n', 'utf8')
    .update(canonicalOriginInboundEventId, 'utf8')
    .digest()
    .subarray(0, 16);

  const versionByte = bytes.at(6);
  const variantByte = bytes.at(8);
  if (bytes.byteLength !== 16 || versionByte === undefined || variantByte === undefined) {
    throw new Error('The capability ID derivation produced an invalid UUID payload.');
  }

  // RFC 9562 UUIDv8 + RFC 4122 variant. The value remains opaque and deterministic.
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

export function encodeTelegramCapabilityId(capabilityId: string): string {
  const canonicalCapabilityId = canonicalUuid(capabilityId, 'The capability ID');
  return Buffer.from(canonicalCapabilityId.replaceAll('-', ''), 'hex').toString('base64url');
}

export function decodeTelegramCapabilityId(compactCapabilityId: string): string | undefined {
  if (!COMPACT_PART_PATTERN.test(compactCapabilityId)) return undefined;

  const bytes = Buffer.from(compactCapabilityId, 'base64url');
  if (bytes.byteLength !== 16 || bytes.toString('base64url') !== compactCapabilityId) {
    return undefined;
  }

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalToken(token: string): string | undefined {
  if (!COMPACT_PART_PATTERN.test(token)) return undefined;

  const bytes = Buffer.from(token, 'base64url');
  return bytes.byteLength === 16 && bytes.toString('base64url') === token ? token : undefined;
}

function deriveCapabilityToken(capabilityId: string, capabilityHmacSecret: Buffer): string {
  return createHmac('sha256', capabilityHmacSecret)
    .update('payreplayy:telegram:player-registration:capability-token:v1\n', 'utf8')
    .update(capabilityId, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export function fingerprintTelegramCapabilityToken(
  token: string,
  capabilityHmacSecret: string,
): string {
  const canonicalCapabilityToken = canonicalToken(token);
  if (!canonicalCapabilityToken) {
    throw new Error('The Telegram capability token must be a canonical 16-byte base64url value.');
  }

  return `hmac-sha256-v1:${hmacHex(
    requiredHmacSecret(capabilityHmacSecret, 'The capability HMAC secret'),
    'payreplayy:telegram:player-registration:capability-token-fingerprint:v1\n',
    canonicalCapabilityToken,
  )}`;
}

export function createTelegramActionSemanticHmac(input: {
  readonly consumer: TelegramActionSemanticConsumer;
  readonly originInboundEventId: string;
  readonly capabilityId: string;
  readonly tokenFingerprint: string;
  readonly semanticHmacSecret: string;
}): string {
  const canonicalPayload = JSON.stringify({
    v: 1,
    consumer: input.consumer,
    originInboundEventId: canonicalUuid(input.originInboundEventId, 'The origin inbound event ID'),
    capabilityId: canonicalUuid(input.capabilityId, 'The capability ID'),
    tokenFingerprint: requiredHmacValue(input.tokenFingerprint, 'The capability token fingerprint'),
  });

  return `hmac-sha256-v1:${hmacHex(
    requiredHmacSecret(input.semanticHmacSecret, 'The action semantic HMAC secret'),
    'payreplayy:telegram:action-semantic:v1\n',
    canonicalPayload,
  )}`;
}

/**
 * The API deterministically derives all opaque presentation inputs from a recorded inbound event.
 * A future private database issuer will receive the canonical ID, token fingerprint, and semantic
 * HMAC together and persist only the blinded values atomically. An exact retry therefore recreates
 * the same callback without persisting raw callback data or a token.
 */
export function derivePlayerRegistrationCapabilityPresentation(input: {
  readonly originInboundEventId: string;
  readonly keys: TelegramActionCapabilityKeys;
}): PlayerRegistrationCapabilityPresentation {
  const originInboundEventId = canonicalUuid(
    input.originInboundEventId,
    'The origin inbound event ID',
  );
  const capabilityId = deriveTelegramPlayerRegistrationCapabilityId(
    originInboundEventId,
    input.keys.capabilityHmacSecret,
  );
  const token = deriveCapabilityToken(
    capabilityId,
    requiredHmacSecret(input.keys.capabilityHmacSecret, 'The capability HMAC secret'),
  );
  const tokenFingerprint = fingerprintTelegramCapabilityToken(
    token,
    input.keys.capabilityHmacSecret,
  );

  return {
    capabilityId,
    callbackData: formatTelegramPlayerRegistrationCapabilityCallback({
      compactCapabilityId: encodeTelegramCapabilityId(capabilityId),
      token,
    }),
    tokenFingerprint,
    issueSemanticInputHmac: createTelegramActionSemanticHmac({
      consumer: 'issue_player_registration_capability',
      originInboundEventId,
      capabilityId,
      tokenFingerprint,
      semanticHmacSecret: input.keys.semanticHmacSecret,
    }),
  };
}

/**
 * Parses a customer-supplied callback into values safe to pass to a later private database action.
 * It intentionally returns only a UUID and blinded fingerprint, never the raw token.
 */
export function decodePlayerRegistrationCapabilityCallback(
  callbackData: unknown,
  capabilityHmacSecret: string,
): DecodedPlayerRegistrationCapabilityCallback | undefined {
  const parsed = parseTelegramPlayerRegistrationCapabilityCallback(callbackData);
  if (!parsed) return undefined;

  const capabilityId = decodeTelegramCapabilityId(parsed.compactCapabilityId);
  const token = canonicalToken(parsed.token);
  if (!capabilityId || !token) return undefined;

  return {
    capabilityId,
    tokenFingerprint: fingerprintTelegramCapabilityToken(token, capabilityHmacSecret),
  };
}
