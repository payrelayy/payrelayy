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

/**
 * Describes a database-fenced, one-shot attempt. This TypeScript shape is not authority to move
 * money: the caller must validate the durable lease, claim, and fence before invoking an adapter.
 */
export interface PlatformCreditAttempt {
  readonly order: PlatformCreditOrder;
  readonly attemptId: string;
  readonly finalActionFenced: true;
}

export interface ConfirmedPlatformCredit {
  readonly outcome: 'confirmed';
  readonly externalTransactionId: string;
  readonly evidenceDigest: string;
}

export type PlatformCreditSubmission =
  | ConfirmedPlatformCredit
  | { readonly outcome: 'stopped_before_final_action'; readonly reason: string }
  | { readonly outcome: 'uncertain'; readonly reason: string };

export type PlatformCreditReconciliation =
  | ConfirmedPlatformCredit
  | { readonly outcome: 'pending' }
  | { readonly outcome: 'uncertain'; readonly reason: string };

/** One platform-specific route, such as KemerBet Companion or a future platform API. */
export interface PlatformCreditAdapter {
  readonly platformCode: PlatformCode;
  submitOnce(attempt: PlatformCreditAttempt): Promise<PlatformCreditSubmission>;
  reconcile(attempt: PlatformCreditAttempt): Promise<PlatformCreditReconciliation>;
}
