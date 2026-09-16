import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260916150000_retry_telebirr_shadow_after_runtime_startup_failure.sql',
    import.meta.url,
  ),
);
const repairMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260916151000_fix_telebirr_shadow_runtime_retry_least.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let repairMigrationSource = '';
let retrySource = '';
let triggerSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  repairMigrationSource = await readFile(repairMigrationPath, 'utf8');
  retrySource =
    migrationSource.match(
      /create function app\.retry_expired_private_telebirr_shadow_after_runtime_startup_failure\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  triggerSource =
    migrationSource.match(
      /create function app\.enforce_private_telebirr_shadow_runtime_retry_only\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(retrySource).not.toBe('');
  expect(triggerSource).not.toBe('');
});

describe('TeleBirr shadow runtime-startup recovery boundary', () => {
  it('opens one audited review-only window and binds retained attempts', () => {
    for (const column of [
      'runtime_retry_request_key uuid',
      'runtime_retry_request_digest text',
      'runtime_retry_reason_code text',
      'runtime_retry_original_expires_at timestamptz',
      'runtime_retry_prior_attempt_count integer',
      'runtime_retry_prior_attempt_history_digest text',
      'runtime_retried_at timestamptz',
    ]) {
      expect(migrationSource).toContain(column);
    }
    expect(migrationSource).toContain('private_tbirr_shadow_runtime_retry_key_idx');
    expect(migrationSource).toContain('private_tbirr_shadow_runtime_retry_digest_idx');
    expect(migrationSource).toContain(
      "runtime_retry_reason_code =\n                        'expired_shadow_runtime_startup_retry_no_credit'",
    );
    expect(migrationSource).toContain("expires_at <= runtime_retried_at + interval '12 hours'");
    expect(migrationSource).toContain("expires_at <= submitted_at + interval '24 hours'");
    expect(retrySource).toContain('app.private_telebirr_shadow_retry_attempt_history_digest(');
    expect(retrySource).toContain('retry_until := least(');
    expect(retrySource).not.toContain('retry_until := pg_catalog.least(');
    expect(retrySource).not.toMatch(/set\s+pilot_revision_id\s*=/iu);
    expect(retrySource).not.toMatch(/set\s+receiver_profile_id\s*=/iu);
  });

  it('repairs only the exact deployed LEAST defect while preserving function authority', () => {
    expect(repairMigrationSource).toContain(
      "'ec175bae642282fdccc3c3f3beec6fa394c142c6d0e67610bdcf0a95c252a331'",
    );
    expect(repairMigrationSource).toContain(
      "'53db6eac1ea632f7962e106c403cff3f1a476947459576dc37f47b03ef936e8a'",
    );
    expect(repairMigrationSource).toContain(
      "defective_expression constant text := 'retry_until := pg_catalog.least('",
    );
    expect(repairMigrationSource).toContain(
      "corrected_expression constant text := 'retry_until := least('",
    );
    expect(repairMigrationSource).toContain('routine.proowner = original_owner');
    expect(repairMigrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(repairMigrationSource).not.toMatch(/grant\s+/iu);
  });

  it('requires the complete disabled-money boundary and unchanged dry-run target', () => {
    expect(retrySource).toContain('app.lock_private_trusted_telebirr_activation_authority()');
    expect(retrySource).toContain(
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
    );
    expect(retrySource).toContain('app.private_telebirr_shadow_mode_is_ready(target_pilot.id)');
    expect(retrySource).toContain('locked_switch_count <> 7');
    expect(retrySource).toContain("source_proof.submitted_at + interval '24 hours'");
    expect(retrySource).toContain(
      'shadow_request.pilot_revision_id is distinct from p_target_pilot_revision_id',
    );
    expect(retrySource).not.toMatch(/update app\.feature_switches/iu);
  });

  it('allows expired assignments only when no evidence or outcome exists', () => {
    expect(retrySource).toContain('prior_attempt_count not between 1 and 99');
    expect(retrySource).toContain('attempt.expires_at > authorized_at');
    for (const table of [
      'telegram_telebirr_shadow_proof_receipts',
      'private_telebirr_shadow_verification_attempts',
      'private_telebirr_shadow_verification_outcomes',
      'private_telebirr_shadow_device_evidence_staging',
      'private_telebirr_shadow_evidence_quarantine',
      'private_live_telebirr_verification_attempts',
      'private_live_telebirr_verification_outcomes',
      'private_live_deposit_pilot_reservations',
      'provider_payment_evidence',
      'private_live_telebirr_device_enrollments',
      'private_live_telebirr_device_enrollment_certificates',
      'private_live_telebirr_device_revocations',
    ]) {
      expect(retrySource).toContain(table);
    }
    expect(retrySource).toContain('app.private_telebirr_expired_pilot_shadow_recovery_digest(');
    expect(retrySource).toContain('app.private_telebirr_expired_shadow_retry_digest(');
    expect(retrySource).toContain('app.private_telebirr_shadow_infrastructure_retry_digest(');
  });

  it('allows only expiry and the seven runtime-retry audit fields to change', () => {
    expect(triggerSource).toContain(
      "current_setting(\n         'app.private_telebirr_shadow_runtime_retry', true",
    );
    expect(triggerSource).toContain('pg_catalog.to_jsonb(new) - array[');
    for (const column of [
      'expires_at',
      'runtime_retry_request_key',
      'runtime_retry_request_digest',
      'runtime_retry_reason_code',
      'runtime_retry_original_expires_at',
      'runtime_retry_prior_attempt_count',
      'runtime_retry_prior_attempt_history_digest',
      'runtime_retried_at',
    ]) {
      expect(triggerSource).toContain(`'${column}'`);
    }
    expect(triggerSource).toContain('app.private_telebirr_shadow_runtime_retry_digest(');
    expect(migrationSource).toContain('when (old.infrastructure_retry_request_key is not null)');
  });

  it('cannot create credit, settlement, execution, reservations, or money movement', () => {
    expect(retrySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_execution_jobs|private_live_deposit_pilot_reservations)/iu,
    );
    expect(retrySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|transfer|settle)/iu,
    );
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.retry_expired_private_telebirr_shadow_after_runtime_startup_failure/iu,
    );
  });

  it('makes exact replay idempotent without opening another window', () => {
    expect(retrySource).toContain(
      'shadow_request.runtime_retry_request_key\n           is distinct from p_runtime_retry_request_key',
    );
    expect(retrySource).toContain(
      'shadow_request.runtime_retry_request_digest\n           is distinct from runtime_retry_digest',
    );
    expect(retrySource).toContain('shadow_request.expires_at');
    expect(retrySource).toContain('true;');
  });
});
