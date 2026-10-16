/** The exact-five idle poll is a no-money route and is rejected by live money gates. */
export function shouldRunExactFiveLookup(
  routineDepositsEnabled: boolean,
  playerValidationEnabled = false,
): boolean {
  return !routineDepositsEnabled && !playerValidationEnabled;
}

/** The single-Player Find lane is opt-in and never shares a browser with money or exact-five. */
export function shouldRunPlayerValidation(
  routineDepositsEnabled: boolean,
  executionV2Enabled: boolean,
  playerValidationEnabled: boolean,
): boolean {
  return playerValidationEnabled && !routineDepositsEnabled && !executionV2Enabled;
}
