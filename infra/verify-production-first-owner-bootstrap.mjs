import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/production-first-owner-bootstrap.yml'),
  'utf8',
);
const inspectSql = readFileSync(
  resolve(root, 'infra/sql/production-first-owner-inspect.sql'),
  'utf8',
);
const bootstrapSql = readFileSync(
  resolve(root, 'infra/sql/production-first-owner-bootstrap.sql'),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/u);
assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/u);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/u);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/u);
assert.match(workflow, /PRODUCTION_POOLER_HOST: aws-0-eu-west-1\.pooler\.supabase\.com/u);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/u);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA.*GITHUB_SHA/su);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /bootstrap-first-production-owner/gu);
assert.match(workflow, /SUPABASE_DB_PASSWORD/u);
assert.match(workflow, /SUPABASE_CA_CERTIFICATE_PEM/u);
assert.match(workflow, /postgres\.\$\{\{ env\.PRODUCTION_PROJECT_REF \}\}/u);
assert.match(workflow, /PGSSLMODE: verify-full/gu);
assert.match(workflow, /PGSSLROOTCERT:/gu);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /if: inputs\.mode == 'bootstrap'/u);
assert.ok(
  workflow.indexOf('production-first-owner-inspect.sql') <
    workflow.indexOf('production-first-owner-bootstrap.sql'),
  'The read-only eligibility inspection must run before the production mutation.',
);
assert.doesNotMatch(
  workflow,
  /SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE|service_role|password_auth|email_address|display_name/iu,
);

assert.match(inspectSql, /begin transaction isolation level serializable read only;/u);
assert.match(inspectSql, /email_confirmed_at is not null/u);
assert.match(inspectSql, /count\(\*\) = 0 as active_owner_absent/u);
assert.match(inspectSql, /procedure\.prosecdef/u);
assert.match(inspectSql, /pg_catalog\.aclexplode/u);
assert.equal(
  (inspectSql.match(/select 1 \/ 0 as rejected;/gu) ?? []).length,
  4,
  'Every failed production inspection branch must stop psql under ON_ERROR_STOP.',
);
assert.match(inspectSql, /rollback;/u);
assert.doesNotMatch(inspectSql, /\\q(?:uit)?\b/u);
assert.doesNotMatch(inspectSql, /\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/iu);

assert.match(bootstrapSql, /begin transaction isolation level serializable;/u);
assert.match(bootstrapSql, /fetanagent:production:first-owner-bootstrap/u);
assert.match(bootstrapSql, /pg_catalog\.pg_advisory_xact_lock/u);
assert.match(
  bootstrapSql,
  /select app\.bootstrap_first_owner\(:'owner_auth_user_id'::uuid, null\) as new_admin_id/u,
);
assert.match(bootstrapSql, /count\(\*\) = 1 as bootstrap_audit_recorded/u);
assert.equal(
  (bootstrapSql.match(/select 1 \/ 0 as rejected;/gu) ?? []).length,
  4,
  'Every failed production bootstrap branch must stop psql and roll back.',
);
assert.match(bootstrapSql, /commit;/u);
assert.doesNotMatch(bootstrapSql, /\\q(?:uit)?\b/u);
assert.doesNotMatch(bootstrapSql, /\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/iu);

console.log(
  'production first-Owner bootstrap verified: manual exact-target workflow, read-only inspection, private audited one-time mutation',
);
