import type { EtbAmount, VerificationReasonCode } from '@payreplayy/domain';

/**
 * Values are validated against database-backed registries. They are strings here so a newly
 * enabled platform or payment provider does not require a core-library deployment.
 */
export type PaymentMethodCode = string;
export type PlatformCode = string;

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
  readonly depositExpiresAt: Date;
  readonly submittedAt: Date;
  readonly attachments: readonly SubmittedAttachmentReference[];
}

export interface AuthoritativePaymentEvidence {
  readonly evidenceId: string;
  readonly canonicalReference: string;
  readonly amount: EtbAmount;
  readonly receiverMatchToken: string;
  readonly occurredAt: Date;
}

export type PaymentVerificationResult =
  | { readonly outcome: 'verified'; readonly evidence: AuthoritativePaymentEvidence }
  | {
      readonly outcome: 'rejected';
      readonly reason: VerificationReasonCode;
      readonly evidence?: AuthoritativePaymentEvidence;
    }
  | { readonly outcome: 'manual_review'; readonly reason: VerificationReasonCode };

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
