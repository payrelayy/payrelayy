import { createHmac } from 'node:crypto';

import type { ApiConfig } from '@fetanagent/config/api';
import {
  projectCustomerDepositStatus,
  type TelegramPrivateActionEnvelope,
  type TelegramPrivateActionResult,
} from '@fetanagent/contracts';
import {
  protectCbeBirrDepositReference,
  protectDepositProofReference,
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
import type { TelegramPrivateActionNonceStore } from './telegram-private-action.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HMAC_VALUE_PATTERN = /^hmac-sha256-v1:[0-9a-f]{64}$/;

const RECORD_INBOUND_SQL = `
  select inbound_event_id, received_at, inbound_event_already_recorded
  from app.record_admitted_telegram_private_inbound_event(
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

async function recordInbound(
  database: TelegramPlayerActionDatabase,
  action: TelegramPrivateActionEnvelope,
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
  return { version: 1, outcome: 'menu', callbackData: presentation.callbackData };
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
  if (config.financialActionsMode !== 'dry_run') {
    return { version: 1, outcome: 'deposit_unavailable' };
  }

  const protectedReference = protectDepositProofReference({
    provider: action.providerCode,
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
    providerCode: action.providerCode,
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
        action.providerCode,
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
    row.provider_code !== action.providerCode ||
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
    providerCode: action.providerCode,
    providerName: action.providerCode === 'cbe_birr' ? 'CBE Birr' : 'TeleBirr',
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
        const inboundEventId = await recordInbound(
          pool,
          action,
          rawBody,
          config.telegramPlayerActionRuntime.payloadHmacSecret,
        );
        switch (action.kind) {
          case 'root_menu':
            return await handleRootMenu(pool, inboundEventId, config);
          case 'player_registration_callback':
            return await handleCallback(pool, inboundEventId, action, config);
          case 'player_id_text':
            return await handlePlayerId(pool, inboundEventId, action, config);
          case 'deposit_intent_command':
            return await handleDepositIntent(pool, inboundEventId, action, config);
          case 'deposit_reference_command':
            return await handleDepositReference(pool, inboundEventId, action, config);
          case 'deposit_proof_command':
            return await handleDepositProof(pool, inboundEventId, action, config);
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
        return await playerActionCatalogPreflightPassed(pool);
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
