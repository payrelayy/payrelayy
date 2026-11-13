import type { ApiConfig } from '@fetanagent/config/api';
import { screenshotReferenceVariants } from '@fetanagent/contracts';
import { fingerprintDepositProofReference } from '@fetanagent/deposit-reference-protection';
import { describe, expect, it } from 'vitest';

import {
  PROBE_RECEIVER_SMS_SCREENSHOT_REFERENCE_SQL,
  probeReceiverSmsScreenshotReference,
} from './telegram-receiver-sms-screenshot-reference-probe.js';

const config = {
  financialActionsMode: 'live',
  telegramPlayerActionRuntime: {
    enabled: true,
    receiverSmsCandidateProductionEnabled: true,
    deploymentTarget: 'production',
    depositProofReferenceProfileVersion: 2,
    depositProofReferenceFingerprintMasterSecret: '2'.repeat(64),
  },
} as unknown as ApiConfig;
const action = {
  version: 1,
  kind: 'receiver_sms_screenshot_reference_probe',
  providerCode: 'telebirr',
  transactionReference: 'DK0S123456',
} as const;

describe('Receiver SMS screenshot reference probe', () => {
  it('queries only blinded variants and returns a bounded correction index', async () => {
    const calls: Array<{ query: string; values: readonly unknown[] }> = [];
    const result = await probeReceiverSmsScreenshotReference(
      {
        async query(query, values) {
          calls.push({ query, values });
          return { rows: [{ correction_index: 1 }] };
        },
      },
      action,
      config,
    );
    expect(result).toEqual({
      version: 1,
      outcome: 'receiver_sms_screenshot_reference_probe',
      correctionIndex: 1,
    });
    expect(calls[0]?.query).toBe(PROBE_RECEIVER_SMS_SCREENSHOT_REFERENCE_SQL);
    expect(calls[0]?.values[0]).toBe('telebirr');
    expect(calls[0]?.values[1]).toEqual(
      screenshotReferenceVariants(action.transactionReference).map((reference) =>
        fingerprintDepositProofReference({
          provider: 'telebirr',
          reference,
          fingerprintSecret: '2'.repeat(64),
        }),
      ),
    );
    expect(JSON.stringify(calls)).not.toContain(action.transactionReference);
  });

  it('rejects malformed database results and never probes when production intake is off', async () => {
    await expect(
      probeReceiverSmsScreenshotReference(
        {
          async query() {
            return { rows: [{ correction_index: 16 }] };
          },
        },
        action,
        config,
      ),
    ).rejects.toThrow(/unavailable/u);
    await expect(
      probeReceiverSmsScreenshotReference(
        {
          async query() {
            throw new Error('must not query');
          },
        },
        action,
        {
          ...config,
          telegramPlayerActionRuntime: {
            ...config.telegramPlayerActionRuntime,
            receiverSmsCandidateProductionEnabled: false,
          },
        } as ApiConfig,
      ),
    ).rejects.toThrow(/unavailable/u);
  });

  it('preserves the ordinary screenshot route before the staged database grant', async () => {
    for (const code of ['42883', '42501']) {
      await expect(
        probeReceiverSmsScreenshotReference(
          {
            async query() {
              throw Object.assign(new Error('probe unavailable'), { code });
            },
          },
          action,
          config,
        ),
      ).resolves.toEqual({
        version: 1,
        outcome: 'receiver_sms_screenshot_reference_probe',
        correctionIndex: null,
      });
    }
  });
});
