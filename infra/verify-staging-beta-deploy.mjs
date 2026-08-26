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
const v2V3SuccessorMigration = readFileSync(
  resolve(root, 'infra/operations/fetanagent-kemerbet-v2-v3-successor-migration.sh'),
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
  'e94dfdcfe90ff6021446fc66e2850ae13198b03d9e2210f454181ab00177f97d';
const actualReviewedHelperSuccessorSha = createHash('sha256')
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

function extractShellFunction(source, name, nextName) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf(`\n}\n\n${nextName}() {`, start);
  assert.ok(start >= 0 && end > start, `missing shell function boundary: ${name}`);
  return source.slice(start, end + 2);
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
  /hashlib\.sha256\(helper_data\)\.hexdigest\(\) != successor_helper_sha/u,
  /require_v3_binding\(binding, \(10001, 10001\), 0o600\)/u,
  /os\.path\.lexists\(committed_binding\)[\s\S]*?os\.path\.lexists\(os\.path\.dirname\(recheck_receipt\)\)[\s\S]*?os\.path\.lexists\(owner_completion\)[\s\S]*?os\.path\.lexists\(candidate_root\)[\s\S]*?os\.path\.lexists\(rpc_root\)/u,
  /gate_state = 'successor-installed'/u,
  /require_v3_binding\(committed_binding, \(0, 0\), 0o444\)/u,
  /exact_directory\(os\.path\.dirname\(recheck_receipt\), 0o700, \['ready-v1'\]\)/u,
  /identity_key_owner_mode != \(0, 0, 0o444\)/u,
  /selector_data = exact_file\(selector_contract, \(0, 0\), 0o444, 1024 \* 1024\)/u,
  /receipt_lines\[1\] != f'release=\{successor\}'/u,
  /receipt_lines\[2\] != f'binding_sha256=\{v3_sha\}'/u,
  /identity_hmac_key_sha256=\{hashlib\.sha256\(identity_key_data\)\.hexdigest\(\)\}/u,
  /selector_sha256=\{hashlib\.sha256\(selector_data\)\.hexdigest\(\)\}/u,
  /exact_directory\([\s\S]*?os\.path\.dirname\(owner_completion\)[\s\S]*?0o755[\s\S]*?os\.path\.basename\(owner_completion\)/u,
  /exact_file\(owner_completion, \(0, 10001\), 0o440, 37, 37\)/u,
  /hashlib\.sha256\(owner_completion_data\)\.hexdigest\(\) !=\s+retirement_intent\[9\]\.split\('=', 1\)\[1\]/u,
  /for consumed_or_transient in \([\s\S]*?binding,[\s\S]*?readiness_player_ids,[\s\S]*?candidate_root,[\s\S]*?promotion_root,[\s\S]*?rpc_root,[\s\S]*?\)/u,
  /gate_state = 'successor-recheck-recoverable'/u,
  /gate_state = 'successor-completed'/u,
  /sys\.stdout\.write\(successor \+ '\\n' \+ successor_helper_sha \+ '\\n' \+ gate_state \+ '\\n'\)/u,
  /\^\(successor-installed\|successor-recheck-recoverable\|successor-completed\)\$/u,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE="\$\{inspection_lines\[2\]\}"/u,
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
  /successor_completion/u,
  /contract=fetanagent-kemerbet-v2-v3-successor-recheck-v1/u,
  /successor-commit-prefix/u,
]) {
  assert.doesNotMatch(
    helper,
    forbiddenSuccessorCompletionMarker,
    'terminal v3 completion must be derived from existing durable artifacts without a fifth overlay marker',
  );
}
const enforceV2V3SuccessorGate = extractShellFunction(
  helper,
  'enforce_kemerbet_v2_v3_successor_gate',
  'consume_exact_one_use_kemerbet_file',
);
for (const successorGateEnforcementContract of [
  /if \[\[ "\$command" == 'verify' \]\]; then\s+return 0\s+fi/u,
  /inspect_kemerbet_v2_v3_successor_gate/,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed'/u,
  /retire-kemerbet-readiness-binding-v1-for-v2-reseal\|reinstall-kemerbet-v1-retirement-secrets\|seal-kemerbet-readiness\|kemerbet-v1-retirement-recovery-ready/u,
  /permanently forbids legacy v1\/v2 reseal or recovery commands/u,
  /recheck-kemerbet-readiness\)[\s\S]*?"\$release" == "\$KEMERBET_V2_V3_SUCCESSOR_RELEASE"/u,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-recheck-recoverable'/u,
  /an interrupted KemerBet v3 recheck permits only exact-release recovery/u,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed'/,
  /incomplete or invalid KemerBet v2-to-v3 successor migration blocks staging mutations/u,
  /stop\|expiry-stop\|stop-public-edge/u,
  /stop-bot\|stop-kemerbet-session-provision/u,
  /the KemerBet v3 successor stop command belongs to another reviewed release/u,
  /network-ready\)\s+return 0/u,
  /install\|fresh-start\|fresh-host-ready\|arm-expiry-stop\|bot-disabled-ready\|install-bot-token\|start-bot\|bot-ready\|fresh-public-edge-ready\|start-fresh-public-edge\|diagnose-owner-startup\|discard\|stop-bot\|start-kemerbet-session-provision\|kemerbet-session-provision-ready\|stop-kemerbet-session-provision\|recheck-kemerbet-readiness\|kemerbet-v3-successor-ready/u,
  /"\$release" == "\$KEMERBET_V2_V3_SUCCESSOR_RELEASE"/u,
  /permits only no-transfer deployment, private sign-in, and readiness recheck/u,
]) {
  assert.match(enforceV2V3SuccessorGate, successorGateEnforcementContract);
}
const successorInstalledCommandAllowlist =
  /install\|fresh-start\|fresh-host-ready\|arm-expiry-stop\|bot-disabled-ready\|install-bot-token\|start-bot\|bot-ready\|fresh-public-edge-ready\|start-fresh-public-edge\|diagnose-owner-startup\|discard\|stop-bot\|start-kemerbet-session-provision\|kemerbet-session-provision-ready\|stop-kemerbet-session-provision\|recheck-kemerbet-readiness\|kemerbet-v3-successor-ready/u.exec(
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
const v3SuccessorInstallBoundary = extractShellFunction(
  helper,
  'require_kemerbet_v3_successor_install_boundary',
  'require_fresh_host_identity',
);
for (const installBoundaryContract of [
  /inspect_kemerbet_v2_v3_successor_gate/u,
  /KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed'/u,
  /KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "\$commit_sha"/u,
  /require_kemerbet_v1_retirement_expiry_guard_disarmed/u,
  /! -e "\$BOT_STARTUP_RECEIPT" && ! -L "\$BOT_STARTUP_RECEIPT"/u,
  /! -e "\$BOT_STARTUP_RECEIPT_ROOT" && ! -L "\$BOT_STARTUP_RECEIPT_ROOT"/u,
  /container ls --all --quiet/u,
  /network ls --quiet/u,
  /require_kemerbet_recheck_transients_absent/u,
  /volume ls --quiet/u,
  /KEMERBET_PROFILE_VOLUME/u,
  /KEMERBET_SESSION_CONTROL_VOLUME/u,
  /require_kemerbet_profile_volume_holders ''/u,
  /resolve_kemerbet_session_control_volume_offline_mountpoint/u,
  /--filter "volume=\$KEMERBET_SESSION_CONTROL_VOLUME"/u,
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
    'require_kemerbet_v1_retirement_expiry_guard_disarmed',
    'containers=',
    '[[ -z "$containers" ]]',
    'networks=',
    '[[ -z "$networks" ]]',
    'require_kemerbet_recheck_transients_absent',
    'project_volumes=',
    '[[ "$project_volumes" == "$expected_volumes" ]]',
    'require_kemerbet_profile_volume_holders',
    '[[ -z "$session_holders" ]]',
    'inspect_kemerbet_v2_v3_successor_gate',
  ],
  'successor installation must prove the complete stopped holder-free boundary before re-attesting it',
);
assert.doesNotMatch(
  v3SuccessorInstallBoundary,
  /^[ \t]*(?:rm|mv|install|cp|truncate|tee)\s+|docker_local (?:container|network|volume) (?:rm|create)\b|compose_command|docker_local compose|docker --host/imu,
  'the successor install preflight must remain read-only and fail closed',
);
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

const installRelease = /\n  install\)([\s\S]*?)\n    ;;\n\n  start\|fresh-start\)/u.exec(
  helper,
)?.[1];
assert.ok(installRelease, 'The helper must define the sealed release installation boundary.');
assertInOrder(
  installRelease,
  [
    'validate_commit_and_tag "$commit_sha" "$image_tag"',
    `if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' ]]; then`,
    'require_kemerbet_v3_successor_install_boundary "$commit_sha"',
    'expected_files=',
    'install -d -o root -g root -m 0755 "$release/infra" "$SECRET_ROOT"',
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

function assertSuccessorInstalledPostcondition(
  commandCase,
  mutationFragment,
  preGateContract,
  insideGateContract,
  releaseReference,
  label,
) {
  assertInOrder(
    commandCase,
    [
      mutationFragment,
      ...preGateContract,
      `if [[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' ]]; then`,
      ...insideGateContract,
      'inspect_kemerbet_v2_v3_successor_gate',
      `[[ "$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' &&`,
      `"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "${releaseReference}" ]]`,
    ],
    `${label} must re-attest the same-release installed successor after its mutation`,
  );
}

assertSuccessorInstalledPostcondition(
  installRelease,
  'rm -rf -- "$incoming"',
  [],
  [],
  '$commit_sha',
  'release installation',
);
assertSuccessorInstalledPostcondition(
  startOrFreshStart,
  'require_owner_kemerbet_receipt_service_access',
  [],
  ['require_exact_fresh_private_runtime "$commit_sha"'],
  '$commit_sha',
  'private-core startup',
);
assertSuccessorInstalledPostcondition(
  installBotToken,
  'rm -f -- "$incoming"',
  ['require_service_file "$SECRET_ROOT/bot-token"'],
  [],
  '$commit_sha',
  'Telegram token installation',
);
assertSuccessorInstalledPostcondition(
  startBot,
  'up -d --no-build --no-deps bot',
  [],
  ['require_exact_fresh_bot_runtime "$commit_sha" immediate-startup'],
  '$commit_sha',
  'Telegram startup',
);

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
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$commit_sha"',
    "successor_component_stop='true'",
    'clear_bot_startup_receipt',
    'if [[ "$successor_component_stop" == \'true\' ]]; then',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_component_stop_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_component_stop_release"',
  ],
  'bot stop must use successor-native control flow and preserve the exact same-release durable overlay',
);
assert.equal(
  (stopBot.match(/inspect_kemerbet_v1_retirement_gate/g) ?? []).length,
  1,
  'bot stop may inspect historical v1 state only in the explicit successor-absent branch',
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
assert.match(startKemerbetSession, /prepare_retryable_kemerbet_session_player_ids/);
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
assertInOrder(
  startKemerbetSession,
  [
    'require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"',
    'prepare_retryable_kemerbet_session_player_ids',
    'require_service_file "$KEMERBET_READINESS_PLAYER_IDS"',
    'require_immutable_config_file "$KEMERBET_SELECTOR_CONTRACT"',
    'up -d --no-build --no-deps --wait --wait-timeout 90 kemerbet-session-provision',
  ],
  'private sign-in must rebuild only an exact retry service copy before the existing no-transfer runtime starts',
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
  /KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "\$commit_sha"/,
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
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$commit_sha"',
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
  2,
  'the retry-only service-copy helper must be defined once and invoked only by private sign-in start',
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
  /recover_incomplete_kemerbet_recheck_promotion_guarded\s+inspect_kemerbet_v2_v3_successor_gate\s+if \[\[ -e "\$KEMERBET_RECHECK_RECEIPT_ROOT" \|\| -L "\$KEMERBET_RECHECK_RECEIPT_ROOT" \]\]; then[\s\S]*?require_completed_kemerbet_recheck_for_release "\$commit_sha" "\$image_tag"[\s\S]*?KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed'[\s\S]*?KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "\$commit_sha"/u,
  'guarded recovery must refresh the successor state before accepting an idempotent completed receipt',
);
assert.match(
  recheckKemerbetReadiness,
  /if \[\[ -e "\$KEMERBET_V1_RETIREMENT_ROOT" \|\| -L "\$KEMERBET_V1_RETIREMENT_ROOT" \]\]; then\s+if \[\[ "\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'absent' \]\]; then\s+finalize_kemerbet_v1_retirement_after_v2_seal "\$commit_sha"[\s\S]*?else\s+\[\[ "\$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-installed' &&\s+"\$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "\$commit_sha" \]\]/u,
  'the legacy v2 finalizer must run only without a successor overlay; v3 must use the exact migrated installed state',
);
assert.match(
  recheckKemerbetReadiness,
  /remove_owned_kemerbet_recheck_promotion_root[\s\S]*?require_completed_kemerbet_recheck_for_release "\$commit_sha" "\$image_tag"\s+inspect_kemerbet_v2_v3_successor_gate[\s\S]*?KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == 'successor-completed'[\s\S]*?KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "\$commit_sha"/u,
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
  8,
  'the stable v3 binding attestor must be defined once and used by all seven operational binding boundaries',
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
  'require_kemerbet_recheck_runtime_artifacts',
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
]) {
  assert.match(strictProfileSnapshotVerify, contract);
}
assert.doesNotMatch(
  strictProfileSnapshotVerify,
  /verify-original|KEMERBET_PROFILE_VOLUME/,
  'completed-snapshot verification must stay strict and must never inspect the mutable original profile',
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
  /kemerbet_recheck_original_profile_volume_holders_match "\$container_id"/,
  /require_kemerbet_profile_volume_holders ''/,
  /require_kemerbet_recheck_profile_manifest_contract "\$account_id"/,
]) {
  assert.match(originalProfileVerify, contract);
}
assert.doesNotMatch(
  originalProfileVerify,
  /KEMERBET_RECHECK_PROFILE_SNAPSHOT_VOLUME|profile-snapshot-verify-v1|container logs|network connect/,
  'original-profile verification must have a distinct identity and never receive the disposable snapshot',
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
const requireRecheckFirewall = extractShellFunction(
  helper,
  'require_kemerbet_recheck_network_firewall',
  'probe_kemerbet_recheck_denied_network',
);
assert.match(requireRecheckFirewall, /normalized_kemerbet_recheck_firewall_digest/);
assert.match(requireRecheckFirewall, /expected_v4.*expected_v6/s);
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
  /close_all_pinned_kemerbet_recheck_network_namespaces \|\| cleanup_status=1/,
  /remove_kemerbet_recheck_container \|\| cleanup_status=1/,
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
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$commit_sha"',
    'session_stop_successor_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'session_stop_successor_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'container stop --time 70',
    'require_exact_fresh_bot_runtime "$commit_sha" published-steady-state',
    'if [[ -n "$session_stop_successor_state" ]]; then',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$session_stop_successor_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$session_stop_successor_release"',
  ],
  'session stop must preserve the exact installed-or-completed successor after recovery and teardown',
);

const startPublicEdge =
  /\n  start-public-edge\|start-fresh-public-edge\)([\s\S]*?)\n    ;;\n\n  stop-public-edge\)/u.exec(
    helper,
  )?.[1];
assert.ok(startPublicEdge, 'The helper must define the public-edge startup boundary.');
assertSuccessorInstalledPostcondition(
  startPublicEdge,
  'up -d --no-build --wait --wait-timeout 90 gateway',
  [],
  ['require_exact_fresh_bot_runtime "$commit_sha" published-steady-state'],
  '$commit_sha',
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
    "successor_component_stop='true'",
    'successor_component_stop_release="$KEMERBET_V2_V3_SUCCESSOR_RELEASE"',
    'successor_component_stop_state="$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE"',
    'container rm --force',
    'if [[ "$successor_component_stop" == \'true\' ]]; then',
    'inspect_kemerbet_v2_v3_successor_gate',
    '"$KEMERBET_V2_V3_SUCCESSOR_GATE_STATE" == "$successor_component_stop_state"',
    '"$KEMERBET_V2_V3_SUCCESSOR_RELEASE" == "$successor_component_stop_release"',
  ],
  'public-edge stop must use successor-native control flow and preserve the exact durable overlay',
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
assertSuccessorInstalledPostcondition(
  botReady,
  'record_fresh_bot_startup_receipt "$2"',
  ['require_exact_fresh_bot_runtime "$2" steady-state'],
  [],
  '$2',
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
  reviewedV3HelperSuccessorSha,
  'the reviewed helper LF bytes must remain frozen at the exact successor pin',
);
assert.match(helperReplacementRunbook, new RegExp(historicalReviewedHelperSuccessorSha, 'gu'));

console.log(
  'staging deploy workflow verified: manual exact-target guards, read-only exact-IP ban gate, sealed images, bounded runtime credentials, checksummed root helper, provenance-bound one-shot KemerBet recheck, and explicit stop path',
);
