import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/production-companion-operator-session.yml', import.meta.url),
  'utf8',
);

test('generates a fresh private one-use activation key for each protected session', () => {
  const generatedKey = workflow.indexOf("stage='one_use_request_key'");
  const preparation = workflow.indexOf("stage='one_use_request_preparation'");
  const stopBoundary = workflow.indexOf('preparation_started=1');

  assert.ok(generatedKey >= 0);
  assert.ok(generatedKey < preparation);
  assert.ok(preparation < stopBoundary);
  assert.match(
    workflow,
    /node -e 'process\.stdout\.write\(require\("node:crypto"\)\.randomUUID\(\)\)'/u,
  );
  assert.match(workflow, /export PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY/u);
  assert.doesNotMatch(workflow, /secrets\.PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY/u);
  assert.doesNotMatch(workflow, /echo[^\n]*PRODUCTION_COMPANION_EXECUTION_REQUEST_KEY/u);
});

test('retains independent emergency revocation after request preparation begins', () => {
  assert.match(workflow, /if \[\[ "\$preparation_started" == 1 \]\]; then/u);
  assert.match(workflow, /production-companion-execution-emergency-disable\.sql/u);
  assert.match(workflow, /node infra\/operations\/require-production-ci\.mjs/u);
});
