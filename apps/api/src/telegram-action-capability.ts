import { createHmac } from 'node:crypto';

import {
  formatTelegramPlayerRegistrationCapabilityCallback,
  parseTelegramPlayerRegistrationCapabilityCallback,
} from '@fetanagent/contracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HMAC_SECRET_PATTERN = /^[0-9a-f]{64}$/;
const HMAC_VALUE_PATTERN = /^hmac-sha256-v[1-9][0-9]*:[0-9a-f]{64}$/;
const COMPACT_PART_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type TelegramActionSemanticConsumer =
  | 'issue_player_registration_capability'
  | 'start_player_registration'
  | 'submit_player_registration_input'
  | 'expire_player_registration_action'
  | 'open_dry_run_deposit_intent'
  | 'capture_dry_run_deposit_reference'
  | 'open_live_deposit_intent'
  | 'capture_live_deposit_reference';

type CapabilityBoundSemanticInput = {
  readonly consumer: 'issue_player_registration_capability' | 'start_player_registration';
  readonly originInboundEventId: string;
  readonly capabilityId: string;
  readonly tokenFingerprint: string;
  readonly semanticHmacSecret: string;
};

type PlayerIdSubmissionSemanticInput = {
  readonly consumer: 'submit_player_registration_input';
  readonly originInboundEventId: string;
  /**
   * Raw trusted-memory input only. The future private wrapper receives it for independent
   * database normalization/validation; it must never enter a generic log, audit record, or
   * callback payload.
   */
  readonly playerId: string;
  readonly semanticHmacSecret: string;
};

type PlayerIdExpirySemanticInput = {
  readonly consumer: 'expire_player_registration_action';
  readonly originInboundEventId: string;
  readonly semanticHmacSecret: string;
};

type DepositIntentSemanticInput = {
  readonly consumer: 'open_dry_run_deposit_intent' | 'open_live_deposit_intent';
  readonly originInboundEventId: string;
  readonly playerId: string;
  readonly expectedAmountMinor: string;
  readonly semanticHmacSecret: string;
};

type DepositReferenceSemanticInput = {
  readonly consumer: 'capture_dry_run_deposit_reference' | 'capture_live_deposit_reference';
  readonly originInboundEventId: string;
  readonly depositIntentId: string;
  readonly referenceFingerprint: string;
  readonly referenceMasked: string;
  readonly keyVersion: number;
  readonly semanticHmacSecret: string;
};

export type TelegramActionSemanticHmacInput =
  | CapabilityBoundSemanticInput
  | PlayerIdSubmissionSemanticInput
  | PlayerIdExpirySemanticInput
  | DepositIntentSemanticInput
  | DepositReferenceSemanticInput;

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

function canonicalPlayerIdForSemanticHmac(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('The Player ID must be text.');
  }

  // Match PostgreSQL btrim's default ordinary-space behavior only. Do not lowercase, normalize
  // Unicode, strip zeros, or validate content here; the future database wrapper remains the
  // authority that re-normalizes and validates the submitted value.
  return value.replace(/^ +| +$/g, '');
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
    .update('fetanagent:telegram:player-registration:capability-id:v1\n', 'utf8')
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
    .update('fetanagent:telegram:player-registration:capability-token:v1\n', 'utf8')
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
    'fetanagent:telegram:player-registration:capability-token-fingerprint:v1\n',
    canonicalCapabilityToken,
  )}`;
}

export function createTelegramActionSemanticHmac(input: TelegramActionSemanticHmacInput): string {
  const basePayload = {
    v: 1,
    consumer: input.consumer,
    originInboundEventId: canonicalUuid(input.originInboundEventId, 'The origin inbound event ID'),
  };
  let canonicalPayload: string;

  switch (input.consumer) {
    case 'issue_player_registration_capability':
    case 'start_player_registration':
      canonicalPayload = JSON.stringify({
        ...basePayload,
        capabilityId: canonicalUuid(input.capabilityId, 'The capability ID'),
        tokenFingerprint: requiredHmacValue(
          input.tokenFingerprint,
          'The capability token fingerprint',
        ),
      });
      break;
    case 'submit_player_registration_input':
      canonicalPayload = JSON.stringify({
        ...basePayload,
        platformCode: 'kemerbet',
        normalizedPlayerId: canonicalPlayerIdForSemanticHmac(input.playerId),
      });
      break;
    case 'expire_player_registration_action':
      canonicalPayload = JSON.stringify({
        ...basePayload,
        platformCode: 'kemerbet',
      });
      break;
    case 'open_dry_run_deposit_intent':
    case 'open_live_deposit_intent':
      if (!/^[1-9][0-9]*$/u.test(input.expectedAmountMinor)) {
        throw new Error('The expected deposit amount must be canonical positive minor units.');
      }
      canonicalPayload = JSON.stringify({
        ...basePayload,
        platformCode: 'kemerbet',
        providerCode: 'cbe_birr',
        normalizedPlayerId: canonicalPlayerIdForSemanticHmac(input.playerId),
        expectedAmountMinor: input.expectedAmountMinor,
        financialMode: input.consumer === 'open_live_deposit_intent' ? 'live' : 'dry_run',
      });
      break;
    case 'capture_dry_run_deposit_reference':
    case 'capture_live_deposit_reference':
      if (
        !/^[0-9a-f]{64}$/u.test(input.referenceFingerprint) ||
        !/^\*{3}[A-Z0-9._-]{4}$/u.test(input.referenceMasked) ||
        !Number.isSafeInteger(input.keyVersion) ||
        input.keyVersion < 1
      ) {
        throw new Error('The protected deposit-reference semantics are invalid.');
      }
      canonicalPayload = JSON.stringify({
        ...basePayload,
        depositIntentId: canonicalUuid(input.depositIntentId, 'The deposit intent ID'),
        referenceFingerprint: input.referenceFingerprint,
        referenceMasked: input.referenceMasked,
        keyVersion: input.keyVersion,
        financialMode: input.consumer === 'capture_live_deposit_reference' ? 'live' : 'dry_run',
      });
      break;
    default:
      throw new Error('The Telegram action semantic consumer is invalid.');
  }

  return `hmac-sha256-v1:${hmacHex(
    requiredHmacSecret(input.semanticHmacSecret, 'The action semantic HMAC secret'),
    'fetanagent:telegram:action-semantic:v1\n',
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
