import type { BetaAdmissionRuntimeConfig } from '@payreplayy/config/beta-admission';
import { describe, expect, it } from 'vitest';

import {
  BetaAdmissionPostgresRuntimeUnavailableError,
  createBetaAdmissionPoolConfig,
} from './postgres-runtime.js';

const config = {
  enabled: true,
  stage: 'staging',
  projectReference: 'spzpiyxheappsfyswewl',
  connection: {
    database: 'postgres',
    host: 'db.spzpiyxheappsfyswewl.supabase.co',
    password: 'test-password',
    port: 5432,
    user: 'payreplayy_beta_admission_runtime',
  },
  tlsMode: 'verify-full',
  transportHmacSecret: 'a'.repeat(64),
  payloadHmacSecret: 'b'.repeat(64),
} satisfies Extract<BetaAdmissionRuntimeConfig, { readonly enabled: true }>;

describe('beta-admission bounded PostgreSQL pool', () => {
  it('enforces one connection, verify-full, and strict client/server timeouts', () => {
    expect(createBetaAdmissionPoolConfig(config)).toMatchObject({
      max: 1,
      min: 0,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
      lock_timeout: 1_000,
      idle_in_transaction_session_timeout: 5_000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it('fails closed if an unsafe cast removes the verify-full promise', () => {
    expect(() =>
      createBetaAdmissionPoolConfig({
        ...config,
        tlsMode: 'require',
      } as unknown as typeof config),
    ).toThrow(BetaAdmissionPostgresRuntimeUnavailableError);
  });
});
