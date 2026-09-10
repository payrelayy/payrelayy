import { createRequire } from 'node:module';

import {
  TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL,
  TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS,
  type TrustedTelebirrPostgresClient,
  type TrustedTelebirrPostgresQuery,
  type TrustedTelebirrPostgresRuntime,
  type TrustedTelebirrStagedEvidenceIdentity,
  type TrustedTelebirrVerifierWorkSource,
} from './postgres-trusted-telebirr-verifier.js';
import {
  decodeTrustedTelebirrVerificationRequest,
  type TrustedTelebirrCompletionInput,
  type TrustedTelebirrVerificationRequest,
  type TrustedTelebirrVerifierDatabase,
} from './trusted-telebirr-verifier.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export const LOAD_TELEBIRR_SHADOW_AUTHORITY_SQL = `
  select app.load_private_telebirr_shadow_verification_authority(
    $1::uuid, $2::uuid, $3::timestamptz
  ) as authority_payload
`;

export const COMPLETE_TELEBIRR_SHADOW_VERIFICATION_SQL = `
  select verification_outcome_id, outcome_disposition, outcome_reason_code,
         deposit_intent_id, deposit_payment_claim_id, execution_job_id,
         settlement_created, already_completed
    from app.complete_private_telebirr_shadow_verification(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
      $7::text, $8::text, $9::timestamptz, $10::text, $11::text,
      $12::text, $13::timestamptz, $14::text, $15::text, $16::text,
      $17::timestamptz, $18::bigint, $19::timestamptz, $20::text
    )
`;

export const LOAD_NEXT_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL = `
  select verification_attempt_id, lease_token, completion_request_key,
         observation_body_digest, signed_assignment, signed_observation
    from app.load_next_private_telebirr_shadow_staged_evidence()
`;

export const QUARANTINE_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL = `
  select app.quarantine_private_telebirr_shadow_staged_evidence(
    $1::uuid, $2::uuid, $3::text, $4::text
  ) as quarantined
`;

export const TELEBIRR_SHADOW_VERIFIER_SINGLETON_KEYS = Object.freeze([20260909, 220000] as const);
export const TELEBIRR_SHADOW_VERIFIER_SINGLETON_ACQUIRE_SQL = `
  select pg_catalog.pg_try_advisory_lock($1::integer, $2::integer)
    as singleton_acquired
`;
export const TELEBIRR_SHADOW_VERIFIER_SINGLETON_HELD_SQL = `
  select exists (
    select 1 from pg_catalog.pg_locks as advisory_lock
    where advisory_lock.locktype = 'advisory'
      and advisory_lock.pid = pg_catalog.pg_backend_pid()
      and advisory_lock.database = (
        select database_catalog.oid
          from pg_catalog.pg_database as database_catalog
         where database_catalog.datname = pg_catalog.current_database()
      )
      and advisory_lock.classid = $1::integer
      and advisory_lock.objid = $2::integer
      and advisory_lock.objsubid = 2
      and advisory_lock.granted
  ) as singleton_held
`;
export const TELEBIRR_SHADOW_VERIFIER_SINGLETON_RELEASE_SQL = `
  select pg_catalog.pg_advisory_unlock($1::integer, $2::integer)
    as singleton_released
`;

export class TelebirrShadowPostgresRuntimeUnavailableError extends Error {
  constructor() {
    super('The TeleBirr shadow PostgreSQL runtime is unavailable.');
    this.name = 'TelebirrShadowPostgresRuntimeUnavailableError';
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

function exactTrueRow(value: unknown): boolean {
  const record = exactRecord(value, TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS);
  return (
    record !== undefined &&
    TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS.every((key) => record[key] === true)
  );
}

function exactBooleanRow(value: unknown, key: string): boolean {
  return exactRecord(value, [key])?.[key] === true;
}

export async function assertTelebirrShadowVerifierCatalogPreflight(
  database: TrustedTelebirrPostgresQuery,
): Promise<void> {
  try {
    const result = await database.query(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL, []);
    if (result.rows.length !== 1 || !exactTrueRow(result.rows[0])) throw new Error();
  } catch {
    throw new TelebirrShadowPostgresRuntimeUnavailableError();
  }
}

export class PostgresTelebirrShadowVerifierDatabase implements TrustedTelebirrVerifierDatabase {
  constructor(private readonly database: TrustedTelebirrPostgresQuery) {}

  async loadAuthority(
    verificationAttemptId: string,
    leaseToken: string,
    occurredAt: string | null,
  ): Promise<unknown> {
    try {
      await assertTelebirrShadowVerifierCatalogPreflight(this.database);
      const result = await this.database.query(LOAD_TELEBIRR_SHADOW_AUTHORITY_SQL, [
        verificationAttemptId,
        leaseToken,
        occurredAt,
      ]);
      const row = exactRecord(result.rows[0], ['authority_payload']);
      const payload = row?.authority_payload;
      if (
        result.rows.length !== 1 ||
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        (Object.getPrototypeOf(payload) !== Object.prototype &&
          Object.getPrototypeOf(payload) !== null) ||
        (payload as Readonly<Record<string, unknown>>).verificationMode !== 'shadow'
      ) {
        throw new Error();
      }
      return payload;
    } catch {
      throw new TelebirrShadowPostgresRuntimeUnavailableError();
    }
  }

  async complete(input: TrustedTelebirrCompletionInput): Promise<unknown> {
    try {
      await assertTelebirrShadowVerifierCatalogPreflight(this.database);
      const result = await this.database.query(COMPLETE_TELEBIRR_SHADOW_VERIFICATION_SQL, [
        input.verificationAttemptId,
        input.leaseToken,
        input.completionRequestKey,
        input.observationBodyDigest,
        input.observationSignatureDigest,
        input.replayIdentity,
        input.sourceDocumentDigest,
        input.normalizedFactsDigest,
        input.observedAt,
        input.protocolDisposition,
        input.protocolReasonCode,
        input.assessmentInputDigest,
        input.assessedAt,
        input.disposition,
        input.reasonCode,
        input.evidenceDigest,
        input.retrievedAt,
        input.receiptPrincipalAmountMinor,
        input.occurredAt,
        input.receiverIdentityDigest,
      ]);
      if (result.rows.length !== 1) throw new Error();
      return result.rows[0];
    } catch {
      throw new TelebirrShadowPostgresRuntimeUnavailableError();
    }
  }
}

export class PostgresTelebirrShadowVerifierWorkSource implements TrustedTelebirrVerifierWorkSource {
  constructor(private readonly database: TrustedTelebirrPostgresQuery) {}

  async loadNext(): Promise<TrustedTelebirrVerificationRequest | null> {
    try {
      await assertTelebirrShadowVerifierCatalogPreflight(this.database);
      const result = await this.database.query(LOAD_NEXT_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL, []);
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) throw new Error();
      const row = exactRecord(result.rows[0], [
        'verification_attempt_id',
        'lease_token',
        'completion_request_key',
        'observation_body_digest',
        'signed_assignment',
        'signed_observation',
      ]);
      if (
        !row ||
        typeof row.verification_attempt_id !== 'string' ||
        !UUID_PATTERN.test(row.verification_attempt_id) ||
        typeof row.lease_token !== 'string' ||
        !UUID_PATTERN.test(row.lease_token) ||
        typeof row.observation_body_digest !== 'string' ||
        !SHA256_PATTERN.test(row.observation_body_digest)
      ) {
        throw new Error();
      }
      const request = decodeTrustedTelebirrVerificationRequest({
        contractVersion: 1,
        verificationAttemptId: row.verification_attempt_id,
        leaseToken: row.lease_token,
        completionRequestKey: row.completion_request_key,
        signedAssignment: row.signed_assignment,
        signedObservation: row.signed_observation,
      });
      if (!request || request.signedObservation.bodyDigest !== row.observation_body_digest) {
        await this.quarantineInvalid({
          verificationAttemptId: row.verification_attempt_id,
          leaseToken: row.lease_token,
          observationBodyDigest: row.observation_body_digest,
        });
        return null;
      }
      return request;
    } catch {
      throw new TelebirrShadowPostgresRuntimeUnavailableError();
    }
  }

  async quarantineInvalid(identity: TrustedTelebirrStagedEvidenceIdentity): Promise<void> {
    try {
      const exactIdentity = exactRecord(identity, [
        'verificationAttemptId',
        'leaseToken',
        'observationBodyDigest',
      ]);
      if (
        !exactIdentity ||
        typeof exactIdentity.verificationAttemptId !== 'string' ||
        !UUID_PATTERN.test(exactIdentity.verificationAttemptId) ||
        typeof exactIdentity.leaseToken !== 'string' ||
        !UUID_PATTERN.test(exactIdentity.leaseToken) ||
        typeof exactIdentity.observationBodyDigest !== 'string' ||
        !SHA256_PATTERN.test(exactIdentity.observationBodyDigest)
      ) {
        throw new Error();
      }
      await assertTelebirrShadowVerifierCatalogPreflight(this.database);
      const result = await this.database.query(QUARANTINE_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL, [
        exactIdentity.verificationAttemptId,
        exactIdentity.leaseToken,
        exactIdentity.observationBodyDigest,
        'trusted_evidence_invalid',
      ]);
      if (result.rows.length !== 1 || !exactBooleanRow(result.rows[0], 'quarantined')) {
        throw new Error();
      }
    } catch {
      throw new TelebirrShadowPostgresRuntimeUnavailableError();
    }
  }
}

export interface TelebirrShadowVerifierConnectionConfig {
  readonly ca: string;
  readonly database: 'postgres';
  readonly host: string;
  readonly password: string;
  readonly port: 5432;
  readonly user: 'fetanagent_telebirr_shadow_verifier_runtime';
}

interface PgModule {
  readonly Client: new (config: Readonly<Record<string, unknown>>) => TrustedTelebirrPostgresClient;
}

export interface TelebirrShadowPostgresRuntimeDependencies {
  readonly createClient?: (
    config: Readonly<Record<string, unknown>>,
  ) => TrustedTelebirrPostgresClient;
}

export async function createTelebirrShadowPostgresRuntime(
  connection: TelebirrShadowVerifierConnectionConfig,
  dependencies: TelebirrShadowPostgresRuntimeDependencies = {},
): Promise<TrustedTelebirrPostgresRuntime> {
  const { ca, ...postgresConnection } = connection;
  const clientConfig = Object.freeze({
    ...postgresConnection,
    application_name: 'fetanagent_telebirr_shadow_verifier',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    ssl: { ca, rejectUnauthorized: true },
  });
  const client =
    dependencies.createClient?.(clientConfig) ??
    (() => {
      const require = createRequire(import.meta.url);
      const { Client } = require('pg') as PgModule;
      return new Client(clientConfig);
    })();
  let available = false;
  let closed = false;
  let lockHeld = false;
  const markUnavailable = () => {
    available = false;
    lockHeld = false;
  };
  client.on('error', markUnavailable);
  client.on('end', markUnavailable);

  const guarded: TrustedTelebirrPostgresQuery = {
    async query(query, values) {
      if (!available || closed) throw new TelebirrShadowPostgresRuntimeUnavailableError();
      try {
        const result = await client.query(query, values);
        if (!available || closed) throw new Error();
        return result;
      } catch {
        markUnavailable();
        throw new TelebirrShadowPostgresRuntimeUnavailableError();
      }
    },
  };

  try {
    await client.connect();
    available = true;
    const acquired = await guarded.query(TELEBIRR_SHADOW_VERIFIER_SINGLETON_ACQUIRE_SQL, [
      ...TELEBIRR_SHADOW_VERIFIER_SINGLETON_KEYS,
    ]);
    if (acquired.rows.length !== 1 || !exactBooleanRow(acquired.rows[0], 'singleton_acquired')) {
      throw new Error();
    }
    lockHeld = true;
    await assertTelebirrShadowVerifierCatalogPreflight(guarded);
  } catch {
    available = false;
    lockHeld = false;
    await client.end().catch(() => undefined);
    client.removeListener('error', markUnavailable);
    client.removeListener('end', markUnavailable);
    throw new TelebirrShadowPostgresRuntimeUnavailableError();
  }

  const database = new PostgresTelebirrShadowVerifierDatabase(guarded);
  const workSource = new PostgresTelebirrShadowVerifierWorkSource(guarded);
  return Object.freeze({
    database,
    workSource,
    async ready() {
      if (!available || closed || !lockHeld) return false;
      try {
        const held = await guarded.query(TELEBIRR_SHADOW_VERIFIER_SINGLETON_HELD_SQL, [
          ...TELEBIRR_SHADOW_VERIFIER_SINGLETON_KEYS,
        ]);
        if (held.rows.length !== 1 || !exactBooleanRow(held.rows[0], 'singleton_held')) {
          markUnavailable();
          return false;
        }
        await assertTelebirrShadowVerifierCatalogPreflight(guarded);
        return available && !closed && lockHeld;
      } catch {
        markUnavailable();
        return false;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      available = false;
      let failed = false;
      if (lockHeld) {
        try {
          const released = await client.query(TELEBIRR_SHADOW_VERIFIER_SINGLETON_RELEASE_SQL, [
            ...TELEBIRR_SHADOW_VERIFIER_SINGLETON_KEYS,
          ]);
          if (
            released.rows.length !== 1 ||
            !exactBooleanRow(released.rows[0], 'singleton_released')
          ) {
            failed = true;
          }
        } catch {
          failed = true;
        } finally {
          lockHeld = false;
        }
      }
      try {
        await client.end();
      } catch {
        failed = true;
      } finally {
        client.removeListener('error', markUnavailable);
        client.removeListener('end', markUnavailable);
      }
      if (failed) throw new TelebirrShadowPostgresRuntimeUnavailableError();
    },
  });
}
