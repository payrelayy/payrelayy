import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260915171500_private_live_telebirr_job_recovery.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let guardSource = '';
let recoverySource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  guardSource =
    migrationSource.match(
      /create function app\.enforce_private_live_telebirr_verification_job_recovery\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  recoverySource =
    migrationSource.match(
      /create function app\.recover_unattempted_private_live_telebirr_verification_job\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(guardSource).not.toBe('');
  expect(recoverySource).not.toBe('');
});

describe('private live TeleBirr expired-job recovery source boundary', () => {
  it('retains the original deadline and permits only one bounded replacement window', () => {
    expect(migrationSource).toContain('add column original_expires_at timestamptz');
    expect(migrationSource).toContain('add column recovery_request_digest text');
    expect(migrationSource).toContain("recovery_reason_code = 'assignment_runtime_unavailable'");
    expect(migrationSource).toContain("expires_at > recovered_at + interval '60 seconds'");
    expect(migrationSource).toContain("expires_at <= recovered_at + interval '5 minutes'");
    expect(migrationSource).toContain('private_live_telebirr_jobs_recovery_request_key_idx');
    expect(migrationSource).toContain('private_live_telebirr_jobs_recovery_request_digest_idx');
  });

  it('keeps all ordinary job updates and every delete fail-closed', () => {
    expect(guardSource).toContain("if tg_op = 'DELETE' then");
    expect(guardSource).toContain("if session_user <> 'postgres'");
    expect(guardSource).toContain('old.recovery_request_key is not null');
    expect(guardSource).toContain('new.original_expires_at is distinct from old.expires_at');
    expect(guardSource).toContain('pg_catalog.to_jsonb(new) - array[');
    expect(guardSource).toContain('private_live_telebirr_verification_attempts');
    expect(guardSource).toContain('private_live_telebirr_verification_outcomes');
  });

  it('binds recovery to the exact active epoch, pilot, job, proof, and profile', () => {
    expect(recoverySource).toContain(
      'active_epoch := app.current_private_trusted_telebirr_activation_epoch()',
    );
    expect(recoverySource).toContain('active_epoch is distinct from p_activation_epoch');
    expect(recoverySource).toContain('activation_epoch.pilot_revision_id = p_pilot_revision_id');
    expect(recoverySource).toContain('verification_job.id = p_verification_job_id');
    expect(recoverySource).toContain('proof_row.id = job.private_live_deposit_pilot_proof_id');
    expect(recoverySource).toContain('receiver_profile.id = job.receiver_profile_id');
    expect(recoverySource).toContain('job.expires_at > authorized_at');
    expect(recoverySource).toContain("proof.submitted_at + interval '24 hours'");
  });

  it('refuses attempted or completed lineage and grants no runtime caller', () => {
    expect(recoverySource).toContain('from app.private_live_telebirr_verification_attempts');
    expect(recoverySource).toContain('from app.private_live_telebirr_verification_outcomes');
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_execution_jobs)/iu,
    );
    expect(recoverySource).not.toMatch(/update app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.recover_unattempted_private_live_telebirr_verification_job/iu,
    );
  });

  it('makes retries exact and does not automatically recover any production row', () => {
    expect(recoverySource).toContain(
      'job.recovery_request_key is distinct from p_recovery_request_key',
    );
    expect(recoverySource).toContain('job.recovery_request_digest is distinct from request_digest');
    expect(recoverySource).toContain(
      'select job.id, job.original_expires_at, job.expires_at, true',
    );
    expect(migrationSource).not.toMatch(
      /recover_unattempted_private_live_telebirr_verification_job\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });
});
