import { describe, expect, it } from 'vitest';

import { reduceTelegramBetaInviteRedemption } from './telegram-beta-invite-admission.js';

const inviteToken = 'A'.repeat(43);
const privateStart = {
  updateId: 123456,
  chat: { id: 28379330, type: 'private' },
  from: { id: 28379330, isBot: false },
} as const;

describe('beta invite admission reducer', () => {
  it('reduces only an exact private non-bot start deep link to an English-only envelope', () => {
    expect(
      reduceTelegramBetaInviteRedemption({ ...privateStart, text: `/start ${inviteToken}` }),
    ).toEqual({
      version: 1,
      kind: 'beta_invite_redemption',
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      inviteToken,
      preferredLocale: 'en',
    });
  });

  it('rejects every non-exact command presentation without normalizing it', () => {
    for (const text of [
      '/start',
      `/start  ${inviteToken}`,
      `/start ${inviteToken} extra`,
      `/start@PayReplayyBot ${inviteToken}`,
      ` /start ${inviteToken}`,
      `/start ${inviteToken}\n`,
      `/menu ${inviteToken}`,
      `/start ${'A'.repeat(42)}`,
      `/start ${'A'.repeat(44)}`,
      `/start ${'!'.repeat(43)}`,
    ]) {
      expect(reduceTelegramBetaInviteRedemption({ ...privateStart, text })).toBeUndefined();
    }
  });

  it('rejects groups, bots, mismatched chat identities, and invalid Telegram identifiers', () => {
    expect(
      reduceTelegramBetaInviteRedemption({
        ...privateStart,
        chat: { id: 28379330, type: 'group' },
        text: `/start ${inviteToken}`,
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramBetaInviteRedemption({
        ...privateStart,
        from: { ...privateStart.from, isBot: true },
        text: `/start ${inviteToken}`,
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramBetaInviteRedemption({
        ...privateStart,
        chat: { id: 28379331, type: 'private' },
        text: `/start ${inviteToken}`,
      }),
    ).toBeUndefined();
    expect(
      reduceTelegramBetaInviteRedemption({
        ...privateStart,
        updateId: -1,
        text: `/start ${inviteToken}`,
      }),
    ).toBeUndefined();
  });

  it('does not capture profile metadata in the admission envelope', () => {
    const redemption = reduceTelegramBetaInviteRedemption({
      ...privateStart,
      text: `/start ${inviteToken}`,
    });

    expect(JSON.stringify(redemption)).not.toContain('firstName');
    expect(JSON.stringify(redemption)).not.toContain('username');
  });
});
