import { createHash, createHmac, randomBytes } from 'node:crypto';

import {
  TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
  TELEGRAM_PRIVATE_INGRESS_HEADERS,
  TELEGRAM_PRIVATE_INGRESS_KEY_ID,
  TELEGRAM_PRIVATE_INGRESS_PATH,
  telegramPrivateIngressSignatureInput,
  type TelegramPrivateInboundEvent,
} from '@payreplayy/contracts';
import { normalizeLocale } from '@payreplayy/i18n';

export interface TelegramPrivateMessageMetadata {
  readonly updateId: number;
  readonly chat: { readonly id: number; readonly type: string } | undefined;
  readonly from:
    | {
        readonly id: number;
        readonly isBot: boolean;
        readonly firstName: string;
        readonly lastName: string | undefined;
        readonly username: string | undefined;
        readonly languageCode: string | undefined;
      }
    | undefined;
}

export interface TelegramIngressClientConfig {
  readonly baseUrl: string;
  readonly transportHmacSecret: string;
}

export interface TelegramIngressClientDependencies {
  readonly now?: () => Date;
  readonly nonce?: () => string;
  readonly fetch?: TelegramIngressFetch;
}

export type TelegramIngressFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'status'>>;

export class TelegramIngressDeliveryError extends Error {
  constructor(
    readonly retryable: boolean,
    message = 'Private Telegram inbound delivery was not accepted.',
  ) {
    super(message);
    this.name = 'TelegramIngressDeliveryError';
  }
}

const MAXIMUM_TELEGRAM_IDENTIFIER = 9_007_199_254_740_991;

function isSafeTelegramIdentifier(value: number, permitsZero: boolean): boolean {
  return (
    Number.isSafeInteger(value) &&
    value <= MAXIMUM_TELEGRAM_IDENTIFIER &&
    (permitsZero ? value >= 0 : value > 0)
  );
}

/**
 * Reduce a grammY message context to the exact metadata allowed across the process boundary.
 * Message text, captions, media, files, and callbacks are intentionally not part of this input.
 */
export function toTelegramPrivateInboundEvent(
  metadata: TelegramPrivateMessageMetadata,
): TelegramPrivateInboundEvent | undefined {
  const { chat, from } = metadata;
  if (
    !chat ||
    !from ||
    chat.type !== 'private' ||
    from.isBot ||
    chat.id !== from.id ||
    !isSafeTelegramIdentifier(metadata.updateId, true) ||
    !isSafeTelegramIdentifier(from.id, false) ||
    !isSafeTelegramIdentifier(chat.id, false) ||
    from.firstName.trim().length === 0
  ) {
    return undefined;
  }

  return {
    version: 1,
    updateId: metadata.updateId.toString(),
    telegramUserId: from.id.toString(),
    privateChatId: chat.id.toString(),
    firstName: from.firstName,
    lastName: from.lastName ?? null,
    username: from.username ?? null,
    preferredLocale: normalizeLocale(from.languageCode),
  };
}

function rawBodyDigest(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

function signIngressRequest(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  const signature = createHmac('sha256', Buffer.from(transportHmacSecret, 'hex'))
    .update(
      telegramPrivateIngressSignatureInput({
        timestamp,
        nonce,
        bodyByteLength: rawBody.byteLength,
        bodySha256: rawBodyDigest(rawBody),
      }),
      'utf8',
    )
    .digest('base64url');

  return `${TELEGRAM_PRIVATE_INGRESS_KEY_ID}.${signature}`;
}

export async function deliverTelegramPrivateInbound(
  event: TelegramPrivateInboundEvent,
  config: TelegramIngressClientConfig,
  dependencies: TelegramIngressClientDependencies = {},
): Promise<void> {
  const now = dependencies.now?.() ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const nonce = dependencies.nonce?.() ?? randomBytes(24).toString('base64url');
  const rawBody = Buffer.from(JSON.stringify(event), 'utf8');
  let response: Pick<Response, 'status'>;
  try {
    response = await (dependencies.fetch ?? fetch)(
      new URL(TELEGRAM_PRIVATE_INGRESS_PATH, config.baseUrl),
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': TELEGRAM_PRIVATE_INGRESS_CONTENT_TYPE,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId]: TELEGRAM_PRIVATE_INGRESS_KEY_ID,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.timestamp]: timestamp,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce]: nonce,
          [TELEGRAM_PRIVATE_INGRESS_HEADERS.signature]: signIngressRequest(
            config.transportHmacSecret,
            timestamp,
            nonce,
            rawBody,
          ),
        },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch {
    throw new TelegramIngressDeliveryError(true, 'Private Telegram inbound delivery failed.');
  }

  if (response.status !== 204) {
    throw new TelegramIngressDeliveryError(
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
}

/**
 * Uses a fresh nonce on every attempt. There is no durable bot outbox yet, so a final failure is
 * surfaced to the customer rather than being represented as accepted.
 */
export async function deliverTelegramPrivateInboundWithRetry(
  event: TelegramPrivateInboundEvent,
  config: TelegramIngressClientConfig,
  dependencies: TelegramIngressClientDependencies = {},
  maximumAttempts = 2,
): Promise<void> {
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 3) {
    throw new Error('Private Telegram inbound delivery attempts must be an integer from 1 to 3.');
  }

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await deliverTelegramPrivateInbound(event, config, dependencies);
      return;
    } catch (error) {
      if (
        !(error instanceof TelegramIngressDeliveryError) ||
        !error.retryable ||
        attempt === maximumAttempts
      ) {
        throw error;
      }
    }
  }
}
