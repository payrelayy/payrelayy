import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918180542_allow_reviewed_expired_source_recovery_shadow_window.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('reviewed expired source shadow window compatibility', () => {
  it('installs only at the complete no-money boundary', () => {
    for (const fragment of [
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
      'safe_switch_count <> 7',
      'exact_disabled_companion_count <> 1',
      "execution_control.control_state = 'disabled'",
      "'fetanagent_deposit_executor'",
      "'fetanagent_deposit_executor_runtime'",
      "'fetanagent_trusted_telebirr_verifier'",
      "'fetanagent_trusted_telebirr_verifier_runtime'",
      'activity.pid <> pg_catalog.pg_backend_pid()',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
  });

  it('aligns only the first reviewed recovery timestamp cap', () => {
    expect(migrationSource).toContain("'recovered_at < (submitted_at + ''24:00:00''::interval)'");
    expect(migrationSource).toContain("'recovered_at < (submitted_at + ''7 days''::interval)'");
    expect(migrationSource).toContain("'source_proof.submitted_at + interval ''7 days'''");
    expect(migrationSource).toContain("'expired_source_authorization.expires_at'");
    expect(migrationSource).toContain(
      "'coalesce(root_job.original_expires_at, root_job.expires_at)'",
    );
    expect(migrationSource).not.toContain("retried_at < (submitted_at + ''7 days''::interval)");
    expect(migrationSource).not.toContain("interval '12 hours'");
  });

  it('rebuilds and validates the existing check without financial authority', () => {
    for (const fragment of [
      'lock table app.private_telebirr_shadow_proof_requests in access exclusive mode',
      'pg_catalog.pg_get_constraintdef(constraint_row.oid)',
      'constraint_row.convalidated',
      'drop constraint private_telebirr_shadow_proof_window_check',
      'add constraint private_telebirr_shadow_proof_window_check',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(migrationSource).not.toMatch(/alter\s+role/iu);
    expect(migrationSource).not.toMatch(/^\s*grant\s+/imu);
    expect(migrationSource).not.toMatch(/update\s+app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /(?:insert\s+into|update|delete\s+from|truncate)\s+app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
  });
});
