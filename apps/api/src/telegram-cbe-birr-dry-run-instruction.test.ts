import { createHash } from 'node:crypto';

import { loadApiConfig } from '@fetanagent/config/api';
import { describe, expect, it, vi } from 'vitest';

import { encodeTelegramCapabilityId } from './telegram-action-capability.js';
import {
  ISSUE_TELEGRAM_CBE_BIRR_DRY_RUN_INSTRUCTION_SQL,
  issueTelegramCbeBirrDryRunInstruction,
  TelegramCbeBirrInstructionUnavailableError,
  type TelegramCbeBirrInstructionDatabase,
} from './telegram-cbe-birr-dry-run-instruction.js';

const inboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const instructionId = '17830f40-ef8f-4fe4-ab6b-57187c93e81e';
const playerId = 'PLAYER-DEMO-42';
const issuedAt = new Date('2026-10-18T00:00:00.000Z');
const expiresAt = new Date('2026-10-18T01:00:00.000Z');

const config = loadApiConfig({
  NODE_ENV: 'test',
  INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
  INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
  INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
  PLAYER_ACTION_DEPLOYMENT_TARGET: 'staging',
  TELEGRAM_CBE_BIRR_BOUND_DRY_RUN_STAGING_ENABLED: 'true',
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

describe('Telegram CBE Birr no-money instruction issuer', () => {
  it('creates a distinct semantic HMAC and returns only an opaque one-hour preview', async () => {
    const calls: Array<{ readonly query: string; readonly values: readonly unknown[] }> = [];
    const database: TelegramCbeBirrInstructionDatabase = {
      async query(query, values) {
        calls.push({ query, values });
        return {
          rows: [
            {
              instruction_id: instructionId,
              issued_at: issuedAt,
              expires_at: expiresAt,
              request_replayed: false,
            },
          ],
        };
      },
    };
    await expect(
      issueTelegramCbeBirrDryRunInstruction(database, inboundEventId, playerId, config),
    ).resolves.toEqual({
      instructionToken: encodeTelegramCapabilityId(instructionId),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      acceptsPayments: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toBe(ISSUE_TELEGRAM_CBE_BIRR_DRY_RUN_INSTRUCTION_SQL);
    expect(calls[0]!.values.slice(0, 2)).toEqual([inboundEventId, playerId]);
    expect(calls[0]!.values[2]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
    expect(calls[0]!.query).not.toMatch(/credit|execute|transfer|receiver.*ciphertext/iu);
  });

  it('fails before SQL outside dry-run mode or with a malformed event', async () => {
    const database = { query: vi.fn() } as unknown as TelegramCbeBirrInstructionDatabase;
    await expect(
      issueTelegramCbeBirrDryRunInstruction(database, inboundEventId, playerId, {
        ...config,
        financialActionsMode: 'live',
      }),
    ).rejects.toBeInstanceOf(TelegramCbeBirrInstructionUnavailableError);
    await expect(
      issueTelegramCbeBirrDryRunInstruction(database, 'invalid', playerId, config),
    ).rejects.toBeInstanceOf(TelegramCbeBirrInstructionUnavailableError);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects extra or invalid SQL fields without leaking private details', async () => {
    for (const row of [
      {
        instruction_id: instructionId,
        issued_at: issuedAt,
        expires_at: expiresAt,
        request_replayed: false,
        receiver_ciphertext: 'private',
      },
      {
        instruction_id: instructionId,
        issued_at: issuedAt,
        expires_at: new Date('2026-10-18T00:59:59.000Z'),
        request_replayed: false,
      },
    ]) {
      await expect(
        issueTelegramCbeBirrDryRunInstruction(
          { query: async () => ({ rows: [row] }) },
          inboundEventId,
          playerId,
          config,
        ),
      ).rejects.toEqual(new TelegramCbeBirrInstructionUnavailableError());
    }
  });
});
