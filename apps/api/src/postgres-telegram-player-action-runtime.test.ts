import { loadApiConfig } from '@payreplayy/config/api';
import type { TelegramPrivateActionEnvelope } from '@payreplayy/contracts';
import { describe, expect, it } from 'vitest';

import {
  createPostgresTelegramPlayerActionRuntime,
  type TelegramPlayerActionDatabase,
} from './postgres-telegram-player-action-runtime.js';

const inboundEventId = '64b27169-c249-4d2e-b312-d2ed9d6661ea';
const actionConfig = loadApiConfig({
  NODE_ENV: 'test',
  INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true',
  INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true',
  INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true',
  BOT_TO_API_ACTION_HMAC_SECRET: 'a'.repeat(64),
  API_TELEGRAM_CAPABILITY_HMAC_SECRET: 'b'.repeat(64),
  API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET: 'c'.repeat(64),
  API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET: 'd'.repeat(64),
  PLAYER_ACTION_DATABASE_URL:
    'postgres://payreplayy_player_actions_runtime:password@db.spzpiyxheappsfyswewl.supabase.co:5432/postgres?sslmode=verify-full',
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
  it('records the admitted update before issuing a deterministic non-financial menu', async () => {
    const calls: { query: string; values: readonly unknown[] }[] = [];
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        calls.push({ query, values });
        if (query.includes('record_admitted_telegram_private_inbound_event')) {
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
    expect(calls[1]?.values[0]).toBe(inboundEventId);
    expect(calls.map((call) => call.query).join('\n')).not.toContain(rawBody.toString('utf8'));
  });

  it('creates only a pending validation request for admitted Player-ID text', async () => {
    const database: TelegramPlayerActionDatabase = {
      async query(query, values) {
        if (query.includes('record_admitted_telegram_private_inbound_event')) {
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
});
