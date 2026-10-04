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

test('selects the diagnostic companion release without adding an automatic session trigger', () => {
  assert.match(workflow, /PRODUCTION_COMPANION_RELEASE_TAG: windows-companion-v0\.1\.21/u);
  assert.match(
    workflow,
    /PRODUCTION_OPERATOR_IMAGE_REVISION: a10b597547db6b556453401fe921512ad84ff964/u,
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_run):/mu);
  assert.match(workflow, /OPEN ONE OWNER-APPROVED COMPANION SESSION/u);
});

test('startup diagnostic selects the same reviewed release as the dormant session', async () => {
  const selected = workflow.match(
    /PRODUCTION_COMPANION_RELEASE_TAG: (windows-companion-v\d+\.\d+\.\d+)/u,
  )?.[1];
  assert.ok(selected);
  for (const filename of ['production-companion-operator-host-startup-diagnostic.yml']) {
    const diagnostic = await readFile(
      new URL(`../../.github/workflows/${filename}`, import.meta.url),
      'utf8',
    );
    assert.equal(
      diagnostic.match(
        /PRODUCTION_COMPANION_RELEASE_TAG: (windows-companion-v\d+\.\d+\.\d+)/u,
      )?.[1],
      selected,
    );
    assert.match(diagnostic, /workflow_dispatch:/u);
    assert.doesNotMatch(diagnostic, /^  (?:push|pull_request|schedule|workflow_run):/mu);
  }
});
