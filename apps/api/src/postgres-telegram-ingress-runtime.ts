import type { ApiConfig, ApiPostgresRuntimeConfig } from '@fetanagent/config/api';
import { Pool, type PoolConfig } from 'pg';

import {
  PostgresTelegramIngressNonceStore,
  type TelegramIngressNonceReservationDatabase,
} from './postgres-telegram-ingress-nonce-store.js';
import {
  PostgresTelegramPrivateInboundRecorder,
  type TelegramPrivateInboundRecordingDatabase,
} from './postgres-telegram-private-inbound-recorder.js';
import type {
  TelegramIngressNonceStore,
  TelegramPrivateInboundRecorder,
} from './telegram-ingress.js';

const POSTGRES_TELEGRAM_INGRESS_CONNECTION_TIMEOUT_MS = 5_000;
const POSTGRES_TELEGRAM_INGRESS_IDLE_TIMEOUT_MS = 10_000;
const POSTGRES_TELEGRAM_INGRESS_QUERY_TIMEOUT_MS = 5_000;
const POSTGRES_TELEGRAM_INGRESS_POOL_MAX = 2;

type PostgresTelegramIngressRuntimeConfig = Extract<
  ApiPostgresRuntimeConfig,
  { readonly enabled: true }
>;

type PostgresTelegramIngressEnabledApiConfig = ApiConfig & {
  readonly postgresRuntime: PostgresTelegramIngressRuntimeConfig;
  readonly telegramIngress: Extract<ApiConfig['telegramIngress'], { readonly enabled: true }>;
  readonly telegramPrivateIngressRuntime: Extract<
    ApiConfig['telegramPrivateIngressRuntime'],
    { readonly enabled: true }
  >;
};

export interface PostgresTelegramIngressRuntimePool {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
}

export interface PostgresTelegramIngressRuntime {
  readonly nonceStore: TelegramIngressNonceStore;
  readonly recorder: TelegramPrivateInboundRecorder;
  close(): Promise<void>;
}

export type PostgresTelegramIngressRuntimeFactory = (
  config: ApiConfig,
) => PostgresTelegramIngressRuntime;

export interface PostgresTelegramIngressRuntimeDependencies {
  readonly createPool?: (config: PoolConfig) => PostgresTelegramIngressRuntimePool;
}

/**
 * The private Telegram route is an inactive capability unless its transport gate, least-privilege
 * API Postgres runtime gate, and final private-ingress runtime gate are all true. This avoids a
 * process-local replay store being used accidentally when the API is configured to receive
 * private Telegram traffic.
 */
export function isPostgresTelegramIngressRuntimeEnabled(
  config: ApiConfig,
): config is PostgresTelegramIngressEnabledApiConfig {
  return (
    config.postgresRuntime.enabled &&
    config.telegramIngress.enabled &&
    config.telegramPrivateIngressRuntime.enabled
  );
}

/**
 * Uses decomposed, already-sanitized configuration fields rather than a DATABASE_URL string.
 * `verify-full` was validated by configuration loading; rejectUnauthorized keeps that TLS promise
 * at the pg-client boundary as well.
 */
export function createPostgresTelegramIngressPoolConfig(
  config: PostgresTelegramIngressRuntimeConfig,
): PoolConfig {
  if (config.tlsMode !== 'verify-full') {
    throw new Error('The Postgres Telegram ingress runtime requires TLS verify-full.');
  }

  return {
    application_name: 'fetanagent-api-telegram-ingress',
    connectionTimeoutMillis: POSTGRES_TELEGRAM_INGRESS_CONNECTION_TIMEOUT_MS,
    database: config.connection.database,
    host: config.connection.host,
    idleTimeoutMillis: POSTGRES_TELEGRAM_INGRESS_IDLE_TIMEOUT_MS,
    max: POSTGRES_TELEGRAM_INGRESS_POOL_MAX,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    query_timeout: POSTGRES_TELEGRAM_INGRESS_QUERY_TIMEOUT_MS,
    ssl: { rejectUnauthorized: true },
    statement_timeout: POSTGRES_TELEGRAM_INGRESS_QUERY_TIMEOUT_MS,
    user: config.connection.user,
  };
}

function createNonceReservationDatabase(
  pool: PostgresTelegramIngressRuntimePool,
): TelegramIngressNonceReservationDatabase {
  return {
    query(query, values) {
      // Each adapter call uses Pool.query directly. Neither this composer nor either adapter opens
      // a transaction, so the successful nonce reservation commits before recording is attempted.
      return pool.query(query, values);
    },
  };
}

function createPrivateInboundRecordingDatabase(
  pool: PostgresTelegramIngressRuntimePool,
): TelegramPrivateInboundRecordingDatabase {
  return {
    query(query, values) {
      // This is intentionally a separate Pool.query operation after nonce reservation, never a
      // shared client transaction that could roll the reservation back with a recorder failure.
      return pool.query(query, values);
    },
  };
}

/**
 * Composes the two narrow database adapters around one bounded pool. It does not execute a query
 * or open a socket at construction time; `pg` connects lazily on the first adapter call.
 */
export function createPostgresTelegramIngressRuntime(
  config: ApiConfig,
  dependencies: PostgresTelegramIngressRuntimeDependencies = {},
): PostgresTelegramIngressRuntime {
  if (!isPostgresTelegramIngressRuntimeEnabled(config)) {
    throw new Error(
      'The Postgres Telegram ingress runtime requires Postgres, Telegram ingress, and private ingress runtime gates.',
    );
  }

  const poolConfig = createPostgresTelegramIngressPoolConfig(config.postgresRuntime);
  const pool = dependencies.createPool?.(poolConfig) ?? new Pool(poolConfig);
  let closePromise: Promise<void> | undefined;

  return {
    nonceStore: new PostgresTelegramIngressNonceStore(createNonceReservationDatabase(pool)),
    recorder: new PostgresTelegramPrivateInboundRecorder(
      createPrivateInboundRecordingDatabase(pool),
    ),
    close() {
      closePromise ??= pool.end();
      return closePromise;
    },
  };
}
