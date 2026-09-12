import { TELEGRAM_PRIVATE_ACTION_PLAYER_ID_MAX_CODE_POINTS } from '@fetanagent/contracts';

import { isBoundedTelegramDepositProofText } from './telegram-deposit-proof-input.js';

/**
 * This callback only opens a Telegram reply prompt. It carries no capability, customer data,
 * Player ID, payment reference, or authority to call the API.
 */
export const TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA = 'gd1.telebirr';

export const TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT = '💰 Deposit with TeleBirr';

export const TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT = [
  'What would you like to do?',
  '',
  'To deposit, tap 💰 Deposit with TeleBirr.',
  'The bot will ask for your KemerBet Player ID and TeleBirr transaction number.',
  'Automatic credit is not enabled yet.',
].join('\n');

export const TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT = [
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

export const TELEGRAM_GUIDED_DEPOSIT_INVALID_TEXT = [
  "I couldn't read those two details. Nothing was submitted.",
  'Reply to the TeleBirr deposit prompt with your KemerBet Player ID on the first line and one transaction number, receipt link, or SMS on the next line.',
  'Cancel anytime with /menu.',
].join('\n');

export const TELEGRAM_GUIDED_DEPOSIT_SELECTION_TEXT = [
  'I found more than one TeleBirr transaction number. Nothing was submitted.',
  'Reply again with your KemerBet Player ID on the first line and only the transaction number you want to use on the second line.',
  'Cancel anytime with /menu.',
].join('\n');

interface TelegramReplyMessageShape {
  readonly text?: unknown;
  readonly from?: { readonly is_bot?: unknown };
}

export function isTelegramGuidedDepositPromptReply(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as TelegramReplyMessageShape;
  return message.text === TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT && message.from?.is_bot === true;
}

export interface TelegramGuidedDepositInput {
  readonly playerId: string;
  readonly proofText: string;
}

const FORBIDDEN_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

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
