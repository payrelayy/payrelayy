import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  presentTelegramDepositOutcome,
  processOneTelegramDepositOutcome,
  processOneTelegramDepositTemporaryCleanup,
  runTelegramDepositOutcomeNotifier,
  type TelegramDepositOutcomeNotifierDependencies,
} from './telegram-deposit-outcome-notifier.js';

const delivery = {
  version: 1,
  outcome: 'deposit_outcome_delivery',
  notificationId: '7e868cac-6ef2-4203-ad6e-449043111937',
  leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
  privateChatId: '123456789',
  outcomeCode: 'credited',
  amountMinor: '3000',
  referenceMasked: '***1A2B',
} as const;

function dependencies(
  result: TelegramPrivateActionResult,
  send: TelegramDepositOutcomeNotifierDependencies['send'],
  actions: TelegramPrivateActionEnvelope[],
): TelegramDepositOutcomeNotifierDependencies {
  return {
    request: async (action) => {
      actions.push(action);
      return action.kind === 'deposit_outcome_claim'
        ? result
        : { version: 1, outcome: 'deposit_outcome_completed', accepted: true };
    },
    send,
    delete: async () => true,
  };
}

describe('Telegram deposit outcome notifier', () => {
  it('checks again after a short idle wait so completed Player and credit results are delivered promptly', async () => {
    const controller = new AbortController();
    const waits: number[] = [];
    await runTelegramDepositOutcomeNotifier(
      {
        request: async (action) => {
          if (action.kind === 'deposit_outcome_claim') {
            return { version: 1, outcome: 'deposit_outcome_none' };
          }
          if (action.kind === 'player_validation_outcome_claim') {
            return { version: 1, outcome: 'player_validation_outcome_none' };
          }
          if (action.kind === 'deposit_temporary_cleanup_claim') {
            return { version: 1, outcome: 'deposit_temporary_cleanup_none' };
          }
          if (action.kind === 'payment_instruction_expiry_claim') {
            return { version: 1, outcome: 'payment_instruction_expiry_none' };
          }
          throw new Error('Unexpected action.');
        },
        send: async () => {
          throw new Error('No notification should be sent.');
        },
        delete: async () => {
          throw new Error('No message should be deleted.');
        },
        sleep: async (milliseconds, signal) => {
          expect(signal.aborted).toBe(false);
          waits.push(milliseconds);
          controller.abort();
        },
      },
      controller.signal,
    );
    expect(waits).toEqual([2_000]);
  });

  it('retires an expired payment card in the background without sending a new chat message', async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => ({ message_id: 1 }));
    const deleted = vi.fn(async () => true);
    const actions: TelegramPrivateActionEnvelope[] = [];
    let expiryClaimed = false;
    await runTelegramDepositOutcomeNotifier(
      {
        request: async (action) => {
          actions.push(action);
          if (action.kind === 'deposit_outcome_claim')
            return { version: 1, outcome: 'deposit_outcome_none' };
          if (action.kind === 'player_validation_outcome_claim')
            return { version: 1, outcome: 'player_validation_outcome_none' };
          if (action.kind === 'deposit_temporary_cleanup_claim')
            return { version: 1, outcome: 'deposit_temporary_cleanup_none' };
          if (action.kind === 'payment_instruction_expiry_claim') {
            if (expiryClaimed) return { version: 1, outcome: 'payment_instruction_expiry_none' };
            expiryClaimed = true;
            return {
              version: 1,
              outcome: 'payment_instruction_expiry_delivery',
              instructionEventId: '42cba976-cfea-48da-83e9-6b9d07cb36b1',
              leaseToken: 'f76f14d1-2fce-4e72-9a24-07671ba702d5',
              privateChatId: '4567',
              telegramMessageId: 89,
              suppressMenu: false,
            };
          }
          if (action.kind === 'payment_instruction_expiry_complete')
            return { version: 1, outcome: 'payment_instruction_expiry_completed', accepted: true };
          throw new Error('Unexpected action.');
        },
        send,
        delete: deleted,
        sleep: async () => {
          controller.abort();
        },
      },
      controller.signal,
    );
    expect(deleted).toHaveBeenCalledExactlyOnceWith(4567, 89);
    expect(send).not.toHaveBeenCalled();
    expect(actions).toContainEqual(
      expect.objectContaining({
        kind: 'payment_instruction_expiry_complete',
        expiryResult: 'complete',
      }),
    );
  });

  it('sends confirmed credit only after a final delivery is claimed, then acknowledges it', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    const messages: string[] = [];
    const result = await processOneTelegramDepositOutcome(
      dependencies(
        delivery,
        async (chatId, text, showDepositButton) => {
          expect(chatId).toBe(123456789);
          expect(showDepositButton).toBe(true);
          messages.push(text);
          return { message_id: 42 };
        },
        actions,
      ),
    );
    expect(result).toBe('processed');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('30.00 ETB credited');
    expect(messages[0]).not.toContain('1A2B');
    expect(actions).toEqual([
      { version: 1, kind: 'deposit_outcome_claim' },
      {
        version: 1,
        kind: 'deposit_outcome_complete',
        notificationId: delivery.notificationId,
        leaseToken: delivery.leaseToken,
        deliveryResult: 'sent',
        telegramMessageId: 42,
      },
    ]);
  });

  it.each(['rejected', 'already_used', 'wrong_receiver'] as const)(
    'keeps Deposit available after a final %s notice',
    async (outcomeCode) => {
      const send = vi.fn(async (_chatId: number, text: string, showDepositButton: boolean) => {
        expect(text).toMatch(/^❌/u);
        expect(showDepositButton).toBe(true);
        return { message_id: 48 };
      });
      await processOneTelegramDepositOutcome(
        dependencies({ ...delivery, outcomeCode, amountMinor: null }, send, []),
      );
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it('does not send when there is no final outcome', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    let sends = 0;
    expect(
      await processOneTelegramDepositOutcome(
        dependencies(
          { version: 1, outcome: 'deposit_outcome_none' },
          async () => {
            sends += 1;
            return { message_id: 1 };
          },
          actions,
        ),
      ),
    ).toBe('none');
    expect(sends).toBe(0);
    expect(actions).toEqual([{ version: 1, kind: 'deposit_outcome_claim' }]);
  });

  it('reports a verified queued payment without claiming a Player credit', () => {
    const waiting = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'verified_waiting',
      amountMinor: null,
    });
    expect(waiting).toBe('⏳ Payment verified. Crediting your Player account.');
    expect(waiting).not.toContain('✅');
    expect(waiting).not.toContain('1A2B');
    expect(waiting).not.toContain('30.00');
    expect(waiting).not.toContain('Deposit complete');
  });

  it('does not offer another deposit as the final action while a credit is still waiting', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    await processOneTelegramDepositOutcome(
      dependencies(
        { ...delivery, outcomeCode: 'verified_waiting', amountMinor: null },
        async (_chatId, _text, showDepositButton) => {
          expect(showDepositButton).toBe(false);
          return { message_id: 43 };
        },
        actions,
      ),
    );
  });

  it('gives an early non-final status without calling an unverified reference rejected', () => {
    const checking = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'checking',
      amountMinor: null,
    });
    expect(checking).toContain('Still checking your payment');
    expect(checking).toContain('We’ll update you here');
    expect(checking).not.toContain('1A2B');
    expect(checking).not.toContain('phone SMS');
    expect(checking).not.toContain('pay again');
    expect(checking).not.toContain('pending');
    expect(checking).not.toContain('Deposit complete');
    expect(checking).not.toContain('rejected');
    expect(checking).not.toContain('30.00');
  });

  it('reports a same-account already-credited reference without a second credit claim', () => {
    const duplicate = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'already_used',
      amountMinor: null,
    });
    expect(duplicate).toBe(
      '❌ This payment reference has already been used. It can’t be submitted again.',
    );
    expect(duplicate).not.toContain('30.00');
    expect(duplicate).not.toContain('fake');
  });

  it('gives a definitive signed wrong-receiver result without revealing receiver details', () => {
    const wrongReceiver = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'wrong_receiver',
      amountMinor: null,
    });
    expect(wrongReceiver).toBe(
      '❌ Deposit not credited. Payment went to a different receiver. Contact support.',
    );
    expect(wrongReceiver).not.toContain('30.00');
  });

  it('gives an explicit invalid-reference result without claiming money moved', () => {
    const invalid = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'invalid_reference',
      amountMinor: null,
    });
    expect(invalid).toBe('❌ Deposit not credited. Check the reference or contact support.');
    expect(invalid).not.toContain('30.00');
    expect(invalid).not.toContain('fake');
  });

  it('has customer-safe copy ready for a future unrelated-receipt decision', () => {
    const unrelated = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'unrelated_receipt',
      amountMinor: null,
    });
    expect(unrelated).toBe(
      '❌ Deposit not credited. This receipt does not match. Contact support.',
    );
    expect(unrelated).not.toContain('1A2B');
  });

  it('keeps an older payment quiet until the Owner decides', () => {
    expect(
      presentTelegramDepositOutcome({
        ...delivery,
        outcomeCode: 'older_pending',
        amountMinor: null,
      }),
    ).toBeNull();
    const rejected = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'old_rejected',
      amountMinor: null,
    });
    expect(rejected).toBe('❌ Deposit not credited. This payment is too old. Contact support.');
  });

  it.each(['held_review', 'older_pending', 'manual_review'] as const)(
    'silently retires a %s notice while preserving later final outcomes',
    async (outcomeCode) => {
      const actions: TelegramPrivateActionEnvelope[] = [];
      const send = vi.fn(async () => ({ message_id: 99 }));
      expect(
        presentTelegramDepositOutcome({ ...delivery, outcomeCode, amountMinor: null }),
      ).toBeNull();
      expect(
        await processOneTelegramDepositOutcome(
          dependencies({ ...delivery, outcomeCode, amountMinor: null }, send, actions),
        ),
      ).toBe('processed');
      expect(send).not.toHaveBeenCalled();
      expect(actions[1]).toMatchObject({
        kind: 'deposit_outcome_complete',
        deliveryResult: 'unavailable',
        telegramMessageId: null,
      });
    },
  );

  it('never describes a rejected or unverified payment as credited, fake, or refunded', () => {
    const rejected = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'rejected',
      amountMinor: null,
    });
    const unverified = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'not_verified',
      amountMinor: null,
    });
    expect(rejected).toContain('Deposit not credited');
    expect(unverified).toContain('Deposit not credited');
    expect(unverified).toContain('Check the reference');
    for (const text of [rejected, unverified]) {
      expect(text).not.toContain('pay again');
      expect(text).not.toContain('30.00');
      expect(text).not.toContain('refunded');
      expect(text).not.toContain('fake');
    }
  });

  it.each([
    ['checking', '⏳'],
    ['verified_waiting', '⏳'],
    ['credited', '✅'],
    ['rejected', '❌'],
    ['wrong_receiver', '❌'],
    ['invalid_reference', '❌'],
    ['unrelated_receipt', '❌'],
    ['old_rejected', '❌'],
    ['not_credited', '⚠️'],
    ['not_verified', '❌'],
    ['already_used', '❌'],
  ] as const)('uses %s status copy with a %s icon', (outcomeCode, icon) => {
    const text = presentTelegramDepositOutcome({ ...delivery, outcomeCode });
    expect(text).not.toBeNull();
    expect(text?.startsWith(icon)).toBe(true);
    if (icon !== '✅') expect(text).not.toContain('✅');
  });

  it('never calls a credited result with a missing amount rejected', () => {
    const text = presentTelegramDepositOutcome({ ...delivery, amountMinor: null });
    expect(text).toBe('⚠️ Deposit status is unavailable. Contact support.');
  });

  it.each([
    { errorCode: 403, outcome: 'unavailable' },
    { errorCode: 429, outcome: 'retry' },
    { errorCode: 500, outcome: 'retry' },
  ] as const)(
    'records Telegram error $errorCode as $outcome without ledger mutation',
    async ({ errorCode, outcome }) => {
      const actions: TelegramPrivateActionEnvelope[] = [];
      await processOneTelegramDepositOutcome(
        dependencies(
          delivery,
          async () => {
            throw { error_code: errorCode };
          },
          actions,
        ),
      );
      expect(actions[1]).toMatchObject({
        kind: 'deposit_outcome_complete',
        deliveryResult: outcome,
        telegramMessageId: null,
      });
    },
  );

  it('deletes only the leased bot-owned notice after a status was sent', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    const deleted: Array<[number, number]> = [];
    const result = await processOneTelegramDepositTemporaryCleanup({
      request: async (action) => {
        actions.push(action);
        return action.kind === 'deposit_temporary_cleanup_claim'
          ? {
              version: 1,
              outcome: 'deposit_temporary_cleanup_delivery',
              updateId: '123',
              leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
              privateChatId: '123456789',
              telegramMessageId: 42,
            }
          : { version: 1, outcome: 'deposit_temporary_cleanup_completed', accepted: true };
      },
      send: async () => {
        throw new Error('No new status may be sent by cleanup.');
      },
      delete: async (chatId, messageId) => {
        deleted.push([chatId, messageId]);
        return true;
      },
    });
    expect(result).toBe('processed');
    expect(deleted).toEqual([[123456789, 42]]);
    expect(actions).toEqual([
      { version: 1, kind: 'deposit_temporary_cleanup_claim' },
      {
        version: 1,
        kind: 'deposit_temporary_cleanup_complete',
        updateId: '123',
        leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
        deletionResult: 'deleted',
      },
    ]);
  });

  it.each([
    { errorCode: 400, outcome: 'unavailable' },
    { errorCode: 403, outcome: 'unavailable' },
    { errorCode: 429, outcome: 'retry' },
  ] as const)(
    'acknowledges Telegram deletion error $errorCode as $outcome',
    async ({ errorCode, outcome }) => {
      const actions: TelegramPrivateActionEnvelope[] = [];
      await processOneTelegramDepositTemporaryCleanup({
        request: async (action) => {
          actions.push(action);
          return action.kind === 'deposit_temporary_cleanup_claim'
            ? {
                version: 1,
                outcome: 'deposit_temporary_cleanup_delivery',
                updateId: '124',
                leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
                privateChatId: '123456789',
                telegramMessageId: 43,
              }
            : { version: 1, outcome: 'deposit_temporary_cleanup_completed', accepted: true };
        },
        send: async () => {
          throw new Error('Unexpected send.');
        },
        delete: async () => {
          throw { error_code: errorCode };
        },
      });
      expect(actions[1]).toMatchObject({
        kind: 'deposit_temporary_cleanup_complete',
        deletionResult: outcome,
      });
    },
  );
});
