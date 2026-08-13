import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/supabase-staging-bootstrap.yml'),
  'utf8',
);
const readme = readFileSync(resolve(root, 'supabase/README.md'), 'utf8');
const transitionRunbook = readFileSync(
  resolve(root, 'infra/operations/fetanagent-vm-transition.md'),
  'utf8',
);

const assertInOrder = (source, needles, message) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${needle}`);
    assert.ok(next > cursor, message);
    cursor = next;
  }
};

const validateTarget = /jobs:\s+validate-target:([\s\S]*?)\n  staging-migrations:/u.exec(
  workflow,
)?.[1];
assert.ok(validateTarget, 'The workflow must validate its target before the protected job.');

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s+contents: read/);
assert.match(
  workflow,
  /confirm_main_commit_sha:\s+description:[^\n]+\s+required: true\s+type: string/u,
);
assert.match(
  validateTarget,
  /CONFIRMED_MAIN_COMMIT_SHA: \$\{\{ inputs\.confirm_main_commit_sha \}\}/,
);
assert.doesNotMatch(validateTarget, /environment:|secrets\./);
assertInOrder(
  validateTarget,
  [
    `GITHUB_REF" != 'refs/heads/main'`,
    `REQUESTED_MODE" != 'plan'`,
    `STAGING_PROJECT_REF" == "$PRODUCTION_PROJECT_REF`,
    `CONFIRMED_STAGING_PROJECT_REF" != "$STAGING_PROJECT_REF`,
    `CONFIRMED_STAGING_PROJECT_REF" == "$PRODUCTION_PROJECT_REF`,
    `CONFIRMED_MAIN_COMMIT_SHA" =~ ^[0-9a-f]{40}$`,
    `CONFIRMED_MAIN_COMMIT_SHA" != "$GITHUB_SHA`,
  ],
  'Branch, mode, project, production, and exact-commit checks must stay ordered before protected work',
);
assert.match(validateTarget, /The confirmed commit does not match the exact workflow commit\./);

const protectedJob = /\n  staging-migrations:([\s\S]*)$/u.exec(workflow)?.[1];
assert.ok(protectedJob, 'The protected migration job must exist.');
assert.match(protectedJob, /needs: validate-target/);
assert.match(protectedJob, /environment: staging/);
assert.match(protectedJob, /uses: actions\/checkout@[0-9a-f]{40}/);
assert.match(protectedJob, /ref: \$\{\{ github\.sha \}\}/);
assert.match(protectedJob, /persist-credentials: false/);
assertInOrder(
  protectedJob,
  [
    'Verify exact checked-out commit',
    `git rev-parse HEAD)" != "$GITHUB_SHA`,
    'Verify tooling and staging credentials',
    'Link only the staging project',
    'supabase migration list --linked',
    'supabase db push --linked --dry-run',
    "if: inputs.mode == 'apply'",
    'supabase db push --linked --yes',
  ],
  'Commit verification and dry-run must precede credentials, linking, and conditional apply',
);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.doesNotMatch(workflow, /service[_-]?role|seed\.sql|telegram|payment/i);

for (const document of [readme, transitionRunbook]) {
  assert.match(document, /confirm_main_commit_sha/);
  assert.match(document, /same full SHA/i);
}

console.log(
  'Supabase staging bootstrap verified: manual staging-only dispatch, exact commit binding, checked-out SHA verification, and dry-run before apply',
);
