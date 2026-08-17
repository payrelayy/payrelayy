import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260816021101_private_verified_deposit_settlement.sql',
    import.meta.url,
  ),
);
const executionMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260815203606_private_production_deposit_execution_commands.sql',
    import.meta.url,
  ),
);
const consumeOnlyMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260816180010_private_deposit_executor_consume_only.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let functionSource = '';
let executionMigrationSource = '';
let consumeOnlyMigrationSource = '';

beforeAll(async () => {
  [migrationSource, executionMigrationSource, consumeOnlyMigrationSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(executionMigrationPath, 'utf8'),
    readFile(consumeOnlyMigrationPath, 'utf8'),
  ]);
  const match = migrationSource.match(
    /create function app\.finalize_verified_deposit_and_enqueue_execution\([\s\S]+?\n\$\$;/u,
  );
  expect(match).not.toBeNull();
  functionSource = match![0];
});

describe('verified deposit settlement migration source boundary', () => {
  it('pins the exact private atomic procedure contract', () => {
    expect(functionSource).toMatch(
      /p_deposit_intent_id uuid,\s+p_verification_attempt_id uuid,\s+p_provider_payment_evidence_id uuid/u,
    );
    expect(functionSource).toMatch(
      /returns table \(\s+deposit_intent_id uuid,\s+payment_claim_id uuid,\s+execution_job_id uuid,\s+deposit_status text,\s+execution_job_status text,\s+already_finalized boolean,\s+updated_at timestamptz\s+\)/u,
    );
    expect(functionSource).toMatch(/security definer\s+set search_path = pg_catalog, app/u);
    expect(functionSource).toContain('app.claim_verified_deposit_payment(');
    expect(functionSource).toContain('app.enqueue_verified_deposit_execution(intent_row.id)');
    expect(functionSource).toContain(
      'pg_catalog.hashtextextended(p_deposit_intent_id::text, 20260815203606)',
    );
  });

  it('correlates the protected submitted and canonical fingerprints before either legacy call', () => {
    const correlationIndex = functionSource.indexOf(
      'evidence_canonical_reference_fingerprint\n       is distinct from submission_submitted_reference_fingerprint',
    );
    const claimIndex = functionSource.indexOf('app.claim_verified_deposit_payment(');
    const enqueueIndex = functionSource.indexOf('app.enqueue_verified_deposit_execution(');

    expect(correlationIndex).toBeGreaterThan(0);
    expect(correlationIndex).toBeLessThan(claimIndex);
    expect(claimIndex).toBeLessThan(enqueueIndex);
    expect(functionSource).toContain("!~ '^[0-9a-f]{64}$'");
  });

  it('never loads raw, masked, or encrypted reference material into the function frame', () => {
    expect(functionSource).not.toMatch(/select\s+submission\.\*/iu);
    expect(functionSource).not.toMatch(/select\s+evidence\.\*/iu);
    expect(functionSource).not.toMatch(
      /submitted_reference_(?:ciphertext|masked)|canonical_reference_(?:ciphertext|masked)|authoritative_locator/iu,
    );

    const exceptionStatements = functionSource.match(/raise exception [^;]+;/giu) ?? [];
    expect(exceptionStatements.length).toBeGreaterThan(0);
    expect(exceptionStatements.every((statement) => !statement.includes('%'))).toBe(true);
  });

  it('grants only the dedicated NOLOGIN group and leaves its runtime unprovisioned', () => {
    expect(migrationSource).toMatch(
      /create role fetanagent_verification_settlement\s+nologin[\s\S]+?connection limit 2;/u,
    );
    expect(migrationSource).toMatch(
      /create role fetanagent_verification_settlement_runtime\s+nologin[\s\S]+?connection limit 1;/u,
    );
    expect(migrationSource).toMatch(
      /grant execute on function app\.finalize_verified_deposit_and_enqueue_execution\(uuid, uuid, uuid\)\s+to fetanagent_verification_settlement;/u,
    );
    expect(migrationSource).not.toMatch(/grant execute[\s\S]+?to fetanagent_deposit_executor;/u);
    expect(migrationSource).not.toMatch(/password\s+/iu);
  });
});

describe('consume-only executor migration source boundary', () => {
  it('removes direct enqueue from every runtime boundary without replacing the primitive', () => {
    const revoke = consumeOnlyMigrationSource.match(
      /revoke execute on function app\.enqueue_verified_deposit_execution\(uuid\)[\s\S]+?;/u,
    );
    expect(revoke).not.toBeNull();

    for (const role of [
      'public',
      'anon',
      'authenticated',
      'service_role',
      'fetanagent_api',
      'fetanagent_api_runtime',
      'fetanagent_worker',
      'fetanagent_player_actions',
      'fetanagent_player_actions_runtime',
      'fetanagent_customer_web',
      'fetanagent_customer_web_runtime',
      'fetanagent_deposit_executor',
      'fetanagent_deposit_executor_runtime',
      'fetanagent_verification_settlement',
      'fetanagent_verification_settlement_runtime',
    ] as const) {
      expect(revoke![0]).toContain(role);
    }

    expect(consumeOnlyMigrationSource).not.toMatch(/grant\s+execute/iu);
    expect(consumeOnlyMigrationSource).not.toMatch(
      /(?:create(?:\s+or\s+replace)?|alter|drop)\s+function\s+app\.enqueue_verified_deposit_execution/iu,
    );
    expect(consumeOnlyMigrationSource).not.toMatch(
      /update\s+app\.feature_switches|\blogin\b|\bpassword\b/iu,
    );
  });

  it('retains enqueue only as the settlement owner internal call', () => {
    expect(functionSource).toContain('app.enqueue_verified_deposit_execution(intent_row.id)');
    expect(functionSource).toMatch(/security definer\s+set search_path = pg_catalog, app/u);
    expect(consumeOnlyMigrationSource).toContain('no runtime role may create');
  });
});

describe('verified settlement and executor transition lock order', () => {
  for (const functionName of [
    'cancel_deposit_execution_before_action',
    'fence_deposit_execution_final_action',
    'require_deposit_execution_reconciliation',
  ] as const) {
    it(`serializes ${functionName} on the settlement intent lock before row locks`, () => {
      const match = executionMigrationSource.match(
        new RegExp(`create function app\\.${functionName}\\([\\s\\S]+?\\n\\$\\$;`, 'u'),
      );
      expect(match).not.toBeNull();
      const source = match![0];
      const resolveIndex = source.indexOf('select attempt.deposit_intent_id');
      const advisoryIndex = source.indexOf(
        'pg_catalog.hashtextextended(resolved_deposit_intent_id::text, 20260815203606)',
      );
      const lockedAttemptIndex = source.indexOf('select attempt.*', advisoryIndex);
      const firstRowLockIndex = source.indexOf('for update', lockedAttemptIndex);
      const revalidationIndex = source.indexOf(
        'attempt_row.deposit_intent_id is distinct from resolved_deposit_intent_id',
      );

      expect(resolveIndex).toBeGreaterThan(0);
      expect(advisoryIndex).toBeGreaterThan(resolveIndex);
      expect(lockedAttemptIndex).toBeGreaterThan(advisoryIndex);
      expect(firstRowLockIndex).toBeGreaterThan(lockedAttemptIndex);
      expect(revalidationIndex).toBeGreaterThan(firstRowLockIndex);
      expect(source.slice(resolveIndex, advisoryIndex)).not.toContain('for update');
    });
  }
});
