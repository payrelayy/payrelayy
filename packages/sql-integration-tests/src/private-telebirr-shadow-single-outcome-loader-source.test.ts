import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260916190000_stop_shadow_loader_after_proof_outcome.sql',
    import.meta.url,
  ),
);
let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('TeleBirr shadow proof-level terminal loader boundary', () => {
  it('stops loading later immutable attempts after the proof has one outcome', () => {
    expect(migrationSource).toContain(
      "'app.load_next_private_telebirr_shadow_staged_evidence()'::regprocedure",
    );
    expect(migrationSource).toContain('or outcome.shadow_proof_request_id = proof.id');
    expect(migrationSource).toContain('old_count = 1 and new_count = 0');
    expect(migrationSource).toContain('old_count = 1 and new_count = 1');
  });

  it('changes no proof, outcome, switch, credit, settlement, or execution row', () => {
    expect(migrationSource).not.toMatch(/insert into app\./iu);
    expect(migrationSource).not.toMatch(/update app\./iu);
    expect(migrationSource).not.toMatch(/delete from app\./iu);
    expect(migrationSource).not.toMatch(/alter table app\./iu);
    expect(migrationSource).not.toMatch(/feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /(?:provider_payment_evidence|deposit_payment_claims|deposit_execution_jobs|settlement)/iu,
    );
  });
});
