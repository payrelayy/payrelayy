import { describe, expect, it, vi } from 'vitest';

import { deliverTelegramPrivateAction } from './telegram-private-action-client.js';
import {
  processOneTelegramPaymentInstructionExpiry,
  recordTelegramPaymentInstruction,
} from './telegram-payment-instruction-expiry.js';

const eventId = '42cba976-cfea-48da-83e9-6b9d07cb36b1';
const leaseToken = 'f76f14d1-2fce-4e72-9a24-07671ba702d5';

describe('one-hour Telegram instruction cleanup', () => {
  it('records only an instruction that the database accepts', async () => {
    const request = vi.fn(async () => ({
      version: 1 as const,
      outcome: 'payment_instruction_recorded' as const,
      accepted: true,
    }));
    const deleted = vi.fn(async () => true);
    expect(
      await recordTelegramPaymentInstruction({ request, delete: deleted }, '1234', '4567', 89),
    ).toBe(true);
    expect(request).toHaveBeenCalledWith({
      version: 1,
      kind: 'payment_instruction_record',
      updateId: '1234',
      privateChatId: '4567',
      telegramMessageId: 89,
    });
    expect(deleted).not.toHaveBeenCalled();
  });

  it('keeps a sent instruction when the real client parses an accepted API response', async () => {
    const deleted = vi.fn(async () => true);
    const accepted = await recordTelegramPaymentInstruction(
      {
        request: (action) =>
          deliverTelegramPrivateAction(
            action,
            { baseUrl: 'http://api:3000/', transportHmacSecret: 'a'.repeat(64) },
            {
              fetch: async () => ({
                status: 200,
                json: async () => ({
                  version: 1,
                  outcome: 'payment_instruction_recorded',
                  accepted: true,
                }),
              }),
            },
          ),
        delete: deleted,
      },
      '1234',
      '4567',
      89,
    );
    expect(accepted).toBe(true);
    expect(deleted).not.toHaveBeenCalled();
  });

  it('removes a visible instruction when durable recording is refused', async () => {
    const deleted = vi.fn(async () => true);
    expect(
      await recordTelegramPaymentInstruction(
        {
          request: async () => ({
            version: 1,
            outcome: 'payment_instruction_recorded',
            accepted: false,
          }),
          delete: deleted,
        },
        '1234',
        '4567',
        89,
      ),
    ).toBe(false);
    expect(deleted).toHaveBeenCalledWith(4567, 89);
  });

  it('deletes an expired instruction and acknowledges its lease without a new message', async () => {
    const request = vi.fn(async (action) =>
      action.kind === 'payment_instruction_expiry_claim'
        ? {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_delivery' as const,
            instructionEventId: eventId,
            leaseToken,
            privateChatId: '4567',
            telegramMessageId: 89,
            suppressMenu: false,
          }
        : {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_completed' as const,
            accepted: true,
          },
    );
    const deleted = vi.fn(async () => true);
    expect(
      await processOneTelegramPaymentInstructionExpiry({
        request,
        delete: deleted,
      }),
    ).toBe('processed');
    expect(deleted).toHaveBeenCalledWith(4567, 89);
    expect(request).toHaveBeenCalledWith({
      version: 1,
      kind: 'payment_instruction_expiry_complete',
      instructionEventId: eventId,
      leaseToken,
      expiryResult: 'complete',
    });
  });

  it('retries a transient Telegram deletion failure', async () => {
    const request = vi.fn(async (action) =>
      action.kind === 'payment_instruction_expiry_claim'
        ? {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_delivery' as const,
            instructionEventId: eventId,
            leaseToken,
            privateChatId: '4567',
            telegramMessageId: 89,
            suppressMenu: false,
          }
        : {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_completed' as const,
            accepted: true,
          },
    );
    await processOneTelegramPaymentInstructionExpiry({
      request,
      delete: async () => {
        throw new Error('network');
      },
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ expiryResult: 'retry' }));
  });

  it('still retires the old instruction when a newer instruction or submission owns the flow', async () => {
    const request = vi.fn(async (action) =>
      action.kind === 'payment_instruction_expiry_claim'
        ? {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_delivery' as const,
            instructionEventId: eventId,
            leaseToken,
            privateChatId: '4567',
            telegramMessageId: 89,
            suppressMenu: true,
          }
        : {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_completed' as const,
            accepted: true,
          },
    );
    const deleted = vi.fn(async () => true);
    await processOneTelegramPaymentInstructionExpiry({ request, delete: deleted });
    expect(deleted).toHaveBeenCalledWith(4567, 89);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ expiryResult: 'complete' }));
  });

  it('acknowledges an instruction that Telegram says was already deleted', async () => {
    const request = vi.fn(async (action) =>
      action.kind === 'payment_instruction_expiry_claim'
        ? {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_delivery' as const,
            instructionEventId: eventId,
            leaseToken,
            privateChatId: '4567',
            telegramMessageId: 89,
            suppressMenu: false,
          }
        : {
            version: 1 as const,
            outcome: 'payment_instruction_expiry_completed' as const,
            accepted: true,
          },
    );
    await processOneTelegramPaymentInstructionExpiry({
      request,
      delete: async () => {
        throw { error_code: 400, description: 'Bad Request: message to delete not found' };
      },
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ expiryResult: 'complete' }));
  });
});
