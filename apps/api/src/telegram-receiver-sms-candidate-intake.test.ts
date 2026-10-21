import type { ApiConfig } from '@fetanagent/config/api';
import { describe, expect, it } from 'vitest';

import {
  CAPTURE_TELEGRAM_RECEIVER_SMS_CANDIDATE_SQL,
  captureTelegramReceiverSmsCandidate,
} from './telegram-receiver-sms-candidate-intake.js';

const inboundId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';
const config = {
  financialActionsMode: 'live',
  telegramActionCapability: { enabled: true, semanticHmacSecret: '3'.repeat(64) },
  telegramPlayerActionRuntime: {
    enabled: true,
    receiverSmsCandidateProductionEnabled: true,
    deploymentTarget: 'production',
    depositProofReferenceProfileVersion: 2,
    depositProofReferenceEncryptionMasterSecret: '1'.repeat(64),
    depositProofReferenceFingerprintMasterSecret: '2'.repeat(64),
  },
} as unknown as ApiConfig;

describe('Telegram receiver SMS candidate intake', () => {
  it.each(['telebirr', 'cbe_birr'] as const)(
    'protects %s proof and uses the same candidate-only RPC',
    async (providerCode) => {
      const calls: Array<{ query: string; values: readonly unknown[] }> = [];
      const database = {
        async query(query: string, values: readonly unknown[]) {
          calls.push({ query, values });
          return {
            rows: [
              {
                candidate_id: candidateId,
                proof_status: 'ready',
                submitted_at: new Date(),
                request_replayed: false,
              },
            ],
          };
        },
      };
      const outcome = await captureTelegramReceiverSmsCandidate(
        database,
        inboundId,
        {
          version: 1,
          kind: 'deposit_proof_command',
          updateId: '100',
          telegramUserId: '200',
          privateChatId: '200',
          preferredLocale: 'en',
          providerCode,
          playerId: 'PLAYER-DEMO-42',
          transactionReference: 'SYNTHSMS1234',
        },
        config,
      );
      expect(outcome).toEqual({
        version: 1,
        outcome: 'receiver_sms_candidate_received',
        providerCode,
        providerName: providerCode === 'telebirr' ? 'TeleBirr' : 'CBE Birr',
        matchStatus: 'ready',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.query).toBe(CAPTURE_TELEGRAM_RECEIVER_SMS_CANDIDATE_SQL);
      expect(JSON.stringify(calls)).not.toContain('SYNTHSMS1234');
      expect(calls[0]?.values[2]).toBe(providerCode);
      expect(calls[0]?.values[6]).toBe(2);
      expect(calls[0]?.values[7]).toBe(2);
    },
  );

  it('fails closed before a database call when its production route is disabled', async () => {
    let called = false;
    await expect(
      captureTelegramReceiverSmsCandidate(
        {
          async query() {
            called = true;
            return { rows: [] };
          },
        },
        inboundId,
        {
          version: 1,
          kind: 'deposit_proof_command',
          updateId: '100',
          telegramUserId: '200',
          privateChatId: '200',
          preferredLocale: 'en',
          providerCode: 'telebirr',
          playerId: 'PLAYER-DEMO-42',
          transactionReference: 'SYNTHSMS1234',
        },
        {
          ...config,
          telegramPlayerActionRuntime: {
            ...config.telegramPlayerActionRuntime,
            receiverSmsCandidateProductionEnabled: false,
          },
        } as ApiConfig,
      ),
    ).rejects.toThrow(/unavailable/u);
    expect(called).toBe(false);
  });
});
