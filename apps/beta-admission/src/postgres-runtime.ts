import type { BetaAdmissionRuntimeConfig } from '@payreplayy/config/beta-admission';
import { Pool, type PoolConfig } from 'pg';

import { runBetaAdmissionCatalogPreflight } from './catalog-preflight.js';
import { PostgresTelegramBetaInviteAdmissionNonceStore } from './postgres-telegram-beta-invite-admission-nonce-store.js';
import { PostgresTelegramBetaInviteAdmissionAdapter } from './telegram-beta-invite-admission.js';

export interface BetaAdmissionPostgresRuntime {
  readonly admission: Pick<PostgresTelegramBetaInviteAdmissionAdapter, 'redeem'>;
  readonly nonceStore: Pick<PostgresTelegramBetaInviteAdmissionNonceStore, 'durable' | 'reserve'>;
  ready(): Promise<boolean>;
  close(): Promise<void>;
}

export class BetaAdmissionPostgresRuntimeUnavailableError extends Error {
  constructor() {
    super('The beta-admission PostgreSQL runtime is unavailable.');
    this.name = 'BetaAdmissionPostgresRuntimeUnavailableError';
  }
}

export function createBetaAdmissionPoolConfig(
  config: Extract<BetaAdmissionRuntimeConfig, { readonly enabled: true }>,
): PoolConfig {
  if (config.tlsMode !== 'verify-full') {
    throw new BetaAdmissionPostgresRuntimeUnavailableError();
  }
  return {
    application_name: 'payreplayy-beta-admission',
    database: config.connection.database,
    connectionTimeoutMillis: 5_000,
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

/**
 * Creates the only database pool owned by the service. The role has a one-connection limit, so the
 * application pool is deliberately capped at one and all work remains short-lived.
 */
export async function createBetaAdmissionPostgresRuntime(
  config: Extract<BetaAdmissionRuntimeConfig, { readonly enabled: true }>,
): Promise<BetaAdmissionPostgresRuntime> {
  const pool = new Pool(createBetaAdmissionPoolConfig(config));
  let closed = false;
  let poolHealthy = true;
  pool.on('error', () => {
    poolHealthy = false;
  });

  try {
    const preflight = await runBetaAdmissionCatalogPreflight(config, { pool });
    if (!preflight.passed) throw new BetaAdmissionPostgresRuntimeUnavailableError();
  } catch {
    await pool.end();
    throw new BetaAdmissionPostgresRuntimeUnavailableError();
  }

  const database = {
    query: async (query: string, values: readonly string[]) => pool.query(query, [...values]),
  };
  const nonceDatabase = {
    query: async (query: string, values: readonly [string, Date]) => pool.query(query, [...values]),
  };

  return {
    admission: new PostgresTelegramBetaInviteAdmissionAdapter(database),
    nonceStore: new PostgresTelegramBetaInviteAdmissionNonceStore(nonceDatabase),
    ready: async () => {
      if (closed) return false;
      try {
        const result = await pool.query<{ ready: boolean }>(
          "select current_user = 'payreplayy_beta_admission_runtime' as ready",
        );
        const ready = result.rows.length === 1 && result.rows[0]?.ready === true;
        poolHealthy = ready;
        return poolHealthy;
      } catch {
        poolHealthy = false;
        return false;
      }
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
