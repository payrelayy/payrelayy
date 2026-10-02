import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261002125452_authorize_late_telebirr_pin_handoff_completion.sql',
    import.meta.url,
  ),
);
const workflowPath = fileURLToPath(
  new URL(
    '../../../.github/workflows/production-live-telebirr-pin-handoff-late-completion.yml',
    import.meta.url,
  ),
);
const eligibilityPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-pin-handoff-late-eligibility.sql',
    import.meta.url,
  ),
);
const armPath = fileURLToPath(
  new URL('../../../infra/sql/production-live-telebirr-pin-handoff-late-arm.sql', import.meta.url),
);

let source = '';
let workflow = '';
let eligibility = '';
let arm = '';

beforeAll(async () => {
  const sources = await Promise.all(
    [migrationPath, eligibilityPath, armPath].map((path) => readFile(path, 'utf8')),
  );
  source = sources[0]!;
  eligibility = sources[1]!;
  arm = sources[2]!;
  if (process.env.SQL_INTEGRATION_MODE !== 'local-disposable') {
    workflow = await readFile(workflowPath, 'utf8');
  }
});

describe('late, staged device-pin-handoff completion', () => {
  it('leaves the normal payment-deadline rule untouched', () => {
    expect(source).not.toContain('create or replace function app.claim_verified_deposit_payment');
    expect(source).not.toContain('update app.deposit_intents');
    expect(source).not.toContain('update app.feature_switches');
    expect(source).toContain('device_pin_handoff_late_completion');
    expect(source).toContain('expired_authority_staged_evidence_completion');
  });

  it('requires the exact existing job and four immutable signed attempts', () => {
    expect(source).toContain("verification_job.recovery_reason_code = 'device_pin_handoff_retry'");
    expect(source).toContain('attempt.attempt_number <> 4');
    expect(source).toContain('app.is_private_live_telebirr_pin_handoff_recovery_intact(job.id)');
    expect(source).toContain('job.recovery_request_digest is not distinct from expected_digest');
    expect(source).toContain('candidate.attempt_number in (1, 2)');
    expect(source).toContain('candidate.attempt_number in (3, 4)');
    expect(source).toContain("quarantine.reason_code = 'trusted_evidence_invalid'");
    expect(source).toContain('evidence.staged_at < candidate.expires_at');
    expect(source).toContain("(p_reason_code = 'device_pin_handoff_late_completion')::integer");
    expect(source).not.toContain('case when p_reason_code');
    expect(source).not.toMatch(
      /(?:delete\s+from|update)\s+app\.(?:private_live_telebirr_verifier_evidence_quarantine|private_live_telebirr_device_evidence_staging)/iu,
    );
  });

  it('requires on-time proof submission and keeps execution disabled', () => {
    expect(source).toContain('proof.submitted_at >=');
    expect(source).toContain('proof.submitted_at <=');
    expect(source).toContain('policy.freshness_window_seconds');
    expect(source).toContain("execution_job.status in ('queued', 'leased', 'retry_wait')");
    expect(source).toContain("control.control_state = 'disabled'");
    expect(source).toContain('provider_payment_evidence payment_evidence');
    expect(source).toContain('private_live_telebirr_source_document_bindings binding');
    expect(source).not.toMatch(
      /(?:insert\s+into|update)\s+app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|provider_payment_evidence)/iu,
    );
  });

  it('binds the one-use operation to the recovered job and leaves its queue untouched', () => {
    expect(eligibility).toContain("job.recovery_reason_code = 'device_pin_handoff_retry'");
    expect(eligibility).toContain('job.recovery_request_key =');
    expect(eligibility).toContain('summary.fresh_evidence_count <> 2');
    expect(eligibility).toContain('summary.prior_quarantine_count <> 2');
    expect(eligibility).toContain("control.control_state = 'disabled'");
    expect(arm).toContain("'device_pin_handoff_late_completion'");
    if (workflow) {
      expect(workflow).toContain('queue_observed=1');
      expect(workflow).toContain('.queuedDepositJobs == 1');
      expect(workflow).toContain('.executionEnabled == false');
      expect(workflow).toContain('emergency-stop');
      expect(workflow).not.toContain('approve_deposit');
    }
  });
});
