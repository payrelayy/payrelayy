import {
  TELEGRAM_BETA_INVITE_TOKEN_LENGTH,
  isTelegramBetaInviteToken,
  type TelegramBetaInviteRedemption,
} from '@payreplayy/contracts';

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
