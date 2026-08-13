import { createHash, createHmac, randomBytes } from 'node:crypto';

import {
  TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
  TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS,
  TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
  TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
  TELEGRAM_BETA_INVITE_TOKEN_LENGTH,
  isTelegramBetaInviteToken,
  telegramBetaInviteRedemptionSignatureInput,
  type TelegramBetaInviteRedemption,
} from '@fetanagent/contracts';
import { message } from '@fetanagent/i18n';

export interface TelegramBetaInviteStartMetadata {
  readonly updateId: number;
  readonly chat: { readonly id: number; readonly type: string } | undefined;
  readonly from:
    | {
        readonly id: number;
        readonly isBot: boolean;
      }
    | undefined;
  /** Untrusted Telegram message text. It is never logged by this reducer. */
  readonly text: unknown;
}

export interface TelegramBetaAdmissionClientConfig {
  readonly baseUrl: string;
  readonly transportHmacSecret: string;
}

export type TelegramBetaAdmissionFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'status'>>;

export interface TelegramBetaAdmissionClientDependencies {
  readonly now?: () => Date;
  readonly nonce?: () => string;
  readonly fetch?: TelegramBetaAdmissionFetch;
}

export class TelegramBetaAdmissionDeliveryError extends Error {
  constructor(
    readonly retryable: boolean,
    messageText = 'Telegram beta admission delivery was not accepted.',
  ) {
    super(messageText);
    this.name = 'TelegramBetaAdmissionDeliveryError';
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

function exactStartInviteToken(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;

  // No `/start@bot`, whitespace normalization, extra argument, caption, or command alias is
  // accepted. Telegram deep links produce exactly this one private-message presentation.
  const match = new RegExp(
    `^/start ([A-Za-z0-9_-]{${TELEGRAM_BETA_INVITE_TOKEN_LENGTH}})$`,
    'u',
  ).exec(text);
  const inviteToken = match?.[1];
  return isTelegramBetaInviteToken(inviteToken) ? inviteToken : undefined;
}

/**
 * Pure, disconnected admission reducer. It accepts only an exact private non-bot `/start` with a
 * 32-byte base64url invite. It neither sends a reply nor calls an API/database/Telegram service.
 */
export function reduceTelegramBetaInviteRedemption(
  metadata: TelegramBetaInviteStartMetadata,
): TelegramBetaInviteRedemption | undefined {
  const { chat, from } = metadata;
  if (
    !chat ||
    !from ||
    chat.type !== 'private' ||
    from.isBot ||
    chat.id !== from.id ||
    !isSafeTelegramIdentifier(metadata.updateId, true) ||
    !isSafeTelegramIdentifier(from.id, false) ||
    !isSafeTelegramIdentifier(chat.id, false)
  ) {
    return undefined;
  }

  const inviteToken = exactStartInviteToken(metadata.text);
  if (!inviteToken) return undefined;

  return {
    version: 1,
    kind: 'beta_invite_redemption',
    updateId: metadata.updateId.toString(),
    telegramUserId: from.id.toString(),
    privateChatId: chat.id.toString(),
    inviteToken,
    preferredLocale: 'en',
  };
}

function rawBodyDigest(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

function signBetaAdmissionRequest(
  transportHmacSecret: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer,
): string {
  const signature = createHmac('sha256', Buffer.from(transportHmacSecret, 'hex'))
    .update(
      telegramBetaInviteRedemptionSignatureInput({
        timestamp,
        nonce,
        bodyByteLength: rawBody.byteLength,
        bodySha256: rawBodyDigest(rawBody),
      }),
      'utf8',
    )
    .digest('base64url');

  return `${TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID}.${signature}`;
}

/**
 * Delivers the exact serialized redemption bytes to the isolated admission service. A 204 is the
 * only success result and is returned by that service only after database admission succeeds.
 */
export async function deliverTelegramBetaInviteRedemption(
  redemption: TelegramBetaInviteRedemption,
  config: TelegramBetaAdmissionClientConfig,
  dependencies: TelegramBetaAdmissionClientDependencies = {},
): Promise<void> {
  const now = dependencies.now?.() ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1_000).toString();
  const nonce = dependencies.nonce?.() ?? randomBytes(24).toString('base64url');
  if (!/^[A-Za-z0-9_-]{32}$/u.test(nonce)) {
    throw new TelegramBetaAdmissionDeliveryError(false);
  }
  if (!/^[0-9a-f]{64}$/u.test(config.transportHmacSecret)) {
    throw new TelegramBetaAdmissionDeliveryError(false);
  }

  const rawBody = Buffer.from(JSON.stringify(redemption), 'utf8');
  let response: Pick<Response, 'status'>;
  try {
    response = await (dependencies.fetch ?? fetch)(
      new URL(TELEGRAM_BETA_INVITE_REDEMPTION_PATH, config.baseUrl),
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
          [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.keyId]: TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
          [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.timestamp]: timestamp,
          [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce]: nonce,
          [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature]: signBetaAdmissionRequest(
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
    throw new TelegramBetaAdmissionDeliveryError(true, 'Telegram beta admission delivery failed.');
  }

  if (response.status !== 204) {
    throw new TelegramBetaAdmissionDeliveryError(
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
}

/** Uses a fresh nonce per attempt and permits no more than two total delivery attempts. */
export async function deliverTelegramBetaInviteRedemptionWithRetry(
  redemption: TelegramBetaInviteRedemption,
  config: TelegramBetaAdmissionClientConfig,
  dependencies: TelegramBetaAdmissionClientDependencies = {},
  maximumAttempts = 2,
): Promise<void> {
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 2) {
    throw new Error('Telegram beta admission attempts must be an integer from 1 to 2.');
  }

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await deliverTelegramBetaInviteRedemption(redemption, config, dependencies);
      return;
    } catch (error) {
      if (
        !(error instanceof TelegramBetaAdmissionDeliveryError) ||
        !error.retryable ||
        attempt === maximumAttempts
      ) {
        throw error;
      }
    }
  }
}

export type TelegramBetaInviteMessageOutcome = 'ignored' | 'admitted' | 'unavailable';

export interface TelegramBetaInviteMessageDependencies extends TelegramBetaAdmissionClientDependencies {
  readonly reply: (text: string) => Promise<unknown>;
}

/**
 * The complete visible beta handler. It ignores every non-invite update, waits for a committed
 * admission acknowledgement, and never exposes invite or database details in a reply.
 */
export async function handleTelegramBetaInviteMessage(
  metadata: TelegramBetaInviteStartMetadata,
  config: TelegramBetaAdmissionClientConfig,
  dependencies: TelegramBetaInviteMessageDependencies,
): Promise<TelegramBetaInviteMessageOutcome> {
  const redemption = reduceTelegramBetaInviteRedemption(metadata);
  if (!redemption) return 'ignored';

  try {
    await deliverTelegramBetaInviteRedemptionWithRetry(redemption, config, dependencies);
  } catch {
    await dependencies.reply(message('en', 'betaAdmissionUnavailable'));
    return 'unavailable';
  }

  await dependencies.reply(message('en', 'betaAdmissionWelcome'));
  return 'admitted';
}
