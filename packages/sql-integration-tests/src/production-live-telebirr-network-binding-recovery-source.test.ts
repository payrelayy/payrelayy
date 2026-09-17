import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const recoverySqlPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-network-binding-recovery.sql',
    import.meta.url,
  ),
);
const eligibilitySqlPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-network-binding-eligibility.sql',
    import.meta.url,
  ),
);
const statusSqlPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-network-binding-status.sql',
    import.meta.url,
  ),
);

let recoverySqlSource = '';
let eligibilitySqlSource = '';
let statusSqlSource = '';

beforeAll(async () => {
  [recoverySqlSource, eligibilitySqlSource, statusSqlSource] = await Promise.all([
    readFile(recoverySqlPath, 'utf8'),
    readFile(eligibilitySqlPath, 'utf8'),
    readFile(statusSqlPath, 'utf8'),
  ]);
});

describe('protected production live TeleBirr network-binding recovery', () => {
  it('pins the reviewed migration functions and invokes only the postgres-only recovery', () => {
    for (const digest of [
      '23809205c5d3e85e26d9909236b83bd153622b3704d48022095ef73f6ecbe70e',
      '71fe68f4d142b8cb84fdb52f174fc2e7fc782d7d707bf01bf24778e165142651',
      '237330eccfa5dfde5dd6c26de8694d32d1fd701964eeb65d5ef1d9049d1584d6',
    ]) {
      expect(recoverySqlSource).toContain(digest);
    }
    expect(recoverySqlSource).toContain("current_user = 'postgres'");
    expect(recoverySqlSource).toContain("session_user = 'postgres'");
    expect(recoverySqlSource).toContain('app.recover_private_live_telebirr_network_retry_binding(');
    expect(recoverySqlSource).toContain("'network_retry_reference_binding_registry'");
    expect(recoverySqlSource).toContain('transaction isolation level serializable');
  });

  it('selects one immutable stranded lineage and snapshots every downstream ledger', () => {
    for (const fragment of [
      "job.network_retry_reason_code = 'official_receipt_network_unavailable'",
      'job.network_binding_recovery_request_key is null',
      'attempt.attempt_number = 1',
      "source_outcome.disposition = 'review_required'",
      "source_outcome.reason_code = 'source_unavailable'",
      'private_live_telebirr_assignment_reference_bindings',
      'private_live_telebirr_assignment_transcripts',
      'private_live_telebirr_assignment_deliveries',
      'private_live_telebirr_device_evidence_staging',
      'private_live_telebirr_observation_transcripts',
      'private_live_telebirr_verification_outcomes',
      'private_live_deposit_pilot_reservations',
      'private_live_telebirr_settlement_receipts',
    ]) {
      expect(recoverySqlSource).toContain(fragment);
    }
    expect(recoverySqlSource).toContain("'scoped_ledger_before'::jsonb");
    expect(recoverySqlSource).toContain("'scoped_ledger_after'::jsonb");
  });

  it('diagnoses every eligibility boundary with only capped counts and fixed states', () => {
    for (const fragment of [
      'begin transaction isolation level read committed read only',
      "then 'pilot_scope_missing'",
      "then 'network_retry_lineage_missing'",
      "then 'replacement_attempt_missing'",
      "then 'replacement_attempts_multiple'",
      "then 'replacement_transcript_exists'",
      "then 'source_outcome_invalid'",
      "then 'source_binding_missing'",
      "then 'device_heartbeat_unavailable'",
      "then 'assignment_broker_unavailable'",
      "else 'eligible'",
      "'readOnly', true",
      "'moneyMoved', false",
      "'replacementAttempts', classified.replacement_attempts",
    ]) {
      expect(eligibilitySqlSource).toContain(fragment);
    }
    expect(eligibilitySqlSource).toContain('least((select count(*)');
    expect(eligibilitySqlSource).toContain(
      'private_trusted_telebirr_activation_control activation_control',
    );
    expect(eligibilitySqlSource).toContain(
      "activation_control.control_key =\n                  'trusted_telebirr_financial_authority'",
    );
    expect(eligibilitySqlSource).not.toContain(
      'app.current_private_trusted_telebirr_activation_epoch()',
    );
    expect(eligibilitySqlSource).not.toContain("'verificationJobId'");
    expect(eligibilitySqlSource).not.toContain("'proofId'");
    expect(eligibilitySqlSource).not.toContain("'transactionReference'");
  });

  it('recognizes only one untouched queued job as success', () => {
    expect(statusSqlSource).toContain("deposit_job.status = 'queued'");
    expect(statusSqlSource).toContain('deposit_job.attempt_count = 0');
    expect(statusSqlSource).toContain('deposit_job.lease_token is null');
    expect(statusSqlSource).toContain("summary.reason_code = 'exact_proof_match'");
    expect(statusSqlSource).toContain("then 'queued'");
    expect(statusSqlSource).toContain('summary.attempts = 2');
    expect(statusSqlSource).toContain('summary.queued_jobs = 1');
  });

  it('keeps KemerBet disabled and emits only redacted counts and states', () => {
    for (const source of [recoverySqlSource, eligibilitySqlSource, statusSqlSource]) {
      expect(source).toContain('fetanagent_deposit_executor_runtime');
    }
    for (const source of [recoverySqlSource, statusSqlSource]) {
      expect(source).not.toMatch(/alter role\s+fetanagent_deposit_executor/iu);
      expect(source).not.toMatch(/update\s+app\.feature_switches/iu);
    }
    expect(statusSqlSource).not.toContain("'verificationJobId'");
    expect(statusSqlSource).not.toContain("'recoveryRequestKey'");
    expect(statusSqlSource).toContain("'kemerBetLoginRoles'");
    expect(statusSqlSource).toContain("'kemerBetSessions'");
    expect(statusSqlSource).toContain("'executionEnabled'");
  });

  it('contains no direct financial or verification write outside the reviewed recovery function', () => {
    expect(recoverySqlSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate)\s+app\./iu,
    );
    expect(statusSqlSource).toContain('read committed read only');
    expect(statusSqlSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate|alter|create|drop)\s+app\./iu,
    );
    expect(eligibilitySqlSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate|alter|create|drop)\s+app\./iu,
    );
  });
});
