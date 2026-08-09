/**
 * Versioned, private bot-to-API action envelope. It is intentionally separate from the metadata
 * inbox transport: it has a different URL, MIME type, authentication headers, HMAC domain, and
 * nonce-digest domain. This contract does not enable a route or a customer-facing action.
 */
export const TELEGRAM_PRIVATE_ACTION_PATH = '/internal/v1/telegram/private-action';
export const TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE =
  'application/vnd.payreplayy.telegram-private-action+json';
export const TELEGRAM_PRIVATE_ACTION_KEY_ID = 'v1';
export const TELEGRAM_PRIVATE_ACTION_MAX_BODY_BYTES = 16 * 1024;
export const TELEGRAM_PRIVATE_ACTION_MAX_TIMESTAMP_SKEW_SECONDS = 60;
export const TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS = 64;

export const TELEGRAM_PRIVATE_ACTION_HEADERS = {
  keyId: 'x-payreplayy-action-key-id',
  nonce: 'x-payreplayy-action-nonce',
  signature: 'x-payreplayy-action-signature',
  timestamp: 'x-payreplayy-action-timestamp',
} as const;

/**
 * A future durable nonce implementation must hash this exact domain-separated input, never store
 * the raw nonce, and never share the private-inbox nonce namespace.
 */
export const TELEGRAM_PRIVATE_ACTION_NONCE_DIGEST_DOMAIN =
  'payreplayy:telegram:private-action:nonce:v1';

export interface TelegramPrivateActionIdentity {
  readonly version: 1;
  readonly updateId: string;
  readonly telegramUserId: string;
  readonly privateChatId: string;
  readonly preferredLocale: 'en';
}

/**
 * These are the only future customer action presentations this local contract understands. The
 * envelope contains no payment reference, attachment, database identifier, or Telegram Update.
 */
export type TelegramPrivateActionEnvelope =
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'root_menu';
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'player_registration_callback';
      /** Opaque, compact capability presentation; never log this raw value. */
      readonly callbackData: string;
    })
  | (TelegramPrivateActionIdentity & {
      readonly kind: 'player_id_text';
      /** Customer input for a later reviewed database boundary; never log this raw value. */
      readonly playerId: string;
    });

export interface TelegramPrivateActionSignatureInput {
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyByteLength: number;
  readonly bodySha256: string;
}

/**
 * This exact text is HMAC-signed by the future bot-side action transport and verified by the API.
 * The digest is calculated over the exact transmitted bytes, never a re-serialized JSON object.
 */
export function telegramPrivateActionSignatureInput(
  input: TelegramPrivateActionSignatureInput,
): string {
  return [
    'payreplayy-bot-api-private-action-v1',
    'POST',
    TELEGRAM_PRIVATE_ACTION_PATH,
    TELEGRAM_PRIVATE_ACTION_KEY_ID,
    input.timestamp,
    input.nonce,
    input.bodyByteLength.toString(),
    input.bodySha256,
  ].join('\n');
}

export function telegramPrivateActionNonceDigestInput(nonce: string): string {
  return `${TELEGRAM_PRIVATE_ACTION_NONCE_DIGEST_DOMAIN}\n${nonce}`;
}

/**
 * The transport's safe log projection intentionally excludes every customer-entered or opaque
 * action field. A caller must not substitute this for authorization or persistence.
 */
export function redactTelegramPrivateActionForLog(action: TelegramPrivateActionEnvelope): {
  readonly version: 1;
  readonly kind: TelegramPrivateActionEnvelope['kind'];
  readonly preferredLocale: 'en';
  readonly customerInputPresent: boolean;
} {
  return {
    version: action.version,
    kind: action.kind,
    preferredLocale: action.preferredLocale,
    customerInputPresent: action.kind !== 'root_menu',
  };
}
