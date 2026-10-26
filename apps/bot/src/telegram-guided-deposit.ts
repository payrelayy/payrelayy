import { TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS } from '@fetanagent/contracts';

import { isBoundedTelegramDepositProofText } from './telegram-deposit-proof-input.js';
import {
  TELEGRAM_INVALID_PAYMENT_REFERENCE_TEXT,
  TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT,
} from './telegram-customer-copy.js';

/**
 * This callback only opens a Telegram Player ID prompt. It carries no capability, customer data,
 * Player ID, payment reference, or authority to call the API.
 */
export const TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA = 'gd1.telebirr';
export const TELEGRAM_GUIDED_CBE_CALLBACK_DATA = 'gd1.cbe';
export const TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA = 'gd1.deposit';
export const TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA = 'sp1.change';

export const TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT = '💰 TeleBirr';
export const TELEGRAM_GUIDED_CBE_BUTTON_TEXT = '💳 CBE Birr';
export const TELEGRAM_GUIDED_COMBINED_BUTTON_TEXT = '💰 Deposit';

const TELEBIRR_AMOUNT_TEXT = 'Amount: choose 25–25,000 ETB in TeleBirr.';
const PREVIOUS_TELEBIRR_PILOT_AMOUNT_TEXT = 'Amount: send exactly 25 ETB in TeleBirr.';
const TELEBIRR_PRESENTATION_WINDOW_TEXT =
  'These payment details remain valid for 1 hour. Send the receipt or reference after paying.';
const PREVIOUS_TELEBIRR_WINDOW_TEXT =
  'This payment instruction is valid for at most 10 minutes; submit the reference promptly.';
const LEGACY_TELEBIRR_WINDOW_TEXT = 'These payment details are valid for 12 hours.';
const PREVIOUS_TELEBIRR_PROOF_OPTIONS_TEXT = 'You can also paste the receipt link or full SMS.';
const CURRENT_TELEBIRR_PROOF_OPTIONS_TEXT =
  'You can also send the full message, receipt link, JPG/PNG screenshot, or PDF (up to 5 MB).';
const PAYMENT_PROOF_INSTRUCTION_TEXT = 'After paying, send your receipt or reference here.';
const RECENT_PAYMENT_PROOF_INSTRUCTION_TEXT =
  'After paying, send reference, SMS, receipt link, screenshot or PDF here.';

export const TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT = 'FetanAgent';

/** A normal chat message; a standalone Player ID is accepted without replying to it. */
export const TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT = '🎮 Send your KemerBet Player ID.';

const RECENT_GUIDED_DEPOSIT_PROMPT_TEXT = '🎮 Send your 8-digit KemerBet Player ID.';

const PREVIOUS_GUIDED_DEPOSIT_PLAYER_PROMPT_TEXT = [
  '🎮 Send your KemerBet Player ID.',
  '/menu to cancel.',
].join('\n');

const PRECEDING_GUIDED_DEPOSIT_PROMPT_TEXT = [
  '🎮 Player ID',
  'Send your KemerBet Player ID. Future deposits will use it.',
  '/menu to cancel.',
].join('\n');

const PRIOR_GUIDED_DEPOSIT_PROMPT_TEXT = [
  '🎮 Choose Player ID',
  '',
  'Which KemerBet Player ID should receive your deposits?',
  'Reply with the Player ID only.',
  'This choice applies to future direct submissions; it does not change a deposit already submitted.',
  '',
  'Tap /menu to cancel.',
].join('\n');

const PREVIOUS_GUIDED_DEPOSIT_PROMPT_TEXT = [
  '💰 New deposit',
  '',
  'Which KemerBet Player ID should receive the money?',
  'Reply with the Player ID only.',
  '',
  'Tap /menu to cancel.',
].join('\n');

/** Keep replies to the immediately previous release safe during a rolling bot update. */
export const TELEGRAM_GUIDED_DEPOSIT_LEGACY_PROMPT_TEXT = [
  '💰 TeleBirr deposit',
  '',
  'Reply to this message with:',
  '1. Your KemerBet Player ID on the first line',
  '2. Your TeleBirr transaction number on the second line',
  '',
  'Example:',
  'PLAYER-DEMO-42',
  'SYNTB00000001',
  '',
  'You may paste a TeleBirr receipt link or the full SMS instead of the transaction number.',
  'Use a reference from a transfer you already made. Do not make a new transfer for this step.',
  'FetanAgent will submit the reference for verification. It will not credit or move money yet.',
  'Cancel anytime with /menu.',
].join('\n');

export const TELEGRAM_GUIDED_DEPOSIT_PLAYER_INVALID_TEXT =
  'That Player ID doesn’t look right. Please try again.';

export const TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT = TELEGRAM_INVALID_PAYMENT_REFERENCE_TEXT;

export const TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT = TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT;

interface TelegramReplyMessageShape {
  readonly text?: unknown;
  readonly from?: { readonly is_bot?: unknown };
}

export function isTelegramGuidedDepositPromptReply(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as TelegramReplyMessageShape;
  return (
    message.text === TELEGRAM_GUIDED_DEPOSIT_LEGACY_PROMPT_TEXT && message.from?.is_bot === true
  );
}

export function isTelegramGuidedDepositPlayerPromptReply(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as TelegramReplyMessageShape;
  return (
    (message.text === TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT ||
      message.text === RECENT_GUIDED_DEPOSIT_PROMPT_TEXT ||
      message.text === PREVIOUS_GUIDED_DEPOSIT_PLAYER_PROMPT_TEXT ||
      message.text === PRECEDING_GUIDED_DEPOSIT_PROMPT_TEXT ||
      message.text === PRIOR_GUIDED_DEPOSIT_PROMPT_TEXT ||
      message.text === PREVIOUS_GUIDED_DEPOSIT_PROMPT_TEXT) &&
    message.from?.is_bot === true
  );
}

export interface TelegramTelebirrPaymentPromptInput {
  readonly playerId: string;
  readonly receiverAccountHolderName: string;
  readonly receiverAccountReference: string;
}

export interface TelegramCombinedPaymentReceiver {
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly receiverAccountHolderName: string;
  readonly receiverAccountReference: string;
}

export interface TelegramCombinedPaymentPromptInput {
  readonly playerId: string;
  readonly receivers: readonly TelegramCombinedPaymentReceiver[];
}

/** Keep the stored 251-prefixed account intact; shorten only Ethiopian mobile numbers on cards. */
export function toTelegramLocalReceiverNumber(accountReference: string): string {
  return /^251[0-9]{9}$/u.test(accountReference) ? accountReference.slice(3) : accountReference;
}

/** Telegram code entities make the receiver digits easy to copy without extra buttons. */
export function telegramReceiverNumberCodeEntities(
  text: string,
): Array<{ type: 'code'; offset: number; length: number }> {
  if (
    !text.startsWith('💰 FetanAgent deposit\n') &&
    !text.startsWith('💰 TeleBirr deposit\n') &&
    !text.startsWith('💳 CBE Birr deposit\n')
  )
    return [];
  return [...text.matchAll(/(?:^|\n)(?:📱 )?Number: ([0-9]{9,24})(?=\n|$)/gu)].map((match) => ({
    type: 'code' as const,
    // Telegram counts UTF-16 code units, like JavaScript string indexes.
    offset: match.index + match[0].length - match[1]!.length,
    length: match[1]!.length,
  }));
}

/** One payable card, with each Owner-configured receiver kept under its own provider. */
function renderTelegramCombinedPaymentPrompt(
  input: TelegramCombinedPaymentPromptInput,
  previousWording: boolean,
  localNumbers: boolean,
  conciseProofText: boolean,
): string {
  if (
    !validPlayerId(input.playerId) ||
    input.receivers.length < 1 ||
    input.receivers.length > 2 ||
    (input.receivers.length === 2 &&
      (input.receivers[0]?.providerCode !== 'telebirr' ||
        input.receivers[1]?.providerCode !== 'cbe_birr')) ||
    input.receivers.some(
      (receiver) =>
        (receiver.providerCode !== 'telebirr' && receiver.providerCode !== 'cbe_birr') ||
        receiver.receiverAccountHolderName !== receiver.receiverAccountHolderName.trim() ||
        Array.from(receiver.receiverAccountHolderName).length < 2 ||
        Array.from(receiver.receiverAccountHolderName).length > 160 ||
        /[\u0000-\u001f\u007f]/u.test(receiver.receiverAccountHolderName) ||
        !/^[0-9]{9,24}$/u.test(receiver.receiverAccountReference),
    )
  )
    throw new Error('The combined payment prompt is unavailable.');
  return [
    '💰 FetanAgent deposit',
    previousWording ? 'Choose one available method. Send 25–25,000 ETB.' : 'Send 25–25,000 ETB.',
    ...input.receivers.flatMap((receiver) => [
      '',
      receiver.providerCode === 'telebirr' ? 'TeleBirr' : 'CBE Birr',
      `Name: ${receiver.receiverAccountHolderName}`,
      `Number: ${localNumbers ? toTelegramLocalReceiverNumber(receiver.receiverAccountReference) : receiver.receiverAccountReference}`,
    ]),
    '',
    `Saved Player ID: ${input.playerId}`,
    ...(previousWording
      ? [
          input.receivers.some((receiver) => receiver.providerCode === 'telebirr')
            ? 'Valid for 1 hour. Check the receiver name before paying.'
            : 'Check the receiver name before paying.',
        ]
      : []),
    conciseProofText
      ? PAYMENT_PROOF_INSTRUCTION_TEXT
      : 'After paying, send one reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.',
  ].join('\n');
}

export function buildTelegramCombinedPaymentPrompt(
  input: TelegramCombinedPaymentPromptInput,
): string {
  return renderTelegramCombinedPaymentPrompt(input, false, true, true);
}

export function parseTelegramCombinedPaymentPromptReply(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const message = value as TelegramReplyMessageShape;
  if (message.from?.is_bot !== true || typeof message.text !== 'string') return undefined;
  const playerId = /(?:^|\n)Saved Player ID: ([^\s]+)(?:\n|$)/u.exec(message.text)?.[1];
  const receivers = [
    ...message.text.matchAll(
      /(?:^|\n)(TeleBirr|CBE Birr)\nName: ([^\r\n]+)\nNumber: ([0-9]{9,24})(?=\n|$)/gu,
    ),
  ].map((match) => ({
    providerCode: match[1] === 'TeleBirr' ? ('telebirr' as const) : ('cbe_birr' as const),
    receiverAccountHolderName: match[2]!,
    receiverAccountReference: match[3]!,
  }));
  if (!playerId) return undefined;
  try {
    const input = { playerId, receivers };
    const currentPrompt = renderTelegramCombinedPaymentPrompt(input, false, true, true);
    return message.text === currentPrompt ||
      message.text ===
        currentPrompt.replace(
          PAYMENT_PROOF_INSTRUCTION_TEXT,
          RECENT_PAYMENT_PROOF_INSTRUCTION_TEXT,
        ) ||
      message.text === renderTelegramCombinedPaymentPrompt(input, false, true, false) ||
      message.text === renderTelegramCombinedPaymentPrompt(input, false, false, false) ||
      message.text === renderTelegramCombinedPaymentPrompt(input, true, false, false)
      ? playerId
      : undefined;
  } catch {
    return undefined;
  }
}

export function isTelegramCombinedPaymentPromptReply(value: unknown): boolean {
  return parseTelegramCombinedPaymentPromptReply(value) !== undefined;
}

function renderTelegramTelebirrPaymentPrompt(
  input: TelegramTelebirrPaymentPromptInput,
  localNumber: boolean,
): string {
  if (
    !validPlayerId(input.playerId) ||
    input.receiverAccountHolderName !== input.receiverAccountHolderName.trim() ||
    Array.from(input.receiverAccountHolderName).length < 2 ||
    Array.from(input.receiverAccountHolderName).length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(input.receiverAccountHolderName) ||
    !/^[0-9]{9,24}$/u.test(input.receiverAccountReference)
  ) {
    throw new Error('The TeleBirr payment prompt is unavailable.');
  }

  return [
    '💰 TeleBirr deposit',
    'Send 25–25,000 ETB to:',
    `👤 Name: ${input.receiverAccountHolderName}`,
    `📱 Number: ${localNumber ? toTelegramLocalReceiverNumber(input.receiverAccountReference) : input.receiverAccountReference}`,
    `🎮 KemerBet Player ID: ${input.playerId}`,
    PAYMENT_PROOF_INSTRUCTION_TEXT,
  ].join('\n');
}

export function buildTelegramTelebirrPaymentPrompt(
  input: TelegramTelebirrPaymentPromptInput,
): string {
  return renderTelegramTelebirrPaymentPrompt(input, true);
}

function renderTelegramCbeSmsPaymentPrompt(
  input: TelegramTelebirrPaymentPromptInput,
  localNumber: boolean,
): string {
  if (
    !validPlayerId(input.playerId) ||
    input.receiverAccountHolderName !== input.receiverAccountHolderName.trim() ||
    Array.from(input.receiverAccountHolderName).length < 2 ||
    Array.from(input.receiverAccountHolderName).length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(input.receiverAccountHolderName) ||
    !/^[0-9]{9,24}$/u.test(input.receiverAccountReference)
  )
    throw new Error('The CBE Birr payment prompt is unavailable.');
  return [
    '💳 CBE Birr deposit',
    'Send 25–25,000 ETB to:',
    `👤 Name: ${input.receiverAccountHolderName}`,
    `📱 Number: ${localNumber ? toTelegramLocalReceiverNumber(input.receiverAccountReference) : input.receiverAccountReference}`,
    `🎮 KemerBet Player ID: ${input.playerId}`,
    PAYMENT_PROOF_INSTRUCTION_TEXT,
  ].join('\n');
}

export function buildTelegramCbeSmsPaymentPrompt(
  input: TelegramTelebirrPaymentPromptInput,
): string {
  return renderTelegramCbeSmsPaymentPrompt(input, true);
}

export function isTelegramCbeSmsPaymentPromptReply(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as TelegramReplyMessageShape;
  if (message.from?.is_bot !== true || typeof message.text !== 'string') return false;
  const playerId = /(?:^|\n)🎮 KemerBet Player ID: ([^\s]+)(?:\n|$)/u.exec(message.text)?.[1];
  const holder = /(?:^|\n)👤 Name: ([^\r\n]+)(?:\n|$)/u.exec(message.text)?.[1];
  const reference = /(?:^|\n)📱 Number: ([0-9]{9,24})(?:\n|$)/u.exec(message.text)?.[1];
  if (!playerId || !holder || !reference) return false;
  try {
    const input = {
      playerId,
      receiverAccountHolderName: holder,
      receiverAccountReference: reference,
    };
    return [true, false].some((localNumber) => {
      const currentPrompt = renderTelegramCbeSmsPaymentPrompt(input, localNumber);
      const recentPrompt = currentPrompt.replace(
        PAYMENT_PROOF_INSTRUCTION_TEXT,
        RECENT_PAYMENT_PROOF_INSTRUCTION_TEXT,
      );
      const precedingPrompt = recentPrompt.replace(
        RECENT_PAYMENT_PROOF_INSTRUCTION_TEXT,
        'After paying, send the reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.\nThe reference identifies CBE Birr automatically.',
      );
      const olderPrompt = precedingPrompt.replace(
        '\nAfter paying,',
        '\nValid for 1 hour. Check the receiver name before paying.\nAfter paying,',
      );
      const previousPrompt = olderPrompt.replace(
        'After paying, send the reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.\nThe reference identifies CBE Birr automatically.',
        'After paying, reply with the transaction reference, SMS, receipt link, screenshot or PDF (max 5 MB).\nIf sending a reference separately, use /cbe followed by the reference.',
      );
      return (
        message.text === currentPrompt ||
        message.text === recentPrompt ||
        message.text ===
          recentPrompt.replace(
            '\nAfter paying,',
            '\nValid for 1 hour. Check the receiver name before paying.\nAfter paying,',
          ) ||
        message.text === precedingPrompt ||
        message.text === olderPrompt ||
        message.text === previousPrompt
      );
    });
  } catch {
    return false;
  }
}

/** Exact previous card stays recognizable while customers reply to already-issued instructions. */
function buildPriorTelegramTelebirrPaymentPrompt(
  input: TelegramTelebirrPaymentPromptInput,
): string {
  return [
    '💰 TeleBirr payment details',
    '',
    'Send money to:',
    `👤 Name: ${input.receiverAccountHolderName}`,
    `📱 Number: ${input.receiverAccountReference}`,
    '',
    `🎮 KemerBet Player ID: ${input.playerId}`,
    TELEBIRR_AMOUNT_TEXT,
    TELEBIRR_PRESENTATION_WINDOW_TEXT,
    '',
    'After paying, reply to this message with the TeleBirr transaction number.',
    CURRENT_TELEBIRR_PROOF_OPTIONS_TEXT,
    '',
    'Before sending, confirm the name shown in TeleBirr matches the name above.',
    'Tap /menu to cancel.',
  ].join('\n');
}

export function parseTelegramTelebirrPaymentPromptReply(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const message = value as TelegramReplyMessageShape;
  if (message.from?.is_bot !== true || typeof message.text !== 'string') return undefined;
  const match = /(?:^|\n)🎮 KemerBet Player ID: ([^\s]+)(?:\n|$)/u.exec(message.text);
  const playerId = match?.[1];
  if (!playerId || !validPlayerId(playerId)) return undefined;
  try {
    const holder = /(?:^|\n)👤 Name: ([^\r\n]+)(?:\n|$)/u.exec(message.text)?.[1];
    const reference = /(?:^|\n)📱 Number: ([0-9]{9,24})(?:\n|$)/u.exec(message.text)?.[1];
    if (!holder || !reference) return undefined;
    const input = {
      playerId,
      receiverAccountHolderName: holder,
      receiverAccountReference: reference,
    };
    const currentPrompts = [true, false].flatMap((localNumber) => {
      const currentPrompt = renderTelegramTelebirrPaymentPrompt(input, localNumber);
      const recentPrompt = currentPrompt.replace(
        PAYMENT_PROOF_INSTRUCTION_TEXT,
        RECENT_PAYMENT_PROOF_INSTRUCTION_TEXT,
      );
      const precedingPrompt = recentPrompt.replace(
        RECENT_PAYMENT_PROOF_INSTRUCTION_TEXT,
        'After paying, send the reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.',
      );
      return [
        currentPrompt,
        recentPrompt,
        recentPrompt.replace(
          '\nAfter paying,',
          '\nValid for 1 hour. Check the receiver name before paying.\nAfter paying,',
        ),
        precedingPrompt,
        precedingPrompt.replace(
          '\nAfter paying,',
          '\nValid for 1 hour. Check the receiver name before paying.\nAfter paying,',
        ),
      ];
    });
    const priorPrompt = buildPriorTelegramTelebirrPaymentPrompt({
      playerId,
      receiverAccountHolderName: holder,
      receiverAccountReference: reference,
    });
    const previousPilotPrompt = priorPrompt.replace(
      TELEBIRR_AMOUNT_TEXT,
      PREVIOUS_TELEBIRR_PILOT_AMOUNT_TEXT,
    );
    const legacyPrompt = priorPrompt.replace(
      TELEBIRR_PRESENTATION_WINDOW_TEXT,
      LEGACY_TELEBIRR_WINDOW_TEXT,
    );
    const previousWindowPrompt = priorPrompt.replace(
      TELEBIRR_PRESENTATION_WINDOW_TEXT,
      PREVIOUS_TELEBIRR_WINDOW_TEXT,
    );
    const previousMediaPrompt = priorPrompt.replace(
      CURRENT_TELEBIRR_PROOF_OPTIONS_TEXT,
      PREVIOUS_TELEBIRR_PROOF_OPTIONS_TEXT,
    );
    return currentPrompts.includes(message.text) ||
      message.text === priorPrompt ||
      message.text === previousPilotPrompt ||
      message.text === legacyPrompt ||
      message.text === previousWindowPrompt ||
      message.text === previousMediaPrompt ||
      message.text ===
        previousPilotPrompt.replace(
          CURRENT_TELEBIRR_PROOF_OPTIONS_TEXT,
          PREVIOUS_TELEBIRR_PROOF_OPTIONS_TEXT,
        ) ||
      message.text ===
        legacyPrompt.replace(
          CURRENT_TELEBIRR_PROOF_OPTIONS_TEXT,
          PREVIOUS_TELEBIRR_PROOF_OPTIONS_TEXT,
        )
      ? playerId
      : undefined;
  } catch {
    return undefined;
  }
}

export interface TelegramGuidedDepositInput {
  readonly playerId: string;
  readonly proofText: string;
}

const FORBIDDEN_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function validPlayerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    !/\s/u.test(value) &&
    !FORBIDDEN_CONTROL_PATTERN.test(value) &&
    Array.from(value).length > 0 &&
    Array.from(value).length <= TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS
  );
}

export function parseTelegramGuidedDepositPlayerInput(text: unknown): string | undefined {
  return validPlayerId(text) ? text : undefined;
}

/**
 * Parse the one reply requested by the guided prompt. No draft is stored in bot memory: the first
 * non-whitespace token is the Player ID and all remaining text is passed to the existing bounded,
 * candidate-only TeleBirr reducer.
 */
export function parseTelegramGuidedDepositInput(
  text: unknown,
): TelegramGuidedDepositInput | undefined {
  if (
    typeof text !== 'string' ||
    !isBoundedTelegramDepositProofText(text) ||
    FORBIDDEN_CONTROL_PATTERN.test(text)
  ) {
    return undefined;
  }

  const match = /^\s*([^\s]+)\s+([\s\S]*\S)\s*$/u.exec(text);
  const playerId = match?.[1];
  const proofText = match?.[2];
  if (
    !playerId ||
    !proofText ||
    Array.from(playerId).length > TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS
  ) {
    return undefined;
  }

  return { playerId, proofText };
}
