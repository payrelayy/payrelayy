import type { TelegramPrivateActionResult } from '@payreplayy/contracts';
import { DEFAULT_LOCALE, message } from '@payreplayy/i18n';

import { renderPlayerRegistrationMenu, type PrivateTelegramMenu } from './private-menu.js';

export type TelegramPlayerIdFlowPresentation =
  | { readonly kind: 'menu'; readonly menu: PrivateTelegramMenu }
  | { readonly kind: 'message'; readonly text: string };

/**
 * Maps the API's deliberately small, non-sensitive result union to English-only Telegram copy.
 * No database identifier, Player ID, or capability value is interpolated into customer text.
 */
export function presentTelegramPlayerIdFlowResult(
  result: TelegramPrivateActionResult,
): TelegramPlayerIdFlowPresentation {
  switch (result.outcome) {
    case 'menu':
      return { kind: 'menu', menu: renderPlayerRegistrationMenu(result.callbackData) };
    case 'awaiting_player_id':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'enterKemerBetPlayerId') };
    case 'player_id_pending':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'playerIdPending') };
    case 'invalid_player_id':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'invalidPlayerId') };
    case 'restart_required':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'playerActionRestart') };
    case 'menu_required':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'playerActionMenuRequired') };
  }
}
