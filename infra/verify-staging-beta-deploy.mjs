import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-beta-deploy-smoke.yml'),
  'utf8',
);
const qualityWorkflow = readFileSync(resolve(root, '.github/workflows/quality.yml'), 'utf8');
const compose = readFileSync(resolve(root, 'infra/compose.staging-beta.yaml'), 'utf8');
const stagingRunbook = readFileSync(resolve(root, 'infra/staging-beta.md'), 'utf8');
const provision = readFileSync(
  resolve(root, 'infra/sql/staging-runtimes-provision-for-deploy.sql'),
  'utf8',
);
const disable = readFileSync(resolve(root, 'infra/sql/staging-runtimes-disable.sql'), 'utf8');
const diagnostics = readFileSync(
  resolve(root, 'infra/sql/staging-runtime-session-diagnostics.sql'),
  'utf8',
);
const helper = readFileSync(
  resolve(root, 'infra/operations/fetanagent-staging-deploy-helper.sh'),
  'utf8',
);
const legacyBrand = 'pay' + 'replayy';
const legacyAdmin = `${legacyBrand}-admin`;
const legacyHelper = `/usr/local/sbin/${legacyBrand}-staging-deploy-helper`;
const legacyHelperSha = '4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69';
const retiredDepositReferenceProtection = new RegExp(
  ['api', 'deposit', 'reference', 'protection'].join('[_-]'),
  'iu',
);

for (const artifact of [workflow, qualityWorkflow, compose, helper, stagingRunbook]) {
  assert.doesNotMatch(
    artifact,
    retiredDepositReferenceProtection,
    'the retired single-key deposit-reference input must remain absent',
  );
}

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_DROPLET_ID: '590666364'/);
assert.match(workflow, /STAGING_DIRECT_DATABASE_HOST: db\.spzpiyxheappsfyswewl\.supabase\.co/);
assert.match(workflow, /GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(workflow, /CONFIRMED_COMMIT.*GITHUB_SHA/);
assert.match(workflow, /CONFIRMED_PROJECT.*STAGING_PROJECT_REF/);
assert.match(workflow, /CONFIRMED_DROPLET.*STAGING_DROPLET_ID/);
assert.match(workflow, /^\s+- transition-ssh-verify$/m);
assert.match(workflow, /^\s+- transition-stop-legacy$/m);
assert.match(workflow, /stop-legacy-staging-runtime/);
assert.match(
  workflow,
  /\^\(plan\|transition-ssh-verify\|transition-stop-legacy\|unban-and-connectivity-check\|deploy-and-smoke\|stop-and-disable\)\$/,
);
assert.match(workflow, /environment: staging/g);
assert.match(workflow, /fetanagent-admin@/g);
assert.doesNotMatch(
  workflow,
  /root@|ssh-keyscan|StrictHostKeyChecking=no|sudo -n (?:docker|bash)|docker\.sock/,
);
assert.match(workflow, /StrictHostKeyChecking=yes/g);
assert.match(workflow, /UserKnownHostsFile=/g);
assert.match(workflow, /fetanagent-staging-deploy-helper verify/g);
assert.match(workflow, /fetanagent-staging-deploy-helper install/g);
assert.match(workflow, /fetanagent-staging-deploy-helper start/g);
assert.match(workflow, /fetanagent-staging-deploy-helper network-ready/g);
assert.match(workflow, /fetanagent-staging-deploy-helper diagnose-owner-startup/g);
assert.match(workflow, /fetanagent-staging-deploy-helper stop/g);
assert.match(workflow, /fetanagent-staging-deploy-helper discard/g);
assert.match(workflow, /sha256sum infra\/operations\/fetanagent-staging-deploy-helper\.sh/g);
assert.match(workflow, /persist-credentials: false/g);

const legacyStopInput = /\n      confirm_legacy_stop:\n([\s\S]*?)\n\npermissions:/u.exec(
  workflow,
)?.[1];
assert.ok(legacyStopInput, 'The legacy-stop confirmation input must exist.');
assert.match(legacyStopInput, /^\s*required: false$/m);
assert.match(legacyStopInput, /^\s*default: ''$/m);
assert.doesNotMatch(legacyStopInput, /^\s*required: true$/m);

const validateTarget = /\n  validate-target:\n([\s\S]*?)\n  build:\n/u.exec(workflow)?.[1];
assert.ok(validateTarget, 'The exact-target validation job must exist.');
assert.match(validateTarget, /CONFIRMED_LEGACY_STOP: \$\{\{ inputs\.confirm_legacy_stop \}\}/);
assert.match(
  validateTarget,
  /if \[\[ "\$REQUESTED_MODE" == 'transition-stop-legacy' \]\]; then\s+\[\[ "\$CONFIRMED_LEGACY_STOP" == 'stop-legacy-staging-runtime' \]\]\s+fi/u,
);

const transitionSshVerify =
  /\n  transition-ssh-verify:\n([\s\S]*?)\n  transition-stop-legacy:\n/u.exec(workflow)?.[1];
assert.ok(
  transitionSshVerify,
  'The permanent read-only transition SSH verification job must exist.',
);
assert.equal(
  createHash('sha256').update(transitionSshVerify).digest('hex'),
  'd24537ae9f6a7d7640a6991ff8a09c27eb8424202640af94bcec701bab01984e',
  'The reviewed read-only transition SSH job body must remain byte-for-byte exact.',
);
assert.match(transitionSshVerify, /if: inputs\.mode == 'transition-ssh-verify'/);
assert.match(transitionSshVerify, /needs: validate-target/);
assert.match(transitionSshVerify, /environment: staging/);
assert.match(transitionSshVerify, /contents: read/);
assert.match(transitionSshVerify, /persist-credentials: false/);
assert.match(transitionSshVerify, /GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(transitionSshVerify, /CONFIRMED_COMMIT" == "\$GITHUB_SHA/);
assert.match(transitionSshVerify, /git rev-parse HEAD/);
assert.match(transitionSshVerify, /CONFIRMED_PROJECT" == "\$STAGING_PROJECT_REF/);
assert.match(transitionSshVerify, /CONFIRMED_PROJECT" != "\$PRODUCTION_PROJECT_REF/);
assert.match(transitionSshVerify, /CONFIRMED_DROPLET" == "\$STAGING_DROPLET_ID/);
assert.match(transitionSshVerify, /REQUESTED_MODE" == 'transition-ssh-verify'/);
assert.match(transitionSshVerify, /STAGING_VM_HOST: \$\{\{ secrets\.STAGING_VM_HOST \}\}/);
assert.match(
  transitionSshVerify,
  /STAGING_VM_KNOWN_HOSTS: \$\{\{ secrets\.STAGING_VM_KNOWN_HOSTS \}\}/,
);
assert.match(
  transitionSshVerify,
  /STAGING_VM_SSH_PRIVATE_KEY: \$\{\{ secrets\.STAGING_VM_SSH_PRIVATE_KEY \}\}/,
);
assert.equal(
  (transitionSshVerify.match(/\$\{\{ secrets\./g) ?? []).length,
  3,
  'The read-only transition SSH job may receive only the three protected VM SSH inputs.',
);
assert.match(
  transitionSshVerify,
  /sha256sum infra\/operations\/fetanagent-staging-deploy-helper\.sh/,
);
assert.match(transitionSshVerify, /ssh-keygen -F "\$STAGING_VM_HOST"/);
assert.match(transitionSshVerify, /BatchMode=yes/);
assert.match(transitionSshVerify, /ClearAllForwardings=yes/);
assert.match(transitionSshVerify, /IdentitiesOnly=yes/);
assert.match(transitionSshVerify, /RequestTTY=no/);
assert.match(transitionSshVerify, /StrictHostKeyChecking=yes/);
assert.match(transitionSshVerify, /UserKnownHostsFile=/);
assert.equal(
  (transitionSshVerify.match(/^\s*ssh\s/gm) ?? []).length,
  1,
  'The transition SSH verification job may execute SSH exactly once.',
);
assert.match(transitionSshVerify, /test \\"\\\$\(id -u\)\\" -ne 0/);
assert.match(transitionSshVerify, /test \\"\\\$\(id -un\)\\" = 'fetanagent-admin'/);
assert.equal(
  (transitionSshVerify.match(/sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper/g) ?? [])
    .length,
  1,
  'The transition SSH verification job may cross the sudo boundary exactly once.',
);
assert.match(
  transitionSshVerify,
  /sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper verify '\$helper_sha'/,
);
const transitionRemoteCommand = transitionSshVerify
  .split(/\r?\n/u)
  .find((line) => line.includes('remote_command='));
assert.ok(transitionRemoteCommand, 'The transition SSH verification command must be explicit.');
assert.equal(
  transitionRemoteCommand.trim(),
  String.raw`remote_command="test \"\$(id -u)\" -ne 0 && test \"\$(id -un)\" = 'fetanagent-admin' && sudo -n /usr/local/sbin/fetanagent-staging-deploy-helper verify '$helper_sha'"`,
  'The remote command must remain the exact non-root and checksum-only proof.',
);
assert.doesNotMatch(
  transitionSshVerify,
  /\bpsql\b|\bsupabase\b|\bdocker\b|\bcompose\b|\bscp\b|\bcurl\b|\bwget\b|staging-runtimes|fetanagent-staging-deploy-helper (?:stop|discard|install|start|cutover-ready|network-ready|diagnose-owner-startup)/,
);

const transitionStopLegacy = /\n  transition-stop-legacy:\n([\s\S]*?)\n  deploy:\n/u.exec(
  workflow,
)?.[1];
assert.ok(transitionStopLegacy, 'The guarded legacy-stop transition job must exist.');
assert.equal(
  createHash('sha256').update(transitionStopLegacy).digest('hex'),
  'f0ad7ed8cd313c48722de46bde8d446b6e71d56541c1940f17c67d7405c8c56d',
  'The reviewed legacy-stop transition job body must remain byte-for-byte exact.',
);
assert.match(transitionStopLegacy, /if: inputs\.mode == 'transition-stop-legacy'/);
assert.match(transitionStopLegacy, /needs: validate-target/);
assert.match(transitionStopLegacy, /environment: staging/);
assert.match(transitionStopLegacy, /contents: read/);
assert.match(transitionStopLegacy, /persist-credentials: false/);
assert.match(transitionStopLegacy, /ref: \$\{\{ github\.sha \}\}/);
assert.match(transitionStopLegacy, /GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(transitionStopLegacy, /CONFIRMED_COMMIT" == "\$GITHUB_SHA/);
assert.match(transitionStopLegacy, /git rev-parse HEAD/);
assert.match(transitionStopLegacy, /CONFIRMED_PROJECT" == "\$STAGING_PROJECT_REF/);
assert.match(transitionStopLegacy, /CONFIRMED_PROJECT" != "\$PRODUCTION_PROJECT_REF/);
assert.match(transitionStopLegacy, /CONFIRMED_DROPLET" == "\$STAGING_DROPLET_ID/);
assert.match(transitionStopLegacy, /REQUESTED_MODE" == 'transition-stop-legacy'/);
assert.match(transitionStopLegacy, /CONFIRMED_LEGACY_STOP" == 'stop-legacy-staging-runtime'/);
assert.match(transitionStopLegacy, /STAGING_VM_HOST: \$\{\{ secrets\.STAGING_VM_HOST \}\}/);
assert.match(
  transitionStopLegacy,
  /STAGING_VM_KNOWN_HOSTS: \$\{\{ secrets\.STAGING_VM_KNOWN_HOSTS \}\}/,
);
assert.match(
  transitionStopLegacy,
  /STAGING_VM_SSH_PRIVATE_KEY: \$\{\{ secrets\.STAGING_VM_SSH_PRIVATE_KEY \}\}/,
);
assert.equal(
  (transitionStopLegacy.match(/\$\{\{ secrets\./g) ?? []).length,
  3,
  'The legacy-stop transition job may receive only the three protected VM SSH inputs.',
);
assert.match(transitionStopLegacy, /ssh-keygen -F "\$STAGING_VM_HOST"/);
assert.match(transitionStopLegacy, /BatchMode=yes/);
assert.match(transitionStopLegacy, /ClearAllForwardings=yes/);
assert.match(transitionStopLegacy, /IdentitiesOnly=yes/);
assert.match(transitionStopLegacy, /RequestTTY=no/);
assert.match(transitionStopLegacy, /StrictHostKeyChecking=yes/);
assert.match(transitionStopLegacy, /UserKnownHostsFile=/);
assert.equal(
  (transitionStopLegacy.match(/^\s*ssh\s/gm) ?? []).length,
  1,
  'The legacy-stop transition job may execute SSH exactly once.',
);
assert.equal(
  (transitionStopLegacy.match(/sudo -n '\$legacy_helper'/g) ?? []).length,
  2,
  'The legacy-stop transition job may cross the exact legacy sudo boundary twice.',
);
assert.equal(
  (transitionStopLegacy.match(new RegExp(legacyHelperSha, 'gu')) ?? []).length,
  1,
  'The legacy-stop transition job must pin the one reviewed legacy helper digest.',
);
assert.match(transitionStopLegacy, /legacy_brand='pay''replayy'/);
assert.match(transitionStopLegacy, /legacy_admin="\$\{legacy_brand\}-admin"/);
assert.match(
  transitionStopLegacy,
  /legacy_helper="\/usr\/local\/sbin\/\$\{legacy_brand\}-staging-deploy-helper"/,
);
assert.doesNotMatch(transitionStopLegacy, new RegExp(legacyBrand, 'iu'));
const transitionStopRemoteCommand = transitionStopLegacy
  .split(/\r?\n/u)
  .find((line) => line.includes('remote_command='));
assert.ok(transitionStopRemoteCommand, 'The legacy-stop remote command must be explicit.');
assert.equal(
  transitionStopRemoteCommand.trim(),
  String.raw`remote_command="test \"\$(id -u)\" -ne 0 && test \"\$(id -un)\" = '$legacy_admin' && sudo -n '$legacy_helper' verify '${legacyHelperSha}' && sudo -n '$legacy_helper' stop"`,
  'The legacy-stop command must verify the exact legacy helper and then stop only its runtime.',
);
assert.equal(
  transitionStopRemoteCommand
    .trim()
    .replaceAll('$legacy_admin', legacyAdmin)
    .replaceAll('$legacy_helper', legacyHelper),
  String.raw`remote_command="test \"\$(id -u)\" -ne 0 && test \"\$(id -un)\" = '${legacyAdmin}' && sudo -n '${legacyHelper}' verify '${legacyHelperSha}' && sudo -n '${legacyHelper}' stop"`,
  'The split legacy constants must render the one exact live identity and helper path.',
);
assert.match(transitionStopLegacy, /"\$legacy_admin@\$STAGING_VM_HOST"/);
assert.doesNotMatch(
  transitionStopLegacy,
  /root@|fetanagent-admin@|SUDO_USER|ssh-keyscan|StrictHostKeyChecking=no|\bpsql\b|\bsupabase\b|\bdocker\b|\bcompose\b|\bscp\b|\bcurl\b|\bwget\b|staging-runtimes|fetanagent-staging-deploy-helper|fetanagent-vm-transition|mark-legacy-stopped/,
);

const transitionStopRunbook =
  /\n`transition-stop-legacy` is a one-way transition boundary\.([\s\S]*?)\n\n`deploy-and-smoke` additionally requires/u.exec(
    stagingRunbook,
  )?.[1];
assert.ok(transitionStopRunbook, 'The guarded legacy-stop runbook section must exist.');
assert.equal(
  createHash('sha256').update(transitionStopRunbook).digest('hex'),
  '30212ba214058029f8cb2eb9040780c5219f5bfb43efc2c2557c0d64d21bd515',
  'The reviewed legacy-stop operator sequence must remain byte-for-byte exact.',
);
assert.match(transitionStopRunbook, /Freeze `main` at the final post-merge SHA/);
assert.match(
  transitionStopRunbook,
  /`transition-ssh-verify` run for that SHA must pass,[\s\S]*?root-console transition `acknowledge` and `verify` commands for the same SHA must both pass/u,
);
assert.match(transitionStopRunbook, /Only then may the stop mode be dispatched/);
assert.match(transitionStopRunbook, /stop-legacy-staging-runtime/);
assert.match(
  transitionStopRunbook,
  /run\s+`mark-legacy-stopped` with the same SHA, then `verify`; keep staging offline until both pass/u,
);
assert.match(
  transitionStopRunbook,
  /do not deploy, migrate, restore the old\s+runtime, or claim that the boundary is sealed/u,
);
assert.match(workflow, /docker build --pull=false --target admin/);
assert.match(workflow, /docker build --pull=false --target api/);
assert.match(workflow, /docker build --pull=false --target beta-admission/);
assert.match(workflow, /docker build --pull=false --target bot/);
assert.match(workflow, /org\.opencontainers\.image\.revision/);
assert.match(workflow, /http:\/\/127\.0\.0\.1:3002\/readyz/);
assert.match(workflow, /stop-and-disable/);
assert.match(workflow, /infra\/sql\/staging-runtimes-disable\.sql/g);
assert.ok(
  workflow.indexOf('Stop any prior staging project and disable old logins') <
    workflow.indexOf('Verify the VM has direct IPv6 database readiness') &&
    workflow.indexOf('Verify the VM has direct IPv6 database readiness') <
      workflow.indexOf('Provision three narrow 24-hour staging logins') &&
    workflow.indexOf('Provision three narrow 24-hour staging logins') <
      workflow.indexOf('Transfer and install sealed release inputs') &&
    workflow.indexOf('Transfer and install sealed release inputs') <
      workflow.indexOf('Start the private staging profile and smoke readiness'),
  'Old runtimes must stop, then direct IPv6 readiness must pass before new logins are provisioned.',
);
const networkReadinessStep =
  /- name: Verify the VM has direct IPv6 database readiness([\s\S]*?)\n\s+- name: Provision three narrow 24-hour staging logins/u.exec(
    workflow,
  )?.[1];
assert.ok(networkReadinessStep, 'The deployment must verify exact VM IPv6 readiness.');
assert.match(networkReadinessStep, /fetanagent-staging-deploy-helper network-ready/);
assert.doesNotMatch(networkReadinessStep, /\b(?:for|while|until)\b|\bsleep\b/);
assert.doesNotMatch(workflow, /run: sleep 125|staging-runtime-login-preflight\.sql/);
assert.match(workflow, /Capture count-only runtime session diagnostics after failed activation/);
assert.match(workflow, /Capture bounded Owner-control startup diagnostics/);
assert.match(workflow, /infra\/sql\/staging-runtime-session-diagnostics\.sql/);
assert.ok(
  workflow.indexOf('Capture bounded Owner-control startup diagnostics') <
    workflow.indexOf('Capture count-only runtime session diagnostics after failed activation') &&
    workflow.indexOf('Capture count-only runtime session diagnostics after failed activation') <
      workflow.indexOf('Roll back failed activation'),
  'Bounded startup and count-only database diagnostics must run before rollback removes the runtime state.',
);
assert.match(workflow, /BETA_ADMISSION_RUNTIME_PASSWORD/);
assert.match(workflow, /OWNER_CONTROL_RUNTIME_PASSWORD/);
assert.match(workflow, /PLAYER_ACTION_RUNTIME_PASSWORD/);
assert.match(workflow, /BOT_TO_API_ACTION_HMAC_SECRET/);
assert.match(workflow, /API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET/);
assert.match(workflow, /API_TELEGRAM_CAPABILITY_HMAC_SECRET/);
assert.match(workflow, /API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET/);
assert.match(workflow, /CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET/);
assert.match(workflow, /CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET/);
assert.match(
  workflow,
  /CBE_DEPOSIT_REFERENCE_KEY_PROFILE_V1_JSON: \$\{\{ vars\.CBE_DEPOSIT_REFERENCE_KEY_PROFILE_V1_JSON \}\}/,
);
assert.match(workflow, /distinct_count/);
assert.match(workflow, /STAGING_TELEGRAM_BOT_TOKEN/);
assert.match(workflow, /STAGING_SUPABASE_PUBLISHABLE_KEY/);
assert.match(workflow, /SUPABASE_CA_CERTIFICATE_PEM/);
assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE|service_role|FINANCIAL_ACTIONS_MODE=live/);

const protectedDeployInputs =
  /- name: Validate protected deploy inputs([\s\S]*?)\n\s+- name: Stop any prior staging project/u.exec(
    workflow,
  )?.[1];
assert.ok(protectedDeployInputs, 'The protected deployment input step must exist.');
assert.match(
  protectedDeployInputs,
  /CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET: \$\{\{ secrets\.CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET \}\}/,
);
assert.match(
  protectedDeployInputs,
  /CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET: \$\{\{ secrets\.CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET \}\}/,
);
assert.match(protectedDeployInputs, /\[\[ "\$distinct_count" -eq 11 \]\]/);
assert.match(
  protectedDeployInputs,
  /const encoded = process\.env\.CBE_DEPOSIT_REFERENCE_KEY_PROFILE_V1_JSON/,
);
assert.match(
  protectedDeployInputs,
  /Object\.keys\(profile\)\.sort\(\)\.join\(','\) !==\s+'encryptionKeyFingerprint,fingerprintKeyFingerprint,version'/,
);
assert.match(protectedDeployInputs, /profile\.version !== 1/);
assert.match(protectedDeployInputs, /\^sha256:\[0-9a-f\]\{64\}\$/);
assert.match(
  protectedDeployInputs,
  /printf '%s\\n' "\$CBE_DEPOSIT_REFERENCE_KEY_PROFILE_V1_JSON" > "\$secret_dir\/cbe-deposit-reference-key-profile\.v1\.json"/,
);
const cbeProfileMaterialization =
  /printf '%s\\n' "\$CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET"([\s\S]*?)printf '%s\\n' "\$STAGING_TELEGRAM_BOT_TOKEN"/u.exec(
    protectedDeployInputs,
  )?.[1];
assert.ok(
  cbeProfileMaterialization,
  'The bounded CBE key/profile materialization block must exist.',
);
assert.doesNotMatch(
  cbeProfileMaterialization,
  /createHash|createHmac|sha256sum|openssl|xxd|digest\s*\(/,
  'ordinary deployment must never derive or self-approve the immutable key profile',
);
for (const releaseInput of [
  'cbe-deposit-reference-encryption-key',
  'cbe-deposit-reference-fingerprint-key',
  'cbe-deposit-reference-key-profile.v1.json',
]) {
  assert.match(workflow, new RegExp(`\\$SECRET_DIR/${releaseInput.replaceAll('.', '\\.')}`));
  assert.match(helper, new RegExp(releaseInput.replaceAll('.', '\\.')));
}

for (const selector of [
  'FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE',
  'FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE',
  'FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE',
]) {
  assert.match(qualityWorkflow, new RegExp(`${selector}=/dev/null`));
  assert.match(helper, new RegExp(selector));
}

for (const sql of [provision, disable]) {
  assert.match(sql, /fetanagent_beta_admission_runtime/);
  assert.match(sql, /fetanagent_owner_control_runtime/);
  assert.match(sql, /fetanagent_player_actions_runtime/);
  assert.doesNotMatch(sql, /fetanagent_api_runtime|fetanagent_worker|service_role|kemerbet/i);
}
assert.match(provision, /interval '24 hours'/g);
assert.match(disable, /nologin/g);
assert.match(disable, /password null/g);
assert.match(disable, /pg_catalog\.pg_terminate_backend\(activity_pid, 5000\)/);
assert.match(disable, /from pg_catalog\.pg_stat_activity as activity/g);
assert.match(disable, /perform pg_catalog\.pg_stat_clear_snapshot\(\)/);
assert.ok(
  disable.indexOf('nologin') < disable.indexOf('pg_catalog.pg_terminate_backend'),
  'The logins must be disabled before existing runtime sessions are terminated.',
);
assert.ok(
  disable.indexOf('pg_catalog.pg_terminate_backend') <
    disable.indexOf('perform pg_catalog.pg_stat_clear_snapshot()') &&
    disable.indexOf('perform pg_catalog.pg_stat_clear_snapshot()') <
      disable.lastIndexOf('from pg_catalog.pg_stat_activity as activity'),
  'Cleanup must clear the statistics snapshot after termination and before verifying zero sessions.',
);

assert.match(diagnostics, /from pg_catalog\.pg_stat_activity as activity/);
assert.match(diagnostics, /count\(\*\)::integer as session_count/);
assert.match(diagnostics, /fetanagent_player_actions_runtime/);
assert.doesNotMatch(diagnostics, /\bpid\b|client_addr|\bquery\b|password|secret/i);

const rollbackStep = /- name: Roll back failed activation([\s\S]*?)\n\s+stop:/u.exec(workflow)?.[1];
assert.ok(rollbackStep, 'The failed-activation rollback must be present.');
assert.match(rollbackStep, /for attempt in 1 2 3 4/);
assert.match(rollbackStep, /sleep 15/);
assert.match(rollbackStep, /cleanup_status/);
assert.match(rollbackStep, /else\s+cleanup_status=\$\?\s+fi/);
assert.match(rollbackStep, /exit "\$cleanup_status"/);
assert.match(rollbackStep, /staging-runtimes-disable\.sql/);

assert.match(helper, /^#!\/usr\/bin\/env bash/);
assert.match(helper, /EXPECTED_SUDO_USER='fetanagent-admin'/);
assert.match(helper, /HELPER_PATH='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'/);
assert.match(helper, /root:root:755/);
assert.match(helper, /DOCKER_HOST="\$LOCAL_DOCKER_SOCKET"/);
assert.match(helper, /--env-file \/dev\/null/);
assert.match(helper, /--project-name "\$PROJECT_NAME"/);
assert.match(helper, /up -d --no-build --wait --wait-timeout 90/);
assert.match(helper, /STAGING_DIRECT_DATABASE_HOST='db\.spzpiyxheappsfyswewl\.supabase\.co'/);
assert.match(helper, /ip -6 address show scope global/);
assert.match(helper, /ip -6 route show default/);
assert.match(helper, /getent ahostsv6 "\$STAGING_DIRECT_DATABASE_HOST" >\/dev\/null/);
assert.match(
  helper,
  /run_bounded_database_preflight \\\s+owner-control apps\/admin\/dist\/database-preflight-cli\.js/,
);
assert.match(
  helper,
  /run_bounded_database_preflight \\\s+api apps\/api\/dist\/player-action-database-preflight-cli\.js/,
);
assert.match(
  helper,
  /run_bounded_database_preflight \\\s+beta-admission apps\/beta-admission\/dist\/catalog-preflight-cli\.js/,
);
const boundedPreflight = /run_bounded_database_preflight\(\)([\s\S]*?)\n\s*\}/u.exec(helper)?.[1];
assert.ok(boundedPreflight, 'The helper must define the bounded database preflight runner.');
assert.match(boundedPreflight, /for attempt in 1 2 3/);
assert.match(boundedPreflight, /run --rm --no-deps "\$service" node "\$preflight_cli"/);
assert.match(boundedPreflight, /if \[\[ "\$attempt" -lt 3 \]\]/);
assert.match(boundedPreflight, /sleep 15/);
assert.doesNotMatch(boundedPreflight, /up -d|password|secret|psql|curl|wget/);
const longLivedStart = helper.indexOf('up -d --no-build --wait --wait-timeout 90');
assert.ok(
  helper.indexOf('owner-control apps/admin/dist/database-preflight-cli.js') < longLivedStart &&
    helper.indexOf('api apps/api/dist/player-action-database-preflight-cli.js') < longLivedStart &&
    helper.indexOf('beta-admission apps/beta-admission/dist/catalog-preflight-cli.js') <
      longLivedStart,
  'All three one-shot runtime preflights must pass before long-lived services start.',
);
assert.match(helper, /docker_local network rm \$networks/);
assert.doesNotMatch(helper, /curl|wget|git |\.env|xzztugbgtulptnbpoelr/);

const ownerDiagnostic = /diagnose-owner-startup\)([\s\S]*?)\n\s*;;/u.exec(helper)?.[1];
assert.ok(ownerDiagnostic, 'The helper must define bounded Owner-control startup diagnostics.');
assert.match(ownerDiagnostic, /com\.docker\.compose\.project=\$PROJECT_NAME/);
assert.match(ownerDiagnostic, /com\.docker\.compose\.service=owner-control/);
assert.match(ownerDiagnostic, /org\.opencontainers\.image\.revision/);
assert.match(ownerDiagnostic, /container logs --tail 80/);
assert.doesNotMatch(ownerDiagnostic, /inspect .*\{\{json \.Config\}\}|container logs .*bot/);

console.log(
  'staging deploy workflow verified: manual exact-target guards, read-only transition SSH proof, sealed images, checksummed root helper, bounded runtime credentials, and stop path',
);
