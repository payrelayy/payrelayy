import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  '.github/workflows/production-trusted-telebirr-verifier-standby.yml',
  'utf8',
);
const helper = readFileSync(
  'infra/operations/fetanagent-production-trusted-telebirr-verifier-standby-helper.sh',
  'utf8',
);
const sudoers = readFileSync(
  'infra/operations/fetanagent-production-trusted-telebirr-verifier-standby-helper.sudoers',
  'utf8',
);
const helperDigest = createHash('sha256').update(helper).digest('hex');

assert.match(workflow, /workflow_dispatch:/u);
assert.match(workflow, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/u);
assert.match(workflow, /"\$CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /STAGE AND SMOKE STANDBY VERIFIER - NO LIVE HANDOFF/u);
assert.match(workflow, /require-production-ci\.mjs/u);
assert.match(workflow, /--target trusted-telebirr-verifier/u);
assert.match(workflow, /--build-arg "VCS_REF=\$GITHUB_SHA"/u);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /StrictHostKeyChecking=yes/u);
assert.match(workflow, /sudo -n '\$helper' verify '\$helper_sha'/u);
assert.match(workflow, /sudo -n '\$helper' prepare '\$GITHUB_SHA' '\$archive_bytes'/u);
assert.match(workflow, /sudo -n '\$helper' stage-smoke '\$GITHUB_SHA' '\$archive_sha'/u);
assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD|SUPABASE_ACCESS_TOKEN|PIN_MANIFEST_BASE64/u);
assert.doesNotMatch(workflow, /activate-verification|start-activated|production-runtime\.yml/u);

assert.match(helper, /flock --nonblock 8/u);
assert.match(helper, /flock --nonblock 9/u);
assert.match(helper, /\[\[ "\$\{#matches\[@\]\}" -eq 1 \]\]/u);
assert.match(helper, /\[\[ "\$snapshot" =~/u);
assert.match(helper, /\|true\\\|healthy\$/u);
assert.match(helper, /chown --no-dereference root:root "\$incoming"/u);
assert.match(helper, /cp --no-dereference --reflink=never/u);
assert.match(helper, /sha256sum "\$sealed\/verifier-image\.tar"/u);
assert.match(helper, /--network none/u);
assert.match(helper, /FINANCIAL_ACTIONS_MODE=dry_run/u);
assert.match(helper, /INTERNAL_TRUSTED_TELEBIRR_VERIFIER_ENABLED=false/u);
assert.match(helper, /TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=false/u);
assert.match(helper, /FetanAgent trusted TeleBirr verifier failed closed\./u);
assert.match(helper, /"\$\(active_container\)" == "\$active_id"/u);
assert.match(helper, /"\$\(active_snapshot "\$active_id"\)" == "\$before"/u);
assert.doesNotMatch(helper, /docker compose (?:up|down)|docker container (?:stop|restart)/u);
assert.doesNotMatch(helper, /psql|postgresql:\/\/|SUPABASE_DB_PASSWORD|SUPABASE_ACCESS_TOKEN/u);

assert.match(sudoers, new RegExp(`sha256:${helperDigest}`, 'u'));
assert.match(
  sudoers,
  /\/usr\/local\/sbin\/fetanagent-production-trusted-telebirr-verifier-standby-helper verify \*/u,
);
assert.match(
  sudoers,
  /\/usr\/local\/sbin\/fetanagent-production-trusted-telebirr-verifier-standby-helper prepare \*/u,
);
assert.match(
  sudoers,
  /\/usr\/local\/sbin\/fetanagent-production-trusted-telebirr-verifier-standby-helper stage-smoke \*/u,
);
assert.match(
  sudoers,
  /\/usr\/local\/sbin\/fetanagent-production-trusted-telebirr-verifier-standby-helper cleanup \*/u,
);
assert.doesNotMatch(sudoers, /start-activated|emergency-stop|activate-verification/u);

console.log('Production standby verifier contract verified.');
