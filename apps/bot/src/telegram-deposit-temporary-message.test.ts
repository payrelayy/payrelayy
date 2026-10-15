import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  cancelTelegramTemporaryMessage,
  startTelegramTemporaryMessage,
  TELEGRAM_TEMPORARY_MEDIA_TEXT,
  TELEGRAM_TEMPORARY_PAYMENT_TEXT,
  type TelegramTemporaryMessageDependencies,
} from './telegram-deposit-temporary-message.js';

function dependencies(
  options: {
    request?: (action: TelegramPrivateActionEnvelope) => Promise<TelegramPrivateActionResult>;
    send?: TelegramTemporaryMessageDependencies['send'];
    delete?: TelegramTemporaryMessageDependencies['delete'];
  } = {},
): TelegramTemporaryMessageDependencies {
  return {
    request:
      options.request ??
      (async () => ({
        version: 1,
        outcome: 'deposit_temporary_recorded',
        accepted: true,
      })),
    send: options.send ?? (async () => ({ message_id: 42 })),
    delete: options.delete ?? (async () => true),
  };
}

describe('Telegram temporary deposit message', () => {
  it('immediately acknowledges an unverified reference and records only its bot message ID', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    const sends: string[] = [];
    const handle = await startTelegramTemporaryMessage(
      dependencies({
        request: async (action) => {
          actions.push(action);
          return { version: 1, outcome: 'deposit_temporary_recorded', accepted: true };
        },
        send: async (chatId, text) => {
          expect(chatId).toBe(123456789);
          sends.push(text);
          return { message_id: 42 };
        },
      }),
      '123',
      '123456789',
      TELEGRAM_TEMPORARY_PAYMENT_TEXT,
    );
    expect(handle).toEqual({ updateId: '123', privateChatId: '123456789', telegramMessageId: 42 });
    expect(sends).toEqual([TELEGRAM_TEMPORARY_PAYMENT_TEXT]);
    expect(sends[0]).toContain('Checking');
    expect(sends[0]).not.toContain('verified');
    expect(actions).toEqual([
      {
        version: 1,
        kind: 'deposit_temporary_record',
        updateId: '123',
        privateChatId: '123456789',
        telegramMessageId: 42,
      },
    ]);
  });

  it('uses an honest reading notice for a screenshot or PDF before extraction', async () => {
    const notices: string[] = [];
    await startTelegramTemporaryMessage(
      dependencies({
        send: async (_chatId, text) => {
          notices.push(text);
          return { message_id: 43 };
        },
      }),
      '124',
      '123456789',
      TELEGRAM_TEMPORARY_MEDIA_TEXT,
    );
    expect(notices).toEqual([TELEGRAM_TEMPORARY_MEDIA_TEXT]);
    expect(notices[0]).not.toContain('verified');
  });

  it('retries an ambiguous DB record but never sends the acknowledgement twice', async () => {
    let calls = 0;
    let sends = 0;
    const handle = await startTelegramTemporaryMessage(
      dependencies({
        request: async () => {
          calls += 1;
          if (calls === 1) throw new Error('response lost');
          return { version: 1, outcome: 'deposit_temporary_recorded', accepted: true };
        },
        send: async () => {
          sends += 1;
          return { message_id: 42 };
        },
      }),
      '125',
      '123456789',
      TELEGRAM_TEMPORARY_PAYMENT_TEXT,
    );
    expect(handle?.telegramMessageId).toBe(42);
    expect(calls).toBe(2);
    expect(sends).toBe(1);
  });

  it('deletes an untracked notice if durable recording is rejected', async () => {
    const deleted: Array<[number, number]> = [];
    const handle = await startTelegramTemporaryMessage(
      dependencies({
        request: async () => ({
          version: 1,
          outcome: 'deposit_temporary_recorded',
          accepted: false,
        }),
        delete: async (chatId, messageId) => {
          deleted.push([chatId, messageId]);
        },
      }),
      '126',
      '123456789',
      TELEGRAM_TEMPORARY_PAYMENT_TEXT,
    );
    expect(handle).toBeUndefined();
    expect(deleted).toEqual([[123456789, 42]]);
  });

  it('marks an unreadable or rejected submission for cleanup without changing a payment', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    await cancelTelegramTemporaryMessage(
      dependencies({
        request: async (action) => {
          actions.push(action);
          return { version: 1, outcome: 'deposit_temporary_cancelled', accepted: true };
        },
      }),
      { updateId: '127', privateChatId: '123456789', telegramMessageId: 44 },
    );
    expect(actions).toEqual([
      {
        version: 1,
        kind: 'deposit_temporary_cancel',
        updateId: '127',
        privateChatId: '123456789',
        telegramMessageId: 44,
      },
    ]);
  });
});
