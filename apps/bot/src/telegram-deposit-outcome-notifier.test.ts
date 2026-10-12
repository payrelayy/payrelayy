import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  presentTelegramDepositOutcome,
  processOneTelegramDepositOutcome,
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
  };
}

describe('Telegram deposit outcome notifier', () => {
  it('sends confirmed credit only after a final delivery is claimed, then acknowledges it', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    const messages: string[] = [];
    const result = await processOneTelegramDepositOutcome(
      dependencies(
        delivery,
        async (chatId, text) => {
          expect(chatId).toBe(123456789);
          messages.push(text);
          return { message_id: 42 };
        },
        actions,
      ),
    );
    expect(result).toBe('processed');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('30.00 ETB was credited');
    expect(messages[0]).toContain('1A2B');
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

  it('never describes a rejected or unverified payment as credited or refunded', () => {
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
    expect(rejected).toContain('deposit rejected');
    expect(unverified).toContain('could not be verified');
    for (const text of [rejected, unverified]) {
      expect(text).toContain('do not pay again');
      expect(text).not.toContain('30.00');
      expect(text).not.toContain('refunded');
    }
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
});
