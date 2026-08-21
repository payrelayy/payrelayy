import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  assertVerifiedDepositSettlementCatalogPreflight,
  createVerifiedDepositSettlementPostgresAdapter,
  FINALIZE_PRIVATE_LIVE_VERIFIED_DEPOSIT_AND_ENQUEUE_EXECUTION_SQL,
  probeVerifiedDepositSettlementCatalogReadiness,
  VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL,
  type VerifiedDepositSettlementPostgresDatabase,
  VerifiedDepositSettlementPostgresAdapterUnavailableError,
} from './verified-deposit-settlement-postgres-adapter.js';

const DEPOSIT_INTENT_ID = '11111111-1111-4111-8111-111111111111';
const VERIFICATION_ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_PAYMENT_EVIDENCE_ID = '33333333-3333-4333-8333-333333333333';
const PAYMENT_CLAIM_ID = '44444444-4444-4444-8444-444444444444';
const EXECUTION_JOB_ID = '55555555-5555-4555-8555-555555555555';

const passingPreflightRow = {
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
  only_expected_direct_membership: true,
  runtime_has_no_members: true,
  group_role_is_safe: true,
  group_usage_allowed_set_denied: true,
  group_only_expected_members: true,
  group_has_no_upstream_membership: true,
  app_schema_boundary_allowed: true,
  no_app_base_object_access: true,
  exact_function_surface_allowed: true,
  allowed_function_hardened: true,
  allowed_function_contract_exact: true,
  allowed_function_execution_private: true,
  default_function_execution_private: true,
};

const input = {
  depositIntentId: DEPOSIT_INTENT_ID,
  verificationAttemptId: VERIFICATION_ATTEMPT_ID,
  providerPaymentEvidenceId: PROVIDER_PAYMENT_EVIDENCE_ID,
};

function settlementRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    deposit_intent_id: DEPOSIT_INTENT_ID,
    payment_claim_id: PAYMENT_CLAIM_ID,
    execution_job_id: EXECUTION_JOB_ID,
    deposit_status: 'execution_pending',
    execution_job_status: 'queued',
    already_finalized: false,
    updated_at: new Date('2026-08-16T18:30:00.000Z'),
    ...overrides,
  };
}

function databaseWithRows(rows: readonly unknown[]) {
  const query = vi.fn(async (statement: string, values: readonly unknown[]) => {
    if (statement === VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL) {
      expect(values).toEqual([]);
      return { rows: [passingPreflightRow] };
    }
    if (statement === FINALIZE_PRIVATE_LIVE_VERIFIED_DEPOSIT_AND_ENQUEUE_EXECUTION_SQL) {
      return { rows };
    }
    throw new Error('unexpected query');
  });
  return { database: { query } satisfies VerifiedDepositSettlementPostgresDatabase, query };
}

function runtimeSourceFiles(directory: URL): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) return runtimeSourceFiles(child);
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts'))
      return [];
    if (entry.name === 'verified-deposit-settlement-postgres-adapter.ts') return [];
    return [fileURLToPath(child)];
  });
}

describe('verified deposit settlement catalog boundary', () => {
  it('pins one hardened function and an uncomposed, injection-only worker surface', () => {
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      "current_user = 'fetanagent_verification_settlement_runtime'",
    );
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain('role.rolcanlogin');
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      "role.rolname = 'fetanagent_verification_settlement'",
    );
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      'app.finalize_private_live_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)',
    );
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      "routine.proconfig = array['search_path=pg_catalog']::text[]",
    );
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      'routine.proallargtypes = array[',
    );
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      'routine.proargmodes = array[',
    );
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      'routine.proargnames = array[',
    );
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      'pg_catalog.pg_get_function_result(routine.oid)',
    );
    for (const resultFragment of [
      'deposit_intent_id uuid',
      'payment_claim_id uuid',
      'execution_job_id uuid',
      'deposit_status text',
      'execution_job_status text',
      'already_finalized boolean',
      'updated_at timestamp with time zone',
    ]) {
      expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(resultFragment);
    }
    expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).toContain(
      'no_app_base_object_access',
    );
    for (const forbiddenSurface of [
      'app.enqueue_verified_deposit_execution(',
      'app.claim_verified_deposit_payment(',
      'app.finalize_verified_deposit_and_enqueue_execution(uuid,uuid,uuid)',
      'app.lease_next_deposit_execution(',
      'app.lease_next_private_live_deposit_execution(',
      'app.fence_deposit_execution_final_action(',
      'app.fence_private_live_deposit_execution_final_action(',
      'app.cancel_deposit_execution_before_action(',
      'app.require_deposit_execution_reconciliation(',
      'app.lease_next_deposit_execution_reconciliation(',
      'app.record_deposit_execution_reconciliation(',
      'app.stage_private_live_telebirr_verification_job(',
      'app.lease_next_private_live_telebirr_verification(',
      'app.record_private_live_telebirr_assignment_transcript(',
      'app.complete_private_live_telebirr_verification(',
      'app.load_private_live_telebirr_verification_authority(',
    ]) {
      expect(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL).not.toContain(forbiddenSurface);
    }
    expect(FINALIZE_PRIVATE_LIVE_VERIFIED_DEPOSIT_AND_ENQUEUE_EXECUTION_SQL).toContain(
      'from app.finalize_private_live_verified_deposit_and_enqueue_execution(',
    );
    const workerRuntimeSources = runtimeSourceFiles(new URL('./', import.meta.url)).map((file) => ({
      file,
      source: readFileSync(file, 'utf8'),
    }));
    const workerPackage = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };
    expect(workerRuntimeSources.length).toBeGreaterThan(0);
    for (const runtimeSource of workerRuntimeSources) {
      expect(runtimeSource.source, runtimeSource.file).not.toContain(
        'verified-deposit-settlement-postgres-adapter',
      );
      expect(runtimeSource.source, runtimeSource.file).not.toContain(
        'createVerifiedDepositSettlementPostgresAdapter',
      );
    }
    expect(workerPackage.dependencies).not.toHaveProperty('pg');
  });

  it('accepts only one exact all-true row and redacts failed probes', async () => {
    await expect(
      assertVerifiedDepositSettlementCatalogPreflight({
        async query(statement, values) {
          expect(statement).toBe(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL);
          expect(values).toEqual([]);
          return { rows: [passingPreflightRow] };
        },
      }),
    ).resolves.toBeUndefined();

    const accessorRow = { ...passingPreflightRow };
    Object.defineProperty(accessorRow, 'runtime_login_is_safe', { get: () => true });
    const missingContractRow = { ...passingPreflightRow } as Record<string, boolean>;
    Reflect.deleteProperty(missingContractRow, 'allowed_function_contract_exact');
    for (const rows of [
      [],
      [{ ...passingPreflightRow, runtime_login_is_safe: false }],
      [{ ...passingPreflightRow, allowed_function_contract_exact: false }],
      [missingContractRow],
      [{ ...passingPreflightRow, extra: true }],
      [accessorRow],
    ]) {
      await expect(
        assertVerifiedDepositSettlementCatalogPreflight({
          async query() {
            return { rows };
          },
        }),
      ).rejects.toThrow('The verified deposit settlement PostgreSQL adapter is unavailable.');
    }

    await expect(
      probeVerifiedDepositSettlementCatalogReadiness({
        async query() {
          throw new Error('postgresql://settlement:secret@database');
        },
      }),
    ).resolves.toBe(false);
  });
});

describe('injected verified deposit settlement adapter', () => {
  it('blocks construction before the financial RPC when the return contract drifts', async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement === VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL) {
        return { rows: [{ ...passingPreflightRow, allowed_function_contract_exact: false }] };
      }
      throw new Error('the financial RPC must not run');
    });

    await expect(
      createVerifiedDepositSettlementPostgresAdapter({
        query: (statement, _values) => query(statement),
      }),
    ).rejects.toBeInstanceOf(VerifiedDepositSettlementPostgresAdapterUnavailableError);
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL);
  });

  it('preflights before the RPC and maps one exact atomic settlement result', async () => {
    const updatedAt = new Date('2026-08-16T18:30:00.000Z');
    const fixture = databaseWithRows([settlementRow({ updated_at: updatedAt })]);
    const adapter = await createVerifiedDepositSettlementPostgresAdapter(fixture.database);

    expect(Object.keys(adapter)).toEqual(['finalize']);
    expect(Object.isFrozen(adapter)).toBe(true);
    await expect(adapter.finalize(input)).resolves.toEqual({
      depositIntentId: DEPOSIT_INTENT_ID,
      paymentClaimId: PAYMENT_CLAIM_ID,
      executionJobId: EXECUTION_JOB_ID,
      depositStatus: 'execution_pending',
      executionJobStatus: 'queued',
      alreadyFinalized: false,
      updatedAt,
    });
    expect(fixture.query.mock.calls).toEqual([
      [VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL, []],
      [
        FINALIZE_PRIVATE_LIVE_VERIFIED_DEPOSIT_AND_ENQUEUE_EXECUTION_SQL,
        [DEPOSIT_INTENT_ID, VERIFICATION_ATTEMPT_ID, PROVIDER_PAYMENT_EVIDENCE_ID],
      ],
    ]);
  });

  it.each([
    ['execution_pending', 'queued'],
    ['execution_pending', 'leased'],
    ['execution_in_progress', 'leased'],
    ['execution_reconciliation', 'succeeded'],
    ['executed', 'succeeded'],
    ['execution_review', 'cancelled'],
    ['execution_review', 'succeeded'],
  ] as const)('accepts an exact finalized replay in %s/%s', async (depositStatus, jobStatus) => {
    const fixture = databaseWithRows([
      settlementRow({
        deposit_status: depositStatus,
        execution_job_status: jobStatus,
        already_finalized: true,
      }),
    ]);
    const adapter = await createVerifiedDepositSettlementPostgresAdapter(fixture.database);
    await expect(adapter.finalize(input)).resolves.toMatchObject({
      depositStatus,
      executionJobStatus: jobStatus,
      alreadyFinalized: true,
    });
  });

  it('rejects malformed input before the financial RPC', async () => {
    const fixture = databaseWithRows([settlementRow()]);
    const adapter = await createVerifiedDepositSettlementPostgresAdapter(fixture.database);

    for (const candidate of [
      { ...input, depositIntentId: 'not-a-uuid' },
      { ...input, unexpected: true },
      { depositIntentId: DEPOSIT_INTENT_ID },
      new Proxy(input, {}),
    ]) {
      await expect(adapter.finalize(candidate as typeof input)).rejects.toBeInstanceOf(
        VerifiedDepositSettlementPostgresAdapterUnavailableError,
      );
    }
    expect(fixture.query).toHaveBeenCalledTimes(1);
  });

  it.each(['telebirr', 'cbe_birr'] as const)(
    'never treats a %s advisory verifier outcome as settlement authority',
    async (providerCode) => {
      const fixture = databaseWithRows([settlementRow()]);
      const adapter = await createVerifiedDepositSettlementPostgresAdapter(fixture.database);
      const advisoryOutcome = {
        ...input,
        contractVersion: 1,
        providerCode,
        disposition: 'settlement_candidate',
        reasonCode: 'exact_proof_match',
        advisoryOnly: true,
        sqlAuthorizationAllowed: false,
        settlementAllowed: false,
        enqueueAllowed: false,
      };

      await expect(adapter.finalize(advisoryOutcome)).rejects.toBeInstanceOf(
        VerifiedDepositSettlementPostgresAdapterUnavailableError,
      );
      expect(fixture.query).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { rows: [] },
    { rows: [settlementRow(), settlementRow()] },
    { rows: [settlementRow({ unexpected: true })] },
    { rows: [settlementRow({ deposit_intent_id: VERIFICATION_ATTEMPT_ID })] },
    { rows: [settlementRow({ execution_job_status: 'succeeded' })] },
    { rows: [settlementRow({ already_finalized: 'false' })] },
    { rows: [settlementRow({ updated_at: '2026-08-16T18:30:00.000Z' })] },
  ])('fails closed on a malformed settlement result %#', async ({ rows }) => {
    const fixture = databaseWithRows(rows);
    const adapter = await createVerifiedDepositSettlementPostgresAdapter(fixture.database);
    await expect(adapter.finalize(input)).rejects.toBeInstanceOf(
      VerifiedDepositSettlementPostgresAdapterUnavailableError,
    );
  });

  it('redacts preflight and RPC backend details', async () => {
    await expect(
      createVerifiedDepositSettlementPostgresAdapter({
        async query() {
          throw new Error('postgresql://settlement:secret@database');
        },
      }),
    ).rejects.toThrow('The verified deposit settlement PostgreSQL adapter is unavailable.');

    const database: VerifiedDepositSettlementPostgresDatabase = {
      async query(statement) {
        if (statement === VERIFIED_DEPOSIT_SETTLEMENT_CATALOG_PREFLIGHT_SQL) {
          return { rows: [passingPreflightRow] };
        }
        throw new Error('proof and connection secret');
      },
    };
    const adapter = await createVerifiedDepositSettlementPostgresAdapter(database);
    let message = '';
    try {
      await adapter.finalize(input);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('The verified deposit settlement PostgreSQL adapter is unavailable.');
    expect(message).not.toContain('proof');
    expect(message).not.toContain('secret');
  });
});
