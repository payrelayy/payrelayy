import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowSource = await readFile(
  new URL(
    '../../.github/workflows/production-live-telebirr-source-document-recovery.yml',
    import.meta.url,
  ),
  'utf8',
);

test('requires exact reviewed main, production protection, CI, and explicit approval', () => {
  assert.match(workflowSource, /environment: production/u);
  assert.ok(workflowSource.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(
    workflowSource.includes(
      '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$CONFIRMED_COMMIT" == "$GITHUB_SHA" ]]',
    ),
  );
  assert.ok(
    workflowSource.includes('RECOVER LIVE TELEBIRR SOURCE DOCUMENT COLLISION - KEMERBET DISABLED'),
  );
  assert.ok(workflowSource.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflowSource.includes('SUPABASE_CA_CERTIFICATE_PEM'));
  assert.ok(workflowSource.includes('PGSSLMODE: verify-full'));
});

test('runs only reviewed preflight, recovery, and bounded status observation', () => {
  for (const path of [
    'infra/sql/production-live-telebirr-source-document-eligibility.sql',
    'infra/sql/production-live-telebirr-source-document-recovery.sql',
    'infra/sql/production-live-telebirr-source-document-status.sql',
  ]) {
    assert.ok(workflowSource.includes(`--file=${path}`));
  }
  assert.ok(workflowSource.includes('for _ in $(seq 1 48)'));
  assert.ok(workflowSource.includes('queued|review_required|definite_reject|expired'));
  assert.ok(workflowSource.includes('[[ "$terminal_state" != \'queued\' ]]'));
  assert.ok(workflowSource.includes('(.eligibilityState | IN("eligible", "ineligible"))'));
  assert.ok(
    workflowSource.includes(
      '[[ "$(jq -r \'.eligibilityState\' <<<"$eligibility_result")" != \'eligible\' ]]',
    ),
  );
  assert.ok(workflowSource.includes('.readOnly == true'));
  assert.ok(workflowSource.includes('.moneyMoved == false'));
  assert.ok(workflowSource.includes('.financialRowsCreated == false'));
});

test('stops at exactly one untouched queue item without enabling or invoking KemerBet', () => {
  for (const fragment of [
    '.observations == 1',
    '.outcomes == 1',
    '.reservations == 1',
    '.settlementReceipts == 1',
    '.settlementDocuments == 1',
    '.depositExecutionJobs == 1',
    '.queuedDepositJobs == 1',
    '.kemerBetLoginRoles == 0',
    '.kemerBetSessions == 0',
    '.executionEnabled == false',
  ]) {
    assert.ok(workflowSource.includes(fragment));
  }
  assert.doesNotMatch(workflowSource, /alter\s+role\s+fetanagent_deposit_executor/iu);
  assert.doesNotMatch(workflowSource, /update\s+app\.feature_switches/iu);
  assert.ok(!workflowSource.includes('production-runtime.yml'));
  assert.ok(!workflowSource.includes('fetanagent_deposit_executor_runtime='));
  assert.ok(!workflowSource.includes('verificationJobId'));
  assert.ok(!workflowSource.includes('sourceDocumentDigest'));
  assert.ok(!workflowSource.includes('transactionReference'));
});
