import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const recoverySqlPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-source-document-recovery.sql',
    import.meta.url,
  ),
);
const eligibilitySqlPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-source-document-eligibility.sql',
    import.meta.url,
  ),
);
const statusSqlPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-live-telebirr-source-document-status.sql',
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

describe('protected production live TeleBirr source-document recovery', () => {
  it('pins the reviewed migrations and every privileged function body', () => {
    for (const migration of ['20260918021500', '20260918023000']) {
      expect(recoverySqlSource).toContain(migration);
    }
    for (const digest of [
      'cf004b38b587d4a3894217d1db721af3a6217481a791297f35a0017f3a888a4f',
      '682c4c2347d73fed98cd5839a8a0702dae1fc5714973a437a70015892b84aa6a',
      '170a1b727b58b965fe2a935c87c64aed2ff83ac527da2389b1af13597e3ff567',
      'be5588fd9107174dcf7251e4adeb9f518c508d8ac59fefd78194248013655cbb',
      '0431435bcb3f0ca3e3cd9a3f525a6a5cd6dc2a17a6cbe4a72e750ba858ffc52c',
    ]) {
      expect(recoverySqlSource).toContain(digest);
    }
    expect(recoverySqlSource).toContain("current_user = 'postgres'");
    expect(recoverySqlSource).toContain("session_user = 'postgres'");
    expect(recoverySqlSource).toContain(
      'app.recover_private_live_telebirr_source_document_collision(',
    );
    expect(recoverySqlSource).toContain('transaction isolation level serializable');
  });

  it('preflights the exact four-attempt, two-evidence same-reference collision read only', () => {
    for (const fragment of [
      'begin transaction isolation level read committed read only',
      'summary.attempt_count = 4',
      'summary.expired_attempts = 4',
      'summary.transcript_count = 2',
      'summary.delivery_count = 2',
      'summary.evidence_count = 2',
      'summary.collision_count between 1 and 2',
      'summary.settled_documents = 0',
      'summary.outcomes = 0',
      'summary.reservations = 0',
      'summary.broker_sessions = 1',
      'summary.verifier_sessions = 1',
      "then 'same_reference_collision_missing'",
      "then 'document_already_settled'",
      "else 'eligible'",
      "'readOnly', true",
      "'moneyMoved', false",
    ]) {
      expect(eligibilitySqlSource).toContain(fragment);
    }
    expect(eligibilitySqlSource).toContain('private_live_telebirr_source_document_bindings');
    expect(eligibilitySqlSource).toContain('private_live_telebirr_settlement_documents');
  });

  it('reopens only the audited job window and creates no ledger row directly', () => {
    expect(recoverySqlSource).toMatch(
      /select recovered\.\*\s+from app\.recover_private_live_telebirr_source_document_collision\(/u,
    );
    expect(recoverySqlSource).toContain("'financialRowsCreated'");
    expect(recoverySqlSource).toContain('summary.financial_rows_unchanged');
    expect(recoverySqlSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate)\s+app\./iu,
    );
    expect(recoverySqlSource).not.toMatch(/update\s+app\.feature_switches/iu);
    expect(recoverySqlSource).not.toMatch(/alter\s+role\s+fetanagent_deposit_executor/iu);
  });

  it('recognizes success only as one untouched queued execution job', () => {
    for (const fragment of [
      "deposit_job.status = 'queued'",
      'deposit_job.attempt_count = 0',
      'deposit_job.lease_token is null',
      'deposit_job.leased_by is null',
      'deposit_job.lease_expires_at is null',
      'deposit_job.last_error_code is null',
      'deposit_job.completed_at is null',
      "summary.disposition = 'settlement_candidate'",
      "summary.reason_code = 'exact_proof_match'",
      'summary.observation_count = 1',
      'summary.outcome_count',
      'summary.reservation_count = 1',
      'summary.settlement_count = 1',
      'summary.document_count = 1',
      'summary.execution_job_count = 1',
      'summary.queued_job_count = 1',
      "then 'queued'",
    ]) {
      expect(statusSqlSource).toContain(fragment);
    }
  });

  it('keeps KemerBet disabled and emits only redacted states and counts', () => {
    for (const source of [recoverySqlSource, eligibilitySqlSource, statusSqlSource]) {
      expect(source).toContain('fetanagent_deposit_executor_runtime');
      expect(source).not.toMatch(/update\s+app\.feature_switches/iu);
      expect(source).not.toMatch(/alter\s+role\s+fetanagent_deposit_executor/iu);
      expect(source).not.toContain("'verificationJobId'");
      expect(source).not.toContain("'sourceDocumentDigest',");
      expect(source).not.toContain("'transactionReference'");
    }
    expect(statusSqlSource).toContain("'kemerBetLoginRoles'");
    expect(statusSqlSource).toContain("'kemerBetSessions'");
    expect(statusSqlSource).toContain("'executionEnabled'");
    expect(eligibilitySqlSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate|alter|create|drop)\s+app\./iu,
    );
    expect(statusSqlSource).not.toMatch(
      /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate|alter|create|drop)\s+app\./iu,
    );
  });
});
