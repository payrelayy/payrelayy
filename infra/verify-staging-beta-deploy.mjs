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
const kemerbetSessionWorkflow = readFileSync(
  resolve(root, '.github/workflows/staging-kemerbet-session-provision.yml'),
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
  '33f4a5a4ba56fa86aa34cdc9a899117d327ed06a58b3cb5d7e9453c28afad5ba';
const installedHelperBackupName = 'fetanagent-staging-deploy-helper.previous-33f4a5a4';
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

function assertInOrder(source, requiredFragments, message) {
  let position = -1;
  for (const fragment of requiredFragments) {
    const nextPosition = source.indexOf(fragment, position + 1);
    assert.ok(nextPosition > position, `${message}: missing or out of order: ${fragment}`);
    position = nextPosition;
  }
}

for (const artifact of [
  workflow,
  botWorkflow,
  kemerbetSessionWorkflow,
  qualityWorkflow,
  compose,
  helper,
  stagingRunbook,
]) {
  assert.doesNotMatch(
    artifact,
    retiredDepositReferenceProtection,
    'the retired single-key deposit-reference input must remain absent',
  );
}

const ownerCompose = /\n  owner-control:\n([\s\S]*?)\n  kemerbet-session-provision:/u.exec(
  compose,
)?.[1];
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
assert.match(ownerCompose, /source: kemerbet_session_control/);
assert.match(ownerCompose, /target: \/run\/fetanagent-kemerbet-session-control/);

for (const requiredSessionWorkflowContract of [
  /workflow_dispatch:/,
  /permissions:\s*\r?\n\s+actions: read\s*\r?\n\s+contents: read/,
  /group: fetanagent-staging-beta-deploy/,
  /STAGING_PROJECT_REF: spzpiyxheappsfyswewl/,
  /PRODUCTION_PROJECT_REF: xzztugbgtulptnbpoelr/,
  /STAGING_DROPLET_ID: '593344964'/,
  /GITHUB_REF" == 'refs\/heads\/main'/,
  /CONFIRMED_COMMIT.*GITHUB_SHA/,
  /CONFIRMED_PROJECT.*STAGING_PROJECT_REF/,
  /CONFIRMED_PROJECT.*PRODUCTION_PROJECT_REF/,
  /CONFIRMED_DROPLET.*STAGING_DROPLET_ID/,
  /private-sign-in-no-transfer/,
  /seal-five-player-no-transfer/,
  /independent-five-player-no-transfer-recheck/,
  /CONFIRMED_PRIOR_SEAL_COMMIT/,
  /CONFIRMED_PRIOR_SEAL_RUN_ID/,
  /\^\(inspect\|start\|seal\|recheck\|stop\)\$/,
  /\^\[0-9a-f\]\{40\}\$/,
  /\^\[1-9\]\[0-9\]\{7,19\}\$/,
  /environment: staging/,
  /persist-credentials: false/,
  /StrictHostKeyChecking=yes/g,
  /fetanagent-staging-deploy-helper verify/,
  /fetanagent-staging-deploy-helper start-kemerbet-session-provision/,
  /fetanagent-staging-deploy-helper kemerbet-session-provision-ready/,
  /fetanagent-staging-deploy-helper seal-kemerbet-readiness/,
  /fetanagent-staging-deploy-helper recheck-kemerbet-readiness '\$GITHUB_SHA' '\$\{GITHUB_SHA:0:12\}'/,
  /fetanagent-staging-deploy-helper stop-kemerbet-session-provision/,
  /GITHUB_API_URL\/repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$CONFIRMED_PRIOR_SEAL_RUN_ID/,
  /\.head_sha == \$sha/,
  /\.head_branch == "main"/,
  /\.head_repository\.full_name == \$repository/,
  /\.event == "workflow_dispatch"/,
  /\.status == "completed"/,
  /\.conclusion == "success"/,
  /\.name == "Staging private KemerBet sign-in"/,
  /\.path == "\.github\/workflows\/staging-kemerbet-session-provision\.yml"/,
  /KemerBet readiness sealed: 5 of 5 Players, Transfer disabled\./,
  /if matches != 1:/,
  /prior_kemerbet_readiness_seal=verified/,
  /private_kemerbet_independent_no_transfer_recheck=pass/,
  /private_kemerbet_sign_in_no_transfer=pass/,
]) {
  assert.match(kemerbetSessionWorkflow, requiredSessionWorkflowContract);
}
assert.equal(
  (kemerbetSessionWorkflow.match(/^\s+actions: read$/gm) ?? []).length,
  2,
  'both the workflow and its job-level permission override must retain actions:read',
);
const priorSealVerification =
  /- name: Verify the exact prior successful readiness seal([\s\S]*?)\n\s+- name: Run the exact private sign-in action/u.exec(
    kemerbetSessionWorkflow,
  )?.[1];
assert.ok(
  priorSealVerification,
  'the recheck must independently inspect the exact prior successful seal run as a separate historical gate',
);
assert.equal(
  (priorSealVerification.match(/curl --fail --silent --show-error --location/g) ?? []).length,
  2,
  'both GitHub API responses must be written silently to protected files',
);
assert.match(priorSealVerification, /"\$metadata" >\/dev\/null/);
assert.match(priorSealVerification, /with archive\.open\(entry\) as stream:/);
assert.match(
  priorSealVerification,
  /except \(OSError, RuntimeError, zipfile\.BadZipFile\):\s*\r?\n\s+raise SystemExit\('The seal log archive could not be safely inspected\.'\) from None/,
);
assert.deepEqual(
  [...priorSealVerification.matchAll(/^\s+echo (.+)$/gm)].map((match) => match[1]),
  ["'prior_kemerbet_readiness_seal=verified'"],
  'the historical seal gate may emit only one fixed aggregate verification result',
);
assert.doesNotMatch(
  priorSealVerification,
  /set -x|curl[^\r\n]*(?:--verbose|-v(?:\s|$))|\btee\b|\bunzip\b|extractall?\(|\bprint\(|sys\.stdout|GITHUB_STEP_SUMMARY|actions\/upload-artifact|::debug|\b(?:head|tail|sed|awk|grep|cat)\b/iu,
  'the provenance step must never print, extract, summarize, or upload protected metadata or raw logs',
);
const privateSignInAction =
  /- name: Run the exact private sign-in action([\s\S]*?)\n\s+- name: Stop the private sign-in browser/u.exec(
    kemerbetSessionWorkflow,
  )?.[1];
assert.ok(
  privateSignInAction,
  'the exact private sign-in SSH action must remain separately bounded',
);
assert.match(
  privateSignInAction,
  /fetanagent-staging-deploy-helper recheck-kemerbet-readiness '\$GITHUB_SHA' '\$\{GITHUB_SHA:0:12\}'/,
);
assert.doesNotMatch(
  privateSignInAction,
  /CONFIRMED_PRIOR_SEAL|prior_seal|sealed_(?:commit|release)|seal_run/iu,
  'historical CI seal provenance must never be exported or passed to the target-host recheck',
);
assert.doesNotMatch(
  kemerbetSessionWorkflow,
  /root@|ssh-keyscan|StrictHostKeyChecking=no|sudo -n (?:docker|bash)|docker\.sock|\bpsql\b|\bsupabase\b|actions: write|FINANCIAL_ACTIONS_MODE: live|KEMERBET_EXECUTOR_ENABLED: 'true'|KEMERBET_FINAL_ACTION_ENABLED: 'true'|gh run view|unzip -p|\bcat\b[^\r\n]*seal-run/,
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
assert.equal(
  (
    helperReplacementRunbook.match(
      /test "\$\(stat --format='%U:%G:%a' \/etc\/sudoers\.d\)" = 'root:root:750'/g,
    ) ?? []
  ).length,
  2,
  'both helper rotation directions must preserve the exact hardened sudoers directory mode observed on the current host',
);
assert.doesNotMatch(
  helperReplacementRunbook,
  /test "\$\(stat --format='%U:%G:%a' \/etc\/sudoers\.d\)" = 'root:root:755'/,
  'helper rotation must not require relaxing the current host sudoers directory permissions',
);
assert.match(
  helperReplacementRunbook,
  /fetanagent-admin ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/fetanagent-staging-deploy-helper \*/,
);
assert.match(helperReplacementRunbook, /visudo -cf \/etc\/sudoers/);
assert.doesNotMatch(helperReplacementRunbook, /fetanagent-vm-transition (?:rotate|verify|inspect)/);
assert.match(helperReplacementRunbook, /sync -f "\$BACKUP"/);
assert.match(helperReplacementRunbook, /sync -f "\$STAGING_ROOT"/);
assert.match(
  helperReplacementRunbook,
  /Do not create, copy, or update VM-transition receipts on Droplet\s+`593344964`/u,
  'fresh-host helper rotation must not create or mutate retired-host transition receipts',
);
assert.equal(
  (
    helperReplacementRunbook.match(
      /MUTATION_LOCK_ROOT='\/run\/fetanagent-staging-deploy-helper'/g,
    ) ?? []
  ).length,
  2,
  'both helper replacement and rollback must use the successor helper mutation-lock root',
);
assert.equal(
  (helperReplacementRunbook.match(/MUTATION_LOCK="\$MUTATION_LOCK_ROOT\/mutation\.lock"/g) ?? [])
    .length,
  2,
  'both helper replacement and rollback must use the exact successor mutation-lock path',
);
assert.equal(
  (
    helperReplacementRunbook.match(
      /SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.rotation-disabled'/g,
    ) ?? []
  ).length,
  2,
  'both rotation directions must use the same ignored same-filesystem sudoers quiescence path',
);
assert.equal(
  (helperReplacementRunbook.match(/flock --exclusive --nonblock 9/g) ?? []).length,
  2,
  'both helper replacement and rollback must hold the nonblocking exclusive mutation lock',
);
assert.equal(
  (
    helperReplacementRunbook.match(
      /if \[\[ ! -e "\$MUTATION_LOCK_ROOT" && ! -L "\$MUTATION_LOCK_ROOT" \]\]/g,
    ) ?? []
  ).length,
  2,
  'both helper replacement and rollback must recreate the volatile safe lock root after reboot',
);
assert.equal(
  (
    helperReplacementRunbook.match(
      /\(set -o noclobber; umask 077; : >"\$MUTATION_LOCK"\) 2>\/dev\/null \|\| true/g,
    ) ?? []
  ).length,
  2,
  'both helper replacement and rollback must race-safely create the volatile lock with a restrictive umask',
);
for (const rotationBoundary of [
  /test ! -L \/run && test -d \/run && test "\$\(realpath -- \/run\)" = '\/run'/,
  /root:root:755/,
  /root:root:700/,
  /root:root:600:1/,
  /path_identity="\$\(stat --format='%u:%g:%a:%h:%d:%i' "\$MUTATION_LOCK"\)"/,
  /fd_identity="\$\(stat -L --format='%u:%g:%a:%h:%d:%i' \/proc\/self\/fd\/9\)"/,
  /test "\$fd_identity" = "\$path_identity"/,
  /case "\$fd_identity" in 0:0:600:1:\*\) ;; \*\) false ;; esac/,
  /test "\$\(stat --format='%u:%g:%a:%h:%d:%i' "\$MUTATION_LOCK"\)" = "\$fd_identity"/,
  /mv -- "\$SUDOERS" "\$SUDOERS_DISABLED"/,
  /sync -f \/etc\/sudoers\.d/,
  /require_no_helper_processes/,
  /require_allowed_helper_for_sudoers_restore/,
  /trap restore_sudoers_on_exit EXIT/,
  /restore_sudoers_grant/,
]) {
  assert.equal(
    (helperReplacementRunbook.match(new RegExp(rotationBoundary.source, 'gu')) ?? []).length >= 2,
    true,
    `both helper rotation directions must retain ${rotationBoundary}`,
  );
}
assert.equal(
  (
    helperReplacementRunbook.match(
      /test "\$\(systemctl show --property=LoadState --value \\\n  fetanagent-staging-runtime-expiry-stop\.timer\)" = 'not-found'/g,
    ) ?? []
  ).length,
  4,
  'replacement and rollback must prove the expiry timer is unloaded before and after quiescence',
);
assert.equal(
  (
    helperReplacementRunbook.match(
      /test "\$\(systemctl show --property=LoadState --value \\\n  fetanagent-staging-runtime-expiry-stop\.service\)" = 'not-found'/g,
    ) ?? []
  ).length,
  4,
  'replacement and rollback must prove the expiry service is unloaded before and after quiescence',
);
assert.equal(
  (
    helperReplacementRunbook.match(
      /test ! -e \/etc\/systemd\/system\/fetanagent-staging-runtime-expiry-stop\.service && \\\n  test ! -L \/etc\/systemd\/system\/fetanagent-staging-runtime-expiry-stop\.service/g,
    ) ?? []
  ).length,
  4,
  'replacement and rollback must prove no expiry service unit path exists at either boundary',
);
const sudoersRestoreFunctions = [
  ...helperReplacementRunbook.matchAll(/restore_sudoers_grant\(\) \{([\s\S]*?)\n\}/gu),
].map((match) => match[1]);
assert.equal(sudoersRestoreFunctions.length, 2);
for (const restoreFunction of sudoersRestoreFunctions) {
  for (const restoreContract of [
    /require_allowed_helper_for_sudoers_restore \|\| return 1/,
    /require_exact_sudoers_file "\$SUDOERS_DISABLED" \|\| return 1/,
    /test ! -e "\$SUDOERS" && test ! -L "\$SUDOERS" \|\| return 1/,
    /mv -- "\$SUDOERS_DISABLED" "\$SUDOERS" \|\| return 1/,
    /sync -f \/etc\/sudoers\.d \|\| return 1/,
    /visudo -cf \/etc\/sudoers >\/dev\/null \|\| return 1/,
  ]) {
    assert.match(restoreFunction, restoreContract);
  }
  assert.ok(
    restoreFunction.indexOf('require_allowed_helper_for_sudoers_restore') <
      restoreFunction.indexOf('mv -- "$SUDOERS_DISABLED" "$SUDOERS"'),
    'the NOPASSWD grant must remain disabled unless TARGET is an exact reviewed helper',
  );
  assert.equal(
    (restoreFunction.match(/sync -f \/etc\/sudoers\.d \|\| return 1/g) ?? []).length,
    2,
    'both already-restored and rename-restored sudoers paths must durably sync the include directory',
  );
}
const allowedHelperRestoreFunctions = [
  ...helperReplacementRunbook.matchAll(
    /require_allowed_helper_for_sudoers_restore\(\) \{([\s\S]*?)\n\}/gu,
  ),
].map((match) => match[1]);
assert.equal(allowedHelperRestoreFunctions.length, 2);
for (const allowedHelperFunction of allowedHelperRestoreFunctions) {
  for (const contract of [
    /test ! -L "\$TARGET" && test -f "\$TARGET" \|\| return 1/,
    /test "\$\(realpath -- "\$TARGET"\)" = "\$TARGET" \|\| return 1/,
    /test "\$\(stat --format='%U:%G:%a:%h' "\$TARGET"\)" = 'root:root:755:1' \|\| return 1/,
    /helper_sha="\$\(sha256sum "\$TARGET" \| awk '\{ print \$1 \}'\)" \|\| return 1/,
    /\[\[ "\$helper_sha" == "\$PREVIOUS_SHA" \|\| "\$helper_sha" == "\$NEXT_SHA" \]\] \|\| return 1/,
    /bash -n "\$TARGET" \|\| return 1/,
  ]) {
    assert.match(allowedHelperFunction, contract);
  }
}
const exactSudoersFileFunctions = [
  ...helperReplacementRunbook.matchAll(/require_exact_sudoers_file\(\) \{([\s\S]*?)\n\}/gu),
].map((match) => match[1]);
assert.equal(exactSudoersFileFunctions.length, 2);
for (const exactSudoersFileFunction of exactSudoersFileFunctions) {
  for (const contract of [
    /test ! -L "\$path" && test -f "\$path" \|\| return 1/,
    /test "\$\(realpath -- "\$path"\)" = "\$path" \|\| return 1/,
    /test "\$\(stat --format='%U:%G:%a:%h' "\$path"\)" = 'root:root:440:1' \|\| return 1/,
    /cmp -s -- "\$path" <\(expected_sudoers\) \|\| return 1/,
  ]) {
    assert.match(exactSudoersFileFunction, contract);
  }
}
const helperReplacement =
  /<<'FETANAGENT_HELPER_REPLACE'\n([\s\S]*?)\nFETANAGENT_HELPER_REPLACE/u.exec(
    helperReplacementRunbook,
  )?.[1];
assert.ok(helperReplacement, 'The exact successor replacement procedure must be documented.');
for (const replacementResumeContract of [
  /SUDOERS_STATE=''/,
  /if \[\[ -e "\$SUDOERS" \|\| -L "\$SUDOERS" \]\]; then/,
  /elif \[\[ -e "\$SUDOERS_DISABLED" \|\| -L "\$SUDOERS_DISABLED" \]\]; then/,
  /SUDOERS_STATE='enabled'/,
  /SUDOERS_STATE='disabled'/,
  /TARGET_SHA="\$\(sha256sum "\$TARGET"/,
  /"\$TARGET_SHA" == "\$PREVIOUS_SHA" \|\| "\$TARGET_SHA" == "\$NEXT_SHA"/,
  /if \[\[ -e "\$BACKUP" \|\| -L "\$BACKUP" \]\]; then/,
  /test "\$TARGET_SHA" = "\$PREVIOUS_SHA"/,
  /if \[\[ "\$SUDOERS_STATE" == 'enabled' \]\]; then/,
  /INSTALL_TMP_PATH='\/usr\/local\/sbin\/\.fetanagent-staging-deploy-helper\.installing-b4664efd'/,
  /BACKUP_TMP_PATH="\$STAGING_ROOT\/\.fetanagent-staging-deploy-helper\.previous-33f4a5a4\.installing"/,
]) {
  assert.match(helperReplacement, replacementResumeContract);
}
const replacementBackupTempAssign = helperReplacement.indexOf('BACKUP_TMP="$BACKUP_TMP_PATH"');
const replacementBackupTempInstall = helperReplacement.indexOf(
  'install -o root -g root -m 0600 "$TARGET" "$BACKUP_TMP"',
  replacementBackupTempAssign,
);
const replacementBackupTempHash = helperReplacement.indexOf(
  'sha256sum "$BACKUP_TMP"',
  replacementBackupTempInstall,
);
const replacementBackupTempSync = helperReplacement.indexOf(
  'sync -f "$BACKUP_TMP"',
  replacementBackupTempHash,
);
const replacementBackupRename = helperReplacement.indexOf(
  'mv -- "$BACKUP_TMP" "$BACKUP"',
  replacementBackupTempSync,
);
const replacementBackupFileSync = helperReplacement.indexOf(
  'sync -f "$BACKUP"',
  replacementBackupRename,
);
const replacementBackupDirectorySync = helperReplacement.indexOf(
  'sync -f "$STAGING_ROOT"',
  replacementBackupFileSync,
);
assert.ok(
  replacementBackupTempAssign >= 0 &&
    replacementBackupTempAssign < replacementBackupTempInstall &&
    replacementBackupTempInstall < replacementBackupTempHash &&
    replacementBackupTempHash < replacementBackupTempSync &&
    replacementBackupTempSync < replacementBackupRename &&
    replacementBackupRename < replacementBackupFileSync &&
    replacementBackupFileSync < replacementBackupDirectorySync,
  'the predecessor backup must use a fixed recoverable temp, exact hash, file fsync, atomic rename, and directory fsync',
);
const replacementInstall = helperReplacement.indexOf(
  'install -o root -g root -m 0755 "$STAGED" "$INSTALL_TMP"',
);
const replacementSudoersRevoke = helperReplacement.indexOf('mv -- "$SUDOERS" "$SUDOERS_DISABLED"');
const replacementQuiescence = helperReplacement.indexOf(
  'require_no_helper_processes',
  replacementSudoersRevoke,
);
const replacementLock = helperReplacement.indexOf(
  'flock --exclusive --nonblock 9',
  replacementQuiescence,
);
const replacementPostLockQuiescence = helperReplacement.indexOf(
  'require_no_helper_processes',
  replacementLock,
);
const replacementHash = helperReplacement.indexOf('sha256sum "$INSTALL_TMP"', replacementInstall);
const replacementSync = helperReplacement.indexOf('sync -f "$INSTALL_TMP"', replacementHash);
const replacementRename = helperReplacement.indexOf(
  'mv -- "$INSTALL_TMP" "$TARGET"',
  replacementSync,
);
const replacementDirectorySync = helperReplacement.indexOf(
  'sync -f "$(dirname -- "$TARGET")"',
  replacementRename,
);
const replacementTargetVerification = helperReplacement.indexOf(
  'test "$(sha256sum "$TARGET"',
  helperReplacement.indexOf('mv -- "$INSTALL_TMP" "$TARGET"'),
);
const replacementSudoersRestore = helperReplacement.lastIndexOf('restore_sudoers_grant');
const replacementVerify = helperReplacementRunbook.indexOf('transition-ssh-verify');
assert.ok(
  replacementInstall >= 0 &&
    replacementSudoersRevoke >= 0 &&
    replacementSudoersRevoke < replacementQuiescence &&
    replacementQuiescence < replacementLock &&
    replacementLock < replacementPostLockQuiescence &&
    replacementLock >= 0 &&
    replacementLock < replacementInstall &&
    replacementInstall < replacementHash &&
    replacementHash < replacementSync &&
    replacementSync < replacementRename &&
    replacementRename < replacementDirectorySync &&
    replacementTargetVerification > replacementRename &&
    replacementSudoersRestore > replacementTargetVerification &&
    replacementRename < replacementVerify,
  'The predecessor grant must be revoked and quiesced before the exact helper is atomically installed, verified, and re-enabled.',
);
const helperRestore = /<<'FETANAGENT_HELPER_RESTORE'\n([\s\S]*?)\nFETANAGENT_HELPER_RESTORE/u.exec(
  helperReplacementRunbook,
)?.[1];
assert.ok(helperRestore, 'The exact predecessor restore procedure must be documented.');
for (const restoreContract of [
  /MUTATION_LOCK_ROOT='\/run\/fetanagent-staging-deploy-helper'/,
  /MUTATION_LOCK="\$MUTATION_LOCK_ROOT\/mutation\.lock"/,
  /SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.rotation-disabled'/,
  /mv -- "\$SUDOERS" "\$SUDOERS_DISABLED"/,
  /require_no_helper_processes/,
  /flock --exclusive --nonblock 9/,
  /METADATA='http:\/\/169\.254\.169\.254\/metadata\/v1'/,
  /593344964/,
  /161\.35\.41\.232/,
  /fetanagent-staging-runtime-expiry-stop\.timer/,
  /label=com\.docker\.compose\.project=fetanagent-staging-beta/,
  /test ! -L "\$TARGET"/,
  /root:root:755/,
  /TARGET_SHA="\$\(sha256sum "\$TARGET"/,
  /"\$TARGET_SHA" == "\$PREVIOUS_SHA" \|\| "\$TARGET_SHA" == "\$NEXT_SHA"/,
  /sha256sum "\$TARGET"[^\n]*"\$PREVIOUS_SHA"/,
]) {
  assert.match(helperRestore, restoreContract);
}
for (const restoreResumeContract of [
  /SUDOERS_STATE=''/,
  /SUDOERS_STATE='enabled'/,
  /SUDOERS_STATE='disabled'/,
  /if \[\[ "\$SUDOERS_STATE" == 'enabled' \]\]; then/,
  /RESTORE_TMP_PATH='\/usr\/local\/sbin\/\.fetanagent-staging-deploy-helper\.restoring-33f4a5a4'/,
  /if \[\[ "\$TARGET_SHA" == "\$NEXT_SHA" \]\]; then/,
  /RESTORE_TMP="\$RESTORE_TMP_PATH"/,
]) {
  assert.match(helperRestore, restoreResumeContract);
}
for (const exactBackupContract of [
  /test ! -L "\$BACKUP" && test -f "\$BACKUP"/g,
  /test "\$\(realpath -- "\$BACKUP"\)" = "\$BACKUP"/g,
  /test "\$\(stat --format='%U:%G:%a:%h' "\$BACKUP"\)" = 'root:root:600:1'/g,
  /test "\$\(sha256sum "\$BACKUP" \| awk '\{ print \$1 \}'\)" = "\$PREVIOUS_SHA"/g,
]) {
  assert.equal(
    (helperRestore.match(exactBackupContract) ?? []).length,
    2,
    'rollback must re-prove the exact regular canonical single-link predecessor backup after quiescence',
  );
}
const preRecheckRollbackState = /require_pre_recheck_rollback_state\(\) \{[\s\S]*?\n\}/u.exec(
  helperRestore,
)?.[0];
assert.ok(preRecheckRollbackState, 'rollback must define its pre-recheck compatibility boundary');
for (const preRecheckContract of [
  /RECHECK_PROMOTION_ROOT/,
  /RECHECK_RECEIPT_ROOT/,
  /RECHECK_CANDIDATE_ROOT/,
  /CANONICAL_BINDING/,
  /10001:10001:400:1/,
  /10001:10001:700/,
  /kemerbet_agent_identity_bindings/,
  /10001:10001:600:1/,
  /\|\| return 1/,
]) {
  assert.match(preRecheckRollbackState, preRecheckContract);
}
assert.equal(
  (helperRestore.match(/\brequire_pre_recheck_rollback_state\b/g) ?? []).length,
  5,
  'rollback compatibility must be defined, checked before and after locking, and checked in both sudoers-restoration branches',
);
const restoreTargetProof = helperRestore.indexOf('sha256sum "$TARGET"');
const restoreSudoersRevoke = helperRestore.indexOf('mv -- "$SUDOERS" "$SUDOERS_DISABLED"');
const restoreQuiescence = helperRestore.indexOf(
  'require_no_helper_processes',
  restoreSudoersRevoke,
);
const restoreLock = helperRestore.indexOf('flock --exclusive --nonblock 9', restoreQuiescence);
const restoreTemporary = helperRestore.indexOf('RESTORE_TMP="$RESTORE_TMP_PATH"', restoreLock);
const restoreSync = helperRestore.indexOf('sync -f "$RESTORE_TMP"', restoreTemporary);
const restoreRename = helperRestore.indexOf('mv -- "$RESTORE_TMP" "$TARGET"');
const restoreDirectorySync = helperRestore.indexOf(
  'sync -f "$(dirname -- "$TARGET")"',
  restoreRename,
);
const restoredTargetVerification = helperRestore.indexOf(
  'test "$(sha256sum "$TARGET"',
  restoreRename,
);
const restoreSudoersGrant = helperRestore.lastIndexOf('restore_sudoers_grant');
assert.ok(
  restoreTargetProof >= 0 &&
    restoreTargetProof < restoreSudoersRevoke &&
    restoreSudoersRevoke < restoreQuiescence &&
    restoreQuiescence < restoreLock &&
    restoreLock < restoreTemporary &&
    restoreTemporary < restoreSync &&
    restoreSync < restoreRename &&
    restoreRename < restoreDirectorySync &&
    restoredTargetVerification > restoreRename &&
    restoreSudoersGrant > restoredTargetVerification,
  'rollback must revoke and quiesce the grant, prove the installed successor, restore the checksum-proven predecessor, verify it, and only then re-enable sudo',
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
assert.match(freshBotRuntime, /published-steady-state/);
assert.match(freshBotRuntime, /published-with-kemerbet-session/);
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

const startKemerbetSession = /\n  start-kemerbet-session-provision\)([\s\S]*?)\n    ;;/u.exec(
  helper,
)?.[1];
assert.ok(startKemerbetSession, 'The helper must define the private no-transfer sign-in start.');
assert.match(
  startKemerbetSession,
  /require_exact_fresh_bot_runtime "\$commit_sha" published-steady-state/,
);
assert.match(startKemerbetSession, /fetanagent-deposit-executor:\$image_tag/);
assert.match(
  startKemerbetSession,
  /require_kemerbet_identity_key_file "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
);
assert.match(startKemerbetSession, /require_service_file "\$KEMERBET_READINESS_PLAYER_IDS"/);
assert.match(startKemerbetSession, /require_immutable_config_file "\$KEMERBET_SELECTOR_CONTRACT"/);
assert.match(startKemerbetSession, /require_kemerbet_readiness_output_directory/);
assert.match(startKemerbetSession, /--profile kemerbet-session-provision/);
assert.match(
  startKemerbetSession,
  /up -d --no-build --no-deps --wait --wait-timeout 90 kemerbet-session-provision/,
);
assert.match(startKemerbetSession, /require_kemerbet_session_provision_runtime "\$commit_sha"/);
assert.doesNotMatch(startKemerbetSession, /FINANCIAL_ACTIONS_MODE=live|KEMERBET_.*=true/);

const kemerbetSessionRuntime =
  /require_kemerbet_session_provision_runtime\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(kemerbetSessionRuntime, 'The helper must attest the private KemerBet sign-in runtime.');
for (const contract of [
  /kemerbet-session-provision/,
  /org\.opencontainers\.image\.revision/,
  /10001:10001/,
  /ReadonlyRootfs/,
  /CapDrop/,
  /SecurityOpt/,
  /PidsLimit/,
  /\.HostConfig\.Memory/,
  /NanoCpus/,
  /ShmSize/,
  /PortBindings/,
  /FINANCIAL_ACTIONS_MODE=dry_run/,
  /KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true/,
  /KEMERBET_EXECUTOR_ENABLED=false/,
  /KEMERBET_FINAL_ACTION_ENABLED=false/,
  /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false/,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false/,
  /grep -c '\^'/,
  /volume\|\/run\/fetanagent-kemerbet-session-control\|true/,
  /volume\|\/var\/lib\/fetanagent\/kemerbet-sessions\|true/,
  /bind\|\/run\/secrets\/kemerbet_agent_identity_hmac_key\|false/,
  /bind\|\/run\/secrets\/kemerbet_no_transfer_readiness_player_ids\|false/,
  /bind\|\/etc\/fetanagent\/kemerbet-selector-contract\.v2\.json\|false/,
  /bind\|\/run\/fetanagent-kemerbet-readiness-seal-output\|true/,
  /KEMERBET_AGENT_IDENTITY_HMAC_KEY/,
  /KEMERBET_READINESS_PLAYER_IDS/,
  /KEMERBET_SELECTOR_CONTRACT/,
  /KEMERBET_READINESS_OUTPUT_ROOT/,
  /\/run\/fetanagent-kemerbet-session-control\/session\.sock/,
]) {
  assert.match(kemerbetSessionRuntime, contract);
}
assert.doesNotMatch(kemerbetSessionRuntime, /container logs|\bcat\b|password=|token=/iu);

const sealKemerbetReadiness = /\n  seal-kemerbet-readiness\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(
  sealKemerbetReadiness,
  'The helper must define the one-time live-session readiness seal.',
);
for (const contract of [
  /published-with-kemerbet-session/,
  /require_kemerbet_session_provision_runtime "\$commit_sha"/,
  /! -e "\$KEMERBET_READINESS_BINDING"/,
  /\/v1\/readiness\/seal/,
  /randomUUID\(\)/,
  /response\.statusCode !== 201/,
  /result\.playersChecked !== 5/,
  /result\.currency !== "ETB"/,
  /result\.transferDisabled !== true/,
  /result\.moneyMoved !== false/,
  /result\.identifiersRedacted !== true/,
  /KemerBet readiness sealed: 5 of 5 Players, Transfer disabled\./,
]) {
  assert.match(sealKemerbetReadiness, contract);
}
assert.doesNotMatch(
  sealKemerbetReadiness,
  /container logs|\bcat\b|PlayerEPOSDeposit|GeneralInfoByExternalId|password=|token=|FINANCIAL_ACTIONS_MODE=live/iu,
);

const recheckKemerbetReadiness = /\n  recheck-kemerbet-readiness\)([\s\S]*?)\n    ;;/u.exec(
  helper,
)?.[1];
assert.ok(
  recheckKemerbetReadiness,
  'The helper must define the independent one-shot bound-profile readiness recheck.',
);
assert.doesNotMatch(
  recheckKemerbetReadiness,
  /sealed_commit|sealed_release|seal_run|prior_seal/iu,
  'the host recheck must not claim provenance from the separately verified historical seal run',
);
for (const contract of [
  /\[\[ \$# -eq 3 \]\]/,
  /validate_commit_and_tag "\$commit_sha" "\$image_tag"/,
  /require_kemerbet_identity_key_file "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /require_service_file "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /KEMERBET_RECHECK_CLEANUP_ARMED='true'/,
  /trap kemerbet_recheck_cleanup_trap EXIT/,
  /trap 'kemerbet_recheck_signal_trap 130' INT/,
  /trap 'kemerbet_recheck_signal_trap 143' TERM/,
  /trap 'kemerbet_recheck_signal_trap 129' HUP/,
  /published-with-kemerbet-session/,
  /container stop --time 70/,
  /container rm/,
  /published-steady-state/,
  /require_kemerbet_profile_volume_holders ''/,
  /harden_kemerbet_identity_key/,
  /harden_kemerbet_player_ids_file/,
  /source_stat="\$\(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a'/,
  /identity_key_stat="\$\(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a'/,
  /selector_stat="\$\(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a'/,
  /player_ids_stat="\$\(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a'/,
  /fetanagent-deposit-executor:\$image_tag/,
  /org\.opencontainers\.image\.revision/,
  /KEMERBET_RECHECK_CANDIDATE_ROOT/,
  /KEMERBET_RECHECK_CANDIDATE_BINDING/,
  /KEMERBET_RECHECK_CANDIDATE_CREATED='true'/,
  /install -d -o root -g root -m 0700 "\$KEMERBET_RECHECK_CANDIDATE_ROOT"/,
  /install -o root -g root -m 0444/,
  /sync -f "\$KEMERBET_RECHECK_CANDIDATE_BINDING"/,
  /require_root_readable_immutable_file "\$KEMERBET_RECHECK_CANDIDATE_BINDING"/,
  /--profile kemerbet-no-transfer-readiness/,
  /create --no-build --no-recreate kemerbet-no-transfer-readiness/,
  /require_kemerbet_recheck_container_contract/,
  /require_kemerbet_profile_volume_holders "\$recheck_container"/,
  /a KemerBet recheck input changed before execution/,
  /timeout --foreground --signal=TERM/,
  /KEMERBET_RECHECK_TIMEOUT_SECONDS/,
  /KEMERBET_RECHECK_KILL_AFTER_SECONDS/,
  /container start --attach "\$recheck_container"/,
  /'exited\|0\|false\|\|0'/,
  /a KemerBet recheck input or profile identity changed during execution/,
  /remove_kemerbet_recheck_container/,
  /remove_kemerbet_recheck_network/,
  /consume_exact_one_use_kemerbet_file/,
  /ln -- "\$KEMERBET_RECHECK_CANDIDATE_BINDING" "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /KEMERBET_RECHECK_FINAL_INSTALLED='true'/,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /remove_kemerbet_recheck_candidate/,
  /shred --force --iterations=1 --zero --remove=unlink -- "\$KEMERBET_READINESS_BINDING"/,
  /KEMERBET_RECHECK_RECEIPT_OWNED='true'/,
  /require_kemerbet_recheck_receipt/,
  /KEMERBET_RECHECK_COMMITTED='true'/,
  /KEMERBET_RECHECK_CLEANUP_ARMED='false'/,
  /trap - EXIT INT TERM HUP/,
  /KemerBet server readiness passed: 5 of 5 Players, Transfer disabled\./,
  /record_kemerbet_recheck_receipt/,
]) {
  assert.match(recheckKemerbetReadiness, contract);
}
const recheckCandidatePosition = recheckKemerbetReadiness.indexOf(
  'install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_CANDIDATE_ROOT"',
);
const recheckRecoveryPosition = recheckKemerbetReadiness.indexOf(
  'recover_incomplete_kemerbet_recheck_promotion',
);
const recheckCompletedReceiptBranchPosition = recheckKemerbetReadiness.indexOf(
  'if [[ -e "$KEMERBET_RECHECK_RECEIPT_ROOT" || -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]',
  recheckRecoveryPosition,
);
const recheckCompletedVerificationPosition = recheckKemerbetReadiness.indexOf(
  'require_completed_kemerbet_recheck_for_release "$commit_sha" "$image_tag"',
  recheckCompletedReceiptBranchPosition,
);
const recheckCompletedResultPosition = recheckKemerbetReadiness.indexOf(
  "printf '%s\\n' 'KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.'",
  recheckCompletedVerificationPosition,
);
const recheckCompletedExitPosition = recheckKemerbetReadiness.indexOf(
  'exit 0',
  recheckCompletedResultPosition,
);
const recheckPreparedJournalPosition = recheckKemerbetReadiness.indexOf(
  'record_kemerbet_recheck_promotion_journal',
);
const recheckPreparedJournalVerificationPosition = recheckKemerbetReadiness.indexOf(
  'require_kemerbet_recheck_prepared_promotion_journal',
  recheckPreparedJournalPosition,
);
const recheckCleanupArmedPosition = recheckKemerbetReadiness.indexOf(
  "KEMERBET_RECHECK_CLEANUP_ARMED='true'",
);
const recheckSessionStopPosition = recheckKemerbetReadiness.indexOf('container stop --time 70');
const recheckSteadyPosition = recheckKemerbetReadiness.indexOf(
  'require_exact_fresh_bot_runtime "$commit_sha" published-steady-state',
  recheckSessionStopPosition,
);
const recheckHardenPosition = recheckKemerbetReadiness.indexOf('harden_kemerbet_identity_key');
const recheckSnapshotPosition = recheckKemerbetReadiness.indexOf(
  `source_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a'`,
);
const recheckHardenedSnapshotPosition = recheckKemerbetReadiness.indexOf(
  `identity_key_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a'`,
  recheckHardenPosition,
);
const recheckCreatePosition = recheckKemerbetReadiness.indexOf(
  'create --no-build --no-recreate kemerbet-no-transfer-readiness',
);
const recheckCandidateJournalPosition = recheckKemerbetReadiness.indexOf(
  'advance_kemerbet_recheck_promotion_journal',
  recheckCandidatePosition,
);
const recheckCandidateJournalVerificationPosition = recheckKemerbetReadiness.indexOf(
  'require_kemerbet_recheck_promotion_journal',
  recheckCandidateJournalPosition,
);
const recheckAttestationPosition = recheckKemerbetReadiness.indexOf(
  'require_kemerbet_recheck_container_contract',
);
const recheckBeforeExecutionPosition = recheckKemerbetReadiness.indexOf(
  'a KemerBet recheck input changed before execution',
);
const recheckRunPosition = recheckKemerbetReadiness.indexOf(
  'container start --attach "$recheck_container"',
);
const recheckSuccessPosition = recheckKemerbetReadiness.indexOf('[[ "$recheck_status" -eq 0 ]]');
const recheckPostcheckPosition = recheckKemerbetReadiness.indexOf(
  'a KemerBet recheck input or profile identity changed during execution',
);
const recheckContainerCleanupPosition = recheckKemerbetReadiness.indexOf(
  'remove_kemerbet_recheck_container',
  recheckPostcheckPosition,
);
const recheckNetworkCleanupPosition = recheckKemerbetReadiness.indexOf(
  'remove_kemerbet_recheck_network',
  recheckContainerCleanupPosition,
);
const recheckOneUseCleanupPosition = recheckKemerbetReadiness.indexOf(
  'consume_exact_one_use_kemerbet_file',
  recheckNetworkCleanupPosition,
);
const recheckFinalBindingPosition = recheckKemerbetReadiness.indexOf(
  'ln -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" "$KEMERBET_AGENT_IDENTITY_BINDINGS"',
);
const recheckCandidateCleanupPosition = recheckKemerbetReadiness.indexOf(
  'remove_kemerbet_recheck_candidate',
  recheckFinalBindingPosition,
);
const recheckSealSourceCleanupPosition = recheckKemerbetReadiness.indexOf(
  'shred --force --iterations=1 --zero --remove=unlink -- "$KEMERBET_READINESS_BINDING"',
);
const recheckReceiptPosition = recheckKemerbetReadiness.indexOf('record_kemerbet_recheck_receipt');
const recheckReceiptVerificationPosition = recheckKemerbetReadiness.indexOf(
  'require_kemerbet_recheck_receipt',
  recheckReceiptPosition,
);
const recheckCommittedPosition = recheckKemerbetReadiness.indexOf(
  "KEMERBET_RECHECK_COMMITTED='true'",
);
const recheckFinalJournalVerificationPosition = recheckKemerbetReadiness.indexOf(
  'require_kemerbet_recheck_promotion_journal',
  recheckReceiptVerificationPosition,
);
const recheckJournalRetirementPosition = recheckKemerbetReadiness.indexOf(
  'remove_owned_kemerbet_recheck_promotion_root',
  recheckFinalJournalVerificationPosition,
);
const recheckDisarmedPosition = recheckKemerbetReadiness.indexOf(
  "KEMERBET_RECHECK_CLEANUP_ARMED='false'",
  recheckCommittedPosition,
);
const recheckResultPosition = recheckKemerbetReadiness.lastIndexOf(
  'KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.',
);
assert.ok(
  recheckRecoveryPosition >= 0 &&
    recheckCompletedReceiptBranchPosition > recheckRecoveryPosition &&
    recheckCompletedVerificationPosition > recheckCompletedReceiptBranchPosition &&
    recheckCompletedResultPosition > recheckCompletedVerificationPosition &&
    recheckCompletedExitPosition > recheckCompletedResultPosition &&
    recheckSnapshotPosition > recheckCompletedExitPosition &&
    recheckSnapshotPosition < recheckPreparedJournalPosition &&
    recheckPreparedJournalPosition > recheckCompletedExitPosition &&
    recheckPreparedJournalPosition > recheckRecoveryPosition &&
    recheckPreparedJournalVerificationPosition > recheckPreparedJournalPosition &&
    recheckCleanupArmedPosition > recheckPreparedJournalVerificationPosition &&
    recheckSessionStopPosition > recheckCleanupArmedPosition &&
    recheckSteadyPosition > recheckSessionStopPosition &&
    recheckHardenPosition > recheckSteadyPosition &&
    recheckHardenedSnapshotPosition > recheckHardenPosition &&
    recheckCandidatePosition > recheckCleanupArmedPosition &&
    recheckCandidatePosition > recheckHardenedSnapshotPosition &&
    recheckCandidateJournalPosition > recheckCandidatePosition &&
    recheckCandidateJournalVerificationPosition > recheckCandidateJournalPosition &&
    recheckCreatePosition > recheckCandidateJournalVerificationPosition &&
    recheckAttestationPosition > recheckCreatePosition &&
    recheckBeforeExecutionPosition > recheckAttestationPosition &&
    recheckRunPosition > recheckCandidatePosition &&
    recheckRunPosition > recheckBeforeExecutionPosition &&
    recheckSuccessPosition > recheckRunPosition &&
    recheckPostcheckPosition > recheckSuccessPosition &&
    recheckContainerCleanupPosition > recheckPostcheckPosition &&
    recheckNetworkCleanupPosition > recheckContainerCleanupPosition &&
    recheckOneUseCleanupPosition > recheckSuccessPosition &&
    recheckOneUseCleanupPosition > recheckNetworkCleanupPosition &&
    recheckFinalBindingPosition > recheckOneUseCleanupPosition &&
    recheckCandidateCleanupPosition > recheckFinalBindingPosition &&
    recheckSealSourceCleanupPosition > recheckCandidateCleanupPosition &&
    recheckReceiptPosition > recheckSealSourceCleanupPosition &&
    recheckReceiptVerificationPosition > recheckReceiptPosition &&
    recheckFinalJournalVerificationPosition > recheckReceiptVerificationPosition &&
    recheckJournalRetirementPosition > recheckFinalJournalVerificationPosition &&
    recheckCommittedPosition > recheckJournalRetirementPosition &&
    recheckDisarmedPosition > recheckCommittedPosition &&
    recheckResultPosition > recheckDisarmedPosition,
  'the recheck must recover, accept only an exact already-committed receipt, otherwise journal before mutation, run once, clean transients, consume IDs, no-clobber promote, receipt, retire the journal, and only then commit',
);
assert.doesNotMatch(
  recheckKemerbetReadiness,
  /install -o 10001|root:root:700\|root:root:755|container logs|\bcat\b|PlayerEPOSDeposit|GeneralInfoByExternalId|password=|token=|FINANCIAL_ACTIONS_MODE=live/iu,
  'the recheck must never preinstall a service-owned final binding, expose logs, or enable financial behavior',
);

for (const lifecycleInitialization of [
  "KEMERBET_RECHECK_CLEANUP_ARMED='false'",
  "KEMERBET_RECHECK_CANDIDATE_CREATED='false'",
  "KEMERBET_RECHECK_CANDIDATE_DEV_INO=''",
  "KEMERBET_RECHECK_CANDIDATE_DIGEST=''",
  "KEMERBET_RECHECK_FINAL_INSTALLED='false'",
  "KEMERBET_RECHECK_RECEIPT_OWNED='false'",
  "KEMERBET_RECHECK_PROMOTION_OWNED='false'",
  "KEMERBET_RECHECK_PLAYER_IDS_DEV_INO=''",
  "KEMERBET_RECHECK_RELEASE=''",
  "KEMERBET_RECHECK_SESSION_CONTAINER=''",
  "KEMERBET_RECHECK_SOURCE_DEV_INO=''",
  "KEMERBET_RECHECK_SOURCE_DIGEST=''",
  "KEMERBET_RECHECK_COMMITTED='false'",
]) {
  assert.match(helper, new RegExp(`^${lifecycleInitialization}$`, 'm'));
}

const consumeOneUseKemerbetFile = /consume_one_use_kemerbet_file\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  consumeOneUseKemerbetFile,
  'the helper must securely consume the exact one-use Player-ID input on terminal paths',
);
for (const contract of [
  /! -L "\$path" && -f "\$path"/,
  /10001:10001:400\|10001:10001:444\|root:root:400\|root:root:444/,
  /stat --format='%h'/,
  /shred --force --iterations=1 --zero --remove=unlink -- "\$path"/,
  /! -e "\$path" && ! -L "\$path"/,
]) {
  assert.match(consumeOneUseKemerbetFile, contract);
}

const hardenKemerbetPlayerIds = /harden_kemerbet_player_ids_file\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  hardenKemerbetPlayerIds,
  'the original one-use Player-ID file must be frozen before the one-shot container is created',
);
for (const contract of [
  /root:root:700/,
  /stat --format='%h'/,
  /digest_before/,
  /chmod 0444 "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /chown root:root "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /sync -f "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /require_root_readable_immutable_file "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /== "\$digest_before"/,
]) {
  assert.match(hardenKemerbetPlayerIds, contract);
}

const hardenKemerbetIdentityKey = /harden_kemerbet_identity_key\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  hardenKemerbetIdentityKey,
  'the identity HMAC key must be frozen root-only without changing its digest',
);
for (const contract of [
  /root:root:700/,
  /stat --format='%h'/,
  /digest_before/,
  /chmod 0444 "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /chown root:root "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /== "\$digest_before"/,
]) {
  assert.match(hardenKemerbetIdentityKey, contract);
}

const stagingMutationLock = /acquire_staging_mutation_lock\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(stagingMutationLock, 'The helper must define one non-blocking root-owned mutation lock.');
for (const contract of [
  /STAGING_MUTATION_LOCK/,
  /root:root:600/,
  /exec 9<>"\$STAGING_MUTATION_LOCK"/,
  /flock --exclusive --nonblock 9/,
]) {
  assert.match(stagingMutationLock, contract);
}
assert.match(
  helper,
  /case "\$command" in\s*\r?\n\s+[^\r\n]*\brecheck-kemerbet-readiness\b[^\r\n]*\)\s*\r?\n\s+acquire_staging_mutation_lock/,
  'the independent recheck must share the non-blocking staging mutation lock',
);
assert.match(
  helper,
  /if \[\[ ! "\$command" =~ \^\(recheck-kemerbet-readiness\|expiry-stop\|stop\|stop-bot\|stop-kemerbet-session-provision\|stop-public-edge\)\$ &&\s*\r?\n\s+\( -e "\$KEMERBET_RECHECK_PROMOTION_ROOT" \|\| -L "\$KEMERBET_RECHECK_PROMOTION_ROOT" \) \]\]; then\s*\r?\n\s+die 'an interrupted KemerBet readiness promotion blocks state-expanding staging mutations'/u,
  'a durable pending recheck must block every state-expanding mutation while retaining fail-safe stop commands',
);
assert.equal(
  (helper.match(/\brecover_incomplete_kemerbet_recheck_promotion\b/g) ?? []).length,
  2,
  'interruption recovery must be defined once and invoked only by the explicit recheck command',
);

const recordRecheckPromotionJournal =
  /record_kemerbet_recheck_promotion_journal\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  recordRecheckPromotionJournal,
  'the helper must create a durable prepared journal before any recheck mutation',
);
for (const contract of [
  /install -d -o root -g root -m 0700 "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /sync -f "\$\(dirname -- "\$KEMERBET_RECHECK_PROMOTION_ROOT"\)"/,
  /'state=prepared'/,
  /"release=\$commit_sha"/,
  /"source_dev_ino=\$source_dev_ino"/,
  /"binding_sha256=\$binding_digest"/,
  /"identity_hmac_key_sha256=\$identity_key_digest"/,
  /"selector_sha256=\$selector_digest"/,
  /"image_id=\$image_id"/,
  /"profile_volume=\$KEMERBET_PROFILE_VOLUME"/,
  /"session_container=\$session_container"/,
  /"player_ids_dev_ino=\$player_ids_dev_ino"/,
  /chmod 0600 "\$temporary"/,
  /sync -f "\$temporary"/,
  /ln -- "\$temporary" "\$KEMERBET_RECHECK_PROMOTION_JOURNAL"/,
  /sync -f "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /root:root:600:1/,
]) {
  assert.match(recordRecheckPromotionJournal, contract);
}
assert.doesNotMatch(
  recordRecheckPromotionJournal,
  /Player ID|player_id(?!s_dev_ino)|agent_id=|account_id=|password|token|raw_|sealed_commit|sealed_release|seal_run|prior_seal/iu,
  'the durable promotion journal must contain only redacted exact identities',
);

const advanceRecheckPromotionJournal =
  /advance_kemerbet_recheck_promotion_journal\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  advanceRecheckPromotionJournal,
  'the helper must atomically advance the durable journal after candidate creation',
);
for (const contract of [
  /require_kemerbet_recheck_prepared_promotion_journal/,
  /'state=candidate_bound'/,
  /"binding_dev_ino=\$binding_dev_ino"/,
  /"profile_identity_sha256=\$profile_identity_digest"/,
  /"session_container=\$session_container"/,
  /"player_ids_dev_ino=\$player_ids_dev_ino"/,
  /sync -f "\$temporary"/,
  /mv -f -- "\$temporary" "\$KEMERBET_RECHECK_PROMOTION_JOURNAL"/,
  /sync -f "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /root:root:600:1/,
]) {
  assert.match(advanceRecheckPromotionJournal, contract);
}
assert.doesNotMatch(
  advanceRecheckPromotionJournal,
  /Player ID|player_id(?!s_dev_ino)|agent_id=|account_id=|password|token|raw_|sealed_commit|sealed_release|seal_run|prior_seal/iu,
  'the candidate-bound journal must not add raw identity or historical seal provenance',
);

const removeExactKemerbetSession =
  /remove_exact_kemerbet_session_provision\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  removeExactKemerbetSession,
  'journal recovery must remove only the exact session container captured before mutation',
);
for (const contract of [
  /expected_container/,
  /actual_container" == "\$expected_container/,
  /com\.docker\.compose\.project/,
  /com\.docker\.compose\.service/,
  /org\.opencontainers\.image\.revision/,
  /kemerbet-session-provision/,
  /10001:10001/,
  /kemerbet-session-provision-server\.js/,
  /FINANCIAL_ACTIONS_MODE=dry_run/,
  /KEMERBET_EXECUTOR_ENABLED=false/,
  /KEMERBET_FINAL_ACTION_ENABLED=false/,
  /KEMERBET_PROFILE_VOLUME/,
  /running\) docker_local container stop --time 70/,
  /docker_local container rm "\$actual_container"/,
]) {
  assert.match(removeExactKemerbetSession, contract);
}

const recoverRecheckPromotion =
  /recover_incomplete_kemerbet_recheck_promotion\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  recoverRecheckPromotion,
  'the helper must recover every durable prepared or candidate-bound crash prefix',
);
for (const contract of [
  /state=prepared/,
  /state=candidate_bound/,
  /session_container=\(none\|\[0-9a-f\]/,
  /player_ids_dev_ino=/,
  /remove_kemerbet_recheck_container/,
  /remove_kemerbet_recheck_network/,
  /remove_journaled_kemerbet_session_provision/,
  /require_kemerbet_profile_volume_holders ''/,
  /remove_kemerbet_recheck_candidate/,
  /consume_exact_one_use_kemerbet_file/,
  /repair_kemerbet_identity_key_readability/,
  /remove_owned_kemerbet_recheck_promotion_root/,
  /remove_owned_kemerbet_recheck_receipt_root/,
  /rollback_kemerbet_recheck_final_binding/,
  /remove_changed_kemerbet_binding_source/,
  /remove_owned_kemerbet_recheck_promotion_root/,
]) {
  assert.match(recoverRecheckPromotion, contract);
}
assert.doesNotMatch(
  recoverRecheckPromotion,
  /container start|compose .*\bup\b|GeneralInfoByExternalId|PlayerEPOSDeposit|FINANCIAL_ACTIONS_MODE=live/iu,
  'crash recovery must clean exact state without retrying the browser probe or enabling money authority',
);
const preparedRecoveryStart = recoverRecheckPromotion.indexOf('state=prepared');
const candidateRecoveryStart = recoverRecheckPromotion.indexOf('state=candidate_bound');
const preparedRecovery = recoverRecheckPromotion.slice(
  preparedRecoveryStart,
  candidateRecoveryStart,
);
const candidateRecovery = recoverRecheckPromotion.slice(candidateRecoveryStart);
assertInOrder(
  preparedRecovery,
  [
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
    'remove_journaled_kemerbet_session_provision',
    "require_kemerbet_profile_volume_holders ''",
    'remove_kemerbet_recheck_candidate',
    'consume_exact_one_use_kemerbet_file',
    'repair_kemerbet_identity_key_readability',
    'remove_owned_kemerbet_recheck_promotion_root',
  ],
  'prepared-state crash recovery must remove the exact session/profile holders, consume the one-use cohort, repair the key, and retire the journal last',
);
assertInOrder(
  candidateRecovery,
  [
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
    'remove_journaled_kemerbet_session_provision',
    "require_kemerbet_profile_volume_holders ''",
    'remove_owned_kemerbet_recheck_receipt_root',
    'rollback_kemerbet_recheck_final_binding',
    'remove_kemerbet_recheck_candidate',
    'remove_changed_kemerbet_binding_source',
    'consume_exact_one_use_kemerbet_file',
    'repair_kemerbet_identity_key_readability',
    'remove_owned_kemerbet_recheck_promotion_root',
  ],
  'candidate-bound crash recovery must unwind receipt/canonical/candidate/source state before consuming the cohort and retiring the journal',
);

const recheckRuntimeContract =
  /require_kemerbet_recheck_container_contract\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  recheckRuntimeContract,
  'The helper must inspect the one-shot container before starting it.',
);
for (const contract of [
  /\.State\.Status.*'created'/s,
  /fetanagent-deposit-executor:\$image_tag/,
  /10001:10001/,
  /\["node","apps\/executor\/dist\/kemerbet-no-transfer-readiness\.js"\]/,
  /'false\|false'/,
  /ReadonlyRootfs/,
  /Privileged/,
  /AutoRemove/,
  /RestartPolicy/,
  /CapAdd/,
  /CapDrop/,
  /SecurityOpt/,
  /PidsLimit/,
  /\.HostConfig\.Memory/,
  /NanoCpus/,
  /ShmSize/,
  /PortBindings/,
  /ExposedPorts/,
  /LogConfig\.Type.*'none'/s,
  /Healthcheck\.Test.*'\["NONE"\]'/s,
  /mode=1777\\nnodev\\nnoexec\\nnosuid\\nrw\\nsize=268435456/,
  /KEMERBET_NO_TRANSFER_READINESS_ENABLED=true/,
  /KEMERBET_EXECUTOR_ENABLED=false/,
  /KEMERBET_FINAL_ACTION_ENABLED=false/,
  /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false/,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false/,
  /KEMERBET_RECHECK_CANDIDATE_BINDING.*\/run\/secrets\/kemerbet_agent_identity_bindings/s,
  /KEMERBET_AGENT_IDENTITY_HMAC_KEY.*\/run\/secrets\/kemerbet_agent_identity_hmac_key/s,
  /KEMERBET_READINESS_PLAYER_IDS.*\/run\/secrets\/kemerbet_no_transfer_readiness_player_ids/s,
  /KEMERBET_SELECTOR_CONTRACT.*\/etc\/fetanagent\/kemerbet-selector-contract\.v2\.json/s,
  /KEMERBET_PROFILE_VOLUME.*\/var\/lib\/fetanagent\/kemerbet-sessions/s,
  /kemerbet_readiness_egress/,
  /network attachment is not singular/,
]) {
  assert.match(recheckRuntimeContract, contract);
}
assert.doesNotMatch(
  recheckRuntimeContract,
  /container start|container logs|\bcat\b|DATABASE|PASSWORD|TOKEN|SUPABASE|RECEIVER|FINANCIAL_ACTIONS_MODE=live/iu,
  'runtime attestation must occur before start and must not expose or add financial authority',
);

const recheckCleanup = /kemerbet_recheck_cleanup_trap\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(recheckCleanup, 'The helper must define terminal cleanup for the one-shot recheck.');
for (const contract of [
  /trap - EXIT/,
  /trap '' INT TERM HUP/,
  /remove_kemerbet_recheck_container/,
  /remove_kemerbet_recheck_network/,
  /KEMERBET_RECHECK_COMMITTED" != 'true'/,
  /KEMERBET_RECHECK_RECEIPT_OWNED" == 'true'/,
  /remove_owned_kemerbet_recheck_receipt_root/,
  /rollback_kemerbet_recheck_final_binding/,
  /KEMERBET_RECHECK_CANDIDATE_CREATED" == 'true'/,
  /remove_kemerbet_recheck_candidate/,
  /consume_exact_one_use_kemerbet_file/,
  /repair_kemerbet_identity_key_readability/,
  /original_status" -eq 0 && "\$cleanup_status" -ne 0/,
  /exit "\$original_status"/,
]) {
  assert.match(recheckCleanup, contract);
}
for (const nonExitingCleanupContract of [
  /remove_kemerbet_recheck_container \|\| cleanup_status=1/,
  /remove_kemerbet_recheck_network \|\| cleanup_status=1/,
  /remove_exact_kemerbet_session_provision[\s\S]*?\|\| cleanup_status=1/,
  /kemerbet_profile_volume_holders_match '' \|\| cleanup_status=1/,
  /remove_owned_kemerbet_recheck_receipt_root \|\| cleanup_status=1/,
  /rollback_kemerbet_recheck_final_binding \|\| cleanup_status=1/,
  /remove_kemerbet_recheck_candidate \|\| cleanup_status=1/,
  /remove_changed_kemerbet_binding_source[\s\S]*?\|\| cleanup_status=1/,
  /consume_exact_one_use_kemerbet_file[\s\S]*?\|\| cleanup_status=1/,
  /consume_one_use_kemerbet_file "\$KEMERBET_READINESS_PLAYER_IDS" \|\| cleanup_status=1/,
  /repair_kemerbet_identity_key_readability \|\| cleanup_status=1/,
  /remove_owned_kemerbet_recheck_promotion_root \|\| cleanup_status=1/,
]) {
  assert.match(recheckCleanup, nonExitingCleanupContract);
}
assert.doesNotMatch(
  recheckCleanup,
  /\bdie\b|require_kemerbet_profile_volume_holders/,
  'the EXIT trap must accumulate rollback failures without invoking an exiting helper',
);
assertInOrder(
  recheckCleanup,
  [
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
    'remove_exact_kemerbet_session_provision',
    "kemerbet_profile_volume_holders_match ''",
    'remove_owned_kemerbet_recheck_receipt_root',
    'rollback_kemerbet_recheck_final_binding',
    'remove_kemerbet_recheck_candidate',
    'remove_changed_kemerbet_binding_source',
    'consume_exact_one_use_kemerbet_file',
    'repair_kemerbet_identity_key_readability',
    '"$cleanup_status" -eq 0',
    'remove_owned_kemerbet_recheck_promotion_root',
  ],
  'catchable cleanup must remove the exact session and every owned transient before retiring the durable journal last',
);
assert.ok(
  recheckCleanup.indexOf('"$cleanup_status" -eq 0') <
    recheckCleanup.indexOf('remove_owned_kemerbet_recheck_promotion_root'),
  'catchable cleanup must retain the durable recovery journal unless every rollback and secret repair succeeds',
);

const recheckRollback = /rollback_kemerbet_recheck_final_binding\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(recheckRollback, 'A failed finalization must roll back only its own final binding.');
for (const contract of [
  /root:root/,
  /KEMERBET_RECHECK_CANDIDATE_DEV_INO/,
  /KEMERBET_RECHECK_CANDIDATE_DIGEST/,
  /rm -f -- "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /sync -f "\$\(dirname -- "\$KEMERBET_AGENT_IDENTITY_BINDINGS"\)"/,
]) {
  assert.match(recheckRollback, contract);
}

const recheckReceiptCleanup = /remove_owned_kemerbet_recheck_receipt_root\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  recheckReceiptCleanup,
  'failed finalization must remove only its exact root-owned transient receipt boundary',
);
for (const contract of [
  /root:root/,
  /root_mode/,
  /entry_mode/,
  /KEMERBET_RECHECK_RECEIPT_ROOT"\/\.ready-v1\.\*/,
  /find -P "\$KEMERBET_RECHECK_RECEIPT_ROOT"/,
  /rmdir -- "\$KEMERBET_RECHECK_RECEIPT_ROOT"/,
]) {
  assert.match(recheckReceiptCleanup, contract);
}
assert.equal(
  (recheckReceiptCleanup.match(/& 8#022\) == 0/g) ?? []).length,
  2,
  'receipt rollback may delete only root-owned entries that are not group/world writable',
);

const recheckIdentityKeyRepair =
  /repair_kemerbet_identity_key_readability\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  recheckIdentityKeyRepair,
  'terminal cleanup must leave the identity key root-owned and readable for a future bounded attempt',
);
assert.match(recheckIdentityKeyRepair, /root:root:700/);
assert.match(recheckIdentityKeyRepair, /stat --format='%h'/);
assert.match(recheckIdentityKeyRepair, /chmod 0444 "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/);
assert.match(recheckIdentityKeyRepair, /chown root:root "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/);
assert.match(recheckIdentityKeyRepair, /root:root:444/);

const recheckCandidateCleanup = /remove_kemerbet_recheck_candidate\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  recheckCandidateCleanup,
  'The helper must remove the root-only candidate on every terminal path.',
);
assert.match(recheckCandidateCleanup, /root:root/);
assert.match(recheckCandidateCleanup, /root_mode/);
assert.match(recheckCandidateCleanup, /candidate_mode/);
assert.equal(
  (recheckCandidateCleanup.match(/& 8#022\) == 0/g) ?? []).length,
  2,
  'cleanup may unlink only a root-owned candidate boundary that is not group/world writable',
);
assert.match(recheckCandidateCleanup, /realpath -- "\$KEMERBET_RECHECK_CANDIDATE_ROOT"/);
assert.match(recheckCandidateCleanup, /rm -f -- "\$KEMERBET_RECHECK_CANDIDATE_BINDING"/);
assert.match(recheckCandidateCleanup, /rmdir -- "\$KEMERBET_RECHECK_CANDIDATE_ROOT"/);
assert.match(
  recheckCandidateCleanup,
  /! -e "\$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "\$KEMERBET_RECHECK_CANDIDATE_ROOT"/,
);

const rootImmutableFileContract = /require_root_readable_immutable_file\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  rootImmutableFileContract,
  'candidate and final bindings must share one root-owned immutable-file contract.',
);
assert.match(rootImmutableFileContract, /realpath -- "\$path"/);
assert.match(rootImmutableFileContract, /root:root:444/);

const recheckReceipt = /record_kemerbet_recheck_receipt\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(recheckReceipt, 'The helper must atomically record only redacted recheck provenance.');
for (const contract of [
  /'version=1'/,
  /"release=\$commit_sha"/,
  /"binding_sha256=\$binding_digest"/,
  /"identity_hmac_key_sha256=\$identity_key_digest"/,
  /"selector_sha256=\$selector_digest"/,
  /"image_id=\$image_id"/,
  /"profile_volume=\$KEMERBET_PROFILE_VOLUME"/,
  /"profile_identity_sha256=\$profile_identity_digest"/,
  /install -d -o root -g root -m 0700 "\$KEMERBET_RECHECK_RECEIPT_ROOT"/,
  /root:root:600/,
  /ln -- "\$temporary" "\$KEMERBET_RECHECK_RECEIPT"/,
]) {
  assert.match(recheckReceipt, contract);
}
assert.doesNotMatch(
  recheckReceipt,
  /Player ID|player_id(?!s_dev_ino)|agent_id=|account_id=|password|token|raw_|sealed_commit|sealed_release|seal_run|prior_seal/iu,
  'the recheck receipt must not contain Player or agent identity data or misattribute historical seal provenance',
);

const recheckReceiptVerification = /require_kemerbet_recheck_receipt\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  recheckReceiptVerification,
  'finalization must re-read and verify the exact root-only receipt before committing',
);
for (const contract of [
  /root:root:700/,
  /"\$entries" == 'ready-v1'/,
  /root:root:600:1/,
  /expected_digest/,
  /actual_digest/,
  /"\$actual_digest" == "\$expected_digest"/,
]) {
  assert.match(recheckReceiptVerification, contract);
}

const completedRecheckVerification =
  /require_completed_kemerbet_recheck_for_release\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  completedRecheckVerification,
  'a post-commit rerun must verify and return only the exact already-completed recheck',
);
for (const contract of [
  /validate_commit_and_tag "\$commit_sha" "\$image_tag"/,
  /! -e "\$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /require_committed_kemerbet_recheck_boundary_shape/,
  /"\$\{receipt_lines\[1\]\}" == "release=\$commit_sha"/,
  /require_kemerbet_recheck_receipt/,
  /sha256sum -- "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /sha256sum -- "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /sha256sum -- "\$KEMERBET_SELECTOR_CONTRACT"/,
  /kemerbet_profile_identity_digest "\$account_id" "\$profile_mountpoint"/,
  /image inspect "fetanagent-deposit-executor:\$image_tag"/,
  /org\.opencontainers\.image\.revision/,
  /\$commit_sha\|fetanagent-deposit-executor\|10001:10001/,
  /require_exact_fresh_bot_runtime "\$commit_sha" published-steady-state/,
  /require_kemerbet_profile_volume_holders ''/,
  /name=\^\/\$\{KEMERBET_RECHECK_CONTAINER\}\$/,
  /name=\^\$\{KEMERBET_RECHECK_NETWORK\}\$/,
  /! -e "\$KEMERBET_READINESS_PLAYER_IDS" && ! -L "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /! -e "\$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "\$KEMERBET_RECHECK_CANDIDATE_ROOT"/,
  /! -e "\$KEMERBET_READINESS_BINDING" && ! -L "\$KEMERBET_READINESS_BINDING"/,
  /require_kemerbet_readiness_output_directory/,
]) {
  assert.match(completedRecheckVerification, contract);
}
assert.doesNotMatch(
  completedRecheckVerification,
  /container start|compose .*\bup\b|GeneralInfoByExternalId|PlayerEPOSDeposit|FINANCIAL_ACTIONS_MODE=live|sealed_commit|sealed_release|seal_run|prior_seal/iu,
  'the idempotent completed path must only attest existing exact state and cannot rerun or claim historical seal provenance',
);

const stopKemerbetSession = /\n  stop-kemerbet-session-provision\)([\s\S]*?)\n    ;;/u.exec(
  helper,
)?.[1];
assert.ok(stopKemerbetSession, 'The helper must define the private KemerBet sign-in stop.');
assert.match(stopKemerbetSession, /container stop --time 70/);
assert.match(stopKemerbetSession, /container rm/);
assert.match(stopKemerbetSession, /published-steady-state/);
assert.doesNotMatch(
  stopKemerbetSession,
  /stop_project|network rm|com\.docker\.compose\.service=(?:gateway|owner-control|bot)|container (?:rm|stop)[^\n]*(?:gateway|owner-control|bot)/,
);

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
  'staging deploy workflow verified: manual exact-target guards, read-only exact-IP ban gate, sealed images, bounded runtime credentials, checksummed root helper, provenance-bound one-shot KemerBet recheck, and explicit stop path',
);
