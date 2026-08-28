import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const helperPath = resolve(root, 'infra/operations/fetanagent-staging-deploy-helper.sh');
const installerPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14.sh',
);
const workflowPath = resolve(root, '.github/workflows/staging-kemerbet-session-provision.yml');
const runbookPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14.md',
);

const helper = readFileSync(helperPath, 'utf8').replaceAll('\r\n', '\n');
const installer = readFileSync(installerPath, 'utf8').replaceAll('\r\n', '\n');
const workflow = readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n');
const runbook = readFileSync(runbookPath, 'utf8').replaceAll('\r\n', '\n');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const authorization =
  'CONFIRM KEMERBET QUARANTINE RECOVERY: deploy the fail-closed recovery, retire the quarantined KemerBet profile and stale one-use v3 binding, prepare one new security-recovery profile and one new exact-five cohort, then—after I sign in through the private preview—run one find-only recheck. Amount and Transfer stay disabled; no money moves.';
const authorizationSha256 = createHash('sha256').update(authorization, 'utf8').digest('hex');
assert.equal(
  authorizationSha256,
  '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874',
);

const helperSha256 = createHash('sha256').update(helper, 'utf8').digest('hex');
assert.match(
  installer,
  new RegExp(`readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${helperSha256}'`),
  'the H14 installer must pin the exact LF-normalized reviewed helper',
);
assert.match(installer, new RegExp(`readonly AUTHORIZATION_SHA256='${authorizationSha256}'`));
assert.match(installer, /readonly PREDECESSOR_RELEASE='306818ca812bd2abce8479396c4eea8383ea00f9'/);
assert.match(
  installer,
  /readonly PREDECESSOR_HELPER_SHA256='3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa'/,
);
assert.match(installer, /run_helper_direct kemerbet-v3-recheck-bridge-ready/);
assert.match(
  installer,
  /run_helper_direct kemerbet-session-provision-ready "\$PREDECESSOR_RELEASE"/,
);
assert.doesNotMatch(installer, /kemerbet-session-provision-ready "\$RECOVERY_RELEASE"/);
assert.match(
  installer,
  /require_recovery_container_contract "\$OWNER_CONTAINER_ID" owner-control "\$PREDECESSOR_RELEASE"/,
);
assert.match(
  installer,
  /require_recovery_container_contract "\$COORDINATOR_CONTAINER_ID" kemerbet-session-provision "\$PREDECESSOR_RELEASE"/,
);
assert.doesNotMatch(
  installer,
  /require_recovery_container_contract[^\n]*"\$RECOVERY_RELEASE"/,
  'the live coordinator and Owner must be attested against the exact H13 runtime, never H14',
);
assert.match(installer, /financial_actions_mode=dry_run/);
assert.match(installer, /kemerbet_executor_enabled=false/);
assert.match(installer, /kemerbet_final_action_enabled=false/);
assert.match(installer, /transfer_enabled=false/);
assert.match(installer, /amount_entry_enabled=false/);
assert.match(installer, /lookup_authorized=false/);
assert.match(installer, /recheck_authorized=false/);
const financialGateCheck = installer.slice(
  installer.indexOf('has_enabled_financial_gate() {'),
  installer.indexOf('\n\nrequire_financial_gates_disabled() {'),
);
assert.match(
  financialGateCheck,
  /\[\[ "\$entry" == 'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \]\] && continue/,
  'only the exact no-transfer readiness seal safety flag may be excluded from the broad financial-gate scan',
);
assert.match(
  financialGateCheck,
  /FINANCIAL_ACTIONS_MODE=dry_run\) continue[\s\S]*?FINANCIAL_ACTIONS_MODE=\*\) return 0/,
  'every declared financial mode except exact dry_run must fail closed',
);
assert.match(
  financialGateCheck,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED\|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED/,
  'the broad scan must include both known runtime and live-deposit pilot gates',
);
assert.match(
  financialGateCheck,
  /status=\$\?\s+\[\[ "\$status" -eq 1 \]\] \|\| return 0/,
  'a gate-scanner error must fail closed',
);
assert.equal(
  (installer.match(/\bhas_enabled_financial_gate\b/g) ?? []).length,
  3,
  'both the global and exact-container financial checks must use the same narrow allowlist',
);
for (const [environment, expectedEnabledGate, description] of [
  [
    [
      'FINANCIAL_ACTIONS_MODE=dry_run',
      'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true',
      'KEMERBET_EXECUTOR_ENABLED=false',
      'KEMERBET_FINAL_ACTION_ENABLED=false',
      'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false',
      'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false',
    ].join('\n'),
    false,
    'the exact no-transfer readiness seal is a safety gate, not a money-moving gate',
  ],
  [
    'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=TRUE',
    true,
    'the allowlist is byte-exact and rejects alternate spellings',
  ],
  [
    'KEMERBET_NO_TRANSFER_READINESS_ENABLED=true',
    true,
    'a similarly named flag is not implicitly allowlisted',
  ],
  ['KEMERBET_EXECUTOR_ENABLED=1', true, 'executor enablement remains rejected'],
  ['KEMERBET_FINAL_ACTION_ENABLED=yes', true, 'final-action enablement remains rejected'],
  ['KEMERBET_TRANSFER_ENABLED=true', true, 'transfer enablement remains rejected'],
  ['KEMERBET_AMOUNT_ENTRY_ENABLED=on', true, 'Amount-entry enablement remains rejected'],
  ['FINANCIAL_ACTIONS_MODE=live', true, 'live financial mode remains rejected'],
  [
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=true',
    true,
    'internal KemerBet execution runtime enablement remains rejected',
  ],
  [
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true',
    true,
    'private live-deposit pilot enablement remains rejected',
  ],
  [
    'FETANAGENT_INTERNAL_EXECUTOR_ENABLED=true',
    true,
    'FetanAgent executor enablement remains rejected',
  ],
  [
    ['KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true', 'FETANAGENT_TRANSFER_ENABLED=true'].join(
      '\n',
    ),
    true,
    'the exact safety flag cannot mask a real enabled financial gate',
  ],
]) {
  const result = spawnSync(
    'bash',
    ['-c', `${financialGateCheck}\nhas_enabled_financial_gate "$(cat)"`],
    { cwd: root, encoding: 'utf8', input: environment },
  );
  assert.equal(result.status === 0, expectedEnabledGate, description);
}
const financialInventoryCheck = installer.slice(
  installer.indexOf('require_financial_gates_disabled() {'),
  installer.indexOf('\n\ncontainer_contract_digest() {'),
);
assert.match(
  financialInventoryCheck,
  /inventory="\$\(docker_local container ls --all --quiet[\s\S]*?\)" \|\| return 1/,
  'Docker inventory capture must fail closed before any container iteration',
);
assert.doesNotMatch(
  financialInventoryCheck,
  /done < <\(docker_local container ls/,
  'process substitution must not hide a failed Docker inventory producer',
);
assert.match(
  financialInventoryCheck,
  /done <<<"\$inventory"/,
  'the verified Docker inventory must be the only input to container iteration',
);
const financialInventoryHarness = `
${financialGateCheck}
${financialInventoryCheck}
FINAL_BINDING="/__fetanagent_h14_verifier_final_binding_$$"
PROJECT_NAME='fetanagent-staging-beta'
docker_local() {
  if [[ "$1:$2" == 'container:ls' ]]; then
    case "$MOCK_MODE" in
      inventory-failure) return 73 ;;
      safe) printf '%s\\n' safe-a safe-b ;;
      unsafe) printf '%s\\n' unsafe-a ;;
      inspect-failure) printf '%s\\n' inspect-a ;;
      *) return 74 ;;
    esac
    return
  fi
  if [[ "$1:$2" == 'container:inspect' ]]; then
    case "$MOCK_MODE:$3" in
      safe:safe-a|safe:safe-b)
        printf '%s\\n' \\
          'FINANCIAL_ACTIONS_MODE=dry_run' \\
          'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \\
          'KEMERBET_EXECUTOR_ENABLED=false' \\
          'KEMERBET_FINAL_ACTION_ENABLED=false' \\
          'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false' \\
          'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false'
        ;;
      unsafe:unsafe-a)
        printf '%s\\n' \\
          'FINANCIAL_ACTIONS_MODE=dry_run' \\
          'KEMERBET_TRANSFER_ENABLED=true'
        ;;
      inspect-failure:inspect-a) return 75 ;;
      *) return 76 ;;
    esac
    return
  fi
  return 77
}
require_financial_gates_disabled
`;
for (const [mode, expectedSuccess, description] of [
  ['inventory-failure', false, 'Docker inventory failure must fail closed'],
  ['safe', true, 'a complete safe Docker inventory must pass'],
  ['unsafe', false, 'an enabled Transfer gate in the Docker inventory must fail closed'],
  ['inspect-failure', false, 'Docker inspect failure must fail closed'],
]) {
  const result = spawnSync('bash', ['-c', financialInventoryHarness], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, MOCK_MODE: mode },
  });
  assert.equal(
    result.status === 0,
    expectedSuccess,
    `${description}: ${result.stderr || result.stdout}`,
  );
}
const containerContractCheck = installer.slice(
  installer.indexOf('require_recovery_container_contract() {'),
  installer.indexOf('\n\nrequire_container_no_chromium() {'),
);
const provisionContractCheck = containerContractCheck.slice(
  containerContractCheck.indexOf('if [[ "$service" == \'kemerbet-session-provision\' ]]'),
);
for (const requiredSafetyEnvironment of [
  'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false',
]) {
  assert.ok(
    provisionContractCheck.includes(`grep -Fxq '${requiredSafetyEnvironment}'`),
    `the coordinator contract omits ${requiredSafetyEnvironment}`,
  );
  assert.ok(
    !containerContractCheck
      .slice(0, containerContractCheck.indexOf(provisionContractCheck))
      .includes(`grep -Fxq '${requiredSafetyEnvironment}'`),
    `the Owner contract must be allowed to omit ${requiredSafetyEnvironment}`,
  );
}
const containerContractHarness = `
${financialGateCheck}
${containerContractCheck}
PROJECT_NAME='fetanagent-staging-beta'
CONTROL_VOLUME='fetanagent-staging-beta_kemerbet_session_control'
PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'
CONTAINER_ID='${'a'.repeat(64)}'
EXPECTED_RELEASE='${'b'.repeat(40)}'
emit_environment() {
  printf '%s\\n' \
    'FINANCIAL_ACTIONS_MODE=dry_run' \
    'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \
    'KEMERBET_EXECUTOR_ENABLED=false' \
    'KEMERBET_FINAL_ACTION_ENABLED=false'
  if [[ "$MOCK_SERVICE" == 'kemerbet-session-provision' ]]; then
    [[ "$MOCK_MODE" == 'missing-internal-false' ]] ||
      printf '%s\\n' 'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false'
    [[ "$MOCK_MODE" == 'missing-private-false' ]] ||
      printf '%s\\n' 'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false'
  fi
  case "$MOCK_MODE" in
    financial-live) printf '%s\\n' 'FINANCIAL_ACTIONS_MODE=live' ;;
    internal-live) printf '%s\\n' 'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=true' ;;
    private-live) printf '%s\\n' 'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true' ;;
  esac
}
docker_local() {
  [[ "$1:$2:$3:$4" == "container:inspect:$CONTAINER_ID:--format" ]] || return 81
  case "$5" in
    '{{.Id}}') printf '%s\\n' "$CONTAINER_ID" ;;
    *'com.docker.compose.project'*) printf '%s\\n' "$PROJECT_NAME" ;;
    *'com.docker.compose.service'*) printf '%s\\n' "$MOCK_SERVICE" ;;
    *'org.opencontainers.image.revision'*) printf '%s\\n' "$EXPECTED_RELEASE" ;;
    '{{.Config.User}}') printf '%s\\n' '10001:10001' ;;
    '{{.HostConfig.ReadonlyRootfs}}') printf '%s\\n' 'true' ;;
    '{{.HostConfig.RestartPolicy.Name}}') printf '%s\\n' 'no' ;;
    '{{json .HostConfig.CapAdd}}') printf '%s\\n' 'null' ;;
    '{{json .HostConfig.CapDrop}}') printf '%s\\n' '["ALL"]' ;;
    '{{json .HostConfig.SecurityOpt}}') printf '%s\\n' '["no-new-privileges:true"]' ;;
    '{{range .Config.Env}}{{println .}}{{end}}') emit_environment ;;
    *'/run/fetanagent-kemerbet-session-control'*) printf '%s\\n' "$CONTROL_VOLUME" ;;
    *'/var/lib/fetanagent/kemerbet-sessions'*) printf '%s\\n' "$PROFILE_VOLUME" ;;
    '{{json .Config.Cmd}}')
      printf '%s\\n' '["node","apps/executor/dist/kemerbet-session-provision-server.js"]'
      ;;
    *) return 82 ;;
  esac
}
require_recovery_container_contract "$CONTAINER_ID" "$MOCK_SERVICE" "$EXPECTED_RELEASE"
`;
for (const [mode, service, expectedSuccess, description] of [
  ['owner-absent', 'owner-control', true, 'Owner may omit coordinator-only false keys'],
  ['internal-live', 'owner-control', false, 'Owner internal-runtime true still fails globally'],
  ['private-live', 'owner-control', false, 'Owner private-pilot true still fails globally'],
  ['safe', 'kemerbet-session-provision', true, 'coordinator exact false-valued gates pass'],
  [
    'missing-internal-false',
    'kemerbet-session-provision',
    false,
    'coordinator missing internal-runtime false assertion fails closed',
  ],
  [
    'missing-private-false',
    'kemerbet-session-provision',
    false,
    'coordinator missing private-pilot false assertion fails closed',
  ],
  [
    'internal-live',
    'kemerbet-session-provision',
    false,
    'coordinator internal-runtime true fails closed',
  ],
  [
    'private-live',
    'kemerbet-session-provision',
    false,
    'coordinator private-pilot true fails closed',
  ],
  [
    'financial-live',
    'kemerbet-session-provision',
    false,
    'coordinator live financial mode fails closed',
  ],
]) {
  const result = spawnSync('bash', ['-c', containerContractHarness], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, MOCK_MODE: mode, MOCK_SERVICE: service },
  });
  assert.equal(
    result.status === 0,
    expectedSuccess,
    `${description}: ${result.stderr || result.stdout}`,
  );
}
assert.match(
  installer,
  /exact_directory\(owner_root, \(0, 0\), 0o755\)/,
  'the H14 installer must use the canonical root:root 0755 Owner receipt-root contract',
);
assert.doesNotMatch(installer, /exact_directory\(owner_root, \(0, 10001\), 0o750\)/);
assert.match(installer, /os\.rename\(source, target\)/);
assert.match(installer, /value\.st_dev != os\.lstat\(os\.path\.dirname\(target\)\)\.st_dev/);
assert.match(installer, /value\.st_nlink != 1/);
assert.match(installer, /stat\.S_ISLNK\(value\.st_mode\)/);
assert.match(installer, /set\(os\.listdir\(root\)\) != expected_entries/);
assert.match(installer, /'quarantined-profile-v1'/);
assert.match(installer, /'retired-binding-v3'/);
assert.match(installer, /'retired-retryable-failure-v1'/);
assert.match(installer, /'predecessor-helper'/);
assert.match(installer, /'runtime-retirement-intent-v1'/);
assert.match(installer, /'runtime-retired-v1'/);
assert.match(installer, /'owner-runtime-restored-v1'/);
assert.match(installer, /'player-stage-consumption-v1'/);
assert.match(installer, /'claim-stage-consumption-v1'/);
assert.doesNotMatch(installer, /retired-player-ids\.stage-v1|retired-claim\.stage-v1/);
assert.match(installer, /def consume_stage\(/);
const consumeStage = installer.slice(
  installer.indexOf('def consume_stage('),
  installer.indexOf('\ndef rename_profile(', installer.indexOf('def consume_stage(')),
);
assert.ok(
  consumeStage.indexOf('authorization, _ = exact_file(') <
    consumeStage.indexOf('if not os.path.lexists(source):'),
  'authorized redacted evidence must be re-attested before an absent source is accepted',
);
assert.ok(
  consumeStage.indexOf('if not os.path.lexists(source):') <
    consumeStage.indexOf('os.unlink(basename, dir_fd=parent_descriptor)'),
  'the present and authorized-absent interruption prefixes must converge on one unlink boundary',
);
assert.match(installer, /os\.unlink\(basename, dir_fd=parent_descriptor\)/);
assert.match(installer, /os\.fstat\(descriptor\)\.st_nlink != 0/);
assert.match(installer, /expected_sha=values\['old_player_ids_sha256'\]/);
assert.match(installer, /values\['player_stage_dev_ino'\]/);
assert.match(installer, /values\['claim_stage_dev_ino'\]/);
const playerPublish = installer.indexOf(
  "publish_record(root, 'player-stage-consumption-v1', player_consumption_data)",
);
const playerConsume = installer.indexOf(
  'player_consumption_path,\n        player_consumption_data,',
);
const claimPublish = installer.indexOf(
  "publish_record(root, 'claim-stage-consumption-v1', claim_consumption_data)",
);
const claimConsume = installer.indexOf('claim_consumption_path,\n        claim_consumption_data,');
assert.ok(playerPublish >= 0 && playerPublish < playerConsume);
assert.ok(claimPublish >= 0 && claimPublish < claimConsume);
assert.ok(
  installer.indexOf('if not os.path.lexists(player_consumption_path):') < playerPublish,
  'the Player stage must still exist and re-attest before its consume authorization is published',
);
assert.ok(
  installer.indexOf('if not os.path.lexists(claim_consumption_path):') < claimPublish,
  'the claim stage must still exist and re-attest before its consume authorization is published',
);

const acceptedStagePrefix = ({ intent, record, source }) =>
  intent === 'exact' && record === 'exact' && (source === 'exact-present' || source === 'absent');
assert.equal(
  acceptedStagePrefix({ intent: 'exact', record: 'exact', source: 'absent' }),
  true,
  'a crash immediately after either authorized unlink must resume',
);
assert.equal(
  acceptedStagePrefix({ intent: 'exact', record: 'exact', source: 'exact-present' }),
  true,
  'a crash after the consume record but before unlink must resume',
);
for (const rejectedPrefix of [
  { intent: 'missing', record: 'missing', source: 'absent' },
  { intent: 'exact', record: 'missing', source: 'absent' },
  { intent: 'exact', record: 'foreign', source: 'absent' },
  { intent: 'exact', record: 'exact', source: 'foreign-present' },
]) {
  assert.equal(acceptedStagePrefix(rejectedPrefix), false);
}

assert.match(installer, /require_container_no_chromium "\$COORDINATOR_CONTAINER_ID"/);
assert.match(installer, /docker_local container top "\$container_id" -eo pid,comm,args/);
assert.doesNotMatch(installer, /docker_local container top "\$container_id" -eo comm,args/);
assert.match(installer, /\^\[\[:space:\]\]\*PID\[\[:space:\]\]\+COMMAND/);
assert.match(installer, /tail -n \+2/);
assert.match(
  installer,
  /readonly EMPTY_CHECKPOINT_RELEASE='4239201b5496bd08912cce4b5581fe19b29a84d4'/,
);
assert.match(
  installer,
  /readonly EMPTY_CHECKPOINT_RECORD_NAME='empty-predecessor-checkpoint-adoption-v1'/,
);
assert.match(installer, /require_exact_empty_predecessor_checkpoint_prefix\(\)/);
assert.match(
  installer,
  /require_exact_empty_predecessor_checkpoint_prefix\(\)[\s\S]*?"\$EMPTY_CHECKPOINT_RECORD_NAME" <<'PY' \|\| return 1/,
);
assert.match(installer, /adopt_exact_empty_predecessor_checkpoint\(\)/);
assert.match(installer, /require_adopted_empty_checkpoint_record\(\)/);
assert.match(installer, /os\.rename\(source, target\)/);
assert.match(installer, /sync_directory\(parent\)/);
assert.match(installer, /checkpoint_dev_ino=\{value\.st_dev\}:\{value\.st_ino\}/);
assert.match(installer, /state=adoption-prepared/);
assert.match(installer, /same_inode_target_rename_authorized=true/);
assert.match(installer, /namespace_rename_pending_at_publication=true/);
assert.doesNotMatch(installer, /state=adopted/);
assert.match(installer, /durable_retirement_intent_present=false/);
assert.match(installer, /deployment_grant_changed=false/);
assert.match(installer, /helper_changed=false/);
assert.match(installer, /runtime_mutated=false/);
assert.match(installer, /active-predecessor-empty:active/);
assert.match(
  installer,
  /require_exact_empty_predecessor_checkpoint_prefix \|\|\s+die 'the predecessor H14 empty checkpoint changed under lock'/,
);
assert.ok(
  installer.indexOf('adopt_exact_empty_predecessor_checkpoint ||') <
    installer.indexOf('prepare_or_load_runtime_retirement_intent ||'),
  'the exact empty predecessor checkpoint must be durably adopted before retirement intent',
);
const lockedAdoptionStart = installer.indexOf(
  'if [[ "$h14_state" == \'predecessor-empty\' ]]; then',
  installer.indexOf('case "$h14_state" in', installer.indexOf("locked_grant_state='active'")),
);
const lockedAdoptionEnd = installer.indexOf("  h14_state='interrupted'", lockedAdoptionStart);
const lockedAdoption = installer.slice(lockedAdoptionStart, lockedAdoptionEnd);
assert.ok(lockedAdoptionStart >= 0 && lockedAdoptionEnd > lockedAdoptionStart);
assert.ok(
  lockedAdoption.indexOf('require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755') <
    lockedAdoption.indexOf('adopt_exact_empty_predecessor_checkpoint ||'),
  'the predecessor helper bytes must be re-attested under lock before adoption evidence says helper_changed=false',
);
assert.ok(
  lockedAdoption.indexOf('run_helper_direct verify "$PREDECESSOR_HELPER_SHA256"') <
    lockedAdoption.indexOf('adopt_exact_empty_predecessor_checkpoint ||'),
  'the predecessor helper must independently verify under lock before same-inode adoption',
);
assert.ok(
  lockedAdoption.indexOf('run_helper_direct kemerbet-v3-recheck-bridge-ready') <
    lockedAdoption.indexOf('adopt_exact_empty_predecessor_checkpoint ||'),
  'the exact H13 bridge state must be re-attested under lock before adoption',
);
assert.match(installer, /docker_local container stop --time 70 "\$COORDINATOR_CONTAINER_ID"/);
assert.match(installer, /docker_local container rm "\$COORDINATOR_CONTAINER_ID"/);
assert.match(installer, /docker_local container stop --time 20 "\$OWNER_CONTAINER_ID"/);
assert.match(installer, /profile_volume_holders=none/);
assert.match(installer, /control_volume_holder=\$OWNER_CONTAINER_ID-stopped/);
assert.match(installer, /require_no_host_chromium/);
assert.match(installer, /require_h14_installer_prefix_namespace \|\| return 1/);
assert.match(installer, /readonly STAGED_INSTALLER="\$STAGING_ROOT\/\$SCRIPT_BASENAME"/);
assert.match(installer, /"\$\(realpath -- "\$0"\)" == "\$STAGED_INSTALLER"/);
assert.match(installer, /require_pre_retirement_intent_only\(\)/);
assert.doesNotMatch(installer, /initial_grant_state='disabled-preintent'/);
assert.doesNotMatch(installer, /initial_grant_state='active-prefix-review-required'/);
assert.match(installer, /locked_grant_state='active'/);
assert.match(
  installer,
  /active-predecessor-empty:active\|active-adoption-only:active\|active-runtime-intent-prepared:active\|active-runtime-intent:active\|active-retired-successor:active\|disabled-runtime-intent:disabled\|disabled-post-retirement:disabled\|disabled-installing-complete:disabled\|disabled-retired-predecessor:disabled\|disabled-retired-successor:disabled/,
);
const prepareRecoveryRootCheck = installer.slice(
  installer.indexOf('prepare_h14_recovery_root() {'),
  installer.indexOf('\n\nrequire_h14_installer_prefix_namespace() {'),
);
assert.doesNotMatch(
  prepareRecoveryRootCheck,
  /\bmkdir\b|\binstall -d\b/,
  'checkpoint recovery must never synthesize a missing H14 parent or successor prefix',
);
assert.match(
  prepareRecoveryRootCheck,
  /require_adopted_empty_checkpoint_record "\$H14_WORK_ROOT"/,
  'both existing successor namespaces must retain exact adoption evidence',
);
assert.equal(
  (prepareRecoveryRootCheck.match(/sync -f "\$H14_PARENT"/g) ?? []).length,
  2,
  'both an already-renamed installing namespace and final namespace must re-fsync the H14 parent before later mutation',
);
const forwardRecoveryCheck = installer.slice(
  installer.indexOf('run_forward_only_recovery() {'),
  installer.indexOf('\n\nrequire_exact_droplet || die'),
);
assert.doesNotMatch(forwardRecoveryCheck, /os\.mkdir\(parent|os\.mkdir\(installing/);
assert.doesNotMatch(forwardRecoveryCheck, /\{release\}, set\(\)/);
assert.doesNotMatch(forwardRecoveryCheck, /adoption_present/);
assert.match(
  forwardRecoveryCheck,
  /parent_entries not in \(\{f'\.installing-\{release\}'\}, \{release\}\)/,
);
assert.match(forwardRecoveryCheck, /exact_ascii_record\(adoption_path, \(0, 0\), 0o600, 20\)/);
assert.match(forwardRecoveryCheck, /def append_complete_exact\(/);
assert.match(forwardRecoveryCheck, /def complete_empty_creation_metadata\(/);
assert.match(
  forwardRecoveryCheck,
  /identity not in \{\s*\(0, 0, expected_created_mode\),\s*\(uid, gid, expected_created_mode\),\s*\}/s,
  'only exact zero-byte post-create and post-chown initialization metadata may be completed',
);
assert.match(forwardRecoveryCheck, /before\.st_size != 0/);
assert.match(forwardRecoveryCheck, /current != data\[:len\(current\)\]/);
assert.match(forwardRecoveryCheck, /write_all\(descriptor, data\[len\(current\):\]\)/);
assert.doesNotMatch(
  forwardRecoveryCheck,
  /if len\(current\) == len\(data\):\s+return/,
  'an already-full temporary Python record must still be fsynced before atomic rename',
);
assert.match(
  forwardRecoveryCheck,
  /if os\.path\.lexists\(intent_path\) and os\.path\.lexists\(intent_temporary\):\s+reject\(\)\s+if not os\.path\.lexists\(intent_path\):/,
  'an exact intent temporary must be recomputed from unchanged sources and append-completed',
);
const renameFileCheck = forwardRecoveryCheck.slice(
  forwardRecoveryCheck.indexOf('def rename_file('),
  forwardRecoveryCheck.indexOf('\ndef attest_stage('),
);
assert.match(
  renameFileCheck,
  /if target_present:\s+sync_directory\(os\.path\.dirname\(source\)\)\s+sync_directory\(os\.path\.dirname\(target\)\)/,
  'an exact target-present file rename resume must heal both directory fsyncs',
);
const consumeStageCheck = forwardRecoveryCheck.slice(
  forwardRecoveryCheck.indexOf('def consume_stage('),
  forwardRecoveryCheck.indexOf('\ndef rename_profile('),
);
assert.match(
  consumeStageCheck,
  /if not os\.path\.lexists\(source\):\s+sync_directory\(os\.path\.dirname\(source\)\)\s+return/,
  'authorized source-absent stage consumption must heal the source-directory fsync',
);
const renameProfileCheck = forwardRecoveryCheck.slice(
  forwardRecoveryCheck.indexOf('def rename_profile('),
  forwardRecoveryCheck.indexOf('\n\ntry:', forwardRecoveryCheck.indexOf('def rename_profile(')),
);
assert.match(
  renameProfileCheck,
  /if target_present:\s+sync_directory\(os\.path\.dirname\(source\)\)\s+sync_directory\(os\.path\.dirname\(target\)\)/,
  'an exact target-present profile rename resume must heal both directory fsyncs',
);
assert.match(
  forwardRecoveryCheck,
  /if os\.path\.lexists\(final\):[\s\S]*?if current != data:\s+reject\(\)\s+sync_directory\(root\)\s+return/,
  'resuming an exact final Python record must fsync its containing directory before later mutation',
);
assert.doesNotMatch(
  forwardRecoveryCheck,
  /if not os\.path\.lexists\(intent_path\) and not os\.path\.lexists\(intent_temporary\)/,
);
assert.ok(
  forwardRecoveryCheck.indexOf("publish_record(root, 'intent-v1', intent_data)") <
    forwardRecoveryCheck.indexOf('rename_file(\n        source_binding,'),
  'no source evidence may move before intent-v1 is byte-exact and durably finalized',
);
assert.match(forwardRecoveryCheck, /'\.owner-runtime-restored-v1\.installing'/);
assert.match(forwardRecoveryCheck, /owner_restore_entries = set\(\)/);
assert.match(
  forwardRecoveryCheck,
  /owner_restored_prefix != owner_restored_data\[:len\(owner_restored_prefix\)\]/,
);
assert.match(
  forwardRecoveryCheck,
  /set\(os\.listdir\(root\)\) != expected_entries \| owner_restore_entries/,
  'both the exact partial and final Owner-restored publication checkpoints must be resumable',
);
assert.match(installer, /die 'the exact predecessor H14 checkpoint namespace is absent'/);
assert.match(installer, /die 'the empty H14 recovery parent cannot establish checkpoint lineage'/);
assert.doesNotMatch(installer, /h14_state='absent'/);
assert.match(
  installer,
  /require_adopted_empty_checkpoint_record "\$RECOVERY_INSTALLING" \|\|\s+die 'the interrupted H14 hotfix prefix is missing/,
);
const shellRecordPublisher = installer.slice(
  installer.indexOf('publish_recovery_record() {'),
  installer.indexOf('\n\nexpected_runtime_retirement_intent() {'),
);
assert.match(shellRecordPublisher, /current != data\[:before\.st_size\]/);
assert.match(shellRecordPublisher, /while offset < len\(data\):/);
assert.match(shellRecordPublisher, /os\.fsync\(descriptor\)/);
assert.match(
  shellRecordPublisher,
  /cmp -s -- "\$final" <\(printf '%s' "\$expected"\) \|\| return 1\s+sync -f "\$root"\s+return/,
  'resuming an exact final shell record must fsync its containing directory before later mutation',
);
assert.doesNotMatch(shellRecordPublisher, /\brm\b|os\.unlink|os\.replace/);
const helperCopier = installer.slice(
  installer.indexOf('copy_helper_atomically() {'),
  installer.indexOf('\n\nrun_forward_only_recovery() {'),
);
assert.match(helperCopier, /current != expected\[:before\.st_size\]/);
assert.match(helperCopier, /partial_mode not in \(0o600, 0o755\)/);
assert.match(helperCopier, /partial_mode == 0o755 and before\.st_size != len\(expected\)/);
assert.match(helperCopier, /while offset < len\(expected\):/);
assert.doesNotMatch(helperCopier, /\brm\b|os\.unlink|os\.replace/);

const completedIdempotentStart = installer.indexOf(
  'if [[ "$h14_state" == \'retired\' ]] &&\n  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then',
);
const completedIdempotentEnd = installer.indexOf('\nfi\n', completedIdempotentStart) + 4;
const completedIdempotent = installer.slice(completedIdempotentStart, completedIdempotentEnd);
assert.ok(completedIdempotentStart >= 0 && completedIdempotentEnd > completedIdempotentStart);
assert.ok(
  completedIdempotentStart < installer.indexOf('prepare_or_load_runtime_retirement_intent ||'),
  'a valid final successor-helper state must exit under lock before installer-only namespace preparation',
);
assert.match(completedIdempotent, /run_helper_direct verify "\$SUCCESSOR_HELPER_SHA256"/);
assert.match(
  completedIdempotent,
  /run_helper_direct kemerbet-quarantine-recovery-ready "\$RECOVERY_RELEASE"/,
);
assert.match(completedIdempotent, /require_financial_gates_disabled/);
assert.match(completedIdempotent, /require_no_other_mutator_processes/);
assert.match(completedIdempotent, /require_exact_droplet/);
assert.match(completedIdempotent, /sync -f \/usr\/local\/sbin/);
assert.match(
  completedIdempotent,
  /! -e "\$INSTALLING_HELPER"[\s\S]*?! -e "\$INSTALLING_HELPER_PARTIAL"/,
  'completed successor-helper topology must reject either helper-install residue',
);
assert.ok(
  completedIdempotent.indexOf('run_helper_direct kemerbet-quarantine-recovery-ready') <
    completedIdempotent.indexOf('restore_sudoers ||'),
  'a disabled grant may be restored only after the successor helper proves the exact final or later-derived state',
);
assert.doesNotMatch(
  completedIdempotent,
  /publish_recovery_record|run_forward_only_recovery|restore_owner_runtime_and_finalize|RECOVERY_INSTALLING/,
  'the completed-state idempotent route must not mutate H14 evidence',
);
assert.match(
  installer,
  /sync -f \/etc\/sudoers\.d \|\| die 'the exact deployment grant namespace could not be durably re-attested'/,
  'an exact active or disabled sudoers topology must be directory-fsynced under lock before later mutation',
);
const runtimeRetirement = installer.slice(
  installer.indexOf('retire_recovery_runtime() {'),
  installer.indexOf('\n\nexpected_owner_runtime_restored() {'),
);
assert.match(
  runtimeRetirement,
  /running_profile_holders="\$\(docker_local container ls --quiet[\s\S]*?\)" \|\| return 1/,
);
assert.match(
  runtimeRetirement,
  /running_control_holders="\$\(docker_local container ls --quiet[\s\S]*?\)" \|\| return 1/,
);
assert.doesNotMatch(
  runtimeRetirement,
  /\[\[ -z "\$\(docker_local container ls/,
  'running volume-holder inventory errors must never collapse to an empty safe inventory',
);
assert.match(
  installer,
  /require_adopted_empty_checkpoint_record "\$RECOVERY_ROOT" \|\|\s+die 'the completed H14 hotfix prefix is missing/,
);
assert.match(
  installer,
  /prepare_or_load_runtime_retirement_intent \|\|\s+die 'the exact coordinator\/Owner retirement intent could not be durably prepared or resumed'/,
);
assert.ok(
  installer.indexOf('prepare_or_load_runtime_retirement_intent ||') <
    installer.indexOf('disable_sudoers || die'),
  'the exact runtime retirement intent must be durable before the grant is disabled or runtime mutation begins',
);
const acceptsInstallerGrantPrefix = ({ namespace, phase, grant, helper, adoption = 'exact' }) => {
  if (adoption !== 'exact') return false;
  if (namespace === 'predecessor') {
    return phase === 'empty-checkpoint' && grant === 'active' && helper === 'predecessor';
  }
  if (namespace === 'interrupted') {
    if (helper !== 'predecessor') return false;
    if (phase === 'adoption-only') return grant === 'active';
    if (phase === 'runtime-intent-prepared') return grant === 'active';
    if (phase === 'runtime-intent') return grant === 'active' || grant === 'disabled';
    return (phase === 'post-retirement' || phase === 'complete') && grant === 'disabled';
  }
  if (namespace === 'final') {
    if (helper === 'predecessor') return phase === 'complete' && grant === 'disabled';
    return (
      helper === 'successor' &&
      (phase === 'complete' || phase === 'helper-derived') &&
      (grant === 'active' || grant === 'disabled')
    );
  }
  return false;
};
for (const acceptedPrefix of [
  {
    namespace: 'predecessor',
    grant: 'active',
    phase: 'empty-checkpoint',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    grant: 'active',
    phase: 'adoption-only',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    grant: 'active',
    phase: 'runtime-intent-prepared',
    helper: 'predecessor',
  },
  { namespace: 'interrupted', phase: 'runtime-intent', grant: 'active', helper: 'predecessor' },
  {
    namespace: 'interrupted',
    phase: 'runtime-intent',
    grant: 'disabled',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    phase: 'post-retirement',
    grant: 'disabled',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    phase: 'complete',
    grant: 'disabled',
    helper: 'predecessor',
  },
  { namespace: 'final', phase: 'complete', grant: 'active', helper: 'successor' },
  { namespace: 'final', phase: 'complete', grant: 'disabled', helper: 'successor' },
  { namespace: 'final', phase: 'helper-derived', grant: 'active', helper: 'successor' },
  { namespace: 'final', phase: 'complete', grant: 'disabled', helper: 'predecessor' },
]) {
  assert.equal(acceptsInstallerGrantPrefix(acceptedPrefix), true);
}
for (const rejectedPrefix of [
  { namespace: 'absent', phase: 'none', grant: 'active', helper: 'predecessor' },
  { namespace: 'empty-parent', phase: 'none', grant: 'active', helper: 'predecessor' },
  {
    namespace: 'interrupted',
    phase: 'adoption-only',
    grant: 'disabled',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    phase: 'runtime-intent-prepared',
    grant: 'disabled',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    phase: 'post-retirement',
    grant: 'active',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    phase: 'complete',
    grant: 'active',
    helper: 'predecessor',
  },
  {
    namespace: 'interrupted',
    grant: 'active',
    phase: 'runtime-intent',
    helper: 'successor',
  },
  { namespace: 'final', phase: 'complete', grant: 'active', helper: 'predecessor' },
  { namespace: 'final', phase: 'adoption-only', grant: 'disabled', helper: 'predecessor' },
  { namespace: 'final', phase: 'adoption-only', grant: 'active', helper: 'successor' },
  {
    namespace: 'interrupted',
    phase: 'runtime-intent',
    grant: 'active',
    helper: 'predecessor',
    adoption: 'missing',
  },
  {
    namespace: 'final',
    phase: 'complete',
    grant: 'disabled',
    helper: 'successor',
    adoption: 'predeleted',
  },
]) {
  assert.equal(acceptsInstallerGrantPrefix(rejectedPrefix), false);
}
assert.ok(
  installer.indexOf('retire_recovery_runtime ||') <
    installer.indexOf('profile_mountpoint="$(docker_local volume inspect'),
  'the exact H13 runtime must be retired before either volume mountpoint is resolved for mutation',
);
assert.ok(
  installer.indexOf('run_forward_only_recovery "$profile_mountpoint" "$control_mountpoint"') <
    installer.indexOf('restore_owner_runtime_and_finalize ||'),
  'the Owner must stay stopped through raw-stage consumption and evidence retirement',
);
assert.match(installer, /publish_record\(owner_root, terminal_name, claim_data, 0, 10001, 0o440\)/);
assert.doesNotMatch(
  installer,
  /\brm\s+-|os\.remove|shred|docker_local\s+(?:compose\s+)?up\b|docker_local\s+(?:volume|network|image)\s+(?:rm|prune)|docker_local\s+system\s+prune/,
);

for (const contract of [
  "readonly KEMERBET_QUARANTINE_RECOVERY_V14_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14'",
  "readonly KEMERBET_QUARANTINE_RECOVERY_PROFILE_ACK_NAME='kemerbet-quarantine-recovery-profile-prepared-v1'",
  "readonly KEMERBET_QUARANTINE_RECOVERY_TERMINAL_MARKER_NAME='kemerbet-readiness-cohort-security-recovery-failed-terminal-v1'",
  "readonly KEMERBET_QUARANTINE_RECOVERY_TERMINAL_MARKER_INSTALLING_NAME='.kemerbet-readiness-cohort-security-recovery-failed-terminal-v1.installing'",
  "readonly KEMERBET_QUARANTINE_RECOVERY_PROFILE_FINALIZED_MARKER_NAME='kemerbet-readiness-cohort-security-recovery-profile-finalized-v1'",
  "readonly KEMERBET_QUARANTINE_RECOVERY_PROFILE_FINALIZED_MARKER_INSTALLING_NAME='.kemerbet-readiness-cohort-security-recovery-profile-finalized-v1.installing'",
  "readonly KEMERBET_OWNER_RECHECK_SPENT_FAILED_TERMINAL_CLAIM_NAME='kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1'",
  `readonly KEMERBET_QUARANTINE_RECOVERY_AUTHORIZATION_SHA256='${authorizationSha256}'`,
  'inspect_kemerbet_h14_recovery_gate() {',
  'finalize_kemerbet_h14_recovery_profile() {',
  'record_kemerbet_h14_recovery_cohort() {',
  'record_kemerbet_h14_reseal() {',
  'record_kemerbet_h14_completion() {',
]) {
  assert.ok(helper.includes(contract), `missing H14 helper contract: ${contract}`);
}
for (const evidenceName of [
  'runtime-retirement-intent-v1',
  'runtime-retired-v1',
  'owner-runtime-restored-v1',
  'player-stage-consumption-v1',
  'claim-stage-consumption-v1',
]) {
  assert.ok(helper.includes(`'${evidenceName}'`), `helper omits ${evidenceName}`);
}
assert.match(helper, /empty_checkpoint_record_name = 'empty-predecessor-checkpoint-adoption-v1'/);
assert.match(helper, /predecessor_recovery_release=4239201b5496bd08912cce4b5581fe19b29a84d4/);
assert.match(helper, /checkpoint_dev_ino=\{root_value\.st_dev\}:\{root_value\.st_ino\}/);
assert.match(helper, /base\.add\(empty_checkpoint_record_name\)/);
const helperRecoveryGate = helper.slice(
  helper.indexOf('inspect_kemerbet_h14_recovery_gate() {'),
  helper.indexOf('\n\ninspect_kemerbet_v2_v3_successor_gate() {'),
);
assert.match(helperRecoveryGate, /KEMERBET_H14_RECOVERY_STATE='invalid'[\s\S]*?return 0/);
assert.doesNotMatch(
  helperRecoveryGate,
  /if os\.path\.lexists\(empty_checkpoint_record_path\)/,
  'the successor helper must never treat adoption evidence as optional',
);
assert.match(
  helperRecoveryGate,
  /exact_ascii_lines\(\s*empty_checkpoint_record_path, \(0, 0\), 0o600, 20\s*\)/,
);
assert.match(helperRecoveryGate, /'state=adoption-prepared'/);
assert.match(helperRecoveryGate, /'same_inode_target_rename_authorized=true'/);
assert.match(helperRecoveryGate, /'namespace_rename_pending_at_publication=true'/);
assert.match(
  helperRecoveryGate,
  /if release in \{\s*'306818ca812bd2abce8479396c4eea8383ea00f9',\s*'4239201b5496bd08912cce4b5581fe19b29a84d4',\s*\}:\s*reject\(\)/s,
  'the successor helper must independently reject both predecessor releases as an H14 final namespace',
);
assert.match(
  helperRecoveryGate,
  /empty_checkpoint_record\[8\]\.split\('=', 1\)\[1\] == empty_checkpoint_record\[9\]\.split\('=', 1\)\[1\]/,
  'the successor helper must independently reject an adoption record whose source and target namespace are equal',
);
assert.match(helper, /runtime_intent\[2\] != f'runtime_release=\{predecessor_runtime_release\}'/);
assert.match(
  helper,
  /intent\[3\] != 'predecessor_release=306818ca812bd2abce8479396c4eea8383ea00f9'/,
);
assert.match(
  helper,
  /intent\[4\] != 'predecessor_helper_sha256=3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa'/,
);
assert.match(helper, /raw_player_ids_preserved=false/);
assert.match(helper, /raw_stage_preserved=false/);
assert.match(
  helper,
  /exact_ascii_lines\(f'\{root\}\/database-profile-prepared-v1', \(10001, 10001\), 0o400, 9\)/,
);
assert.match(
  helper,
  /ack\[6:\] != \[\s*'configuration_reason=security_recovery',\s*'transfer_disabled=true',\s*'money_moved=false'/s,
);
assert.match(helper, /contract=fetanagent-kemerbet-quarantine-recovery-identity-authorization-v1/);
assert.match(helper, /old_identity_fingerprint=\{old_match\.group\(2\)\.decode\("ascii"\)\}/);
assert.match(helper, /if len\(authorization_data\) != 389/);
assert.doesNotMatch(helper, /profile_id\.encode\('ascii'\)\s*\+ b' '\s*\+ old_match\.group\(2\)/s);
assert.match(helper, /move_exact\(ack_source, ack_target/);
assert.match(helper, /cohort-publication-prefix/);
assert.match(helper, /cohort-latch-retirement-prefix/);
assert.match(helper, /cohort-freeze-prefix/);
assert.match(helper, /reseal-publication-prefix/);
assert.match(helper, /completion-publication-prefix/);
assert.match(helper, /freeze_owner_staged_kemerbet_cohort_for_h14\(\)/);
assert.match(helper, /require_frozen_owner_staged_kemerbet_cohort_for_h14\(\)/);
assert.match(helper, /retire_kemerbet_h14_profile_finalized_latch\(\)/);
assert.match(helper, /profile-finalized-cohort-latch-v1/);
assert.match(
  helper,
  /terminal_installing_prefix = authorization_prefix \| \{'\.terminal-recovery-marker-v1\.installing'\}/,
);
assert.match(helper, /seal_match\.group\(1\)\.decode\('ascii'\) != profile_id/);
assert.match(helper, /seal_match\.group\(2\) == old_match\.group\(2\)/);
assert.match(helper, /final_data != seal_data/);
assert.match(
  helper,
  /cohort-prepared\)\s+printf '%s\\n'\s+\\?\s*"\$KEMERBET_QUARANTINE_RECOVERY_V14_PARENT\/\$KEMERBET_H14_RECOVERY_RELEASE\/recovery-identity-authorization-v1"/s,
);
assert.match(
  helper,
  /reseal-prefix\|reseal-publication-prefix\)\s+die 'the H14 private preview is blocked while the fresh identity binding publication is incomplete'/s,
);
assert.match(helper, /resealed\).*?printf '%s\\n' "\$KEMERBET_READINESS_BINDING"/s);
assert.match(helper, /'0:10001:440:1:389'/);
assert.match(helper, /require_kemerbet_h14_recovery_identity_authorization_content/);
assert.match(
  helper,
  /publish_root_claim_marker\(f'\{root\}\/terminal-recovery-marker-v1', marker_data\)/,
);
assert.match(
  helper,
  /transition_profile_finalized_latch\(marker_source, profile_finalized_marker, marker_data\)/,
);
assert.match(helper, /kemerbet_recheck_spent_failed_terminal_marker\(\)/);
assert.match(helper, /state=execution_started/);
assert.match(helper, /state=spent/);
assert.match(
  helper,
  /ownership not in \{\s*\(10001, 10001, 0o400\),\s*\(0, 0, 0o400\),\s*\(0, 0, 0o444\),\s*\}/s,
);
assert.match(helper, /else 'transitional'\s*if ownership == \(0, 0, 0o400\)/s);
assert.match(helper, /stage_states == \('frozen', 'frozen'\)/);
assert.match(helper, /if cohort_name\.startswith\('\.'\) and stage_states != \('raw', 'raw'\):/);
assert.match(helper, /else 'cohort-freeze-prefix'/);
assert.match(helper, /the H14 readiness seal requires the exact terminal frozen cohort/);
assert.match(helper, /the H14 find-only recheck requires the exact resealed frozen cohort/);
assert.match(
  helper,
  /if \[\[ "\$KEMERBET_H14_RECOVERY_STATE" == 'invalid' \]\]; then\s+KEMERBET_V2_V3_SUCCESSOR_GATE_STATE='invalid'/,
  'malformed H14 evidence must poison the aggregate successor gate',
);
const profileFinalization = helper.slice(
  helper.indexOf('finalize_kemerbet_h14_recovery_profile() {'),
  helper.indexOf('publish_kemerbet_h14_record() {'),
);
const privateTerminalPublish = profileFinalization.indexOf(
  "publish_root_claim_marker(f'{root}/terminal-recovery-marker-v1', marker_data)",
);
const ownerLatchTransition = profileFinalization.indexOf(
  'transition_profile_finalized_latch(marker_source, profile_finalized_marker, marker_data)',
);
const acknowledgmentRetirement = profileFinalization.indexOf(
  'move_exact(ack_source, ack_target, ack_data',
);
assert.ok(
  privateTerminalPublish >= 0 &&
    ownerLatchTransition > privateTerminalPublish &&
    acknowledgmentRetirement > ownerLatchTransition,
  'private terminal evidence must be durable before the atomic Owner-latch rename, and the acknowledgment retires only afterward',
);
const ownerLatchTransitionFunction = profileFinalization.slice(
  profileFinalization.indexOf('def transition_profile_finalized_latch('),
  profileFinalization.indexOf(
    '\n\ntry:',
    profileFinalization.indexOf('def transition_profile_finalized_latch('),
  ),
);
assert.match(ownerLatchTransitionFunction, /os\.rename\(source, target\)/);
assert.match(ownerLatchTransitionFunction, /sync_directory\(directory\)/);
assert.match(ownerLatchTransitionFunction, /or os\.path\.lexists\(source\)/);
assert.match(
  ownerLatchTransitionFunction,
  /\(target_value\.st_dev, target_value\.st_ino\)\s*!= \(source_value\.st_dev, source_value\.st_ino\)/s,
);
assert.doesNotMatch(
  profileFinalization,
  /move_exact\(marker_source, f'\{root\}\/terminal-recovery-marker-v1'/,
  'the sole Owner-visible quarantine marker must never move out of the receipt root',
);

const successorGate = helper.slice(
  helper.indexOf('enforce_kemerbet_v2_v3_successor_gate() {'),
  helper.indexOf('require_kemerbet_v3_runtime_bridge() {'),
);
for (const resumableGate of [
  'record-kemerbet-quarantine-recovery-cohort:cohort-latch-retirement-prefix',
  'record-kemerbet-quarantine-recovery-cohort:cohort-freeze-prefix',
  'seal-kemerbet-readiness:cohort-prepared',
  'seal-kemerbet-readiness:reseal-prefix',
]) {
  assert.ok(successorGate.includes(resumableGate), `H14 gate omits ${resumableGate}`);
}

const spentTerminalization = helper.slice(
  helper.indexOf('terminalize_spent_kemerbet_recheck_authorization() {'),
  helper.indexOf('require_committed_kemerbet_recheck_boundary_shape() {'),
);
const spentFinalBranch = spentTerminalization.slice(
  spentTerminalization.indexOf('if [[ -e "$terminal_marker"'),
  spentTerminalization.indexOf('  else\n'),
);
assert.match(
  spentFinalBranch,
  /kemerbet_recheck_spent_failed_terminal_marker publish/,
  'the final+installer hard-link crash prefix must resume through the publisher repair path',
);
assert.doesNotMatch(spentFinalBranch, /kemerbet_recheck_spent_failed_terminal_marker require/);

const retainedReceiptNamespace = helper.slice(
  helper.indexOf('RECEIPT_MARKERS = {'),
  helper.indexOf('\n}\n', helper.indexOf('RECEIPT_MARKERS = {')) + 2,
);
const startupReceiptNamespace = helper.slice(
  helper.indexOf('require_owner_kemerbet_receipt_startup_state() {'),
  helper.indexOf('ensure_owner_kemerbet_receipt_root() {'),
);
for (const recoveryMarker of [
  'kemerbet-readiness-cohort-security-recovery-failed-terminal-v1',
  '.kemerbet-readiness-cohort-security-recovery-failed-terminal-v1.installing',
  'kemerbet-readiness-cohort-security-recovery-profile-finalized-v1',
  '.kemerbet-readiness-cohort-security-recovery-profile-finalized-v1.installing',
  'kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1',
  '.kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1.installing',
]) {
  assert.ok(retainedReceiptNamespace.includes(recoveryMarker));
}
for (const recoveryMarkerConstant of [
  'KEMERBET_QUARANTINE_RECOVERY_TERMINAL_MARKER_NAME',
  'KEMERBET_QUARANTINE_RECOVERY_TERMINAL_MARKER_INSTALLING_NAME',
  'KEMERBET_QUARANTINE_RECOVERY_PROFILE_FINALIZED_MARKER_NAME',
  'KEMERBET_QUARANTINE_RECOVERY_PROFILE_FINALIZED_MARKER_INSTALLING_NAME',
  'KEMERBET_OWNER_RECHECK_SPENT_FAILED_TERMINAL_CLAIM_NAME',
  'KEMERBET_OWNER_RECHECK_SPENT_FAILED_TERMINAL_CLAIM_INSTALLING_NAME',
]) {
  assert.ok(startupReceiptNamespace.includes(recoveryMarkerConstant));
}
const h14Record = helper.slice(
  helper.indexOf('record_kemerbet_h14_recovery_cohort() {'),
  helper.indexOf('record_kemerbet_h14_reseal() {'),
);
const h14RecordPublish = h14Record.indexOf('publish_kemerbet_h14_record cohort-prepared-v1');
const h14RecordFreeze = h14Record.indexOf('freeze_owner_staged_kemerbet_cohort_for_h14');
const h14RecordRequireFrozen = h14Record.indexOf(
  'require_frozen_owner_staged_kemerbet_cohort_for_h14',
);
const h14RecordRetireLatch = h14Record.indexOf('retire_kemerbet_h14_profile_finalized_latch');
const h14RecordTerminal = h14Record.indexOf(`KEMERBET_H14_RECOVERY_STATE" == 'cohort-prepared'`);
assert.ok(
  h14RecordPublish >= 0 && h14RecordFreeze >= 0 && h14RecordPublish < h14RecordFreeze,
  'the redacted inode/digest cohort receipt must be durable before either exact stage inode freezes',
);
assert.ok(
  h14RecordTerminal >= 0 && h14RecordFreeze < h14RecordTerminal,
  'record completion must follow the root-owned frozen stage transition',
);
assert.ok(
  h14RecordRequireFrozen >= 0 &&
    h14RecordRetireLatch >= 0 &&
    h14RecordFreeze < h14RecordRequireFrozen &&
    h14RecordRequireFrozen < h14RecordRetireLatch &&
    h14RecordRetireLatch < h14RecordTerminal,
  'the profile-finalized quarantine latch must remain visible until the exact frozen cohort is re-attested',
);
assert.match(helper, /record_kemerbet_h14_completion "\$commit_sha"/);
assert.match(
  helper,
  /session_binding_source="\$\(select_kemerbet_session_binding_source "\$commit_sha"\)"/,
);
assert.doesNotMatch(
  helper.slice(
    helper.indexOf('finalize_kemerbet_h14_recovery_profile() {'),
    helper.indexOf('consume_exact_one_use_kemerbet_file() {'),
  ),
  /docker_local\s+(?:compose\s+)?up\b|container exec|\/transfer\b|amount_entry_enabled=true|transfer_enabled=true/,
);

for (const mode of [
  'quarantine-recovery-inspect',
  'quarantine-recovery-finalize-profile',
  'quarantine-recovery-record-cohort',
]) {
  assert.ok(workflow.includes(`- ${mode}`), `workflow lacks ${mode}`);
}
assert.match(workflow, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/);
assert.match(workflow, /CONFIRMED_COMMIT.*== "\$GITHUB_SHA"/);
assert.match(
  workflow,
  /CONFIRMED_PRIOR_SEAL_COMMIT" =~ \^\[0-9a-f\]\{40\}\$ && "\$CONFIRMED_PRIOR_SEAL_COMMIT" == "\$GITHUB_SHA"/,
);
assert.doesNotMatch(
  workflow,
  /\^\(start\|inspect\|quarantine-recovery-inspect\|quarantine-recovery-finalize-profile\|quarantine-recovery-record-cohort\|seal\)\$/,
);
assert.ok(workflow.includes(authorizationSha256));
assert.match(workflow, /kemerbet-quarantine-recovery-ready '\$GITHUB_SHA'/);
assert.match(workflow, /finalize-kemerbet-quarantine-recovery-profile '\$GITHUB_SHA'/);
assert.match(workflow, /record-kemerbet-quarantine-recovery-cohort '\$GITHUB_SHA'/);
assert.match(workflow, /environment: staging/);

assert.ok(runbook.includes(authorizationSha256));
assert.match(runbook, /coordinator contains no Chromium process/);
assert.match(runbook, /requests `pid,comm,args` from Docker/);
assert.match(runbook, /4239201b5496bd08912cce4b5581fe19b29a84d4/);
assert.match(runbook, /empty-predecessor-checkpoint-adoption-v1/);
assert.match(runbook, /state=adoption-prepared/);
assert.match(runbook, /same-inode target rename/);
assert.match(runbook, /namespace rename was still pending/);
assert.match(runbook, /then renames\s+the same directory inode/);
assert.match(runbook, /missing or empty H14 parent/);
assert.match(runbook, /There is no recursive cleanup, unlink, replacement directory/);
assert.match(runbook, /does not disable the grant, change the helper/);
assert.match(runbook, /stops and removes that\s+coordinator, stops the exact Owner container/);
assert.match(
  runbook,
  /retry after either\s+unlink accepts absence only\s+when the corresponding byte-exact consume record already exists/,
);
assert.match(runbook, /without copying any\s+Player ID into the redacted records/);
assert.match(runbook, /containing no Player\s+ID, provider credential, cookie, OTP, or HMAC token/);
assert.match(runbook, /root-only internal opaque\s+claim\/profile UUIDs/);
assert.match(runbook, /explicitly named root-only quarantine/);
assert.match(
  runbook,
  /redacted digest\/inode\s+evidence is append-only and never\s+deleted or rolled back/,
);
assert.match(
  runbook,
  /retired UUID-bound digest is preserved only as the\s+continuity proof and is never relabeled as belonging to the fresh UUID/,
);
assert.match(runbook, /derived under the fresh UUID from that same transient raw observation/);
assert.match(runbook, /Amount and\s+Transfer remain disabled/);
assert.match(runbook, /repository_owner='pay''relayy'/);
assert.match(runbook, /repository_name="\$repository_owner"/);
assert.match(
  runbook,
  /raw\.githubusercontent\.com\/\$repository_owner\/\$repository_name\/\$release/,
);
assert.match(runbook, /\[\[ "\$release" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
assert.match(runbook, /\[\[ ! -e "\$staging_root" && ! -L "\$staging_root" \]\]/);
assert.match(
  runbook,
  /full Git commit SHA is the non-circular content-addressed provenance anchor/,
);
assert.match(runbook, /sha256sum "\$staging_root\/fetanagent-staging-deploy-helper\.next"/);
assert.match(
  runbook,
  /bash "\$staging_root\/fetanagent-kemerbet-quarantine-recovery-v14\.sh"\s+\\\s+"\$release" "\$successor_sha"/,
);
assert.ok(
  packageJson.scripts['test:infra'].includes(
    'node infra/verify-kemerbet-quarantine-recovery-v14.mjs',
  ),
  'test:infra must run the H14 verifier',
);

const extractPythonHeredoc = (functionName, expectedArgumentBinding) => {
  const declaration = `${functionName}() {`;
  const functionStart = installer.indexOf(declaration);
  assert.ok(functionStart >= 0, `missing ${functionName}`);

  const afterDeclaration = functionStart + declaration.length;
  const nextFunctionOffset = installer
    .slice(afterDeclaration)
    .search(/\n[A-Za-z_][A-Za-z0-9_]*\(\) \{\n/);
  const functionEnd =
    nextFunctionOffset < 0 ? installer.length : afterDeclaration + nextFunctionOffset;
  const functionSource = installer.slice(functionStart, functionEnd);
  const heredocOpeners = [...functionSource.matchAll(/<<'PY'(?: \|\| return 1)?\n/g)];
  assert.equal(
    heredocOpeners.length,
    1,
    `${functionName} must contain exactly one supported Python heredoc`,
  );
  const heredocStart = functionStart + heredocOpeners[0].index;
  const sourceStart = heredocStart + heredocOpeners[0][0].length;
  const sourceEnd = installer.indexOf('\nPY\n', sourceStart);
  assert.ok(
    sourceEnd > sourceStart && sourceEnd < functionEnd,
    `unterminated ${functionName} Python heredoc`,
  );
  const source = installer.slice(sourceStart, sourceEnd);
  assert.ok(
    source.includes(expectedArgumentBinding),
    `${functionName} Python heredoc has an unexpected argument contract`,
  );
  return source;
};

if (process.platform === 'linux') {
  const predecessorRelease = '4239201b5496bd08912cce4b5581fe19b29a84d4';
  const successorRelease = 'a'.repeat(40);
  const recordName = 'empty-predecessor-checkpoint-adoption-v1';
  const sourceName = `.installing-${predecessorRelease}`;
  const targetName = `.installing-${successorRelease}`;
  const adoptionPython = extractPythonHeredoc(
    'adopt_exact_empty_predecessor_checkpoint',
    'parent, predecessor_release, successor_release, record_name = sys.argv[1:]',
  )
    .replaceAll('(0, 0, 0o700)', '(os.getuid(), os.getgid(), 0o700)')
    .replaceAll('(0, 0, 0o600, 1)', '(os.getuid(), os.getgid(), 0o600, 1)');
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-h14-empty-checkpoint-'));
  const expectedRecord = (value) =>
    Buffer.from(
      [
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-empty-checkpoint-adoption',
        'state=adoption-prepared',
        'same_inode_target_rename_authorized=true',
        'namespace_rename_pending_at_publication=true',
        `predecessor_recovery_release=${predecessorRelease}`,
        `successor_recovery_release=${successorRelease}`,
        `checkpoint_dev_ino=${value.dev}:${value.ino}`,
        `source_namespace=${sourceName}`,
        `target_namespace=${targetName}`,
        'durable_retirement_intent_present=false',
        'deployment_grant_changed=false',
        'helper_changed=false',
        'runtime_mutated=false',
        'financial_actions_mode=dry_run',
        'kemerbet_executor_enabled=false',
        'kemerbet_final_action_enabled=false',
        'amount_entry_enabled=false',
        'transfer_enabled=false',
        'money_moved=false',
        '',
      ].join('\n'),
      'ascii',
    );
  const makeCheckpoint = (name) => {
    const parent = join(fixtureRoot, name);
    const source = join(parent, sourceName);
    mkdirSync(parent, { mode: 0o700 });
    chmodSync(parent, 0o700);
    mkdirSync(source, { mode: 0o700 });
    chmodSync(source, 0o700);
    return { parent, source, sourceStat: statSync(source) };
  };
  const runAdoption = (parent) =>
    spawnSync(
      '/usr/bin/python3',
      ['-I', '-', parent, predecessorRelease, successorRelease, recordName],
      { encoding: 'utf8', input: adoptionPython },
    );
  const recordValidationPython = extractPythonHeredoc(
    'require_adopted_empty_checkpoint_record',
    'root, predecessor_release, successor_release, record_name = sys.argv[1:]',
  )
    .replaceAll('(0, 0, 0o700)', '(os.getuid(), os.getgid(), 0o700)')
    .replaceAll('(0, 0, 0o600, 1)', '(os.getuid(), os.getgid(), 0o600, 1)');
  const phasePython = extractPythonHeredoc(
    'classify_h14_base_phase',
    'root, adoption_name = sys.argv[1:]',
  );
  const runRecordValidation = (checkpoint) =>
    spawnSync(
      '/usr/bin/python3',
      ['-I', '-', checkpoint, predecessorRelease, successorRelease, recordName],
      { encoding: 'utf8', input: recordValidationPython },
    );
  const runPhaseClassification = (checkpoint) =>
    spawnSync('/usr/bin/python3', ['-I', '-', checkpoint, recordName], {
      encoding: 'utf8',
      input: phasePython,
    });

  const shellPrefixPython = extractPythonHeredoc(
    'publish_recovery_record',
    'path, mode_text, text = sys.argv[1:]',
  )
    .replaceAll('os.fchown(descriptor, 0, 0)', 'os.fchown(descriptor, os.getuid(), os.getgid())')
    .replaceAll('(0, 0, mode, 1)', '(os.getuid(), os.getgid(), mode, 1)')
    .replaceAll(
      '(before.st_dev, before.st_ino, 0, 0, mode, 1, len(data))',
      '(before.st_dev, before.st_ino, os.getuid(), os.getgid(), mode, 1, len(data))',
    );
  const forwardPython = extractPythonHeredoc(
    'run_forward_only_recovery',
    '    terminal_name,\n) = sys.argv[1:]',
  );
  const forwardPublicationFunctions = forwardPython.slice(
    forwardPython.indexOf('def reject():'),
    forwardPython.indexOf('\ndef exact_ascii_record('),
  );
  const pythonRecordHarness = `${['import os', 'import stat', '', forwardPublicationFunctions].join(
    '\n',
  )}\nroot, text, mode_text = __import__('sys').argv[1:]\npublish_record(root, 'record-v1', text.encode('ascii'), os.getuid(), os.getgid(), int(mode_text, 8))\n`;
  const helperPrefixPython = extractPythonHeredoc(
    'copy_helper_atomically',
    'source, partial, digest, source_mode_text = sys.argv[1:]',
  )
    .replaceAll('(0, 0, source_mode, 1)', '(os.getuid(), os.getgid(), source_mode, 1)')
    .replaceAll(
      'os.fchown(partial_descriptor, 0, 0)',
      'os.fchown(partial_descriptor, os.getuid(), os.getgid())',
    )
    .replaceAll(
      '(before.st_uid, before.st_gid, before.st_nlink) != (0, 0, 1)',
      '(before.st_uid, before.st_gid, before.st_nlink) != (os.getuid(), os.getgid(), 1)',
    )
    .replaceAll(
      '(before.st_dev, before.st_ino, 0, 0, partial_mode, 1, len(expected))',
      '(before.st_dev, before.st_ino, os.getuid(), os.getgid(), partial_mode, 1, len(expected))',
    );

  try {
    const shellPrefixRoot = join(fixtureRoot, 'shell-prefix');
    mkdirSync(shellPrefixRoot, { mode: 0o700 });
    const shellExpected = 'version=1\nstate=exact-prefix-resume\ntransfer_enabled=false\n';
    const shellPartial = join(shellPrefixRoot, '.record-v1.installing');
    writeFileSync(shellPartial, shellExpected.slice(0, 19), { mode: 0o600 });
    chmodSync(shellPartial, 0o600);
    let result = spawnSync('/usr/bin/python3', ['-I', '-', shellPartial, '600', shellExpected], {
      encoding: 'utf8',
      input: shellPrefixPython,
    });
    assert.equal(result.status, 0, `shell evidence prefix completion failed: ${result.stderr}`);
    assert.equal(readFileSync(shellPartial, 'ascii'), shellExpected);
    const shellForeign = join(shellPrefixRoot, '.foreign-v1.installing');
    writeFileSync(shellForeign, 'version=X\n', { mode: 0o600 });
    chmodSync(shellForeign, 0o600);
    const shellForeignBefore = readFileSync(shellForeign);
    result = spawnSync('/usr/bin/python3', ['-I', '-', shellForeign, '600', shellExpected], {
      encoding: 'utf8',
      input: shellPrefixPython,
    });
    assert.notEqual(result.status, 0, 'foreign shell evidence prefixes must fail closed');
    assert.deepEqual(readFileSync(shellForeign), shellForeignBefore);

    const pythonPrefixRoot = join(fixtureRoot, 'python-prefix');
    mkdirSync(pythonPrefixRoot, { mode: 0o700 });
    chmodSync(pythonPrefixRoot, 0o700);
    const pythonExpected = 'version=1\nstate=python-prefix-resume\nmoney_moved=false\n';
    const pythonPartial = join(pythonPrefixRoot, '.record-v1.installing');
    writeFileSync(pythonPartial, pythonExpected.slice(0, 23), { mode: 0o600 });
    chmodSync(pythonPartial, 0o600);
    result = spawnSync('/usr/bin/python3', ['-I', '-', pythonPrefixRoot, pythonExpected, '600'], {
      encoding: 'utf8',
      input: pythonRecordHarness,
    });
    assert.equal(result.status, 0, `Python evidence prefix completion failed: ${result.stderr}`);
    assert.equal(readFileSync(join(pythonPrefixRoot, 'record-v1'), 'ascii'), pythonExpected);
    assert.equal(readdirSync(pythonPrefixRoot).includes('.record-v1.installing'), false);
    const pythonForeignRoot = join(fixtureRoot, 'python-foreign-prefix');
    mkdirSync(pythonForeignRoot, { mode: 0o700 });
    chmodSync(pythonForeignRoot, 0o700);
    const pythonForeign = join(pythonForeignRoot, '.record-v1.installing');
    writeFileSync(pythonForeign, 'foreign\n', { mode: 0o600 });
    chmodSync(pythonForeign, 0o600);
    const pythonForeignBefore = readFileSync(pythonForeign);
    result = spawnSync('/usr/bin/python3', ['-I', '-', pythonForeignRoot, pythonExpected, '600'], {
      encoding: 'utf8',
      input: pythonRecordHarness,
    });
    assert.notEqual(result.status, 0, 'foreign Python evidence prefixes must fail closed');
    assert.deepEqual(readFileSync(pythonForeign), pythonForeignBefore);

    for (const [initializationName, initialMode] of [
      ['after-create-or-chown', 0o600],
      ['after-chmod', 0o640],
    ]) {
      const initializationRoot = join(fixtureRoot, `python-${initializationName}`);
      mkdirSync(initializationRoot, { mode: 0o700 });
      chmodSync(initializationRoot, 0o700);
      const initializationTemporary = join(initializationRoot, '.record-v1.installing');
      writeFileSync(initializationTemporary, Buffer.alloc(0), { mode: initialMode });
      chmodSync(initializationTemporary, initialMode);
      result = spawnSync(
        '/usr/bin/python3',
        ['-I', '-', initializationRoot, pythonExpected, '640'],
        { encoding: 'utf8', input: pythonRecordHarness },
      );
      assert.equal(
        result.status,
        0,
        `exact zero-byte ${initializationName} initialization must resume: ${result.stderr}`,
      );
      assert.equal(readFileSync(join(initializationRoot, 'record-v1'), 'ascii'), pythonExpected);
    }
    const foreignInitializationRoot = join(fixtureRoot, 'python-foreign-initialization');
    mkdirSync(foreignInitializationRoot, { mode: 0o700 });
    chmodSync(foreignInitializationRoot, 0o700);
    const foreignInitialization = join(foreignInitializationRoot, '.record-v1.installing');
    writeFileSync(foreignInitialization, Buffer.alloc(0), { mode: 0o644 });
    chmodSync(foreignInitialization, 0o644);
    result = spawnSync(
      '/usr/bin/python3',
      ['-I', '-', foreignInitializationRoot, pythonExpected, '640'],
      { encoding: 'utf8', input: pythonRecordHarness },
    );
    assert.notEqual(result.status, 0, 'a foreign zero-byte initialization mode must fail closed');
    assert.equal(statSync(foreignInitialization).mode & 0o777, 0o644);

    const helperPrefixRoot = join(fixtureRoot, 'helper-prefix');
    mkdirSync(helperPrefixRoot, { mode: 0o700 });
    const helperSource = join(helperPrefixRoot, 'helper.next');
    const helperPartial = join(helperPrefixRoot, '.helper.partial');
    const helperExpected = Buffer.from('#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n', 'ascii');
    const helperDigest = createHash('sha256').update(helperExpected).digest('hex');
    writeFileSync(helperSource, helperExpected, { mode: 0o600 });
    chmodSync(helperSource, 0o600);
    writeFileSync(helperPartial, helperExpected.subarray(0, 17), { mode: 0o600 });
    chmodSync(helperPartial, 0o600);
    result = spawnSync(
      '/usr/bin/python3',
      ['-I', '-', helperSource, helperPartial, helperDigest, '600'],
      { encoding: 'utf8', input: helperPrefixPython },
    );
    assert.equal(result.status, 0, `helper prefix completion failed: ${result.stderr}`);
    assert.deepEqual(readFileSync(helperPartial), helperExpected);
    chmodSync(helperPartial, 0o755);
    result = spawnSync(
      '/usr/bin/python3',
      ['-I', '-', helperSource, helperPartial, helperDigest, '600'],
      { encoding: 'utf8', input: helperPrefixPython },
    );
    assert.equal(result.status, 0, 'a fully written chmod-before-rename helper prefix must resume');
    const helperForeign = join(helperPrefixRoot, '.helper-foreign.partial');
    writeFileSync(helperForeign, Buffer.from('foreign', 'ascii'), { mode: 0o600 });
    chmodSync(helperForeign, 0o600);
    const helperForeignBefore = readFileSync(helperForeign);
    result = spawnSync(
      '/usr/bin/python3',
      ['-I', '-', helperSource, helperForeign, helperDigest, '600'],
      { encoding: 'utf8', input: helperPrefixPython },
    );
    assert.notEqual(result.status, 0, 'foreign helper prefixes must fail closed');
    assert.deepEqual(readFileSync(helperForeign), helperForeignBefore);

    const clean = makeCheckpoint('clean');
    result = runAdoption(clean.parent);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(clean.parent), [targetName]);
    const cleanTarget = join(clean.parent, targetName);
    const cleanTargetStat = statSync(cleanTarget);
    assert.equal(
      `${cleanTargetStat.dev}:${cleanTargetStat.ino}`,
      `${clean.sourceStat.dev}:${clean.sourceStat.ino}`,
    );
    assert.deepEqual(
      readFileSync(join(cleanTarget, recordName)),
      expectedRecord(clean.sourceStat),
      'the same checkpoint inode must carry its exact append-only adoption evidence',
    );
    result = runRecordValidation(cleanTarget);
    assert.equal(
      result.status,
      0,
      `a crash after source-to-target rename must resume: ${result.stderr}`,
    );
    result = runPhaseClassification(cleanTarget);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'adoption-only');
    const cleanFinal = join(clean.parent, successorRelease);
    renameSync(cleanTarget, cleanFinal);
    result = runRecordValidation(cleanFinal);
    assert.equal(
      result.status,
      0,
      `the same recorded inode must remain valid after final namespace rename: ${result.stderr}`,
    );
    assert.equal(statSync(cleanFinal).ino, clean.sourceStat.ino);

    const partial = makeCheckpoint('partial');
    const partialExpected = expectedRecord(partial.sourceStat);
    const partialPath = join(partial.source, `.${recordName}.installing`);
    writeFileSync(partialPath, partialExpected.subarray(0, 137), { mode: 0o600 });
    chmodSync(partialPath, 0o600);
    result = runAdoption(partial.parent);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      readFileSync(join(partial.parent, targetName, recordName)),
      partialExpected,
      'an exact temporary record prefix must append and rename forward without deletion',
    );
    result = runRecordValidation(join(partial.parent, targetName));
    assert.equal(result.status, 0, result.stderr);

    const prepared = makeCheckpoint('prepared');
    const preparedExpected = expectedRecord(prepared.sourceStat);
    writeFileSync(join(prepared.source, recordName), preparedExpected, { mode: 0o600 });
    chmodSync(join(prepared.source, recordName), 0o600);
    result = runAdoption(prepared.parent);
    assert.equal(
      result.status,
      0,
      `an exact pre-rename prepared record must resume: ${result.stderr}`,
    );

    const missing = makeCheckpoint('missing-record');
    result = runAdoption(missing.parent);
    assert.equal(result.status, 0, result.stderr);
    const missingTarget = join(missing.parent, targetName);
    rmSync(join(missingTarget, recordName));
    result = runRecordValidation(missingTarget);
    assert.notEqual(result.status, 0, 'a predeleted interrupted adoption record must fail closed');

    const predeletedFinal = makeCheckpoint('predeleted-final-record');
    result = runAdoption(predeletedFinal.parent);
    assert.equal(result.status, 0, result.stderr);
    const predeletedTarget = join(predeletedFinal.parent, targetName);
    const predeletedRoot = join(predeletedFinal.parent, successorRelease);
    renameSync(predeletedTarget, predeletedRoot);
    rmSync(join(predeletedRoot, recordName));
    result = runRecordValidation(predeletedRoot);
    assert.notEqual(result.status, 0, 'a predeleted final adoption record must fail closed');

    const malformed = makeCheckpoint('malformed-record');
    result = runAdoption(malformed.parent);
    assert.equal(result.status, 0, result.stderr);
    const malformedTarget = join(malformed.parent, targetName);
    writeFileSync(join(malformedTarget, recordName), 'state=adopted\n', { mode: 0o600 });
    chmodSync(join(malformedTarget, recordName), 0o600);
    result = runRecordValidation(malformedTarget);
    assert.notEqual(
      result.status,
      0,
      'a semantically false or truncated adoption record must fail closed',
    );

    const arbitrary = makeCheckpoint('arbitrary-prefix');
    result = runAdoption(arbitrary.parent);
    assert.equal(result.status, 0, result.stderr);
    const arbitraryTarget = join(arbitrary.parent, targetName);
    writeFileSync(join(arbitraryTarget, 'host-retired-v1'), 'foreign-subset\n', { mode: 0o600 });
    chmodSync(join(arbitraryTarget, 'host-retired-v1'), 0o600);
    result = runPhaseClassification(arbitraryTarget);
    assert.notEqual(
      result.status,
      0,
      'an arbitrary interrupted subset must fail phase classification',
    );

    const installingComplete = makeCheckpoint('installing-owner-restored-complete');
    result = runAdoption(installingComplete.parent);
    assert.equal(result.status, 0, result.stderr);
    const installingCompleteTarget = join(installingComplete.parent, targetName);
    for (const entry of [
      'runtime-retirement-intent-v1',
      'runtime-retired-v1',
      'intent-v1',
      'predecessor-helper',
      'retired-binding-v3',
      'player-stage-consumption-v1',
      'claim-stage-consumption-v1',
      'retired-retryable-failure-v1',
      'quarantined-profile-v1',
      'host-retired-v1',
      'owner-runtime-restored-v1',
    ]) {
      writeFileSync(join(installingCompleteTarget, entry), 'phase-fixture\n', { mode: 0o600 });
    }
    result = runPhaseClassification(installingCompleteTarget);
    assert.equal(
      result.status,
      0,
      `a crash after Owner-restored record publication but before root rename must classify: ${result.stderr}`,
    );
    assert.equal(result.stdout.trim(), 'complete');

    const emptyParent = join(fixtureRoot, 'empty-parent');
    mkdirSync(emptyParent, { mode: 0o700 });
    chmodSync(emptyParent, 0o700);
    result = runPhaseClassification(emptyParent);
    assert.notEqual(result.status, 0, 'an empty H14 parent must fail phase classification');
    result = runPhaseClassification(join(fixtureRoot, 'missing-parent'));
    assert.notEqual(result.status, 0, 'a missing H14 parent must fail phase classification');

    const foreign = makeCheckpoint('foreign');
    writeFileSync(join(foreign.source, 'foreign'), 'x', { mode: 0o600 });
    result = runAdoption(foreign.parent);
    assert.notEqual(result.status, 0, 'a foreign empty-checkpoint entry must fail closed');
    assert.deepEqual(readdirSync(foreign.parent), [sourceName]);
    assert.deepEqual(readdirSync(foreign.source), ['foreign']);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

for (const script of [helperPath, installerPath]) {
  const syntax = spawnSync('bash', ['-n', script], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(
    syntax.status,
    0,
    `bash syntax failed for ${script}: ${syntax.stderr || syntax.stdout}`,
  );
}

console.log(`KemerBet H14 quarantine-recovery contracts verified; helper ${helperSha256}.`);
