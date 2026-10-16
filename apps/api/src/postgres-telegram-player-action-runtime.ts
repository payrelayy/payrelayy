import { createHmac } from 'node:crypto';

import type { ApiConfig } from '@fetanagent/config/api';
import {
  isTelegramDepositProofToken,
  projectCustomerDepositStatus,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import {
  protectCbeBirrDepositReference,
  protectDepositProofReference,
  unprotectReceiverAccountReference,
} from '@fetanagent/deposit-reference-protection';
import type { DepositStatus } from '@fetanagent/domain';
import { Pool, type PoolConfig } from 'pg';

import {
  createTelegramActionSemanticHmac,
  decodeTelegramCapabilityId,
  decodePlayerRegistrationCapabilityCallback,
  derivePlayerRegistrationCapabilityPresentation,
  encodeTelegramCapabilityId,
} from './telegram-action-capability.js';
import { PostgresTelegramPrivateActionNonceStore } from './postgres-telegram-private-action-nonce-store.js';
import { playerActionCatalogPreflightPassed } from './player-action-catalog-preflight.js';
import { captureTelegramRoutineTelebirrCandidate } from './telegram-routine-telebirr-candidate-intake.js';
import { captureTelegramLiveTelebirrProof } from './telegram-telebirr-live-proof-intake.js';
import { captureTelegramTelebirrShadowProof } from './telegram-telebirr-shadow-proof-intake.js';
import type { TelegramPrivateActionNonceStore } from './telegram-private-action.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HMAC_VALUE_PATTERN = /^hmac-sha256-v1:[0-9a-f]{64}$/;

const RECORD_INBOUND_SQL = `
  select inbound_event_id, received_at, inbound_event_already_recorded
  from app.record_public_telegram_action_inbound_event(
    $1::bigint, $2::bigint, $3::bigint, $4::text, $5::text
  )
`;
const ISSUE_CAPABILITY_SQL = `
  select result_capability_id, capability_expires_at,
         expected_conversation_version, origin_inbound_event_already_consumed
  from app.issue_telegram_player_registration_capability(
    $1::uuid, $2::uuid, $3::text, $4::text
  )
`;
const START_ACTION_SQL = `
  select result_outcome, result_reason_code, player_registration_action_id,
         player_id_deadline_at, conversation_version, origin_inbound_event_already_consumed
  from app.start_telegram_player_registration_action($1::uuid, $2::uuid, $3::text, $4::text)
`;
const SUBMIT_INPUT_SQL = `
  select result_outcome, result_reason_code, player_registration_request_id,
         request_status, existing_request_reused, conversation_version,
         origin_inbound_event_already_consumed
  from app.submit_telegram_player_registration_input($1::uuid, $2::text, $3::text)
`;
const PREPARE_TELEBIRR_DESTINATION_SQL = `
  select provider_code, receiver_revision_id, receiver_account_holder_name,
         receiver_account_reference_ciphertext, receiver_account_reference_fingerprint,
         receiver_account_masked, payments_enabled, request_replayed,
         (not payments_enabled
           and receiver_account_reference_ciphertext is not null
           and receiver_account_reference_fingerprint is not null) as receiver_review_enabled
  from app.prepare_telegram_telebirr_destination($1::uuid, $2::text, $3::text)
`;
const EXPIRE_ACTION_SQL = `
  select player_registration_action_id, action_status, conversation_version,
         origin_inbound_event_already_consumed
  from app.expire_telegram_player_registration_action($1::uuid, $2::text)
`;
const OPEN_DRY_RUN_DEPOSIT_SQL = `
  select deposit_intent_id, provider_code, receiver_account_holder_name,
         receiver_account_masked, receiver_customer_instruction, expected_amount_minor,
         currency_code, payment_deadline_at, deposit_status,
         origin_inbound_event_already_consumed
  from app.open_telegram_dry_run_deposit_intent($1::uuid, $2::text, $3::bigint, $4::text)
`;
const CAPTURE_DRY_RUN_REFERENCE_SQL = `
  select deposit_submission_id, result_deposit_intent_id, submission_status, submitted_at,
         origin_inbound_event_already_consumed
  from app.capture_telegram_dry_run_deposit_reference(
    $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::smallint, $7::text
  )
`;
const CAPTURE_DRY_RUN_PROOF_SQL = `
  select deposit_proof_request_id, provider_code, proof_status, submitted_at, request_replayed
  from app.capture_telegram_dry_run_deposit_proof(
    $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
    $7::smallint, $8::smallint, $9::text
  )
`;
const GET_CUSTOMER_DEPOSIT_SQL = `
  select deposit_intent_id, expected_amount_minor, currency_code, deposit_status,
         created_at, updated_at
  from app.get_telegram_customer_deposit($1::uuid, $2::uuid)
`;
const GET_CUSTOMER_DEPOSIT_PROOF_SQL = `
  select deposit_proof_request_id, provider_code, proof_status, submitted_at
  from app.get_telegram_customer_deposit_proof($1::uuid, $2::uuid)
`;
const PREPARE_LIVE_TELEBIRR_DESTINATION_SQL = `
  select provider_code, receiver_revision_id, receiver_account_holder_name,
         receiver_account_reference_ciphertext, receiver_account_reference_fingerprint,
         receiver_account_masked, payments_enabled, request_replayed
  from app.prepare_telegram_live_telebirr_destination($1::uuid, $2::text, $3::text)
`;
const GET_SAVED_PLAYER_SELECTION_SQL = `
  select selected_player_id
  from app.get_telegram_saved_player_selection($1::uuid)
`;
const SAVE_PLAYER_SELECTION_SQL = `
  select selected_player_id, request_replayed
  from app.save_telegram_player_selection($1::uuid, $2::text)
`;
const REQUEST_PLAYER_VALIDATION_SQL = `
  select request_id, request_replayed
  from app.request_telegram_player_validation($1::uuid, $2::text)
`;
const GET_CUSTOMER_LIVE_TELEBIRR_PROOF_SQL = `
  select live_proof_id, provider_code, deposit_status, amount_minor, currency_code, submitted_at
  from app.get_telegram_customer_live_telebirr_proof($1::uuid, $2::uuid)
`;
const CLAIM_TELEGRAM_DEPOSIT_OUTCOME_SQL = `
  select notification_id, notification_lease_token, notification_private_chat_id,
         notification_outcome_code, notification_amount_minor, notification_reference_masked
  from app.claim_telegram_deposit_outcome_notification()
`;
const COMPLETE_TELEGRAM_DEPOSIT_OUTCOME_SQL = `
  select app.complete_telegram_deposit_outcome_notification(
    $1::uuid, $2::uuid, $3::text, $4::bigint
  ) as accepted
`;
const CLAIM_PLAYER_VALIDATION_OUTCOME_SQL = `
  select notification_id, notification_lease_token,
         notification_private_chat_id, notification_outcome_code
  from app.claim_telegram_player_validation_notification()
`;
const COMPLETE_PLAYER_VALIDATION_OUTCOME_SQL = `
  select app.complete_telegram_player_validation_notification(
    $1::uuid, $2::uuid, $3::text, $4::bigint
  ) as accepted
`;
const RECORD_TELEGRAM_DEPOSIT_TEMPORARY_SQL = `
  select app.record_telegram_deposit_temporary_message(
    $1::bigint, $2::bigint, $3::bigint
  ) as accepted
`;
const CANCEL_TELEGRAM_DEPOSIT_TEMPORARY_SQL = `
  select app.cancel_telegram_deposit_temporary_message(
    $1::bigint, $2::bigint, $3::bigint
  ) as accepted
`;
const CLAIM_TELEGRAM_DEPOSIT_TEMPORARY_CLEANUP_SQL = `
  select cleanup_update_id, cleanup_lease_token,
         cleanup_private_chat_id, cleanup_message_id
  from app.claim_telegram_deposit_temporary_deletion()
`;
const COMPLETE_TELEGRAM_DEPOSIT_TEMPORARY_CLEANUP_SQL = `
  select app.complete_telegram_deposit_temporary_deletion(
    $1::bigint, $2::uuid, $3::text
  ) as accepted
`;
const RECORD_PAYMENT_INSTRUCTION_SQL = `
  select app.record_telegram_payment_instruction_message(
    $1::bigint, $2::bigint, $3::bigint
  ) as accepted
`;
const CLAIM_PAYMENT_INSTRUCTION_EXPIRY_SQL = `
  select instruction_event_id, instruction_lease_token,
         instruction_private_chat_id, instruction_message_id,
         instruction_suppress_menu
  from app.claim_telegram_payment_instruction_expiry()
`;
const COMPLETE_PAYMENT_INSTRUCTION_EXPIRY_SQL = `
  select app.complete_telegram_payment_instruction_expiry(
    $1::uuid, $2::uuid, $3::text
  ) as accepted
`;

const DEPOSIT_STATUSES = new Set<DepositStatus>([
  'intake_received',
  'verification_pending',
  'verification_review',
  'verified',
  'execution_pending',
  'execution_in_progress',
  'execution_review',
  'execution_reconciliation',
  'executed',
  'rejected',
  'expired',
  'cancelled',
  'execution_uncertain',
]);

type EnabledPlayerActionConfig = ApiConfig & {
  readonly telegramActionCapability: Extract<
    ApiConfig['telegramActionCapability'],
    { readonly enabled: true }
  >;
  readonly telegramActionChannel: Extract<
    ApiConfig['telegramActionChannel'],
    { readonly enabled: true }
  >;
  readonly telegramPlayerActionRuntime: Extract<
    ApiConfig['telegramPlayerActionRuntime'],
    { readonly enabled: true }
  >;
};

export interface TelegramPlayerActionDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
}

export interface PostgresTelegramPlayerActionRuntime {
  readonly nonceStore: TelegramPrivateActionNonceStore;
  handle(
    action: TelegramPrivateActionEnvelope,
    rawBody: Buffer,
  ): Promise<TelegramPrivateActionResult>;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export class TelegramPlayerActionRuntimeUnavailableError extends Error {
  constructor() {
    super('The Telegram Player-ID action runtime is unavailable.');
    this.name = 'TelegramPlayerActionRuntimeUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneRow(rows: readonly unknown[]): Record<string, unknown> {
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return rows[0];
}

function isPgRejection(error: unknown): boolean {
  return isRecord(error) && error.code === 'P0001';
}

function payloadHmac(secret: string, rawBody: Buffer): string {
  return `hmac-sha256-v1:${createHmac('sha256', Buffer.from(secret, 'hex'))
    .update('fetanagent:telegram:private-action:payload:v1\n', 'utf8')
    .update(rawBody)
    .digest('hex')}`;
}

function amountEtbToMinor(value: string): string | undefined {
  const match = /^([1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/u.exec(value);
  if (!match) return undefined;
  const major = match[1];
  if (!major) return undefined;
  const minor = `${match[2] ?? ''}00`.slice(0, 2);
  const amountMinor = BigInt(major) * 100n + BigInt(minor);
  if (amountMinor < 2_500n || amountMinor > 2_500_000n) return undefined;
  return amountMinor.toString();
}

async function handleDepositOutcomeClaim(
  database: TelegramPlayerActionDatabase,
): Promise<TelegramPrivateActionResult> {
  const rows = (await database.query(CLAIM_TELEGRAM_DEPOSIT_OUTCOME_SQL, [])).rows;
  if (rows.length === 0) return { version: 1, outcome: 'deposit_outcome_none' };
  const row = oneRow(rows);
  if (
    Object.keys(row).length !== 6 ||
    typeof row.notification_id !== 'string' ||
    !UUID_PATTERN.test(row.notification_id) ||
    typeof row.notification_lease_token !== 'string' ||
    !UUID_PATTERN.test(row.notification_lease_token) ||
    typeof row.notification_private_chat_id !== 'string' ||
    !/^[1-9][0-9]{0,15}$/u.test(row.notification_private_chat_id) ||
    BigInt(row.notification_private_chat_id) > 9007199254740991n ||
    ![
      'checking',
      'verified_waiting',
      'credited',
      'rejected',
      'wrong_receiver',
      'invalid_reference',
      'manual_review',
      'not_credited',
      'not_verified',
      'already_used',
    ].includes(row.notification_outcome_code as string) ||
    !(
      row.notification_amount_minor === null ||
      (typeof row.notification_amount_minor === 'string' &&
        /^[1-9][0-9]*$/u.test(row.notification_amount_minor))
    ) ||
    (row.notification_outcome_code === 'credited') !== (row.notification_amount_minor !== null) ||
    typeof row.notification_reference_masked !== 'string' ||
    !/^\*{3}[A-Z0-9]{4}$/u.test(row.notification_reference_masked)
  )
    throw new TelegramPlayerActionRuntimeUnavailableError();
  return {
    version: 1,
    outcome: 'deposit_outcome_delivery',
    notificationId: row.notification_id,
    leaseToken: row.notification_lease_token,
    privateChatId: row.notification_private_chat_id,
    outcomeCode: row.notification_outcome_code as
      | 'checking'
      | 'verified_waiting'
      | 'credited'
      | 'rejected'
      | 'wrong_receiver'
      | 'invalid_reference'
      | 'manual_review'
      | 'not_credited'
      | 'not_verified'
      | 'already_used',
    amountMinor: row.notification_amount_minor as string | null,
    referenceMasked: row.notification_reference_masked,
  };
}

async function handleDepositOutcomeComplete(
  database: TelegramPlayerActionDatabase,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'deposit_outcome_complete' }>,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (
      await database.query(COMPLETE_TELEGRAM_DEPOSIT_OUTCOME_SQL, [
        action.notificationId,
        action.leaseToken,
        action.deliveryResult,
        action.telegramMessageId,
      ])
    ).rows,
  );
  if (Object.keys(row).length !== 1 || typeof row.accepted !== 'boolean') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return { version: 1, outcome: 'deposit_outcome_completed', accepted: row.accepted };
}

async function handlePlayerValidationOutcomeClaim(
  database: TelegramPlayerActionDatabase,
): Promise<TelegramPrivateActionResult> {
  const rows = (await database.query(CLAIM_PLAYER_VALIDATION_OUTCOME_SQL, [])).rows;
  if (rows.length === 0) return { version: 1, outcome: 'player_validation_outcome_none' };
  const row = oneRow(rows);
  if (
    Object.keys(row).length !== 4 ||
    typeof row.notification_id !== 'string' ||
    !UUID_PATTERN.test(row.notification_id) ||
    typeof row.notification_lease_token !== 'string' ||
    !UUID_PATTERN.test(row.notification_lease_token) ||
    typeof row.notification_private_chat_id !== 'string' ||
    !/^[1-9][0-9]{0,15}$/u.test(row.notification_private_chat_id) ||
    BigInt(row.notification_private_chat_id) > 9007199254740991n ||
    (row.notification_outcome_code !== 'selected' &&
      row.notification_outcome_code !== 'review_required')
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return {
    version: 1,
    outcome: 'player_validation_outcome_delivery',
    notificationId: row.notification_id,
    leaseToken: row.notification_lease_token,
    privateChatId: row.notification_private_chat_id,
    outcomeCode: row.notification_outcome_code,
  };
}

async function handlePlayerValidationOutcomeComplete(
  database: TelegramPlayerActionDatabase,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'player_validation_outcome_complete' }
  >,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (
      await database.query(COMPLETE_PLAYER_VALIDATION_OUTCOME_SQL, [
        action.notificationId,
        action.leaseToken,
        action.deliveryResult,
        action.telegramMessageId,
      ])
    ).rows,
  );
  if (Object.keys(row).length !== 1 || typeof row.accepted !== 'boolean') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return { version: 1, outcome: 'player_validation_outcome_completed', accepted: row.accepted };
}

async function handleDepositTemporaryRecord(
  database: TelegramPlayerActionDatabase,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'deposit_temporary_record' | 'deposit_temporary_cancel' }
  >,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (
      await database.query(
        action.kind === 'deposit_temporary_record'
          ? RECORD_TELEGRAM_DEPOSIT_TEMPORARY_SQL
          : CANCEL_TELEGRAM_DEPOSIT_TEMPORARY_SQL,
        [action.updateId, action.privateChatId, action.telegramMessageId],
      )
    ).rows,
  );
  if (Object.keys(row).length !== 1 || typeof row.accepted !== 'boolean') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return {
    version: 1,
    outcome:
      action.kind === 'deposit_temporary_record'
        ? 'deposit_temporary_recorded'
        : 'deposit_temporary_cancelled',
    accepted: row.accepted,
  };
}

async function handleDepositTemporaryCleanupClaim(
  database: TelegramPlayerActionDatabase,
): Promise<TelegramPrivateActionResult> {
  const rows = (await database.query(CLAIM_TELEGRAM_DEPOSIT_TEMPORARY_CLEANUP_SQL, [])).rows;
  if (rows.length === 0) return { version: 1, outcome: 'deposit_temporary_cleanup_none' };
  const row = oneRow(rows);
  if (
    Object.keys(row).length !== 4 ||
    typeof row.cleanup_update_id !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,15})$/u.test(row.cleanup_update_id) ||
    BigInt(row.cleanup_update_id) > 9007199254740991n ||
    typeof row.cleanup_lease_token !== 'string' ||
    !UUID_PATTERN.test(row.cleanup_lease_token) ||
    typeof row.cleanup_private_chat_id !== 'string' ||
    !/^[1-9][0-9]{0,15}$/u.test(row.cleanup_private_chat_id) ||
    BigInt(row.cleanup_private_chat_id) > 9007199254740991n ||
    typeof row.cleanup_message_id !== 'string' ||
    !/^[1-9][0-9]{0,15}$/u.test(row.cleanup_message_id) ||
    BigInt(row.cleanup_message_id) > 9007199254740991n
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return {
    version: 1,
    outcome: 'deposit_temporary_cleanup_delivery',
    updateId: row.cleanup_update_id,
    leaseToken: row.cleanup_lease_token,
    privateChatId: row.cleanup_private_chat_id,
    telegramMessageId: Number(row.cleanup_message_id),
  };
}

async function handleDepositTemporaryCleanupComplete(
  database: TelegramPlayerActionDatabase,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'deposit_temporary_cleanup_complete' }
  >,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (
      await database.query(COMPLETE_TELEGRAM_DEPOSIT_TEMPORARY_CLEANUP_SQL, [
        action.updateId,
        action.leaseToken,
        action.deletionResult,
      ])
    ).rows,
  );
  if (Object.keys(row).length !== 1 || typeof row.accepted !== 'boolean') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return { version: 1, outcome: 'deposit_temporary_cleanup_completed', accepted: row.accepted };
}

async function handlePaymentInstructionRecord(
  database: TelegramPlayerActionDatabase,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'payment_instruction_record' }>,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (
      await database.query(RECORD_PAYMENT_INSTRUCTION_SQL, [
        action.updateId,
        action.privateChatId,
        action.telegramMessageId,
      ])
    ).rows,
  );
  if (Object.keys(row).length !== 1 || typeof row.accepted !== 'boolean') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return { version: 1, outcome: 'payment_instruction_recorded', accepted: row.accepted };
}

async function handlePaymentInstructionExpiryClaim(
  database: TelegramPlayerActionDatabase,
): Promise<TelegramPrivateActionResult> {
  const rows = (await database.query(CLAIM_PAYMENT_INSTRUCTION_EXPIRY_SQL, [])).rows;
  if (rows.length === 0) return { version: 1, outcome: 'payment_instruction_expiry_none' };
  const row = oneRow(rows);
  if (
    Object.keys(row).length !== 5 ||
    typeof row.instruction_event_id !== 'string' ||
    !UUID_PATTERN.test(row.instruction_event_id) ||
    typeof row.instruction_lease_token !== 'string' ||
    !UUID_PATTERN.test(row.instruction_lease_token) ||
    typeof row.instruction_private_chat_id !== 'string' ||
    !/^[1-9][0-9]{0,15}$/u.test(row.instruction_private_chat_id) ||
    BigInt(row.instruction_private_chat_id) > 9007199254740991n ||
    typeof row.instruction_message_id !== 'string' ||
    !/^[1-9][0-9]{0,15}$/u.test(row.instruction_message_id) ||
    BigInt(row.instruction_message_id) > 9007199254740991n ||
    typeof row.instruction_suppress_menu !== 'boolean'
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return {
    version: 1,
    outcome: 'payment_instruction_expiry_delivery',
    instructionEventId: row.instruction_event_id,
    leaseToken: row.instruction_lease_token,
    privateChatId: row.instruction_private_chat_id,
    telegramMessageId: Number(row.instruction_message_id),
    suppressMenu: row.instruction_suppress_menu,
  };
}

async function handlePaymentInstructionExpiryComplete(
  database: TelegramPlayerActionDatabase,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'payment_instruction_expiry_complete' }
  >,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (
      await database.query(COMPLETE_PAYMENT_INSTRUCTION_EXPIRY_SQL, [
        action.instructionEventId,
        action.leaseToken,
        action.expiryResult,
      ])
    ).rows,
  );
  if (Object.keys(row).length !== 1 || typeof row.accepted !== 'boolean') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return { version: 1, outcome: 'payment_instruction_expiry_completed', accepted: row.accepted };
}

async function recordInbound(
  database: TelegramPlayerActionDatabase,
  action: Exclude<
    TelegramPrivateActionEnvelope,
    {
      readonly kind:
        | 'deposit_outcome_claim'
        | 'deposit_outcome_complete'
        | 'player_validation_outcome_claim'
        | 'player_validation_outcome_complete'
        | 'deposit_temporary_record'
        | 'deposit_temporary_cancel'
        | 'deposit_temporary_cleanup_claim'
        | 'deposit_temporary_cleanup_complete'
        | 'payment_instruction_record'
        | 'payment_instruction_expiry_claim'
        | 'payment_instruction_expiry_complete';
    }
  >,
  rawBody: Buffer,
  secret: string,
): Promise<string> {
  const row = oneRow(
    (
      await database.query(RECORD_INBOUND_SQL, [
        action.updateId,
        action.telegramUserId,
        action.privateChatId,
        payloadHmac(secret, rawBody),
        action.preferredLocale,
      ])
    ).rows,
  );
  if (
    typeof row.inbound_event_id !== 'string' ||
    !UUID_PATTERN.test(row.inbound_event_id) ||
    !(row.received_at instanceof Date) ||
    Number.isNaN(row.received_at.getTime()) ||
    typeof row.inbound_event_already_recorded !== 'boolean'
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return row.inbound_event_id;
}

function validateSemanticHmac(value: string): string {
  if (!HMAC_VALUE_PATTERN.test(value)) throw new TelegramPlayerActionRuntimeUnavailableError();
  return value;
}

async function handleRootMenu(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  const presentation = derivePlayerRegistrationCapabilityPresentation({
    originInboundEventId,
    keys: config.telegramActionCapability,
  });
  let row: Record<string, unknown>;
  try {
    row = oneRow(
      (
        await database.query(ISSUE_CAPABILITY_SQL, [
          originInboundEventId,
          presentation.capabilityId,
          presentation.tokenFingerprint,
          presentation.issueSemanticInputHmac,
        ])
      ).rows,
    );
  } catch (error) {
    if (!isPgRejection(error)) throw error;
    const expiryHmac = validateSemanticHmac(
      createTelegramActionSemanticHmac({
        consumer: 'expire_player_registration_action',
        originInboundEventId,
        semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
      }),
    );
    try {
      oneRow((await database.query(EXPIRE_ACTION_SQL, [originInboundEventId, expiryHmac])).rows);
    } catch {
      throw error;
    }
    return { version: 1, outcome: 'restart_required' };
  }
  if (
    row.result_capability_id !== presentation.capabilityId ||
    !(row.capability_expires_at instanceof Date) ||
    Number.isNaN(row.capability_expires_at.getTime()) ||
    typeof row.expected_conversation_version !== 'string' ||
    typeof row.origin_inbound_event_already_consumed !== 'boolean'
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  const selectedPlayerId = await getSavedPlayerSelection(database, originInboundEventId);
  return {
    version: 1,
    outcome: 'menu',
    callbackData: presentation.callbackData,
    selectedPlayerId,
  };
}

async function getSavedPlayerSelection(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
): Promise<string | null> {
  const rows = (await database.query(GET_SAVED_PLAYER_SELECTION_SQL, [originInboundEventId])).rows;
  if (rows.length === 0) return null;
  const row = oneRow(rows);
  if (
    typeof row.selected_player_id !== 'string' ||
    row.selected_player_id !== row.selected_player_id.trim() ||
    Array.from(row.selected_player_id).length < 1 ||
    Array.from(row.selected_player_id).length > 64 ||
    /[\s\u0000-\u001f\u007f]/u.test(row.selected_player_id)
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return row.selected_player_id;
}

async function handleSavePlayerSelection(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'save_player_selection_command' }
  >,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (await database.query(SAVE_PLAYER_SELECTION_SQL, [originInboundEventId, action.playerId])).rows,
  );
  if (row.selected_player_id !== action.playerId || typeof row.request_replayed !== 'boolean') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return { version: 1, outcome: 'player_selection_saved', playerId: action.playerId };
}

async function handlePlayerValidationRequest(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'player_validation_request_command' }
  >,
): Promise<TelegramPrivateActionResult> {
  const row = oneRow(
    (await database.query(REQUEST_PLAYER_VALIDATION_SQL, [originInboundEventId, action.playerId]))
      .rows,
  );
  if (
    typeof row.request_id !== 'string' ||
    !UUID_PATTERN.test(row.request_id) ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return { version: 1, outcome: 'player_validation_queued' };
}

async function handleSavedTelebirrDestination(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'saved_telebirr_destination_command' }
  >,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  const selectedPlayerId = await getSavedPlayerSelection(database, originInboundEventId);
  if (selectedPlayerId === null) return { version: 1, outcome: 'player_selection_missing' };
  const result = await handleTelebirrDestination(
    database,
    originInboundEventId,
    { ...action, kind: 'telebirr_deposit_destination_command', playerId: selectedPlayerId },
    config,
  );
  if (
    result.outcome === 'telebirr_deposit_destination' ||
    result.outcome === 'telebirr_deposit_destination_review' ||
    result.outcome === 'telebirr_deposit_preview'
  ) {
    return { ...result, selectedPlayerId };
  }
  return result;
}

async function handleSavedTelebirrProof(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'saved_telebirr_proof_command' }>,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  const selectedPlayerId = await getSavedPlayerSelection(database, originInboundEventId);
  if (selectedPlayerId === null) return { version: 1, outcome: 'player_selection_missing' };
  return handleDepositProof(
    database,
    originInboundEventId,
    {
      ...action,
      kind: 'deposit_proof_command',
      providerCode: 'telebirr',
      playerId: selectedPlayerId,
    },
    config,
  );
}

async function handleCallback(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'player_registration_callback' }>,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  const decoded = decodePlayerRegistrationCapabilityCallback(
    action.callbackData,
    config.telegramActionCapability.capabilityHmacSecret,
  );
  if (!decoded) return { version: 1, outcome: 'restart_required' };
  const semanticHmac = validateSemanticHmac(
    createTelegramActionSemanticHmac({
      consumer: 'start_player_registration',
      originInboundEventId,
      capabilityId: decoded.capabilityId,
      tokenFingerprint: decoded.tokenFingerprint,
      semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
    }),
  );
  const row = oneRow(
    (
      await database.query(START_ACTION_SQL, [
        originInboundEventId,
        decoded.capabilityId,
        decoded.tokenFingerprint,
        semanticHmac,
      ])
    ).rows,
  );
  if (typeof row.result_outcome !== 'string' || typeof row.result_reason_code !== 'string') {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return row.result_outcome === 'completed' || row.result_outcome === 'active_action_exists'
    ? { version: 1, outcome: 'awaiting_player_id' }
    : { version: 1, outcome: 'restart_required' };
}

async function handlePlayerId(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'player_id_text' }>,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  const semanticHmac = validateSemanticHmac(
    createTelegramActionSemanticHmac({
      consumer: 'submit_player_registration_input',
      originInboundEventId,
      playerId: action.playerId,
      semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
    }),
  );
  let row: Record<string, unknown>;
  try {
    row = oneRow(
      (
        await database.query(SUBMIT_INPUT_SQL, [
          originInboundEventId,
          action.playerId,
          semanticHmac,
        ])
      ).rows,
    );
  } catch (error) {
    if (!isPgRejection(error)) throw error;
    const expiryHmac = validateSemanticHmac(
      createTelegramActionSemanticHmac({
        consumer: 'expire_player_registration_action',
        originInboundEventId,
        semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
      }),
    );
    try {
      oneRow((await database.query(EXPIRE_ACTION_SQL, [originInboundEventId, expiryHmac])).rows);
      return { version: 1, outcome: 'restart_required' };
    } catch (expiryError) {
      if (isPgRejection(expiryError)) return { version: 1, outcome: 'menu_required' };
      throw expiryError;
    }
  }

  if (row.result_outcome === 'completed' && row.request_status === 'pending_validation') {
    return { version: 1, outcome: 'player_id_pending' };
  }
  if (row.result_outcome === 'completed' && row.request_status === 'exists') {
    return { version: 1, outcome: 'player_id_exists' };
  }
  if (row.result_outcome === 'rejected' && row.result_reason_code === 'invalid_player_id') {
    return { version: 1, outcome: 'invalid_player_id' };
  }
  if (row.result_outcome === 'rejected') return { version: 1, outcome: 'restart_required' };
  throw new TelegramPlayerActionRuntimeUnavailableError();
}

async function handleTelebirrDestination(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<
    TelegramPrivateActionEnvelope,
    { readonly kind: 'telebirr_deposit_destination_command' }
  >,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  const livePaymentPresentation =
    config.financialActionsMode === 'live' &&
    !config.telegramPlayerActionRuntime.telebirrReceiverReviewEnabled;
  // The private SQL wrapper selects the legacy pilot or routine Owner authority.
  // Its payments_enabled result is still required before protected details open.
  const semanticHmac = validateSemanticHmac(
    createTelegramActionSemanticHmac({
      consumer: livePaymentPresentation
        ? 'prepare_telegram_live_telebirr_destination'
        : 'prepare_telegram_telebirr_destination',
      originInboundEventId,
      playerId: action.playerId,
      semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
    }),
  );
  const row = oneRow(
    (
      await database.query(
        livePaymentPresentation
          ? PREPARE_LIVE_TELEBIRR_DESTINATION_SQL
          : PREPARE_TELEBIRR_DESTINATION_SQL,
        [originInboundEventId, action.playerId, semanticHmac],
      )
    ).rows,
  );
  if (
    row.provider_code !== 'telebirr' ||
    typeof row.receiver_revision_id !== 'string' ||
    !UUID_PATTERN.test(row.receiver_revision_id) ||
    typeof row.receiver_account_holder_name !== 'string' ||
    row.receiver_account_holder_name !== row.receiver_account_holder_name.trim() ||
    Array.from(row.receiver_account_holder_name).length < 2 ||
    Array.from(row.receiver_account_holder_name).length > 160 ||
    /[\u0000-\u001f\u007f]/u.test(row.receiver_account_holder_name) ||
    typeof row.receiver_account_masked !== 'string' ||
    !/^\*{3}[0-9]{4}$/u.test(row.receiver_account_masked) ||
    typeof row.payments_enabled !== 'boolean' ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }

  const base = {
    version: 1 as const,
    providerCode: 'telebirr' as const,
    providerName: 'TeleBirr' as const,
    receiverAccountHolderName: row.receiver_account_holder_name,
    receiverAccountMasked: row.receiver_account_masked,
  };
  const receiverReviewEnabled = config.telegramPlayerActionRuntime.telebirrReceiverReviewEnabled;
  // Review permission is independent of payment permission. The private database boundary
  // releases an envelope for an exact no-money pilot without setting payments_enabled.
  const mayDiscloseReceiver = receiverReviewEnabled
    ? config.financialActionsMode === 'dry_run' &&
      row.payments_enabled === false &&
      row.receiver_review_enabled === true
    : livePaymentPresentation && row.payments_enabled;
  if (!mayDiscloseReceiver) {
    return {
      ...base,
      outcome: 'telebirr_deposit_preview',
      acceptsPayments: false,
    };
  }

  if (
    typeof row.receiver_account_reference_ciphertext !== 'string' ||
    typeof row.receiver_account_reference_fingerprint !== 'string'
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  const receiverAccountReference = unprotectReceiverAccountReference({
    ciphertext: row.receiver_account_reference_ciphertext,
    fingerprint: row.receiver_account_reference_fingerprint,
    masked: row.receiver_account_masked,
    provider: 'telebirr',
    secrets: {
      encryptionSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceEncryptionMasterSecret,
      fingerprintSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceFingerprintMasterSecret,
    },
  });
  if (receiverReviewEnabled) {
    return {
      ...base,
      outcome: 'telebirr_deposit_destination_review',
      receiverAccountReference,
      amountMinor: '2500',
      currencyCode: 'ETB',
      acceptsPayments: false,
    };
  }
  if (!livePaymentPresentation) {
    return {
      ...base,
      outcome: 'telebirr_deposit_preview',
      acceptsPayments: false,
    };
  }
  return {
    ...base,
    outcome: 'telebirr_deposit_destination',
    receiverAccountReference,
    acceptsPayments: true,
  };
}

async function handleDepositIntent(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'deposit_intent_command' }>,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  if (config.financialActionsMode !== 'dry_run') {
    return { version: 1, outcome: 'deposit_unavailable' };
  }
  const expectedAmountMinor = amountEtbToMinor(action.amountEtb);
  if (!expectedAmountMinor) return { version: 1, outcome: 'deposit_input_invalid' };
  const semanticHmac = createTelegramActionSemanticHmac({
    consumer: 'open_dry_run_deposit_intent',
    originInboundEventId,
    playerId: action.playerId,
    expectedAmountMinor,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });
  const row = oneRow(
    (
      await database.query(OPEN_DRY_RUN_DEPOSIT_SQL, [
        originInboundEventId,
        action.playerId,
        expectedAmountMinor,
        semanticHmac,
      ])
    ).rows,
  );
  if (
    typeof row.deposit_intent_id !== 'string' ||
    !UUID_PATTERN.test(row.deposit_intent_id) ||
    row.provider_code !== 'cbe_birr' ||
    typeof row.receiver_account_holder_name !== 'string' ||
    typeof row.receiver_account_masked !== 'string' ||
    typeof row.receiver_customer_instruction !== 'string' ||
    row.expected_amount_minor !== expectedAmountMinor ||
    row.currency_code !== 'ETB' ||
    !(row.payment_deadline_at instanceof Date) ||
    Number.isNaN(row.payment_deadline_at.getTime()) ||
    row.deposit_status !== 'intake_received'
  )
    throw new TelegramPlayerActionRuntimeUnavailableError();
  return {
    version: 1,
    outcome: 'deposit_instructions',
    depositToken: encodeTelegramCapabilityId(row.deposit_intent_id),
    amountMinor: expectedAmountMinor,
    currencyCode: 'ETB',
    providerName: 'CBE Birr',
    receiverAccountHolderName: row.receiver_account_holder_name,
    receiverAccountMasked: row.receiver_account_masked,
    customerInstruction: row.receiver_customer_instruction,
    paymentDeadline: row.payment_deadline_at.toISOString(),
    depositStatus: projectCustomerDepositStatus(row.deposit_status),
    financialMode: 'dry_run',
  };
}

async function handleDepositReference(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'deposit_reference_command' }>,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  if (config.financialActionsMode !== 'dry_run') {
    return { version: 1, outcome: 'deposit_unavailable' };
  }
  const depositIntentId = decodeTelegramCapabilityId(action.depositToken);
  if (!depositIntentId) return { version: 1, outcome: 'deposit_input_invalid' };
  const protectedReference = protectCbeBirrDepositReference(action.transactionReference, {
    encryptionSecret: config.telegramPlayerActionRuntime.depositReferenceEncryptionSecret,
    fingerprintSecret: config.telegramPlayerActionRuntime.depositReferenceFingerprintSecret,
  });
  const semanticHmac = createTelegramActionSemanticHmac({
    consumer: 'capture_dry_run_deposit_reference',
    originInboundEventId,
    depositIntentId,
    referenceFingerprint: protectedReference.fingerprint,
    referenceMasked: protectedReference.masked,
    keyVersion: protectedReference.keyVersion,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });
  const row = oneRow(
    (
      await database.query(CAPTURE_DRY_RUN_REFERENCE_SQL, [
        originInboundEventId,
        depositIntentId,
        protectedReference.ciphertext,
        protectedReference.fingerprint,
        protectedReference.masked,
        protectedReference.keyVersion,
        semanticHmac,
      ])
    ).rows,
  );
  if (
    row.result_deposit_intent_id !== depositIntentId ||
    row.submission_status !== 'received' ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime())
  )
    throw new TelegramPlayerActionRuntimeUnavailableError();
  if (
    typeof row.deposit_submission_id !== 'string' ||
    !UUID_PATTERN.test(row.deposit_submission_id)
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return {
    version: 1,
    outcome: 'deposit_reference_received',
    depositStatus: projectCustomerDepositStatus('intake_received'),
    financialMode: 'dry_run',
  };
}

async function handleDepositProof(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'deposit_proof_command' }>,
  config: EnabledPlayerActionConfig,
): Promise<TelegramPrivateActionResult> {
  if (config.telegramPlayerActionRuntime.telebirrReceiverReviewEnabled) {
    return { version: 1, outcome: 'deposit_unavailable' };
  }

  if (action.providerCode === 'telebirr') {
    if (config.telegramPlayerActionRuntime.routineTelebirrCandidateProductionEnabled) {
      // The amount-free candidate route takes precedence over the pilot/live proof path.
      // Its database function independently requires every financial switch to be disabled.
      return captureTelegramRoutineTelebirrCandidate(
        database,
        originInboundEventId,
        action,
        config,
      );
    }
    if (config.financialActionsMode === 'live') {
      return captureTelegramLiveTelebirrProof(database, originInboundEventId, action, config);
    }
    if (config.financialActionsMode === 'dry_run') {
      if (config.telegramPlayerActionRuntime.routineTelebirrCandidateStagingEnabled) {
        // The adapter accepts only synthetic staging references. Never fall back to shadow/live.
        return captureTelegramRoutineTelebirrCandidate(
          database,
          originInboundEventId,
          action,
          config,
        );
      }
      return captureTelegramTelebirrShadowProof(database, originInboundEventId, action, config);
    }
    return { version: 1, outcome: 'deposit_unavailable' };
  }

  if (config.financialActionsMode !== 'dry_run') {
    return { version: 1, outcome: 'deposit_unavailable' };
  }

  const protectedReference = protectDepositProofReference({
    provider: 'cbe_birr',
    reference: action.transactionReference,
    secrets: {
      encryptionSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceEncryptionMasterSecret,
      fingerprintSecret:
        config.telegramPlayerActionRuntime.depositProofReferenceFingerprintMasterSecret,
    },
  });
  const semanticHmac = createTelegramActionSemanticHmac({
    consumer: 'capture_dry_run_deposit_proof',
    originInboundEventId,
    playerId: action.playerId,
    providerCode: 'cbe_birr',
    referenceFingerprint: protectedReference.fingerprint,
    referenceMasked: protectedReference.masked,
    keyVersion: protectedReference.keyVersion,
    profileVersion: config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
    semanticHmacSecret: config.telegramActionCapability.semanticHmacSecret,
  });
  const row = oneRow(
    (
      await database.query(CAPTURE_DRY_RUN_PROOF_SQL, [
        originInboundEventId,
        action.playerId,
        'cbe_birr',
        protectedReference.ciphertext,
        protectedReference.fingerprint,
        protectedReference.masked,
        protectedReference.keyVersion,
        config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion,
        semanticHmac,
      ])
    ).rows,
  );
  if (
    typeof row.deposit_proof_request_id !== 'string' ||
    !UUID_PATTERN.test(row.deposit_proof_request_id) ||
    row.provider_code !== 'cbe_birr' ||
    row.proof_status !== 'proof_received' ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime()) ||
    typeof row.request_replayed !== 'boolean'
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }

  return {
    version: 1,
    outcome: 'deposit_proof_received',
    proofToken: encodeTelegramCapabilityId(row.deposit_proof_request_id),
    providerCode: 'cbe_birr',
    providerName: 'CBE Birr',
    proofStatus: 'proof_received',
    financialMode: 'dry_run',
  };
}

async function handleDepositProofStatus(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'deposit_proof_status_command' }>,
): Promise<TelegramPrivateActionResult> {
  if (!isTelegramDepositProofToken(action.proofToken)) {
    return { version: 1, outcome: 'deposit_input_invalid' };
  }
  const proofRequestId = decodeTelegramCapabilityId(action.proofToken);
  if (!proofRequestId) return { version: 1, outcome: 'deposit_input_invalid' };
  let rows: readonly unknown[];
  try {
    rows = (
      await database.query(GET_CUSTOMER_LIVE_TELEBIRR_PROOF_SQL, [
        originInboundEventId,
        proofRequestId,
      ])
    ).rows;
    if (rows.length > 0) {
      const row = oneRow(rows);
      const amountAvailable =
        typeof row.amount_minor === 'string' && /^[1-9][0-9]*$/u.test(row.amount_minor);
      if (
        Object.keys(row).length !== 6 ||
        row.live_proof_id !== proofRequestId ||
        row.provider_code !== 'telebirr' ||
        typeof row.deposit_status !== 'string' ||
        !DEPOSIT_STATUSES.has(row.deposit_status as DepositStatus) ||
        !(
          (row.amount_minor === null && row.currency_code === null) ||
          (amountAvailable && row.currency_code === 'ETB')
        ) ||
        !(row.submitted_at instanceof Date) ||
        Number.isNaN(row.submitted_at.getTime())
      ) {
        throw new TelegramPlayerActionRuntimeUnavailableError();
      }
      return {
        version: 1,
        outcome: 'telebirr_live_deposit_status',
        proofToken: action.proofToken,
        providerCode: 'telebirr',
        providerName: 'TeleBirr',
        amountMinor: amountAvailable ? (row.amount_minor as string) : null,
        currencyCode: amountAvailable ? 'ETB' : null,
        depositStatus: projectCustomerDepositStatus(row.deposit_status as DepositStatus),
        financialMode: 'live',
      };
    }

    rows = (
      await database.query(GET_CUSTOMER_DEPOSIT_PROOF_SQL, [originInboundEventId, proofRequestId])
    ).rows;
  } catch (error) {
    if (!isPgRejection(error)) throw error;
    return { version: 1, outcome: 'deposit_status_unavailable' };
  }
  if (rows.length === 0) return { version: 1, outcome: 'deposit_status_unavailable' };
  const row = oneRow(rows);
  if (
    Object.keys(row).length !== 4 ||
    row.deposit_proof_request_id !== proofRequestId ||
    (row.provider_code !== 'cbe_birr' && row.provider_code !== 'telebirr') ||
    row.proof_status !== 'proof_received' ||
    !(row.submitted_at instanceof Date) ||
    Number.isNaN(row.submitted_at.getTime())
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  // These immutable records are dry-run submissions, even if the runtime mode changes later.
  // A status read cannot promote a proof into a verified payment or a completed deposit.
  return {
    version: 1,
    outcome: 'deposit_proof_status',
    proofToken: action.proofToken,
    providerCode: row.provider_code,
    providerName: row.provider_code === 'cbe_birr' ? 'CBE Birr' : 'TeleBirr',
    proofStatus: 'proof_received',
    financialMode: 'dry_run',
  };
}

async function handleDepositStatus(
  database: TelegramPlayerActionDatabase,
  originInboundEventId: string,
  action: Extract<TelegramPrivateActionEnvelope, { readonly kind: 'deposit_status_command' }>,
): Promise<TelegramPrivateActionResult> {
  const depositIntentId = decodeTelegramCapabilityId(action.depositToken);
  if (!depositIntentId) return { version: 1, outcome: 'deposit_input_invalid' };
  const row = oneRow(
    (await database.query(GET_CUSTOMER_DEPOSIT_SQL, [originInboundEventId, depositIntentId])).rows,
  );
  if (
    row.deposit_intent_id !== depositIntentId ||
    typeof row.expected_amount_minor !== 'string' ||
    !/^[1-9][0-9]*$/u.test(row.expected_amount_minor) ||
    row.currency_code !== 'ETB' ||
    typeof row.deposit_status !== 'string' ||
    !DEPOSIT_STATUSES.has(row.deposit_status as DepositStatus) ||
    !(row.created_at instanceof Date) ||
    Number.isNaN(row.created_at.getTime()) ||
    !(row.updated_at instanceof Date) ||
    Number.isNaN(row.updated_at.getTime())
  ) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  return {
    version: 1,
    outcome: 'deposit_status',
    amountMinor: row.expected_amount_minor,
    currencyCode: 'ETB',
    depositStatus: projectCustomerDepositStatus(row.deposit_status as DepositStatus),
  };
}

export function isTelegramPlayerActionRuntimeEnabled(
  config: ApiConfig,
): config is EnabledPlayerActionConfig {
  return (
    config.telegramActionChannel.enabled &&
    config.telegramActionCapability.enabled &&
    config.telegramPlayerActionRuntime.enabled
  );
}

export function createTelegramPlayerActionPoolConfig(
  config: EnabledPlayerActionConfig['telegramPlayerActionRuntime'],
): PoolConfig {
  return {
    application_name: 'fetanagent-player-actions',
    connectionTimeoutMillis: 5_000,
    database: config.connection.database,
    host: config.connection.host,
    idleTimeoutMillis: 10_000,
    idle_in_transaction_session_timeout: 5_000,
    lock_timeout: 1_000,
    max: 2,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    query_timeout: 5_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
    user: config.connection.user,
  };
}

export function createPostgresTelegramPlayerActionRuntime(
  config: ApiConfig,
  database?: TelegramPlayerActionDatabase,
): PostgresTelegramPlayerActionRuntime {
  if (!isTelegramPlayerActionRuntimeEnabled(config)) {
    throw new TelegramPlayerActionRuntimeUnavailableError();
  }
  const pgPool = database
    ? undefined
    : new Pool(createTelegramPlayerActionPoolConfig(config.telegramPlayerActionRuntime));
  const pool: TelegramPlayerActionDatabase = database ?? {
    async query(query, values) {
      const result = await pgPool!.query(query, [...values]);
      return { rows: result.rows as readonly unknown[] };
    },
    async end() {
      await pgPool!.end();
    },
  };
  const nonceStore = new PostgresTelegramPrivateActionNonceStore({
    query: (query, values) => pool.query(query, values),
  });
  let closePromise: Promise<void> | undefined;

  return {
    nonceStore,
    async handle(action, rawBody) {
      try {
        if (action.kind === 'deposit_outcome_claim') {
          return await handleDepositOutcomeClaim(pool);
        }
        if (action.kind === 'player_validation_outcome_claim') {
          return await handlePlayerValidationOutcomeClaim(pool);
        }
        if (action.kind === 'payment_instruction_record') {
          return await handlePaymentInstructionRecord(pool, action);
        }
        if (action.kind === 'payment_instruction_expiry_claim') {
          return await handlePaymentInstructionExpiryClaim(pool);
        }
        if (action.kind === 'payment_instruction_expiry_complete') {
          return await handlePaymentInstructionExpiryComplete(pool, action);
        }
        if (action.kind === 'deposit_outcome_complete') {
          return await handleDepositOutcomeComplete(pool, action);
        }
        if (action.kind === 'player_validation_outcome_complete') {
          return await handlePlayerValidationOutcomeComplete(pool, action);
        }
        if (
          action.kind === 'deposit_temporary_record' ||
          action.kind === 'deposit_temporary_cancel'
        ) {
          return await handleDepositTemporaryRecord(pool, action);
        }
        if (action.kind === 'deposit_temporary_cleanup_claim') {
          return await handleDepositTemporaryCleanupClaim(pool);
        }
        if (action.kind === 'deposit_temporary_cleanup_complete') {
          return await handleDepositTemporaryCleanupComplete(pool, action);
        }
        const inboundEventId = await recordInbound(
          pool,
          action,
          rawBody,
          config.telegramPlayerActionRuntime.payloadHmacSecret,
        );
        switch (action.kind) {
          case 'root_menu':
            return await handleRootMenu(pool, inboundEventId, config);
          case 'save_player_selection_command':
            return await handleSavePlayerSelection(pool, inboundEventId, action);
          case 'player_validation_request_command':
            return await handlePlayerValidationRequest(pool, inboundEventId, action);
          case 'saved_telebirr_destination_command':
            return await handleSavedTelebirrDestination(pool, inboundEventId, action, config);
          case 'saved_telebirr_proof_command':
            return await handleSavedTelebirrProof(pool, inboundEventId, action, config);
          case 'player_registration_callback':
            return await handleCallback(pool, inboundEventId, action, config);
          case 'player_id_text':
            return await handlePlayerId(pool, inboundEventId, action, config);
          case 'telebirr_deposit_destination_command':
            return await handleTelebirrDestination(pool, inboundEventId, action, config);
          case 'deposit_intent_command':
            return await handleDepositIntent(pool, inboundEventId, action, config);
          case 'deposit_reference_command':
            return await handleDepositReference(pool, inboundEventId, action, config);
          case 'deposit_proof_command':
            return await handleDepositProof(pool, inboundEventId, action, config);
          case 'deposit_proof_status_command':
            return await handleDepositProofStatus(pool, inboundEventId, action);
          case 'deposit_status_command':
            return await handleDepositStatus(pool, inboundEventId, action);
        }
      } catch (error) {
        if (error instanceof TelegramPlayerActionRuntimeUnavailableError) throw error;
        throw new TelegramPlayerActionRuntimeUnavailableError();
      }
    },
    async ready() {
      try {
        return await playerActionCatalogPreflightPassed(
          pool,
          config.telegramPlayerActionRuntime.routineTelebirrCandidateStagingEnabled ||
            config.telegramPlayerActionRuntime.routineTelebirrCandidateProductionEnabled,
          // Permit only the exact candidate grant during the gate-off handoff.
          true,
        );
      } catch {
        return false;
      }
    },
    close() {
      closePromise ??= pool.end();
      return closePromise;
    },
  };
}
