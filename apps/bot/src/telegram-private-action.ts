import {
  TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS,
  parseTelegramPlayerRegistrationCapabilityCallback,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionIdentity,
} from '@payreplayy/contracts';
import { normalizeLocale } from '@payreplayy/i18n';

export interface TelegramPrivateActionMetadata {
  readonly updateId: number;
  readonly chat: { readonly id: number; readonly type: string } | undefined;
  readonly from:
    | {
        readonly id: number;
        readonly isBot: boolean;
        readonly languageCode: string | undefined;
      }
    | undefined;
}

export interface TelegramRootMenuMetadata extends TelegramPrivateActionMetadata {
  /** This is reduced locally and is never placed in the private action envelope. */
  readonly command: string | undefined;
}

export interface TelegramPlayerRegistrationCallbackMetadata extends TelegramPrivateActionMetadata {
  readonly callbackData: unknown;
}

export interface TelegramPlayerIdTextMetadata extends TelegramPrivateActionMetadata {
  readonly text: unknown;
}

const MAXIMUM_TELEGRAM_IDENTIFIER = 9_007_199_254_740_991;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;

function isSafeTelegramIdentifier(value: number, permitsZero: boolean): boolean {
  return (
    Number.isSafeInteger(value) &&
    value <= MAXIMUM_TELEGRAM_IDENTIFIER &&
    (permitsZero ? value >= 0 : value > 0)
  );
}

function toTelegramPrivateActionIdentity(
  metadata: TelegramPrivateActionMetadata,
): TelegramPrivateActionIdentity | undefined {
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

  return {
    version: 1,
    updateId: metadata.updateId.toString(),
    telegramUserId: from.id.toString(),
    privateChatId: chat.id.toString(),
    // Every unsupported Telegram locale deliberately reduces to the product's English-only
    // customer-facing locale. The original language code never crosses this boundary.
    preferredLocale: normalizeLocale(from.languageCode),
  };
}

function validPlayerIdText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Array.from(value).length <= TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

/**
 * Reduce only the exact root-menu commands. This is a pure local reducer; it is not wired to a
 * grammY handler, polling loop, HTTP client, or dispatcher.
 */
export function reduceTelegramRootMenuAction(
  metadata: TelegramRootMenuMetadata,
): TelegramPrivateActionEnvelope | undefined {
  if (metadata.command !== '/start' && metadata.command !== '/menu') return undefined;

  const identity = toTelegramPrivateActionIdentity(metadata);
  return identity ? { ...identity, kind: 'root_menu' } : undefined;
}

/**
 * Reduce a structurally valid opaque capability callback. The raw callback remains strictly
 * in-memory for a later reviewed API boundary and must never be logged or treated as authority.
 */
export function reduceTelegramPlayerRegistrationCallbackAction(
  metadata: TelegramPlayerRegistrationCallbackMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (
    !identity ||
    typeof metadata.callbackData !== 'string' ||
    !parseTelegramPlayerRegistrationCapabilityCallback(metadata.callbackData)
  ) {
    return undefined;
  }

  return {
    ...identity,
    kind: 'player_registration_callback',
    callbackData: metadata.callbackData,
  };
}

/**
 * Reduce bounded, control-character-free Player ID text without attempting platform validation
 * or normalization. A later private database wrapper remains the authority for both.
 */
export function reduceTelegramPlayerIdTextAction(
  metadata: TelegramPlayerIdTextMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (!identity || !validPlayerIdText(metadata.text)) return undefined;

  return {
    ...identity,
    kind: 'player_id_text',
    playerId: metadata.text,
  };
}
