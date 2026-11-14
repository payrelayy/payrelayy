import type { EtbAmount, VerificationReasonCode } from '@fetanagent/domain';

/** Registry values stay open so a new method or platform does not require a core type change. */
export type PaymentMethodCode = string;
export type PlatformCode = string;

export type ProviderEvidenceSource =
  'receiver_sms' | 'provider_api' | 'provider_receipt_lookup' | 'provider_account_activity';

export interface SubmittedAttachmentReference {
  readonly attachmentId: string;
}

/** Existing combined verification contract. Keep its public export during gradual migration. */
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
   * Sensitive adapter-only value. Encrypt and fingerprint before persistence. Never put it in
   * logs, bot state, audit metadata, or customer-facing messages.
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

/**
 * Source facts before receiver matching, payment policy, or a one-use claim. A paired phone
 * signature authenticates the reporting device, not the bank or the receiver account. The raw
 * reference is transient and must be protected before it is stored.
 */
export interface PaymentSourceObservation {
  readonly paymentMethodCode: PaymentMethodCode;
  readonly canonicalReference: string;
  readonly amountMinor: number;
  readonly currencyCode: 'ETB';
  readonly occurredAt: string;
  readonly evidenceSource: ProviderEvidenceSource;
  readonly sourceDigest: string;
  readonly bankAuthenticationPerformed: boolean;
  readonly receiverAccountBinding:
    | { readonly kind: 'not_attested' }
    | { readonly kind: 'exact'; readonly accountId: string; readonly version: number };
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

/**
 * Future payment-method edge. The reader reports source facts only. A screenshot or customer text
 * may supply candidate references, but cannot by itself produce the `found` outcome. `found`
 * requires exactly one source payment; competing matches remain ambiguous. The core applies
 * receiver, freshness, amount, duplicate-claim, and eligibility policy afterward.
 */
export interface PaymentEvidenceQuery {
  readonly paymentMethodCode: PaymentMethodCode;
  readonly referenceCandidates: readonly string[];
  readonly receiverAccountId: string;
  readonly receiverAccountVersion: number;
}

export type PaymentEvidenceLookup =
  | { readonly outcome: 'found'; readonly evidence: AuthoritativePaymentEvidence }
  | { readonly outcome: 'not_found_yet' }
  | { readonly outcome: 'ambiguous'; readonly reason: 'multiple_matches' | 'conflicting_facts' }
  | { readonly outcome: 'unavailable'; readonly reason: 'source' | 'network' | 'parse' };

export interface PaymentEvidenceReader {
  readonly paymentMethodCode: PaymentMethodCode;
  findEvidence(query: PaymentEvidenceQuery): Promise<PaymentEvidenceLookup>;
}
