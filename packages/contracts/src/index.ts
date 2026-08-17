import type { EtbAmount, VerificationReasonCode } from '@fetanagent/domain';

export * from './telegram-private-inbound.js';
export * from './telegram-action-capability.js';
export * from './telegram-private-action.js';
export * from './telegram-beta-invite-admission.js';
export * from './cbe-birr-authoritative-shadow.js';
export * from './cbe-birr-authoritative-adapter.js';
export * from './cbe-birr-authoritative-shadow-attempt.js';
export * from './cbe-birr-authoritative-shadow-settlement.js';
export * from './kemerbet-deposit-execution.js';
export * from './customer-deposit-status.js';

/**
 * Values are validated against database-backed registries. They are strings here so a newly
 * enabled platform or payment provider does not require a core-library deployment.
 */
export type PaymentMethodCode = string;
export type PlatformCode = string;
export type ProviderEvidenceSource =
  'provider_api' | 'provider_receipt_lookup' | 'provider_account_activity';

export interface SubmittedAttachmentReference {
  readonly attachmentId: string;
}

export interface PaymentVerificationInput {
  readonly depositId: string;
  readonly paymentMethodCode: PaymentMethodCode;
  readonly submittedTransactionId?: string;
  readonly expectedAmount: EtbAmount;
  readonly receiverAccountId: string;
  readonly receiverAccountVersion: number;
  readonly depositOpenedAt: Date;
  readonly paymentDeadlineAt: Date;
  readonly submittedAt: Date;
  readonly attachments: readonly SubmittedAttachmentReference[];
}

export interface AuthoritativePaymentEvidence {
  /**
   * Sensitive adapter-only value. It is encrypted and fingerprinted before persistence and must
   * never be placed in logs, bot state, audit metadata, or customer-facing messages.
   */
  readonly canonicalReference: string;
  readonly amount: EtbAmount;
  readonly matchedReceiverAccountId: string;
  readonly matchedReceiverAccountVersion: number;
  readonly occurredAt: Date;
  readonly retrievedAt: Date;
  readonly evidenceSource: ProviderEvidenceSource;
  readonly providerFinalStatus: 'completed';
  readonly adapterVersion: string;
  readonly normalizationVersion: string;
  readonly evidenceDigest: string;
}

export type PaymentVerificationResult =
  | { readonly outcome: 'verified'; readonly evidence: AuthoritativePaymentEvidence }
  | {
      readonly outcome: 'rejected';
      readonly reason: VerificationReasonCode;
      readonly evidence?: AuthoritativePaymentEvidence;
    }
  | {
      readonly outcome: 'manual_review';
      readonly reason: VerificationReasonCode;
      readonly evidence?: AuthoritativePaymentEvidence;
    };

export interface PaymentProviderVerifier {
  readonly paymentMethodCode: PaymentMethodCode;
  verify(input: PaymentVerificationInput): Promise<PaymentVerificationResult>;
}
