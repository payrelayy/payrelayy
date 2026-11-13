import { describe, expect, it, vi } from 'vitest';

import { correctScreenshotReferenceFromSms } from './telegram-screenshot-sms-correction.js';

const action = {
  providerCode: 'telebirr',
  transactionReference: 'DK0S123456',
} as const;

describe('Screenshot SMS correction', () => {
  it('changes one reference only when signed SMS and local OCR agree', async () => {
    const request = vi.fn(async () => ({
      version: 1 as const,
      outcome: 'receiver_sms_screenshot_reference_probe' as const,
      correctionIndex: 1,
    }));
    const confirm = vi.fn(async () => ({
      providerCode: 'telebirr' as const,
      transactionReference: 'DKOS123456',
    }));
    await expect(correctScreenshotReferenceFromSms(action, request, confirm)).resolves.toBe(
      'DKOS123456',
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      version: 1,
      kind: 'receiver_sms_screenshot_reference_probe',
      providerCode: 'telebirr',
      transactionReference: action.transactionReference,
    });
  });

  it('keeps the original when local OCR disagrees with SMS', async () => {
    for (const local of [
      null,
      action,
      { providerCode: 'cbe_birr' as const, transactionReference: 'DKOS123456' },
    ]) {
      await expect(
        correctScreenshotReferenceFromSms(
          action,
          async () => ({
            version: 1,
            outcome: 'receiver_sms_screenshot_reference_probe',
            correctionIndex: 1,
          }),
          async () => local,
        ),
      ).resolves.toBe(action.transactionReference);
    }
  });

  it('keeps the original without a safe SMS result and skips local OCR', async () => {
    const confirm = vi.fn(async () => ({
      providerCode: 'telebirr' as const,
      transactionReference: 'DKOS123456',
    }));
    for (const correctionIndex of [null, 15]) {
      await expect(
        correctScreenshotReferenceFromSms(
          action,
          async () => ({
            version: 1,
            outcome: 'receiver_sms_screenshot_reference_probe',
            correctionIndex,
          }),
          confirm,
        ),
      ).resolves.toBe(action.transactionReference);
    }
    await expect(
      correctScreenshotReferenceFromSms(
        action,
        async () => {
          throw new Error('unavailable');
        },
        confirm,
      ),
    ).resolves.toBe(action.transactionReference);
    expect(confirm).not.toHaveBeenCalled();
  });
});
