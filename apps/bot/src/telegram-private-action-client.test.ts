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
  it('accepts only the non-payable CBE Birr staging instruction preview', async () => {
    const preview = {
      version: 1,
      outcome: 'cbe_birr_dry_run_instruction_preview',
      instructionToken: 'AAAAAAAAAAAAAAAAAAAAAA',
      expiresAt: '2026-10-18T01:00:00.000Z',
      acceptsPayments: false,
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => preview }),
      }),
    ).resolves.toEqual(preview);
    for (const invalid of [
      { ...preview, acceptsPayments: true },
      { ...preview, receiverAccountReference: '0000000042' },
      { ...preview, instructionToken: 'invalid' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => invalid }),
        }),
      ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    }
  });

  it('accepts only a bounded selected Player in private menu and receiver results', async () => {
    const callbackData = 'prc1.AAAAAAAAAAAAAAAAAAAAAA._____________________w';
    const menu = { version: 1, outcome: 'menu', callbackData, selectedPlayerId: 'PLAYER-DEMO-42' };
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => menu }),
      }),
    ).resolves.toEqual(menu);
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ ...menu, selectedPlayerId: 'BAD PLAYER' }),
        }),
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({
            ...menu,
            selectedPlayerId: 'PLAYER-DEMO-42',
            receiverAccountReference: '0000000042',
          }),
        }),
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
  });
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

  it('accepts only the minimal queued Player validation result', async () => {
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ version: 1, outcome: 'player_validation_queued' }),
        }),
      }),
    ).resolves.toEqual({ version: 1, outcome: 'player_validation_queued' });
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({
            version: 1,
            outcome: 'player_validation_queued',
            playerId: 'PLAYER-DEMO-42',
          }),
        }),
      }),
    ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
  });

  it('accepts only a bounded bot-only Player validation delivery', async () => {
    const claim: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'player_validation_outcome_claim',
    };
    const delivery = {
      version: 1,
      outcome: 'player_validation_outcome_delivery',
      notificationId: '7e868cac-6ef2-4203-ad6e-449043111937',
      leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
      privateChatId: '123456789',
      outcomeCode: 'selected',
    } as const;
    for (const response of [
      { version: 1, outcome: 'player_validation_outcome_none' },
      delivery,
      { ...delivery, outcomeCode: 'review_required' },
      { version: 1, outcome: 'player_validation_outcome_completed', accepted: true },
    ]) {
      await expect(
        deliverTelegramPrivateAction(claim, config, {
          fetch: async () => ({ status: 200, json: async () => response }),
        }),
      ).resolves.toEqual(response);
    }
    for (const invalid of [
      { ...delivery, outcomeCode: 'approved_without_find' },
      { ...delivery, privateChatId: '0' },
      { ...delivery, playerId: '28379330' },
      { ...delivery, notificationId: 'not-a-uuid' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(claim, config, {
          fetch: async () => ({ status: 200, json: async () => invalid }),
        }),
      ).rejects.toBeInstanceOf(TelegramPrivateActionDeliveryError);
    }
  });

  it('accepts exact one-hour instruction record and expiry responses', async () => {
    const recordAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'payment_instruction_record',
      updateId: '10',
      privateChatId: '20',
      telegramMessageId: 42,
    };
    const claimAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'payment_instruction_expiry_claim',
    };
    const delivery = {
      version: 1,
      outcome: 'payment_instruction_expiry_delivery',
      instructionEventId: '7e868cac-6ef2-4203-ad6e-449043111937',
      leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
      privateChatId: '123456789',
      telegramMessageId: 42,
      suppressMenu: false,
    } as const;
    const completeAction: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'payment_instruction_expiry_complete',
      instructionEventId: delivery.instructionEventId,
      leaseToken: delivery.leaseToken,
      expiryResult: 'complete',
    };

    for (const [request, response] of [
      [recordAction, { version: 1, outcome: 'payment_instruction_recorded', accepted: true }],
      [recordAction, { version: 1, outcome: 'payment_instruction_recorded', accepted: false }],
      [claimAction, { version: 1, outcome: 'payment_instruction_expiry_none' }],
      [claimAction, delivery],
      [
        completeAction,
        { version: 1, outcome: 'payment_instruction_expiry_completed', accepted: true },
      ],
    ] as const) {
      await expect(
        deliverTelegramPrivateAction(request, config, {
          fetch: async () => ({ status: 200, json: async () => response }),
        }),
      ).resolves.toEqual(response);
    }

    for (const invalid of [
      { ...delivery, instructionEventId: 'not-a-uuid' },
      { ...delivery, privateChatId: '0' },
      { ...delivery, telegramMessageId: 0 },
      { ...delivery, suppressMenu: 'false' },
      { ...delivery, receiverAccountReference: 'must-not-leak' },
      { version: 1, outcome: 'payment_instruction_recorded', accepted: true, extra: 1 },
    ]) {
      await expect(
        deliverTelegramPrivateAction(claimAction, config, {
          fetch: async () => ({ status: 200, json: async () => invalid }),
        }),
      ).rejects.toBeInstanceOf(TelegramPrivateActionDeliveryError);
    }
  });

  it('accepts only an amount-free, masked verified-waiting notification', async () => {
    const waiting = {
      version: 1,
      outcome: 'deposit_outcome_delivery',
      notificationId: '7e868cac-6ef2-4203-ad6e-449043111937',
      leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
      privateChatId: '123456789',
      outcomeCode: 'verified_waiting',
      amountMinor: null,
      referenceMasked: '***1A2B',
    } as const;
    const claim: TelegramPrivateActionEnvelope = { version: 1, kind: 'deposit_outcome_claim' };
    await expect(
      deliverTelegramPrivateAction(claim, config, {
        fetch: async () => ({ status: 200, json: async () => waiting }),
      }),
    ).resolves.toEqual(waiting);
    await expect(
      deliverTelegramPrivateAction(claim, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ ...waiting, outcomeCode: 'checking' }),
        }),
      }),
    ).resolves.toEqual({ ...waiting, outcomeCode: 'checking' });
    await expect(
      deliverTelegramPrivateAction(claim, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ ...waiting, outcomeCode: 'already_used' }),
        }),
      }),
    ).resolves.toEqual({ ...waiting, outcomeCode: 'already_used' });
    await expect(
      deliverTelegramPrivateAction(claim, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ ...waiting, outcomeCode: 'wrong_receiver' }),
        }),
      }),
    ).resolves.toEqual({ ...waiting, outcomeCode: 'wrong_receiver' });
    await expect(
      deliverTelegramPrivateAction(claim, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ ...waiting, outcomeCode: 'manual_review' }),
        }),
      }),
    ).resolves.toEqual({ ...waiting, outcomeCode: 'manual_review' });
    await expect(
      deliverTelegramPrivateAction(claim, config, {
        fetch: async () => ({
          status: 200,
          json: async () => ({ ...waiting, amountMinor: '3000' }),
        }),
      }),
    ).rejects.toBeInstanceOf(TelegramPrivateActionDeliveryError);
  });

  it('accepts a bounded bot-owned temporary deletion lease and rejects extra data', async () => {
    const claim: TelegramPrivateActionEnvelope = {
      version: 1,
      kind: 'deposit_temporary_cleanup_claim',
    };
    const delivery = {
      version: 1,
      outcome: 'deposit_temporary_cleanup_delivery',
      updateId: '123',
      leaseToken: '03618c2d-47d4-44ea-b681-9c4a0a4d1fab',
      privateChatId: '123456789',
      telegramMessageId: 42,
    };
    await expect(
      deliverTelegramPrivateAction(claim, config, {
        fetch: async () => ({ status: 200, json: async () => delivery }),
      }),
    ).resolves.toEqual(delivery);
    for (const invalid of [
      { ...delivery, privateChatId: '0' },
      { ...delivery, telegramMessageId: 0 },
      { ...delivery, paymentReference: 'must-not-leak' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(claim, config, {
          fetch: async () => ({ status: 200, json: async () => invalid }),
        }),
      ).rejects.toBeInstanceOf(TelegramPrivateActionDeliveryError);
    }
  });

  it('accepts only exact, internally consistent TeleBirr receiver projections', async () => {
    const preview = {
      version: 1,
      outcome: 'telebirr_deposit_preview',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      receiverAccountHolderName: 'Demo Receiver',
      receiverAccountMasked: '***0042',
      acceptsPayments: false,
    } as const;
    const destination = {
      ...preview,
      outcome: 'telebirr_deposit_destination',
      receiverAccountReference: '0000000042',
      acceptsPayments: true,
    } as const;
    const review = {
      ...preview,
      outcome: 'telebirr_deposit_destination_review',
      receiverAccountReference: '0000000042',
      amountMinor: '2500',
      currencyCode: 'ETB',
    } as const;

    for (const result of [preview, destination, review]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => result }),
        }),
      ).resolves.toEqual(result);
    }

    for (const invalid of [
      { ...preview, receiverAccountReference: '0000000042' },
      { ...preview, acceptsPayments: true },
      { ...destination, receiverAccountMasked: '***0000' },
      { ...destination, receiverAccountReference: '09123 47494' },
      { ...destination, acceptsPayments: false },
      { ...destination, databaseReceiverId: 'private' },
      { ...review, receiverAccountMasked: '***0000' },
      { ...review, amountMinor: '5000' },
      { ...review, currencyCode: 'USD' },
      { ...review, acceptsPayments: true },
    ]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => invalid }),
        }),
      ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    }
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

  it('accepts only the fully redacted no-money TeleBirr shadow-queue projection', async () => {
    const queuedResult = {
      version: 1,
      outcome: 'telebirr_shadow_verification_queued',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'verification_queued',
      verificationMode: 'shadow_no_money',
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => queuedResult }),
      }),
    ).resolves.toEqual(queuedResult);

    for (const unsafeResult of [
      { ...queuedResult, providerCode: 'cbe_birr' },
      { ...queuedResult, proofStatus: 'verified' },
      { ...queuedResult, verificationMode: 'live' },
      { ...queuedResult, proofToken: 'A'.repeat(22) },
      { ...queuedResult, shadowProofRequestId: 'private' },
      { ...queuedResult, playerId: 'PLAYER-DEMO-42' },
      { ...queuedResult, transactionReference: 'SYNTHETICREF7890' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => unsafeResult }),
        }),
      ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    }
  });

  it('accepts only the fully redacted no-money routine candidate projection', async () => {
    const candidateResult = {
      version: 1,
      outcome: 'telebirr_routine_candidate_recorded_no_money',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'untrusted_received',
      verificationMode: 'not_started_no_money',
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => candidateResult }),
      }),
    ).resolves.toEqual(candidateResult);

    for (const unsafeResult of [
      { ...candidateResult, providerCode: 'cbe_birr' },
      { ...candidateResult, proofStatus: 'verified' },
      { ...candidateResult, verificationMode: 'live' },
      { ...candidateResult, proofToken: 'A'.repeat(22) },
      { ...candidateResult, proofRequestId: 'private' },
      { ...candidateResult, playerId: 'PLAYER-DEMO-42' },
      { ...candidateResult, transactionReference: 'FETANTESTREF7890' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => unsafeResult }),
        }),
      ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    }
  });

  it('accepts only the fully redacted paid-pending routine candidate projection', async () => {
    const candidateResult = {
      version: 1,
      outcome: 'telebirr_routine_candidate_recorded_paid_pending',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'pending_verification',
      verificationMode: 'phone_receipt_pending',
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => candidateResult }),
      }),
    ).resolves.toEqual(candidateResult);

    for (const unsafeResult of [
      { ...candidateResult, providerCode: 'cbe_birr' },
      { ...candidateResult, proofStatus: 'verified' },
      { ...candidateResult, verificationMode: 'live' },
      { ...candidateResult, proofRequestId: 'private' },
      { ...candidateResult, playerId: 'PLAYER-DEMO-42' },
      { ...candidateResult, transactionReference: 'AB12CD34EF' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => unsafeResult }),
        }),
      ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    }
  });

  it('accepts only the narrow same-customer completed-duplicate projection', async () => {
    const duplicateResult = {
      version: 1,
      outcome: 'telebirr_routine_candidate_already_used',
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      proofStatus: 'already_used',
      verificationMode: 'same_customer_completed_ledger',
    } as const;
    await expect(
      deliverTelegramPrivateAction(action, config, {
        fetch: async () => ({ status: 200, json: async () => duplicateResult }),
      }),
    ).resolves.toEqual(duplicateResult);
    for (const unsafeResult of [
      { ...duplicateResult, providerCode: 'cbe_birr' },
      { ...duplicateResult, proofStatus: 'pending_verification' },
      { ...duplicateResult, verificationMode: 'phone_receipt_pending' },
      { ...duplicateResult, transactionReference: 'AB12CD34EF' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => unsafeResult }),
        }),
      ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    }
  });

  it('accepts only exact live TeleBirr queue and status projections', async () => {
    const proofToken = `${'B'.repeat(21)}A`;
    const queued = {
      version: 1,
      outcome: 'telebirr_live_verification_queued',
      proofToken,
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      depositStatus: { label: 'Checking payment', tone: 'working' },
      financialMode: 'live',
    } as const;
    const status = {
      version: 1,
      outcome: 'telebirr_live_deposit_status',
      proofToken,
      providerCode: 'telebirr',
      providerName: 'TeleBirr',
      amountMinor: null,
      currencyCode: null,
      depositStatus: { label: 'Being checked', tone: 'working' },
      financialMode: 'live',
    } as const;
    for (const result of [queued, status]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => result }),
        }),
      ).resolves.toEqual(result);
    }

    for (const unsafeResult of [
      { ...queued, proofToken: 'B'.repeat(22) },
      { ...queued, financialMode: 'dry_run' },
      { ...queued, transactionReference: 'SYNTHETICREF7890' },
      { ...status, amountMinor: '2500' },
      { ...status, currencyCode: 'ETB' },
      { ...status, amountMinor: '2500', currencyCode: null },
      { ...status, providerCode: 'cbe_birr' },
      { ...status, liveProofId: 'private' },
    ]) {
      await expect(
        deliverTelegramPrivateAction(action, config, {
          fetch: async () => ({ status: 200, json: async () => unsafeResult }),
        }),
      ).rejects.toEqual(new TelegramPrivateActionDeliveryError(false));
    }
  });

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
