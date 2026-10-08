import { createHash, createHmac } from 'node:crypto';

import { loadApiConfig, type ApiConfig } from '@fetanagent/config/api';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createTelegramActionSemanticHmac } from './telegram-action-capability.js';
import {
  CAPTURE_TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_SQL,
  captureTelegramRoutineTelebirrCandidate,
  TelegramRoutineTelebirrCandidateUnavailableError,
  type TelegramRoutineTelebirrCandidateDatabase,
} from './telegram-routine-telebirr-candidate-intake.js';

const inboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const proofRequestId = '6e41f167-b917-4417-92f1-38b1951d6ce3';
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
const config = loadApiConfig({
  NODE_ENV: 'test',
  INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
  INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
  INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
  TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_STAGING_ENABLED: 'true',
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
if (!config.telegramPlayerActionRuntime.enabled) {
  throw new Error('Expected the staging Player-action test fixture to be enabled.');
}
const enabledCandidateRuntime = config.telegramPlayerActionRuntime;
const productionConfig: ApiConfig = {
  ...config,
  telegramPlayerActionRuntime: {
    ...config.telegramPlayerActionRuntime,
    deploymentTarget: 'production',
  },
};
const enabledProductionConfig: ApiConfig = {
  ...productionConfig,
  financialActionsMode: 'live',
  telegramPlayerActionRuntime: {
    ...enabledCandidateRuntime,
    deploymentTarget: 'production',
    routineTelebirrCandidateStagingEnabled: false,
    routineTelebirrCandidateProductionEnabled: true,
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
  transactionReference: 'FETANTESTREF7890',
};

function acceptedDatabase(
  calls: Array<{ readonly query: string; readonly values: readonly unknown[] }>,
  proofStatus: 'untrusted_received' | 'paid_pending' = 'untrusted_received',
): TelegramRoutineTelebirrCandidateDatabase {
  return {
    async query(query, values) {
      calls.push({ query, values });
      return {
        rows: [
          {
            proof_request_id: proofRequestId,
            provider_code: 'telebirr',
            proof_status: proofStatus,
            submitted_at: new Date('2026-10-05T17:00:00.000Z'),
            request_replayed: false,
          },
        ],
      };
    },
  };
}

describe('dormant routine Telegram TeleBirr candidate adapter', () => {
  it('protects only a synthetic reference and domain-separates the amount-free RPC', async () => {
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
      captureTelegramRoutineTelebirrCandidate(
        acceptedDatabase(calls),
        inboundEventId,
        action,
        config,
      ),
    ).resolves.toEqual({
      version: 1,
      outcome: 'telebirr_routine_candidate_recorded_no_money',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'untrusted_received',
      verificationMode: 'not_started_no_money',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toBe(CAPTURE_TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_SQL);
    expect(calls[0]!.query).not.toMatch(/execute|settle|transfer|verification_job/iu);
    expect(calls[0]!.values.slice(0, 3)).toEqual([inboundEventId, action.playerId, 'telebirr']);
    expect(calls[0]!.values[3]).toMatch(
      /^v2\.telebirr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(calls[0]!.values[4]).toBe(expectedFingerprint);
    expect(calls[0]!.values[5]).toBe('***7890');
    expect(calls[0]!.values.slice(6, 8)).toEqual([2, 2]);
    expect(calls[0]!.values[8]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
    expect(JSON.stringify(calls)).not.toContain(action.transactionReference);
    expect(calls[0]!.values[8]).not.toBe(
      createTelegramActionSemanticHmac({
        consumer: 'capture_telegram_telebirr_shadow_proof',
        originInboundEventId: inboundEventId,
        playerId: action.playerId,
        providerCode: 'telebirr',
        referenceFingerprint: expectedFingerprint,
        referenceMasked: '***7890',
        keyVersion: 2,
        profileVersion: 2,
        semanticHmacSecret,
      }),
    );
  });

  it('protects a real-format production reference without sending plaintext or an amount to SQL', async () => {
    const calls: Array<{ readonly query: string; readonly values: readonly unknown[] }> = [];
    const realAction = { ...action, transactionReference: 'AB12CD34EF' };

    await expect(
      captureTelegramRoutineTelebirrCandidate(
        acceptedDatabase(calls, 'paid_pending'),
        inboundEventId,
        realAction,
        enabledProductionConfig,
      ),
    ).resolves.toMatchObject({
      outcome: 'telebirr_routine_candidate_recorded_paid_pending',
      proofStatus: 'pending_verification',
      verificationMode: 'phone_receipt_pending',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toBe(CAPTURE_TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_SQL);
    expect(calls[0]!.values).toHaveLength(9);
    expect(calls[0]!.values[3]).toMatch(/^v2\.telebirr\./u);
    expect(calls[0]!.values[5]).toBe('***34EF');
    expect(JSON.stringify(calls)).not.toContain(realAction.transactionReference);
    expect(calls[0]!.query).not.toMatch(/execute|settle|transfer|verification_job/iu);
  });

  it('never calls SQL for an unenabled target, staging/live mismatch, or mismatched reference', async () => {
    const database = { query: vi.fn() } as unknown as TelegramRoutineTelebirrCandidateDatabase;
    const denied = [
      {
        action,
        config: {
          ...config,
          telegramPlayerActionRuntime: {
            ...enabledCandidateRuntime,
            routineTelebirrCandidateStagingEnabled: false,
          },
        },
      },
      { action, config: productionConfig },
      { action, config: { ...config, financialActionsMode: 'live' as const } },
      { action: { ...action, transactionReference: 'SYNTB1234567890' }, config },
      { action: { ...action, transactionReference: 'fetanTESTREF7890' }, config },
      { action: { ...action, providerCode: 'cbe_birr' as const }, config },
      { action, config: enabledProductionConfig },
      {
        action: { ...action, transactionReference: 'ab12CD34EF' },
        config: enabledProductionConfig,
      },
      {
        action: { ...action, transactionReference: 'A'.repeat(33) },
        config: enabledProductionConfig,
      },
      {
        action: { ...action, transactionReference: 'AB12CD34ÉF' },
        config: enabledProductionConfig,
      },
    ];
    for (const attempt of denied) {
      await expect(
        captureTelegramRoutineTelebirrCandidate(
          database,
          inboundEventId,
          attempt.action as typeof action,
          attempt.config,
        ),
      ).rejects.toBeInstanceOf(TelegramRoutineTelebirrCandidateUnavailableError);
    }
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects a non-v4 event identifier before SQL', async () => {
    const database = { query: vi.fn() } as unknown as TelegramRoutineTelebirrCandidateDatabase;
    await expect(
      captureTelegramRoutineTelebirrCandidate(
        database,
        '64b27169-c249-1d2e-b312-d2ed9d6661ea',
        action,
        config,
      ),
    ).rejects.toBeInstanceOf(TelegramRoutineTelebirrCandidateUnavailableError);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects database candidate modes that disagree with the configured financial mode', async () => {
    const calls: Array<{ readonly query: string; readonly values: readonly unknown[] }> = [];
    await expect(
      captureTelegramRoutineTelebirrCandidate(
        acceptedDatabase(calls),
        inboundEventId,
        { ...action, transactionReference: 'AB12CD34EF' },
        enabledProductionConfig,
      ),
    ).rejects.toBeInstanceOf(TelegramRoutineTelebirrCandidateUnavailableError);
    await expect(
      captureTelegramRoutineTelebirrCandidate(
        acceptedDatabase(calls, 'paid_pending'),
        inboundEventId,
        action,
        config,
      ),
    ).rejects.toBeInstanceOf(TelegramRoutineTelebirrCandidateUnavailableError);
    expect(calls).toHaveLength(2);
  });

  it.each([
    { rows: [] },
    {
      rows: [
        {
          proof_request_id: proofRequestId,
          provider_code: 'telebirr',
          proof_status: 'verified',
          submitted_at: new Date('2026-10-05T17:00:00.000Z'),
          request_replayed: false,
        },
      ],
    },
    {
      rows: [
        {
          proof_request_id: proofRequestId,
          provider_code: 'telebirr',
          proof_status: 'untrusted_received',
          submitted_at: new Date('2026-10-05T17:00:00.000Z'),
          request_replayed: false,
          candidate_reference_ciphertext: 'private',
        },
      ],
    },
  ])('rejects malformed or overbroad database output', async ({ rows }) => {
    await expect(
      captureTelegramRoutineTelebirrCandidate(
        { query: async () => ({ rows }) },
        inboundEventId,
        action,
        config,
      ),
    ).rejects.toEqual(new TelegramRoutineTelebirrCandidateUnavailableError());
  });
});
