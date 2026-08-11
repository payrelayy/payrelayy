import { createHmac } from 'node:crypto';

import type { ApiConfig } from '@payreplayy/config/api';
import type {
  TelegramPrivateActionEnvelope,
  TelegramPrivateActionResult,
} from '@payreplayy/contracts';
import { Pool, type PoolConfig } from 'pg';

import {
  createTelegramActionSemanticHmac,
  decodePlayerRegistrationCapabilityCallback,
  derivePlayerRegistrationCapabilityPresentation,
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
    .update('payreplayy:telegram:private-action:payload:v1\n', 'utf8')
    .update(rawBody)
    .digest('hex')}`;
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
  const row = oneRow(
    (
      await database.query(ISSUE_CAPABILITY_SQL, [
        originInboundEventId,
        presentation.capabilityId,
        presentation.tokenFingerprint,
        presentation.issueSemanticInputHmac,
      ])
    ).rows,
  );
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
  if (row.result_outcome === 'rejected' && row.result_reason_code === 'invalid_player_id') {
    return { version: 1, outcome: 'invalid_player_id' };
  }
  if (row.result_outcome === 'rejected') return { version: 1, outcome: 'restart_required' };
  throw new TelegramPlayerActionRuntimeUnavailableError();
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
    application_name: 'payreplayy-player-actions',
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
