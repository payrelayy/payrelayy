/** The exact-five idle poll is a no-money route and is rejected by live money gates. */
export function shouldRunExactFiveLookup(routineDepositsEnabled: boolean): boolean {
  return !routineDepositsEnabled;
}
