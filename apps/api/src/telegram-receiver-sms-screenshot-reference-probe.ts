import type { ApiConfig } from '@fetanagent/config/api';
import {
  screenshotReferenceVariants,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { fingerprintDepositProofReference } from '@fetanagent/deposit-reference-protection';

type ProbeAction = Extract<
  TelegramPrivateActionEnvelope,
  { readonly kind: 'receiver_sms_screenshot_reference_probe' }
>;

export interface ScreenshotReferenceProbeDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export const PROBE_RECEIVER_SMS_SCREENSHOT_REFERENCE_SQL = `
  select app.probe_receiver_sms_screenshot_reference(
    $1::text, $2::text[]
  ) as correction_index
`;

/** Read-only lookup before the original OCR reading is saved as an immutable candidate. */
export async function probeReceiverSmsScreenshotReference(
  database: ScreenshotReferenceProbeDatabase,
  action: ProbeAction,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  const runtime = config.telegramPlayerActionRuntime;
  if (
    !runtime.enabled ||
    !runtime.receiverSmsCandidateProductionEnabled ||
    runtime.deploymentTarget !== 'production' ||
    config.financialActionsMode !== 'live' ||
    runtime.depositProofReferenceProfileVersion !== 2 ||
    action.transactionReference.length !== (action.providerCode === 'telebirr' ? 10 : 11)
  ) {
    throw new Error('Screenshot reference lookup is unavailable.');
  }
  const variants = screenshotReferenceVariants(action.transactionReference);
  if (variants.length === 1) {
    return {
      version: 1,
      outcome: 'receiver_sms_screenshot_reference_probe',
      correctionIndex: null,
    };
  }
  const fingerprints = variants.map((reference) =>
    fingerprintDepositProofReference({
      provider: action.providerCode,
      reference,
      fingerprintSecret: runtime.depositProofReferenceFingerprintMasterSecret,
    }),
  );
  let response: { readonly rows: readonly unknown[] };
  try {
    response = await database.query(PROBE_RECEIVER_SMS_SCREENSHOT_REFERENCE_SQL, [
      action.providerCode,
      fingerprints,
    ]);
  } catch (error) {
    // The application may go live before the separate database release. During that
    // handoff, preserve the original reading without turning an optional probe into
    // a failed customer submission.
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === '42883' || error.code === '42501')
    ) {
      return {
        version: 1,
        outcome: 'receiver_sms_screenshot_reference_probe',
        correctionIndex: null,
      };
    }
    throw error;
  }
  const row = response.rows[0];
  if (
    response.rows.length !== 1 ||
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    Object.keys(row).length !== 1 ||
    !('correction_index' in row) ||
    (row.correction_index !== null &&
      (typeof row.correction_index !== 'number' ||
        !Number.isInteger(row.correction_index) ||
        row.correction_index < 1 ||
        row.correction_index >= variants.length))
  ) {
    throw new Error('Screenshot reference lookup is unavailable.');
  }
  return {
    version: 1,
    outcome: 'receiver_sms_screenshot_reference_probe',
    correctionIndex: row.correction_index as number | null,
  };
}
