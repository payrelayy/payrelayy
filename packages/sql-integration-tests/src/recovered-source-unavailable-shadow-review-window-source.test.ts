import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918183820_allow_recovered_source_unavailable_shadow_review_window.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('recovered source-unavailable shadow review window', () => {
  it('installs only while the complete no-money boundary is inert', () => {
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

  it('measures only valid terminal recovery review from recovered_at for exactly twelve hours', () => {
    expect(migrationSource).toContain(
      "'and recovery.recovery_expires_at > pg_catalog.clock_timestamp()'",
    );
    expect(migrationSource).toContain("and recovery.authorized_at + interval ''12 hours'' >");
    expect(migrationSource).toContain("'captured_at < proof.submitted_at + interval ''12 hours'''");
    expect(migrationSource).toContain("'         then proof.recovered_at + interval ''12 hours'''");
    expect(migrationSource).toContain(
      "'authority_at >= proof.submitted_at + interval ''12 hours'''",
    );
    expect(migrationSource).toContain('app.private_live_telebirr_source_recovery_is_valid(');
    expect(migrationSource.match(/proof\.recovered_at \+ interval ''12 hours''/gu)).toHaveLength(2);
  });

  it('rewrites only the three reviewed security-definer bodies with pinned source hashes', () => {
    for (const fragment of [
      'cd575d169de117f9ecfe3fa47aab91af9aa3eca3c086c86a95ce0f1007c19b66',
      '0bca40588148f94ca6a6fe194a8ebd3a1ca3aac76f7192c4753443bc2174f4d6',
      '5ee3dc4fce6e041ccaff48d1403261b2d809b318f2e76a6454e02a0f821525c8',
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
    expect(migrationSource.match(/execute rewritten_definition;/gu)).toHaveLength(3);
  });

  it('does not widen a phone lease or create financial authority', () => {
    expect(migrationSource).not.toMatch(/alter\s+role/iu);
    expect(migrationSource).not.toMatch(/^\s*grant\s+/imu);
    expect(migrationSource).not.toMatch(/update\s+app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /(?:insert\s+into|update|delete\s+from|truncate)\s+app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
    expect(migrationSource).not.toMatch(/requested_lease_seconds/iu);
    expect(migrationSource).not.toMatch(/attempt\.expires_at\s*[:=]/iu);
    expect(migrationSource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|transfer_money)/iu,
    );
  });
});
