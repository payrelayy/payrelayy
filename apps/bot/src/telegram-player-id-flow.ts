import type { TelegramPrivateActionResult } from '@fetanagent/contracts';
import { DEFAULT_LOCALE, message } from '@fetanagent/i18n';

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
    case 'player_id_exists':
      return { kind: 'message', text: message(DEFAULT_LOCALE, 'playerIdExists') };
    case 'deposit_instructions':
      return {
        kind: 'message',
        text:
          result.financialMode === 'live'
            ? [
                `CBE Birr deposit: ${formatMinorEtb(result.amountMinor)} ETB.`,
                `Status: ${result.depositStatus.label}.`,
                result.customerInstruction,
                `Receiver: ${result.receiverAccountHolderName} (${result.receiverAccountMasked}).`,
                `Payment deadline: ${result.paymentDeadline}.`,
                `After paying, send /reference ${result.depositToken} YOUR_TRANSACTION_REFERENCE.`,
                `Check progress with /deposit_status ${result.depositToken}.`,
              ].join('\n')
            : [
                'SIMULATION ONLY — DO NOT SEND MONEY.',
                `Dry-run CBE Birr deposit simulation: ${formatMinorEtb(result.amountMinor)} ETB.`,
                `Status: ${result.depositStatus.label}.`,
                `Test instruction: ${result.customerInstruction}`,
                `Synthetic receiver: ${result.receiverAccountHolderName} (${result.receiverAccountMasked}).`,
                `Test deadline: ${result.paymentDeadline}.`,
                `To test protected reference capture, send /reference ${result.depositToken} TEST_REFERENCE.`,
                'No payment is verified or executed in this simulation.',
              ].join('\n'),
      };
    case 'deposit_reference_received':
      return {
        kind: 'message',
        text:
          result.financialMode === 'live'
            ? `Reference received. Status: ${result.depositStatus.label}.`
            : `Simulation reference received. Status: ${result.depositStatus.label}.`,
      };
    case 'deposit_proof_received':
      return {
        kind: 'message',
        text: [
          'SIMULATION ONLY — proof received.',
          `Provider: ${result.providerName}.`,
          'No payment was verified or credited.',
        ].join('\n'),
      };
    case 'deposit_status':
      return {
        kind: 'message',
        text: `Deposit ${formatMinorEtb(result.amountMinor)} ETB — ${result.depositStatus.label}.`,
      };
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
