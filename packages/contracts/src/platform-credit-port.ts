import type { EtbAmount } from '@fetanagent/domain';

import type { PlatformCode } from './payment-evidence-port.js';

/** The ledger creates one order from one claimed incoming payment. */
export interface PlatformCreditOrder {
  readonly depositIntentId: string;
  readonly paymentClaimId: string;
  readonly platformCode: PlatformCode;
  readonly platformAgentAccountId: string;
  readonly customerAccountId: string;
  readonly amount: EtbAmount;
  readonly currencyCode: 'ETB';
  /** Internal correlation only. An external platform may not honor this as an idempotency key. */
  readonly orderReference: string;
}

/** The database has leased this attempt, but its final action has not been fenced yet. */
export interface PlatformCreditPreparedAttempt {
  readonly order: PlatformCreditOrder;
  readonly attemptId: string;
}

/** This TypeScript shape is not itself authority to move money; the durable fence remains. */
export interface PlatformCreditAttempt extends PlatformCreditPreparedAttempt {
  readonly finalActionFenced: true;
}

/** Acquired at the final action, after any platform-specific preflight. */
export interface PlatformCreditFinalActionAuthority {
  readonly attempt: PlatformCreditAttempt;
  isFresh(): boolean;
}

export interface ConfirmedPlatformCredit {
  readonly outcome: 'confirmed';
  readonly evidenceDigest: string;
  /** Present only when the platform supplies one. Never substitute an internal reconciliation ID. */
  readonly externalTransactionId?: string;
}

export type PlatformCreditSubmission =
  | ConfirmedPlatformCredit
  /** A platform success surface was seen; the durable store still has to confirm the attempt. */
  | { readonly outcome: 'provider_success_observed'; readonly evidenceDigest: string }
  | { readonly outcome: 'stopped_before_final_action'; readonly reason: string }
  | { readonly outcome: 'uncertain'; readonly reason: string };

export type PlatformCreditReconciliation =
  | ConfirmedPlatformCredit
  | { readonly outcome: 'pending' }
  | { readonly outcome: 'uncertain'; readonly reason: string };

/** One platform-specific route, such as KemerBet Companion or a future platform API. */
export interface PlatformCreditAdapter {
  readonly platformCode: PlatformCode;
  /** The callback must acquire the durable fence exactly once at the actual final action. */
  submitOnce(
    prepared: PlatformCreditPreparedAttempt,
    acquireFinalAction: () => Promise<PlatformCreditFinalActionAuthority>,
  ): Promise<PlatformCreditSubmission>;
  reconcile(attempt: PlatformCreditAttempt): Promise<PlatformCreditReconciliation>;
}
