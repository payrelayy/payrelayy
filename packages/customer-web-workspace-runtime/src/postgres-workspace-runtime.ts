import {
  CUSTOMER_WEB_DATABASE_DIRECT_HOST,
  CUSTOMER_WEB_DATABASE_RUNTIME_ROLE,
  CUSTOMER_WEB_STAGING_SUPABASE_PROJECT_REFERENCE,
  type CustomerWebWorkspaceConfig,
} from '@fetanagent/config/customer-web';
import { projectCustomerDepositStatus } from '@fetanagent/contracts';
import type { DepositStatus } from '@fetanagent/domain';
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
const CIPHERTEXT_PATTERN = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const MASKED_REFERENCE_PATTERN = /^\*\*\*[A-Z0-9._-]{4}$/u;
const AMOUNT_MINOR_PATTERN = /^[1-9][0-9]*$/u;
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

export const OPEN_CUSTOMER_WEB_DEPOSIT_INTENT_SQL = `
  select deposit_intent_id, provider_code, receiver_account_holder_name,
         receiver_account_masked, receiver_customer_instruction, expected_amount_minor,
         currency_code, payment_deadline_at, deposit_status, request_key_already_used
  from app.open_customer_web_deposit_intent($1::uuid, $2::uuid, $3::text, $4::bigint)
`;

export const CAPTURE_CUSTOMER_WEB_DEPOSIT_REFERENCE_SQL = `
  select result_deposit_intent_id, submission_status, deposit_status, submitted_at,
         request_key_already_used
  from app.capture_customer_web_deposit_reference(
    $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::smallint
  )
`;

export const LIST_CUSTOMER_WEB_DEPOSITS_SQL = `
  select deposit_intent_id, expected_amount_minor, currency_code, deposit_status,
         created_at, updated_at
  from app.list_customer_web_deposits($1::uuid, $2::integer)
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

function validDepositStatus(value: unknown): value is DepositStatus {
  return typeof value === 'string' && DEPOSIT_STATUSES.has(value as DepositStatus);
}

function validAmountMinor(value: unknown): value is string {
  if (typeof value !== 'string' || !AMOUNT_MINOR_PATTERN.test(value)) return false;
  const amount = BigInt(value);
  return amount >= 2_500n && amount <= 2_500_000n;
}

function validProtectedReference(input: DataRecord): boolean {
  return (
    typeof input.ciphertext === 'string' &&
    input.ciphertext.length <= 512 &&
    CIPHERTEXT_PATTERN.test(input.ciphertext) &&
    typeof input.fingerprint === 'string' &&
    FINGERPRINT_PATTERN.test(input.fingerprint) &&
    typeof input.masked === 'string' &&
    MASKED_REFERENCE_PATTERN.test(input.masked) &&
    input.keyVersion === 1
  );
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
    async captureDepositReference(
      input: Parameters<CustomerWorkspacePort['captureDepositReference']>[0],
    ) {
      if (isUnavailable()) return GENERIC_FAILURE;
      return dispatch(async () => {
        let databaseQueryCompleted = false;
        try {
          if (isUnavailable()) return GENERIC_FAILURE;
          const record = readExactRecord(input, [
            'authUserId',
            'ciphertext',
            'depositIntentId',
            'fingerprint',
            'keyVersion',
            'masked',
            'requestKey',
          ]);
          if (
            !validAuthUserId(record.authUserId) ||
            !validAuthUserId(record.depositIntentId) ||
            !validRequestKey(record.requestKey) ||
            !validProtectedReference(record)
          ) {
            return GENERIC_FAILURE;
          }
          const result = await database.query(CAPTURE_CUSTOMER_WEB_DEPOSIT_REFERENCE_SQL, [
            record.authUserId,
            record.requestKey,
            record.depositIntentId,
            record.ciphertext,
            record.fingerprint,
            record.masked,
            record.keyVersion,
          ]);
          databaseQueryCompleted = true;
          if (isTerminallyUnavailable()) return GENERIC_FAILURE;
          const row = oneRow(result.rows, [
            'result_deposit_intent_id',
            'submission_status',
            'deposit_status',
            'submitted_at',
            'request_key_already_used',
          ]);
          if (
            row.result_deposit_intent_id !== record.depositIntentId ||
            row.submission_status !== 'verification_enqueued' ||
            row.deposit_status !== 'verification_pending' ||
            !validDate(row.submitted_at) ||
            typeof row.request_key_already_used !== 'boolean'
          ) {
            markUnhealthy();
            return GENERIC_FAILURE;
          }
          return {
            ok: true,
            depositIntentId: record.depositIntentId,
            replayed: row.request_key_already_used,
            status: projectCustomerDepositStatus('verification_pending'),
            submittedAt: row.submitted_at.toISOString(),
          } as const;
        } catch {
          if (databaseQueryCompleted) markUnhealthy();
          return GENERIC_FAILURE;
        }
      });
    },

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

    async listDeposits(input: Parameters<CustomerWorkspacePort['listDeposits']>[0]) {
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
          const result = await database.query(LIST_CUSTOMER_WEB_DEPOSITS_SQL, [
            record.authUserId,
            record.limit,
          ]);
          databaseQueryCompleted = true;
          if (isTerminallyUnavailable()) return GENERIC_FAILURE;
          if (result.rows.length > (record.limit as number)) {
            markUnhealthy();
            return GENERIC_FAILURE;
          }
          const deposits = result.rows.map((value) => {
            const row = readExactRecord(value, [
              'deposit_intent_id',
              'expected_amount_minor',
              'currency_code',
              'deposit_status',
              'created_at',
              'updated_at',
            ]);
            if (
              !validAuthUserId(row.deposit_intent_id) ||
              !validAmountMinor(row.expected_amount_minor) ||
              row.currency_code !== 'ETB' ||
              !validDepositStatus(row.deposit_status) ||
              !validDate(row.created_at) ||
              !validDate(row.updated_at)
            ) {
              throw new Error();
            }
            return Object.freeze({
              amountMinor: row.expected_amount_minor,
              createdAt: row.created_at.toISOString(),
              currencyCode: 'ETB' as const,
              depositIntentId: row.deposit_intent_id,
              status: projectCustomerDepositStatus(row.deposit_status),
              updatedAt: row.updated_at.toISOString(),
            });
          });
          return { ok: true, deposits: Object.freeze(deposits) } as const;
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

    async openDeposit(input: Parameters<CustomerWorkspacePort['openDeposit']>[0]) {
      if (isUnavailable()) return GENERIC_FAILURE;
      return dispatch(async () => {
        let databaseQueryCompleted = false;
        try {
          if (isUnavailable()) return GENERIC_FAILURE;
          const record = readExactRecord(input, [
            'amountMinor',
            'authUserId',
            'playerId',
            'requestKey',
          ]);
          if (
            !validAmountMinor(record.amountMinor) ||
            !validAuthUserId(record.authUserId) ||
            !validPlayerId(record.playerId) ||
            !validRequestKey(record.requestKey)
          ) {
            return GENERIC_FAILURE;
          }
          const result = await database.query(OPEN_CUSTOMER_WEB_DEPOSIT_INTENT_SQL, [
            record.authUserId,
            record.requestKey,
            record.playerId,
            record.amountMinor,
          ]);
          databaseQueryCompleted = true;
          if (isTerminallyUnavailable()) return GENERIC_FAILURE;
          const row = oneRow(result.rows, [
            'deposit_intent_id',
            'provider_code',
            'receiver_account_holder_name',
            'receiver_account_masked',
            'receiver_customer_instruction',
            'expected_amount_minor',
            'currency_code',
            'payment_deadline_at',
            'deposit_status',
            'request_key_already_used',
          ]);
          if (
            !validAuthUserId(row.deposit_intent_id) ||
            row.provider_code !== 'cbe_birr' ||
            typeof row.receiver_account_holder_name !== 'string' ||
            row.receiver_account_holder_name.length < 1 ||
            row.receiver_account_holder_name.length > 160 ||
            typeof row.receiver_account_masked !== 'string' ||
            row.receiver_account_masked.length < 1 ||
            row.receiver_account_masked.length > 128 ||
            typeof row.receiver_customer_instruction !== 'string' ||
            row.receiver_customer_instruction.length < 1 ||
            row.receiver_customer_instruction.length > 500 ||
            row.expected_amount_minor !== record.amountMinor ||
            row.currency_code !== 'ETB' ||
            !validDate(row.payment_deadline_at) ||
            row.deposit_status !== 'intake_received' ||
            typeof row.request_key_already_used !== 'boolean'
          ) {
            markUnhealthy();
            return GENERIC_FAILURE;
          }
          return {
            ok: true,
            instructions: Object.freeze({
              amountMinor: record.amountMinor,
              currencyCode: 'ETB' as const,
              customerInstruction: row.receiver_customer_instruction,
              depositIntentId: row.deposit_intent_id,
              paymentDeadline: row.payment_deadline_at.toISOString(),
              providerName: 'CBE Birr' as const,
              receiverAccountHolderName: row.receiver_account_holder_name,
              receiverAccountMasked: row.receiver_account_masked,
              replayed: row.request_key_already_used,
              status: projectCustomerDepositStatus('intake_received'),
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
