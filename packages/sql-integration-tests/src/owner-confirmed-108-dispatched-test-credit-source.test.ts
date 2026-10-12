import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261012171636_owner_confirmed_108_dispatched_test_credit.sql',
    import.meta.url,
  ),
);

describe('Owner-confirmed 108 ETB dispatched test credit', () => {
  it('installs a dormant, exact-attempt command without reconciling at migration time', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain(
      'create function app.resolve_owner_confirmed_108_dispatched_test_credit(',
    );
    expect(source).toContain("'65000246-b235-40ba-9335-fd267eeca6c7'::uuid");
    expect(source).toContain("pg_catalog.date_trunc('minute', p_history_minute_at)");
    expect(source).toContain('player_account.player_id is distinct from p_observed_player_id');
    expect(source).toContain('p_observed_amount_minor is distinct from 10800');
    expect(source).not.toMatch(
      /select\s+app\.resolve_owner_confirmed_108_dispatched_test_credit\s*\(/iu,
    );
  });

  it('preserves the earlier receipt and requires dormant financial authority', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain('observed_amount_minor = 10000');
    expect(source).toContain('observed_amount_minor = 10800');
    expect(source).toContain("session_user <> 'postgres'");
    expect(source).toContain("feature_switch.mode <> 'disabled'");
    expect(source).toContain("control.control_state = 'disabled'");
    expect(source).toContain('app.current_private_trusted_telebirr_activation_epoch() is not null');
    expect(source).toContain('p_owner_attests_both_wallets is distinct from true');
    expect(source).toContain(
      'p_operator_verified_success_and_approved_history is distinct from true',
    );
    expect(source).toContain('p_owner_accepts_no_second_credit_or_refund is distinct from true');
  });

  it('requires exact signed-dispatch lineage and never issues another provider action', async () => {
    const source = await readFile(migration, 'utf8');
    expect(source).toContain('intent_row.expected_amount_minor <> 10800');
    expect(source).toContain("provider_code <> 'telebirr'");
    expect(source).toContain("platform_code <> 'kemerbet'");
    expect(source).toContain('player_account.player_id is distinct from p_observed_player_id');
    expect(source).toContain("broker_row.operation <> 'record_dispatch'");
    expect(source).toContain("broker_row.result_body ->> 'amountMinor' is distinct from '10800'");
    expect(source).toContain('dispatch_row.exact_player_credit_match is distinct from true');
    expect(source).toContain('app.lease_next_deposit_execution_reconciliation(');
    expect(source).toContain("'owner_confirmed_history_minute_and_signed_dispatch'");
    expect(source).toContain("'additional_credit_or_refund_performed', false");
    expect(source).not.toContain('app.fence_deposit_execution_final_action(');
    expect(source).not.toContain('app.routine_telebirr_broker_command(');
    expect(source).not.toMatch(/update\s+app\.feature_switches/iu);
  });
});
