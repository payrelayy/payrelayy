import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
const v2V3SuccessorMigration = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v2-v3-successor-migration.sh'),
  'utf8',
);
const v3SuccessorHelperRotation = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV2 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v2.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV3 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v3.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV4 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v4.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV5 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v5.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV6 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v6.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV7 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v7.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV8 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v8.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV9 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v9.sh'),
  'utf8',
);
const v3SuccessorHelperRotationV10 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-successor-helper-rotation-v10.sh'),
  'utf8',
);
const v3RuntimeBridgeHelperPromotionV11 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-runtime-bridge-helper-promotion-v11.sh'),
  'utf8',
);
const v3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecovery = readFileSync(
  resolve(
    root,
    'infra/operations/fetanagent-kemerbet-v3-runtime-bridge-helper-promotion-v11-empty-checkpoint-recovery.sh',
  ),
  'utf8',
);
const v3RuntimeBridgeParserScopeRepairV12 = readFileSync(
  resolve(
    root,
    'infra/operations/fetanagent-kemerbet-v3-runtime-bridge-parser-scope-repair-v12.sh',
  ),
  'utf8',
);
const v3RecheckBridgeV13 = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v3-recheck-bridge-v13.sh'),
  'utf8',
);
const legacyBrand = 'pay' + 'replayy';
const legacyAdmin = `${legacyBrand}-admin`;
const legacyHelper = `/usr/local/sbin/${legacyBrand}-staging-deploy-helper`;
const legacyHelperSha = '4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69';
const installedHelperPredecessorSha =
  'ecd47f5d6aff8cd955ed8b68d7313b79fde5547a6827743e1e5f1b0d1fca04be';
const installedHelperBackupName = 'fetanagent-staging-deploy-helper.previous-ecd47f5d';
const installedHelperBackupPath = `/root/fetanagent-helper-rotation/${installedHelperBackupName}`;
const retained022HelperBackupSha =
  '022a9f10335fb570efb7638e2029ce663525ed742296268471b4c3a444ada714';
const retained022HelperBackupName = 'fetanagent-staging-deploy-helper.previous-022a9f10';
const retained022HelperBackupPath = `/root/fetanagent-helper-rotation/${retained022HelperBackupName}`;
const retainedD9cdHelperBackupSha =
  'd9cdcdec53e0a408bc15b205f161fd19e3204ed8e81a32e5921342c2bfa867f7';
const retainedD9cdHelperBackupName = 'fetanagent-staging-deploy-helper.previous-d9cdcdec';
const retainedD9cdHelperBackupPath = `/root/fetanagent-helper-rotation/${retainedD9cdHelperBackupName}`;
const retained526HelperBackupSha =
  '5267906f1b0fe07c8d4a2da05f2e101240a39ee8ab73cf323d4b41d7a30b6795';
const retained526HelperBackupName = 'fetanagent-staging-deploy-helper.previous-5267906f';
const retained526HelperBackupPath = `/root/fetanagent-helper-rotation/${retained526HelperBackupName}`;
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
const historicalReviewedHelperSuccessorSha =
  '43b09de7356bc6237264d8f0b162b237e74c1a59c175a2dccced7ad5b77d6619';
const reviewedV3HelperSuccessorSha =
  'f98047953fb9249d7dbcd13be6cf1a145b53a4952a760b36d5ba8bfab2f36f82';
const reviewedV3HelperRotationV2SuccessorSha =
  '05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe';
const reviewedV3HelperRotationV3SuccessorSha =
  '020b2b2d7eca153dffd72d7811d58c1a93e41edc24d1217cb459f5828e549b7b';
const reviewedV3HelperRotationV4SuccessorSha =
  '8ae567bb50581288600ef8058553fb411d6b04d1177a275b4e59bed936bb1db6';
const reviewedV3HelperRotationV5SuccessorSha =
  '2fe840e137c435becc6179ba85cf00e86c1100b906da880b8f8e191a26cacd20';
const reviewedV3HelperRotationV6SuccessorSha =
  'b3af405d303a123d4219ea8e6981ce447f9651abf83318879ebc3e579e318df1';
const reviewedV3HelperRotationV7SuccessorSha =
  '6be7cbcb5e3715c9d45ecc86005bdcb9b41f6d4cb86fbdffaf47525f416defc8';
const reviewedV3HelperRotationV8SuccessorSha =
  '918fb4a5713a5d1fa5a3b214175e3a91dc6f5d505bd21d8fec85862416ac66cf';
const reviewedV3HelperRotationV9SuccessorSha =
  'd3284d1c268fdba227ff5628f2ac28f9e30375a8a85517e06258a97dfab5e4e1';
const reviewedV3HelperRotationV10SuccessorSha =
  '73eabc728bc25462ab96d17dc8faa5775526571caae9d2ab0265f523b84a387e';
const reviewedV3RuntimeBridgeHelperV11Sha =
  '8696fd6d606b7c3440ab180e9d409bb113da2ba14434752b47fca07e34a09728';
const reviewedV3RuntimeBridgeParserScopeRepairHelperV12Sha =
  '9f9c7f124820c1c8c8aabbe411de5ccc0d914bf7f4696904d6ba557eee62b3da';
const reviewedV3RuntimeBridgeParserScopeRepairV12Sha =
  '171b98279bffec64558b309d9a793fa8306d64615e0f73b95607553640dbbb54';
const reviewedV3RecheckBridgeHelperV13Sha =
  '3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa';
const reviewedV3RecheckBridgeV13Sha =
  '6eb4a913d852975d809cdf20eee340d2a984a38d5009badfe47dda2ccfe662aa';
const reviewedV3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecoverySha =
  'a20f6f5b813a3032477b7e7fcaaf5aac94b8083ac0ddfdaab4b673c56fccc3e7';
const actualReviewedHelperSuccessorSha = createHash('sha256')
  .update(helper.replaceAll('\r\n', '\n'))
  .digest('hex');
const actualReviewedV3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecoverySha = createHash(
  'sha256',
)
  .update(v3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecovery.replaceAll('\r\n', '\n'))
  .digest('hex');
const actualReviewedV3RuntimeBridgeParserScopeRepairV12Sha = createHash('sha256')
  .update(v3RuntimeBridgeParserScopeRepairV12.replaceAll('\r\n', '\n'))
  .digest('hex');
const actualReviewedV3RecheckBridgeV13Sha = createHash('sha256')
  .update(v3RecheckBridgeV13.replaceAll('\r\n', '\n'))
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

function extractShellFunction(source, name, nextName) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf(`\n}\n\n${nextName}() {`, start);
  assert.ok(start >= 0 && end > start, `missing shell function boundary: ${name}`);
  return source.slice(start, end + 2);
}

function extractSingleQuotedPythonHeredoc(shellFunction, name) {
  const extracted = /<<'PY'\r?\n([\s\S]*?)\r?\nPY/u.exec(shellFunction)?.[1];
  assert.ok(extracted, `missing embedded Python boundary: ${name}`);
  return extracted;
}

const v2V3MigrationConfirmation = 'I-UNDERSTAND-THIS-ARCHIVES-V2-AND-INSTALLS-THE-V3-SUCCESSOR';
for (const fixedMigrationContract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly METADATA='http:\/\/169\.254\.169\.254\/metadata\/v1'$/mu,
  /^readonly EXPECTED_DROPLET_ID='593344964'$/mu,
  /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu,
  /^readonly PROJECT_NAME='fetanagent-staging-beta'$/mu,
  /^readonly STAGING_ROOT="\/root\/fetanagent-v3-successor-\$SUCCESSOR_RELEASE"$/mu,
  /^readonly STAGED_HELPER="\$STAGING_ROOT\/fetanagent-staging-deploy-helper\.next"$/mu,
  /\[\[ \$# -eq 6 \]\]/u,
  /^readonly PROVIDED_CONFIRMATION="\$6"$/mu,
  /\[\[ "\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION" \]\] \|\| die 'the exact one-use migration confirmation is required'/u,
  /"\$METADATA\/id"\)" ==\s+"\$EXPECTED_DROPLET_ID"/u,
  /"\$METADATA\/interfaces\/public\/0\/ipv4\/address"\)" == "\$EXPECTED_PUBLIC_IPV4"/u,
]) {
  assert.match(v2V3SuccessorMigration, fixedMigrationContract);
}
assert.equal(
  v2V3SuccessorMigration.split(`readonly CONFIRMATION='${v2V3MigrationConfirmation}'`).length - 1,
  1,
  'the v2-to-v3 migration must expose one exact, immutable one-use confirmation',
);
assert.doesNotMatch(
  v2V3SuccessorMigration,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove|replace)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the successor migration must archive predecessor evidence and must contain no destructive deletion primitive',
);

const successorDurableVolumeContract = extractShellFunction(
  helper,
  'inspect_kemerbet_durable_volume_contract',
  'require_kemerbet_v1_retirement_durable_volumes',
);
for (const composeVolumeContract of [
  /\{\{len \.Labels\}\}/u,
  /com\.docker\.compose\.project/u,
  /com\.docker\.compose\.version/u,
  /com\.docker\.compose\.volume/u,
  /com\.docker\.compose\.config-hash/u,
  /"\$options" == 'null'/u,
  /"\$mountpoint" == "\/var\/lib\/docker\/volumes\/\$volume\/_data"/u,
  /3\)\s+\[\[ -z "\$compose_config_hash" \]\] \|\| return 1/u,
  /"\$name\|\$driver\|\$scope\|\$options\|\$label_count\|\$project\|\$compose_version\|\$volume_label\|\$mountpoint"/u,
  /4\) \[\[ "\$compose_config_hash" =~ \^\[0-9a-f\]\{64\}\$ \]\] \|\| return 1/u,
  /if \[\[ "\$label_count" == '4' \]\]; then\s+printf '%s' "\$volume_contract"/u,
  /\*\) return 1/u,
]) {
  assert.match(successorDurableVolumeContract, composeVolumeContract);
}
assert.equal(
  (successorDurableVolumeContract.match(/com\.docker\.compose\.[a-z-]+/gu) ?? []).length,
  4,
  'the successor durable-volume inspector must bind exactly the four recognized Compose label keys',
);
const successorDurableVolumeAttestor = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_durable_volumes',
  'kemerbet_v1_retirement_recovery_context_digest',
);
assertInOrder(
  successorDurableVolumeAttestor,
  [
    'inspect_kemerbet_durable_volume_contract',
    "volume_label_count=\"$(cut -d '|' -f 5",
    'volume_label_schema="$volume_label_count"',
    '"$volume_label_count" == "$volume_label_schema"',
    'profile_contract="$volume_contract"',
    'control_contract="$volume_contract"',
    '"control_contract=$control_contract"',
    '"profile_contract=$profile_contract"',
    '} | sha256sum',
  ],
  'the successor must bind each exact legacy-or-Compose-5 label contract into the durable-volume digest',
);
for (const exactVolumeResolver of [
  extractShellFunction(
    helper,
    'resolve_kemerbet_session_control_volume_mountpoint',
    'resolve_kemerbet_session_control_volume_offline_mountpoint',
  ),
  extractShellFunction(
    helper,
    'resolve_kemerbet_session_control_volume_offline_mountpoint',
    'require_owner_kemerbet_receipt_ancestors',
  ),
  extractShellFunction(
    helper,
    'resolve_kemerbet_profile_volume_mountpoint',
    'kemerbet_profile_volume_holders_match',
  ),
]) {
  assert.match(exactVolumeResolver, /inspect_kemerbet_durable_volume_contract/u);
}

const compose5MigrationAttestor = extractShellFunction(
  v2V3SuccessorMigration,
  'require_compose5_durable_volume_compatibility',
  'run_predecessor_recovery_ready_compose5_compat',
);
for (const compose5MigrationContract of [
  /volume ls --quiet[\s\S]*?label=com\.docker\.compose\.project=\$PROJECT_NAME/u,
  /"\$project_volumes" == "\$expected_volumes"/u,
  /\{\{len \.Labels\}\}/u,
  /com\.docker\.compose\.config-hash/u,
  /"\$label_count" == '4'/u,
  /"\$compose_config_hash" =~ \^\[0-9a-f\]\{64\}\$/u,
  /container ls --all --quiet[\s\S]*?--filter "volume=\$volume"/u,
  /"\$holders" \]\] \|\| return 1/u,
  /10001:10001:700/u,
  /10001:10001:700:2/u,
  /COMPOSE5_DURABLE_VOLUME_DIGEST="\$\(\{/u,
]) {
  assert.match(compose5MigrationAttestor, compose5MigrationContract);
}
assert.equal(
  (compose5MigrationAttestor.match(/com\.docker\.compose\.[a-z-]+/gu) ?? []).length,
  5,
  'the migration must use only the project filter plus the exact four Compose volume label keys',
);
assert.doesNotMatch(
  compose5MigrationAttestor,
  /\bdocker\s+(?:volume|container|network)\s+(?:create|rm|update)\b|\b(?:mv|rm|install)\b/u,
  'the Compose 5 compatibility attestor must remain read-only',
);

const compose5PredecessorCompatibility = extractShellFunction(
  v2V3SuccessorMigration,
  'run_predecessor_recovery_ready_compose5_compat',
  'require_migration_intent',
);
const compose5NormalizerStart = compose5PredecessorCompatibility.indexOf(
  'compat_activate_normalizer() {',
);
const compose5NormalizerEnd = compose5PredecessorCompatibility.indexOf(
  '\nset -- kemerbet-v1-retirement-recovery-ready "$1"',
  compose5NormalizerStart,
);
assert.ok(
  compose5NormalizerStart >= 0 && compose5NormalizerEnd > compose5NormalizerStart,
  'the predecessor compatibility path must expose one DEBUG/source normalizer',
);
const compose5DebugNormalizer = compose5PredecessorCompatibility.slice(
  compose5NormalizerStart,
  compose5NormalizerEnd,
);
assertInOrder(
  compose5PredecessorCompatibility,
  [
    'require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755',
    'require_compose5_durable_volume_compatibility',
    'compatibility_digest="$COMPOSE5_DURABLE_VOLUME_DIGEST"',
    "env -i PATH=\"$SAFE_PATH\" HOME='/root' SUDO_USER='fetanagent-admin'",
    '"$(sha256sum -- "$0"',
    'trap compat_activate_normalizer DEBUG',
    'source "$0"',
    'require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755',
    'require_compose5_durable_volume_compatibility',
    '"$COMPOSE5_DURABLE_VOLUME_DIGEST" == "$compatibility_digest"',
  ],
  'the compatibility subprocess must source only the exact predecessor and re-attest the unchanged Compose 5 boundary afterward',
);
for (const constrainedCompatibilityContract of [
  /"\$BASH_COMMAND" == "command=\\"\\\$\{1:-\}\\""/u,
  /\[\[ \$# -eq 5 && "\$1" == volume && "\$2" == inspect/u,
  /"\$5" == "\$COMPAT_LEGACY_VOLUME_FORMAT"/u,
  /"\$label_count" == 4/u,
  /"\$compose_config_hash" == "\$expected_config_hash"/u,
  /\|3\|\$project\|\$compose_version\|\$volume_label\|\$mountpoint/u,
  /docker --host "\$LOCAL_DOCKER_SOCKET" "\$@"/u,
  /set -- kemerbet-v1-retirement-recovery-ready "\$1"/u,
  /\[\[ "\$COMPAT_ACTIVATED" == true \]\]/u,
]) {
  assert.match(compose5PredecessorCompatibility, constrainedCompatibilityContract);
}
assert.doesNotMatch(
  compose5PredecessorCompatibility,
  /\b(?:sed|head|tail|eval)\b|\bdocker\s+(?:volume|container|network)\s+(?:create|rm|update)\b/u,
  'the predecessor compatibility path must neither rewrite helper definitions nor mutate Docker state',
);
assert.match(
  helper,
  /kemerbet-v1-retirement-recovery-ready\)\s+\[\[ \$# -eq 2 \]\][\s\S]*?require_kemerbet_v1_retirement_recovery_ready "\$commit_sha"/u,
  'sourcing the exact predecessor with the compatibility command must still execute its complete recovery-ready predicate',
);

const predecessorRecoveryReadyCompatibility = extractShellFunction(
  v2V3SuccessorMigration,
  'require_predecessor_recovery_ready',
  'require_fresh_disabled_predecessor_boundary',
);
assertInOrder(
  predecessorRecoveryReadyCompatibility,
  [
    'run_predecessor_helper',
    'kemerbet-v1-retirement-recovery-ready "$PREDECESSOR_RELEASE"',
    'return 0',
    'run_predecessor_recovery_ready_compose5_compat',
  ],
  'every predecessor recovery proof must first run the unmodified helper and fall back only to the exact Compose 5 adapter',
);

const freshDisabledPredecessorBoundary = extractShellFunction(
  v2V3SuccessorMigration,
  'require_fresh_disabled_predecessor_boundary',
  'require_migration_intent',
);
assertInOrder(
  freshDisabledPredecessorBoundary,
  [
    'docker_local_read_only container ls --all --quiet',
    'label=com.docker.compose.project=$PROJECT_NAME',
    'validate_retirement_and_binding "$RETIREMENT_ROOT" "$SOURCE"',
  ],
  'the disabled-grant boundary must re-attest an exactly stopped predecessor and exact v2 continuity',
);
assert.doesNotMatch(
  freshDisabledPredecessorBoundary,
  /run_predecessor_helper|sudo -n/u,
  'the disabled-grant boundary must not invoke the predecessor helper through its disabled grant',
);

const migrationRetirementContinuity = extractShellFunction(
  v2V3SuccessorMigration,
  'validate_retirement_and_binding',
  'require_v3_binding',
);
for (const legacyProjectionContract of [
  /binding_match = v2_pattern\.fullmatch\(binding_data\)/u,
  /binding_match\.group\(1\)[\s\S]*?hmac-sha256-agent-identity-v1:[\s\S]*?binding_match\.group\(2\)/u,
  /hashlib\.sha256\(legacy_projection\)\.hexdigest\(\) != intent\[6\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(migrationRetirementContinuity, legacyProjectionContract);
}

if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const project = 'fetanagent-staging-beta';
  const profileVolume = `${project}_kemerbet_sessions`;
  const controlVolume = `${project}_kemerbet_session_control`;
  const composeVersion = '5.1.4';
  const lowerHash = 'a'.repeat(64);
  const volumeContract = ({
    volume = profileVolume,
    count,
    logical = 'kemerbet_sessions',
    hash = '',
    projectName = project,
    version = composeVersion,
  }) =>
    `${volume}|local|local|null|${count}|${projectName}|${version}|${logical}|${hash}|/var/lib/docker/volumes/${volume}/_data`;
  const inspectorHarness = [
    'set -euo pipefail',
    `PROJECT_NAME='${project}'`,
    'docker_local() { printf \'%s\' "$MOCK_VOLUME_CONTRACT"; }',
    successorDurableVolumeContract,
    `observed="$(inspect_kemerbet_durable_volume_contract '${profileVolume}' kemerbet_sessions)"`,
    '[[ "$observed" == "$MOCK_EXPECTED_CONTRACT" ]]',
  ].join('\n');
  const legacyProfileContract = volumeContract({ count: 3 });
  const historicalLegacyProfileContract = `${profileVolume}|local|local|null|3|${project}|${composeVersion}|kemerbet_sessions|/var/lib/docker/volumes/${profileVolume}/_data`;
  const compose5ProfileContract = volumeContract({ count: 4, hash: lowerHash });
  const contractCases = [
    ['exact legacy three-label', legacyProfileContract, historicalLegacyProfileContract, 0],
    ['exact Compose 5 four-label', compose5ProfileContract, compose5ProfileContract, 0],
    ['foreign fourth label', volumeContract({ count: 4 }), '', 1],
    ['foreign fifth label', volumeContract({ count: 5, hash: lowerHash }), '', 1],
    ['missing logical label', volumeContract({ count: 3, logical: '' }), '', 1],
    ['uppercase hash', volumeContract({ count: 4, hash: lowerHash.toUpperCase() }), '', 1],
    ['short hash', volumeContract({ count: 4, hash: 'a'.repeat(63) }), '', 1],
    ['hash on legacy count', volumeContract({ count: 3, hash: lowerHash }), '', 1],
    ['foreign logical label', volumeContract({ count: 3, logical: 'foreign' }), '', 1],
  ];
  for (const [name, contract, expectedContract, expectedStatus] of contractCases) {
    const result = spawnSync(bashExecutable, ['-c', inspectorHarness], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        MOCK_VOLUME_CONTRACT: contract,
        MOCK_EXPECTED_CONTRACT: expectedContract,
      },
    });
    assert.equal(
      result.status,
      expectedStatus,
      `${name} durable-volume fixture returned ${result.status}: ${result.stderr}`,
    );
  }

  const normalizedProfileContract = `${profileVolume}|local|local|null|3|${project}|${composeVersion}|kemerbet_sessions|/var/lib/docker/volumes/${profileVolume}/_data`;
  for (const [name, contract, expectedStatus] of [
    ['exact DEBUG/source Compose 5 adapter', volumeContract({ count: 4, hash: lowerHash }), 0],
    ['DEBUG/source adapter rejects foreign fourth label', volumeContract({ count: 4 }), 1],
    [
      'DEBUG/source adapter rejects foreign fifth label',
      volumeContract({ count: 5, hash: lowerHash }),
      1,
    ],
    [
      'DEBUG/source adapter rejects uppercase hash',
      volumeContract({ count: 4, hash: lowerHash.toUpperCase() }),
      1,
    ],
    [
      'DEBUG/source adapter rejects foreign project',
      volumeContract({ count: 4, hash: lowerHash, projectName: 'foreign' }),
      1,
    ],
  ]) {
    const adapterHarness = [
      'set -euo pipefail',
      'SCRATCH="$(mktemp -d)"',
      'trap \'rm -rf -- "$SCRATCH"\' EXIT',
      'mkdir -p "$SCRATCH/bin"',
      `printf '%s\\n' '#!/usr/bin/env bash' "printf '%s' '${contract}'" >"$SCRATCH/bin/docker"`,
      'chmod 0700 "$SCRATCH/bin/docker"',
      'SAFE_PATH="$SCRATCH/bin:/usr/bin:/bin"',
      "LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'",
      `PROJECT_NAME='${project}'`,
      `COMPAT_PROFILE_VOLUME='${profileVolume}'`,
      `COMPAT_CONTROL_VOLUME='${controlVolume}'`,
      `COMPAT_PROFILE_CONFIG_HASH='${lowerHash}'`,
      `COMPAT_CONTROL_CONFIG_HASH='${'f'.repeat(64)}'`,
      `COMPAT_VOLUME_VERSION='${composeVersion}'`,
      'COMPAT_LEGACY_VOLUME_FORMAT=\'{{.Name}}|{{.Driver}}|{{.Scope}}|{{json .Options}}|{{len .Labels}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.version" }}|{{ index .Labels "com.docker.compose.volume" }}|{{.Mountpoint}}\'',
      'COMPAT_COMPOSE5_VOLUME_FORMAT=\'{{.Name}}|{{.Driver}}|{{.Scope}}|{{json .Options}}|{{len .Labels}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.version" }}|{{ index .Labels "com.docker.compose.volume" }}|{{with index .Labels "com.docker.compose.config-hash"}}{{.}}{{end}}|{{.Mountpoint}}\'',
      'COMPAT_ACTIVATED=false',
      'CHAIN_SENTINEL="$SCRATCH/full-chain-called"',
      compose5DebugNormalizer,
      'cat >"$SCRATCH/predecessor-helper" <<\'BASH\'',
      'docker_local() { return 97; }',
      'require_kemerbet_v1_retirement_recovery_ready() {',
      '  local observed',
      '  observed="$(docker_local volume inspect "$COMPAT_PROFILE_VOLUME" --format "$COMPAT_LEGACY_VOLUME_FORMAT")" || return 1',
      `  [[ "$observed" == '${normalizedProfileContract}' ]] || return 1`,
      '  printf \'%s\' called >"$CHAIN_SENTINEL"',
      '}',
      'command="${1:-}"',
      'case "$command" in',
      '  kemerbet-v1-retirement-recovery-ready)',
      '    require_kemerbet_v1_retirement_recovery_ready "$2" || exit 1',
      '    ;;',
      '  *) exit 1 ;;',
      'esac',
      'BASH',
      'set -- kemerbet-v1-retirement-recovery-ready 0123456789abcdef0123456789abcdef01234567',
      'set -T',
      'trap compat_activate_normalizer DEBUG',
      'source "$SCRATCH/predecessor-helper"',
      '[[ "$COMPAT_ACTIVATED" == true && -f "$CHAIN_SENTINEL" ]]',
    ].join('\n');
    const result = spawnSync(bashExecutable, ['-c', adapterHarness], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(
      result.status,
      expectedStatus,
      `${name} fixture returned ${result.status}: ${result.stderr}`,
    );
  }

  const pairHarness = [
    'set -euo pipefail',
    'SCRATCH="$(mktemp -d)"',
    'trap \'rm -rf -- "$SCRATCH"\' EXIT',
    `PROJECT_NAME='${project}'`,
    `KEMERBET_PROFILE_VOLUME='${profileVolume}'`,
    `KEMERBET_SESSION_CONTROL_VOLUME='${controlVolume}'`,
    'KEMERBET_V1_RETIREMENT_ARCHIVE="$SCRATCH/absent-archive"',
    'KEMERBET_READINESS_BINDING="$SCRATCH/binding"',
    'KEMERBET_RECHECK_OWNER_CLAIM_ID="11111111-1111-4111-8111-111111111111"',
    `KEMERBET_RECHECK_PLAYER_IDS_DIGEST='${'b'.repeat(64)}'`,
    'KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="1:2"',
    'KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="3:4"',
    'KEMERBET_V1_RETIREMENT_DURABLE_VOLUME_DIGEST=""',
    'docker_local() {',
    '  if [[ "$1" == volume && "$2" == ls ]]; then',
    '    printf \'%s\\n%s\\n\' "$KEMERBET_PROFILE_VOLUME" "$KEMERBET_SESSION_CONTROL_VOLUME"',
    '  elif [[ "$1" == volume && "$2" == inspect ]]; then',
    '    case "$3" in',
    '      "$KEMERBET_PROFILE_VOLUME") printf \'%s\' "$PROFILE_CONTRACT" ;;',
    '      "$KEMERBET_SESSION_CONTROL_VOLUME") printf \'%s\' "$CONTROL_CONTRACT" ;;',
    '      *) return 1 ;;',
    '    esac',
    '  elif [[ "$1" == container && "$2" == ls ]]; then',
    '    :',
    '  else',
    '    return 1',
    '  fi',
    '}',
    'resolve_kemerbet_session_control_volume_mountpoint() { printf \'%s\' "/var/lib/docker/volumes/$KEMERBET_SESSION_CONTROL_VOLUME/_data"; }',
    'resolve_kemerbet_profile_volume_mountpoint() { printf \'%s\' "/var/lib/docker/volumes/$KEMERBET_PROFILE_VOLUME/_data"; }',
    'inspect_owner_staged_kemerbet_cohort_for_retirement_context() { :; }',
    'require_owner_kemerbet_failed_marker_read_only() { :; }',
    `kemerbet_profile_identity_digest() { printf '%s' '${'c'.repeat(64)}'; }`,
    'stat() {',
    '  local path="${!#}"',
    '  case "$path" in',
    '    "/var/lib/docker/volumes/$KEMERBET_PROFILE_VOLUME/_data") printf \'%s\' "11:21:10001:10001:700:3" ;;',
    '    "/var/lib/docker/volumes/$KEMERBET_SESSION_CONTROL_VOLUME/_data") printf \'%s\' "10:20:10001:10001:700:2" ;;',
    '    *) command stat "$@" ;;',
    '  esac',
    '}',
    successorDurableVolumeContract,
    successorDurableVolumeAttestor,
    `printf '%s\\n' '11111111-1111-4111-8111-111111111111 hmac-sha256-agent-identity-v1:${'d'.repeat(64)} sha256-provider-authorization-v1:${'e'.repeat(64)}' >"$KEMERBET_READINESS_BINDING"`,
    'require_kemerbet_v1_retirement_durable_volumes >/dev/null',
  ].join('\n');
  const profileLegacy = volumeContract({ count: 3 });
  const controlLegacy = volumeContract({
    volume: controlVolume,
    count: 3,
    logical: 'kemerbet_session_control',
  });
  const profileCompose5 = volumeContract({ count: 4, hash: lowerHash });
  const controlCompose5 = volumeContract({
    volume: controlVolume,
    count: 4,
    logical: 'kemerbet_session_control',
    hash: 'f'.repeat(64),
  });
  for (const [name, profileContract, controlContract, expectedStatus] of [
    ['matched legacy pair', profileLegacy, controlLegacy, 0],
    ['matched Compose 5 pair', profileCompose5, controlCompose5, 0],
    ['mixed legacy and Compose 5 pair', profileLegacy, controlCompose5, 1],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: pairHarness,
      env: {
        PATH: process.env.PATH,
        PROFILE_CONTRACT: profileContract,
        CONTROL_CONTRACT: controlContract,
      },
    });
    assert.equal(
      result.status,
      expectedStatus,
      `${name} durable-volume pair fixture returned ${result.status}: ${result.stderr}`,
    );
  }
}

const migrationFreshBranch =
  /if require_exact_sudoers_file "\$SUDOERS"; then([\s\S]*?)\n  elif \[\[ ! -e "\$SUDOERS"/u.exec(
    v2V3SuccessorMigration,
  )?.[1];
assert.ok(migrationFreshBranch, 'the migration must expose one enabled-grant fresh path');
assertInOrder(
  migrationFreshBranch,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper stop',
    'require_predecessor_recovery_ready',
    'failed outside the exact Compose 5 durable-volume compatibility contract',
    'validate_retirement_and_binding "$RETIREMENT_ROOT" "$SOURCE"',
  ],
  'the migration must try the unmodified predecessor first and use compatibility only before exact continuity validation',
);

const v2V3BindingTransform = extractShellFunction(
  v2V3SuccessorMigration,
  'archive_and_transform_binding',
  'publish_completion',
);
for (const stableV3ProjectionContract of [
  /v2 = re\.compile\([\s\S]*?b'\(' \+ uuid \+ rb'\) hmac-sha256-agent-identity-v1:\(\[0-9a-f\]\{64\}\) '[\s\S]*?rb'sha256-provider-authorization-v1:\[0-9a-f\]\{64\}\\n'/u,
  /v3 = re\.compile\([\s\S]*?b'\(' \+ uuid \+ rb'\) hmac-sha256-agent-identity-v1:\(\[0-9a-f\]\{64\}\) '[\s\S]*?rb'hmac-sha256-agent-profile-pin-v3:\\2\\n'/u,
  /read_exact\(archive_fd, archive_name, \(0, 0\), 0o400\)/u,
  /hashlib\.sha256\(archived\)\.hexdigest\(\) != expected_sha/u,
  /match\.group\(1\) \+ b' hmac-sha256-agent-identity-v1:' \+ match\.group\(2\) \+\s+b' hmac-sha256-agent-profile-pin-v3:' \+ match\.group\(2\) \+ b'\\n'/u,
  /if current == expected_v3 and v3\.fullmatch\(current\) is not None:/u,
  /os\.rename\(temporary, source_name, src_dir_fd=source_fd, dst_dir_fd=source_fd\)/u,
  /read_exact\(source_fd, source_name, \(10001, 10001\), 0o600\) != expected_v3/u,
]) {
  assert.match(v2V3BindingTransform, stableV3ProjectionContract);
}
const expectedV3Projection = /expected_v3 = \(([\s\S]*?)\n    \)\n    current =/u.exec(
  v2V3BindingTransform,
)?.[1];
assert.ok(expectedV3Projection, 'the migration must construct one explicit v3 projection');
assert.doesNotMatch(
  expectedV3Projection,
  /provider-authorization/iu,
  'the retired provider-authorization digest must not enter the stable v3 identity projection',
);

const migrationRequireV3Binding = /require_v3_binding\(\) \{[\s\S]*?\n\}/u.exec(
  v2V3SuccessorMigration,
)?.[0];
assert.ok(migrationRequireV3Binding, 'the migration must define an exact v3 binding attestor');
for (const v3MigrationBindingContract of [
  /rb'hmac-sha256-agent-identity-v1:\(\[0-9a-f\]\{64\}\) '/u,
  /rb'hmac-sha256-agent-profile-pin-v3:\\1\\n'/u,
  /\(10001, 10001, 0o600, 1, 230\)/u,
  /\(value\.st_dev, value\.st_ino\) != \(named\.st_dev, named\.st_ino\)/u,
  /os\.path\.realpath\(path\) != path/u,
  /pattern\.fullmatch\(bytes\(data\)\) is None/u,
]) {
  assert.match(migrationRequireV3Binding, v3MigrationBindingContract);
}

const migrationRestoreSudoers = /restore_sudoers\(\) \{[\s\S]*?\n\}/u.exec(
  v2V3SuccessorMigration,
)?.[0];
assert.ok(migrationRestoreSudoers, 'the migration must define an exact sudoers restoration');
for (const sudoersRestoreContract of [
  /\[\[ ! -e "\$SUDOERS" && ! -L "\$SUDOERS" \]\] \|\| return 1/u,
  /require_exact_sudoers_file "\$SUDOERS_DISABLED" \|\| return 1/u,
  /visudo -cf "\$SUDOERS_DISABLED" >\/dev\/null \|\| return 1/u,
  /visudo -cf \/etc\/sudoers >\/dev\/null \|\| return 1/u,
  /mv -- "\$SUDOERS_DISABLED" "\$SUDOERS" \|\| return 1/u,
  /sync -f \/etc\/sudoers\.d \|\| return 1/u,
  /if sync -f \/etc\/sudoers\.d && require_exact_sudoers_file "\$SUDOERS" &&\s+visudo -cf \/etc\/sudoers >\/dev\/null; then/u,
  /mv -- "\$SUDOERS" "\$SUDOERS_DISABLED" \|\| return 1/u,
  /require_exact_sudoers_file "\$SUDOERS_DISABLED" \|\| return 1/u,
]) {
  assert.match(migrationRestoreSudoers, sudoersRestoreContract);
}
const migrationStateClassifier = v2V3SuccessorMigration.slice(
  v2V3SuccessorMigration.indexOf('if [[ ! -e "$MIGRATION_ROOT" && ! -L "$MIGRATION_ROOT" &&'),
  v2V3SuccessorMigration.indexOf('if [[ -e "$MIGRATION_PARENT" || -L "$MIGRATION_PARENT" ]]'),
);
assert.ok(
  migrationStateClassifier.length > 0,
  'the migration must classify fresh, disabled-fresh, completed, and interrupted topologies',
);
const migrationFreshDisabledBranch =
  /elif \[\[ ! -e "\$SUDOERS" && ! -L "\$SUDOERS" \]\] &&\s+require_exact_sudoers_file "\$SUDOERS_DISABLED"; then([\s\S]*?)\n  else\n    die 'the deployment sudoers grant topology is unavailable or ambiguous'/u.exec(
    migrationStateClassifier,
  )?.[1];
assert.ok(
  migrationFreshDisabledBranch,
  'the migration must expose one exact no-prefix disabled-grant recovery branch',
);
assertInOrder(
  migrationFreshDisabledBranch,
  [
    "migration_state='fresh-disabled'",
    'require_fresh_disabled_predecessor_boundary',
    'disabled-grant recovery requires an exactly stopped predecessor with intact v2 continuity',
  ],
  'fresh-disabled recovery must prove the stopped predecessor and exact v2 continuity without invoking the disabled helper',
);
assert.doesNotMatch(
  migrationFreshDisabledBranch,
  /run_predecessor_helper|sudo -n/u,
  'fresh-disabled recovery must not invoke the predecessor helper through its disabled grant',
);
const migrationInterruptedBranch = /else\s+migration_state='interrupted'([\s\S]*?)\nfi\s*$/u.exec(
  migrationStateClassifier,
)?.[1];
assert.ok(
  migrationInterruptedBranch,
  'the migration must expose one exact interrupted-prefix classifier',
);
for (const interruptedMigrationContract of [
  /! -e "\$MIGRATION_ROOT" && ! -L "\$MIGRATION_ROOT"/u,
  /require_migration_installing_prefix "\$MIGRATION_INSTALLING"/u,
  /! -e "\$SUDOERS" && ! -L "\$SUDOERS"/u,
  /require_exact_sudoers_file "\$SUDOERS_DISABLED"/u,
]) {
  assert.match(migrationInterruptedBranch, interruptedMigrationContract);
}
for (const migrationParentStateContract of [
  /fresh\|fresh-disabled\) \[\[ -z "\$migration_parent_entries" \]\]/u,
  /interrupted\) \[\[ "\$migration_parent_entries" == "\$\{SUCCESSOR_RELEASE\}\.installing" \]\]/u,
  /completed\) \[\[ "\$migration_parent_entries" == "\$SUCCESSOR_RELEASE" \]\]/u,
  /elif \[\[ "\$migration_state" != 'fresh' && "\$migration_state" != 'fresh-disabled' \]\]; then\s+die 'the existing migration lost its canonical parent'/u,
]) {
  assert.match(v2V3SuccessorMigration, migrationParentStateContract);
}
const migrationCompletedFastPath =
  /if \[\[ "\$migration_state" == 'completed' \]\]; then([\s\S]*?)\nfi\n\ntrap cleanup EXIT/u.exec(
    v2V3SuccessorMigration,
  )?.[1];
assert.ok(
  migrationCompletedFastPath,
  'the completed successor must have one lock-protected, non-mutating re-attestation path',
);
assertInOrder(
  migrationCompletedFastPath,
  [
    'require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755',
    'require_v3_binding "$SOURCE"',
    'kemerbet-v3-successor-ready "$SUCCESSOR_RELEASE" "$SUCCESSOR_HELPER_SHA256"',
    'if [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]',
    'restore_sudoers',
    'require_exact_sudoers_file "$SUDOERS"',
    'exit 0',
  ],
  'completed migration recovery must re-attest the exact successor, normalize the grant, and exit before mutation',
);
const migrationCriticalSection = v2V3SuccessorMigration.slice(
  v2V3SuccessorMigration.indexOf('trap cleanup EXIT'),
);
const migrationGrantDisableBoundary =
  /trap cleanup EXIT\n([\s\S]*?)\n# Disable the predecessor helper grant before publishing any successor namespace\./u.exec(
    migrationCriticalSection,
  )?.[1];
assert.ok(
  migrationGrantDisableBoundary,
  'the migration must expose one exact enabled-or-already-disabled grant transition',
);
assertInOrder(
  migrationGrantDisableBoundary,
  [
    'if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]',
    'require_exact_sudoers_file "$SUDOERS"',
    '[[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]]',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    "sudoers_disabled='true'",
    'sync -f /etc/sudoers.d',
    'else',
    "sudoers_disabled='true'",
    'require_exact_sudoers_file "$SUDOERS_DISABLED"',
    '[[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]]',
    'visudo -cf /etc/sudoers',
    'require_no_helper_processes',
  ],
  'the migration must normalize both enabled and already-disabled grant entries before creating successor evidence',
);
assertInOrder(
  migrationCriticalSection,
  [
    'trap cleanup EXIT',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'require_exact_sudoers_file "$SUDOERS_DISABLED"',
    '[[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]]',
    'visudo -cf /etc/sudoers',
    'require_no_helper_processes',
    'if [[ ! -e "$MIGRATION_INSTALLING" && ! -L "$MIGRATION_INSTALLING" ]]',
    'sync -f "$MIGRATION_PARENT"',
    'publish_intent "$MIGRATION_INSTALLING"',
    'require_migration_intent "$MIGRATION_INSTALLING"',
    'archive_and_transform_binding "$MIGRATION_INSTALLING"',
    'require_v3_binding "$SOURCE"',
    'require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755',
    'publish_completion "$MIGRATION_INSTALLING"',
    'mv -- "$MIGRATION_INSTALLING" "$MIGRATION_ROOT"',
    "sudoers_may_restore='true'",
    'restore_sudoers',
    "sudoers_may_restore='false'",
    'trap - EXIT',
  ],
  'the successor migration must keep the deployment grant disabled across archival, transformation, helper replacement, and final v3 attestation',
);
const migrationGrantMoveIndex = migrationCriticalSection.indexOf(
  'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
);
const migrationIntentPublishIndex = migrationCriticalSection.indexOf(
  'publish_intent "$MIGRATION_INSTALLING"',
);
assert.ok(
  migrationGrantMoveIndex >= 0 &&
    migrationIntentPublishIndex >= 0 &&
    migrationGrantMoveIndex < migrationIntentPublishIndex,
  'the predecessor helper grant must be disabled before any successor intent is published',
);
assertInOrder(
  v2V3SuccessorMigration,
  [
    'require_no_helper_processes',
    'flock --exclusive --nonblock 9',
    'case "$migration_state" in',
    'fresh)',
    'require_predecessor_recovery_ready',
    'validate_retirement_and_binding "$RETIREMENT_ROOT" "$SOURCE"',
    'fresh-disabled)',
    'require_fresh_disabled_predecessor_boundary',
    'if [[ "$migration_state" == \'completed\' ]]',
    'trap cleanup EXIT',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
  ],
  'the migration must acquire the root mutation lock, re-attest each fresh boundary, and finish completed-overlay recovery before disabling the exact deployment grant',
);
assert.doesNotMatch(
  migrationCriticalSection.slice(0, migrationCriticalSection.indexOf("sudoers_may_restore='true'")),
  /run_predecessor_helper|sudo -n/u,
  'the disabled-grant critical section must never regain helper sudo through the predecessor path',
);
for (const canonicalRetirementContract of [
  /\[\[ ! -L "\$RETIREMENT_ROOT" && -d "\$RETIREMENT_ROOT" &&\s+"\$\(realpath -- "\$RETIREMENT_ROOT"\)" == "\$RETIREMENT_ROOT" &&\s+"\$\(stat --format='%U:%G:%a' "\$RETIREMENT_ROOT"\)" == 'root:root:700' \]\]/u,
  /die 'the canonical predecessor retirement root changed under lock'/u,
  /\[\[ ! -L "\$RETIREMENT_ROOT" && -d "\$RETIREMENT_ROOT" \]\] \|\|\s+die 'the canonical predecessor retirement root was not preserved'/u,
  /kemerbet-v3-successor-ready "\$SUCCESSOR_RELEASE" "\$SUCCESSOR_HELPER_SHA256"/u,
]) {
  assert.match(v2V3SuccessorMigration, canonicalRetirementContract);
}
assert.doesNotMatch(
  v2V3SuccessorMigration,
  /RETIREMENT_ARCHIVE_NAME|mv -- "\$RETIREMENT_ROOT"|os\.rename\([^\r\n]*retirement/iu,
  'the canonical v1 retirement root must remain in place while the four-entry successor overlay archives only the v2 binding and predecessor helper',
);

const v3HelperRotationConfirmation =
  'I-UNDERSTAND-THIS-APPENDS-ONE-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationContract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly BASE_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v2-v3-successor'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-disabled'$/mu,
  /^readonly LOCK="\$LOCK_ROOT\/mutation\.lock"$/mu,
  /^readonly EXPECTED_DROPLET_ID='593344964'$/mu,
  /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu,
  /^readonly PREDECESSOR_RELEASE='de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3'$/mu,
  /^readonly PREDECESSOR_HELPER_SHA256='e94dfdcfe90ff6021446fc66e2850ae13198b03d9e2210f454181ab00177f97d'$/mu,
  new RegExp(`^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperSuccessorSha}'$`, 'mu'),
  /\[\[ \$# -eq 3 \]\]/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /the supplied successor helper digest is not the hard-pinned reviewed artifact/u,
  /\[\[ "\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION" \]\]/u,
  /\[\[ "\$\(id -u\)" == '0' && "\$\(id -un\)" == 'root' \]\]/u,
  /\[\[ -z "\$\{SUDO_USER:-\}" && -z "\$\{DOCKER_HOST:-\}" && -z "\$\{DOCKER_CONTEXT:-\}" \]\]/u,
]) {
  assert.match(v3SuccessorHelperRotation, fixedRotationContract);
}
assert.equal(
  v3SuccessorHelperRotation.split(`readonly CONFIRMATION='${v3HelperRotationConfirmation}'`)
    .length - 1,
  1,
  'the installed-v3 rotation must expose one exact one-use root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotation,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the helper rotation must append evidence and atomically replace only the reviewed helper without destructive cleanup primitives',
);
assert.doesNotMatch(
  v3SuccessorHelperRotation,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the helper rotation must never enable Transfer or a live money-moving executor',
);

const rotationBaseEvidence = extractShellFunction(
  v3SuccessorHelperRotation,
  'load_exact_base_successor_evidence',
  'expected_intent',
);
for (const baseEvidenceContract of [
  /exact_directory\(parent, \[expected_release\]\)/u,
  /\['binding-v2', 'completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /len\(intent\) != 9/u,
  /len\(completion\) != 10/u,
  /retirement_intent_sha256=/u,
  /retirement_completion_sha256=/u,
  /hashlib\.sha256\(retirement_intent_data\)\.hexdigest\(\) != retirement_intent_sha/u,
  /hashlib\.sha256\(retirement_completion_data\)\.hexdigest\(\) != retirement_completion_sha/u,
  /v2_match\.group\(1\) != v3_match\.group\(1\)/u,
  /v2_match\.group\(2\) != v3_match\.group\(2\)/u,
  /retirement_intent\[2\] != f'release=\{predecessor_release\}'/u,
  /retirement_intent\[4\] != f'helper_sha256=\{predecessor_helper_sha\}'/u,
  /identity_hmac_key_dev_ino=/u,
  /identity_hmac_key_sha256=/u,
  /owner_stage_player_ids_dev_ino=/u,
  /owner_stage_player_ids_sha256=/u,
  /owner_stage_claim_dev_ino=/u,
  /release_asset_sha256=/u,
  /v2_binding_dev_ino=/u,
  /v2_binding_sha256=/u,
  /for forbidden_installed_residue in \(/u,
]) {
  assert.match(rotationBaseEvidence, baseEvidenceContract);
}
assert.doesNotMatch(
  rotationBaseEvidence,
  /sys\.stdout\.write\(\s*(?:binding_v[23]|intent_data|completion_data|identity_key_data)\s*\)|print\(\s*(?:binding_v[23]|intent_data|completion_data|identity_key_data)\s*\)/u,
  'the locked base-evidence parser must output only digests, never IDs, bindings, or secrets',
);

const rotationDurableCapture = extractShellFunction(
  v3SuccessorHelperRotation,
  'capture_rotation_durable_boundary',
  'require_preserved_rotation_durable_boundary',
);
for (const durableCaptureContract of [
  /ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST="\$COMPOSE5_DURABLE_VOLUME_DIGEST"/u,
  /ROTATION_COMPOSE5_PROFILE_CONFIG_HASH="\$COMPOSE5_PROFILE_CONFIG_HASH"/u,
  /ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH="\$COMPOSE5_SESSION_CONTROL_CONFIG_HASH"/u,
  /ROTATION_COMPOSE5_VOLUME_VERSION="\$COMPOSE5_VOLUME_VERSION"/u,
]) {
  assert.match(rotationDurableCapture, durableCaptureContract);
}
const rotationDurablePreserverBody =
  /require_preserved_rotation_durable_boundary\(\) \{([\s\S]*?)\n\}\n\nBASE_SUCCESSOR_INTENT_SHA256/u.exec(
    v3SuccessorHelperRotation,
  )?.[1];
assert.ok(
  rotationDurablePreserverBody,
  'the rotation must expose one exact durable-volume preservation checkpoint',
);
const rotationDurablePreserver = `require_preserved_rotation_durable_boundary() {${rotationDurablePreserverBody}\n}`;
assertInOrder(
  rotationDurablePreserver,
  [
    'durable_digest="$ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST"',
    'profile_hash="$ROTATION_COMPOSE5_PROFILE_CONFIG_HASH"',
    'session_control_hash="$ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH"',
    'volume_version="$ROTATION_COMPOSE5_VOLUME_VERSION"',
    'require_stopped_no_transfer_boundary',
    '"$COMPOSE5_DURABLE_VOLUME_DIGEST" == "$durable_digest"',
    '"$COMPOSE5_PROFILE_CONFIG_HASH" == "$profile_hash"',
    '"$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" == "$session_control_hash"',
    '"$COMPOSE5_VOLUME_VERSION" == "$volume_version"',
  ],
  'every later checkpoint must recompute and compare the exact frozen durable-volume identity',
);
for (const durableEvidenceField of [
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal(
    (v3SuccessorHelperRotation.match(new RegExp(`${durableEvidenceField}=`, 'gu')) ?? []).length,
    3,
    `intent, completion, and the atomic publisher must bind ${durableEvidenceField}`,
  );
}

const rotationClassifier = extractShellFunction(
  v3SuccessorHelperRotation,
  'classify_rotation',
  'require_rotation_prefix',
);
for (const classifierContract of [
  /if not os\.path\.lexists\(parent\):\s+print\('absent'\)/u,
  /entries = sorted\(os\.listdir\(parent\)\)/u,
  /if entries == \[\]:\s+print\('empty-parent'\)/u,
  /elif entries == \[f'\{successor\}\.installing'\]:\s+print\('interrupted'\)/u,
  /elif entries == \[successor\]:\s+print\('completed'\)/u,
]) {
  assert.match(rotationClassifier, classifierContract);
}
const rotationPrefix = extractShellFunction(
  v3SuccessorHelperRotation,
  'require_rotation_prefix',
  'publish_record',
);
for (const prefixContract of [
  /'\.completed-v1\.installing': \(0o600, 4096\)/u,
  /'\.intent-v1\.installing': \(0o600, 4096\)/u,
  /'\.predecessor-helper\.installing': \(0o400, 2 \* 1024 \* 1024\)/u,
  /if any\(name not in allowed for name in entries\):/u,
  /if final in entries and f'\.\{final\}\.installing' in entries:/u,
]) {
  assert.match(rotationPrefix, prefixContract);
}
const rotationCleanup = /cleanup\(\) \{([\s\S]*?)\n\}\n\n\[\[ "\$\(curl/u.exec(
  v3SuccessorHelperRotation,
)?.[1];
assert.ok(rotationCleanup, 'the one-use rotation must expose an exact EXIT cleanup boundary');
assert.match(rotationCleanup, /if \[\[ "\$rotation_finalized" == 'false' \]\]/u);
assert.match(rotationCleanup, /rollback_precompletion_helper/u);
assert.match(
  rotationCleanup,
  /rerun this exact operation with the same successor release and helper digest from the root console; do not restore the grant manually/u,
);
assert.doesNotMatch(
  rotationCleanup,
  /restore_sudoers|mv -- "\$SUDOERS_DISABLED" "\$SUDOERS"/u,
  'error cleanup must leave the exact grant disabled until a same-input resume succeeds',
);

const rotationPublisher = extractShellFunction(
  v3SuccessorHelperRotation,
  'publish_record',
  'copy_root_file_atomically',
);
for (const atomicRecordContract of [
  /"\$ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST"/u,
  /"\$ROTATION_COMPOSE5_PROFILE_CONFIG_HASH"/u,
  /"\$ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH"/u,
  /"\$ROTATION_COMPOSE5_VOLUME_VERSION"/u,
  /f'compose5_durable_volume_digest=\{compose5_durable_volume_digest\}\\n'/u,
  /f'compose5_profile_config_hash=\{compose5_profile_config_hash\}\\n'/u,
  /f'compose5_session_control_config_hash=\{compose5_session_control_config_hash\}\\n'/u,
  /f'compose5_volume_version=\{compose5_volume_version\}\\n'/u,
  /os\.O_WRONLY \| os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /expected\.startswith\(existing\)/u,
  /os\.fsync\(descriptor\)/u,
  /os\.rename\(temporary, target, src_dir_fd=directory, dst_dir_fd=directory\)/u,
  /os\.fsync\(directory\)/u,
]) {
  assert.match(rotationPublisher, atomicRecordContract);
}
const rotationHelperCopier = extractShellFunction(
  v3SuccessorHelperRotation,
  'copy_root_file_atomically',
  'require_exact_rotation',
);
for (const atomicHelperContract of [
  /os\.O_RDONLY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /hashlib\.sha256\(data\)\.hexdigest\(\) != expected_digest/u,
  /bytes\(data\)\.startswith\(existing\)/u,
  /os\.O_WRONLY \| os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /os\.rename\(temporary, target\)/u,
  /os\.fsync\(directory\)/u,
]) {
  assert.match(rotationHelperCopier, atomicHelperContract);
}
const exactRotation = extractShellFunction(
  v3SuccessorHelperRotation,
  'require_exact_rotation',
  'restore_sudoers',
);
for (const finalRotationContract of [
  /\$'completed-v1\\nintent-v1\\npredecessor-helper'/u,
  /load_rotation_intent_sha256/u,
  /cmp -s -- "\$root\/\$ROTATION_COMPLETION_NAME" <\(expected_completion\)/u,
  /require_helper_file "\$root\/\$HELPER_ARCHIVE_NAME" "\$PREDECESSOR_HELPER_SHA256" 400/u,
]) {
  assert.match(exactRotation, finalRotationContract);
}
const rotationGrantRestore = extractShellFunction(
  v3SuccessorHelperRotation,
  'restore_sudoers',
  'rollback_precompletion_helper',
);
assertInOrder(
  rotationGrantRestore,
  [
    'require_exact_sudoers_file "$SUDOERS_DISABLED"',
    'visudo -cf "$SUDOERS_DISABLED"',
    'visudo -cf /etc/sudoers',
    'mv -- "$SUDOERS_DISABLED" "$SUDOERS"',
    'sync -f /etc/sudoers.d && require_exact_sudoers_file "$SUDOERS"',
    'visudo -cf /etc/sudoers',
    'require_exact_sudoers_file "$SUDOERS"',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'sync -f /etc/sudoers.d',
    'require_exact_sudoers_file "$SUDOERS_DISABLED"',
  ],
  'grant restoration must prevalidate, publish, and roll the same exact grant back to disabled after any post-move failure',
);

const rotationMainStart = v3SuccessorHelperRotation.indexOf(
  'rotation_state="$(classify_rotation)"',
);
assert.ok(rotationMainStart >= 0, 'the one-use rotation main transaction must be extractable');
const rotationMain = v3SuccessorHelperRotation.slice(rotationMainStart);
assertInOrder(
  rotationMain,
  [
    'rotation_state="$(classify_rotation)"',
    'case "$rotation_state" in',
    'absent)',
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'empty-parent)',
    "die 'an empty rotation parent may resume only with the deployment grant disabled'",
    'interrupted)',
    "die 'an interrupted rotation must retain the disabled deployment grant'",
    'completed)',
    'require_no_helper_processes',
    'flock --exclusive --nonblock 9',
    '[[ "$(classify_rotation)" == "$rotation_state" ]]',
    'load_exact_base_successor_evidence',
    'require_stopped_no_transfer_boundary',
    'capture_rotation_durable_boundary',
    'trap cleanup EXIT',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    "sudoers_disabled='true'",
    'sync -f /etc/sudoers.d',
    'require_no_helper_processes',
    'load_exact_base_successor_evidence',
    'require_preserved_rotation_durable_boundary',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$TARGET"',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'mv -- "$INSTALLING_HELPER" "$TARGET"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'require_exact_rotation "$ROTATION_INSTALLING"',
    'mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"',
    "rotation_finalized='true'",
    'require_exact_rotation "$ROTATION_ROOT"',
    'require_global_installer_residue_absent',
    'require_preserved_rotation_durable_boundary',
    'flock --unlock 9',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'flock --exclusive --nonblock 9',
    'require_no_helper_processes',
    'load_exact_base_successor_evidence',
    'require_exact_rotation "$ROTATION_ROOT"',
    'require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755',
    'require_global_installer_residue_absent',
    'require_preserved_rotation_durable_boundary',
    'restore_sudoers',
    "sudoers_disabled='false'",
    'trap - EXIT',
  ],
  'the rotation must quiesce the old helper, lock and disable sudo, append exact evidence, self-attest the successor while disabled, and only then restore the grant',
);
assert.equal(
  (rotationMain.match(/restore_sudoers/g) ?? []).length,
  1,
  'the deployment grant may be restored at exactly one final post-attestation point',
);
assert.match(
  rotationMain,
  /if \[\[ "\$rotation_state" == 'completed' \]\]; then[\s\S]*?require_global_installer_residue_absent[\s\S]*?rotation_finalized='true'/u,
  'a completed resume must reject every global install or rollback residue before successor self-attestation',
);
assert.match(
  rotationMain,
  /run_successor_helper_direct kemerbet-v3-successor-ready[\s\S]*?flock --exclusive --nonblock 9[\s\S]*?require_global_installer_residue_absent[\s\S]*?restore_sudoers/u,
  'residue, evidence, helper, and stopped-boundary checks must repeat after temporary lock release and before grant restoration',
);
assert.doesNotMatch(
  rotationMain.slice(
    rotationMain.indexOf('mv -- "$SUDOERS" "$SUDOERS_DISABLED"'),
    rotationMain.indexOf('restore_sudoers'),
  ),
  /run_predecessor_helper|sudo -n/u,
  'the disabled-grant transaction must never regain the predecessor sudo path',
);

if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const restoreHarness = [
    'set -euo pipefail',
    'fixture_dir="$(mktemp -d)"',
    'trap \'command rm -rf -- "$fixture_dir"\' EXIT',
    'SUDOERS="$fixture_dir/active"',
    'SUDOERS_DISABLED="$fixture_dir/disabled"',
    'printf "%s\\n" exact-grant >"$SUDOERS_DISABLED"',
    'chmod 0440 "$SUDOERS_DISABLED"',
    "MOVED='false'",
    "SYNC_FAILED='false'",
    "VALIDATION_FAILED='false'",
    "VISUDO_CALLS='0'",
    'require_exact_sudoers_file() {',
    '  local path="$1"',
    '  if [[ "$FAULT_POINT" == validation && "$path" == "$SUDOERS" && "$MOVED" == true && "$VALIDATION_FAILED" == false ]]; then VALIDATION_FAILED=true; return 1; fi',
    '  [[ ! -L "$path" && -f "$path" && "$(cat "$path")" == exact-grant ]]',
    '}',
    'visudo() {',
    '  VISUDO_CALLS="$((VISUDO_CALLS + 1))"',
    '  if [[ "$FAULT_POINT" == visudo && "$VISUDO_CALLS" == 3 ]]; then return 1; fi',
    '  return 0',
    '}',
    'sync() {',
    '  if [[ "$FAULT_POINT" == sync && "$MOVED" == true && "$SYNC_FAILED" == false ]]; then SYNC_FAILED=true; return 1; fi',
    '  return 0',
    '}',
    'mv() {',
    '  local source="${@: -2:1}" target="${@: -1}"',
    '  command mv "$@" || return 1',
    '  if [[ "$source" == "$SUDOERS_DISABLED" && "$target" == "$SUDOERS" ]]; then MOVED=true; fi',
    '}',
    rotationGrantRestore,
    'set +e',
    'restore_sudoers',
    'status=$?',
    'set -e',
    'if [[ "$FAULT_POINT" == none ]]; then',
    '  [[ "$status" == 0 && -f "$SUDOERS" && ! -e "$SUDOERS_DISABLED" ]]',
    'else',
    '  [[ "$status" != 0 && ! -e "$SUDOERS" && -f "$SUDOERS_DISABLED" ]]',
    '  require_exact_sudoers_file "$SUDOERS_DISABLED"',
    'fi',
  ].join('\n');
  for (const faultPoint of ['none', 'sync', 'validation', 'visudo']) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: restoreHarness,
      env: { PATH: process.env.PATH, FAULT_POINT: faultPoint },
    });
    assert.equal(
      result.status,
      0,
      `the ${faultPoint} grant-restore fault fixture must leave an exact active success or exact disabled rollback: ${result.stderr}`,
    );
  }

  const durableHarness = [
    'set -euo pipefail',
    `ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST='${'a'.repeat(64)}'`,
    `ROTATION_COMPOSE5_PROFILE_CONFIG_HASH='${'b'.repeat(64)}'`,
    `ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH='${'c'.repeat(64)}'`,
    "ROTATION_COMPOSE5_VOLUME_VERSION='5.2.1'",
    'require_stopped_no_transfer_boundary() {',
    '  COMPOSE5_DURABLE_VOLUME_DIGEST="$CURRENT_DURABLE_DIGEST"',
    '  COMPOSE5_PROFILE_CONFIG_HASH="$CURRENT_PROFILE_HASH"',
    '  COMPOSE5_SESSION_CONTROL_CONFIG_HASH="$CURRENT_SESSION_HASH"',
    '  COMPOSE5_VOLUME_VERSION="$CURRENT_VERSION"',
    '}',
    rotationDurablePreserver,
    'require_preserved_rotation_durable_boundary',
  ].join('\n');
  for (const [
    name,
    currentDurableDigest,
    currentProfileHash,
    currentSessionHash,
    currentVersion,
    expectedStatus,
  ] of [
    ['unchanged volumes', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), '5.2.1', 0],
    ['recreated same-name volumes', 'd'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), '5.2.1', 1],
    ['changed profile contract', 'a'.repeat(64), 'd'.repeat(64), 'c'.repeat(64), '5.2.1', 1],
    ['changed control contract', 'a'.repeat(64), 'b'.repeat(64), 'd'.repeat(64), '5.2.1', 1],
    ['changed Compose version', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), '5.2.2', 1],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: durableHarness,
      env: {
        PATH: process.env.PATH,
        CURRENT_DURABLE_DIGEST: currentDurableDigest,
        CURRENT_PROFILE_HASH: currentProfileHash,
        CURRENT_SESSION_HASH: currentSessionHash,
        CURRENT_VERSION: currentVersion,
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} durable-boundary fixture returned ${result.status}: ${result.stderr}`,
    );
  }
}

if (process.platform === 'linux') {
  const fixtureSha256 = (value) => createHash('sha256').update(value).digest('hex');
  const exactWrite = (path, value, mode) => {
    writeFileSync(path, value, { mode });
    chmodSync(path, mode);
  };
  const adaptRootOwnedPython = (source) =>
    source
      .replaceAll('(0, 0, 0o700)', '(os.getuid(), os.getgid(), 0o700)')
      .replaceAll('(0, 0, 0o444)', '(os.getuid(), os.getgid(), 0o444)')
      .replaceAll('(10001, 10001, 0o400)', '(os.getuid(), os.getgid(), 0o400)')
      .replaceAll('(0, 0)', '(os.getuid(), os.getgid())')
      .replaceAll('(10001, 10001)', '(os.getuid(), os.getgid())');

  const classifierPython = adaptRootOwnedPython(
    extractSingleQuotedPythonHeredoc(rotationClassifier, 'classify_rotation'),
  );
  const classifierFixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-v3-rotation-classifier-'));
  const classifierParent = join(classifierFixtureRoot, 'rotation');
  const classifierRelease = 'a'.repeat(40);
  const runClassifier = () =>
    spawnSync('/usr/bin/python3', ['-I', '-', classifierParent, classifierRelease], {
      encoding: 'utf8',
      input: classifierPython,
    });
  try {
    let classifierResult = runClassifier();
    assert.equal(classifierResult.status, 0, classifierResult.stderr);
    assert.equal(classifierResult.stdout.trim(), 'absent');

    mkdirSync(classifierParent, { mode: 0o700 });
    chmodSync(classifierParent, 0o700);
    classifierResult = runClassifier();
    assert.equal(classifierResult.status, 0, classifierResult.stderr);
    assert.equal(
      classifierResult.stdout.trim(),
      'empty-parent',
      'a crash after publishing only the exact empty parent must remain resumable',
    );

    mkdirSync(join(classifierParent, `${classifierRelease}.installing`), { mode: 0o700 });
    classifierResult = runClassifier();
    assert.equal(classifierResult.status, 0, classifierResult.stderr);
    assert.equal(classifierResult.stdout.trim(), 'interrupted');
    rmSync(join(classifierParent, `${classifierRelease}.installing`), { recursive: true });

    mkdirSync(join(classifierParent, classifierRelease), { mode: 0o700 });
    classifierResult = runClassifier();
    assert.equal(classifierResult.status, 0, classifierResult.stderr);
    assert.equal(classifierResult.stdout.trim(), 'completed');
    mkdirSync(join(classifierParent, 'foreign'), { mode: 0o700 });
    classifierResult = runClassifier();
    assert.notEqual(
      classifierResult.status,
      0,
      'any second or foreign rotation entry must fail closed',
    );
  } finally {
    rmSync(classifierFixtureRoot, { recursive: true, force: true });
  }

  const baseEvidencePython = adaptRootOwnedPython(
    extractSingleQuotedPythonHeredoc(rotationBaseEvidence, 'load_exact_base_successor_evidence'),
  );
  const fixtureUuid = '00000000-0000-1000-8000-000000000001';
  const alternateFixtureUuid = '00000000-0000-1000-8000-000000000002';
  const fixtureIdentityHmac = '1'.repeat(64);
  const fixtureAuthorization = '2'.repeat(64);
  const fixtureV2 = Buffer.from(
    `${fixtureUuid} hmac-sha256-agent-identity-v1:${fixtureIdentityHmac} ` +
      `sha256-provider-authorization-v1:${fixtureAuthorization}\n`,
    'ascii',
  );
  const v3Binding = (account = fixtureUuid, hmac = fixtureIdentityHmac) =>
    Buffer.from(
      `${account} hmac-sha256-agent-identity-v1:${hmac} ` +
        `hmac-sha256-agent-profile-pin-v3:${hmac}\n`,
      'ascii',
    );
  assert.equal(fixtureV2.length, 230);
  assert.equal(v3Binding().length, 230);

  const buildBaseEvidenceFixture = (name, options = {}) => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), `fetanagent-v3-base-${name}-`));
    const parent = join(fixtureRoot, 'base');
    const expectedRelease = 'b'.repeat(40);
    const predecessorRelease = 'a'.repeat(40);
    const retirementRelease = options.retirementRelease ?? predecessorRelease;
    const expectedHelper = 'c'.repeat(64);
    const successorRoot = join(parent, expectedRelease);
    const retirement = join(fixtureRoot, 'retirement');
    const source = join(fixtureRoot, 'binding-v3');
    const identityKey = join(fixtureRoot, 'identity-key');
    const oldHelper = Buffer.from('#!/usr/bin/env bash\nexit 0\n', 'ascii');
    const oldHelperSha = fixtureSha256(oldHelper);
    const identityKeyData = Buffer.from('3'.repeat(64), 'ascii');
    const selectedV3 = v3Binding(
      options.v3Account ?? fixtureUuid,
      options.v3Hmac ?? fixtureIdentityHmac,
    );

    mkdirSync(parent, { mode: 0o700 });
    mkdirSync(successorRoot, { mode: 0o700 });
    mkdirSync(retirement, { mode: 0o700 });
    chmodSync(parent, 0o700);
    chmodSync(successorRoot, 0o700);
    chmodSync(retirement, 0o700);
    exactWrite(identityKey, identityKeyData, 0o400);
    const identityStat = statSync(identityKey);

    const retirementIntentLines = [
      'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1',
      'state=retirement-authorized',
      `release=${retirementRelease}`,
      'helper_dev_ino=10:20',
      `helper_sha256=${oldHelperSha}`,
      'legacy_binding_dev_ino=30:40',
      `legacy_binding_sha256=${'4'.repeat(64)}`,
      `identity_hmac_key_dev_ino=${identityStat.dev}:${identityStat.ino}`,
      `identity_hmac_key_sha256=${fixtureSha256(identityKeyData)}`,
      `claim_sha256=${'5'.repeat(64)}`,
      'owner_stage_player_ids_dev_ino=50:60',
      `owner_stage_player_ids_sha256=${'6'.repeat(64)}`,
      'owner_stage_claim_dev_ino=70:80',
      `release_asset_sha256=${'7'.repeat(64)}`,
    ];
    const retirementIntent = `${retirementIntentLines.join('\n')}\n`;
    const retirementCompletionLines = [
      retirementIntentLines[0],
      'state=resealed-v2',
      ...retirementIntentLines.slice(2),
      'v2_binding_dev_ino=90:100',
      `v2_binding_sha256=${fixtureSha256(fixtureV2)}`,
    ];
    let retirementCompletion = `${retirementCompletionLines.join('\n')}\n`;
    let publishedRetirementIntent = retirementIntent;
    if (options.unboundRetirementEvidence) {
      publishedRetirementIntent = retirementIntent.replace(
        `claim_sha256=${'5'.repeat(64)}`,
        `claim_sha256=${'8'.repeat(64)}`,
      );
    }
    exactWrite(join(retirement, 'intent-v1'), publishedRetirementIntent, 0o600);
    exactWrite(join(retirement, 'completed-v1'), retirementCompletion, 0o600);

    const baseIntentLines = [
      'contract=fetanagent-kemerbet-readiness-v2-v3-successor-v1',
      'state=authorized',
      `predecessor_release=${predecessorRelease}`,
      `successor_release=${expectedRelease}`,
      `predecessor_helper_sha256=${oldHelperSha}`,
      `successor_helper_sha256=${expectedHelper}`,
      `v2_binding_sha256=${fixtureSha256(fixtureV2)}`,
      `retirement_intent_sha256=${fixtureSha256(retirementIntent)}`,
      `retirement_completion_sha256=${fixtureSha256(retirementCompletion)}`,
    ];
    const baseIntent = `${baseIntentLines.join('\n')}\n`;
    const baseCompletion = `${[
      baseIntentLines[0],
      'state=successor-installed',
      ...baseIntentLines.slice(2),
      `v3_binding_sha256=${fixtureSha256(selectedV3)}`,
    ].join('\n')}\n`;
    exactWrite(join(successorRoot, 'intent-v1'), baseIntent, 0o600);
    exactWrite(join(successorRoot, 'completed-v1'), baseCompletion, 0o600);
    exactWrite(join(successorRoot, 'binding-v2'), fixtureV2, 0o400);
    exactWrite(join(successorRoot, 'predecessor-helper'), oldHelper, 0o400);
    exactWrite(source, selectedV3, 0o600);

    return {
      fixtureRoot,
      args: [
        parent,
        source,
        expectedRelease,
        expectedHelper,
        retirement,
        identityKey,
        join(fixtureRoot, 'committed-binding'),
        join(fixtureRoot, 'recheck-receipt'),
        join(fixtureRoot, 'owner-completion'),
        join(fixtureRoot, 'promotion'),
        join(fixtureRoot, 'candidate'),
        join(fixtureRoot, 'rpc'),
      ],
    };
  };
  const runBaseEvidenceFixture = (fixture) =>
    spawnSync('/usr/bin/python3', ['-I', '-', ...fixture.args], {
      encoding: 'utf8',
      input: baseEvidencePython,
    });
  for (const [name, options, expectedStatus] of [
    ['exact immutable base', {}, 0],
    ['changed retirement evidence digest', { unboundRetirementEvidence: true }, 1],
    ['different coherent retirement predecessor', { retirementRelease: 'd'.repeat(40) }, 1],
    ['valid-shaped different v3 account', { v3Account: alternateFixtureUuid }, 1],
    ['valid-shaped different v3 hmac', { v3Hmac: '9'.repeat(64) }, 1],
  ]) {
    const fixture = buildBaseEvidenceFixture(name.replaceAll(' ', '-'), options);
    try {
      const result = runBaseEvidenceFixture(fixture);
      assert.equal(
        result.status === 0 ? 0 : 1,
        expectedStatus,
        `${name} base-evidence fixture returned ${result.status}: ${result.stderr}`,
      );
      if (expectedStatus === 0) {
        assert.match(
          result.stdout,
          /^(?:[0-9a-f]{64}\n){5}$/u,
          'the valid base parser may expose only its five non-secret digests',
        );
      } else {
        assert.equal(result.stdout, '', `${name} must fail without exposing any partial evidence`);
      }
    } finally {
      rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    }
  }
}

const v3HelperRotationV2Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-SECOND-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV2Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly BASE_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v2-v3-successor'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v2-disabled'$/mu,
  /^readonly LOCK="\$LOCK_ROOT\/mutation\.lock"$/mu,
  /^readonly EXPECTED_DROPLET_ID='593344964'$/mu,
  /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu,
  /^readonly BASE_SUCCESSOR_RELEASE='de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3'$/mu,
  /^readonly BASE_SUCCESSOR_HELPER_SHA256='e94dfdcfe90ff6021446fc66e2850ae13198b03d9e2210f454181ab00177f97d'$/mu,
  /^readonly PREDECESSOR_RELEASE='8fe693b51b5426c3f358bba67519459161a0ebf9'$/mu,
  /^readonly PREDECESSOR_HELPER_SHA256='f98047953fb9249d7dbcd13be6cf1a145b53a4952a760b36d5ba8bfab2f36f82'$/mu,
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV2SuccessorSha}'$`,
    'mu',
  ),
  /\[\[ \$# -eq 3 \]\]/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
  /\[\[ "\$\(id -u\)" == '0' && "\$\(id -un\)" == 'root' \]\]/u,
  /\[\[ -z "\$\{SUDO_USER:-\}" && -z "\$\{DOCKER_HOST:-\}" && -z "\$\{DOCKER_CONTEXT:-\}" \]\]/u,
]) {
  assert.match(v3SuccessorHelperRotationV2, fixedRotationV2Contract);
}
assert.equal(
  v3SuccessorHelperRotationV2.split(`readonly CONFIRMATION='${v3HelperRotationV2Confirmation}'`)
    .length - 1,
  1,
  'the second installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV2,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the second helper rotation must append evidence and atomically replace only the reviewed helper without destructive cleanup primitives',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV2,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the second helper rotation must never enable Transfer or a live money-moving executor',
);

const rotationV2BaseEvidenceStart = v3SuccessorHelperRotationV2.indexOf(
  'load_exact_base_successor_evidence() {',
);
const rotationV2BaseEvidenceEnd = v3SuccessorHelperRotationV2.indexOf(
  "\n}\n\nPREDECESSOR_ROTATION_INTENT_SHA256=''",
  rotationV2BaseEvidenceStart,
);
assert.ok(
  rotationV2BaseEvidenceStart >= 0 && rotationV2BaseEvidenceEnd > rotationV2BaseEvidenceStart,
  'the second rotation base-evidence parser must be extractable',
);
const rotationV2BaseEvidence = v3SuccessorHelperRotationV2.slice(
  rotationV2BaseEvidenceStart,
  rotationV2BaseEvidenceEnd + 2,
);
for (const rotationV2BaseContract of [
  /"\$BASE_SUCCESSOR_RELEASE" "\$BASE_SUCCESSOR_HELPER_SHA256"/u,
  /exact_directory\(parent, \[expected_release\]\)/u,
  /\['binding-v2', 'completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /retirement_intent_sha256=/u,
  /retirement_completion_sha256=/u,
  /v2_match\.group\(1\) != v3_match\.group\(1\)/u,
  /v2_match\.group\(2\) != v3_match\.group\(2\)/u,
  /for forbidden_installed_residue in \(/u,
]) {
  assert.match(rotationV2BaseEvidence, rotationV2BaseContract);
}
assert.doesNotMatch(
  rotationV2BaseEvidence,
  /sys\.stdout\.write\(\s*(?:binding_v[23]|intent_data|completion_data|identity_key_data)\s*\)|print\(\s*(?:binding_v[23]|intent_data|completion_data|identity_key_data)\s*\)/u,
  'the v2 rotation base parser may output only non-secret digests',
);

const rotationV2PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationContract of [
  /"\$PREDECESSOR_ROTATION_PARENT" "\$BASE_SUCCESSOR_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$BASE_SUCCESSOR_HELPER_SHA256" "\$PREDECESSOR_HELPER_SHA256"/u,
  /exact_directory\(parent, \[predecessor_release\]\)/u,
  /\['completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /intent\[2\] != f'predecessor_release=\{base_release\}'/u,
  /intent\[3\] != f'successor_release=\{predecessor_release\}'/u,
  /intent\[4\] != f'predecessor_helper_sha256=\{base_helper\}'/u,
  /intent\[5\] != f'successor_helper_sha256=\{predecessor_helper\}'/u,
  /base_successor_intent_sha256=/u,
  /base_successor_completion_sha256=/u,
  /base_binding_v2_sha256=/u,
  /base_predecessor_helper_sha256=/u,
  /base_binding_v3_sha256=/u,
  /completion\[15\] !=\s+f'rotation_intent_sha256=\{hashlib\.sha256\(intent_data\)\.hexdigest\(\)\}'/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != base_helper/u,
  /print\(hashlib\.sha256\(intent_data\)\.hexdigest\(\)\)/u,
  /print\(hashlib\.sha256\(completion_data\)\.hexdigest\(\)\)/u,
  /print\(hashlib\.sha256\(archived_helper\)\.hexdigest\(\)\)/u,
]) {
  assert.match(rotationV2PredecessorEvidence, predecessorRotationContract);
}
assert.doesNotMatch(
  rotationV2PredecessorEvidence,
  /print\(\s*(?:intent_data|completion_data|archived_helper)\s*\)|sys\.stdout\.write\(\s*(?:intent_data|completion_data|archived_helper)\s*\)/u,
  'the first-link parser may expose only digests and frozen non-secret Compose metadata',
);

const rotationV2BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
const compactRotationV2BoundaryMatcher = rotationV2BoundaryMatcher
  .replaceAll('\\\n', '')
  .replaceAll(/\s+/gu, ' ');
for (const predecessorBoundaryContract of [
  '"$COMPOSE5_DURABLE_VOLUME_DIGEST" == "$PREDECESSOR_ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST"',
  '"$COMPOSE5_PROFILE_CONFIG_HASH" == "$PREDECESSOR_ROTATION_COMPOSE5_PROFILE_CONFIG_HASH"',
  '"$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" == "$PREDECESSOR_ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH"',
  '"$COMPOSE5_VOLUME_VERSION" == "$PREDECESSOR_ROTATION_COMPOSE5_VOLUME_VERSION"',
]) {
  assert.ok(
    compactRotationV2BoundaryMatcher.includes(predecessorBoundaryContract),
    `the current durable boundary must preserve the first-link field: ${predecessorBoundaryContract}`,
  );
}

const rotationV2IntentStart = v3SuccessorHelperRotationV2.indexOf('expected_intent() {');
const rotationV2IntentEnd = v3SuccessorHelperRotationV2.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV2IntentStart,
);
assert.ok(
  rotationV2IntentStart >= 0 && rotationV2IntentEnd > rotationV2IntentStart,
  'the second rotation intent renderer must be extractable',
);
const rotationV2Intent = v3SuccessorHelperRotationV2.slice(
  rotationV2IntentStart,
  rotationV2IntentEnd + 2,
);
const rotationV2Completion = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'expected_completion',
  'classify_rotation',
);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal(
    (rotationV2Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length,
    1,
    `the second rotation intent must bind ${evidenceField} exactly once`,
  );
  assert.equal(
    (rotationV2Completion.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length,
    1,
    `the second rotation completion must bind ${evidenceField} exactly once`,
  );
}
assert.match(rotationV2Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u);
assert.match(rotationV2Completion, /rotation_intent_sha256=\$ROTATION_INTENT_SHA256/u);

const rotationV2Classifier = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'classify_rotation',
  'require_rotation_prefix',
);
for (const classifierContract of [
  /if not os\.path\.lexists\(parent\):[\s\S]*?print\('absent'\)/u,
  /entries == \[\]/u,
  /print\('empty-parent'\)/u,
  /entries == \[f'\{successor\}\.installing'\]/u,
  /print\('interrupted'\)/u,
  /entries == \[successor\]/u,
  /print\('completed'\)/u,
  /else:\s+raise SystemExit\(1\)/u,
]) {
  assert.match(rotationV2Classifier, classifierContract);
}
if (process.platform === 'linux') {
  const adaptRotationV2RootOwnership = (source) =>
    source
      .replaceAll('(0, 0, 0o700)', '(os.getuid(), os.getgid(), 0o700)')
      .replaceAll('(0, 0, mode, 1)', '(os.getuid(), os.getgid(), mode, 1)');
  const classifierPython = adaptRotationV2RootOwnership(
    extractSingleQuotedPythonHeredoc(rotationV2Classifier, 'classify_rotation'),
  );
  const classifierRoot = mkdtempSync(join(tmpdir(), 'fetanagent-v3-rotation-v2-classifier-'));
  const classifierParent = join(classifierRoot, 'rotation-v2');
  const classifierRelease = 'a'.repeat(40);
  const runClassifier = () =>
    spawnSync('/usr/bin/python3', ['-I', '-', classifierParent, classifierRelease], {
      encoding: 'utf8',
      input: classifierPython,
    });
  try {
    let result = runClassifier();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'absent');

    mkdirSync(classifierParent, { mode: 0o700 });
    chmodSync(classifierParent, 0o700);
    result = runClassifier();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'empty-parent');

    mkdirSync(join(classifierParent, `${classifierRelease}.installing`), { mode: 0o700 });
    result = runClassifier();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'interrupted');
    rmSync(join(classifierParent, `${classifierRelease}.installing`), { recursive: true });

    mkdirSync(join(classifierParent, classifierRelease), { mode: 0o700 });
    result = runClassifier();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'completed');
    mkdirSync(join(classifierParent, 'foreign'), { mode: 0o700 });
    result = runClassifier();
    assert.notEqual(result.status, 0, 'a foreign or second v2 rotation child must fail closed');
  } finally {
    rmSync(classifierRoot, { recursive: true, force: true });
  }

  const predecessorPython = adaptRotationV2RootOwnership(
    extractSingleQuotedPythonHeredoc(
      rotationV2PredecessorEvidence,
      'load_exact_predecessor_rotation_evidence',
    ),
  );
  const predecessorRoot = mkdtempSync(join(tmpdir(), 'fetanagent-v3-rotation-v2-predecessor-'));
  const predecessorParent = join(predecessorRoot, 'rotation-v1');
  const baseRelease = 'a'.repeat(40);
  const predecessorRelease = 'b'.repeat(40);
  const predecessorDirectory = join(predecessorParent, predecessorRelease);
  const archivedHelper = Buffer.from('#!/usr/bin/env bash\nexit 0\n', 'ascii');
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  const baseHelper = digest(archivedHelper);
  const predecessorHelper = 'c'.repeat(64);
  const baseIntent = 'd'.repeat(64);
  const baseCompletion = 'e'.repeat(64);
  const baseBindingV2 = 'f'.repeat(64);
  const baseOldHelper = '1'.repeat(64);
  const baseBindingV3 = '2'.repeat(64);
  const durableDigest = '3'.repeat(64);
  const profileHash = '4'.repeat(64);
  const sessionHash = '5'.repeat(64);
  const composeVersion = '5.2.1';
  const intentLines = [
    'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1',
    'state=authorized',
    `predecessor_release=${baseRelease}`,
    `successor_release=${predecessorRelease}`,
    `predecessor_helper_sha256=${baseHelper}`,
    `successor_helper_sha256=${predecessorHelper}`,
    `base_successor_intent_sha256=${baseIntent}`,
    `base_successor_completion_sha256=${baseCompletion}`,
    `base_binding_v2_sha256=${baseBindingV2}`,
    `base_predecessor_helper_sha256=${baseOldHelper}`,
    `base_binding_v3_sha256=${baseBindingV3}`,
    `compose5_durable_volume_digest=${durableDigest}`,
    `compose5_profile_config_hash=${profileHash}`,
    `compose5_session_control_config_hash=${sessionHash}`,
    `compose5_volume_version=${composeVersion}`,
  ];
  const intentBytes = Buffer.from(`${intentLines.join('\n')}\n`, 'ascii');
  const completionBytes = Buffer.from(
    `${[
      intentLines[0],
      'state=successor-installed',
      ...intentLines.slice(2),
      `rotation_intent_sha256=${digest(intentBytes)}`,
    ].join('\n')}\n`,
    'ascii',
  );
  const predecessorArgs = (expectedBaseIntent = baseIntent) => [
    predecessorParent,
    baseRelease,
    predecessorRelease,
    baseHelper,
    predecessorHelper,
    expectedBaseIntent,
    baseCompletion,
    baseBindingV2,
    baseOldHelper,
    baseBindingV3,
  ];
  const runPredecessor = (expectedBaseIntent = baseIntent) =>
    spawnSync('/usr/bin/python3', ['-I', '-', ...predecessorArgs(expectedBaseIntent)], {
      encoding: 'utf8',
      input: predecessorPython,
    });
  try {
    mkdirSync(predecessorParent, { mode: 0o700 });
    mkdirSync(predecessorDirectory, { mode: 0o700 });
    chmodSync(predecessorParent, 0o700);
    chmodSync(predecessorDirectory, 0o700);
    writeFileSync(join(predecessorDirectory, 'intent-v1'), intentBytes, { mode: 0o600 });
    writeFileSync(join(predecessorDirectory, 'completed-v1'), completionBytes, { mode: 0o600 });
    writeFileSync(join(predecessorDirectory, 'predecessor-helper'), archivedHelper, {
      mode: 0o400,
    });
    chmodSync(join(predecessorDirectory, 'intent-v1'), 0o600);
    chmodSync(join(predecessorDirectory, 'completed-v1'), 0o600);
    chmodSync(join(predecessorDirectory, 'predecessor-helper'), 0o400);

    let result = runPredecessor();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^(?:[0-9a-f]{64}\n){6}5\.2\.1\n$/u);

    result = runPredecessor('6'.repeat(64));
    assert.notEqual(result.status, 0, 'changed immutable base evidence must reject the first link');
    assert.equal(result.stdout, '', 'a rejected first link must expose no partial evidence');

    mkdirSync(join(predecessorParent, 'foreign'), { mode: 0o700 });
    result = runPredecessor();
    assert.notEqual(result.status, 0, 'an extra first-rotation child must fail closed');
    assert.equal(result.stdout, '', 'a foreign first-link topology must expose no evidence');
    rmSync(join(predecessorParent, 'foreign'), { recursive: true });

    chmodSync(join(predecessorDirectory, 'predecessor-helper'), 0o600);
    writeFileSync(join(predecessorDirectory, 'predecessor-helper'), 'changed');
    chmodSync(join(predecessorDirectory, 'predecessor-helper'), 0o400);
    result = runPredecessor();
    assert.notEqual(result.status, 0, 'changed archived first-link helper bytes must fail closed');
    assert.equal(result.stdout, '', 'changed archived helper bytes must expose no evidence');
  } finally {
    rmSync(predecessorRoot, { recursive: true, force: true });
  }
}
const rotationV2Prefix = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'require_rotation_prefix',
  'publish_record',
);
for (const prefixContract of [
  /\.intent-v1\.installing/u,
  /\.predecessor-helper\.installing/u,
  /\.completed-v1\.installing/u,
  /if any\(name not in allowed for name in entries\)/u,
  /if final in entries and f'\.\{final\}\.installing' in entries/u,
  /os\.path\.realpath\(root\) != root/u,
]) {
  assert.match(rotationV2Prefix, prefixContract);
}
const rotationV2Publisher = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'publish_record',
  'copy_root_file_atomically',
);
for (const publisherContract of [
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /predecessor_rotation_intent_sha256=/u,
  /predecessor_rotation_completion_sha256=/u,
  /predecessor_rotation_helper_archive_sha256=/u,
  /os\.O_WRONLY \| os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /os\.fsync\(descriptor\)/u,
  /os\.rename\(temporary, target, src_dir_fd=directory, dst_dir_fd=directory\)/u,
  /os\.fsync\(directory\)/u,
]) {
  assert.match(rotationV2Publisher, publisherContract);
}
const rotationV2HelperCopier = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'copy_root_file_atomically',
  'require_exact_rotation',
);
for (const copierContract of [
  /os\.O_RDONLY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /hashlib\.sha256\(data\)\.hexdigest\(\) != expected_digest/u,
  /bytes\(data\)\.startswith\(existing\)/u,
  /os\.O_WRONLY \| os\.O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /os\.rename\(temporary, target\)/u,
  /os\.fsync\(directory\)/u,
]) {
  assert.match(rotationV2HelperCopier, copierContract);
}
const rotationV2Exact = extractShellFunction(
  v3SuccessorHelperRotationV2,
  'require_exact_rotation',
  'restore_sudoers',
);
for (const exactRotationV2Contract of [
  /\$'completed-v1\\nintent-v1\\npredecessor-helper'/u,
  /load_rotation_intent_sha256/u,
  /cmp -s -- "\$root\/\$ROTATION_COMPLETION_NAME" <\(expected_completion\)/u,
  /require_helper_file "\$root\/\$HELPER_ARCHIVE_NAME" "\$PREDECESSOR_HELPER_SHA256" 400/u,
]) {
  assert.match(rotationV2Exact, exactRotationV2Contract);
}

const rotationV2MainStart = v3SuccessorHelperRotationV2.indexOf(
  'rotation_state="$(classify_rotation)"',
);
assert.ok(
  rotationV2MainStart >= 0,
  'the second one-use rotation main transaction must be extractable',
);
const rotationV2Main = v3SuccessorHelperRotationV2.slice(rotationV2MainStart);
assertInOrder(
  rotationV2Main,
  [
    'rotation_state="$(classify_rotation)"',
    'case "$rotation_state" in',
    'absent)',
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'empty-parent)',
    "die 'an empty rotation parent may resume only with the deployment grant disabled'",
    'interrupted)',
    "die 'an interrupted rotation must retain the disabled deployment grant'",
    'completed)',
    'require_no_helper_processes',
    'flock --exclusive --nonblock 9',
    '[[ "$(classify_rotation)" == "$rotation_state" ]]',
    'load_exact_base_successor_evidence',
    'load_exact_predecessor_rotation_evidence',
    'require_predecessor_rotation_global_residue_absent',
    'require_stopped_no_transfer_boundary',
    'require_current_boundary_matches_predecessor_rotation',
    'capture_rotation_durable_boundary',
    'trap cleanup EXIT',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    "sudoers_disabled='true'",
    'sync -f /etc/sudoers.d',
    'require_no_helper_processes',
    'load_exact_base_successor_evidence',
    'load_exact_predecessor_rotation_evidence',
    'require_predecessor_rotation_global_residue_absent',
    'require_preserved_rotation_durable_boundary',
    'require_current_boundary_matches_predecessor_rotation',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$TARGET"',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'mv -- "$INSTALLING_HELPER" "$TARGET"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'require_exact_rotation "$ROTATION_INSTALLING"',
    'mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"',
    "rotation_finalized='true'",
    'require_exact_rotation "$ROTATION_ROOT"',
    'require_preserved_rotation_durable_boundary',
    'flock --unlock 9',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'flock --exclusive --nonblock 9',
    'load_exact_base_successor_evidence',
    'load_exact_predecessor_rotation_evidence',
    'require_predecessor_rotation_global_residue_absent',
    'require_exact_rotation "$ROTATION_ROOT"',
    'require_preserved_rotation_durable_boundary',
    'require_current_boundary_matches_predecessor_rotation',
    'restore_sudoers',
    "sudoers_disabled='false'",
    'trap - EXIT',
  ],
  'the second rotation must re-attest both immutable predecessors, disable the grant, append one exact link, self-attest the new helper, and only then restore the grant',
);
assert.equal(
  (rotationV2Main.match(/restore_sudoers/g) ?? []).length,
  1,
  'the second rotation may restore the deployment grant exactly once after final self-attestation',
);
assert.doesNotMatch(
  rotationV2Main.slice(
    rotationV2Main.indexOf('mv -- "$SUDOERS" "$SUDOERS_DISABLED"'),
    rotationV2Main.indexOf('restore_sudoers'),
  ),
  /run_predecessor_helper|sudo -n/u,
  'the second disabled-grant transaction must never regain the predecessor sudo path',
);
assert.match(
  rotationV2Main,
  /if \[\[ "\$rotation_state" == 'completed' \]\]; then[\s\S]*?require_global_installer_residue_absent[\s\S]*?rotation_finalized='true'/u,
  'a completed second-link resume must reject installer residue before successor self-attestation',
);
assert.match(
  rotationV2Main,
  /run_successor_helper_direct kemerbet-v3-successor-ready[\s\S]*?flock --exclusive --nonblock 9[\s\S]*?require_predecessor_rotation_global_residue_absent[\s\S]*?require_global_installer_residue_absent[\s\S]*?restore_sudoers/u,
  'both link namespaces, helper bytes, and durable boundaries must be re-attested before grant restoration',
);
for (const rotationV2RunbookContract of [
  /One-use second installed-v3 helper\/release rotation/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v2\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v2-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2\/<successor-release>\//u,
  new RegExp(v3HelperRotationV2Confirmation, 'u'),
  /do not repin or rerun the first\s+rotation/u,
  /Never restore sudo manually, call the old helper directly, delete or rename either\s+rotation prefix/u,
  /installed first-link helper intentionally does not know the v2 namespace/u,
  /does not start a service, enable the executor, invoke a KemerBet lookup or\s+Transfer, or move money/u,
]) {
  assert.match(stagingRunbook, rotationV2RunbookContract);
}

const v3HelperRotationV3Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-THIRD-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV3Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly BASE_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v2-v3-successor'$/mu,
  /^readonly FIRST_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  /^readonly FIRST_ROTATION_SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-disabled'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v3-disabled'$/mu,
  /^readonly PREDECESSOR_SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v2-disabled'$/mu,
  /^readonly BASE_SUCCESSOR_RELEASE='de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3'$/mu,
  /^readonly BASE_SUCCESSOR_HELPER_SHA256='e94dfdcfe90ff6021446fc66e2850ae13198b03d9e2210f454181ab00177f97d'$/mu,
  /^readonly FIRST_ROTATION_RELEASE='8fe693b51b5426c3f358bba67519459161a0ebf9'$/mu,
  /^readonly FIRST_ROTATION_HELPER_SHA256='f98047953fb9249d7dbcd13be6cf1a145b53a4952a760b36d5ba8bfab2f36f82'$/mu,
  /^readonly PREDECESSOR_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'$/mu,
  /^readonly PREDECESSOR_HELPER_SHA256='05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe'$/mu,
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV3SuccessorSha}'$`,
    'mu',
  ),
  /\[\[ \$# -eq 3 \]\]/u,
  /"\$SUCCESSOR_RELEASE" != "\$FIRST_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$FIRST_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
  /\[\[ "\$\(id -u\)" == '0' && "\$\(id -un\)" == 'root' \]\]/u,
  /\[\[ -z "\$\{SUDO_USER:-\}" && -z "\$\{DOCKER_HOST:-\}" && -z "\$\{DOCKER_CONTEXT:-\}" \]\]/u,
]) {
  assert.match(v3SuccessorHelperRotationV3, fixedRotationV3Contract);
}
assert.equal(
  v3SuccessorHelperRotationV3.split(`readonly CONFIRMATION='${v3HelperRotationV3Confirmation}'`)
    .length - 1,
  1,
  'the third installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV3,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the third helper rotation must append evidence and atomically replace only the reviewed helper without destructive cleanup primitives',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV3,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the third helper rotation must never enable Transfer or a live money-moving executor',
);

const rotationV3PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV3,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV3Contract of [
  /"\$FIRST_ROTATION_PARENT" "\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$BASE_SUCCESSOR_RELEASE" "\$FIRST_ROTATION_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$BASE_SUCCESSOR_HELPER_SHA256" "\$FIRST_ROTATION_HELPER_SHA256"/u,
  /"\$PREDECESSOR_HELPER_SHA256" "\$BASE_SUCCESSOR_INTENT_SHA256"/u,
  /exact_directory\(first_parent, \[first_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /len\(first_intent\) != 15/u,
  /len\(first_completion\) != 16/u,
  /len\(intent\) != 18/u,
  /len\(completion\) != 19/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(first_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(first_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(first_archive\)\.hexdigest\(\)\}'/u,
  /intent\[14\] != first_intent\[11\]/u,
  /intent\[15\] != first_intent\[12\]/u,
  /intent\[16\] != first_intent\[13\]/u,
  /intent\[17\] != first_intent\[14\]/u,
  /hashlib\.sha256\(first_archive\)\.hexdigest\(\) != base_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != first_helper/u,
  /print\(hashlib\.sha256\(intent_data\)\.hexdigest\(\)\)/u,
  /print\(hashlib\.sha256\(completion_data\)\.hexdigest\(\)\)/u,
  /print\(hashlib\.sha256\(archived_helper\)\.hexdigest\(\)\)/u,
]) {
  assert.match(rotationV3PredecessorEvidence, predecessorRotationV3Contract);
}
assert.doesNotMatch(
  rotationV3PredecessorEvidence,
  /print\(\s*(?:first_intent_data|first_completion_data|first_archive|intent_data|completion_data|archived_helper)\s*\)|sys\.stdout\.write\(\s*(?:first_intent_data|first_completion_data|first_archive|intent_data|completion_data|archived_helper)\s*\)/u,
  'the two-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);

const rotationV3BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV3,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV3BoundaryMatcher,
  rotationV2BoundaryMatcher,
  'the third rotation must preserve the exact second-link durable-boundary matcher',
);
const rotationV3IntentStart = v3SuccessorHelperRotationV3.indexOf('expected_intent() {');
const rotationV3IntentEnd = v3SuccessorHelperRotationV3.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV3IntentStart,
);
assert.ok(
  rotationV3IntentStart >= 0 && rotationV3IntentEnd > rotationV3IntentStart,
  'the third rotation intent renderer must be extractable',
);
const rotationV3Intent = v3SuccessorHelperRotationV3.slice(
  rotationV3IntentStart,
  rotationV3IntentEnd + 2,
);
const rotationV3Completion = extractShellFunction(
  v3SuccessorHelperRotationV3,
  'expected_completion',
  'classify_rotation',
);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal(
    (rotationV3Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length,
    1,
    `the third rotation intent must bind ${evidenceField} exactly once`,
  );
  assert.equal(
    (rotationV3Completion.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length,
    1,
    `the third rotation completion must bind ${evidenceField} exactly once`,
  );
}
assert.match(rotationV3Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u);
assert.match(rotationV3Completion, /rotation_intent_sha256=\$ROTATION_INTENT_SHA256/u);

const rotationV3Classifier = extractShellFunction(
  v3SuccessorHelperRotationV3,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(
  rotationV3Classifier,
  rotationV2Classifier,
  'the already exercised absent, empty, interrupted, completed, and foreign classifier must remain byte-identical for the third namespace',
);
const rotationV3Prefix = extractShellFunction(
  v3SuccessorHelperRotationV3,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(
  rotationV3Prefix,
  rotationV2Prefix,
  'the already exercised append-only prefix validator must remain byte-identical for the third namespace',
);
const rotationV3Exact = extractShellFunction(
  v3SuccessorHelperRotationV3,
  'require_exact_rotation',
  'restore_sudoers',
);
for (const exactRotationV3Contract of [
  /\$'completed-v1\\nintent-v1\\npredecessor-helper'/u,
  /load_rotation_intent_sha256/u,
  /cmp -s -- "\$root\/\$ROTATION_COMPLETION_NAME" <\(expected_completion\)/u,
  /require_helper_file "\$root\/\$HELPER_ARCHIVE_NAME" "\$PREDECESSOR_HELPER_SHA256" 400/u,
]) {
  assert.match(rotationV3Exact, exactRotationV3Contract);
}

const rotationV3CleanupStart = v3SuccessorHelperRotationV3.indexOf('cleanup() {');
const rotationV3CleanupEnd = v3SuccessorHelperRotationV3.indexOf(
  '\n}\n\n[[ "$(curl',
  rotationV3CleanupStart,
);
assert.ok(
  rotationV3CleanupStart >= 0 && rotationV3CleanupEnd > rotationV3CleanupStart,
  'the third rotation fail-closed cleanup must be extractable',
);
const rotationV3Cleanup = v3SuccessorHelperRotationV3.slice(
  rotationV3CleanupStart,
  rotationV3CleanupEnd + 2,
);
assert.match(rotationV3Cleanup, /rollback_precompletion_helper \|\| status=1/u);
assert.match(rotationV3Cleanup, /do not restore the grant manually/u);
assert.doesNotMatch(
  rotationV3Cleanup,
  /restore_sudoers|mv -- "\$SUDOERS_DISABLED" "\$SUDOERS"/u,
  'third-link cleanup must never reactivate the deployment grant',
);
const rotationV3PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV3,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const residuePath of [
  '$FIRST_ROTATION_SUDOERS_DISABLED',
  '$FIRST_ROTATION_INSTALLING_HELPER',
  '$FIRST_ROTATION_INSTALLING_HELPER_PARTIAL',
  '$FIRST_ROTATION_ROLLBACK_HELPER',
  '$FIRST_ROTATION_ROLLBACK_HELPER_PARTIAL',
  '$PREDECESSOR_SUDOERS_DISABLED',
  '$PREDECESSOR_INSTALLING_HELPER',
  '$PREDECESSOR_INSTALLING_HELPER_PARTIAL',
  '$PREDECESSOR_ROLLBACK_HELPER',
  '$PREDECESSOR_ROLLBACK_HELPER_PARTIAL',
]) {
  assert.ok(
    rotationV3PredecessorResidue.includes(residuePath),
    `the third rotation must reject consumed predecessor residue: ${residuePath}`,
  );
}

const rotationV3MainStart = v3SuccessorHelperRotationV3.indexOf(
  'rotation_state="$(classify_rotation)"',
);
assert.ok(
  rotationV3MainStart >= 0,
  'the third one-use rotation main transaction must be extractable',
);
const rotationV3Main = v3SuccessorHelperRotationV3.slice(rotationV3MainStart);
assertInOrder(
  rotationV3Main,
  [
    'rotation_state="$(classify_rotation)"',
    'case "$rotation_state" in',
    'absent)',
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'empty-parent)',
    "die 'an empty rotation parent may resume only with the deployment grant disabled'",
    'interrupted)',
    "die 'an interrupted rotation must retain the disabled deployment grant'",
    'completed)',
    'flock --exclusive --nonblock 9',
    'load_exact_base_successor_evidence',
    'load_exact_predecessor_rotation_evidence',
    'require_stopped_no_transfer_boundary',
    'capture_rotation_durable_boundary',
    'trap cleanup EXIT',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    "sudoers_disabled='true'",
    'sync -f /etc/sudoers.d',
    'require_no_helper_processes',
    'load_exact_predecessor_rotation_evidence',
    'require_preserved_rotation_durable_boundary',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$TARGET"',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'mv -- "$INSTALLING_HELPER" "$TARGET"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'require_exact_rotation "$ROTATION_INSTALLING"',
    'mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"',
    "rotation_finalized='true'",
    'require_exact_rotation "$ROTATION_ROOT"',
    'flock --unlock 9',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'flock --exclusive --nonblock 9',
    'load_exact_predecessor_rotation_evidence',
    'require_exact_rotation "$ROTATION_ROOT"',
    'require_current_boundary_matches_predecessor_rotation',
    'restore_sudoers',
    "sudoers_disabled='false'",
    'trap - EXIT',
  ],
  'the third rotation must re-attest the immutable base and both prior links, disable the grant, append one exact link, self-attest the new helper, and only then restore the grant',
);
assert.equal(
  (rotationV3Main.match(/restore_sudoers/g) ?? []).length,
  1,
  'the third rotation may restore the deployment grant exactly once after final self-attestation',
);
assert.doesNotMatch(
  rotationV3Main.slice(
    rotationV3Main.indexOf('mv -- "$SUDOERS" "$SUDOERS_DISABLED"'),
    rotationV3Main.indexOf('restore_sudoers'),
  ),
  /run_predecessor_helper|sudo -n/u,
  'the third disabled-grant transaction must never regain the predecessor sudo path',
);
assert.match(
  rotationV3Main,
  /if \[\[ "\$rotation_state" == 'completed' \]\]; then[\s\S]*?require_global_installer_residue_absent[\s\S]*?rotation_finalized='true'/u,
  'a completed third-link resume must reject installer residue before successor self-attestation',
);
for (const rotationV3RunbookContract of [
  /One-use third installed-v3 helper\/release rotation/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v3\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v3-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3\/<successor-release>\//u,
  new RegExp(v3HelperRotationV3Confirmation, 'u'),
  /do not repin or rerun either consumed predecessor rotation/u,
  /Never restore sudo manually, call the predecessor helper directly, delete or rename any rotation prefix/u,
  /installed second-link helper intentionally does not know the v3 namespace/u,
  /does not start a service, enable the executor, invoke a KemerBet lookup or Transfer, or move money/u,
]) {
  assert.match(stagingRunbook, rotationV3RunbookContract);
}

const v3HelperRotationV4Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-FOURTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV4Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly FIRST_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly SECOND_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v4-disabled'$/mu,
  /^readonly SECOND_ROTATION_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'$/mu,
  /^readonly SECOND_ROTATION_HELPER_SHA256='05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe'$/mu,
  /^readonly PREDECESSOR_RELEASE='9c83821b4959f5ac52b0d642e476063ca7f3590e'$/mu,
  /^readonly PREDECESSOR_HELPER_SHA256='020b2b2d7eca153dffd72d7811d58c1a93e41edc24d1217cb459f5828e549b7b'$/mu,
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV4SuccessorSha}'$`,
    'mu',
  ),
  /"\$SUCCESSOR_RELEASE" != "\$SECOND_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$SECOND_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
]) {
  assert.match(v3SuccessorHelperRotationV4, fixedRotationV4Contract);
}
assert.equal(
  v3SuccessorHelperRotationV4.split(`readonly CONFIRMATION='${v3HelperRotationV4Confirmation}'`)
    .length - 1,
  1,
  'the fourth installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV4,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the fourth helper rotation must remain append-only and use no destructive cleanup primitive',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV4,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the fourth helper rotation must never issue a lookup, enable Transfer, or enable money movement',
);

const rotationV4PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV4,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV4Contract of [
  /"\$FIRST_ROTATION_PARENT" "\$SECOND_ROTATION_PARENT" "\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$SECOND_ROTATION_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$SECOND_ROTATION_HELPER_SHA256" "\$PREDECESSOR_HELPER_SHA256"/u,
  /exact_directory\(first_parent, \[first_release\]\)/u,
  /exact_directory\(second_parent, \[second_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u,
  /hashlib\.sha256\(first_archive\)\.hexdigest\(\) != base_helper/u,
  /hashlib\.sha256\(second_archive\)\.hexdigest\(\) != first_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != second_helper/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(second_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(second_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(second_archive\)\.hexdigest\(\)\}'/u,
]) {
  assert.match(rotationV4PredecessorEvidence, predecessorRotationV4Contract);
}
assert.doesNotMatch(
  rotationV4PredecessorEvidence,
  /print\(\s*(?:first|second)?_?(?:intent_data|completion_data|archive|archived_helper)\s*\)/u,
  'the three-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);
const rotationV4BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV4,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV4BoundaryMatcher,
  rotationV3BoundaryMatcher,
  'the fourth rotation must preserve the exact third-link durable-boundary matcher',
);
const rotationV4Classifier = extractShellFunction(
  v3SuccessorHelperRotationV4,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(rotationV4Classifier, rotationV3Classifier);
const rotationV4Prefix = extractShellFunction(
  v3SuccessorHelperRotationV4,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(rotationV4Prefix, rotationV3Prefix);
const rotationV4IntentStart = v3SuccessorHelperRotationV4.indexOf('expected_intent() {');
const rotationV4IntentEnd = v3SuccessorHelperRotationV4.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV4IntentStart,
);
assert.ok(rotationV4IntentStart >= 0 && rotationV4IntentEnd > rotationV4IntentStart);
const rotationV4Intent = v3SuccessorHelperRotationV4.slice(
  rotationV4IntentStart,
  rotationV4IntentEnd + 2,
);
assert.match(rotationV4Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4/u);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal((rotationV4Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length, 1);
}
const rotationV4PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV4,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const generation of ['FIRST_ROTATION', 'SECOND_ROTATION', 'PREDECESSOR']) {
  for (const suffix of [
    'SUDOERS_DISABLED',
    'INSTALLING_HELPER',
    'INSTALLING_HELPER_PARTIAL',
    'ROLLBACK_HELPER',
    'ROLLBACK_HELPER_PARTIAL',
  ]) {
    assert.ok(rotationV4PredecessorResidue.includes(`$${generation}_${suffix}`));
  }
}
const rotationV4Main = v3SuccessorHelperRotationV4.slice(
  v3SuccessorHelperRotationV4.indexOf('rotation_state="$(classify_rotation)"'),
);
assertInOrder(
  rotationV4Main,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'require_stopped_no_transfer_boundary',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'restore_sudoers',
  ],
  'the fourth rotation must stop before mutation, append one link, self-attest, and restore sudo once',
);
assert.equal((rotationV4Main.match(/restore_sudoers/g) ?? []).length, 1);
for (const rotationV4RunbookContract of [
  /One-use fourth installed-v3 helper\/release rotation/u,
  /Docker 28 reports inspected capability names with the canonical `CAP_` prefix/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v4\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v4-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4\/<successor-release>\//u,
  new RegExp(v3HelperRotationV4Confirmation, 'u'),
  /validates the immutable base and exact first, second, and third links in order/u,
  /invokes its\s+guarded stop, and proves the stopped boundary/u,
  /existing completed root-certified candidate recovery and the current retryable exact-five\s+recheck failure\/source\/stage evidence are outside this namespace and must remain unchanged/u,
  /leaves the runtime stopped,[\s\S]*?Transfer and the executor disabled,[\s\S]*?makes no KemerBet request/u,
  /Current Docker 28 repair order: rotate, deploy, publish, then recheck/u,
  /Only then retry the same exact-five FIND-only no-transfer recheck/u,
]) {
  assert.match(stagingRunbook, rotationV4RunbookContract);
}

const v3HelperRotationV5Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-FIFTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV5Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly FIRST_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly SECOND_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly THIRD_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v5'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v5-disabled'$/mu,
  /^readonly FIRST_ROTATION_RELEASE='8fe693b51b5426c3f358bba67519459161a0ebf9'$/mu,
  new RegExp(`^readonly FIRST_ROTATION_HELPER_SHA256='${reviewedV3HelperSuccessorSha}'$`, 'mu'),
  /^readonly SECOND_ROTATION_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'$/mu,
  new RegExp(
    `^readonly SECOND_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV2SuccessorSha}'$`,
    'mu',
  ),
  /^readonly THIRD_ROTATION_RELEASE='9c83821b4959f5ac52b0d642e476063ca7f3590e'$/mu,
  new RegExp(
    `^readonly THIRD_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV3SuccessorSha}'$`,
    'mu',
  ),
  /^readonly PREDECESSOR_RELEASE='874b8380a7e9f90806ebb1ad5c2958c1b245977f'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV4SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV5SuccessorSha}'$`,
    'mu',
  ),
  /"\$SUCCESSOR_RELEASE" != "\$THIRD_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$PREDECESSOR_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$THIRD_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
]) {
  assert.match(v3SuccessorHelperRotationV5, fixedRotationV5Contract);
}
assert.equal(
  v3SuccessorHelperRotationV5.split(`readonly CONFIRMATION='${v3HelperRotationV5Confirmation}'`)
    .length - 1,
  1,
  'the fifth installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV5,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the fifth helper rotation must remain append-only and use no destructive cleanup primitive',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV5,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the fifth helper rotation must never issue a lookup, enable Transfer, or enable money movement',
);

const rotationV5PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV5,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV5Contract of [
  /"\$FIRST_ROTATION_PARENT" "\$SECOND_ROTATION_PARENT" "\$THIRD_ROTATION_PARENT"/u,
  /"\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$SECOND_ROTATION_RELEASE" "\$THIRD_ROTATION_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$SECOND_ROTATION_HELPER_SHA256" "\$THIRD_ROTATION_HELPER_SHA256"/u,
  /"\$PREDECESSOR_HELPER_SHA256"/u,
  /len\(\{base_release, first_release, second_release, third_release, predecessor_release\}\) != 5/u,
  /len\(\{base_helper, first_helper, second_helper, third_helper, predecessor_helper\}\) != 5/u,
  /exact_directory\(first_parent, \[first_release\]\)/u,
  /exact_directory\(second_parent, \[second_release\]\)/u,
  /exact_directory\(third_parent, \[third_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4/u,
  /hashlib\.sha256\(first_archive\)\.hexdigest\(\) != base_helper/u,
  /hashlib\.sha256\(second_archive\)\.hexdigest\(\) != first_helper/u,
  /hashlib\.sha256\(third_archive\)\.hexdigest\(\) != second_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != third_helper/u,
  /third_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(second_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(third_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(third_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(third_archive\)\.hexdigest\(\)\}'/u,
]) {
  assert.match(rotationV5PredecessorEvidence, predecessorRotationV5Contract);
}
assert.doesNotMatch(
  rotationV5PredecessorEvidence,
  /print\(\s*(?:first|second|third)?_?(?:intent_data|completion_data|archive|archived_helper)\s*\)/u,
  'the four-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);
const rotationV5BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV5,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV5BoundaryMatcher,
  rotationV4BoundaryMatcher,
  'the fifth rotation must preserve the exact fourth-link durable-boundary matcher',
);
const rotationV5Classifier = extractShellFunction(
  v3SuccessorHelperRotationV5,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(rotationV5Classifier, rotationV4Classifier);
const rotationV5Prefix = extractShellFunction(
  v3SuccessorHelperRotationV5,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(rotationV5Prefix, rotationV4Prefix);
const rotationV5IntentStart = v3SuccessorHelperRotationV5.indexOf('expected_intent() {');
const rotationV5IntentEnd = v3SuccessorHelperRotationV5.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV5IntentStart,
);
assert.ok(rotationV5IntentStart >= 0 && rotationV5IntentEnd > rotationV5IntentStart);
const rotationV5Intent = v3SuccessorHelperRotationV5.slice(
  rotationV5IntentStart,
  rotationV5IntentEnd + 2,
);
assert.match(rotationV5Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5/u);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal((rotationV5Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length, 1);
}
const rotationV5PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV5,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const generation of ['FIRST_ROTATION', 'SECOND_ROTATION', 'THIRD_ROTATION', 'PREDECESSOR']) {
  for (const suffix of [
    'SUDOERS_DISABLED',
    'INSTALLING_HELPER',
    'INSTALLING_HELPER_PARTIAL',
    'ROLLBACK_HELPER',
    'ROLLBACK_HELPER_PARTIAL',
  ]) {
    assert.ok(rotationV5PredecessorResidue.includes(`$${generation}_${suffix}`));
  }
}
const rotationV5Main = v3SuccessorHelperRotationV5.slice(
  v3SuccessorHelperRotationV5.indexOf('rotation_state="$(classify_rotation)"'),
);
assertInOrder(
  rotationV5Main,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'require_stopped_no_transfer_boundary',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'restore_sudoers',
  ],
  'the fifth rotation must stop before mutation, append one link, self-attest, and restore sudo once',
);
assert.equal((rotationV5Main.match(/restore_sudoers/g) ?? []).length, 1);
for (const rotationV5RunbookContract of [
  /One-use fifth installed-v3 helper\/release rotation/u,
  /Docker Engine 29 renders an unset typed `netip\.Prefix` as the literal `invalid Prefix`/u,
  /reads one bounded `\{\{json \.IPAM\.Config\}\}` value/u,
  /every nonempty value, including the Go-template `invalid Prefix`\s+sentinel, fails closed/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v5\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v5-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v5\/<successor-release>\//u,
  new RegExp(v3HelperRotationV5Confirmation, 'u'),
  /hard-pins the completed v4 release and helper as its\s+direct predecessor/u,
  /validates the immutable base plus the exact first, second, third, and fourth links in order/u,
  /existing completed root-certified candidate recovery and retryable exact-five recheck\s+failure\/source\/stage evidence are outside v5 and must remain byte-for-byte unchanged/u,
  /Do not perform broad cleanup/u,
  /leaves the runtime stopped,[\s\S]*?Transfer and the executor disabled,[\s\S]*?makes no KemerBet request/u,
  /Historical Docker 29 IPAM repair order: rotate, deploy, publish, then recheck/u,
  /Only then retry the same exact-five FIND-only no-transfer recheck/u,
]) {
  assert.match(stagingRunbook, rotationV5RunbookContract);
}

const v3HelperRotationV6Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-SIXTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV6Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly FIRST_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly SECOND_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly THIRD_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  /^readonly FOURTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v5'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v6'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v6-disabled'$/mu,
  /^readonly FIRST_ROTATION_RELEASE='8fe693b51b5426c3f358bba67519459161a0ebf9'$/mu,
  new RegExp(`^readonly FIRST_ROTATION_HELPER_SHA256='${reviewedV3HelperSuccessorSha}'$`, 'mu'),
  /^readonly SECOND_ROTATION_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'$/mu,
  new RegExp(
    `^readonly SECOND_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV2SuccessorSha}'$`,
    'mu',
  ),
  /^readonly THIRD_ROTATION_RELEASE='9c83821b4959f5ac52b0d642e476063ca7f3590e'$/mu,
  new RegExp(
    `^readonly THIRD_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV3SuccessorSha}'$`,
    'mu',
  ),
  /^readonly FOURTH_ROTATION_RELEASE='874b8380a7e9f90806ebb1ad5c2958c1b245977f'$/mu,
  new RegExp(
    `^readonly FOURTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV4SuccessorSha}'$`,
    'mu',
  ),
  /^readonly PREDECESSOR_RELEASE='882c29910a820d0fc4c934e2584ae157fe99309e'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV5SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV6SuccessorSha}'$`,
    'mu',
  ),
  /"\$SUCCESSOR_RELEASE" != "\$FOURTH_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$PREDECESSOR_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$FOURTH_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
]) {
  assert.match(v3SuccessorHelperRotationV6, fixedRotationV6Contract);
}
assert.equal(
  v3SuccessorHelperRotationV6.split(`readonly CONFIRMATION='${v3HelperRotationV6Confirmation}'`)
    .length - 1,
  1,
  'the sixth installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV6,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the sixth helper rotation must remain append-only and use no destructive cleanup primitive',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV6,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the sixth helper rotation must never issue a lookup, enable Transfer, or enable money movement',
);

const rotationV6PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV6,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV6Contract of [
  /"\$FIRST_ROTATION_PARENT" "\$SECOND_ROTATION_PARENT" "\$THIRD_ROTATION_PARENT"/u,
  /"\$FOURTH_ROTATION_PARENT" "\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$SECOND_ROTATION_RELEASE" "\$THIRD_ROTATION_RELEASE"/u,
  /"\$FOURTH_ROTATION_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$SECOND_ROTATION_HELPER_SHA256" "\$THIRD_ROTATION_HELPER_SHA256"/u,
  /"\$FOURTH_ROTATION_HELPER_SHA256" "\$PREDECESSOR_HELPER_SHA256"/u,
  /len\(\{base_release, first_release, second_release, third_release, fourth_release,\s+predecessor_release\}\) != 6/u,
  /len\(\{base_helper, first_helper, second_helper, third_helper, fourth_helper,\s+predecessor_helper\}\) != 6/u,
  /exact_directory\(first_parent, \[first_release\]\)/u,
  /exact_directory\(second_parent, \[second_release\]\)/u,
  /exact_directory\(third_parent, \[third_release\]\)/u,
  /exact_directory\(fourth_parent, \[fourth_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5/u,
  /hashlib\.sha256\(first_archive\)\.hexdigest\(\) != base_helper/u,
  /hashlib\.sha256\(second_archive\)\.hexdigest\(\) != first_helper/u,
  /hashlib\.sha256\(third_archive\)\.hexdigest\(\) != second_helper/u,
  /hashlib\.sha256\(fourth_archive\)\.hexdigest\(\) != third_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != fourth_helper/u,
  /fourth_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(third_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(fourth_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(fourth_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(fourth_archive\)\.hexdigest\(\)\}'/u,
]) {
  assert.match(rotationV6PredecessorEvidence, predecessorRotationV6Contract);
}
assert.doesNotMatch(
  rotationV6PredecessorEvidence,
  /print\(\s*(?:first|second|third|fourth)?_?(?:intent_data|completion_data|archive|archived_helper)\s*\)/u,
  'the five-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);
const rotationV6BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV6,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV6BoundaryMatcher,
  rotationV5BoundaryMatcher,
  'the sixth rotation must preserve the exact fifth-link durable-boundary matcher',
);
const rotationV6Classifier = extractShellFunction(
  v3SuccessorHelperRotationV6,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(rotationV6Classifier, rotationV5Classifier);
const rotationV6Prefix = extractShellFunction(
  v3SuccessorHelperRotationV6,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(rotationV6Prefix, rotationV5Prefix);
const rotationV6IntentStart = v3SuccessorHelperRotationV6.indexOf('expected_intent() {');
const rotationV6IntentEnd = v3SuccessorHelperRotationV6.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV6IntentStart,
);
assert.ok(rotationV6IntentStart >= 0 && rotationV6IntentEnd > rotationV6IntentStart);
const rotationV6Intent = v3SuccessorHelperRotationV6.slice(
  rotationV6IntentStart,
  rotationV6IntentEnd + 2,
);
assert.match(rotationV6Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v6/u);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal((rotationV6Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length, 1);
}
const rotationV6PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV6,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const generation of [
  'FIRST_ROTATION',
  'SECOND_ROTATION',
  'THIRD_ROTATION',
  'FOURTH_ROTATION',
  'PREDECESSOR',
]) {
  for (const suffix of [
    'SUDOERS_DISABLED',
    'INSTALLING_HELPER',
    'INSTALLING_HELPER_PARTIAL',
    'ROLLBACK_HELPER',
    'ROLLBACK_HELPER_PARTIAL',
  ]) {
    assert.ok(rotationV6PredecessorResidue.includes(`$${generation}_${suffix}`));
  }
}
const rotationV6Main = v3SuccessorHelperRotationV6.slice(
  v3SuccessorHelperRotationV6.indexOf('rotation_state="$(classify_rotation)"'),
);
assertInOrder(
  rotationV6Main,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'require_stopped_no_transfer_boundary',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'restore_sudoers',
  ],
  'the sixth rotation must stop before mutation, append one link, self-attest, and restore sudo once',
);
assert.equal((rotationV6Main.match(/restore_sudoers/g) ?? []).length, 1);
for (const rotationV6RunbookContract of [
  /One-use sixth installed-v3 helper\/release rotation/u,
  /logical service-network key/u,
  /proxy's egress\s+network is its only accepted primary `HostConfig\.NetworkMode`/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v6\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v6-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v6\/<successor-release>\//u,
  new RegExp(v3HelperRotationV6Confirmation, 'u'),
  /hard-pins the completed v5 release and helper as its\s+direct predecessor/u,
  /validates the immutable base plus the exact first, second, third, fourth, and fifth links in\s+order/u,
  /retryable exact-five recheck\s+failure\/source\/stage evidence[^.]*must remain byte-for-byte unchanged/u,
  /Do not perform broad cleanup/u,
  /leaves the runtime stopped,[\s\S]*?Transfer and the executor disabled,[\s\S]*?makes no KemerBet request/u,
  /Current Docker 29 proxy-contract repair order: rotate, deploy, publish, then recheck/u,
  /Only then retry the same exact-five FIND-only no-transfer recheck/u,
]) {
  assert.match(stagingRunbook, rotationV6RunbookContract);
}

const v3HelperRotationV7Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-SEVENTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV7Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly FIRST_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly SECOND_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly THIRD_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  /^readonly FOURTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4'$/mu,
  /^readonly FIFTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v5'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v6'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v7'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v7-disabled'$/mu,
  /^readonly FIRST_ROTATION_RELEASE='8fe693b51b5426c3f358bba67519459161a0ebf9'$/mu,
  new RegExp(`^readonly FIRST_ROTATION_HELPER_SHA256='${reviewedV3HelperSuccessorSha}'$`, 'mu'),
  /^readonly SECOND_ROTATION_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'$/mu,
  new RegExp(
    `^readonly SECOND_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV2SuccessorSha}'$`,
    'mu',
  ),
  /^readonly THIRD_ROTATION_RELEASE='9c83821b4959f5ac52b0d642e476063ca7f3590e'$/mu,
  new RegExp(
    `^readonly THIRD_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV3SuccessorSha}'$`,
    'mu',
  ),
  /^readonly FOURTH_ROTATION_RELEASE='874b8380a7e9f90806ebb1ad5c2958c1b245977f'$/mu,
  new RegExp(
    `^readonly FOURTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV4SuccessorSha}'$`,
    'mu',
  ),
  /^readonly FIFTH_ROTATION_RELEASE='882c29910a820d0fc4c934e2584ae157fe99309e'$/mu,
  new RegExp(
    `^readonly FIFTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV5SuccessorSha}'$`,
    'mu',
  ),
  /^readonly PREDECESSOR_RELEASE='1f7239c4116be509e9ca38c7343969d1773af692'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV6SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV7SuccessorSha}'$`,
    'mu',
  ),
  /"\$SUCCESSOR_RELEASE" != "\$FIFTH_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$PREDECESSOR_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$FIFTH_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
]) {
  assert.match(v3SuccessorHelperRotationV7, fixedRotationV7Contract);
}
assert.equal(
  v3SuccessorHelperRotationV7.split(`readonly CONFIRMATION='${v3HelperRotationV7Confirmation}'`)
    .length - 1,
  1,
  'the seventh installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV7,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the seventh helper rotation must remain append-only and use no destructive cleanup primitive',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV7,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the seventh helper rotation must never issue a lookup, enable Transfer, or enable money movement',
);

const rotationV7PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV7,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV7Contract of [
  /"\$FIRST_ROTATION_PARENT" "\$SECOND_ROTATION_PARENT" "\$THIRD_ROTATION_PARENT"/u,
  /"\$FOURTH_ROTATION_PARENT" "\$FIFTH_ROTATION_PARENT" "\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$FOURTH_ROTATION_RELEASE" "\$FIFTH_ROTATION_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$FOURTH_ROTATION_HELPER_SHA256" "\$FIFTH_ROTATION_HELPER_SHA256"/u,
  /"\$PREDECESSOR_HELPER_SHA256"/u,
  /len\(\{base_release, first_release, second_release, third_release, fourth_release,\s+fifth_release, predecessor_release\}\) != 7/u,
  /len\(\{base_helper, first_helper, second_helper, third_helper, fourth_helper,\s+fifth_helper, predecessor_helper\}\) != 7/u,
  /exact_directory\(first_parent, \[first_release\]\)/u,
  /exact_directory\(second_parent, \[second_release\]\)/u,
  /exact_directory\(third_parent, \[third_release\]\)/u,
  /exact_directory\(fourth_parent, \[fourth_release\]\)/u,
  /exact_directory\(fifth_parent, \[fifth_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v6/u,
  /hashlib\.sha256\(first_archive\)\.hexdigest\(\) != base_helper/u,
  /hashlib\.sha256\(second_archive\)\.hexdigest\(\) != first_helper/u,
  /hashlib\.sha256\(third_archive\)\.hexdigest\(\) != second_helper/u,
  /hashlib\.sha256\(fourth_archive\)\.hexdigest\(\) != third_helper/u,
  /hashlib\.sha256\(fifth_archive\)\.hexdigest\(\) != fourth_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != fifth_helper/u,
  /fifth_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(fourth_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(fifth_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(fifth_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(fifth_archive\)\.hexdigest\(\)\}'/u,
]) {
  assert.match(rotationV7PredecessorEvidence, predecessorRotationV7Contract);
}
assert.doesNotMatch(
  rotationV7PredecessorEvidence,
  /print\(\s*(?:first|second|third|fourth|fifth)?_?(?:intent_data|completion_data|archive|archived_helper)\s*\)/u,
  'the six-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);
const rotationV7BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV7,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV7BoundaryMatcher,
  rotationV6BoundaryMatcher,
  'the seventh rotation must preserve the exact sixth-link durable-boundary matcher',
);
const rotationV7Classifier = extractShellFunction(
  v3SuccessorHelperRotationV7,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(rotationV7Classifier, rotationV6Classifier);
const rotationV7Prefix = extractShellFunction(
  v3SuccessorHelperRotationV7,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(rotationV7Prefix, rotationV6Prefix);
const rotationV7IntentStart = v3SuccessorHelperRotationV7.indexOf('expected_intent() {');
const rotationV7IntentEnd = v3SuccessorHelperRotationV7.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV7IntentStart,
);
assert.ok(rotationV7IntentStart >= 0 && rotationV7IntentEnd > rotationV7IntentStart);
const rotationV7Intent = v3SuccessorHelperRotationV7.slice(
  rotationV7IntentStart,
  rotationV7IntentEnd + 2,
);
assert.match(rotationV7Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v7/u);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal((rotationV7Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length, 1);
}
const rotationV7PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV7,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const generation of [
  'FIRST_ROTATION',
  'SECOND_ROTATION',
  'THIRD_ROTATION',
  'FOURTH_ROTATION',
  'FIFTH_ROTATION',
  'PREDECESSOR',
]) {
  for (const suffix of [
    'SUDOERS_DISABLED',
    'INSTALLING_HELPER',
    'INSTALLING_HELPER_PARTIAL',
    'ROLLBACK_HELPER',
    'ROLLBACK_HELPER_PARTIAL',
  ]) {
    assert.ok(rotationV7PredecessorResidue.includes(`$${generation}_${suffix}`));
  }
}
const rotationV7Main = v3SuccessorHelperRotationV7.slice(
  v3SuccessorHelperRotationV7.indexOf('rotation_state="$(classify_rotation)"'),
);
assertInOrder(
  rotationV7Main,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'require_stopped_no_transfer_boundary',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'restore_sudoers',
  ],
  'the seventh rotation must stop before mutation, append one link, self-attest, and restore sudo once',
);
assert.equal((rotationV7Main.match(/restore_sudoers/g) ?? []).length, 1);
for (const rotationV7RunbookContract of [
  /One-use seventh installed-v3 helper\/release rotation/u,
  /`iptables-save` canonicalization/u,
  /explicit `icmp-port-unreachable` and\s+`icmp6-port-unreachable` reject forms/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v7\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v7-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v7\/<successor-release>\//u,
  new RegExp(v3HelperRotationV7Confirmation, 'u'),
  /hard-pins the completed v6 release and helper as its\s+direct predecessor/u,
  /validates\s+the immutable base plus the exact first, second, third, fourth, fifth, and sixth links in order/u,
  /retryable exact-five recheck\s+failure\/source\/stage evidence[^.]*must remain byte-for-byte unchanged/u,
  /Do not perform broad cleanup/u,
  /leaves the runtime stopped,[\s\S]*?Transfer and the executor disabled,[\s\S]*?makes no KemerBet request/u,
  /Current Docker 29 firewall-canonicalization repair order: rotate, deploy, publish, then recheck/u,
  /Only then retry the same exact-five FIND-only no-transfer recheck/u,
]) {
  assert.match(stagingRunbook, rotationV7RunbookContract);
}

const v3HelperRotationV8Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-EIGHTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV8Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly FIRST_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly SECOND_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly THIRD_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  /^readonly FOURTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4'$/mu,
  /^readonly FIFTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v5'$/mu,
  /^readonly SIXTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v6'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v7'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v8'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v8-disabled'$/mu,
  /^readonly FIRST_ROTATION_RELEASE='8fe693b51b5426c3f358bba67519459161a0ebf9'$/mu,
  new RegExp(`^readonly FIRST_ROTATION_HELPER_SHA256='${reviewedV3HelperSuccessorSha}'$`, 'mu'),
  /^readonly SECOND_ROTATION_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'$/mu,
  new RegExp(
    `^readonly SECOND_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV2SuccessorSha}'$`,
    'mu',
  ),
  /^readonly THIRD_ROTATION_RELEASE='9c83821b4959f5ac52b0d642e476063ca7f3590e'$/mu,
  new RegExp(
    `^readonly THIRD_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV3SuccessorSha}'$`,
    'mu',
  ),
  /^readonly FOURTH_ROTATION_RELEASE='874b8380a7e9f90806ebb1ad5c2958c1b245977f'$/mu,
  new RegExp(
    `^readonly FOURTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV4SuccessorSha}'$`,
    'mu',
  ),
  /^readonly FIFTH_ROTATION_RELEASE='882c29910a820d0fc4c934e2584ae157fe99309e'$/mu,
  new RegExp(
    `^readonly FIFTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV5SuccessorSha}'$`,
    'mu',
  ),
  /^readonly SIXTH_ROTATION_RELEASE='1f7239c4116be509e9ca38c7343969d1773af692'$/mu,
  new RegExp(
    `^readonly SIXTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV6SuccessorSha}'$`,
    'mu',
  ),
  /^readonly PREDECESSOR_RELEASE='c73ba69d326be9c0b797b8fd9bbd77aa82cb89c9'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV7SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV8SuccessorSha}'$`,
    'mu',
  ),
  /"\$SUCCESSOR_RELEASE" != "\$SIXTH_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$FIFTH_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$PREDECESSOR_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$SIXTH_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$FIFTH_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
]) {
  assert.match(v3SuccessorHelperRotationV8, fixedRotationV8Contract);
}
assert.equal(
  v3SuccessorHelperRotationV8.split(`readonly CONFIRMATION='${v3HelperRotationV8Confirmation}'`)
    .length - 1,
  1,
  'the eighth installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV8,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the eighth helper rotation must remain append-only and use no destructive cleanup primitive',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV8,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the eighth helper rotation must never issue a lookup, enable Transfer, or enable money movement',
);

const rotationV8PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV8,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV8Contract of [
  /"\$FIRST_ROTATION_PARENT" "\$SECOND_ROTATION_PARENT" "\$THIRD_ROTATION_PARENT"/u,
  /"\$FOURTH_ROTATION_PARENT" "\$FIFTH_ROTATION_PARENT" "\$SIXTH_ROTATION_PARENT"/u,
  /"\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$FOURTH_ROTATION_RELEASE" "\$FIFTH_ROTATION_RELEASE" "\$SIXTH_ROTATION_RELEASE"/u,
  /"\$PREDECESSOR_RELEASE"/u,
  /"\$FOURTH_ROTATION_HELPER_SHA256" "\$FIFTH_ROTATION_HELPER_SHA256"/u,
  /"\$SIXTH_ROTATION_HELPER_SHA256" "\$PREDECESSOR_HELPER_SHA256"/u,
  /len\(\{base_release, first_release, second_release, third_release, fourth_release,\s+fifth_release, sixth_release, predecessor_release\}\) != 8/u,
  /len\(\{base_helper, first_helper, second_helper, third_helper, fourth_helper,\s+fifth_helper, sixth_helper, predecessor_helper\}\) != 8/u,
  /exact_directory\(first_parent, \[first_release\]\)/u,
  /exact_directory\(second_parent, \[second_release\]\)/u,
  /exact_directory\(third_parent, \[third_release\]\)/u,
  /exact_directory\(fourth_parent, \[fourth_release\]\)/u,
  /exact_directory\(fifth_parent, \[fifth_release\]\)/u,
  /exact_directory\(sixth_parent, \[sixth_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v6/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v7/u,
  /hashlib\.sha256\(first_archive\)\.hexdigest\(\) != base_helper/u,
  /hashlib\.sha256\(second_archive\)\.hexdigest\(\) != first_helper/u,
  /hashlib\.sha256\(third_archive\)\.hexdigest\(\) != second_helper/u,
  /hashlib\.sha256\(fourth_archive\)\.hexdigest\(\) != third_helper/u,
  /hashlib\.sha256\(fifth_archive\)\.hexdigest\(\) != fourth_helper/u,
  /hashlib\.sha256\(sixth_archive\)\.hexdigest\(\) != fifth_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != sixth_helper/u,
  /fifth_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(fourth_intent_data\)\.hexdigest\(\)\}'/u,
  /sixth_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(fifth_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(sixth_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(sixth_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(sixth_archive\)\.hexdigest\(\)\}'/u,
]) {
  assert.match(rotationV8PredecessorEvidence, predecessorRotationV8Contract);
}
assert.doesNotMatch(
  rotationV8PredecessorEvidence,
  /print\(\s*(?:first|second|third|fourth|fifth|sixth)?_?(?:intent_data|completion_data|archive|archived_helper)\s*\)/u,
  'the seven-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);
const rotationV8BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV8,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV8BoundaryMatcher,
  rotationV7BoundaryMatcher,
  'the eighth rotation must preserve the exact seventh-link durable-boundary matcher',
);
const rotationV8Classifier = extractShellFunction(
  v3SuccessorHelperRotationV8,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(rotationV8Classifier, rotationV7Classifier);
const rotationV8Prefix = extractShellFunction(
  v3SuccessorHelperRotationV8,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(rotationV8Prefix, rotationV7Prefix);
const rotationV8IntentStart = v3SuccessorHelperRotationV8.indexOf('expected_intent() {');
const rotationV8IntentEnd = v3SuccessorHelperRotationV8.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV8IntentStart,
);
assert.ok(rotationV8IntentStart >= 0 && rotationV8IntentEnd > rotationV8IntentStart);
const rotationV8Intent = v3SuccessorHelperRotationV8.slice(
  rotationV8IntentStart,
  rotationV8IntentEnd + 2,
);
assert.match(rotationV8Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v8/u);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal((rotationV8Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length, 1);
}
const rotationV8PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV8,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const generation of [
  'FIRST_ROTATION',
  'SECOND_ROTATION',
  'THIRD_ROTATION',
  'FOURTH_ROTATION',
  'FIFTH_ROTATION',
  'SIXTH_ROTATION',
  'PREDECESSOR',
]) {
  for (const suffix of [
    'SUDOERS_DISABLED',
    'INSTALLING_HELPER',
    'INSTALLING_HELPER_PARTIAL',
    'ROLLBACK_HELPER',
    'ROLLBACK_HELPER_PARTIAL',
  ]) {
    assert.ok(rotationV8PredecessorResidue.includes(`$${generation}_${suffix}`));
  }
}
const rotationV8Main = v3SuccessorHelperRotationV8.slice(
  v3SuccessorHelperRotationV8.indexOf('rotation_state="$(classify_rotation)"'),
);
assertInOrder(
  rotationV8Main,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'require_stopped_no_transfer_boundary',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'restore_sudoers',
  ],
  'the eighth rotation must stop before mutation, append one link, self-attest, and restore sudo once',
);
assert.equal((rotationV8Main.match(/restore_sudoers/g) ?? []).length, 1);
for (const rotationV8RunbookContract of [
  /One-use eighth installed-v3 helper\/release rotation/u,
  /fail-closed pre-recheck checkpoint/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v8\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v8-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v8\/<successor-release>\//u,
  new RegExp(v3HelperRotationV8Confirmation, 'u'),
  /hard-pins the completed v7 release and helper as its\s+direct predecessor/u,
  /validates\s+the immutable base plus the exact first, second, third, fourth, fifth, sixth, and seventh\s+links in order/u,
  /retryable exact-five recheck\s+failure\/source\/stage evidence[^.]*must remain byte-for-byte unchanged/u,
  /Do not perform broad cleanup/u,
  /leaves the runtime stopped,[\s\S]*?Transfer and the executor disabled,[\s\S]*?makes no KemerBet request/u,
  /Current authenticated-session continuity repair order: rotate, deploy, sign in, then recheck/u,
  /Only then retry the same exact-five FIND-only no-transfer recheck/u,
]) {
  assert.match(stagingRunbook, rotationV8RunbookContract);
}

const v3HelperRotationV9Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-NINTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV9Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly FIRST_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation'$/mu,
  /^readonly SECOND_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  /^readonly THIRD_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  /^readonly FOURTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4'$/mu,
  /^readonly FIFTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v5'$/mu,
  /^readonly SIXTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v6'$/mu,
  /^readonly SEVENTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v7'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v8'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v9'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v9-disabled'$/mu,
  /^readonly SEVENTH_ROTATION_RELEASE='c73ba69d326be9c0b797b8fd9bbd77aa82cb89c9'$/mu,
  new RegExp(
    `^readonly SEVENTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV7SuccessorSha}'$`,
    'mu',
  ),
  /^readonly PREDECESSOR_RELEASE='ede557b85ce5878b57f2a6abd0775c530276f46d'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV8SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV9SuccessorSha}'$`,
    'mu',
  ),
  /"\$SUCCESSOR_RELEASE" != "\$SEVENTH_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$SIXTH_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$PREDECESSOR_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$SEVENTH_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$SIXTH_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
]) {
  assert.match(v3SuccessorHelperRotationV9, fixedRotationV9Contract);
}
assert.equal(
  v3SuccessorHelperRotationV9.split(`readonly CONFIRMATION='${v3HelperRotationV9Confirmation}'`)
    .length - 1,
  1,
  'the ninth installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV9,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the ninth helper rotation must remain append-only and use no destructive cleanup primitive',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV9,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the ninth helper rotation must never issue a lookup, enable Transfer, or enable money movement',
);

const rotationV9PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV9,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV9Contract of [
  /"\$FIRST_ROTATION_PARENT" "\$SECOND_ROTATION_PARENT" "\$THIRD_ROTATION_PARENT"/u,
  /"\$FOURTH_ROTATION_PARENT" "\$FIFTH_ROTATION_PARENT" "\$SIXTH_ROTATION_PARENT"/u,
  /"\$SEVENTH_ROTATION_PARENT" "\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$FOURTH_ROTATION_RELEASE" "\$FIFTH_ROTATION_RELEASE" "\$SIXTH_ROTATION_RELEASE"/u,
  /"\$SEVENTH_ROTATION_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$SIXTH_ROTATION_HELPER_SHA256" "\$SEVENTH_ROTATION_HELPER_SHA256"/u,
  /"\$PREDECESSOR_HELPER_SHA256"/u,
  /len\(\{base_release, first_release, second_release, third_release, fourth_release,\s+fifth_release, sixth_release, seventh_release, predecessor_release\}\) != 9/u,
  /len\(\{base_helper, first_helper, second_helper, third_helper, fourth_helper,\s+fifth_helper, sixth_helper, seventh_helper, predecessor_helper\}\) != 9/u,
  /exact_directory\(first_parent, \[first_release\]\)/u,
  /exact_directory\(second_parent, \[second_release\]\)/u,
  /exact_directory\(third_parent, \[third_release\]\)/u,
  /exact_directory\(fourth_parent, \[fourth_release\]\)/u,
  /exact_directory\(fifth_parent, \[fifth_release\]\)/u,
  /exact_directory\(sixth_parent, \[sixth_release\]\)/u,
  /exact_directory\(seventh_parent, \[seventh_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v6/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v7/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v8/u,
  /hashlib\.sha256\(first_archive\)\.hexdigest\(\) != base_helper/u,
  /hashlib\.sha256\(second_archive\)\.hexdigest\(\) != first_helper/u,
  /hashlib\.sha256\(third_archive\)\.hexdigest\(\) != second_helper/u,
  /hashlib\.sha256\(fourth_archive\)\.hexdigest\(\) != third_helper/u,
  /hashlib\.sha256\(fifth_archive\)\.hexdigest\(\) != fourth_helper/u,
  /hashlib\.sha256\(sixth_archive\)\.hexdigest\(\) != fifth_helper/u,
  /hashlib\.sha256\(seventh_archive\)\.hexdigest\(\) != sixth_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != seventh_helper/u,
  /seventh_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(sixth_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(seventh_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(seventh_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(seventh_archive\)\.hexdigest\(\)\}'/u,
]) {
  assert.match(rotationV9PredecessorEvidence, predecessorRotationV9Contract);
}
assert.doesNotMatch(
  rotationV9PredecessorEvidence,
  /print\(\s*(?:first|second|third|fourth|fifth|sixth|seventh)?_?(?:intent_data|completion_data|archive|archived_helper)\s*\)/u,
  'the eight-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);
const rotationV9BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV9,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV9BoundaryMatcher,
  rotationV8BoundaryMatcher,
  'the ninth rotation must preserve the exact eighth-link durable-boundary matcher',
);
const rotationV9Classifier = extractShellFunction(
  v3SuccessorHelperRotationV9,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(rotationV9Classifier, rotationV8Classifier);
const rotationV9Prefix = extractShellFunction(
  v3SuccessorHelperRotationV9,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(rotationV9Prefix, rotationV8Prefix);
const rotationV9IntentStart = v3SuccessorHelperRotationV9.indexOf('expected_intent() {');
const rotationV9IntentEnd = v3SuccessorHelperRotationV9.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV9IntentStart,
);
assert.ok(rotationV9IntentStart >= 0 && rotationV9IntentEnd > rotationV9IntentStart);
const rotationV9Intent = v3SuccessorHelperRotationV9.slice(
  rotationV9IntentStart,
  rotationV9IntentEnd + 2,
);
assert.match(rotationV9Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v9/u);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal((rotationV9Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length, 1);
}
const rotationV9PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV9,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const generation of [
  'FIRST_ROTATION',
  'SECOND_ROTATION',
  'THIRD_ROTATION',
  'FOURTH_ROTATION',
  'FIFTH_ROTATION',
  'SIXTH_ROTATION',
  'SEVENTH_ROTATION',
  'PREDECESSOR',
]) {
  for (const suffix of [
    'SUDOERS_DISABLED',
    'INSTALLING_HELPER',
    'INSTALLING_HELPER_PARTIAL',
    'ROLLBACK_HELPER',
    'ROLLBACK_HELPER_PARTIAL',
  ]) {
    assert.ok(rotationV9PredecessorResidue.includes(`$${generation}_${suffix}`));
  }
}
const rotationV9Main = v3SuccessorHelperRotationV9.slice(
  v3SuccessorHelperRotationV9.indexOf('rotation_state="$(classify_rotation)"'),
);
assertInOrder(
  rotationV9Main,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'require_stopped_no_transfer_boundary',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'restore_sudoers',
  ],
  'the ninth rotation must stop before mutation, append one link, self-attest, and restore sudo once',
);
assert.equal((rotationV9Main.match(/restore_sudoers/g) ?? []).length, 1);
for (const rotationV9RunbookContract of [
  /One-use ninth installed-v3 helper\/release rotation/u,
  /exactly one canonical KemerBet refresh-token request/u,
  /fixed, privacy-safe failure-stage enum/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v9\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v9-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v9\/<successor-release>\//u,
  new RegExp(v3HelperRotationV9Confirmation, 'u'),
  /hard-pins completed v8 release[\s\S]*?as the direct predecessor/u,
  /validates the immutable base plus the exact first, second, third, fourth, fifth, sixth, seventh,\s+and eighth links in order/u,
  /Do not perform broad cleanup/u,
  /leaves the runtime stopped,[\s\S]*?Transfer and the executor disabled,[\s\S]*?makes no KemerBet request/u,
  /Current startup-refresh diagnostics repair order: rotate, deploy, sign in, then recheck/u,
  /Obtain a fresh explicit authorization, then dispatch exactly one exact-five FIND-only\s+no-transfer recheck/u,
  /Never automatically retry a failed recheck/u,
]) {
  assert.match(stagingRunbook, rotationV9RunbookContract);
}

const v3HelperRotationV10Confirmation =
  'I-UNDERSTAND-THIS-APPENDS-TENTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED';
for (const fixedRotationV10Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly EIGHTH_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v8'$/mu,
  /^readonly PREDECESSOR_ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v9'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v10'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-rotation-v10-disabled'$/mu,
  /^readonly EIGHTH_ROTATION_RELEASE='ede557b85ce5878b57f2a6abd0775c530276f46d'$/mu,
  new RegExp(
    `^readonly EIGHTH_ROTATION_HELPER_SHA256='${reviewedV3HelperRotationV8SuccessorSha}'$`,
    'mu',
  ),
  /^readonly PREDECESSOR_RELEASE='31812cfc5403effdafa1d68fb641058bf14a8850'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV9SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3HelperRotationV10SuccessorSha}'$`,
    'mu',
  ),
  /^readonly SUCCESSOR_RELEASE="\$1"$/mu,
  /"\$SUCCESSOR_RELEASE" != "\$EIGHTH_ROTATION_RELEASE"/u,
  /"\$SUCCESSOR_RELEASE" != "\$PREDECESSOR_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$EIGHTH_ROTATION_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
]) {
  assert.match(v3SuccessorHelperRotationV10, fixedRotationV10Contract);
}
assert.doesNotMatch(
  v3SuccessorHelperRotationV10,
  /REVIEWED_SUCCESSOR_RELEASE/u,
  'the tenth operation must bind the future protected-main merge SHA supplied after merge, not its pre-merge base',
);
assert.equal(
  v3SuccessorHelperRotationV10.split(`readonly CONFIRMATION='${v3HelperRotationV10Confirmation}'`)
    .length - 1,
  1,
  'the tenth installed-v3 rotation must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV10,
  /(?:^|[;\s])(?:rm|unlink|shred|truncate)\b|os\.(?:unlink|remove)\s*\(|shutil\.rmtree\s*\(|find[^\r\n]*-delete|docker[^\r\n]*(?:container|volume|image|network)\s+rm\b/imu,
  'the tenth helper rotation must remain append-only and use no destructive cleanup primitive',
);
assert.doesNotMatch(
  v3SuccessorHelperRotationV10,
  /GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer\/|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the tenth helper rotation must never issue a lookup, enable Transfer, or enable money movement',
);
const rotationV10PredecessorEvidence = extractShellFunction(
  v3SuccessorHelperRotationV10,
  'load_exact_predecessor_rotation_evidence',
  'require_current_boundary_matches_predecessor_rotation',
);
for (const predecessorRotationV10Contract of [
  /"\$SEVENTH_ROTATION_PARENT" "\$EIGHTH_ROTATION_PARENT"/u,
  /"\$PREDECESSOR_ROTATION_PARENT"/u,
  /"\$SEVENTH_ROTATION_RELEASE" "\$EIGHTH_ROTATION_RELEASE" "\$PREDECESSOR_RELEASE"/u,
  /"\$EIGHTH_ROTATION_HELPER_SHA256" "\$PREDECESSOR_HELPER_SHA256"/u,
  /len\(\{base_release, first_release, second_release, third_release, fourth_release,\s+fifth_release, sixth_release, seventh_release, eighth_release,\s+predecessor_release\}\) != 10/u,
  /len\(\{base_helper, first_helper, second_helper, third_helper, fourth_helper,\s+fifth_helper, sixth_helper, seventh_helper, eighth_helper,\s+predecessor_helper\}\) != 10/u,
  /exact_directory\(eighth_parent, \[eighth_release\]\)/u,
  /exact_directory\(predecessor_parent, \[predecessor_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v8/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v9/u,
  /hashlib\.sha256\(eighth_archive\)\.hexdigest\(\) != seventh_helper/u,
  /hashlib\.sha256\(archived_helper\)\.hexdigest\(\) != eighth_helper/u,
  /intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(eighth_intent_data\)\.hexdigest\(\)\}'/u,
  /intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(eighth_completion_data\)\.hexdigest\(\)\}'/u,
  /intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(eighth_archive\)\.hexdigest\(\)\}'/u,
]) {
  assert.match(rotationV10PredecessorEvidence, predecessorRotationV10Contract);
}
assert.doesNotMatch(
  rotationV10PredecessorEvidence,
  /print\(\s*(?:first|second|third|fourth|fifth|sixth|seventh|eighth)?_?(?:intent_data|completion_data|archive|archived_helper)\s*\)/u,
  'the nine-link predecessor parser may expose only digests and frozen non-secret Compose metadata',
);
const rotationV10BoundaryMatcher = extractShellFunction(
  v3SuccessorHelperRotationV10,
  'require_current_boundary_matches_predecessor_rotation',
  'expected_intent',
);
assert.equal(
  rotationV10BoundaryMatcher,
  rotationV9BoundaryMatcher,
  'the tenth rotation must preserve the exact ninth-link durable-boundary matcher',
);
const rotationV10Classifier = extractShellFunction(
  v3SuccessorHelperRotationV10,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.equal(rotationV10Classifier, rotationV9Classifier);
const rotationV10Prefix = extractShellFunction(
  v3SuccessorHelperRotationV10,
  'require_rotation_prefix',
  'publish_record',
);
assert.equal(rotationV10Prefix, rotationV9Prefix);
const rotationV10IntentStart = v3SuccessorHelperRotationV10.indexOf('expected_intent() {');
const rotationV10IntentEnd = v3SuccessorHelperRotationV10.indexOf(
  "\n}\n\nROTATION_INTENT_SHA256=''",
  rotationV10IntentStart,
);
assert.ok(rotationV10IntentStart >= 0 && rotationV10IntentEnd > rotationV10IntentStart);
const rotationV10Intent = v3SuccessorHelperRotationV10.slice(
  rotationV10IntentStart,
  rotationV10IntentEnd + 2,
);
assert.match(rotationV10Intent, /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v10/u);
for (const evidenceField of [
  'base_successor_intent_sha256',
  'base_successor_completion_sha256',
  'base_binding_v2_sha256',
  'base_predecessor_helper_sha256',
  'base_binding_v3_sha256',
  'predecessor_rotation_intent_sha256',
  'predecessor_rotation_completion_sha256',
  'predecessor_rotation_helper_archive_sha256',
  'compose5_durable_volume_digest',
  'compose5_profile_config_hash',
  'compose5_session_control_config_hash',
  'compose5_volume_version',
]) {
  assert.equal((rotationV10Intent.match(new RegExp(`${evidenceField}=`, 'gu')) ?? []).length, 1);
}
const rotationV10PredecessorResidue = extractShellFunction(
  v3SuccessorHelperRotationV10,
  'require_predecessor_rotation_global_residue_absent',
  'require_rollback_residue_absent',
);
for (const generation of [
  'FIRST_ROTATION',
  'SECOND_ROTATION',
  'THIRD_ROTATION',
  'FOURTH_ROTATION',
  'FIFTH_ROTATION',
  'SIXTH_ROTATION',
  'SEVENTH_ROTATION',
  'EIGHTH_ROTATION',
  'PREDECESSOR',
]) {
  for (const suffix of [
    'SUDOERS_DISABLED',
    'INSTALLING_HELPER',
    'INSTALLING_HELPER_PARTIAL',
    'ROLLBACK_HELPER',
    'ROLLBACK_HELPER_PARTIAL',
  ]) {
    assert.ok(rotationV10PredecessorResidue.includes(`$${generation}_${suffix}`));
  }
}
const rotationV10Main = v3SuccessorHelperRotationV10.slice(
  v3SuccessorHelperRotationV10.indexOf('rotation_state="$(classify_rotation)"'),
);
assertInOrder(
  rotationV10Main,
  [
    'run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256"',
    'run_predecessor_helper kemerbet-v3-successor-ready',
    'run_predecessor_helper stop',
    'require_stopped_no_transfer_boundary',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'publish_record "$ROTATION_INSTALLING" intent',
    'copy_root_file_atomically "$STAGED_HELPER"',
    'publish_record "$ROTATION_INSTALLING" completion',
    'run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_successor_helper_direct kemerbet-v3-successor-ready',
    'restore_sudoers',
  ],
  'the tenth rotation must stop before mutation, append one link, self-attest, and restore sudo once',
);
assert.equal((rotationV10Main.match(/restore_sudoers/g) ?? []).length, 1);
for (const rotationV10RunbookContract of [
  /One-use tenth installed-v3 helper\/release rotation/u,
  /immutable successor parser ends at the v9 namespace/u,
  /Rewriting the completed v9 record[\s\S]*?is forbidden/u,
  /fetanagent-kemerbet-v3-successor-helper-rotation-v10\.sh/u,
  /\/root\/fetanagent-v3-helper-rotation-v10-<successor-release>\//u,
  /\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v10\/<successor-release>\//u,
  new RegExp(v3HelperRotationV10Confirmation, 'u'),
  /exact protected-`main` commit[\s\S]*?pre-merge base commit is not the\s+successor release/u,
  /read-only `verify` plus `kemerbet-v3-successor-ready` SSH preflight/u,
  /before it stops staging or disables database\s+logins/u,
  /performs no KemerBet request,[\s\S]*?Transfer,[\s\S]*?money movement/u,
  /Never reuse the consumed v9 authorization and never retry a\s+failed recheck automatically/u,
]) {
  assert.match(stagingRunbook, rotationV10RunbookContract);
}

const v3RuntimeBridgeV11Confirmation =
  'I-UNDERSTAND-THIS-INSTALLS-ONE-FUTURE-RELEASE-NEUTRAL-V3-RUNTIME-BRIDGE-WITH-TRANSFER-DISABLED';
for (const fixedRuntimeBridgeV11Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly PROJECT_NAME='fetanagent-staging-beta'$/mu,
  /^readonly HISTORICAL_OVERLAY_RELEASE='c061f9dc05e60d641d306f16b5d826e6e1b2c6c4'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV10SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly PREDECESSOR_ARCHIVE_SHA256='${reviewedV3HelperRotationV9SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3RuntimeBridgeHelperV11Sha}'$`,
    'mu',
  ),
  /^readonly ROTATION_V10_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v10'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v11'$/mu,
  /^readonly EXPECTED_DROPLET_ID='593344964'$/mu,
  /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu,
  /\[\[ \$# -eq 3 \]\]/u,
  /^readonly BRIDGE_RELEASE="\$1"$/mu,
  /^readonly SUCCESSOR_HELPER_SHA256="\$2"$/mu,
  /^readonly PROVIDED_CONFIRMATION="\$3"$/mu,
  /"\$BRIDGE_RELEASE" != "\$HISTORICAL_OVERLAY_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
  /"\$METADATA\/id"/u,
  /"\$METADATA\/interfaces\/public\/0\/ipv4\/address"/u,
]) {
  assert.match(v3RuntimeBridgeHelperPromotionV11, fixedRuntimeBridgeV11Contract);
}
assert.equal(
  v3RuntimeBridgeHelperPromotionV11.split(
    `readonly CONFIRMATION='${v3RuntimeBridgeV11Confirmation}'`,
  ).length - 1,
  1,
  'the H11 runtime-bridge promotion must expose one distinct exact root confirmation',
);
assert.doesNotMatch(
  v3RuntimeBridgeHelperPromotionV11,
  /kemerbet-readiness-v3-helper-rotation-v1[2-9]|kemerbet-readiness-v3-helper-rotation-v[2-9][0-9]/u,
  'the one authorized H11 bridge must not create or imply an H12/H13-style release rotation',
);
assert.doesNotMatch(
  v3RuntimeBridgeHelperPromotionV11,
  /run_helper_direct\s+(?:recheck-kemerbet-readiness|prepare-kemerbet-readiness|seal-kemerbet-readiness)|GeneralInfoByExternalId|PlayerEPOSDeposit|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the H11 promotion must not authorize a lookup, recheck, Transfer, executor, or money movement',
);
assert.doesNotMatch(
  v3RuntimeBridgeHelperPromotionV11,
  /docker_local_read_only\s+(?:container|volume|image|network)\s+(?:rm|prune)|docker[^\r\n]*(?:system|container|volume|image|network)\s+prune/iu,
  'the H11 promotion may inspect Docker and call the predecessor stop boundary, but cannot perform direct Docker cleanup',
);

const runtimeBridgeV11H10Evidence = extractShellFunction(
  v3RuntimeBridgeHelperPromotionV11,
  'load_exact_h10_evidence',
  'require_stopped_historical_overlay',
);
for (const h10EvidenceContract of [
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v10/u,
  /"\$HISTORICAL_OVERLAY_RELEASE"/u,
  /successor_helper_sha256=\$PREDECESSOR_HELPER_SHA256/u,
  /"\$PREDECESSOR_ARCHIVE_SHA256" 400/u,
  /"\$\{#intent_lines\[@\]\}" -eq 18/u,
  /"\$\{#completion_lines\[@\]\}" -eq 19/u,
  /state=successor-installed/u,
  /rotation_intent_sha256=\$H10_INTENT_SHA256/u,
  /BASE_BINDING_V3_SHA256=/u,
  /COMPOSE5_DURABLE_VOLUME_DIGEST=/u,
  /COMPOSE5_PROFILE_CONFIG_HASH=/u,
  /COMPOSE5_SESSION_CONTROL_CONFIG_HASH=/u,
  /COMPOSE5_VOLUME_VERSION=/u,
]) {
  assert.match(runtimeBridgeV11H10Evidence, h10EvidenceContract);
}

const runtimeBridgeV11Intent = extractShellFunction(
  v3RuntimeBridgeHelperPromotionV11,
  'expected_intent',
  'expected_completion',
);
for (const exactBridgeEvidence of [
  'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v11',
  'state=authorized',
  'overlay_release=$HISTORICAL_OVERLAY_RELEASE',
  'bridge_release=$BRIDGE_RELEASE',
  'predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256',
  'successor_helper_sha256=$SUCCESSOR_HELPER_SHA256',
  'predecessor_rotation_intent_sha256=$H10_INTENT_SHA256',
  'predecessor_rotation_completion_sha256=$H10_COMPLETION_SHA256',
  'predecessor_rotation_helper_archive_sha256=$H10_ARCHIVE_SHA256',
  'base_binding_v3_sha256=$BASE_BINDING_V3_SHA256',
  'transition=historical-overlay-current-runtime-separated-v1',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'transfer_enabled=false',
  'lookup_authorized=false',
  'recheck_authorized=false',
]) {
  assert.equal(
    (
      runtimeBridgeV11Intent.match(new RegExp(exactBridgeEvidence.replaceAll('$', '\\$'), 'gu')) ??
      []
    ).length,
    1,
    `the H11 intent must contain exactly one ${exactBridgeEvidence} field`,
  );
}
for (const inheritedComposeEvidence of [
  'COMPOSE5_DURABLE_VOLUME_DIGEST',
  'COMPOSE5_PROFILE_CONFIG_HASH',
  'COMPOSE5_SESSION_CONTROL_CONFIG_HASH',
  'COMPOSE5_VOLUME_VERSION',
]) {
  assert.equal(
    (runtimeBridgeV11Intent.match(new RegExp(inheritedComposeEvidence, 'gu')) ?? []).length,
    1,
  );
}

const runtimeBridgeV11Main = v3RuntimeBridgeHelperPromotionV11.slice(
  v3RuntimeBridgeHelperPromotionV11.indexOf('require_exact_sudoers_file "$SUDOERS" || die'),
);
assertInOrder(
  runtimeBridgeV11Main,
  [
    'run_helper_direct verify "$PREDECESSOR_HELPER_SHA256"',
    'run_helper_direct kemerbet-v3-successor-ready',
    '"$HISTORICAL_OVERLAY_RELEASE" "$PREDECESSOR_HELPER_SHA256"',
    'run_helper_direct stop',
    'require_stopped_historical_overlay',
    'flock --exclusive --nonblock 9',
    'disable_sudoers',
    'publish_record "$ROTATION_INSTALLING" intent-v1 0600 expected_intent',
    'install -o root -g root -m 0400 "$TARGET" "$ROTATION_INSTALLING/predecessor-helper"',
    'install -o root -g root -m 0755 "$STAGED_HELPER" "$INSTALLING_HELPER"',
    'mv -- "$INSTALLING_HELPER" "$TARGET"',
    'publish_record "$ROTATION_INSTALLING" completed-v1 0600 expected_completion',
    'mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"',
    'flock --unlock 9',
    'run_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256"',
    'flock --exclusive --nonblock 9',
    'restore_sudoers',
  ],
  'H11 must attest H10, stop safely, append immutable bridge evidence, install the reviewed helper, self-attest, and only then restore the deployment grant',
);
assert.equal(
  (runtimeBridgeV11Main.match(/run_helper_direct stop/g) ?? []).length,
  1,
  'H11 must invoke the predecessor stop boundary exactly once',
);
assert.equal(
  (runtimeBridgeV11Main.match(/restore_sudoers/g) ?? []).length,
  1,
  'H11 must restore the narrow deployment grant exactly once on the new-install path',
);

const runtimeBridgeV11EmptyCheckpointRecovery =
  v3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecovery;
for (const fixedRecoveryContract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly PROJECT_NAME='fetanagent-staging-beta'$/mu,
  /^readonly HISTORICAL_OVERLAY_RELEASE='c061f9dc05e60d641d306f16b5d826e6e1b2c6c4'$/mu,
  /^readonly REVIEWED_BRIDGE_RELEASE='21ef5f0d987d9dc21efc1a81916316a3f6d7f864'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3HelperRotationV10SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly PREDECESSOR_ARCHIVE_SHA256='${reviewedV3HelperRotationV9SuccessorSha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3RuntimeBridgeHelperV11Sha}'$`,
    'mu',
  ),
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v11'$/mu,
  /^readonly EXPECTED_DROPLET_ID='593344964'$/mu,
  /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu,
  /\[\[ \$# -eq 3 \]\]/u,
  /"\$BRIDGE_RELEASE" == "\$REVIEWED_BRIDGE_RELEASE"/u,
  /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u,
  /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u,
  /require_exact_droplet \|\| die/u,
]) {
  assert.match(runtimeBridgeV11EmptyCheckpointRecovery, fixedRecoveryContract);
}
assert.equal(
  runtimeBridgeV11EmptyCheckpointRecovery.split(
    `readonly CONFIRMATION='${v3RuntimeBridgeV11Confirmation}'`,
  ).length - 1,
  1,
  'the empty-checkpoint recovery must require the original exact H11 authorization',
);
assert.doesNotMatch(
  runtimeBridgeV11EmptyCheckpointRecovery,
  /\b(?:rm|rmdir)\b|run_helper_direct\s+stop/u,
  'the recovery must neither erase state nor invoke the predecessor stop boundary again',
);
assert.doesNotMatch(
  runtimeBridgeV11EmptyCheckpointRecovery,
  /run_helper_direct\s+(?:recheck-kemerbet-readiness|prepare-kemerbet-readiness|seal-kemerbet-readiness)|GeneralInfoByExternalId|PlayerEPOSDeposit|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true/iu,
  'the recovery must not authorize a lookup, recheck, Transfer, executor, or money movement',
);
assert.doesNotMatch(
  runtimeBridgeV11EmptyCheckpointRecovery,
  /docker_local_read_only\s+(?:container|volume|image|network)\s+(?:rm|prune)|docker[^\r\n]*(?:system|container|volume|image|network)\s+prune/iu,
  'the recovery may only inspect the stopped Docker boundary',
);

const runtimeBridgeV11RecoveryProcessGate = runtimeBridgeV11EmptyCheckpointRecovery.slice(
  runtimeBridgeV11EmptyCheckpointRecovery.indexOf('require_no_other_mutator_processes() {'),
  runtimeBridgeV11EmptyCheckpointRecovery.indexOf("\n\nH10_INTENT_SHA256=''"),
);
for (const processGateContract of [
  /\/proc\/\[0-9\]\*\/cmdline/u,
  /"\$pid" == "\$\$"/u,
  /"\$TARGET"\|"\$INSTALLING_HELPER"\|"\$INSTALLING_HELPER_PARTIAL"\|"\$STAGED_HELPER"/u,
  /"\$ORIGINAL_PROMOTION_BASENAME"\|"\$RECOVERY_BASENAME"/u,
]) {
  assert.match(runtimeBridgeV11RecoveryProcessGate, processGateContract);
}

const runtimeBridgeV11EmptyCheckpoint = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'require_exact_empty_checkpoint',
  'require_exact_completed_namespace',
);
assertInOrder(
  runtimeBridgeV11EmptyCheckpoint,
  [
    '"$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf \'%f\\n\')" ==',
    '".installing-$BRIDGE_RELEASE"',
    '-z "$(find -P "$ROTATION_INSTALLING" -mindepth 1 -maxdepth 1',
    '! -e "$ROTATION_ROOT"',
    '! -e "$INSTALLING_HELPER"',
    'require_disabled_grant_only',
    'require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755',
  ],
  'recovery admission must be the one empty pre-intent directory with disabled grant and exact H10 helper',
);

const runtimeBridgeV11CompletedNamespace = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'require_exact_completed_namespace',
  'restore_sudoers',
);
assertInOrder(
  runtimeBridgeV11CompletedNamespace,
  [
    '"$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf \'%f\\n\')" ==',
    '"$BRIDGE_RELEASE"',
    '! -e "$ROTATION_INSTALLING"',
    '! -e "$INSTALLING_HELPER"',
    'require_exact_rotation_record "$ROTATION_ROOT"',
    'require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755',
  ],
  'already-complete admission must contain only the exact final record and reviewed H11 helper',
);

const runtimeBridgeV11RecoveryIntent = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'expected_intent',
  'expected_completion',
);
assert.equal(
  runtimeBridgeV11RecoveryIntent,
  runtimeBridgeV11Intent,
  'recovery must publish byte-identical H11 intent evidence, including every false finance flag',
);

const runtimeBridgeV11RecoveryLock = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'open_lock',
  'close_lock',
);
assertInOrder(
  runtimeBridgeV11RecoveryLock,
  [
    '[[ ! -L /run && -d /run',
    'root:root:755',
    '(umask 077 && mkdir --mode=0700 -- "$LOCK_ROOT")',
    'root:root:700',
    '(set -o noclobber; umask 077; : >"$LOCK")',
    'root:root:600:1',
    'exec 9<>"$LOCK"',
    'stat --format=\'%u:%g:%a:%h:%d:%i\' "$LOCK"',
    "stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9",
    '"$fd_identity" == "$path_identity"',
    'flock --exclusive --nonblock 9',
    '"$(stat --format=\'%u:%g:%a:%h:%d:%i\' "$LOCK")" == "$fd_identity"',
  ],
  'the recovery lock must validate /run, create no-following exact objects, bind fd to path identity, and recheck after flock',
);

const runtimeBridgeV11RecoverySudoRestore = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'restore_sudoers',
  'open_lock',
);
assertInOrder(
  runtimeBridgeV11RecoverySudoRestore,
  [
    'require_disabled_grant_only',
    'visudo -cf "$SUDOERS_DISABLED"',
    'visudo -cf /etc/sudoers',
    'mv -- "$SUDOERS_DISABLED" "$SUDOERS"',
    'sync -f /etc/sudoers.d',
    'require_exact_sudoers_file "$SUDOERS"',
    'visudo -cf /etc/sudoers',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    'require_disabled_grant_only',
  ],
  'grant restoration must validate first and atomically return to disabled state if post-move validation fails',
);

const runtimeBridgeV11RecoveryClassifier = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'classify_rotation',
  'require_rotation_prefix',
);
assert.match(runtimeBridgeV11RecoveryClassifier, /print\('interrupted'\)/u);
assert.match(runtimeBridgeV11RecoveryClassifier, /print\('completed'\)/u);
assert.doesNotMatch(runtimeBridgeV11RecoveryClassifier, /print\('absent'|'empty-parent'\)/u);

const runtimeBridgeV11RecoveryPrefix = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'require_rotation_prefix',
  'require_record_prefix',
);
for (const resumablePrefixContract of [
  /'\.intent-v1\.installing': \(0o600, 4096\)/u,
  /'\.predecessor-helper\.installing': \(0o400, 2 \* 1024 \* 1024\)/u,
  /'\.completed-v1\.installing': \(0o600, 4096\)/u,
  /if final in entries and f'\.\{final\}\.installing' in entries/u,
  /item\.st_nlink\) !=\s+\(0, 0, mode, 1\)/u,
]) {
  assert.match(runtimeBridgeV11RecoveryPrefix, resumablePrefixContract);
}

const runtimeBridgeV11RecoveryPublisher = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'publish_record',
  'copy_root_file_atomically',
);
for (const resumablePublisherContract of [
  /os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /expected\.startswith\(existing\)/u,
  /os\.O_EXCL \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /os\.fsync\(descriptor\)/u,
  /os\.rename\(temporary, target, src_dir_fd=directory, dst_dir_fd=directory\)/u,
  /os\.fsync\(directory\)/u,
]) {
  assert.match(runtimeBridgeV11RecoveryPublisher, resumablePublisherContract);
}

const runtimeBridgeV11RecoveryCopy = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'copy_root_file_atomically',
  'classify_rotation',
);
for (const resumableCopyContract of [
  /os\.O_RDONLY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /hashlib\.sha256\(data\)\.hexdigest\(\) != expected_digest/u,
  /bytes\(data\)\.startswith\(existing\)/u,
  /os\.O_EXCL \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/u,
  /os\.rename\(temporary, target\)/u,
  /os\.fsync\(directory\)/u,
]) {
  assert.match(runtimeBridgeV11RecoveryCopy, resumableCopyContract);
}

const runtimeBridgeV11RecoveryConsistency = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'require_interrupted_prefix_consistency',
  'require_exact_rotation_record',
);
for (const monotonicRecoveryContract of [
  /require_rotation_prefix/u,
  /require_disabled_grant_only/u,
  /require_record_prefix "\$ROTATION_INSTALLING\/intent-v1"/u,
  /require_record_prefix "\$ROTATION_INSTALLING\/completed-v1"/u,
  /target_state='predecessor'/u,
  /target_state='successor'/u,
  /require_copy_prefix "\$ROTATION_INSTALLING\/\.predecessor-helper\.installing"/u,
  /require_helper_file "\$ROTATION_INSTALLING\/predecessor-helper"/u,
  /require_copy_prefix "\$INSTALLING_HELPER_PARTIAL" "\$STAGED_HELPER"/u,
]) {
  assert.match(runtimeBridgeV11RecoveryConsistency, monotonicRecoveryContract);
}

const runtimeBridgeV11RecoveryComposeBoundary = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'require_compose5_durable_volume_compatibility',
  'require_expiry_guard_disarmed',
);
for (const exactComposeBoundaryContract of [
  /volume ls --quiet/u,
  /"\$PROFILE_VOLUME" "\$SESSION_CONTROL_VOLUME"/u,
  /\{\{\.Name\}\}\|\{\{\.Driver\}\}\|\{\{\.Scope\}\}\|\{\{json \.Options\}\}\|\{\{len \.Labels\}\}/u,
  /"\$scope" == 'local'/u,
  /"\$options" == 'null'/u,
  /"\$label_count" == '4'/u,
  /"\$volume_label" == "\$expected_volume_label"/u,
  /"\$mountpoint" == "\/var\/lib\/docker\/volumes\/\$volume\/_data"/u,
  /"\$\(stat --format='%u:%g:%a' "\$mountpoint"\)" == '10001:10001:700'/u,
  /"\$\(stat --format='%u:%g:%a:%h' "\$mountpoint"\)" == '10001:10001:700:2'/u,
  /OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST=/u,
]) {
  assert.match(runtimeBridgeV11RecoveryComposeBoundary, exactComposeBoundaryContract);
}

const runtimeBridgeV11RecoveryStoppedBoundary = extractShellFunction(
  runtimeBridgeV11EmptyCheckpointRecovery,
  'require_stopped_durable_boundary',
  'require_stopped_historical_overlay',
);
assertInOrder(
  runtimeBridgeV11RecoveryStoppedBoundary,
  [
    'container ls --all --quiet',
    'network ls --quiet',
    'require_expiry_guard_disarmed',
    'require_no_recheck_transients',
    '! -e "$BOT_STARTUP_RECEIPT_ROOT"',
    'require_compose5_durable_volume_compatibility',
    '"compose5_durable_volume_digest=$OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST" ==',
    '"compose5_profile_config_hash=$OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH" ==',
    '"compose5_session_control_config_hash=$OBSERVED_COMPOSE5_SESSION_CONTROL_CONFIG_HASH" ==',
    '"compose5_volume_version=$OBSERVED_COMPOSE5_VOLUME_VERSION" ==',
    '"$(sha256sum -- "$SOURCE_BINDING"',
  ],
  'post-attestation recovery must match the complete inherited Compose 5 contract, disarmed runtime, and v3 binding',
);

const runtimeBridgeV11RecoveryMain = runtimeBridgeV11EmptyCheckpointRecovery.slice(
  runtimeBridgeV11EmptyCheckpointRecovery.indexOf("grant_disabled='false'"),
);
assertInOrder(
  runtimeBridgeV11RecoveryMain,
  [
    'rotation_state="$(classify_rotation)"',
    'require_interrupted_prefix_consistency',
    "grant_disabled='true'",
    'trap cleanup EXIT',
    'open_lock',
    'require_no_other_mutator_processes',
    'require_exact_droplet',
    'load_exact_h10_evidence',
    '"$(classify_rotation)" == "$rotation_state"',
    'require_interrupted_prefix_consistency',
    'require_stopped_historical_overlay',
    'require_stopped_durable_boundary',
    'require_interrupted_prefix_consistency',
    'publish_record "$ROTATION_INSTALLING" intent-v1 0600 expected_intent',
    'copy_root_file_atomically "$TARGET"',
    'require_interrupted_prefix_consistency',
    'copy_root_file_atomically "$STAGED_HELPER" "$INSTALLING_HELPER_PARTIAL"',
    'mv -- "$INSTALLING_HELPER" "$TARGET"',
    'require_interrupted_prefix_consistency',
    'publish_record "$ROTATION_INSTALLING" completed-v1 0600 expected_completion',
    'mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"',
    'require_exact_completed_namespace',
    'close_lock',
    'run_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256"',
    'require_stopped_durable_boundary',
    'open_lock',
    'require_exact_completed_namespace',
    'require_disabled_grant_only',
    'require_stopped_durable_boundary',
    'restore_sudoers',
    "grant_disabled='false'",
    'close_lock',
    'trap - EXIT',
  ],
  'H11 recovery must resume exact prefixes, self-attest, recheck the stopped binding boundary, and restore sudo last',
);
assert.equal(
  (runtimeBridgeV11RecoveryMain.match(/run_helper_direct stop/gu) ?? []).length,
  0,
  'H11 recovery must never repeat the already-completed predecessor stop',
);
assert.equal(
  (runtimeBridgeV11RecoveryMain.match(/visudo -cf \/etc\/sudoers/gu) ?? []).length,
  2,
  'both active-grant admission and final active-grant validation must check the complete sudoers configuration',
);

for (const artifact of [
  workflow,
  botWorkflow,
  kemerbetSessionWorkflow,
  qualityWorkflow,
  compose,
  helper,
  v3SuccessorHelperRotation,
  v3SuccessorHelperRotationV2,
  v3SuccessorHelperRotationV3,
  v3SuccessorHelperRotationV4,
  v3SuccessorHelperRotationV5,
  v3SuccessorHelperRotationV6,
  v3SuccessorHelperRotationV7,
  v3SuccessorHelperRotationV8,
  v3SuccessorHelperRotationV9,
  v3SuccessorHelperRotationV10,
  v3RuntimeBridgeHelperPromotionV11,
  v3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecovery,
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
  /Only source traversal omits the exact top-level\s+`SingletonCookie`, `SingletonLock`, and `SingletonSocket` entries/u,
  /Post-run re-attestation of the original profile uses a\s+separate `verify-original` command with only the source omission rule/u,
  /explicitly trusted, supervised enrollment ceremony/u,
  /compromised enrollment renderer is therefore outside the confidentiality\s+guarantee/u,
  /Compromised-renderer containment begins\s+after that close/u,
  /exact 230-byte v3 binding\. Only after that match does it pin the complete bearer digest in memory/u,
  /wrong\s+identity, bearer drift, races, aborts, and malformed responses are sticky-fatal/u,
  /two-field v1 identity binding cannot be upgraded in place/u,
  /`retire-v1-for-v2-reseal` mode of the manual `Staging private KemerBet\s+sign-in` workflow/u,
  /confirm_v1_binding_sha256/u,
  /I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL/u,
  /never invoke retirement automatically/u,
  /workflow never reads the target file to derive that expected value/u,
  /gh workflow run staging-kemerbet-session-provision\.yml --ref main/u,
  /-f mode=retire-v1-for-v2-reseal/u,
  /-f confirm_v1_binding_sha256='<independently-reviewed-64-lowercase-v1-file-sha256>'/u,
  /durable\s+root-owned intent and exact root-only archive/u,
  /global gate blocks helper or release\s+replacement and every unrelated state-expanding command/u,
  /explicit same-commit retirement\s+resume, the private-session start\/readiness\/seal sequence/u,
  /UUID and identity\s+fingerprint\s+project to the exact archived v1 SHA-256/u,
  /The retirement gate unlocks only after the recheck commits the immutable canonical v2 binding and\s+exact root-only success receipt/u,
  /Migration from v1 does not by itself\s+require changing the provider\s+token/u,
  /later provider-token rotation safely requires a new\s+supervised v2 seal/u,
  /`recover-v1-retirement-after-expiry`/u,
  /I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE/u,
  /separate `confirm_v1_retirement_release_sha` as the exact 40-character release/u,
  /requires the explicit release to be an ancestor of the current `GITHUB_SHA`/u,
  /helper, runtime-role provision SQL, and runtime-role disable SQL as canonical LF blobs with\s+`git show <release>:<fixed-path>`/u,
  /never computes or substitutes the retirement release from the current\s+workflow commit/u,
  /Before creating the 23-file bundle, making any remote mutation, uploading a path, or enabling a\s+database role/u,
  /read-only `kemerbet-v1-retirement-recovery-ready <explicit-release>` command/u,
  /clean\s+initial boundary or an exact helper-recognized safe-to-reset crash residue/u,
  /malformed residue, or foreign residue fails before any rollback flag is armed/u,
  /run the historical disable SQL,\s+invoke the SHA-verified helper `stop`, and call the same read-only preflight a second time/u,
  /second\s+result must be exactly clean before local bundle creation/u,
  /discards only an incomplete temp-only binding prefix/u,
  /complete\s+230-byte temp must first project to the archived v1 identity/u,
  /atomically hard-links it\s+to the absent final name, removes the temp link, synchronizes the directory/u,
  /reattests the same\s+inode, single link, and content/u,
  /final-plus-same-inode-temp crash.*removes only the\s+temp link and preserves the final v2 artifact/su,
  /preserved final is offline-finalized to\s+`resealed-awaiting-recheck`/u,
  /23-file bundle/u,
  /run-unique deploy-user-owned mode-`0700` staging directory/u,
  /captures that directory's device\/inode/u,
  /descriptor-relative atomic no-replace rename/u,
  /\/tmp\/fetanagent-kemerbet-v1-retirement-secrets-<40-lowercase-hex-release>/u,
  /After publication, the job provisions fresh 24-hour narrow database roles, then calls only\s+`reinstall-kemerbet-v1-retirement-secrets`/u,
  /private-core `start`, `arm-expiry-stop` at the derived time, `start-bot` and `bot-ready`, then\s+`start-public-edge` and `public-edge-ready`/u,
  /exact run-unique staging, incoming, or atomic `\.consumed` path/u,
  /preflight failure never deletes pre-existing\s+residue/u,
  /exactly two durable labeled project volumes/u,
  /`fetanagent-staging-beta_kemerbet_sessions` and\s+`fetanagent-staging-beta_kemerbet_session_control`/u,
  /exact `local` driver and scope,\s+null options, exactly the project\/Compose-version\/volume labels/u,
  /UID\/GID `10001:10001`\s+mode-`0700` roots, and zero container holders/u,
  /third project volume, any\s+readiness snapshot\/RPC\/output volume, transient container or network/u,
  /`resealed-awaiting-recheck` must not start another private session/u,
  /proxy RCE or proxy-process\s+compromise is outside this fail-closed guarantee/u,
  /terminates KemerBet TLS, necessarily sees\s+the current bearer and Player identifier, and owns the only egress route/u,
  /depends on the pinned, reviewed image and source,\s+plus the documented privilege, network, mount, and lifecycle isolation/u,
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
  /confirm_v1_binding_sha256:/,
  /confirm_v1_retirement:/,
  /CONFIRMED_V1_BINDING_SHA256/,
  /CONFIRMED_V1_RETIREMENT/,
  /\^\(inspect\|start\|retire-v1-for-v2-reseal\|seal\|recheck\|stop\)\$/,
  /\^\[0-9a-f\]\{40\}\$/,
  /\^\[1-9\]\[0-9\]\{7,19\}\$/,
  /\^\[0-9a-f\]\{64\}\$/,
  /I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL/,
  /environment: staging/,
  /persist-credentials: false/,
  /StrictHostKeyChecking=yes/g,
  /fetanagent-staging-deploy-helper verify/,
  /fetanagent-staging-deploy-helper start-kemerbet-session-provision/,
  /fetanagent-staging-deploy-helper kemerbet-session-provision-ready/,
  /fetanagent-staging-deploy-helper retire-kemerbet-readiness-binding-v1-for-v2-reseal '\$GITHUB_SHA' '\$CONFIRMED_V1_BINDING_SHA256' '\$CONFIRMED_V1_RETIREMENT'/,
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
  /private_kemerbet_v1_binding_retired_for_v2_reseal=confirmed/,
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
const exactV1RetirementCommand =
  "fetanagent-staging-deploy-helper retire-kemerbet-readiness-binding-v1-for-v2-reseal '$GITHUB_SHA' '$CONFIRMED_V1_BINDING_SHA256' '$CONFIRMED_V1_RETIREMENT'";
assert.equal(
  kemerbetSessionWorkflow.split(exactV1RetirementCommand).length - 1,
  1,
  'the destructive v1 retirement command must occur exactly once, in its explicit workflow mode',
);
const explicitV1RetirementAction = /\n\s+retire-v1-for-v2-reseal\)\n([\s\S]*?)\n\s+;;/u.exec(
  privateSignInAction,
)?.[1];
assert.ok(
  explicitV1RetirementAction,
  'the private sign-in workflow must isolate v1 retirement in one explicit case branch',
);
for (const explicitRetirementGuard of [
  /CONFIRMED_V1_BINDING_SHA256" =~ \^\[0-9a-f\]\{64\}\$/,
  /CONFIRMED_V1_RETIREMENT" == 'I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL'/,
  /retire-kemerbet-readiness-binding-v1-for-v2-reseal '\$GITHUB_SHA' '\$CONFIRMED_V1_BINDING_SHA256' '\$CONFIRMED_V1_RETIREMENT'/,
  /private_kemerbet_v1_binding_retired_for_v2_reseal=confirmed/,
]) {
  assert.match(explicitV1RetirementAction, explicitRetirementGuard);
}
assert.doesNotMatch(
  explicitV1RetirementAction,
  /sha256sum|kemerbet_agent_identity_bindings|KEMERBET_READINESS_BINDING|docker[^\r\n]*(?:binding|sha256)/iu,
  'the workflow must use only the independently reviewed user-supplied v1 SHA-256 and never derive it from the target binding',
);
for (const nonRetirementMode of ['start', 'inspect', 'seal', 'recheck']) {
  const modeAction = new RegExp(`\\n\\s+${nonRetirementMode}\\)\\n([\\s\\S]*?)\\n\\s+;;`, 'u').exec(
    privateSignInAction,
  )?.[1];
  assert.ok(modeAction, `the ${nonRetirementMode} private-session action must remain explicit`);
  assert.doesNotMatch(
    modeAction,
    /retire-kemerbet-readiness-binding-v1-for-v2-reseal/u,
    `the ${nonRetirementMode} mode must never retire a v1 binding automatically`,
  );
}
for (const workflowWithoutRetirementAuthority of [workflow, botWorkflow]) {
  assert.doesNotMatch(
    workflowWithoutRetirementAuthority,
    /retire-kemerbet-readiness-binding-v1-for-v2-reseal/u,
    'deploy and bot workflows must never invoke the explicit v1 retirement command',
  );
}
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
assert.match(workflow, /^\s+- recover-v1-retirement-after-expiry$/m);
assert.match(workflow, /^\s+- predecessor-stop-and-disable$/m);
assert.match(workflow, /^\s+- ecd47f5d-predecessor-stop-and-disable$/m);
assert.match(workflow, /stop-legacy-staging-runtime/);
assert.match(workflow, /stop-current-staging-predecessor-runtime/);
assert.match(workflow, /stop-exact-ecd47f5d-staging-predecessor-runtime/);
assert.match(
  workflow,
  /\^\(plan\|transition-ssh-verify\|transition-stop-legacy\|unban-and-connectivity-check\|deploy-and-smoke\|recover-v1-retirement-after-expiry\|predecessor-stop-and-disable\|ecd47f5d-predecessor-stop-and-disable\|stop-and-disable\)\$/,
);
assert.match(
  workflow,
  /elif \[\[ "\$REQUESTED_MODE" == 'ecd47f5d-predecessor-stop-and-disable' \]\]; then\s+\[\[ "\$CONFIRMED_LEGACY_STOP" == 'stop-exact-ecd47f5d-staging-predecessor-runtime' \]\]\s+\[\[ -z "\$CONFIRMED_V1_RETIREMENT_RECOVERY" \]\]\s+\[\[ -z "\$CONFIRMED_V1_RETIREMENT_RELEASE" \]\]/u,
  'The exact installed-predecessor cleanup mode must require its own typed confirmation and reject every retirement-recovery input.',
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
assert.match(workflow, /fetanagent-staging-deploy-helper network-ready/g);
assert.match(workflow, /fetanagent-staging-deploy-helper diagnose-owner-startup/g);
assert.match(workflow, /fetanagent-staging-deploy-helper stop/g);
assert.match(workflow, /fetanagent-staging-deploy-helper discard/g);
assert.match(
  workflow,
  /fetanagent-staging-deploy-helper arm-expiry-stop '\$GITHUB_SHA' '\$STOP_AT'/g,
);
assertInOrder(
  workflow,
  [
    '- name: Transfer and install sealed release inputs',
    "fetanagent-staging-deploy-helper install '$GITHUB_SHA' '${GITHUB_SHA:0:12}' '$incoming'",
    '- name: Arm the host-local stop before database credential expiry',
    "fetanagent-staging-deploy-helper arm-expiry-stop '$GITHUB_SHA' '$STOP_AT'",
    '- name: Start the private staging profile and smoke readiness',
    "fetanagent-staging-deploy-helper fresh-start '$GITHUB_SHA' '${GITHUB_SHA:0:12}'",
    "fetanagent-staging-deploy-helper bot-disabled-ready '$GITHUB_SHA'",
  ],
  'the deployment must install the stopped successor, arm its exact expiry guard, and only then start and attest the private bot-disabled runtime',
);

assertInOrder(
  workflow,
  [
    '- name: Verify the immutable KemerBet overlay and runtime bridge before stopping staging',
    '- name: Verify enough Docker storage before any staging downtime',
    '- name: Stop any prior staging project and disable old logins',
  ],
  'the deployment must reject insufficient Docker storage before it stops a working staging release',
);
const preDowntimeStorage =
  /- name: Verify enough Docker storage before any staging downtime([\s\S]*?)\n\s+- name: Stop any prior staging project and disable old logins/u.exec(
    workflow,
  )?.[1];
assert.ok(preDowntimeStorage, 'the deployment must contain the bounded pre-downtime disk check');
assert.match(
  preDowntimeStorage,
  /stat --format='%s' "\$RUNNER_TEMP\/release\/fetanagent-staging-images\.tar"/,
);
assertInOrder(
  preDowntimeStorage,
  [
    'fetanagent-staging-deploy-helper verify',
    'fetanagent-staging-deploy-helper docker-storage-ready',
    "'$bundle_bytes'",
  ],
  'the unprivileged workflow must pass only the local bundle size to the narrow root-owned storage attestation',
);
assert.equal((preDowntimeStorage.match(/^\s*ssh\s/gm) ?? []).length, 1);
assert.equal(
  (preDowntimeStorage.match(/sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper/g) ?? [])
    .length,
  2,
);
assert.doesNotMatch(
  preDowntimeStorage,
  /\bdf\b|\/var\/lib\/docker|bundle_bytes \* 2|available_bytes|docker_(?:local|root)|docker\s+(?:image|container|volume|system|compose)|rm\b|prune|database/iu,
  'the workflow must not inspect the protected Docker data root or perform a storage mutation itself',
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

const retirementRecoveryInput =
  /\n      confirm_v1_retirement_recovery:\n([\s\S]*?)\n      confirm_v1_retirement_release_sha:/u.exec(
    workflow,
  )?.[1];
assert.ok(retirementRecoveryInput, 'The explicit v1-retirement recovery input must exist.');
assert.match(
  retirementRecoveryInput,
  /description: For recover-v1-retirement-after-expiry type I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE/,
);
assert.match(retirementRecoveryInput, /^\s*required: false$/m);
assert.match(retirementRecoveryInput, /^\s*default: ''$/m);
assert.doesNotMatch(retirementRecoveryInput, /^\s*required: true$/m);
const retirementReleaseInput =
  /\n      confirm_v1_retirement_release_sha:\n([\s\S]*?)\n\npermissions:/u.exec(workflow)?.[1];
assert.ok(retirementReleaseInput, 'The explicit retirement-release input must exist.');
assert.match(retirementReleaseInput, /exact 40-character retirement release commit SHA/);
assert.match(retirementReleaseInput, /^\s*required: false$/m);
assert.match(retirementReleaseInput, /^\s*default: ''$/m);
assert.doesNotMatch(retirementReleaseInput, /^\s*required: true$/m);

const validateTarget = /\n  validate-target:\n([\s\S]*?)\n  build:\n/u.exec(workflow)?.[1];
assert.ok(validateTarget, 'The exact-target validation job must exist.');
assert.match(validateTarget, /CONFIRMED_LEGACY_STOP: \$\{\{ inputs\.confirm_legacy_stop \}\}/);
assert.match(
  validateTarget,
  /CONFIRMED_V1_RETIREMENT_RECOVERY: \$\{\{ inputs\.confirm_v1_retirement_recovery \}\}/,
);
assert.match(
  validateTarget,
  /CONFIRMED_V1_RETIREMENT_RELEASE: \$\{\{ inputs\.confirm_v1_retirement_release_sha \}\}/,
);
const retirementValidationBranch =
  /elif \[\[ "\$REQUESTED_MODE" == 'recover-v1-retirement-after-expiry' \]\]; then([\s\S]*?)\n\s+else/u.exec(
    validateTarget,
  )?.[1];
assert.ok(
  retirementValidationBranch,
  'The recovery mode must have one exclusive validation branch.',
);
assert.match(retirementValidationBranch, /\[\[ -z "\$CONFIRMED_LEGACY_STOP" \]\]/);
assert.match(
  retirementValidationBranch,
  /\[\[ "\$CONFIRMED_V1_RETIREMENT_RECOVERY" == \\\s+'I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE' \]\]/u,
);
assert.match(
  retirementValidationBranch,
  /\[\[ "\$CONFIRMED_V1_RETIREMENT_RELEASE" =~ \^\[0-9a-f\]\{40\}\$ \]\]/,
);
assert.equal(
  (validateTarget.match(/\[\[ -z "\$CONFIRMED_V1_RETIREMENT_RECOVERY" \]\]/g) ?? []).length,
  4,
  'Every non-recovery validation branch must reject the recovery confirmation.',
);
assert.equal(
  (validateTarget.match(/\[\[ -z "\$CONFIRMED_V1_RETIREMENT_RELEASE" \]\]/g) ?? []).length,
  4,
  'Every non-recovery validation branch must reject an explicit retirement release.',
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
assert.match(workflow, /name: Prove persistent Chromium closes and restores cleanly/);
assert.match(
  workflow,
  /timeout 150s docker run --rm[\s\S]*?--network none[\s\S]*?--read-only[\s\S]*?--user 10001:10001[\s\S]*?--cap-drop ALL[\s\S]*?--security-opt no-new-privileges:true[\s\S]*?--pids-limit 256[\s\S]*?--memory 768m[\s\S]*?--cpus 2[\s\S]*?--shm-size 256m[\s\S]*?--tmpfs \/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=268435456[\s\S]*?--entrypoint node[\s\S]*?"fetanagent-deposit-executor:\$tag"[\s\S]*?apps\/executor\/dist\/kemerbet-persistent-browser-checkpoint-smoke\.js[\s\S]*?2>\/dev\/null/,
  'the exact executor image must prove a clean persistent-browser checkpoint in an isolated disposable container',
);
assert.match(
  workflow,
  /test "\$checkpoint_smoke_output" = 'KEMERBET_PERSISTENT_BROWSER_CHECKPOINT_SMOKE_OK'/,
);
assert.ok(
  workflow.indexOf('Prove persistent Chromium closes and restores cleanly') >
    workflow.indexOf('Build commit-labelled images without runtime secrets') &&
    workflow.indexOf('Prove persistent Chromium closes and restores cleanly') <
      workflow.indexOf('Save sealed images for the deployment job'),
  'the clean-checkpoint smoke must pass before the executor image can enter the deployment bundle',
);
assert.match(
  workflow,
  /docker save --output "\$RUNNER_TEMP\/fetanagent-staging-images\.tar"[\s\S]*?"fetanagent-gateway:\$tag"[\s\S]*?"fetanagent-deposit-executor:\$tag"/,
);
assert.match(workflow, /org\.opencontainers\.image\.revision/);
assert.match(workflow, /http:\/\/127\.0\.0\.1:3002\/readyz/);
assert.match(workflow, /stop-and-disable/);
assert.match(workflow, /infra\/sql\/staging-runtimes-disable\.sql/g);
const deployJob = /\n  deploy:\n([\s\S]*?)\n  recover-v1-retirement:\n/u.exec(workflow)?.[1];
assert.ok(deployJob, 'The guarded staging deployment job must exist.');
assert.doesNotMatch(
  deployJob,
  /fetanagent-staging-deploy-helper start '\$GITHUB_SHA'/,
  'Fresh-host staging must not invoke the retired cutover-only start path.',
);
assert.doesNotMatch(
  deployJob,
  /network-bans remove|--db-unban-ip/,
  'Deploy mode must never mutate the Supabase network-ban list.',
);
const retirementRecoveryJob = /\n  recover-v1-retirement:\n([\s\S]*?)\n  stop:\n/u.exec(
  workflow,
)?.[1];
assert.ok(
  retirementRecoveryJob,
  'The dedicated same-release v1-retirement recovery job must exist.',
);
assert.match(retirementRecoveryJob, /if: inputs\.mode == 'recover-v1-retirement-after-expiry'/);
assert.match(retirementRecoveryJob, /^    needs: validate-target$/m);
assert.doesNotMatch(retirementRecoveryJob, /^    needs:.*\bbuild\b/m);
assert.match(retirementRecoveryJob, /^    runs-on: ubuntu-24\.04$/m);
assert.match(retirementRecoveryJob, /^    timeout-minutes: 25$/m);
assert.match(retirementRecoveryJob, /^    environment: staging$/m);
assert.match(retirementRecoveryJob, /permissions:\s+contents: read/u);
assert.equal(
  (retirementRecoveryJob.match(/^\s*uses:/gm) ?? []).length,
  1,
  'Recovery may invoke only the pinned source checkout action.',
);
assert.match(
  retirementRecoveryJob,
  /uses: actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4\.2\.2/,
);
assert.match(retirementRecoveryJob, /fetch-depth: 0/);
assert.match(retirementRecoveryJob, /persist-credentials: false/);
assert.match(
  retirementRecoveryJob,
  /CONFIRMED_V1_RETIREMENT_RECOVERY: \$\{\{ inputs\.confirm_v1_retirement_recovery \}\}/,
);
assert.match(
  retirementRecoveryJob,
  /CONFIRMED_V1_RETIREMENT_RELEASE: \$\{\{ inputs\.confirm_v1_retirement_release_sha \}\}/,
);
assert.match(
  retirementRecoveryJob,
  /\[\[ "\$CONFIRMED_V1_RETIREMENT_RECOVERY" == \\\s+'I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE' \]\]/u,
);
const retirementRecoveryRun = /\n        run: \|\n([\s\S]*)$/u.exec(retirementRecoveryJob)?.[1];
assert.ok(retirementRecoveryRun, 'The recovery-only shell contract must exist.');
assert.doesNotMatch(
  retirementRecoveryRun,
  /\$\{\{/u,
  'Untrusted workflow inputs must enter the recovery shell only through its environment.',
);
assert.match(retirementRecoveryRun, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/);
assert.match(
  retirementRecoveryRun,
  /\[\[ "\$GITHUB_SHA" =~ \^\[0-9a-f\]\{40\}\$ && "\$CONFIRMED_V1_RETIREMENT_RELEASE" =~ \^\[0-9a-f\]\{40\}\$ \]\]/,
);
for (const releaseProvenanceContract of [
  /\[\[ "\$\(git rev-parse HEAD\)" == "\$GITHUB_SHA" \]\]/,
  /release_sha="\$CONFIRMED_V1_RETIREMENT_RELEASE"/,
  /\[\[ "\$\(git rev-parse "\$release_sha\^\{commit\}"\)" == "\$release_sha" \]\]/,
  /git merge-base --is-ancestor "\$release_sha" "\$GITHUB_SHA"/,
  /contract_dir="\$RUNNER_TEMP\/v1-retirement-contract"/,
  /git cat-file -t "\$release_sha:\$source_path"/,
  /git show "\$release_sha:\$source_path" >"\$contract_dir\/\$target_name"/,
  /not raw\.endswith\(b'\\n'\)/,
  /b'\\r' in raw/,
  /b'\\0' in raw/,
  /raw\.decode\('utf-8', errors='strict'\)/,
  /bash -n "\$contract_dir\/fetanagent-staging-deploy-helper\.sh"/,
]) {
  assert.match(retirementRecoveryRun, releaseProvenanceContract);
}
const retirementRecoveryContracts =
  /\n          recovery_contracts=\(\n([\s\S]*?)\n          \)/u.exec(retirementRecoveryJob)?.[1];
assert.ok(
  retirementRecoveryContracts,
  'Recovery must enumerate its exact historical contract blobs.',
);
assert.deepEqual(
  retirementRecoveryContracts
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/^'|'$/gu, '')),
  [
    'infra/operations/fetanagent-staging-deploy-helper.sh:fetanagent-staging-deploy-helper.sh',
    'infra/sql/staging-runtimes-provision-for-deploy.sql:staging-runtimes-provision-for-deploy.sql',
    'infra/sql/staging-runtimes-disable.sql:staging-runtimes-disable.sql',
  ],
  'Recovery may derive only the exact helper and role provision/disable contracts from the retirement release.',
);

const expectedRetirementRecoverySecrets = [
  'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET',
  'API_TELEGRAM_CAPABILITY_HMAC_SECRET',
  'API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET',
  'BETA_ADMISSION_PAYLOAD_HMAC_SECRET',
  'BETA_ADMISSION_RUNTIME_PASSWORD',
  'BOT_TO_API_ACTION_HMAC_SECRET',
  'BOT_TO_BETA_ADMISSION_HMAC_SECRET',
  'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET',
  'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET',
  'CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET',
  'CUSTOMER_WEB_RUNTIME_PASSWORD',
  'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
  'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
  'OWNER_CONTROL_RUNTIME_PASSWORD',
  'PLAYER_ACTION_RUNTIME_PASSWORD',
  'STAGING_SUPABASE_PUBLISHABLE_KEY',
  'STAGING_TELEGRAM_BOT_TOKEN',
  'STAGING_VM_HOST',
  'STAGING_VM_KNOWN_HOSTS',
  'STAGING_VM_SSH_PRIVATE_KEY',
  'SUPABASE_CA_CERTIFICATE_PEM',
  'SUPABASE_DB_PASSWORD',
];
const retirementRecoverySecrets = [
  ...retirementRecoveryJob.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/gu),
].map((match) => match[1]);
assert.deepEqual(
  [...retirementRecoverySecrets].sort(),
  expectedRetirementRecoverySecrets,
  'The recovery job may receive only the exact reviewed 22 protected inputs.',
);
assert.deepEqual(
  [...retirementRecoveryJob.matchAll(/\$\{\{ vars\.([A-Z0-9_]+) \}\}/gu)]
    .map((match) => match[1])
    .sort(),
  [
    'CBE_DEPOSIT_REFERENCE_KEY_PROFILE_V1_JSON',
    'DEPOSIT_PROOF_REFERENCE_PROFILE_V2_JSON',
    'STAGING_TELEGRAM_BOT_TOKEN_SHA256',
  ],
  'Recovery may receive only the exact two key profiles and approved bot-token fingerprint.',
);
assert.match(retirementRecoveryJob, /telegram\('getMe'\)/);
assert.match(retirementRecoveryJob, /telegram\('getWebhookInfo'\)/);
assert.match(retirementRecoveryJob, /identity\.username\.toLowerCase\(\) !== 'fetanagentbot'/);
assert.match(retirementRecoveryJob, /webhook\.url !== ''/);
assert.match(retirementRecoveryJob, /webhook\.pending_update_count !== 0/);
assert.doesNotMatch(retirementRecoveryJob, /deleteWebhook|drop_pending_updates|setWebhook/);

const retirementRecoveryBundle = /\n          bundle_files=\(\n([\s\S]*?)\n          \)/u.exec(
  retirementRecoveryJob,
)?.[1];
assert.ok(retirementRecoveryBundle, 'The exact recovery secret bundle must be enumerated.');
const retirementRecoveryBundleFiles = retirementRecoveryBundle.trim().split(/\s+/u);
assert.deepEqual(retirementRecoveryBundleFiles, [
  'api-action-capability-hmac',
  'api-action-payload-hmac',
  'api-action-semantic-hmac',
  'api-action-transport-hmac',
  'beta-database-url',
  'beta-payload-hmac',
  'beta-transport-hmac',
  'bot-action-transport-hmac',
  'bot-token',
  'bot-transport-hmac',
  'cbe-deposit-reference-encryption-key',
  'cbe-deposit-reference-fingerprint-key',
  'cbe-deposit-reference-key-profile.v1.json',
  'customer-web-database-url',
  'customer-web-publishable-key',
  'customer-web-rate-limit-hmac',
  'deposit-proof-reference-encryption-master',
  'deposit-proof-reference-fingerprint-master',
  'deposit-proof-reference-profile.v2.json',
  'owner-database-url',
  'player-action-database-url',
  'publishable-key',
  'supabase-ca.crt',
]);
assert.match(retirementRecoveryJob, /\[\[ "\$\{#bundle_files\[@\]\}" -eq 23 \]\]/);
assert.match(
  retirementRecoveryJob,
  /incoming="\/tmp\/fetanagent-kemerbet-v1-retirement-secrets-\$release_sha"/,
);
assert.match(
  retirementRecoveryJob,
  /\[\[ "\$incoming" =~ \^\/tmp\/fetanagent-kemerbet-v1-retirement-secrets-\[0-9a-f\]\{40\}\$ \]\]/,
);
assert.match(
  retirementRecoveryJob,
  /\[\[ "\$GITHUB_RUN_ID" =~ \^\[1-9\]\[0-9\]\*\$ && "\$GITHUB_RUN_ATTEMPT" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/,
);
assert.match(
  retirementRecoveryJob,
  /remote_bundle_staging="\/tmp\/fetanagent-kemerbet-v1-retirement-secrets-stage-\$release_sha-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/,
);
assert.match(
  retirementRecoveryJob,
  /\[\[ "\$remote_bundle_staging" =~ \^\/tmp\/fetanagent-kemerbet-v1-retirement-secrets-stage-\[0-9a-f\]\{40\}-\[1-9\]\[0-9\]\*-\[1-9\]\[0-9\]\*\$ \]\]/,
);
assert.match(
  retirementRecoveryJob,
  /connection_dir="\$RUNNER_TEMP\/v1-retirement-recovery-session"/,
);
assert.match(retirementRecoveryJob, /secret_dir="\$RUNNER_TEMP\/v1-retirement-recovery-bundle"/);
assert.match(retirementRecoveryJob, /install -d -m 0700 "\$connection_dir"/);
assert.match(retirementRecoveryJob, /install -d -m 0700 "\$secret_dir"/);
const retirementRecoveryRemoteDirectoryCreate = String.raw`install -d -m 0700 \"\$staging\"`;
assert.ok(retirementRecoveryJob.includes(retirementRecoveryRemoteDirectoryCreate));
assert.match(
  retirementRecoveryJob,
  /stat --format='%U:%a' \\"\\\$staging\\"\)\\" == 'fetanagent-admin:700'/,
);
assert.match(retirementRecoveryJob, /\[\[ ! -e \\"\\\$incoming\\" && ! -L \\"\\\$incoming\\" \]\]/);
assert.match(
  retirementRecoveryJob,
  /\[\[ ! -e \\"\\\$incoming\.consumed\\" && ! -L \\"\\\$incoming\.consumed\\" \]\]/,
);
assert.match(retirementRecoveryJob, /chmod 0600 \\"\\\$staging\\"\/\*/);
assert.match(retirementRecoveryJob, /-type f \| wc -l\)\\" -eq 23/);
assert.match(
  retirementRecoveryJob,
  /scp "\$\{ssh_opts\[@\]\}" "\$\{bundle_files\[@\]\/\#\/\$secret_dir\/\}" "\$remote:\$remote_bundle_staging\/"/,
);
assert.match(retirementRecoveryJob, /StrictHostKeyChecking=yes/);
assert.match(retirementRecoveryJob, /UserKnownHostsFile=/);
assert.match(
  retirementRecoveryJob,
  /sha256sum "\$contract_dir\/fetanagent-staging-deploy-helper\.sh"/,
);
assert.match(
  retirementRecoveryJob,
  /remote_prefix="test \\"\\\$\(id -u\)\\" -ne 0 && test \\"\\\$\(id -un\)\\" = 'fetanagent-admin' && sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper verify '\$helper_sha'"/,
);
const retirementRecoveryPreflight =
  "fetanagent-staging-deploy-helper kemerbet-v1-retirement-recovery-ready '$release_sha'";
const retirementRecoveryPreflightIndex = retirementRecoveryJob.indexOf(retirementRecoveryPreflight);
const retirementRecoveryCleanPreflightIndex = retirementRecoveryJob.lastIndexOf(
  retirementRecoveryPreflight,
);
assert.ok(
  retirementRecoveryPreflightIndex >= 0,
  'Recovery must call the exact historical helper read-only retirement readiness command.',
);
assert.equal(
  (retirementRecoveryJob.match(/kemerbet-v1-retirement-recovery-ready '\$release_sha'/g) ?? [])
    .length,
  2,
  'Recovery must use one read-only safe-reset classifier and one post-normalization clean preflight.',
);
assert.match(
  retirementRecoveryJob,
  /recovery_preflight_state="\$\(ssh[\s\S]*?\[\[ "\$recovery_preflight_state" == 'KemerBet v1 retirement recovery preflight: clean\.' \|\| \\\s+"\$recovery_preflight_state" == 'KemerBet v1 retirement recovery preflight: safe-to-reset\.' \]\]/u,
);
assert.match(
  retirementRecoveryJob,
  /recovery_clean_state="\$\(ssh[\s\S]*?\[\[ "\$recovery_clean_state" == 'KemerBet v1 retirement recovery preflight: clean\.' \]\]/u,
);
const retirementRecoveryBundleCreateIndex = retirementRecoveryJob.indexOf(
  'install -d -m 0700 "$secret_dir"',
);
const retirementRecoveryResetMutationIndex = retirementRecoveryJob.indexOf(
  "recovery_mutation_attempted='true'",
);
const retirementRecoveryDisableFlagIndex = retirementRecoveryJob.indexOf(
  "roles_disable_attempted='true'",
);
const retirementRecoveryInitialDisableIndex = retirementRecoveryJob.indexOf(
  'psql -X --file="$contract_dir/staging-runtimes-disable.sql"',
  retirementRecoveryDisableFlagIndex,
);
const retirementRecoveryResetStopIndex = retirementRecoveryJob.indexOf(
  'fetanagent-staging-deploy-helper stop',
  retirementRecoveryInitialDisableIndex,
);
assert.ok(
  retirementRecoveryJob.indexOf("recovery_mutation_attempted='false'") <
    retirementRecoveryPreflightIndex &&
    retirementRecoveryJob.indexOf("remote_bundle_owned_by_run='false'") <
      retirementRecoveryPreflightIndex &&
    retirementRecoveryJob.indexOf("roles_disable_attempted='false'") <
      retirementRecoveryPreflightIndex &&
    retirementRecoveryJob.indexOf("roles_provision_attempted='false'") <
      retirementRecoveryPreflightIndex &&
    retirementRecoveryPreflightIndex < retirementRecoveryResetMutationIndex &&
    retirementRecoveryResetMutationIndex < retirementRecoveryDisableFlagIndex &&
    retirementRecoveryDisableFlagIndex < retirementRecoveryInitialDisableIndex &&
    retirementRecoveryInitialDisableIndex < retirementRecoveryResetStopIndex &&
    retirementRecoveryResetStopIndex < retirementRecoveryCleanPreflightIndex &&
    retirementRecoveryCleanPreflightIndex < retirementRecoveryBundleCreateIndex &&
    retirementRecoveryCleanPreflightIndex <
      retirementRecoveryJob.indexOf(retirementRecoveryRemoteDirectoryCreate) &&
    retirementRecoveryCleanPreflightIndex <
      retirementRecoveryJob.indexOf("roles_provision_attempted='true'"),
  'The first exact release/context/full-expiry preflight must remain read-only; only a safe result may arm cleanup, disable stale roles, and run verified stop, and the second preflight must prove clean state before bundle creation, upload, or role provisioning.',
);
assert.ok(
  retirementRecoveryJob.indexOf(
    "sudo -n /usr/local/sbin/fetanagent-staging-deploy-helper verify '$helper_sha'",
  ) < retirementRecoveryPreflightIndex,
  'The installed historical helper SHA must be verified before its read-only recovery preflight.',
);

assert.match(retirementRecoveryJob, /trap 'cleanup "\$\?"' EXIT/);
assert.match(retirementRecoveryJob, /recovery_mutation_attempted='false'/);
assert.match(retirementRecoveryJob, /remote_bundle_dev_ino=''/);
assert.match(retirementRecoveryJob, /remote_bundle_owned_by_run='false'/);
assert.match(retirementRecoveryJob, /roles_disable_attempted='false'/);
assert.match(retirementRecoveryJob, /roles_provision_attempted='false'/);
assert.ok(
  retirementRecoveryResetMutationIndex < retirementRecoveryCleanPreflightIndex &&
    retirementRecoveryCleanPreflightIndex <
      retirementRecoveryJob.indexOf(retirementRecoveryRemoteDirectoryCreate),
  'Rollback authority must be armed for safe reset, while remote bundle creation remains blocked until the clean preflight succeeds.',
);
assert.ok(
  retirementRecoveryJob.indexOf("roles_provision_attempted='true'") <
    retirementRecoveryJob.indexOf(
      'psql -X --file="$contract_dir/staging-runtimes-provision-for-deploy.sql"',
    ),
  'Role cleanup must be armed before the transactional role provisioning attempt.',
);
const retirementRecoveryResetCleanup =
  /\n          cleanup_recovery_reset\(\) \{([\s\S]*?)\n          \}\n          trap 'cleanup_recovery_reset "\$\?"' EXIT/u.exec(
    retirementRecoveryJob,
  )?.[1];
assert.ok(
  retirementRecoveryResetCleanup,
  'Safe-reset mutations must install rollback before the first read-only classifier returns.',
);
assert.match(
  retirementRecoveryResetCleanup,
  /"\$original_status" -ne 0 && "\$recovery_mutation_attempted" == 'true'/,
);
assert.match(retirementRecoveryResetCleanup, /fetanagent-staging-deploy-helper stop/);
assert.match(
  retirementRecoveryResetCleanup,
  /"\$original_status" -ne 0 && "\$roles_disable_attempted" == 'true'/,
);
assert.match(
  retirementRecoveryResetCleanup,
  /psql -X --file="\$contract_dir\/staging-runtimes-disable\.sql" \|\| database_status=\$\?/,
);
const retirementRecoveryCleanup =
  /\n          cleanup\(\) \{([\s\S]*?)\n          \}\n          trap 'cleanup "\$\?"' EXIT/u.exec(
    retirementRecoveryJob,
  )?.[1];
assert.ok(retirementRecoveryCleanup, 'The recovery job must install an exact EXIT cleanup.');
assert.match(
  retirementRecoveryCleanup,
  /"\$original_status" -ne 0 && "\$recovery_mutation_attempted" == 'true'/,
);
assert.match(
  retirementRecoveryCleanup,
  /"\$remote_prefix && sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper stop"/,
);
assert.match(retirementRecoveryCleanup, /cleanup_remote_bundle \|\| cleanup_status=\$\?/);
assert.match(
  retirementRecoveryCleanup,
  /"\$original_status" -ne 0 && \\\s+\( "\$roles_disable_attempted" == 'true' \|\| "\$roles_provision_attempted" == 'true' \)/u,
);
assert.match(
  retirementRecoveryCleanup,
  /if \[\[ "\$remote_bundle_owned_by_run" == 'true' \]\]; then\s+cleanup_remote_bundle \|\| cleanup_status=\$\?\s+fi/u,
);
assert.match(
  retirementRecoveryCleanup,
  /psql -X --file="\$contract_dir\/staging-runtimes-disable\.sql" \|\| database_status=\$\?/,
);
assert.match(
  retirementRecoveryCleanup,
  /"\$connection_dir" == "\$RUNNER_TEMP\/v1-retirement-recovery-session"/,
);
assert.match(
  retirementRecoveryCleanup,
  /"\$secret_dir" == "\$RUNNER_TEMP\/v1-retirement-recovery-bundle"/,
);
assert.match(retirementRecoveryCleanup, /rm -rf -- "\$connection_dir"/);
assert.match(retirementRecoveryCleanup, /rm -rf -- "\$secret_dir"/);
assert.ok(
  retirementRecoveryCleanup.indexOf('fetanagent-staging-deploy-helper stop') <
    retirementRecoveryCleanup.indexOf('cleanup_remote_bundle'),
  'SHA-verified helper teardown must remove consumed residue before the independent incoming-path cleanup.',
);
const retirementRecoveryRemoteCleanup =
  /\n          cleanup_remote_bundle\(\) \{([\s\S]*?)\n          \}\n\n          cleanup\(\)/u.exec(
    retirementRecoveryJob,
  )?.[1];
assert.ok(
  retirementRecoveryRemoteCleanup,
  'The recovery job must independently clean only its exact remote incoming paths.',
);
assert.match(
  retirementRecoveryRemoteCleanup,
  /ssh "\$\{ssh_opts\[@\]\}" "\$remote" \\\s+"bash -s -- '\$incoming' '\$remote_bundle_staging' '\$remote_bundle_dev_ino'" <<'REMOTE_CLEANUP'/u,
);
assert.match(
  retirementRecoveryRemoteCleanup,
  /\^\/tmp\/fetanagent-kemerbet-v1-retirement-secrets-\[0-9a-f\]\{40\}\$/,
);
assert.match(retirementRecoveryRemoteCleanup, /staging="\$2"\s+expected_dev_ino="\$3"/u);
assert.match(
  retirementRecoveryRemoteCleanup,
  /\^\/tmp\/fetanagent-kemerbet-v1-retirement-secrets-stage-\[0-9a-f\]\{40\}-\[1-9\]\[0-9\]\*-\[1-9\]\[0-9\]\*\$/,
);
assert.match(retirementRecoveryRemoteCleanup, /\^\[0-9\]\+:\[0-9\]\+\$/);
const retirementRecoveryCleanupAllowlist =
  /\n          allowed_names=\(\n([\s\S]*?)\n          \)/u.exec(
    retirementRecoveryRemoteCleanup,
  )?.[1];
assert.ok(
  retirementRecoveryCleanupAllowlist,
  'Remote cleanup must enumerate the bounded recovery-bundle filename allowlist.',
);
assert.deepEqual(
  retirementRecoveryCleanupAllowlist.trim().split(/\s+/u),
  retirementRecoveryBundleFiles,
  'Remote cleanup may inspect and purge only the same exact 23 recovery bundle names.',
);
assert.equal(
  (
    retirementRecoveryRemoteCleanup.match(
      /for candidate in "\$staging" "\$incoming" "\$incoming\.consumed"; do/g,
    ) ?? []
  ).length,
  3,
  'Cleanup must inventory, purge, and attest absence of only the run staging path and its two publication states.',
);
assert.match(retirementRecoveryRemoteCleanup, /present_count=\$\(\(present_count \+ 1\)\)/);
assert.match(retirementRecoveryRemoteCleanup, /"\$present_count" -gt 1/);
assert.match(retirementRecoveryRemoteCleanup, /realpath -- "\$candidate"/);
assert.match(retirementRecoveryRemoteCleanup, /'fetanagent-admin:700'/);
assert.match(
  retirementRecoveryRemoteCleanup,
  /stat --format='%d:%i' "\$candidate"\)" != "\$expected_dev_ino"/,
);
assert.match(retirementRecoveryRemoteCleanup, /find -P "\$candidate" -mindepth 1 -maxdepth 1/);
assert.match(retirementRecoveryRemoteCleanup, /stat --format='%U:%a:%h' "\$target"/);
assert.match(retirementRecoveryRemoteCleanup, /'fetanagent-admin:600:1'/);
assert.match(retirementRecoveryRemoteCleanup, /rm -rf -- "\$candidate"/);
assert.match(
  retirementRecoveryRemoteCleanup,
  /if \[\[ -e "\$candidate" \|\| -L "\$candidate" \]\]; then cleanup_failed=1; fi/,
);
assert.match(retirementRecoveryRemoteCleanup, /\[\[ "\$cleanup_failed" -eq 0 \]\]/);
assert.doesNotMatch(
  retirementRecoveryRemoteCleanup,
  /\/tmp\/?['"]?\s*;|\/var\/lib|\/run\/secrets/u,
);
const retirementRecoveryRemoteIdentityCapture = retirementRecoveryJob.indexOf(
  'remote_bundle_dev_ino="$(ssh',
);
const retirementRecoveryRemoteOwnership = retirementRecoveryJob.indexOf(
  "remote_bundle_owned_by_run='true'",
);
const retirementRecoveryUpload = retirementRecoveryJob.indexOf('scp "${ssh_opts[@]}"');
assert.ok(
  retirementRecoveryPreflightIndex < retirementRecoveryRemoteIdentityCapture &&
    retirementRecoveryRemoteIdentityCapture < retirementRecoveryRemoteOwnership &&
    retirementRecoveryRemoteOwnership < retirementRecoveryUpload,
  'Only an exact path created after the read-only preflight and bound by its captured device/inode may become cleanup-owned before upload.',
);
assert.match(
  retirementRecoveryJob,
  /remote_bundle_dev_ino="\$\(ssh[\s\S]*?stat --format='%d:%i' \\"\\\$staging\\"/u,
);
assert.match(
  retirementRecoveryJob,
  /\[\[ "\$remote_bundle_dev_ino" =~ \^\[0-9\]\+:\[0-9\]\+\$ \]\]/,
);
const retirementRecoveryPublishIndex = retirementRecoveryJob.indexOf(
  `"python3 -I - '$remote_bundle_staging' '$incoming' '$remote_bundle_dev_ino'" <<'REMOTE_PUBLISH'`,
);
assert.ok(
  retirementRecoveryUpload < retirementRecoveryPublishIndex,
  'The complete protected bundle must be uploaded only to the run staging inode before publication.',
);
for (const publicationContract of [
  /parent_fd = os\.open\(parent, flags\)/,
  /os\.O_DIRECTORY/,
  /os\.O_NOFOLLOW/,
  /os\.stat\(staging_name, dir_fd=parent_fd, follow_symlinks=False\)/,
  /f'\{staged\.st_dev\}:\{staged\.st_ino\}' != expected_dev_ino/,
  /for absent_name in \(incoming_name, incoming_name \+ '\.consumed'\):/,
  /renameat2\(parent_fd, os\.fsencode\(staging_name\), parent_fd, os\.fsencode\(incoming_name\), 1\)/,
  /error in \(errno\.EEXIST, errno\.ENOTEMPTY\)/,
  /os\.fsync\(parent_fd\)/,
  /\(published\.st_dev, published\.st_ino\) != \(staged\.st_dev, staged\.st_ino\)/,
  /\(parent_after\.st_dev, parent_after\.st_ino\) != \(parent_before\.st_dev, parent_before\.st_ino\)/,
]) {
  assert.match(retirementRecoveryJob, publicationContract);
}

const recoveryProvisionIndex = retirementRecoveryJob.indexOf(
  'psql -X --file="$contract_dir/staging-runtimes-provision-for-deploy.sql"',
);
const recoveryReinstallIndex = retirementRecoveryJob.indexOf(
  "fetanagent-staging-deploy-helper reinstall-kemerbet-v1-retirement-secrets '$release_sha' '$incoming'",
);
const recoveryStartIndex = retirementRecoveryJob.indexOf(
  "fetanagent-staging-deploy-helper start '$release_sha' '${release_sha:0:12}'",
);
const recoveryArmIndex = retirementRecoveryJob.indexOf(
  "fetanagent-staging-deploy-helper arm-expiry-stop '$release_sha' '$stop_at'",
);
const recoveryBotStartIndex = retirementRecoveryJob.indexOf(
  "fetanagent-staging-deploy-helper start-bot '$release_sha' '${release_sha:0:12}'",
);
const recoveryBotReadyIndex = retirementRecoveryJob.indexOf(
  "fetanagent-staging-deploy-helper bot-ready '$release_sha'",
);
const recoveryEdgeStartIndex = retirementRecoveryJob.indexOf(
  "fetanagent-staging-deploy-helper start-public-edge '$release_sha' '${release_sha:0:12}'",
);
const recoveryEdgeReadyIndex = retirementRecoveryJob.indexOf(
  "fetanagent-staging-deploy-helper public-edge-ready '$release_sha'",
);
assert.ok(
  recoveryProvisionIndex >= 0 &&
    retirementRecoveryPublishIndex < recoveryProvisionIndex &&
    recoveryProvisionIndex < recoveryReinstallIndex &&
    recoveryReinstallIndex < recoveryStartIndex &&
    recoveryStartIndex < recoveryArmIndex &&
    recoveryArmIndex < recoveryBotStartIndex &&
    recoveryBotStartIndex < recoveryBotReadyIndex &&
    recoveryBotReadyIndex < recoveryEdgeStartIndex &&
    recoveryEdgeStartIndex < recoveryEdgeReadyIndex,
  'Recovery must provision roles, reinstall only secrets, start core, arm expiry, then start and verify bot and edge in the exact same-release order.',
);
assert.match(retirementRecoveryJob, /for attempt in \{1\.\.12\}/);
assert.match(retirementRecoveryJob, /if \[\[ "\$attempt" -lt 12 \]\]; then sleep 5; fi/);
assert.equal(
  (retirementRecoveryJob.match(/v1_retirement_same_release_recovery=pass/g) ?? []).length,
  1,
  'Recovery may emit only one fixed aggregate success result.',
);
assert.doesNotMatch(
  retirementRecoveryJob,
  /actions\/(?:download|upload)-artifact|docker\b|compose\b|images?\.tar|fetanagent-staging-deploy-helper (?:install|fresh-start|start-kemerbet-session-provision|seal-kemerbet-readiness|recheck-kemerbet-readiness)|sha256sum infra\/operations\/fetanagent-staging-deploy-helper\.sh|psql -X --file=infra\/sql\/(?:staging-runtimes-provision-for-deploy|staging-runtimes-disable)\.sql|FINANCIAL_ACTIONS_MODE|KEMERBET_EXECUTOR_ENABLED|KEMERBET_FINAL_ACTION_ENABLED|GeneralInfoByExternalId|PlayerEPOSDeposit|Transfer/iu,
  'The recovery surface must remain secrets-only and structurally unable to build, install, replace images, open enrollment, recheck, or move money.',
);
assert.doesNotMatch(
  retirementRecoveryJob,
  /fetanagent-staging-deploy-helper (?:reinstall-kemerbet-v1-retirement-secrets|start|arm-expiry-stop|start-bot|bot-ready|start-public-edge|public-edge-ready) '\$GITHUB_SHA'|\$\{GITHUB_SHA:0:12\}/u,
  'Recovery must pass only the explicit durable retirement release to every remote mutation.',
);
assert.doesNotMatch(
  retirementRecoveryJob,
  /root@|ssh-keyscan|StrictHostKeyChecking=no|sudo -n (?:docker|bash)|docker\.sock|SUPABASE_ACCESS_TOKEN|service_role|echo[^\n]*\$(?:STAGING_TELEGRAM_BOT_TOKEN|PGPASSWORD)|set\s+-x|printenv/iu,
);
const retirementDurableVolumes = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_durable_volumes',
  'kemerbet_v1_retirement_recovery_context_digest',
);
for (const durableVolumeContract of [
  /docker_local volume ls --quiet \\\n\s+--filter "label=com\.docker\.compose\.project=\$PROJECT_NAME" \| LC_ALL=C sort/u,
  /"\$KEMERBET_PROFILE_VOLUME" "\$KEMERBET_SESSION_CONTROL_VOLUME" \| LC_ALL=C sort/,
  /\[\[ "\$project_volumes" == "\$expected_volumes" \]\] \|\| return 1/,
  /inspect_kemerbet_durable_volume_contract[\s\S]*?"\$volume" kemerbet_sessions/u,
  /inspect_kemerbet_durable_volume_contract[\s\S]*?"\$volume" kemerbet_session_control/u,
  /profile_contract="\$volume_contract"/,
  /control_contract="\$volume_contract"/,
  /"control_contract=\$control_contract"/,
  /"profile_contract=\$profile_contract"/,
  /docker_local container ls --all --quiet --filter "volume=\$volume"/,
  /resolve_kemerbet_session_control_volume_mountpoint/,
  /resolve_kemerbet_profile_volume_mountpoint/,
  /inspect_owner_staged_kemerbet_cohort/,
  /require_owner_kemerbet_failed_marker_read_only/,
  /kemerbet_profile_identity_digest[\s\S]*?allow-exact-stale-singletons/u,
  /KEMERBET_V1_RETIREMENT_DURABLE_VOLUME_DIGEST=/,
]) {
  assert.match(retirementDurableVolumes, durableVolumeContract);
}
assert.doesNotMatch(
  retirementDurableVolumes,
  /volume create|volume rm|container start|snapshot|runtime-input|completion-output|rpc/iu,
  'the migration recovery volume proof must be read-only and must accept no transient readiness volume',
);
const retirementRecoveryReadyTopology = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_recovery_ready_topology',
  'require_kemerbet_v1_retirement_recovery_ready',
);
for (const recoveryTopologyContract of [
  /normalize_kemerbet_readiness_binding_publication inspect/,
  /\^\(empty\|v1\|v2\|v2-temp-prefix\|v2-temp-complete-prefix\|v2-hardlink-prefix\)\$/,
  /require_kemerbet_v1_retirement_v2_temporary_projection/,
  /require_kemerbet_v1_retired_awaiting_v2 "\$commit_sha"/,
  /require_kemerbet_v1_retirement_seal_finalization_prefix "\$commit_sha"/,
  /require_kemerbet_v1_retirement_completed_continuity/,
  /KEMERBET_V1_RETIREMENT_CONTINUITY_STATE" == \\\s+'resealed-awaiting-recheck'/u,
  /KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='clean'/,
  /KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'/,
  /\^\(clean\|safe-to-reset\)\$/,
]) {
  assert.match(retirementRecoveryReadyTopology, recoveryTopologyContract);
}
const retirementBindingPublicationNormalizer = extractShellFunction(
  helper,
  'normalize_kemerbet_readiness_binding_publication',
  'require_kemerbet_readiness_output_directory',
);
for (const publicationNormalizerContract of [
  /action="\$\{1:-normalize\}"/,
  /action" == 'normalize' \|\| "\$action" == 'inspect'/,
  /BINDING_V2 = re\.compile\([\s\S]*?sha256-provider-authorization-v1:\[0-9a-f\]\{64\}\\n/u,
  /BINDING_V3 = re\.compile\([\s\S]*?hmac-sha256-agent-identity-v1:\(\[0-9a-f\]\{\{64\}\}\) '[\s\S]*?hmac-sha256-agent-profile-pin-v3:\\1\\n/u,
  /def binding_v2_prefix_contract\(\):/,
  /def binding_v3_prefix_contract\(\):/,
  /def is_binding_v2_prefix\(content\):/,
  /def is_binding_v3_prefix\(content\):/,
  /if len\(temporary_names\) > 1:/,
  /final_before\.st_nlink != \(2 if temporary else 1\)/,
  /\(temporary_before\.st_dev, temporary_before\.st_ino\) !=\s+\(final_before\.st_dev, final_before\.st_ino\)/u,
  /publication_state = f'\{final_version\}-hardlink-prefix'/,
  /if action == 'normalize':\s+os\.unlink\(temporary, dir_fd=root_fd\)\s+os\.fsync\(root_fd\)/u,
  /normalized\.st_nlink != 1/,
  /temporary_before\.st_size > 230/,
  /if len\(temporary_content\) == 230:/,
  /if BINDING_V3\.fullmatch\(temporary_text\) is not None:/,
  /elif BINDING_V2\.fullmatch\(temporary_text\) is not None:/,
  /v2_prefix = is_binding_v2_prefix\(temporary_content\)/,
  /v3_prefix = is_binding_v3_prefix\(temporary_content\)/,
  /if not v2_prefix and not v3_prefix:/,
  /temporary_version = 'v3' if v3_prefix and not v2_prefix else 'v2'/,
  /f'\{temporary_version\}-temp-complete-prefix'\s+if len\(temporary_content\) == 230\s+else f'\{temporary_version\}-temp-prefix'/u,
  /if action == 'normalize' and len\(temporary_content\) == 230:/,
  /os\.link\(\s+temporary,\s+final_name,\s+src_dir_fd=root_fd,\s+dst_dir_fd=root_fd,\s+follow_symlinks=False,/u,
  /\(normalized\.st_dev, normalized\.st_ino\) !=\s+\(temporary_before\.st_dev, temporary_before\.st_ino\)/u,
  /normalized\.st_nlink != 1/,
  /normalized_content != temporary_content/,
  /elif action == 'normalize':\s+os\.unlink\(temporary, dir_fd=root_fd\)\s+os\.fsync\(root_fd\)/u,
  /final_entries not in \(\[\], \[final_name\]\)/,
  /os\.fsync\(root_fd\)/,
]) {
  assert.match(retirementBindingPublicationNormalizer, publicationNormalizerContract);
}
assert.doesNotMatch(
  retirementBindingPublicationNormalizer,
  /os\.(?:rename|replace)\(/,
  'Publication recovery may only use the same-filesystem hard-link no-replace primitive.',
);
const retirementTemporaryProjection = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_v2_temporary_projection',
  'require_kemerbet_v1_retirement_seal_finalization_prefix',
);
const retirementStableV2Projection = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_v2_binding_projection',
  'require_kemerbet_v1_retirement_v2_temporary_projection',
);
for (const stableRetirementProjectionContract of [
  /10001:10001:600:\$links:230/u,
  /sha256-provider-authorization-v1:\[0-9a-f\]\{64\}/u,
  /printf '%s %s\\n' "\$account_id" "\$identity_fingerprint" \| sha256sum/u,
  /KEMERBET_V1_RETIREMENT_LEGACY_SHA256/u,
]) {
  assert.match(retirementStableV2Projection, stableRetirementProjectionContract);
}
assert.doesNotMatch(
  retirementStableV2Projection,
  /hmac-sha256-agent-profile-pin-v3|require_kemerbet_v3_binding_content/u,
  'the historical v1-retirement continuity projection must continue validating the exact v2 source',
);
for (const temporaryProjectionContract of [
  /entries="\$\(find -P "\$KEMERBET_READINESS_OUTPUT_ROOT"/,
  /\.kemerbet_agent_identity_bindings/,
  /! -e "\$KEMERBET_READINESS_BINDING" && ! -L "\$KEMERBET_READINESS_BINDING"/,
  /10001:10001:600:1:230/,
  /sha256-provider-authorization-v1:\[0-9a-f\]\{64\}/,
  /KEMERBET_V1_RETIREMENT_LEGACY_SHA256/,
  /"\$after" == "\$before"/,
  /sha256sum -- "\$temporary"/,
]) {
  assert.match(retirementTemporaryProjection, temporaryProjectionContract);
}
const retirementRecoveryReady = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_recovery_ready',
  'finalize_kemerbet_v1_retirement_after_v2_seal',
);
for (const recoveryReadyContract of [
  /read_kemerbet_v1_retirement_intent_metadata/,
  /KEMERBET_V1_RETIREMENT_RELEASE" == "\$commit_sha"/,
  /KEMERBET_V1_RETIREMENT_HELPER_DEV_INO/,
  /KEMERBET_V1_RETIREMENT_HELPER_SHA256/,
  /require_kemerbet_v1_retirement_current_context "\$commit_sha"/,
  /require_kemerbet_v1_retirement_recovery_ready_topology "\$commit_sha"/,
  /require_kemerbet_v1_retirement_safe_reset_boundary/,
  /kemerbet_v1_retirement_release_asset_digest "\$commit_sha"/,
  /KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256/,
  /kemerbet_v1_retirement_secret_bundle classify-reset-targets -/,
  /classify_kemerbet_v1_retirement_bot_receipt_reset_state/,
  /classify_kemerbet_v1_retirement_input_reset_state "\$commit_sha"/,
  /classify_kemerbet_v1_retirement_journal_reset_state "\$commit_sha"/,
  /clean\|absent\|absent\|absent\|absent/,
  /KEMERBET_V1_RETIREMENT_RECOVERY_PREFLIGHT_STATE='safe-to-reset'/,
]) {
  assert.match(retirementRecoveryReady, recoveryReadyContract);
}
assert.equal(
  (retirementRecoveryReady.match(/require_kemerbet_v1_retirement_current_context/g) ?? []).length,
  2,
);
assert.equal(
  (retirementRecoveryReady.match(/require_kemerbet_v1_retirement_recovery_ready_topology/g) ?? [])
    .length,
  2,
);
assert.equal(
  (retirementRecoveryReady.match(/require_kemerbet_v1_retirement_safe_reset_boundary/g) ?? [])
    .length,
  2,
);
const retirementSafeResetBoundary = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_safe_reset_boundary',
  'classify_kemerbet_v1_retirement_bot_receipt_reset_state',
);
for (const safeResetContract of [
  /require_kemerbet_v1_retirement_expiry_guard_disarmed/,
  /container ls --all --quiet/,
  /network ls --quiet/,
  /\[\[ -z "\$containers" && -z "\$networks" \]\]/,
  /require_kemerbet_recheck_transients_absent/,
  /require_kemerbet_v1_retirement_durable_volumes/,
]) {
  assert.match(retirementSafeResetBoundary, safeResetContract);
}
const retirementSafeResetFinalizer = extractShellFunction(
  helper,
  'finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown',
  'classify_kemerbet_v1_retirement_bot_receipt_reset_state',
);
for (const safeResetFinalizerContract of [
  /inspect_kemerbet_v1_retirement_gate/,
  /KEMERBET_V1_RETIREMENT_GATE_STATE" == 'seal-finalization-prefix'/,
  /require_kemerbet_v1_retirement_safe_reset_boundary/,
  /require_kemerbet_v1_retirement_current_context "\$release"/,
  /kemerbet_v1_retirement_release_asset_digest "\$release"/,
  /KEMERBET_V1_RETIREMENT_RELEASE_ASSET_SHA256/,
  /finalize_kemerbet_v1_retirement_after_v2_seal "\$release"/,
  /KEMERBET_V1_RETIREMENT_GATE_STATE" == 'resealed-awaiting-recheck'/,
]) {
  assert.match(retirementSafeResetFinalizer, safeResetFinalizerContract);
}
assert.equal(
  (retirementSafeResetFinalizer.match(/require_kemerbet_v1_retirement_safe_reset_boundary/g) ?? [])
    .length,
  2,
);
assert.match(
  helper,
  /kemerbet-v1-retirement-recovery-ready\)\s+\[\[ \$# -eq 2 \]\][\s\S]*?require_kemerbet_v1_retirement_recovery_ready "\$commit_sha"[\s\S]*?KemerBet v1 retirement recovery preflight: clean\.[\s\S]*?KemerBet v1 retirement recovery preflight: safe-to-reset\./u,
);
assert.match(
  helper,
  /inspect_kemerbet_v2_v3_successor_gate\s+if \[\[ "\$command" == 'kemerbet-v1-retirement-recovery-ready' \]\]; then\s+\[\[ "\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' \]\] \|\|\s+die 'the KemerBet v3 successor permanently forbids legacy v1 retirement recovery'\s+else\s+if \[\[ "\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' \]\]; then\s+enforce_kemerbet_v1_retirement_gate "\$command" "\$\{@:2\}"\s+fi\s+enforce_kemerbet_v2_v3_successor_gate "\$command" "\$\{@:2\}"\s+fi/u,
  'successor inspection must precede dispatch and permanently block legacy recovery once any successor overlay exists',
);
const inspectV2V3SuccessorGate = extractShellFunction(
  helper,
  'inspect_kemerbet_v2_v3_successor_gate',
  'enforce_kemerbet_v2_v3_successor_gate',
);
if (process.platform === 'linux') {
  const inspectorPython = extractSingleQuotedPythonHeredoc(
    inspectV2V3SuccessorGate,
    'inspect_kemerbet_v2_v3_successor_gate',
  );
  const inspectorCompile = spawnSync(
    '/usr/bin/python3',
    ['-I', '-c', 'import sys; compile(sys.stdin.read(), "<successor-inspector>", "exec")'],
    { encoding: 'utf8', input: inspectorPython },
  );
  assert.equal(
    inspectorCompile.status,
    0,
    `the complete historical-overlay plus runtime-bridge inspector Python must compile: ${inspectorCompile.stderr}`,
  );
}
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V2_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v2'$/mu,
  'the second helper rotation must use one fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V3_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v3'$/mu,
  'the third helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V4_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v4'$/mu,
  'the fourth helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V5_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v5'$/mu,
  'the fifth helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V6_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v6'$/mu,
  'the sixth helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V7_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v7'$/mu,
  'the seventh helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V8_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v8'$/mu,
  'the eighth helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V9_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v9'$/mu,
  'the ninth helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V10_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v10'$/mu,
  'the tenth helper rotation must use one distinct fixed append-only evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V11_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v11'$/mu,
  'the one-time runtime bridge must use a distinct append-only H11 evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_HELPER_ROTATION_V12_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v12'$/mu,
  'the parser-scope repair must use a distinct append-only H12 evidence namespace',
);
assert.match(
  helper,
  /^readonly KEMERBET_V3_RECHECK_BRIDGE_V13_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-recheck-bridge-v13'$/mu,
  'the release-bound exact-five recheck bridge must use a distinct append-only H13 evidence namespace',
);
for (const successorGateContract of [
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE='absent'/,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE='invalid'/,
  /\['binding-v2', 'completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /contract=fetanagent-kemerbet-readiness-v2-v3-successor-v1/u,
  /state=successor-installed/u,
  /len\(intent\) != 9/u,
  /len\(completion\) != 10/u,
  /retirement_intent_sha256=/u,
  /retirement_completion_sha256=/u,
  /completion\[9\].*v3_binding_sha256/u,
  /exact_file\(f'\{root\}\/binding-v2', \(0, 0\), 0o400, 230, 230\)/u,
  /rb'sha256-provider-authorization-v1:\[0-9a-f\]\{64\}\\n'/u,
  /rb'hmac-sha256-agent-profile-pin-v3:\\2\\n'/u,
  /v2_match\.group\(1\) != matched\.group\(1\)/u,
  /v2_match\.group\(2\) != matched\.group\(2\)/u,
  /exact_directory\(retirement, 0o700, \['completed-v1', 'intent-v1'\]\)/u,
  /retirement_completion\[1\] != 'state=resealed-v2'/u,
  /retirement_completion\[15\] != f'v2_binding_sha256=\{v2_sha\}'/u,
  /retirement_intent\[9\]\.startswith\('claim_sha256='\)/u,
  /hashlib\.sha256\(retirement_intent_data\)\.hexdigest\(\) != retirement_intent_sha/u,
  /hashlib\.sha256\(retirement_completion_data\)\.hexdigest\(\) != retirement_completion_sha/u,
  /helper_data = exact_file\(helper, \(0, 0\), 0o755, 2 \* 1024 \* 1024\)/u,
  /hashlib\.sha256\(helper_data\)\.hexdigest\(\) != effective_helper_sha/u,
  /require_v3_binding\(binding, \(10001, 10001\), 0o600\)/u,
  /os\.path\.lexists\(committed_binding\)[\s\S]*?os\.path\.lexists\(os\.path\.dirname\(recheck_receipt\)\)[\s\S]*?os\.path\.lexists\(owner_completion\)[\s\S]*?os\.path\.lexists\(candidate_root\)[\s\S]*?os\.path\.lexists\(rpc_root\)/u,
  /gate_state = 'successor-installed'/u,
  /require_v3_binding\(committed_binding, \(0, 0\), 0o444\)/u,
  /exact_directory\(os\.path\.dirname\(recheck_receipt\), 0o700, \['ready-v1'\]\)/u,
  /identity_key_owner_mode != \(0, 0, 0o444\)/u,
  /selector_data = exact_file\(selector_contract, \(0, 0\), 0o444, 1024 \* 1024\)/u,
  /receipt_lines\[1\] !=\s+f'release=\{recheck_bridge_release if recheck_bridge_state == "active" else effective_release\}'/u,
  /receipt_lines\[2\] != f'binding_sha256=\{v3_sha\}'/u,
  /identity_hmac_key_sha256=\{hashlib\.sha256\(identity_key_data\)\.hexdigest\(\)\}/u,
  /selector_sha256=\{hashlib\.sha256\(selector_data\)\.hexdigest\(\)\}/u,
  /exact_directory\([\s\S]*?os\.path\.dirname\(owner_completion\)[\s\S]*?0o755[\s\S]*?os\.path\.basename\(owner_completion\)/u,
  /exact_file\(owner_completion, \(0, 10001\), 0o440, 37, 37\)/u,
  /hashlib\.sha256\(owner_completion_data\)\.hexdigest\(\) !=\s+retirement_intent\[9\]\.split\('=', 1\)\[1\]/u,
  /for consumed_or_transient in \([\s\S]*?binding,[\s\S]*?readiness_player_ids,[\s\S]*?candidate_root,[\s\S]*?promotion_root,[\s\S]*?rpc_root,[\s\S]*?\)/u,
  /gate_state = 'successor-recheck-recoverable'/u,
  /gate_state = 'successor-completed'/u,
  /sys\.stdout\.write\([\s\S]*?effective_release \+ '\\n' \+ effective_helper_sha \+ '\\n' \+ gate_state \+ '\\n' \+[\s\S]*?runtime_bridge_state \+ '\\n' \+ runtime_bridge_release \+ '\\n' \+[\s\S]*?recheck_bridge_state \+ '\\n' \+ recheck_bridge_release \+ '\\n'[\s\S]*?\)/u,
  /\^\(successor-installed\|successor-recheck-recoverable\|successor-completed\)\$/u,
  /"\$\{#inspection_lines\[@\]\}" -eq 7/u,
  /"\$\{inspection_lines\[3\]\}" == 'active'/u,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="\$\{inspection_lines\[2\]\}"/u,
  /KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="\$\{inspection_lines\[3\]\}"/u,
  /KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE="\$\{inspection_lines\[4\]\}"/u,
  /KEMERBET_V3_RECHECK_BRIDGE_STATE="\$\{inspection_lines\[5\]\}"/u,
  /KEMERBET_V3_RECHECK_BRIDGE_RELEASE="\$\{inspection_lines\[6\]\}"/u,
]) {
  assert.match(inspectV2V3SuccessorGate, successorGateContract);
}
assert.equal(
  (
    inspectV2V3SuccessorGate.match(
      /base_entries = \['binding-v2', 'completed-v1', 'intent-v1', 'predecessor-helper'\]/gu,
    ) ?? []
  ).length,
  1,
  'the successor inspector must define one exact immutable four-entry overlay',
);
const successorRotationChainStart = inspectV2V3SuccessorGate.indexOf(
  'effective_release = successor',
);
const successorRotationChainEnd = inspectV2V3SuccessorGate.indexOf(
  'def require_live_successor_helper():',
  successorRotationChainStart,
);
assert.ok(
  successorRotationChainStart >= 0 && successorRotationChainEnd > successorRotationChainStart,
  'the successor inspector must expose one bounded effective-helper rotation-chain parser',
);
const successorRotationChain = inspectV2V3SuccessorGate.slice(
  successorRotationChainStart,
  successorRotationChainEnd,
);
for (const rotationChainContract of [
  /effective_release = successor/u,
  /effective_helper_sha = successor_helper_sha/u,
  /if os\.path\.lexists\(rotation_parent\):/u,
  /rotation_parent_value = os\.lstat\(rotation_parent\)/u,
  /stat\.S_ISDIR\(rotation_parent_value\.st_mode\)/u,
  /exact_directory\(rotation_parent, 0o700, \[rotation_release\]\)/u,
  /\['completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1/u,
  /len\(rotation_intent\) != 15/u,
  /len\(rotation_completion\) != 16/u,
  /rotation_intent\[2\] != f'predecessor_release=\{successor\}'/u,
  /rotation_intent\[3\] != f'successor_release=\{rotation_release\}'/u,
  /rotation_intent\[4\] != f'predecessor_helper_sha256=\{successor_helper_sha\}'/u,
  /base_successor_intent_sha256=/u,
  /base_successor_completion_sha256=/u,
  /base_binding_v2_sha256=/u,
  /base_predecessor_helper_sha256=/u,
  /base_binding_v3_sha256=/u,
  /compose5_durable_volume_digest=/u,
  /compose5_profile_config_hash=/u,
  /compose5_session_control_config_hash=/u,
  /compose5_volume_version=/u,
  /compose_version\.fullmatch\(rotation_intent\[14\]\.split\('=', 1\)\[1\]\)/u,
  /rotation_completion\[2:15\] != rotation_intent\[2:15\]/u,
  /rotation_completion\[15\] !=/u,
  /rotation_intent_sha256=/u,
  /hashlib\.sha256\(archived_successor_helper\)\.hexdigest\(\) != successor_helper_sha/u,
  /effective_release = rotation_release/u,
  /effective_helper_sha = rotation_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = successor',
    'if os.path.lexists(rotation_parent):',
    'rotation_parent_value = os.lstat(rotation_parent)',
    'exact_directory(rotation_parent, 0o700, [rotation_release])',
    "['completed-v1', 'intent-v1', 'predecessor-helper']",
    "rotation_completion[1] != 'state=successor-installed'",
    'rotation_intent_sha256=',
    'archived_successor_helper = exact_file(',
    'effective_release = rotation_release',
    "effective_helper_sha = rotation_intent[5].split('=', 1)[1]",
  ],
  'the first exact completed append-only rotation must change the effective release and helper identity before the v2 link is considered',
);
for (const rotationV2ChainContract of [
  /if os\.path\.lexists\(rotation_v2_parent\):/u,
  /rotation_intent_data is None/u,
  /rotation_completion_data is None/u,
  /archived_successor_helper is None/u,
  /exact_directory\(rotation_v2_parent, 0o700, \[rotation_v2_release\]\)/u,
  /\['completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2/u,
  /len\(rotation_v2_intent\) != 18/u,
  /len\(rotation_v2_completion\) != 19/u,
  /rotation_v2_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v2_intent\[3\] != f'successor_release=\{rotation_v2_release\}'/u,
  /rotation_v2_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /predecessor_rotation_intent_sha256=/u,
  /predecessor_rotation_completion_sha256=/u,
  /predecessor_rotation_helper_archive_sha256=/u,
  /rotation_v2_intent\[14\] != rotation_intent\[11\]/u,
  /rotation_v2_intent\[15\] != rotation_intent\[12\]/u,
  /rotation_v2_intent\[16\] != rotation_intent\[13\]/u,
  /rotation_v2_intent\[17\] != rotation_intent\[14\]/u,
  /rotation_v2_completion\[2:18\] != rotation_v2_intent\[2:18\]/u,
  /rotation_v2_completion\[18\] !=/u,
  /hashlib\.sha256\(archived_rotation_v2_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v2_release/u,
  /effective_helper_sha = rotation_v2_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV2ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_release',
    "effective_helper_sha = rotation_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v2_parent):',
    'rotation_intent_data is None',
    'exact_directory(rotation_v2_parent, 0o700, [rotation_v2_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2'",
    'predecessor_rotation_intent_sha256=',
    'predecessor_rotation_completion_sha256=',
    'predecessor_rotation_helper_archive_sha256=',
    'archived_rotation_v2_predecessor_helper = exact_file(',
    'effective_release = rotation_v2_release',
    "effective_helper_sha = rotation_v2_intent[5].split('=', 1)[1]",
  ],
  'the second rotation must causally bind the exact first link before changing the effective identity',
);
for (const rotationV3ChainContract of [
  /if os\.path\.lexists\(rotation_v3_parent\):/u,
  /rotation_v2_intent_data is None/u,
  /rotation_v2_completion_data is None/u,
  /archived_rotation_v2_predecessor_helper is None/u,
  /exact_directory\(rotation_v3_parent, 0o700, \[rotation_v3_release\]\)/u,
  /\['completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3/u,
  /len\(rotation_v3_intent\) != 18/u,
  /len\(rotation_v3_completion\) != 19/u,
  /rotation_v3_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v3_intent\[3\] != f'successor_release=\{rotation_v3_release\}'/u,
  /rotation_v3_release in \{successor, rotation_release, effective_release\}/u,
  /rotation_v3_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v3_intent\[5\]\.split\('=', 1\)\[1\] in \{\s+successor_helper_sha,\s+rotation_intent\[5\]\.split\('=', 1\)\[1\],\s+effective_helper_sha,/u,
  /rotation_v3_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v2_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v3_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v2_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v3_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v2_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v3_intent\[14\] != rotation_v2_intent\[14\]/u,
  /rotation_v3_intent\[15\] != rotation_v2_intent\[15\]/u,
  /rotation_v3_intent\[16\] != rotation_v2_intent\[16\]/u,
  /rotation_v3_intent\[17\] != rotation_v2_intent\[17\]/u,
  /rotation_v3_completion\[2:18\] != rotation_v3_intent\[2:18\]/u,
  /rotation_v3_completion\[18\] !=/u,
  /hashlib\.sha256\(archived_rotation_v3_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v3_release/u,
  /effective_helper_sha = rotation_v3_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV3ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v2_release',
    "effective_helper_sha = rotation_v2_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v3_parent):',
    'rotation_v2_intent_data is None',
    'exact_directory(rotation_v3_parent, 0o700, [rotation_v3_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3'",
    'predecessor_rotation_intent_sha256=',
    'predecessor_rotation_completion_sha256=',
    'predecessor_rotation_helper_archive_sha256=',
    'archived_rotation_v3_predecessor_helper = exact_file(',
    'effective_release = rotation_v3_release',
    "effective_helper_sha = rotation_v3_intent[5].split('=', 1)[1]",
  ],
  'the third rotation must causally bind the exact second link before changing the effective identity',
);
for (const rotationV4ChainContract of [
  /if os\.path\.lexists\(rotation_v4_parent\):/u,
  /rotation_v3_intent_data is None/u,
  /rotation_v3_completion_data is None/u,
  /archived_rotation_v3_predecessor_helper is None/u,
  /exact_directory\(rotation_v4_parent, 0o700, \[rotation_v4_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4/u,
  /len\(rotation_v4_intent\) != 18/u,
  /len\(rotation_v4_completion\) != 19/u,
  /rotation_v4_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v4_intent\[3\] != f'successor_release=\{rotation_v4_release\}'/u,
  /rotation_v4_release in \{\s+successor,\s+rotation_release,\s+rotation_v2_release,\s+effective_release,/u,
  /rotation_v4_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v4_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v3_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v4_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v3_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v4_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v3_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v4_intent\[14\] != rotation_v3_intent\[14\]/u,
  /rotation_v4_intent\[15\] != rotation_v3_intent\[15\]/u,
  /rotation_v4_intent\[16\] != rotation_v3_intent\[16\]/u,
  /rotation_v4_intent\[17\] != rotation_v3_intent\[17\]/u,
  /rotation_v4_completion\[2:18\] != rotation_v4_intent\[2:18\]/u,
  /hashlib\.sha256\(archived_rotation_v4_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v4_release/u,
  /effective_helper_sha = rotation_v4_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV4ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v3_release',
    "effective_helper_sha = rotation_v3_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v4_parent):',
    'rotation_v3_intent_data is None',
    'exact_directory(rotation_v4_parent, 0o700, [rotation_v4_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4'",
    'archived_rotation_v4_predecessor_helper = exact_file(',
    'effective_release = rotation_v4_release',
    "effective_helper_sha = rotation_v4_intent[5].split('=', 1)[1]",
  ],
  'the fourth rotation must causally bind the exact third link before changing the effective identity',
);
for (const rotationV5ChainContract of [
  /if os\.path\.lexists\(rotation_v5_parent\):/u,
  /rotation_v4_intent_data is None/u,
  /rotation_v4_completion_data is None/u,
  /archived_rotation_v4_predecessor_helper is None/u,
  /exact_directory\(rotation_v5_parent, 0o700, \[rotation_v5_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5/u,
  /len\(rotation_v5_intent\) != 18/u,
  /len\(rotation_v5_completion\) != 19/u,
  /rotation_v5_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v5_intent\[3\] != f'successor_release=\{rotation_v5_release\}'/u,
  /rotation_v5_release in \{\s+successor,\s+rotation_release,\s+rotation_v2_release,\s+rotation_v3_release,\s+effective_release,/u,
  /rotation_v5_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v5_intent\[5\]\.split\('=', 1\)\[1\] in \{\s+successor_helper_sha,\s+rotation_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v2_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v3_intent\[5\]\.split\('=', 1\)\[1\],\s+effective_helper_sha,/u,
  /rotation_v5_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v4_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v5_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v4_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v5_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v4_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v5_intent\[14\] != rotation_v4_intent\[14\]/u,
  /rotation_v5_intent\[15\] != rotation_v4_intent\[15\]/u,
  /rotation_v5_intent\[16\] != rotation_v4_intent\[16\]/u,
  /rotation_v5_intent\[17\] != rotation_v4_intent\[17\]/u,
  /rotation_v5_completion\[2:18\] != rotation_v5_intent\[2:18\]/u,
  /rotation_v5_completion\[18\] !=/u,
  /hashlib\.sha256\(archived_rotation_v5_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v5_release/u,
  /effective_helper_sha = rotation_v5_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV5ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v4_release',
    "effective_helper_sha = rotation_v4_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v5_parent):',
    'rotation_v4_intent_data is None',
    'exact_directory(rotation_v5_parent, 0o700, [rotation_v5_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v5'",
    'archived_rotation_v5_predecessor_helper = exact_file(',
    'effective_release = rotation_v5_release',
    "effective_helper_sha = rotation_v5_intent[5].split('=', 1)[1]",
  ],
  'the fifth rotation must causally bind the exact fourth link before changing the effective identity',
);
for (const rotationV6ChainContract of [
  /if os\.path\.lexists\(rotation_v6_parent\):/u,
  /rotation_v5_intent_data is None/u,
  /rotation_v5_completion_data is None/u,
  /archived_rotation_v5_predecessor_helper is None/u,
  /exact_directory\(rotation_v6_parent, 0o700, \[rotation_v6_release\]\)/u,
  /exact_directory\(\s+rotation_v6_root,\s+0o700,\s+\['completed-v1', 'intent-v1', 'predecessor-helper'\],\s+\)/u,
  /exact_file\(\s+f'\{rotation_v6_root\}\/intent-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /exact_file\(\s+f'\{rotation_v6_root\}\/completed-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v6/u,
  /len\(rotation_v6_intent\) != 18/u,
  /len\(rotation_v6_completion\) != 19/u,
  /rotation_v6_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v6_intent\[3\] != f'successor_release=\{rotation_v6_release\}'/u,
  /rotation_v6_release in \{\s+successor,\s+rotation_release,\s+rotation_v2_release,\s+rotation_v3_release,\s+rotation_v4_release,\s+effective_release,/u,
  /rotation_v6_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v6_intent\[5\]\.split\('=', 1\)\[1\] in \{\s+successor_helper_sha,\s+rotation_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v2_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v3_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v4_intent\[5\]\.split\('=', 1\)\[1\],\s+effective_helper_sha,/u,
  /rotation_v6_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v5_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v6_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v5_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v6_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v5_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v6_intent\[14\] != rotation_v5_intent\[14\]/u,
  /rotation_v6_intent\[15\] != rotation_v5_intent\[15\]/u,
  /rotation_v6_intent\[16\] != rotation_v5_intent\[16\]/u,
  /rotation_v6_intent\[17\] != rotation_v5_intent\[17\]/u,
  /rotation_v6_completion\[2:18\] != rotation_v6_intent\[2:18\]/u,
  /rotation_v6_completion\[18\] !=/u,
  /exact_file\(\s+f'\{rotation_v6_root\}\/predecessor-helper',\s+\(0, 0\),\s+0o400,/u,
  /hashlib\.sha256\(archived_rotation_v6_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v6_release/u,
  /effective_helper_sha = rotation_v6_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV6ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v5_release',
    "effective_helper_sha = rotation_v5_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v6_parent):',
    'rotation_v5_intent_data is None',
    'exact_directory(rotation_v6_parent, 0o700, [rotation_v6_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v6'",
    'archived_rotation_v6_predecessor_helper = exact_file(',
    'effective_release = rotation_v6_release',
    "effective_helper_sha = rotation_v6_intent[5].split('=', 1)[1]",
  ],
  'the sixth rotation must causally bind the exact fifth link before changing the effective identity',
);
for (const rotationV7ChainContract of [
  /if os\.path\.lexists\(rotation_v7_parent\):/u,
  /rotation_v6_intent_data is None/u,
  /rotation_v6_completion_data is None/u,
  /archived_rotation_v6_predecessor_helper is None/u,
  /exact_directory\(rotation_v7_parent, 0o700, \[rotation_v7_release\]\)/u,
  /exact_directory\(\s+rotation_v7_root,\s+0o700,\s+\['completed-v1', 'intent-v1', 'predecessor-helper'\],\s+\)/u,
  /exact_file\(\s+f'\{rotation_v7_root\}\/intent-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /exact_file\(\s+f'\{rotation_v7_root\}\/completed-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v7/u,
  /len\(rotation_v7_intent\) != 18/u,
  /len\(rotation_v7_completion\) != 19/u,
  /rotation_v7_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v7_intent\[3\] != f'successor_release=\{rotation_v7_release\}'/u,
  /rotation_v7_release in \{\s+successor,\s+rotation_release,\s+rotation_v2_release,\s+rotation_v3_release,\s+rotation_v4_release,\s+rotation_v5_release,\s+effective_release,/u,
  /rotation_v7_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v7_intent\[5\]\.split\('=', 1\)\[1\] in \{\s+successor_helper_sha,\s+rotation_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v2_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v3_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v4_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v5_intent\[5\]\.split\('=', 1\)\[1\],\s+effective_helper_sha,/u,
  /rotation_v7_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v6_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v7_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v6_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v7_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v6_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v7_intent\[14\] != rotation_v6_intent\[14\]/u,
  /rotation_v7_intent\[15\] != rotation_v6_intent\[15\]/u,
  /rotation_v7_intent\[16\] != rotation_v6_intent\[16\]/u,
  /rotation_v7_intent\[17\] != rotation_v6_intent\[17\]/u,
  /rotation_v7_completion\[2:18\] != rotation_v7_intent\[2:18\]/u,
  /rotation_v7_completion\[18\] !=/u,
  /exact_file\(\s+f'\{rotation_v7_root\}\/predecessor-helper',\s+\(0, 0\),\s+0o400,/u,
  /hashlib\.sha256\(archived_rotation_v7_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v7_release/u,
  /effective_helper_sha = rotation_v7_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV7ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v6_release',
    "effective_helper_sha = rotation_v6_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v7_parent):',
    'rotation_v6_intent_data is None',
    'exact_directory(rotation_v7_parent, 0o700, [rotation_v7_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v7'",
    'archived_rotation_v7_predecessor_helper = exact_file(',
    'effective_release = rotation_v7_release',
    "effective_helper_sha = rotation_v7_intent[5].split('=', 1)[1]",
  ],
  'the seventh rotation must causally bind the exact sixth link before changing the effective identity',
);
for (const rotationV8ChainContract of [
  /rotation_v8_intent_data = None/u,
  /rotation_v8_completion_data = None/u,
  /archived_rotation_v8_predecessor_helper = None/u,
  /if os\.path\.lexists\(rotation_v8_parent\):/u,
  /rotation_v7_intent_data is None/u,
  /rotation_v7_completion_data is None/u,
  /archived_rotation_v7_predecessor_helper is None/u,
  /exact_directory\(rotation_v8_parent, 0o700, \[rotation_v8_release\]\)/u,
  /exact_directory\(\s+rotation_v8_root,\s+0o700,\s+\['completed-v1', 'intent-v1', 'predecessor-helper'\],\s+\)/u,
  /exact_file\(\s+f'\{rotation_v8_root\}\/intent-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /exact_file\(\s+f'\{rotation_v8_root\}\/completed-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v8/u,
  /len\(rotation_v8_intent\) != 18/u,
  /len\(rotation_v8_completion\) != 19/u,
  /rotation_v8_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v8_intent\[3\] != f'successor_release=\{rotation_v8_release\}'/u,
  /rotation_v8_release in \{\s+successor,\s+rotation_release,\s+rotation_v2_release,\s+rotation_v3_release,\s+rotation_v4_release,\s+rotation_v5_release,\s+rotation_v6_release,\s+effective_release,/u,
  /rotation_v8_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v8_intent\[5\]\.split\('=', 1\)\[1\] in \{\s+successor_helper_sha,\s+rotation_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v2_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v3_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v4_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v5_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v6_intent\[5\]\.split\('=', 1\)\[1\],\s+effective_helper_sha,/u,
  /rotation_v8_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v7_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v8_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v7_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v8_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v7_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v8_intent\[14\] != rotation_v7_intent\[14\]/u,
  /rotation_v8_intent\[15\] != rotation_v7_intent\[15\]/u,
  /rotation_v8_intent\[16\] != rotation_v7_intent\[16\]/u,
  /rotation_v8_intent\[17\] != rotation_v7_intent\[17\]/u,
  /rotation_v8_completion\[2:18\] != rotation_v8_intent\[2:18\]/u,
  /rotation_v8_completion\[18\] !=/u,
  /exact_file\(\s+f'\{rotation_v8_root\}\/predecessor-helper',\s+\(0, 0\),\s+0o400,/u,
  /hashlib\.sha256\(archived_rotation_v8_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v8_release/u,
  /effective_helper_sha = rotation_v8_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV8ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v7_release',
    "effective_helper_sha = rotation_v7_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v8_parent):',
    'rotation_v7_intent_data is None',
    'exact_directory(rotation_v8_parent, 0o700, [rotation_v8_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v8'",
    'archived_rotation_v8_predecessor_helper = exact_file(',
    'effective_release = rotation_v8_release',
    "effective_helper_sha = rotation_v8_intent[5].split('=', 1)[1]",
  ],
  'the eighth rotation must causally bind the exact seventh link before changing the effective identity',
);
for (const rotationV9ChainContract of [
  /rotation_v9_intent_data = None/u,
  /rotation_v9_completion_data = None/u,
  /archived_rotation_v9_predecessor_helper = None/u,
  /if os\.path\.lexists\(rotation_v9_parent\):/u,
  /rotation_v8_intent_data is None/u,
  /rotation_v8_completion_data is None/u,
  /archived_rotation_v8_predecessor_helper is None/u,
  /exact_directory\(rotation_v9_parent, 0o700, \[rotation_v9_release\]\)/u,
  /exact_directory\(\s+rotation_v9_root,\s+0o700,\s+\['completed-v1', 'intent-v1', 'predecessor-helper'\],\s+\)/u,
  /exact_file\(\s+f'\{rotation_v9_root\}\/intent-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /exact_file\(\s+f'\{rotation_v9_root\}\/completed-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v9/u,
  /len\(rotation_v9_intent\) != 18/u,
  /len\(rotation_v9_completion\) != 19/u,
  /rotation_v9_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v9_intent\[3\] != f'successor_release=\{rotation_v9_release\}'/u,
  /rotation_v9_release in \{\s+successor,\s+rotation_release,\s+rotation_v2_release,\s+rotation_v3_release,\s+rotation_v4_release,\s+rotation_v5_release,\s+rotation_v6_release,\s+rotation_v7_release,\s+effective_release,/u,
  /rotation_v9_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v9_intent\[5\]\.split\('=', 1\)\[1\] in \{\s+successor_helper_sha,\s+rotation_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v2_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v3_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v4_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v5_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v6_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v7_intent\[5\]\.split\('=', 1\)\[1\],\s+effective_helper_sha,/u,
  /rotation_v9_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v8_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v9_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v8_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v9_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v8_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v9_intent\[14\] != rotation_v8_intent\[14\]/u,
  /rotation_v9_intent\[15\] != rotation_v8_intent\[15\]/u,
  /rotation_v9_intent\[16\] != rotation_v8_intent\[16\]/u,
  /rotation_v9_intent\[17\] != rotation_v8_intent\[17\]/u,
  /rotation_v9_completion\[2:18\] != rotation_v9_intent\[2:18\]/u,
  /rotation_v9_completion\[18\] !=/u,
  /exact_file\(\s+f'\{rotation_v9_root\}\/predecessor-helper',\s+\(0, 0\),\s+0o400,/u,
  /hashlib\.sha256\(archived_rotation_v9_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v9_release/u,
  /effective_helper_sha = rotation_v9_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV9ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v8_release',
    "effective_helper_sha = rotation_v8_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v9_parent):',
    'rotation_v8_intent_data is None',
    'exact_directory(rotation_v9_parent, 0o700, [rotation_v9_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v9'",
    'archived_rotation_v9_predecessor_helper = exact_file(',
    'effective_release = rotation_v9_release',
    "effective_helper_sha = rotation_v9_intent[5].split('=', 1)[1]",
  ],
  'the ninth rotation must causally bind the exact eighth link before changing the effective identity',
);
for (const rotationV10ChainContract of [
  /rotation_v10_intent_data = None/u,
  /rotation_v10_completion_data = None/u,
  /archived_rotation_v10_predecessor_helper = None/u,
  /if os\.path\.lexists\(rotation_v10_parent\):/u,
  /rotation_v9_intent_data is None/u,
  /rotation_v9_completion_data is None/u,
  /archived_rotation_v9_predecessor_helper is None/u,
  /exact_directory\(rotation_v10_parent, 0o700, \[rotation_v10_release\]\)/u,
  /exact_directory\(\s+rotation_v10_root,\s+0o700,\s+\['completed-v1', 'intent-v1', 'predecessor-helper'\],\s+\)/u,
  /exact_file\(\s+f'\{rotation_v10_root\}\/intent-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /exact_file\(\s+f'\{rotation_v10_root\}\/completed-v1',\s+\(0, 0\),\s+0o600,\s+4096,\s+\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v10/u,
  /len\(rotation_v10_intent\) != 18/u,
  /len\(rotation_v10_completion\) != 19/u,
  /rotation_v10_intent\[2\] != f'predecessor_release=\{effective_release\}'/u,
  /rotation_v10_intent\[3\] != f'successor_release=\{rotation_v10_release\}'/u,
  /rotation_v10_release in \{\s+successor,\s+rotation_release,\s+rotation_v2_release,\s+rotation_v3_release,\s+rotation_v4_release,\s+rotation_v5_release,\s+rotation_v6_release,\s+rotation_v7_release,\s+rotation_v8_release,\s+effective_release,/u,
  /rotation_v10_intent\[4\] !=\s+f'predecessor_helper_sha256=\{effective_helper_sha\}'/u,
  /rotation_v10_intent\[5\]\.split\('=', 1\)\[1\] in \{\s+successor_helper_sha,\s+rotation_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v2_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v3_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v4_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v5_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v6_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v7_intent\[5\]\.split\('=', 1\)\[1\],\s+rotation_v8_intent\[5\]\.split\('=', 1\)\[1\],\s+effective_helper_sha,/u,
  /rotation_v10_intent\[11\] !=\s+f'predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v9_intent_data\)\.hexdigest\(\)\}'/u,
  /rotation_v10_intent\[12\] !=\s+f'predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v9_completion_data\)\.hexdigest\(\)\}'/u,
  /rotation_v10_intent\[13\] !=\s+f'predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v9_predecessor_helper\)\.hexdigest\(\)\}'/u,
  /rotation_v10_intent\[14\] != rotation_v9_intent\[14\]/u,
  /rotation_v10_intent\[15\] != rotation_v9_intent\[15\]/u,
  /rotation_v10_intent\[16\] != rotation_v9_intent\[16\]/u,
  /rotation_v10_intent\[17\] != rotation_v9_intent\[17\]/u,
  /rotation_v10_completion\[2:18\] != rotation_v10_intent\[2:18\]/u,
  /rotation_v10_completion\[18\] !=/u,
  /exact_file\(\s+f'\{rotation_v10_root\}\/predecessor-helper',\s+\(0, 0\),\s+0o400,/u,
  /hashlib\.sha256\(archived_rotation_v10_predecessor_helper\)\.hexdigest\(\) != effective_helper_sha/u,
  /effective_release = rotation_v10_release/u,
  /effective_helper_sha = rotation_v10_intent\[5\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(successorRotationChain, rotationV10ChainContract);
}
assertInOrder(
  successorRotationChain,
  [
    'effective_release = rotation_v9_release',
    "effective_helper_sha = rotation_v9_intent[5].split('=', 1)[1]",
    'if os.path.lexists(rotation_v10_parent):',
    'rotation_v9_intent_data is None',
    'exact_directory(rotation_v10_parent, 0o700, [rotation_v10_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v10'",
    'archived_rotation_v10_predecessor_helper = exact_file(',
    'effective_release = rotation_v10_release',
    "effective_helper_sha = rotation_v10_intent[5].split('=', 1)[1]",
  ],
  'the tenth rotation must causally bind the exact ninth link before changing the effective identity',
);
const runtimeBridgeChain = successorRotationChain.slice(
  successorRotationChain.indexOf("runtime_bridge_state = 'absent'"),
  successorRotationChain.indexOf(
    'exact_directory(retirement',
    successorRotationChain.indexOf("runtime_bridge_state = 'absent'"),
  ),
);
assert.ok(
  runtimeBridgeChain.length > 0,
  'the successor inspector must expose a bounded H11 runtime-bridge parser',
);
for (const runtimeBridgeContract of [
  /if os\.path\.lexists\(rotation_v11_parent\):/u,
  /rotation_v10_intent_data is None/u,
  /rotation_v10_completion_data is None/u,
  /archived_rotation_v10_predecessor_helper is None/u,
  /overlay_release = effective_release/u,
  /runtime_bridge_predecessor_helper_sha = effective_helper_sha/u,
  /exact_directory\(rotation_v11_parent, 0o700, \[rotation_v11_release\]\)/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v11/u,
  /len\(rotation_v11_intent\) != 21/u,
  /len\(rotation_v11_completion\) != 22/u,
  /rotation_v11_intent\[2\] != f'overlay_release=\{overlay_release\}'/u,
  /rotation_v11_intent\[3\] != f'bridge_release=\{rotation_v11_release\}'/u,
  /predecessor_rotation_intent_sha256=/u,
  /predecessor_rotation_completion_sha256=/u,
  /predecessor_rotation_helper_archive_sha256=/u,
  /base_binding_v3_sha256=/u,
  /transition=historical-overlay-current-runtime-separated-v1/u,
  /financial_actions_mode=dry_run/u,
  /kemerbet_executor_enabled=false/u,
  /kemerbet_final_action_enabled=false/u,
  /transfer_enabled=false/u,
  /lookup_authorized=false/u,
  /recheck_authorized=false/u,
  /rotation_v11_completion\[1\] != 'state=runtime-bridge-installed'/u,
  /rotation_v11_completion\[2:21\] != rotation_v11_intent\[2:21\]/u,
  /hashlib\.sha256\(archived_rotation_v11_predecessor_helper\)\.hexdigest\(\) !=\s+runtime_bridge_predecessor_helper_sha/u,
  /effective_helper_sha = rotation_v11_intent\[5\]\.split\('=', 1\)\[1\]/u,
  /runtime_bridge_state = 'active'/u,
  /runtime_bridge_release = rotation_v11_release/u,
]) {
  assert.match(runtimeBridgeChain, runtimeBridgeContract);
}
assert.doesNotMatch(
  runtimeBridgeChain,
  /^\s*predecessor_helper_sha = effective_helper_sha\s*$/mu,
  'H11 must never overwrite the immutable historical/base helper digest used by retirement validation',
);
assert.doesNotMatch(
  runtimeBridgeChain,
  /effective_release = rotation_v11_release/u,
  'H11 must update only the installed helper/runtime bridge and must preserve the historical overlay release',
);
assertInOrder(
  runtimeBridgeChain,
  [
    'overlay_release = effective_release',
    'runtime_bridge_predecessor_helper_sha = effective_helper_sha',
    'exact_directory(rotation_v11_parent, 0o700, [rotation_v11_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v11'",
    "'transition=historical-overlay-current-runtime-separated-v1'",
    "'lookup_authorized=false'",
    "'recheck_authorized=false'",
    'archived_rotation_v11_predecessor_helper = exact_file(',
    "effective_helper_sha = rotation_v11_intent[5].split('=', 1)[1]",
    "runtime_bridge_state = 'active'",
    'runtime_bridge_release = rotation_v11_release',
  ],
  'H11 must causally attest H10, retain the historical overlay identity, and activate only a no-finance runtime bridge',
);
const parserScopeRepairChain = runtimeBridgeChain.slice(
  runtimeBridgeChain.indexOf('if os.path.lexists(rotation_v12_parent):'),
);
assert.ok(
  parserScopeRepairChain.length > 0,
  'the successor inspector must expose a bounded H12 parser-scope repair parser',
);
for (const parserScopeRepairContract of [
  /if os\.path\.lexists\(rotation_v12_parent\):/u,
  /runtime_bridge_state != 'active'/u,
  /rotation_v12_predecessor_helper_sha = effective_helper_sha/u,
  /exact_directory\(rotation_v12_parent, 0o700, \[rotation_v12_release\]\)/u,
  /\['completed-v1', 'intent-v1', 'predecessor-helper'\]/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v12/u,
  /len\(rotation_v12_intent\) != 22/u,
  /len\(rotation_v12_completion\) != 23/u,
  /rotation_v12_intent\[2\] != f'overlay_release=\{overlay_release\}'/u,
  /rotation_v12_intent\[3\] != f'runtime_bridge_release=\{rotation_v11_release\}'/u,
  /rotation_v12_intent\[4\] != f'repair_release=\{rotation_v12_release\}'/u,
  /predecessor_helper_sha256=\{rotation_v12_predecessor_helper_sha\}/u,
  /successor_helper_sha256=/u,
  /predecessor_rotation_intent_sha256=\{hashlib\.sha256\(rotation_v11_intent_data\)\.hexdigest\(\)\}/u,
  /predecessor_rotation_completion_sha256=\{hashlib\.sha256\(rotation_v11_completion_data\)\.hexdigest\(\)\}/u,
  /predecessor_rotation_helper_archive_sha256=\{hashlib\.sha256\(archived_rotation_v11_predecessor_helper\)\.hexdigest\(\)\}/u,
  /base_binding_v3_sha256=\{v3_sha\}/u,
  /rotation_v12_intent\[11\] != rotation_v11_intent\[10\]/u,
  /rotation_v12_intent\[12\] != rotation_v11_intent\[11\]/u,
  /rotation_v12_intent\[13\] != rotation_v11_intent\[12\]/u,
  /rotation_v12_intent\[14\] != rotation_v11_intent\[13\]/u,
  /transition=runtime-bridge-parser-scope-repair-v1/u,
  /financial_actions_mode=dry_run/u,
  /kemerbet_executor_enabled=false/u,
  /kemerbet_final_action_enabled=false/u,
  /transfer_enabled=false/u,
  /lookup_authorized=false/u,
  /recheck_authorized=false/u,
  /rotation_v12_completion\[1\] != 'state=parser-repair-installed'/u,
  /rotation_v12_completion\[2:22\] != rotation_v12_intent\[2:22\]/u,
  /rotation_intent_sha256=\{hashlib\.sha256\(rotation_v12_intent_data\)\.hexdigest\(\)\}/u,
  /hashlib\.sha256\(archived_rotation_v12_predecessor_helper\)\.hexdigest\(\) !=\s+rotation_v12_predecessor_helper_sha/u,
  /effective_helper_sha = rotation_v12_intent\[6\]\.split\('=', 1\)\[1\]/u,
]) {
  assert.match(parserScopeRepairChain, parserScopeRepairContract);
}
assert.doesNotMatch(
  parserScopeRepairChain,
  /^\s*predecessor_helper_sha\s*=/mu,
  'H12 must never assign the immutable historical/base helper digest',
);
assert.doesNotMatch(
  parserScopeRepairChain,
  /effective_release = rotation_v12_release|runtime_bridge_release = rotation_v12_release/u,
  'H12 may update only the effective helper digest, never the historical overlay or H11 bridge release',
);
assertInOrder(
  parserScopeRepairChain,
  [
    'if os.path.lexists(rotation_v12_parent):',
    "runtime_bridge_state != 'active'",
    'rotation_v12_predecessor_helper_sha = effective_helper_sha',
    'exact_directory(rotation_v12_parent, 0o700, [rotation_v12_release])',
    "'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v12'",
    "'transition=runtime-bridge-parser-scope-repair-v1'",
    "'lookup_authorized=false'",
    "'recheck_authorized=false'",
    'archived_rotation_v12_predecessor_helper = exact_file(',
    "effective_helper_sha = rotation_v12_intent[6].split('=', 1)[1]",
  ],
  'H12 must attest the active H11 bridge, append its immutable repair record, and only then advance the effective helper digest',
);

const h11ScopedCaptureStatement =
  /^\s*(runtime_bridge_predecessor_helper_sha = effective_helper_sha)\s*$/mu.exec(
    runtimeBridgeChain,
  )?.[1];
const h11EffectiveUpdateStatement =
  /^\s*(effective_helper_sha = rotation_v11_intent\[5\]\.split\('=', 1\)\[1\])\s*$/mu.exec(
    runtimeBridgeChain,
  )?.[1];
const h12ScopedCaptureStatement =
  /^\s*(rotation_v12_predecessor_helper_sha = effective_helper_sha)\s*$/mu.exec(
    parserScopeRepairChain,
  )?.[1];
const h12EffectiveUpdateStatement =
  /^\s*(effective_helper_sha = rotation_v12_intent\[6\]\.split\('=', 1\)\[1\])\s*$/mu.exec(
    parserScopeRepairChain,
  )?.[1];
const immutableRetirementComparison =
  /(retirement_intent\[4\] != f'helper_sha256=\{predecessor_helper_sha\}')/u.exec(
    inspectV2V3SuccessorGate,
  )?.[1];
assert.ok(
  h11ScopedCaptureStatement &&
    h11EffectiveUpdateStatement &&
    h12ScopedCaptureStatement &&
    h12EffectiveUpdateStatement &&
    immutableRetirementComparison,
  'the exact H11/H12 scope-changing statements and immutable retirement comparison must be extractable',
);
if (process.platform === 'linux') {
  const parserScopeRegression = `
predecessor_helper_sha = '${'a'.repeat(64)}'
effective_helper_sha = '${'b'.repeat(64)}'
rotation_v11_intent = [''] * 6
rotation_v11_intent[5] = 'successor_helper_sha256=${'c'.repeat(64)}'
${h11ScopedCaptureStatement}
assert runtime_bridge_predecessor_helper_sha == '${'b'.repeat(64)}'
${h11EffectiveUpdateStatement}
assert effective_helper_sha == '${'c'.repeat(64)}'
assert predecessor_helper_sha == '${'a'.repeat(64)}'
rotation_v12_intent = [''] * 7
rotation_v12_intent[6] = 'successor_helper_sha256=${'d'.repeat(64)}'
${h12ScopedCaptureStatement}
assert rotation_v12_predecessor_helper_sha == '${'c'.repeat(64)}'
${h12EffectiveUpdateStatement}
assert effective_helper_sha == '${'d'.repeat(64)}'
assert predecessor_helper_sha == '${'a'.repeat(64)}'
retirement_intent = [''] * 5
retirement_intent[4] = 'helper_sha256=${'a'.repeat(64)}'
assert not (${immutableRetirementComparison})
`;
  const parserScopeRegressionResult = spawnSync('/usr/bin/python3', ['-I', '-'], {
    encoding: 'utf8',
    input: parserScopeRegression,
  });
  assert.equal(
    parserScopeRegressionResult.status,
    0,
    `H11/H12 must preserve the distinct historical helper digest through immutable retirement validation: ${parserScopeRegressionResult.stderr}`,
  );
}

for (const fixedParserScopeRepairV12Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly HISTORICAL_OVERLAY_RELEASE='c061f9dc05e60d641d306f16b5d826e6e1b2c6c4'$/mu,
  /^readonly REVIEWED_BRIDGE_RELEASE='21ef5f0d987d9dc21efc1a81916316a3f6d7f864'$/mu,
  new RegExp(`^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3RuntimeBridgeHelperV11Sha}'$`, 'mu'),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3RuntimeBridgeParserScopeRepairHelperV12Sha}'$`,
    'mu',
  ),
  /^readonly CONFIRMATION='I-UNDERSTAND-THIS-INSTALLS-ONE-H12-PARSER-SCOPE-REPAIR-WITH-TRANSFER-DISABLED'$/mu,
  /^readonly EXPECTED_DROPLET_ID='593344964'$/mu,
  /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu,
  /^readonly SUDOERS_DISABLED='\/etc\/sudoers\.d\/\.fetanagent-staging-deploy-helper\.v3-runtime-bridge-v11-disabled'$/mu,
  /^readonly ROTATION_V11_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v11'$/mu,
  /^readonly ROTATION_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v12'$/mu,
  /\[\[ \$# -eq 3 \]\] \|\| die 'expected the repair release, reviewed helper digest, and exact H12 confirmation'/u,
  /\[\[ "\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION" \]\] \|\| die 'the exact H12 confirmation is required'/u,
  /load_exact_h10_evidence/u,
  /load_exact_h11_evidence/u,
  /contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v12/u,
  /state=parser-repair-installed/u,
  /transition=runtime-bridge-parser-scope-repair-v1/u,
  /financial_actions_mode=dry_run/u,
  /kemerbet_executor_enabled=false/u,
  /kemerbet_final_action_enabled=false/u,
  /transfer_enabled=false/u,
  /lookup_authorized=false/u,
  /recheck_authorized=false/u,
  /print\('absent'\)/u,
  /print\('empty-parent'\)/u,
  /print\('interrupted'\)/u,
  /print\('completed'\)/u,
  /entries == \[f'\.installing-\{release\}'\]/u,
  /entries == \[release\]/u,
]) {
  assert.match(v3RuntimeBridgeParserScopeRepairV12, fixedParserScopeRepairV12Contract);
}
const parserScopeRepairV12Classifier = extractShellFunction(
  v3RuntimeBridgeParserScopeRepairV12,
  'classify_rotation',
  'require_rotation_prefix',
);
const parserScopeRepairV12ClassifierPython = extractSingleQuotedPythonHeredoc(
  parserScopeRepairV12Classifier,
  'classify_rotation',
);
if (process.platform === 'linux') {
  const classifierFixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-h12-classifier-'));
  const classifierParent = join(classifierFixtureRoot, 'rotation-v12');
  const classifierRelease = 'a'.repeat(40);
  const classifierProgram = join(classifierFixtureRoot, 'classify.py');
  writeFileSync(
    classifierProgram,
    parserScopeRepairV12ClassifierPython.replace(
      '(0, 0, 0o700)',
      '(os.getuid(), os.getgid(), 0o700)',
    ),
    { mode: 0o600 },
  );
  const runClassifierFixture = () =>
    spawnSync('/usr/bin/python3', ['-I', classifierProgram, classifierParent, classifierRelease], {
      encoding: 'utf8',
    });
  try {
    let result = runClassifierFixture();
    assert.equal(result.status, 0, `H12 absent classifier failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'absent');

    mkdirSync(classifierParent, { mode: 0o700 });
    chmodSync(classifierParent, 0o700);
    result = runClassifierFixture();
    assert.equal(result.status, 0, `H12 empty-parent classifier failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'empty-parent');

    mkdirSync(join(classifierParent, `.installing-${classifierRelease}`), { mode: 0o700 });
    result = runClassifierFixture();
    assert.equal(result.status, 0, `H12 interrupted classifier failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'interrupted');

    rmSync(join(classifierParent, `.installing-${classifierRelease}`), { recursive: true });
    mkdirSync(join(classifierParent, classifierRelease), { mode: 0o700 });
    result = runClassifierFixture();
    assert.equal(result.status, 0, `H12 completed classifier failed: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'completed');

    mkdirSync(join(classifierParent, 'foreign-entry'), { mode: 0o700 });
    result = runClassifierFixture();
    assert.notEqual(result.status, 0, 'H12 classifier must reject any foreign namespace entry');
  } finally {
    rmSync(classifierFixtureRoot, { recursive: true, force: true });
  }
}
const parserScopeRepairV12Prefix = extractShellFunction(
  v3RuntimeBridgeParserScopeRepairV12,
  'require_rotation_prefix',
  'require_record_prefix',
);
for (const prefixContract of [
  /'\.completed-v1\.installing': \(0o600, 4096\)/u,
  /'\.intent-v1\.installing': \(0o600, 4096\)/u,
  /'\.predecessor-helper\.installing': \(0o400, 2 \* 1024 \* 1024\)/u,
  /'completed-v1': \(0o600, 4096\)/u,
  /'intent-v1': \(0o600, 4096\)/u,
  /'predecessor-helper': \(0o400, 2 \* 1024 \* 1024\)/u,
  /any\(name not in allowed for name in entries\)/u,
  /if final in entries and f'\.\{final\}\.installing' in entries/u,
  /item\.st_nlink\) !=\s+\(0, 0, mode, 1\)/u,
  /item\.st_size > maximum/u,
]) {
  assert.match(parserScopeRepairV12Prefix, prefixContract);
}
const parserScopeRepairV12InterruptedPrefix = extractShellFunction(
  v3RuntimeBridgeParserScopeRepairV12,
  'require_interrupted_prefix_consistency',
  'require_exact_rotation_record',
);
for (const interruptedPrefixContract of [
  /require_rotation_prefix/u,
  /require_disabled_grant_only/u,
  /require_record_prefix "\$ROTATION_INSTALLING\/intent-v1"/u,
  /require_record_prefix "\$ROTATION_INSTALLING\/completed-v1"/u,
  /target_state='predecessor'/u,
  /target_state='successor'/u,
  /require_copy_prefix "\$ROTATION_INSTALLING\/\.predecessor-helper\.installing"/u,
  /require_helper_file "\$ROTATION_INSTALLING\/predecessor-helper"/u,
  /require_helper_file "\$INSTALLING_HELPER" "\$SUCCESSOR_HELPER_SHA256" 755/u,
  /require_copy_prefix "\$INSTALLING_HELPER_PARTIAL" "\$STAGED_HELPER" 755 600/u,
]) {
  assert.match(parserScopeRepairV12InterruptedPrefix, interruptedPrefixContract);
}
const parserScopeRepairV12Main = v3RuntimeBridgeParserScopeRepairV12.slice(
  v3RuntimeBridgeParserScopeRepairV12.indexOf(
    "require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'",
  ),
);
assert.ok(
  parserScopeRepairV12Main.length > 0,
  'the H12 repair must expose one bounded root-only execution path',
);
const parserScopeRepairV12PreInstall = parserScopeRepairV12Main.slice(
  0,
  parserScopeRepairV12Main.indexOf('mv -- "$INSTALLING_HELPER" "$TARGET"'),
);
assert.doesNotMatch(
  parserScopeRepairV12PreInstall,
  /^\s*run_helper_direct\s+(?!\(\))/mu,
  'the known-broken H11 helper must never be invoked before the corrected helper replaces it',
);
assertInOrder(
  parserScopeRepairV12Main,
  [
    "load_exact_h10_evidence || die 'the immutable H10 rotation evidence is invalid'",
    "load_exact_h11_evidence || die 'the immutable H11 runtime-bridge evidence is invalid'",
    'rotation_state="$(classify_rotation)"',
    "open_lock || die 'the exact staging mutation lock is unsafe or another mutation is active'",
    "load_exact_h11_evidence || die 'the immutable H11 runtime-bridge evidence changed under lock'",
    'publish_record "$ROTATION_INSTALLING" intent-v1 0600 expected_intent',
    'copy_root_file_atomically "$TARGET"',
    'mv -- "$INSTALLING_HELPER" "$TARGET"',
    'publish_record "$ROTATION_INSTALLING" completed-v1 0600 expected_completion',
    'mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"',
    'close_lock',
    'run_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256"',
    "open_lock || die 'the exact staging mutation lock changed or another mutation appeared'",
    "load_exact_h11_evidence || die 'the immutable H11 runtime-bridge evidence changed before grant restoration'",
    '[[ "$(classify_rotation)" == \'completed\' ]]',
    "restore_sudoers || die 'the deployment grant could not be restored safely'",
  ],
  'H12 must append intent, archive H11, install and attest the corrected helper, publish completion, re-lock, and restore sudo last',
);
assert.equal(
  (parserScopeRepairV12Main.match(/^\s*restore_sudoers \|\| die/gmu) ?? []).length,
  1,
  'the H12 execution path may restore the deployment grant at exactly one final checkpoint',
);
assert.equal(
  (parserScopeRepairV12Main.match(/^\s*run_helper_direct\s+/gmu) ?? []).length,
  2,
  'the corrected H12 helper may be invoked only for digest verification and the no-finance bridge-ready attestation',
);
assert.doesNotMatch(
  v3RuntimeBridgeParserScopeRepairV12,
  /(?:^|\n)\s*(?:rm|rmdir|unlink)\s/u,
  'H12 must preserve every prior evidence and checkpoint rather than deleting recovery state',
);
assert.doesNotMatch(
  v3RuntimeBridgeParserScopeRepairV12,
  /docker_local_read_only\s+(?:container|network|volume|image|system)\s+(?:create|start|stop|kill|restart|rm|prune)/u,
  'H12 Docker inspection must remain read-only',
);
assert.doesNotMatch(
  v3RuntimeBridgeParserScopeRepairV12,
  /^\s*run_helper_direct\s+(?:kemerbet-readiness-(?:lookup|recheck)|kemerbet-final|transfer|deposit|withdraw|executor)/mu,
  'H12 must not authorize lookup, recheck, Transfer, executor, or any financial action',
);
assert.doesNotMatch(
  v3RuntimeBridgeParserScopeRepairV12,
  /(?:publish_record|copy_root_file_atomically|install -d|mv --)[^\n]*ROTATION_V11/u,
  'H12 must treat the complete H11 namespace as immutable input only',
);
const parserScopeRepairV12InitialAdmission = extractShellFunction(
  v3RuntimeBridgeParserScopeRepairV12,
  'require_initial_namespace',
  'require_exact_empty_checkpoint',
);
for (const initialAdmissionContract of [
  /require_exact_h11_repair_boundary/u,
  /absent/u,
  /empty-parent/u,
]) {
  assert.match(parserScopeRepairV12InitialAdmission, initialAdmissionContract);
}
const parserScopeRepairV12HistoricalBoundary = extractShellFunction(
  v3RuntimeBridgeParserScopeRepairV12,
  'require_exact_h11_repair_boundary',
  'expected_intent',
);
for (const historicalBoundaryContract of [
  /require_helper_file "\$TARGET" "\$PREDECESSOR_HELPER_SHA256" 755/u,
  /load_exact_h10_evidence/u,
  /load_exact_h11_evidence/u,
  /require_disabled_grant_only/u,
  /require_stopped_durable_boundary/u,
]) {
  assert.match(parserScopeRepairV12HistoricalBoundary, historicalBoundaryContract);
}
const parserScopeRepairV12Lock = extractShellFunction(
  v3RuntimeBridgeParserScopeRepairV12,
  'open_lock',
  'close_lock',
);
for (const lockContract of [
  /LOCK_ROOT/u,
  /mkdir --mode=0700/u,
  /root:root:700/u,
  /root:root:600:1/u,
  /exec 9<>"\$LOCK"/u,
  /stat --format='%u:%g:%a:%h:%d:%i' "\$LOCK"/u,
  /stat -L --format='%u:%g:%a:%h:%d:%i' \/proc\/self\/fd\/9/u,
  /flock --exclusive --nonblock 9/u,
]) {
  assert.match(parserScopeRepairV12Lock, lockContract);
}
assertInOrder(
  parserScopeRepairV12Lock,
  [
    'path_identity="$(stat --format=\'%u:%g:%a:%h:%d:%i\' "$LOCK")"',
    'fd_identity="$(stat -L --format=\'%u:%g:%a:%h:%d:%i\' /proc/self/fd/9)"',
    '[[ "$fd_identity" == \'0:0:600:1:\'* && "$fd_identity" == "$path_identity" ]]',
    'flock --exclusive --nonblock 9',
    '[[ "$(stat --format=\'%u:%g:%a:%h:%d:%i\' "$LOCK")" == "$fd_identity" ]]',
  ],
  'H12 must prove lock path/fd identity both before and after flock',
);
const parserScopeRepairV12Restore = extractShellFunction(
  v3RuntimeBridgeParserScopeRepairV12,
  'restore_sudoers',
  'open_lock',
);
assertInOrder(
  parserScopeRepairV12Restore,
  [
    'mv -- "$SUDOERS_DISABLED" "$SUDOERS"',
    'require_exact_sudoers_file "$SUDOERS"',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
  ],
  'a failed post-move sudoers validation must roll back to the disabled path',
);

for (const fixedRecheckBridgeV13Contract of [
  /^#!\/usr\/bin\/env bash$/mu,
  /^set -euo pipefail$/mu,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
  /^readonly HISTORICAL_OVERLAY_RELEASE='c061f9dc05e60d641d306f16b5d826e6e1b2c6c4'$/mu,
  /^readonly RUNTIME_BRIDGE_RELEASE='21ef5f0d987d9dc21efc1a81916316a3f6d7f864'$/mu,
  new RegExp(
    `^readonly PREDECESSOR_HELPER_SHA256='${reviewedV3RuntimeBridgeParserScopeRepairHelperV12Sha}'$`,
    'mu',
  ),
  new RegExp(
    `^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${reviewedV3RecheckBridgeHelperV13Sha}'$`,
    'mu',
  ),
  /^readonly CONFIRMATION='CONFIRM EXACT-FIVE NO-TRANSFER KEMERBET RECHECK'$/mu,
  /^readonly EXPECTED_DROPLET_ID='593344964'$/mu,
  /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu,
  /^readonly ROTATION_V12_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-helper-rotation-v12'$/mu,
  /^readonly BRIDGE_PARENT='\/var\/lib\/fetanagent\/kemerbet-readiness-v3-recheck-bridge-v13'$/mu,
  /^readonly SOURCE_BINDING='\/var\/lib\/fetanagent\/kemerbet-readiness-seal-output\/kemerbet_agent_identity_bindings'$/mu,
  /^readonly FINAL_BINDING='\/etc\/fetanagent\/executor-secrets\/kemerbet_agent_identity_bindings'$/mu,
  /\[\[ \$# -eq 3 \]\] \|\| die 'expected the recheck release, reviewed helper digest, and exact confirmation'/u,
  /\[\[ "\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION" \]\] \|\|\s+die 'the exact no-transfer exact-five confirmation is required'/u,
  /contract=fetanagent-kemerbet-readiness-v3-recheck-bridge-v13/u,
  /state=authorized/u,
  /state=recheck-bridge-installed/u,
  /authorization=\$CONFIRMATION/u,
  /financial_actions_mode=dry_run/u,
  /kemerbet_executor_enabled=false/u,
  /kemerbet_final_action_enabled=false/u,
  /transfer_enabled=false/u,
  /amount_entry_enabled=false/u,
  /lookup_authorized=exact-five-profile-read-only-once/u,
  /recheck_authorized=exact-five-no-transfer-once/u,
  /executor_final_action_enabled=false/u,
  /10001:10001:600:1:230/u,
  /hmac-sha256-agent-profile-pin-v3/u,
]) {
  assert.match(v3RecheckBridgeV13, fixedRecheckBridgeV13Contract);
}
const recheckBridgeV13Main = v3RecheckBridgeV13.slice(
  v3RecheckBridgeV13.indexOf(
    "require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'",
  ),
);
assert.ok(
  recheckBridgeV13Main.length > 0,
  'H13 must expose one bounded root-only installation path',
);
assertInOrder(
  recheckBridgeV13Main,
  [
    "load_exact_h12_evidence || die 'the immutable H12 parser-repair evidence is invalid'",
    'require_stopped_durable_boundary ||',
    'run_helper_direct verify "$PREDECESSOR_HELPER_SHA256"',
    'run_helper_direct kemerbet-v3-runtime-bridge-ready "$PREDECESSOR_HELPER_SHA256"',
    "open_lock || die 'the exact staging mutation lock is unsafe or another mutation is active'",
    "disable_sudoers || die 'the deployment grant could not be disabled safely'",
    'publish_record "$BRIDGE_INSTALLING" intent-v1 600 expected_intent',
    'copy_root_file_atomically "$TARGET"',
    'mv -- "$INSTALLING_HELPER" "$TARGET"',
    'publish_record "$BRIDGE_INSTALLING" completed-v1 600 expected_completion',
    'mv -- "$BRIDGE_INSTALLING" "$BRIDGE_ROOT"',
    'run_helper_direct verify "$SUCCESSOR_HELPER_SHA256"',
    'run_helper_direct kemerbet-v3-recheck-bridge-ready "$SUCCESSOR_HELPER_SHA256" "$RECHECK_RELEASE"',
    "open_lock || die 'the exact staging mutation lock changed before grant restoration'",
    "restore_sudoers || die 'the deployment grant could not be restored safely'",
  ],
  'H13 must attest H12, stop, disable the grant, append evidence, rotate and attest the helper, and restore the grant last',
);
assert.equal(
  (recheckBridgeV13Main.match(/^\s*restore_sudoers \|\| die/gmu) ?? []).length,
  1,
  'H13 may restore deployment access at exactly one final checkpoint',
);
assert.equal(
  (recheckBridgeV13Main.match(/^\s*run_helper_direct\s+/gmu) ?? []).length,
  4,
  'H13 may invoke only the predecessor and successor digest/read-only bridge attestations',
);
assert.doesNotMatch(
  v3RecheckBridgeV13,
  /^\s*run_helper_direct\s+(?:kemerbet-readiness-(?:lookup|recheck)|kemerbet-final|transfer|deposit|withdraw|executor)/mu,
  'the H13 installer must never perform a lookup, recheck, Transfer, executor, or financial action',
);
assert.doesNotMatch(
  v3RecheckBridgeV13,
  /docker_local_read_only\s+(?:container|network|volume|image|system)\s+(?:create|start|stop|kill|restart|rm|prune)/u,
  'H13 Docker inspection must remain read-only',
);
assert.doesNotMatch(
  v3RecheckBridgeV13,
  /PlayerEPOSDeposit|financial_actions_mode=live|kemerbet_executor_enabled=true|kemerbet_final_action_enabled=true|executor_final_action_enabled=true/u,
  'H13 must not contain a financial-action implementation or live financial switch',
);
assert.doesNotMatch(
  v3RecheckBridgeV13,
  /(?:publish_record|copy_root_file_atomically|install -d|mv --)[^\n]*ROTATION_V12/u,
  'H13 must treat the complete H12 namespace as immutable input only',
);
assert.match(
  compose,
  /source: \$\{FETANAGENT_STAGING_KEMERBET_SESSION_BINDING_FILE:-\/etc\/fetanagent\/executor-secrets\/kemerbet_agent_identity_bindings\}/u,
  'the private preview binding source must use the single explicit H13 interpolation with the final binding as its fail-closed default',
);
assert.doesNotMatch(
  compose,
  /^\s+FETANAGENT_STAGING_KEMERBET_SESSION_BINDING_FILE:/mu,
  'the host-only H13 binding selector must never be passed into a container environment',
);
assert.doesNotMatch(
  successorRotationChain,
  /os\.(?:rename|replace|unlink|mkdir|makedirs)|open\([^\n]*O_(?:WRONLY|RDWR|CREAT)/u,
  'the helper rotation-chain inspector must remain read-only',
);
assert.match(
  inspectV2V3SuccessorGate,
  /receipt_lines\[1\] !=\s+f'release=\{recheck_bridge_release if recheck_bridge_state == "active" else effective_release\}/u,
  'a later terminal ready receipt must bind the authorized H13 recheck release while retaining the legacy fallback',
);
const successorRecoverableBranch =
  /promotion_exists = promotion_exists_and_is_safe\(\)\nif promotion_exists:([\s\S]*?)\nelif os\.path\.lexists\(binding\):/u.exec(
    inspectV2V3SuccessorGate,
  )?.[1];
const successorInstalledBranch =
  /elif os\.path\.lexists\(binding\):([\s\S]*?)\nelse:\n    require_v3_binding\(committed_binding/u.exec(
    inspectV2V3SuccessorGate,
  )?.[1];
const successorCompletedBranch =
  /else:\n    require_v3_binding\(committed_binding([\s\S]*?)\n    gate_state = 'successor-completed'/u.exec(
    inspectV2V3SuccessorGate,
  )?.[1];
assert.ok(
  successorRecoverableBranch && successorInstalledBranch && successorCompletedBranch,
  'the successor inspector must expose promotion-first recoverable, installed, and completed branches',
);
assertInOrder(
  successorRecoverableBranch,
  ['require_live_successor_helper()', "gate_state = 'successor-recheck-recoverable'"],
  'a safe promotion root must force exact-helper recovery before any installed/completed classification',
);
assertInOrder(
  successorInstalledBranch,
  [
    'require_v3_binding(binding, (10001, 10001), 0o600)',
    'require_live_successor_helper()',
    'os.path.lexists(committed_binding)',
    'os.path.lexists(os.path.dirname(recheck_receipt))',
    'os.path.lexists(owner_completion)',
    'os.path.lexists(candidate_root)',
    'os.path.lexists(rpc_root)',
    "gate_state = 'successor-installed'",
  ],
  'installed classification must prove the live source and helper while excluding terminal or transient residue',
);
assertInOrder(
  successorCompletedBranch,
  [
    ', (0, 0), 0o444)',
    "exact_directory(os.path.dirname(recheck_receipt), 0o700, ['ready-v1'])",
    'receipt_data = exact_file(recheck_receipt, (0, 0), 0o600, 4096)',
    'owner_completion_data = exact_file(owner_completion, (0, 10001), 0o440, 37, 37)',
    'for consumed_or_transient in (',
  ],
  'completed classification must derive solely from exact durable binding, receipt, Owner claim, and consumed-input absence',
);
assert.doesNotMatch(
  successorCompletedBranch,
  /require_live_successor_helper/u,
  'terminal successor completion must survive later approved helper rotation',
);
const terminalCompletedStart = inspectV2V3SuccessorGate.indexOf(
  'else:\n    require_v3_binding(committed_binding',
);
const terminalCompletedAssignment = "    gate_state = 'successor-completed'";
const terminalCompletedEnd =
  inspectV2V3SuccessorGate.indexOf(terminalCompletedAssignment, terminalCompletedStart) +
  terminalCompletedAssignment.length;
assert.ok(
  terminalCompletedStart >= 0 && terminalCompletedEnd > terminalCompletedStart,
  'the exact terminal successor-completed Python branch must be extractable',
);
const executableTerminalCompletedBranch = inspectV2V3SuccessorGate
  .slice(terminalCompletedStart, terminalCompletedEnd)
  .replace(/^else:/u, 'if True:');
if (process.platform === 'linux') {
  const completedFixture = `
import hashlib
import os
import re

sha = re.compile(r'[0-9a-f]{64}')
effective_release = '${'b'.repeat(40)}'
effective_helper_sha = '${'c'.repeat(64)}'
recheck_bridge_state = 'active'
recheck_bridge_release = '${'a'.repeat(40)}'
later_helper_bytes = b'later ordinary reviewed helper bytes'
assert hashlib.sha256(later_helper_bytes).hexdigest() != effective_helper_sha
v3_sha = '${'d'.repeat(64)}'
identity_key_data = b'identity-key-fixture'
selector_bytes = b'{"fixture":true}\\n'
owner_completion_data = b'00000000-0000-1000-8000-000000000000\\n'
claim = re.compile(rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\n')
retirement_intent = [''] * 10
retirement_intent[9] = 'claim_sha256=' + hashlib.sha256(owner_completion_data).hexdigest()
identity_key_owner_mode = (0, 0, 0o444)
committed_binding = '/fixture/committed-binding'
recheck_receipt = '/fixture/ready/ready-v1'
owner_completion = '/fixture/owner/completed-v1'
selector_contract = '/fixture/selector'
binding = '/fixture/consumed-binding'
readiness_player_ids = '/fixture/consumed-player-ids'
candidate_root = '/fixture/candidate'
promotion_root = '/fixture/promotion'
rpc_root = '/fixture/rpc'
receipt_lines = [
    'version=1',
    f'release={recheck_bridge_release}',
    f'binding_sha256={v3_sha}',
    f'identity_hmac_key_sha256={hashlib.sha256(identity_key_data).hexdigest()}',
    f'selector_sha256={hashlib.sha256(selector_bytes).hexdigest()}',
    'image_id=sha256:${'e'.repeat(64)}',
    'profile_volume=fetanagent-staging-beta_kemerbet_sessions',
    'profile_identity_sha256=${'f'.repeat(64)}',
]
receipt_data = ('\\n'.join(receipt_lines) + '\\n').encode('ascii')

def reject():
    raise AssertionError('terminal completion fixture rejected')

def require_live_successor_helper():
    raise AssertionError('terminal completion re-pinned later helper bytes')

def require_v3_binding(*_args):
    return b'binding'

def exact_directory(*_args):
    return None

def exact_file(path, *_args):
    if path == recheck_receipt:
        return receipt_data
    if path == selector_contract:
        return selector_bytes
    if path == owner_completion:
        return owner_completion_data
    raise AssertionError(path)

os.path.lexists = lambda _path: False
${executableTerminalCompletedBranch}
assert gate_state == 'successor-completed'
`;
  const completedFixtureResult = spawnSync('/usr/bin/python3', ['-I', '-'], {
    encoding: 'utf8',
    input: completedFixture,
  });
  assert.equal(
    completedFixtureResult.status,
    0,
    `terminal completion must accept later helper bytes while retaining the rotated receipt release: ${completedFixtureResult.stderr}`,
  );
}
for (const successorState of [
  'successor-recheck-recoverable',
  'successor-installed',
  'successor-completed',
]) {
  assert.equal(
    (inspectV2V3SuccessorGate.match(new RegExp(`gate_state = '${successorState}'`, 'gu')) ?? [])
      .length,
    1,
    `the successor inspector must assign ${successorState} in exactly one branch`,
  );
}
for (const forbiddenSuccessorCompletionMarker of [
  /publish_kemerbet_v3_successor_recheck_completion/u,
  /completion_name/u,
  /completion_temporary_name/u,
  /\bKEMERBET_V3_SUCCESSOR_COMPLETION(?:_NAME|_PATH|_ROOT)?\b/u,
  /\bsuccessor_completion(?:_name|_path|_root)?=/u,
  /contract=fetanagent-kemerbet-v2-v3-successor-recheck-v1/u,
  /successor-commit-prefix/u,
]) {
  assert.doesNotMatch(
    helper,
    forbiddenSuccessorCompletionMarker,
    'terminal v3 completion must be derived from existing durable artifacts without a fifth overlay marker',
  );
}
const requiredV3RecheckRelease = extractShellFunction(
  helper,
  'required_kemerbet_v3_recheck_release',
  'enforce_kemerbet_v2_v3_successor_gate',
);
const enforceV2V3SuccessorGate = extractShellFunction(
  helper,
  'enforce_kemerbet_v2_v3_successor_gate',
  'consume_exact_one_use_kemerbet_file',
);
for (const successorGateEnforcementContract of [
  /if \[\[ "\$command" =~ \^\(verify\|kemerbet-v3-runtime-bridge-ready\|kemerbet-v3-recheck-bridge-ready\|docker-storage-ready\)\$ \]\]; then\s+return 0\s+fi/u,
  /inspect_kemerbet_v2_v3_successor_gate/,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed'/u,
  /retire-kemerbet-readiness-binding-v1-for-v2-reseal\|reinstall-kemerbet-v1-retirement-secrets\|seal-kemerbet-readiness\|kemerbet-v1-retirement-recovery-ready/u,
  /permanently forbids legacy v1\/v2 reseal or recovery commands/u,
  /stop-bot\|stop-kemerbet-session-provision\)[\s\S]*?return 0/u,
  /recheck-kemerbet-readiness\)[\s\S]*?"\$release" == "\$expected_recheck_release"/u,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-recheck-recoverable'/u,
  /an interrupted KemerBet v3 recheck permits only exact-release recovery/u,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed'/,
  /incomplete or invalid KemerBet v2-to-v3 successor migration blocks staging mutations/u,
  /stop\|expiry-stop\|stop-public-edge/u,
  /stop-bot\|stop-kemerbet-session-provision/u,
  /the KemerBet v3 successor stop command belongs to another reviewed release/u,
  /network-ready\)\s+return 0/u,
  /recheck-kemerbet-readiness\)[\s\S]*?the KemerBet v3 lookup\/recheck boundary is bound to another reviewed release/u,
  /kemerbet-v3-successor-ready\)[\s\S]*?the KemerBet v3 successor overlay is bound to another reviewed release/u,
  /the KemerBet v3 lookup\/recheck boundary is bound to another reviewed release/u,
  /install\|fresh-start\|fresh-host-ready\|arm-expiry-stop\|bot-disabled-ready\|install-bot-token\|start-bot\|bot-ready\|fresh-public-edge-ready\|start-fresh-public-edge\|diagnose-owner-startup\|discard\|stop-bot\|start-kemerbet-session-provision\|kemerbet-session-provision-ready\|stop-kemerbet-session-provision/u,
  /KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active'/u,
  /"\$release" =~ \^\[0-9a-f\]\{40\}\$/u,
  /the reviewed current runtime release is invalid/u,
  /"\$release" == "\$KEMERBET_V2_V3_SUCCESSOR_RELEASE"/u,
  /permits only no-transfer deployment, private sign-in, and readiness recheck/u,
]) {
  assert.match(enforceV2V3SuccessorGate, successorGateEnforcementContract);
}
assertInOrder(
  enforceV2V3SuccessorGate,
  [
    'if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == \'successor-completed\' ]]; then',
    'stop-bot|stop-kemerbet-session-provision)',
    'return 0',
    'recheck-kemerbet-readiness)',
    'stop|expiry-stop|stop-public-edge)',
    'stop-bot|stop-kemerbet-session-provision)',
    '"$release" == "$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
  ],
  'completed component stops must reach their current-runtime handler without comparing the historical overlay release, while installed stops remain same-release',
);
if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const currentRelease = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const successorGateHarness = [
    'set -euo pipefail',
    `CURRENT_RELEASE='${currentRelease}'`,
    'die() { return 1; }',
    'inspect_kemerbet_v2_v3_successor_gate() { KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$OVERLAY_RELEASE"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="$BRIDGE_STATE"; KEMERBET_V3_RECHECK_BRIDGE_STATE="$RECHECK_BRIDGE_STATE"; KEMERBET_V3_RECHECK_BRIDGE_RELEASE="$RECHECK_BRIDGE_RELEASE"; }',
    requiredV3RecheckRelease,
    enforceV2V3SuccessorGate,
    'enforce_kemerbet_v2_v3_successor_gate "$COMPONENT_COMMAND" "$CURRENT_RELEASE"',
  ].join('\n');
  for (const [name, command, overlayState, overlayRelease, bridgeState, expectedStatus] of [
    [
      'completed historical-overlay bot stop dispatch',
      'stop-bot',
      'successor-completed',
      '1'.repeat(40),
      'active',
      0,
    ],
    [
      'completed historical-overlay session stop dispatch',
      'stop-kemerbet-session-provision',
      'successor-completed',
      '1'.repeat(40),
      'active',
      0,
    ],
    [
      'installed historical-overlay bot stop dispatch through active bridge',
      'stop-bot',
      'successor-installed',
      '1'.repeat(40),
      'active',
      0,
    ],
    [
      'installed legacy same-release bot stop dispatch without bridge',
      'stop-bot',
      'successor-installed',
      currentRelease,
      'absent',
      0,
    ],
    [
      'installed wrong-release bot stop remains blocked without bridge',
      'stop-bot',
      'successor-installed',
      '1'.repeat(40),
      'absent',
      1,
    ],
    [
      'future ordinary release is accepted through active bridge',
      'fresh-host-ready',
      'successor-installed',
      '1'.repeat(40),
      'active',
      0,
    ],
    [
      'foreign lookup/recheck remains blocked through active bridge',
      'recheck-kemerbet-readiness',
      'successor-installed',
      '1'.repeat(40),
      'active',
      1,
    ],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: successorGateHarness,
      env: {
        PATH: process.env.PATH,
        COMPONENT_COMMAND: command,
        OVERLAY_STATE: overlayState,
        OVERLAY_RELEASE: overlayRelease,
        BRIDGE_STATE: bridgeState,
        RECHECK_BRIDGE_STATE: 'absent',
        RECHECK_BRIDGE_RELEASE: '',
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} fixture returned ${result.status}: ${result.stderr}`,
    );
  }
}
const successorInstalledCommandAllowlist =
  /install\|fresh-start\|fresh-host-ready\|arm-expiry-stop\|bot-disabled-ready\|install-bot-token\|start-bot\|bot-ready\|fresh-public-edge-ready\|start-fresh-public-edge\|diagnose-owner-startup\|discard\|stop-bot\|start-kemerbet-session-provision\|kemerbet-session-provision-ready\|stop-kemerbet-session-provision/u.exec(
    enforceV2V3SuccessorGate,
  )?.[0];
assert.ok(
  successorInstalledCommandAllowlist,
  'the installed successor must expose one exact no-transfer command allowlist',
);
assert.doesNotMatch(
  successorInstalledCommandAllowlist,
  /(?:^|\|)(?:public-edge-ready|start-public-edge)(?:\||$)/u,
  'the migrated fixed host must never expose the retired-host public-edge commands',
);
const retryableKemerbetBindingSource = extractShellFunction(
  helper,
  'require_retryable_kemerbet_binding_source',
  'consume_exact_kemerbet_binding_source',
);
for (const retryableV3Contract of [
  /\$expected_dev_ino:10001:10001:600:1:230/u,
  /sha256sum -- "\$KEMERBET_READINESS_BINDING"/u,
  /"\$expected_digest"/u,
  /require_kemerbet_v3_binding_content "\$KEMERBET_READINESS_BINDING"/u,
]) {
  assert.match(retryableKemerbetBindingSource, retryableV3Contract);
}
assert.doesNotMatch(
  retryableKemerbetBindingSource,
  /sha256-provider-authorization-v1|require_kemerbet_v1_retired_awaiting_v2/iu,
  'every retryable successor source must be exact v3 and must never fall back to the historical provider-authorization binding',
);
const v3SuccessorReadyCase =
  /\n  kemerbet-v3-successor-ready\)([\s\S]*?)\n    ;;\n\n  stop\)/u.exec(helper)?.[1];
assert.ok(v3SuccessorReadyCase, 'the helper must expose one read-only v3 overlay readiness check');
for (const v3SuccessorReadyContract of [
  /\[\[ \$# -eq 3 && "\$2" =~ \^\[0-9a-f\]\{40\}\$ && "\$3" =~ \^\[0-9a-f\]\{64\}\$ \]\]/u,
  /inspect_kemerbet_v2_v3_successor_gate/,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed'/,
  /KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "\$2"/,
  /KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "\$3"/,
  /v3 successor overlay ready: stable Profile binding, Transfer disabled/u,
]) {
  assert.match(v3SuccessorReadyCase, v3SuccessorReadyContract);
}
assert.doesNotMatch(
  v3SuccessorReadyCase,
  /docker|compose|GeneralInfoByExternalId|PlayerEPOSDeposit|curl|FINANCIAL_ACTIONS_MODE=live/iu,
  'the v3 overlay readiness command must only re-attest the completed local overlay',
);
const v3RuntimeBridgeReadyCase =
  /\n  kemerbet-v3-runtime-bridge-ready\)([\s\S]*?)\n    ;;\n\n  docker-storage-ready\)/u.exec(
    helper,
  )?.[1];
assert.ok(
  v3RuntimeBridgeReadyCase,
  'the helper must expose one read-only future-release-neutral runtime-bridge attestation',
);
for (const runtimeBridgeReadyContract of [
  /\[\[ \$# -eq 2 && "\$2" =~ \^\[0-9a-f\]\{64\}\$ \]\]/u,
  /require_kemerbet_v3_runtime_bridge/u,
  /KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "\$2"/u,
  /historical overlay \$KEMERBET_V2_V3_SUCCESSOR_RELEASE; current releases remain Transfer-disabled/u,
]) {
  assert.match(v3RuntimeBridgeReadyCase, runtimeBridgeReadyContract);
}
assert.doesNotMatch(
  v3RuntimeBridgeReadyCase,
  /docker|compose|GeneralInfoByExternalId|PlayerEPOSDeposit|curl|recheck-kemerbet-readiness|FINANCIAL_ACTIONS_MODE=live/iu,
  'runtime-bridge readiness must only re-attest local immutable evidence and the exact installed helper',
);
const dockerStorageReadyCase =
  /\n  docker-storage-ready\)([\s\S]*?)\n    ;;\n\n  kemerbet-v3-successor-ready\)/u.exec(
    helper,
  )?.[1];
assert.ok(
  dockerStorageReadyCase,
  'the helper must expose one narrow read-only Docker-data-root storage attestation',
);
for (const dockerStorageContract of [
  /\[\[ \$# -eq 2 && "\$2" =~ \^\[1-9\]\[0-9\]\{0,11\}\$ \]\]/u,
  /bundle_bytes <= 64 \* 1024 \* 1024 \* 1024/u,
  /! -L "\$DOCKER_DATA_ROOT"/u,
  /realpath -- "\$DOCKER_DATA_ROOT"/u,
  /df --output=avail -B1 -- "\$DOCKER_DATA_ROOT"/u,
  /NR != 2 \|\| value == ""/u,
  /required_bytes=\$\(\(bundle_bytes \* 2 \+ 4 \* 1024 \* 1024 \* 1024\)\)/u,
  /available_bytes >= required_bytes/u,
]) {
  assert.match(dockerStorageReadyCase, dockerStorageContract);
}
assert.doesNotMatch(
  dockerStorageReadyCase,
  /docker\s+(?:image|container|volume|system|compose)|\brm\b|prune|install|mv|truncate|fallocate/iu,
  'storage readiness may read filesystem capacity only; it must not mutate Docker or host storage',
);
const requireV3RuntimeBridge = extractShellFunction(
  helper,
  'require_kemerbet_v3_runtime_bridge',
  'consume_exact_one_use_kemerbet_file',
);
for (const runtimeBridgeRequirement of [
  /inspect_kemerbet_v2_v3_successor_gate/u,
  /KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active'/u,
  /KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" =~ \^\[0-9a-f\]\{40\}\$/u,
  /KEMERBET_V2_V3_SUCCESSOR_RELEASE" =~ \^\[0-9a-f\]\{40\}\$/u,
  /KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" =~ \^\[0-9a-f\]\{64\}\$/u,
  /successor-installed\|successor-completed/u,
]) {
  assert.match(requireV3RuntimeBridge, runtimeBridgeRequirement);
}
const v3SuccessorStoppedDurableBoundary = extractShellFunction(
  helper,
  'require_kemerbet_v3_successor_stopped_durable_boundary',
  'require_kemerbet_v3_successor_install_boundary',
);
for (const stoppedDurableContract of [
  /container ls --all --quiet/u,
  /network ls --quiet/u,
  /require_kemerbet_recheck_transients_absent/u,
  /volume ls --quiet/u,
  /KEMERBET_PROFILE_VOLUME/u,
  /KEMERBET_SESSION_CONTROL_VOLUME/u,
  /resolve_kemerbet_profile_volume_mountpoint/u,
  /require_kemerbet_profile_volume_holders ''/u,
  /resolve_kemerbet_session_control_volume_offline_mountpoint/u,
  /--filter "volume=\$KEMERBET_SESSION_CONTROL_VOLUME"/u,
]) {
  assert.match(v3SuccessorStoppedDurableBoundary, stoppedDurableContract);
}
assertInOrder(
  v3SuccessorStoppedDurableBoundary,
  [
    'containers=',
    '[[ -z "$containers" ]]',
    'networks=',
    '[[ -z "$networks" ]]',
    'require_kemerbet_recheck_transients_absent',
    'project_volumes=',
    '[[ "$project_volumes" == "$expected_volumes" ]]',
    'resolve_kemerbet_profile_volume_mountpoint',
    "require_kemerbet_profile_volume_holders ''",
    'resolve_kemerbet_session_control_volume_offline_mountpoint',
    '[[ -z "$session_holders" ]]',
  ],
  'the shared stopped successor predicate must prove exact empty runtime and holder-free durable volumes',
);
assert.doesNotMatch(
  v3SuccessorStoppedDurableBoundary,
  /^[ \t]*(?:rm|mv|install|cp|truncate|tee)\s+|docker_local (?:container|network|volume) (?:rm|create)\b|compose_command|docker_local compose|docker --host/imu,
  'the shared stopped successor predicate must remain read-only and fail closed',
);

const v3SuccessorInstallBoundary = extractShellFunction(
  helper,
  'require_kemerbet_v3_successor_install_boundary',
  'require_kemerbet_v3_successor_armed_stopped_boundary',
);
for (const installBoundaryContract of [
  /inspect_kemerbet_v2_v3_successor_gate/u,
  /successor_state="\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"/u,
  /successor_release="\$KEMERBET_V2_V3_SUCCESSOR_RELEASE"/u,
  /successor-installed\)/u,
  /successor-completed\)/u,
  /KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active'/u,
  /require_kemerbet_v3_runtime_bridge/u,
  /successor_release" == "\$commit_sha"/u,
  /require_kemerbet_v1_retirement_expiry_guard_disarmed/u,
  /! -e "\$BOT_STARTUP_RECEIPT" && ! -L "\$BOT_STARTUP_RECEIPT"/u,
  /! -e "\$BOT_STARTUP_RECEIPT_ROOT" && ! -L "\$BOT_STARTUP_RECEIPT_ROOT"/u,
  /require_kemerbet_v3_successor_stopped_durable_boundary/u,
]) {
  assert.match(v3SuccessorInstallBoundary, installBoundaryContract);
}
assert.equal(
  (v3SuccessorInstallBoundary.match(/inspect_kemerbet_v2_v3_successor_gate/g) ?? []).length,
  2,
  'successor installation must attest the exact overlay before and after its offline preflight',
);
assertInOrder(
  v3SuccessorInstallBoundary,
  [
    'inspect_kemerbet_v2_v3_successor_gate',
    'successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'case "$successor_state" in',
    'require_kemerbet_v1_retirement_expiry_guard_disarmed',
    'require_kemerbet_v3_successor_stopped_durable_boundary',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_release"',
  ],
  'successor installation must prove the complete stopped holder-free boundary before re-attesting it',
);
assert.doesNotMatch(
  v3SuccessorInstallBoundary,
  /^[ \t]*(?:rm|mv|install|cp|truncate|tee)\s+|docker_local (?:container|network|volume) (?:rm|create)\b|compose_command|docker_local compose|docker --host/imu,
  'the successor install preflight must remain read-only and fail closed',
);
if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const release = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const installBoundaryHarness = [
    'set -euo pipefail',
    `EXPECTED_RELEASE='${release}'`,
    'BOT_STARTUP_RECEIPT="/tmp/fetanagent-install-boundary-fixture-$BASHPID/receipt"',
    'BOT_STARTUP_RECEIPT_ROOT="/tmp/fetanagent-install-boundary-fixture-$BASHPID"',
    "INSPECTION_COUNT='0'",
    "TRACE=''",
    'die() { return 1; }',
    'require_kemerbet_v3_runtime_bridge() { TRACE="${TRACE}B"; [[ "$BRIDGE_STATE" == active ]]; }',
    'require_kemerbet_v1_retirement_expiry_guard_disarmed() { TRACE="${TRACE}G"; [[ "$GUARD_STATE" == exact ]]; }',
    'require_kemerbet_v3_successor_stopped_durable_boundary() { TRACE="${TRACE}D"; [[ "$DURABLE_STATE" == exact ]]; }',
    'inspect_kemerbet_v2_v3_successor_gate() { TRACE="${TRACE}O"; INSPECTION_COUNT="$((INSPECTION_COUNT + 1))"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="$BRIDGE_STATE"; if [[ "$INSPECTION_COUNT" == 1 ]]; then KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$INITIAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$INITIAL_OVERLAY_RELEASE"; else KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$FINAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$FINAL_OVERLAY_RELEASE"; fi; }',
    v3SuccessorInstallBoundary,
    'require_kemerbet_v3_successor_install_boundary "$EXPECTED_RELEASE"',
    '[[ "$TRACE" == OBGDO ]]',
  ].join('\n');
  for (const [
    name,
    initialState,
    initialRelease,
    finalState,
    finalRelease,
    bridgeState,
    expectedStatus,
  ] of [
    [
      'exact installed install boundary',
      'successor-installed',
      release,
      'successor-installed',
      release,
      'active',
      0,
    ],
    [
      'exact completed install boundary',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '1'.repeat(40),
      'active',
      0,
    ],
    [
      'future release through installed historical overlay',
      'successor-installed',
      '0'.repeat(40),
      'successor-installed',
      '0'.repeat(40),
      'active',
      0,
    ],
    [
      'changed completed install release',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '2'.repeat(40),
      'active',
      1,
    ],
    ['invalid install overlay state', 'invalid', release, 'invalid', release, 'active', 1],
    [
      'missing runtime bridge',
      'successor-installed',
      release,
      'successor-installed',
      release,
      'absent',
      1,
    ],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: installBoundaryHarness,
      env: {
        PATH: process.env.PATH,
        GUARD_STATE: 'exact',
        DURABLE_STATE: 'exact',
        INITIAL_OVERLAY_STATE: initialState,
        INITIAL_OVERLAY_RELEASE: initialRelease,
        FINAL_OVERLAY_STATE: finalState,
        FINAL_OVERLAY_RELEASE: finalRelease,
        BRIDGE_STATE: bridgeState,
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} fixture returned ${result.status}: ${result.stderr}`,
    );
  }
}
const v3SuccessorArmedStoppedBoundary = extractShellFunction(
  helper,
  'require_kemerbet_v3_successor_armed_stopped_boundary',
  'require_fresh_host_identity',
);
assertInOrder(
  v3SuccessorArmedStoppedBoundary,
  [
    '[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]]',
    'inspect_kemerbet_v2_v3_successor_gate',
    'successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'case "$successor_state" in',
    'successor-installed)',
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE\" == 'active'",
    'require_kemerbet_v3_runtime_bridge',
    '[[ "$successor_release" == "$commit_sha" ]]',
    'successor-completed)',
    'require_kemerbet_v1_retirement_expiry_guard_armed',
    'require_fresh_host_start_ready "$commit_sha"',
    '[[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT"',
    'require_kemerbet_v3_successor_stopped_durable_boundary',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_release"',
  ],
  'the armed successor boundary must prove the exact guard and stopped host before re-attesting the unchanged installed or completed overlay',
);
assert.doesNotMatch(
  v3SuccessorArmedStoppedBoundary,
  /\b(?:Transfer|GeneralInfoByExternalId|PlayerEPOSDeposit)\b|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|docker_local compose|^[ \t]*(?:docker|install|rm|mv)\s+/imu,
  'the armed stopped-host successor boundary must remain read-only and grant no money-moving authority',
);

if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const release = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const boundaryHarness = [
    'set -euo pipefail',
    `EXPECTED_RELEASE='${release}'`,
    'BOT_STARTUP_RECEIPT="/tmp/fetanagent-expiry-boundary-fixture-$BASHPID/receipt"',
    'BOT_STARTUP_RECEIPT_ROOT="/tmp/fetanagent-expiry-boundary-fixture-$BASHPID"',
    "INSPECTION_COUNT='0'",
    "TRACE=''",
    'die() { return 1; }',
    'require_kemerbet_v3_runtime_bridge() { TRACE="${TRACE}B"; [[ "$BRIDGE_STATE" == active ]]; }',
    'require_kemerbet_v1_retirement_expiry_guard_armed() { TRACE="${TRACE}G"; [[ "$GUARD_STATE" == exact ]]; }',
    'require_fresh_host_start_ready() { TRACE="${TRACE}S"; [[ "$STOPPED_STATE" == exact ]]; }',
    'require_kemerbet_v3_successor_stopped_durable_boundary() { TRACE="${TRACE}D"; [[ "$DURABLE_STATE" == exact ]]; }',
    'inspect_kemerbet_v2_v3_successor_gate() { TRACE="${TRACE}O"; INSPECTION_COUNT="$((INSPECTION_COUNT + 1))"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="$BRIDGE_STATE"; if [[ "$INSPECTION_COUNT" == 1 ]]; then KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$INITIAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$INITIAL_OVERLAY_RELEASE"; else KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$FINAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$FINAL_OVERLAY_RELEASE"; fi; }',
    v3SuccessorArmedStoppedBoundary,
    'require_kemerbet_v3_successor_armed_stopped_boundary "$EXPECTED_RELEASE"',
    '[[ "$TRACE" == OBGSDO ]]',
  ].join('\n');
  for (const [
    name,
    guardState,
    stoppedState,
    durableState,
    initialOverlayState,
    initialOverlayRelease,
    finalOverlayState,
    finalOverlayRelease,
    expectedStatus,
  ] of [
    [
      'exact armed stopped installed successor',
      'exact',
      'exact',
      'exact',
      'successor-installed',
      release,
      'successor-installed',
      release,
      0,
    ],
    [
      'exact armed stopped completed successor',
      'exact',
      'exact',
      'exact',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '1'.repeat(40),
      0,
    ],
    [
      'missing expiry guard',
      'missing',
      'exact',
      'exact',
      'successor-installed',
      release,
      'successor-installed',
      release,
      1,
    ],
    [
      'invalid expiry guard',
      'invalid',
      'exact',
      'exact',
      'successor-installed',
      release,
      'successor-installed',
      release,
      1,
    ],
    [
      'running successor host',
      'exact',
      'running',
      'exact',
      'successor-installed',
      release,
      'successor-installed',
      release,
      1,
    ],
    [
      'invalid durable boundary',
      'exact',
      'exact',
      'invalid',
      'successor-installed',
      release,
      'successor-installed',
      release,
      1,
    ],
    [
      'invalid initial overlay',
      'exact',
      'exact',
      'exact',
      'invalid',
      release,
      'invalid',
      release,
      1,
    ],
    [
      'future release through armed installed historical overlay',
      'exact',
      'exact',
      'exact',
      'successor-installed',
      '0'.repeat(40),
      'successor-installed',
      '0'.repeat(40),
      0,
    ],
    [
      'changed successor overlay state',
      'exact',
      'exact',
      'exact',
      'successor-installed',
      release,
      'successor-completed',
      release,
      1,
    ],
    [
      'changed successor overlay release',
      'exact',
      'exact',
      'exact',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '2'.repeat(40),
      1,
    ],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: boundaryHarness,
      env: {
        PATH: process.env.PATH,
        GUARD_STATE: guardState,
        STOPPED_STATE: stoppedState,
        DURABLE_STATE: durableState,
        INITIAL_OVERLAY_STATE: initialOverlayState,
        INITIAL_OVERLAY_RELEASE: initialOverlayRelease,
        FINAL_OVERLAY_STATE: finalOverlayState,
        FINAL_OVERLAY_RELEASE: finalOverlayRelease,
        BRIDGE_STATE: 'active',
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} armed-successor fixture returned ${result.status}: ${result.stderr}`,
    );
  }
}

const helperArmExpiryStopCase = /\n  arm-expiry-stop\)([\s\S]*?)\n    ;;\n\n  expiry-stop\)/u.exec(
  helper,
)?.[1];
assert.ok(helperArmExpiryStopCase, 'the helper must expose one exact expiry-arm command');
assertInOrder(
  helperArmExpiryStopCase,
  [
    'arm_expiry_stop "$2" "$3"',
    `if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]`,
    'require_kemerbet_v3_successor_armed_stopped_boundary "$2"',
    'else',
  ],
  'expiry arming must attest the exact stopped successor before the separately guarded fresh-start',
);
assert.doesNotMatch(
  helperArmExpiryStopCase.slice(0, helperArmExpiryStopCase.indexOf('    else')),
  /require_exact_fresh_private_runtime|docker_local compose|\b(?:start|up)\b/u,
  'arming an installed or completed successor must not require or start a runtime before fresh-start',
);

if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const release = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const armHarness = [
    'set -euo pipefail',
    `EXPECTED_RELEASE='${release}'`,
    `set -- arm-expiry-stop "$EXPECTED_RELEASE" '2026-08-27 00:00:00 UTC'`,
    'KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$ARM_OVERLAY_STATE"',
    'KEMERBET_V2_V3_SUCCESSOR_RELEASE="$ARM_OVERLAY_RELEASE"',
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE='active'",
    'BOT_STARTUP_RECEIPT="/tmp/fetanagent-expiry-arm-fixture-$BASHPID/receipt"',
    'BOT_STARTUP_RECEIPT_ROOT="/tmp/fetanagent-expiry-arm-fixture-$BASHPID"',
    "TRACE=''",
    'die() { return 1; }',
    'arm_expiry_stop() { TRACE="${TRACE}A"; }',
    'require_kemerbet_v3_runtime_bridge() { TRACE="${TRACE}B"; return 0; }',
    'require_kemerbet_v1_retirement_expiry_guard_armed() { TRACE="${TRACE}G"; return 0; }',
    'require_fresh_host_start_ready() { TRACE="${TRACE}S"; return 0; }',
    'require_kemerbet_v3_successor_stopped_durable_boundary() { TRACE="${TRACE}D"; return 0; }',
    'inspect_kemerbet_v2_v3_successor_gate() { TRACE="${TRACE}O"; KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$ARM_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$ARM_OVERLAY_RELEASE"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="active"; }',
    'require_exact_fresh_private_runtime() { TRACE="${TRACE}X"; return 1; }',
    v3SuccessorArmedStoppedBoundary,
    helperArmExpiryStopCase,
    '[[ "$TRACE" == AOBGSDO ]]',
  ].join('\n');
  for (const [name, overlayState, overlayRelease] of [
    ['installed successor', 'successor-installed', release],
    ['completed successor', 'successor-completed', '1'.repeat(40)],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: armHarness,
      env: {
        PATH: process.env.PATH,
        ARM_OVERLAY_STATE: overlayState,
        ARM_OVERLAY_RELEASE: overlayRelease,
      },
    });
    assert.equal(
      result.status,
      0,
      `the exact stopped ${name} must arm without a premature runtime predicate: ${result.stderr}`,
    );
  }
}
const helperStopCase = /\n  stop\)\n([\s\S]*?)\n    ;;\n\n  arm-expiry-stop\)/u.exec(helper)?.[1];
const helperExpiryStopCase = /\n  expiry-stop\)\n([\s\S]*?)\n    ;;\n\n  cutover-ready\)/u.exec(
  helper,
)?.[1];
for (const [name, stopCase] of [
  ['stop', helperStopCase],
  ['expiry-stop', helperExpiryStopCase],
]) {
  assert.ok(stopCase, `${name} must retain its exact full-teardown migration normalization.`);
  assert.equal(
    (stopCase.match(/finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown/g) ?? [])
      .length,
    2,
  );
  for (const branch of [
    /emergency_stop_project_after_kemerbet_recovery_failure[\s\S]*?emergency_disarm_expiry_stop_after_kemerbet_recovery_failure[\s\S]*?abort_kemerbet_v1_reinstall_journal_after_full_expiry[\s\S]*?finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown/u,
    /stop_project[\s\S]*?disarm_expiry_stop[\s\S]*?abort_kemerbet_v1_reinstall_journal_after_full_expiry[\s\S]*?finalize_kemerbet_v1_retirement_safe_reset_after_full_teardown/u,
  ]) {
    assert.match(stopCase, branch);
  }
}
const retirementReinstallBoundary = extractShellFunction(
  helper,
  'require_kemerbet_v1_retirement_reinstall_boundary',
  'kemerbet_v1_retirement_secret_bundle',
);
assert.match(retirementReinstallBoundary, /require_kemerbet_v1_retirement_durable_volumes/);
assert.match(
  retirementReinstallBoundary,
  /container ls --all --quiet[\s\S]*?network ls --quiet[\s\S]*?\[\[ -z "\$containers" && -z "\$networks" \]\]/u,
);
assert.match(retirementReinstallBoundary, /require_kemerbet_recheck_transients_absent/);
const stopJob = /\n  stop:\n([\s\S]*)$/u.exec(workflow)?.[1];
assert.ok(stopJob, 'The staging stop job must exist.');
assert.match(
  stopJob,
  /if: inputs\.mode == 'predecessor-stop-and-disable' \|\| inputs\.mode == 'ecd47f5d-predecessor-stop-and-disable' \|\| inputs\.mode == 'stop-and-disable'/,
);
assert.match(stopJob, /REQUESTED_MODE: \$\{\{ inputs\.mode \}\}/);
assert.match(stopJob, /if \[\[ "\$REQUESTED_MODE" == 'predecessor-stop-and-disable' \]\]; then/u);
const historicalPredecessorBranch =
  /if \[\[ "\$REQUESTED_MODE" == 'predecessor-stop-and-disable' \]\]; then([\s\S]*?)\n\s+elif \[\[ "\$REQUESTED_MODE" == 'ecd47f5d-predecessor-stop-and-disable' \]\]; then/u.exec(
    stopJob,
  )?.[1];
assert.ok(
  historicalPredecessorBranch,
  'The historical predecessor mode must remain a distinct, unchanged branch.',
);
assert.match(
  historicalPredecessorBranch,
  /test "\$\(sha256sum infra\/sql\/staging-runtimes-disable\.sql \| awk '\{print \$1\}'\)" = \\\s+'956f1f76c21e46103f0d5439617b94572f7aad28a214930e25cb799a30399583'/u,
);
assert.match(
  historicalPredecessorBranch,
  /helper_sha='022a9f10335fb570efb7638e2029ce663525ed742296268471b4c3a444ada714'/,
);
assert.match(historicalPredecessorBranch, /release_sha='8f58ff06425160835c94801e564fa6f9066d0930'/);
assert.match(historicalPredecessorBranch, /predecessor_mode='true'/);
assert.doesNotMatch(
  historicalPredecessorBranch,
  /ecd47f5d6aff8cd955ed8b68d7313b79fde5547a6827743e1e5f1b0d1fca04be|594ce9656311feabd062b6b6360a90ba5d7ee576/u,
  'The historical predecessor cleanup mode must never be repinned to the currently installed predecessor.',
);

const installedPredecessorBranch =
  /elif \[\[ "\$REQUESTED_MODE" == 'ecd47f5d-predecessor-stop-and-disable' \]\]; then([\s\S]*?)\n\s+else/u.exec(
    stopJob,
  )?.[1];
assert.ok(
  installedPredecessorBranch,
  'The currently installed predecessor must have its own exact cleanup branch.',
);
assert.match(
  installedPredecessorBranch,
  /test "\$\(sha256sum infra\/sql\/staging-runtimes-disable\.sql \| awk '\{print \$1\}'\)" = \\\s+'956f1f76c21e46103f0d5439617b94572f7aad28a214930e25cb799a30399583'/u,
);
assert.match(
  installedPredecessorBranch,
  new RegExp(`helper_sha='${installedHelperPredecessorSha}'`, 'u'),
);
assert.match(installedPredecessorBranch, /release_sha='594ce9656311feabd062b6b6360a90ba5d7ee576'/);
assert.match(installedPredecessorBranch, /predecessor_mode='true'/);
assert.doesNotMatch(
  installedPredecessorBranch,
  /022a9f10335fb570efb7638e2029ce663525ed742296268471b4c3a444ada714|8f58ff06425160835c94801e564fa6f9066d0930/u,
  'The currently installed predecessor cleanup mode must never fall back to the older historical pins.',
);
assert.match(stopJob, /else\s+\[\[ "\$REQUESTED_MODE" == 'stop-and-disable' \]\]\s+fi/u);
assert.match(stopJob, /956f1f76c21e46103f0d5439617b94572f7aad28a214930e25cb799a30399583/);
assert.match(
  stopJob,
  /fetanagent-staging-deploy-helper verify '\$helper_sha' && sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper stop && sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper discard '\$release_sha'/,
);
assert.match(
  stopJob,
  /test \\"\\\$\(id -u\)\\" -ne 0 \|\| exit 190; sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper verify '\$helper_sha' \|\| exit 191; sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper stop \|\| exit 192; sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper discard '\$release_sha' \|\| exit 193/,
);
assert.match(stopJob, /psql -X --file=infra\/sql\/staging-runtimes-disable\.sql/);
assertInOrder(
  stopJob,
  [
    'remote_command="test \\"\\$(id -u)\\" -ne 0 || exit 190;',
    "fetanagent-staging-deploy-helper verify '$helper_sha' || exit 191;",
    'fetanagent-staging-deploy-helper stop || exit 192;',
    "fetanagent-staging-deploy-helper discard '$release_sha' || exit 193",
    '"$remote_command" || remote_status=$?',
    'case "$remote_status" in',
    'psql -X --file=infra/sql/staging-runtimes-disable.sql',
  ],
  'Both exact predecessor modes must prove the helper, attempt stop and exact-release discard, classify the remote result, and only then run cleanup SQL.',
);
assert.equal(
  (stopJob.match(/\bpsql\b/g) ?? []).length,
  1,
  'The cleanup job must expose exactly one database mutation point after the remote proof boundary.',
);
assert.ok(
  stopJob.indexOf('0|192|193) ;;') <
    stopJob.indexOf('psql -X --file=infra/sql/staging-runtimes-disable.sql'),
  'Only a completed predecessor proof or explicitly mapped post-proof failure may reach database cleanup.',
);
assert.doesNotMatch(
  stopJob,
  /network-bans|--db-unban-ip|\b(?:transfer|deposit|withdraw)\b|fetanagent-staging-deploy-helper (?:install|start(?:-[a-z0-9-]+)?|fresh-start|arm-[a-z0-9-]+|retire-[a-z0-9-]+|recheck-[a-z0-9-]+)/iu,
  'The predecessor cleanup path must only stop the fixed project, discard its exact release, and disable runtime logins.',
);
assert.match(stagingRunbook, /`predecessor-stop-and-disable`/u);
assert.match(stagingRunbook, /`stop-current-staging-predecessor-runtime`/u);
assert.match(stagingRunbook, /historical `022a9f10` predecessor\s+deployment/u);
assert.match(stagingRunbook, /8f58ff06425160835c94801e564fa6f9066d0930/u);
assert.match(stagingRunbook, /`ecd47f5d-predecessor-stop-and-disable`/u);
assert.match(stagingRunbook, /`stop-exact-ecd47f5d-staging-predecessor-runtime`/u);
assert.match(stagingRunbook, new RegExp(installedHelperPredecessorSha, 'u'));
assert.match(stagingRunbook, /`594ce9656311feabd062b6b6360a90ba5d7ee576`/u);
assert.match(
  stagingRunbook,
  /It does not\s+transfer or install a release,[\s\S]*?start any service,[\s\S]*?authorize Transfer, or move money\./u,
  'The operator runbook must preserve the installed-predecessor cleanup mode as a no-start, no-transfer boundary.',
);
assert.ok(
  workflow.indexOf(
    'Verify the immutable KemerBet overlay and runtime bridge before stopping staging',
  ) < workflow.indexOf('Verify enough Docker storage before any staging downtime') &&
    workflow.indexOf('Verify enough Docker storage before any staging downtime') <
      workflow.indexOf('Stop any prior staging project and disable old logins') &&
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
  'The exact successor gate must pass before downtime; then old runtimes stop, IPv6 and the exact ban list pass, and real role expiries arm the host-local guard before startup.',
);
const preStopSuccessorGate =
  /- name: Verify the immutable KemerBet overlay and runtime bridge before stopping staging([\s\S]*?)\n\s+- name: Verify enough Docker storage before any staging downtime/u.exec(
    workflow,
  )?.[1];
assert.ok(
  preStopSuccessorGate,
  'Deployment must prove the immutable overlay and runtime bridge before downtime.',
);
assertInOrder(
  preStopSuccessorGate,
  [
    'fetanagent-staging-deploy-helper verify',
    'fetanagent-staging-deploy-helper kemerbet-v3-runtime-bridge-ready',
    "'${{ steps.protected.outputs.helper_sha }}'",
  ],
  'the read-only pre-stop SSH check must verify the installed helper and its future-release-neutral runtime bridge',
);
assert.equal(
  (preStopSuccessorGate.match(/^\s*ssh\s/gm) ?? []).length,
  1,
  'the pre-stop successor gate must make exactly one SSH call',
);
assert.equal(
  (
    preStopSuccessorGate.match(/sudo -n \/usr\/local\/sbin\/fetanagent-staging-deploy-helper/g) ??
    []
  ).length,
  2,
  'the pre-stop gate may invoke only helper verify and runtime-bridge-ready through sudo',
);
assert.doesNotMatch(
  preStopSuccessorGate,
  /\bpsql\b|\bsupabase\b|\bdocker\b|\bscp\b|fetanagent-staging-deploy-helper (?:stop|discard|install|start|arm-|recheck-)/u,
  'the pre-stop successor gate must remain read-only',
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
  /### Historical audit record: exact v1\/v2 helper replacement on the staging Droplet([\s\S]*?)\nThe protected `staging` environment/u.exec(
    stagingRunbook,
  )?.[1];
assert.ok(helperReplacementRunbook, 'The current staging helper replacement must be documented.');
assert.match(helperReplacementRunbook, /retired Droplet `590666364`/);
assert.match(helperReplacementRunbook, /current staging Droplet `593344964`/);
assert.match(helperReplacementRunbook, /stop-and-disable/);
assert.match(helperReplacementRunbook, new RegExp(installedHelperPredecessorSha, 'gu'));
assert.ok(
  helperReplacementRunbook.includes(`BACKUP="$STAGING_ROOT/${installedHelperBackupName}"`) &&
    helperReplacementRunbook.includes(`BACKUP='${installedHelperBackupPath}'`),
  'The replacement and restore blocks must use the same new fixed predecessor-versioned backup path.',
);
for (const retainedBackup of [
  {
    variable: 'RETAINED_022_BACKUP',
    shaVariable: 'RETAINED_022_BACKUP_SHA',
    name: retained022HelperBackupName,
    path: retained022HelperBackupPath,
    sha: retained022HelperBackupSha,
  },
  {
    variable: 'RETAINED_D9CD_BACKUP',
    shaVariable: 'RETAINED_D9CD_BACKUP_SHA',
    name: retainedD9cdHelperBackupName,
    path: retainedD9cdHelperBackupPath,
    sha: retainedD9cdHelperBackupSha,
  },
  {
    variable: 'RETAINED_526_BACKUP',
    shaVariable: 'RETAINED_526_BACKUP_SHA',
    name: retained526HelperBackupName,
    path: retained526HelperBackupPath,
    sha: retained526HelperBackupSha,
  },
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
  /(?:^|\n)\s*(?:rm|mv|install|cp|truncate|shred)\b[^\n]*"\$RETAINED_(?:022|D9CD|526|121E|AF823|B466|33F4)_BACKUP"/u,
  'The current rotation must never mutate or remove any retained earlier predecessor backup.',
);
assert.match(helperReplacementRunbook, /Retain all eight versioned predecessor backups/);
assert.match(helperReplacementRunbook, /seven older backups during this rotation/);
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
const helperReplacementRetirementGate =
  /require_kemerbet_v1_retirement_rotation_ready\(\) \{([\s\S]*?)\n\}/u.exec(
    helperReplacement,
  )?.[1];
assert.ok(
  helperReplacementRetirementGate,
  'successor helper replacement must independently validate the v1 retirement boundary',
);
for (const externalRetirementGateContract of [
  /python3 -I - "\$TARGET" <<'PY'/,
  /TARGET = sys\.argv\[1\]/,
  /ROOT = '\/var\/lib\/fetanagent\/kemerbet-readiness-binding-v1-retirement'/,
  /ROOT_INSTALLING = f'\{ROOT\}\.installing'/,
  /if not os\.path\.lexists\(ROOT\):\s+if os\.path\.lexists\(ROOT_INSTALLING\):\s+reject\(\)\s+raise SystemExit\(0\)/u,
  /if os\.path\.lexists\(ROOT_INSTALLING\):\s+reject\(\)/u,
  /exact_directory\(ROOT, \(0, 0\), 0o700\)/,
  /entries != \['completed-v1', 'intent-v1'\]/,
  /intent = exact_lines\(intent_raw, 14\)/,
  /completion = exact_lines\(completion_raw, 16\)/,
  /rf'release_asset_sha256=\{HEX\}'/,
  /completion\[2:14\] != intent\[2:14\]/,
  /v2_binding_dev_ino=\{DEV_INO\}', completion\[14\]/,
  /v2_binding_sha256=\{HEX\}', completion\[15\]/,
  /helper_dev_ino = intent\[3\]\.removeprefix\('helper_dev_ino='\)/,
  /helper_sha = intent\[4\]\.removeprefix\('helper_sha256='\)/,
  /exact_file\(TARGET, \{\(0, 0, 0o755\)\}, 2 \* 1024 \* 1024\)/,
  /observed_helper_dev_ino != helper_dev_ino/,
  /hashlib\.sha256\(helper_raw\)\.hexdigest\(\) != helper_sha/,
  /exact_file\(KEY, \{\(10001, 10001, 0o400\), \(0, 0, 0o444\)\}, 4096\)/,
  /os\.path\.lexists\(SOURCE\).*os\.path\.lexists\(PROMOTION\)/s,
  /binding_raw, _ = exact_file\(FINAL, \{\(0, 0, 0o444\)\}, 230, 230\)/,
  /receipt = exact_lines\(receipt_raw, 8\)/,
  /receipt\[1\] != f'release=\{release\}'/,
  /receipt\[2\] != f'binding_sha256=\{v2_sha\}'/,
  /receipt\[3\] != f'identity_hmac_key_sha256=\{key_sha\}'/,
  /v2_sha = completion\[15\]\.removeprefix\('v2_binding_sha256='\)/,
  /selector_sha256=\{HEX\}/,
  /hashlib\.sha256\(selector_raw\)\.hexdigest\(\) != receipt\[4\]/,
  /hashlib\.sha256\(binding_raw\)\.hexdigest\(\) != v2_sha/,
  /projection = hashlib\.sha256\(f'\{account_id\} \{fingerprint\}\\n'\.encode\('ascii'\)\)\.hexdigest\(\)/,
  /projection != legacy_sha/,
]) {
  assert.match(helperReplacementRetirementGate, externalRetirementGateContract);
}
assert.doesNotMatch(
  helperReplacementRetirementGate,
  /\bprint\(|logging|sys\.stdout|subprocess|shell=True|os\.system/,
  'the external rotation gate must remain read-only and must never print retirement or binding contents',
);
assertInOrder(
  helperReplacement,
  [
    'flock --exclusive --nonblock 9',
    'require_no_helper_processes',
    'require_kemerbet_v1_retirement_rotation_ready',
    'fetanagent-staging-runtime-expiry-stop.timer',
    'install -o root -g root -m 0755 "$STAGED" "$INSTALL_TMP"',
  ],
  'helper replacement must validate exact committed v2 continuity under the mutation lock before replacing the helper',
);
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
  new RegExp(
    `INSTALL_TMP_PATH='\\/usr\\/local\\/sbin\\/\\.fetanagent-staging-deploy-helper\\.installing-${historicalReviewedHelperSuccessorSha.slice(0, 8)}'`,
  ),
  new RegExp(
    `BACKUP_TMP_PATH="\\$STAGING_ROOT\\/\\.fetanagent-staging-deploy-helper\\.previous-${installedHelperPredecessorSha.slice(0, 8)}\\.installing"`,
  ),
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
const helperRestoreRetirementGate =
  /require_kemerbet_v1_retirement_rotation_ready\(\) \{([\s\S]*?)\n\}/u.exec(helperRestore)?.[1];
assert.ok(
  helperRestoreRetirementGate,
  'predecessor rollback must independently refuse every installed v1-retirement state',
);
for (const rollbackRetirementGateContract of [
  /retirement_root='\/var\/lib\/fetanagent\/kemerbet-readiness-binding-v1-retirement'/,
  /retirement_root_installing="\$\{retirement_root\}\.installing"/,
  /\[\[ ! -e "\$retirement_root" && ! -L "\$retirement_root" &&\s+! -e "\$retirement_root_installing" && ! -L "\$retirement_root_installing" \]\]/u,
]) {
  assert.match(helperRestoreRetirementGate, rollbackRetirementGateContract);
}
assert.doesNotMatch(
  helperRestoreRetirementGate,
  /rm\b|rmdir\b|mv\b|install\b|mkdir\b|chmod\b|chown\b|completed-v1|intent-v1/,
  'predecessor rollback must accept only genuine retirement-root absence and must never repair or interpret successor retirement state',
);
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
  new RegExp(
    `RESTORE_TMP_PATH='\\/usr\\/local\\/sbin\\/\\.fetanagent-staging-deploy-helper\\.restoring-${installedHelperPredecessorSha.slice(0, 8)}'`,
  ),
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
const restoreRetirementGate = helperRestore.indexOf(
  'require_kemerbet_v1_retirement_rotation_ready',
  restoreLock,
);
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
    restoreLock < restoreRetirementGate &&
    restoreRetirementGate < restoreTemporary &&
    restoreLock < restoreTemporary &&
    restoreTemporary < restoreSync &&
    restoreSync < restoreRename &&
    restoreRename < restoreDirectorySync &&
    restoredTargetVerification > restoreRename &&
    restoreSudoersGrant > restoredTargetVerification,
  'rollback must revoke and quiesce the grant, refuse every retirement state under the lock, restore the checksum-proven predecessor, verify it, and only then re-enable sudo',
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
  deployJob,
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
  /- name: Validate protected deploy inputs([\s\S]*?)\n\s+- name: Verify the immutable KemerBet overlay and runtime bridge before stopping staging/u.exec(
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

const rollbackStep =
  /- name: Roll back failed activation([\s\S]*?)\n\s+recover-v1-retirement:/u.exec(workflow)?.[1];
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
  /if \[\[ "\$command" == 'fresh-start' \]\]; then\s+require_kemerbet_v1_retirement_expiry_guard_armed \|\|[\s\S]*?if \[\[ "\$successor_start_state" != 'absent' \]\]; then\s+require_kemerbet_v3_successor_armed_stopped_boundary "\$commit_sha"\s+else\s+require_fresh_host_start_ready "\$commit_sha"\s+fi\s+clear_bot_startup_receipt/u,
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

const installRelease = /\n  install\)([\s\S]*?)\n    ;;\n\n  start\|fresh-start\)/u.exec(
  helper,
)?.[1];
assert.ok(installRelease, 'The helper must define the sealed release installation boundary.');
assertInOrder(
  installRelease,
  [
    'validate_commit_and_tag "$commit_sha" "$image_tag"',
    'successor_install_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'successor_install_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'successor_install_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"',
    'successor_install_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"',
    `if [[ "$successor_install_state" != 'absent' ]]; then`,
    'require_kemerbet_v3_successor_install_boundary "$commit_sha"',
    'expected_files=',
    'install -d -o root -g root -m 0755 "$release/infra" "$SECRET_ROOT"',
    'rm -rf -- "$incoming"',
    `if [[ "$successor_install_state" != 'absent' ]]; then`,
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_install_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_install_release"',
    '"$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_install_helper_sha"',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == \'active\'',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_install_bridge_release"',
  ],
  'successor installation must prove the stopped preflight before examining or replacing release bytes',
);
assert.equal(
  (
    helper.match(
      /for image in owner-control customer-web api beta-admission bot deposit-executor gateway; do/g,
    ) ?? []
  ).length,
  2,
  'both release installation and startup must reject a missing or wrong-release executor image',
);
const startOrFreshStart =
  /\n  start\|fresh-start\)([\s\S]*?)\n    ;;\n\n  bot-disabled-ready\)/u.exec(helper)?.[1];
assert.ok(startOrFreshStart, 'The helper must define the private-core startup boundary.');
assertInOrder(
  startOrFreshStart,
  [
    'validate_commit_and_tag "$commit_sha" "$image_tag"',
    'successor_start_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'successor_start_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'successor_start_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"',
    'successor_start_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"',
    `if [[ "$command" == 'fresh-start' ]]`,
    'require_kemerbet_v1_retirement_expiry_guard_armed',
    `if [[ "$successor_start_state" != 'absent' ]]`,
    'require_kemerbet_v3_successor_armed_stopped_boundary "$commit_sha"',
    'clear_bot_startup_receipt',
    'up -d --no-build --wait --wait-timeout 90 owner-control customer-web api beta-admission',
    'require_owner_kemerbet_receipt_service_access',
    `if [[ "$successor_start_state" != 'absent' ]]`,
    'require_kemerbet_v1_retirement_expiry_guard_armed',
    'require_exact_fresh_private_runtime "$commit_sha"',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_start_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_start_release"',
    '"$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_start_helper_sha"',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == \'active\'',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_start_bridge_release"',
  ],
  'fresh-start must validate the exact armed stopped successor before activation and attest its private runtime afterward',
);
assert.doesNotMatch(
  startOrFreshStart.slice(
    0,
    startOrFreshStart.indexOf('up -d --no-build --wait --wait-timeout 90'),
  ),
  /require_exact_fresh_private_runtime/u,
  'the stopped successor must be guarded by the expiry boundary, not a premature live-runtime predicate',
);
const freshStartInitializationStart = startOrFreshStart.indexOf('    [[ $# -eq 3 ]]');
const freshStartInitializationEnd = startOrFreshStart.indexOf('    compose_file=');
assert.ok(
  freshStartInitializationStart >= 0 && freshStartInitializationEnd > freshStartInitializationStart,
  'the fresh-start initialization boundary must be extractable for executable guard fixtures',
);
const freshStartInitialization = startOrFreshStart.slice(
  freshStartInitializationStart,
  freshStartInitializationEnd,
);
assertInOrder(
  freshStartInitialization,
  [
    `if [[ "$command" == 'fresh-start' ]]`,
    'require_kemerbet_v1_retirement_expiry_guard_armed',
    `if [[ "$successor_start_state" != 'absent' ]]`,
    'require_kemerbet_v3_successor_armed_stopped_boundary "$commit_sha"',
    'clear_bot_startup_receipt',
    'else',
    'require_private_start_cutover_ready "$commit_sha"',
  ],
  'fresh-start must require an expiry guard before its first mutation while historical start remains on its cutover boundary',
);
assert.equal(
  (freshStartInitialization.match(/require_kemerbet_v1_retirement_expiry_guard_armed/g) ?? [])
    .length,
  1,
  'fresh-start initialization must contain one unconditional literal expiry-guard check',
);

const postStartSuccessorStart = startOrFreshStart.indexOf(
  '    require_owner_kemerbet_receipt_service_access',
);
const postStartSuccessorEnd = startOrFreshStart.indexOf(
  `    if [[ "$migration_recovery_start" == 'true' ]]`,
  postStartSuccessorStart,
);
assert.ok(
  postStartSuccessorStart >= 0 && postStartSuccessorEnd > postStartSuccessorStart,
  'the post-start successor boundary must be extractable for executable guard fixtures',
);
const postStartSuccessorBoundary = startOrFreshStart.slice(
  postStartSuccessorStart,
  postStartSuccessorEnd,
);

if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const release = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const preStartHarness = [
    'set -euo pipefail',
    `EXPECTED_RELEASE='${release}'`,
    "EXPECTED_TAG='de14588d4e5b'",
    'set -- fresh-start "$EXPECTED_RELEASE" "$EXPECTED_TAG"',
    "command='fresh-start'",
    'KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$PRE_OVERLAY_STATE"',
    'KEMERBET_V2_V3_SUCCESSOR_RELEASE="$PRE_OVERLAY_RELEASE"',
    `KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256='${'2'.repeat(64)}'`,
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE='active'",
    `KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE='${'3'.repeat(40)}'`,
    "TRACE=''",
    'die() { return 1; }',
    'validate_commit_and_tag() { TRACE="${TRACE}V"; [[ "$1" == "$EXPECTED_RELEASE" && "$2" == "$EXPECTED_TAG" ]]; }',
    'require_kemerbet_v1_retirement_expiry_guard_armed() { TRACE="${TRACE}G"; [[ "$GUARD_STATE" == exact ]]; }',
    'require_kemerbet_v3_successor_armed_stopped_boundary() { TRACE="${TRACE}B"; [[ "$STOPPED_STATE" == exact ]]; }',
    'require_fresh_host_start_ready() { TRACE="${TRACE}F"; return 1; }',
    'clear_bot_startup_receipt() { TRACE="${TRACE}C"; }',
    freshStartInitialization,
    '[[ "$TRACE" == VGBC ]]',
  ].join('\n');
  for (const [name, overlayState, overlayRelease, guardState, stoppedState, expectedStatus] of [
    ['exact installed fresh-start boundary', 'successor-installed', release, 'exact', 'exact', 0],
    [
      'exact completed fresh-start boundary',
      'successor-completed',
      '1'.repeat(40),
      'exact',
      'exact',
      0,
    ],
    ['missing fresh-start guard', 'successor-installed', release, 'missing', 'exact', 1],
    ['invalid fresh-start guard', 'successor-installed', release, 'invalid', 'exact', 1],
    ['invalid stopped successor boundary', 'successor-installed', release, 'exact', 'invalid', 1],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: preStartHarness,
      env: {
        PATH: process.env.PATH,
        PRE_OVERLAY_STATE: overlayState,
        PRE_OVERLAY_RELEASE: overlayRelease,
        GUARD_STATE: guardState,
        STOPPED_STATE: stoppedState,
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} pre-start fixture returned ${result.status}: ${result.stderr}`,
    );
  }

  const postStartHarness = [
    'set -euo pipefail',
    `commit_sha='${release}'`,
    'successor_start_state="$INITIAL_OVERLAY_STATE"',
    'successor_start_release="$INITIAL_OVERLAY_RELEASE"',
    `successor_start_helper_sha='${'2'.repeat(64)}'`,
    `successor_start_bridge_release='${'3'.repeat(40)}'`,
    'KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$successor_start_state"',
    'KEMERBET_V2_V3_SUCCESSOR_RELEASE="$successor_start_release"',
    'KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$successor_start_helper_sha"',
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE='active'",
    'KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE="$successor_start_bridge_release"',
    "TRACE=''",
    'die() { return 1; }',
    'require_owner_kemerbet_receipt_service_access() { TRACE="${TRACE}A"; }',
    'require_kemerbet_v1_retirement_expiry_guard_armed() { TRACE="${TRACE}G"; [[ "$GUARD_STATE" == exact ]]; }',
    'require_exact_fresh_private_runtime() { TRACE="${TRACE}R"; [[ "$RUNTIME_STATE" == exact ]]; }',
    'inspect_kemerbet_v2_v3_successor_gate() { TRACE="${TRACE}O"; KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$OVERLAY_RELEASE"; KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$FINAL_HELPER_SHA"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="$FINAL_BRIDGE_STATE"; KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE="$FINAL_BRIDGE_RELEASE"; }',
    postStartSuccessorBoundary,
    '[[ "$TRACE" == AGRO ]]',
  ].join('\n');
  for (const [
    name,
    initialOverlayState,
    initialOverlayRelease,
    guardState,
    runtimeState,
    finalOverlayState,
    finalOverlayRelease,
    expectedStatus,
  ] of [
    [
      'exact installed post-start runtime',
      'successor-installed',
      release,
      'exact',
      'exact',
      'successor-installed',
      release,
      0,
    ],
    [
      'exact completed post-start runtime',
      'successor-completed',
      '1'.repeat(40),
      'exact',
      'exact',
      'successor-completed',
      '1'.repeat(40),
      0,
    ],
    [
      'missing post-start guard',
      'successor-installed',
      release,
      'missing',
      'exact',
      'successor-installed',
      release,
      1,
    ],
    [
      'invalid post-start guard',
      'successor-installed',
      release,
      'invalid',
      'exact',
      'successor-installed',
      release,
      1,
    ],
    [
      'invalid post-start runtime',
      'successor-installed',
      release,
      'exact',
      'invalid',
      'successor-installed',
      release,
      1,
    ],
    [
      'changed post-start overlay',
      'successor-installed',
      release,
      'exact',
      'exact',
      'successor-completed',
      release,
      1,
    ],
    [
      'changed post-start release',
      'successor-completed',
      '1'.repeat(40),
      'exact',
      'exact',
      'successor-completed',
      '2'.repeat(40),
      1,
    ],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: postStartHarness,
      env: {
        PATH: process.env.PATH,
        INITIAL_OVERLAY_STATE: initialOverlayState,
        INITIAL_OVERLAY_RELEASE: initialOverlayRelease,
        GUARD_STATE: guardState,
        RUNTIME_STATE: runtimeState,
        OVERLAY_STATE: finalOverlayState,
        OVERLAY_RELEASE: finalOverlayRelease,
        FINAL_HELPER_SHA: '2'.repeat(64),
        FINAL_BRIDGE_STATE: 'active',
        FINAL_BRIDGE_RELEASE: '3'.repeat(40),
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} post-start fixture returned ${result.status}: ${result.stderr}`,
    );
  }
}

for (const [label, controlSlice] of [
  ['expiry arming', helperArmExpiryStopCase],
  ['fresh-start initialization', freshStartInitialization],
  ['successor post-start', postStartSuccessorBoundary],
]) {
  assert.doesNotMatch(
    controlSlice,
    /FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true|INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true|GeneralInfoByExternalId|PlayerEPOSDeposit|--profile kemerbet-session-provision|up[^\n]*deposit-executor/u,
    `${label} must not broaden the dry-run no-transfer authority`,
  );
}

function assertRuntimeBridgePostcondition(
  commandCase,
  mutationFragment,
  preGateContract,
  insideGateContract,
  evidencePrefix,
  label,
) {
  assertInOrder(
    commandCase,
    [
      mutationFragment,
      ...preGateContract,
      `if [[ "$${evidencePrefix}_successor_state" != 'absent' ]]; then`,
      ...insideGateContract,
      'inspect_kemerbet_v2_v3_successor_gate',
      `[[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$${evidencePrefix}_successor_state" &&`,
      `"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$${evidencePrefix}_successor_release" &&`,
      `"$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$${evidencePrefix}_successor_helper_sha" &&`,
      `"$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == 'active' &&`,
      `"$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$${evidencePrefix}_bridge_release" ]]`,
    ],
    `${label} must re-attest the unchanged historical overlay, installed helper, and runtime bridge after its mutation`,
  );
}

assertRuntimeBridgePostcondition(
  installBotToken,
  'rm -f -- "$incoming"',
  ['require_service_file "$SECRET_ROOT/bot-token"'],
  [],
  'bot_token',
  'Telegram token installation',
);
assertRuntimeBridgePostcondition(
  startBot,
  'up -d --no-build --no-deps bot',
  [],
  ['require_exact_fresh_bot_runtime "$commit_sha" immediate-startup'],
  'bot_start',
  'Telegram startup',
);

const exactCurrentComponentContainer = extractShellFunction(
  helper,
  'require_exact_current_component_container',
  'require_exact_private_runtime',
);
for (const componentContainerContract of [
  /\^\(bot\|gateway\|kemerbet-session-provision\)\$/u,
  /com\.docker\.compose\.project/u,
  /com\.docker\.compose\.service/u,
  /org\.opencontainers\.image\.revision/u,
  /image_id=.*\{\{\.Image\}\}/u,
  /\^sha256:\[0-9a-f\]\{64\}\$/u,
  /docker_local image inspect "\$image_id"/u,
]) {
  assert.match(exactCurrentComponentContainer, componentContainerContract);
}
assertInOrder(
  exactCurrentComponentContainer,
  [
    'observed_project=',
    '[[ "$observed_project" == "$PROJECT_NAME" ]]',
    'observed_service=',
    '[[ "$observed_service" == "$service" ]]',
    'container_revision=',
    '[[ "$container_revision" == "$commit_sha" ]]',
    'image_id=',
    'image_revision=',
    '[[ "$image_revision" == "$commit_sha" ]]',
  ],
  'component teardown must bind the exact project, service, container revision, and immutable image revision',
);
assert.doesNotMatch(
  exactCurrentComponentContainer,
  /container (?:rm|stop)|image rm|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true/u,
  'the component-container provenance check must remain read-only and grant no money-moving authority',
);
if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const release = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const containerId = 'a'.repeat(64);
  const imageId = `sha256:${'b'.repeat(64)}`;
  const componentContainerHarness = [
    'set -euo pipefail',
    `PROJECT_NAME='fetanagent-staging-beta'`,
    `EXPECTED_RELEASE='${release}'`,
    `CONTAINER_ID='${containerId}'`,
    'die() { return 1; }',
    'docker_local() {',
    '  if [[ "$1" == container && "$2" == inspect ]]; then',
    '    case "${*: -1}" in',
    '      *com.docker.compose.project*) printf "%s" "$OBSERVED_PROJECT" ;;',
    '      *com.docker.compose.service*) printf "%s" "$OBSERVED_SERVICE" ;;',
    '      *org.opencontainers.image.revision*) printf "%s" "$CONTAINER_REVISION" ;;',
    '      *\{\{.Image\}\}*) printf "%s" "$OBSERVED_IMAGE_ID" ;;',
    '      *) return 91 ;;',
    '    esac',
    '  elif [[ "$1" == image && "$2" == inspect ]]; then',
    '    [[ "$3" == "$OBSERVED_IMAGE_ID" ]] || return 92',
    '    printf "%s" "$IMAGE_REVISION"',
    '  else',
    '    return 93',
    '  fi',
    '}',
    exactCurrentComponentContainer,
    'require_exact_current_component_container "$CONTAINER_ID" bot "$EXPECTED_RELEASE"',
  ].join('\n');
  for (const [
    name,
    observedProject,
    observedService,
    containerRevision,
    observedImageId,
    imageRevision,
    expectedStatus,
  ] of [
    ['exact current bot container', 'fetanagent-staging-beta', 'bot', release, imageId, release, 0],
    ['foreign component project', 'foreign', 'bot', release, imageId, release, 1],
    [
      'foreign component service',
      'fetanagent-staging-beta',
      'gateway',
      release,
      imageId,
      release,
      1,
    ],
    [
      'stale component container revision',
      'fetanagent-staging-beta',
      'bot',
      '1'.repeat(40),
      imageId,
      release,
      1,
    ],
    [
      'malformed component image identity',
      'fetanagent-staging-beta',
      'bot',
      release,
      'b'.repeat(64),
      release,
      1,
    ],
    [
      'stale component image revision',
      'fetanagent-staging-beta',
      'bot',
      release,
      imageId,
      '1'.repeat(40),
      1,
    ],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: componentContainerHarness,
      env: {
        PATH: process.env.PATH,
        OBSERVED_PROJECT: observedProject,
        OBSERVED_SERVICE: observedService,
        CONTAINER_REVISION: containerRevision,
        OBSERVED_IMAGE_ID: observedImageId,
        IMAGE_REVISION: imageRevision,
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} fixture returned ${result.status}: ${result.stderr}`,
    );
  }
}

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
assertInOrder(
  stopBot,
  [
    'recover_kemerbet_recheck_before_teardown',
    'inspect_kemerbet_v2_v3_successor_gate',
    'if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == \'absent\' ]]; then',
    'inspect_kemerbet_v1_retirement_gate',
    'else',
    'case "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" in',
    'successor-installed|successor-completed)',
    'require_kemerbet_v3_runtime_bridge',
    "successor_component_stop='true'",
    '"$session_container" kemerbet-session-provision "$commit_sha"',
    'container stop --time 70 "$session_container"',
    'require_exact_current_component_container "$gateway_container" gateway "$commit_sha"',
    'container rm --force "$gateway_container"',
    'require_exact_current_component_container "$bot_container" bot "$commit_sha"',
    'container rm --force "$bot_container"',
    'clear_bot_startup_receipt',
    'if [[ "$successor_component_stop" == \'true\' ]]; then',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_component_stop_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_component_stop_release"',
    '"$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_component_stop_helper_sha"',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == \'active\'',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_component_stop_bridge_release"',
  ],
  'bot stop must preserve the historical completed overlay while proving every removed component belongs to the current release',
);
assert.equal(
  (stopBot.match(/require_exact_current_component_container/g) ?? []).length,
  3,
  'bot stop must prove the exact current session, gateway, and bot containers before removal',
);
assert.equal(
  (stopBot.match(/inspect_kemerbet_v1_retirement_gate/g) ?? []).length,
  1,
  'bot stop may inspect historical v1 state only in the explicit successor-absent branch',
);

if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const release = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const stopBotHarness = [
    'set -euo pipefail',
    `EXPECTED_RELEASE='${release}'`,
    'set -- stop-bot "$EXPECTED_RELEASE"',
    "PROJECT_NAME='fetanagent-staging-beta'",
    "KEMERBET_TEARDOWN_RECOVERY_FAILED='false'",
    "KEMERBET_V2_V3_SUCCESSOR_GATE_STATE=''",
    "KEMERBET_V2_V3_SUCCESSOR_RELEASE=''",
    "KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256=''",
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE=''",
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE=''",
    "OVERLAY_INSPECTION_COUNT='0'",
    "BOT_PRESENT='true'",
    "TRACE=''",
    'trap \'printf "__TRACE__%s" "$TRACE"\' EXIT',
    'die() { return 1; }',
    'recover_kemerbet_recheck_before_teardown() { TRACE="${TRACE}R"; }',
    'require_kemerbet_teardown_recovery_success() { TRACE="${TRACE}Q"; }',
    'require_kemerbet_v3_runtime_bridge() { TRACE="${TRACE}B"; [[ "$BRIDGE_STATE" == active ]]; }',
    'inspect_kemerbet_v1_retirement_gate() { return 95; }',
    'inspect_kemerbet_v2_v3_successor_gate() { TRACE="${TRACE}O"; OVERLAY_INSPECTION_COUNT="$((OVERLAY_INSPECTION_COUNT + 1))"; KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$HELPER_SHA"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="$BRIDGE_STATE"; KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE="$BRIDGE_RELEASE"; if [[ "$OVERLAY_INSPECTION_COUNT" == 1 ]]; then KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$INITIAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$INITIAL_OVERLAY_RELEASE"; else KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$FINAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$FINAL_OVERLAY_RELEASE"; fi; }',
    'docker_local() {',
    '  if [[ "$1" == container && "$2" == ls ]]; then',
    '    case "$*" in',
    '      *com.docker.compose.service=kemerbet-session-provision*) return 0 ;;',
    '      *com.docker.compose.service=gateway*) return 0 ;;',
    '      *com.docker.compose.service=bot*) [[ "$BOT_PRESENT" == true ]] && printf "%s" "${BOT_ID:-aaaaaaaaaaaa}" ;;',
    '      *) printf "%s" "cccccccccccc" ;;',
    '    esac',
    '  elif [[ "$1" == container && "$2" == rm ]]; then',
    '    TRACE="${TRACE}M"; BOT_PRESENT=false',
    '  else',
    '    return 96',
    '  fi',
    '}',
    'require_exact_current_component_container() { TRACE="${TRACE}P"; [[ "$TARGET_STATE" == exact ]]; }',
    'clear_bot_startup_receipt() { TRACE="${TRACE}C"; }',
    'require_exact_fresh_private_runtime() { TRACE="${TRACE}X"; [[ "$RUNTIME_STATE" == exact ]]; }',
    stopBot,
  ].join('\n');
  for (const [
    name,
    initialState,
    initialRelease,
    finalState,
    finalRelease,
    targetState,
    runtimeState,
    bridgeState,
    expectedStatus,
    mutationExpected,
  ] of [
    [
      'installed current-release bot stop',
      'successor-installed',
      release,
      'successor-installed',
      release,
      'exact',
      'exact',
      'active',
      0,
      true,
    ],
    [
      'completed historical-release bot stop',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '1'.repeat(40),
      'exact',
      'exact',
      'active',
      0,
      true,
    ],
    [
      'future current release bot stop with historical installed overlay',
      'successor-installed',
      '1'.repeat(40),
      'successor-installed',
      '1'.repeat(40),
      'exact',
      'exact',
      'active',
      0,
      true,
    ],
    [
      'invalid bot-stop successor state',
      'invalid',
      release,
      'invalid',
      release,
      'exact',
      'exact',
      'active',
      1,
      false,
    ],
    [
      'foreign bot target release',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '1'.repeat(40),
      'invalid',
      'exact',
      'active',
      1,
      false,
    ],
    [
      'changed completed bot-stop overlay',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '2'.repeat(40),
      'exact',
      'exact',
      'active',
      1,
      true,
    ],
    [
      'missing bot-stop runtime bridge',
      'successor-installed',
      release,
      'successor-installed',
      release,
      'exact',
      'exact',
      'absent',
      1,
      false,
    ],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: stopBotHarness,
      env: {
        PATH: process.env.PATH,
        INITIAL_OVERLAY_STATE: initialState,
        INITIAL_OVERLAY_RELEASE: initialRelease,
        FINAL_OVERLAY_STATE: finalState,
        FINAL_OVERLAY_RELEASE: finalRelease,
        TARGET_STATE: targetState,
        RUNTIME_STATE: runtimeState,
        BRIDGE_STATE: bridgeState,
        BRIDGE_RELEASE: '3'.repeat(40),
        HELPER_SHA: '2'.repeat(64),
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} fixture returned ${result.status}: ${result.stderr}`,
    );
    assert.equal(
      result.stdout.includes('M'),
      mutationExpected,
      `${name} fixture mutation trace was ${result.stdout}`,
    );
    if (mutationExpected) {
      assert.match(
        result.stdout,
        /P.*M/u,
        `${name} must prove the current bot container before removing it`,
      );
    }
  }
}

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
assert.match(
  startKemerbetSession,
  /session_binding_source="\$\(select_kemerbet_session_binding_source "\$commit_sha"\)"/,
);
assert.match(
  startKemerbetSession,
  /FETANAGENT_STAGING_KEMERBET_SESSION_BINDING_FILE="\$session_binding_source"/,
);
assert.doesNotMatch(startKemerbetSession, /prepare_retryable_kemerbet_session_player_ids/);
assert.doesNotMatch(startKemerbetSession, /require_service_file "\$KEMERBET_READINESS_PLAYER_IDS"/);
assert.match(startKemerbetSession, /require_immutable_config_file "\$KEMERBET_SELECTOR_CONTRACT"/);
assert.match(startKemerbetSession, /require_kemerbet_readiness_output_directory/);
assert.match(startKemerbetSession, /require_kemerbet_v3_runtime_bridge/);
assert.match(
  startKemerbetSession,
  /successor_session_release="\$KEMERBET_V2_V3_SUCCESSOR_RELEASE"/,
);
assert.match(
  startKemerbetSession,
  /successor_session_bridge_release="\$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"/,
);
assert.match(startKemerbetSession, /--profile kemerbet-session-provision/);
assert.match(
  startKemerbetSession,
  /up -d --no-build --no-deps --wait --wait-timeout 90 kemerbet-session-provision/,
);
assert.match(
  startKemerbetSession,
  /require_kemerbet_session_provision_runtime "\$commit_sha" "\$session_binding_source"/,
);
assert.doesNotMatch(startKemerbetSession, /FINANCIAL_ACTIONS_MODE=live|KEMERBET_.*=true/);
assertInOrder(
  startKemerbetSession,
  [
    'require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"',
    'require_immutable_config_file "$KEMERBET_SELECTOR_CONTRACT"',
    'require_kemerbet_v3_runtime_bridge',
    'session_binding_source="$(select_kemerbet_session_binding_source "$commit_sha")"',
    'FETANAGENT_STAGING_KEMERBET_SESSION_BINDING_FILE="$session_binding_source"',
    'up -d --no-build --no-deps --wait --wait-timeout 90 kemerbet-session-provision',
    'require_kemerbet_session_provision_runtime "$commit_sha" "$session_binding_source"',
    'inspect_kemerbet_v2_v3_successor_gate',
  ],
  'private sign-in must start only the no-transfer coordinator and re-attest the unchanged historical overlay/runtime bridge',
);

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
  /== '6'/,
  /volume\|\/run\/fetanagent-kemerbet-session-control\|true/,
  /volume\|\/var\/lib\/fetanagent\/kemerbet-sessions\|true/,
  /bind\|\/run\/secrets\/kemerbet_agent_identity_hmac_key\|false/,
  /bind\|\/run\/secrets\/kemerbet_agent_identity_bindings\|false/,
  /bind\|\/etc\/fetanagent\/kemerbet-selector-contract\.v2\.json\|false/,
  /bind\|\/run\/fetanagent-kemerbet-readiness-seal-output\|true/,
  /KEMERBET_AGENT_IDENTITY_HMAC_KEY/,
  /expected_binding_source="\$2"/,
  /"\$KEMERBET_READINESS_BINDING"\)/,
  /10001:10001:600:1:230/,
  /KEMERBET_AGENT_IDENTITY_BINDINGS/,
  /KEMERBET_SELECTOR_CONTRACT/,
  /KEMERBET_READINESS_OUTPUT_ROOT/,
  /profile_volume_source="\$\(docker_local container inspect "\$container_id"/,
  /binding_source="\$\(docker_local container inspect "\$container_id"/,
  /\.Destination "\/run\/secrets\/kemerbet_agent_identity_bindings"/,
  /"\$binding_source" == "\$expected_binding_source"/,
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
assertInOrder(
  kemerbetSessionRuntime,
  [
    'case "$expected_binding_source" in',
    '"$KEMERBET_READINESS_BINDING")',
    '"$KEMERBET_AGENT_IDENTITY_BINDINGS")',
    'require_kemerbet_v3_binding_content "$expected_binding_source"',
    "grep -Fxq 'bind|/run/secrets/kemerbet_agent_identity_bindings|false'",
    'binding_source="$(docker_local container inspect "$container_id"',
    '"$binding_source" == "$expected_binding_source"',
  ],
  'the private sign-in runtime must validate one explicitly allowlisted v3 binding before proving its exact read-only host-to-container mount',
);
assert.doesNotMatch(
  kemerbetSessionRuntime,
  /KEMERBET_READINESS_PLAYER_IDS|kemerbet_no_transfer_readiness_player_ids/u,
  'the long-lived sign-in coordinator must not depend on or receive the separately authorized one-use lookup cohort',
);
assert.doesNotMatch(kemerbetSessionRuntime, /container logs|\bcat\b|password=|token=/iu);

const sealKemerbetReadiness = /\n  seal-kemerbet-readiness\)([\s\S]*?)\n    ;;/u.exec(helper)?.[1];
assert.ok(
  sealKemerbetReadiness,
  'The helper must define the one-time live-session readiness seal.',
);
for (const contract of [
  /published-with-kemerbet-session/,
  /require_kemerbet_session_provision_runtime "\$commit_sha" "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /if \[\[ -e "\$KEMERBET_READINESS_BINDING" \|\| -L "\$KEMERBET_READINESS_BINDING" \]\]; then/,
  /\[\[ -e "\$KEMERBET_V1_RETIREMENT_ROOT" \|\| -L "\$KEMERBET_V1_RETIREMENT_ROOT" \]\] \|\|/,
  /the one-time KemerBet readiness binding already exists/,
  /finalize_kemerbet_v1_retirement_after_v2_seal "\$commit_sha"/,
  /KemerBet readiness sealed: 5 of 5 Players, Transfer disabled\./,
  /\/v1\/readiness\/seal/,
  /randomUUID\(\)/,
  /response\.statusCode !== 201/,
  /result\.playersChecked !== 5/,
  /result\.currency !== "ETB"/,
  /result\.transferDisabled !== true/,
  /result\.moneyMoved !== false/,
  /result\.identifiersRedacted !== true/,
  /the one-time KemerBet readiness binding was not created/,
  /KemerBet readiness sealed: 5 of 5 Players, Transfer disabled\./,
]) {
  assert.match(sealKemerbetReadiness, contract);
}
assert.equal(
  (sealKemerbetReadiness.match(/\/v1\/readiness\/seal/g) ?? []).length,
  1,
  'the seal command must issue at most one supervised seal request and otherwise only resume exact retirement finalization',
);
assert.equal(
  (
    sealKemerbetReadiness.match(
      /KemerBet readiness sealed: 5 of 5 Players, Transfer disabled\./g,
    ) ?? []
  ).length,
  2,
  'normal and recovered v2 seals must emit the same canonical aggregate success line',
);
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
  /inspect_kemerbet_durable_volume_contract[\s\S]*?"\$volume_name" kemerbet_session_control/u,
  /mountpoint="\$\{volume_contract##\*\|\}"/u,
  /"\$mountpoint" == \/\*/,
  /! -L "\$mountpoint" && -d "\$mountpoint"/,
  /realpath -- "\$mountpoint"/,
  /stat --format='%u:%g:%a' "\$mountpoint"/,
  /== '10001:10001:700'/,
]) {
  assert.match(kemerbetSessionControlVolumeResolver, contract);
}

const prepareRetryableKemerbetSessionPlayerIds =
  /prepare_retryable_kemerbet_session_player_ids\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(
  prepareRetryableKemerbetSessionPlayerIds,
  'the helper must rebuild only the consumed private-session Player copy from an exact retryable cohort',
);
for (const contract of [
  /if \[\[ -e "\$KEMERBET_READINESS_PLAYER_IDS" \|\| -L "\$KEMERBET_READINESS_PLAYER_IDS" \]\]/,
  /failed_path="\$KEMERBET_OWNER_RECEIPT_ROOT\/\$KEMERBET_OWNER_FAILED_CLAIM_NAME"/,
  /failed_installing_path="\$KEMERBET_OWNER_RECEIPT_ROOT\/\$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"/,
  /candidate_path="\$\(dirname -- "\$KEMERBET_READINESS_PLAYER_IDS"\)\/\.kemerbet-readiness-player-ids\.promote-v1"/,
  /! -e "\$failed_path" && ! -L "\$failed_path"/,
  /! -e "\$failed_installing_path" && ! -L "\$failed_installing_path"/,
  /! -e "\$candidate_path" && ! -L "\$candidate_path"/,
  /require_service_file "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /stat --format='%h' "\$KEMERBET_READINESS_PLAYER_IDS"/,
  /stat --format='%u:%g:%a:%h:%s' "\$KEMERBET_READINESS_BINDING"/,
  /'10001:10001:600:1:230'/,
  /require_kemerbet_v3_binding_content "\$KEMERBET_READINESS_BINDING"/,
  /inspect_kemerbet_v2_v3_successor_gate/,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed'/,
  /KEMERBET_V3_RECHECK_BRIDGE_STATE" == 'active'/,
  /KEMERBET_V3_RECHECK_BRIDGE_RELEASE" == "\$commit_sha"/,
  /! -e "\$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "\$KEMERBET_RECHECK_PROMOTION_ROOT"/,
  /! -e "\$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "\$KEMERBET_RECHECK_RECEIPT_ROOT"/,
  /! -e "\$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "\$KEMERBET_RECHECK_CANDIDATE_ROOT"/,
  /! -e "\$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /KEMERBET_RECOVERY_LATCH_NAME/,
  /KEMERBET_RECOVERY_LATCH_INSTALLING_NAME/,
  /require_kemerbet_readiness_output_directory/,
  /realpath -- "\$KEMERBET_READINESS_BINDING"/,
  /stat --format='%u:%g:%a:%h' "\$KEMERBET_READINESS_BINDING"/,
  /== '10001:10001:600:1'/,
  /binding_size.*== '230'/s,
  /wc -l <"\$KEMERBET_READINESS_BINDING"/,
  /require_kemerbet_v3_binding_content "\$KEMERBET_READINESS_BINDING"/,
  /inspect_owner_staged_kemerbet_cohort/,
  /owner_kemerbet_cohort_marker require-failed "\$before_claim_id"/,
  /exec \{metadata_fd\}<<<"\$before_claim_id\n\$before_digest"/,
  /"\$before_player_dev_ino" "\$before_claim_dev_ino" "\$metadata_fd" <<'PY'/,
  /EXPECTED_SOURCE_NAME = 'kemerbet-readiness-player-ids\.stage-v1'/,
  /EXPECTED_CLAIM_NAME = 'kemerbet-readiness-cohort-claim\.stage-v1'/,
  /EXPECTED_TARGET = '\/etc\/fetanagent\/executor-secrets\/kemerbet_no_transfer_readiness_player_ids'/,
  /CANDIDATE_NAME = '\.kemerbet-readiness-player-ids\.promote-v1'/,
  /PLAYER_ID = re\.compile\(rb'\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,63\}'\)/,
  /CLAIM_ID = re\.compile\(r'\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}'\)/,
  /def read_private_metadata\(descriptor_text\):/,
  /claim_id, digest = read_private_metadata\(sys\.argv\[6\]\)/,
  /len\(lines\) != 5 or len\(set\(lines\)\) != 5/,
  /source_directory_descriptor = open_exact_directory\(source_parent, 10001, 10001, 0o700\)/,
  /target_directory_descriptor = open_exact_directory\(target_parent, 0, 0, 0o700\)/,
  /os\.O_RDONLY \| os\.O_DIRECTORY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/,
  /\(10001, 10001, 0o400, 1\)/,
  /hashlib\.sha256\(source_content\)\.hexdigest\(\) != expected_digest/,
  /claim_descriptor, claim_identity = read_exact_file\(/,
  /if claim_identity != expected_claim_identity:/,
  /remove_safe_candidate\(/,
  /if target_value is not None:/,
  /if target_value\.st_nlink == 2 and candidate_value is not None:/,
  /elif target_value\.st_nlink == 1:/,
  /os\.O_CREAT\s+\| os\.O_EXCL\s+\| os\.O_NOFOLLOW/u,
  /os\.fchown\(candidate_descriptor, 10001, 10001\)/,
  /os\.fchmod\(candidate_descriptor, 0o400\)/,
  /os\.fsync\(candidate_descriptor\)/,
  /src_dir_fd=target_directory_descriptor/,
  /dst_dir_fd=target_directory_descriptor/,
  /follow_symlinks=False/,
  /os\.unlink\(CANDIDATE_NAME, dir_fd=target_directory_descriptor\)/,
  /require_source_unchanged\(/,
  /after_player_dev_ino.*before_player_dev_ino/s,
  /after_claim_dev_ino.*before_claim_dev_ino/s,
  /after_claim_id.*before_claim_id/s,
  /after_digest.*before_digest/s,
  /sha256sum -- "\$KEMERBET_READINESS_PLAYER_IDS"/,
]) {
  assert.match(prepareRetryableKemerbetSessionPlayerIds, contract);
}
assert.equal(
  (prepareRetryableKemerbetSessionPlayerIds.match(/inspect_owner_staged_kemerbet_cohort/g) ?? [])
    .length,
  2,
  'retry sign-in must attest the same Owner stage pair before and after copying',
);
assert.equal(
  (
    prepareRetryableKemerbetSessionPlayerIds.match(
      /owner_kemerbet_cohort_marker require-failed "\$before_claim_id"/g,
    ) ?? []
  ).length,
  2,
  'retry sign-in must pin the same aggregate failed marker before and after copying',
);
assert.equal(
  (
    prepareRetryableKemerbetSessionPlayerIds.match(
      /! -e "\$failed_installing_path" && ! -L "\$failed_installing_path"/g,
    ) ?? []
  ).length,
  2,
  'retry sign-in must keep an incomplete failed-marker installer out of both the legacy fast path and the retry boundary',
);
assertInOrder(
  prepareRetryableKemerbetSessionPlayerIds,
  [
    'failed_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME"',
    'failed_installing_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"',
    'candidate_path="$(dirname -- "$KEMERBET_READINESS_PLAYER_IDS")/.kemerbet-readiness-player-ids.promote-v1"',
    'if [[ -e "$KEMERBET_READINESS_PLAYER_IDS" || -L "$KEMERBET_READINESS_PLAYER_IDS" ]]; then',
    'if [[ ! -e "$failed_path" && ! -L "$failed_path" &&',
    '! -e "$candidate_path" && ! -L "$candidate_path" ]]; then',
    `if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' ]]; then`,
    'require_kemerbet_v3_binding_content "$KEMERBET_READINESS_BINDING"',
    'inspect_kemerbet_v2_v3_successor_gate',
    `[[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' &&`,
    `"$KEMERBET_V3_RECHECK_BRIDGE_STATE" == 'active' &&`,
    '"$KEMERBET_V3_RECHECK_BRIDGE_RELEASE" == "$commit_sha"',
    'return 0',
    '[[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT"',
  ],
  'the legacy target-present fast path must be unreachable for a failed retry or fixed-candidate crash prefix',
);
assertInOrder(
  prepareRetryableKemerbetSessionPlayerIds,
  [
    'inspect_owner_staged_kemerbet_cohort',
    'owner_kemerbet_cohort_marker require-failed "$before_claim_id"',
    'source_descriptor, source_content = read_exact_source(',
    'claim_descriptor, claim_identity = read_exact_file(',
    'os.fsync(candidate_descriptor)',
    'require_source_unchanged(',
    'os.link(',
    'os.fsync(target_directory_descriptor)',
    'os.unlink(CANDIDATE_NAME, dir_fd=target_directory_descriptor)',
    'os.fsync(target_directory_descriptor)',
    'final_descriptor, _ = read_exact_file(',
    'inspect_owner_staged_kemerbet_cohort',
    'owner_kemerbet_cohort_marker require-failed "$before_claim_id"',
    'require_service_file "$KEMERBET_READINESS_PLAYER_IDS"',
  ],
  'retry sign-in must validate, atomically copy, re-attest the unchanged Owner cohort, and only then expose the service copy',
);
assert.doesNotMatch(
  prepareRetryableKemerbetSessionPlayerIds,
  /owner_kemerbet_cohort_marker guard-retry|promote_owner_staged_kemerbet_player_ids|restore_owner_staged_kemerbet_cohort|publish-(?:imported|completed|failed)|remove-(?:imported|completed|failed)|record_kemerbet_recheck|\bpsql\b|DATABASE_URL|container (?:create|start|run|logs)|PlayerEPOSDeposit|GeneralInfoByExternalId|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION|PRIVATE_LIVE_DEPOSIT_PILOT)_ENABLED=true|tempfile|mkstemp|\bprint\s*\(|os\.environ|sys\.(?:stdout|stderr)|\bsubprocess\b|os\.system|os\.(?:fchmod|fchown|pwrite|ftruncate)\((?:source|claim)_descriptor|os\.(?:unlink|rename)\((?:source_name|claim_name)/iu,
  'retry sign-in must only create the exact private service copy without stage, marker, database, provider, financial, or logging side effects',
);
assert.doesNotMatch(
  prepareRetryableKemerbetSessionPlayerIds,
  /"\$before_claim_id" \\\n|"\$before_digest" \\\n/u,
  'retry sign-in must carry the private claim ID and Player digest only through the inherited metadata descriptor',
);
assert.equal(
  (helper.match(/\bprepare_retryable_kemerbet_session_player_ids\b/g) ?? []).length,
  1,
  'the legacy retry-copy primitive may remain defined for exact recovery review but ordinary private sign-in must not invoke it',
);

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
  /require_kemerbet_v3_binding_content "\$KEMERBET_READINESS_BINDING"/,
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
  /require_kemerbet_v3_binding_content "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /agent_profile_pin/,
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
  /require_kemerbet_recheck_transients_absent/,
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
  /require_kemerbet_v3_binding_content "\$KEMERBET_READINESS_BINDING"/,
  /KEMERBET_RECHECK_CLEANUP_ARMED='true'/,
  /trap kemerbet_recheck_cleanup_trap EXIT/,
  /trap 'kemerbet_recheck_signal_trap 130' INT/,
  /published-with-kemerbet-session/,
  /container stop --time 70/,
  /published-steady-state/,
  /require_kemerbet_profile_volume_holders ''/,
  /harden_kemerbet_identity_key/,
  /harden_kemerbet_player_ids_file/,
  /profile_identity_digest="\$\(kemerbet_profile_identity_digest[\s\S]*?allow-exact-stale-singletons\)" \|\|/,
  /KEMERBET_RECHECK_CANDIDATE_ROOT/,
  /KEMERBET_RECHECK_CANDIDATE_BINDING/,
  /KEMERBET_RECHECK_CANDIDATE_CREATED='true'/,
  /install -d -o root -g root -m 0700 "\$KEMERBET_RECHECK_CANDIDATE_ROOT"/,
  /install -o root -g root -m 0444/,
  /require_root_readable_immutable_file "\$KEMERBET_RECHECK_CANDIDATE_BINDING"/,
  /require_kemerbet_recheck_engine_boundary/,
  /create_kemerbet_recheck_rpc_capabilities "\$account_id" "\$commit_sha"/,
  /run_kemerbet_recheck_authorization_premint "\$image_id"/,
  /prepare_kemerbet_recheck_profile_snapshot "\$account_id" "\$image_id"/,
  /require_kemerbet_recheck_runtime_artifacts prepared "\$commit_sha" "\$account_id"/,
  /--profile kemerbet-no-transfer-readiness/,
  /create --no-build --no-recreate[\s\S]*?kemerbet-no-transfer-readiness[\s\S]*?kemerbet-readiness-browser[\s\S]*?kemerbet-readiness-egress-proxy/u,
  /require_kemerbet_recheck_container_contract[\s\S]*?controller/,
  /require_kemerbet_recheck_container_contract[\s\S]*?browser/,
  /require_kemerbet_recheck_container_contract[\s\S]*?proxy/,
  /install_kemerbet_recheck_network_firewall "\$browser_full_container_id" browser/,
  /publish_kemerbet_recheck_firewall_release browser/,
  /install_kemerbet_recheck_network_firewall "\$recheck_full_container_id" controller/,
  /publish_kemerbet_recheck_firewall_release controller/,
  /require_kemerbet_recheck_running_network_contract/,
  /require_kemerbet_recheck_runtime_artifacts released "\$commit_sha" "\$account_id"/,
  /wait_for_kemerbet_recheck_service_healthy "\$proxy_full_container_id"[\s\S]*?\.Id.*\.State\.Status.*\.State\.Running.*\.State\.Paused.*\.State\.OOMKilled.*\.State\.Error.*\.RestartCount.*\.State\.Health[\s\S]*?\$proxy_full_container_id\|running\|true\|false\|false\|\|0\|healthy[\s\S]*?container start "\$browser_full_container_id"/u,
  /wait_kemerbet_recheck_container_exit_zero "\$recheck_full_container_id"/,
  /wait_kemerbet_recheck_container_exit_zero "\$browser_full_container_id"/,
  /require_kemerbet_recheck_runtime_artifacts completed "\$commit_sha" "\$account_id"/,
  /container stop --time 15 "\$proxy_full_container_id"/,
  /'exited\|0\|false\|\|0'/,
  /run_kemerbet_recheck_original_profile_verify "\$account_id" "\$image_id"/,
  /remove_kemerbet_recheck_rpc_capabilities/,
  /require_kemerbet_recheck_transients_absent/,
  /consume_exact_one_use_kemerbet_file/,
  /ln -- "\$KEMERBET_RECHECK_CANDIDATE_BINDING" "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /KEMERBET_RECHECK_FINAL_INSTALLED='true'/,
  /require_root_readable_immutable_file "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /remove_kemerbet_recheck_candidate/,
  /consume_exact_kemerbet_binding_source/,
  /KEMERBET_RECHECK_RECEIPT_OWNED='true'/,
  /record_kemerbet_recheck_receipt/,
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
]) {
  assert.match(recheckKemerbetReadiness, contract);
}
assert.match(
  recheckKemerbetReadiness,
  /recover_incomplete_kemerbet_recheck_promotion_guarded\s+inspect_kemerbet_v2_v3_successor_gate\s+if \[\[ "\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" != 'absent' \]\]; then\s+require_kemerbet_v3_recheck_bridge "\$commit_sha"[\s\S]*?if \[\[ -e "\$KEMERBET_RECHECK_RECEIPT_ROOT" \|\| -L "\$KEMERBET_RECHECK_RECEIPT_ROOT" \]\]; then[\s\S]*?require_completed_kemerbet_recheck_for_release "\$commit_sha" "\$image_tag"[\s\S]*?KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed'[\s\S]*?KEMERBET_V3_RECHECK_BRIDGE_RELEASE" == "\$commit_sha"/u,
  'guarded recovery must refresh the successor state before accepting an idempotent completed receipt',
);
assert.match(
  recheckKemerbetReadiness,
  /if \[\[ -e "\$KEMERBET_V1_RETIREMENT_ROOT" \|\| -L "\$KEMERBET_V1_RETIREMENT_ROOT" \]\]; then\s+if \[\[ "\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' \]\]; then\s+finalize_kemerbet_v1_retirement_after_v2_seal "\$commit_sha"[\s\S]*?else\s+\[\[ "\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' &&\s+"\$KEMERBET_V3_RECHECK_BRIDGE_RELEASE" == "\$commit_sha" \]\]/u,
  'the legacy v2 finalizer must run only without a successor overlay; v3 must use the exact migrated installed state',
);
assert.match(
  recheckKemerbetReadiness,
  /remove_owned_kemerbet_recheck_promotion_root[\s\S]*?require_completed_kemerbet_recheck_for_release "\$commit_sha" "\$image_tag"\s+inspect_kemerbet_v2_v3_successor_gate[\s\S]*?KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed'[\s\S]*?KEMERBET_V3_RECHECK_BRIDGE_RELEASE" == "\$commit_sha"/u,
  'normal v3 completion must retire the promotion journal and derive the durable terminal state before reporting success',
);
assert.equal(
  (recheckKemerbetReadiness.match(/allow-exact-stale-singletons/g) ?? []).length,
  2,
  'the original persistent profile must be holder-free and attested before and after the disposable snapshot run',
);
assert.equal(
  (recheckKemerbetReadiness.match(/docker_local container start/g) ?? []).length,
  3,
  'the fixed proxy, browser, and controller are the only long-running readiness services started',
);
assert.equal(
  (recheckKemerbetReadiness.match(/require_kemerbet_recheck_container_contract/g) ?? []).length,
  3,
  'all three long-running readiness containers must be attested before start',
);
assert.equal(
  (recheckKemerbetReadiness.match(/require_kemerbet_recheck_runtime_artifacts/g) ?? []).length,
  4,
  'runtime artifacts must be attested prepared, released, completed, and unchanged before cleanup',
);
assert.equal(
  (recheckKemerbetReadiness.match(/require_kemerbet_recheck_running_network_contract/g) ?? [])
    .length,
  2,
  'exact fixed-IP membership must be attested before and after the controller/browser run',
);
assertInOrder(
  recheckKemerbetReadiness,
  [
    'recover_incomplete_kemerbet_recheck_promotion',
    'require_completed_kemerbet_recheck_for_release "$commit_sha" "$image_tag"',
    'inspect_owner_staged_kemerbet_cohort',
    'record_kemerbet_recheck_promotion_journal',
    'promote_owner_staged_kemerbet_player_ids',
    'advance_kemerbet_recheck_import_journal_to_prepared',
    'owner_kemerbet_cohort_marker publish-imported',
    'harden_kemerbet_identity_key',
    'profile_identity_digest="$(kemerbet_profile_identity_digest',
    'install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_CANDIDATE_ROOT"',
    'advance_kemerbet_recheck_promotion_journal',
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
    'remove_kemerbet_recheck_rpc_capabilities',
    'require_kemerbet_recheck_transients_absent',
    'require_kemerbet_recheck_engine_boundary',
    'create_kemerbet_recheck_rpc_capabilities "$account_id" "$commit_sha"',
    'run_kemerbet_recheck_authorization_premint "$image_id"',
    'prepare_kemerbet_recheck_profile_snapshot "$account_id" "$image_id"',
    'require_kemerbet_recheck_runtime_artifacts prepared "$commit_sha" "$account_id"',
    'require_kemerbet_profile_volume_holders',
    'create_kemerbet_recheck_network',
    'create --no-build --no-recreate',
    'kemerbet-no-transfer-readiness',
    'kemerbet-readiness-browser',
    'kemerbet-readiness-egress-proxy',
    'require_kemerbet_recheck_container_contract',
    'controller "$commit_sha" "$image_tag" "$image_id"',
    'require_kemerbet_recheck_container_contract',
    'browser "$commit_sha" "$image_tag" "$image_id"',
    'require_kemerbet_recheck_container_contract',
    'proxy "$commit_sha" "$image_tag" "$image_id"',
    'container start "$proxy_full_container_id"',
    'wait_for_kemerbet_recheck_service_healthy "$proxy_full_container_id"',
    '$proxy_full_container_id|running|true|false|false||0|healthy',
    'container start "$browser_full_container_id"',
    'install_kemerbet_recheck_network_firewall "$browser_full_container_id" browser',
    'require_kemerbet_recheck_network_firewall "$browser_full_container_id" browser',
    'probe_kemerbet_recheck_denied_network "$browser_full_container_id"',
    'publish_kemerbet_recheck_firewall_release browser',
    'close_pinned_kemerbet_recheck_network_namespace browser',
    'wait_for_kemerbet_recheck_service_healthy "$browser_full_container_id"',
    'container start "$recheck_full_container_id"',
    'install_kemerbet_recheck_network_firewall "$recheck_full_container_id" controller',
    'require_kemerbet_recheck_network_firewall "$recheck_full_container_id" controller',
    'probe_kemerbet_recheck_denied_network "$recheck_full_container_id"',
    'publish_kemerbet_recheck_firewall_release controller',
    'close_pinned_kemerbet_recheck_network_namespace controller',
    'require_kemerbet_recheck_running_network_contract',
    'require_kemerbet_recheck_runtime_artifacts released "$commit_sha" "$account_id"',
    'wait_kemerbet_recheck_container_exit_zero "$recheck_full_container_id"',
    'wait_kemerbet_recheck_container_exit_zero "$browser_full_container_id"',
    'require_kemerbet_recheck_runtime_artifacts completed "$commit_sha" "$account_id"',
    'container stop --time 15 "$proxy_full_container_id"',
    'run_kemerbet_recheck_original_profile_verify "$account_id" "$image_id"',
    'observed_profile_identity_digest="$(kemerbet_profile_identity_digest',
    'require_kemerbet_recheck_runtime_artifacts completed "$commit_sha" "$account_id"',
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
    'remove_kemerbet_recheck_rpc_capabilities',
    'require_kemerbet_recheck_transients_absent',
    'ln -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" "$KEMERBET_AGENT_IDENTITY_BINDINGS"',
    'require_precommit_kemerbet_artifact_boundary',
    'record_kemerbet_recheck_receipt',
    'require_kemerbet_recheck_receipt',
    "KEMERBET_RECHECK_DURABLE_SUCCESS='true'",
    'consume_exact_one_use_kemerbet_file',
    'remove_kemerbet_recheck_candidate',
    'consume_exact_kemerbet_binding_source',
    'complete_owner_staged_kemerbet_cohort',
    'remove_owned_kemerbet_recheck_promotion_root',
    "KEMERBET_RECHECK_COMMITTED='true'",
    "KEMERBET_RECHECK_CLEANUP_ARMED='false'",
  ],
  'readiness must pre-mint and snapshot offline, release separately firewalled services, validate completion, re-attest the original profile, and clean every transient before durable promotion',
);
assert.doesNotMatch(
  recheckKemerbetReadiness,
  /network connect|container pause|container unpause|KEMERBET_RECHECK_BOOTSTRAP_NETWORK|KEMERBET_RECHECK_NETWORK_GATE|container logs|\bcat\b|\bshred\b|PlayerEPOSDeposit|GeneralInfoByExternalId|password=|token=|FINANCIAL_ACTIONS_MODE=live/iu,
  'the final recheck must not use dynamic network attachment, expose content, or enable financial behavior',
);

const removeKemerBetRecheckContainer = extractShellFunction(
  helper,
  'remove_kemerbet_recheck_container',
  'resolve_kemerbet_recheck_profile_snapshot_mountpoint',
);
assertInOrder(
  removeKemerBetRecheckContainer,
  [
    '"$KEMERBET_RECHECK_CONTAINER"',
    '"$KEMERBET_RECHECK_BROWSER_CONTAINER"',
    '"$KEMERBET_RECHECK_PROXY_CONTAINER"',
    '"$KEMERBET_RECHECK_AUTHORIZER_CONTAINER"',
    '"$KEMERBET_RECHECK_SNAPSHOT_CONTAINER"',
    '"$KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER"',
    '"$KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER"',
    'com.docker.compose.service',
    'com.fetanagent.kemerbet-readiness.oneshot',
    'container rm --force "$container_id"',
    'remove_kemerbet_recheck_profile_snapshot_volume',
  ],
  'cleanup must verify and remove the exact three services and four offline one-shots, then the disposable snapshot volume',
);
assert.doesNotMatch(
  removeKemerBetRecheckContainer,
  /container prune|compose[^\r\n]*\bdown\b|container logs/u,
  'container cleanup must never prune, tear down the project, or inspect logs',
);

const resolveKemerBetRecheckProfileSnapshotMountpoint = extractShellFunction(
  helper,
  'resolve_kemerbet_recheck_profile_snapshot_mountpoint',
  'remove_kemerbet_recheck_profile_snapshot_volume',
);
const removeKemerBetRecheckProfileSnapshotVolume = extractShellFunction(
  helper,
  'remove_kemerbet_recheck_profile_snapshot_volume',
  'create_kemerbet_recheck_profile_snapshot_volume',
);
for (const [name, snapshotVolumeContract] of [
  ['snapshot resolver', resolveKemerBetRecheckProfileSnapshotMountpoint],
  ['snapshot cleanup', removeKemerBetRecheckProfileSnapshotVolume],
]) {
  assert.match(
    snapshotVolumeContract,
    /--format '\{\{range \$key, \$value := \.Labels\}\}\{\{printf "%s=%s\\n" \$key \$value\}\}\{\{end\}\}' \| \\\n\s+LC_ALL=C sed '\/\^\$\/d' \| \\\n\s+LC_ALL=C sort/u,
    `${name} must remove only Docker formatter empty label records before exact sorting`,
  );
}

const removeKemerBetRecheckNetwork = extractShellFunction(
  helper,
  'remove_kemerbet_recheck_network',
  'create_kemerbet_recheck_network',
);
assertInOrder(
  removeKemerBetRecheckNetwork,
  [
    '"$KEMERBET_RECHECK_EGRESS_NETWORK"',
    '"$KEMERBET_RECHECK_PROXY_NETWORK"',
    '"$KEMERBET_RECHECK_CONTROL_NETWORK"',
    'com.docker.compose.project',
    'com.docker.compose.network',
    'docker_local network rm "$network_id"',
  ],
  'network cleanup must inspect and remove only the exact labelled egress, proxy, and control networks',
);
assert.doesNotMatch(
  removeKemerBetRecheckNetwork,
  /network prune|compose[^\r\n]*\bdown\b|--filter "label=/u,
  'network cleanup must never prune or select networks through broad labels',
);

const requireKemerBetRecheckNetworkIpamContract = extractShellFunction(
  helper,
  'require_kemerbet_recheck_network_ipam_contract',
  'create_kemerbet_recheck_network',
);
assertInOrder(
  requireKemerBetRecheckNetworkIpamContract,
  [
    "--format '{{json .IPAM.Config}}'",
    '${#observed_ipam_json} -le 4096',
    'env -i PATH="$SAFE_PATH" python3 -I -',
    'object_pairs_hook=unique_object',
    "allowed_keys = {'AuxiliaryAddresses', 'Gateway', 'IPRange', 'Subnet'}",
    "required_keys = {'Gateway', 'Subnet'}",
    "if ip_range is not None and (type(ip_range) is not str or ip_range != ''):",
    'if auxiliary is not None and (type(auxiliary) is not dict or auxiliary):',
    'if len(expected_pairs) != 2 or set(observed_pairs) != expected_pairs:',
  ],
  'network IPAM attestation must parse one bounded exact JSON contract and compare its pairs order-independently',
);
assert.doesNotMatch(
  requireKemerBetRecheckNetworkIpamContract,
  /range \.IPAM\.Config|printf [^\r\n]*\.IPRange/u,
  'network IPAM attestation must not stringify Docker 29 typed prefixes through Go templates',
);

if (process.platform === 'linux') {
  const ipamPython = extractSingleQuotedPythonHeredoc(
    requireKemerBetRecheckNetworkIpamContract,
    'require_kemerbet_recheck_network_ipam_contract',
  );
  const expectedIpam = ['172.31.254.0/29', '172.31.254.1', 'fd5e:7a9e:1::/64', 'fd5e:7a9e:1::1'];
  const exactIpv4 = { Subnet: expectedIpam[0], Gateway: expectedIpam[1] };
  const exactIpv6 = { Subnet: expectedIpam[2], Gateway: expectedIpam[3] };
  const runIpamFixture = (raw) =>
    spawnSync('/usr/bin/python3', ['-I', '-', raw, ...expectedIpam], {
      encoding: 'utf8',
      input: ipamPython,
    });

  for (const [name, raw] of [
    ['missing IPRange in reverse Docker config order', JSON.stringify([exactIpv6, exactIpv4])],
    [
      'empty Docker 29 JSON-canonicalized unset typed IPRange',
      JSON.stringify([
        { ...exactIpv4, IPRange: '', AuxiliaryAddresses: null },
        { ...exactIpv6, IPRange: '', AuxiliaryAddresses: {} },
      ]),
    ],
    [
      'null IPRange',
      JSON.stringify([
        { ...exactIpv4, IPRange: null },
        { ...exactIpv6, IPRange: null },
      ]),
    ],
  ]) {
    const result = runIpamFixture(raw);
    assert.equal(result.status, 0, `${name} IPAM fixture failed: ${result.stderr}`);
    assert.equal(result.stdout, '', `${name} IPAM fixture must expose no output`);
  }

  for (const [name, raw] of [
    [
      'Docker 29 Go-template invalid Prefix sentinel',
      JSON.stringify([{ ...exactIpv4, IPRange: 'invalid Prefix' }, exactIpv6]),
    ],
    ['nonempty IPRange', JSON.stringify([{ ...exactIpv4, IPRange: '172.31.254.0/30' }, exactIpv6])],
    ['unexpected field', JSON.stringify([{ ...exactIpv4, Foreign: '' }, exactIpv6])],
    [
      'nonempty auxiliary addresses',
      JSON.stringify([
        { ...exactIpv4, AuxiliaryAddresses: { reserved: '172.31.254.2' } },
        exactIpv6,
      ]),
    ],
    [
      'duplicate JSON key',
      `[{"Subnet":"${expectedIpam[0]}","Subnet":"${expectedIpam[0]}","Gateway":"${expectedIpam[1]}"},{"Subnet":"${expectedIpam[2]}","Gateway":"${expectedIpam[3]}"}]`,
    ],
    ['duplicate config', JSON.stringify([exactIpv4, exactIpv4])],
    ['extra config', JSON.stringify([exactIpv4, exactIpv6, exactIpv6])],
    ['wrong subnet', JSON.stringify([{ ...exactIpv4, Subnet: '172.31.254.8/29' }, exactIpv6])],
    ['missing subnet', JSON.stringify([{ Gateway: expectedIpam[1] }, exactIpv6])],
    ['wrong gateway', JSON.stringify([{ ...exactIpv4, Gateway: '172.31.254.2' }, exactIpv6])],
    ['missing gateway', JSON.stringify([{ Subnet: expectedIpam[0] }, exactIpv6])],
    ['malformed JSON', '[{"Subnet":'],
  ]) {
    const result = runIpamFixture(raw);
    assert.notEqual(result.status, 0, `${name} IPAM fixture was accepted`);
  }
}

const createKemerBetRecheckNetwork = extractShellFunction(
  helper,
  'create_kemerbet_recheck_network',
  'kemerbet_recheck_network_identity',
);
assertInOrder(
  createKemerBetRecheckNetwork,
  [
    '"$KEMERBET_RECHECK_CONTROL_NETWORK"',
    '"$KEMERBET_RECHECK_PROXY_NETWORK"',
    '"$KEMERBET_RECHECK_EGRESS_NETWORK"',
    "expected_label='kemerbet_readiness_control'",
    'KEMERBET_RECHECK_CONTROL_IPV4_SUBNET',
    'KEMERBET_RECHECK_CONTROL_IPV6_SUBNET',
    "expected_label='kemerbet_readiness_proxy'",
    'KEMERBET_RECHECK_PROXY_IPV4_SUBNET',
    'KEMERBET_RECHECK_PROXY_IPV6_SUBNET',
    "expected_label='kemerbet_readiness_egress'",
    'network create',
    '--driver bridge',
    '--ipv6',
    '--internal',
    'gateway_mode_ipv4=isolated',
    'gateway_mode_ipv6=isolated',
    'require_kemerbet_recheck_network_ipam_contract',
  ],
  'network creation must define the exact two static-IP isolated planes and the otherwise empty egress plane',
);
assert.equal(
  (createKemerBetRecheckNetwork.match(/^\s+--internal$/gmu) ?? []).length,
  1,
  'one fixed conditional adds --internal to both isolated networks and never to egress',
);
assert.doesNotMatch(
  createKemerBetRecheckNetwork,
  /^\s+--attachable$|network connect|network prune|compose[^\r\n]*\b(?:up|down)\b/mu,
  'network creation must leave all networks non-attachable and use no dynamic membership changes',
);
for (const [name, formatter] of [
  [
    'network options',
    /--format '\{\{range \$key, \$value := \.Options\}\}\{\{printf "%s=%s\\n" \$key \$value\}\}\{\{end\}\}' \| \\\n\s+LC_ALL=C sed '\/\^\$\/d' \| \\\n\s+LC_ALL=C sort/u,
  ],
]) {
  assert.match(
    createKemerBetRecheckNetwork,
    formatter,
    `${name} attestation must remove only Docker formatter empty records before exact sorting`,
  );
}

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
  "KEMERBET_RECHECK_IDENTITY_KEY_DIGEST=''",
  "KEMERBET_RECHECK_COMMITTED='false'",
  "KEMERBET_RECHECK_DURABLE_SUCCESS='false'",
  "KEMERBET_RECHECK_CONTROLLER_FIREWALL_V4_DIGEST=''",
  "KEMERBET_RECHECK_CONTROLLER_FIREWALL_V6_DIGEST=''",
  "KEMERBET_RECHECK_BROWSER_FIREWALL_V4_DIGEST=''",
  "KEMERBET_RECHECK_BROWSER_FIREWALL_V6_DIGEST=''",
]) {
  assert.match(helper, new RegExp('^' + lifecycleInitialization + '$', 'm'));
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
assert.equal(
  (recoverRecheckPromotion.match(/\bremove_kemerbet_recheck_container\b/g) ?? []).length,
  3,
  'each durable recovery state must remove the transient recheck container first',
);
assert.equal(
  (recoverRecheckPromotion.match(/\bremove_kemerbet_recheck_network\b/g) ?? []).length,
  3,
  'each durable recovery state must remove both transient recheck networks first',
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
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
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
    'remove_kemerbet_recheck_container',
    'remove_kemerbet_recheck_network',
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

const recheckEngineBoundary = extractShellFunction(
  helper,
  'require_kemerbet_recheck_engine_boundary',
  'require_kemerbet_recheck_container_contract',
);
for (const contract of [
  /nsenter iptables-restore ip6tables-restore iptables-save ip6tables-save/,
  /docker_local version --format '\{\{\.Server\.Version\}\}'/,
  /\^\(\[0-9\]\+\)\\\.\[0-9\]\+/,
  /major="\$\{BASH_REMATCH\[1\]\}"/,
  /\(\( major >= 28 \)\)/,
]) {
  assert.match(recheckEngineBoundary, contract);
}
assert.doesNotMatch(
  helper,
  /\\\$\{/u,
  'the root helper must not retain escaped runtime Bash expansions that silently disable variable interpolation',
);

for (const fixedRuntimeContract of [
  /^readonly KEMERBET_RECHECK_CONTAINER="\$PROJECT_NAME-kemerbet-no-transfer-readiness-once"$/mu,
  /^readonly KEMERBET_RECHECK_BROWSER_CONTAINER="\$PROJECT_NAME-kemerbet-readiness-browser-once"$/mu,
  /^readonly KEMERBET_RECHECK_PROXY_CONTAINER="\$PROJECT_NAME-kemerbet-readiness-egress-proxy-once"$/mu,
  /^readonly KEMERBET_RECHECK_AUTHORIZER_CONTAINER="\$PROJECT_NAME-kemerbet-readiness-authorizer-once"$/mu,
  /^readonly KEMERBET_RECHECK_SNAPSHOT_CONTAINER="\$PROJECT_NAME-kemerbet-readiness-profile-snapshot-copy-once"$/mu,
  /^readonly KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER="\$PROJECT_NAME-kemerbet-readiness-profile-snapshot-verify-once"$/mu,
  /^readonly KEMERBET_RECHECK_CONTROL_NETWORK="\$\{PROJECT_NAME\}_kemerbet_readiness_control"$/mu,
  /^readonly KEMERBET_RECHECK_PROXY_NETWORK="\$\{PROJECT_NAME\}_kemerbet_readiness_proxy"$/mu,
  /^readonly KEMERBET_RECHECK_EGRESS_NETWORK="\$\{PROJECT_NAME\}_kemerbet_readiness_egress"$/mu,
  /^readonly KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV4='172\.31\.254\.2'$/mu,
  /^readonly KEMERBET_RECHECK_BROWSER_CONTROL_IPV4='172\.31\.254\.3'$/mu,
  /^readonly KEMERBET_RECHECK_PROXY_PROXY_IPV4='172\.31\.254\.10'$/mu,
  /^readonly KEMERBET_RECHECK_BROWSER_PROXY_IPV4='172\.31\.254\.11'$/mu,
  /^readonly KEMERBET_RECHECK_RPC_ROOT='\/run\/fetanagent-kemerbet-readiness-rpc-v1'$/mu,
  /^readonly KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT="\$KEMERBET_RECHECK_RPC_ROOT\/controller-stage-output"$/mu,
  /^readonly KEMERBET_RECHECK_CONTROLLER_STAGE="\$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT\/stage-v1"$/mu,
  /^readonly KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT="\$KEMERBET_RECHECK_RPC_ROOT\/browser-stage-output"$/mu,
  /^readonly KEMERBET_RECHECK_BROWSER_STAGE="\$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT\/stage-v1"$/mu,
  /^readonly KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT="\$KEMERBET_RECHECK_RPC_ROOT\/proxy-stage-output"$/mu,
  /^readonly KEMERBET_RECHECK_PROXY_STAGE="\$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT\/stage-v1"$/mu,
  /^readonly KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS="\$KEMERBET_RECHECK_RPC_ROOT\/proxy-agent-identity-bindings"$/mu,
  /^readonly KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY="\$KEMERBET_RECHECK_RPC_ROOT\/proxy-agent-identity-hmac-key"$/mu,
  /^readonly KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME="\$PROJECT_NAME-kemerbet-readiness-profile-snapshot-once"$/mu,
  /^readonly KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER="\$PROJECT_NAME-kemerbet-readiness-profile-original-verify-once"$/mu,
]) {
  assert.match(helper, fixedRuntimeContract);
}
assert.ok(
  (helper.match(/sha256-provider-authorization-v1:\[0-9a-f\]\{64\}/g) ?? []).length >= 5,
  'the helper must retain the historical v2 provider-authorization parsers needed for bounded recovery and migration continuity',
);
const v3BindingContentContract = /require_kemerbet_v3_binding_content\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
assert.ok(v3BindingContentContract, 'the helper must define one exact stable v3 binding attestor');
for (const v3BindingContract of [
  /len\(sys\.argv\) != 2 or os\.path\.realpath\(sys\.argv\[1\]\) != sys\.argv\[1\]/u,
  /os\.stat\(path, follow_symlinks=False\)/u,
  /not stat\.S_ISREG\(before\.st_mode\) or before\.st_size != 230/u,
  /os\.O_RDONLY \| os\.O_CLOEXEC/u,
  /os\.O_NOFOLLOW/u,
  /rb'hmac-sha256-agent-identity-v1:\(\[0-9a-f\]\{64\}\) '/u,
  /rb'hmac-sha256-agent-profile-pin-v3:\\2\\n'/u,
  /identity\(before\) != identity\(opened\)/u,
  /identity\(opened\) != identity\(after\)/u,
  /identity\(after\) != identity\(path_after\)/u,
  /len\(data\) != 230/u,
  /PATTERN\.fullmatch\(bytes\(data\)\) is None/u,
]) {
  assert.match(v3BindingContentContract, v3BindingContract);
}
assert.equal(
  (helper.match(/require_kemerbet_v3_binding_content/g) ?? []).length,
  11,
  'the stable v3 binding attestor must be defined once and used by all ten operational binding boundaries, including both preview-source states',
);
const v1RetirementRuntimeStart = helper.indexOf('publish_kemerbet_v1_retirement_artifact() {');
const v1RetirementRuntimeEnd = helper.indexOf('\nconsume_exact_one_use_kemerbet_file() {');
assert.ok(
  v1RetirementRuntimeStart >= 0 && v1RetirementRuntimeEnd > v1RetirementRuntimeStart,
  'the obsolete v1 parser must be isolated inside the explicit retirement boundary',
);
const helperOutsideV1Retirement =
  helper.slice(0, v1RetirementRuntimeStart) + helper.slice(v1RetirementRuntimeEnd);
assert.doesNotMatch(
  helperOutsideV1Retirement,
  /hmac-sha256-agent-identity-v1:\[0-9a-f\]\{64\}\$'/,
  'obsolete two-field v1 bindings must be accepted only inside the explicit retirement transaction',
);
const recheckAgentIdentitySourceContract = extractShellFunction(
  helper,
  'require_kemerbet_recheck_agent_identity_source_contract',
  'require_kemerbet_recheck_authorizations_contract',
);
for (const contract of [
  /binding = read_exact\(sys\.argv\[1\], 0o444, 230\)/,
  /rb'hmac-sha256-agent-identity-v1:\(\[0-9a-f\]\{64\}\) '/,
  /rb'hmac-sha256-agent-profile-pin-v3:\\1\\n'/,
]) {
  assert.match(recheckAgentIdentitySourceContract, contract);
}

const readinessServiceTimeout =
  /^readonly KEMERBET_RECHECK_SERVICE_READY_TIMEOUT_SECONDS='([0-9]+)'$/mu.exec(helper);
assert.ok(readinessServiceTimeout, 'the readiness service deadline must be fixed');
assert.equal(Number(readinessServiceTimeout[1]), 240);
assert.ok(
  Number(readinessServiceTimeout[1]) >= 210,
  'the helper deadline must cover the 90-second start period and 120 one-second health retries',
);

const proxyComposeService =
  /\n  kemerbet-readiness-egress-proxy:\r?\n([\s\S]*?)\n  customer-web:/u.exec(compose)?.[1];
assert.ok(proxyComposeService, 'the static trusted proxy service must exist');
const proxyHealthCommand =
  /healthcheck:[\s\S]*?- CMD\r?\n\s+- node\r?\n\s+- -e\r?\n\s+- "([^\r\n]*)"/u.exec(
    proxyComposeService,
  )?.[1];
assert.ok(proxyHealthCommand, 'the trusted proxy must have one exact application health command');
const decodedProxyHealthCommand = JSON.parse(`"${proxyHealthCommand}"`);
const proxyHealthTestSha256 = createHash('sha256')
  .update(['CMD', 'node', '-e', decodedProxyHealthCommand].map((entry) => `${entry}\n`).join(''))
  .digest('hex');
assert.equal(
  proxyHealthTestSha256,
  '424d2d9214c1089d7a9ecace5818e5541f3dd3b59324fbcf647503c2802456da',
);
assert.match(
  helper,
  /^readonly KEMERBET_RECHECK_PROXY_HEALTH_TEST_SHA256='424d2d9214c1089d7a9ecace5818e5541f3dd3b59324fbcf647503c2802456da'$/mu,
);

for (const dockerIdentityContract of [
  /groupadd --gid 10001 fetanagent/,
  /useradd --uid 10001 --gid 10001[^\r\n]*fetanagent/,
  /groupadd --gid 10002 fetanagent-readiness-controller/,
  /useradd --uid 10002 --gid 10002[^\r\n]*fetanagent-readiness-controller/,
  /groupadd --gid 10003 fetanagent-readiness-proxy/,
  /useradd --uid 10003 --gid 10003[^\r\n]*fetanagent-readiness-proxy/,
  /groupadd --gid 10004 fetanagent-readiness-authorizer/,
  /useradd --uid 10004 --gid 10004[^\r\n]*fetanagent-readiness-authorizer/,
]) {
  assert.match(dockerfile, dockerIdentityContract);
}

const recheckCompletionReceipt = extractShellFunction(
  helper,
  'require_kemerbet_recheck_completion_receipt_contract',
  'read_kemerbet_recheck_fixed_stage',
);
for (const contract of [
  /10003:10003:400:1/,
  /read_exact\(binding_path, 10003, 10003, 0o400, 230, 230\)/,
  /fetanagent-kemerbet-readiness-layer7-completion-v3/,
  /'agentIdentityBindingSha256': hashlib\.sha256\(binding_serialized\)\.hexdigest\(\)/,
  /'identifiersRedacted': True/,
  /'moneyMoved': False/,
  /'responsesValidated': True/,
  /'sameAgentIdentityValidated': True/,
  /'stableAgentProfileValidated': True/,
  /'sequences': \[1, 2, 3, 4, 5\]/,
  /'transferDisabled': True/,
  /'version': 3/,
  /canonical = json\.dumps\(expected, separators=\(',', ':'\), ensure_ascii=False\)\.encode\(\) \+ b'\\n'/,
  /if data != canonical:/,
]) {
  assert.match(recheckCompletionReceipt, contract);
}
assert.doesNotMatch(
  recheckCompletionReceipt,
  /print\(|sys\.stdout|username|account_id|Authorization|bearer/iu,
  'completion verification must expose only the canonical nonsecret v3 receipt',
);

const recheckFixedStageReader = extractShellFunction(
  helper,
  'read_kemerbet_recheck_fixed_stage',
  'require_kemerbet_recheck_fixed_stage_contract',
);
for (const contract of [
  /expected_uid='10002'/,
  /expected_uid='10001'/,
  /expected_uid='10003'/,
  /stat\.S_ISDIR\(root_stat\.st_mode\)/,
  /stat\.S_ISREG\(before\.st_mode\)/,
  /stat\.S_IMODE\(before\.st_mode\) != 0o400/,
  /before\.st_nlink != 1/,
  /before\.st_size > 64/,
  /entries != \['stage-v1'\]/,
  /os\.O_RDONLY \| getattr\(os, 'O_NOFOLLOW', 0\)/,
  /identity\(opened_after\) != identity\(opened\)/,
  /identity\(root_after\) != identity\(root_stat\)/,
  /sorted\(os\.listdir\(root\)\) != \['stage-v1'\]/,
  /stage not in allowed\[role\]/,
  /controller_lookup_1/,
  /browser_restored_navigation/,
  /browser_refresh_admitted/,
  /browser_refresh_forwarded/,
  /browser_refresh_response_complete/,
]) {
  assert.match(recheckFixedStageReader, contract);
}
assert.doesNotMatch(
  recheckFixedStageReader,
  /requestUrl|headers|body|playerId|accountId|authorizationDigest|tokenValue|entries not in \([^\n]*stage-v1\.installing/,
  'the fixed stage reader must neither accept nor emit request or identity material',
);

const recheckFixedStageContract = extractShellFunction(
  helper,
  'require_kemerbet_recheck_fixed_stage_contract',
  'print_kemerbet_recheck_fixed_failure_stages',
);
for (const contract of [
  /controller_not_started/,
  /browser_not_started/,
  /proxy_not_started/,
  /controller_complete/,
  /browser_complete/,
  /proxy_ready/,
  /browser_refresh_response_complete/,
]) {
  assert.match(recheckFixedStageContract, contract);
}

const recheckFixedStagePrinter = extractShellFunction(
  helper,
  'print_kemerbet_recheck_fixed_failure_stages',
  'require_kemerbet_recheck_runtime_artifacts',
);
assert.match(recheckFixedStagePrinter, /read_kemerbet_recheck_fixed_stage controller/);
assert.match(recheckFixedStagePrinter, /read_kemerbet_recheck_fixed_stage browser/);
assert.match(recheckFixedStagePrinter, /read_kemerbet_recheck_fixed_stage proxy/);
assert.doesNotMatch(
  recheckFixedStagePrinter,
  /cat|head|tail|sed|awk|grep|find|request|header|body|token|digest/,
  'failure reporting must print only values returned by the exact fixed-stage validator',
);

const recheckRuntimeArtifacts = extractShellFunction(
  helper,
  'require_kemerbet_recheck_runtime_artifacts',
  'remove_kemerbet_recheck_rpc_capabilities',
);
for (const contract of [
  /prepared.*released.*completed/s,
  /browser-capability.*controller-capability.*controller-firewall-release/s,
  /proxy-agent-identity-bindings.*proxy-agent-identity-hmac-key/s,
  /require_kemerbet_recheck_runtime_file "\$KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY"[\s\S]*?'10002:10002:400:1:65'/u,
  /require_kemerbet_recheck_runtime_file "\$KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY"[\s\S]*?'10001:10001:400:1:65'/u,
  /require_kemerbet_recheck_runtime_file "\$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY"[\s\S]*?'10004:10004:400:1:65'/u,
  /require_kemerbet_recheck_runtime_file "\$KEMERBET_RECHECK_PROXY_HMAC_KEY"[\s\S]*?'10003:10003:400:1:65'/u,
  /require_kemerbet_recheck_agent_identity_source_contract/,
  /require_kemerbet_recheck_runtime_file "\$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS"[\s\S]*?'10003:10003:400:1:230'/u,
  /require_kemerbet_recheck_runtime_file "\$KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY"[\s\S]*?'10003:10003:400:1:64'/u,
  /proxy_identity_binding_inode.*candidate_binding_inode/s,
  /proxy_identity_key_inode.*identity_key_inode/s,
  /require_kemerbet_recheck_authorizations_contract/,
  /require_kemerbet_recheck_profile_manifest_contract "\$account_id"/,
  /require_kemerbet_recheck_fixed_stage_contract "\$phase"/,
  /require_kemerbet_recheck_completion_receipt_contract "\$commit_sha"/,
]) {
  assert.match(recheckRuntimeArtifacts, contract);
}

const createRecheckRpcCapabilities = extractShellFunction(
  helper,
  'create_kemerbet_recheck_rpc_capabilities',
  'wait_kemerbet_recheck_container_exit_zero',
);
for (const contract of [
  /install -d -o root -g root -m 0700 "\$KEMERBET_RECHECK_RPC_ROOT"/,
  /KEMERBET_RECHECK_RPC_CONTROLLER_CAPABILITY/,
  /KEMERBET_RECHECK_RPC_BROWSER_CAPABILITY/,
  /KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY/,
  /KEMERBET_RECHECK_PROXY_HMAC_KEY/,
  /KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE/,
  /KEMERBET_RECHECK_PROXY_RUN_NONCE/,
  /KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS/,
  /KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY/,
  /KEMERBET_RECHECK_BROWSER_ACCOUNT_ID/,
  /KEMERBET_RECHECK_SNAPSHOT_ACCOUNT_ID/,
  /KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE/,
  /KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE/,
  /install -d -o 10002 -g 10002 -m 0700 "\$KEMERBET_RECHECK_CONTROLLER_STAGE_OUTPUT_ROOT"/,
  /install -d -o 10001 -g 10001 -m 0700 "\$KEMERBET_RECHECK_BROWSER_STAGE_OUTPUT_ROOT"/,
  /install -d -o 10003 -g 10003 -m 0700 "\$KEMERBET_RECHECK_PROXY_STAGE_OUTPUT_ROOT"/,
  /controller_not_started/,
  /browser_not_started/,
  /proxy_not_started/,
  /install -o 10001 -g 10001 -m 0400/,
  /install -o 10002 -g 10002 -m 0400/,
  /install -o 10003 -g 10003 -m 0400/,
  /install -o 10004 -g 10004 -m 0400/,
  /install -o root -g root -m 0444/,
  /cmp -s/,
]) {
  assert.match(createRecheckRpcCapabilities, contract);
}
assert.doesNotMatch(
  createRecheckRpcCapabilities,
  /mkdir --mode=0700 -- "\$KEMERBET_RECHECK_RPC_ROOT"/,
  'the root-owned RPC directory must use one exact creation primitive',
);

const recheckOneshotContainerContract = extractShellFunction(
  helper,
  'require_kemerbet_recheck_oneshot_container_contract',
  'wait_kemerbet_recheck_container_exit_zero',
);
assert.match(
  recheckOneshotContainerContract,
  /--format '\{\{range \.Mounts\}\}\{\{printf "%s\|%s\|%s\|%t\|%s\\n" \.Type \.Name \.Destination \.RW \.Source\}\}\{\{end\}\}' \| \\\n\s+LC_ALL=C sed '\/\^\$\/d' \| \\\n\s+LC_ALL=C sort/u,
  'the one-shot mount attestor must remove only Docker formatter empty records before exact sorting',
);

if (process.platform === 'linux' || process.platform === 'win32') {
  const mountContractBashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const mountContractNormalizationRegression = spawnSync(mountContractBashExecutable, ['-s'], {
    encoding: 'utf8',
    input: [
      'set -euo pipefail',
      'assert_formatter_contract() {',
      '  local expected first raw normalized whitespace extra missing changed',
      '  expected="$1"',
      '  shift',
      '  first="$1"',
      '  shift',
      '  raw="$(printf \'%s\\n\' "$first" "$@" \'\' | LC_ALL=C sort)"',
      '  [[ "$raw" != "$expected" ]]',
      '  normalized="$(printf \'%s\\n\' "$first" "$@" \'\' | LC_ALL=C sed \'/^$/d\' | LC_ALL=C sort)"',
      '  [[ "$normalized" == "$expected" ]]',
      "  whitespace=\"$(printf '%s\\n' \"$first\" \"$@\" ' ' '' | LC_ALL=C sed '/^$/d' | LC_ALL=C sort)\"",
      '  [[ "$whitespace" != "$expected" ]]',
      '  extra="$(printf \'%s\\n\' "$first" "$@" unexpected-record \'\' | LC_ALL=C sed \'/^$/d\' | LC_ALL=C sort)"',
      '  [[ "$extra" != "$expected" ]]',
      "  missing=\"$(printf '%s\\n' \"$@\" '' | LC_ALL=C sed '/^$/d' | LC_ALL=C sort)\"",
      '  [[ "$missing" != "$expected" ]]',
      '  changed="$(printf \'%s\\n\' "changed:$first" "$@" \'\' | LC_ALL=C sed \'/^$/d\' | LC_ALL=C sort)"',
      '  [[ "$changed" != "$expected" ]]',
      '}',
      "assert_formatter_contract \"$(printf '%s\\n' 'com.docker.compose.project=fetanagent-staging-beta' 'com.docker.compose.volume=kemerbet_readiness_profile_snapshot' 'com.fetanagent.kemerbet-readiness.snapshot=profile-snapshot-v1' | LC_ALL=C sort)\" 'com.docker.compose.volume=kemerbet_readiness_profile_snapshot' 'com.fetanagent.kemerbet-readiness.snapshot=profile-snapshot-v1' 'com.docker.compose.project=fetanagent-staging-beta'",
      "assert_formatter_contract \"$(printf '%s\\n' 'com.docker.network.bridge.gateway_mode_ipv4=isolated' 'com.docker.network.bridge.gateway_mode_ipv6=isolated' | LC_ALL=C sort)\" 'com.docker.network.bridge.gateway_mode_ipv6=isolated' 'com.docker.network.bridge.gateway_mode_ipv4=isolated'",
      "assert_formatter_contract \"$(printf '%s\\n' 'bind||/run/output|true|/run/source-output' 'bind||/run/secrets/input|false|/run/source-input' | LC_ALL=C sort)\" 'bind||/run/secrets/input|false|/run/source-input' 'bind||/run/output|true|/run/source-output'",
      "assert_formatter_contract \"$(printf '%s\\n' 'fetanagent-staging-beta_kemerbet-readiness-control' 'fetanagent-staging-beta_kemerbet-readiness-proxy' | LC_ALL=C sort)\" 'fetanagent-staging-beta_kemerbet-readiness-proxy' 'fetanagent-staging-beta_kemerbet-readiness-control'",
      "assert_formatter_contract \"$(printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' | LC_ALL=C sort)\" 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
      "empty=\"$(printf '\\n' | LC_ALL=C sed '/^$/d' | LC_ALL=C sort)\"",
      '[[ -z "$empty" ]]',
    ].join('\n'),
  });
  assert.equal(
    mountContractNormalizationRegression.status,
    0,
    `the one-shot mount normalization regression failed: ${mountContractNormalizationRegression.stderr || mountContractNormalizationRegression.stdout}`,
  );
}

const helperLines = helper.split(/\r?\n/u);
const multilineDockerFormatterSortPipelines = [];
for (let index = 0; index < helperLines.length; index += 1) {
  if (!helperLines[index].includes("--format '{{range")) continue;
  const candidate = helperLines.slice(index, index + 8).join('\n');
  const commandSubstitutionEnd = candidate.indexOf(')"');
  const boundedCandidate =
    commandSubstitutionEnd >= 0 ? candidate.slice(0, commandSubstitutionEnd + 2) : candidate;
  if (boundedCandidate.includes('LC_ALL=C sort)')) {
    multilineDockerFormatterSortPipelines.push(boundedCandidate);
  }
}
assert.equal(
  multilineDockerFormatterSortPipelines.length,
  9,
  'every multiline Docker formatter that is sorted must remain in the audited inventory',
);
assert.equal(
  multilineDockerFormatterSortPipelines.filter((pipeline) =>
    pipeline.includes("LC_ALL=C sed '/^$/d' |"),
  ).length,
  8,
  'all eight exact Docker inventories must remove only byte-empty formatter records before sorting',
);
assert.equal(
  multilineDockerFormatterSortPipelines.filter((pipeline) =>
    pipeline.includes("LC_ALL=C grep -E '^("),
  ).length,
  1,
  'the sole remaining sorted multiline formatter must use the anchored runtime-environment allowlist',
);
for (const pipeline of multilineDockerFormatterSortPipelines) {
  assert.ok(
    pipeline.includes("LC_ALL=C sed '/^$/d' |") || pipeline.includes("LC_ALL=C grep -E '^("),
    'a multiline Docker formatter may reach sort only through exact empty-record removal or the anchored environment allowlist',
  );
}

const authorizationPremint = extractShellFunction(
  helper,
  'run_kemerbet_recheck_authorization_premint',
  'run_kemerbet_recheck_profile_snapshot_copy',
);
for (const contract of [
  /--network none/,
  /--user 10004:10004/,
  /--read-only/,
  /--cap-drop ALL/,
  /no-new-privileges/,
  /kemerbet-readiness-authorization-premint\.js/,
  /src=\$KEMERBET_RECHECK_AUTHORIZER_PLAYER_IDS,dst=\/run\/secrets\/kemerbet_no_transfer_readiness_player_ids,readonly/,
  /src=\$KEMERBET_RECHECK_AUTHORIZER_HMAC_KEY,dst=\/run\/secrets\/kemerbet_readiness_authorizer_hmac_key,readonly/,
  /src=\$KEMERBET_RECHECK_AUTHORIZER_RUN_NONCE,dst=\/run\/secrets\/kemerbet_readiness_authorizer_run_nonce,readonly/,
  /src=\$KEMERBET_RECHECK_AUTHORIZER_OUTPUT_ROOT,dst=\/run\/output"/,
  /wait_kemerbet_recheck_container_exit_zero/,
  /require_kemerbet_recheck_authorizations_contract/,
]) {
  assert.match(authorizationPremint, contract);
}
assert.doesNotMatch(
  authorizationPremint,
  /KEMERBET_PROFILE_VOLUME|KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME|network connect|container logs/iu,
  'the offline authorizer must receive neither a browser profile nor a network',
);

const profileSnapshotCopy = extractShellFunction(
  helper,
  'run_kemerbet_recheck_profile_snapshot_copy',
  'run_kemerbet_recheck_profile_snapshot_verify',
);
assert.match(
  profileSnapshotCopy,
  /"\$expected_mounts" '\["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_FOWNER"\]' \|\| return 1/u,
  'snapshot-copy attestation must require Docker 28 canonical capability names',
);
assert.doesNotMatch(
  profileSnapshotCopy,
  /"\$expected_mounts" '\["CHOWN","DAC_OVERRIDE","FOWNER"\]' \|\| return 1/u,
  'snapshot-copy attestation must reject the non-canonical unprefixed capability spelling',
);

const strictProfileSnapshotVerify = extractShellFunction(
  helper,
  'run_kemerbet_recheck_profile_snapshot_verify',
  'run_kemerbet_recheck_original_profile_verify',
);
for (const contract of [
  /KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER/,
  /profile-snapshot-verify-v1/,
  /--network none/,
  /type=volume,src=\$KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME,dst=\/run\/source,readonly/,
  /kemerbet-readiness-profile-snapshot\.js verify\)/,
  /'\["apps\/executor\/dist\/kemerbet-readiness-profile-snapshot\.js","verify"\]'/,
  /"\$expected_mounts" '\["CAP_DAC_OVERRIDE"\]' \|\| return 1/,
]) {
  assert.match(strictProfileSnapshotVerify, contract);
}
assert.doesNotMatch(
  strictProfileSnapshotVerify,
  /verify-original|KEMERBET_PROFILE_VOLUME|"\$expected_mounts" '\["DAC_OVERRIDE"\]'/,
  'completed-snapshot verification must stay strict, use Docker 28 canonical capability names, and never inspect the mutable original profile',
);

const originalProfileVerify = extractShellFunction(
  helper,
  'run_kemerbet_recheck_original_profile_verify',
  'prepare_kemerbet_recheck_profile_snapshot',
);
for (const contract of [
  /KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER/,
  /profile-original-verify-v1/,
  /--network none/,
  /--read-only/,
  /--user 0:0/,
  /--cap-drop ALL/,
  /--cap-add DAC_OVERRIDE/,
  /no-new-privileges:true/,
  /type=volume,src=\$KEMERBET_PROFILE_VOLUME,dst=\/run\/source,readonly/,
  /src=\$KEMERBET_RECHECK_PROFILE_OUTPUT_ROOT,dst=\/run\/output,readonly/,
  /kemerbet-readiness-profile-snapshot\.js verify-original\)/,
  /'\["apps\/executor\/dist\/kemerbet-readiness-profile-snapshot\.js","verify-original"\]'/,
  /"\$expected_mounts" '\["CAP_DAC_OVERRIDE"\]' \|\| return 1/,
  /kemerbet_recheck_original_profile_volume_holders_match "\$container_id"/,
  /require_kemerbet_profile_volume_holders ''/,
  /require_kemerbet_recheck_profile_manifest_contract "\$account_id"/,
]) {
  assert.match(originalProfileVerify, contract);
}
assert.doesNotMatch(
  originalProfileVerify,
  /KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME|profile-snapshot-verify-v1|container logs|network connect|"\$expected_mounts" '\["DAC_OVERRIDE"\]'/,
  'original-profile verification must have a distinct identity, use Docker 28 canonical capability names, and never receive the disposable snapshot',
);

const prepareProfileSnapshot = extractShellFunction(
  helper,
  'prepare_kemerbet_recheck_profile_snapshot',
  'require_kemerbet_recheck_transients_absent',
);
assertInOrder(
  prepareProfileSnapshot,
  [
    'create_kemerbet_recheck_profile_snapshot_volume',
    'run_kemerbet_recheck_profile_snapshot_copy "$account_id" "$image_id"',
    'run_kemerbet_recheck_profile_snapshot_verify "$account_id" \'0:0:700\' "$image_id"',
    "resolve_kemerbet_recheck_profile_snapshot_mountpoint '0:0:700'",
    'chown 10001:10001 "$mountpoint"',
    'chmod 0700 "$mountpoint"',
    "resolve_kemerbet_recheck_profile_snapshot_mountpoint '10001:10001:700'",
    'run_kemerbet_recheck_profile_snapshot_verify "$account_id" \'10001:10001:700\' "$image_id"',
  ],
  'snapshot preparation must copy and verify offline, perform only the root handoff, and reverify before browser use',
);
assert.doesNotMatch(
  prepareProfileSnapshot,
  /chown\s+-R|chmod\s+-R|KEMERBET_PROFILE_VOLUME.*:rw|network connect|container logs/iu,
  'snapshot handoff must never rewrite copied tree metadata or expose the real profile for writing',
);

const recheckRuntimeContract = extractShellFunction(
  helper,
  'require_kemerbet_recheck_container_contract',
  'require_kemerbet_recheck_running_network_contract',
);
for (const contract of [
  /controller\)/,
  /expected_user='10002:10002'/,
  /kemerbet-no-transfer-readiness\.js/,
  /KEMERBET_RECHECK_CONTROL_NETWORK/,
  /browser\)/,
  /expected_user='10001:10001'/,
  /kemerbet-readiness-browser-driver\.js/,
  /KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME/,
  /KEMERBET_RECHECK_BROWSER_ACCOUNT_ID/,
  /KEMERBET_READINESS_L7_PROXY_IPV4=\$KEMERBET_RECHECK_PROXY_PROXY_IPV4/,
  /proxy\)/,
  /expected_user='10003:10003'/,
  /kemerbet-readiness-layer7-proxy\.js/,
  /KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_BINDINGS/,
  /KEMERBET_RECHECK_PROXY_AGENT_IDENTITY_HMAC_KEY/,
  /KEMERBET_RECHECK_PROXY_OUTPUT_ROOT/,
  /FINANCIAL_ACTIONS_MODE=dry_run/,
  /KEMERBET_EXECUTOR_ENABLED=false/,
  /KEMERBET_FINAL_ACTION_ENABLED=false/,
  /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false/,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false/,
  /ReadonlyRootfs/,
  /Privileged/,
  /\[\\"ALL\\"\]/,
  /no-new-privileges:true/,
  /PortBindings/,
  /LogConfig\.Type/,
  /\.Config\.Healthcheck\.Interval/,
  /'1000000000\|1000000000\|90000000000\|120'/,
  /\.Config\.Healthcheck\.Test/,
  /KEMERBET_RECHECK_PROXY_HEALTH_TEST_SHA256/,
]) {
  assert.match(recheckRuntimeContract, contract);
}
assert.equal(
  (recheckRuntimeContract.match(/expected_dns='\["127\.0\.0\.1"\]'/g) ?? []).length,
  2,
  'only controller and browser may use the loopback-only DNS contract',
);
assert.equal(
  (
    recheckRuntimeContract.match(
      /expected_dns_options='\["attempts:1","timeout:1","ndots:0"\]'/g,
    ) ?? []
  ).length,
  2,
);
assert.equal((recheckRuntimeContract.match(/expected_dns='null'/g) ?? []).length, 1);
assert.equal((recheckRuntimeContract.match(/expected_dns_options='null'/g) ?? []).length, 1);
assert.equal(
  (
    recheckRuntimeContract.match(
      /expected_tmpfs='\{"\/tmp":"rw,noexec,nosuid,nodev,size=33554432,mode=1777"\}'/g,
    ) ?? []
  ).length,
  2,
  'controller and proxy must have the exact private 32 MiB tmpfs',
);
assert.equal(
  (
    recheckRuntimeContract.match(
      /expected_tmpfs='\{"\/tmp":"rw,noexec,nosuid,nodev,size=268435456,mode=1777"\}'/g,
    ) ?? []
  ).length,
  1,
  'the browser must have the exact private 256 MiB tmpfs',
);
assert.equal((recheckRuntimeContract.match(/expected_stop_timeout='15'/g) ?? []).length, 2);
assert.equal((recheckRuntimeContract.match(/expected_stop_timeout='60'/g) ?? []).length, 1);
assert.equal(
  (
    recheckRuntimeContract.match(/expected_network_mode="\$KEMERBET_RECHECK_CONTROL_NETWORK"/g) ??
    []
  ).length,
  2,
  'controller and browser must use the isolated control network as their exact primary network',
);
assert.equal(
  (recheckRuntimeContract.match(/expected_network_mode="\$KEMERBET_RECHECK_EGRESS_NETWORK"/g) ?? [])
    .length,
  1,
  'the proxy must use the Compose-selected egress network as its exact primary network',
);
assert.equal(
  (recheckRuntimeContract.match(/expected_network_mode="\$KEMERBET_RECHECK_PROXY_NETWORK"/g) ?? [])
    .length,
  0,
  'the proxy network remains an exact secondary membership and must not be mistaken for Compose NetworkMode',
);
for (const exactRoleMembership of [
  /controller\)\s+\[\[ "\$observed_networks" == "\$KEMERBET_RECHECK_CONTROL_NETWORK" \]\]/u,
  /browser\)\s+\[\[ "\$observed_networks" == "\$\(printf '%s\\n' [\\]\s*"\$KEMERBET_RECHECK_CONTROL_NETWORK" "\$KEMERBET_RECHECK_PROXY_NETWORK" \| LC_ALL=C sort\)" \]\]/u,
  /proxy\)\s+\[\[ "\$observed_networks" == "\$\(printf '%s\\n' [\\]\s*"\$KEMERBET_RECHECK_EGRESS_NETWORK" "\$KEMERBET_RECHECK_PROXY_NETWORK" \| LC_ALL=C sort\)" \]\]/u,
]) {
  assert.match(
    recheckRuntimeContract,
    exactRoleMembership,
    'each readiness role must retain its exact fail-closed network-membership set',
  );
}
for (const emptyProxyVariable of [
  'ALL_PROXY',
  'FTP_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'all_proxy',
  'ftp_proxy',
  'https_proxy',
  'http_proxy',
  'no_proxy',
]) {
  assert.equal(
    (recheckRuntimeContract.match(new RegExp(`'${emptyProxyVariable}='`, 'g')) ?? []).length,
    3,
    `all three readiness roles must explicitly clear ${emptyProxyVariable}`,
  );
}
assert.equal((recheckRuntimeContract.match(/'NODE_ENV=production'/g) ?? []).length, 3);
assertInOrder(
  recheckRuntimeContract,
  [
    'observed_runtime_environment="$(docker_local container inspect "$container_id"',
    "--format '{{range .Config.Env}}{{println .}}{{end}}'",
    "LC_ALL=C grep -E '^(ALL_PROXY|FINANCIAL_ACTIONS_MODE|FTP_PROXY|HTTPS_PROXY|HTTP_PROXY|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED|KEMERBET_[A-Z0-9_]+|NODE_ENV|NO_PROXY|all_proxy|ftp_proxy|https_proxy|http_proxy|no_proxy)='",
    'LC_ALL=C sort)" || return 1',
    '[[ "$observed_runtime_environment" == "$expected_runtime_environment" ]]',
  ],
  'the runtime environment must equal the exact role allowlist after Compose creation',
);
assert.doesNotMatch(
  recheckRuntimeContract,
  /KEMERBET_PROFILE_VOLUME|container start|container logs|DATABASE|PASSWORD|SUPABASE|RECEIVER|FINANCIAL_ACTIONS_MODE=live/iu,
  'pre-start runtime attestation must reference only the disposable profile and no financial authority',
);
for (const [name, formatter] of [
  [
    'runtime mounts',
    /--format '\{\{range \.Mounts\}\}\{\{printf "%s\|%s\|%s\|%t\|%s\\n" \.Type \.Name \.Destination \.RW \.Source\}\}\{\{end\}\}' \| \\\n\s+LC_ALL=C sed '\/\^\$\/d' \| \\\n\s+LC_ALL=C sort/u,
  ],
  [
    'runtime network names',
    /--format '\{\{range \$name, \$_ := \.NetworkSettings\.Networks\}\}\{\{println \$name\}\}\{\{end\}\}' \| \\\n\s+LC_ALL=C sed '\/\^\$\/d' \| \\\n\s+LC_ALL=C sort/u,
  ],
]) {
  assert.match(
    recheckRuntimeContract,
    formatter,
    `${name} attestation must remove only Docker formatter empty records before exact sorting`,
  );
}

const recheckRunningNetworkContract = extractShellFunction(
  helper,
  'require_kemerbet_recheck_running_network_contract',
  'normalized_kemerbet_recheck_firewall_digest',
);
for (const contract of [
  /KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV4/,
  /KEMERBET_RECHECK_CONTROLLER_CONTROL_IPV6/,
  /KEMERBET_RECHECK_BROWSER_CONTROL_IPV4/,
  /KEMERBET_RECHECK_BROWSER_CONTROL_IPV6/,
  /KEMERBET_RECHECK_BROWSER_PROXY_IPV4/,
  /KEMERBET_RECHECK_BROWSER_PROXY_IPV6/,
  /KEMERBET_RECHECK_PROXY_PROXY_IPV4/,
  /KEMERBET_RECHECK_PROXY_PROXY_IPV6/,
  /KEMERBET_RECHECK_CONTROL_NETWORK[\s\S]*?browser_id.*controller_id/s,
  /KEMERBET_RECHECK_PROXY_NETWORK[\s\S]*?browser_id.*proxy_id/s,
  /KEMERBET_RECHECK_EGRESS_NETWORK[\s\S]*?"\$proxy_id"/s,
]) {
  assert.match(recheckRunningNetworkContract, contract);
}
assert.equal(
  (
    recheckRunningNetworkContract.match(
      /--format '\{\{range \$id, \$_ := \.Containers\}\}\{\{println \$id\}\}\{\{end\}\}' \| \\\n\s+LC_ALL=C sed '\/\^\$\/d' \| \\\n\s+LC_ALL=C sort/gu,
    ) ?? []
  ).length,
  2,
  'both exact multi-member readiness networks must discard only Docker formatter empty records before sorting',
);

const pinRecheckNetworkNamespace = extractShellFunction(
  helper,
  'pin_kemerbet_recheck_network_namespace',
  'require_pinned_kemerbet_recheck_network_namespace',
);
const canonicalNetnsIdentityRegex = String.raw`^net:\[[0-9]+\]$`;
const overEscapedNetnsIdentityRegex = String.raw`^net:\\[[0-9]+\\]$`;
assert.equal(
  pinRecheckNetworkNamespace.split(canonicalNetnsIdentityRegex).length - 1,
  2,
  'both newly observed namespace identities must use the executable Linux netns regex',
);
assert.ok(
  pinRecheckNetworkNamespace.includes(String.raw`"$namespace_identity" =~ ^net:\[[0-9]+\]$ &&`) &&
    pinRecheckNetworkNamespace.includes(
      String.raw`"$host_namespace_identity" =~ ^net:\[[0-9]+\]$ &&`,
    ),
  'both observed namespace checks must keep the canonical regex as an unquoted Bash operand',
);
for (const contract of [
  /\.Id.*\.State\.Pid.*\.State\.Running.*\.State\.Paused.*\.HostConfig\.NetworkMode/s,
  /netns_path="\/proc\/\$observed_pid\/ns\/net"/,
  /host_namespace_identity="\$\(readlink -- \/proc\/self\/ns\/net\)"/,
  /"\$namespace_identity" != "\$host_namespace_identity"/,
  /exec \{netns_fd\}<"\$netns_path"/,
  /stat -L --format='%d:%i' "\/proc\/self\/fd\/\$netns_fd"/,
  /readlink -- "\/proc\/self\/fd\/\$netns_fd"/,
  /"\$descriptor_identity" != "\$path_identity"/,
  /"\$descriptor_target" != "\$namespace_identity"/,
  /"\$namespace_identity_after" != "\$namespace_identity"/,
]) {
  assert.match(pinRecheckNetworkNamespace, contract);
}
assert.equal(
  (pinRecheckNetworkNamespace.match(/docker_local container inspect/g) ?? []).length,
  2,
  'the namespace path and held descriptor must be bracketed by exact full-container reinspection',
);

const requirePinnedRecheckNetworkNamespace = extractShellFunction(
  helper,
  'require_pinned_kemerbet_recheck_network_namespace',
  'close_pinned_kemerbet_recheck_network_namespace',
);
assert.equal(
  requirePinnedRecheckNetworkNamespace.split(canonicalNetnsIdentityRegex).length - 1,
  1,
  'the retained namespace identity must use the same executable Linux netns regex',
);
assert.ok(
  requirePinnedRecheckNetworkNamespace.includes(
    String.raw`"$expected_identity" =~ ^net:\[[0-9]+\]$ ]] || return 1`,
  ),
  'the retained namespace check must keep the canonical regex as an unquoted Bash operand',
);
assert.ok(
  !helper.includes(overEscapedNetnsIdentityRegex),
  'the helper must not double-escape bracket literals in unquoted Bash regex operands',
);
if (process.platform === 'linux') {
  const netnsIdentityRegexRegression = spawnSync(
    '/bin/bash',
    [
      '-c',
      String.raw`
set -euo pipefail
identity="$(readlink -- /proc/self/ns/net)"
[[ "$identity" =~ ^net:\[[0-9]+\]$ ]]
for invalid_identity in 'mnt:[123]' 'net:[x]' 'net:\[123\]'; do
  if [[ "$invalid_identity" =~ ^net:\[[0-9]+\]$ ]]; then
    exit 1
  fi
done
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    netnsIdentityRegexRegression.status,
    0,
    `the canonical namespace regex must accept only a real Linux netns identity: ${netnsIdentityRegexRegression.stderr}`,
  );
}
for (const contract of [
  /\/proc\/self\/fd\/\$descriptor/,
  /\.Id.*\.State\.Pid.*\.State\.Running.*\.State\.Paused.*\.HostConfig\.NetworkMode/s,
  /stat -L --format='%d:%i' "\/proc\/\$expected_pid\/ns\/net"/,
  /readlink -- "\/proc\/\$expected_pid\/ns\/net"/,
  /"\$observed_after" == "\$observed_before"/,
  /"\$namespace_identity" == "\$expected_identity"/,
  /"\$descriptor_identity" == "\$path_identity"/,
]) {
  assert.match(requirePinnedRecheckNetworkNamespace, contract);
}

const closePinnedRecheckNetworkNamespace = extractShellFunction(
  helper,
  'close_pinned_kemerbet_recheck_network_namespace',
  'close_all_pinned_kemerbet_recheck_network_namespaces',
);
assert.match(closePinnedRecheckNetworkNamespace, /exec \{descriptor\}<&-/);
assert.match(closePinnedRecheckNetworkNamespace, /! -e "\/proc\/self\/fd\/\$descriptor_number"/);

const namespaceEntryLines = helper.match(/^.*env -i PATH="\$SAFE_PATH" nsenter.*$/gmu) ?? [];
assert.ok(namespaceEntryLines.length >= 6, 'all firewall operations must enter the held namespace');
for (const namespaceEntryLine of namespaceEntryLines) {
  assert.match(namespaceEntryLine, /nsenter --net="\/proc\/self\/fd\/\$netns_fd" --/);
  assert.doesNotMatch(
    namespaceEntryLine,
    /--target|\/proc\/\$(?:observed_pid|expected_pid)\/ns\/net/,
  );
}

const installRecheckFirewall = extractShellFunction(
  helper,
  'install_kemerbet_recheck_network_firewall',
  'require_kemerbet_recheck_network_firewall',
);
for (const contract of [
  /controller\)/,
  /browser\)/,
  /iptables-restore/,
  /ip6tables-restore/,
  /-P OUTPUT DROP/,
  /127\.0\.0\.11\/32 -j REJECT/,
  /KEMERBET_RECHECK_BROWSER_CONTROL_IPV4 --dport 4587 -j ACCEPT/,
  /KEMERBET_RECHECK_PROXY_PROXY_IPV4 --dport 18443 -j ACCEPT/,
  /normalized_kemerbet_recheck_firewall_digest/,
  /KEMERBET_RECHECK_CONTROLLER_FIREWALL_V4_DIGEST/,
  /KEMERBET_RECHECK_BROWSER_FIREWALL_V4_DIGEST/,
]) {
  assert.match(installRecheckFirewall, contract);
}
assert.equal(
  (installRecheckFirewall.match(/^-A .* -j REJECT --reject-with icmp-port-unreachable$/gmu) ?? [])
    .length,
  6,
  'the controller and browser IPv4 restore programs must use six explicit canonical rejects',
);
assert.equal(
  (installRecheckFirewall.match(/^-A .* -j REJECT --reject-with icmp6-port-unreachable$/gmu) ?? [])
    .length,
  2,
  'the shared IPv6 restore program must use two explicit canonical rejects',
);
assert.doesNotMatch(
  installRecheckFirewall,
  /^-A .* -j REJECT$/mu,
  'the firewall installer must not depend on iptables-save canonicalizing a bare REJECT target',
);
assert.match(
  installRecheckFirewall,
  /sed -n '2p'\)" == "-A \$KEMERBET_RECHECK_FIREWALL_CHAIN -d 127\.0\.0\.11\/32 -j REJECT --reject-with icmp-port-unreachable"/u,
  'the IPv4 post-install check must require the exact explicit reject rendering',
);
assert.match(
  installRecheckFirewall,
  /sed -n '\$p'\)" == "-A \$KEMERBET_RECHECK_FIREWALL_CHAIN -j REJECT --reject-with icmp6-port-unreachable"/u,
  'the IPv6 post-install check must require the exact explicit reject rendering',
);
const requireRecheckFirewall = extractShellFunction(
  helper,
  'require_kemerbet_recheck_network_firewall',
  'probe_kemerbet_recheck_denied_network',
);
assert.match(requireRecheckFirewall, /normalized_kemerbet_recheck_firewall_digest/);
assert.match(requireRecheckFirewall, /expected_v4.*expected_v6/s);
assert.match(
  requireRecheckFirewall,
  /normalized_kemerbet_recheck_firewall_digest "\$netns_fd" 4\)" == "\$expected_v4" &&\s+"\$\(normalized_kemerbet_recheck_firewall_digest "\$netns_fd" 6\)" == "\$expected_v6"/u,
  'retained firewall verification must re-check the exact IPv4 and IPv6 normalized digests together',
);
const deniedNetworkProbe = extractShellFunction(
  helper,
  'probe_kemerbet_recheck_denied_network',
  'publish_kemerbet_recheck_firewall_release',
);
for (const contract of [/127\.0\.0\.11/, /1\.1\.1\.1/, /deniedTcp/, /deniedUdp/, /deniedResolve/]) {
  assert.match(deniedNetworkProbe, contract);
}
const firewallRelease = extractShellFunction(
  helper,
  'publish_kemerbet_recheck_firewall_release',
  'wait_for_kemerbet_recheck_service_healthy',
);
for (const contract of [
  /KEMERBET_RECHECK_CONTROLLER_FIREWALL_RELEASE/,
  /KEMERBET_RECHECK_BROWSER_FIREWALL_RELEASE/,
  /0:0:444:1:0/,
  /chmod 0600/,
  /KEMERBET_RECHECK_FIREWALL_RELEASE_CONTENT/,
  /chmod 0444/,
]) {
  assert.match(firewallRelease, contract);
}

const waitForRecheckServiceHealthy =
  /wait_for_kemerbet_recheck_service_healthy\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(waitForRecheckServiceHealthy, 'the helper must define a bounded exact-state health wait');
for (const contract of [
  /SECONDS \+ KEMERBET_RECHECK_SERVICE_READY_TIMEOUT_SECONDS/,
  /\.Id.*\.State\.Status.*\.State\.Running.*\.State\.Paused.*\.State\.OOMKilled.*\.State\.Error.*\.RestartCount.*\.State\.Health/s,
  /\$container_id\|running\|true\|false\|false\|\|0\|healthy/,
  /\$container_id\|running\|true\|false\|false\|\|0\|starting/,
  /\*\) return 1/,
]) {
  assert.match(waitForRecheckServiceHealthy, contract);
}

const recheckTransientsAbsent = extractShellFunction(
  helper,
  'require_kemerbet_recheck_transients_absent',
  'remove_kemerbet_recheck_candidate',
);
for (const contract of [
  /KEMERBET_RECHECK_CONTAINER/,
  /KEMERBET_RECHECK_BROWSER_CONTAINER/,
  /KEMERBET_RECHECK_PROXY_CONTAINER/,
  /KEMERBET_RECHECK_AUTHORIZER_CONTAINER/,
  /KEMERBET_RECHECK_SNAPSHOT_CONTAINER/,
  /KEMERBET_RECHECK_SNAPSHOT_VERIFY_CONTAINER/,
  /KEMERBET_RECHECK_ORIGINAL_VERIFY_CONTAINER/,
  /KEMERBET_RECHECK_CONTROL_NETWORK/,
  /KEMERBET_RECHECK_PROXY_NETWORK/,
  /KEMERBET_RECHECK_EGRESS_NETWORK/,
  /KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME/,
  /KEMERBET_RECHECK_RPC_ROOT/,
]) {
  assert.match(recheckTransientsAbsent, contract);
}

const recheckCleanup = /kemerbet_recheck_cleanup_trap\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
assert.ok(recheckCleanup, 'The helper must define terminal cleanup for the one-shot recheck.');
assertInOrder(
  recheckCleanup,
  [
    'close_all_pinned_kemerbet_recheck_network_namespaces',
    'remove_kemerbet_recheck_container',
    'print_kemerbet_recheck_fixed_failure_stages',
    'remove_kemerbet_recheck_profile_snapshot_volume',
    'remove_kemerbet_recheck_network',
    'remove_kemerbet_recheck_rpc_capabilities',
    'remove_exact_kemerbet_session_provision',
    "kemerbet_profile_volume_holders_match ''",
    'remove_owned_kemerbet_recheck_receipt_root',
    'rollback_kemerbet_recheck_final_binding',
    'remove_kemerbet_recheck_candidate',
    'consume_exact_one_use_kemerbet_file',
    'repair_kemerbet_identity_key_readability',
    'restore_retryable_owner_staged_kemerbet_cohort',
    'remove_owned_kemerbet_recheck_promotion_root',
  ],
  'catchable cleanup must destroy the partial snapshot and all seven containers, three networks, RPC secrets, and durable intermediates in fail-closed order',
);
for (const contract of [
  /trap - EXIT/,
  /trap '' INT TERM HUP/,
  /local containers_quiesced='false'/,
  /"\$original_status" -ne 0/,
  /"\$containers_quiesced" == 'true'/,
  /print_kemerbet_recheck_fixed_failure_stages \|\|/,
  /KemerBet readiness fixed stage output is unavailable\./,
  /close_all_pinned_kemerbet_recheck_network_namespaces \|\| cleanup_status=1/,
  /if remove_kemerbet_recheck_container; then[\s\S]*?containers_quiesced='true'[\s\S]*?else[\s\S]*?cleanup_status=1[\s\S]*?fi/,
  /remove_kemerbet_recheck_profile_snapshot_volume \|\| cleanup_status=1/,
  /remove_kemerbet_recheck_network \|\| cleanup_status=1/,
  /remove_kemerbet_recheck_rpc_capabilities \|\| cleanup_status=1/,
  /original_status" -eq 0 && "\$cleanup_status" -ne 0/,
  /exit "\$original_status"/,
]) {
  assert.match(recheckCleanup, contract);
}
assert.doesNotMatch(
  recheckCleanup,
  /\bdie\b|container logs/,
  'the EXIT trap must accumulate cleanup failures without invoking an exiting helper or exposing logs',
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
  /require_kemerbet_v3_binding_content "\$KEMERBET_AGENT_IDENTITY_BINDINGS"/,
  /agent_profile_pin/,
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
  /require_kemerbet_recheck_transients_absent/,
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
assertInOrder(
  stopKemerbetSession,
  [
    'recover_kemerbet_recheck_before_teardown',
    'inspect_kemerbet_v2_v3_successor_gate',
    'case "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" in',
    'successor-installed|successor-completed)',
    'require_kemerbet_v3_runtime_bridge',
    'session_stop_successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'session_stop_successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'session_stop_successor_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"',
    'session_stop_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"',
    '"$session_container" kemerbet-session-provision "$commit_sha"',
    'container stop --time 70',
    'require_exact_fresh_bot_runtime "$commit_sha" published-steady-state',
    'if [[ -n "$session_stop_successor_state" ]]; then',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$session_stop_successor_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$session_stop_successor_release"',
    '"$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$session_stop_successor_helper_sha"',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == \'active\'',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$session_stop_bridge_release"',
  ],
  'session stop must preserve the historical overlay and active runtime bridge while proving the removed session belongs to the current application release',
);
assert.equal(
  (stopKemerbetSession.match(/require_exact_current_component_container/g) ?? []).length,
  1,
  'session stop must prove the exact current session container before removal',
);

if (process.platform === 'linux' || process.platform === 'win32') {
  const bashExecutable =
    process.platform === 'win32'
      ? resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : '/bin/bash';
  const release = 'de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3';
  const stopSessionHarness = [
    'set -euo pipefail',
    `EXPECTED_RELEASE='${release}'`,
    'set -- stop-kemerbet-session-provision "$EXPECTED_RELEASE"',
    "PROJECT_NAME='fetanagent-staging-beta'",
    "KEMERBET_TEARDOWN_RECOVERY_FAILED='false'",
    "KEMERBET_V2_V3_SUCCESSOR_GATE_STATE=''",
    "KEMERBET_V2_V3_SUCCESSOR_RELEASE=''",
    "KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256=''",
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE=''",
    "KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE=''",
    "OVERLAY_INSPECTION_COUNT='0'",
    "TRACE=''",
    'trap \'printf "__TRACE__%s" "$TRACE"\' EXIT',
    'die() { return 1; }',
    'recover_kemerbet_recheck_before_teardown() { TRACE="${TRACE}R"; }',
    'require_kemerbet_teardown_recovery_success() { TRACE="${TRACE}Q"; }',
    'inspect_kemerbet_v2_v3_successor_gate() { TRACE="${TRACE}O"; OVERLAY_INSPECTION_COUNT="$((OVERLAY_INSPECTION_COUNT + 1))"; if [[ "$OVERLAY_INSPECTION_COUNT" == 1 ]]; then KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$INITIAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$INITIAL_OVERLAY_RELEASE"; KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$INITIAL_HELPER_SHA"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="$INITIAL_BRIDGE_STATE"; KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE="$INITIAL_BRIDGE_RELEASE"; else KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="$FINAL_OVERLAY_STATE"; KEMERBET_V2_V3_SUCCESSOR_RELEASE="$FINAL_OVERLAY_RELEASE"; KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$FINAL_HELPER_SHA"; KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE="$FINAL_BRIDGE_STATE"; KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE="$FINAL_BRIDGE_RELEASE"; fi; }',
    'require_kemerbet_v3_runtime_bridge() { TRACE="${TRACE}B"; [[ "$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == active ]]; }',
    'docker_local() {',
    '  if [[ "$1" == container && "$2" == ls ]]; then',
    '    printf "%s" "aaaaaaaaaaaa"',
    '  elif [[ "$1" == container && "$2" == stop ]]; then',
    '    TRACE="${TRACE}S"',
    '  elif [[ "$1" == container && "$2" == rm ]]; then',
    '    TRACE="${TRACE}M"',
    '  else',
    '    return 96',
    '  fi',
    '}',
    'require_exact_current_component_container() { TRACE="${TRACE}P"; [[ "$TARGET_STATE" == exact ]]; }',
    'require_exact_fresh_bot_runtime() { TRACE="${TRACE}X"; [[ "$RUNTIME_STATE" == exact ]]; }',
    stopKemerbetSession,
  ].join('\n');
  for (const [
    name,
    initialState,
    initialRelease,
    finalState,
    finalRelease,
    initialHelperSha,
    finalHelperSha,
    initialBridgeState,
    finalBridgeState,
    initialBridgeRelease,
    finalBridgeRelease,
    targetState,
    runtimeState,
    expectedStatus,
    mutationExpected,
  ] of [
    [
      'installed current-release session stop',
      'successor-installed',
      '1'.repeat(40),
      'successor-installed',
      '1'.repeat(40),
      '2'.repeat(64),
      '2'.repeat(64),
      'active',
      'active',
      '3'.repeat(40),
      '3'.repeat(40),
      'exact',
      'exact',
      0,
      true,
    ],
    [
      'completed historical-release session stop',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '1'.repeat(40),
      '2'.repeat(64),
      '2'.repeat(64),
      'active',
      'active',
      '3'.repeat(40),
      '3'.repeat(40),
      'exact',
      'exact',
      0,
      true,
    ],
    [
      'future application release remains independent from historical overlay',
      'successor-installed',
      '1'.repeat(40),
      'successor-installed',
      '1'.repeat(40),
      '2'.repeat(64),
      '2'.repeat(64),
      'active',
      'active',
      '3'.repeat(40),
      '3'.repeat(40),
      'exact',
      'exact',
      0,
      true,
    ],
    [
      'missing runtime bridge',
      'successor-installed',
      '1'.repeat(40),
      'successor-installed',
      '1'.repeat(40),
      '2'.repeat(64),
      '2'.repeat(64),
      'absent',
      'absent',
      '',
      '',
      'exact',
      'exact',
      1,
      false,
    ],
    [
      'foreign session target release',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '1'.repeat(40),
      '2'.repeat(64),
      '2'.repeat(64),
      'active',
      'active',
      '3'.repeat(40),
      '3'.repeat(40),
      'invalid',
      'exact',
      1,
      false,
    ],
    [
      'changed completed session-stop overlay',
      'successor-completed',
      '1'.repeat(40),
      'successor-completed',
      '2'.repeat(40),
      '2'.repeat(64),
      '2'.repeat(64),
      'active',
      'active',
      '3'.repeat(40),
      '3'.repeat(40),
      'exact',
      'exact',
      1,
      true,
    ],
  ]) {
    const result = spawnSync(bashExecutable, ['-s'], {
      encoding: 'utf8',
      input: stopSessionHarness,
      env: {
        PATH: process.env.PATH,
        INITIAL_OVERLAY_STATE: initialState,
        INITIAL_OVERLAY_RELEASE: initialRelease,
        FINAL_OVERLAY_STATE: finalState,
        FINAL_OVERLAY_RELEASE: finalRelease,
        INITIAL_HELPER_SHA: initialHelperSha,
        FINAL_HELPER_SHA: finalHelperSha,
        INITIAL_BRIDGE_STATE: initialBridgeState,
        FINAL_BRIDGE_STATE: finalBridgeState,
        INITIAL_BRIDGE_RELEASE: initialBridgeRelease,
        FINAL_BRIDGE_RELEASE: finalBridgeRelease,
        TARGET_STATE: targetState,
        RUNTIME_STATE: runtimeState,
      },
    });
    assert.equal(
      result.status === 0 ? 0 : 1,
      expectedStatus,
      `${name} fixture returned ${result.status}: ${result.stderr}`,
    );
    assert.equal(
      result.stdout.includes('M'),
      mutationExpected,
      `${name} fixture mutation trace was ${result.stdout}`,
    );
    if (mutationExpected) {
      assert.match(
        result.stdout,
        /P.*S.*M.*X/u,
        `${name} must prove the current session before stopping it and re-attest the remaining runtime`,
      );
    }
  }
}

const startPublicEdge =
  /\n  start-public-edge\|start-fresh-public-edge\)([\s\S]*?)\n    ;;\n\n  stop-public-edge\)/u.exec(
    helper,
  )?.[1];
assert.ok(startPublicEdge, 'The helper must define the public-edge startup boundary.');
assertRuntimeBridgePostcondition(
  startPublicEdge,
  'up -d --no-build --wait --wait-timeout 90 gateway',
  [],
  ['require_exact_fresh_bot_runtime "$commit_sha" published-steady-state'],
  'public_edge',
  'fresh public-edge startup',
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
assertInOrder(
  stopPublicEdge,
  [
    'recover_kemerbet_recheck_before_teardown',
    'inspect_kemerbet_v2_v3_successor_gate',
    'if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == \'absent\' ]]; then',
    'inspect_kemerbet_v1_retirement_gate',
    'else',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" =~ ^(successor-installed|successor-completed)$',
    'require_kemerbet_v3_runtime_bridge',
    "successor_component_stop='true'",
    'successor_component_stop_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'successor_component_stop_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'successor_component_stop_helper_sha="$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256"',
    'successor_component_stop_bridge_release="$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE"',
    'container rm --force',
    'if [[ "$successor_component_stop" == \'true\' ]]; then',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_component_stop_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_component_stop_release"',
    '"$KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256" == "$successor_component_stop_helper_sha"',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_STATE" == \'active\'',
    '"$KEMERBET_V2_V3_RUNTIME_BRIDGE_RELEASE" == "$successor_component_stop_bridge_release"',
  ],
  'public-edge stop must use successor-native control flow and preserve the exact historical overlay and active runtime bridge',
);
assert.equal(
  (stopPublicEdge.match(/inspect_kemerbet_v1_retirement_gate/g) ?? []).length,
  1,
  'public-edge stop may inspect historical v1 state only in the explicit successor-absent branch',
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
assertRuntimeBridgePostcondition(
  botReady,
  'record_fresh_bot_startup_receipt "$2"',
  ['require_exact_fresh_bot_runtime "$2" steady-state'],
  [],
  'bot_ready',
  'Telegram readiness',
);
const botRuntimeCalls = [
  ...helper.matchAll(
    /require_exact_fresh_bot_runtime "(\$(?:commit_sha|2))" (immediate-startup|steady-state)/gu,
  ),
].map((match) => `${match[1]} ${match[2]}`);
assert.deepEqual(botRuntimeCalls, [
  '$commit_sha immediate-startup',
  '$commit_sha steady-state',
  '$commit_sha steady-state',
  '$commit_sha immediate-startup',
  '$commit_sha immediate-startup',
  '$2 immediate-startup',
  '$2 steady-state',
  '$commit_sha steady-state',
]);

const ownerDiagnostic = /\n  diagnose-owner-startup\)([\s\S]*?)\n\s*;;/u.exec(helper)?.[1];
assert.ok(ownerDiagnostic, 'The helper must define bounded Owner-control startup diagnostics.');
assert.match(ownerDiagnostic, /com\.docker\.compose\.project=\$PROJECT_NAME/);
assert.match(ownerDiagnostic, /com\.docker\.compose\.service=owner-control/);
assert.match(ownerDiagnostic, /org\.opencontainers\.image\.revision/);
assert.match(ownerDiagnostic, /container logs --tail 80/);
assert.doesNotMatch(ownerDiagnostic, /inspect .*\{\{json \.Config\}\}|container logs .*bot/);

assert.equal(
  actualReviewedHelperSuccessorSha,
  reviewedV3RecheckBridgeHelperV13Sha,
  'the reviewed helper LF bytes must remain frozen at the exact release-bound H13 recheck-bridge successor pin',
);
assert.equal(
  actualReviewedV3RuntimeBridgeParserScopeRepairV12Sha,
  reviewedV3RuntimeBridgeParserScopeRepairV12Sha,
  'the reviewed H12 parser-scope repair LF bytes must remain frozen at its exact pin',
);
assert.equal(
  actualReviewedV3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecoverySha,
  reviewedV3RuntimeBridgeHelperPromotionV11EmptyCheckpointRecoverySha,
  'the reviewed H11 empty-checkpoint recovery LF bytes must remain frozen at its exact pin',
);
assert.equal(
  actualReviewedV3RecheckBridgeV13Sha,
  reviewedV3RecheckBridgeV13Sha,
  'the reviewed H13 exact-five recheck-bridge installer LF bytes must remain frozen at its exact pin',
);
assert.notEqual(
  reviewedV3RuntimeBridgeHelperV11Sha,
  reviewedV3HelperRotationV10SuccessorSha,
  'the H11 bridge parser cannot be represented by the historical H10 helper bytes',
);
assert.notEqual(
  reviewedV3RuntimeBridgeParserScopeRepairHelperV12Sha,
  reviewedV3RuntimeBridgeHelperV11Sha,
  'the corrected H12 parser cannot be represented by the known-broken H11 helper bytes',
);
assert.notEqual(
  reviewedV3RecheckBridgeHelperV13Sha,
  reviewedV3RuntimeBridgeParserScopeRepairHelperV12Sha,
  'the H13 release-bound recheck helper cannot be represented by the H12 parser-repair bytes',
);
assert.match(helperReplacementRunbook, new RegExp(historicalReviewedHelperSuccessorSha, 'gu'));

console.log(
  'staging deploy workflow verified: manual exact-target guards, read-only exact-IP ban gate, sealed images, bounded runtime credentials, checksummed root helper, provenance-bound one-shot KemerBet recheck, and explicit stop path',
);
