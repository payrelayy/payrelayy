import {
  CUSTOMER_WEB_DATABASE_DIRECT_HOST,
  CUSTOMER_WEB_DATABASE_RUNTIME_ROLE,
  CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE,
  type CustomerWebWorkspaceConfig,
} from '@fetanagent/config/customer-web';
import { Pool, type PoolConfig } from 'pg';

import { customerWorkspaceCatalogPreflightPassed } from './workspace-catalog-preflight.js';
import type {
  CustomerWorkspaceDisplayStatus,
  CustomerWorkspaceFailure,
  CustomerWorkspacePort,
  CustomerWorkspaceRegistration,
  CustomerWorkspaceRuntime,
} from './types.js';

type EnabledCustomerWebWorkspaceConfig = Extract<
  CustomerWebWorkspaceConfig,
  { readonly enabled: true }
>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLAYER_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]+$/u;
const DISPLAY_STATUSES = new Set<CustomerWorkspaceDisplayStatus>([
  'checking',
  'ready',
  'needs_attention',
]);
const GENERIC_FAILURE: CustomerWorkspaceFailure = Object.freeze({
  error: 'customer_workspace_unavailable',
  ok: false,
});

export const ENSURE_CUSTOMER_WEB_ACCOUNT_SQL = `
  select account_status, account_created
  from app.ensure_customer_web_account($1::uuid)
`;

export const SUBMIT_CUSTOMER_WEB_PLAYER_REGISTRATION_SQL = `
  select platform_code, request_status, existing_request_reused,
         request_key_already_used, request_created_at
  from app.submit_customer_web_player_registration($1::uuid, $2::uuid, $3::text)
`;

export const LIST_CUSTOMER_WEB_PLAYER_REGISTRATIONS_SQL = `
  select platform_code, submitted_player_id, request_status,
         request_created_at, request_updated_at
  from app.list_customer_web_player_registrations($1::uuid, $2::integer)
`;

type DataRecord = Readonly<Record<string, unknown>>;

export interface CustomerWorkspaceDatabase {
  query(query: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  end(): Promise<void>;
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface CustomerWorkspacePostgresRuntimeDependencies {
  readonly database?: CustomerWorkspaceDatabase;
  readonly now?: () => number;
}

type SerializedWorkspaceDispatch = <Result>(operation: () => Promise<Result>) => Promise<Result>;

export class CustomerWorkspaceRuntimeUnavailableError extends Error {
  constructor() {
    super('The customer workspace runtime is unavailable.');
    this.name = 'CustomerWorkspaceRuntimeUnavailableError';
  }
}

function createSerializedWorkspaceDispatch(): SerializedWorkspaceDispatch {
  let tail: Promise<void> = Promise.resolve();
  return <Result>(operation: () => Promise<Result>) => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

function readDataRecord(value: unknown): DataRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new Error();
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error();
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    throw new Error();
  }
}

function readExactRecord(value: unknown, keys: readonly string[]): DataRecord {
  const record = readDataRecord(value);
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    !actualKeys.every((key, index) => key === expectedKeys[index])
  ) {
    throw new Error();
  }
  return record;
}

function oneRow(rows: readonly unknown[], keys: readonly string[]): DataRecord {
  if (rows.length !== 1) throw new Error();
  return readExactRecord(rows[0], keys);
}

function validAuthUserId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validRequestKey(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_KEY_PATTERN.test(value);
}

function validPlayerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 64 &&
    value === value.trim() &&
    PLAYER_ID_PATTERN.test(value)
  );
}

function validDisplayStatus(value: unknown): value is CustomerWorkspaceDisplayStatus {
  return typeof value === 'string' && DISPLAY_STATUSES.has(value as CustomerWorkspaceDisplayStatus);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function registrationFromRow(row: DataRecord): CustomerWorkspaceRegistration {
  if (
    row.platform_code !== 'kemerbet' ||
    !validPlayerId(row.submitted_player_id) ||
    !validDisplayStatus(row.request_status) ||
    !validDate(row.request_created_at) ||
    !validDate(row.request_updated_at)
  ) {
    throw new Error();
  }
  return Object.freeze({ playerId: row.submitted_player_id, status: row.request_status });
}

function validateEnabledConfig(config: EnabledCustomerWebWorkspaceConfig): void {
  if (
    config.stage !== 'staging' ||
    config.projectReference !== CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE ||
    config.tlsMode !== 'verify-full' ||
    config.connection.database !== 'postgres' ||
    config.connection.host !== CUSTOMER_WEB_DATABASE_DIRECT_HOST ||
    config.connection.port !== 5432 ||
    config.connection.user !== CUSTOMER_WEB_DATABASE_RUNTIME_ROLE ||
    typeof config.connection.password !== 'string' ||
    config.connection.password === ''
  ) {
    throw new CustomerWorkspaceRuntimeUnavailableError();
  }
}

export function createCustomerWorkspacePoolConfig(
  config: EnabledCustomerWebWorkspaceConfig,
): PoolConfig {
  validateEnabledConfig(config);
  return {
    application_name: 'fetanagent-customer-web',
    connectionTimeoutMillis: 5_000,
    database: config.connection.database,
    host: config.connection.host,
    idleTimeoutMillis: 10_000,
    idle_in_transaction_session_timeout: 5_000,
    lock_timeout: 1_000,
    max: 1,
    min: 0,
    password: config.connection.password,
    port: config.connection.port,
    query_timeout: 5_000,
    ssl: { rejectUnauthorized: true },
    statement_timeout: 5_000,
    user: config.connection.user,
  };
}

function createWorkspacePort(
  database: CustomerWorkspaceDatabase,
  isUnavailable: () => boolean,
  isTerminallyUnavailable: () => boolean,
  dispatch: SerializedWorkspaceDispatch,
  markUnhealthy: () => void,
): CustomerWorkspacePort {
  return Object.freeze({
    async ensureAccount(input: Parameters<CustomerWorkspacePort['ensureAccount']>[0]) {
      if (isUnavailable()) return GENERIC_FAILURE;
      return dispatch(async () => {
        let databaseQueryCompleted = false;
        try {
          if (isUnavailable()) return GENERIC_FAILURE;
          const record = readExactRecord(input, ['authUserId']);
          if (!validAuthUserId(record.authUserId)) return GENERIC_FAILURE;
          const result = await database.query(ENSURE_CUSTOMER_WEB_ACCOUNT_SQL, [record.authUserId]);
          databaseQueryCompleted = true;
          if (isTerminallyUnavailable()) return GENERIC_FAILURE;
          const row = oneRow(result.rows, ['account_status', 'account_created']);
          if (row.account_status !== 'active' || typeof row.account_created !== 'boolean') {
            markUnhealthy();
            return GENERIC_FAILURE;
          }
          if (isUnavailable()) return GENERIC_FAILURE;
          return { ok: true, status: 'active' } as const;
        } catch {
          if (databaseQueryCompleted) markUnhealthy();
          return GENERIC_FAILURE;
        }
      });
    },

    async listPlayerRegistrations(
      input: Parameters<CustomerWorkspacePort['listPlayerRegistrations']>[0],
    ) {
      if (isUnavailable()) return GENERIC_FAILURE;
      return dispatch(async () => {
        let databaseQueryCompleted = false;
        try {
          if (isUnavailable()) return GENERIC_FAILURE;
          const record = readExactRecord(input, ['authUserId', 'limit']);
          if (
            !validAuthUserId(record.authUserId) ||
            !Number.isSafeInteger(record.limit) ||
            (record.limit as number) < 1 ||
            (record.limit as number) > 20
          ) {
            return GENERIC_FAILURE;
          }
          const result = await database.query(LIST_CUSTOMER_WEB_PLAYER_REGISTRATIONS_SQL, [
            record.authUserId,
            record.limit,
          ]);
          databaseQueryCompleted = true;
          if (isTerminallyUnavailable()) return GENERIC_FAILURE;
          if (result.rows.length > (record.limit as number)) {
            markUnhealthy();
            return GENERIC_FAILURE;
          }
          const registrations = result.rows.map((row) =>
            registrationFromRow(
              readExactRecord(row, [
                'platform_code',
                'submitted_player_id',
                'request_status',
                'request_created_at',
                'request_updated_at',
              ]),
            ),
          );
          if (isUnavailable()) return GENERIC_FAILURE;
          return { ok: true, registrations: Object.freeze(registrations) } as const;
        } catch {
          if (databaseQueryCompleted) markUnhealthy();
          return GENERIC_FAILURE;
        }
      });
    },

    async submitPlayerRegistration(
      input: Parameters<CustomerWorkspacePort['submitPlayerRegistration']>[0],
    ) {
      if (isUnavailable()) return GENERIC_FAILURE;
      return dispatch(async () => {
        let databaseQueryCompleted = false;
        try {
          if (isUnavailable()) return GENERIC_FAILURE;
          const record = readExactRecord(input, ['authUserId', 'playerId', 'requestKey']);
          if (
            !validAuthUserId(record.authUserId) ||
            !validPlayerId(record.playerId) ||
            !validRequestKey(record.requestKey)
          ) {
            return GENERIC_FAILURE;
          }
          const result = await database.query(SUBMIT_CUSTOMER_WEB_PLAYER_REGISTRATION_SQL, [
            record.authUserId,
            record.requestKey,
            record.playerId,
          ]);
          databaseQueryCompleted = true;
          if (isTerminallyUnavailable()) return GENERIC_FAILURE;
          const row = oneRow(result.rows, [
            'platform_code',
            'request_status',
            'existing_request_reused',
            'request_key_already_used',
            'request_created_at',
          ]);
          if (
            row.platform_code !== 'kemerbet' ||
            !validDisplayStatus(row.request_status) ||
            typeof row.existing_request_reused !== 'boolean' ||
            typeof row.request_key_already_used !== 'boolean' ||
            !validDate(row.request_created_at)
          ) {
            markUnhealthy();
            return GENERIC_FAILURE;
          }
          if (isUnavailable()) return GENERIC_FAILURE;
          return {
            ok: true,
            registration: Object.freeze({
              playerId: record.playerId,
              status: row.request_status,
            }),
          } as const;
        } catch {
          if (databaseQueryCompleted) markUnhealthy();
          return GENERIC_FAILURE;
        }
      });
    },
  });
}

/**
 * Creates the sole direct-Postgres workspace capability owned by the customer web process. Startup is
 * catalog-preflighted, the pool never exceeds one connection, and no query can address a table.
 */
export async function createCustomerWorkspacePostgresRuntime(
  config: EnabledCustomerWebWorkspaceConfig,
  dependencies: CustomerWorkspacePostgresRuntimeDependencies = {},
): Promise<CustomerWorkspaceRuntime> {
  const poolConfig = createCustomerWorkspacePoolConfig(config);
  const pgPool = dependencies.database ? undefined : new Pool(poolConfig);
  const database: CustomerWorkspaceDatabase =
    dependencies.database ??
    ({
      async query(query, values) {
        const result = await pgPool!.query(query, [...values]);
        return { rows: result.rows as readonly unknown[] };
      },
      async end() {
        await pgPool!.end();
      },
      on(event, listener) {
        return pgPool!.on(event, listener);
      },
    } satisfies CustomerWorkspaceDatabase);
  let closed = false;
  let poolHealthy = true;
  let closePromise: Promise<void> | undefined;
  const now = dependencies.now ?? Date.now;
  const readinessTtlMs = 30_000;
  let lastPreflightAt = 0;
  let preflightInProgress = false;
  let readinessPromise: Promise<boolean> | undefined;
  const dispatch = createSerializedWorkspaceDispatch();
  database.on?.('error', () => {
    poolHealthy = false;
  });

  try {
    const initialPreflightPassed = await customerWorkspaceCatalogPreflightPassed(database);
    if (!initialPreflightPassed || !poolHealthy) throw new Error();
    lastPreflightAt = now();
  } catch {
    try {
      await database.end();
    } catch {
      // The public startup error deliberately remains generic.
    }
    throw new CustomerWorkspaceRuntimeUnavailableError();
  }

  const port = createWorkspacePort(
    database,
    () => closed || !poolHealthy || preflightInProgress,
    () => closed || !poolHealthy,
    dispatch,
    () => {
      poolHealthy = false;
    },
  );
  return Object.freeze({
    ...port,
    async ready() {
      if (closed || !poolHealthy) return false;
      if (now() - lastPreflightAt < readinessTtlMs) return true;
      if (readinessPromise) return readinessPromise;
      preflightInProgress = true;
      readinessPromise = dispatch(async () => {
        if (closed || !poolHealthy) return false;
        try {
          const preflightPassed = await customerWorkspaceCatalogPreflightPassed(database);
          if (!preflightPassed || !poolHealthy || closed) {
            poolHealthy = false;
            return false;
          }
          lastPreflightAt = now();
          return true;
        } catch {
          poolHealthy = false;
          return false;
        }
      }).finally(() => {
        preflightInProgress = false;
        readinessPromise = undefined;
      });
      return readinessPromise;
    },
    close() {
      closed = true;
      closePromise ??= database.end();
      return closePromise;
    },
  });
}
