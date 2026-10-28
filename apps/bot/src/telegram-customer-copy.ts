/** Shared customer wording for the same payment state across immediate and delayed replies. */
export const TELEGRAM_PAYMENT_RECEIVED_TEXT = '⏳ Payment details received. We’ll update you here.';

export const TELEGRAM_PAYMENT_ALREADY_USED_TEXT =
  'This payment reference has already been used. It can’t be submitted again.';

export const TELEGRAM_PAYMENT_ALREADY_CREDITED_TEXT =
  '✅ This payment was already credited. It can’t be credited again.';

export const TELEGRAM_PAYMENT_ALREADY_SUBMITTED_WAIT_TEXT =
  '⏳ This payment is already submitted. Please wait for an update here.';

export const TELEGRAM_PAYMENT_ALREADY_SUBMITTED_OTHER_TEXT =
  '❌ This payment was already submitted. It can’t be submitted again.';

export const TELEGRAM_PAYMENT_ALREADY_CLOSED_TEXT =
  '❌ This payment was already closed. Contact support if you need help.';

export const TELEGRAM_PAYMENT_ALREADY_RECORDED_TEXT =
  '❌ This payment is already being handled. It can’t be submitted again.';

export const TELEGRAM_PAYMENT_NEEDS_REVIEW_TEXT =
  '⚠️ Your deposit needs review. We’ll update you here.';

export const TELEGRAM_INVALID_PAYMENT_REFERENCE_TEXT =
  'I couldn’t find a valid payment reference. Send one reference or receipt.';

export const TELEGRAM_MULTIPLE_PAYMENT_REFERENCES_TEXT =
  'I found more than one reference. Send just one.';
