import { parseTelegramPlayerRegistrationCapabilityCallback } from '@payreplayy/contracts';
import { DEFAULT_LOCALE, message } from '@payreplayy/i18n';

export interface PrivateTelegramMenuButton {
  readonly text: string;
  readonly callbackData: string;
}

export interface PrivateTelegramMenu {
  readonly text: string;
  readonly buttons: readonly PrivateTelegramMenuButton[];
}

/**
 * The bot only renders an API-supplied opaque callback. It cannot mint a capability or attach an
 * arbitrary action string, and this renderer is intentionally not connected to a live handler.
 */
export function renderPlayerRegistrationMenu(capabilityCallbackData: string): PrivateTelegramMenu {
  if (!parseTelegramPlayerRegistrationCapabilityCallback(capabilityCallbackData)) {
    throw new Error('The Player ID menu requires a valid opaque capability callback.');
  }

  return {
    text: message(DEFAULT_LOCALE, 'playerRegistrationMenu'),
    buttons: [
      {
        text: message(DEFAULT_LOCALE, 'addKemerBetPlayerId'),
        callbackData: capabilityCallbackData,
      },
    ],
  };
}
