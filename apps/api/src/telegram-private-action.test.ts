import type { IncomingHttpHeaders } from 'node:http';

import { loadApiConfig } from '@payreplayy/config/api';
import {
  TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
  TELEGRAM_PRIVATE_ACTION_HEADERS,
  TELEGRAM_PRIVATE_ACTION_KEY_ID,
  TELEGRAM_PRIVATE_ACTION_PATH,
  type TelegramPrivateActionEnvelope,
} from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import {
  createTelegramPrivateActionSignatureForTest,
  InMemoryTelegramPrivateActionDispatcher,
  InMemoryTelegramPrivateActionNonceStore,
  redactTelegramPrivateActionForLog,
  verifyAndDispatchTelegramPrivateActionForTest,
  verifyTelegramPrivateActionRequest,
} from './telegram-private-action.js';

const transportHmacSecret = 'a'.repeat(64);
const fixedNow = new Date('2026-08-09T12:00:00.000Z');
const fixedTimestamp = Math.floor(fixedNow.getTime() / 1000).toString();
const fixedNonce = 'n'.repeat(32);
const callbackData = 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w';
const callbackAction: TelegramPrivateActionEnvelope = {
  version: 1,
  kind: 'player_registration_callback',
  updateId: '123456',
  telegramUserId: '28379330',
  privateChatId: '28379330',
  preferredLocale: 'en',
  callbackData,
};

function verificationOptions(nonceStore = new InMemoryTelegramPrivateActionNonceStore()) {
  return {
    transportHmacSecret,
    now: fixedNow,
    nonceStore,
  };
}

function signedRequest(
  action: TelegramPrivateActionEnvelope = callbackAction,
  options: { readonly nonce?: string; readonly timestamp?: string; readonly rawBody?: Buffer } = {},
) {
  const rawBody = options.rawBody ?? Buffer.from(JSON.stringify(action), 'utf8');
  const timestamp = options.timestamp ?? fixedTimestamp;
  const nonce = options.nonce ?? fixedNonce;

  return {
    request: {
      method: 'POST',
      url: TELEGRAM_PRIVATE_ACTION_PATH,
      headers: {
        'content-type': TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
        [TELEGRAM_PRIVATE_ACTION_HEADERS.keyId]: TELEGRAM_PRIVATE_ACTION_KEY_ID,
        [TELEGRAM_PRIVATE_ACTION_HEADERS.timestamp]: timestamp,
        [TELEGRAM_PRIVATE_ACTION_HEADERS.nonce]: nonce,
        [TELEGRAM_PRIVATE_ACTION_HEADERS.signature]: createTelegramPrivateActionSignatureForTest(
          transportHmacSecret,
          timestamp,
          nonce,
          rawBody,
        ),
      },
      rawHeaders: [
        'content-type',
        TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
        TELEGRAM_PRIVATE_ACTION_HEADERS.keyId,
        TELEGRAM_PRIVATE_ACTION_KEY_ID,
        TELEGRAM_PRIVATE_ACTION_HEADERS.timestamp,
        timestamp,
        TELEGRAM_PRIVATE_ACTION_HEADERS.nonce,
        nonce,
        TELEGRAM_PRIVATE_ACTION_HEADERS.signature,
        createTelegramPrivateActionSignatureForTest(transportHmacSecret, timestamp, nonce, rawBody),
      ],
    },
    rawBody,
  } as const;
}

describe('private Telegram action transport contract', () => {
  it('authenticates an exact callback envelope and dispatches only through the test seam', async () => {
    const dispatcher = new InMemoryTelegramPrivateActionDispatcher();
    const { request, rawBody } = signedRequest();

    await expect(
      verifyAndDispatchTelegramPrivateActionForTest(
        request,
        rawBody,
        verificationOptions(),
        dispatcher,
      ),
    ).resolves.toBe(true);
    expect(dispatcher.snapshotForTest()).toEqual([callbackAction]);
  });

  it('rejects changed raw bytes before parsing or dispatching', async () => {
    const dispatcher = new InMemoryTelegramPrivateActionDispatcher();
    const { request, rawBody } = signedRequest();
    const tamperedBody = Buffer.from(rawBody.toString('utf8').replace('123456', '123457'), 'utf8');

    await expect(
      verifyAndDispatchTelegramPrivateActionForTest(
        request,
        tamperedBody,
        verificationOptions(),
        dispatcher,
      ),
    ).resolves.toBe(false);
    expect(dispatcher.snapshotForTest()).toEqual([]);
  });

  it('rejects stale timestamps and replayed action nonces', async () => {
    const stale = signedRequest(callbackAction, { timestamp: '1700000000' });
    await expect(
      verifyTelegramPrivateActionRequest(stale.request, stale.rawBody, verificationOptions()),
    ).resolves.toBeUndefined();

    const nonceStore = new InMemoryTelegramPrivateActionNonceStore();
    const current = signedRequest();
    await expect(
      verifyTelegramPrivateActionRequest(
        current.request,
        current.rawBody,
        verificationOptions(nonceStore),
      ),
    ).resolves.toEqual(callbackAction);
    await expect(
      verifyTelegramPrivateActionRequest(
        current.request,
        current.rawBody,
        verificationOptions(nonceStore),
      ),
    ).resolves.toBeUndefined();
  });

  it('passes only a domain-separated nonce digest to the action store', async () => {
    let receivedDigest: string | undefined;
    const nonceStore = {
      durable: false,
      reserve: async (nonceDigest: string) => {
        receivedDigest = nonceDigest;
        return true;
      },
    };
    const current = signedRequest();

    await expect(
      verifyTelegramPrivateActionRequest(current.request, current.rawBody, {
        ...verificationOptions(),
        nonceStore,
      }),
    ).resolves.toEqual(callbackAction);
    expect(receivedDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(receivedDigest).not.toBe(fixedNonce);
  });

  it('rejects duplicate authentication headers and malformed callbacks', async () => {
    const malformedAction = {
      ...callbackAction,
      callbackData: 'start:player-registration',
    } as const;
    const malformed = signedRequest(malformedAction);
    await expect(
      verifyTelegramPrivateActionRequest(
        malformed.request,
        malformed.rawBody,
        verificationOptions(),
      ),
    ).resolves.toBeUndefined();

    const signed = signedRequest();
    const duplicateRequest = {
      ...signed.request,
      rawHeaders: [
        ...signed.request.rawHeaders,
        TELEGRAM_PRIVATE_ACTION_HEADERS.nonce,
        'o'.repeat(32),
      ],
    };
    await expect(
      verifyTelegramPrivateActionRequest(duplicateRequest, signed.rawBody, verificationOptions()),
    ).resolves.toBeUndefined();

    const fallbackContentEncodingArrayRequest = {
      ...signed.request,
      headers: {
        ...signed.request.headers,
        'content-encoding': ['gzip'],
      } as unknown as IncomingHttpHeaders,
    };
    await expect(
      verifyTelegramPrivateActionRequest(
        fallbackContentEncodingArrayRequest,
        signed.rawBody,
        verificationOptions(),
      ),
    ).resolves.toBeUndefined();
  });

  it('accepts only bounded, control-character-free English Player ID text', async () => {
    const validAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'player_id_text',
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en',
      playerId: 'player-123',
    };
    const valid = signedRequest(validAction);
    await expect(
      verifyTelegramPrivateActionRequest(valid.request, valid.rawBody, verificationOptions()),
    ).resolves.toEqual(validAction);

    const control = signedRequest({ ...validAction, playerId: 'player\u0000id' });
    await expect(
      verifyTelegramPrivateActionRequest(control.request, control.rawBody, verificationOptions()),
    ).resolves.toBeUndefined();

    const tooLong = signedRequest({ ...validAction, playerId: 'x'.repeat(65) });
    await expect(
      verifyTelegramPrivateActionRequest(tooLong.request, tooLong.rawBody, verificationOptions()),
    ).resolves.toBeUndefined();

    const nonEnglish = signedRequest(validAction, {
      rawBody: Buffer.from(JSON.stringify({ ...validAction, preferredLocale: 'am' }), 'utf8'),
    });
    await expect(
      verifyTelegramPrivateActionRequest(
        nonEnglish.request,
        nonEnglish.rawBody,
        verificationOptions(),
      ),
    ).resolves.toBeUndefined();
  });

  it('redacts opaque callback tokens and Player ID text from the only log projection', () => {
    const redactedCallback = JSON.stringify(redactTelegramPrivateActionForLog(callbackAction));
    const playerId = 'player-123';
    const playerAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'player_id_text',
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en',
      playerId,
    };
    const redactedPlayer = JSON.stringify(redactTelegramPrivateActionForLog(playerAction));

    expect(redactedCallback).not.toContain(callbackData);
    expect(redactedCallback).not.toContain('_____________________w');
    expect(redactedPlayer).not.toContain(playerId);
    expect(redactedCallback).toContain('"preferredLocale":"en"');
  });

  it('does not create an action route or database runtime when every gate is false', async () => {
    const config = loadApiConfig({ NODE_ENV: 'test' });
    const app = buildApp(config, {
      createPostgresTelegramIngressRuntime: () => {
        throw new Error('disabled action channel must not create a database runtime');
      },
    });

    expect(config.telegramActionChannel).toEqual({
      enabled: false,
      transportHmacSecret: undefined,
    });
    expect(config.postgresRuntime.enabled).toBe(false);
    expect(config.telegramPrivateIngressRuntime.enabled).toBe(false);
    expect(
      (await app.inject({ method: 'POST', url: TELEGRAM_PRIVATE_ACTION_PATH })).statusCode,
    ).toBe(404);
    await app.close();
  });
});
