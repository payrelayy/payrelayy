export const verificationReasonCodes = [
  'transaction_id_missing',
  'transaction_id_duplicate',
  'authoritative_receipt_not_found',
  'authoritative_receipt_unavailable',
  'receiver_mismatch',
  'amount_mismatch',
  'payment_stale',
  'payment_timestamp_future',
  'payment_fields_missing',
  'receipt_parse_uncertain',
  'provider_network_uncertain',
  'provider_reference_reused',
] as const;

export type VerificationReasonCode = (typeof verificationReasonCodes)[number];

export const executionReasonCodes = [
  'player_not_found',
  'withdrawal_not_found',
  'withdrawal_already_completed',
  'executor_session_uncertain',
  'executor_captcha_detected',
  'executor_response_uncertain',
  'reconciliation_required',
] as const;

export type ExecutionReasonCode = (typeof executionReasonCodes)[number];
