import { createHash, createHmac } from 'node:crypto';

import { loadApiConfig } from '@fetanagent/config/api';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createTelegramActionSemanticHmac } from './telegram-action-capability.js';
import {
  CAPTURE_TELEGRAM_TELEBIRR_SHADOW_PROOF_SQL,
  captureTelegramTelebirrShadowProof,
  TelegramTelebirrShadowProofIntakeUnavailableError,
  type TelegramTelebirrShadowProofDatabase,
} from './telegram-telebirr-shadow-proof-intake.js';

const inboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const shadowProofRequestId = '6e41f167-b917-4417-92f1-38b1951d6ce3';
const shadowVerificationJobId = 'b7de0dac-a890-4a31-9140-888a20f2089f';
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
): TelegramTelebirrShadowProofDatabase {
  return {
    async query(query, values) {
      calls.push({ query, values });
      return {
        rows: [
          {
            shadow_proof_request_id: shadowProofRequestId,
            shadow_verification_job_id: shadowVerificationJobId,
            provider_code: 'telebirr',
            proof_status: 'verification_queued',
            submitted_at: new Date('2026-09-10T08:00:00.000Z'),
            request_replayed: false,
          },
        ],
      };
    },
  };
}

describe('Telegram TeleBirr no-money shadow proof intake', () => {
  it('protects the reference and calls only the exact shadow RPC with lane-bound semantics', async () => {
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
      captureTelegramTelebirrShadowProof(acceptedDatabase(calls), inboundEventId, action, config),
    ).resolves.toEqual({
      version: 1,
      outcome: 'telebirr_shadow_verification_queued',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'verification_queued',
      verificationMode: 'shadow_no_money',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe(CAPTURE_TELEGRAM_TELEBIRR_SHADOW_PROOF_SQL);
    expect(calls[0]?.query).toContain('app.capture_telegram_telebirr_shadow_proof(');
    expect(calls[0]?.query).not.toMatch(/live|execute|settle|transfer/iu);
    expect(calls[0]?.values.slice(0, 3)).toEqual([inboundEventId, action.playerId, 'telebirr']);
    expect(calls[0]?.values[3]).toMatch(
      /^v2\.telebirr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(calls[0]?.values[4]).toBe(expectedFingerprint);
    expect(calls[0]?.values[5]).toBe('***7890');
    expect(calls[0]?.values[6]).toBe(2);
    expect(calls[0]?.values[7]).toBe(2);
    expect(calls[0]?.values[8]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
    expect(JSON.stringify(calls)).not.toContain(action.transactionReference);

    const dryRunHmac = createTelegramActionSemanticHmac({
      consumer: 'capture_dry_run_deposit_proof',
      originInboundEventId: inboundEventId,
      playerId: action.playerId,
      providerCode: 'telebirr',
      referenceFingerprint: expectedFingerprint,
      referenceMasked: '***7890',
      keyVersion: 2,
      profileVersion: 2,
      semanticHmacSecret,
    });
    expect(calls[0]?.values[8]).not.toBe(dryRunHmac);
  });

  it('fails before PostgreSQL outside dry-run mode or for a non-TeleBirr action', async () => {
    const database = { query: vi.fn() } as unknown as TelegramTelebirrShadowProofDatabase;

    await expect(
      captureTelegramTelebirrShadowProof(database, inboundEventId, action, {
        ...config,
        financialActionsMode: 'live',
      }),
    ).rejects.toBeInstanceOf(TelegramTelebirrShadowProofIntakeUnavailableError);
    await expect(
      captureTelegramTelebirrShadowProof(
        database,
        inboundEventId,
        { ...action, providerCode: 'cbe_birr' } as unknown as typeof action,
        config,
      ),
    ).rejects.toBeInstanceOf(TelegramTelebirrShadowProofIntakeUnavailableError);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('replaces protection and database details with one generic unavailable error', async () => {
    await expect(
      captureTelegramTelebirrShadowProof(
        {
          query: async () => {
            throw new Error('private pilot, customer, player, and receipt details');
          },
        },
        inboundEventId,
        action,
        config,
      ),
    ).rejects.toEqual(new TelegramTelebirrShadowProofIntakeUnavailableError());
    await expect(
      captureTelegramTelebirrShadowProof(
        { query: vi.fn() } as unknown as TelegramTelebirrShadowProofDatabase,
        inboundEventId,
        { ...action, transactionReference: 'not valid' },
        config,
      ),
    ).rejects.toEqual(new TelegramTelebirrShadowProofIntakeUnavailableError());
  });

  it.each([
    { rows: [] },
    {
      rows: [
        {
          shadow_proof_request_id: shadowProofRequestId,
          shadow_verification_job_id: shadowVerificationJobId,
          provider_code: 'telebirr',
          proof_status: 'proof_received',
          submitted_at: new Date('2026-09-10T08:00:00.000Z'),
          request_replayed: false,
        },
      ],
    },
    {
      rows: [
        {
          shadow_proof_request_id: shadowProofRequestId,
          shadow_verification_job_id: shadowVerificationJobId,
          provider_code: 'cbe_birr',
          proof_status: 'verification_queued',
          submitted_at: new Date('2026-09-10T08:00:00.000Z'),
          request_replayed: false,
        },
      ],
    },
    {
      rows: [
        {
          shadow_proof_request_id: shadowProofRequestId,
          shadow_verification_job_id: shadowVerificationJobId,
          provider_code: 'telebirr',
          proof_status: 'verification_queued',
          submitted_at: new Date('2026-09-10T08:00:00.000Z'),
          request_replayed: false,
          candidate_reference_ciphertext: 'must-not-escape',
        },
      ],
    },
  ])('rejects malformed or overbroad database output', async ({ rows }) => {
    await expect(
      captureTelegramTelebirrShadowProof(
        { query: async () => ({ rows }) },
        inboundEventId,
        action,
        config,
      ),
    ).rejects.toBeInstanceOf(TelegramTelebirrShadowProofIntakeUnavailableError);
  });
});
