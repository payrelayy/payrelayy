import { createHash, createHmac } from 'node:crypto';

import { loadApiConfig } from '@fetanagent/config/api';
import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  createPostgresTelegramPlayerActionRuntime,
  type TelegramPlayerActionDatabase,
} from './postgres-telegram-player-action-runtime.js';
import { encodeTelegramCapabilityId } from './telegram-action-capability.js';

const inboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const depositIntentId = '3d8af16e-87e0-4a17-9098-b0907defd95f';
const depositSubmissionId = 'a7cfdc2e-360f-47f1-836f-e65c9239e57b';
const depositProofRequestId = '6e41f167-b917-4417-92f1-38b1951d6ce3';
const referenceKeyProfile = JSON.stringify({
  encryptionKeyFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('e'.repeat(64), 'hex'))
    .digest('hex')}`,
  fingerprintKeyFingerprint: `sha256:${createHash('sha256')
    .update(Buffer.from('f'.repeat(64), 'hex'))
    .digest('hex')}`,
  version: 1,
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
const actionConfig = loadApiConfig({
  NODE_ENV: 'test',
  INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
  INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
  INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
  BOT_TO_API_ACTION_HMAC_SECRET: 'a'.repeat(64),
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

const rootAction: TelegramPrivateActionEnvelope = {
  version: 1,
  kind: 'root_menu',
  updateId: '10',
  telegramUserId: '20',
  privateChatId: '20',
  preferredLocale: 'en',
};

describe('Postgres Telegram Player-ID action runtime', () => {
  it('publicly onboards the action update before issuing a deterministic non-financial menu', async () => {
    const calls: { query: string; values: readonly unknown[] }[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        calls.push({ query, values });
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-11T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        if (query.includes('issue_telegram_player_registration_capability')) {
          return {
            rows: [
              {
                result_capability_id: values[1],
                capability_expires_at: new Date('2026-08-11T12:05:00.000Z'),
                expected_conversation_version: '1',
                origin_inbound_event_already_consumed: false,
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };
    const runtime = createPostgresTelegramPlayerActionRuntime(actionConfig, database);
    const rawBody = Buffer.from(JSON.stringify(rootAction), 'utf8');
    const result = await runtime.handle(rootAction, rawBody);

    expect(result.outcome).toBe('menu');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.values.slice(0, 3)).toEqual(['10', '20', '20']);
    expect(calls[0]?.values[3]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/);
    expect(calls[0]?.query).toContain('record_public_telegram_action_inbound_event');
    expect(calls[0]?.query).not.toContain('record_admitted_telegram_private_inbound_event');
    expect(calls[1]?.values[0]).toBe(inboundEventId);
    expect(calls.map((call) => call.query).join('\n')).not.toContain(rawBody.toString('utf8'));
  });

  it('expires an already-stale Player-ID prompt before asking the root menu caller to restart', async () => {
    const calls: { query: string; values: readonly unknown[] }[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        calls.push({ query, values });
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-11T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        if (query.includes('issue_telegram_player_registration_capability')) {
          throw { code: 'P0001' };
        }
        if (query.includes('expire_telegram_player_registration_action')) {
          return {
            rows: [
              {
                player_registration_action_id: '8392154c-85b2-47b2-b84d-2aee97cd468f',
                action_status: 'expired',
                conversation_version: '2',
                origin_inbound_event_already_consumed: false,
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };

    await expect(
      createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
        rootAction,
        Buffer.from(JSON.stringify(rootAction), 'utf8'),
      ),
    ).resolves.toEqual({ version: 1, outcome: 'restart_required' });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.query).toContain('expire_telegram_player_registration_action');
    expect(calls[2]?.values[0]).toBe(inboundEventId);
    expect(calls[2]?.values[1]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
  });

  it('keeps an unrelated root-menu database failure fail-closed without attempting expiry', async () => {
    const calls: string[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query) {
        calls.push(query);
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-11T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        throw new Error('synthetic database failure');
      },
      async end() {},
    };

    await expect(
      createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
        rootAction,
        Buffer.from(JSON.stringify(rootAction), 'utf8'),
      ),
    ).rejects.toMatchObject({ name: 'TelegramPlayerActionRuntimeUnavailableError' });
    expect(calls).toHaveLength(2);
    expect(calls.join('\n')).not.toContain('expire_telegram_player_registration_action');
  });

  it('creates only a pending validation request for publicly onboarded Player-ID text', async () => {
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-11T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        if (query.includes('submit_telegram_player_registration_input')) {
          expect(values[1]).toBe('KM12345');
          return {
            rows: [
              {
                result_outcome: 'completed',
                result_reason_code: 'accepted_pending_validation',
                request_status: 'pending_validation',
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };
    const action: TelegramPrivateActionEnvelope = {
      ...rootAction,
      kind: 'player_id_text',
      playerId: 'KM12345',
    };
    await expect(
      createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
        action,
        Buffer.from(JSON.stringify(action), 'utf8'),
      ),
    ).resolves.toEqual({ version: 1, outcome: 'player_id_pending' });
  });

  it('reports a previously validated Player ID as already registered', async () => {
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-11T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        if (query.includes('submit_telegram_player_registration_input')) {
          expect(values[1]).toBe('KM12345');
          return {
            rows: [
              {
                result_outcome: 'completed',
                result_reason_code: 'player_registration_requested',
                request_status: 'exists',
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };
    const action: TelegramPrivateActionEnvelope = {
      ...rootAction,
      kind: 'player_id_text',
      playerId: 'KM12345',
    };

    await expect(
      createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
        action,
        Buffer.from(JSON.stringify(action), 'utf8'),
      ),
    ).resolves.toEqual({ version: 1, outcome: 'player_id_exists' });
  });

  it('opens only a CBE Birr dry-run intake for an inclusive in-range amount', async () => {
    const calls: { query: string; values: readonly unknown[] }[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        calls.push({ query, values });
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-12T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        if (query.includes('open_telegram_dry_run_deposit_intent')) {
          expect(values.slice(0, 3)).toEqual([inboundEventId, 'PLAYER-DEMO-42', '2500']);
          expect(values[3]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
          return {
            rows: [
              {
                deposit_intent_id: depositIntentId,
                provider_code: 'cbe_birr',
                receiver_account_holder_name: 'FetanAgent Staging',
                receiver_account_masked: '****1234',
                receiver_customer_instruction: 'Send only CBE Birr to the shown account.',
                expected_amount_minor: '2500',
                currency_code: 'ETB',
                payment_deadline_at: new Date('2026-08-12T13:00:00.000Z'),
                deposit_status: 'intake_received',
                origin_inbound_event_already_consumed: false,
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };
    const action: TelegramPrivateActionEnvelope = {
      ...rootAction,
      kind: 'deposit_intent_command',
      playerId: 'PLAYER-DEMO-42',
      amountEtb: '25',
    };

    await expect(
      createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
        action,
        Buffer.from(JSON.stringify(action), 'utf8'),
      ),
    ).resolves.toEqual({
      version: 1,
      outcome: 'deposit_instructions',
      depositToken: encodeTelegramCapabilityId(depositIntentId),
      amountMinor: '2500',
      currencyCode: 'ETB',
      providerName: 'CBE Birr',
      receiverAccountHolderName: 'FetanAgent Staging',
      receiverAccountMasked: '****1234',
      customerInstruction: 'Send only CBE Birr to the shown account.',
      paymentDeadline: '2026-08-12T13:00:00.000Z',
      depositStatus: { label: 'Ready to start', tone: 'neutral' },
      financialMode: 'dry_run',
    });
    expect(calls).toHaveLength(2);
  });

  it.each(['24.99', '25000.01'])(
    'rejects the out-of-range amount %s before opening an intent',
    async (amountEtb) => {
      const calls: string[] = [];
      const database: TelegramPlayerActionDatabase = {
        async query(query) {
          calls.push(query);
          if (query.includes('record_public_telegram_action_inbound_event')) {
            return {
              rows: [
                {
                  inbound_event_id: inboundEventId,
                  received_at: new Date('2026-08-12T12:00:00.000Z'),
                  inbound_event_already_recorded: false,
                },
              ],
            };
          }
          throw new Error('unexpected statement');
        },
        async end() {},
      };
      const action: TelegramPrivateActionEnvelope = {
        ...rootAction,
        kind: 'deposit_intent_command',
        playerId: 'PLAYER-DEMO-42',
        amountEtb,
      };

      await expect(
        createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
          action,
          Buffer.from(JSON.stringify(action), 'utf8'),
        ),
      ).resolves.toEqual({ version: 1, outcome: 'deposit_input_invalid' });
      expect(calls.join('\n')).not.toContain('open_telegram_dry_run_deposit_intent');
    },
  );

  it.each(['cbe_birr', 'telebirr'] as const)(
    'protects an amount-free %s proof before the dry-run database call',
    async (providerCode) => {
      const transactionReference = 'SYNTHETICREF7890';
      const fingerprintKey = createHmac('sha256', Buffer.from('2'.repeat(64), 'hex'))
        .update(
          `fetanagent:deposit-proof-reference:fingerprint-key:v2\nprovider:${providerCode}`,
          'utf8',
        )
        .digest();
      const expectedFingerprint = createHmac('sha256', fingerprintKey)
        .update(
          `fetanagent:deposit-proof-reference:fingerprint-input:v2\nprovider:${providerCode}\n`,
          'utf8',
        )
        .update(transactionReference, 'utf8')
        .digest('hex');
      const calls: { query: string; values: readonly unknown[] }[] = [];
      const database: TelegramPlayerActionDatabase = {
        async query(query, values) {
          calls.push({ query, values });
          if (query.includes('record_public_telegram_action_inbound_event')) {
            return {
              rows: [
                {
                  inbound_event_id: inboundEventId,
                  received_at: new Date('2026-08-20T12:00:00.000Z'),
                  inbound_event_already_recorded: false,
                },
              ],
            };
          }
          if (query.includes('capture_telegram_dry_run_deposit_proof')) {
            expect(values[0]).toBe(inboundEventId);
            expect(values[1]).toBe('PLAYER-DEMO-42');
            expect(values[2]).toBe(providerCode);
            expect(values[3]).toMatch(
              new RegExp(
                `^v2\\.${providerCode}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`,
                'u',
              ),
            );
            expect(values[4]).toBe(expectedFingerprint);
            expect(values[5]).toBe('***7890');
            expect(values[6]).toBe(2);
            expect(values[7]).toBe(2);
            expect(values[8]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
            expect(JSON.stringify(values)).not.toContain(transactionReference);
            return {
              rows: [
                {
                  deposit_proof_request_id: depositProofRequestId,
                  provider_code: providerCode,
                  proof_status: 'proof_received',
                  submitted_at: new Date('2026-08-20T12:00:00.000Z'),
                  request_replayed: false,
                },
              ],
            };
          }
          throw new Error('unexpected statement');
        },
        async end() {},
      };
      const action: TelegramPrivateActionEnvelope = {
        ...rootAction,
        kind: 'deposit_proof_command',
        providerCode,
        playerId: 'PLAYER-DEMO-42',
        transactionReference,
      };

      await expect(
        createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
          action,
          Buffer.from(JSON.stringify(action), 'utf8'),
        ),
      ).resolves.toEqual({
        version: 1,
        outcome: 'deposit_proof_received',
        proofToken: encodeTelegramCapabilityId(depositProofRequestId),
        providerCode,
        providerName: providerCode === 'cbe_birr' ? 'CBE Birr' : 'TeleBirr',
        proofStatus: 'proof_received',
        financialMode: 'dry_run',
      });
      expect(calls).toHaveLength(2);
      expect(calls.map((call) => call.query).join('\n')).not.toContain(transactionReference);
    },
  );

  it('keeps amount-free proof intake unavailable outside dry-run mode', async () => {
    const calls: string[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query) {
        calls.push(query);
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-20T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };
    const action: TelegramPrivateActionEnvelope = {
      ...rootAction,
      kind: 'deposit_proof_command',
      providerCode: 'telebirr',
      playerId: 'PLAYER-DEMO-42',
      transactionReference: 'SYNTHETICREF7890',
    };

    await expect(
      createPostgresTelegramPlayerActionRuntime(
        { ...actionConfig, financialActionsMode: 'live' },
        database,
      ).handle(action, Buffer.from(JSON.stringify(action), 'utf8')),
    ).resolves.toEqual({ version: 1, outcome: 'deposit_unavailable' });
    expect(calls).toHaveLength(1);
    expect(calls.join('\n')).not.toContain('capture_telegram_dry_run_deposit_proof');
  });

  it('protects a raw reference before the database call and returns no reference material', async () => {
    const transactionReference = 'tx-abc-7890';
    const fingerprintKey = createHmac('sha256', Buffer.from('f'.repeat(64), 'hex'))
      .update('fetanagent:deposit-reference:fingerprint-key:v1', 'utf8')
      .digest();
    const expectedFingerprint = createHmac('sha256', fingerprintKey)
      .update('fetanagent:deposit-reference:fingerprint-input:v1\n', 'utf8')
      .update('provider:cbe_birr\n', 'utf8')
      .update(transactionReference.toUpperCase(), 'utf8')
      .digest('hex');
    const calls: { query: string; values: readonly unknown[] }[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        calls.push({ query, values });
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2026-08-12T12:05:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        if (query.includes('capture_telegram_dry_run_deposit_reference')) {
          expect(values[0]).toBe(inboundEventId);
          expect(values[1]).toBe(depositIntentId);
          expect(values[2]).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
          expect(values[3]).toBe(expectedFingerprint);
          expect(values[4]).toBe('***7890');
          expect(values[5]).toBe(1);
          expect(values[6]).toMatch(/^hmac-sha256-v1:[0-9a-f]{64}$/u);
          expect(JSON.stringify(values)).not.toContain(transactionReference);
          return {
            rows: [
              {
                deposit_submission_id: depositSubmissionId,
                result_deposit_intent_id: depositIntentId,
                submission_status: 'received',
                submitted_at: new Date('2026-08-12T12:05:00.000Z'),
                origin_inbound_event_already_consumed: false,
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };
    const action: TelegramPrivateActionEnvelope = {
      ...rootAction,
      kind: 'deposit_reference_command',
      depositToken: encodeTelegramCapabilityId(depositIntentId),
      transactionReference,
    };

    await expect(
      createPostgresTelegramPlayerActionRuntime(actionConfig, database).handle(
        action,
        Buffer.from(JSON.stringify(action), 'utf8'),
      ),
    ).resolves.toEqual({
      version: 1,
      outcome: 'deposit_reference_received',
      depositStatus: { label: 'Ready to start', tone: 'neutral' },
      financialMode: 'dry_run',
    });
    expect(calls.map((call) => call.query).join('\n')).not.toContain(transactionReference);
  });

  it('blocks legacy amount and reference commands from every live financial path', async () => {
    const calls: string[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query) {
        calls.push(query);
        if (query.includes('record_public_telegram_action_inbound_event')) {
          return {
            rows: [
              {
                inbound_event_id: inboundEventId,
                received_at: new Date('2030-01-01T12:00:00.000Z'),
                inbound_event_already_recorded: false,
              },
            ],
          };
        }
        throw new Error('unexpected statement');
      },
      async end() {},
    };
    const runtime = createPostgresTelegramPlayerActionRuntime(
      { ...actionConfig, financialActionsMode: 'live' },
      database,
    );
    const openAction: TelegramPrivateActionEnvelope = {
      ...rootAction,
      kind: 'deposit_intent_command',
      playerId: 'PLAYER-DEMO-42',
      amountEtb: '25',
    };
    await expect(
      runtime.handle(openAction, Buffer.from(JSON.stringify(openAction), 'utf8')),
    ).resolves.toEqual({ version: 1, outcome: 'deposit_unavailable' });
    const referenceAction: TelegramPrivateActionEnvelope = {
      ...rootAction,
      updateId: '11',
      kind: 'deposit_reference_command',
      depositToken: encodeTelegramCapabilityId(depositIntentId),
      transactionReference: 'LEGACYREF7890',
    };
    await expect(
      runtime.handle(referenceAction, Buffer.from(JSON.stringify(referenceAction), 'utf8')),
    ).resolves.toEqual({ version: 1, outcome: 'deposit_unavailable' });
    expect(calls).toHaveLength(2);
    expect(calls.join('\n')).not.toMatch(
      /open_telegram_(?:dry_run|live)_deposit_intent|capture_telegram_(?:dry_run|live)_deposit_reference/u,
    );
  });
});
