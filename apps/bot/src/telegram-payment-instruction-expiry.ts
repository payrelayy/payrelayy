import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';

export interface TelegramPaymentInstructionExpiryDependencies {
  readonly request: (action: TelegramPrivateActionEnvelope) => Promise<TelegramPrivateActionResult>;
  readonly delete: (privateChatId: number, messageId: number) => Promise<boolean>;
  readonly sendMenu: (privateChatId: number) => Promise<unknown>;
}

function telegramErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('error_code' in error)) return undefined;
  return typeof error.error_code === 'number' ? error.error_code : undefined;
}

function deletedAlready(error: unknown): boolean {
  return (
    telegramErrorCode(error) === 400 &&
    typeof error === 'object' &&
    error !== null &&
    'description' in error &&
    typeof error.description === 'string' &&
    error.description.toLowerCase().includes('message to delete not found')
  );
}

/** The message is only a presentation; failed recording removes it rather than promising an hour. */
export async function recordTelegramPaymentInstruction(
  dependencies: Pick<TelegramPaymentInstructionExpiryDependencies, 'request' | 'delete'>,
  updateId: string,
  privateChatId: string,
  messageId: number,
): Promise<boolean> {
  const chatId = Number(privateChatId);
  if (
    !Number.isSafeInteger(chatId) ||
    chatId <= 0 ||
    !Number.isSafeInteger(messageId) ||
    messageId <= 0
  )
    return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await dependencies.request({
        version: 1,
        kind: 'payment_instruction_record',
        updateId,
        privateChatId,
        telegramMessageId: messageId,
      });
      if (result.outcome === 'payment_instruction_recorded' && result.accepted) return true;
      break;
    } catch {
      // A committed database call may have lost its response; retry with the same IDs.
    }
  }
  try {
    await dependencies.delete(chatId, messageId);
  } catch {
    /* best effort */
  }
  return false;
}

/** One bounded, durable expiry lease; the database is authoritative for the one-hour deadline. */
export async function processOneTelegramPaymentInstructionExpiry(
  dependencies: TelegramPaymentInstructionExpiryDependencies,
): Promise<'none' | 'processed'> {
  const claimed = await dependencies.request({
    version: 1,
    kind: 'payment_instruction_expiry_claim',
  });
  if (claimed.outcome === 'payment_instruction_expiry_none') return 'none';
  if (claimed.outcome !== 'payment_instruction_expiry_delivery') {
    throw new Error('Unexpected Telegram instruction expiry claim.');
  }
  const chatId = Number(claimed.privateChatId);
  let expiryResult: 'complete' | 'retry' | 'unavailable' = 'retry';
  try {
    if (!(await dependencies.delete(chatId, claimed.telegramMessageId))) {
      throw new Error('Telegram did not confirm instruction deletion.');
    }
    if (!claimed.suppressMenu) await dependencies.sendMenu(chatId);
    expiryResult = 'complete';
  } catch (error) {
    if (deletedAlready(error)) {
      try {
        if (!claimed.suppressMenu) await dependencies.sendMenu(chatId);
        expiryResult = 'complete';
      } catch (sendError) {
        expiryResult = telegramErrorCode(sendError) === 403 ? 'unavailable' : 'retry';
      }
    } else {
      expiryResult = telegramErrorCode(error) === 403 ? 'unavailable' : 'retry';
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const completed = await dependencies.request({
        version: 1,
        kind: 'payment_instruction_expiry_complete',
        instructionEventId: claimed.instructionEventId,
        leaseToken: claimed.leaseToken,
        expiryResult,
      });
      if (completed.outcome !== 'payment_instruction_expiry_completed' || !completed.accepted)
        throw new Error('Telegram instruction expiry ACK was not accepted.');
      return 'processed';
    } catch {
      if (attempt === 1) throw new Error('Telegram instruction expiry ACK failed.');
    }
  }
  return 'processed';
}
