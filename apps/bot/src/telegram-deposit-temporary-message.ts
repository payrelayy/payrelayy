import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';

export interface TelegramTemporaryMessageHandle {
  readonly updateId: string;
  readonly privateChatId: string;
  readonly telegramMessageId: number;
}

export interface TelegramTemporaryMessageDependencies {
  readonly request: (action: TelegramPrivateActionEnvelope) => Promise<TelegramPrivateActionResult>;
  readonly send: (privateChatId: number, text: string) => Promise<{ readonly message_id: number }>;
  readonly delete: (privateChatId: number, messageId: number) => Promise<unknown>;
}

export const TELEGRAM_TEMPORARY_PAYMENT_TEXT =
  '⏳ Submission received. Checking your TeleBirr payment. Please do not pay again.';
export const TELEGRAM_TEMPORARY_MEDIA_TEXT =
  '⏳ Receipt received. Reading and checking it now. Please do not pay again.';

/** The acknowledgment is presentation only; a failed Telegram or DB call never authorizes money. */
export async function startTelegramTemporaryMessage(
  dependencies: TelegramTemporaryMessageDependencies,
  updateId: string,
  privateChatId: string,
  text: string,
): Promise<TelegramTemporaryMessageHandle | undefined> {
  const chatId = Number(privateChatId);
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return undefined;
  let messageId: number;
  try {
    const sent = await dependencies.send(chatId, text);
    messageId = sent.message_id;
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return undefined;
  } catch {
    return undefined;
  }
  const handle = { updateId, privateChatId, telegramMessageId: messageId };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const recorded = await dependencies.request({
        version: 1,
        kind: 'deposit_temporary_record',
        updateId,
        privateChatId,
        telegramMessageId: messageId,
      });
      if (recorded.outcome === 'deposit_temporary_recorded' && recorded.accepted) return handle;
      break;
    } catch {
      // A committed-but-unacknowledged database response can succeed on the same-ID retry.
    }
  }
  try {
    await dependencies.delete(chatId, messageId);
  } catch {
    // The final payment result is never blocked by a Telegram deletion failure.
  }
  return undefined;
}

/** Marks a locally rejected/unreadable submission for bounded bot-owned deletion. */
export async function cancelTelegramTemporaryMessage(
  dependencies: Pick<TelegramTemporaryMessageDependencies, 'request'>,
  handle: TelegramTemporaryMessageHandle | undefined,
): Promise<void> {
  if (!handle) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const cancelled = await dependencies.request({
        version: 1,
        kind: 'deposit_temporary_cancel',
        ...handle,
      });
      if (cancelled.outcome === 'deposit_temporary_cancelled' && cancelled.accepted) return;
    } catch {
      // The DB also reclaims a message with no paid candidate after five minutes.
    }
  }
}
