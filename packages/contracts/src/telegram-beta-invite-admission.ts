/**
 * Versioned, private bot-to-API admission envelope. This transport is deliberately independent
 * from both the generic private inbox and customer-action transports: it has a distinct URL,
 * MIME type, headers, HMAC domain, nonce namespace, and invite-token digest domain.
 *
 * It does not enable a route, polling, customer creation, a database connection, or redemption.
 */
export const TELEGRAM_BETA_INVITE_REDEMPTION_PATH = '/internal/v1/telegram/beta-invite-redemption';
export const TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE =
  'application/vnd.payreplayy.telegram-beta-invite-redemption+json';
export const TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID = 'v1';
export const TELEGRAM_BETA_INVITE_REDEMPTION_MAX_BODY_BYTES = 8 * 1024;
export const TELEGRAM_BETA_INVITE_REDEMPTION_MAX_TIMESTAMP_SKEW_SECONDS = 60;

/** A 32-byte random value encoded with unpadded base64url. */
export const TELEGRAM_BETA_INVITE_TOKEN_BYTES = 32;
export const TELEGRAM_BETA_INVITE_TOKEN_LENGTH = 43;

export const TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS = {
  keyId: 'x-payreplayy-admission-key-id',
  nonce: 'x-payreplayy-admission-nonce',
  signature: 'x-payreplayy-admission-signature',
  timestamp: 'x-payreplayy-admission-timestamp',
} as const;

/**
 * This envelope is accepted only after an exact private `/start <invite>` reduction. The invite
 * token is sensitive admission material: it must not be logged, persisted in raw form, or reused
 * as a database identifier.
 */
export interface TelegramBetaInviteRedemption {
  readonly version: 1;
  readonly kind: 'beta_invite_redemption';
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly inviteToken: string;
  readonly preferredLocale: 'en';
}

export interface TelegramBetaInviteRedemptionSignatureInput {
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyByteLength: number;
  readonly bodySha256: string;
}

/**
 * This exact text is HMAC-signed over the transmitted bytes by the future bot transport and
 * verified by the future API route. It must not be shared with a different internal transport.
 */
export function telegramBetaInviteRedemptionSignatureInput(
  input: TelegramBetaInviteRedemptionSignatureInput,
): string {
  return [
    'payreplayy-bot-api-beta-invite-v1',
    'POST',
    TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
    TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
    input.timestamp,
    input.nonce,
    input.bodyByteLength.toString(),
    input.bodySha256,
  ].join('\n');
}

/**
 * A future durable nonce implementation hashes this exact domain-separated input and stores only
 * that digest. It must never share the inbox or customer-action nonce namespaces.
 */
export const TELEGRAM_BETA_INVITE_REDEMPTION_NONCE_DIGEST_DOMAIN =
  'payreplayy:telegram:beta-invite:nonce:v1';

export function telegramBetaInviteRedemptionNonceDigestInput(nonce: string): string {
  return `${TELEGRAM_BETA_INVITE_REDEMPTION_NONCE_DIGEST_DOMAIN}\n${nonce}`;
}

/**
 * A future API adapter creates a domain-separated SHA-256 digest from this exact input before a
 * database call. The raw deep-link token is a 32-byte cryptographically random value and must
 * never cross the API/database boundary.
 */
export const TELEGRAM_BETA_INVITE_TOKEN_DIGEST_DOMAIN = 'payreplayy:telegram:beta-invite:token:v1';

export function telegramBetaInviteTokenDigestInput(inviteToken: string): string {
  return `${TELEGRAM_BETA_INVITE_TOKEN_DIGEST_DOMAIN}\n${inviteToken}`;
}

export function isTelegramBetaInviteToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^[A-Za-z0-9_-]{${TELEGRAM_BETA_INVITE_TOKEN_LENGTH}}$`, 'u').test(value)
  );
}

/** The only safe diagnostic projection of a beta-invite redemption. */
export function redactTelegramBetaInviteRedemptionForLog(
  redemption: TelegramBetaInviteRedemption,
): {
  readonly version: 1;
  readonly kind: 'beta_invite_redemption';
  readonly preferredLocale: 'en';
  readonly invitePresented: true;
} {
  return {
    version: redemption.version,
    kind: redemption.kind,
    preferredLocale: redemption.preferredLocale,
    invitePresented: true,
  };
}
