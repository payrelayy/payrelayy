import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260915190000_private_telebirr_expired_pilot_shadow_recovery.sql',
    import.meta.url,
  ),
);
const repairMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260915203500_fix_expired_telebirr_shadow_recovery_least.sql',
    import.meta.url,
  ),
);
const retryMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260915213340_retry_expired_telebirr_shadow_request.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let recoverySource = '';
let repairMigrationSource = '';
let retryMigrationSource = '';
let retrySource = '';
let retryTriggerSource = '';

beforeAll(async () => {
  [migrationSource, repairMigrationSource, retryMigrationSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(repairMigrationPath, 'utf8'),
    readFile(retryMigrationPath, 'utf8'),
  ]);
  recoverySource =
    migrationSource.match(
      /create function app\.recover_expired_private_live_telebirr_payment_to_shadow\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(recoverySource).not.toBe('');
  retrySource =
    retryMigrationSource.match(
      /create function app\.retry_expired_private_telebirr_shadow_request\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  retryTriggerSource =
    retryMigrationSource.match(
      /create function app\.enforce_private_telebirr_shadow_proof_retry_only\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(retrySource).not.toBe('');
  expect(retryTriggerSource).not.toBe('');
});

describe('expired-pilot TeleBirr no-credit recovery source boundary', () => {
  it('retains the original live proof/job and creates only one bounded shadow request', () => {
    expect(migrationSource).toContain('source_live_verification_job_id uuid');
    expect(migrationSource).toContain('source_live_proof_id uuid');
    expect(migrationSource).toContain('original_expires_at timestamptz');
    expect(migrationSource).toContain("recovery_reason_code = 'expired_pilot_recovery_no_credit'");
    expect(migrationSource).toContain("expires_at > recovered_at + interval '60 seconds'");
    expect(migrationSource).toContain("expires_at <= recovered_at + interval '5 minutes'");
    expect(migrationSource).toContain('private_telebirr_shadow_recovery_source_job_idx');
    expect(migrationSource).toContain('private_telebirr_shadow_recovery_source_proof_idx');
    expect(recoverySource).toContain('insert into app.private_telebirr_shadow_proof_requests');
    expect(recoverySource).not.toMatch(
      /(?:update|delete\s+from)\s+app\.private_live_(?:deposit_pilot_proofs|telebirr_verification_jobs)/iu,
    );
  });

  it('requires postgres, no active authority, and the established no-money shadow gate', () => {
    expect(recoverySource).toContain("session_user <> 'postgres'");
    expect(recoverySource).toContain('app.lock_private_trusted_telebirr_activation_authority()');
    expect(recoverySource).toContain(
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
    );
    expect(recoverySource).toContain('app.private_telebirr_shadow_mode_is_ready(target_pilot.id)');
    expect(recoverySource).not.toMatch(/update app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.recover_expired_private_live_telebirr_payment_to_shadow/iu,
    );
  });

  it('rejects any attempted, completed, reserved, or already-used live payment', () => {
    expect(recoverySource).toContain('app.private_live_telebirr_verification_attempts');
    expect(recoverySource).toContain('app.private_live_telebirr_verification_outcomes');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_reservations');
    expect(recoverySource).toContain('app.provider_payment_evidence');
    expect(recoverySource).toContain('source_job.recovery_request_key is not null');
    expect(recoverySource).toContain('source_job.expires_at > authorized_at');
    expect(recoverySource).toContain("source_proof.submitted_at + interval '24 hours'");
  });

  it('binds the fresh pilot to identical frozen players, customers, provider, receiver, and policy', () => {
    expect(recoverySource).toContain('source_pilot.platform_agent_account_id');
    expect(recoverySource).toContain('source_pilot.maximum_aggregate_minor');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_players');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_customers');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_providers');
    expect(recoverySource).toContain('source_profile.receiver_identity_digest');
    expect(recoverySource).toContain('source_profile.deposit_policy_version_id');
    expect(recoverySource).toContain('source_profile.automatic_freshness_seconds');
  });

  it('cannot create settlement, claims, execution, KemerBet actions, or money movement', () => {
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_execution_jobs|private_live_deposit_pilot_reservations)/iu,
    );
    expect(recoverySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|kemerbet|transfer|settle)/iu,
    );
    expect(migrationSource).not.toMatch(
      /recover_expired_private_live_telebirr_payment_to_shadow\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });

  it('makes replay exact through a retained canonical recovery digest', () => {
    expect(migrationSource).toContain('app.private_telebirr_expired_pilot_shadow_recovery_digest');
    expect(recoverySource).toContain(
      'existing_recovery.recovery_request_key is distinct from p_recovery_request_key',
    );
    expect(recoverySource).toContain(
      'existing_recovery.recovery_request_digest is distinct from recovery_digest',
    );
    expect(recoverySource).toContain('existing_recovery.expires_at');
    expect(recoverySource).toContain('true;');
  });

  it('repairs only the reviewed LEAST defect and preserves the deployed function boundary', () => {
    expect(repairMigrationSource).toContain(
      "defective_expression constant text := 'recovered_until := pg_catalog.least('",
    );
    expect(repairMigrationSource).toContain(
      "corrected_expression constant text := 'recovered_until := least('",
    );
    expect(repairMigrationSource).toContain(
      "'2b82945ec661374530174c236afc916b15717de92165c0e37731bdac6ba1e699'",
    );
    expect(repairMigrationSource).toContain('pg_catalog.pg_get_functiondef(routine.oid)');
    expect(repairMigrationSource).toContain('routine.prosrc = corrected_source');
    expect(repairMigrationSource).toContain('routine.proowner = original_owner');
    expect(repairMigrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(repairMigrationSource).not.toMatch(
      /recover_expired_private_live_telebirr_payment_to_shadow\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });
});

describe('expired TeleBirr shadow retry source boundary', () => {
  it('retains the existing live and shadow identities and permits exactly one bounded retry', () => {
    expect(retryMigrationSource).toContain('retry_request_key uuid');
    expect(retryMigrationSource).toContain('retry_request_digest text');
    expect(retryMigrationSource).toContain("retry_reason_code = 'expired_shadow_retry_no_credit'");
    expect(retryMigrationSource).toContain('private_telebirr_shadow_retry_request_key_idx');
    expect(retryMigrationSource).toContain('private_telebirr_shadow_retry_request_digest_idx');
    expect(retryMigrationSource).toContain("expires_at > retried_at + interval '60 seconds'");
    expect(retryMigrationSource).toContain("expires_at <= retried_at + interval '5 minutes'");
    expect(retrySource).toContain('update app.private_telebirr_shadow_proof_requests');
    expect(retrySource).toContain('where request.id = shadow_request.id');
    expect(retrySource).toContain('and request.retry_request_key is null');
    expect(retrySource).not.toMatch(
      /(?:insert\s+into|update|delete\s+from)\s+app\.private_live_(?:deposit_pilot_proofs|telebirr_verification_jobs)/iu,
    );
    expect(retrySource).not.toMatch(
      /(?:insert\s+into|delete\s+from)\s+app\.private_telebirr_shadow_proof_requests/iu,
    );
  });

  it('requires postgres, no active authority, and the exact dry-run no-money shadow gate', () => {
    expect(retrySource).toContain("session_user <> 'postgres'");
    expect(retrySource).toContain("current_setting('transaction_isolation') <> 'read committed'");
    expect(retrySource).toContain('app.lock_private_trusted_telebirr_activation_authority()');
    expect(retrySource).toContain(
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
    );
    expect(retrySource).toContain('app.private_telebirr_shadow_mode_is_ready(target_pilot.id)');
    expect(retrySource).toContain('locked_switch_count <> 7');
    expect(retrySource).not.toMatch(/update app\.feature_switches/iu);
    expect(retryMigrationSource).not.toMatch(
      /grant execute on function\s+app\.retry_expired_private_telebirr_shadow_request/iu,
    );
  });

  it('allows only the exact retry columns through the immutable trigger', () => {
    expect(retryTriggerSource).toContain(
      "current_setting('app.private_telebirr_shadow_retry', true)",
    );
    expect(retryTriggerSource).toContain("is distinct from 'on'");
    expect(retryTriggerSource).toContain('pg_catalog.to_jsonb(new) - array[');
    expect(retryTriggerSource).toContain("'retry_request_key'");
    expect(retryTriggerSource).toContain("'retry_request_digest'");
    expect(retryTriggerSource).toContain("'retry_prior_pilot_revision_id'");
    expect(retryTriggerSource).toContain("'retry_original_expires_at'");
    expect(retryTriggerSource).toContain("'retried_at'");
    expect(retryTriggerSource).toContain('app.private_telebirr_expired_shadow_retry_digest(');
    expect(retryTriggerSource).toContain(
      'new.retry_request_digest is distinct from expected_digest',
    );
    expect(retryTriggerSource).toContain("if tg_op = 'DELETE'");
  });

  it('rejects source or shadow lineage that has already been used', () => {
    expect(retrySource).toContain('app.telegram_telebirr_shadow_proof_receipts');
    expect(retrySource).toContain('app.private_telebirr_shadow_verification_attempts');
    expect(retrySource).toContain('app.private_telebirr_shadow_verification_outcomes');
    expect(retrySource).toContain('app.private_live_telebirr_verification_attempts');
    expect(retrySource).toContain('app.private_live_telebirr_verification_outcomes');
    expect(retrySource).toContain('app.private_live_deposit_pilot_reservations');
    expect(retrySource).toContain('app.provider_payment_evidence');
    expect(retrySource).toContain("source_proof.submitted_at + interval '24 hours'");
    expect(retryTriggerSource).toContain('app.telegram_telebirr_shadow_proof_receipts');
    expect(retryTriggerSource).toContain('app.private_telebirr_shadow_verification_attempts');
    expect(retryTriggerSource).toContain('app.private_telebirr_shadow_verification_outcomes');
  });

  it('binds the retry to an identical fresh pilot, receiver, provider, players, and customers', () => {
    expect(retrySource).toContain('source_pilot.platform_agent_account_id');
    expect(retrySource).toContain('source_pilot.maximum_aggregate_minor');
    expect(retrySource).toContain('app.private_live_deposit_pilot_players');
    expect(retrySource).toContain('app.private_live_deposit_pilot_customers');
    expect(retrySource).toContain('app.private_live_deposit_pilot_providers');
    expect(retrySource).toContain('source_profile.receiver_identity_digest');
    expect(retrySource).toContain('source_profile.deposit_policy_version_id');
    expect(retrySource).toContain('source_profile.automatic_freshness_seconds');
    expect(retrySource).toContain(
      "raise exception 'The retry pilot is not identical to the original payment pilot.'",
    );
  });

  it('cannot enable credit, settlement, execution, KemerBet actions, transfers, or money movement', () => {
    expect(retrySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_execution_jobs|private_live_deposit_pilot_reservations)/iu,
    );
    expect(retrySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|kemerbet|transfer|settle)/iu,
    );
    expect(retryMigrationSource).not.toMatch(
      /retry_expired_private_telebirr_shadow_request\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });

  it('makes an exact replay return the same retained request without opening another window', () => {
    expect(retryMigrationSource).toContain('app.private_telebirr_expired_shadow_retry_digest');
    expect(retrySource).toContain(
      'shadow_request.retry_request_key is distinct from p_retry_request_key',
    );
    expect(retrySource).toContain(
      'shadow_request.retry_request_digest is distinct from retry_digest',
    );
    expect(retrySource).toContain('shadow_request.expires_at');
    expect(retrySource).toContain('true;');
  });
});
