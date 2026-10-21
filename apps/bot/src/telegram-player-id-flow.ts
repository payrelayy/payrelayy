import {
  formatTelegramDepositProofStatusCallback,
  formatTelegramDepositProofTrackingHandle,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { DEFAULT_LOCALE, message } from '@fetanagent/i18n';

import { renderPlayerRegistrationMenu, type PrivateTelegramMenu } from './private-menu.js';
import {
  buildTelegramTelebirrPaymentPrompt,
  TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
  TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
  TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA,
} from './telegram-guided-deposit.js';

export type TelegramPlayerIdFlowPresentation =
  | { readonly kind: 'deferred' }
  | { readonly kind: 'menu'; readonly menu: PrivateTelegramMenu }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'force_reply'; readonly text: string; readonly placeholder: string };

export interface TelegramPlayerIdFlowContext {
  readonly selectedPlayerId?: string;
  readonly playerValidationEnabled?: boolean;
  readonly receiverSmsCandidateEnabled?: boolean;
}

export const TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT =
  'I could not load that deposit status. Check the tracking reference in this private chat, or try again shortly.';

/**
 * Maps the API's deliberately small, non-sensitive result union to English-only Telegram copy.
 * Only the compact tracking handle is shown for payment state. The customer's selected Player ID
 * may be echoed in their private chat; raw database UUIDs and credentials are excluded.
 */
export function presentTelegramPlayerIdFlowResult(
  result: TelegramPrivateActionResult,
  context: TelegramPlayerIdFlowContext = {},
): TelegramPlayerIdFlowPresentation {
  switch (result.outcome) {
    case 'deposit_outcome_none':
    case 'deposit_outcome_delivery':
    case 'deposit_outcome_completed':
    case 'player_validation_outcome_none':
    case 'player_validation_outcome_delivery':
    case 'player_validation_outcome_completed':
    case 'deposit_temporary_recorded':
    case 'deposit_temporary_cancelled':
    case 'deposit_temporary_cleanup_none':
    case 'deposit_temporary_cleanup_delivery':
    case 'deposit_temporary_cleanup_completed':
    case 'payment_instruction_recorded':
    case 'payment_instruction_expiry_none':
    case 'payment_instruction_expiry_delivery':
    case 'payment_instruction_expiry_completed':
      throw new Error(
        'A bot-only notification operation cannot be presented as a customer action.',
      );
    case 'player_validation_queued':
      return {
        kind: 'message',
        text: '🔎 Checking your Player ID. We’ll confirm it here. Your saved ID stays unchanged until verified.',
      };
    case 'menu':
      return {
        kind: 'menu',
        menu: renderPlayerRegistrationMenu(
          result.callbackData,
          result.selectedPlayerId,
          context.playerValidationEnabled,
        ),
      };
    case 'player_selection_missing':
      return {
        kind: 'force_reply',
        text: TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
        placeholder: 'KemerBet Player ID',
      };
    case 'player_selection_saved':
      return {
        kind: 'menu',
        menu: {
          text: `✅ Player ID ${result.playerId} saved.`,
          buttons: [
            { text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA },
            { text: '🔄 Change Player ID', callbackData: TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA },
          ],
        },
      };
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
    case 'telebirr_deposit_destination_review': {
      const selectedPlayerId = context.selectedPlayerId ?? result.selectedPlayerId;
      if (!selectedPlayerId) throw new Error('The selected Player ID is unavailable.');
      return {
        kind: 'message',
        text: [
          '🔎 TeleBirr receiver — review only',
          '',
          'Receiver:',
          `👤 Name: ${result.receiverAccountHolderName}`,
          `📱 Number: ${result.receiverAccountReference}`,
          '',
          `🎮 KemerBet Player ID: ${selectedPlayerId}`,
          '💵 Amount: 25 ETB',
          '',
          'NO PAYMENT YET.',
          'This screen is information only and cannot accept payment proof.',
          'Tap /menu to cancel.',
        ].join('\n'),
      };
    }
    case 'telebirr_deposit_destination': {
      const selectedPlayerId = context.selectedPlayerId ?? result.selectedPlayerId;
      if (!selectedPlayerId) throw new Error('The selected Player ID is unavailable.');
      return {
        kind: 'force_reply',
        text: buildTelegramTelebirrPaymentPrompt({
          playerId: selectedPlayerId,
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
    case 'cbe_birr_dry_run_instruction_preview': {
      const playerId = context.selectedPlayerId;
      if (!playerId) throw new Error('The staging Player ID is unavailable.');
      return {
        kind: 'message',
        text: [
          '🧪 CBE Birr test only — do not send money.',
          `Test instruction expires: ${result.expiresAt}.`,
          'No payment receiver is shown or enabled.',
          `To test a synthetic proof, send /cbe_test_proof ${result.instructionToken} ${playerId} SYNTHCBE0001.`,
          'No receipt lookup or Player credit will occur.',
        ].join('\n'),
      };
    }
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
    case 'telebirr_routine_candidate_recorded_no_money':
      return {
        kind: 'message',
        text: [
          '🧪 Simulation only — test transaction number recorded.',
          'No payment was checked or verified. No KemerBet deposit or credit will be made.',
          'Do not send money. This is not a payment-status confirmation.',
        ].join('\n'),
      };
    case 'telebirr_routine_candidate_recorded_paid_pending':
      // The signed phone result normally arrives quickly. A permanent acknowledgment
      // here would give an invalid reference two bot messages before its final result.
      // The outcome notifier sends one definitive message, or a delayed checking notice
      // if the phone/provider remains unavailable.
      return { kind: 'deferred' };
    case 'receiver_sms_candidate_received':
      if (result.matchStatus === 'already_used') {
        return {
          kind: 'message',
          text: 'Deposit not credited. Reason: payment already used. Contact support if this is unexpected.',
        };
      }
      if (result.matchStatus === 'older_review') {
        // The database has already queued the durable Owner-review notice.
        return { kind: 'deferred' };
      }
      if (result.matchStatus === 'held_review') {
        // The notifier owns the one customer-visible held result and its retries.
        return { kind: 'deferred' };
      }
      return {
        kind: 'message',
        text: `${result.providerName} reference received. Checking against the receiving phone SMS. Please do not pay again.`,
      };
    case 'telebirr_routine_candidate_already_used':
      return {
        kind: 'menu',
        menu: {
          text: [
            '⚠️ Reference already used.',
            'This Telegram account already used it for a completed deposit. No new Player credit was made.',
            'Do not pay again. Contact support if this is unexpected.',
          ].join('\n'),
          buttons: [{ text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA }],
        },
      };
    case 'telebirr_live_verification_queued':
      return {
        kind: 'menu',
        menu: {
          text: [
            '✅ Transaction number received',
            `Status: ${result.depositStatus.label}`,
            '',
            `Tracking reference: ${formatTelegramDepositProofTrackingHandle(result.proofToken)}`,
            'FetanAgent will verify the payment and prepare the KemerBet deposit automatically.',
          ].join('\n'),
          buttons: [
            {
              text: 'Check status',
              callbackData: formatTelegramDepositProofStatusCallback(result.proofToken),
            },
            { text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA },
          ],
        },
      };
    case 'telebirr_live_deposit_status':
      return {
        kind: 'menu',
        menu: {
          text: [
            '💳 TeleBirr deposit',
            `Status: ${result.depositStatus.label}`,
            ...(result.amountMinor === null
              ? []
              : [`Amount: ${formatMinorEtb(result.amountMinor)} ETB`]),
            '',
            `Tracking reference: ${formatTelegramDepositProofTrackingHandle(result.proofToken)}`,
          ].join('\n'),
          buttons: [
            {
              text: 'Refresh status',
              callbackData: formatTelegramDepositProofStatusCallback(result.proofToken),
            },
            { text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_TELEBIRR_CALLBACK_DATA },
          ],
        },
      };
    case 'deposit_status':
      return {
        kind: 'message',
        text: `Deposit ${formatMinorEtb(result.amountMinor)} ETB — ${result.depositStatus.label}.`,
      };
    case 'deposit_input_invalid':
      return {
        kind: 'message',
        text: telegramDepositHelpText(context.receiverSmsCandidateEnabled),
      };
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

export function telegramDepositHelpText(receiverSmsCandidateEnabled = false): string {
  if (receiverSmsCandidateEnabled) {
    return [
      '💰 Deposits',
      'Save a Player ID once in /menu, then tap Deposit for the current receiver.',
      'After paying, send one reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.',
      'A bare reference is treated as TeleBirr. For CBE Birr, send /cbe followed by the reference, or send the CBE Birr SMS or receipt.',
      'The receiving phone SMS supplies the amount. Status: /deposit_status. Help: /support.',
    ].join('\n');
  }
  return [
    '💰 TeleBirr deposit',
    'Save a Player ID once in /menu, then tap Deposit for the current receiver.',
    'After paying, send your reference, SMS, receipt link, screenshot or PDF (max 5 MB) here.',
    'A direct reference is treated as TeleBirr. CBE Birr is not live yet.',
    'Status: /deposit_status with your tracking code. Help: /support.',
  ].join('\n');
}

export function telegramDepositReferenceSelectionText(): string {
  return [
    'I found more than one TeleBirr reference. Nothing was submitted.',
    'Send one reference only.',
  ].join('\n');
}

function formatMinorEtb(value: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) return 'invalid';
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}
