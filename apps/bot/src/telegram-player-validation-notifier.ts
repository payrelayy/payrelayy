import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';

type Delivery = Extract<
  TelegramPrivateActionResult,
  { readonly outcome: 'player_validation_outcome_delivery' }
>;

export interface TelegramPlayerValidationNotifierDependencies {
  readonly request: (action: TelegramPrivateActionEnvelope) => Promise<TelegramPrivateActionResult>;
  readonly send: (
    privateChatId: number,
    text: string,
    showDepositButton: boolean,
  ) => Promise<{ readonly message_id: number }>;
}

/** No raw Player ID or ownership claim appears in a background notification. */
export function presentTelegramPlayerValidationOutcome(delivery: Delivery): string {
  if (delivery.outcomeCode === 'selected') {
    return '✅ Player ID verified and saved. You can now deposit. Check Menu for your current ID.';
  }
  return [
    '⚠️ Player ID not verified.',
    'Your saved Player ID has not changed. Try again or contact support if this continues.',
  ].join('\n');
}

function telegramErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('error_code' in error)) return undefined;
  const code = error.error_code;
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : undefined;
}

/** A claim makes at most one send; an ambiguous ACK may later repeat the notification. */
export async function processOneTelegramPlayerValidationOutcome(
  dependencies: TelegramPlayerValidationNotifierDependencies,
): Promise<'none' | 'processed'> {
  const claimed = await dependencies.request({
    version: 1,
    kind: 'player_validation_outcome_claim',
  });
  if (claimed.outcome === 'player_validation_outcome_none') return 'none';
  if (claimed.outcome !== 'player_validation_outcome_delivery') {
    throw new Error('Unexpected Telegram Player validation outcome response.');
  }
  let result: 'sent' | 'retry' | 'unavailable' = 'retry';
  let messageId: number | null = null;
  try {
    const sent = await dependencies.send(
      Number(claimed.privateChatId),
      presentTelegramPlayerValidationOutcome(claimed),
      true,
    );
    if (!Number.isSafeInteger(sent.message_id) || sent.message_id <= 0) {
      throw new Error('Telegram returned no valid message ID.');
    }
    result = 'sent';
    messageId = sent.message_id;
  } catch (error) {
    result = telegramErrorCode(error) === 403 ? 'unavailable' : 'retry';
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const completed = await dependencies.request({
        version: 1,
        kind: 'player_validation_outcome_complete',
        notificationId: claimed.notificationId,
        leaseToken: claimed.leaseToken,
        deliveryResult: result,
        telegramMessageId: messageId,
      });
      if (completed.outcome !== 'player_validation_outcome_completed' || !completed.accepted) {
        throw new Error('The Telegram Player validation acknowledgement was not accepted.');
      }
      return 'processed';
    } catch {
      if (attempt === 1) {
        throw new Error('The Telegram Player validation acknowledgement failed.');
      }
    }
  }
  return 'processed';
}
