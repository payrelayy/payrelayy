import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918192428_recover_source_shadow_authority_deadline_quarantine.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('source-recovery shadow authority-deadline recovery', () => {
  it('repairs the fourth source-recovery deadline without widening a signed assignment', () => {
    expect(migrationSource).toContain(
      "'and captured_at < proof.submitted_at + interval ''12 hours'''",
    );
    expect(migrationSource).toContain("then proof.recovered_at + interval ''12 hours''");
    expect(migrationSource).toContain('app.private_live_telebirr_source_recovery_is_valid(');
    expect(migrationSource).toContain('staged.observed_at < attempt.issued_at');
    expect(migrationSource).toContain('staged.staged_at >= source_proof.expires_at');
    expect(migrationSource).not.toMatch(/requested_lease_seconds\s*[:=]/iu);
    expect(migrationSource).not.toMatch(/attempt\.expires_at\s*[:=]/iu);
  });

  it('preserves the source and creates one ledger-bound append-only child', () => {
    for (const fragment of [
      'add column authority_deadline_retry_source_id uuid',
      'create table app.private_telebirr_shadow_authority_deadline_retries',
      'prior_quarantine_count = prior_attempt_count',
      'private_tbirr_shadow_authority_retry_source_once_key',
      'private_tbirr_shadow_authority_deadline_retries_immutable',
      'private_tbirr_shadow_authority_deadline_retries_no_truncate',
      'app.private_telebirr_shadow_retry_attempt_history_digest(source_proof.id)',
      'app.private_telebirr_shadow_quarantine_history_digest(source_proof.id)',
      "quarantine.reason_code <> 'trusted_evidence_invalid'",
      'source_proof.authority_deadline_retry_source_id is not null',
      'new.authority_deadline_retry_source_id is null',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
  });

  it('gives the replacement exactly twelve hours and keeps current trust material valid', () => {
    expect(migrationSource).toContain("retry_expires_at = authorized_at + interval '12 hours'");
    expect(migrationSource).toContain("retry_until := authorized_at + interval '12 hours'");
    expect(migrationSource).toContain('enrollment.valid_until >= retry_until');
    expect(migrationSource).toContain('signer.valid_until >= retry_until');
    expect(migrationSource).toContain('pilot.expires_at < retry_until');
    expect(migrationSource).toContain('profile.valid_until < retry_until');
    expect(migrationSource).toContain("'source_recovery_authority_deadline_retry_no_credit'");
  });

  it('requires every financial and execution authority to remain inert', () => {
    for (const fragment of [
      'safe_switch_count <> 7',
      'exact_disabled_companion_count <> 1',
      "execution_control.control_state = 'disabled'",
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
      "'fetanagent_deposit_executor'",
      "'fetanagent_deposit_executor_runtime'",
      "'fetanagent_trusted_telebirr_verifier'",
      "'fetanagent_trusted_telebirr_verifier_runtime'",
      'activity.pid <> pg_catalog.pg_backend_pid()',
      "'financial_actions_enabled', false",
      "'money_moved', false",
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(migrationSource).not.toMatch(/^\s*grant\s+/imu);
    expect(migrationSource).not.toMatch(/update\s+app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /(?:insert\s+into|update|delete\s+from|truncate)\s+app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
  });

  it('preserves security-definer metadata across both reviewed body rewrites', () => {
    for (const fragment of [
      'pg_catalog.pg_get_functiondef(routine.oid)',
      'routine.prosrc = rewritten_source',
      'routine.proowner = original_owner',
      'routine.proacl is not distinct from original_acl',
      'routine.proconfig is not distinct from original_config',
      'routine.provolatile = original_volatility',
      'routine.proparallel = original_parallel',
      'routine.proleakproof = original_leakproof',
      'routine.prosecdef = original_security_definer',
      'routine.proretset = original_returns_set',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(migrationSource.match(/execute rewritten_definition;/gu)).toHaveLength(2);
  });

  it('keeps all new recovery capabilities postgres-only and RLS-sealed', () => {
    expect(migrationSource).toContain('enable row level security');
    expect(migrationSource).toContain('force row level security');
    expect(migrationSource).toContain('revoke all on table');
    expect(migrationSource).toContain('revoke all on function');
    expect(migrationSource).toContain("session_user <> 'postgres'");
    expect(migrationSource).not.toMatch(/grant .*fetanagent_/iu);
  });
});
