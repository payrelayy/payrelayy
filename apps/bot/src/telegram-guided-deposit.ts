import { TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS } from '@fetanagent/contracts';

import { isBoundedTelegramDepositProofText } from './telegram-deposit-proof-input.js';

/**
 * This callback only opens a Telegram reply prompt. It carries no capability, customer data,
 * Player ID, payment reference, or authority to call the API.
 */
export const TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA = 'gd1.telebirr';

export const TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT = '💰 Make a deposit';

export const TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT = [
  'Welcome to FetanAgent 👋',
  '',
  'Deposit from TeleBirr to KemerBet in a few simple steps.',
  'Choose an option below.',
].join('\n');

/** First step of the current deposit wizard. */
export const TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT = [
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

export const TELEGRAM_GUIDED_DEPOSIT_PLAYER_INVALID_TEXT = [
  "I couldn't read that Player ID.",
  'Reply to the deposit question with the KemerBet Player ID only.',
  'Tap /menu to cancel.',
].join('\n');

export const TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT = [
  "I couldn't find one TeleBirr transaction number. Nothing was submitted.",
  'Reply to the payment-details message with the transaction number, receipt link, or full SMS.',
  'Tap /menu to cancel.',
].join('\n');

export const TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT = [
  'I found more than one TeleBirr transaction number. Nothing was submitted.',
  'Reply again with only the transaction number you want to use.',
  'Tap /menu to cancel.',
].join('\n');

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
  return message.text === TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT && message.from?.is_bot === true;
}

export interface TelegramTelebirrPaymentPromptInput {
  readonly playerId: string;
  readonly receiverAccountHolderName: string;
  readonly receiverAccountReference: string;
}

export function buildTelegramTelebirrPaymentPrompt(
  input: TelegramTelebirrPaymentPromptInput,
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
    '💰 TeleBirr payment details',
    '',
    'Send money to:',
    `👤 Name: ${input.receiverAccountHolderName}`,
    `📱 Number: ${input.receiverAccountReference}`,
    '',
    `🎮 KemerBet Player ID: ${input.playerId}`,
    'Amount: choose 25–25,000 ETB in TeleBirr.',
    'These payment details are valid for 10 minutes.',
    '',
    'After paying, reply to this message with the TeleBirr transaction number.',
    'You can also paste the receipt link or full SMS.',
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
    return buildTelegramTelebirrPaymentPrompt({
      playerId,
      receiverAccountHolderName: holder,
      receiverAccountReference: reference,
    }) === message.text
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
