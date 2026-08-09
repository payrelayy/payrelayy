import { describe, expect, it } from 'vitest';

import {
  reduceTelegramPlayerIdTextAction,
  reduceTelegramPlayerRegistrationCallbackAction,
  reduceTelegramRootMenuAction,
} from './telegram-private-action.js';

const privateMetadata = {
  updateId: 123456,
  chat: { id: 28379330, type: 'private' },
  from: {
    id: 28379330,
    isBot: false,
    languageCode: 'am-ET',
  },
} as const;

const callbackData = 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w';

describe('private Telegram action reducers', () => {
  it('reduces only exact root-menu commands to an English-only envelope', () => {
    expect(reduceTelegramRootMenuAction({ ...privateMetadata, command: '/start' })).toEqual({
      version: 1,
      kind: 'root_menu',
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en',
    });
    expect(reduceTelegramRootMenuAction({ ...privateMetadata, command: '/start extra' })).toBe(
      undefined,
    );
  });

  it('accepts only a compact Player ID capability callback within Telegram’s byte limit', () => {
    const action = reduceTelegramPlayerRegistrationCallbackAction({
      ...privateMetadata,
      callbackData,
    });

    expect(action).toMatchObject({
      kind: 'player_registration_callback',
      callbackData,
      preferredLocale: 'en',
    });
    expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(64);
    expect(
      reduceTelegramPlayerRegistrationCallbackAction({
        ...privateMetadata,
        callbackData: 'start:player-registration',
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramPlayerRegistrationCallbackAction({
        ...privateMetadata,
        callbackData: `${callbackData}x`.repeat(2),
      }),
    ).toBeUndefined();
  });

  it('rejects unsafe chat identities and control-character Player ID text', () => {
    expect(
      reduceTelegramPlayerIdTextAction({ ...privateMetadata, text: 'player\u0000id' }),
    ).toBeUndefined();
    expect(
      reduceTelegramPlayerIdTextAction({
        ...privateMetadata,
        text: 'x'.repeat(65),
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramPlayerIdTextAction({
        ...privateMetadata,
        chat: { id: 28379331, type: 'private' },
        text: 'player-123',
      }),
    ).toBeUndefined();
  });

  it('preserves bounded text only in memory for a later database authority', () => {
    expect(
      reduceTelegramPlayerIdTextAction({ ...privateMetadata, text: 'player-123' }),
    ).toMatchObject({
      kind: 'player_id_text',
      playerId: 'player-123',
      preferredLocale: 'en',
    });
  });
});
