import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260920160000_fix_source_binding_window_loader_deadline.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('source-binding window shadow-loader deadline repair', () => {
  it('rewrites exactly the global evidence loader and keeps ordinary review behavior', () => {
    for (const fragment of [
      'app.load_next_private_telebirr_shadow_staged_evidence()',
      "expected_source_sha256 constant text := '938d802013e88cdb3c7c2591c620bdf9d2d0caf5c80ed3deecf13c3df11634da'",
      "old_fragment constant text :=\n    '       else proof.submitted_at + interval ''12 hours'''",
      'when proof.source_binding_window_retry_source_id is not null',
      'then app.private_telebirr_shadow_source_binding_window_review_deadline(',
      'proof.source_binding_window_retry_source_id is null',
      'execute rewritten_definition;',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
  });

  it('preserves every reviewed routine authority property', () => {
    for (const fragment of [
      'routine.prosrc = rewritten_source',
      'routine.proowner = original_owner',
      'routine.proacl is not distinct from original_acl',
      'routine.proconfig is not distinct from original_config',
      'routine.provolatile = original_volatility',
      'routine.proparallel = original_parallel',
      'routine.proleakproof = original_leakproof',
      'routine.prosecdef = original_security_definer',
      'routine.proretset = original_returns_set',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
  });

  it('adds no settlement, execution, credit, withdrawal, or money-moving operation', () => {
    expect(migrationSource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
    expect(migrationSource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|transfer_money|credit_customer|withdraw)/iu,
    );
  });
});
