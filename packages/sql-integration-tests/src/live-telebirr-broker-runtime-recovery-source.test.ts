import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260917171000_fix_live_telebirr_broker_runtime_recovery.sql',
    import.meta.url,
  ),
);
const applicationPath = fileURLToPath(
  new URL(
    '../../../apps/telebirr-assignment-broker/src/telebirr-assignment-broker-application.ts',
    import.meta.url,
  ),
);

let migrationSource = '';
let applicationSource = '';
let recoverySource = '';
let guardExtensionSource = '';

beforeAll(async () => {
  [migrationSource, applicationSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(applicationPath, 'utf8'),
  ]);
  recoverySource =
    migrationSource.match(
      /create function app\.recover_private_live_telebirr_assignment_broker_runtime\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  guardExtensionSource = migrationSource.match(/\$new_tail\$([\s\S]+?)\$new_tail\$/u)?.[1] ?? '';

  expect(recoverySource).not.toBe('');
  expect(guardExtensionSource).not.toBe('');
});

describe('live TeleBirr assignment-broker runtime recovery source boundary', () => {
  it('retires a failed broker connection through a bounded readiness watchdog', () => {
    expect(applicationSource).toContain(
      'TELEBIRR_ASSIGNMENT_BROKER_READINESS_INTERVAL_MILLISECONDS = 5_000',
    );
    expect(applicationSource).toContain('readinessTimer.unref()');
    expect(applicationSource).toContain('if (!ready) void closeApplication()');
    expect(applicationSource).toContain('clearInterval(readinessTimer)');
    expect(applicationSource).toContain('await closeRuntimes(activeLocalServer, activePostgres)');
  });

  it('requires the exact reviewed predecessor sources before changing recovery authority', () => {
    expect(migrationSource).toContain(
      'df17c714ff3ed197534442ab7aa0e5b5fa88226fdd88d478f7911e33611dc9e2',
    );
    expect(migrationSource).toContain(
      '8b87768eeac5b4719cc4b2aa0752c418dd7233bf87940d0afc29837c83cec22a',
    );
    expect(migrationSource).toContain(
      'c6d6caaf5987323df4709303e19bd710ddd626836d94c1579de7d1b0e2722747',
    );
    expect(migrationSource).toContain(
      'fd355332c2f6a62a44df84aaea3d97a8feedcd2580e966e43a22569fcbf7d0e3',
    );
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
  });

  it('preserves the binding-retry replay against its retained second-window expiry', () => {
    expect(migrationSource).toContain(
      'epoch from coalesce(job.broker_original_expires_at, job.expires_at)',
    );
    expect(migrationSource).toContain('coalesce(job.broker_original_expires_at, job.expires_at)');
    expect(recoverySource).toContain('app.recover_private_live_telebirr_assignment_binding_retry(');
    expect(recoverySource).toContain('prior_recovery.already_recovered is distinct from true');
  });

  it('allows only one final five-minute transition from the exact two-attempt state', () => {
    expect(migrationSource).toContain("'assignment_broker_runtime_unavailable'");
    expect(migrationSource).toContain("expires_at > broker_recovered_at + interval '60 seconds'");
    expect(migrationSource).toContain("expires_at <= broker_recovered_at + interval '5 minutes'");
    expect(guardExtensionSource).toContain('attempt_count <> 2');
    expect(guardExtensionSource).toContain('transcript.verification_attempt_id = retry_attempt.id');
    expect(guardExtensionSource).toContain('delivery.verification_attempt_id = retry_attempt.id');
    expect(recoverySource).toContain("authorized_at + interval '5 minutes'");
    expect(recoverySource).toContain("proof.submitted_at + interval '24 hours'");
  });

  it('binds the audit digest to the stranded attempt and exact runtime repair source', () => {
    for (const source of [guardExtensionSource, recoverySource]) {
      expect(source).toContain(
        'fetanagent:telebirr:private-live-pilot:assignment-broker-runtime-recovery:v1',
      );
      expect(source).toContain("'|binding_retry_recovery_request_digest='");
      expect(source).toContain("'|stranded_retry_attempt_id='");
      expect(source).toContain("'|stranded_retry_assignment_id='");
      expect(source).toContain("'|runtime_repair_source_sha256='");
      expect(source).toContain(
        'sha256:911d05a9a40d047b849f0144eda6e1bb8f148569aff416de220e2a5ae4d05fff',
      );
      expect(source).toContain("'|repair_migration=20260917171000'");
    }
  });

  it('keeps evidence, settlement, and KemerBet execution outside the recovery', () => {
    expect(recoverySource).toContain('private_live_telebirr_device_evidence_staging');
    expect(recoverySource).toContain('private_live_telebirr_observation_transcripts');
    expect(recoverySource).toContain('private_live_telebirr_verification_outcomes');
    expect(recoverySource).toContain('private_live_deposit_pilot_reservations');
    expect(recoverySource).toContain('fetanagent_deposit_executor_runtime');
    expect(recoverySource).not.toMatch(/update app\.feature_switches/iu);
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:private_live_telebirr_verification_attempts|private_live_telebirr_device_evidence_staging|private_live_telebirr_verification_outcomes|deposit_payment_claims|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|deposit_jobs)/iu,
    );
  });

  it('grants no runtime caller and never targets a production row automatically', () => {
    expect(recoverySource).toContain("if session_user <> 'postgres'");
    expect(migrationSource).toMatch(
      /revoke all on function[\s\S]+recover_private_live_telebirr_assignment_broker_runtime/iu,
    );
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.recover_private_live_telebirr_assignment_broker_runtime/iu,
    );
    expect(migrationSource).not.toMatch(
      /recover_private_live_telebirr_assignment_broker_runtime\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });
});
