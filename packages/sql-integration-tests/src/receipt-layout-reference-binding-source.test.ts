import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260921171000_bind_receipt_layout_to_stable_reference.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let repairedWitness = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  repairedWitness =
    migrationSource.match(
      /new_fragment constant text := \$proof_history_reference_binding\$([\s\S]+?)\$proof_history_reference_binding\$;/u,
    )?.[1] ?? '';
});

describe('receipt-layout stable-reference binding repair', () => {
  it('rewrites exactly the reviewed validator and preserves its authority', () => {
    expect(migrationSource).toContain(
      "'app.private_telebirr_shadow_layout_source_is_valid(uuid,uuid)'",
    );
    expect(migrationSource).toContain(
      "'70526705e57340615b7c944388401ccbc21381993a2904beb8903f2415eacc5e'",
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

  it('preserves the exact terminal document witness', () => {
    expect(repairedWitness).not.toBe('');
    expect(repairedWitness).toContain(
      'terminal_staged.verification_attempt_id = outcome.verification_attempt_id',
    );
    expect(repairedWitness).toContain(
      'terminal_staged.observation_body_digest = outcome.observation_body_digest',
    );
    expect(repairedWitness).toContain(
      "terminal_staged.signed_observation -> 'body' ->> 'sourceDocumentDigest' =",
    );
    expect(repairedWitness).toContain('outcome.source_document_digest');
  });

  it('binds layout evidence through the stable signed reference identity', () => {
    expect(repairedWitness).toContain('layout_attempt.shadow_proof_request_id = proof.id');
    expect(repairedWitness).toContain("'hmac-sha256:' || proof.candidate_reference_fingerprint");
    expect(repairedWitness).toContain('layout_transcript.reference_binding_digest');
    expect(repairedWitness).toContain('terminal_transcript.reference_binding_digest');
    expect(repairedWitness).toContain(
      "layout_staged.signed_observation -> 'body' ->> 'referenceBindingDigest' =",
    );
    expect(repairedWitness).toContain(
      "terminal_staged.signed_observation -> 'body' ->> 'referenceBindingDigest'",
    );
    expect(repairedWitness).toContain("->> 'lookupOutcome' =");
    expect(repairedWitness).toContain("'review_required'");
    expect(repairedWitness).toContain("'unknown_layout'");
    expect(repairedWitness).toContain("->> 'retrievedAt'");
  });

  it('does not equate the receipt document with the later network document', () => {
    expect(repairedWitness).not.toContain(
      "layout_staged.signed_observation -> 'body' ->> 'sourceDocumentDigest'",
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
