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
    expect(messages[0]).toContain('30.00 ETB credited');
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

  it('reports a verified queued payment without claiming a Player credit', () => {
    const waiting = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'verified_waiting',
      amountMinor: null,
    });
    expect(waiting).toContain('payment verified');
    expect(waiting).toContain('waiting for Player credit');
    expect(waiting).toContain('1A2B');
    expect(waiting).not.toContain('30.00');
    expect(waiting).not.toContain('Deposit complete');
  });

  it('gives an early non-final status without calling an unverified reference rejected', () => {
    const checking = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'checking',
      amountMinor: null,
    });
    expect(checking).toContain('Deposit not credited yet');
    expect(checking).toContain('was not verified');
    expect(checking).toContain('1A2B');
    expect(checking).toContain('final result');
    expect(checking).toContain('no Player credit was recorded');
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
    expect(duplicate).toContain('Reference already used');
    expect(duplicate).toContain('This Telegram account');
    expect(duplicate).toContain('No new Player credit was made');
    expect(duplicate).toContain('1A2B');
    expect(duplicate).not.toContain('30.00');
    expect(duplicate).not.toContain('fake');
  });

  it('gives a definitive signed wrong-receiver result without revealing receiver details', () => {
    const wrongReceiver = presentTelegramDepositOutcome({
      ...delivery,
      outcomeCode: 'wrong_receiver',
      amountMinor: null,
    });
    expect(wrongReceiver).toContain('Deposit rejected — wrong receiver');
    expect(wrongReceiver).toContain('different receiver');
    expect(wrongReceiver).toContain('No Player credit was made');
    expect(wrongReceiver).toContain('1A2B');
    expect(wrongReceiver).not.toContain('30.00');
  });

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
    expect(unverified).toContain('couldn’t verify');
    expect(unverified).toContain('No Player credit was recorded for this submission');
    for (const text of [rejected, unverified]) {
      expect(text).toContain('do not pay again');
      expect(text).not.toContain('30.00');
      expect(text).not.toContain('refunded');
      expect(text).not.toContain('fake');
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
