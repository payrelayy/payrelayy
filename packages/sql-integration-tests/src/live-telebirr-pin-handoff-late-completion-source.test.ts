import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261002125452_authorize_late_telebirr_pin_handoff_completion.sql',
    import.meta.url,
  ),
);

let source = '';

beforeAll(async () => {
  source = await readFile(migrationPath, 'utf8');
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
    expect(source).toContain('app.private_live_telebirr_pin_handoff_evidence_digest(job.id)');
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
    expect(source).not.toMatch(
      /(?:insert\s+into|update)\s+app\.(?:deposit_jobs|private_live_deposit_pilot_reservations|provider_payment_evidence)/iu,
    );
  });
});
