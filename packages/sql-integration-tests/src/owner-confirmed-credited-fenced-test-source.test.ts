import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261011231338_owner_confirmed_credited_fenced_test.sql',
    import.meta.url,
  ),
);

describe('Owner-confirmed credited fenced test', () => {
  it('installs a private, one-use audited resolution without invoking it', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain('create table app.owner_confirmed_fenced_test_credits');
    expect(source).toContain('execution_attempt_id uuid not null unique');
    expect(source).toContain('reconciliation_id uuid not null unique');
    expect(source).toContain('create function app.resolve_owner_confirmed_fenced_test_credit(');
    expect(source).toContain("session_user <> 'postgres'");
    expect(source).toContain('app.require_active_owner_for_private_live_deposit_pilot');
    expect(source).toContain('create trigger owner_confirmed_fenced_test_credits_immutable');
    expect(source).not.toMatch(/select\s+app\.resolve_owner_confirmed_fenced_test_credit\s*\(/iu);
  });

  it('requires dormant money switches and exact Owner/provider evidence', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain("feature_switch.mode <> 'disabled'");
    expect(source).toContain("control.control_state = 'disabled'");
    expect(source).toContain('app.current_private_trusted_telebirr_activation_epoch() is not null');
    expect(source).toContain('p_owner_attests_both_wallets is distinct from true');
    expect(source).toContain('p_owner_attests_success_screen_and_history is distinct from true');
    expect(source).toContain('p_owner_accepts_no_second_credit_or_refund is distinct from true');
    expect(source).toContain('intent_row.expected_amount_minor <> 3000');
    expect(source).toContain("provider_code <> 'telebirr'");
    expect(source).toContain("platform_code <> 'kemerbet'");
    expect(source).toContain('player_account.player_id is distinct from p_observed_player_id');
    expect(source).toContain('p_matched_history_occurred_at not between');
    expect(source).toContain('app.routine_telebirr_dispatch_evidence');
  });

  it('uses the existing reconciliation ledger and never authorizes another Transfer', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain("set status = 'reconciliation_required'");
    expect(source).toContain('app.lease_next_deposit_execution_reconciliation(');
    expect(source).toContain('app.record_deposit_execution_reconciliation(');
    expect(source).toContain("'deposit.owner_confirmed_credited_test_reconciled'");
    expect(source).toContain("'additional_credit_or_refund_performed', false");
    expect(source).not.toContain('app.fence_deposit_execution_final_action(');
    expect(source).not.toContain('app.routine_telebirr_broker_command(');
    expect(source).not.toMatch(/insert\s+into\s+app\.deposit_execution_attempts/iu);
    expect(source).not.toMatch(/update\s+app\.feature_switches/iu);
  });
});
