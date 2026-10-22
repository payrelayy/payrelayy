import { parseTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';

import {
  TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
  TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
  TELEGRAM_GUIDED_CBE_BUTTON_TEXT,
  TELEGRAM_GUIDED_CBE_CALLBACK_DATA,
} from './telegram-guided-deposit.js';

export interface PrivateTelegramMenuButton {
  readonly text: string;
  readonly callbackData: string;
}

export interface PrivateTelegramMenu {
  readonly text: string;
  readonly buttons: readonly PrivateTelegramMenuButton[];
}

/** Short, non-expiry menu used when an old payment card is removed. */
export function renderTelegramQuickMenu(receiverSmsCandidateEnabled = false): PrivateTelegramMenu {
  return {
    text: TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT,
    buttons: [
      {
        text: TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT,
        callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
      },
      ...(receiverSmsCandidateEnabled
        ? [
            {
              text: TELEGRAM_GUIDED_CBE_BUTTON_TEXT,
              callbackData: TELEGRAM_GUIDED_CBE_CALLBACK_DATA,
            },
          ]
        : []),
      { text: '🔄 Change Player ID', callbackData: TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA },
    ],
  };
}

/**
 * The privileged Player-ID action always uses the API-supplied opaque callback. The fixed deposit
 * callback below has no authority: it only opens a local reply prompt, and the completed input
 * still crosses the existing authenticated API and database boundary.
 */
export function renderPlayerRegistrationMenu(
  capabilityCallbackData: string,
  selectedPlayerId: string | null = null,
  playerValidationEnabled = false,
  receiverSmsCandidateEnabled = false,
): PrivateTelegramMenu {
  if (!parseTelegramPlayerRegistrationCapabilityCallback(capabilityCallbackData)) {
    throw new Error('The Player ID menu requires a valid opaque capability callback.');
  }

  return {
    text:
      selectedPlayerId === null
        ? `${TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT}\nSet a Player ID to deposit.`
        : `${TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT}\nPlayer ID: ${selectedPlayerId}`,
    buttons: [
      {
        text: TELEGRAM_GUIDED_TELEBIRR_BUTTON_TEXT,
        callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
      },
      ...(receiverSmsCandidateEnabled
        ? [
            {
              text: TELEGRAM_GUIDED_CBE_BUTTON_TEXT,
              callbackData: TELEGRAM_GUIDED_CBE_CALLBACK_DATA,
            },
          ]
        : []),
      {
        text: selectedPlayerId === null ? '🎮 Set Player ID' : '🔄 Change Player ID',
        callbackData: TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
      },
      ...(playerValidationEnabled
        ? []
        : [{ text: '➕ Request Player ID review', callbackData: capabilityCallbackData }]),
    ],
  };
}
