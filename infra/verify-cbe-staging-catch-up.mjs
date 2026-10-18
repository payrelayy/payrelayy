import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-cbe-migration-catch-up.yml'),
  'utf8',
);
const preflight = readFileSync(
  resolve(root, 'infra/sql/staging-cbe-reviewed-catch-up-preflight.sql'),
  'utf8',
);
const postflight = readFileSync(
  resolve(root, 'infra/sql/staging-cbe-post-catch-up-verification.sql'),
  'utf8',
);

function assertInOrder(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.ok(next > cursor, `Missing or out-of-order catch-up step: ${marker}`);
    cursor = next;
  }
}

assert.match(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|pull_request_target|schedule):/mu);
assert.match(workflow, /environment: staging/u);
assert.match(workflow, /group: supabase-staging-bootstrap/u);
assert.match(workflow, /actions: read/u);
assert.match(workflow, /contents: read/u);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /BACKUP_RUN_ID: '39131122213'/u);
assert.match(
  workflow,
  /BACKUP_CIPHERTEXT_SHA256: 7abbc7c5f432976d9d7ca855a956c26c371a54b0161c3fa613b5aebd44b3a3ad/u,
);
assert.match(workflow, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/u);
assert.match(workflow, /\[\[ "\$CONFIRMED_MAIN_COMMIT_SHA" == "\$GITHUB_SHA" \]\]/u);
assert.match(workflow, /APPLY 185 REVIEWED STAGING MIGRATIONS/u);
assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /PGSSLMODE=verify-full/u);
assert.match(
  workflow,
  /SUPABASE_CA_CERTIFICATE_PEM: \$\{\{ secrets\.SUPABASE_CA_CERTIFICATE_PEM \}\}/u,
);

assertInOrder(workflow, [
  'Reject any other branch, project, commit, or action',
  'environment: staging',
  'Verify exact checked-out commit',
  'Verify the reviewed encrypted backup is still available',
  'gh run download "$BACKUP_RUN_ID"',
  'sha256sum "$ciphertext"',
  'Set up the pinned Supabase CLI',
  'assert_sql_gate infra/sql/staging-cbe-reviewed-catch-up-preflight.sql pre-apply',
  'supabase link --project-ref "$STAGING_PROJECT_REF"',
  'supabase db push --linked --dry-run --include-all',
  'node infra/staging-migration-gap-guard.mjs cbe-catch-up',
  'assert_sql_gate infra/sql/staging-cbe-reviewed-catch-up-preflight.sql pre-apply',
  'supabase db push --linked --include-all --yes',
  'assert_sql_gate infra/sql/staging-cbe-post-catch-up-verification.sql post-apply',
]);

assert.match(
  preflight,
  /ledger_sha256 = 'e8299d777d05872f1cc6f2588ca3ca1d2eb15fe2c2e419970e63701149d74427'/u,
);
assert.match(preflight, /applied_migrations = 87/u);
assert.match(preflight, /disabled_switches = 7/u);
assert.match(preflight, /expired_shadow_role_locked/u);
assert.match(preflight, /matches_reviewed_catch_up_start/u);
assert.match(
  postflight,
  /ledger_sha256 = '239137ea9573030dfb5b2584b2ad8698ce4b05c90ac3e8a677cf4121d848ebd5'/u,
);
assert.match(postflight, /applied_migrations = 272/u);
assert.match(postflight, /disabled_switches = 7/u);
assert.match(postflight, /deposit_jobs = 0/u);
assert.match(postflight, /execution_attempts = 0/u);
assert.match(postflight, /matches_reviewed_post_catch_up_snapshot/u);

console.log(
  'CBE staging catch-up workflow verified: manual target, backup, exact plan, and no-money gates.',
);
