import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const workflow = await readFile(
  new URL('.github/workflows/production-companion-operator-host-status.yml', root),
  'utf8',
);

test('inspects only exact passing main and the pinned dormant host image', () => {
  assert.ok(workflow.includes('[[ "$GITHUB_REF" == \'refs/heads/main\' ]]'));
  assert.ok(workflow.includes('node infra/operations/require-production-ci.mjs'));
  assert.ok(workflow.includes('INSPECT DORMANT COMPANION OPERATOR HOST'));
  assert.ok(workflow.includes('PRODUCTION_OPERATOR_IMAGE_REVISION: ([0-9a-f]{40})'));
  assert.ok(workflow.includes('fetanagent-production-operator-host-launch inspect'));
  assert.ok(workflow.includes('protected_operator_image_ready_dormant'));
  assert.ok(workflow.includes('persist-credentials: false'));
});

test('uses pinned SSH identity and cannot create an operator or financial session', () => {
  for (const fragment of [
    'BatchMode=yes',
    'IdentitiesOnly=yes',
    'StrictHostKeyChecking=yes',
    'UserKnownHostsFile=',
    'ssh-keygen -F',
    'rm -f -- "$protected/deploy-key" "$protected/known-hosts"',
  ]) {
    assert.ok(workflow.includes(fragment));
  }
  assert.doesNotMatch(workflow, /PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY/u);
  assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD/u);
  assert.doesNotMatch(workflow, /\b(?:prepare|run|stop)\s+'?\$revision/u);
  assert.doesNotMatch(workflow, /\b(?:insert|update|delete|truncate)\s+(?:into\s+)?app\./iu);
});

test('classifies a failed dormant check without restarting or stopping the host', () => {
  for (const fragment of [
    'operator_listener=listening',
    'operator_listener=closed',
    'docker_service=active',
    'docker_service=not_active',
    'operator_container=present',
    'operator_container=absent',
    'launcher_file=exact',
    'The protected operator host is not proven dormant',
  ]) {
    assert.ok(workflow.includes(fragment));
  }
  assert.doesNotMatch(
    workflow,
    /fetanagent-production-operator-host-launch (?:run|stop|diagnose)/u,
  );
  assert.doesNotMatch(workflow, /docker (?:run|start|stop|rm|rmi)\b/u);
});
