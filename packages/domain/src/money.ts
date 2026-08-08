export const ETB_SCALE = 100;
/**
 * KemerBet's provider-confirmed amount range for one deposit transaction. These constants are not
 * a per-customer, daily, lifetime, or frequency quota: customers may create unlimited distinct
 * deposits when each individual deposit is within this range.
 */
export const DEPOSIT_MINIMUM_MINOR = 25 * ETB_SCALE;
export const DEPOSIT_MAXIMUM_MINOR = 25_000 * ETB_SCALE;

export class EtbAmount {
  private constructor(public readonly minor: number) {}

  public static fromMinor(minor: number): EtbAmount {
    if (!Number.isSafeInteger(minor) || minor < 0) {
      throw new Error('ETB amount must be a non-negative safe integer in minor units.');
    }

    return new EtbAmount(minor);
  }

  public static fromWhole(whole: number): EtbAmount {
    if (!Number.isSafeInteger(whole) || whole < 0) {
      throw new Error('ETB whole amount must be a non-negative safe integer.');
    }

    return EtbAmount.fromMinor(whole * ETB_SCALE);
  }

  public isWithinDepositLimits(): boolean {
    return this.minor >= DEPOSIT_MINIMUM_MINOR && this.minor <= DEPOSIT_MAXIMUM_MINOR;
  }

  public toDisplay(): string {
    return (this.minor / ETB_SCALE).toFixed(2);
  }
}
