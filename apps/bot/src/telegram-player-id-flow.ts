import {
  formatTelegramDepositProofStatusCallback,
  formatTelegramDepositProofTrackingHandle,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { DEFAULT_LOCALE, message } from '@fetanagent/i18n';

import { renderPlayerRegistrationMenu, type PrivateTelegramMenu } from './private-menu.js';
import { buildTelegramTelebirrPaymentPrompt } from './telegram-guided-deposit.js';

export type TelegramPlayerIdFlowPresentation =
  | { readonly kind: 'menu'; readonly menu: PrivateTelegramMenu }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'force_reply'; readonly text: string; readonly placeholder: string };

export interface TelegramPlayerIdFlowContext {
  readonly selectedPlayerId?: string;
}

export const TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT =
  'I could not load that deposit status. Check the tracking reference in this private chat, or try again shortly.';

/**
 * Maps the API's deliberately small, non-sensitive result union to English-only Telegram copy.
 * Only the compact tracking handle is shown; raw database UUIDs, Player IDs and credentials are
 * excluded from customer text.
 */
export function presentTelegramPlayerIdFlowResult(
  result: TelegramPrivateActionResult,
  context: TelegramPlayerIdFlowContext = {},
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
    case 'telebirr_deposit_preview':
      return {
        kind: 'message',
        text: [
          '🔒 TeleBirr deposits are not live yet.',
          '',
          `Configured receiver: ${result.receiverAccountHolderName}`,
          `Wallet: ${result.receiverAccountMasked}`,
          '',
          'Do not send money yet. The complete wallet number will appear here when automatic processing is ready.',
          'Tap /menu to go back.',
        ].join('\n'),
      };
    case 'telebirr_deposit_destination': {
      if (!context.selectedPlayerId) throw new Error('The selected Player ID is unavailable.');
      return {
        kind: 'force_reply',
        text: buildTelegramTelebirrPaymentPrompt({
          playerId: context.selectedPlayerId,
          receiverAccountHolderName: result.receiverAccountHolderName,
          receiverAccountReference: result.receiverAccountReference,
        }),
        placeholder: 'TeleBirr transaction number',
      };
    }
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
          '✅ Transaction number received',
          'Status: Being checked',
          '',
          'Automatic credit is not live yet.',
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
    '💰 How to deposit',
    '',
    '1. Tap /menu, then 💰 Make a deposit.',
    '2. Send the KemerBet Player ID.',
    '3. FetanAgent will show the receiver name and wallet number when payments are live.',
    '4. After paying, reply with the TeleBirr transaction number, receipt link, or full SMS.',
    '',
    'Check an earlier request with /deposit_status and its tracking reference.',
    'Need help? Tap /support.',
  ].join('\n');
}

export function telegramDepositReferenceSelectionText(): string {
  return [
    'I found more than one TeleBirr transaction number. Nothing was submitted.',
    'Reply to the payment-details message with only the transaction number you want to use.',
  ].join('\n');
}

function formatMinorEtb(value: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) return 'invalid';
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}
