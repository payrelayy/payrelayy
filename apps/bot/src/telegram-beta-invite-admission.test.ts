import { createHash, createHmac } from 'node:crypto';

import {
  TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
  TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS,
  TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
  TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
  telegramBetaInviteRedemptionSignatureInput,
  type TelegramBetaInviteRedemption,
} from '@fetanagent/contracts';
import { message } from '@fetanagent/i18n';
import { describe, expect, it } from 'vitest';

import {
  deliverTelegramBetaInviteRedemption,
  deliverTelegramBetaInviteRedemptionWithRetry,
  handleTelegramBetaInviteMessage,
  reduceTelegramBetaInviteRedemption,
  TelegramBetaAdmissionDeliveryError,
} from './telegram-beta-invite-admission.js';

const inviteToken = 'A'.repeat(43);
const privateStart = {
  updateId: 123456,
  chat: { id: 28379330, type: 'private' },
  from: { id: 28379330, isBot: false },
} as const;
const transportHmacSecret = 'a'.repeat(64);
const redemption = {
  version: 1,
  kind: 'beta_invite_redemption',
  updateId: '123456',
  telegramUserId: '28379330',
  privateChatId: '28379330',
  inviteToken,
  preferredLocale: 'en',
} satisfies TelegramBetaInviteRedemption;

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
      `/start@fetanagentbot ${inviteToken}`,
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

describe('beta invite admission delivery', () => {
  it('signs the exact transmitted bytes for the fixed private contract and uses a timeout', async () => {
    let captured:
      | {
          readonly input: string | URL;
          readonly init: RequestInit | undefined;
        }
      | undefined;

    await deliverTelegramBetaInviteRedemption(
      redemption,
      {
        baseUrl: 'http://beta-admission:3001/',
        transportHmacSecret,
      },
      {
        now: () => new Date('2026-08-10T12:00:00.000Z'),
        nonce: () => 'n'.repeat(32),
        fetch: async (input, init) => {
          captured = { input, init };
          return { status: 204 };
        },
      },
    );

    const rawBody = captured?.init?.body as Buffer;
    const timestamp = '1786363200';
    const bodySha256 = createHash('sha256').update(rawBody).digest('hex');
    const signature = createHmac('sha256', Buffer.from(transportHmacSecret, 'hex'))
      .update(
        telegramBetaInviteRedemptionSignatureInput({
          timestamp,
          nonce: 'n'.repeat(32),
          bodyByteLength: rawBody.byteLength,
          bodySha256,
        }),
        'utf8',
      )
      .digest('base64url');

    expect(captured?.input).toEqual(
      new URL(TELEGRAM_BETA_INVITE_REDEMPTION_PATH, 'http://beta-admission:3001/'),
    );
    expect(captured?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(captured?.init?.headers).toEqual({
      'content-type': TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.keyId]: TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.timestamp]: timestamp,
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce]: 'n'.repeat(32),
      [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature]: `v1.${signature}`,
    });
    expect(rawBody.equals(Buffer.from(JSON.stringify(redemption), 'utf8'))).toBe(true);
    expect(captured?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses a fresh nonce for each of the two permitted total attempts', async () => {
    const nonces = ['a'.repeat(32), 'b'.repeat(32)];
    const seenNonces: string[] = [];
    let attempts = 0;

    await expect(
      deliverTelegramBetaInviteRedemptionWithRetry(
        redemption,
        {
          baseUrl: 'http://beta-admission:3001/',
          transportHmacSecret,
        },
        {
          nonce: () => nonces[attempts] as string,
          fetch: async (_input, init) => {
            seenNonces.push(
              (init?.headers as Record<string, string>)[
                TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce
              ] as string,
            );
            attempts += 1;
            return { status: 503 };
          },
        },
      ),
    ).rejects.toBeInstanceOf(TelegramBetaAdmissionDeliveryError);

    expect(attempts).toBe(2);
    expect(seenNonces).toEqual(nonces);
  });

  it('does not retry non-retryable responses or expose the invite in its error', async () => {
    let attempts = 0;
    let caught: unknown;
    try {
      await deliverTelegramBetaInviteRedemptionWithRetry(
        redemption,
        {
          baseUrl: 'http://beta-admission:3001/',
          transportHmacSecret,
        },
        {
          fetch: async () => {
            attempts += 1;
            return { status: 401 };
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TelegramBetaAdmissionDeliveryError);
    expect((caught as Error).message).not.toContain(inviteToken);
    expect((caught as Error).message).not.toContain(JSON.stringify(redemption));
    expect(attempts).toBe(1);
  });

  it.each([0, 3, 1.5])(
    'rejects an unsafe attempt count %s before delivery',
    async (attemptsLimit) => {
      let attempts = 0;
      await expect(
        deliverTelegramBetaInviteRedemptionWithRetry(
          redemption,
          {
            baseUrl: 'http://beta-admission:3001/',
            transportHmacSecret,
          },
          {
            fetch: async () => {
              attempts += 1;
              return { status: 204 };
            },
          },
          attemptsLimit,
        ),
      ).rejects.toThrow('attempts must be an integer from 1 to 2');
      expect(attempts).toBe(0);
    },
  );
});

describe('visible beta invite message handler', () => {
  it('ignores every non-exact update without delivery or a reply', async () => {
    let deliveries = 0;
    const replies: string[] = [];

    const outcome = await handleTelegramBetaInviteMessage(
      { ...privateStart, text: '/start' },
      {
        baseUrl: 'http://beta-admission:3001/',
        transportHmacSecret,
      },
      {
        fetch: async () => {
          deliveries += 1;
          return { status: 204 };
        },
        reply: async (text) => {
          replies.push(text);
        },
      },
    );

    expect(outcome).toBe('ignored');
    expect(deliveries).toBe(0);
    expect(replies).toEqual([]);
  });

  it('waits for database-backed service success before sending the welcome', async () => {
    let acknowledge: ((value: Pick<Response, 'status'>) => void) | undefined;
    const replies: string[] = [];
    const processing = handleTelegramBetaInviteMessage(
      { ...privateStart, text: `/start ${inviteToken}` },
      {
        baseUrl: 'http://beta-admission:3001/',
        transportHmacSecret,
      },
      {
        fetch: () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
        reply: async (text) => {
          replies.push(text);
        },
      },
    );

    await Promise.resolve();
    expect(replies).toEqual([]);
    acknowledge?.({ status: 204 });

    await expect(processing).resolves.toBe('admitted');
    expect(replies).toEqual([message('en', 'betaAdmissionWelcome')]);
  });

  it('sends only the generic retry copy when admission remains unavailable', async () => {
    const replies: string[] = [];
    const outcome = await handleTelegramBetaInviteMessage(
      { ...privateStart, text: `/start ${inviteToken}` },
      {
        baseUrl: 'http://beta-admission:3001/',
        transportHmacSecret,
      },
      {
        fetch: async () => ({ status: 503 }),
        reply: async (text) => {
          replies.push(text);
        },
      },
    );

    expect(outcome).toBe('unavailable');
    expect(replies).toEqual([message('en', 'betaAdmissionUnavailable')]);
    expect(replies.join(' ')).not.toContain(inviteToken);
  });
});
