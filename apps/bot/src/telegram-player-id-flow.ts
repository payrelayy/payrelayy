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
    case 'deposit_instructions':
      return {
        kind: 'message',
        text: [
          `Dry-run CBE Birr deposit: ${formatMinorEtb(result.amountMinor)} ETB.`,
          `${result.customerInstruction}`,
          `Receiver: ${result.receiverAccountHolderName} (${result.receiverAccountMasked}).`,
          `Deadline: ${result.paymentDeadline}.`,
          `After paying, send /reference ${result.depositToken} TRANSACTION_REFERENCE.`,
          'This records intake only; payment verification and KemerBet execution remain disabled.',
        ].join('\n'),
      };
    case 'deposit_reference_received':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'depositReferenceReceived') };
    case 'deposit_input_invalid':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'depositInputInvalid') };
    case 'deposit_unavailable':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'depositUnavailable') };
    case 'invalid_player_id':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'invalidPlayerId') };
    case 'restart_required':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'playerActionRestart') };
    case 'menu_required':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'playerActionMenuRequired') };
  }
}

function formatMinorEtb(value: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) return 'invalid';
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}
