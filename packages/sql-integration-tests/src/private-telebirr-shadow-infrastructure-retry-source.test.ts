import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260916110500_retry_telebirr_shadow_after_infrastructure_failure.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let retrySource = '';
let triggerSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  retrySource =
    migrationSource.match(
      /create function app\.retry_expired_private_telebirr_shadow_after_infrastructure_failure\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  triggerSource =
    migrationSource.match(
      /create function app\.enforce_private_telebirr_shadow_infrastructure_retry_only\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(retrySource).not.toBe('');
  expect(triggerSource).not.toBe('');
});

describe('TeleBirr shadow infrastructure-only retry boundary', () => {
  it('opens one final five-minute window on the unchanged dry-run pilot', () => {
    expect(migrationSource).toContain('infrastructure_retry_request_key uuid');
    expect(migrationSource).toContain('infrastructure_retry_request_digest text');
    expect(migrationSource).toContain(
      "infrastructure_retry_reason_code = 'expired_shadow_infrastructure_retry_no_credit'",
    );
    expect(migrationSource).toContain('private_tbirr_shadow_infra_retry_key_idx');
    expect(migrationSource).toContain('private_tbirr_shadow_infra_retry_digest_idx');
    expect(migrationSource).toContain(
      "expires_at > infrastructure_retried_at + interval '60 seconds'",
    );
    expect(migrationSource).toContain(
      "expires_at <= infrastructure_retried_at + interval '5 minutes'",
    );
    expect(retrySource).toContain(
      'shadow_request.pilot_revision_id is distinct from p_target_pilot_revision_id',
    );
    expect(retrySource).not.toMatch(/set\s+pilot_revision_id\s*=/iu);
    expect(retrySource).not.toMatch(/set\s+receiver_profile_id\s*=/iu);
  });

  it('requires the complete no-money boundary and no active financial authority', () => {
    expect(retrySource).toContain('app.lock_private_trusted_telebirr_activation_authority()');
    expect(retrySource).toContain(
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
    );
    expect(retrySource).toContain('app.private_telebirr_shadow_mode_is_ready(target_pilot.id)');
    expect(retrySource).toContain('locked_switch_count <> 7');
    expect(retrySource).toContain("source_proof.submitted_at + interval '24 hours'");
    expect(retrySource).not.toMatch(/update app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.retry_expired_private_telebirr_shadow_after_infrastructure_failure/iu,
    );
  });

  it('requires untouched live and shadow lineage plus the current enrolled phone', () => {
    for (const table of [
      'telegram_telebirr_shadow_proof_receipts',
      'private_telebirr_shadow_verification_attempts',
      'private_telebirr_shadow_verification_outcomes',
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
    expect(retrySource).toContain('shadow_request.recovery_request_digest is distinct from');
    expect(retrySource).toContain('shadow_request.retry_request_digest is distinct from');
  });

  it('allows only expiry and the five infrastructure-retry audit fields to change', () => {
    expect(triggerSource).toContain(
      "current_setting(\n         'app.private_telebirr_shadow_infrastructure_retry', true",
    );
    expect(triggerSource).toContain('pg_catalog.to_jsonb(new) - array[');
    for (const column of [
      'expires_at',
      'infrastructure_retry_request_key',
      'infrastructure_retry_request_digest',
      'infrastructure_retry_reason_code',
      'infrastructure_retry_original_expires_at',
      'infrastructure_retried_at',
    ]) {
      expect(triggerSource).toContain(`'${column}'`);
    }
    expect(triggerSource).toContain('app.private_telebirr_shadow_infrastructure_retry_digest(');
    expect(migrationSource).toContain('when (old.retry_request_key is not null)');
  });

  it('cannot create credit, settlement, execution, reservations, or money movement', () => {
    expect(retrySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_execution_jobs|private_live_deposit_pilot_reservations)/iu,
    );
    expect(retrySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|kemerbet|transfer|settle)/iu,
    );
    expect(migrationSource).not.toMatch(
      /retry_expired_private_telebirr_shadow_after_infrastructure_failure\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });

  it('makes exact replay idempotent without opening another window', () => {
    expect(retrySource).toContain(
      'shadow_request.infrastructure_retry_request_key\n           is distinct from p_infrastructure_retry_request_key',
    );
    expect(retrySource).toContain(
      'shadow_request.infrastructure_retry_request_digest\n           is distinct from infrastructure_retry_digest',
    );
    expect(retrySource).toContain('shadow_request.expires_at');
    expect(retrySource).toContain('true;');
  });
});
