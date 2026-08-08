import type { EtbAmount, VerificationReasonCode } from '@payreplayy/domain';

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

export interface PlatformDepositRequest {
  readonly executionAttemptId: string;
  readonly platformCode: PlatformCode;
  readonly playerId: string;
  readonly amount: EtbAmount;
}

export type PlatformDepositResult =
  | { readonly outcome: 'completed'; readonly platformReference: string }
  | { readonly outcome: 'rejected'; readonly reason: string }
  | { readonly outcome: 'uncertain'; readonly reason: string };

export interface PlatformDepositExecutor {
  readonly platformCode: PlatformCode;
  deposit(request: PlatformDepositRequest): Promise<PlatformDepositResult>;
}
