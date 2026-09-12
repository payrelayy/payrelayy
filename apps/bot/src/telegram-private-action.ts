import {
  TELEGRAM_PRIVATE_ACTION_DEPOSIT_TOKEN_LENGTH,
  TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_REFERENCE_MAX_CODE_POINTS,
  TELEGRAM_PRIVATE_ACTION_REFERENCE_MIN_CODE_POINTS,
  parseTelegramDepositProofStatusCallback,
  parseTelegramDepositProofTrackingHandle,
  parseTelegramPlayerRegistrationCapabilityCallback,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionIdentity,
} from '@fetanagent/contracts';
import { normalizeLocale } from '@fetanagent/i18n';

import {
  isBoundedTelegramDepositProofText,
  reduceTelegramDepositProofInput,
} from './telegram-deposit-proof-input.js';
import {
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
  isTelegramGuidedDepositPromptReply,
  isTelegramGuidedDepositPlayerPromptReply,
  parseTelegramGuidedDepositInput,
  parseTelegramGuidedDepositPlayerInput,
  parseTelegramTelebirrPaymentPromptReply,
} from './telegram-guided-deposit.js';

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

export interface TelegramDepositCommandMetadata extends TelegramPrivateActionMetadata {
  readonly command: unknown;
}

export interface TelegramGuidedDepositReplyMetadata extends TelegramPrivateActionMetadata {
  readonly text: unknown;
  readonly replyToMessage: unknown;
}

export type TelegramGuidedDepositDestinationSubmission =
  | {
      readonly kind: 'action';
      readonly action: Extract<
        TelegramPrivateActionEnvelope,
        { kind: 'telebirr_deposit_destination_command' }
      >;
    }
  | { readonly kind: 'invalid_input' };

const MAXIMUM_TELEGRAM_IDENTIFIER = 9_007_199_254_740_991;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const ETB_AMOUNT_PATTERN = /^(?:[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/u;
const COMPACT_UUID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

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

/** Recognize only a private, exact `/deposit` command prefix for fixed invalid-input handling. */
export function isRecognizedTelegramDepositCommand(
  metadata: TelegramDepositCommandMetadata,
): boolean {
  return (
    toTelegramPrivateActionIdentity(metadata) !== undefined &&
    typeof metadata.command === 'string' &&
    /^\/deposit(?:\s|$)/u.test(metadata.command)
  );
}

/** Recognize status requests so malformed handles receive the same generic unavailable reply. */
export function isRecognizedTelegramDepositStatusCommand(
  metadata: TelegramDepositCommandMetadata,
): boolean {
  return (
    toTelegramPrivateActionIdentity(metadata) !== undefined &&
    typeof metadata.command === 'string' &&
    /^\/deposit_status(?:\s|$)/u.test(metadata.command)
  );
}

export function isRecognizedTelegramDepositProofStatusCallback(
  metadata: TelegramPlayerRegistrationCallbackMetadata,
): boolean {
  return (
    toTelegramPrivateActionIdentity(metadata) !== undefined &&
    typeof metadata.callbackData === 'string' &&
    /^dps1(?:\.|$)/u.test(metadata.callbackData)
  );
}

/** The fixed callback opens a prompt only; it is not an action capability or API request. */
export function isTelegramGuidedDepositStartCallback(
  metadata: TelegramPlayerRegistrationCallbackMetadata,
): boolean {
  return (
    toTelegramPrivateActionIdentity(metadata) !== undefined &&
    metadata.callbackData === TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA
  );
}

/** `/deposit` is the discoverable guided entry point; argument-bearing legacy commands still work. */
export function isTelegramGuidedDepositStartCommand(
  metadata: TelegramDepositCommandMetadata,
): boolean {
  return toTelegramPrivateActionIdentity(metadata) !== undefined && metadata.command === '/deposit';
}

/** Help contains no customer data and is available only in the matching private chat. */
export function isTelegramPrivateHelpCommand(metadata: TelegramDepositCommandMetadata): boolean {
  return toTelegramPrivateActionIdentity(metadata) !== undefined && metadata.command === '/help';
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

/** Re-checking a proof always goes to the API with the caller's private-chat identity. */
export function reduceTelegramDepositProofStatusCallbackAction(
  metadata: TelegramPlayerRegistrationCallbackMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  const proofToken = parseTelegramDepositProofStatusCallback(metadata.callbackData);
  return identity && proofToken
    ? { ...identity, kind: 'deposit_proof_status_command', proofToken }
    : undefined;
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

/**
 * Convert the first wizard reply into a protected destination lookup. Ordinary Player-ID text and
 * forged customer-authored prompts never enter this path.
 */
export function reduceTelegramGuidedDepositDestinationSubmission(
  metadata: TelegramGuidedDepositReplyMetadata,
): TelegramGuidedDepositDestinationSubmission | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (!identity || !isTelegramGuidedDepositPlayerPromptReply(metadata.replyToMessage)) {
    return undefined;
  }
  const playerId = parseTelegramGuidedDepositPlayerInput(metadata.text);
  if (!playerId) return { kind: 'invalid_input' };
  return {
    kind: 'action',
    action: {
      ...identity,
      kind: 'telebirr_deposit_destination_command',
      playerId,
    },
  };
}

/** Parse the explicit Player-ID + amount command without guessing which linked account to use. */
export function reduceTelegramDepositIntentCommand(
  metadata: TelegramDepositCommandMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (!identity || typeof metadata.command !== 'string') return undefined;
  const match = /^\/deposit ([^\s]+) ([^\s]+)$/u.exec(metadata.command);
  if (!match) return undefined;
  const [, playerId, amountEtb] = match;
  if (!validPlayerIdText(playerId) || !amountEtb || !ETB_AMOUNT_PATTERN.test(amountEtb)) {
    return undefined;
  }
  return { ...identity, kind: 'deposit_intent_command', playerId, amountEtb };
}

export type TelegramDepositProofSubmission =
  | {
      readonly kind: 'action';
      readonly action: Extract<TelegramPrivateActionEnvelope, { kind: 'deposit_proof_command' }>;
    }
  | { readonly kind: 'selection_required' }
  | { readonly kind: 'invalid_input' };

/**
 * Convert one explicit reply to the bot's guided prompt into the established protected action.
 * This is stateless: all required customer input is present in the new Telegram update, so no
 * Player ID or payment reference is retained in bot memory between messages.
 */
export function reduceTelegramGuidedDepositProofSubmission(
  metadata: TelegramGuidedDepositReplyMetadata,
): TelegramDepositProofSubmission | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (!identity) return undefined;

  const paymentPlayerId = parseTelegramTelebirrPaymentPromptReply(metadata.replyToMessage);
  const legacyReply = isTelegramGuidedDepositPromptReply(metadata.replyToMessage);
  if (!paymentPlayerId && !legacyReply) return undefined;

  const legacyInput = legacyReply ? parseTelegramGuidedDepositInput(metadata.text) : undefined;
  const playerId = paymentPlayerId ?? legacyInput?.playerId;
  const proofText = paymentPlayerId ? metadata.text : legacyInput?.proofText;
  if (!playerId || typeof proofText !== 'string') return { kind: 'invalid_input' };
  const proofInput = reduceTelegramDepositProofInput('telebirr', proofText);
  if (proofInput.kind !== 'candidate') return proofInput;
  return {
    kind: 'action',
    action: {
      ...identity,
      kind: 'deposit_proof_command',
      providerCode: 'telebirr',
      playerId,
      transactionReference: proofInput.transactionReference,
    },
  };
}

/**
 * Parse an explicit, amount-free proof command. TeleBirr additionally accepts receipt URL/SMS
 * candidate text. Ambiguity never selects a reference or forwards the original message.
 */
export function reduceTelegramDepositProofSubmission(
  metadata: TelegramDepositCommandMetadata,
): TelegramDepositProofSubmission | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (
    !identity ||
    typeof metadata.command !== 'string' ||
    !isRecognizedTelegramDepositCommand(metadata)
  ) {
    return undefined;
  }
  if (!isBoundedTelegramDepositProofText(metadata.command)) return { kind: 'invalid_input' };
  const match = /^\/deposit (cbe_birr|telebirr) ([^\s]+) ([\s\S]+)$/u.exec(metadata.command);
  if (!match) return { kind: 'invalid_input' };
  const [, providerCode, playerId, proofText] = match;
  if (
    (providerCode !== 'cbe_birr' && providerCode !== 'telebirr') ||
    !validPlayerIdText(playerId) ||
    !proofText
  ) {
    return { kind: 'invalid_input' };
  }
  const input = reduceTelegramDepositProofInput(providerCode, proofText);
  if (input.kind !== 'candidate') return input;
  return {
    kind: 'action',
    action: {
      ...identity,
      kind: 'deposit_proof_command',
      providerCode,
      playerId,
      transactionReference: input.transactionReference,
    },
  };
}

/** Action-only compatibility helper; the handler uses the full result for safe input guidance. */
export function reduceTelegramDepositProofCommand(
  metadata: TelegramDepositCommandMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const result = reduceTelegramDepositProofSubmission(metadata);
  return result?.kind === 'action' ? result.action : undefined;
}

/** Parse an exact compact deposit token and a bounded single-token transaction reference. */
export function reduceTelegramDepositReferenceCommand(
  metadata: TelegramDepositCommandMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (!identity || typeof metadata.command !== 'string') return undefined;
  const match = /^\/reference ([A-Za-z0-9_-]+) ([^\s]+)$/u.exec(metadata.command);
  if (!match) return undefined;
  const [, depositToken, transactionReference] = match;
  if (
    !depositToken ||
    depositToken.length !== TELEGRAM_PRIVATE_ACTION_DEPOSIT_TOKEN_LENGTH ||
    !COMPACT_UUID_PATTERN.test(depositToken) ||
    !transactionReference ||
    Array.from(transactionReference).length < TELEGRAM_PRIVATE_ACTION_REFERENCE_MIN_CODE_POINTS ||
    Array.from(transactionReference).length > TELEGRAM_PRIVATE_ACTION_REFERENCE_MAX_CODE_POINTS ||
    !/^[A-Za-z0-9._-]+$/u.test(transactionReference)
  ) {
    return undefined;
  }
  return {
    ...identity,
    kind: 'deposit_reference_command',
    depositToken,
    transactionReference,
  };
}

/** Parse an exact compact status token without treating its presentation as authority. */
export function reduceTelegramDepositStatusCommand(
  metadata: TelegramDepositCommandMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (!identity || typeof metadata.command !== 'string') return undefined;
  if (metadata.command.startsWith('/deposit_status p1.')) {
    const proofToken = parseTelegramDepositProofTrackingHandle(
      metadata.command.slice('/deposit_status '.length),
    );
    return proofToken
      ? { ...identity, kind: 'deposit_proof_status_command', proofToken }
      : undefined;
  }
  const match = /^\/deposit_status ([A-Za-z0-9_-]+)$/u.exec(metadata.command);
  const depositToken = match?.[1];
  if (
    !depositToken ||
    depositToken.length !== TELEGRAM_PRIVATE_ACTION_DEPOSIT_TOKEN_LENGTH ||
    !COMPACT_UUID_PATTERN.test(depositToken)
  ) {
    return undefined;
  }
  return { ...identity, kind: 'deposit_status_command', depositToken };
}
