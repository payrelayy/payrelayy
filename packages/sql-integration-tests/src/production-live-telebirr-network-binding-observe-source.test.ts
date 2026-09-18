import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const observerSqlPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-network-binding-observe.sql',
    import.meta.url,
  ),
);

let observerSqlSource = '';

beforeAll(async () => {
  observerSqlSource = await readFile(observerSqlPath, 'utf8');
});

describe('production live TeleBirr network-binding observer', () => {
  it('derives exactly one recent recovered target without protected identifier inputs', () => {
    for (const fragment of [
      "job.network_retry_reason_code = 'official_receipt_network_unavailable'",
      'job.network_retry_source_job_id is not null',
      'job.network_binding_recovered_at is not null',
      "'network_retry_reference_binding_registry'",
      "pg_catalog.clock_timestamp() - interval '24 hours'",
      '(select count(*) from recent_recovery_targets) = 1',
    ]) {
      expect(observerSqlSource).toContain(fragment);
    }
    expect(observerSqlSource).not.toContain('TARGET_PILOT_REVISION_ID');
    expect(observerSqlSource).not.toContain('NETWORK_BINDING_RECOVERY_REQUEST_KEY');
  });

  it('recognizes append-only attempts while requiring one untouched queued job', () => {
    for (const fragment of [
      'summary.attempts >= 3',
      'summary.contiguous_attempts',
      "deposit_job.status = 'queued'",
      'deposit_job.attempt_count = 0',
      'deposit_job.lease_token is null',
      'deposit_job.last_error_code is null',
      'summary.execution_jobs = 1',
      'summary.queued_jobs = 1',
      'summary.transcripts not between 0 and summary.attempts',
      'summary.evidence not between 0 and summary.attempts',
      "then 'queued'",
    ]) {
      expect(observerSqlSource).toContain(fragment);
    }
    expect(observerSqlSource).not.toContain('summary.attempts = 3');
  });

  it('accepts retained duplicate evidence only when the terminal chain remains one-to-one', () => {
    expect(observerSqlSource).toContain('summary.transcripts between 1 and summary.attempts');
    expect(observerSqlSource).toContain('summary.deliveries = summary.transcripts');
    expect(observerSqlSource).toContain('summary.evidence = summary.deliveries');
    expect(observerSqlSource).not.toContain(
      "when summary.disposition = 'review_required'\n              and summary.transcripts = 1",
    );
  });

  it('keeps the observer read only and reports only redacted counts and fixed states', () => {
    expect(observerSqlSource).toContain(
      'begin transaction isolation level read committed read only',
    );
    expect(observerSqlSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate|alter|create|drop)\s+app\./iu,
    );
    expect(observerSqlSource).not.toContain("'verificationJobId'");
    expect(observerSqlSource).not.toContain("'recoveryRequestKey'");
    expect(observerSqlSource).not.toContain("'transactionReference'");
    expect(observerSqlSource).toContain("'readOnly', true");
    expect(observerSqlSource).toContain("'moneyMoved', false");
    expect(observerSqlSource).toContain("'recentRecoveryTargets'");
    expect(observerSqlSource).toContain("'lastAttemptNumber'");
  });

  it('treats every KemerBet execution boundary as unsafe unless disabled', () => {
    expect(observerSqlSource).toContain("feature_switch.feature_key = 'deposit_execution'");
    expect(observerSqlSource).toContain("feature_switch.mode = 'disabled'");
    expect(observerSqlSource).toContain('fetanagent_deposit_executor_runtime');
    expect(observerSqlSource).toContain("'depositExecutionSwitchDisabled'");
    expect(observerSqlSource).toContain("'kemerBetLoginRoles'");
    expect(observerSqlSource).toContain("'kemerBetSessions'");
    expect(observerSqlSource).toContain("'executionEnabled'");
    expect(observerSqlSource).toContain(
      'summary.kemer_logins <> 0\n           or summary.kemer_sessions <> 0 as execution_enabled',
    );
  });

  it('diagnoses the trusted verifier gap without exposing evidence contents', () => {
    for (const fragment of [
      "'trustedVerifierLoginState'",
      "'trustedVerifierSessions'",
      "'unexpectedVerifierSessions'",
      "'financialAuthorityActive'",
      "'verificationBoundaryLive'",
      "'evidenceQuarantines'",
      "'eligibleEvidenceNow'",
      "'minimumEvidenceLeadSeconds'",
      "then 'staged_evidence_unconsumed'",
      "then 'trusted_verifier_login_unavailable'",
      "then 'trusted_verifier_session_unavailable'",
    ]) {
      expect(observerSqlSource).toContain(fragment);
    }
    expect(observerSqlSource).not.toContain("'signedAssignment'");
    expect(observerSqlSource).not.toContain("'signedObservation'");
  });

  it('derives financial authority without calling a lock-taking runtime interlock', () => {
    for (const fragment of [
      'read_only_financial_authority as materialized',
      "activation_control.control_key = 'trusted_telebirr_financial_authority'",
      "activation_epoch.authority_state = 'active'",
      'activation_epoch.revoked_at is null',
      'private_trusted_telebirr_emergency_disable_intents',
      "feature_switch.feature_key = 'cbe_birr_authoritative_verification'",
      "feature_switch.feature_key = 'private_live_deposit_pilot'",
      'exists (select 1 from read_only_financial_authority)',
    ]) {
      expect(observerSqlSource).toContain(fragment);
    }
    expect(observerSqlSource).not.toContain(
      'app.current_private_trusted_telebirr_activation_epoch()',
    );
    expect(observerSqlSource).not.toMatch(/\bfor\s+(?:key\s+)?share\b/iu);
    expect(observerSqlSource).not.toMatch(/\bfor\s+(?:no\s+key\s+)?update\b/iu);
  });
});
