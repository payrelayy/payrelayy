import { createHash, createHmac } from 'node:crypto';

import { loadApiConfig, type ApiConfig } from '@fetanagent/config/api';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createTelegramActionSemanticHmac,
  encodeTelegramCapabilityId,
} from './telegram-action-capability.js';
import {
  CAPTURE_TELEGRAM_LIVE_TELEBIRR_PROOF_SQL,
  captureTelegramLiveTelebirrProof,
  TelegramLiveTelebirrProofIntakeUnavailableError,
  type TelegramLiveTelebirrProofDatabase,
} from './telegram-telebirr-live-proof-intake.js';

const inboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const liveProofId = '6e41f167-b917-4417-92f1-38b1951d6ce3';
const liveVerificationJobId = 'b7de0dac-a890-4a31-9140-888a20f2089f';
const semanticHmacSecret = 'c'.repeat(64);
const referenceProfile = JSON.stringify({
  encryptionMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('1'.repeat(64), 'hex'))
    .digest('hex')}`,
  fingerprintMasterFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('2'.repeat(64), 'hex'))
    .digest('hex')}`,
  version: 2,
});
const baseConfig = loadApiConfig({
  NODE_ENV: 'test',
  INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
  INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
  INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
  PLAYER_ACTION_DEPLOYMENT_TARGET: 'staging',
  BOT_TO_API_ACTION_HMAC_SECRET: 'a'.repeat(64),
  API_TELEGRAM_CAPABILITY_HMAC_SECRET: 'b'.repeat(64),
  API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: semanticHmacSecret,
  API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET: 'd'.repeat(64),
  CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: 'e'.repeat(64),
  CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: 'f'.repeat(64),
  CBE_DEPOSIT_REFERENCE_KEY_PROFILE: JSON.stringify({
    encryptionKeyFingerprint: `sha256:${createHash('sha256')
      .update(Buffer.from('e'.repeat(64), 'hex'))
      .digest('hex')}`,
    fingerprintKeyFingerprint: `sha256:${createHash('sha256')
      .update(Buffer.from('f'.repeat(64), 'hex'))
      .digest('hex')}`,
    version: 1,
  }),
  DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET: '1'.repeat(64),
  DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET: '2'.repeat(64),
  DEPOSIT_PROOF_REFERENCE_PROFILE: referenceProfile,
  PLAYER_ACTION_DATABASE_URL:
    'postgres://fetanagent_player_actions_runtime:password@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full',
});
if (!baseConfig.telegramPlayerActionRuntime.enabled) {
  throw new Error('Expected the Telegram Player-action runtime test fixture to be enabled.');
}
const enabledPlayerActionRuntime = baseConfig.telegramPlayerActionRuntime;
const liveConfig: ApiConfig = {
  ...baseConfig,
  financialActionsMode: 'live',
  telegramPlayerActionRuntime: enabledPlayerActionRuntime,
};
const receiverReviewLiveConfig: ApiConfig = {
  ...liveConfig,
  telegramPlayerActionRuntime: {
    ...enabledPlayerActionRuntime,
    telebirrReceiverReviewEnabled: true,
  },
};
const action: Extract<TelegramPrivateActionEnvelope, { kind: 'deposit_proof_command' }> = {
  version: 1,
  kind: 'deposit_proof_command',
  updateId: '10',
  telegramUserId: '20',
  privateChatId: '20',
  preferredLocale: 'en',
  providerCode: 'telebirr',
  playerId: 'PLAYER-DEMO-42',
  transactionReference: 'SYNTHETICREF7890',
};

function acceptedDatabase(
  calls: Array<{ readonly query: string; readonly values: readonly unknown[] }>,
): TelegramLiveTelebirrProofDatabase {
  return {
    async query(query, values) {
      calls.push({ query, values });
      return {
        rows: [
          {
            live_proof_id: liveProofId,
            live_verification_job_id: liveVerificationJobId,
            provider_code: 'telebirr',
            proof_status: 'verification_pending',
            submitted_at: new Date('2026-09-15T08:00:00.000Z'),
            request_replayed: false,
          },
        ],
      };
    },
  };
}

describe('Telegram live TeleBirr proof intake', () => {
  it('protects the reference and calls only the exact proof-to-verifier RPC', async () => {
    const calls: Array<{ readonly query: string; readonly values: readonly unknown[] }> = [];
    const expectedFingerprintKey = createHmac('sha256', Buffer.from('2'.repeat(64), 'hex'))
      .update('fetanagent:deposit-proof-reference:fingerprint-key:v2\nprovider:telebirr', 'utf8')
      .digest();
    const expectedFingerprint = createHmac('sha256', expectedFingerprintKey)
      .update(
        'fetanagent:deposit-proof-reference:fingerprint-input:v2\nprovider:telebirr\n',
        'utf8',
      )
      .update(action.transactionReference, 'utf8')
      .digest('hex');

    await expect(
      captureTelegramLiveTelebirrProof(acceptedDatabase(calls), inboundEventId, action, liveConfig),
    ).resolves.toEqual({
      version: 1,
      outcome: 'telebirr_live_verification_queued',
      proofToken: encodeTelegramCapabilityId(liveProofId),
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      depositStatus: { label: 'Checking payment', tone: 'working' },
      financialMode: 'live',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe(CAPTURE_TELEGRAM_LIVE_TELEBIRR_PROOF_SQL);
    expect(calls[0]?.query).toContain('app.capture_telegram_live_telebirr_proof(');
    expect(calls[0]?.query).not.toMatch(/execute|settle|transfer/iu);
    expect(calls[0]?.values.slice(0, 3)).toEqual([inboundEventId, action.playerId, 'telebirr']);
    expect(calls[0]?.values[3]).toMatch(
      /^v2\.telebirr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(calls[0]?.values[4]).toBe(expectedFingerprint);
    expect(calls[0]?.values[5]).toBe('***7890');
    expect(calls[0]?.values.slice(6, 8)).toEqual([2, 2]);
    expect(calls[0]?.values[8]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
    expect(JSON.stringify(calls)).not.toContain(action.transactionReference);

    const shadowHmac = createTelegramActionSemanticHmac({
      consumer: 'capture_telegram_telebirr_shadow_proof',
      originInboundEventId: inboundEventId,
      playerId: action.playerId,
      providerCode: 'telebirr',
      referenceFingerprint: expectedFingerprint,
      referenceMasked: '***7890',
      keyVersion: 2,
      profileVersion: 2,
      semanticHmacSecret,
    });
    expect(calls[0]?.values[8]).not.toBe(shadowHmac);
  });

  it('fails before PostgreSQL unless every API-side live gate is exact', async () => {
    const database = { query: vi.fn() } as unknown as TelegramLiveTelebirrProofDatabase;
    await expect(
      captureTelegramLiveTelebirrProof(database, inboundEventId, action, baseConfig),
    ).rejects.toBeInstanceOf(TelegramLiveTelebirrProofIntakeUnavailableError);
    await expect(
      captureTelegramLiveTelebirrProof(database, inboundEventId, action, receiverReviewLiveConfig),
    ).rejects.toBeInstanceOf(TelegramLiveTelebirrProofIntakeUnavailableError);
    await expect(
      captureTelegramLiveTelebirrProof(
        database,
        inboundEventId,
        { ...action, providerCode: 'cbe_birr' } as unknown as typeof action,
        liveConfig,
      ),
    ).rejects.toBeInstanceOf(TelegramLiveTelebirrProofIntakeUnavailableError);
    expect(database.query).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    {
      rows: [
        {
          live_proof_id: liveProofId,
          live_verification_job_id: liveVerificationJobId,
          provider_code: 'telebirr',
          proof_status: 'verified',
          submitted_at: new Date('2026-09-15T08:00:00.000Z'),
          request_replayed: false,
        },
      ],
    },
    {
      rows: [
        {
          live_proof_id: liveProofId,
          live_verification_job_id: liveVerificationJobId,
          provider_code: 'telebirr',
          proof_status: 'verification_pending',
          submitted_at: new Date('2026-09-15T08:00:00.000Z'),
          request_replayed: false,
          candidate_reference_ciphertext: 'must-not-escape',
        },
      ],
    },
  ])(
    'replaces malformed, overbroad, or private database output with one error',
    async ({ rows }) => {
      await expect(
        captureTelegramLiveTelebirrProof(
          { query: async () => ({ rows }) },
          inboundEventId,
          action,
          liveConfig,
        ),
      ).rejects.toEqual(new TelegramLiveTelebirrProofIntakeUnavailableError());
    },
  );
});
