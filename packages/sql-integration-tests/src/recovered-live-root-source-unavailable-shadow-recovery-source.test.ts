import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918174938_accept_recovered_live_root_source_unavailable_shadow_recovery.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('recovered live root source-unavailable compatibility', () => {
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

  it('binds a recovered root to its immutable original five-minute expiry', () => {
    expect(migrationSource).toContain(
      'coalesce(root_job.original_expires_at, root_job.expires_at)',
    );
    expect(migrationSource).toContain("root_job.submitted_at + interval '5 minutes'");
    expect(migrationSource).toContain(
      'shadow_proof.original_expires_at =\n        coalesce(root_job.original_expires_at, root_job.expires_at)',
    );
    expect(migrationSource).toContain(
      'shadow_proof.original_expires_at is distinct from\n           coalesce(root_job.original_expires_at, root_job.expires_at)',
    );
    expect(migrationSource).not.toContain("interval '12 hours'");
  });

  it('rewrites only the reviewed recovery and validator bodies in place', () => {
    for (const fragment of [
      'app.recover_private_live_telebirr_source_to_shadow(uuid,uuid,uuid,uuid,uuid,text)',
      'app.private_live_telebirr_source_recovery_is_valid(uuid,uuid)',
      'pg_catalog.pg_get_functiondef(routine.oid)',
      'pg_catalog.replace(original_definition, old_window, new_window)',
      'routine.oid = routine_oid',
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

  it('does not widen leases or create a financial side effect', () => {
    expect(migrationSource).not.toMatch(
      /(?:insert\s+into|update|delete\s+from|truncate)\s+app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
    expect(migrationSource).not.toMatch(/alter\s+role/iu);
    expect(migrationSource).not.toMatch(/grant\s+/iu);
    expect(migrationSource).not.toMatch(/update\s+app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|transfer_money)/iu,
    );
  });
});
