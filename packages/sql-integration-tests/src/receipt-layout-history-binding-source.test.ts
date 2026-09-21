import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260921133000_fix_receipt_layout_history_binding.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let repairedWitness = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  repairedWitness =
    migrationSource.match(
      /new_fragment constant text := \$proof_history_layout_binding\$([\s\S]+?)\$proof_history_layout_binding\$;/u,
    )?.[1] ?? '';
});

describe('receipt-layout proof-history binding repair', () => {
  it('rewrites exactly the reviewed validator and preserves its authority', () => {
    expect(migrationSource).toContain(
      "'app.private_telebirr_shadow_layout_source_is_valid(uuid,uuid)'",
    );
    expect(migrationSource).toContain(
      "'8b7f10d9847e1124665b5e3375a56f759bb33552ab3e2a6830ebd353c3c9be42'",
    );
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(migrationSource).toContain('routine.proconfig is not distinct from original_config');
    expect(migrationSource).toContain('routine.proowner = original_owner');
    expect(migrationSource).toContain('routine.prosecdef = original_security_definer');
    expect(migrationSource).toContain('routine.provolatile = original_volatility');
    expect(migrationSource).toContain("routine.provolatile = 's'");
    expect(migrationSource).toContain("array['search_path=pg_catalog']::text[]");
    expect(migrationSource.match(/^commit;$/gmu) ?? []).toHaveLength(1);
  });

  it('accepts only a signed layout witness from the same proof and source document', () => {
    expect(repairedWitness).not.toBe('');
    expect(repairedWitness).toContain(
      'join app.private_telebirr_shadow_verification_attempts attempt',
    );
    expect(repairedWitness).toContain('attempt.shadow_proof_request_id = proof.id');
    expect(repairedWitness).toContain("->> 'sourceDocumentDigest' =");
    expect(repairedWitness).toContain('outcome.source_document_digest');
    expect(repairedWitness).toContain("->> 'lookupOutcome' =");
    expect(repairedWitness).toContain("'review_required'");
    expect(repairedWitness).toContain("'unknown_layout'");
    expect(repairedWitness).toContain("->> 'retrievedAt'");
  });

  it('does not require the later terminal outcome to be the layout observation', () => {
    expect(repairedWitness).not.toContain(
      'staged.verification_attempt_id = outcome.verification_attempt_id',
    );
    expect(repairedWitness).not.toContain(
      'staged.observation_body_digest = outcome.observation_body_digest',
    );
  });

  it('does not create financial authority or mutate production rows', () => {
    expect(migrationSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+app\./iu,
    );
    expect(migrationSource).not.toMatch(/\bgrant\s+execute\b/iu);
    expect(migrationSource).not.toContain('execute_deposit');
    expect(migrationSource).not.toContain('finalize_private_live_verified_deposit');
  });
});
