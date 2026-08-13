import type { IncomingHttpHeaders } from 'node:http';

import { loadApiConfig } from '@fetanagent/config/api';
import {
  TELEGRAM_PRIVATE_ACTION_CONTENT_TYPE,
  TELEGRAM_PRIVATE_ACTION_HEADERS,
  TELEGRAM_PRIVATE_ACTION_KEY_ID,
  TELEGRAM_PRIVATE_ACTION_PATH,
  type TelegramPrivateActionEnvelope,
} from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import {
  createTelegramPrivateActionSignatureForTest,
  InMemoryTelegramPrivateActionDispatcher,
  InMemoryTelegramPrivateActionNonceStore,
  redactTelegramPrivateActionForLog,
  type TelegramPrivateActionNonceStore,
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

function durableNonceStore(
  memoryStore = new InMemoryTelegramPrivateActionNonceStore(),
): TelegramPrivateActionNonceStore {
  return {
    durable: true,
    reserve: (nonceDigest, expiresAt, now) => memoryStore.reserve(nonceDigest, expiresAt, now),
  };
}

function verificationOptions(nonceStore = durableNonceStore()) {
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

    const nonceStore = durableNonceStore();
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
      durable: true as const,
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

  it('accepts only strict dry-run deposit commands and protected references', async () => {
    const depositAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'deposit_intent_command',
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en',
      playerId: '28379330',
      amountEtb: '25.00',
    };
    const deposit = signedRequest(depositAction);
    await expect(
      verifyTelegramPrivateActionRequest(deposit.request, deposit.rawBody, verificationOptions()),
    ).resolves.toEqual(depositAction);

    const malformedAmount = signedRequest({ ...depositAction, amountEtb: '25.000' });
    await expect(
      verifyTelegramPrivateActionRequest(
        malformedAmount.request,
        malformedAmount.rawBody,
        verificationOptions(),
      ),
    ).resolves.toBeUndefined();

    const referenceAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'deposit_reference_command',
      updateId: '123457',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en',
      depositToken: 'AAAAAAAAAAAAAAAAAAAAAA',
      transactionReference: 'CBE-TEST-7890',
    };
    const reference = signedRequest(referenceAction, { nonce: 'o'.repeat(32) });
    await expect(
      verifyTelegramPrivateActionRequest(
        reference.request,
        reference.rawBody,
        verificationOptions(),
      ),
    ).resolves.toEqual(referenceAction);

    const malformedReference = signedRequest(
      { ...referenceAction, transactionReference: ' CBE-TEST-7890' },
      { nonce: 'p'.repeat(32) },
    );
    await expect(
      verifyTelegramPrivateActionRequest(
        malformedReference.request,
        malformedReference.rawBody,
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

  it('registers only the isolated action route when all Player-ID gates are explicit', async () => {
    const config = loadApiConfig({
      NODE_ENV: 'test',
      INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
      INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
      INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
      BOT_TO_API_ACTION_HMAC_SECRET: transportHmacSecret,
      API_TELEGRAM_CAPABILITY_HMAC_SECRET: 'b'.repeat(64),
      API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: 'c'.repeat(64),
      API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET: 'd'.repeat(64),
      API_DEPOSIT_REFERENCE_PROTECTION_SECRET: 'e'.repeat(64),
      PLAYER_ACTION_DATABASE_URL:
        'postgres://fetanagent_player_actions_runtime:password@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full',
    });
    let handled: TelegramPrivateActionEnvelope | undefined;
    let closed = 0;
    const app = buildApp(config, {
      now: () => fixedNow,
      postgresTelegramPlayerActionRuntime: {
        nonceStore: {
          durable: true,
          reserve: async () => true,
        },
        async handle(action) {
          handled = action;
          return { version: 1, outcome: 'awaiting_player_id' };
        },
        async ready() {
          return true;
        },
        async close() {
          closed += 1;
        },
      },
    });
    const signed = signedRequest();
    const response = await app.inject({
      method: 'POST',
      url: TELEGRAM_PRIVATE_ACTION_PATH,
      headers: signed.request.headers as Record<string, string>,
      payload: signed.rawBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: 1, outcome: 'awaiting_player_id' });
    expect(handled).toEqual(callbackAction);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    await app.close();
    expect(closed).toBe(1);
  });
});
