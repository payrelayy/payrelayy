import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowSource = await readFile(
  new URL(
    '../../.github/workflows/production-live-telebirr-network-binding-recovery.yml',
    import.meta.url,
  ),
  'utf8',
);

test('requires an exact main commit, production environment, CI, and explicit disabled-executor phrase', () => {
  assert.match(workflowSource, /environment: production/u);
  assert.ok(workflowSource.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(
    workflowSource.includes(
      '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$CONFIRMED_COMMIT" == "$GITHUB_SHA" ]]',
    ),
  );
  assert.ok(
    workflowSource.includes('RECOVER LIVE TELEBIRR NETWORK RETRY BINDING - KEMERBET DISABLED'),
  );
  assert.ok(workflowSource.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflowSource.includes('SUPABASE_CA_CERTIFICATE_PEM'));
  assert.ok(workflowSource.includes('PGSSLMODE: verify-full'));
});

test('uses only the reviewed recovery and redacted status SQL with a bounded terminal poll', () => {
  assert.ok(
    workflowSource.includes(
      '--file=infra/sql/production-live-telebirr-network-binding-recovery.sql',
    ),
  );
  assert.ok(
    workflowSource.includes('--file=infra/sql/production-live-telebirr-network-binding-status.sql'),
  );
  assert.ok(workflowSource.includes('for _ in $(seq 1 48)'));
  assert.ok(workflowSource.includes('queued|review_required|definite_reject|expired'));
  assert.ok(workflowSource.includes('[[ "$terminal_state" != \'queued\' ]]'));
});

test('never enables or invokes KemerBet and never emits protected identifiers', () => {
  assert.doesNotMatch(workflowSource, /alter role\s+fetanagent_deposit_executor/iu);
  assert.doesNotMatch(workflowSource, /update\s+app\.feature_switches/iu);
  assert.ok(!workflowSource.includes('verificationJobId'));
  assert.ok(!workflowSource.includes('recoveryRequestKey'));
  assert.ok(!workflowSource.includes('production-runtime.yml'));
  assert.ok(!workflowSource.includes('fetanagent_deposit_executor_runtime='));
});
