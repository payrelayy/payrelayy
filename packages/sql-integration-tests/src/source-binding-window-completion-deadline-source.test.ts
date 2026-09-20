import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260920163121_fix_source_binding_completion_deadline.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('source-binding window shadow-completion deadline repair', () => {
  it('rewrites both terminal checks with a fail-closed reviewed retry deadline', () => {
    for (const fragment of [
      'app.complete_private_telebirr_shadow_verification(uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,text,text,text,timestamp with time zone,bigint,timestamp with time zone,text)',
      "expected_source_sha256 constant text :=\n    '38fe1ac7ce772cef84d29e4292a232ae3fffbc66667846741ed012aa2702c1e0'",
      "old_fragment constant text :=\n    '      when proof.recovery_request_key is not null'",
      'when proof.source_binding_window_retry_source_id is not null',
      'then coalesce(',
      'app.private_telebirr_shadow_source_binding_window_review_deadline(',
      "proof.submitted_at + interval ''12 hours''",
      ') / pg_catalog.length(old_fragment) <> 2',
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
