import { setTimeout as delay } from 'node:timers/promises';

import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';

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
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function formatMinorEtb(amountMinor: string): string {
  const amount = BigInt(amountMinor);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}

/** Customer-safe copy: no full receipt reference, Player ID, or internal job state. */
export function presentTelegramDepositOutcome(delivery: Delivery): string {
  if (delivery.outcomeCode === 'checking') {
    return [
      '⏳ Still checking your TeleBirr payment',
      `Reference ending ${delivery.referenceMasked.slice(-4)} has not been verified or credited yet.`,
      'We’ll send the final result here. Please do not pay again.',
    ].join('\n');
  }
  if (delivery.outcomeCode === 'verified_waiting') {
    return [
      '✅ TeleBirr payment verified',
      `Transaction ending ${delivery.referenceMasked.slice(-4)} is waiting for Player credit.`,
      'No action needed. We’ll send the final result here.',
    ].join('\n');
  }
  if (delivery.outcomeCode === 'credited' && delivery.amountMinor !== null) {
    return [
      '✅ Deposit complete',
      `${formatMinorEtb(delivery.amountMinor)} ETB credited to the selected Player account.`,
      `Transaction ending ${delivery.referenceMasked.slice(-4)}.`,
    ].join('\n');
  }
  if (delivery.outcomeCode === 'already_used') {
    return [
      '⚠️ Reference already used',
      `This Telegram account already submitted the TeleBirr reference ending ${delivery.referenceMasked.slice(-4)} for a completed deposit.`,
      'No new Player credit was made. Do not pay again; contact support if this is unexpected.',
    ].join('\n');
  }
  if (delivery.outcomeCode === 'wrong_receiver') {
    return [
      '❌ Deposit rejected — wrong receiver',
      `The TeleBirr receipt ending ${delivery.referenceMasked.slice(-4)} names a different receiver. No Player credit was made.`,
      'If money left your wallet, do not pay again. Contact support with the reference.',
    ].join('\n');
  }
  if (delivery.outcomeCode === 'invalid_reference') {
    return [
      '❌ Invalid TeleBirr reference',
      `The official receipt page did not recognize the reference ending ${delivery.referenceMasked.slice(-4)}. No Player credit was made.`,
      'Check the reference. If money left your wallet, do not pay again—contact support.',
    ].join('\n');
  }
  if (delivery.outcomeCode === 'rejected') {
    return [
      '❌ Deposit not credited',
      `This submission (reference ending ${delivery.referenceMasked.slice(-4)}) did not credit the selected Player account.`,
      'If money left your wallet, do not pay again. Contact support with the reference.',
    ].join('\n');
  }
  if (delivery.outcomeCode === 'not_credited') {
    return [
      '⚠️ Deposit not credited',
      `This submission (reference ending ${delivery.referenceMasked.slice(-4)}) did not result in a Player credit.`,
      'If money left your wallet, do not pay again. Contact support with the reference.',
    ].join('\n');
  }
  return [
    '❌ Deposit not credited',
    `We couldn’t verify the TeleBirr reference ending ${delivery.referenceMasked.slice(-4)} within the allowed time. No Player credit was recorded for this submission.`,
    'Check the reference. If money left your wallet, do not pay again—contact support.',
  ].join('\n');
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
      pause = (await processOneTelegramDepositOutcome(dependencies)) === 'none' ? 10_000 : 0;
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
