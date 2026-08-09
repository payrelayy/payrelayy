import { booleanFromEnv } from './shared.js';

/**
 * The beta-admission preflight has no runtime implementation in this stage. This type encodes
 * the only safe configuration state: disabled, with no connection or transport material loaded.
 */
export type BetaAdmissionPreflightConfig = {
  readonly enabled: false;
};

/**
 * Loads only the explicit beta-admission preflight gate. Even an explicit true value fails closed
 * until a later reviewed stage provides a separate runtime, credential boundary, and catalog-only
 * preflight implementation.
 */
export function loadBetaAdmissionPreflightConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BetaAdmissionPreflightConfig {
  const enabled = booleanFromEnv(
    environment.INTERNAL_TELEGRAM_BETA_ADMISSION_PREFLIGHT_ENABLED,
    false,
    'INTERNAL_TELEGRAM_BETA_ADMISSION_PREFLIGHT_ENABLED',
  );

  if (enabled) {
    throw new Error('Beta-admission preflight is not provisioned in this stage.');
  }

  return { enabled: false };
}
