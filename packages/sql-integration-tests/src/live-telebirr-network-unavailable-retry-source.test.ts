import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260917214600_retry_live_telebirr_after_network_unavailable.sql',
    import.meta.url,
  ),
);
let migrationSource = '';
let retrySource = '';
let insertGuardSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  retrySource =
    migrationSource.match(
      /create function app\.retry_private_live_telebirr_after_network_unavailable\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  insertGuardSource =
    migrationSource.match(
      /create function app\.enforce_private_live_telebirr_network_retry_insert\(\)[\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';

  expect(retrySource).not.toBe('');
  expect(insertGuardSource).not.toBe('');
});

describe('live TeleBirr network-unavailable retry source boundary', () => {
  it('preserves the original terminal outcome and links one replacement job to it', () => {
    expect(migrationSource).toContain('network_retry_source_job_id uuid');
    expect(migrationSource).toContain('private_live_telebirr_jobs_original_proof_uidx');
    expect(migrationSource).toContain('private_live_telebirr_jobs_network_retry_proof_uidx');
    expect(migrationSource).toContain('private_live_telebirr_jobs_network_retry_source_uidx');
    expect(retrySource).toContain("outcome.disposition is distinct from 'review_required'");
    expect(retrySource).toContain("outcome.reason_code is distinct from 'source_unavailable'");
    expect(retrySource).not.toMatch(
      /delete from app\.private_live_telebirr_verification_outcomes/iu,
    );
    expect(retrySource).not.toMatch(/update app\.private_live_telebirr_verification_outcomes/iu);
  });

  it('moves customer-visible status to the linked replacement without mutating intake receipts', () => {
    expect(migrationSource).toContain(
      '8da3d728ae7fef5b6db54408cb410af448a63e5c0d84df14127b430ba881382f',
    );
    expect(migrationSource).toContain(
      '37531e5f4e5f21b9477a663661e4049d1c420540ebd16c24cb2f975c7c90b12d',
    );
    expect(migrationSource).toContain('retry_job.network_retry_source_job_id = source_job.id');
    expect(migrationSource).toContain('coalesce(retry_job.id, source_job.id)');
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(migrationSource).not.toMatch(/update app\.telegram_live_telebirr_proof_receipts/iu);
  });

  it('requires signed network-only evidence and a fresh ready device', () => {
    expect(retrySource).toContain("'{body,facts,lookupOutcome}'");
    expect(retrySource).toContain("is distinct from 'review_required'");
    expect(retrySource).toContain("'{body,facts,reviewReason}'");
    expect(retrySource).toContain("is distinct from 'network_unavailable'");
    expect(retrySource).toContain("heartbeat.runtime_state <> 'ready'");
    expect(retrySource).toContain("heartbeat.status_code <> 'no_assignment'");
    expect(retrySource).toContain("interval '6 minutes'");
    expect(retrySource).toContain('heartbeat.last_seen_at < outcome.created_at');
  });

  it('requires the live singleton broker and keeps KemerBet disabled', () => {
    expect(retrySource).toContain('fetanagent_telebirr_assignment_broker_runtime');
    expect(retrySource).toContain('1178948673::integer');
    expect(retrySource).toContain('1413632594::integer');
    expect(retrySource).toContain('fetanagent_deposit_executor_runtime');
    expect(insertGuardSource).toContain('fetanagent_deposit_executor_runtime');
    expect(retrySource).not.toMatch(/alter role[\s\S]+login/iu);
    expect(retrySource).not.toMatch(/update app\.feature_switches/iu);
  });

  it('creates only a bounded replacement verification job', () => {
    expect(retrySource).toContain("authorized_at + interval '5 minutes'");
    expect(retrySource).toContain("proof.submitted_at + interval '24 hours'");
    expect(retrySource).toMatch(/insert into app\.private_live_telebirr_verification_jobs/iu);
    expect(retrySource).not.toMatch(
      /insert into app\.(?:private_live_telebirr_verification_attempts|private_live_telebirr_device_evidence_staging|private_live_telebirr_verification_outcomes|deposit_payment_claims|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts|deposit_jobs)/iu,
    );
  });

  it('is postgres-only, idempotent, and never targets a production row automatically', () => {
    expect(retrySource).toContain("if session_user <> 'postgres'");
    expect(retrySource).toContain(
      'replacement_job.network_retry_request_key is distinct from p_retry_request_key',
    );
    expect(migrationSource).toMatch(
      /revoke all on function app\.retry_private_live_telebirr_after_network_unavailable/iu,
    );
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.retry_private_live_telebirr_after_network_unavailable/iu,
    );
    expect(migrationSource).not.toMatch(
      /retry_private_live_telebirr_after_network_unavailable\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });
});
