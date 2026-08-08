/**
 * The only Telegram fields that may cross from the bot process to the API.
 * This deliberately excludes message text, captions, callback data, media, file IDs, payment
 * references, and the original Telegram Update object.
 */
export interface TelegramPrivateInboundEvent {
  readonly version: 1;
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly preferredLocale: TelegramInboundLocale;
}

export type TelegramInboundLocale = 'en' | 'am';

export const TELEGRAM_PRIVATE_INGRESS_PATH = '/internal/v1/telegram/private-inbound';
export const TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE =
  'application/vnd.payreplayy.telegram-private-inbound+json';
export const TELEGRAM_PRIVATE_INGRESS_KEY_ID = 'v1';
export const TELEGRAM_PRIVATE_INGRESS_MAX_BODY_BYTES = 32 * 1024;
export const TELEGRAM_PRIVATE_INGRESS_MAX_TIMESTAMP_SKEW_SECONDS = 60;

export const TELEGRAM_PRIVATE_INGRESS_HEADERS = {
  keyId: 'x-payreplayy-key-id',
  nonce: 'x-payreplayy-nonce',
  signature: 'x-payreplayy-signature',
  timestamp: 'x-payreplayy-timestamp',
} as const;

export interface TelegramPrivateIngressSignatureInput {
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyByteLength: number;
  readonly bodySha256: string;
}

/**
 * This exact text is HMAC-signed by the bot and verified by the API. The body digest is calculated
 * from the exact transmitted bytes, never from a re-serialized JSON object.
 */
export function telegramPrivateIngressSignatureInput(
  input: TelegramPrivateIngressSignatureInput,
): string {
  return [
    'payreplayy-bot-api-v1',
    'POST',
    TELEGRAM_PRIVATE_INGRESS_PATH,
    TELEGRAM_PRIVATE_INGRESS_KEY_ID,
    input.timestamp,
    input.nonce,
    input.bodyByteLength.toString(),
    input.bodySha256,
  ].join('\n');
}
