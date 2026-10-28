import type { ApiConfig } from '@fetanagent/config/api';
import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import { protectDepositProofReference } from '@fetanagent/deposit-reference-protection';

import { createTelegramActionSemanticHmac } from './telegram-action-capability.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REFERENCE = /^[A-Za-z0-9]{8,32}$/u;
const STATUSES = new Set(['pending_sms', 'ready', 'older_review', 'held_review', 'already_used']);
const DUPLICATE_STATES = new Set([
  'none',
  'credited',
  'same_account_pending',
  'other_account_pending',
  'closed',
  'recorded_elsewhere',
]);

export const CAPTURE_TELEGRAM_RECEIVER_SMS_CANDIDATE_SQL = `
  select candidate.candidate_id, candidate.proof_status,
    candidate.submitted_at, candidate.request_replayed,
    app.telegram_receiver_sms_duplicate_state(
      $1::uuid, candidate.candidate_id) as duplicate_state
  from app.capture_telegram_receiver_sms_candidate(
    $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,
    $7::smallint,$8::smallint,$9::text
  ) candidate
`;

export interface ReceiverSmsCandidateDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}

type Action = Extract<TelegramPrivateActionEnvelope, { readonly kind: 'deposit_proof_command' }>;

/** Customer proof only nominates a reference. The receiver phone SMS supplies the payment facts. */
export async function captureTelegramReceiverSmsCandidate(
  database: ReceiverSmsCandidateDatabase,
  originInboundEventId: string,
  action: Action,
  config: ApiConfig,
): Promise<TelegramPrivateActionResult> {
  const runtime = config.telegramPlayerActionRuntime;
  if (
    !runtime.enabled ||
    !runtime.receiverSmsCandidateProductionEnabled ||
    runtime.deploymentTarget !== 'production' ||
    config.financialActionsMode !== 'live' ||
    !config.telegramActionCapability.enabled ||
    runtime.depositProofReferenceProfileVersion !== 2 ||
    !UUID.test(originInboundEventId) ||
    !REFERENCE.test(action.transactionReference)
  ) {
    throw new Error('The receiver SMS deposit intake is unavailable.');
  }
  const protectedReference = protectDepositProofReference({
    provider: action.providerCode,
    reference: action.transactionReference.toUpperCase(),
    secrets: {
      encryptionSecret: runtime.depositProofReferenceEncryptionMasterSecret,
      fingerprintSecret: runtime.depositProofReferenceFingerprintMasterSecret,
    },
  });
  const semanticHmac = createTelegramActionSemanticHmac({
    consumer: 'capture_telegram_receiver_sms_candidate',
    originInboundEventId,
    playerId: action.playerId,
    providerCode: action.providerCode,
    referenceFingerprint: protectedReference.fingerprint,
    referenceMasked: protectedReference.masked,
    keyVersion: protectedReference.keyVersion,
    profileVersion: runtime.depositProofReferenceProfileVersion,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });
  const response = await database.query(CAPTURE_TELEGRAM_RECEIVER_SMS_CANDIDATE_SQL, [
    originInboundEventId,
    action.playerId,
    action.providerCode,
    protectedReference.ciphertext,
    protectedReference.fingerprint,
    protectedReference.masked,
    protectedReference.keyVersion,
    runtime.depositProofReferenceProfileVersion,
    semanticHmac,
  ]);
  const row = response.rows[0];
  if (
    response.rows.length !== 1 ||
    typeof row !== 'object' ||
    row === null ||
    Array.isArray(row) ||
    Object.keys(row).length !== 5 ||
    !('candidate_id' in row) ||
    typeof row.candidate_id !== 'string' ||
    !UUID.test(row.candidate_id) ||
    !('proof_status' in row) ||
    typeof row.proof_status !== 'string' ||
    !STATUSES.has(row.proof_status) ||
    !('submitted_at' in row) ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime()) ||
    !('request_replayed' in row) ||
    typeof row.request_replayed !== 'boolean' ||
    !('duplicate_state' in row) ||
    typeof row.duplicate_state !== 'string' ||
    !DUPLICATE_STATES.has(row.duplicate_state)
  ) {
    throw new Error('The receiver SMS deposit intake is unavailable.');
  }
  const duplicateState = row.duplicate_state as
    | 'none'
    | 'credited'
    | 'same_account_pending'
    | 'other_account_pending'
    | 'closed'
    | 'recorded_elsewhere';
  return {
    version: 1,
    outcome: 'receiver_sms_candidate_received',
    providerCode: action.providerCode,
    providerName: action.providerCode === 'telebirr' ? 'TeleBirr' : 'CBE Birr',
    matchStatus: row.proof_status as
      'pending_sms' | 'ready' | 'older_review' | 'held_review' | 'already_used',
    ...(duplicateState === 'none' ? {} : { duplicateState }),
  };
}
