import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260917161516_fix_live_telebirr_retry_binding_uniqueness.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let bindingGuardSource = '';
let jobRecoveryGuardSource = '';
let recoverySource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  bindingGuardSource =
    migrationSource.match(
      /create function app\.enforce_private_live_telebirr_assignment_reference_binding\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  jobRecoveryGuardSource =
    migrationSource.match(
      /create or replace function app\.enforce_private_live_telebirr_verification_job_recovery\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  recoverySource =
    migrationSource.match(
      /create function app\.recover_private_live_telebirr_assignment_binding_retry\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';

  expect(bindingGuardSource).not.toBe('');
  expect(jobRecoveryGuardSource).not.toBe('');
  expect(recoverySource).not.toBe('');
});

describe('live TeleBirr retry reference-binding repair source boundary', () => {
  it('guards and replaces only the reviewed global uniqueness constraint', () => {
    expect(migrationSource).toContain(
      'add740d5b0efde9fa5b9f14b624340474a0bcc47618011469d230f82672a95be',
    );
    expect(migrationSource).toContain("'UNIQUE (reference_binding_digest)'");
    expect(migrationSource).toContain(
      'drop constraint private_live_telebirr_assignment_t_reference_binding_digest_key',
    );
    expect(migrationSource).toContain(
      'create index private_live_tbirr_assignment_reference_binding_idx',
    );
    expect(migrationSource).not.toContain(
      'create unique index private_live_tbirr_assignment_reference_binding_idx',
    );
  });

  it('allows same-job retries while retaining an immutable cross-job replay boundary', () => {
    expect(migrationSource).toContain(
      'create table app.private_live_telebirr_assignment_reference_bindings',
    );
    expect(migrationSource).toContain(
      'private_live_telebirr_assignment_reference_bindings_immutable',
    );
    expect(migrationSource).toContain(
      'private_live_telebirr_assignment_reference_bindings_no_truncate',
    );
    expect(migrationSource).toContain('private_live_tbirr_assignment_reference_binding_fkey');
    expect(bindingGuardSource).toContain('on conflict (reference_binding_digest) do nothing');
    expect(bindingGuardSource).toContain('registered_job_id is distinct from resolved_job_id');
    expect(bindingGuardSource).toContain('belongs to another verification job');
  });

  it('retains the first recovery path and adds only one bounded final window', () => {
    expect(jobRecoveryGuardSource).toContain(
      'fetanagent:telebirr:private-live-pilot:job-recovery:v1',
    );
    expect(jobRecoveryGuardSource).toContain(
      'fetanagent:telebirr:private-live-pilot:binding-mismatch-job-recovery:v1',
    );
    expect(jobRecoveryGuardSource).toContain(
      'fetanagent:telebirr:private-live-pilot:assignment-binding-retry-recovery:v1',
    );
    expect(migrationSource).toContain("'assignment_reference_binding_uniqueness'");
    expect(migrationSource).toContain("expires_at > retry_recovered_at + interval '60 seconds'");
    expect(migrationSource).toContain("expires_at <= retry_recovered_at + interval '5 minutes'");
    expect(recoverySource).toContain("authorized_at + interval '5 minutes'");
    expect(recoverySource).toContain("proof.submitted_at + interval '24 hours'");
  });

  it('preserves the first recovery replay against its retained first-window expiry', () => {
    expect(migrationSource).toContain(
      'e317bb957244136f17244d6b64716fc842c8eac5a18d7a5b576a7771187010d8',
    );
    expect(migrationSource).toContain(
      'db61cf239b113c97d95ef0ee589dd32702cdd4db2ab27d5d6d727cf277771f10',
    );
    expect(migrationSource).toContain(
      'epoch from coalesce(job.retry_original_expires_at, job.expires_at)',
    );
    expect(migrationSource).toContain('coalesce(job.retry_original_expires_at, job.expires_at),');
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
  });

  it('requires the exact two-attempt, pre-evidence, pre-settlement stranded state', () => {
    expect(recoverySource).toContain('attempt_count <> 2');
    expect(recoverySource).toContain('failed_attempt.attempt_number <> 1');
    expect(recoverySource).toContain('retry_attempt.attempt_number <> 2');
    expect(recoverySource).toContain('transcript.verification_attempt_id = retry_attempt.id');
    expect(recoverySource).toContain('delivery.verification_attempt_id = retry_attempt.id');
    expect(recoverySource).toContain('private_live_telebirr_device_evidence_staging');
    expect(recoverySource).toContain('private_live_telebirr_observation_transcripts');
    expect(recoverySource).toContain('private_live_telebirr_verification_outcomes');
    expect(recoverySource).toContain('private_live_deposit_pilot_reservations');
    expect(recoverySource).toContain('staging_source_sha256 is distinct from');
  });

  it('binds the audit digest to both attempts and the installed repair source', () => {
    for (const source of [jobRecoveryGuardSource, recoverySource]) {
      expect(source).toContain("'|first_recovery_request_digest='");
      expect(source).toContain("'|failed_attempt_id='");
      expect(source).toContain("'|failed_reference_binding_digest='");
      expect(source).toContain("'|stranded_retry_attempt_id='");
      expect(source).toContain("'|stranded_retry_assignment_id='");
      expect(source).toContain("'|repair_migration=20260917161516'");
      expect(source).toContain("'|repair_source_sha256=sha256:'");
    }
  });

  it('requires live authority while keeping the deposit executor disabled', () => {
    expect(recoverySource).toContain(
      'active_epoch := app.current_private_trusted_telebirr_activation_epoch()',
    );
    expect(recoverySource).toContain('active_epoch is distinct from p_activation_epoch');
    expect(recoverySource).toContain('app.is_private_live_deposit_pilot_enforced()');
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
      /revoke all on function[\s\S]+recover_private_live_telebirr_assignment_binding_retry/iu,
    );
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.recover_private_live_telebirr_assignment_binding_retry/iu,
    );
    expect(migrationSource).not.toMatch(
      /recover_private_live_telebirr_assignment_binding_retry\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });
});
