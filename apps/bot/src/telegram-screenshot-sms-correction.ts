import {
  screenshotReferenceVariants,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';

interface ScreenshotReference {
  readonly providerCode: 'telebirr' | 'cbe_birr';
  readonly transactionReference: string;
}

/**
 * The signed SMS narrows the possibilities, then independent local OCR must read that exact
 * alternative from the same image. No match or disagreement preserves the original reading.
 */
export async function correctScreenshotReferenceFromSms(
  proof: ScreenshotReference,
  request: (probe: TelegramPrivateActionEnvelope) => Promise<TelegramPrivateActionResult>,
  confirmFromLocalOcr: () => Promise<ScreenshotReference | null>,
): Promise<string> {
  const variants = screenshotReferenceVariants(proof.transactionReference);
  if (variants.length === 1) return proof.transactionReference;
  try {
    const result = await request({
      version: 1,
      kind: 'receiver_sms_screenshot_reference_probe',
      providerCode: proof.providerCode,
      transactionReference: proof.transactionReference,
    });
    if (
      result.outcome !== 'receiver_sms_screenshot_reference_probe' ||
      result.correctionIndex === null ||
      !Number.isInteger(result.correctionIndex) ||
      result.correctionIndex < 1 ||
      result.correctionIndex >= variants.length
    )
      return proof.transactionReference;
    const alternative = variants[result.correctionIndex]!;
    const local = await confirmFromLocalOcr();
    return local?.providerCode === proof.providerCode && local.transactionReference === alternative
      ? alternative
      : proof.transactionReference;
  } catch {
    return proof.transactionReference;
  }
}
