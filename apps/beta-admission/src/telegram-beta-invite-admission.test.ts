import type { IncomingHttpHeaders } from 'node:http';

import {
  TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
  TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS,
  TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
  TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
  type TelegramBetaInviteRedemption,
} from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import {
  createTelegramBetaInviteAdmissionSignatureForTest,
  InMemoryTelegramBetaInviteAdmissionNonceStore,
  PostgresTelegramBetaInviteAdmissionAdapter,
  redactTelegramBetaInviteRedemptionForLog,
  toTelegramBetaInviteRedemptionDatabaseInput,
  verifyTelegramBetaInviteAdmissionRequest,
} from './telegram-beta-invite-admission.js';
import type { TelegramBetaInviteAdmissionNonceStore } from './telegram-beta-invite-admission.js';

const transportHmacSecret = 'a'.repeat(64);
const payloadHmacSecret = 'b'.repeat(64);
const fixedNow = new Date('2026-08-09T12:00:00.000Z');
const fixedTimestamp = Math.floor(fixedNow.getTime() / 1000).toString();
const fixedNonce = 'n'.repeat(32);
const inviteToken = 'A'.repeat(43);
const redemption: TelegramBetaInviteRedemption = {
  version: 1,
  kind: 'beta_invite_redemption',
  updateId: '123456',
  telegramUserId: '28379330',
  privateChatId: '28379330',
  inviteToken,
  preferredLocale: 'en',
};

/** Test-only stand-in for a reviewed durable store; never a production implementation. */
function createDurableNonceStore(): TelegramBetaInviteAdmissionNonceStore {
  const inMemoryStore = new InMemoryTelegramBetaInviteAdmissionNonceStore();
  return {
    durable: true,
    reserve: (nonceDigest, expiresAtMs, nowMs) =>
      inMemoryStore.reserve(nonceDigest, expiresAtMs, nowMs),
  };
}

function verificationOptions(
  nonceStore: TelegramBetaInviteAdmissionNonceStore = createDurableNonceStore(),
) {
  return { transportHmacSecret, now: fixedNow, nonceStore };
}

function signedRequest(
  value: TelegramBetaInviteRedemption = redemption,
  options: { readonly nonce?: string; readonly timestamp?: string; readonly rawBody?: Buffer } = {},
) {
  const rawBody = options.rawBody ?? Buffer.from(JSON.stringify(value), 'utf8');
  const timestamp = options.timestamp ?? fixedTimestamp;
  const nonce = options.nonce ?? fixedNonce;
  const signature = createTelegramBetaInviteAdmissionSignatureForTest(
    transportHmacSecret,
    timestamp,
    nonce,
    rawBody,
  );

  return {
    request: {
      method: 'POST',
      url: TELEGRAM_BETA_INVITE_REDEMPTION_PATH,
      headers: {
        'content-type': TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
        [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.keyId]: TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
        [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.timestamp]: timestamp,
        [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce]: nonce,
        [TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature]: signature,
      },
      rawHeaders: [
        'content-type',
        TELEGRAM_BETA_INVITE_REDEMPTION_CONTENT_TYPE,
        TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.keyId,
        TELEGRAM_BETA_INVITE_REDEMPTION_KEY_ID,
        TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.timestamp,
        timestamp,
        TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce,
        nonce,
        TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.signature,
        signature,
      ],
    },
    rawBody,
  } as const;
}

describe('beta invite admission transport contract', () => {
  it('authenticates only a strict signed invite-redemption envelope', async () => {
    const { request, rawBody } = signedRequest();
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(request, rawBody, verificationOptions()),
    ).resolves.toEqual(redemption);
  });

  it('fails closed before reserving a nonce when a non-durable store is supplied at runtime', async () => {
    const signed = signedRequest();
    let reserveCalls = 0;
    const nonDurableStore = {
      durable: false as const,
      reserve: async () => {
        reserveCalls += 1;
        return true;
      },
    };

    await expect(
      verifyTelegramBetaInviteAdmissionRequest(
        signed.request,
        signed.rawBody,
        verificationOptions(nonDurableStore as unknown as TelegramBetaInviteAdmissionNonceStore),
      ),
    ).resolves.toBeUndefined();
    expect(reserveCalls).toBe(0);
  });

  it('rejects changed raw bytes, stale requests, replayed nonces, and duplicates', async () => {
    const { request, rawBody } = signedRequest();
    const changed = Buffer.from(rawBody.toString('utf8').replace('123456', '123457'), 'utf8');
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(request, changed, verificationOptions()),
    ).resolves.toBeUndefined();

    const stale = signedRequest(redemption, { timestamp: '1700000000' });
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(stale.request, stale.rawBody, verificationOptions()),
    ).resolves.toBeUndefined();

    const nonceStore = createDurableNonceStore();
    const current = signedRequest();
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(
        current.request,
        current.rawBody,
        verificationOptions(nonceStore),
      ),
    ).resolves.toEqual(redemption);
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(
        current.request,
        current.rawBody,
        verificationOptions(nonceStore),
      ),
    ).resolves.toBeUndefined();

    const duplicate = {
      ...current.request,
      rawHeaders: [
        ...current.request.rawHeaders,
        TELEGRAM_BETA_INVITE_REDEMPTION_HEADERS.nonce,
        'o'.repeat(32),
      ],
    };
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(duplicate, current.rawBody, verificationOptions()),
    ).resolves.toBeUndefined();
  });

  it('rejects fallback header arrays and an envelope with unrecognized keys', async () => {
    const signed = signedRequest();
    const fallbackContentEncodingArrayRequest = {
      ...signed.request,
      headers: {
        ...signed.request.headers,
        'content-encoding': ['gzip'],
      } as unknown as IncomingHttpHeaders,
    };
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(
        fallbackContentEncodingArrayRequest,
        signed.rawBody,
        verificationOptions(),
      ),
    ).resolves.toBeUndefined();

    const extra = signedRequest(redemption, {
      rawBody: Buffer.from(JSON.stringify({ ...redemption, firstName: 'not permitted' }), 'utf8'),
    });
    await expect(
      verifyTelegramBetaInviteAdmissionRequest(extra.request, extra.rawBody, verificationOptions()),
    ).resolves.toBeUndefined();
  });

  it('derives domain-separated digest values and never passes a raw invite token to the SQL adapter', async () => {
    const databaseInput = toTelegramBetaInviteRedemptionDatabaseInput(redemption, {
      payloadHmacSecret,
    });
    const serializedInput = JSON.stringify(databaseInput);
    expect(serializedInput).not.toContain(inviteToken);
    expect(databaseInput.inviteTokenDigest).toMatch(/^sha256-v1:[0-9a-f]{64}$/);
    expect(databaseInput.payloadHmac).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/);
    expect(JSON.stringify(redactTelegramBetaInviteRedemptionForLog(redemption))).not.toContain(
      inviteToken,
    );

    let queryValues: readonly string[] | undefined;
    const adapter = new PostgresTelegramBetaInviteAdmissionAdapter({
      query: async (_query, values) => {
        queryValues = values;
        return {
          rows: [
            {
              inbound_event_id: '7ce59f16-08e6-4c20-a694-e1f7b1b20d4d',
              received_at: fixedNow,
              inbound_event_already_recorded: false,
            },
          ],
        };
      },
    });

    await expect(adapter.redeem(databaseInput)).resolves.toMatchObject({
      inboundEventAlreadyRecorded: false,
    });
    expect(queryValues).toHaveLength(6);
    expect(JSON.stringify(queryValues)).not.toContain(inviteToken);
    expect(queryValues?.[3]).toBe(databaseInput.inviteTokenDigest);
  });

  it('rejects malformed adapter input before it can query the database', async () => {
    const databaseInput = toTelegramBetaInviteRedemptionDatabaseInput(redemption, {
      payloadHmacSecret,
    });
    let queryCalls = 0;
    const adapter = new PostgresTelegramBetaInviteAdmissionAdapter({
      query: async () => {
        queryCalls += 1;
        return { rows: [] };
      },
    });

    await expect(
      adapter.redeem({
        ...databaseInput,
        inviteTokenDigest: inviteToken,
      } as unknown as typeof databaseInput),
    ).rejects.toMatchObject({
      name: 'TelegramBetaInviteAdmissionUnavailableError',
    });
    expect(queryCalls).toBe(0);
    expect('recordAdmittedInbound' in adapter).toBe(false);
  });

  it('separates terminal invite rejection from retryable database unavailability', async () => {
    const databaseInput = toTelegramBetaInviteRedemptionDatabaseInput(redemption, {
      payloadHmacSecret,
    });
    const rejected = new PostgresTelegramBetaInviteAdmissionAdapter({
      query: async () => {
        throw { code: 'P0001', message: 'must never escape' };
      },
    });
    const unavailable = new PostgresTelegramBetaInviteAdmissionAdapter({
      query: async () => {
        throw { code: '08006', message: 'must never escape' };
      },
    });

    await expect(rejected.redeem(databaseInput)).rejects.toMatchObject({
      name: 'TelegramBetaInviteAdmissionRejectedError',
      message: 'The beta invite was not accepted.',
    });
    await expect(unavailable.redeem(databaseInput)).rejects.toMatchObject({
      name: 'TelegramBetaInviteAdmissionUnavailableError',
      message: 'The beta invite admission boundary is unavailable.',
    });
  });
});
