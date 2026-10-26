import { parseTelegramPlayerRegistrationCapabilityCallback } from '@fetanagent/contracts';

import {
  TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
  TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT,
  TELEGRAM_GUIDED_COMBINED_BUTTON_TEXT,
  TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA,
} from './telegram-guided-deposit.js';

export interface PrivateTelegramMenuButton {
  readonly text: string;
  readonly callbackData: string;
}

export interface PrivateTelegramMenu {
  readonly text: string;
  readonly buttons: readonly PrivateTelegramMenuButton[];
}

/** Action buttons accompany an outcome, without creating a separate menu message. */
export function renderTelegramOutcomeActions(): readonly PrivateTelegramMenuButton[] {
  return [
    {
      text: TELEGRAM_GUIDED_COMBINED_BUTTON_TEXT,
      callbackData: TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA,
    },
  ];
}

/**
 * Keep the API-issued capability structurally valid even though this compact menu opens the
 * existing free-text Player ID path. The fixed buttons have no payment authority; submitted
 * input still crosses the authenticated API and database boundary.
 */
export function renderPlayerRegistrationMenu(
  capabilityCallbackData: string,
  selectedPlayerId: string | null = null,
): PrivateTelegramMenu {
  if (!parseTelegramPlayerRegistrationCapabilityCallback(capabilityCallbackData)) {
    throw new Error('The Player ID menu requires a valid opaque capability callback.');
  }

  return {
    text:
      selectedPlayerId === null
        ? TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT
        : `${TELEGRAM_GUIDED_DEPOSIT_MENU_TEXT}\nPlayer ID: ${selectedPlayerId}`,
    buttons: [
      {
        text: selectedPlayerId === null ? '➕ Add Player ID' : TELEGRAM_GUIDED_COMBINED_BUTTON_TEXT,
        callbackData:
          selectedPlayerId === null
            ? TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA
            : TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA,
      },
    ],
  };
}
