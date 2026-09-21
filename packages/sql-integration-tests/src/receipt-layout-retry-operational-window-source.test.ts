import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260921193344_align_receipt_layout_retry_operational_window.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('receipt-layout retry operational window', () => {
  it('replaces only the reviewed near-full-pilot predicate', () => {
    expect(migrationSource).toContain(
      "'app.retry_reviewed_private_telebirr_source_binding_receipt_layout(text,text)'",
    );
    expect(migrationSource).toContain(
      "target_pilot.expires_at <= v_authorized_at + interval ''11 hours 50 minutes''",
    );
    expect(migrationSource).toContain(
      "target_pilot.expires_at <= v_authorized_at + interval ''1 hour''",
    );
    expect(migrationSource).toContain('rewritten_definition := pg_catalog.replace(');
    expect(migrationSource).toContain(
      'rewritten_source := pg_catalog.replace(original_source, old_fragment, new_fragment)',
    );
    expect(migrationSource.match(/^commit;$/gmu) ?? []).toHaveLength(1);
  });

  it('requires the exact deployed source and preserves every routine attribute', () => {
    expect(migrationSource).toMatch(/expected_source_sha256 constant text :=\s*'[0-9a-f]{64}'/u);
    expect(migrationSource).toContain(
      "routine.prorettype = 'pg_catalog.record'::pg_catalog.regtype",
    );
    expect(migrationSource).toContain("routine.provolatile = 'v'");
    expect(migrationSource).toContain("routine.proparallel = 'u'");
    expect(migrationSource).toContain('routine.prosecdef');
    expect(migrationSource).toContain('routine.proretset');
    expect(migrationSource).toContain("array['search_path=pg_catalog']::text[]");
    expect(migrationSource).toContain('routine.proowner = original_owner');
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(migrationSource).toContain('routine.proconfig is not distinct from original_config');
    expect(migrationSource).toContain('routine.provolatile = original_volatility');
    expect(migrationSource).toContain('routine.proparallel = original_parallel');
    expect(migrationSource).toContain('routine.proleakproof = original_leakproof');
    expect(migrationSource).toContain('routine.prosecdef = original_security_definer');
    expect(migrationSource).toContain('routine.proretset = original_returns_set');
    expect(migrationSource).toContain('routine.prorettype = original_return_type');
    expect(migrationSource).toContain('routine.pronargs = original_argument_count');
  });

  it('does not grant authority or mutate production data', () => {
    expect(migrationSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\./iu,
    );
    expect(migrationSource).not.toMatch(/\bgrant\s+execute\b/iu);
    expect(migrationSource).not.toContain('feature_switches');
    expect(migrationSource).not.toContain('deposit_jobs');
    expect(migrationSource).not.toContain('settlement_receipts');
    expect(migrationSource).not.toContain('execute_deposit');
  });
});
