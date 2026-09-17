import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260917152955_fix_live_telebirr_fingerprint_binding_and_recovery.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let recoveryGuardSource = '';
let recoverySource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  recoveryGuardSource =
    migrationSource.match(
      /create or replace function app\.enforce_private_live_telebirr_verification_job_recovery\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  recoverySource =
    migrationSource.match(
      /create function app\.recover_attempted_private_live_telebirr_binding_mismatch_job\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(recoveryGuardSource).not.toBe('');
  expect(recoverySource).not.toBe('');
});

describe('live TeleBirr fingerprint binding repair and attempted-job recovery source boundary', () => {
  it('repairs both live wire comparisons without changing staging authority', () => {
    expect(migrationSource).toContain(
      "assignment_body ->> 'referenceFingerprint'\n      is distinct from 'hmac-sha256:' || job.candidate_reference_fingerprint",
    );
    expect(migrationSource).toContain(
      "observation_body ->> 'referenceFingerprint'\n      is distinct from 'hmac-sha256:' || job.candidate_reference_fingerprint",
    );
    expect(migrationSource).toContain(
      'dfe90415f8fa49a7de6f2034e07ebe081f26d1c066d734d74d0f0626617f65b9',
    );
    expect(migrationSource).toContain(
      'd9977107fbbe842758b1e09d917f7fbac66af2e31c68004386b81bcb842cbe2e',
    );
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(migrationSource).toContain(
      "routine.proconfig = array['search_path=pg_catalog']::text[]",
    );
  });

  it('retains the original expiry and opens at most one bounded replacement window', () => {
    expect(migrationSource).toContain("'device_evidence_binding_mismatch'");
    expect(migrationSource).toContain("expires_at > recovered_at + interval '60 seconds'");
    expect(migrationSource).toContain("expires_at <= recovered_at + interval '5 minutes'");
    expect(recoverySource).toContain("authorized_at + interval '5 minutes'");
    expect(recoverySource).toContain("proof.submitted_at + interval '24 hours'");
    expect(recoverySource).toContain('verification_job.recovery_request_key is null');
  });

  it('requires exactly one expired attempt and one delivered assignment with no downstream state', () => {
    expect(recoverySource).toContain('attempt_count <> 1');
    expect(recoverySource).toContain('failed_attempt.attempt_number <> 1');
    expect(recoverySource).toContain('failed_attempt.expires_at > authorized_at');
    expect(recoverySource).toContain('private_live_telebirr_assignment_transcripts');
    expect(recoverySource).toContain('private_live_telebirr_assignment_deliveries');
    expect(recoverySource).toContain('private_live_telebirr_device_evidence_staging');
    expect(recoverySource).toContain('private_live_telebirr_observation_transcripts');
    expect(recoverySource).toContain('private_live_telebirr_verification_outcomes');
    expect(recoverySource).toContain('private_live_deposit_pilot_reservations');
    expect(recoverySource).toContain('staging_source_sha256 is distinct from');
  });

  it('binds the immutable recovery digest to the failed attempt, assignment, and reviewed defect', () => {
    for (const source of [recoveryGuardSource, recoverySource]) {
      expect(source).toContain(
        'fetanagent:telebirr:private-live-pilot:binding-mismatch-job-recovery:v1',
      );
      expect(source).toContain("'|failed_attempt_id='");
      expect(source).toContain("'|failed_assignment_body_digest='");
      expect(source).toContain("'|failed_reference_binding_digest='");
      expect(source).toContain("'|defect_source_sha256='");
    }
  });

  it('requires current financial authority while keeping the deposit executor disabled', () => {
    expect(recoverySource).toContain(
      'active_epoch := app.current_private_trusted_telebirr_activation_epoch()',
    );
    expect(recoverySource).toContain('active_epoch is distinct from p_activation_epoch');
    expect(recoverySource).toContain('fetanagent_deposit_executor_runtime');
    expect(recoverySource).toContain('and role.rolcanlogin');
    expect(recoverySource).toContain('from pg_catalog.pg_stat_activity activity');
    expect(recoverySource).not.toMatch(/update app\.feature_switches/iu);
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_payment_claims|private_live_deposit_pilot_reservations|deposit_jobs)/iu,
    );
  });

  it('grants no runtime caller and never targets a production row automatically', () => {
    expect(recoverySource).toContain("if session_user <> 'postgres'");
    expect(migrationSource).toMatch(
      /revoke all on function[\s\S]+recover_attempted_private_live_telebirr_binding_mismatch_job/iu,
    );
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.recover_attempted_private_live_telebirr_binding_mismatch_job/iu,
    );
    expect(migrationSource).not.toMatch(
      /recover_attempted_private_live_telebirr_binding_mismatch_job\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });
});
