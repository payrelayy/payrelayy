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
import type { TelebirrCandidateSourceKind } from '@fetanagent/telebirr-verification-foundation/candidate-extraction';

import {
  isBoundedTelegramDepositProofText,
  reduceTelegramDepositProofInput,
} from './telegram-deposit-proof-input.js';
import {
  TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
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
  readonly playerValidationEnabled?: boolean;
}

export interface TelegramGuidedDepositMediaMetadata extends TelegramPrivateActionMetadata {
  readonly replyToMessage: unknown;
  readonly caption: unknown;
  readonly extractedText: string;
  readonly sourceKind: Extract<TelebirrCandidateSourceKind, 'ocr_text' | 'pdf_text'>;
}

export type TelegramGuidedDepositDestinationSubmission =
  | {
      readonly kind: 'action';
      readonly action: Extract<
        TelegramPrivateActionEnvelope,
        { kind: 'save_player_selection_command' | 'player_validation_request_command' }
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

export function isTelegramSavedPlayerChangeCallback(
  metadata: TelegramPlayerRegistrationCallbackMetadata,
): boolean {
  return (
    toTelegramPrivateActionIdentity(metadata) !== undefined &&
    metadata.callbackData === TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA
  );
}

export function reduceTelegramSavedTelebirrDestinationAction(
  metadata: TelegramPrivateActionMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  return identity ? { ...identity, kind: 'saved_telebirr_destination_command' } : undefined;
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
 * Save the Player ID only after a reply to the exact bot prompt. Payment instructions are fetched
 * by a separate user action, so a failed save cannot disclose or start a payment destination.
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
      kind: metadata.playerValidationEnabled
        ? 'player_validation_request_command'
        : 'save_player_selection_command',
      playerId,
    },
  };
}

/** Direct receipt intake is enabled only for TeleBirr. Clear CBE Birr material must not be
 * silently interpreted as TeleBirr while that provider remains non-live. */
export function isCbeBirrReceiptText(text: unknown): boolean {
  return (
    typeof text === 'string' &&
    /(?:cbepay1\.cbe\.com\.et|\bCBE\s?Birr\b|\bCredit Account\b)/iu.test(text)
  );
}

export function reduceTelegramSavedTelebirrProofSubmission(
  metadata: TelegramDepositCommandMetadata,
): TelegramDepositProofSubmission | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  const inputText = metadata.command;
  if (
    !identity ||
    typeof inputText !== 'string' ||
    inputText.startsWith('/') ||
    isCbeBirrReceiptText(inputText)
  )
    return undefined;
  const looksLikeReference = /^(?=[A-Za-z0-9]{8,32}$)(?=.*[0-9])[A-Za-z0-9]+$/u.test(
    inputText.trim(),
  );
  const looksLikeReceipt = /(?:https:\/\/|transaction|receipt|reference|txn\s*id)/iu.test(
    inputText,
  );
  if (!looksLikeReference && !looksLikeReceipt) return undefined;
  const proof = reduceTelegramDepositProofInput('telebirr', inputText);
  if (proof.kind !== 'candidate') return proof;
  return {
    kind: 'action',
    action: {
      ...identity,
      kind: 'saved_telebirr_proof_command',
      transactionReference: proof.transactionReference,
    },
  };
}

export function reduceTelegramSavedTelebirrMediaSubmission(
  metadata: Omit<TelegramGuidedDepositMediaMetadata, 'replyToMessage'>,
): TelegramDepositProofSubmission | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (
    !identity ||
    isCbeBirrReceiptText(metadata.extractedText) ||
    isCbeBirrReceiptText(metadata.caption)
  )
    return undefined;
  if (typeof metadata.caption !== 'undefined' && typeof metadata.caption !== 'string') {
    return { kind: 'invalid_input' };
  }
  const caption = (metadata.caption ?? '').trim();
  const labelledCaption = /^[A-Za-z0-9]{8,32}$/u.test(caption)
    ? `Transaction ID: ${caption}`
    : caption;
  const recognized = metadata.extractedText.trim();
  const labelledRecognized = /^[A-Za-z0-9]{8,32}$/u.test(recognized)
    ? `Transaction ID: ${recognized}`
    : metadata.extractedText;
  const input = reduceTelegramDepositProofInput(
    'telebirr',
    labelledCaption ? `${labelledCaption}\n${labelledRecognized}` : labelledRecognized,
    metadata.sourceKind,
  );
  if (input.kind !== 'candidate') return input;
  return {
    kind: 'action',
    action: {
      ...identity,
      kind: 'saved_telebirr_proof_command',
      transactionReference: input.transactionReference,
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
      readonly action: Extract<
        TelegramPrivateActionEnvelope,
        { kind: 'deposit_proof_command' | 'saved_telebirr_proof_command' }
      >;
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
 * Media is only a reference source for a reply to our exact payment prompt. The reference still
 * crosses the same protected action boundary as typed input. A conflicting caption and image/PDF
 * must require explicit customer selection rather than choosing either one silently.
 */
export function reduceTelegramGuidedDepositMediaSubmission(
  metadata: TelegramGuidedDepositMediaMetadata,
): TelegramDepositProofSubmission | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  const playerId = parseTelegramTelebirrPaymentPromptReply(metadata.replyToMessage);
  if (!identity || !playerId) return undefined;
  if (typeof metadata.caption !== 'undefined' && typeof metadata.caption !== 'string') {
    return { kind: 'invalid_input' };
  }
  const caption = (metadata.caption ?? '').trim();
  // A bare reference in an attachment caption is compared with the recognized reference too.
  const labelledCaption = /^[A-Za-z0-9]{8,32}$/u.test(caption)
    ? `Transaction ID: ${caption}`
    : caption;
  const recognized = metadata.extractedText.trim();
  const labelledRecognized = /^[A-Za-z0-9]{8,32}$/u.test(recognized)
    ? `Transaction ID: ${recognized}`
    : metadata.extractedText;
  const text = labelledCaption ? `${labelledCaption}\n${labelledRecognized}` : labelledRecognized;
  const input = reduceTelegramDepositProofInput('telebirr', text, metadata.sourceKind);
  if (input.kind !== 'candidate') return input;
  return {
    kind: 'action',
    action: {
      ...identity,
      kind: 'deposit_proof_command',
      providerCode: 'telebirr',
      playerId,
      transactionReference: input.transactionReference,
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

/** Explicit staging simulation; only synthetic references cross the private action boundary. */
export function reduceTelegramCbeBirrDryRunCommand(
  metadata: TelegramDepositCommandMetadata,
): TelegramPrivateActionEnvelope | undefined {
  const identity = toTelegramPrivateActionIdentity(metadata);
  if (!identity || typeof metadata.command !== 'string') return undefined;
  const instruction = /^\/cbe_test ([^\s]+)$/u.exec(metadata.command);
  if (instruction) {
    const playerId = instruction[1];
    return playerId && validPlayerIdText(playerId)
      ? { ...identity, kind: 'cbe_birr_dry_run_instruction_command', playerId }
      : undefined;
  }
  const proof = /^\/cbe_test_proof ([A-Za-z0-9_-]{22}) ([^\s]+) (SYNTHCBE[A-Z0-9]{4,24})$/u.exec(
    metadata.command,
  );
  if (!proof) return undefined;
  const [, instructionToken, playerId, transactionReference] = proof;
  return instructionToken &&
    playerId &&
    transactionReference &&
    COMPACT_UUID_PATTERN.test(instructionToken) &&
    validPlayerIdText(playerId)
    ? {
        ...identity,
        kind: 'cbe_birr_bound_dry_run_proof_command',
        instructionToken,
        playerId,
        transactionReference,
      }
    : undefined;
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
