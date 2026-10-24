import {
  formatTelegramDepositProofStatusCallback,
  formatTelegramDepositProofTrackingHandle,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { DEFAULT_LOCALE, message } from '@fetanagent/i18n';

import {
  TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT,
  TELEGRAM_PAYMENT_ALREADY_USED_TEXT,
  TELEGRAM_PAYMENT_RECEIVED_TEXT,
} from './telegram-customer-copy.js';
import { renderPlayerRegistrationMenu, type PrivateTelegramMenu } from './private-menu.js';
import {
  buildTelegramTelebirrPaymentPrompt,
  buildTelegramCbeSmsPaymentPrompt,
  buildTelegramCombinedPaymentPrompt,
  toTelegramLocalReceiverNumber,
  TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA,
  TELEGRAM_CHANGE_PLAYER_CALLBACK_DATA,
  TELEGRAM_GUIDED_DEPOSIT_PROMPT_TEXT,
} from './telegram-guided-deposit.js';

export type TelegramPlayerIdFlowPresentation =
  | { readonly kind: 'deferred' }
  | { readonly kind: 'menu'; readonly menu: PrivateTelegramMenu }
  | { readonly kind: 'message'; readonly text: string }
  | {
      readonly kind: 'force_reply';
      readonly text: string;
      readonly placeholder: string;
    };

export interface TelegramPlayerIdFlowContext {
  readonly selectedPlayerId?: string;
  readonly playerValidationEnabled?: boolean;
  readonly receiverSmsCandidateEnabled?: boolean;
}

export const TELEGRAM_DEPOSIT_STATUS_UNAVAILABLE_TEXT =
  'Deposit status is unavailable. Please try again shortly.';

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
        text: '🔎 Checking your Player ID. We’ll update you here.',
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
            { text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA },
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
          'TeleBirr deposits are unavailable right now.',
          'Do not send money to this receiver yet.',
        ].join('\n'),
      };
    case 'combined_deposit_destination':
      return {
        kind: 'force_reply',
        text: buildTelegramCombinedPaymentPrompt({
          playerId: result.selectedPlayerId,
          receivers: result.receivers,
        }),
        placeholder: 'Payment reference or receipt',
      };
    case 'telebirr_deposit_destination_review': {
      const selectedPlayerId = context.selectedPlayerId ?? result.selectedPlayerId;
      if (!selectedPlayerId) throw new Error('The selected Player ID is unavailable.');
      return {
        kind: 'message',
        text: [
          'TeleBirr receiver preview',
          `Name: ${result.receiverAccountHolderName}`,
          `Number: ${toTelegramLocalReceiverNumber(result.receiverAccountReference)}`,
          `Player ID: ${selectedPlayerId}`,
          'Do not send money yet. Deposits are unavailable from this screen.',
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
    case 'cbe_sms_deposit_destination':
      return {
        kind: 'force_reply',
        text: buildTelegramCbeSmsPaymentPrompt({
          playerId: result.selectedPlayerId,
          receiverAccountHolderName: result.receiverAccountHolderName,
          receiverAccountReference: result.receiverAccountReference,
        }),
        placeholder: 'CBE Birr transaction reference',
      };
    case 'deposit_instructions':
      return {
        kind: 'message',
        text:
          result.financialMode === 'live'
            ? [
                '💳 CBE Birr deposit',
                `Amount: ${formatMinorEtb(result.amountMinor)} ETB`,
                `Receiver: ${result.receiverAccountHolderName} (${result.receiverAccountMasked})`,
                result.customerInstruction,
                `Pay by: ${result.paymentDeadline}`,
                `After paying: /reference ${result.depositToken} YOUR_REFERENCE`,
                `Status: /deposit_status ${result.depositToken}`,
              ].join('\n')
            : [
                '🧪 Test only — do not send money.',
                `Amount: ${formatMinorEtb(result.amountMinor)} ETB`,
                `Test reference: /reference ${result.depositToken} TEST_REFERENCE`,
                'No payment or Player credit will be made.',
              ].join('\n'),
      };
    case 'cbe_birr_dry_run_instruction_preview': {
      const playerId = context.selectedPlayerId;
      if (!playerId) throw new Error('The staging Player ID is unavailable.');
      return {
        kind: 'message',
        text: [
          '🧪 CBE Birr test only — do not send money.',
          `To test: /cbe_test_proof ${result.instructionToken} ${playerId} SYNTHCBE0001`,
          'No Player credit will be made.',
        ].join('\n'),
      };
    }
    case 'deposit_reference_received':
      return {
        kind: 'message',
        text:
          result.financialMode === 'live'
            ? TELEGRAM_PAYMENT_RECEIVED_TEXT
            : '🧪 Test reference received. No Player credit will be made.',
      };
    case 'deposit_proof_received':
    case 'deposit_proof_status':
      return {
        kind: 'menu',
        menu: {
          text: [
            '🧪 Test reference received. No Player credit will be made.',
            `Status: /deposit_status ${formatTelegramDepositProofTrackingHandle(result.proofToken)}`,
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
        text: '🧪 Test reference received. No Player credit will be made.',
      };
    case 'telebirr_routine_candidate_recorded_no_money':
      return {
        kind: 'message',
        text: '🧪 Test reference received. No payment was verified or credited. Do not send money.',
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
          text: TELEGRAM_PAYMENT_ALREADY_USED_TEXT,
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
        text: TELEGRAM_PAYMENT_RECEIVED_TEXT,
      };
    case 'telebirr_routine_candidate_already_used':
      return {
        kind: 'menu',
        menu: {
          text: TELEGRAM_PAYMENT_ALREADY_USED_TEXT,
          buttons: [{ text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA }],
        },
      };
    case 'telebirr_live_verification_queued':
      return {
        kind: 'menu',
        menu: {
          text: [
            TELEGRAM_PAYMENT_RECEIVED_TEXT,
            `Status: /deposit_status ${formatTelegramDepositProofTrackingHandle(result.proofToken)}`,
          ].join('\n'),
          buttons: [
            {
              text: 'Check status',
              callbackData: formatTelegramDepositProofStatusCallback(result.proofToken),
            },
            { text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA },
          ],
        },
      };
    case 'telebirr_live_deposit_status':
      return {
        kind: 'menu',
        menu: {
          text: [
            '💰 Deposit',
            `Status: ${result.depositStatus.label}`,
            ...(result.amountMinor === null
              ? []
              : [`Amount: ${formatMinorEtb(result.amountMinor)} ETB`]),
          ].join('\n'),
          buttons: [
            {
              text: 'Refresh status',
              callbackData: formatTelegramDepositProofStatusCallback(result.proofToken),
            },
            { text: '💰 Deposit', callbackData: TELEGRAM_GUIDED_COMBINED_CALLBACK_DATA },
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
      'Tap Deposit for payment details.',
      'After paying, send your reference, SMS, receipt link, screenshot or PDF here.',
      'Help: /support.',
    ].join('\n');
  }
  return [
    '💰 TeleBirr deposits',
    'Tap Deposit for payment details.',
    'After paying, send your reference, SMS, receipt link, screenshot or PDF here.',
    'Help: /support.',
  ].join('\n');
}

export function telegramDepositReferenceSelectionText(
  _receiverSmsCandidateEnabled = false,
): string {
  return TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT;
}

function formatMinorEtb(value: string): string {
  if (!/^[1-9][0-9]*$/u.test(value)) return 'invalid';
  const minor = BigInt(value);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}
