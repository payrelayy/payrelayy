import { describe, expect, it, vi } from 'vitest';

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

  it('deletes an expired instruction, sends menu, and acknowledges its lease', async () => {
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
    const sendMenu = vi.fn(async () => undefined);
    expect(
      await processOneTelegramPaymentInstructionExpiry({
        request,
        delete: deleted,
        sendMenu,
      }),
    ).toBe('processed');
    expect(deleted).toHaveBeenCalledWith(4567, 89);
    expect(sendMenu).toHaveBeenCalledWith(4567);
    expect(request).toHaveBeenCalledWith({
      version: 1,
      kind: 'payment_instruction_expiry_complete',
      instructionEventId: eventId,
      leaseToken,
      expiryResult: 'complete',
    });
  });

  it('retries a transient Telegram deletion failure without sending another menu', async () => {
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
    const sendMenu = vi.fn(async () => undefined);
    await processOneTelegramPaymentInstructionExpiry({
      request,
      delete: async () => {
        throw new Error('network');
      },
      sendMenu,
    });
    expect(sendMenu).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ expiryResult: 'retry' }));
  });

  it('does not send another menu when a newer instruction or submitted candidate owns the flow', async () => {
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
    const sendMenu = vi.fn(async () => undefined);
    await processOneTelegramPaymentInstructionExpiry({ request, delete: deleted, sendMenu });
    expect(deleted).toHaveBeenCalledWith(4567, 89);
    expect(sendMenu).not.toHaveBeenCalled();
  });
});
