import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const enumMigration = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261011201642_owner_fenced_test_no_credit_closure.sql',
    import.meta.url,
  ),
);
const guardMigration = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261011201721_guarded_owner_fenced_test_resolution.sql',
    import.meta.url,
  ),
);

describe('fenced own-account test disposition', () => {
  it('commits the distinct terminal enum before using it', async () => {
    const enumSource = await readFile(enumMigration, 'utf8');
    const guardSource = await readFile(guardMigration, 'utf8');
    expect(enumSource).toContain("add value if not exists 'owner_test_closed_uncredited'");
    expect(guardSource).toContain("old.status = 'review_required'");
    expect(guardSource).toContain("new.status = 'owner_test_closed_uncredited'");
  });

  it('requires an Owner attestation and dormant financial authority', async () => {
    const source = await readFile(guardMigration, 'utf8');
    expect(source).toContain("session_user <> 'postgres'");
    expect(source).toContain('app.require_active_owner_for_private_live_deposit_pilot');
    expect(source).toContain('p_owner_attests_both_wallets is distinct from true');
    expect(source).toContain('p_owner_accepts_no_credit_or_refund is distinct from true');
    expect(source).toContain('p_owner_accepts_provider_outcome_unconfirmed is distinct from true');
    expect(source).toContain("feature_switch.mode <> 'disabled'");
    expect(source).toContain("control.control_state = 'disabled'");
    expect(source).toContain('app.current_private_trusted_telebirr_activation_epoch() is not null');
  });

  it('retains uncertain evidence and cannot credit or retry', async () => {
    const source = await readFile(guardMigration, 'utf8');
    expect(source).toContain("reconciliation_row.outcome <> 'ambiguous'");
    expect(source).toContain('app.routine_telebirr_dispatch_evidence');
    expect(source).toContain("pause.reason_code = 'execution_uncertain'");
    expect(source).toContain('app.owner_fenced_test_no_credit_resolutions');
    expect(source).toContain("'provider_outcome_unconfirmed', true");
    expect(source).toContain("'closure_performed_credit_or_refund', false");
    expect(source).not.toMatch(/update\s+app\.deposit_jobs/iu);
    expect(source).not.toMatch(/update\s+app\.deposit_payment_claims/iu);
  });
});
