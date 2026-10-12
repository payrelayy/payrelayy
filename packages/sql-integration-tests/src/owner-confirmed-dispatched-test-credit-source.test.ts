import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261012133428_owner_confirmed_dispatched_test_credit.sql',
    import.meta.url,
  ),
);

describe('Owner-confirmed dispatched test credit', () => {
  it('installs a private one-use receipt without resolving anything at migration time', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain('create table app.owner_confirmed_dispatched_test_credits');
    expect(source).toContain('execution_attempt_id uuid not null unique');
    expect(source).toContain('history_transaction_id text not null unique');
    expect(source).toContain('create trigger owner_confirmed_dispatched_test_credits_immutable');
    expect(source).toContain('create function app.resolve_owner_confirmed_dispatched_test_credit(');
    expect(source).toContain("session_user <> 'postgres'");
    expect(source).not.toMatch(
      /select\s+app\.resolve_owner_confirmed_dispatched_test_credit\s*\(/iu,
    );
  });

  it('requires a stopped financial system and signed dispatch for the exact own-account credit', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain("feature_switch.mode <> 'disabled'");
    expect(source).toContain("control.control_state = 'disabled'");
    expect(source).toContain('app.current_private_trusted_telebirr_activation_epoch() is not null');
    expect(source).toContain('p_owner_attests_both_wallets is distinct from true');
    expect(source).toContain('p_owner_attests_success_and_approved_history is distinct from true');
    expect(source).toContain('p_owner_accepts_no_second_credit_or_refund is distinct from true');
    expect(source).toContain('intent_row.expected_amount_minor <> 10000');
    expect(source).toContain("provider_code <> 'telebirr'");
    expect(source).toContain("platform_code <> 'kemerbet'");
    expect(source).toContain('player_account.player_id is distinct from p_observed_player_id');
    expect(source).toContain("broker_row.operation <> 'record_dispatch'");
    expect(source).toContain('dispatch_row.exact_player_credit_match is distinct from true');
  });

  it('records minute-precision history distinctly without weakening normal reconciliation', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain('owner_confirmed_history_minute_and_signed_dispatch');
    expect(source).toContain('receipt.history_minute_at =');
    expect(source).toContain("'history_time_precision', 'minute'");
    expect(source).toContain('app.lease_next_deposit_execution_reconciliation(');
    expect(source).toContain("set status = 'confirmed_executed'");
    expect(source).toContain("set status = 'executed'");
    expect(source).toContain("'additional_credit_or_refund_performed', false");
    expect(source).not.toContain('app.fence_deposit_execution_final_action(');
    expect(source).not.toContain('app.routine_telebirr_broker_command(');
    expect(source).not.toMatch(/update\s+app\.feature_switches/iu);
  });
});
