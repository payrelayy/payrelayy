import { createHash } from 'node:crypto';

import { loadApiConfig } from '@fetanagent/config/api';
import { describe, expect, it, vi } from 'vitest';

import { encodeTelegramCapabilityId } from './telegram-action-capability.js';
import {
  CAPTURE_TELEGRAM_CBE_BIRR_BOUND_PROOF_SQL,
  captureTelegramCbeBirrBoundProof,
  TelegramCbeBirrBoundProofIntakeUnavailableError,
  type TelegramCbeBirrBoundProofAction,
  type TelegramCbeBirrBoundProofDatabase,
} from './telegram-cbe-birr-bound-proof-intake.js';

const inboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const instructionId = '17830f40-ef8f-4fe4-ab6b-57187c93e81e';
const proofId = '6e41f167-b917-4417-92f1-38b1951d6ce3';
const config = loadApiConfig({
  NODE_ENV: 'test',
  INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
  INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
  INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
  PLAYER_ACTION_DEPLOYMENT_TARGET: 'staging',
  BOT_TO_API_ACTION_HMAC_SECRET: 'a'.repeat(64),
  API_TELEGRAM_CAPABILITY_HMAC_SECRET: 'b'.repeat(64),
  API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: 'c'.repeat(64),
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
  DEPOSIT_PROOF_REFERENCE_PROFILE: JSON.stringify({
    encryptionMasterFingerprint: `sha256:${createHash('sha256')
      .update(Buffer.from('1'.repeat(64), 'hex'))
      .digest('hex')}`,
    fingerprintMasterFingerprint: `sha256:${createHash('sha256')
      .update(Buffer.from('2'.repeat(64), 'hex'))
      .digest('hex')}`,
    version: 2,
  }),
  PLAYER_ACTION_DATABASE_URL:
    'postgres://fetanagent_player_actions_runtime:password@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full',
});
const action: TelegramCbeBirrBoundProofAction = {
  version: 1,
  kind: 'deposit_proof_command',
  updateId: '10',
  telegramUserId: '20',
  privateChatId: '20',
  preferredLocale: 'en',
  providerCode: 'cbe_birr',
  playerId: 'PLAYER-DEMO-42',
  transactionReference: 'SYNTHETICREF7890',
  instructionToken: encodeTelegramCapabilityId(instructionId),
};

describe('dormant CBE Birr instruction-bound proof adapter', () => {
  it('sends only protected reference fields and one instruction ID to the private dry-run RPC', async () => {
    const calls: Array<{ readonly query: string; readonly values: readonly unknown[] }> = [];
    const database: TelegramCbeBirrBoundProofDatabase = {
      async query(query, values) {
        calls.push({ query, values });
        return {
          rows: [
            {
              deposit_proof_request_id: proofId,
              provider_code: 'cbe_birr',
              proof_status: 'proof_received',
              submitted_at: new Date('2026-10-18T00:00:00.000Z'),
              request_replayed: false,
            },
          ],
        };
      },
    };

    await expect(
      captureTelegramCbeBirrBoundProof(database, inboundEventId, action, config),
    ).resolves.toEqual({
      version: 1,
      outcome: 'deposit_proof_received',
      proofToken: encodeTelegramCapabilityId(proofId),
      providerCode: 'cbe_birr',
      providerName: 'CBE Birr',
      proofStatus: 'proof_received',
      financialMode: 'dry_run',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe(CAPTURE_TELEGRAM_CBE_BIRR_BOUND_PROOF_SQL);
    expect(calls[0]?.query).not.toMatch(/settle|credit|execute|transfer/iu);
    expect(calls[0]?.values.slice(0, 3)).toEqual([instructionId, inboundEventId, action.playerId]);
    expect(calls[0]?.values[3]).toMatch(
      /^v2\.cbe_birr\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    expect(calls[0]?.values[4]).toMatch(/^[0-9a-f]{64}$/u);
    expect(calls[0]?.values[5]).toBe('***7890');
    expect(calls[0]?.values.slice(6, 8)).toEqual([2, 2]);
    expect(calls[0]?.values[8]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
    expect(JSON.stringify(calls)).not.toContain(action.transactionReference);
  });

  it('fails before SQL without a valid token, dry-run mode, or CBE provider', async () => {
    const database = { query: vi.fn() } as unknown as TelegramCbeBirrBoundProofDatabase;
    await expect(
      captureTelegramCbeBirrBoundProof(
        database,
        inboundEventId,
        { ...action, instructionToken: 'invalid' },
        config,
      ),
    ).rejects.toBeInstanceOf(TelegramCbeBirrBoundProofIntakeUnavailableError);
    await expect(
      captureTelegramCbeBirrBoundProof(database, inboundEventId, action, {
        ...config,
        financialActionsMode: 'live',
      }),
    ).rejects.toBeInstanceOf(TelegramCbeBirrBoundProofIntakeUnavailableError);
    await expect(
      captureTelegramCbeBirrBoundProof(
        database,
        inboundEventId,
        {
          ...action,
          providerCode: 'telebirr',
        },
        config,
      ),
    ).rejects.toBeInstanceOf(TelegramCbeBirrBoundProofIntakeUnavailableError);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects extra database fields and hides SQL errors', async () => {
    await expect(
      captureTelegramCbeBirrBoundProof(
        {
          query: async () => ({
            rows: [
              {
                deposit_proof_request_id: proofId,
                provider_code: 'cbe_birr',
                proof_status: 'proof_received',
                submitted_at: new Date('2026-10-18T00:00:00.000Z'),
                request_replayed: false,
                candidate_reference_ciphertext: 'must-not-escape',
              },
            ],
          }),
        },
        inboundEventId,
        action,
        config,
      ),
    ).rejects.toBeInstanceOf(TelegramCbeBirrBoundProofIntakeUnavailableError);
    await expect(
      captureTelegramCbeBirrBoundProof(
        {
          query: async () => {
            throw new Error('private SQL detail');
          },
        },
        inboundEventId,
        action,
        config,
      ),
    ).rejects.toEqual(new TelegramCbeBirrBoundProofIntakeUnavailableError());
  });
});
