import { setTimeout as delay } from 'node:timers/promises';

import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import {
  TELEGRAM_PAYMENT_ALREADY_USED_TEXT,
  TELEGRAM_PAYMENT_NEEDS_REVIEW_TEXT,
} from './telegram-customer-copy.js';
import { processOneTelegramPaymentInstructionExpiry } from './telegram-payment-instruction-expiry.js';
import { processOneTelegramPlayerValidationOutcome } from './telegram-player-validation-notifier.js';

type Delivery = Extract<
  TelegramPrivateActionResult,
  { readonly outcome: 'deposit_outcome_delivery' }
>;

export interface TelegramDepositOutcomeNotifierDependencies {
  readonly request: (action: TelegramPrivateActionEnvelope) => Promise<TelegramPrivateActionResult>;
  readonly send: (
    privateChatId: number,
    text: string,
    showDepositButton: boolean,
  ) => Promise<{ readonly message_id: number }>;
  readonly delete: (privateChatId: number, messageId: number) => Promise<boolean>;
  readonly sendMenu?: (privateChatId: number) => Promise<unknown>;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function formatMinorEtb(amountMinor: string): string {
  const amount = BigInt(amountMinor);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}

/** Customer-safe copy: no full receipt reference, Player ID, or internal job state. */
export function presentTelegramDepositOutcome(delivery: Delivery): string {
  if (delivery.outcomeCode === 'checking') {
    return '⏳ Still checking your payment. We’ll update you here.';
  }
  if (delivery.outcomeCode === 'verified_waiting') {
    return '✅ Payment confirmed. Finishing your deposit.';
  }
  if (delivery.outcomeCode === 'credited' && delivery.amountMinor !== null) {
    return [
      '✅ Deposit complete',
      `${formatMinorEtb(delivery.amountMinor)} ETB credited to your Player account.`,
    ].join('\n');
  }
  if (delivery.outcomeCode === 'already_used') {
    return TELEGRAM_PAYMENT_ALREADY_USED_TEXT;
  }
  if (delivery.outcomeCode === 'wrong_receiver') {
    return 'Deposit not credited. Payment went to a different receiver. Contact support.';
  }
  if (delivery.outcomeCode === 'invalid_reference') {
    return 'Deposit not credited. Check the reference or contact support.';
  }
  if (delivery.outcomeCode === 'unrelated_receipt') {
    return 'Deposit not credited. This receipt does not match. Contact support.';
  }
  if (delivery.outcomeCode === 'held_review') {
    return TELEGRAM_PAYMENT_NEEDS_REVIEW_TEXT;
  }
  if (delivery.outcomeCode === 'older_pending') {
    return TELEGRAM_PAYMENT_NEEDS_REVIEW_TEXT;
  }
  if (delivery.outcomeCode === 'old_rejected') {
    return 'Deposit not credited. This payment is too old. Contact support.';
  }
  if (delivery.outcomeCode === 'manual_review') {
    return TELEGRAM_PAYMENT_NEEDS_REVIEW_TEXT;
  }
  if (delivery.outcomeCode === 'rejected') {
    return '❌ Deposit not credited. Contact support if you need help.';
  }
  if (delivery.outcomeCode === 'not_credited') {
    return '⚠️ We couldn’t confirm your deposit. Contact support.';
  }
  return '❌ Deposit not credited. Check the reference or contact support.';
}

function telegramErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('error_code' in error)) return undefined;
  const code = error.error_code;
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : undefined;
}

async function complete(
  dependencies: TelegramDepositOutcomeNotifierDependencies,
  delivery: Delivery,
  result: 'sent' | 'retry' | 'unavailable',
  messageId: number | null,
): Promise<void> {
  const action: TelegramPrivateActionEnvelope = {
    version: 1,
    kind: 'deposit_outcome_complete',
    notificationId: delivery.notificationId,
    leaseToken: delivery.leaseToken,
    deliveryResult: result,
    telegramMessageId: messageId,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await dependencies.request(action);
      if (response.outcome !== 'deposit_outcome_completed' || !response.accepted) {
        throw new Error('The Telegram deposit outcome acknowledgement was not accepted.');
      }
      return;
    } catch {
      if (attempt === 1) throw new Error('The Telegram deposit outcome acknowledgement failed.');
    }
  }
}

/** A single claim can produce at most one Telegram send; an ambiguous ACK may later repeat it. */
export async function processOneTelegramDepositOutcome(
  dependencies: TelegramDepositOutcomeNotifierDependencies,
): Promise<'none' | 'processed'> {
  const claimed = await dependencies.request({ version: 1, kind: 'deposit_outcome_claim' });
  if (claimed.outcome === 'deposit_outcome_none') return 'none';
  if (claimed.outcome !== 'deposit_outcome_delivery') {
    throw new Error('Unexpected Telegram deposit outcome response.');
  }
  let result: 'sent' | 'retry' | 'unavailable' = 'retry';
  let messageId: number | null = null;
  try {
    const sent = await dependencies.send(
      Number(claimed.privateChatId),
      presentTelegramDepositOutcome(claimed),
      claimed.outcomeCode !== 'checking' && claimed.outcomeCode !== 'verified_waiting',
    );
    if (!Number.isSafeInteger(sent.message_id) || sent.message_id <= 0) {
      throw new Error('Telegram returned no valid message ID.');
    }
    result = 'sent';
    messageId = sent.message_id;
  } catch (error) {
    // A customer blocking the bot cannot be retried; transient Telegram/network failures can.
    result = telegramErrorCode(error) === 403 ? 'unavailable' : 'retry';
  }
  await complete(dependencies, claimed, result, messageId);
  return 'processed';
}

/** Cleanup runs only after the database observes a sent status or a cancelled intake. */
export async function processOneTelegramDepositTemporaryCleanup(
  dependencies: TelegramDepositOutcomeNotifierDependencies,
): Promise<'none' | 'processed'> {
  const claimed = await dependencies.request({
    version: 1,
    kind: 'deposit_temporary_cleanup_claim',
  });
  if (claimed.outcome === 'deposit_temporary_cleanup_none') return 'none';
  if (claimed.outcome !== 'deposit_temporary_cleanup_delivery') {
    throw new Error('Unexpected Telegram temporary cleanup response.');
  }
  let deletionResult: 'deleted' | 'retry' | 'unavailable' = 'retry';
  try {
    if (await dependencies.delete(Number(claimed.privateChatId), claimed.telegramMessageId)) {
      deletionResult = 'deleted';
    }
  } catch (error) {
    deletionResult = [400, 403].includes(telegramErrorCode(error) ?? 0) ? 'unavailable' : 'retry';
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const completed = await dependencies.request({
        version: 1,
        kind: 'deposit_temporary_cleanup_complete',
        updateId: claimed.updateId,
        leaseToken: claimed.leaseToken,
        deletionResult,
      });
      if (completed.outcome !== 'deposit_temporary_cleanup_completed' || !completed.accepted) {
        throw new Error('Telegram temporary cleanup completion was not accepted.');
      }
      return 'processed';
    } catch {
      if (attempt === 1) throw new Error('Telegram temporary cleanup completion failed.');
    }
  }
  return 'processed';
}

export async function runTelegramDepositOutcomeNotifier(
  dependencies: TelegramDepositOutcomeNotifierDependencies,
  signal: AbortSignal,
): Promise<void> {
  const sleep =
    dependencies.sleep ??
    (async (milliseconds, waitSignal) => {
      await delay(milliseconds, undefined, { signal: waitSignal });
    });
  while (!signal.aborted) {
    let pause = 0;
    try {
      const outcome = await processOneTelegramDepositOutcome(dependencies);
      const playerValidation = await processOneTelegramPlayerValidationOutcome(dependencies);
      const cleanup = await processOneTelegramDepositTemporaryCleanup(dependencies);
      const instruction = dependencies.sendMenu
        ? await processOneTelegramPaymentInstructionExpiry({
            request: dependencies.request,
            delete: dependencies.delete,
            sendMenu: dependencies.sendMenu,
          })
        : 'none';
      pause =
        outcome === 'none' &&
        playerValidation === 'none' &&
        cleanup === 'none' &&
        instruction === 'none'
          ? 10_000
          : 0;
    } catch {
      console.warn('Telegram deposit outcome delivery is temporarily unavailable.');
      pause = 5_000;
    }
    if (pause > 0 && !signal.aborted) {
      try {
        await sleep(pause, signal);
      } catch {
        /* shutdown */
      }
    }
  }
}
