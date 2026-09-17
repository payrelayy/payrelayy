import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260917220932_fix_live_telebirr_network_retry_binding.sql',
    import.meta.url,
  ),
);
let migrationSource = '';
let recoverySource = '';
let mutationGuardSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  recoverySource =
    migrationSource.match(
      /create function app\.recover_private_live_telebirr_network_retry_binding\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  mutationGuardSource =
    migrationSource.match(
      /create or replace function app\.reject_private_live_telebirr_network_retry_mutation\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(recoverySource).not.toBe('');
  expect(mutationGuardSource).not.toBe('');
});

describe('live TeleBirr network-retry reference-binding repair', () => {
  it('patches only the reviewed registry guard and preserves authority', () => {
    expect(migrationSource).toContain(
      '0d55bd12f3a2a4e0da69a82bbbc3b0b7a94a4afa698f57bdd36b298e2a35c883',
    );
    expect(migrationSource).toContain(
      '23809205c5d3e85e26d9909236b83bd153622b3704d48022095ef73f6ecbe70e',
    );
    expect(migrationSource).toContain('job.network_retry_source_job_id');
    expect(migrationSource).toContain(
      'registered_job_id is distinct from authorized_source_job_id',
    );
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
  });

  it('opens one audited five-minute recovery only for the exact stranded attempt', () => {
    expect(recoverySource).toContain('attempt_count <> 1');
    expect(recoverySource).toContain('attempt.attempt_number = 1');
    expect(recoverySource).toContain('attempt.expires_at > authorized_at');
    expect(recoverySource).toContain("authorized_at + interval '5 minutes'");
    expect(recoverySource).toContain("proof.submitted_at + interval '24 hours'");
    expect(recoverySource).toContain('private_live_telebirr_assignment_reference_bindings');
    expect(recoverySource).toContain("'network_retry_reference_binding_registry'");
  });

  it('keeps downstream and KemerBet execution outside the recovery', () => {
    expect(recoverySource).toContain('private_live_telebirr_device_evidence_staging');
    expect(recoverySource).toContain('private_live_telebirr_observation_transcripts');
    expect(recoverySource).toContain('private_live_telebirr_verification_outcomes');
    expect(recoverySource).toContain('private_live_deposit_pilot_reservations');
    expect(recoverySource).toContain('fetanagent_deposit_executor_runtime');
    expect(mutationGuardSource).toContain('fetanagent_deposit_executor_runtime');
    expect(recoverySource).not.toMatch(/update app\.feature_switches/iu);
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:private_live_telebirr_verification_attempts|private_live_telebirr_device_evidence_staging|private_live_telebirr_verification_outcomes|deposit_payment_claims|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|deposit_jobs)/iu,
    );
  });

  it('retains immutable job guards for original and replacement jobs', () => {
    expect(migrationSource).toContain('when (old.network_retry_source_job_id is null)');
    expect(mutationGuardSource).toContain("if tg_op = 'DELETE'");
    expect(mutationGuardSource).toContain("if session_user <> 'postgres'");
    expect(mutationGuardSource).toContain('pg_catalog.to_jsonb(new)');
    expect(mutationGuardSource).toContain('network_binding_recovery_request_digest');
  });

  it('grants no runtime caller and never targets a production row automatically', () => {
    expect(recoverySource).toContain("if session_user <> 'postgres'");
    expect(migrationSource).toMatch(
      /revoke all on function app\.recover_private_live_telebirr_network_retry_binding/iu,
    );
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.recover_private_live_telebirr_network_retry_binding/iu,
    );
    expect(migrationSource).not.toMatch(
      /recover_private_live_telebirr_network_retry_binding\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });
});
