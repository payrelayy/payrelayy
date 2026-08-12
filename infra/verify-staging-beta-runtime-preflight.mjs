import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(workspace, '.github/workflows/staging-beta-runtime-preflight.yml'),
  'utf8',
);
const inspectSql = readFileSync(
  resolve(workspace, 'infra/sql/staging-beta-runtime-inspect.sql'),
  'utf8',
);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|push:|schedule:/);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_MAIN_COMMIT_SHA" != "\$GITHUB_SHA"/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_POOLER_HOST: aws-1-eu-west-1\.pooler\.supabase\.com/);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.STAGING_PROJECT_REF \}\}/);
assert.match(workflow, /PGSSLMODE: verify-full/);
assert.match(workflow, /run: psql -X --file=infra\/sql\/staging-beta-runtime-inspect\.sql/);
assert.doesNotMatch(
  workflow,
  /provision-and-preflight|BETA_ADMISSION_RUNTIME_PASSWORD|BOT_TO_BETA_ADMISSION_HMAC_SECRET|BETA_ADMISSION_PAYLOAD_HMAC_SECRET|pnpm |db:preflight|staging-beta-runtime-provision|staging-beta-runtime-disable|sleep 125/,
);
assert.doesNotMatch(
  workflow,
  /TELEGRAM_BOT_TOKEN|docker compose|docker run|compose up|FINANCIAL_ACTIONS_MODE=live/,
);

assert.match(inspectSql, /payreplayy_beta_admission_runtime/);
assert.match(inspectSql, /not role\.rolsuper/);
assert.match(inspectSql, /role\.rolconnlimit <> 1/);
assert.match(inspectSql, /membership\.inherit_option/);
assert.match(inspectSql, /not membership\.set_option/);
assert.match(inspectSql, /not membership\.admin_option/);
assert.doesNotMatch(inspectSql, /service_role|payreplayy_api_runtime|payreplayy_worker|kemerbet/i);

console.log('Staging beta runtime workflow verified as read-only role inspection only.');
