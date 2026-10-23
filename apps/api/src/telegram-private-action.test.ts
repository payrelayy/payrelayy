import type { IncomingHttpHeaders } from 'node:http';
import { createHash } from 'node:crypto';

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
  parseTelegramPrivateActionEnvelope,
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
const referenceKeyProfile = JSON.stringify({
  encryptionKeyFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('e'.repeat(64), 'hex'))
    .digest('hex')}`,
  fingerprintKeyFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('f'.repeat(64), 'hex'))
    .digest('hex')}`,
  version: 1,
});

describe('bot-only deposit outcome actions', () => {
  it('accepts only exact claim and lease-completion envelopes', () => {
    const claim = { version: 1, kind: 'deposit_outcome_claim' };
    const complete = {
      version: 1,
      kind: 'deposit_outcome_complete',
      notificationId: '7e868cac-6ef2-4203-ad6e-449043111937',
      leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
      deliveryResult: 'sent',
      telegramMessageId: 42,
    };
    expect(parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(claim)))).toEqual(claim);
    expect(parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(complete)))).toEqual(
      complete,
    );
    for (const invalid of [
      { ...claim, telegramUserId: '123' },
      { ...complete, deliveryResult: 'sent', telegramMessageId: null },
      { ...complete, deliveryResult: 'retry', telegramMessageId: 42 },
      { ...complete, notificationId: 'not-a-uuid' },
    ]) {
      expect(
        parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(invalid))),
      ).toBeUndefined();
    }
  });
});
describe('bot-only Player validation outcome actions', () => {
  it('accepts only exact claim and lease-completion envelopes', () => {
    const claim = { version: 1, kind: 'player_validation_outcome_claim' };
    const complete = {
      version: 1,
      kind: 'player_validation_outcome_complete',
      notificationId: '7e868cac-6ef2-4203-ad6e-449043111937',
      leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
      deliveryResult: 'sent',
      telegramMessageId: 42,
    };
    expect(parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(claim)))).toEqual(claim);
    expect(parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(complete)))).toEqual(
      complete,
    );
    for (const invalid of [
      { ...claim, telegramUserId: '123' },
      { ...complete, deliveryResult: 'sent', telegramMessageId: null },
      { ...complete, deliveryResult: 'retry', telegramMessageId: 42 },
      { ...complete, notificationId: 'not-a-uuid' },
    ]) {
      expect(
        parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(invalid))),
      ).toBeUndefined();
    }
  });
});
describe('bot-only temporary deposit message actions', () => {
  it('accepts only exact, bounded message tracking and deletion leases', () => {
    const record = {
      version: 1,
      kind: 'deposit_temporary_record',
      updateId: '123',
      privateChatId: '123456789',
      telegramMessageId: 42,
    };
    const cancel = { ...record, kind: 'deposit_temporary_cancel' };
    const claim = { version: 1, kind: 'deposit_temporary_cleanup_claim' };
    const complete = {
      version: 1,
      kind: 'deposit_temporary_cleanup_complete',
      updateId: '123',
      leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
      deletionResult: 'deleted',
    };
    for (const action of [record, cancel, claim, complete]) {
      expect(parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(action)))).toEqual(
        action,
      );
    }
    for (const invalid of [
      { ...record, privateChatId: '0' },
      { ...record, telegramMessageId: 0 },
      { ...record, receiptReference: 'should-not-be-here' },
      { ...claim, telegramUserId: '123456789' },
      { ...complete, leaseToken: 'not-a-uuid' },
      { ...complete, deletionResult: 'credited' },
    ]) {
      expect(
        parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(invalid))),
      ).toBeUndefined();
    }
  });
});
const proofReferenceProfile = JSON.stringify({
  encryptionMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('1'.repeat(64), 'hex'))
    .digest('hex')}`,
  fingerprintMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('2'.repeat(64), 'hex'))
    .digest('hex')}`,
  version: 2,
});
const callbackAction: TelegramPrivateActionEnvelope = {
  version: 1,
  kind: 'player_registration_callback',
  updateId: '123456',
  telegramUserId: '28379330',
  privateChatId: '28379330',
  preferredLocale: 'en',
  callbackData,
};

describe('staging CBE Birr command envelope', () => {
  const identity = {
    version: 1,
    updateId: '123456',
    telegramUserId: '28379330',
    privateChatId: '28379330',
    preferredLocale: 'en',
  } as const;
  const instruction = {
    ...identity,
    kind: 'cbe_birr_dry_run_instruction_command',
    playerId: 'PLAYER-DEMO-42',
  };
  const proof = {
    ...identity,
    kind: 'cbe_birr_bound_dry_run_proof_command',
    instructionToken: 'AAAAAAAAAAAAAAAAAAAAAA',
    playerId: 'PLAYER-DEMO-42',
    transactionReference: 'SYNTHCBE0001',
  };

  it('accepts only exact synthetic instruction and bound-proof shapes', () => {
    for (const action of [instruction, proof]) {
      expect(parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(action)))).toEqual(
        action,
      );
    }
    for (const action of [
      { ...instruction, amountEtb: '25' },
      { ...proof, transactionReference: 'REALREF1234' },
      { ...proof, transactionReference: 'synthcbe0001' },
      { ...proof, instructionToken: 'invalid' },
      { ...proof, receiverAccountReference: '0000000042' },
    ]) {
      expect(
        parseTelegramPrivateActionEnvelope(Buffer.from(JSON.stringify(action))),
      ).toBeUndefined();
    }
  });
});

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

  it('accepts only an exact TeleBirr destination-selection envelope', async () => {
    const destinationAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'telebirr_deposit_destination_command',
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en',
      playerId: 'PLAYER-DEMO-42',
    };
    const valid = signedRequest(destinationAction);
    await expect(
      verifyTelegramPrivateActionRequest(valid.request, valid.rawBody, verificationOptions()),
    ).resolves.toEqual(destinationAction);

    for (const malformedAction of [
      { ...destinationAction, playerId: ' PLAYER-DEMO-42' },
      { ...destinationAction, playerId: 'PLAYER DEMO 42' },
      { ...destinationAction, providerCode: 'telebirr' },
    ]) {
      const malformed = signedRequest(malformedAction as unknown as TelegramPrivateActionEnvelope);
      await expect(
        verifyTelegramPrivateActionRequest(
          malformed.request,
          malformed.rawBody,
          verificationOptions(),
        ),
      ).resolves.toBeUndefined();
    }
  });

  it('accepts only exact saved-Player and direct TeleBirr actions', async () => {
    const identity = {
      version: 1 as const,
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en' as const,
    };
    const actions: TelegramPrivateActionEnvelope[] = [
      { ...identity, kind: 'save_player_selection_command', playerId: 'PLAYER-DEMO-42' },
      { ...identity, kind: 'player_validation_request_command', playerId: 'PLAYER-DEMO-42' },
      { ...identity, kind: 'saved_telebirr_destination_command' },
      { ...identity, kind: 'saved_telebirr_proof_command', transactionReference: 'SYNTB00000001' },
    ];
    for (const action of actions) {
      const valid = signedRequest(action);
      await expect(
        verifyTelegramPrivateActionRequest(valid.request, valid.rawBody, verificationOptions()),
      ).resolves.toEqual(action);
      const pollutedPayload: unknown = { ...action, providerCode: 'cbe_birr' };
      const polluted = signedRequest(pollutedPayload as TelegramPrivateActionEnvelope);
      await expect(
        verifyTelegramPrivateActionRequest(
          polluted.request,
          polluted.rawBody,
          verificationOptions(),
        ),
      ).resolves.toBeUndefined();
    }
    const invalidPlayer = signedRequest({
      ...identity,
      kind: 'save_player_selection_command',
      playerId: ' PLAYER-DEMO-42',
    });
    await expect(
      verifyTelegramPrivateActionRequest(
        invalidPlayer.request,
        invalidPlayer.rawBody,
        verificationOptions(),
      ),
    ).resolves.toBeUndefined();
    for (const playerId of [' PLAYER-DEMO-42', 'PLAYER DEMO', 'PLAYER/DEMO', '']) {
      const invalidRequest = signedRequest({
        ...identity,
        kind: 'player_validation_request_command',
        playerId,
      });
      await expect(
        verifyTelegramPrivateActionRequest(
          invalidRequest.request,
          invalidRequest.rawBody,
          verificationOptions(),
        ),
      ).resolves.toBeUndefined();
    }
  });

  it('requires a canonical nonempty provider list for a combined destination', async () => {
    const identity = {
      version: 1 as const,
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en' as const,
    };
    for (const providerCodes of [['telebirr'], ['cbe_birr'], ['telebirr', 'cbe_birr']] as const) {
      const action: TelegramPrivateActionEnvelope = {
        ...identity,
        kind: 'saved_combined_destination_command',
        providerCodes,
      };
      const valid = signedRequest(action);
      await expect(
        verifyTelegramPrivateActionRequest(valid.request, valid.rawBody, verificationOptions()),
      ).resolves.toEqual(action);
    }
    for (const providerCodes of [
      [],
      ['cbe_birr', 'telebirr'],
      ['telebirr', 'telebirr'],
      ['unknown'],
    ]) {
      const invalid = signedRequest({
        ...identity,
        kind: 'saved_combined_destination_command',
        providerCodes,
      } as unknown as TelegramPrivateActionEnvelope);
      await expect(
        verifyTelegramPrivateActionRequest(invalid.request, invalid.rawBody, verificationOptions()),
      ).resolves.toBeUndefined();
    }
  });

  it('accepts only an exact provider-coded saved SMS proof', async () => {
    const identity = {
      version: 1 as const,
      updateId: '123456',
      telegramUserId: '28379330',
      privateChatId: '28379330',
      preferredLocale: 'en' as const,
    };
    const action: TelegramPrivateActionEnvelope = {
      ...identity,
      kind: 'saved_receiver_sms_proof_command',
      providerCode: 'cbe_birr',
      transactionReference: 'SYNTHCBE1234',
    };
    const valid = signedRequest(action);
    await expect(
      verifyTelegramPrivateActionRequest(valid.request, valid.rawBody, verificationOptions()),
    ).resolves.toEqual(action);
    for (const invalid of [
      { ...action, providerCode: 'unknown' },
      { ...action, amountMinor: 2500 },
    ]) {
      const request = signedRequest(invalid as TelegramPrivateActionEnvelope);
      await expect(
        verifyTelegramPrivateActionRequest(request.request, request.rawBody, verificationOptions()),
      ).resolves.toBeUndefined();
    }
  });

  it('accepts only strict deposit, protected-reference, and status commands', async () => {
    const depositAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'deposit_intent_command',
      updateId: '123456',
      telegramUserId: '123456789',
      privateChatId: '123456789',
      preferredLocale: 'en',
      playerId: 'PLAYER-DEMO-42',
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
      telegramUserId: '123456789',
      privateChatId: '123456789',
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

    const fullyRevealedReference = signedRequest(
      { ...referenceAction, transactionReference: 'ABCD' },
      { nonce: 'r'.repeat(32) },
    );
    await expect(
      verifyTelegramPrivateActionRequest(
        fullyRevealedReference.request,
        fullyRevealedReference.rawBody,
        verificationOptions(),
      ),
    ).resolves.toBeUndefined();

    const proofAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'deposit_proof_command',
      updateId: '123459',
      telegramUserId: '123456789',
      privateChatId: '123456789',
      preferredLocale: 'en',
      providerCode: 'telebirr',
      playerId: 'PLAYER-DEMO-42',
      transactionReference: 'SYNTHETICREF7890',
    };
    const proof = signedRequest(proofAction, { nonce: 's'.repeat(32) });
    await expect(
      verifyTelegramPrivateActionRequest(proof.request, proof.rawBody, verificationOptions()),
    ).resolves.toEqual(proofAction);

    for (const malformedProof of [
      { ...proofAction, providerCode: 'unknown' },
      { ...proofAction, transactionReference: 'raw reference' },
      { ...proofAction, unexpected: true },
    ]) {
      const signed = signedRequest(malformedProof as unknown as TelegramPrivateActionEnvelope, {
        nonce: 't'.repeat(32),
      });
      await expect(
        verifyTelegramPrivateActionRequest(signed.request, signed.rawBody, verificationOptions()),
      ).resolves.toBeUndefined();
    }

    const statusAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'deposit_status_command',
      updateId: '123458',
      telegramUserId: '123456789',
      privateChatId: '123456789',
      preferredLocale: 'en',
      depositToken: 'AAAAAAAAAAAAAAAAAAAAAA',
    };
    const status = signedRequest(statusAction, { nonce: 'q'.repeat(32) });
    await expect(
      verifyTelegramPrivateActionRequest(status.request, status.rawBody, verificationOptions()),
    ).resolves.toEqual(statusAction);
  });

  it('authenticates only a canonical customer-scoped proof-status envelope', async () => {
    const action: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'deposit_proof_status_command',
      updateId: '123460',
      telegramUserId: '123456789',
      privateChatId: '123456789',
      preferredLocale: 'en',
      proofToken: 'bkHxZ7kXRBeS8TixlR1s4w',
    };
    const signed = signedRequest(action);
    await expect(
      verifyTelegramPrivateActionRequest(signed.request, signed.rawBody, verificationOptions()),
    ).resolves.toEqual(action);

    for (const malformed of [
      { ...action, proofToken: `p1.${action.proofToken}` },
      { ...action, proofToken: 'B'.repeat(22) },
      { ...action, proofToken: `${action.proofToken}\n` },
      { ...action, proofToken: null },
      { ...action, privateChatId: '999999999' },
      { ...action, customerId: 'untrusted-customer' },
      { ...action, depositToken: action.proofToken },
    ]) {
      const request = signedRequest(malformed as unknown as TelegramPrivateActionEnvelope);
      await expect(
        verifyTelegramPrivateActionRequest(request.request, request.rawBody, verificationOptions()),
      ).resolves.toBeUndefined();
    }
    expect(JSON.stringify(redactTelegramPrivateActionForLog(action))).not.toContain(
      action.proofToken,
    );
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
    const proofReference = 'SYNTHETICREF7890';
    const proofPlayerId = 'PLAYER-DEMO-42';
    const proofAction: TelegramPrivateActionEnvelope = {
      ...playerAction,
      kind: 'deposit_proof_command',
      providerCode: 'telebirr',
      playerId: proofPlayerId,
      transactionReference: proofReference,
    };
    const redactedProof = JSON.stringify(redactTelegramPrivateActionForLog(proofAction));

    expect(redactedCallback).not.toContain(callbackData);
    expect(redactedCallback).not.toContain('_____________________w');
    expect(redactedPlayer).not.toContain(playerId);
    expect(redactedProof).not.toContain(proofPlayerId);
    expect(redactedProof).not.toContain(proofReference);
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
      PLAYER_ACTION_DEPLOYMENT_TARGET: 'staging',
      BOT_TO_API_ACTION_HMAC_SECRET: transportHmacSecret,
      API_TELEGRAM_CAPABILITY_HMAC_SECRET: 'b'.repeat(64),
      API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: 'c'.repeat(64),
      API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET: 'd'.repeat(64),
      CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: 'e'.repeat(64),
      CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: 'f'.repeat(64),
      CBE_DEPOSIT_REFERENCE_KEY_PROFILE: referenceKeyProfile,
      DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET: '1'.repeat(64),
      DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET: '2'.repeat(64),
      DEPOSIT_PROOF_REFERENCE_PROFILE: proofReferenceProfile,
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
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({
      runtimeContract: {
        financialActionsMode: 'dry_run',
        playerActionRuntimeEnabled: true,
        depositProofReferenceMastersConfigured: true,
        depositProofReferenceProfileVersion: 2,
      },
    });
    await app.close();
    expect(closed).toBe(1);
  });
});
