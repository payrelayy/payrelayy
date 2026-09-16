import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260916205919_prefer_latest_source_retry_shadow_evidence.sql',
    import.meta.url,
  ),
);
let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('TeleBirr source-unavailable retry evidence selection', () => {
  it('keeps FIFO for ordinary proofs and suppresses only older eligible retry observations', () => {
    expect(migrationSource).toContain("'app.load_next_private_telebirr_shadow_staged_evidence()'");
    expect(migrationSource).toContain('proof.source_unavailable_retry_source_id is null');
    expect(migrationSource).toContain('newer_attempt.shadow_proof_request_id = proof.id');
    expect(migrationSource).toContain(
      "'   order by staged.staged_at, staged.observation_body_digest'",
    );
    expect(migrationSource).toContain('newer_staged.staged_at < newer_attempt.expires_at');
    expect(migrationSource).toContain('newer_quarantine.verification_attempt_id');
    expect(migrationSource).toContain('newer_outcome.shadow_proof_request_id = proof.id');
  });

  it('preserves function ownership, ACL, security-definer, and fixed search path', () => {
    expect(migrationSource).toContain('routine.proowner = original_owner');
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(migrationSource).toContain('routine.prosecdef');
    expect(migrationSource).toContain("array['search_path=pg_catalog']::text[]");
  });

  it('does not grant financial or data mutation authority', () => {
    expect(migrationSource).not.toMatch(/insert into app\./iu);
    expect(migrationSource).not.toMatch(/update app\./iu);
    expect(migrationSource).not.toMatch(/delete from app\./iu);
    expect(migrationSource).not.toMatch(/alter table app\./iu);
    expect(migrationSource).not.toMatch(/feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /\bgrant\s+(?:execute|select|insert|update|delete|usage)\b/iu,
    );
  });
});
