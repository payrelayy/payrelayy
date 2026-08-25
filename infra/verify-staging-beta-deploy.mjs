import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
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
  '5267906f1b0fe07c8d4a2da05f2e101240a39ee8ab73cf323d4b41d7a30b6795';
const installedHelperBackupName = 'fetanagent-staging-deploy-helper.previous-5267906f';
const installedHelperBackupPath = `/root/fetanagent-helper-rotation/${installedHelperBackupName}`;
const retained121eHelperBackupSha =
  '121e3b360fc8e68aacd87a6d6a39611d2e6005c347a782798a1204d85b42b5b4';
const retained121eHelperBackupName = 'fetanagent-staging-deploy-helper.previous-121e3b36';
const retained121eHelperBackupPath = `/root/fetanagent-helper-rotation/${retained121eHelperBackupName}`;
const retainedAf823HelperBackupSha =
  'af823251e2374b77898c813f5f7fe74e78280b69ba89d0b1dd0901b8851c8833';
const retainedAf823HelperBackupName = 'fetanagent-staging-deploy-helper.previous-af823251';
const retainedAf823HelperBackupPath = `/root/fetanagent-helper-rotation/${retainedAf823HelperBackupName}`;
const retainedB466HelperBackupSha =
  'b4664efdbe3297b7b0ddee8122bf431608571e84dd0987892f58c20f48bdb663';
const retainedB466HelperBackupName = 'fetanagent-staging-deploy-helper.previous-b4664efd';
const retainedB466HelperBackupPath = `/root/fetanagent-helper-rotation/${retainedB466HelperBackupName}`;
const retained33f4HelperBackupSha =
  '33f4a5a4ba56fa86aa34cdc9a899117d327ed06a58b3cb5d7e9453c28afad5ba';
const retained33f4HelperBackupName = 'fetanagent-staging-deploy-helper.previous-33f4a5a4';
const retained33f4HelperBackupPath = `/root/fetanagent-helper-rotation/${retained33f4HelperBackupName}`;
const reviewedHelperSuccessorSha =
  'd9cdcdec53e0a408bc15b205f161fd19e3204ed8e81a32e5921342c2bfa867f7';
const actualReviewedHelperSuccessorSha = createHash('sha256')
  .update(helper.replaceAll('\r\n', '\n'))
  .digest('hex');
assert.equal(
  actualReviewedHelperSuccessorSha,
  reviewedHelperSuccessorSha,
  'the reviewed helper LF bytes must remain frozen at the exact successor pin',
);
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

function extractShellFunction(source, name, nextName) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf(`\n}\n\n${nextName}() {`, start);
  assert.ok(start >= 0 && end > start, `missing shell function boundary: ${name}`);
  return source.slice(start, end + 2);
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

for (const ownerClaimRunbookContract of [
  /Owner exact-five cohort import and claim freeze/,
  /kemerbet-readiness-cohort-imported-v1/,
  /kemerbet-readiness-cohort-completed-v1/,
  /kemerbet-readiness-cohort-failed-v1/,
  /root:10001`, mode `0440`, link-count\s+one/u,
  /retryable failure restores both exact source inodes first/u,
  /Player-stage SHA-256 before either source\s+changes/u,
  /never printed,\s+logged, returned to the app, copied into an aggregate marker or public receipt/u,
  /placed in a child\s+process argument\/environment, or exposed through `\/proc\/\*\/cmdline`/u,
  /only through an inherited root-process file descriptor/u,
  /unlinks its fixed pathname, synchronizes the parent\s+directory, proves the pathname absent/u,
  /before publishing matching\s+`kemerbet-readiness-cohort-completed-v1`/u,
  /re-proves it again after publication, and retires the\s+journal last/u,
  /Exactly one `owner-control` container/u,
  /this container is its sole holder/u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-cohort-receipts/u,
  /\/run\/fetanagent-kemerbet-readiness-cohort-receipts/u,
  /exact read-only bind/u,
  /prevent UID 10001 from\s+creating, unlinking, renaming, hard-linking, symlinking, or replacing/u,
  /Before the feature's\s+first installation, the parent and receipt root may both be genuinely absent/u,
  /exact non-symbolic absence as no latch only after proving `\/`, `\/var`, and\s+`\/var\/lib`/u,
  /Once installed, every directory through `\/var\/lib\/fetanagent` and the receipt root is canonical/u,
  /resolves every inspected bind source to a canonical host path/u,
  /explicitly treating host `\/`/u,
  /normalizes an exact imported\/failed crash prefix/u,
  /exact partial\s+single-link installer is removed durably/u,
  /rejects any\s+completed installer\/final/u,
  /legacy aggregate final\/installer names must be\s+absent from the Owner-writable session-control volume/u,
  /Latch-path presence alone is not treated as durable/u,
  /`recovery-in-progress-or-failed-v1` fallback/u,
  /fixed `pending-v1` inode\/content/u,
  /generic promotion cleanup rejects either fallback before any\s+delete/u,
  /If neither protected namespace can retain a\s+durable block, recovery and teardown both stop/u,
  /exact pre-journal\/no-mutation boundary/u,
  /\$profile_mountpoint\/\$account_id\/Singleton\*/u,
  /does\s+not compare KemerBet balances or transaction history/u,
  /freezes writes to every table from which its cohort\s+was derived/u,
  /It never auto-expires\./,
  /stale-claim alert/,
  /Never delete a claim, marker,\s+journal, or source-table lock merely because it is old/u,
]) {
  assert.match(stagingRunbook, ownerClaimRunbookContract);
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
assert.match(
  ownerCompose,
  /type: bind\s*\r?\n\s+source: \/var\/lib\/fetanagent\/kemerbet-readiness-cohort-receipts\s*\r?\n\s+target: \/run\/fetanagent-kemerbet-readiness-cohort-receipts\s*\r?\n\s+read_only: true\s*\r?\n\s+bind:\s*\r?\n\s+create_host_path: false/,
);
assert.equal(
  (compose.match(/source: \/var\/lib\/fetanagent\/kemerbet-readiness-cohort-receipts/g) ?? [])
    .length,
  1,
  'only Owner control may receive the aggregate receipt bind',
);

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
for (const retainedBackup of [
  {
    variable: 'RETAINED_121E_BACKUP',
    shaVariable: 'RETAINED_121E_BACKUP_SHA',
    name: retained121eHelperBackupName,
    path: retained121eHelperBackupPath,
    sha: retained121eHelperBackupSha,
  },
  {
    variable: 'RETAINED_AF823_BACKUP',
    shaVariable: 'RETAINED_AF823_BACKUP_SHA',
    name: retainedAf823HelperBackupName,
    path: retainedAf823HelperBackupPath,
    sha: retainedAf823HelperBackupSha,
  },
  {
    variable: 'RETAINED_B466_BACKUP',
    shaVariable: 'RETAINED_B466_BACKUP_SHA',
    name: retainedB466HelperBackupName,
    path: retainedB466HelperBackupPath,
    sha: retainedB466HelperBackupSha,
  },
  {
    variable: 'RETAINED_33F4_BACKUP',
    shaVariable: 'RETAINED_33F4_BACKUP_SHA',
    name: retained33f4HelperBackupName,
    path: retained33f4HelperBackupPath,
    sha: retained33f4HelperBackupSha,
  },
]) {
  assert.ok(
    helperReplacementRunbook.includes(
      `${retainedBackup.variable}="$STAGING_ROOT/${retainedBackup.name}"`,
    ) && helperReplacementRunbook.includes(`${retainedBackup.variable}='${retainedBackup.path}'`),
    `Both rotation directions must separately name ${retainedBackup.name}.`,
  );
  assert.equal(
    (
      helperReplacementRunbook.match(
        new RegExp(`${retainedBackup.shaVariable}='${retainedBackup.sha}'`, 'gu'),
      ) ?? []
    ).length,
    2,
    `Both rotation directions must pin ${retainedBackup.name}.`,
  );
  for (const retainedBackupContract of [
    new RegExp(
      `test ! -L "\\$${retainedBackup.variable}" && test -f "\\$${retainedBackup.variable}"`,
      'gu',
    ),
    new RegExp(
      `test "\\$\\(realpath -- "\\$${retainedBackup.variable}"\\)" = "\\$${retainedBackup.variable}"`,
      'gu',
    ),
    new RegExp(
      `test "\\$\\(stat --format='%U:%G:%a:%h' "\\$${retainedBackup.variable}"\\)" = 'root:root:600:1'`,
      'gu',
    ),
    new RegExp(
      `test "\\$\\(sha256sum "\\$${retainedBackup.variable}" \\| awk '\\{ print \\$1 \\}'\\)" = "\\$${retainedBackup.shaVariable}"`,
      'gu',
    ),
  ]) {
    assert.equal(
      (helperReplacementRunbook.match(retainedBackupContract) ?? []).length,
      2,
      `Both rotation directions must independently prove ${retainedBackup.name} is exact root-only evidence.`,
    );
  }
}
assert.doesNotMatch(
  helperReplacementRunbook,
  /(?:^|\n)\s*(?:rm|mv|install|cp|truncate|shred)\b[^\n]*"\$RETAINED_(?:121E|AF823|B466|33F4)_BACKUP"/u,
  'The current rotation must never mutate or remove any retained earlier predecessor backup.',
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
  /INSTALL_TMP_PATH='\/usr\/local\/sbin\/\.fetanagent-staging-deploy-helper\.installing-d9cdcdec'/,
  /BACKUP_TMP_PATH="\$STAGING_ROOT\/\.fetanagent-staging-deploy-helper\.previous-5267906f\.installing"/,
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
  /RESTORE_TMP_PATH='\/usr\/local\/sbin\/\.fetanagent-staging-deploy-helper\.restoring-5267906f'/,
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
for (const exactRollbackResiduePath of [
  /RECHECK_PROMOTION_ROOT='\/var\/lib\/fetanagent\/kemerbet-readiness-recheck-promotion'/,
  /RECHECK_RECEIPT_ROOT='\/var\/lib\/fetanagent\/kemerbet-readiness-recheck'/,
  /RECHECK_CANDIDATE_ROOT='\/etc\/fetanagent\/executor-secrets\/\.kemerbet-readiness-recheck-candidate'/,
  /CANONICAL_BINDING='\/etc\/fetanagent\/executor-secrets\/kemerbet_agent_identity_bindings'/,
  /IMPORT_CANDIDATE='\/etc\/fetanagent\/executor-secrets\/\.kemerbet-readiness-player-ids\.promote-v1'/,
  /READINESS_OUTPUT_ROOT='\/var\/lib\/fetanagent\/kemerbet-readiness-seal-output'/,
  /OWNER_RECEIPT_PARENT='\/var\/lib\/fetanagent'/,
  /OWNER_RECEIPT_ROOT="\$OWNER_RECEIPT_PARENT\/kemerbet-readiness-cohort-receipts"/,
  /SESSION_CONTROL_VOLUME='fetanagent-staging-beta_kemerbet_session_control'/,
  /PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'/,
]) {
  assert.match(helperRestore, exactRollbackResiduePath);
}
for (const preRecheckContract of [
  /RECHECK_PROMOTION_ROOT/,
  /RECHECK_RECEIPT_ROOT/,
  /RECHECK_CANDIDATE_ROOT/,
  /CANONICAL_BINDING/,
  /IMPORT_CANDIDATE/,
  /10001:10001:400:1/,
  /0:0:444:1/,
  /identity_key_metadata/,
  /READINESS_OUTPUT_ROOT/,
  /READINESS_BINDING/,
  /OWNER_RECEIPT_PARENT/,
  /OWNER_RECEIPT_ROOT/,
  /0:0:755/,
  /find -P "\$OWNER_RECEIPT_ROOT"[\s\S]*?-printf 'present\\n' -quit/u,
  /\[\[ -z "\$receipt_entry" \]\] \|\| return 1/,
  /stat --format='%u:%g:%a:%d:%i' "\$OWNER_RECEIPT_PARENT"/,
  /stat --format='%u:%g:%a:%d:%i' "\$OWNER_RECEIPT_ROOT"/,
  /OWNER_RECEIPT_PARENT_IDENTITY="\$current_parent_identity"/,
  /OWNER_RECEIPT_ROOT_IDENTITY="\$current_root_identity"/,
  /"\$current_parent_identity" == "\$OWNER_RECEIPT_PARENT_IDENTITY"/,
  /"\$current_root_identity" == "\$OWNER_RECEIPT_ROOT_IDENTITY"/,
  /10001:10001:600:1/,
  /kemerbet-readiness-cohort-imported-v1/,
  /kemerbet-readiness-cohort-completed-v1/,
  /kemerbet-readiness-cohort-failed-v1/,
  /profile_path="\$profile_mountpoint\/\$account_id"/,
  /SingletonCookie SingletonLock SingletonSocket/,
  /"\$profile_path\/\$absent_path"/,
  /kemerbet_session_control/,
  /kemerbet_sessions/,
  /\$PROFILE_VOLUME\|local\|local\|fetanagent-staging-beta\|kemerbet_sessions/,
  /\|\| return 1/,
]) {
  assert.match(preRecheckRollbackState, preRecheckContract);
}
assertInOrder(
  preRecheckRollbackState,
  [
    'for absent_path in \\',
    '"$IMPORT_CANDIDATE"; do',
    'for ancestor in / /var /var/lib "$OWNER_RECEIPT_PARENT" "$OWNER_RECEIPT_ROOT"; do',
    'receipt_entry="$(find -P "$OWNER_RECEIPT_ROOT" \\',
    '[[ -z "$receipt_entry" ]] || return 1',
    'current_parent_identity="$(stat',
    'current_root_identity="$(stat',
    '[[ "$current_parent_identity" == "$OWNER_RECEIPT_PARENT_IDENTITY" ]] || return 1',
    '[[ "$current_root_identity" == "$OWNER_RECEIPT_ROOT_IDENTITY" ]] || return 1',
  ],
  'rollback must exclude legacy residue, prove an already installed empty receipt namespace, and retain its inode identities',
);
assert.doesNotMatch(
  helperRestore,
  /(?:^|\n)\s*(?:chmod|chown|install\s+-d|mkdir|mv|rm|rmdir)\b[^\n]*\$(?:OWNER_RECEIPT_PARENT|OWNER_RECEIPT_ROOT)/u,
  'rollback must never create, repair, empty, move, or remove either protected receipt directory',
);
assert.doesNotMatch(
  preRecheckRollbackState,
  /if \[\[ -e "\$PLAYER_IDS"|! -e "\$PLAYER_IDS"|"\$profile_mountpoint\/\$absent_path"|"\$IMPORT_CANDIDATE" \\\n    "\$OWNER_RECEIPT_ROOT"; do/,
  'rollback compatibility must require the predecessor Player-ID source, require the protected receipt root rather than absence, and inspect Chromium singletons only under the exact account profile',
);
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
const ensureReceiptRootPosition = helper.indexOf('    ensure_owner_kemerbet_receipt_root');
const firstDatabasePreflightPosition = helper.indexOf(
  'run_bounded_database_preflight \\\n      owner-control',
);
assert.ok(
  ensureReceiptRootPosition >= 0 && ensureReceiptRootPosition < firstDatabasePreflightPosition,
  'the root-owned receipt bind source must be installed before any Compose database preflight',
);
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
assert.ok(
  helper.indexOf('require_owner_kemerbet_receipt_service_access', longLivedStart) > longLivedStart,
  'the live Owner process must prove read-only receipt access after long-lived startup',
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
assertInOrder(
  expiryStopCommand,
  [
    "[[ $# -eq 1 ]] || die 'expiry-stop accepts no additional arguments'",
    'recover_kemerbet_recheck_before_teardown',
    'emergency_stop_project_after_kemerbet_recovery_failure',
    'emergency_disarm_expiry_stop_after_kemerbet_recovery_failure',
    'require_kemerbet_teardown_recovery_success',
  ],
  'expiry-stop must validate its invocation and retire any exact promotion journal before deleting runtime credentials',
);
assert.equal(
  (expiryStopCommand.match(/require_kemerbet_teardown_recovery_success/g) ?? []).length,
  1,
  'expiry-stop must expose a nonzero fixed result only after the emergency cleanup branch finishes',
);
assert.match(helper, /"\$command" == 'expiry-stop'/);
assert.match(helper, /-z "\$\{SUDO_USER:-\}"/);
assert.match(helper, /-n "\$\{INVOCATION_ID:-\}"/);
assert.match(helper, /FETANAGENT_STAGING_EXPIRY_GUARD:-\}" == '1'/);
assert.match(helper, /expiry-stop may run only from the fixed systemd guard/);
const normalStopCommand = /\n  stop\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(normalStopCommand, 'The ordinary stop command must remain present.');
assert.match(normalStopCommand, /stop_project/);
assert.match(normalStopCommand, /disarm_expiry_stop/);
assertInOrder(
  normalStopCommand,
  [
    "[[ $# -eq 1 ]] || die 'stop accepts no additional arguments'",
    'recover_kemerbet_recheck_before_teardown',
    'emergency_stop_project_after_kemerbet_recovery_failure',
    'emergency_disarm_expiry_stop_after_kemerbet_recovery_failure',
    'require_kemerbet_teardown_recovery_success',
  ],
  'ordinary stop must retire an exact promotion journal before its first teardown or secret deletion',
);
assert.equal(
  (normalStopCommand.match(/require_kemerbet_teardown_recovery_success/g) ?? []).length,
  1,
  'ordinary stop must expose a nonzero fixed result only after the emergency cleanup branch finishes',
);
const stopProject = /stop_project\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(stopProject, 'The helper must define exact project cleanup.');
assert.match(stopProject, /remove_staging_runtime_secrets_best_effort/);
const bestEffortRuntimeRemoval = /remove_project_runtime_best_effort\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
const bestEffortSecretRemoval =
  /remove_staging_runtime_secrets_best_effort\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(bestEffortRuntimeRemoval && bestEffortSecretRemoval);
for (const contract of [
  /container rm --force \$containers[^\n]*\|\| cleanup_status=1/,
  /network rm \$networks[^\n]*\|\| cleanup_status=1/,
  /remaining=/,
  /return "\$cleanup_status"/,
]) {
  assert.match(bestEffortRuntimeRemoval, contract);
}
for (const contract of [
  /for secret_path in "\$\{secret_paths\[@\]\}"/,
  /rm -f -- "\$secret_path" \|\| cleanup_status=1/,
  /clear_bot_startup_receipt/,
  /! -e "\$secret_path" && ! -L "\$secret_path"/,
  /BOT_STARTUP_RECEIPT_ROOT/,
  /return "\$cleanup_status"/,
]) {
  assert.match(bestEffortSecretRemoval, contract);
}
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
assertInOrder(
  stopBot,
  [
    "[[ $# -eq 2 ]] || die 'stop-bot requires one reviewed main commit'",
    '[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]]',
    'recover_kemerbet_recheck_before_teardown',
    'emergency_stop_project_after_kemerbet_recovery_failure',
    'emergency_disarm_expiry_stop_after_kemerbet_recovery_failure',
    'require_kemerbet_teardown_recovery_success',
    'bot_container=',
    'clear_bot_startup_receipt',
  ],
  'bot stop must validate the reviewed commit and recover the journal before removing runtime or receipts',
);
assert.equal(
  (stopBot.match(/require_kemerbet_teardown_recovery_success/g) ?? []).length,
  2,
  'bot stop must report recovery failure after full-project emergency cleanup and retain a final normal-path check',
);
assert.doesNotMatch(
  stopBot,
  /emergency_(?:disable_bot|remove_project_service)_after_kemerbet_recovery_failure/,
  'bot-stop recovery failure must never leave Owner or another project service running',
);

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
  /profile_volume_source="\$\(docker_local container inspect "\$container_id"/,
  /\.Destination "\/var\/lib\/fetanagent\/kemerbet-sessions"/,
  /\{\{\.Name\}\}/,
  /"\$profile_volume_source" == "\$KEMERBET_PROFILE_VOLUME"/,
  /require_kemerbet_profile_volume_holders "\$container_id"/,
  /"\$owner_socket_source" == "\$KEMERBET_SESSION_CONTROL_VOLUME"/,
  /"\$session_socket_source" == "\$KEMERBET_SESSION_CONTROL_VOLUME"/,
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

const kemerbetProfileIdentityDigest = /kemerbet_profile_identity_digest\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  kemerbetProfileIdentityDigest,
  'the helper must define the exact persistent-profile identity boundary',
);
for (const contract of [
  /\[\[ \$# -eq 3 \]\]/,
  /singleton_policy="\$3"/,
  /allow-exact-stale-singletons\)/,
  /require-absent-singletons\)/,
  /allow-exact-stale-singletons\) require_kemerbet_profile_volume_holders '' \|\| return 1/,
  /the KemerBet profile singleton policy is invalid/,
  /for singleton in SingletonCookie SingletonLock SingletonSocket/,
  /if \[\[ ! -e "\$singleton_path" && ! -L "\$singleton_path" \]\]; then/,
  /"\$singleton_policy" == 'allow-exact-stale-singletons' && -L "\$singleton_path"/,
  /stat --format='%u:%g:%a:%h' -- "\$singleton_path"/,
  /"\$singleton_stat" == '10001:10001:777:1'/,
  /the KemerBet profile singleton metadata is unsafe/,
  /mountpoint_stat="\$\(stat --format='%d:%i:%u:%g:%a' "\$mountpoint"\)" \|\| return 1/,
  /profile_stat="\$\(stat --format='%d:%i:%u:%g:%a' "\$profile_path"\)" \|\| return 1/,
  /digest="\$\(printf 'volume=%s\\nroot=%s\\nprofile=%s\\naccount=%s\\n'/,
  /\[\[ "\$digest" =~ \^\[0-9a-f\]\{64\}\$ \]\] \|\| return 1/,
  /printf '%s' "\$digest"/,
]) {
  assert.match(kemerbetProfileIdentityDigest, contract);
}
assert.doesNotMatch(
  kemerbetProfileIdentityDigest,
  /\breadlink\b|\b(?:cat|head|tail|dd|od|strings)\b|\b(?:rm|unlink|shred)\b|find[^\n]*-(?:delete|exec)/iu,
  'the host profile boundary may inspect exact singleton link metadata but must not read targets, read profile contents, or delete anything',
);

assert.match(
  helper,
  /readonly KEMERBET_SESSION_CONTROL_VOLUME="\$\{PROJECT_NAME\}_kemerbet_session_control"/,
  'the Owner-staged cohort must use only the exact Compose session-control volume',
);
for (const receiptBoundaryConstant of [
  /readonly KEMERBET_OWNER_RECEIPT_PARENT='\/var\/lib\/fetanagent'/,
  /readonly KEMERBET_OWNER_RECEIPT_ROOT="\$KEMERBET_OWNER_RECEIPT_PARENT\/kemerbet-readiness-cohort-receipts"/,
  /readonly KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT='\/run\/fetanagent-kemerbet-readiness-cohort-receipts'/,
]) {
  assert.match(helper, receiptBoundaryConstant);
}

const receiptDirectory = /require_owner_kemerbet_receipt_directory\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(receiptDirectory, 'the helper must prove the fixed root-anchored receipt directory');
for (const contract of [
  /require_owner_kemerbet_receipt_ancestors/,
  /realpath -- "\$KEMERBET_OWNER_RECEIPT_PARENT"/,
  /realpath -- "\$KEMERBET_OWNER_RECEIPT_ROOT"/,
  /stat --format='%u:%g:%a' "\$KEMERBET_OWNER_RECEIPT_PARENT"/,
  /stat --format='%u:%g:%a' "\$KEMERBET_OWNER_RECEIPT_ROOT"/,
  /'0:0:755'/,
]) {
  assert.match(receiptDirectory, contract);
}

const receiptAncestors = /require_owner_kemerbet_receipt_ancestors\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(receiptAncestors, 'every host ancestor of the receipt authority must be proven safe');
for (const contract of [
  /for ancestor in \/ \/var \/var\/lib/,
  /! -L "\$ancestor" && -d "\$ancestor"/,
  /realpath -- "\$ancestor"/,
  /stat --format='%u:%g:%a' "\$ancestor"/,
  /'0:0:755'/,
]) {
  assert.match(receiptAncestors, contract);
}

const ensureReceiptRoot = /ensure_owner_kemerbet_receipt_root\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  ensureReceiptRoot,
  'the helper must create the fixed bind source without following links',
);
for (const contract of [
  /require_owner_kemerbet_receipt_ancestors/,
  /install -d -o root -g root -m 0755 "\$KEMERBET_OWNER_RECEIPT_PARENT"/,
  /install -d -o root -g root -m 0755 "\$KEMERBET_OWNER_RECEIPT_ROOT"/,
  /sync -f \/var\/lib/,
  /sync -f "\$KEMERBET_OWNER_RECEIPT_PARENT"/,
  /require_owner_kemerbet_receipt_startup_state/,
]) {
  assert.match(ensureReceiptRoot, contract);
}
assert.match(
  helper,
  /readonly KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME='kemerbet-readiness-player-ids\.stage-v1'/,
  'the Owner-staged cohort must use one fixed, versioned staging name',
);

const kemerbetSessionControlVolumeResolver =
  /resolve_kemerbet_session_control_volume_mountpoint\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  kemerbetSessionControlVolumeResolver,
  'the helper must resolve the exact shared KemerBet session-control volume on the host',
);
for (const contract of [
  /label=com\.docker\.compose\.project=\$PROJECT_NAME/,
  /label=com\.docker\.compose\.volume=kemerbet_session_control/,
  /"\$volume_name" == "\$KEMERBET_SESSION_CONTROL_VOLUME"/,
  /\$KEMERBET_SESSION_CONTROL_VOLUME\|local\|local\|\$PROJECT_NAME\|kemerbet_session_control/,
  /--format '\{\{\.Mountpoint\}\}'/,
  /"\$mountpoint" == \/\*/,
  /! -L "\$mountpoint" && -d "\$mountpoint"/,
  /realpath -- "\$mountpoint"/,
  /stat --format='%u:%g:%a' "\$mountpoint"/,
  /== '10001:10001:700'/,
]) {
  assert.match(kemerbetSessionControlVolumeResolver, contract);
}

const promoteOwnerStagedKemerbetPlayerIds =
  /promote_owner_staged_kemerbet_player_ids\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  promoteOwnerStagedKemerbetPlayerIds,
  'the helper must define the one-use Owner-staged KemerBet cohort promotion',
);
for (const contract of [
  /command -v python3/,
  /control_mountpoint="\$\(resolve_kemerbet_session_control_volume_mountpoint\)"/,
  /source="\$control_mountpoint\/\$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"/,
  /claim_source="\$control_mountpoint\/\$KEMERBET_OWNER_STAGED_CLAIM_NAME"/,
  /"\$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"/,
  /"\$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"/,
  /"\$KEMERBET_RECHECK_OWNER_CLAIM_ID"/,
  /exec \{digest_fd\}<<<"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"/,
  /"\$digest_fd" <<'PY'/,
  /import hashlib/,
  /DIGEST = re\.compile/,
  /os\.read\(descriptor, 66\)/,
  /os\.close\(descriptor\)/,
  /read_private_digest\(sys\.argv\[7\]\)/,
  /exec \{digest_fd\}<&-/,
  /EXPECTED_SOURCE_NAME = 'kemerbet-readiness-player-ids\.stage-v1'/,
  /EXPECTED_CLAIM_NAME = 'kemerbet-readiness-cohort-claim\.stage-v1'/,
  /EXPECTED_TARGET = '\/etc\/fetanagent\/executor-secrets\/kemerbet_no_transfer_readiness_player_ids'/,
  /PLAYER_ID = re\.compile\(rb'\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,63\}'\)/,
  /CLAIM_ID = re\.compile/,
  /MAXIMUM_BYTES = 1024/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /source_directory_descriptor = open_exact_directory\(source_parent, 10001, 10001, 0o700\)/,
  /target_directory_descriptor = open_exact_directory\(target_parent, 0, 0, 0o700\)/,
  /os\.O_RDWR \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /dir_fd=directory_descriptor/,
  /open_stage_file\(/,
  /require_content_digest\(player_content, expected_player_digest\)/,
  /\(10001, 10001, 0o444\)/,
  /len\(lines\) != 5 or len\(set\(lines\)\) != 5/,
  /PLAYER_ID\.fullmatch\(line\) is None/,
  /freeze_stage_file\(/,
  /metadata in \{[\s\S]*?\(10001, 10001, 0o400\),[\s\S]*?\(10001, 10001, 0o444\),[\s\S]*?\}/u,
  /os\.fchown\(descriptor, 0, 0\)/,
  /os\.fchmod\(descriptor, 0o444\)/,
  /os\.fsync\(descriptor\)/,
  /require_named_identity\(/,
  /candidate_name = '\.kemerbet-readiness-player-ids\.promote-v1'/,
  /candidate_path = os\.path\.join\(target_parent, candidate_name\)/,
  /recover_candidate\(/,
  /os\.O_CREAT\s+\| os\.O_EXCL\s+\| os\.O_NOFOLLOW/u,
  /os\.fchown\(candidate_descriptor, 10001, 10001\)/,
  /os\.fchmod\(candidate_descriptor, 0o400\)/,
  /os\.fsync\(candidate_descriptor\)/,
  /src_dir_fd=target_directory_descriptor/,
  /dst_dir_fd=target_directory_descriptor/,
  /os\.link\(\s+candidate_name,\s+target_name,[\s\S]*?follow_symlinks=False,\s+\)/u,
  /os\.unlink\(candidate_name, dir_fd=target_directory_descriptor\)/,
  /fsync_directory\(target_directory_descriptor\)/,
  /fsync_directory\(source_directory_descriptor\)/,
  /require_exact_directory\(/,
  /raise SystemExit\(1\)/,
  /require_service_file "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /stat --format='%h' "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /sha256sum -- "\$KEMERBET_READINESS_PLAYER_IDS"/,
]) {
  assert.match(promoteOwnerStagedKemerbetPlayerIds, contract);
}
const ownerCohortCandidateRecoveryPosition =
  promoteOwnerStagedKemerbetPlayerIds.indexOf('recover_candidate(');
const ownerCohortTargetPresencePosition = promoteOwnerStagedKemerbetPlayerIds.indexOf(
  'target_present = optional_named_file(',
);
assert.ok(
  ownerCohortCandidateRecoveryPosition >= 0 &&
    ownerCohortCandidateRecoveryPosition < ownerCohortTargetPresencePosition,
  'the fixed candidate must be normalized before existing-target or fresh-promotion semantics are evaluated',
);
assertInOrder(
  promoteOwnerStagedKemerbetPlayerIds,
  [
    'freeze_stage_file(',
    'fsync_directory(source_directory_descriptor)',
    'recover_candidate(',
    'os.fsync(candidate_descriptor)',
    'os.link(',
    'fsync_directory(target_directory_descriptor)',
    'os.unlink(candidate_name, dir_fd=target_directory_descriptor)',
    'require_absent(target_directory_descriptor, candidate_name, candidate_path)',
  ],
  'the import must durably freeze both retained sources, normalize crash residue, fsync content and link, then remove the fixed installer',
);
assert.doesNotMatch(
  promoteOwnerStagedKemerbetPlayerIds,
  /tempfile|mkstemp|\bprint\s*\(|os\.environ|sys\.(?:stdout|stderr)|\bsubprocess\b|os\.system|os\.pwrite|os\.ftruncate\(source|os\.unlink\(source_name|container logs|PlayerEPOSDeposit|GeneralInfoByExternalId|password=|token=/iu,
  'the one-use promotion must verify its private journal digest without logging or printing Player data',
);
assert.doesNotMatch(
  promoteOwnerStagedKemerbetPlayerIds,
  /^\s*"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" <<'PY'/mu,
  'the dictionary-testable Player cohort digest must not be exposed in the Python child process argument vector',
);
assert.equal(
  (helper.match(/\bpromote_owner_staged_kemerbet_player_ids\b/g) ?? []).length,
  3,
  'the one-use promotion must be defined once, invoked by the recheck, and resumable only from its durable import journal',
);

for (const fixedCohortPath of [
  /readonly KEMERBET_OWNER_STAGED_CLAIM_NAME='kemerbet-readiness-cohort-claim\.stage-v1'/,
  /readonly KEMERBET_OWNER_IMPORTED_CLAIM_NAME='kemerbet-readiness-cohort-imported-v1'/,
  /readonly KEMERBET_OWNER_COMPLETED_CLAIM_NAME='kemerbet-readiness-cohort-completed-v1'/,
  /readonly KEMERBET_OWNER_FAILED_CLAIM_NAME='kemerbet-readiness-cohort-failed-v1'/,
  /readonly KEMERBET_RECOVERY_LATCH_NAME='kemerbet-readiness-recovery-in-progress-or-failed-v1'/,
  /readonly KEMERBET_RECOVERY_LATCH_INSTALLING_NAME='\.kemerbet-readiness-recovery-in-progress-or-failed-v1\.installing'/,
  /readonly KEMERBET_RECOVERY_FALLBACK_NAME='recovery-in-progress-or-failed-v1'/,
  /readonly KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME='\.recovery-in-progress-or-failed-v1\.installing'/,
]) {
  assert.match(helper, fixedCohortPath);
}
const inspectRecoveryLatch = /inspect_kemerbet_recovery_latch\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
const publishRecoveryLatch = /publish_kemerbet_recovery_latch\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
const recoveryLatchAuthority = /require_kemerbet_recovery_latch_authority\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
const retireRecoveryLatch = /retire_owned_kemerbet_recovery_latch\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
const guardedIncompleteRecovery =
  /recover_incomplete_kemerbet_recheck_promotion_guarded\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
const inspectRecoveryFallback = extractShellFunction(
  helper,
  'inspect_kemerbet_recovery_fallback',
  'durably_retain_fixed_kemerbet_recovery_residue',
);
const durableRecoveryResidue = extractShellFunction(
  helper,
  'durably_retain_fixed_kemerbet_recovery_residue',
  'durably_retain_kemerbet_recovery_latch_residue',
);
const durableRecoveryLatchResidue = extractShellFunction(
  helper,
  'durably_retain_kemerbet_recovery_latch_residue',
  'durably_retain_kemerbet_recovery_fallback_residue',
);
const durableRecoveryFallbackResidue = extractShellFunction(
  helper,
  'durably_retain_kemerbet_recovery_fallback_residue',
  'require_kemerbet_recovery_fallback_publish_boundary',
);
const fallbackPublishBoundary = extractShellFunction(
  helper,
  'require_kemerbet_recovery_fallback_publish_boundary',
  'publish_kemerbet_recovery_fallback',
);
const publishRecoveryFallback = extractShellFunction(
  helper,
  'publish_kemerbet_recovery_fallback',
  'publish_kemerbet_recovery_latch',
);
const retryableRecoveryBoundary = extractShellFunction(
  helper,
  'require_retryable_kemerbet_recovery_boundary',
  'require_prejournal_kemerbet_recovery_boundary',
);
const prejournalRecoveryBoundary = extractShellFunction(
  helper,
  'require_prejournal_kemerbet_recovery_boundary',
  'require_retired_kemerbet_recovery_boundary',
);
const retiredRecoveryBoundary = extractShellFunction(
  helper,
  'require_retired_kemerbet_recovery_boundary',
  'retire_owned_kemerbet_recovery_latch',
);
const committedRecoveryBoundary = extractShellFunction(
  helper,
  'require_committed_kemerbet_recheck_boundary_shape',
  'require_current_kemerbet_success_runtime_boundary',
);
const completedOwnerRecoveryBoundary = extractShellFunction(
  helper,
  'require_completed_owner_kemerbet_cohort_marker',
  'complete_owner_staged_kemerbet_cohort',
);
const removePromotionRoot = extractShellFunction(
  helper,
  'remove_owned_kemerbet_recheck_promotion_root',
  'repair_kemerbet_identity_key_readability',
);
assert.ok(
  inspectRecoveryLatch &&
    publishRecoveryLatch &&
    recoveryLatchAuthority &&
    retireRecoveryLatch &&
    guardedIncompleteRecovery &&
    inspectRecoveryFallback &&
    durableRecoveryResidue &&
    publishRecoveryFallback &&
    retryableRecoveryBoundary &&
    prejournalRecoveryBoundary &&
    retiredRecoveryBoundary &&
    committedRecoveryBoundary &&
    completedOwnerRecoveryBoundary,
  'the helper must define a write-ahead root latch around every recovery attempt',
);
assertInOrder(
  removePromotionRoot,
  [
    'KEMERBET_RECOVERY_FALLBACK_NAME',
    'KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME',
    'find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -type f -delete',
  ],
  'generic promotion cleanup must reject either fallback name before any journal deletion',
);
assert.doesNotMatch(
  'recovery-in-progress-or-failed-v1',
  /^\.pending-v1\.[A-Za-z0-9]+$/u,
  'the durable fallback name must never enter the generic journal-temporary namespace',
);
for (const contract of [
  /for ancestor in \/ \/var \/var\/lib/,
  /0:0:755/,
  /KEMERBET_RECOVERY_LATCH_NAME/,
  /KEMERBET_RECOVERY_LATCH_INSTALLING_NAME/,
  /0:0:400:1/,
  /fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1/,
]) {
  assert.match(inspectRecoveryLatch, contract);
}
assertInOrder(
  inspectRecoveryLatch,
  [
    'for ancestor in / /var /var/lib; do',
    'if [[ ! -e "$KEMERBET_OWNER_RECEIPT_PARENT" && ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" ]]; then',
    '[[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]] || return 2',
    '[[ ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" && -d "$KEMERBET_OWNER_RECEIPT_PARENT"',
    'if [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]]; then',
    '[[ ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" && -d "$KEMERBET_OWNER_RECEIPT_ROOT"',
    'for path in \\',
  ],
  'recovery-latch inspection must recognize only exact pre-install absence before validating and enumerating an existing protected root',
);
assert.doesNotMatch(
  inspectRecoveryLatch,
  /\b(?:install|ln|mkdir|mv|rm)\b/u,
  'recovery-latch inspection must remain read-only when proving a pre-install namespace absent',
);
for (const contract of [
  /KEMERBET_RECOVERY_FALLBACK_NAME/,
  /KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME/,
  /present_count/,
  /0:0:700/,
  /0:0:400:1/,
  /fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1/,
]) {
  assert.match(inspectRecoveryFallback, contract);
}
for (const contract of [
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW/,
  /os\.O_RDONLY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /len\(residue_names\) != 1/,
  /not CONTENT\.startswith\(residue_content\)/,
  /os\.fsync\(residue_fd\)/,
  /os\.fsync\(journal_fd\)/,
  /os\.fsync\(root_fd\)/,
  /not same\(residue_stat, named_residue\)/,
  /not same\(journal_stat, named_journal\)/,
]) {
  assert.match(durableRecoveryResidue, contract);
}
for (const contract of [
  /for ancestor in \/ \/var \/var\/lib/,
  /0:0:755/,
  /durably_retain_fixed_kemerbet_recovery_residue/,
  /receipt "\$KEMERBET_OWNER_RECEIPT_ROOT"/,
]) {
  assert.match(durableRecoveryLatchResidue, contract);
}
for (const contract of [
  /for ancestor in \/ \/var \/var\/lib/,
  /0:0:755/,
  /0:0:700/,
  /durably_retain_fixed_kemerbet_recovery_residue/,
  /promotion "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
]) {
  assert.match(durableRecoveryFallbackResidue, contract);
}
for (const contract of [
  /entries=.*find -P "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /\[\[ "\$entries" == 'pending-v1' \]\]/,
  /0:0:600:1/,
  /version=1/,
  /state=\(import_prepared\|prepared\|candidate_bound\)/,
]) {
  assert.match(fallbackPublishBoundary, contract);
}
for (const contract of [
  /require_kemerbet_recovery_fallback_publish_boundary/,
  /KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME/,
  /journal_fd = os\.open/,
  /journal_content = os\.pread/,
  /os\.O_WRONLY \| os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW/,
  /os\.fsync\(installing_fd\)/,
  /os\.rename\(/,
  /os\.fsync\(root_fd\)/,
  /publisher_status=\$\?/,
  /\[\[ "\$publisher_status" -eq 0 \]\] \|\| return 1/,
  /inspect_kemerbet_recovery_fallback/,
]) {
  assert.match(publishRecoveryFallback, contract);
}
assertInOrder(
  publishRecoveryFallback,
  [
    'journal_fd = os.open',
    'installing_fd = os.open',
    'os.fsync(installing_fd)',
    'os.rename(',
    'os.fsync(root_fd)',
    'named_journal = os.stat',
    'publisher_status=$?',
    '[[ "$publisher_status" -eq 0 ]] || return 1',
    'inspect_kemerbet_recovery_fallback',
  ],
  'the fallback must bind the exact journal and durably rename its fixed installer before success',
);
for (const contract of [
  /os\.O_WRONLY \| os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW/,
  /os\.fchown\(installing_fd, 0, 0\)/,
  /os\.fchmod\(installing_fd, 0o400\)/,
  /os\.fsync\(installing_fd\)/,
  /os\.rename\(/,
  /os\.fsync\(root_fd\)/,
  /publisher_status=\$\?/,
  /\[\[ "\$publisher_status" -eq 0 \]\] \|\| return 1/,
  /KEMERBET_RECOVERY_LATCH_DEV_INO="\$\(stat --format='%d:%i'/,
]) {
  assert.match(publishRecoveryLatch, contract);
}
assertInOrder(
  publishRecoveryLatch,
  [
    'set +e',
    'os.rename(',
    'os.fsync(root_fd)',
    'publisher_status=$?',
    '[[ "$publisher_status" -eq 0 ]] || return 1',
    'inspect_kemerbet_recovery_latch',
    'KEMERBET_RECOVERY_LATCH_DEV_INO=',
  ],
  'latch namespace shape must never hide a failed final-rename directory fsync',
);
for (const contract of [
  /inspect_kemerbet_recovery_fallback/,
  /durable KemerBet recovery fallback blocks readiness mutation/,
  /KEMERBET_RECOVERY_LATCH_DEV_INO/,
  /stat --format='%d:%i'/,
  /pre-existing or unsafe KemerBet recovery latch blocks readiness mutation/,
]) {
  assert.match(recoveryLatchAuthority, contract);
}
assertInOrder(
  recoveryLatchAuthority,
  ['inspect_kemerbet_recovery_fallback', 'inspect_kemerbet_recovery_latch'],
  'fallback state must block every marker or recovery authority before latch authorization',
);
for (const contract of [
  /require_retired_kemerbet_recovery_boundary \|\| return 1/,
  /require_owner_kemerbet_receipt_service_access \|\| return 1/,
  /os\.O_RDONLY \| os\.O_NOFOLLOW/,
  /expected_dev_ino/,
  /os\.unlink\(final_name, dir_fd=root_fd\)/,
  /os\.fsync\(root_fd\)/,
  /write_replacement/,
  /retire_status=\$\?/,
  /\[\[ "\$retire_status" -eq 0 \]\] \|\| return 1/,
  /KEMERBET_RECOVERY_LATCH_DEV_INO=''/,
]) {
  assert.match(retireRecoveryLatch, contract);
}
assertInOrder(
  retireRecoveryLatch,
  [
    'require_retired_kemerbet_recovery_boundary || return 1',
    'require_owner_kemerbet_receipt_service_access || return 1',
    'set +e',
    'env -i PATH="$SAFE_PATH" python3',
    'os.unlink(final_name, dir_fd=root_fd)',
  ],
  'latch retirement must re-prove the independently retired boundary and the live read-only Owner bind immediately before its unlink transaction',
);
assertInOrder(
  guardedIncompleteRecovery,
  [
    'inspect_kemerbet_recovery_fallback',
    '[[ "$fallback_status" -eq 1 ]]',
    'inspect_kemerbet_recovery_latch',
    '[[ "$latch_status" -eq 1 ]]',
    'require_owner_kemerbet_receipt_service_access',
    'publish_kemerbet_recovery_latch',
    'require_owned_kemerbet_recovery_latch',
    'recover_incomplete_kemerbet_recheck_promotion',
    'require_retired_kemerbet_recovery_boundary',
    'retire_owned_kemerbet_recovery_latch',
  ],
  'guarded recovery must prove the live read-only Owner bind before publishing the latch, repeat that proof inside raw recovery, and retire the latch only after an independent success boundary',
);
for (const contract of [
  /expected_claim_id/,
  /expected_claim_dev_ino/,
  /expected_player_dev_ino/,
  /expected_player_digest/,
  /expected_source_dev_ino/,
  /expected_source_digest/,
  /expected_identity_digest/,
  /require_retryable_kemerbet_binding_source/,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /inspect_owner_staged_kemerbet_cohort/,
  /owner_kemerbet_cohort_marker require-failed/,
  /KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME/,
  /KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME/,
  /KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME/,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY" \|\| return 1/,
  /inspect_owner_staged_kemerbet_cohort \|\| return 1/,
  /require_legacy_owner_kemerbet_receipt_paths_absent \|\| return 1/,
]) {
  assert.match(retryableRecoveryBoundary, contract);
}
for (const contract of [
  /require_owned_kemerbet_recovery_latch/,
  /pre-journal KemerBet recovery retained a derived artifact/,
  /require_kemerbet_readiness_output_directory/,
  /hmac-sha256-agent-identity-v1/,
  /inspect_owner_staged_kemerbet_cohort/,
  /KEMERBET_OWNER_FAILED_CLAIM_NAME/,
  /KEMERBET_RECOVERY_LATCH_NAME/,
  /require_owned_kemerbet_recovery_latch \|\| return 1/,
  /inspect_owner_staged_kemerbet_cohort \|\| return 1/,
  /require_legacy_owner_kemerbet_receipt_paths_absent \|\| return 1/,
]) {
  assert.match(prejournalRecoveryBoundary, contract);
}
for (const contract of [
  /case "\$KEMERBET_RECHECK_RECOVERY_OUTCOME" in/,
  /committed\)/,
  /retryable\)/,
  /prejournal_no_mutation\)/,
  /require_committed_kemerbet_recheck_boundary_shape/,
  /require_retryable_kemerbet_recovery_boundary/,
  /require_prejournal_kemerbet_recovery_boundary/,
  /missing or invalid/,
  /require_committed_kemerbet_recheck_boundary_shape \|\| return 1/,
  /require_completed_owner_kemerbet_cohort_marker \|\| return 1/,
  /require_retryable_kemerbet_recovery_boundary \|\| return 1/,
  /require_prejournal_kemerbet_recovery_boundary \|\| return 1/,
  /require_owned_kemerbet_recovery_latch \|\| return 1/,
]) {
  assert.match(retiredRecoveryBoundary, contract);
}
assert.match(
  committedRecoveryBoundary,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_BINDINGS" \|\| return 1/,
);
for (const contract of [
  /control_mountpoint="\$\(resolve_kemerbet_session_control_volume_mountpoint\)" \|\| return 1/,
  /require_legacy_owner_kemerbet_receipt_paths_absent \|\| return 1/,
]) {
  assert.match(completedOwnerRecoveryBoundary, contract);
}
const singleOwnerControlRuntime =
  /require_single_owner_control_runtime_instance\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  singleOwnerControlRuntime,
  'the root import boundary must explicitly reject absent or scaled Owner control runtimes',
);
for (const contract of [
  /label=com\.docker\.compose\.project=\$PROJECT_NAME/,
  /label=com\.docker\.compose\.service=owner-control/,
  /\[\[ "\$owner_ids" =~ \^\[0-9a-f\]\{12,64\}\$ \]\]/,
  /\$PROJECT_NAME\|owner-control/,
  /exactly one Owner control container/,
  /require_owner_kemerbet_receipt_directory/,
  /bind\|\$KEMERBET_OWNER_RECEIPT_ROOT\|\$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT\|false/,
  /container ls --all --quiet --no-trunc/,
  /for bind_container in "\$\{all_container_ids\[@\]\}"/,
  /container inspect "\$bind_container"/,
  /container_bind_contracts/,
  /if \[\[ -n "\$container_bind_contracts" \]\]/,
  /\{\{if eq \.Type "bind"\}\}/,
  /bind_source_canonical="\$\(realpath -- "\$bind_source"\)"/,
  /realpath -- "\$bind_source_canonical"/,
  /"\$bind_source_canonical" == '\/'/,
  /"\$bind_source_canonical" == "\$KEMERBET_OWNER_RECEIPT_ROOT\/"\*/,
  /"\$KEMERBET_OWNER_RECEIPT_ROOT" == "\$bind_source_canonical\/"\*/,
  /\$owner_ids\|bind\|\$KEMERBET_OWNER_RECEIPT_ROOT\|\$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT\|false/,
  /overlaps an unexpected container bind/,
  /require_owner_kemerbet_receipt_directory \|\| return 1/,
  /require_legacy_owner_kemerbet_receipt_paths_absent \|\| return 1/,
]) {
  assert.match(singleOwnerControlRuntime, contract);
}
assert.doesNotMatch(
  singleOwnerControlRuntime,
  /container inspect "\$\{all_container_ids\[@\]\}"|\b(?:start|stop|rm|kill|scale|up|create)\b/iu,
  'the singleton proof must be read-only and must inspect bind inventories one container at a time',
);
assert.ok(
  (helper.match(/\brequire_single_owner_control_runtime_instance\b/g) ?? []).length >= 3,
  'the singleton/mount proof must guard direct stage inspection and the live Owner service-access gate',
);
assert.ok(
  (helper.match(/\brequire_owner_kemerbet_receipt_service_access\b/g) ?? []).length >= 6,
  'live read-only Owner service access must guard recovery, aggregate transitions, startup, and finalization',
);
const receiptServiceAccess =
  /require_owner_kemerbet_receipt_service_access\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(receiptServiceAccess, 'the running Owner process must prove read-only receipt access');
for (const contract of [
  /require_single_owner_control_runtime_instance \|\| return 1/,
  /container ls --quiet --no-trunc/,
  /container exec "\$owner_id" node -e/,
  /readdirSync\(p\)/,
  /R_OK\|fs\.constants\.X_OK/,
  /fs\.constants\.W_OK/,
  /EACCES','EPERM','EROFS/,
]) {
  assert.match(receiptServiceAccess, contract);
}
assert.doesNotMatch(
  receiptServiceAccess,
  /container ls --all/,
  'receipt service access must reject an exited Owner even when its mount configuration remains present',
);
const inspectOwnerCohort = /inspect_owner_staged_kemerbet_cohort\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(inspectOwnerCohort, 'the helper must inspect both Owner stage files before journaling');
for (const contract of [
  /10001:10001:400:1/,
  /require_single_owner_control_runtime_instance \|\| return 1/,
  /control_mountpoint="\$\(resolve_kemerbet_session_control_volume_mountpoint\)" \|\| return 1/,
  /claim_size" == '37'/,
  /KEMERBET_RECHECK_OWNER_CLAIM_ID/,
  /cmp -s -- "\$claim_path"/,
  /require-failed/,
  /KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO/,
  /KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO/,
  /KEMERBET_RECHECK_PLAYER_IDS_DIGEST/,
  /import hashlib/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /os\.O_RDONLY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /os\.pread\(descriptor/,
  /hashlib\.sha256\(player_content\)\.hexdigest\(\)/,
  /len\(lines\) != 5/,
  /sys\.stdout\.write\(/,
]) {
  assert.match(inspectOwnerCohort, contract);
}
assert.doesNotMatch(
  inspectOwnerCohort,
  /PlayerEPOSDeposit|GeneralInfoByExternalId|container logs|password=|token=|\bprint\s*\(/iu,
  'Owner cohort inspection may return only captured device/inode identities and a private digest to the helper process',
);

const currentKemerbetSuccessRuntimeBoundary =
  /require_current_kemerbet_success_runtime_boundary\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  currentKemerbetSuccessRuntimeBoundary,
  'normal and recovered completion must share one exact current-runtime attestation boundary',
);
for (const contract of [
  /require_kemerbet_recheck_receipt/,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /sha256sum -- "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /sha256sum -- "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /sha256sum -- "\$KEMERBET_SELECTOR_CONTRACT"/,
  /kemerbet_profile_identity_digest/,
  /require-absent-singletons/,
  /docker_local image inspect "\$image_id"/,
  /org\.opencontainers\.image\.revision/,
  /require_exact_fresh_bot_runtime "\$commit_sha" published-steady-state/,
  /require_owner_kemerbet_receipt_service_access/,
  /require_kemerbet_profile_volume_holders ''/,
  /KEMERBET_RECHECK_CONTAINER/,
  /KEMERBET_RECHECK_NETWORK/,
  /profile_mountpoint="\$\(resolve_kemerbet_profile_volume_mountpoint\)" \|\| return 1/,
  /observed_profile_identity_digest="\$\(kemerbet_profile_identity_digest/,
  /require-absent-singletons\)" \|\| return 1/,
]) {
  assert.match(currentKemerbetSuccessRuntimeBoundary, contract);
}
assert.doesNotMatch(
  currentKemerbetSuccessRuntimeBoundary,
  /container start|compose .*\bup\b|PlayerEPOSDeposit|GeneralInfoByExternalId|FINANCIAL_ACTIONS_MODE=live|container logs/iu,
  'the reusable success boundary must only attest current state and cannot run a probe or financial action',
);
assert.equal(
  (helper.match(/\brequire_current_kemerbet_success_runtime_boundary\b/g) ?? []).length,
  8,
  'the shared boundary must be defined once and invoked at every normal/recovered pre- and post-completion boundary',
);

const precommitKemerbetArtifacts =
  /require_precommit_kemerbet_artifact_boundary\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  precommitKemerbetArtifacts,
  'the receipt commit point must retain every sealed retry source',
);
for (const contract of [
  /require_retryable_kemerbet_binding_source/,
  /KEMERBET_READINESS_PLAYER_IDS/,
  /player_ids_dev_ino:1/,
  /sha256sum -- "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /KEMERBET_RECHECK_CANDIDATE_BINDING/,
  /KEMERBET_AGENT_IDENTITY_BINDINGS/,
  /\$binding_dev_ino:2/,
  /owner_kemerbet_cohort_marker require-imported/,
]) {
  assert.match(precommitKemerbetArtifacts, contract);
}

const committedKemerbetCleanupArtifacts =
  /require_committed_kemerbet_cleanup_artifacts\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  committedKemerbetCleanupArtifacts,
  'receipt-authorized recovery must accept only exact journaled content or durable pathname absence',
);
for (const contract of [
  /canonical_links/,
  /KEMERBET_RECHECK_CANDIDATE_BINDING/,
  /require_retryable_kemerbet_binding_source/,
  /KEMERBET_READINESS_PLAYER_IDS/,
  /player_ids_dev_ino:0:0:444:1/,
  /sha256sum -- "\$KEMERBET_READINESS_PLAYER_IDS"/,
]) {
  assert.match(committedKemerbetCleanupArtifacts, contract);
}

const cohortMarker = /owner_kemerbet_cohort_marker\(\) \{[\s\S]*?\nPY\n\}/u.exec(helper)?.[0];
assert.ok(cohortMarker, 'the helper must publish only fixed aggregate cohort markers');
for (const contract of [
  /ALLOWED = \{/,
  /require_kemerbet_recovery_latch_authority \|\| return 1/,
  /require_owner_kemerbet_receipt_service_access \|\| return 1/,
  /"\$KEMERBET_OWNER_RECEIPT_ROOT\/\$marker_name"/,
  /\(0, 0, 0o755\)/,
  /os\.listdir\(directory_descriptor\)/,
  /CLAIM_ID = re\.compile/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /\(0, 10001, 0o440, links, len\(content\)\)/,
  /os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /write_all\(installing_descriptor, content\)/,
  /os\.fchown\(installing_descriptor, 0, 10001\)/,
  /os\.fchmod\(installing_descriptor, 0o440\)/,
  /os\.fsync\(installing_descriptor\)/,
  /os\.link\(/,
  /os\.fsync\(directory_descriptor\)/,
  /os\.unlink\(installing_name, dir_fd=directory_descriptor\)/,
  /def exact_installing_prefix\(/,
  /content\[:named\.st_size\]/,
]) {
  assert.match(cohortMarker, contract);
}
assertInOrder(
  cohortMarker,
  ['require_owner_kemerbet_receipt_service_access', 'env -i PATH="$SAFE_PATH" python3'],
  'every root receipt transition must prove the exact Owner process is running with live read-only service access immediately before mutation',
);
const retryMarkerGuard = /if action == 'guard-retry':([\s\S]*?)\n            return/u.exec(
  cohortMarker,
)?.[1];
assert.ok(
  retryMarkerGuard,
  'retry cleanup must normalize only journal-bound marker crash prefixes',
);
for (const contract of [
  /if 'completed' in final_name and \(pending is not None or final is not None\)/,
  /pending\.st_nlink != 2/,
  /final\.st_nlink != 2/,
  /exact_marker\(directory_descriptor, pending_name, pending_path, content, 2\)/,
  /exact_installing_prefix\(directory_descriptor, pending_name, pending, content\)/,
  /os\.unlink\(pending_name, dir_fd=directory_descriptor\)/,
  /os\.fsync\(directory_descriptor\)/,
  /if len\(observed\) > 1/,
]) {
  assert.match(retryMarkerGuard, contract);
}
assertInOrder(
  retryMarkerGuard,
  ['observed = []', 'if len(observed) > 1:', 'if observed:', 'os.unlink(pending_name'],
  'retry guard must reject conflicting imported/failed crash prefixes before it normalizes any installer',
);
assert.doesNotMatch(
  cohortMarker,
  /allow-zero-owner|owner_policy|runtime_policy/,
  'aggregate receipt mutation must always require the exact live singleton Owner read-only bind',
);
assert.doesNotMatch(
  cohortMarker,
  /resolve_kemerbet_session_control_volume_mountpoint|\$control_mountpoint\/\$marker_name/,
  'aggregate markers must never derive their namespace from the Owner-writable session volume',
);
assert.doesNotMatch(
  cohortMarker,
  /Player ID|sha256|hexdigest|\bprint\s*\(|sys\.(?:stdout|stderr)|GeneralInfoByExternalId|PlayerEPOSDeposit/iu,
  'aggregate marker publication must not expose identifiers, digests, or provider operations',
);
const completeOwnerCohort = /complete_owner_staged_kemerbet_cohort\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(completeOwnerCohort, 'the helper must define the committed aggregate-marker sequence');
assertInOrder(
  completeOwnerCohort,
  [
    'consume_owner_staged_kemerbet_cohort',
    'remove-imported',
    'remove-failed',
    'publish-completed',
    'require-completed',
  ],
  'completion must consume both stages and clear transient markers before publishing completed last',
);
const consumeOwnerCohort =
  /consume_owner_staged_kemerbet_cohort\(\) \{[\s\S]*?\nPY\n[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  consumeOwnerCohort,
  'committed completion must consume the journal-bound Owner stage pair through one descriptor-bound operation',
);
for (const contract of [
  /KEMERBET_RECHECK_PLAYER_IDS_DIGEST/,
  /exec \{digest_fd\}<<<"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"/,
  /"\$digest_fd" <<'PY'/,
  /import hashlib/,
  /DIGEST = re\.compile/,
  /os\.read\(descriptor, 66\)/,
  /os\.close\(descriptor\)/,
  /read_private_digest\(sys\.argv\[5\]\)/,
  /exec \{digest_fd\}<&-/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /os\.O_RDWR \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /\(named\.st_dev, named\.st_ino\) != expected_identity/,
  /\(0, 0, 0o444, 1, expected_size\)/,
  /hashlib\.sha256\(player_content\)\.hexdigest\(\) != player_digest/,
  /os\.pwrite\(descriptor, block\[:length\], offset\)/,
  /os\.fsync\(descriptor\)/,
  /os\.unlink\(item\[0\], dir_fd=directory_descriptor\)/,
  /os\.fsync\(directory_descriptor\)/,
  /require_absent\(directory, directory_descriptor, player_path\)/,
  /require_absent\(directory, directory_descriptor, claim_path\)/,
]) {
  assert.match(consumeOwnerCohort, contract);
}
assert.doesNotMatch(
  consumeOwnerCohort,
  /\bprint\s*\(|sys\.(?:stdout|stderr)|GeneralInfoByExternalId|PlayerEPOSDeposit|container logs/iu,
  'stage consumption must privately verify and unlink only journal-bound inodes without exposing identifiers or invoking a provider action',
);
assert.doesNotMatch(
  consumeOwnerCohort,
  /^\s*"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" <<'PY'/mu,
  'stage consumption must transport the private Player cohort digest outside argv',
);
const ownerStageUnlinkIndex = consumeOwnerCohort.lastIndexOf(
  'os.unlink(item[0], dir_fd=directory_descriptor)',
);
const ownerStageDirectoryFsyncIndex = consumeOwnerCohort.indexOf(
  'os.fsync(directory_descriptor)',
  ownerStageUnlinkIndex,
);
const ownerStageAbsenceIndex = consumeOwnerCohort.indexOf(
  'require_absent(directory, directory_descriptor, player_path)',
  ownerStageDirectoryFsyncIndex,
);
const ownerStageEraseIndex = consumeOwnerCohort.lastIndexOf('erase(item[2], item[4])');
assert.ok(
  ownerStageUnlinkIndex >= 0 &&
    ownerStageDirectoryFsyncIndex > ownerStageUnlinkIndex &&
    ownerStageAbsenceIndex > ownerStageDirectoryFsyncIndex &&
    ownerStageEraseIndex > ownerStageAbsenceIndex,
  'both Owner stages must be unlinked and directory-synced before any optional descriptor-only wipe, so every crash prefix leaves exact content or durable absence',
);
const restoreOwnerCohort =
  /restore_owner_staged_kemerbet_cohort\(\) \{[\s\S]*?\n\}(?=\n\nconsume_owner_staged_kemerbet_cohort\(\))/u.exec(
    helper,
  )?.[0];
assert.ok(
  restoreOwnerCohort,
  'retry recovery must restore the exact retained Owner stage pair through descriptor-bound metadata changes',
);
for (const contract of [
  /exec \{digest_fd\}<<<"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"/,
  /"\$digest_fd" <<'PY'/,
  /os\.read\(descriptor, 66\)/,
  /os\.close\(descriptor\)/,
  /read_private_digest\(sys\.argv\[6\]\)/,
  /exec \{digest_fd\}<&-/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /os\.O_RDWR \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /\(relative\.st_dev, relative\.st_ino\) != expected_identity/,
  /\(10001, 10001, 0o444\)/,
  /hashlib\.sha256\(player_content\)\.hexdigest\(\) != player_digest/,
  /os\.fchown\(descriptor, 10001, 10001\)/,
  /os\.fchmod\(descriptor, 0o400\)/,
  /os\.fsync\(descriptor\)/,
  /os\.fsync\(directory_descriptor\)/,
  /\.kemerbet-readiness-cohort-completed-v1\.installing/,
  /kemerbet-readiness-cohort-completed-v1/,
]) {
  assert.match(restoreOwnerCohort, contract);
}
assert.doesNotMatch(
  restoreOwnerCohort,
  /\.kemerbet-readiness-cohort-(?:imported|failed)-v1\.installing/,
  'retry restoration must leave journal-owned imported/failed installer crash prefixes for the exact marker transition to normalize',
);
assert.doesNotMatch(
  restoreOwnerCohort,
  /^\s*"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" <<'PY'/mu,
  'retry restoration must transport the private Player cohort digest outside argv',
);
const restoreRetryableOwnerCohort =
  /restore_retryable_owner_staged_kemerbet_cohort\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  restoreRetryableOwnerCohort,
  'the helper must restore both exact stage files before publishing retryable failure',
);
assertInOrder(
  restoreRetryableOwnerCohort,
  [
    'guard-retry',
    'restore_owner_staged_kemerbet_cohort',
    'guard-retry',
    'remove-imported',
    'publish-failed',
    'require-failed',
  ],
  'retryable failure must restore both sources first and expose only an aggregate failure marker',
);
assert.equal(
  (restoreRetryableOwnerCohort.match(/guard-retry/g) ?? []).length,
  2,
  'retry restore must prove the separate completed receipt absent both before and after stage mutation',
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
  /inspect_owner_staged_kemerbet_cohort/,
  /record_kemerbet_recheck_promotion_journal/,
  /require_kemerbet_recheck_import_prepared_promotion_journal/,
  /promote_owner_staged_kemerbet_player_ids/,
  /advance_kemerbet_recheck_import_journal_to_prepared/,
  /owner_kemerbet_cohort_marker publish-imported/,
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
  /allow-exact-stale-singletons/,
  /require-absent-singletons/,
  /profile_identity_digest="\$\(kemerbet_profile_identity_digest[\s\S]*?allow-exact-stale-singletons\)" \|\|/,
  /observed_profile_identity_digest="\$\(kemerbet_profile_identity_digest[\s\S]*?require-absent-singletons\)" \|\|/,
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
  /consume_exact_kemerbet_binding_source/,
  /KEMERBET_RECHECK_RECEIPT_OWNED='true'/,
  /require_kemerbet_recheck_receipt/,
  /require_precommit_kemerbet_artifact_boundary/,
  /require_current_kemerbet_success_runtime_boundary/,
  /require_committed_kemerbet_recheck_boundary_shape/,
  /KEMERBET_RECHECK_DURABLE_SUCCESS='true'/,
  /complete_owner_staged_kemerbet_cohort/,
  /require_completed_owner_kemerbet_cohort_marker/,
  /KEMERBET_RECHECK_COMMITTED='true'/,
  /KEMERBET_RECHECK_CLEANUP_ARMED='false'/,
  /trap - EXIT INT TERM HUP/,
  /KemerBet server readiness passed: 5 of 5 Players, Transfer disabled\./,
  /record_kemerbet_recheck_receipt/,
]) {
  assert.match(recheckKemerbetReadiness, contract);
}
assert.equal(
  (recheckKemerbetReadiness.match(/allow-exact-stale-singletons/g) ?? []).length,
  1,
  'the one-shot recheck must accept exact stale singleton symlinks only at the holder-free pre-container profile check',
);
assert.equal(
  (recheckKemerbetReadiness.match(/require-absent-singletons/g) ?? []).length,
  1,
  'the one-shot recheck directly requires singleton removal after execution; the reusable current-runtime boundary repeats that proof before and after commit',
);
assert.equal(
  (recheckKemerbetReadiness.match(/require_current_kemerbet_success_runtime_boundary/g) ?? [])
    .length,
  4,
  'normal success must prove the full current runtime boundary before the receipt, after the receipt, before completed publication, and after publication',
);
assertInOrder(
  recheckKemerbetReadiness,
  [
    'recover_incomplete_kemerbet_recheck_promotion',
    'require_completed_kemerbet_recheck_for_release "$commit_sha" "$image_tag"',
    'inspect_owner_staged_kemerbet_cohort',
    'source_stat="$(stat',
    'record_kemerbet_recheck_promotion_journal',
    'require_kemerbet_recheck_import_prepared_promotion_journal',
    "KEMERBET_RECHECK_CLEANUP_ARMED='true'",
    'owner_kemerbet_cohort_marker remove-failed',
    'promote_owner_staged_kemerbet_player_ids',
    'advance_kemerbet_recheck_import_journal_to_prepared',
    'require_kemerbet_recheck_prepared_promotion_journal',
    'owner_kemerbet_cohort_marker publish-imported',
    'harden_kemerbet_identity_key',
    'advance_kemerbet_recheck_promotion_journal',
    'create --no-build --no-recreate kemerbet-no-transfer-readiness',
    'require_kemerbet_recheck_container_contract',
    'container start --attach "$recheck_container"',
    '[[ "$recheck_status" -eq 0 ]]',
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
    'ln -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" "$KEMERBET_AGENT_IDENTITY_BINDINGS"',
    'require_precommit_kemerbet_artifact_boundary',
    'require_current_kemerbet_success_runtime_boundary',
    'record_kemerbet_recheck_receipt',
    'require_kemerbet_recheck_receipt',
    'require_kemerbet_recheck_promotion_journal',
    'require_precommit_kemerbet_artifact_boundary',
    'require_current_kemerbet_success_runtime_boundary',
    "KEMERBET_RECHECK_DURABLE_SUCCESS='true'",
    'consume_exact_one_use_kemerbet_file',
    'remove_kemerbet_recheck_candidate',
    'consume_exact_kemerbet_binding_source',
    'require_committed_kemerbet_recheck_boundary_shape',
    'require_current_kemerbet_success_runtime_boundary',
    'complete_owner_staged_kemerbet_cohort',
    'require_completed_owner_kemerbet_cohort_marker',
    'require_committed_kemerbet_recheck_boundary_shape',
    'require_current_kemerbet_success_runtime_boundary',
    'remove_owned_kemerbet_recheck_promotion_root',
    "KEMERBET_RECHECK_COMMITTED='true'",
    "KEMERBET_RECHECK_CLEANUP_ARMED='false'",
  ],
  'the recheck must durably journal before import mutation, run only the no-transfer check, then publish completion after its receipt and binding are durable',
);
assert.doesNotMatch(
  recheckKemerbetReadiness,
  /install -o 10001|root:root:700\|root:root:755|container logs|\bcat\b|\bshred\b|PlayerEPOSDeposit|GeneralInfoByExternalId|password=|token=|FINANCIAL_ACTIONS_MODE=live/iu,
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
  "KEMERBET_RECHECK_PLAYER_IDS_DIGEST=''",
  "KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO=''",
  "KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO=''",
  "KEMERBET_RECHECK_OWNER_CLAIM_ID=''",
  "KEMERBET_RECHECK_RELEASE=''",
  "KEMERBET_RECHECK_SESSION_CONTAINER=''",
  "KEMERBET_RECHECK_SOURCE_DEV_INO=''",
  "KEMERBET_RECHECK_SOURCE_DIGEST=''",
  "KEMERBET_RECHECK_COMMITTED='false'",
  "KEMERBET_RECHECK_DURABLE_SUCCESS='false'",
]) {
  assert.match(helper, new RegExp(`^${lifecycleInitialization}$`, 'm'));
}

const consumeExactOneUseKemerbetFile =
  /consume_exact_one_use_kemerbet_file\(\) \{[\s\S]*?\n\}(?=\n\nremove_kemerbet_recheck_container\(\))/u.exec(
    helper,
  )?.[0];
assert.ok(
  consumeExactOneUseKemerbetFile,
  'the helper must descriptor-validate and unlink the exact one-use Player or sealed binding source',
);
for (const contract of [
  /import hashlib/,
  /exec \{digest_fd\}<<<"\$expected_digest"/,
  /"\$digest_fd" <<'PY'/,
  /os\.read\(descriptor, 66\)/,
  /os\.close\(descriptor\)/,
  /read_private_digest\(sys\.argv\[3\]\)/,
  /exec \{digest_fd\}<&-/,
  /CONTRACTS = \{/,
  /kemerbet_no_transfer_readiness_player_ids/,
  /kemerbet_agent_identity_bindings/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /os\.O_RDONLY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /\(named\.st_dev, named\.st_ino\) != expected_identity/,
  /named\.st_nlink != 1/,
  /hashlib\.sha256\(content\)\.hexdigest\(\) != expected_digest/,
  /os\.unlink\(name, dir_fd=directory_descriptor\)/,
  /os\.fsync\(directory_descriptor\)/,
  /os\.stat\(name, dir_fd=directory_descriptor, follow_symlinks=False\)/,
]) {
  assert.match(consumeExactOneUseKemerbetFile, contract);
}
assert.doesNotMatch(
  consumeExactOneUseKemerbetFile,
  /\bshred\b|os\.pwrite|os\.write|os\.ftruncate|\bprint\s*\(|sys\.(?:stdout|stderr)|GeneralInfoByExternalId|PlayerEPOSDeposit/iu,
  'one-use cleanup must never modify named content before durable unlink or expose Player data',
);
assert.doesNotMatch(
  consumeExactOneUseKemerbetFile,
  /^\s*"\$expected_digest" <<'PY'/mu,
  'one-use cleanup must not expose a private journal digest in argv',
);
assertInOrder(
  consumeExactOneUseKemerbetFile,
  [
    'hashlib.sha256(content).hexdigest() != expected_digest',
    'os.unlink(name, dir_fd=directory_descriptor)',
    'os.fsync(directory_descriptor)',
    'os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)',
  ],
  'one-use cleanup must validate the exact descriptor digest, unlink, sync the parent, and prove durable pathname absence in that order',
);

const requireKemerbetIdentityKey = /require_kemerbet_identity_key_file\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  requireKemerbetIdentityKey,
  'the KemerBet identity-key boundary must accept only the exact service or hardened-root metadata',
);
for (const contract of [
  /metadata="\$\(stat --format='%u:%g:%a' "\$path"\)"/,
  /"\$metadata" == '10001:10001:400' \|\| "\$metadata" == '0:0:444'/,
]) {
  assert.match(requireKemerbetIdentityKey, contract);
}
assert.doesNotMatch(
  requireKemerbetIdentityKey,
  /stat --format='%U:%G:%a'/,
  'identity-key service ownership must not depend on a host account name for UID 10001',
);

const hardenKemerbetPlayerIds = /harden_kemerbet_player_ids_file\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(
  hardenKemerbetPlayerIds,
  'the original one-use Player-ID file must be frozen before the one-shot container is created',
);
for (const contract of [
  /KEMERBET_RECHECK_PLAYER_IDS_DEV_INO/,
  /KEMERBET_RECHECK_PLAYER_IDS_DIGEST/,
  /exec \{digest_fd\}<<<"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"/,
  /"\$digest_fd" <<'PY'/,
  /import hashlib/,
  /os\.read\(descriptor, 66\)/,
  /os\.close\(descriptor\)/,
  /read_private_digest\(sys\.argv\[3\]\)/,
  /exec \{digest_fd\}<&-/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /os\.O_RDWR \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /\(opened\.st_dev, opened\.st_ino\) != identity/,
  /hashlib\.sha256\(content\)\.hexdigest\(\) != expected_digest/,
  /os\.fchown\(descriptor, 0, 0\)/,
  /os\.fchmod\(descriptor, 0o444\)/,
  /os\.fsync\(descriptor\)/,
  /os\.fsync\(directory_descriptor\)/,
  /hashlib\.sha256\([\s\S]*?os\.pread\(descriptor,[\s\S]*?\)\.hexdigest\(\) != expected_digest/u,
]) {
  assert.match(hardenKemerbetPlayerIds, contract);
}
assert.doesNotMatch(
  hardenKemerbetPlayerIds,
  /^\s*"\$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" <<'PY'/mu,
  'Player-ID hardening must transport the private cohort digest outside argv',
);

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
  /metadata="\$\(stat --format='%u:%g:%a' "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"\)"/,
  /if \[\[ "\$metadata" == '10001:10001:400' \]\]/,
  /digest_before/,
  /chmod 0444 "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /chown root:root "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/,
  /== "\$digest_before"/,
]) {
  assert.match(hardenKemerbetIdentityKey, contract);
}
assert.doesNotMatch(
  hardenKemerbetIdentityKey,
  /metadata="\$\(stat --format='%U:%G:%a' "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"\)"/,
  'identity-key hardening must compare numeric service ownership before converting it to root ownership',
);

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
  /if \[\[ ! "\$command" =~ \^\(recheck-kemerbet-readiness\|expiry-stop\|stop\|stop-bot\|stop-kemerbet-session-provision\|stop-public-edge\)\$ &&[\s\S]*?KEMERBET_RECHECK_PROMOTION_ROOT[\s\S]*?KEMERBET_RECOVERY_LATCH_NAME[\s\S]*?KEMERBET_RECOVERY_LATCH_INSTALLING_NAME[\s\S]*?die 'an interrupted KemerBet readiness recovery blocks state-expanding staging mutations'/u,
  'a durable journal, receipt latch, or promotion fallback must block state expansion while retaining fail-safe stop commands',
);
const recoverBeforeTeardown = /recover_kemerbet_recheck_before_teardown\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
const incompleteRecoveryStart = helper.indexOf('recover_incomplete_kemerbet_recheck_promotion() {');
const incompleteRecoveryEnd = helper.indexOf(
  '\n}\n\nrecover_kemerbet_recheck_before_teardown() {',
  incompleteRecoveryStart,
);
assert.ok(incompleteRecoveryStart >= 0 && incompleteRecoveryEnd > incompleteRecoveryStart);
const incompleteRecovery = helper.slice(incompleteRecoveryStart, incompleteRecoveryEnd + 2);
assertInOrder(
  incompleteRecovery,
  [
    "die 'an interrupted KemerBet promotion root is unsafe'",
    'require_owner_kemerbet_receipt_service_access',
    'actual_entries=',
  ],
  'interrupted recovery must reject a stopped Owner before its first journal, candidate, stage, or receipt normalization',
);
for (const firstMutation of [
  'rm -f -- "$entry"',
  'remove_owned_kemerbet_recheck_promotion_root',
  'remove_owned_kemerbet_recheck_receipt_root',
  'owner_kemerbet_cohort_marker',
]) {
  assert.ok(
    incompleteRecovery.indexOf('require_owner_kemerbet_receipt_service_access') <
      incompleteRecovery.indexOf(firstMutation),
    `live Owner access must precede interrupted-recovery mutation: ${firstMutation}`,
  );
}
for (const contract of [
  /KEMERBET_RECHECK_RECOVERY_OUTCOME=''/,
  /KEMERBET_RECHECK_RECOVERY_OUTCOME='prejournal_no_mutation'/,
  /KEMERBET_RECHECK_RECOVERY_OUTCOME='retryable'/,
  /KEMERBET_RECHECK_RECOVERY_OUTCOME='committed'/,
  /\^\\\.pending-v1\\\.\[A-Za-z0-9\]\+\$/,
]) {
  assert.match(incompleteRecovery, contract);
}
assert.ok(
  (incompleteRecovery.match(/KEMERBET_RECHECK_RECOVERY_OUTCOME='prejournal_no_mutation'/g) ?? [])
    .length >= 2,
  'both empty-root and sole-journal-temporary prefixes must select the exact no-mutation outcome',
);
assert.ok(
  recoverBeforeTeardown,
  'every stop family must share one exact recovery-before-teardown boundary',
);
for (const contract of [
  /KEMERBET_RECHECK_PROMOTION_ROOT/,
  /recover_incomplete_kemerbet_recheck_promotion_guarded/,
  /! -e "\$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /durably_retain_kemerbet_recovery_latch_residue/,
  /publish_kemerbet_recovery_fallback/,
  /durably_retain_kemerbet_recovery_fallback_residue/,
  /teardown was not attempted/,
  /KEMERBET_TEARDOWN_RECOVERY_FAILED='true'/,
  /full emergency teardown will continue/,
]) {
  assert.match(recoverBeforeTeardown, contract);
}
assertInOrder(
  recoverBeforeTeardown,
  [
    'set +e',
    '( set -e; recover_incomplete_kemerbet_recheck_promotion_guarded )',
    'recovery_status=$?',
    'set -e',
    'if [[ "$recovery_status" -eq 0',
    'inspect_kemerbet_recovery_latch',
    'durably_retain_kemerbet_recovery_latch_residue',
    'inspect_kemerbet_recovery_fallback',
    'publish_kemerbet_recovery_fallback',
    'durably_retain_kemerbet_recovery_fallback_residue',
    "KEMERBET_TEARDOWN_RECOVERY_FAILED='true'",
  ],
  'catchable recovery must run as a standalone errexit-enabled subshell so an unguarded failure cannot be mistaken for success',
);
assert.doesNotMatch(
  recoverBeforeTeardown,
  /if\s+\(\s*recover_incomplete_kemerbet_recheck_promotion_guarded/u,
  'placing the recovery function in an if-condition would suppress errexit inside its body',
);
if (process.platform === 'linux') {
  const absentReceiptRootRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      [
        'set -eu',
        inspectRecoveryLatch,
        inspectRecoveryFallback,
        guardedIncompleteRecovery,
        recoverBeforeTeardown,
        String.raw`
KEMERBET_RECOVERY_LATCH_NAME='kemerbet-readiness-recovery-in-progress-or-failed-v1'
KEMERBET_RECOVERY_LATCH_INSTALLING_NAME='.kemerbet-readiness-recovery-in-progress-or-failed-v1.installing'
KEMERBET_RECOVERY_FALLBACK_NAME='recovery-in-progress-or-failed-v1'
KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME='.recovery-in-progress-or-failed-v1.installing'
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
sentinel="$scratch/unexpected-mutation"

unexpected_call() {
  : >"$sentinel"
  return 97
}
die() { unexpected_call; }
require_owner_kemerbet_receipt_service_access() { unexpected_call; }
publish_kemerbet_recovery_latch() { unexpected_call; }
require_owned_kemerbet_recovery_latch() { unexpected_call; }
recover_incomplete_kemerbet_recheck_promotion() { unexpected_call; }
require_retired_kemerbet_recovery_boundary() { unexpected_call; }
retire_owned_kemerbet_recovery_latch() { unexpected_call; }
durably_retain_kemerbet_recovery_latch_residue() { unexpected_call; }
publish_kemerbet_recovery_fallback() { unexpected_call; }
durably_retain_kemerbet_recovery_fallback_residue() { unexpected_call; }

run_clean_absence_case() {
  KEMERBET_OWNER_RECEIPT_PARENT="$1"
  KEMERBET_OWNER_RECEIPT_ROOT="$2"
  KEMERBET_RECHECK_PROMOTION_ROOT="$3"
  test ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && test ! -L "$KEMERBET_OWNER_RECEIPT_ROOT"
  test ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && test ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT"
  set +e
  inspect_kemerbet_recovery_latch
  inspect_status=$?
  set -e
  test "$inspect_status" -eq 1
  recover_incomplete_kemerbet_recheck_promotion_guarded
  recover_kemerbet_recheck_before_teardown
  test "$KEMERBET_TEARDOWN_RECOVERY_FAILED" = 'false'
  test "$KEMERBET_EMERGENCY_TEARDOWN_FAILED" = 'false'
  test ! -e "$sentinel"
  test ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && test ! -L "$KEMERBET_OWNER_RECEIPT_ROOT"
  test ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && test ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT"
}

nonce="fetanagent-absent-receipt-regression-$$"
missing_parent="/var/lib/$nonce-parent"
missing_root="$missing_parent/receipts"
missing_promotion="/var/lib/$nonce-promotion"
test ! -e "$missing_parent" && test ! -L "$missing_parent"
run_clean_absence_case "$missing_parent" "$missing_root" "$missing_promotion"
test ! -e "$missing_parent" && test ! -L "$missing_parent"

safe_parent='/var/lib'
safe_missing_root="/var/lib/$nonce-receipts"
run_clean_absence_case "$safe_parent" "$safe_missing_root" "$missing_promotion"

dangling_parent="$scratch/dangling-parent"
ln -s -- "$scratch/absent-target" "$dangling_parent"
KEMERBET_OWNER_RECEIPT_PARENT="$dangling_parent"
KEMERBET_OWNER_RECEIPT_ROOT="$dangling_parent/receipts"
set +e
inspect_kemerbet_recovery_latch
dangling_status=$?
set -e
test "$dangling_status" -eq 2
test ! -e "$sentinel"
`,
      ].join('\n'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    absentReceiptRootRegression.status,
    0,
    `an absent pre-install receipt namespace must be a no-latch, no-mutation cleanup boundary:\n${absentReceiptRootRegression.stdout}\n${absentReceiptRootRegression.stderr}`,
  );

  const secondRetirementRecheckRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -eu
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
latch="$root/recovery-latch"
resolver_seen="$root/resolver-seen"
unlink_log="$root/unlink-log"
printf 'durable recovery latch\n' >"$latch"
chmod 0400 "$latch"
before="$(sha256sum -- "$latch")"
resolve_control_volume_model() {
  if test -e "$resolver_seen"; then return 1; fi
  : >"$resolver_seen"
  printf '%s\n' "$root/control-volume"
}
require_completed_marker_model() {
  local control_mountpoint
  control_mountpoint="$(resolve_control_volume_model)" || return 1
  test -n "$control_mountpoint"
}
require_retired_boundary_model() {
  require_completed_marker_model || return 1
}
retire_latch_model() {
  require_retired_boundary_model || return 1
  printf 'unlink-ran\n' >"$unlink_log"
  rm -f -- "$latch"
}
# The raw recovery's first independent retired-boundary validation succeeds.
require_retired_boundary_model
# The real caller uses an OR-list around retire_owned, which suppresses errexit in a function body.
# Explicit return propagation must nevertheless stop before unlink when the nested resolver fails
# during the second retirement recheck.
retire_status=0
retire_latch_model || retire_status=$?
test "$retire_status" -ne 0
test -f "$latch"
test ! -e "$unlink_log"
after="$(sha256sum -- "$latch")"
test "$before" = "$after"
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    secondRetirementRecheckRegression.status,
    0,
    `a nested control-volume resolver failure during the second retirement recheck must propagate through an OR-list caller before unlink and leave the durable latch unchanged: ${secondRetirementRecheckRegression.stderr}`,
  );

  const profileDigestFailureRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -eu
root="$(mktemp -d)"
trap 'rm -rf -- "$root"' EXIT
hash_log="$root/hash-ran"
require_holders_model() {
  test "$1" = pass
}
final_stat_model() {
  local value="$1" status="$2"
  test "$status" = pass || return 1
  printf '%s' "$value"
}
profile_digest_model() {
  local policy="$1" holder_status="$2" root_status="$3" profile_status="$4"
  local digest mountpoint_stat profile_stat
  case "$policy" in
    allow-exact-stale-singletons) require_holders_model "$holder_status" || return 1 ;;
    require-absent-singletons) ;;
    *) return 1 ;;
  esac
  mountpoint_stat="$(final_stat_model '1:2:10001:10001:700' "$root_status")" || return 1
  profile_stat="$(final_stat_model '1:3:10001:10001:700' "$profile_status")" || return 1
  : >"$hash_log"
  digest="$(printf 'volume=%s\nroot=%s\nprofile=%s\naccount=%s\n' \
    volume "$mountpoint_stat" "$profile_stat" account | sha256sum | awk '{print $1}')" || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$digest"
}
for scenario in holder root-stat profile-stat; do
  rm -f -- "$hash_log"
  holder_status=pass
  root_status=pass
  profile_status=pass
  case "$scenario" in
    holder) holder_status=fail ;;
    root-stat) root_status=fail ;;
    profile-stat) profile_status=fail ;;
  esac
  set +e
  result="$(profile_digest_model allow-exact-stale-singletons \
    "$holder_status" "$root_status" "$profile_status")"
  digest_status=$?
  set -e
  test "$digest_status" -ne 0
  test -z "$result"
  test ! -e "$hash_log"
done
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    profileDigestFailureRegression.status,
    0,
    `profile-holder or final-stat failure must propagate through command substitution before any syntactically valid profile digest is emitted: ${profileDigestFailureRegression.stderr}`,
  );

  const perContainerBindInventoryRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -eu
container_a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
container_b='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
inspect_one_model() {
  case "$1" in
    "$container_a") printf '%s|/var/lib/fetanagent/kemerbet-owner-receipts|/run/receipts|false\n' "$1" ;;
    "$container_b") printf '\n' ;;
    *) return 1 ;;
  esac
}
all_bind_contracts=''
for bind_container in "$container_a" "$container_b"; do
  container_bind_contracts="$(inspect_one_model "$bind_container")"
  if test -n "$container_bind_contracts"; then
    if test -n "$all_bind_contracts"; then all_bind_contracts+=$'\n'; fi
    all_bind_contracts+="$container_bind_contracts"
  fi
done
seen=0
while IFS='|' read -r bind_container bind_source bind_destination bind_rw; do
  test -n "$bind_container"
  test -n "$bind_source"
  test -n "$bind_destination"
  test "$bind_rw" = false
  seen=$((seen + 1))
done <<<"$all_bind_contracts"
test "$seen" -eq 1
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    perContainerBindInventoryRegression.status,
    0,
    `per-container Docker mount inspection must not turn a second container with no binds into an empty classifier record: ${perContainerBindInventoryRegression.stderr}`,
  );

  const latchServicePreflightRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -eu
receipt_root="$(mktemp -d)"
trap 'rm -rf -- "$receipt_root"' EXIT
printf 'unchanged aggregate receipt sentinel\n' >"$receipt_root/existing-receipt"
chmod 0440 "$receipt_root/existing-receipt"
snapshot_receipts() {
  (
    stat --format='%u:%g:%a:%h:%s' "$receipt_root"
    find -P "$receipt_root" -mindepth 1 -maxdepth 1 -printf '%f|%u|%g|%m|%n|%s\n' | LC_ALL=C sort
    sha256sum -- "$receipt_root/existing-receipt"
  )
}
require_live_readonly_owner_model() {
  case "$1" in
    stopped-owner|foreign-rw-ancestor-bind|foreign-rw-descendant-bind) return 1 ;;
    exact-live-readonly-owner) return 0 ;;
    *) return 2 ;;
  esac
}
publish_latch_model() {
  printf 'installing\n' >"$receipt_root/.latch.installing"
  mv -- "$receipt_root/.latch.installing" "$receipt_root/latch"
}
guarded_recovery_model() {
  require_live_readonly_owner_model "$1"
  publish_latch_model
}
for rejected_topology in stopped-owner foreign-rw-ancestor-bind foreign-rw-descendant-bind; do
  before="$(snapshot_receipts)"
  set +e
  ( set -e; guarded_recovery_model "$rejected_topology" )
  rejected_status=$?
  set -e
  test "$rejected_status" -ne 0
  after="$(snapshot_receipts)"
  test "$before" = "$after"
  test ! -e "$receipt_root/.latch.installing"
  test ! -e "$receipt_root/latch"
done
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    latchServicePreflightRegression.status,
    0,
    `stopped Owner and foreign writable bind topologies must fail before creating either latch pathname and leave the receipt namespace byte-for-byte unchanged: ${latchServicePreflightRegression.stderr}`,
  );

  const errexitRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -u
journal_sentinel="$(mktemp)"
receipt_sentinel="$(mktemp)"
owner_sentinel="$(mktemp)"
bot_sentinel="$(mktemp)"
session_sentinel="$(mktemp)"
gateway_sentinel="$(mktemp)"
network_sentinel="$(mktemp)"
secret_sentinel="$(mktemp)"
trap 'rm -f -- "$journal_sentinel" "$receipt_sentinel" "$owner_sentinel" "$bot_sentinel" "$session_sentinel" "$gateway_sentinel" "$network_sentinel" "$secret_sentinel"' EXIT
recovery_with_unguarded_failure() {
  test -f "$owner_sentinel"
  false
  rm -f -- "$journal_sentinel" "$receipt_sentinel"
}
emergency_stop_model() {
  local recovery_status=0
  set +e
  ( set -e; recovery_with_unguarded_failure )
  recovery_status=$?
  set -e
  if test "$recovery_status" -ne 0; then
    rm -f -- "$owner_sentinel" "$bot_sentinel" "$session_sentinel" "$gateway_sentinel" "$network_sentinel" "$secret_sentinel"
    return 1
  fi
}
set +e
( emergency_stop_model )
first_status=$?
( emergency_stop_model )
second_status=$?
set -e
test "$first_status" -ne 0
test "$second_status" -ne 0
test -f "$journal_sentinel"
test -f "$receipt_sentinel"
test ! -e "$owner_sentinel"
test ! -e "$bot_sentinel"
test ! -e "$session_sentinel"
test ! -e "$gateway_sentinel"
test ! -e "$network_sentinel"
test ! -e "$secret_sentinel"
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    errexitRegression.status,
    0,
    `the standalone recovery subshell must preserve evidence, remove the full project, complete idempotent emergency cleanup, and return nonzero after an unguarded failure: ${errexitRegression.stderr}`,
  );

  const durableBlockRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -euo pipefail
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
receipt_root="$test_root/receipt"
promotion_root="$test_root/promotion"
mkdir -m 0755 -- "$receipt_root"
mkdir -m 0700 -- "$promotion_root"
printf 'version=1\nstate=prepared\n' >"$promotion_root/pending-v1"
chmod 0600 "$promotion_root/pending-v1"
printf evidence >"$test_root/evidence"
printf owner >"$test_root/owner"
recovery_count="$test_root/recovery-count"
: >"$recovery_count"
primary_durable_marker="$test_root/primary-durable"
fallback_durable_marker="$test_root/fallback-durable"
publish_primary_with_directory_fsync_failure() {
  printf block >"$receipt_root/.latch.installing"
  mv -- "$receipt_root/.latch.installing" "$receipt_root/latch"
  return 1
}
durabilize_primary() {
  test -f "$receipt_root/latch"
  test "\${unsafe_primary_root:-false}" = false
  test "\${primary_fsync_ok:-false}" = true
}
publish_fallback() {
  test -f "$promotion_root/pending-v1"
  printf block >"$promotion_root/.fallback.installing"
  mv -- "$promotion_root/.fallback.installing" "$promotion_root/fallback"
  sync -f "$promotion_root/fallback"
  sync -f "$promotion_root"
}
durabilize_fallback() {
  test -f "$promotion_root/pending-v1"
  test -f "$promotion_root/fallback"
  sync -f "$promotion_root/fallback"
  sync -f "$promotion_root"
}
guarded_recovery() {
  if test -e "$receipt_root/latch" || test -e "$promotion_root/fallback"; then
    return 1
  fi
  printf x >>"$recovery_count"
  publish_primary_with_directory_fsync_failure
}
stop_model() {
  local recovery_status=0
  set +e
  ( set -e; guarded_recovery )
  recovery_status=$?
  set -e
  if test "$recovery_status" -eq 0; then
    return 0
  fi
  if durabilize_primary; then
    : >"$primary_durable_marker"
  elif test -e "$promotion_root/fallback" && durabilize_fallback; then
    : >"$fallback_durable_marker"
  elif publish_fallback && durabilize_fallback; then
    : >"$fallback_durable_marker"
  else
    return 2
  fi
  rm -f -- "$test_root/owner" || true
  return 1
}
unsafe_primary_root=true
primary_fsync_ok=false
set +e
( stop_model )
first_status=$?
( stop_model )
second_status=$?
set -e
test "$first_status" -eq 1
test "$second_status" -eq 1
test ! -e "$primary_durable_marker"
test -f "$fallback_durable_marker"
test "$(wc -c <"$recovery_count")" -eq 1
test -f "$promotion_root/fallback"
test -f "$promotion_root/pending-v1"
test -f "$test_root/evidence"
test ! -e "$test_root/owner"

rm -f -- "$receipt_root/latch" "$promotion_root/fallback" \
  "$primary_durable_marker" "$fallback_durable_marker"
printf owner >"$test_root/owner"
publish_fallback() { return 1; }
set +e
( stop_model )
no_block_status=$?
set -e
test "$no_block_status" -eq 2
test ! -e "$primary_durable_marker"
test ! -e "$fallback_durable_marker"
test -f "$test_root/owner"
test -f "$test_root/evidence"
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    durableBlockRegression.status,
    0,
    `a failed primary directory fsync or unsafe primary root must use a durably re-proved fallback, repeats must skip recovery, and dual publication failure must forbid teardown: ${durableBlockRegression.stderr}`,
  );

  const prejournalOutcomeRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -euo pipefail
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
for prefix in empty temporary; do
  promotion="$test_root/$prefix"
  mkdir -m 0700 -- "$promotion"
  if test "$prefix" = temporary; then
    printf partial >"$promotion/.pending-v1.ABC123"
    chmod 0600 "$promotion/.pending-v1.ABC123"
  fi
  source="$test_root/$prefix-source"
  stage="$test_root/$prefix-stage"
  printf source >"$source"
  printf stage >"$stage"
  entries="$(find "$promotion" -mindepth 1 -maxdepth 1 -printf '%f\n')"
  if test -z "$entries" || [[ "$entries" =~ ^\.pending-v1\.[A-Za-z0-9]+$ ]]; then
    rm -f -- "$promotion"/.pending-v1.*
    rmdir -- "$promotion"
    outcome=prejournal_no_mutation
  else
    exit 1
  fi
  test "$outcome" = prejournal_no_mutation
  test -f "$source"
  test -f "$stage"
  test ! -e "$promotion"
done
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    prejournalOutcomeRegression.status,
    0,
    `empty and sole-temporary pre-journal crash prefixes must retire only as exact no-mutation outcomes: ${prejournalOutcomeRegression.stderr}`,
  );
}
assert.doesNotMatch(
  recoverBeforeTeardown,
  /stop_project|container (?:rm|stop)|network rm|rm -f.*SECRET_ROOT|clear_bot_startup_receipt/,
  'recovery-before-teardown may attest and retire the journal but must not itself hide a teardown',
);
assert.doesNotMatch(
  helper,
  /allow-zero-owner-journal-recovery|stop_project_preserving_kemerbet_recovery/,
  'the helper must not retain a zero-Owner receipt authority or preserve expired credentials for later recovery',
);
assert.equal(
  (helper.match(/\brecover_incomplete_kemerbet_recheck_promotion\b/g) ?? []).length,
  2,
  'raw interruption recovery must be defined once and invoked only by its write-ahead guarded wrapper',
);
assert.equal(
  (helper.match(/\brecover_incomplete_kemerbet_recheck_promotion_guarded\b/g) ?? []).length,
  3,
  'guarded interruption recovery must be defined once and invoked only by explicit recheck or the shared pre-teardown hook',
);
const teardownRecoveryStatus =
  /require_kemerbet_teardown_recovery_success\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(teardownRecoveryStatus);
for (const contract of [
  /KEMERBET_TEARDOWN_RECOVERY_FAILED/,
  /KEMERBET_EMERGENCY_TEARDOWN_FAILED/,
  /emergency teardown is incomplete/,
  /full staging runtime was stopped/,
  /requires root remediation/,
]) {
  assert.match(teardownRecoveryStatus, contract);
}
assert.doesNotMatch(
  teardownRecoveryStatus,
  /owner_kemerbet_cohort_marker|remove_owned_kemerbet_recheck_promotion_root/,
);
assert.equal(
  (helper.match(/\brequire_kemerbet_teardown_recovery_success\b/g) ?? []).length,
  9,
  'only the five stop-family handlers may report recovery status: one check for full stops and emergency-plus-normal checks for scoped stops',
);
const emergencyProjectStop =
  /emergency_stop_project_after_kemerbet_recovery_failure\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
const emergencyExpiryDisarm =
  /emergency_disarm_expiry_stop_after_kemerbet_recovery_failure\(\) \{[\s\S]*?\n\}/u.exec(
    helper,
  )?.[0];
assert.ok(emergencyProjectStop && emergencyExpiryDisarm);
for (const contract of [
  /remove_project_runtime_best_effort \|\| cleanup_status=1/,
  /remove_staging_runtime_secrets_best_effort \|\| cleanup_status=1/,
  /return "\$cleanup_status"/,
]) {
  assert.match(emergencyProjectStop, contract);
}
for (const contract of [
  /command -v systemctl/,
  /systemctl disable --now "\$EXPIRY_STOP_TIMER"[^\n]*\|\| cleanup_status=1/,
  /rm -f -- "\$EXPIRY_STOP_TIMER_PATH" "\$EXPIRY_STOP_SERVICE_PATH" \|\| cleanup_status=1/,
  /systemctl daemon-reload \|\| cleanup_status=1/,
  /"\$timer_load_state" == 'not-found'/,
  /return "\$cleanup_status"/,
]) {
  assert.match(emergencyExpiryDisarm, contract);
}
assert.doesNotMatch(
  helper,
  /emergency_(?:remove_project_service|disable_bot)_after_kemerbet_recovery_failure/,
  'recovery failure must not retain a live Owner through a scoped emergency helper',
);
assert.doesNotMatch(
  emergencyProjectStop,
  /owner_kemerbet_cohort_marker|KEMERBET_OWNER_(?:IMPORTED|COMPLETED|FAILED)|remove_owned_kemerbet_recheck_promotion_root/,
  'emergency teardown must retain the journal and every aggregate receipt for manual root remediation',
);
assert.doesNotMatch(
  emergencyExpiryDisarm,
  /owner_kemerbet_cohort_marker|KEMERBET_OWNER_(?:IMPORTED|COMPLETED|FAILED)|remove_owned_kemerbet_recheck_promotion_root/,
  'emergency expiry cleanup must retain the journal and every aggregate receipt for manual root remediation',
);
assert.equal(
  (helper.match(/\bemergency_stop_project_after_kemerbet_recovery_failure\b/g) ?? []).length,
  6,
  'the one full-project emergency helper must be defined once and used by all five stop-family commands',
);
assert.equal(
  (helper.match(/\bemergency_disarm_expiry_stop_after_kemerbet_recovery_failure\b/g) ?? []).length,
  6,
  'the one best-effort expiry disarm helper must be defined once and used by all five stop-family commands',
);

const recordRecheckPromotionJournal =
  /record_kemerbet_recheck_promotion_journal\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  recordRecheckPromotionJournal,
  'the helper must create a durable import-prepared journal before any stage mutation',
);
for (const contract of [
  /install -d -o root -g root -m 0700 "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /sync -f "\$\(dirname -- "\$KEMERBET_RECHECK_PROMOTION_ROOT"\)"/,
  /'state=import_prepared'/,
  /"release=\$commit_sha"/,
  /"source_dev_ino=\$source_dev_ino"/,
  /"binding_sha256=\$binding_digest"/,
  /"identity_hmac_key_sha256=\$identity_key_digest"/,
  /"selector_sha256=\$selector_digest"/,
  /"image_id=\$image_id"/,
  /"profile_volume=\$KEMERBET_PROFILE_VOLUME"/,
  /"session_container=\$session_container"/,
  /"owner_stage_player_ids_dev_ino=\$owner_player_ids_dev_ino"/,
  /"owner_stage_claim_dev_ino=\$owner_claim_dev_ino"/,
  /"claim_id=\$claim_id"/,
  /"player_ids_sha256=\$player_ids_digest"/,
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
  /Player ID|player_id(?!s_(?:dev_ino|sha256|digest))|agent_id=|account_id=|password|token|raw_|sealed_commit|sealed_release|seal_run|prior_seal/iu,
  'the durable promotion journal must contain only redacted exact identities',
);

const advanceRecheckImportJournal =
  /advance_kemerbet_recheck_import_journal_to_prepared\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  advanceRecheckImportJournal,
  'the helper must durably bind the promoted one-use target before publishing imported',
);
for (const contract of [
  /require_kemerbet_recheck_import_prepared_promotion_journal/,
  /'state=prepared'/,
  /"player_ids_dev_ino=\$player_ids_dev_ino"/,
  /"owner_stage_player_ids_dev_ino=\$owner_player_ids_dev_ino"/,
  /"owner_stage_claim_dev_ino=\$owner_claim_dev_ino"/,
  /"claim_id=\$claim_id"/,
  /"player_ids_sha256=\$player_ids_digest"/,
  /sync -f "\$temporary"/,
  /mv -f -- "\$temporary" "\$KEMERBET_RECHECK_PROMOTION_JOURNAL"/,
  /sync -f "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
]) {
  assert.match(advanceRecheckImportJournal, contract);
}

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
  /"owner_stage_player_ids_dev_ino=\$owner_player_ids_dev_ino"/,
  /"owner_stage_claim_dev_ino=\$owner_claim_dev_ino"/,
  /"claim_id=\$claim_id"/,
  /"player_ids_sha256=\$player_ids_digest"/,
  /sync -f "\$temporary"/,
  /mv -f -- "\$temporary" "\$KEMERBET_RECHECK_PROMOTION_JOURNAL"/,
  /sync -f "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /root:root:600:1/,
]) {
  assert.match(advanceRecheckPromotionJournal, contract);
}
assert.doesNotMatch(
  advanceRecheckPromotionJournal,
  /Player ID|player_id(?!s_(?:dev_ino|sha256|digest))|agent_id=|account_id=|password|token|raw_|sealed_commit|sealed_release|seal_run|prior_seal/iu,
  'the candidate-bound journal must not add raw identity or historical seal provenance',
);

for (const [name, state, minimumLines] of [
  ['require_kemerbet_recheck_import_prepared_promotion_journal', 'import_prepared', '14'],
  ['require_kemerbet_recheck_prepared_promotion_journal', 'prepared', '15'],
  ['require_kemerbet_recheck_promotion_journal', 'candidate_bound', '17'],
]) {
  const journalVerifier = new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`, 'u').exec(helper)?.[0];
  assert.ok(journalVerifier, `${state} journal verifier must exist`);
  assert.match(journalVerifier, /player_ids_digest/);
  assert.match(journalVerifier, /"player_ids_sha256=\$player_ids_digest"/);
  assert.match(journalVerifier, /actual_digest/);
  assert.match(journalVerifier, /expected_digest/);
  assert.match(journalVerifier, /"\$actual_digest" == "\$expected_digest"/);
  assert.match(
    helper,
    new RegExp(`"\\$\\{#journal_lines\\[@\\]\\}" -eq ${minimumLines}`),
    `${state} recovery schema must preserve its exact digest-bound line count`,
  );
}

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
  'the helper must recover every durable import, prepared, candidate, and committed crash prefix',
);
for (const contract of [
  /state=import_prepared/,
  /state=prepared/,
  /state=candidate_bound/,
  /session_container=\(none\|\[0-9a-f\]/,
  /player_ids_dev_ino=/,
  /player_ids_sha256=/,
  /owner_stage_player_ids_dev_ino=/,
  /owner_stage_claim_dev_ino=/,
  /claim_id=/,
  /remove_kemerbet_recheck_container/,
  /remove_kemerbet_recheck_network/,
  /remove_journaled_kemerbet_session_provision/,
  /require_kemerbet_profile_volume_holders ''/,
  /remove_kemerbet_recheck_candidate/,
  /require_retryable_kemerbet_binding_source/,
  /consume_exact_one_use_kemerbet_file/,
  /repair_kemerbet_identity_key_readability/,
  /restore_retryable_owner_staged_kemerbet_cohort/,
  /complete_owner_staged_kemerbet_cohort/,
  /require_current_kemerbet_success_runtime_boundary/,
  /require_committed_kemerbet_cleanup_artifacts/,
  /require_committed_kemerbet_recheck_boundary_shape/,
  /remove_owned_kemerbet_recheck_promotion_root/,
  /rollback_kemerbet_recheck_final_binding/,
  /require_retryable_kemerbet_binding_source/,
  /remove_owned_kemerbet_recheck_promotion_root/,
  /if \[\[ -z "\$receipt_entries" \]\]; then[\s\S]*?receipt_present='partial'/,
]) {
  assert.match(recoverRecheckPromotion, contract);
}
assert.doesNotMatch(
  recoverRecheckPromotion,
  /container start|compose .*\bup\b|GeneralInfoByExternalId|PlayerEPOSDeposit|FINANCIAL_ACTIONS_MODE=live/iu,
  'crash recovery must clean exact state without retrying the browser probe or enabling money authority',
);
const importRecovery = recoverRecheckPromotion.slice(
  recoverRecheckPromotion.indexOf('state=import_prepared'),
  recoverRecheckPromotion.indexOf('state=prepared'),
);
const preparedRecovery = recoverRecheckPromotion.slice(
  recoverRecheckPromotion.indexOf('state=prepared'),
  recoverRecheckPromotion.indexOf('state=candidate_bound'),
);
const candidateRecovery = recoverRecheckPromotion.slice(
  recoverRecheckPromotion.indexOf('state=candidate_bound'),
);
assertInOrder(
  importRecovery,
  [
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
    'remove_journaled_kemerbet_session_provision',
    'owner_kemerbet_cohort_marker remove-failed',
    'promote_owner_staged_kemerbet_player_ids',
    'advance_kemerbet_recheck_import_journal_to_prepared',
    'owner_kemerbet_cohort_marker publish-imported',
    'consume_exact_one_use_kemerbet_file',
    'restore_retryable_owner_staged_kemerbet_cohort',
    'repair_kemerbet_identity_key_readability',
    'remove_owned_kemerbet_recheck_promotion_root',
  ],
  'import-prepared recovery must normalize the fixed import then restore both stages before exposing retryable failure',
);
assertInOrder(
  preparedRecovery,
  [
    'remove_kemerbet_recheck_candidate',
    'consume_exact_one_use_kemerbet_file',
    'restore_retryable_owner_staged_kemerbet_cohort',
    'repair_kemerbet_identity_key_readability',
    'remove_owned_kemerbet_recheck_promotion_root',
  ],
  'prepared recovery must consume only its imported target, restore both stages, publish failure, and retire the journal last',
);
assertInOrder(
  candidateRecovery,
  [
    'require_kemerbet_recheck_receipt',
    'require_kemerbet_recheck_promotion_journal',
    'require_current_kemerbet_success_runtime_boundary',
    'require_committed_kemerbet_cleanup_artifacts',
    'consume_exact_one_use_kemerbet_file',
    'remove_kemerbet_recheck_candidate',
    'consume_exact_kemerbet_binding_source',
    'repair_kemerbet_identity_key_readability',
    'require_committed_kemerbet_recheck_boundary_shape',
    'require_current_kemerbet_success_runtime_boundary',
    'complete_owner_staged_kemerbet_cohort',
    'require_completed_owner_kemerbet_cohort_marker',
    'require_committed_kemerbet_recheck_boundary_shape',
    'require_current_kemerbet_success_runtime_boundary',
    'remove_owned_kemerbet_recheck_promotion_root',
    'rollback_kemerbet_recheck_final_binding',
    'remove_kemerbet_recheck_candidate',
    'require_retryable_kemerbet_binding_source',
    'consume_exact_one_use_kemerbet_file',
    'restore_retryable_owner_staged_kemerbet_cohort',
    'repair_kemerbet_identity_key_readability',
    'remove_owned_kemerbet_recheck_promotion_root',
  ],
  'candidate recovery must complete a durable receipt/binding or otherwise restore both stages before retryable failure',
);
assert.equal(
  (candidateRecovery.match(/require_current_kemerbet_success_runtime_boundary/g) ?? []).length,
  3,
  'committed recovery must re-prove the current release/image/profile/runtime/no-holder/singleton/no-transient boundary before consume, before completed publication, and after publication',
);

const recheckRuntimeContract =
  /require_kemerbet_recheck_container_contract\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  recheckRuntimeContract,
  'The helper must inspect the one-shot container before starting it.',
);
const recheckComposeService =
  /(?:^|\n)  kemerbet-no-transfer-readiness:\r?\n([\s\S]*?)(?=\r?\n  [a-z][a-z0-9-]*:\r?\n)/u.exec(
    compose,
  )?.[1];
assert.ok(recheckComposeService, 'The one-shot Compose service must remain separately bounded.');
const dockerProxyEnvironmentNames = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'FTP_PROXY',
  'ftp_proxy',
  'ALL_PROXY',
  'all_proxy',
];
const recheckComposeEnvironment =
  /^    environment:\r?\n([\s\S]*?)(?=^    [a-z][a-z0-9_]*:)/mu.exec(recheckComposeService)?.[1];
assert.ok(recheckComposeEnvironment, 'The one-shot Compose environment must remain explicit.');
const executorRuntimeBase = dockerfile
  .split('FROM runtime-base AS executor-runtime-base')[1]
  ?.split('FROM executor-runtime-base AS executor')[0];
assert.ok(executorRuntimeBase, 'The executor image must retain a separate runtime base.');
for (const proxyName of dockerProxyEnvironmentNames) {
  assert.equal(
    (recheckComposeEnvironment.match(new RegExp(`^      ${proxyName}: ''$`, 'gmu')) ?? []).length,
    1,
    `Compose must override ${proxyName} with one exact empty value.`,
  );
  assert.equal(
    (
      executorRuntimeBase.match(
        new RegExp(`^\\s+(?:ENV\\s+)?${proxyName}=\\s*(?:\\\\)?$`, 'gmu'),
      ) ?? []
    ).length,
    1,
    `The executor image must contribute one exact empty ${proxyName} baseline.`,
  );
}
const recheckExpectedEnvironment =
  /expected_environment="\$\(\{([\s\S]*?)\}\s*\|\s*LC_ALL=C sort\)"/u.exec(
    recheckRuntimeContract,
  )?.[1];
assert.ok(recheckExpectedEnvironment, 'The runtime must derive one exact expected environment.');
for (const proxyName of dockerProxyEnvironmentNames) {
  assert.doesNotMatch(
    recheckExpectedEnvironment,
    new RegExp(`\\b${proxyName}\\b`, 'u'),
    `The runtime must preserve the image's empty ${proxyName} baseline.`,
  );
}
assert.match(
  recheckRuntimeContract,
  /actual_environment="\$\(docker_local container inspect "\$container_id"\s*\\\s*\n\s*--format '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}'\)"/u,
  'The runtime must capture Docker template output before sorting it.',
);
assert.match(
  recheckRuntimeContract,
  /actual_environment="\$\(LC_ALL=C sort <<<"\$actual_environment"\)"/u,
  'The runtime must sort the captured environment without manufacturing an empty record.',
);
assert.doesNotMatch(
  recheckRuntimeContract,
  /--format '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}' \| LC_ALL=C sort/u,
  'Docker template output must never be piped directly to sort.',
);
const recheckComposeTmpfsOptions = /^    tmpfs:\r?\n      - \/tmp:([^\r\n]+)$/mu.exec(
  recheckComposeService,
)?.[1];
assert.ok(recheckComposeTmpfsOptions, 'The one-shot Compose tmpfs contract must remain exact.');
const recheckHelperTmpfsLiteral =
  /\$'([^']+)' \]\] \|\|\r?\n\s+die 'the KemerBet recheck temporary filesystem contract is not exact'/u.exec(
    recheckRuntimeContract,
  )?.[1];
assert.ok(recheckHelperTmpfsLiteral, 'The runtime tmpfs predicate must remain exact.');
assert.equal(
  recheckComposeTmpfsOptions.split(',').sort().join('\n'),
  recheckHelperTmpfsLiteral.replaceAll('\\n', '\n'),
  'Compose must serialize the same exact tmpfs options that the runtime predicate requires.',
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
  /KEMERBET_RECHECK_DURABLE_SUCCESS" != 'true'/,
  /KEMERBET_RECHECK_COMMITTED" != 'true'/,
  /KEMERBET_RECHECK_RECEIPT_OWNED" == 'true'/,
  /remove_owned_kemerbet_recheck_receipt_root/,
  /rollback_kemerbet_recheck_final_binding/,
  /KEMERBET_RECHECK_CANDIDATE_CREATED" == 'true'/,
  /remove_kemerbet_recheck_candidate/,
  /consume_exact_one_use_kemerbet_file/,
  /repair_kemerbet_identity_key_readability/,
  /restore_retryable_owner_staged_kemerbet_cohort/,
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
  /require_retryable_kemerbet_binding_source[\s\S]*?\|\| cleanup_status=1/,
  /consume_exact_one_use_kemerbet_file[\s\S]*?\|\| cleanup_status=1/,
  /Import may have failed after creating a target but before shell captured its inode/,
  /repair_kemerbet_identity_key_readability \|\| cleanup_status=1/,
  /restore_retryable_owner_staged_kemerbet_cohort \|\| cleanup_status=1/,
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
    'require_retryable_kemerbet_binding_source',
    'consume_exact_one_use_kemerbet_file',
    'repair_kemerbet_identity_key_readability',
    '"$cleanup_status" -eq 0',
    'restore_retryable_owner_staged_kemerbet_cohort',
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
assert.match(
  recheckIdentityKeyRepair,
  /metadata="\$\(stat --format='%u:%g:%a' "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"\)"/,
);
assert.match(recheckIdentityKeyRepair, /0:0:444\) return 0 ;;/);
assert.match(recheckIdentityKeyRepair, /10001:10001:400\|10001:10001:444\|0:0:400\) ;;/);
assert.match(recheckIdentityKeyRepair, /chmod 0444 "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/);
assert.match(recheckIdentityKeyRepair, /chown root:root "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"/);
assert.match(recheckIdentityKeyRepair, /root:root:444/);
assert.doesNotMatch(
  recheckIdentityKeyRepair,
  /metadata="\$\(stat --format='%U:%G:%a' "\$KEMERBET_AGENT_IDENTITY_HMAC_KEY"\)"/,
  'identity-key recovery must compare numeric service ownership before repairing root readability',
);

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
  /kemerbet_profile_identity_digest/,
  /"\$account_id" "\$profile_mountpoint" require-absent-singletons/,
  /profile_mountpoint="\$\(resolve_kemerbet_profile_volume_mountpoint\)" \|\| return 1/,
  /observed_profile_identity_digest="\$\(kemerbet_profile_identity_digest/,
  /require-absent-singletons\)" \|\| return 1/,
  /image inspect "fetanagent-deposit-executor:\$image_tag"/,
  /org\.opencontainers\.image\.revision/,
  /\$commit_sha\|fetanagent-deposit-executor\|10001:10001/,
  /require_exact_fresh_bot_runtime "\$commit_sha" published-steady-state/,
  /require_owner_kemerbet_receipt_service_access/,
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
assertInOrder(
  stopKemerbetSession,
  [
    '[[ $# -eq 2 ]] ||',
    '[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]]',
    'recover_kemerbet_recheck_before_teardown',
    'emergency_stop_project_after_kemerbet_recovery_failure',
    'emergency_disarm_expiry_stop_after_kemerbet_recovery_failure',
    'require_kemerbet_teardown_recovery_success',
    'session_container=',
    'container stop --time 70',
  ],
  'session-provision stop must validate the release and recover the journal before removing runtime',
);
assert.equal(
  (stopKemerbetSession.match(/require_kemerbet_teardown_recovery_success/g) ?? []).length,
  2,
  'session stop must return a visible nonzero recovery result after full-project emergency cleanup and retain a final normal-path check',
);
assert.doesNotMatch(
  stopKemerbetSession,
  /emergency_(?:disable_bot|remove_project_service)_after_kemerbet_recovery_failure/,
  'session-stop recovery failure must never leave Owner or another project service running',
);

const stopPublicEdge = /\n  stop-public-edge\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(stopPublicEdge, 'The helper must define the isolated public-edge stop boundary.');
assertInOrder(
  stopPublicEdge,
  [
    "[[ $# -eq 1 ]] || die 'stop-public-edge accepts no additional arguments'",
    'recover_kemerbet_recheck_before_teardown',
    'emergency_stop_project_after_kemerbet_recovery_failure',
    'emergency_disarm_expiry_stop_after_kemerbet_recovery_failure',
    'require_kemerbet_teardown_recovery_success',
    'gateway_container=',
    'container rm --force',
  ],
  'public-edge stop must validate its invocation and recover the journal before removing runtime',
);
assert.equal(
  (stopPublicEdge.match(/require_kemerbet_teardown_recovery_success/g) ?? []).length,
  2,
  'public-edge stop must signal recovery failure after full-project emergency cleanup and retain a final normal-path check',
);
assert.doesNotMatch(
  stopPublicEdge,
  /emergency_(?:disable_bot|remove_project_service)_after_kemerbet_recovery_failure/,
  'public-edge recovery failure must never leave Owner or another project service running',
);
assert.equal(
  (helper.match(/\brecover_kemerbet_recheck_before_teardown\b/g) ?? []).length,
  6,
  'the shared pre-teardown recovery must be defined once and called by all five stop-family commands',
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
