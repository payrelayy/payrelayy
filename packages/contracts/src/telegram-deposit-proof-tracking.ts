/** Separate customer tracking namespace for proof submissions, never legacy deposit intents. */
export const TELEGRAM_DEPOSIT_PROOF_TRACKING_PREFIX = 'p1';
export const TELEGRAM_DEPOSIT_PROOF_STATUS_CALLBACK_PREFIX = 'dps1';

// Sixteen bytes encode to 22 base64url characters; the final four padding bits must be zero.
const CANONICAL_COMPACT_UUID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/u;

/** Structural validation only. Possession of a proof token does not authorize access. */
export function isTelegramDepositProofToken(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length === 22 && CANONICAL_COMPACT_UUID_PATTERN.test(value)
  );
}

function formatProofPresentation(prefix: string, proofToken: string): string {
  if (!isTelegramDepositProofToken(proofToken)) {
    throw new Error('A Telegram proof tracking presentation requires a canonical compact token.');
  }
  return `${prefix}.${proofToken}`;
}

function parseProofPresentation(prefix: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(`${prefix}.`)) return undefined;
  const proofToken = value.slice(prefix.length + 1);
  return isTelegramDepositProofToken(proofToken) ? proofToken : undefined;
}

export function formatTelegramDepositProofTrackingHandle(proofToken: string): string {
  return formatProofPresentation(TELEGRAM_DEPOSIT_PROOF_TRACKING_PREFIX, proofToken);
}

export function parseTelegramDepositProofTrackingHandle(value: unknown): string | undefined {
  return parseProofPresentation(TELEGRAM_DEPOSIT_PROOF_TRACKING_PREFIX, value);
}

/** The ASCII-only callback is 27 bytes, within Telegram's 64-byte callback limit. */
export function formatTelegramDepositProofStatusCallback(proofToken: string): string {
  return formatProofPresentation(TELEGRAM_DEPOSIT_PROOF_STATUS_CALLBACK_PREFIX, proofToken);
}

export function parseTelegramDepositProofStatusCallback(value: unknown): string | undefined {
  return parseProofPresentation(TELEGRAM_DEPOSIT_PROOF_STATUS_CALLBACK_PREFIX, value);
}
