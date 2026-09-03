import type { TelegramPrivateActionEnvelope } from '@fetanagent/contracts';
import { describe, expect, it } from 'vitest';

import {
  TelegramPrivateActionDeliveryError,
  deliverTelegramPrivateAction,
  deliverTelegramPrivateActionWithRetry,
} from './telegram-private-action-client.js';
import {
  reduceTelegramDepositProofCommand,
  reduceTelegramDepositProofStatusCallbackAction,
  reduceTelegramDepositStatusCommand,
} from './telegram-private-action.js';
import { presentTelegramPlayerIdFlowResult } from './telegram-player-id-flow.js';

const action: TelegramPrivateActionEnvelope = {
  version: 1,
  kind: 'root_menu',
  updateId: '10',
  telegramUserId: '20',
  privateChatId: '20',
  preferredLocale: 'en',
};
const config = {
  baseUrl: 'http://api:3000/',
  transportHmacSecret: 'a'.repeat(64),
};

describe('Telegram private-action bot client', () => {
  it('signs the exact serialized bytes and accepts only a strict safe result', async () => {
    let captured: RequestInit | undefined;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        now: () => new Date('2026-08-11T12:00:00.000Z'),
        nonce: () => 'n'.repeat(32),
        fetch: async (_input, init) => {
          captured = init;
          return {
            status: 200,
            json: async () => ({ version: 1, outcome: 'player_id_pending' }),
          };
        },
      }),
    ).resolves.toEqual({ version: 1, outcome: 'player_id_pending' });
    expect(Buffer.from(captured?.body as Uint8Array).toString('utf8')).toBe(JSON.stringify(action));
    expect(captured?.headers).toMatchObject({
      'content-type': 'application/vnd.fetanagent.telegram-private-action+json',
      'x-fetanagent-action-nonce': 'n'.repeat(32),
    });
    expect(JSON.stringify(captured?.headers)).not.toContain(config.transportHmacSecret);
  });

  it('uses two fresh nonces at most for retryable failures', async () => {
    const nonces = ['a'.repeat(32), 'b'.repeat(32)];
    const deliveredNonces: string[] = [];
    let attempts = 0;
    await expect(
      deliverTelegramPrivateActionWithRetry(action, config, {
        nonce: () => nonces[attempts] ?? 'c'.repeat(32),
        fetch: async (_input, init) => {
          const headers = init?.headers as Record<string, string>;
          deliveredNonces.push(headers['x-fetanagent-action-nonce'] ?? '');
          attempts += 1;
          return attempts === 1
            ? { status: 503, json: async () => ({}) }
            : { status: 200, json: async () => ({ version: 1, outcome: 'menu_required' }) };
        },
      }),
    ).resolves.toEqual({ version: 1, outcome: 'menu_required' });
    expect(deliveredNonces).toEqual(nonces);
  });

  it('accepts the bounded already-registered Player ID result', async () => {
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ version: 1, outcome: 'player_id_exists' }),
        }),
      }),
    ).resolves.toEqual({ version: 1, outcome: 'player_id_exists' });
  });

  it('accepts only the bounded customer projection on deposit instructions', async () => {
    const safeResult = {
      version: 1,
      outcome: 'deposit_instructions',
      depositToken: 'A'.repeat(22),
      amountMinor: '2500',
      currencyCode: 'ETB',
      providerName: 'CBE Birr',
      receiverAccountHolderName: 'FetanAgent staging',
      receiverAccountMasked: '****1234',
      customerInstruction: 'Simulation only.',
      paymentDeadline: '2026-08-12T13:00:00.000Z',
      depositStatus: { label: 'Preparing deposit', tone: 'working' },
      financialMode: 'live',
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => safeResult }),
      }),
    ).resolves.toEqual(safeResult);

    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({
            ...safeResult,
            depositStatus: {
              label: 'Preparing deposit',
              tone: 'working',
              executionAttemptId: 'not-customer-safe',
            },
          }),
        }),
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
  });

  it('rejects malformed success bodies and never retries a 4xx response', async () => {
    let attempts = 0;
    await expect(
      deliverTelegramPrivateActionWithRetry(action, config, {
        fetch: async () => {
          attempts += 1;
          return { status: 401, json: async () => ({ sensitive: 'detail' }) };
        },
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    expect(attempts).toBe(1);
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ version: 1, outcome: 'menu', callbackData: 'raw-player-id' }),
        }),
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
  });

  it('accepts only exact customer-safe reference and status results', async () => {
    const referenceResult = {
      version: 1,
      outcome: 'deposit_reference_received',
      depositStatus: { label: 'Checking payment', tone: 'working' },
      financialMode: 'live',
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => referenceResult }),
      }),
    ).resolves.toEqual(referenceResult);

    const statusResult = {
      version: 1,
      outcome: 'deposit_status',
      amountMinor: '2500',
      currencyCode: 'ETB',
      depositStatus: { label: 'Completed', tone: 'success' },
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => statusResult }),
      }),
    ).resolves.toEqual(statusResult);
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ ...statusResult, executionAttemptId: 'private' }),
        }),
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
  });

  it.each(['deposit_proof_received', 'deposit_proof_status'] as const)(
    'accepts only the exact amount-free dry-run %s projection',
    async (outcome) => {
      const proofResult = {
        version: 1,
        outcome,
        proofToken: `${'B'.repeat(21)}A`,
        providerCode: 'telebirr',
        providerName: 'TeleBirr',
        proofStatus: 'proof_received',
        financialMode: 'dry_run',
      } as const;
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => proofResult }),
        }),
      ).resolves.toEqual(proofResult);

      for (const unsafeResult of [
        { ...proofResult, providerName: 'CBE Birr' },
        { ...proofResult, providerCode: 'unknown' },
        { ...proofResult, proofToken: 'B'.repeat(22) },
        { ...proofResult, proofToken: `p1.${'A'.repeat(22)}` },
        { ...proofResult, proofToken: `${'A'.repeat(22)}\n` },
        { ...proofResult, proofStatus: 'completed' },
        { ...proofResult, financialMode: 'live' },
        { ...proofResult, amountMinor: '2500' },
        { ...proofResult, transactionReference: 'SYNTHETICREF7890' },
        { ...proofResult, playerId: 'PLAYER-DEMO-42' },
        { ...proofResult, proofToken: undefined },
      ]) {
        await expect(
          deliverTelegramPrivateAction(action, config, {
            fetch: async () => ({ status: 200, json: async () => unsafeResult }),
          }),
        ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
      }
    },
  );

  it('accepts only a generic two-key status-unavailable response', async () => {
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ version: 1, outcome: 'deposit_status_unavailable' }),
        }),
      }),
    ).resolves.toEqual({ version: 1, outcome: 'deposit_status_unavailable' });
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({
            version: 1,
            outcome: 'deposit_status_unavailable',
            reason: 'foreign_customer',
          }),
        }),
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
  });

  it('roundtrips proof submission, tracking command and button through the signed client', async () => {
    const metadata = {
      updateId: 10,
      chat: { id: 20, type: 'private' },
      from: { id: 20, isBot: false, languageCode: 'en' },
    };
    const proofToken = 'A'.repeat(22);
    const proofResult = {
      version: 1,
      outcome: 'deposit_proof_received',
      proofToken,
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'proof_received',
      financialMode: 'dry_run',
    } as const;
    const submitAction = reduceTelegramDepositProofCommand({
      ...metadata,
      command: '/deposit telebirr PLAYER-DEMO-42 SYNTHETICREF7890',
    });
    expect(submitAction?.kind).toBe('deposit_proof_command');
    if (!submitAction) throw new Error('Expected a valid proof action.');
    const receipt = await deliverTelegramPrivateAction(submitAction, config, {
      fetch: async () => ({ status: 200, json: async () => proofResult }),
    });
    const presentation = presentTelegramPlayerIdFlowResult(receipt);
    expect(presentation.kind).toBe('menu');
    if (presentation.kind !== 'menu') throw new Error('Expected tracking button.');
    const command = presentation.menu.text.match(/\/deposit_status p1\.[A-Za-z0-9_-]{22}/u)?.[0];
    const commandAction = reduceTelegramDepositStatusCommand({
      ...metadata,
      updateId: 11,
      command,
    });
    const callbackAction = reduceTelegramDepositProofStatusCallbackAction({
      ...metadata,
      updateId: 11,
      callbackData: presentation.menu.buttons[0]?.callbackData,
    });
    expect(commandAction).toEqual(callbackAction);
    expect(commandAction).toMatchObject({
      kind: 'deposit_proof_status_command',
      proofToken,
      telegramUserId: '20',
      privateChatId: '20',
    });
    if (!callbackAction) throw new Error('Expected a proof status action.');
    let captured: unknown;
    const status = await deliverTelegramPrivateAction(callbackAction, config, {
      fetch: async (_url, init) => {
        captured = JSON.parse(Buffer.from(init?.body as Uint8Array).toString('utf8'));
        return {
          status: 200,
          json: async () => ({ ...proofResult, outcome: 'deposit_proof_status' }),
        };
      },
    });
    expect(captured).toEqual(callbackAction);
    expect(JSON.stringify(captured)).not.toMatch(/PLAYER-DEMO|SYNTHETICREF|transactionReference/u);
    expect(presentTelegramPlayerIdFlowResult(status)).toEqual(presentation);
  });
});
