import { describe, expect, it, vi } from 'vitest';

import {
  COMPLETE_TRUSTED_TELEBIRR_VERIFICATION_SQL,
  LOAD_TRUSTED_TELEBIRR_AUTHORITY_SQL,
  PostgresTrustedTelebirrVerifierDatabase,
  TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL,
  TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS,
  TRUSTED_TELEBIRR_VERIFIER_SINGLETON_ACQUIRE_SQL,
  TRUSTED_TELEBIRR_VERIFIER_SINGLETON_HELD_SQL,
  TRUSTED_TELEBIRR_VERIFIER_SINGLETON_KEYS,
  TRUSTED_TELEBIRR_VERIFIER_SINGLETON_RELEASE_SQL,
  TrustedTelebirrPostgresRuntimeUnavailableError,
  assertTrustedTelebirrVerifierCatalogPreflight,
  createTrustedTelebirrPostgresRuntime,
  type TrustedTelebirrPostgresClient,
} from './postgres-trusted-telebirr-verifier.js';
import type { TrustedTelebirrCompletionInput } from './trusted-telebirr-verifier.js';

const truePreflight = Object.fromEntries(
  TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS.map((key) => [key, true]),
);

function completionInput(
  overrides: Partial<TrustedTelebirrCompletionInput> = {},
): TrustedTelebirrCompletionInput {
  return {
    verificationAttemptId: '11111111-1111-4111-8111-111111111111',
    leaseToken: '22222222-2222-4222-8222-222222222222',
    completionRequestKey: '33333333-3333-4333-8333-333333333333',
    observationBodyDigest: `sha256:${'1'.repeat(64)}`,
    observationSignatureDigest: `sha256:${'2'.repeat(64)}`,
    replayIdentity: `sha256:${'3'.repeat(64)}`,
    sourceDocumentDigest: `sha256:${'4'.repeat(64)}`,
    normalizedFactsDigest: `sha256:${'5'.repeat(64)}`,
    observedAt: '2026-08-20T18:03:00.000Z',
    protocolDisposition: 'would_review',
    protocolReasonCode: 'receipt_requires_review',
    assessmentInputDigest: `sha256:${'6'.repeat(64)}`,
    assessedAt: '2026-08-20T18:03:05.000Z',
    disposition: 'review_required',
    reasonCode: 'source_unavailable',
    evidenceDigest: `sha256:${'7'.repeat(64)}`,
    retrievedAt: '2026-08-20T18:03:00.000Z',
    receiptPrincipalAmountMinor: null,
    occurredAt: null,
    receiverIdentityDigest: null,
    ...overrides,
  };
}

describe('trusted TeleBirr PostgreSQL boundary', () => {
  it('preflights only the bounded runtime identity and two exact SECURITY DEFINER functions', () => {
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      "current_user = 'fetanagent_trusted_telebirr_verifier_runtime'",
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      "role.rolvaliduntil > pg_catalog.clock_timestamp() + interval '5 minutes'",
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      "role.rolvaliduntil <= pg_catalog.clock_timestamp() + interval '24 hours 5 minutes'",
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      'as database_connect_temp_boundary_acknowledged',
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      'as no_non_system_schema_create',
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      'as no_non_system_base_object_access',
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      'as exact_reachable_function_surface_allowed',
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      'as no_reachable_unallowlisted_security_definer',
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      "routine.proconfig = array['search_path=pg_catalog']::text[]",
    );
    expect(TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      'as allowed_functions_execution_private',
    );
  });

  it('accepts one exact all-true catalog row and rejects false, missing, or extra fields', async () => {
    await expect(
      assertTrustedTelebirrVerifierCatalogPreflight({
        query: vi.fn(async () => ({ rows: [truePreflight] })),
      }),
    ).resolves.toBeUndefined();

    for (const row of [
      { ...truePreflight, runtime_login_is_safe: false },
      Object.fromEntries(Object.entries(truePreflight).slice(1)),
      { ...truePreflight, unexpected: true },
    ]) {
      await expect(
        assertTrustedTelebirrVerifierCatalogPreflight({
          query: vi.fn(async () => ({ rows: [row] })),
        }),
      ).rejects.toBeInstanceOf(TrustedTelebirrPostgresRuntimeUnavailableError);
    }
  });

  it('passes nullable review fields to the exact completion routine without coercion', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL) {
        return { rows: [truePreflight] };
      }
      return {
        rows: [
          {
            verification_outcome_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            outcome_disposition: 'review_required',
            outcome_reason_code: 'source_unavailable',
            deposit_intent_id: null,
            deposit_payment_claim_id: null,
            execution_job_id: null,
            settlement_created: false,
            already_completed: false,
          },
        ],
      };
    });
    const database = new PostgresTrustedTelebirrVerifierDatabase({ query });
    const input = completionInput();
    await database.complete(input);

    expect(query).toHaveBeenNthCalledWith(1, TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL, []);
    expect(query).toHaveBeenNthCalledWith(2, COMPLETE_TRUSTED_TELEBIRR_VERIFICATION_SQL, [
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
      null,
      null,
      null,
    ]);
  });

  it('rechecks the bounded catalog before every authority read and completion', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL) {
        return { rows: [{ ...truePreflight, runtime_login_is_safe: false }] };
      }
      throw new Error('financial operation must not run after catalog drift');
    });
    const database = new PostgresTrustedTelebirrVerifierDatabase({ query });

    await expect(database.loadAuthority('attempt', 'lease', null)).rejects.toBeInstanceOf(
      TrustedTelebirrPostgresRuntimeUnavailableError,
    );
    await expect(database.complete(completionInput())).rejects.toBeInstanceOf(
      TrustedTelebirrPostgresRuntimeUnavailableError,
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL, []);
    expect(query).toHaveBeenNthCalledWith(2, TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL, []);
  });

  it('uses one direct singleton connection and becomes unavailable on lock/catalog drift', async () => {
    const listeners = new Map<string, (error?: Error) => void>();
    const ca = '-----BEGIN CERTIFICATE-----\nsynthetic-ca\n-----END CERTIFICATE-----\n';
    let observedClientConfig: Readonly<Record<string, unknown>> | undefined;
    let held = true;
    const query = vi.fn(async (sql: string) => {
      if (sql === TRUSTED_TELEBIRR_VERIFIER_SINGLETON_ACQUIRE_SQL) {
        return { rows: [{ singleton_acquired: true }] };
      }
      if (sql === TRUSTED_TELEBIRR_VERIFIER_CATALOG_PREFLIGHT_SQL) {
        return { rows: [truePreflight] };
      }
      if (sql === TRUSTED_TELEBIRR_VERIFIER_SINGLETON_HELD_SQL) {
        return { rows: [{ singleton_held: held }] };
      }
      if (sql === TRUSTED_TELEBIRR_VERIFIER_SINGLETON_RELEASE_SQL) {
        return { rows: [{ singleton_released: true }] };
      }
      if (sql === LOAD_TRUSTED_TELEBIRR_AUTHORITY_SQL) {
        return { rows: [{ authority_payload: { contractVersion: 1 } }] };
      }
      throw new Error('unexpected SQL');
    });
    const client: TrustedTelebirrPostgresClient = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      query,
      on: vi.fn((event, listener) => void listeners.set(event, listener)),
      removeListener: vi.fn((event) => void listeners.delete(event)),
    };
    const runtime = await createTrustedTelebirrPostgresRuntime(
      {
        ca,
        database: 'postgres',
        host: 'db.spzpiyxheappsfyswewl.supabase.co',
        password: 'synthetic-password-123456',
        port: 5432,
        user: 'fetanagent_trusted_telebirr_verifier_runtime',
      },
      {
        createClient: (config) => {
          observedClientConfig = config;
          return client;
        },
      },
    );
    expect(observedClientConfig).toMatchObject({
      ssl: { ca, rejectUnauthorized: true },
    });
    expect(observedClientConfig).not.toHaveProperty('ca');
    expect(await runtime.ready()).toBe(true);
    held = false;
    expect(await runtime.ready()).toBe(false);
    await expect(runtime.database.loadAuthority('a', 'b', null)).rejects.toBeInstanceOf(
      TrustedTelebirrPostgresRuntimeUnavailableError,
    );
    await runtime.close();
    expect(query).toHaveBeenCalledWith(TRUSTED_TELEBIRR_VERIFIER_SINGLETON_ACQUIRE_SQL, [
      ...TRUSTED_TELEBIRR_VERIFIER_SINGLETON_KEYS,
    ]);
  });
});
