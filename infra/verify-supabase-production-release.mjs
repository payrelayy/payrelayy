import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/supabase-production-release.yml'),
  'utf8',
);
const readme = readFileSync(resolve(root, 'supabase/README.md'), 'utf8');

const assertInOrder = (source, needles, message) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${needle}`);
    assert.ok(next > cursor, message);
    cursor = next;
  }
};

const validateTarget = /jobs:\s+validate-target:([\s\S]*?)\n  production-migrations:/u.exec(
  workflow,
)?.[1];
assert.ok(validateTarget, 'The workflow must validate its target before the protected job.');

assert.match(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/u);
assert.match(workflow, /permissions:\s+contents: read/u);
assert.doesNotMatch(workflow, /\bdry-run\b|inputs\.mode|\bplan\b/u);
assert.match(
  workflow,
  /confirm_production_apply:\s+description: Type APPLY PRODUCTION MIGRATIONS[^\n]*\s+required: true\s+type: string/u,
);
assert.doesNotMatch(validateTarget, /environment:|secrets\./u);
assertInOrder(
  validateTarget,
  [
    `GITHUB_REF\" != 'refs/heads/main'`,
    `STAGING_PROJECT_REF\" == \"$PRODUCTION_PROJECT_REF`,
    `CONFIRMED_PRODUCTION_PROJECT_REF\" != \"$PRODUCTION_PROJECT_REF`,
    `CONFIRMED_PRODUCTION_PROJECT_REF\" == \"$STAGING_PROJECT_REF`,
    `CONFIRMED_MAIN_COMMIT_SHA\" =~ ^[0-9a-f]{40}$`,
    `CONFIRMED_MAIN_COMMIT_SHA\" != \"$GITHUB_SHA`,
    `CONFIRMED_PRODUCTION_APPLY\" != 'APPLY PRODUCTION MIGRATIONS'`,
  ],
  'Branch, target separation, exact commit, and explicit apply checks must stay ordered',
);

const protectedJob = /\n  production-migrations:([\s\S]*)$/u.exec(workflow)?.[1];
assert.ok(protectedJob, 'The protected production migration job must exist.');
assert.match(protectedJob, /needs: validate-target/u);
assert.match(protectedJob, /environment: production/u);
assert.match(protectedJob, /uses: actions\/checkout@[0-9a-f]{40}/u);
assert.match(protectedJob, /ref: \$\{\{ github\.sha \}\}/u);
assert.match(protectedJob, /persist-credentials: false/u);
assertInOrder(
  protectedJob,
  [
    'Verify exact checked-out commit',
    `git rev-parse HEAD)\" != \"$GITHUB_SHA`,
    'Verify tooling and production credentials',
    'Link only the production project',
    'Verify the linked production target',
    'Apply canonical migrations to production',
    'supabase migration list --linked',
    'supabase db push --linked --yes',
    'supabase migration list --linked',
  ],
  'Commit verification, credential validation, exact linking, and canonical apply must stay ordered',
);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(protectedJob, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/u);
assert.match(protectedJob, /SUPABASE_DB_PASSWORD: \$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/u);
assert.doesNotMatch(workflow, /service[_-]?role|seed\.sql|telegram|payment/u);

assert.match(readme, /## Production database release/u);
assert.match(readme, /confirm_production_project_ref/u);
assert.match(readme, /confirm_main_commit_sha/u);
assert.match(readme, /APPLY PRODUCTION MIGRATIONS/u);
assert.match(readme, /does not enable financial execution/u);

console.log(
  'Supabase production release verified: manual production-only dispatch, exact target and commit binding, protected credentials, and canonical apply without a staging or dry-run mode',
);
