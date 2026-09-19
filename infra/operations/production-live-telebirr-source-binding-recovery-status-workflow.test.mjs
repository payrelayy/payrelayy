import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const [workflow, status] = await Promise.all(
  [
    '.github/workflows/production-live-telebirr-source-binding-recovery-status.yml',
    'infra/sql/production-live-telebirr-source-binding-recovery-status.sql',
  ].map((path) => readFile(new URL(path, root), 'utf8')),
);

test('requires reviewed main, protected production secrets, and exact read-only intent', () => {
  assert.match(workflow, /environment: production/u);
  assert.ok(workflow.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(workflow.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflow.includes('OBSERVE REVIEWED TELEBIRR SOURCE BINDING - READ ONLY'));
  assert.ok(workflow.includes('PGSSLMODE: verify-full'));
  assert.ok(workflow.includes('persist-credentials: false'));
});

test('uses the existing read-only status query and publishes only redacted facts', () => {
  assert.ok(
    workflow.includes('infra/sql/production-live-telebirr-source-binding-recovery-status.sql'),
  );
  for (const fragment of [
    'verificationState',
    'outcomeReasonCode',
    'assignmentDeliveries',
    'sourceBindingRetryClosures',
    'authorityConsumptions',
    'queuedDepositJobs',
    'trustedVerifierSessions',
    'financialSwitchesDisabled',
    'kemerBetLoginRoles',
    'executionEnabled',
    'readOnly',
    'moneyMoved',
  ]) {
    assert.ok(workflow.includes(fragment));
  }
  assert.ok(status.includes('begin transaction isolation level read committed read only;'));
  assert.ok(status.includes("'readOnly', true"));
  assert.ok(status.includes("'moneyMoved', false"));
  assert.ok(!status.includes("'verificationJobId',"));
  assert.ok(!status.includes("'retryRequestKey',"));
  assert.ok(!status.includes("'sourceDocumentDigest',"));
});

test('cannot mutate production or enable any financial path', () => {
  for (const source of [workflow, status]) {
    assert.doesNotMatch(source, /\b(?:insert|update|delete|truncate)\s+(?:into\s+)?app\./iu);
    assert.doesNotMatch(source, /alter\s+role/iu);
  }
  assert.ok(workflow.includes('.financialSwitchesLive == 0'));
  assert.ok(workflow.includes('.financialSwitchesDisabled == 7'));
  assert.ok(workflow.includes('.kemerBetLoginRoles == 0'));
  assert.ok(workflow.includes('.kemerBetSessions == 0'));
  assert.ok(workflow.includes('.executionEnabled == false'));
});

test('publishes the redacted snapshot before enforcing the safety boundary', () => {
  const publish = workflow.indexOf('printf \'%s\\n\' "$redacted_result"');
  const safety = workflow.indexOf('.financialSwitchesDisabled == 7', publish);
  assert.notEqual(publish, -1);
  assert.ok(safety > publish);
  assert.ok(!workflow.includes('tee -a "$GITHUB_STEP_SUMMARY" <<<"$observer_result"'));
});
