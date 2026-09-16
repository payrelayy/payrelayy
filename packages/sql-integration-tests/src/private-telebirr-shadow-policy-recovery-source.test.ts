import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260916182000_recover_quarantined_telebirr_shadow_after_policy_fix.sql',
    import.meta.url,
  ),
);
const workflowPath = fileURLToPath(
  new URL(
    '../../../.github/workflows/production-telebirr-shadow-policy-recovery.yml',
    import.meta.url,
  ),
);
const operationSqlPath = fileURLToPath(
  new URL('../../../infra/sql/production-telebirr-shadow-policy-recovery.sql', import.meta.url),
);

let migrationSource = '';
let workflowSource = '';
let operationSqlSource = '';
let recoverySource = '';
let triggerSource = '';

beforeAll(async () => {
  [migrationSource, workflowSource, operationSqlSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(workflowPath, 'utf8'),
    readFile(operationSqlPath, 'utf8'),
  ]);
  recoverySource =
    migrationSource.match(
      /create function app\.retry_quarantined_private_telebirr_shadow_after_policy_fix\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  triggerSource =
    migrationSource.match(
      /create or replace function app\.enforce_private_telebirr_shadow_proof_retry_only\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(recoverySource).not.toBe('');
  expect(triggerSource).not.toBe('');
});

describe('TeleBirr shadow verifier-policy recovery boundary', () => {
  it('preserves the original staging and quarantine in an immutable digest-bound ledger', () => {
    expect(migrationSource).toContain('app.private_telebirr_shadow_policy_recoveries');
    expect(migrationSource).toContain('private_tbirr_shadow_policy_recoveries_immutable');
    expect(migrationSource).toContain('private_tbirr_shadow_policy_recoveries_no_truncate');
    expect(migrationSource).toContain('app.private_telebirr_shadow_policy_recovery_digest(');
    expect(migrationSource).toContain("reason_code = 'verifier_policy_fix_retry_no_credit'");
    expect(migrationSource).toContain('quarantined_observation_body_digest text not null unique');
    expect(migrationSource).not.toMatch(
      /(?:delete from|truncate) app\.private_telebirr_shadow_(?:device_evidence_staging|evidence_quarantine)/iu,
    );
  });

  it('requires the exact expired direct proof and its one quarantined signed attempt', () => {
    for (const fragment of [
      'proof.source_live_verification_job_id is not null',
      'proof.recovery_request_key is not null',
      'proof.retry_request_key is not null',
      'proof.infrastructure_retry_request_key is not null',
      'proof.runtime_retry_request_key is not null',
      'proof.expires_at > authorized_at',
      'attempt.attempt_number <> 1',
      'prior_attempt_count <> 1',
      'staged.staged_at > proof.expires_at',
      "quarantine.reason_code <> 'trusted_evidence_invalid'",
      'private_telebirr_shadow_verification_outcomes',
      'provider_payment_evidence',
      'telegram_telebirr_shadow_proof_receipts',
    ]) {
      expect(recoverySource).toContain(fragment);
    }
    expect(recoverySource).toContain(
      'app.private_telebirr_shadow_retry_attempt_history_digest(proof.id)',
    );
  });

  it('keeps every money gate disabled and extends only the proof expiry', () => {
    expect(recoverySource).toContain('app.lock_private_trusted_telebirr_activation_authority()');
    expect(recoverySource).toContain(
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
    );
    expect(recoverySource).toContain('app.private_telebirr_shadow_mode_is_ready(pilot.id)');
    expect(recoverySource).toContain('locked_switch_count <> 7');
    expect(recoverySource).toMatch(
      /update app\.private_telebirr_shadow_proof_requests candidate\s+set expires_at = retry_until/iu,
    );
    expect(recoverySource).not.toMatch(/update app\.feature_switches/iu);
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_payment_claims|deposit_execution_jobs|private_live_deposit_pilot_reservations)/iu,
    );
    expect(recoverySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|transfer|settle)/iu,
    );
    expect(triggerSource).toContain("pg_catalog.to_jsonb(new) - 'expires_at'");
    expect(triggerSource).toContain("pg_catalog.to_jsonb(old) - 'expires_at'");
  });

  it('provides a bounded, idempotent 12-hour-at-most recovery window', () => {
    expect(recoverySource).toContain("authorized_at + interval '12 hours'");
    expect(recoverySource).toContain("proof.submitted_at + interval '12 hours'");
    expect(recoverySource).toContain("authorized_at + interval '10 minutes'");
    expect(recoverySource).toContain('pilot.expires_at');
    expect(recoverySource).toContain('profile.valid_until');
    expect(recoverySource).toContain('active_enrollment_valid_until');
    expect(recoverySource).toContain('The TeleBirr shadow policy-recovery replay conflicts.');
    expect(recoverySource).toContain('true;');
  });

  it('runs only from protected main with exact identifiers and an explicit no-money phrase', () => {
    expect(workflowSource).toContain('environment: production');
    expect(workflowSource).toContain('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]');
    expect(workflowSource).toContain(
      '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$CONFIRMED_COMMIT" == "$GITHUB_SHA" ]]',
    );
    expect(workflowSource).toContain(
      'RECOVER QUARANTINED TELEBIRR SHADOW AFTER POLICY FIX - NO MONEY',
    );
    expect(workflowSource).toContain('node infra/operations/require-production-ci.mjs');
    expect(workflowSource).toContain(
      '--file=infra/sql/production-telebirr-shadow-policy-recovery.sql',
    );
    expect(operationSqlSource).toContain(
      'app.retry_quarantined_private_telebirr_shadow_after_policy_fix(',
    );
    expect(operationSqlSource).toContain("'financialActionsEnabled', false");
    expect(operationSqlSource).toContain("'kemerBetCreditEnabled', false");
    expect(operationSqlSource).toContain("quarantine.reason_code = 'trusted_evidence_invalid'");
  });
});
