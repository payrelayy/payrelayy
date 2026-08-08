/**
 * Opaque, compact presentation for the single future private-chat action. This is a transport
 * contract only: it carries no Player ID, payment information, customer identity, or secret key.
 */
export const TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_PREFIX = 'prc1';
export const TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_COMPACT_PART_LENGTH = 22;
export const TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_MAX_BYTES = 64;

const COMPACT_PART_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export interface TelegramPlayerRegistrationCapabilityCallback {
  readonly compactCapabilityId: string;
  readonly token: string;
}

function validCompactPart(value: string): boolean {
  return COMPACT_PART_PATTERN.test(value);
}

/**
 * Builds the only supported callback presentation. Its ASCII-only shape is deliberately 50 bytes,
 * below Telegram's 64-byte callback-data limit.
 */
export function formatTelegramPlayerRegistrationCapabilityCallback(
  input: TelegramPlayerRegistrationCapabilityCallback,
): string {
  if (!validCompactPart(input.compactCapabilityId) || !validCompactPart(input.token)) {
    throw new Error(
      'A Telegram Player ID capability callback must contain canonical compact parts.',
    );
  }

  const callbackData = `${TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_PREFIX}.${input.compactCapabilityId}.${input.token}`;
  if (callbackData.length > TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_MAX_BYTES) {
    throw new Error('A Telegram Player ID capability callback exceeds the supported byte limit.');
  }

  return callbackData;
}

/**
 * Parses untrusted Telegram callback text structurally. The API must separately decode the compact
 * identifier and fingerprint the token; callers must never treat this presentation as authority.
 */
export function parseTelegramPlayerRegistrationCapabilityCallback(
  callbackData: unknown,
): TelegramPlayerRegistrationCapabilityCallback | undefined {
  if (
    typeof callbackData !== 'string' ||
    callbackData.length > TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_MAX_BYTES
  ) {
    return undefined;
  }

  const parts = callbackData.split('.');
  const compactCapabilityId = parts[1];
  const token = parts[2];
  if (
    parts.length !== 3 ||
    parts[0] !== TELEGRAM_PLAYER_REGISTRATION_CAPABILITY_CALLBACK_PREFIX ||
    compactCapabilityId === undefined ||
    token === undefined ||
    !validCompactPart(compactCapabilityId) ||
    !validCompactPart(token)
  ) {
    return undefined;
  }

  return {
    compactCapabilityId,
    token,
  };
}
