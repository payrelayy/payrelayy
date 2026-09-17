import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowSource = await readFile(
  new URL(
    '../../.github/workflows/production-live-telebirr-network-binding-observe.yml',
    import.meta.url,
  ),
  'utf8',
);

test('requires an exact passing main commit and protected production environment', () => {
  assert.match(workflowSource, /environment: production/u);
  assert.ok(workflowSource.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(
    workflowSource.includes(
      '[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$CONFIRMED_COMMIT" == "$GITHUB_SHA" ]]',
    ),
  );
  assert.ok(workflowSource.includes('OBSERVE LIVE TELEBIRR NETWORK RETRY BINDING - READ ONLY'));
  assert.ok(workflowSource.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflowSource.includes('SUPABASE_CA_CERTIFICATE_PEM'));
  assert.ok(workflowSource.includes('PGSSLMODE: verify-full'));
});

test('invokes only the redacted read-only observer and emits its bounded result', () => {
  assert.ok(
    workflowSource.includes(
      '--file=infra/sql/production-live-telebirr-network-binding-observe.sql',
    ),
  );
  assert.ok(workflowSource.includes('.verificationState | IN('));
  assert.ok(workflowSource.includes('"invalid"'));
  assert.ok(workflowSource.includes('.readOnly == true'));
  assert.ok(workflowSource.includes('.moneyMoved == false'));
  assert.ok(workflowSource.includes('tee -a "$GITHUB_STEP_SUMMARY"'));
});

test('takes no protected identifier inputs and never enables or invokes KemerBet', () => {
  for (const protectedInput of [
    'confirm_production_project_ref',
    'confirm_pilot_revision_id',
    'confirm_activation_epoch',
    'confirm_recovery_request_key',
  ]) {
    assert.ok(!workflowSource.includes(protectedInput));
  }
  assert.doesNotMatch(workflowSource, /alter role\s+fetanagent_deposit_executor/iu);
  assert.doesNotMatch(workflowSource, /update\s+app\.feature_switches/iu);
  assert.ok(!workflowSource.includes('verificationJobId'));
  assert.ok(!workflowSource.includes('recoveryRequestKey'));
  assert.ok(!workflowSource.includes('production-runtime.yml'));
});
