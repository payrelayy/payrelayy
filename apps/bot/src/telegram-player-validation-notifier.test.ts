import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  presentTelegramPlayerValidationOutcome,
  processOneTelegramPlayerValidationOutcome,
} from './telegram-player-validation-notifier.js';

const delivery = {
  version: 1,
  outcome: 'player_validation_outcome_delivery',
  notificationId: '7e868cac-6ef2-4203-ad6e-449043111937',
  leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
  privateChatId: '123456789',
  outcomeCode: 'selected',
} as const;

describe('Telegram Player validation outcome notifier', () => {
  it('sends one verified result to the private chat and acknowledges the lease', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    const texts: string[] = [];
    const processed = await processOneTelegramPlayerValidationOutcome({
      request: async (action): Promise<TelegramPrivateActionResult> => {
        actions.push(action);
        return action.kind === 'player_validation_outcome_claim'
          ? delivery
          : { version: 1, outcome: 'player_validation_outcome_completed', accepted: true };
      },
      send: async (chatId, text, showDepositButton) => {
        expect(chatId).toBe(123456789);
        expect(showDepositButton).toBe(true);
        texts.push(text);
        return { message_id: 42 };
      },
    });
    expect(processed).toBe('processed');
    expect(texts).toEqual([expect.stringContaining('Player ID verified and saved')]);
    expect(texts[0]).not.toContain('28379330');
    expect(actions).toEqual([
      { version: 1, kind: 'player_validation_outcome_claim' },
      {
        version: 1,
        kind: 'player_validation_outcome_complete',
        notificationId: delivery.notificationId,
        leaseToken: delivery.leaseToken,
        deliveryResult: 'sent',
        telegramMessageId: 42,
      },
    ]);
  });

  it('does not send when the default-off queue has no delivery', async () => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    expect(
      await processOneTelegramPlayerValidationOutcome({
        request: async (action) => {
          actions.push(action);
          return { version: 1, outcome: 'player_validation_outcome_none' };
        },
        send: async () => {
          throw new Error('No message may be sent.');
        },
      }),
    ).toBe('none');
    expect(actions).toEqual([{ version: 1, kind: 'player_validation_outcome_claim' }]);
  });

  it('does not call an inconclusive Find invalid or change the saved ID', () => {
    const text = presentTelegramPlayerValidationOutcome({
      ...delivery,
      outcomeCode: 'review_required',
    });
    expect(text).toContain('not verified');
    expect(text).toContain('saved Player ID has not changed');
    expect(text).not.toContain('invalid');
    expect(text).not.toContain('deposit complete');
  });

  it.each([
    { errorCode: 403, expected: 'unavailable' },
    { errorCode: 429, expected: 'retry' },
  ] as const)('records Telegram $errorCode as $expected', async ({ errorCode, expected }) => {
    const actions: TelegramPrivateActionEnvelope[] = [];
    await processOneTelegramPlayerValidationOutcome({
      request: async (action) => {
        actions.push(action);
        return action.kind === 'player_validation_outcome_claim'
          ? delivery
          : { version: 1, outcome: 'player_validation_outcome_completed', accepted: true };
      },
      send: async () => {
        throw { error_code: errorCode };
      },
    });
    expect(actions[1]).toMatchObject({
      kind: 'player_validation_outcome_complete',
      deliveryResult: expected,
      telegramMessageId: null,
    });
  });

  it('retries an ambiguous acknowledgement without sending twice in one claim', async () => {
    let sends = 0;
    let acknowledgements = 0;
    await processOneTelegramPlayerValidationOutcome({
      request: async (action) => {
        if (action.kind === 'player_validation_outcome_claim') return delivery;
        acknowledgements += 1;
        if (acknowledgements === 1) throw new Error('ACK lost');
        return { version: 1, outcome: 'player_validation_outcome_completed', accepted: true };
      },
      send: async () => {
        sends += 1;
        return { message_id: 42 };
      },
    });
    expect(sends).toBe(1);
    expect(acknowledgements).toBe(2);
  });
});
