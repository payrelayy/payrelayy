import {
  TELEGRAM_PRIVATE_INGRESS_HEADERS,
  TELEGRAM_PRIVATE_INGRESS_PATH,
  type TelegramPrivateInboundEvent,
} from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import {
  deliverTelegramPrivateInbound,
  deliverTelegramPrivateInboundWithRetry,
  TelegramIngressDeliveryError,
  toTelegramPrivateInboundEvent,
  type TelegramPrivateMessageMetadata,
} from './telegram-ingress.js';

const transportHmacSecret = 'c'.repeat(64);
const validMetadata = {
  updateId: 123456,
  chat: { id: 28379330, type: 'private' },
  from: {
    id: 28379330,
    isBot: false,
    firstName: 'Example',
    lastName: undefined,
    username: 'example_user',
    languageCode: 'am-ET',
  },
} satisfies TelegramPrivateMessageMetadata;

describe('Telegram private message reducer', () => {
  it('keeps only allowlisted private-chat metadata', () => {
    expect(toTelegramPrivateInboundEvent(validMetadata)).toEqual({
      version: 1,
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      firstName: 'Example',
      lastName: null,
      username: 'example_user',
      preferredLocale: 'am',
    });
  });

  const invalidMetadata: readonly TelegramPrivateMessageMetadata[] = [
    {
      ...validMetadata,
      chat: { id: 28379330, type: 'group' },
    },
    {
      ...validMetadata,
      chat: { id: 999, type: 'private' },
    },
    {
      ...validMetadata,
      from: { ...validMetadata.from, isBot: true },
    },
    {
      ...validMetadata,
      from: undefined,
    },
  ];

  it.each(invalidMetadata)('rejects non-private or malformed message metadata', (metadata) => {
    expect(toTelegramPrivateInboundEvent(metadata)).toBeUndefined();
  });
});

describe('Telegram ingress client', () => {
  it('sends only the reduced DTO as a signed raw body to the fixed internal endpoint', async () => {
    const event = toTelegramPrivateInboundEvent(validMetadata) as TelegramPrivateInboundEvent;
    let captured:
      | {
          readonly input: string | URL;
          readonly init: RequestInit | undefined;
        }
      | undefined;

    await deliverTelegramPrivateInbound(
      event,
      {
        baseUrl: 'http://api:3000/',
        transportHmacSecret,
      },
      {
        now: () => new Date('2026-08-08T12:00:00.000Z'),
        nonce: () => 'n'.repeat(32),
        fetch: async (input, init) => {
          captured = { input, init };
          return { status: 204 };
        },
      },
    );

    expect(captured?.input).toEqual(new URL(TELEGRAM_PRIVATE_INGRESS_PATH, 'http://api:3000/'));
    expect(captured?.init?.method).toBe('POST');
    expect(captured?.init?.headers).toMatchObject({
      [TELEGRAM_PRIVATE_INGRESS_HEADERS.keyId]: 'v1',
      [TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce]: 'n'.repeat(32),
      [TELEGRAM_PRIVATE_INGRESS_HEADERS.signature]:
        expect.stringMatching(/^v1\.[A-Za-z0-9_-]{43}$/),
    });
    expect((captured?.init?.body as Buffer).toString('utf8')).toBe(JSON.stringify(event));
    expect((captured?.init?.body as Buffer).toString('utf8')).not.toContain('message text');
  });

  it('fails when the private API does not acknowledge receipt', async () => {
    const event = toTelegramPrivateInboundEvent(validMetadata) as TelegramPrivateInboundEvent;

    await expect(
      deliverTelegramPrivateInbound(
        event,
        {
          baseUrl: 'http://api:3000/',
          transportHmacSecret,
        },
        {
          fetch: async () => ({ status: 503 }),
        },
      ),
    ).rejects.toThrow('was not accepted');
  });

  it('retries a retryable transport failure with a fresh nonce', async () => {
    const event = toTelegramPrivateInboundEvent(validMetadata) as TelegramPrivateInboundEvent;
    const nonces = ['a'.repeat(32), 'b'.repeat(32)];
    const seenNonces: string[] = [];
    let attempt = 0;

    await deliverTelegramPrivateInboundWithRetry(
      event,
      {
        baseUrl: 'http://api:3000/',
        transportHmacSecret,
      },
      {
        nonce: () => nonces[attempt] as string,
        fetch: async (_input, init) => {
          seenNonces.push(
            (init?.headers as Record<string, string>)[
              TELEGRAM_PRIVATE_INGRESS_HEADERS.nonce
            ] as string,
          );
          attempt += 1;
          return { status: attempt === 1 ? 503 : 204 };
        },
      },
    );

    expect(seenNonces).toEqual(nonces);
  });

  it('does not retry a non-retryable private API response', async () => {
    const event = toTelegramPrivateInboundEvent(validMetadata) as TelegramPrivateInboundEvent;
    let attempts = 0;

    await expect(
      deliverTelegramPrivateInboundWithRetry(
        event,
        {
          baseUrl: 'http://api:3000/',
          transportHmacSecret,
        },
        {
          fetch: async () => {
            attempts += 1;
            return { status: 401 };
          },
        },
      ),
    ).rejects.toBeInstanceOf(TelegramIngressDeliveryError);

    expect(attempts).toBe(1);
  });

  it('rejects an unsafe retry-attempt limit before sending a request', async () => {
    const event = toTelegramPrivateInboundEvent(validMetadata) as TelegramPrivateInboundEvent;
    let attempts = 0;

    await expect(
      deliverTelegramPrivateInboundWithRetry(
        event,
        {
          baseUrl: 'http://api:3000/',
          transportHmacSecret,
        },
        {
          fetch: async () => {
            attempts += 1;
            return { status: 204 };
          },
        },
        0,
      ),
    ).rejects.toThrow('attempts must be an integer from 1 to 3');

    expect(attempts).toBe(0);
  });
});
