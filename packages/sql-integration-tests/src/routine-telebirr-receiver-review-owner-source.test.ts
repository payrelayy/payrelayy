import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261015213000_routine_telebirr_receiver_review_owner_queue.sql',
    import.meta.url,
  ),
);
let source = '';
beforeAll(async () => {
  source = await readFile(migrationPath, 'utf8');
});

describe('Owner TeleBirr receiver-change review queue migration', () => {
  it('grants only a bounded read RPC to the Owner runtime role', () => {
    expect(source).toContain('p_limit not between 1 and 50');
    expect(source).toContain('(recorded_at desc, candidate_id desc)');
    expect(source).toContain('(review.recorded_at, review.candidate_id)');
    expect(source).toContain("admin_user.role = 'owner'");
    expect(source).toContain("admin_user.status = 'active'");
    expect(source).toContain('review.candidate_reference_masked');
    expect(source).toContain('instructed.account_reference_masked');
    expect(source).toContain('candidate_receiver.account_reference_masked');
    expect(source).toContain('to fetanagent_owner_control');
    expect(source).toContain('fetanagent_owner_control_runtime');
    expect(source).not.toMatch(
      /insert into\s+app\.deposit_intents|update\s+app\.deposit_intents/iu,
    );
    expect(source).not.toMatch(/insert into\s+app\.deposit_payment_claims/iu);
  });
});
