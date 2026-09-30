import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(
  new URL('./prepare-windows-companion-one-job-local.ps1', import.meta.url),
  'utf8',
);

test('prepares only an empty activation handoff directory after the no-write plan exit', () => {
  const enrollment = source.indexOf(
    "OrdinaryFile (Join-Path $dataRoot 'device\\companion-primary.enrollment.json')",
  );
  const handoff = source.indexOf("$handoffDirectory = Join-Path $dataRoot 'execution-v2'");
  const planExit = source.indexOf('if ($PlanOnly) {');
  const create = source.indexOf(
    'New-Item -ItemType Directory -Path $handoffDirectory -ErrorAction Stop',
  );
  const reviewedCopy = source.indexOf("$stage = 'reviewed_copy'");
  assert.ok(enrollment >= 0 && enrollment < handoff);
  assert.ok(handoff < planExit && planExit < create && create < reviewedCopy);
  assert.match(
    source,
    /if \(-not \$createHandoffDirectory\) \{\s*\$null = OrdinaryDirectory \$handoffDirectory;?/u,
  );
  assert.match(source, /Get-ChildItem -LiteralPath \$handoffDirectory -Force\)\.Count -ne 0/u);
  assert.match(
    source,
    /\$stage = 'activation_directory'[\s\S]*?\$null = OrdinaryDirectory \$handoffDirectory/u,
  );
  assert.match(
    source,
    /if \(\$PlanOnly\) \{\s*'ONE_JOB_LOCAL_PLAN_READY; no files changed\.'\s*exit 0\s*\}/u,
  );
});
