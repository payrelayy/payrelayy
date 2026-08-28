import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
assert.match(installer, /initial_grant_state='disabled-preintent'/);
assert.match(installer, /initial_grant_state='active-prefix-review-required'/);
assert.match(installer, /locked_grant_state='active'/);
assert.match(
  installer,
  /active:active\|active-prefix-review-required:active\|active-retired-review-required:active\|disabled-preintent:disabled\|disabled:disabled/,
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
const acceptsInstallerGrantPrefix = ({ h14State, grant, prefix, helper }) => {
  if (grant === 'disabled') {
    return ['absent', 'interrupted', 'retired'].includes(h14State);
  }
  if (grant !== 'active') return false;
  if (h14State === 'absent' || h14State === 'interrupted') {
    return prefix === 'exact-runtime-intent-only' && helper === 'predecessor';
  }
  return h14State === 'retired' && helper === 'successor';
};
for (const acceptedPrefix of [
  {
    h14State: 'absent',
    grant: 'active',
    prefix: 'exact-runtime-intent-only',
    helper: 'predecessor',
  },
  { h14State: 'absent', grant: 'disabled', prefix: 'none', helper: 'predecessor' },
  {
    h14State: 'interrupted',
    grant: 'active',
    prefix: 'exact-runtime-intent-only',
    helper: 'predecessor',
  },
  { h14State: 'interrupted', grant: 'disabled', prefix: 'later-exact', helper: 'predecessor' },
  { h14State: 'retired', grant: 'active', prefix: 'complete', helper: 'successor' },
  { h14State: 'retired', grant: 'disabled', prefix: 'complete', helper: 'predecessor' },
]) {
  assert.equal(acceptsInstallerGrantPrefix(acceptedPrefix), true);
}
for (const rejectedPrefix of [
  { h14State: 'interrupted', grant: 'active', prefix: 'later-exact', helper: 'predecessor' },
  {
    h14State: 'interrupted',
    grant: 'active',
    prefix: 'exact-runtime-intent-only',
    helper: 'foreign',
  },
  { h14State: 'retired', grant: 'active', prefix: 'complete', helper: 'predecessor' },
  { h14State: 'absent', grant: 'foreign', prefix: 'none', helper: 'predecessor' },
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
assert.match(runbook, /raw\.githubusercontent\.com\/payrelayy\/payrelayy\/\$release/);
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
