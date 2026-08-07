import type { EtbAmount, VerificationReasonCode } from '@payreplayy/domain';

export type PaymentMethod = 'telebirr' | 'cbe_birr';

export interface PaymentVerificationInput {
  readonly depositId: string;
  readonly paymentMethod: PaymentMethod;
  readonly submittedTransactionId?: string;
  readonly configuredReceiverReference: string;
  readonly submittedAt: Date;
  readonly attachmentObjectKeys: readonly string[];
}

export interface AuthoritativePaymentEvidence {
  readonly canonicalReference: string;
  readonly amount: EtbAmount;
  readonly receiverReference: string;
  readonly occurredAt: Date;
  readonly evidenceLocator: string;
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
  readonly paymentMethod: PaymentMethod;
  verify(input: PaymentVerificationInput): Promise<PaymentVerificationResult>;
}

export interface KemerBetDepositRequest {
  readonly executionAttemptId: string;
  readonly playerId: string;
  readonly amount: EtbAmount;
}

export type KemerBetDepositResult =
  | { readonly outcome: 'completed'; readonly platformReference: string }
  | { readonly outcome: 'rejected'; readonly reason: string }
  | { readonly outcome: 'uncertain'; readonly reason: string };

export interface PlatformDepositExecutor {
  readonly platform: 'kemerbet';
  deposit(request: KemerBetDepositRequest): Promise<KemerBetDepositResult>;
}
