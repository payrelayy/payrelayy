import { describe, expect, it, vi } from 'vitest';

import {
  COMPLETE_TELEBIRR_SHADOW_VERIFICATION_SQL,
  LOAD_NEXT_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL,
  LOAD_TELEBIRR_SHADOW_AUTHORITY_SQL,
  PostgresTelebirrShadowVerifierDatabase,
  PostgresTelebirrShadowVerifierWorkSource,
  QUARANTINE_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL,
  TELEBIRR_SHADOW_VERIFIER_SINGLETON_ACQUIRE_SQL,
  TELEBIRR_SHADOW_VERIFIER_SINGLETON_HELD_SQL,
  TELEBIRR_SHADOW_VERIFIER_SINGLETON_KEYS,
  TELEBIRR_SHADOW_VERIFIER_SINGLETON_RELEASE_SQL,
  TelebirrShadowPostgresRuntimeUnavailableError,
  assertTelebirrShadowVerifierCatalogPreflight,
  createTelebirrShadowPostgresRuntime,
} from './postgres-telebirr-shadow-verifier.js';
import {
  TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL,
  TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS,
  type TrustedTelebirrPostgresClient,
} from './postgres-trusted-telebirr-verifier.js';
import type { TrustedTelebirrCompletionInput } from './trusted-telebirr-verifier.js';

const truePreflight = Object.fromEntries(
  TRUSTED_TELEBIRR_VERIFIER_PREFLIGHT_KEYS.map((key) => [key, true]),
);

function completionInput(): TrustedTelebirrCompletionInput {
  return {
    verificationAttemptId: '11111111-1111-4111-8111-111111111111',
    leaseToken: '22222222-2222-4222-8222-222222222222',
    completionRequestKey: '33333333-3333-4333-8333-333333333333',
    observationBodyDigest: `sha256:${'1'.repeat(64)}`,
    observationSignatureDigest: `sha256:${'2'.repeat(64)}`,
    replayIdentity: `sha256:${'3'.repeat(64)}`,
    sourceDocumentDigest: `sha256:${'4'.repeat(64)}`,
    normalizedFactsDigest: `sha256:${'5'.repeat(64)}`,
    observedAt: '2026-09-10T10:00:00.000Z',
    protocolDisposition: 'would_forward_signed_evidence',
    protocolReasonCode: 'signed_evidence_verified',
    assessmentInputDigest: `sha256:${'6'.repeat(64)}`,
    assessedAt: '2026-09-10T10:00:01.000Z',
    disposition: 'settlement_candidate',
    reasonCode: 'exact_proof_match',
    evidenceDigest: `sha256:${'7'.repeat(64)}`,
    retrievedAt: '2026-09-10T10:00:00.000Z',
    receiptPrincipalAmountMinor: '5000',
    occurredAt: '2026-09-10T09:59:00.000Z',
    receiverIdentityDigest: `sha256:${'8'.repeat(64)}`,
  };
}

describe('TeleBirr shadow PostgreSQL boundary', () => {
  it('preflights one isolated role with only the four shadow functions', async () => {
    expect(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      "current_user = 'fetanagent_telebirr_shadow_verifier_runtime'",
    );
    expect(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      "role.rolname = 'fetanagent_telebirr_shadow_verifier'",
    );
    expect(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain('select count(*) = 4');
    expect(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      'app.complete_private_telebirr_shadow_verification',
    );
    expect(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL).not.toContain(
      'app.complete_private_live_telebirr_verification',
    );
    expect(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL).not.toContain('deposit_execution');
    expect(TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL).toContain(
      "routine.proconfig = array['search_path=pg_catalog']::text[]",
    );

    await expect(
      assertTelebirrShadowVerifierCatalogPreflight({
        query: vi.fn(async () => ({ rows: [truePreflight] })),
      }),
    ).resolves.toBeUndefined();

    for (const row of [
      { ...truePreflight, runtime_login_is_safe: false },
      Object.fromEntries(Object.entries(truePreflight).slice(1)),
      { ...truePreflight, unexpected: true },
    ]) {
      await expect(
        assertTelebirrShadowVerifierCatalogPreflight({
          query: vi.fn(async () => ({ rows: [row] })),
        }),
      ).rejects.toBeInstanceOf(TelebirrShadowPostgresRuntimeUnavailableError);
    }
  });

  it('accepts only shadow authority and binds all completion evidence without coercion', async () => {
    const completion = completionInput();
    const query = vi.fn(async (sql: string) => {
      if (sql === TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL) {
        return { rows: [truePreflight] };
      }
      if (sql === LOAD_TELEBIRR_SHADOW_AUTHORITY_SQL) {
        return {
          rows: [{ authority_payload: { contractVersion: 1, verificationMode: 'shadow' } }],
        };
      }
      if (sql === COMPLETE_TELEBIRR_SHADOW_VERIFICATION_SQL) {
        return {
          rows: [
            {
              verification_outcome_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              outcome_disposition: 'would_verify',
              outcome_reason_code: 'exact_proof_match',
              deposit_intent_id: null,
              deposit_payment_claim_id: null,
              execution_job_id: null,
              settlement_created: false,
              already_completed: false,
            },
          ],
        };
      }
      throw new Error('unexpected SQL');
    });
    const database = new PostgresTelebirrShadowVerifierDatabase({ query });

    await expect(database.loadAuthority('attempt', 'lease', null)).resolves.toEqual({
      contractVersion: 1,
      verificationMode: 'shadow',
    });
    await expect(database.complete(completion)).resolves.toMatchObject({
      outcome_disposition: 'would_verify',
      deposit_intent_id: null,
      deposit_payment_claim_id: null,
      execution_job_id: null,
      settlement_created: false,
    });
    expect(query).toHaveBeenCalledWith(COMPLETE_TELEBIRR_SHADOW_VERIFICATION_SQL, [
      completion.verificationAttemptId,
      completion.leaseToken,
      completion.completionRequestKey,
      completion.observationBodyDigest,
      completion.observationSignatureDigest,
      completion.replayIdentity,
      completion.sourceDocumentDigest,
      completion.normalizedFactsDigest,
      completion.observedAt,
      completion.protocolDisposition,
      completion.protocolReasonCode,
      completion.assessmentInputDigest,
      completion.assessedAt,
      completion.disposition,
      completion.reasonCode,
      completion.evidenceDigest,
      completion.retrievedAt,
      completion.receiptPrincipalAmountMinor,
      completion.occurredAt,
      completion.receiverIdentityDigest,
    ]);
  });

  it('rejects live authority at the database boundary', async () => {
    const database = new PostgresTelebirrShadowVerifierDatabase({
      query: async (sql) =>
        sql === TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL
          ? { rows: [truePreflight] }
          : { rows: [{ authority_payload: { contractVersion: 1, verificationMode: 'live' } }] },
    });

    await expect(database.loadAuthority('attempt', 'lease', null)).rejects.toBeInstanceOf(
      TelebirrShadowPostgresRuntimeUnavailableError,
    );
  });

  it('quarantines a structurally invalid signed envelope without returning it to the worker', async () => {
    const completion = completionInput();
    const query = vi.fn(async (sql: string) => {
      if (sql === TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL) {
        return { rows: [truePreflight] };
      }
      if (sql === LOAD_NEXT_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL) {
        return {
          rows: [
            {
              verification_attempt_id: completion.verificationAttemptId,
              lease_token: completion.leaseToken,
              completion_request_key: completion.completionRequestKey,
              observation_body_digest: completion.observationBodyDigest,
              signed_assignment: {},
              signed_observation: {},
            },
          ],
        };
      }
      if (sql === QUARANTINE_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL) {
        return { rows: [{ quarantined: true }] };
      }
      throw new Error('unexpected SQL');
    });
    const source = new PostgresTelebirrShadowVerifierWorkSource({ query });

    await expect(source.loadNext()).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(QUARANTINE_TELEBIRR_SHADOW_STAGED_EVIDENCE_SQL, [
      completion.verificationAttemptId,
      completion.leaseToken,
      completion.observationBodyDigest,
      'trusted_evidence_invalid',
    ]);
  });

  it('uses a dedicated direct singleton connection and fails readiness closed on lock drift', async () => {
    const ca = '-----BEGIN CERTIFICATE-----\nsynthetic-ca\n-----END CERTIFICATE-----\n';
    let clientConfig: Readonly<Record<string, unknown>> | undefined;
    let held = true;
    const query = vi.fn(async (sql: string) => {
      if (sql === TELEBIRR_SHADOW_VERIFIER_SINGLETON_ACQUIRE_SQL) {
        return { rows: [{ singleton_acquired: true }] };
      }
      if (sql === TELEBIRR_SHADOW_VERIFIER_CATALOG_PREFLIGHT_SQL) {
        return { rows: [truePreflight] };
      }
      if (sql === TELEBIRR_SHADOW_VERIFIER_SINGLETON_HELD_SQL) {
        return { rows: [{ singleton_held: held }] };
      }
      if (sql === TELEBIRR_SHADOW_VERIFIER_SINGLETON_RELEASE_SQL) {
        return { rows: [{ singleton_released: true }] };
      }
      throw new Error('unexpected SQL');
    });
    const client: TrustedTelebirrPostgresClient = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      query,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const runtime = await createTelebirrShadowPostgresRuntime(
      {
        ca,
        database: 'postgres',
        host: 'db.synthetic.supabase.co',
        password: 'synthetic-password-123456',
        port: 5432,
        user: 'fetanagent_telebirr_shadow_verifier_runtime',
      },
      {
        createClient: (config) => {
          clientConfig = config;
          return client;
        },
      },
    );

    expect(clientConfig).toMatchObject({
      application_name: 'fetanagent_telebirr_shadow_verifier',
      ssl: { ca, rejectUnauthorized: true },
    });
    expect(clientConfig).not.toHaveProperty('ca');
    expect(await runtime.ready()).toBe(true);
    held = false;
    expect(await runtime.ready()).toBe(false);
    await runtime.close();
    expect(query).toHaveBeenCalledWith(TELEBIRR_SHADOW_VERIFIER_SINGLETON_ACQUIRE_SQL, [
      ...TELEBIRR_SHADOW_VERIFIER_SINGLETON_KEYS,
    ]);
  });
});
