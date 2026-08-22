import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = readFileSync(
  resolve(root, '.github/workflows/staging-beta-deploy-smoke.yml'),
  'utf8',
);
const botWorkflow = readFileSync(
  resolve(root, '.github/workflows/staging-telegram-bot.yml'),
  'utf8',
);
const botSource = readFileSync(resolve(root, 'apps/bot/src/index.ts'), 'utf8');
const apiSource = readFileSync(resolve(root, 'apps/api/src/app.ts'), 'utf8');
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
const installedHelperPredecessorSha =
  '4966c316de10e9d7a5ac5e94662e75dbcb241b0103828b91b049b93670e1c188';
const installedHelperBackupName = 'fetanagent-staging-deploy-helper.previous-4966c316';
const installedHelperBackupPath = `/root/fetanagent-helper-rotation/${installedHelperBackupName}`;
const reviewedHelperSuccessorSha = createHash('sha256')
  .update(helper.replaceAll('\r\n', '\n'))
  .digest('hex');
const stagingDropletIpv6 = '2a03:b0c0:1:e0:0:1:a8b4:2001';
const staleStagingBannedIpv6 = '2a05:d018:135e:1602:5210:739d:5667:fee4';
const retiredDepositReferenceProtection = new RegExp(
  ['api', 'deposit', 'reference', 'protection'].join('[_-]'),
  'iu',
);

for (const artifact of [workflow, botWorkflow, qualityWorkflow, compose, helper, stagingRunbook]) {
  assert.doesNotMatch(
    artifact,
    retiredDepositReferenceProtection,
    'the retired single-key deposit-reference input must remain absent',
  );
}

const ownerCompose = /\n  owner-control:\n([\s\S]*?)\n  customer-web:/u.exec(compose)?.[1];
assert.ok(ownerCompose, 'The staging Compose contract must contain Owner control.');
for (const exactOwnerReceiverSetting of [
  'OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER_FILE: /run/secrets/owner_receiver_reference_encryption_master',
  'OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER_FILE: /run/secrets/owner_receiver_reference_fingerprint_master',
  'OWNER_RECEIVER_REFERENCE_PROFILE_FILE: /etc/fetanagent/deposit-proof-reference-profile.v2.json',
]) {
  assert.match(ownerCompose, new RegExp(exactOwnerReceiverSetting.replaceAll('.', '\\.')));
}
assert.doesNotMatch(
  ownerCompose,
  /^\s+DEPOSIT_PROOF_REFERENCE_(?:ENCRYPTION|FINGERPRINT|PROFILE)/mu,
  'Owner control must use its receiver-specific contract rather than the provider-proof environment.',
);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
assert.match(workflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(workflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(workflow, /STAGING_DROPLET_ID: '593344964'/);
assert.match(workflow, /STAGING_DIRECT_DATABASE_HOST: db\.spzpiyxheappsfyswewl\.supabase\.co/);
assert.match(workflow, new RegExp(`^  STAGING_BANNED_IP: ${stagingDropletIpv6}$`, 'mu'));
assert.doesNotMatch(workflow, new RegExp(staleStagingBannedIpv6, 'u'));
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
assert.match(workflow, /fetanagent-staging-deploy-helper fresh-start/g);
assert.match(workflow, /fetanagent-staging-deploy-helper bot-disabled-ready '\$GITHUB_SHA'/g);
assert.doesNotMatch(
  workflow,
  /fetanagent-staging-deploy-helper start '\$GITHUB_SHA'/,
  'Fresh-host staging must not invoke the retired cutover-only start path.',
);
assert.match(workflow, /fetanagent-staging-deploy-helper network-ready/g);
assert.match(workflow, /fetanagent-staging-deploy-helper diagnose-owner-startup/g);
assert.match(workflow, /fetanagent-staging-deploy-helper stop/g);
assert.match(workflow, /fetanagent-staging-deploy-helper discard/g);
assert.match(
  workflow,
  /fetanagent-staging-deploy-helper arm-expiry-stop '\$GITHUB_SHA' '\$STOP_AT'/g,
);
assert.match(workflow, /sha256sum infra\/operations\/fetanagent-staging-deploy-helper\.sh/g);
assert.match(workflow, /persist-credentials: false/g);
assert.doesNotMatch(workflow, /confirm_stop_and_disable_deadline_utc|CONFIRMED_STOP_DEADLINE/);
assert.equal(
  (workflow.match(/uses: supabase\/setup-cli@46f7f98c7f948ad727d22c1e67fab04c223a0520 # v3/g) ?? [])
    .length,
  2,
  'Both network-ban paths must use the same pinned Supabase CLI setup action.',
);
assert.equal(
  (workflow.match(/^\s+version: 2\.113\.0$/gm) ?? []).length,
  2,
  'Both network-ban paths must install the exact reviewed Supabase CLI version.',
);

const connectivityJob = /\n  connectivity:\n([\s\S]*?)\n  transition-ssh-verify:\n/u.exec(
  workflow,
)?.[1];
assert.ok(connectivityJob, 'The explicit staging unban and connectivity job must exist.');
assert.match(connectivityJob, /if: inputs\.mode == 'unban-and-connectivity-check'/);
assert.match(connectivityJob, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
assert.match(
  connectivityJob,
  /current_bans="\$\(supabase network-bans get \\\r?\n\s+--project-ref "\$STAGING_PROJECT_REF" --experimental --output json\)"/u,
);
assert.match(connectivityJob, /type == "array" and all\(\.\[\]; type == "string"\)/);
assert.match(connectivityJob, /jq -er --arg ip "\$STAGING_BANNED_IP"/);
assert.match(connectivityJob, /if index\(\$ip\) == null then "clear" else "banned" end/);
assert.match(connectivityJob, /case "\$ban_status" in/);
assert.match(
  connectivityJob,
  /supabase network-bans remove --db-unban-ip "\$STAGING_BANNED_IP" \\\r?\n\s+--project-ref "\$STAGING_PROJECT_REF" --experimental/u,
);
assert.equal(
  (workflow.match(/supabase network-bans remove --db-unban-ip/g) ?? []).length,
  1,
  'Only the explicit connectivity mode may remove one exact staging network ban.',
);
assert.equal(
  (workflow.match(/--db-unban-ip "\$STAGING_BANNED_IP"/g) ?? []).length,
  1,
  'Network-ban removal must target only the one pinned staging IP.',
);
assert.doesNotMatch(connectivityJob, /--db-unban-ip (?!"\$STAGING_BANNED_IP")/u);

assert.match(botWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(botWorkflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(botWorkflow, /permissions:\s*\r?\n\s+contents: read/);
assert.match(botWorkflow, /concurrency:\s*\r?\n\s+group: fetanagent-staging-beta-deploy/);
assert.match(botWorkflow, /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/);
assert.match(botWorkflow, /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/);
assert.match(botWorkflow, /STAGING_DROPLET_ID: '593344964'/);
assert.match(botWorkflow, /STAGING_BOT_USERNAME: fetanagentbot/);
assert.match(botWorkflow, /GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(botWorkflow, /CONFIRMED_COMMIT.*GITHUB_SHA/);
assert.match(botWorkflow, /CONFIRMED_PROJECT.*STAGING_PROJECT_REF/);
assert.match(botWorkflow, /CONFIRMED_PROJECT.*PRODUCTION_PROJECT_REF/);
assert.match(botWorkflow, /CONFIRMED_DROPLET.*STAGING_DROPLET_ID/);
assert.match(botWorkflow, /CONFIRMED_BOT_USERNAME.*STAGING_BOT_USERNAME/);
assert.match(botWorkflow, /activate-staging-telegram-bot/);
assert.match(botWorkflow, /\^\(activate-and-smoke\|stop-and-disable\)\$/);
assert.match(botWorkflow, /environment: staging/);
assert.match(botWorkflow, /contents: read/);
assert.match(botWorkflow, /persist-credentials: false/);
assert.match(
  botWorkflow,
  /STAGING_TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.STAGING_TELEGRAM_BOT_TOKEN \}\}/,
);
assert.match(
  botWorkflow,
  /EXPECTED_TOKEN_SHA256: \$\{\{ vars\.STAGING_TELEGRAM_BOT_TOKEN_SHA256 \}\}/,
);
assert.match(botWorkflow, /createHash\('sha256'\)\.update\(token\)\.digest\('hex'\)/);
assert.match(botWorkflow, /telegram\('getMe'\)/);
assert.match(botWorkflow, /telegram\('getWebhookInfo'\)/);
assert.match(botWorkflow, /identity\.username\.toLowerCase\(\) !== 'fetanagentbot'/);
assert.match(botWorkflow, /webhook\.url !== ''/);
assert.match(botWorkflow, /webhook\.pending_update_count !== 0/);
assert.doesNotMatch(botWorkflow, /deleteWebhook|drop_pending_updates|setWebhook/);
assert.match(botWorkflow, /StrictHostKeyChecking=yes/g);
assert.match(botWorkflow, /UserKnownHostsFile=/g);
assert.match(botWorkflow, /fetanagent-admin@/g);
assert.match(botWorkflow, /fetanagent-staging-deploy-helper verify/g);
for (const botCommand of [
  'bot-disabled-ready',
  'install-bot-token',
  'start-bot',
  'bot-ready',
  'stop-bot',
]) {
  assert.match(botWorkflow, new RegExp(`fetanagent-staging-deploy-helper ${botCommand}`));
  assert.match(helper, new RegExp(`\\n  ${botCommand.replace('-', '\\-')}\\)`));
}
assert.match(botWorkflow, /for attempt in \{1\.\.12\}/);
assert.match(botWorkflow, /sleep 5/);
assert.match(botWorkflow, /staging_telegram_bot_smoke=pass/);
assert.match(botWorkflow, /steps\.install-token\.outcome == 'success'/);
assert.match(botWorkflow, /rm -rf -- "\$secret_dir"/);
assert.doesNotMatch(
  botWorkflow,
  /root@|ssh-keyscan|StrictHostKeyChecking=no|sudo -n (?:docker|bash)|docker\.sock/,
);
assert.doesNotMatch(
  botWorkflow,
  /SUPABASE_DB_PASSWORD|SUPABASE_ACCESS_TOKEN|service_role|FINANCIAL_ACTIONS_MODE=live|KEMERBET_EXECUTOR_ENABLED=true|KEMERBET_FINAL_ACTION_ENABLED=true|\bdoctl\b|porkbun|fetanagent\.com/iu,
);
assert.doesNotMatch(
  botWorkflow,
  /echo[^\n]*\$STAGING_TELEGRAM_BOT_TOKEN|set\s+-x|printenv|env\s*$/imu,
  'The bot activation gate must never print the protected token or its environment.',
);

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
  /\bpsql\b|\bsupabase\b|\bdocker\b|\bcompose\b|\bscp\b|\bcurl\b|\bwget\b|staging-runtimes|fetanagent-staging-deploy-helper (?:stop|discard|install|start|cutover-ready|fresh-host-ready|network-ready|diagnose-owner-startup)/,
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
assert.match(workflow, /docker build --pull=false --target customer-web/);
assert.match(workflow, /docker build --pull=false --target api/);
assert.match(workflow, /docker build --pull=false --target beta-admission/);
assert.match(workflow, /docker build --pull=false --target bot/);
assert.match(workflow, /docker build --pull=false --target gateway/);
assert.match(workflow, /apt-cache policy chromium/);
assert.match(
  workflow,
  /docker build --pull=false --target executor[\s\S]*?--build-arg "VCS_REF=\$GITHUB_SHA"[\s\S]*?--build-arg "FETANAGENT_CHROMIUM_PACKAGE_VERSION=\$CHROMIUM_PACKAGE_VERSION"[\s\S]*?-t "fetanagent-deposit-executor:\$tag"/,
);
assert.match(
  workflow,
  /docker image inspect "fetanagent-deposit-executor:\$tag"[\s\S]*?org\.opencontainers\.image\.revision[\s\S]*?= "\$GITHUB_SHA"/,
);
assert.match(
  workflow,
  /docker image inspect "fetanagent-deposit-executor:\$tag"[\s\S]*?org\.opencontainers\.image\.chromium-package-version[\s\S]*?"\$CHROMIUM_PACKAGE_VERSION"/,
);
assert.match(
  workflow,
  /docker save --output "\$RUNNER_TEMP\/fetanagent-staging-images\.tar"[\s\S]*?"fetanagent-gateway:\$tag"[\s\S]*?"fetanagent-deposit-executor:\$tag"/,
);
assert.match(workflow, /org\.opencontainers\.image\.revision/);
assert.match(workflow, /http:\/\/127\.0\.0\.1:3002\/readyz/);
assert.match(workflow, /stop-and-disable/);
assert.match(workflow, /infra\/sql\/staging-runtimes-disable\.sql/g);
const deployJob = /\n  deploy:\n([\s\S]*?)\n  stop:\n/u.exec(workflow)?.[1];
assert.ok(deployJob, 'The guarded staging deployment job must exist.');
assert.doesNotMatch(
  deployJob,
  /network-bans remove|--db-unban-ip/,
  'Deploy mode must never mutate the Supabase network-ban list.',
);
assert.ok(
  workflow.indexOf('Stop any prior staging project and disable old logins') <
    workflow.indexOf('Verify the fresh-host deployment boundary is empty') &&
    workflow.indexOf('Verify the fresh-host deployment boundary is empty') <
      workflow.indexOf('Verify the VM has direct IPv6 database readiness') &&
    workflow.indexOf('Verify the VM has direct IPv6 database readiness') <
      workflow.indexOf('Set up the pinned Supabase CLI for the read-only ban check') &&
    workflow.indexOf('Set up the pinned Supabase CLI for the read-only ban check') <
      workflow.indexOf('Check the exact staging network ban before provisioning') &&
    workflow.indexOf('Check the exact staging network ban before provisioning') <
      workflow.indexOf('Provision four narrow 24-hour staging logins') &&
    workflow.indexOf('Provision four narrow 24-hour staging logins') <
      workflow.indexOf('Derive the automatic stop time from exact database role expiries') &&
    workflow.indexOf('Derive the automatic stop time from exact database role expiries') <
      workflow.indexOf('Transfer and install sealed release inputs') &&
    workflow.indexOf('Transfer and install sealed release inputs') <
      workflow.indexOf('Arm the host-local stop before database credential expiry') &&
    workflow.indexOf('Arm the host-local stop before database credential expiry') <
      workflow.indexOf('Start the private staging profile and smoke readiness'),
  'Old runtimes must stop, IPv6 and the exact ban list must pass, then the real role expiries must arm the host-local guard before startup.',
);
const freshHostReadinessStep =
  /- name: Verify the fresh-host deployment boundary is empty([\s\S]*?)\n\s+- name: Verify the VM has direct IPv6 database readiness/u.exec(
    workflow,
  )?.[1];
assert.ok(freshHostReadinessStep, 'Deployment must prove the exact empty fresh-host boundary.');
assert.match(
  freshHostReadinessStep,
  /fetanagent-staging-deploy-helper fresh-host-ready '\$GITHUB_SHA'/,
);
assert.doesNotMatch(freshHostReadinessStep, /fetanagent-staging-deploy-helper cutover-ready/);
const networkReadinessStep =
  /- name: Verify the VM has direct IPv6 database readiness([\s\S]*?)\n\s+- name: Set up the pinned Supabase CLI for the read-only ban check/u.exec(
    workflow,
  )?.[1];
assert.ok(networkReadinessStep, 'The deployment must verify exact VM IPv6 readiness.');
assert.match(networkReadinessStep, /fetanagent-staging-deploy-helper network-ready/);
assert.doesNotMatch(networkReadinessStep, /\b(?:for|while|until)\b|\bsleep\b/);
const deployBanGate =
  /- name: Check the exact staging network ban before provisioning([\s\S]*?)\n\s+- name: Provision four narrow 24-hour staging logins/u.exec(
    deployJob,
  )?.[1];
assert.ok(deployBanGate, 'Deploy must fail closed on its current exact network ban.');
assert.match(deployBanGate, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
assert.match(
  deployBanGate,
  /current_bans="\$\(supabase network-bans get \\\r?\n\s+--project-ref "\$STAGING_PROJECT_REF" --experimental --output json\)"/u,
);
assert.match(deployBanGate, /type == "array" and all\(\.\[\]; type == "string"\)/);
assert.match(deployBanGate, /jq -er --arg ip "\$STAGING_BANNED_IP"/);
assert.match(deployBanGate, /if index\(\$ip\) == null then "clear" else "banned" end/);
assert.match(deployBanGate, /case "\$ban_status" in/);
assert.match(
  deployBanGate,
  /The exact staging VM IP is currently banned; run the explicit unban-and-connectivity-check mode before redeploying\./,
);
assert.doesNotMatch(
  deployBanGate,
  /network-bans remove|--db-unban-ip|\bpsql\b|(?:BETA_ADMISSION|CUSTOMER_WEB|OWNER_CONTROL|PLAYER_ACTION)_RUNTIME_PASSWORD/,
);
assert.doesNotMatch(
  deployBanGate,
  /echo [^\n]*\$(?:SUPABASE_ACCESS_TOKEN|current_bans)/,
  'The fail-closed ban gate must not print protected inputs or the returned ban list.',
);
const expiryDerivation =
  /- name: Derive the automatic stop time from exact database role expiries([\s\S]*?)\n\s+- name: Transfer and install sealed release inputs/u.exec(
    deployJob,
  )?.[1];
assert.ok(expiryDerivation, 'Deployment must derive one stop time from the exact role expiries.');
for (const role of [
  'fetanagent_beta_admission_runtime',
  'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime',
  'fetanagent_player_actions_runtime',
]) {
  assert.match(expiryDerivation, new RegExp(role, 'u'));
}
assert.match(expiryDerivation, /pg_catalog\.count\(oid\) = 4/);
assert.match(expiryDerivation, /pg_catalog\.count\(rolvaliduntil\) = 4/);
assert.match(expiryDerivation, /pg_catalog\.bool_and\(rolcanlogin\)/);
assert.match(expiryDerivation, /pg_catalog\.bool_and\(pg_catalog\.isfinite\(rolvaliduntil\)\)/);
assert.match(expiryDerivation, /pg_catalog\.min\(rolvaliduntil\) - interval '2 hours'/);
assert.match(expiryDerivation, /interval '23 hours 30 minutes'/);
assert.match(expiryDerivation, /interval '24 hours 5 minutes'/);
assert.match(expiryDerivation, /interval '10 seconds'/);
assert.match(expiryDerivation, /stop_epoch > now_epoch \+ 21 \* 60 \* 60/);
assert.match(expiryDerivation, /stop_epoch <= now_epoch \+ 23 \* 60 \* 60/);
assert.doesNotMatch(
  expiryDerivation,
  /alter\s+role|network-bans|supabase\s|docker|echo[^\n]*(?:PGPASSWORD|SUPABASE_DB_PASSWORD)|FINANCIAL_ACTIONS_MODE=live|KEMERBET_.*=true/iu,
);
const expiryArming =
  /- name: Arm the host-local stop before database credential expiry([\s\S]*?)\n\s+- name: Start the private staging profile and smoke readiness/u.exec(
    deployJob,
  )?.[1];
assert.ok(expiryArming, 'Deployment must arm the host-local guard before long-lived startup.');
assert.match(expiryArming, /STOP_AT: \$\{\{ steps\.expiry\.outputs\.stop_at \}\}/);
assert.match(expiryArming, /fetanagent-staging-deploy-helper verify/);
assert.match(
  expiryArming,
  /fetanagent-staging-deploy-helper arm-expiry-stop '\$GITHUB_SHA' '\$STOP_AT'/,
);
assert.doesNotMatch(expiryArming, /password|psql|supabase|docker|FINANCIAL_ACTIONS_MODE=live/iu);
assert.match(
  stagingRunbook,
  /`SUPABASE_ACCESS_TOKEN`[\s\S]*?exact-IP removal only in explicit unban mode/u,
);
assert.doesNotMatch(stagingRunbook, /confirm_stop_and_disable_deadline_utc|operator attestation/);
assert.match(stagingRunbook, /exactly two hours before the earliest expiry/);
assert.match(stagingRunbook, /automatic\s+stop-before-expiry boundary/);
assert.match(stagingRunbook, /not credential rotation or continuous\s+availability/u);
const helperReplacementRunbook =
  /### Exact helper replacement on the current staging Droplet([\s\S]*?)\nThe protected `staging` environment/u.exec(
    stagingRunbook,
  )?.[1];
assert.ok(helperReplacementRunbook, 'The current staging helper replacement must be documented.');
assert.match(helperReplacementRunbook, /retired Droplet `590666364`/);
assert.match(helperReplacementRunbook, /current staging Droplet `593344964`/);
assert.match(helperReplacementRunbook, /stop-and-disable/);
assert.match(helperReplacementRunbook, new RegExp(installedHelperPredecessorSha, 'gu'));
assert.match(helperReplacementRunbook, new RegExp(reviewedHelperSuccessorSha, 'gu'));
assert.ok(
  helperReplacementRunbook.includes(`BACKUP="$STAGING_ROOT/${installedHelperBackupName}"`) &&
    helperReplacementRunbook.includes(`BACKUP='${installedHelperBackupPath}'`),
  'The replacement and restore blocks must use the same new fixed predecessor-versioned backup path.',
);
assert.doesNotMatch(
  helperReplacementRunbook,
  /BACKUP=(?:"\$STAGING_ROOT\/|')fetanagent-staging-deploy-helper\.previous(?:"|')/u,
  'The current rotation must not reuse the prior unversioned backup evidence path.',
);
assert.match(helperReplacementRunbook, /metadata\/v1/);
assert.match(helperReplacementRunbook, /593344964/);
assert.match(helperReplacementRunbook, /161\.35\.41\.232/);
assert.match(helperReplacementRunbook, /root:root:755/);
assert.match(helperReplacementRunbook, /root:root:440/);
assert.match(
  helperReplacementRunbook,
  /fetanagent-admin ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/fetanagent-staging-deploy-helper \*/,
);
assert.match(helperReplacementRunbook, /visudo -cf \/etc\/sudoers/);
assert.doesNotMatch(helperReplacementRunbook, /fetanagent-vm-transition (?:rotate|verify|inspect)/);
const replacementInstall = helperReplacementRunbook.indexOf(
  'install -o root -g root -m 0755 "$STAGED" "$INSTALL_TMP"',
);
const replacementHash = helperReplacementRunbook.indexOf(
  'sha256sum "$INSTALL_TMP"',
  replacementInstall,
);
const replacementRename = helperReplacementRunbook.indexOf(
  'mv -f -- "$INSTALL_TMP" "$TARGET"',
  replacementHash,
);
const replacementVerify = helperReplacementRunbook.indexOf('transition-ssh-verify');
assert.ok(
  replacementInstall >= 0 &&
    replacementInstall < replacementHash &&
    replacementHash < replacementRename &&
    replacementRename < replacementVerify,
  'The exact helper must be syntax/hash checked, atomically installed, and then verified through non-root SSH.',
);
assert.match(
  stagingRunbook,
  new RegExp(
    'DigitalOcean Droplet `593344964` has the exact current public IPv6 address\\s+`' +
      stagingDropletIpv6 +
      '`',
    'u',
  ),
);
assert.doesNotMatch(stagingRunbook, new RegExp(staleStagingBannedIpv6, 'u'));
assert.match(stagingRunbook, /stop\/check\/unban-before-redeploy process/);
assert.match(stagingRunbook, /deploy mode does\s+not unban an address/u);
assert.match(stagingRunbook, /host-local timer\s+stops the containers/u);
assert.match(stagingRunbook, /another temporary network\s+ban/u);
assert.match(stagingRunbook, /does not support in-place runtime-password rotation/);
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
assert.match(workflow, /CUSTOMER_WEB_RUNTIME_PASSWORD/);
assert.match(workflow, /CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET/);
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
assert.match(workflow, /DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET/);
assert.match(workflow, /DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET/);
assert.match(
  workflow,
  /DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON: \$\{\{ vars\.DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON \}\}/,
);
assert.match(workflow, /distinct_count/);
assert.doesNotMatch(
  workflow,
  /secrets\.STAGING_TELEGRAM_BOT_TOKEN|\$STAGING_TELEGRAM_BOT_TOKEN/,
  'Fresh-host deploy must not read or materialize a Telegram token before the separate bot gate.',
);
assert.match(
  workflow,
  /printf '%s\\n' 'telegram-disabled-until-separate-smoke' > "\$secret_dir\/bot-token"/,
  'Fresh-host deploy must install a deliberately invalid bot-token sentinel.',
);
assert.match(workflow, /STAGING_SUPABASE_PUBLISHABLE_KEY/);
assert.match(workflow, /SUPABASE_CA_CERTIFICATE_PEM/);
assert.doesNotMatch(
  workflow,
  /SUPABASE_SERVICE_ROLE|service_role|FINANCIAL_ACTIONS_MODE=live|KEMERBET_EXECUTOR_ENABLED=true|KEMERBET_FINAL_ACTION_ENABLED=true/,
);

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
assert.match(
  protectedDeployInputs,
  /DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET: \$\{\{ secrets\.DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET \}\}/,
);
assert.match(
  protectedDeployInputs,
  /DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET: \$\{\{ secrets\.DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET \}\}/,
);
assert.match(
  protectedDeployInputs,
  /\[\[ "\$DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET" =~ \^\[0-9a-f\]\{64\}\$ \]\]/,
);
assert.match(
  protectedDeployInputs,
  /\[\[ "\$DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET" =~ \^\[0-9a-f\]\{64\}\$ \]\]/,
);
assert.match(protectedDeployInputs, /\[\[ "\$distinct_count" -eq 15 \]\]/);
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
assert.match(
  protectedDeployInputs,
  /const encoded = process\.env\.DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON/,
);
assert.match(
  protectedDeployInputs,
  /Object\.keys\(profile\)\.sort\(\)\.join\(','\) !==\s+'encryptionMasterFingerprint,fingerprintMasterFingerprint,version'/,
);
assert.match(protectedDeployInputs, /profile\.version !== 2/);
assert.match(
  protectedDeployInputs,
  /printf '%s\\n' "\$DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON" > "\$secret_dir\/deposit-proof-reference-profile\.v2\.json"/,
);
const cbeProfileMaterialization =
  /printf '%s\\n' "\$CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET"([\s\S]*?)printf '%s\\n' 'telegram-disabled-until-separate-smoke'/u.exec(
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
const providerProofProfileMaterialization =
  /printf '%s\\n' "\$DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET"([\s\S]*?)printf '%s\\n' 'telegram-disabled-until-separate-smoke'/u.exec(
    protectedDeployInputs,
  )?.[1];
assert.ok(
  providerProofProfileMaterialization,
  'The bounded provider-proof v2 roots/profile materialization block must exist.',
);
assert.doesNotMatch(
  providerProofProfileMaterialization,
  /createHash|createHmac|sha256sum|openssl|xxd|digest\s*\(/,
  'ordinary deployment must never derive or self-approve the provider-proof v2 profile',
);
for (const releaseInput of [
  'cbe-deposit-reference-encryption-key',
  'cbe-deposit-reference-fingerprint-key',
  'cbe-deposit-reference-key-profile.v1.json',
  'deposit-proof-reference-encryption-master',
  'deposit-proof-reference-fingerprint-master',
  'deposit-proof-reference-profile.v2.json',
  'customer-web-database-url',
  'customer-web-publishable-key',
  'customer-web-rate-limit-hmac',
]) {
  assert.match(workflow, new RegExp(`\\$SECRET_DIR/${releaseInput.replaceAll('.', '\\.')}`));
  assert.match(helper, new RegExp(releaseInput.replaceAll('.', '\\.')));
}

for (const selector of [
  'FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE',
  'FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE',
  'FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE',
  'FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE',
  'FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE',
  'FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE',
  'FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE',
  'FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE',
  'FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE',
]) {
  assert.match(qualityWorkflow, new RegExp(`${selector}=/dev/null`));
  assert.match(helper, new RegExp(selector));
}

for (const sql of [provision, disable]) {
  assert.match(sql, /fetanagent_beta_admission_runtime/);
  assert.match(sql, /fetanagent_customer_web_runtime/);
  assert.match(sql, /fetanagent_owner_control_runtime/);
  assert.match(sql, /fetanagent_player_actions_runtime/);
  assert.match(
    sql,
    /fetanagent_customer_web_runtime'[\s\S]*?then 2[\s\S]*?fetanagent_player_actions_runtime'[\s\S]*?then 2/u,
  );
  assert.doesNotMatch(sql, /fetanagent_api_runtime|fetanagent_worker|service_role|kemerbet/i);
}
assert.match(provision, /interval '24 hours'/g);
assert.match(
  provision,
  /alter role fetanagent_customer_web_runtime with[\s\S]*?connection limit 2 password :'customer_web_runtime_password';/u,
);
assert.match(disable, /nologin/g);
assert.match(disable, /password null/g);
assert.match(
  disable,
  /alter role fetanagent_customer_web_runtime with[\s\S]*?connection limit 2 password null valid until 'infinity';/u,
);
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
assert.match(diagnostics, /fetanagent_customer_web_runtime/);
assert.doesNotMatch(diagnostics, /\bpid\b|client_addr|\bquery\b|password|secret/i);

const rollbackStep = /- name: Roll back failed activation([\s\S]*?)\n\s+stop:/u.exec(workflow)?.[1];
assert.ok(rollbackStep, 'The failed-activation rollback must be present.');
assert.match(
  rollbackStep,
  /if: always\(\) && \(failure\(\) \|\| cancelled\(\)\) && steps\.provision\.outputs\.attempted == 'true'/,
);
const rollbackVerify = rollbackStep.indexOf('fetanagent-staging-deploy-helper verify');
const rollbackStop = rollbackStep.indexOf('fetanagent-staging-deploy-helper stop');
const rollbackDiscard = rollbackStep.indexOf('fetanagent-staging-deploy-helper discard');
assert.ok(
  rollbackVerify >= 0 && rollbackVerify < rollbackStop && rollbackStop < rollbackDiscard,
  'Any failure before activation completes must stop the project and disarm an armed expiry timer before discarding the release.',
);
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
assert.match(helper, /BOT_STARTUP_RECEIPT_ROOT='\/var\/lib\/fetanagent-bot-startup-receipt'/);
assert.match(helper, /BOT_STARTUP_RECEIPT="\$BOT_STARTUP_RECEIPT_ROOT\/bot-v1"/);
assert.match(helper, /BOT_STARTUP_RECEIPT_VERSION='1'/);
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
  /run_bounded_database_preflight \\\s+customer-web apps\/customer-web\/dist\/database-preflight-cli\.js/,
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
    helper.indexOf('customer-web apps/customer-web/dist/database-preflight-cli.js') <
      longLivedStart &&
    helper.indexOf('api apps/api/dist/player-action-database-preflight-cli.js') < longLivedStart &&
    helper.indexOf('beta-admission apps/beta-admission/dist/catalog-preflight-cli.js') <
      longLivedStart,
  'All four one-shot runtime preflights must pass before long-lived services start.',
);
assert.match(helper, /docker_local network rm \$networks/);
assert.match(helper, /EXPIRY_STOP_SERVICE='fetanagent-staging-runtime-expiry-stop\.service'/);
assert.match(helper, /EXPIRY_STOP_TIMER='fetanagent-staging-runtime-expiry-stop\.timer'/);
const expiryArmHelper = /arm_expiry_stop\(\) \(([\s\S]*?)\n\)/u.exec(helper)?.[1];
assert.ok(expiryArmHelper, 'The helper must define the host-local expiry-stop arming boundary.');
assert.match(expiryArmHelper, /stop_epoch > now_epoch \+ 21 \* 60 \* 60/);
assert.match(expiryArmHelper, /stop_epoch <= now_epoch \+ 23 \* 60 \* 60/);
assert.match(expiryArmHelper, /OnCalendar=\$calendar_stop_at/);
assert.match(expiryArmHelper, /Persistent=true/);
assert.match(expiryArmHelper, /AccuracySec=1min/);
assert.match(expiryArmHelper, /Restart=on-failure/);
assert.match(expiryArmHelper, /RestartSec=60/);
assert.match(expiryArmHelper, /StartLimitIntervalSec=0/);
assert.match(expiryArmHelper, /NoNewPrivileges=true/);
assert.match(expiryArmHelper, /PrivateTmp=true/);
assert.match(expiryArmHelper, /UMask=0077/);
assert.match(expiryArmHelper, /install -o root -g root -m 0644/);
assert.match(expiryArmHelper, /systemctl enable --now "\$EXPIRY_STOP_TIMER"/);
assert.match(expiryArmHelper, /systemctl is-enabled --quiet "\$EXPIRY_STOP_TIMER"/);
assert.match(expiryArmHelper, /systemctl is-active --quiet "\$EXPIRY_STOP_TIMER"/);
assert.doesNotMatch(
  expiryArmHelper,
  /password|psql|supabase|curl|wget|FINANCIAL_ACTIONS_MODE=live/iu,
);
const expiryStopCommand = /\n  expiry-stop\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(expiryStopCommand, 'The helper must define the systemd-only expiry stop command.');
assert.match(expiryStopCommand, /stop_project/);
assert.match(expiryStopCommand, /disarm_expiry_stop/);
assert.match(helper, /"\$command" == 'expiry-stop'/);
assert.match(helper, /-z "\$\{SUDO_USER:-\}"/);
assert.match(helper, /-n "\$\{INVOCATION_ID:-\}"/);
assert.match(helper, /FETANAGENT_STAGING_EXPIRY_GUARD:-\}" == '1'/);
assert.match(helper, /expiry-stop may run only from the fixed systemd guard/);
const normalStopCommand = /\n  stop\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(normalStopCommand, 'The ordinary stop command must remain present.');
assert.match(normalStopCommand, /stop_project/);
assert.match(normalStopCommand, /disarm_expiry_stop/);
const stopProject = /stop_project\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(stopProject, 'The helper must define exact project cleanup.');
assert.match(stopProject, /clear_bot_startup_receipt/);
assert.match(
  helper,
  /if \[\[ "\$command" == 'fresh-start' \]\]; then\s+require_fresh_host_start_ready "\$commit_sha"\s+clear_bot_startup_receipt/,
);
const freshHostIdentity = /require_fresh_host_identity\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(freshHostIdentity, 'The helper must define the exact fresh-host identity gate.');
assert.match(freshHostIdentity, /curl --fail --silent --show-error --noproxy '\*' --max-time 3/);
assert.match(freshHostIdentity, /http:\/\/169\.254\.169\.254\/metadata\/v1\/id/);
assert.doesNotMatch(
  helper.replace(freshHostIdentity, ''),
  /curl|wget|git |\.env|xzztugbgtulptnbpoelr/,
);

const liveApiRuntimeContract = /require_live_api_runtime_contract\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  liveApiRuntimeContract,
  'The helper must re-evaluate the redacted contract inside the exact live API container.',
);
for (const expected of [
  '[[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]]',
  'docker_local container exec "$container_id"',
  'node --input-type=module --eval',
  'fetch("http://127.0.0.1:3000/healthz"',
  'redirect: "error"',
  'signal: AbortSignal.timeout(3000)',
  'response.headers.get("content-type")',
  'contentType?.startsWith("application/json")',
  'response.status !== 200',
  'health.status !== "ok"',
  'health.service !== "fetanagent-api"',
  'runtimeContract.financialActionsMode !== "dry_run"',
  'runtimeContract.playerActionRuntimeEnabled !== true',
  'runtimeContract.depositProofReferenceMastersConfigured !== true',
  'runtimeContract.depositProofReferenceProfileVersion !== 2',
  'process.exit(23)',
  'process.stdout.write(JSON.stringify(runtimeContract))',
  '[[ "$runtime_contract" ==',
  '{"financialActionsMode":"dry_run","playerActionRuntimeEnabled":true,"depositProofReferenceMastersConfigured":true,"depositProofReferenceProfileVersion":2}',
]) {
  assert.ok(
    liveApiRuntimeContract.includes(expected),
    `Live API contract gate missing ${expected}.`,
  );
}
assert.doesNotMatch(
  liveApiRuntimeContract,
  /container logs|console\.|process\.env|\.env|token|password|connection|secret|https?:\/\/(?!127\.0\.0\.1:3000\/healthz)|\b(?:rm|mv|stop|disable|kill|prune)\b/iu,
);
const apiHealthStart = apiSource.indexOf("app.get('/healthz'");
const apiReadyStart = apiSource.indexOf("app.get('/readyz'", apiHealthStart);
assert.ok(
  apiHealthStart >= 0 && apiReadyStart > apiHealthStart,
  'The API health route must exist.',
);
const apiHealthRoute = apiSource.slice(apiHealthStart, apiReadyStart);
for (const expected of [
  'runtimeContract:',
  'financialActionsMode: config.financialActionsMode',
  'playerActionRuntimeEnabled: config.telegramPlayerActionRuntime.enabled',
  'depositProofReferenceMastersConfigured: config.telegramPlayerActionRuntime.enabled',
  'config.telegramPlayerActionRuntime.depositProofReferenceProfileVersion ?? null',
]) {
  assert.ok(apiHealthRoute.includes(expected), `API health runtime contract missing ${expected}.`);
}
assert.doesNotMatch(apiHealthRoute, /password|secret|connection|token/iu);

const clearBotStartupReceipt = /clear_bot_startup_receipt\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(clearBotStartupReceipt, 'The helper must define exact Telegram receipt cleanup.');
assert.match(clearBotStartupReceipt, /root:root:700/);
assert.match(clearBotStartupReceipt, /root:root:600/);
assert.match(clearBotStartupReceipt, /rm -f -- "\$BOT_STARTUP_RECEIPT"/);
assert.match(clearBotStartupReceipt, /rmdir -- "\$BOT_STARTUP_RECEIPT_ROOT"/);
assert.doesNotMatch(clearBotStartupReceipt, /rm -rf|find|glob|\*/);

const recordBotStartupReceipt = /record_fresh_bot_startup_receipt\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(recordBotStartupReceipt, 'The helper must seal the immediate Telegram startup proof.');
for (const expected of [
  'label=com.docker.compose.project=$PROJECT_NAME',
  'label=com.docker.compose.service=bot',
  '{{.Id}}',
  '{{.State.StartedAt}}',
  'org.opencontainers.image.revision',
  '[[ "$revision" == "$commit_sha" ]]',
  '{{.State.Status}}',
  '{{.RestartCount}}',
  'docker_local container logs --tail 80 "$container_id"',
  'Telegram bot started with configured private admission and action handlers.',
  'install -d -o root -g root -m 0700 "$BOT_STARTUP_RECEIPT_ROOT"',
  'mktemp "$BOT_STARTUP_RECEIPT_ROOT/.bot-v1.XXXXXX"',
  '"receipt_version=$BOT_STARTUP_RECEIPT_VERSION"',
  '"commit_sha=$commit_sha"',
  '"container_id=$full_container_id"',
  '"container_started_at=$container_started_at"',
  "'restart_count=0'",
  "'startup_contract=telegram-private-admission-actions-v1'",
  'mv -fT -- "$temporary" "$BOT_STARTUP_RECEIPT"',
  'rm -f -- "$temporary"',
  'the Telegram startup receipt could not be sealed atomically',
]) {
  assert.ok(recordBotStartupReceipt.includes(expected), `Bot startup receipt missing ${expected}.`);
}
assert.doesNotMatch(recordBotStartupReceipt, /token|password|secret/iu);
assert.match(
  recordBotStartupReceipt,
  /if ! printf[\s\S]*! chown[\s\S]*! chmod[\s\S]*! mv[\s\S]*then\s+rm -f -- "\$temporary"/,
);

const requireBotStartupReceipt = /require_fresh_bot_startup_receipt\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(requireBotStartupReceipt, 'The helper must bind steady Telegram state to its receipt.');
for (const expected of [
  'root:root:700',
  'root:root:600',
  '{{.Id}}',
  '{{.State.StartedAt}}',
  '{{.RestartCount}}',
  'cmp -s -- "$BOT_STARTUP_RECEIPT"',
  '"receipt_version=$BOT_STARTUP_RECEIPT_VERSION"',
  '"commit_sha=$commit_sha"',
  '"container_id=$full_container_id"',
  '"container_started_at=$container_started_at"',
  "'restart_count=0'",
  "'startup_contract=telegram-private-admission-actions-v1'",
]) {
  assert.ok(
    requireBotStartupReceipt.includes(expected),
    `Bot startup receipt gate missing ${expected}.`,
  );
}
assert.doesNotMatch(
  requireBotStartupReceipt,
  /container logs|token|password|secret|\b(?:rm|mv|stop|disable|kill|prune)\b/iu,
);

const freshBotRuntime = /require_exact_fresh_bot_runtime\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(freshBotRuntime, 'The helper must define an exact fresh-host Telegram runtime gate.');
assert.match(freshBotRuntime, /local startup_contract_mode="\$2"/);
assert.match(
  freshBotRuntime,
  /"\$startup_contract_mode" == 'immediate-startup' \|\| "\$startup_contract_mode" == 'steady-state'/,
);
assert.match(freshBotRuntime, /api beta-admission bot customer-web owner-control/);
assert.match(freshBotRuntime, /NODE_ENV=production/);
assert.match(freshBotRuntime, /FINANCIAL_ACTIONS_MODE=dry_run/);
assert.match(freshBotRuntime, /TELEGRAM_BOT_ENABLED=true/);
assert.match(freshBotRuntime, /TELEGRAM_BETA_ADMISSION_ENABLED=true/);
assert.match(freshBotRuntime, /KEMERBET_EXECUTOR_ENABLED=false/);
assert.match(freshBotRuntime, /KEMERBET_FINAL_ACTION_ENABLED=false/);
assert.match(freshBotRuntime, /INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false/);
assert.match(freshBotRuntime, /INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true/);
assert.match(
  freshBotRuntime,
  /DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=\/run\/secrets\/deposit_proof_reference_encryption_master/,
);
assert.match(
  freshBotRuntime,
  /DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=\/run\/secrets\/deposit_proof_reference_fingerprint_master/,
);
assert.match(
  freshBotRuntime,
  /DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=\/etc\/fetanagent\/deposit-proof-reference-profile\.v2\.json/,
);
assert.match(freshBotRuntime, /require_live_api_runtime_contract "\$ids"/);
assert.match(freshBotRuntime, /RestartCount/);
assert.match(
  freshBotRuntime,
  /Telegram bot started with configured private admission and action handlers\./,
);
assert.match(
  freshBotRuntime,
  /if \[\[ "\$startup_contract_mode" == 'immediate-startup' \]\]; then[\s\S]*container logs --tail 80[\s\S]*else[\s\S]*require_fresh_bot_startup_receipt "\$commit_sha" "\$ids"/,
);
assert.equal(
  (freshBotRuntime.match(/container logs --tail 80/g) ?? []).length,
  1,
  'Only immediate Telegram activation may inspect the bounded startup log.',
);
assert.match(
  botSource,
  /Telegram bot started with configured private admission and action handlers\./,
);
assert.doesNotMatch(freshBotRuntime, /\bcat\b|token=|password=|echo [^\n]*(?:SECRET|PROFILE)/);

const freshPrivateRuntime = /require_exact_fresh_private_runtime\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(freshPrivateRuntime, 'The helper must define an exact fresh-host private runtime gate.');
assert.match(freshPrivateRuntime, /FINANCIAL_ACTIONS_MODE=dry_run/);
assert.match(freshPrivateRuntime, /KEMERBET_EXECUTOR_ENABLED=false/);
assert.match(freshPrivateRuntime, /KEMERBET_FINAL_ACTION_ENABLED=false/);
assert.match(freshPrivateRuntime, /INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false/);
assert.match(
  freshPrivateRuntime,
  /INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true/,
);
assert.match(freshPrivateRuntime, /require_live_api_runtime_contract "\$ids"/);
assert.doesNotMatch(freshPrivateRuntime, /container logs/);

const disabledBotReady = /require_fresh_bot_disabled_ready\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(disabledBotReady, 'The helper must define the fresh-host disabled-bot gate.');
assert.match(disabledBotReady, /require_exact_fresh_private_runtime "\$commit_sha"/);
assert.match(disabledBotReady, /telegram-disabled-until-separate-smoke/);

const installBotToken = /\n  install-bot-token\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(installBotToken, 'The helper must define exact protected bot-token installation.');
assert.match(installBotToken, /\/tmp\/fetanagent-bot-token-\$commit_sha/);
assert.match(installBotToken, /\$EXPECTED_SUDO_USER:600/);
assert.match(installBotToken, /\^\[0-9\]\{8,12\}:\[A-Za-z0-9_-\]\{35,\}\$/);
assert.match(installBotToken, /install -o 10001 -g 10001 -m 0400/);
assert.match(installBotToken, /rm -f -- "\$incoming"/);
assert.doesNotMatch(installBotToken, /echo|cat|docker|curl|wget/);

const startBot = /\n  start-bot\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(startBot, 'The helper must define the isolated Telegram bot start boundary.');
assert.match(startBot, /require_exact_fresh_private_runtime "\$commit_sha"/);
assert.match(startBot, /fetanagent-bot:\$image_tag/);
assert.match(startBot, /--env-file \/dev\/null/);
assert.match(startBot, /clear_bot_startup_receipt/);
assert.match(startBot, /up -d --no-build --no-deps bot/);
assert.doesNotMatch(startBot, /gateway|FINANCIAL_ACTIONS_MODE=live|KEMERBET_.*=true/);

const stopBot = /\n  stop-bot\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(stopBot, 'The helper must define a fail-closed Telegram bot stop boundary.');
assert.match(stopBot, /com\.docker\.compose\.service=bot/);
assert.match(stopBot, /container rm --force/);
assert.match(stopBot, /clear_bot_startup_receipt/);
assert.match(stopBot, /telegram-disabled-until-separate-smoke/);
assert.match(stopBot, /require_fresh_bot_disabled_ready "\$commit_sha"/);
assert.doesNotMatch(stopBot, /stop_project|network rm|owner-control|api|beta-admission/);

const botReady = /\n  bot-ready\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(
  botReady,
  'The helper must define the immediate Telegram readiness and receipt boundary.',
);
assert.match(botReady, /require_exact_fresh_bot_runtime "\$2" immediate-startup/);
assert.match(botReady, /record_fresh_bot_startup_receipt "\$2"/);
assert.match(botReady, /require_exact_fresh_bot_runtime "\$2" steady-state/);
const botRuntimeCalls = [
  ...helper.matchAll(
    /require_exact_fresh_bot_runtime "(\$(?:commit_sha|2))" (immediate-startup|steady-state)/gu,
  ),
].map((match) => `${match[1]} ${match[2]}`);
assert.deepEqual(botRuntimeCalls, [
  '$commit_sha steady-state',
  '$2 immediate-startup',
  '$2 steady-state',
  '$commit_sha steady-state',
]);

const ownerDiagnostic = /diagnose-owner-startup\)([\s\S]*?)\n\s*;;/u.exec(helper)?.[1];
assert.ok(ownerDiagnostic, 'The helper must define bounded Owner-control startup diagnostics.');
assert.match(ownerDiagnostic, /com\.docker\.compose\.project=\$PROJECT_NAME/);
assert.match(ownerDiagnostic, /com\.docker\.compose\.service=owner-control/);
assert.match(ownerDiagnostic, /org\.opencontainers\.image\.revision/);
assert.match(ownerDiagnostic, /container logs --tail 80/);
assert.doesNotMatch(ownerDiagnostic, /inspect .*\{\{json \.Config\}\}|container logs .*bot/);

console.log(
  'staging deploy workflow verified: manual exact-target guards, read-only exact-IP ban gate, sealed images, bounded runtime credentials, host-local stop-before-expiry, checksummed root helper, and explicit stop path',
);
