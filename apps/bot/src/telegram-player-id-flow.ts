import {
  formatTelegramDepositProofStatusCallback,
  formatTelegramDepositProofTrackingHandle,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { DEFAULT_LOCALE, message } from '@fetanagent/i18n';

import { renderPlayerRegistrationMenu, type PrivateTelegramMenu } from './private-menu.js';

export type TelegramPlayerIdFlowPresentation =
  | { readonly kind: 'menu'; readonly menu: PrivateTelegramMenu }
  | { readonly kind: 'message'; readonly text: string };

export const TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT =
  'I could not load that deposit status. Check the tracking reference in this private chat, or try again shortly.';

/**
 * Maps the API's deliberately small, non-sensitive result union to English-only Telegram copy.
 * Only the compact tracking handle is shown; raw database UUIDs, Player IDs and credentials are
 * excluded from customer text.
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
    case 'deposit_proof_status':
      return {
        kind: 'menu',
        menu: {
          text: [
            '✅ Reference received.',
            `Payment method: ${result.providerName}.`,
            `Tracking reference: ${formatTelegramDepositProofTrackingHandle(result.proofToken)}`,
            `To check it later, send /deposit_status ${formatTelegramDepositProofTrackingHandle(result.proofToken)}`,
            'Automatic credit and money movement are not enabled yet.',
          ].join('\n'),
          buttons: [
            {
              text: 'Check status',
              callbackData: formatTelegramDepositProofStatusCallback(result.proofToken),
            },
          ],
        },
      };
    case 'telebirr_shadow_verification_queued':
      return {
        kind: 'message',
        text: [
          '✅ Reference received.',
          'FetanAgent is checking it.',
          'Automatic credit and money movement are not enabled yet.',
        ].join('\n'),
      };
    case 'deposit_status':
      return {
        kind: 'message',
        text: `Deposit ${formatMinorEtb(result.amountMinor)} ETB — ${result.depositStatus.label}.`,
      };
    case 'deposit_input_invalid':
      return { kind: 'message', text: telegramDepositHelpText() };
    case 'deposit_status_unavailable':
      return {
        kind: 'message',
        text: TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT,
      };
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

export function telegramDepositHelpText(): string {
  return [
    'TeleBirr deposit:',
    '1. Send /menu.',
    '2. Tap 💰 Deposit with TeleBirr.',
    '3. Reply with your KemerBet Player ID on the first line and your TeleBirr transaction number on the second line.',
    'You may paste a TeleBirr receipt link or the full SMS instead of the transaction number.',
    'To check a previous request, send /deposit_status followed by its p1. tracking reference.',
    'Use a reference from a transfer you already made. Do not make a new transfer for this step.',
    'Automatic credit and money movement are not enabled yet.',
    'Need account help? Use /support.',
  ].join('\n');
}

export function telegramDepositReferenceSelectionText(): string {
  return [
    'I found more than one TeleBirr transaction number. Nothing was submitted.',
    'Send /deposit, then reply with your KemerBet Player ID on the first line and only the transaction number you want to use on the second line.',
  ].join('\n');
}

function formatMinorEtb(value: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) return 'invalid';
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}
