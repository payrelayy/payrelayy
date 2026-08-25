import { TextDecoder } from 'node:util';

const PLAYER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MAXIMUM_LOOKUP_JSON_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/**
 * Trusted proxy-side mirror of the established browser lookup contract. It deliberately returns
 * only a boolean so no Player identity can escape into a receipt, diagnostic, or log.
 */
export function validateKemerBetReadinessPlayerLookupResponse(input: {
  readonly body: Buffer;
  readonly requestedPlayerId: string;
  readonly statusCode: number;
}): boolean {
  if (
    input.statusCode !== 200 ||
    !Buffer.isBuffer(input.body) ||
    input.body.length < 2 ||
    input.body.length > MAXIMUM_LOOKUP_JSON_BYTES ||
    !PLAYER_ID_PATTERN.test(input.requestedPlayerId)
  ) {
    return false;
  }
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(input.body);
    if (/^\s*\ufeff/u.test(text) || /\0/u.test(text)) return false;
    parsed = JSON.parse(text) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !isRecord(parsed.value)) return false;
  const value = parsed.value;
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    value.externalId !== input.requestedPlayerId ||
    value.currencyCode !== 'ETB'
  ) {
    return false;
  }
  const identities = [...new Set([value.userName, value.email])].filter(boundedIdentity);
  return identities.length >= 1 && identities.length <= 2;
}

export const KEMERBET_READINESS_PLAYER_LOOKUP_RESPONSE_CONTRACT = Object.freeze({
  currencyCode: 'ETB',
  maximumJsonBytes: MAXIMUM_LOOKUP_JSON_BYTES,
  requiredValueFields: Object.freeze(['id', 'externalId', 'currencyCode']),
  statusCode: 200,
} as const);
