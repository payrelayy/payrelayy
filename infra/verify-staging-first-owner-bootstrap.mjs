import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-first-owner-bootstrap.yml'),
  'utf8',
);
const inspectSql = readFileSync(resolve(root, 'infra/sql/staging-first-owner-inspect.sql'), 'utf8');
const bootstrapSql = readFileSync(
  resolve(root, 'infra/sql/staging-first-owner-bootstrap.sql'),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA.*GITHUB_SHA/s);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /bootstrap-first-staging-owner/g);
assert.match(workflow, /SUPABASE_DB_PASSWORD/);
assert.match(workflow, /SUPABASE_CA_CERTIFICATE_PEM/);
assert.match(workflow, /postgres\.\$\{\{ env\.STAGING_PROJECT_REF \}\}/);
assert.match(workflow, /PGSSLMODE: verify-full/g);
assert.match(workflow, /PGSSLROOTCERT:/g);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /if: inputs\.mode == 'bootstrap'/);
assert.ok(
  workflow.indexOf('staging-first-owner-inspect.sql') <
    workflow.indexOf('staging-first-owner-bootstrap.sql'),
  'The read-only eligibility inspection must run before the mutating bootstrap.',
);
assert.doesNotMatch(
  workflow,
  /SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE|service_role|password_auth|email_address|display_name/i,
);

assert.match(inspectSql, /begin transaction isolation level serializable read only;/);
assert.match(inspectSql, /email_confirmed_at is not null/);
assert.match(inspectSql, /count\(\*\) = 0 as active_owner_absent/);
assert.match(inspectSql, /procedure\.prosecdef/);
assert.match(inspectSql, /pg_catalog\.aclexplode/);
assert.equal(
  (inspectSql.match(/select 1 \/ 0 as rejected;/g) ?? []).length,
  4,
  'Every failed inspection branch must stop psql under ON_ERROR_STOP.',
);
assert.match(inspectSql, /rollback;/);
assert.doesNotMatch(inspectSql, /\\q(?:uit)?\b/);
assert.doesNotMatch(inspectSql, /\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/i);

assert.match(bootstrapSql, /begin transaction isolation level serializable;/);
assert.match(bootstrapSql, /pg_catalog\.pg_advisory_xact_lock/);
assert.match(
  bootstrapSql,
  /select app\.bootstrap_first_owner\(:'owner_auth_user_id'::uuid, null\) as new_admin_id/,
);
assert.match(bootstrapSql, /count\(\*\) = 1 as bootstrap_audit_recorded/);
assert.equal(
  (bootstrapSql.match(/select 1 \/ 0 as rejected;/g) ?? []).length,
  4,
  'Every failed bootstrap branch must stop psql and roll back.',
);
assert.match(bootstrapSql, /commit;/);
assert.doesNotMatch(bootstrapSql, /\\q(?:uit)?\b/);
assert.doesNotMatch(bootstrapSql, /\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/i);

console.log(
  'staging first-Owner bootstrap verified: manual exact-target workflow, read-only inspection, private audited one-time mutation',
);
