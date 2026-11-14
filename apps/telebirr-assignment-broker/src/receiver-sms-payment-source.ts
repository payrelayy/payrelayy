import type { PaymentSourceObservation } from '@fetanagent/contracts';
import type {
  ReceiverSmsVerifiedEvent,
  ReceiverSmsVerifiedPayment,
} from '@fetanagent/telebirr-verification-foundation';

export type ReceiverSmsPaymentObservation = PaymentSourceObservation & {
  readonly paymentMethodCode: ReceiverSmsVerifiedPayment['providerCode'];
  readonly evidenceSource: 'receiver_sms';
  readonly bankAuthenticationPerformed: false;
  readonly receiverAccountBinding: { readonly kind: 'not_attested' };
};

const UNATTESTED_RECEIVER = Object.freeze({ kind: 'not_attested' as const });

/** Called only after the paired-phone signature and enrollment have been verified. */
export function projectVerifiedReceiverSmsPayment(
  event: ReceiverSmsVerifiedEvent,
  payment: ReceiverSmsVerifiedPayment,
): ReceiverSmsPaymentObservation {
  return Object.freeze({
    paymentMethodCode: payment.providerCode,
    canonicalReference: payment.transactionReference,
    amountMinor: payment.amountMinor,
    currencyCode: 'ETB',
    occurredAt: payment.occurredAt,
    evidenceSource: 'receiver_sms',
    sourceDigest: event.eventBodyDigest,
    bankAuthenticationPerformed: false,
    receiverAccountBinding: UNATTESTED_RECEIVER,
  });
}
