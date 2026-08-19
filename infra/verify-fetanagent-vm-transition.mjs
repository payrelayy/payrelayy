import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const transition = read('infra/operations/fetanagent-vm-transition.sh');
const runbook = read('infra/operations/fetanagent-vm-transition.md');
const deployHelper = read('infra/operations/fetanagent-staging-deploy-helper.sh');
const deployWorkflow = read('.github/workflows/staging-beta-deploy-smoke.yml');
const publicWorkflow = read('.github/workflows/staging-public-domain.yml');

const legacyBrand = 'pay' + 'replayy';
const legacyHelperSha = '4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69';
const legacySudoersSha = '34d408b7139c64888700ccd48f9b95dbe8ec5bfbae58d904ad2d10ffaaf2b928';
const baseHelperSha = 'e530efcc0781be8d298c0527f1a27bf1b7c97f9e0c9584adc0dd6ced0a7770af';
const baseReviewedCommit = 'e636de89be179514af3aae3972ee0b086cd8c816';
const dropletId = '590666364';
const transitionVersion = '1';

const functionBody = (source, name) => {
  const opening = `${name}() {`;
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, `Missing ${name} function.`);
  const bodyStart = start + opening.length;
  const end = source.indexOf('\n}\n', bodyStart);
  assert.notEqual(end, -1, `Unterminated ${name} function.`);
  return source.slice(bodyStart, end);
};

const assertInOrder = (source, needles, message) => {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${needle}`);
    assert.ok(next > cursor, message);
    cursor = next;
  }
};

const assertExactReceiptWriter = (body, marker, fields) => {
  const continueLine = (line) => `${line} ` + '\\';
  const expected = [
    continueLine(`write_marker \"$${marker}\"`),
    ...fields.map((field, index) =>
      index === fields.length - 1 ? `    ${field}` : continueLine(`    ${field}`),
    ),
  ].join('\n');
  assert.ok(body.includes(expected), `${marker} must be written with its exact schema.`);
};

assert.match(transition, /^#!\/usr\/bin\/env bash\r?$/m);
assert.match(transition, /set -euo pipefail/);
assert.match(transition, /readonly TRANSITION_VERSION='1'/);
assert.match(transition, /readonly DROPLET_ID='590666364'/);
assert.match(transition, /readonly PUBLIC_IPV4='178\.128\.39\.89'/);
assert.match(transition, /readonly TRANSITION_PATH='\/usr\/local\/sbin\/fetanagent-vm-transition'/);
assert.match(transition, /readonly LEGACY_BRAND='pay''replayy'/);
assert.match(transition, /readonly LEGACY_ADMIN="\$\{LEGACY_BRAND\}-admin"/);
assert.match(
  transition,
  /readonly LEGACY_HELPER="\/usr\/local\/sbin\/\$\{LEGACY_BRAND\}-staging-deploy-helper"/,
);
assert.match(
  transition,
  /readonly LEGACY_SUDOERS="\/etc\/sudoers\.d\/\$\{LEGACY_BRAND\}-staging-deploy"/,
  'The deployed legacy sudoers path must be assembled from the split legacy brand constant.',
);
assert.match(
  deployHelper,
  /readonly LEGACY_SUDOERS="\/etc\/sudoers\.d\/\$\{LEGACY_BRAND\}-staging-deploy"/,
  'The final helper must prove absence of the same one fixed legacy sudoers path.',
);
assert.doesNotMatch(
  transition,
  new RegExp(legacyBrand, 'u'),
  'The forbidden legacy brand literal must not be reintroduced into the transition source.',
);
assert.doesNotMatch(
  deployHelper,
  /LEGACY_SUDOERS_[A-Z]/u,
  'The final helper must not retain speculative legacy sudoers path variants.',
);
assert.match(transition, new RegExp(`readonly LEGACY_HELPER_SHA='${legacyHelperSha}'`));
assert.match(transition, /readonly NEW_ADMIN='fetanagent-admin'/);
assert.match(
  transition,
  /readonly NEW_HELPER='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'/,
);
assert.match(transition, new RegExp(`readonly NEW_HELPER_SHA='${baseHelperSha}'`));
const expectedRotatedHelperSha = createHash('sha256')
  .update(deployHelper.replaceAll('\r\n', '\n'))
  .digest('hex');
assert.match(
  transition,
  new RegExp(`readonly ROTATED_HELPER_SHA='${expectedRotatedHelperSha}'`),
  'The transition must pin the normalized LF SHA-256 of the rotated deploy helper.',
);
assert.match(transition, new RegExp(`readonly BASE_REVIEWED_COMMIT='${baseReviewedCommit}'`));
assert.match(transition, /readonly STATE_ROOT='\/var\/lib\/fetanagent-vm-transition'/);
for (const [name, suffix] of [
  ['PREPARED_MARKER', 'prepared-v1'],
  ['ACKNOWLEDGED_MARKER', 'acknowledged-v1'],
  ['LEGACY_STOPPED_MARKER', 'legacy-stopped-v1'],
  ['RETIRED_MARKER', 'retired-v1'],
  ['HELPER_ROTATION_MARKER', 'helper-rotation-v1'],
]) {
  assert.match(transition, new RegExp(`readonly ${name}=\"\\$STATE_ROOT/${suffix}\"`));
}

const rootConsole = functionBody(transition, 'require_root_console');
assert.match(rootConsole, /\[\[ \$EUID -eq 0 \]\]/);
assert.match(rootConsole, /\$\{SUDO_USER:-\}/);
assert.match(rootConsole, /readlink -f -- "\$0"/);
assert.match(rootConsole, /root:root:700/);
assert.doesNotMatch(transition, /NOPASSWD:[^\n]*fetanagent-vm-transition/);

const dropletGate = functionBody(transition, 'require_exact_droplet');
assert.match(transition, /readonly METADATA_ROOT='http:\/\/169\.254\.169\.254\/metadata\/v1'/);
assert.match(dropletGate, /curl --fail --silent --show-error --noproxy '\*' --max-time 3/);
assert.match(dropletGate, /"\$METADATA_ROOT\/id"/);
assert.match(dropletGate, /"\$METADATA_ROOT\/interfaces\/public\/0\/ipv4\/address"/);
assert.equal(
  (transition.match(/\bcurl\b/g) ?? []).length,
  4,
  'Only the two command allowlist references and two fixed metadata reads may use curl.',
);
assert.deepEqual(
  [...transition.matchAll(/https?:\/\/[^'"\s]+/g)].map((match) => match[0]),
  ['http://169.254.169.254/metadata/v1'],
  'The transition must not contact any endpoint except fixed link-local Droplet metadata.',
);

const writeMarker = functionBody(transition, 'write_marker');
assertInOrder(
  writeMarker,
  [
    'mktemp "$STATE_ROOT/.marker.XXXXXX"',
    "printf '%s\\n'",
    'chown root:root',
    'chmod 0600',
    'mv -f --',
    "'root:root:600'",
  ],
  'Transition receipts must be atomically sealed before validation',
);
const exactMarker = functionBody(transition, 'require_exact_marker');
assertInOrder(
  exactMarker,
  [
    'require_regular_metadata "$marker"',
    'temporary="$(mktemp)"',
    'printf \'%s\\n\' "$@"',
    'cmp -s -- "$temporary" "$marker"',
  ],
  'Every transition receipt must exactly equal its declared ordered schema',
);
const markerField = functionBody(transition, 'marker_field');
assertInOrder(
  markerField,
  ['grep -c "^${key}="', '[[ "$count" -eq 1', 'sed -n "s/^${key}=//p"'],
  'Dynamic receipt fields must be unique before use',
);

const main = functionBody(transition, 'main');
const commandCase = /case "\$command" in([\s\S]*?)\n\s*esac/u.exec(main)?.[1];
assert.ok(commandCase, 'The transition must use an explicit command allowlist.');
for (const [command, count] of [
  ['inspect', 1],
  ['prepare', 1],
  ['acknowledge', 2],
  ['mark-legacy-stopped', 2],
  ['rollback-prepare', 1],
  ['retire', 2],
  ['rotate-retired-helper', 3],
  ['finalize-retired-helper', 3],
  ['verify', 1],
]) {
  const arm = new RegExp(`(?:^|\\n)\\s*${command}\\)([\\s\\S]*?)\\n\\s*;;`, 'u').exec(
    commandCase,
  )?.[1];
  assert.ok(arm, `Missing ${command} command arm.`);
  assert.match(arm, new RegExp(`\\[\\[ \\$# -eq ${count}`));
}
assert.match(transition, /\^\[0-9a-f\]\{40\}\$/);

const inspect = functionBody(transition, 'inspect_transition');
assert.doesNotMatch(
  inspect,
  /\b(?:rm|mv|cp|install|chmod|chown|useradd|usermod|userdel|passwd|pkill|touch|truncate)\b|systemctl\s+(?:start|stop|restart|enable|disable)|docker_local\s+(?:rm|stop|kill|prune)/,
  'Inspect mode must remain read-only.',
);
assert.doesNotMatch(
  inspect,
  /authorized_keys[^\n]*(?:cat|sed|awk)|cat[^\n]*(?:secret|authorized_keys)/i,
);
assert.match(
  inspect,
  /require_legacy_sudoers_boundary/,
  'Before the stopped receipt, inspection must require the exact live sudoers boundary to be present.',
);

const prepare = functionBody(transition, 'prepare_transition');
assertInOrder(
  prepare,
  [
    'require_legacy_identity',
    'require_legacy_helper',
    'require_legacy_authorized_keys',
    'require_legacy_sudoers_boundary',
    'visudo -cf /etc/sudoers',
    'useradd --create-home',
    'expected_new_sudoers',
    'visudo -cf "$temporary"',
    'visudo -cf /etc/sudoers',
    'sshd -t',
    'require_effective_new_sshd_policy',
    'systemctl reload ssh',
    'require_effective_new_sshd_policy',
    'write_marker "$PREPARED_MARKER"',
  ],
  'Preparation must validate inputs and sudoers before sealing its receipt',
);
assert.match(
  prepare,
  /useradd --create-home --home-dir "\$NEW_HOME" --shell \/bin\/bash --user-group/,
);
assert.doesNotMatch(prepare, /usermod[^\n]*(?:docker|sudo)|groupadd[^\n]*(?:docker|sudo)/);
const helperSource = functionBody(transition, 'require_new_helper_source');
assert.notEqual(
  helperSource.trim(),
  'require_new_helper_source',
  'The staged helper validator must not recursively call itself.',
);
assert.doesNotMatch(
  helperSource,
  /\brequire_new_helper_source\b/,
  'The staged helper validator must never call itself.',
);
assertInOrder(
  helperSource,
  [
    'require_regular_metadata "$NEW_HELPER_SOURCE" \'root:root:600\'',
    'sha256sum "$NEW_HELPER_SOURCE"',
    '"$NEW_HELPER_SHA"',
  ],
  'The staged helper source must be a pinned root-only regular file',
);

const newSshdDropin = functionBody(transition, 'expected_new_sshd_dropin');
assert.match(newSshdDropin, /AllowTcpForwarding local/u);
assert.match(newSshdDropin, /PermitOpen 127\.0\.0\.1:3002/u);
assert.match(newSshdDropin, /AllowAgentForwarding no/u);
assert.match(newSshdDropin, /AllowStreamLocalForwarding no/u);
assert.match(newSshdDropin, /GatewayPorts no/u);
assert.match(newSshdDropin, /PermitTunnel no/u);
assert.doesNotMatch(
  newSshdDropin,
  /PermitUserEnvironment/u,
  'The generated Match block must not contain a keyword OpenSSH rejects in that context.',
);
const strandedSshdDropin = functionBody(transition, 'expected_stranded_new_sshd_dropin');
assert.equal(
  strandedSshdDropin.replace('    PermitUserEnvironment no\n', ''),
  newSshdDropin,
  'The rollback-only stranded contract must differ solely by the rejected Match keyword.',
);
assert.equal(
  (strandedSshdDropin.match(/PermitUserEnvironment no/gu) ?? []).length,
  1,
  'The rollback-only stranded contract must identify exactly the known invalid line.',
);
const rollbackSshdDropin = functionBody(transition, 'require_exact_rollback_new_sshd_dropin');
assertInOrder(
  rollbackSshdDropin,
  [
    'require_regular_metadata "$NEW_SSHD_DROPIN" \'root:root:644\'',
    'matches_exact_stranded_new_sshd_dropin',
    'require_exact_new_sshd_dropin',
  ],
  'Rollback must accept only the current or exact stranded owned SSH fragment',
);
const effectiveSshdPolicy = functionBody(transition, 'require_effective_new_sshd_policy');
assert.match(
  effectiveSshdPolicy,
  /sshd -T -C "user=\$NEW_ADMIN,host=localhost,addr=127\.0\.0\.1"/u,
);
assertInOrder(
  effectiveSshdPolicy,
  [
    'key="${expected%% *}"',
    'awk -v key="$key"',
    '[[ "$count" -eq 1 ]]',
    'grep -Fxq -- "$expected"',
  ],
  'The effective SSH policy must require one exact value for every security key',
);
for (const expected of [
  'permituserenvironment no',
  'authenticationmethods publickey',
  'pubkeyauthentication yes',
  'passwordauthentication no',
  'kbdinteractiveauthentication no',
  'permitemptypasswords no',
  'allowagentforwarding no',
  'allowstreamlocalforwarding no',
  'allowtcpforwarding local',
  'disableforwarding no',
  'permitopen 127.0.0.1:3002',
  'gatewayports no',
  'permittunnel no',
  'permittty no',
  'x11forwarding no',
]) {
  assert.ok(effectiveSshdPolicy.includes(expected), `Effective SSH policy missing ${expected}.`);
}
const newAccessFiles = functionBody(transition, 'require_new_access_files');
assertInOrder(
  newAccessFiles,
  ['require_exact_new_sshd_dropin', 'sshd -t', 'require_effective_new_sshd_policy'],
  'Prepared access validation must prove syntax before the effective user policy',
);

const legacySudoersReferences = functionBody(transition, 'legacy_sudoers_references');
assert.ok(
  legacySudoersReferences.includes('for candidate in /etc/sudoers "$LEGACY_SUDOERS"; do'),
  'The exact deployed legacy fragment must be included in the fixed sudoers reference inventory.',
);
assert.ok(
  legacySudoersReferences.includes('if [[ "$candidate" == "$LEGACY_SUDOERS" ]]; then'),
  'The fixed legacy fragment must be inventoried regardless of its current content.',
);
assert.ok(
  legacySudoersReferences.includes('"$LEGACY_SUDOERS") continue ;;'),
  'Only the one proven legacy sudoers path may bypass the unknown-fragment scan.',
);
const expectedLegacySudoers = functionBody(transition, 'expected_legacy_sudoers');
const observedLegacySudoersBytes = `${legacyBrand}-admin ALL=(root) NOPASSWD: /usr/local/sbin/${legacyBrand}-staging-deploy-helper\n`;
assert.equal(
  createHash('sha256').update(observedLegacySudoersBytes).digest('hex'),
  legacySudoersSha,
  'The exact observed one-line LF sudoers contract must retain its reviewed digest.',
);
assert.equal(
  expectedLegacySudoers.trim(),
  ['cat <<EOF', '$LEGACY_ADMIN ALL=(root) NOPASSWD: $LEGACY_HELPER', 'EOF'].join('\n'),
  'The fixed fragment must accept only the one exact observed command contract.',
);
assert.doesNotMatch(
  expectedLegacySudoers,
  /\*|Defaults:/u,
  'The fixed fragment must not accept any token absent from the observed contract.',
);
const legacySudoersState = functionBody(transition, 'require_legacy_sudoers_state');
assertInOrder(
  legacySudoersState,
  [
    'expected_legacy_sudoers >"$temporary"',
    '"$LEGACY_SUDOERS")',
    'require_regular_metadata "$reference" \'root:root:440\'',
    'cmp -s -- "$temporary" "$reference"',
  ],
  'The deployed fixed fragment must be compared with its exact contract before it is accepted',
);
const disableLegacySudoers = functionBody(transition, 'disable_legacy_execution_boundary');
assertInOrder(
  disableLegacySudoers,
  [
    'require_legacy_sudoers_boundary_or_absent',
    'require_legacy_authorized_keys_present_or_absent',
    'if [[ -e "$LEGACY_SUDOERS" || -L "$LEGACY_SUDOERS" ]]',
    'require_legacy_sudoers_boundary',
    'rm -f -- "$LEGACY_SUDOERS"',
    'visudo -cf /etc/sudoers',
  ],
  'Only the fixed fragment may be deleted, after every removable access artifact is prevalidated',
);

const markStopped = functionBody(transition, 'mark_legacy_stopped');
assertInOrder(
  markStopped,
  [
    'require_prepared_contract',
    'require_acknowledged_marker',
    'require_legacy_residue_absent',
    'require_port_3002_free',
    'disable_legacy_execution_boundary',
    'require_legacy_residue_absent',
    'require_port_3002_free',
    'require_legacy_execution_boundary_disabled',
    'write_marker "$LEGACY_STOPPED_MARKER"',
  ],
  'Legacy runtime absence and execution-access retirement must precede the stopped receipt',
);
const markStoppedAlreadyComplete =
  /if \[\[ -e "\$LEGACY_STOPPED_MARKER" \]\]; then([\s\S]*?)\n\s*fi/u.exec(markStopped)?.[1];
assert.ok(markStoppedAlreadyComplete, 'Stopped-phase resume path must be explicit.');
assertInOrder(
  markStoppedAlreadyComplete,
  [
    'require_legacy_stopped_marker',
    'require_legacy_residue_absent',
    'require_legacy_execution_boundary_disabled',
  ],
  'A stopped receipt must never substitute for live access-boundary verification',
);

const rollback = functionBody(transition, 'rollback_prepare');
assert.match(rollback, /rollback-prepare is forbidden after the legacy-stopped boundary/);
assert.match(rollback, /validate_rollback_prepare_state/);
assertInOrder(
  rollback,
  [
    'validate_rollback_prepare_state',
    'rm -f -- "$ACKNOWLEDGED_MARKER" "$PREPARED_MARKER"',
    'rm -f -- "$NEW_SSHD_DROPIN"',
    'rm -f -- "$NEW_SUDOERS"',
    'rm -f -- "$NEW_HELPER"',
    'userdel --remove "$NEW_ADMIN"',
  ],
  'Rollback must prevalidate, invalidate receipts, then remove only prepared access artifacts',
);
assert.doesNotMatch(rollback, /LEGACY_HELPER[^\n]*rm|rm[^\n]*LEGACY_HELPER/);
const rollbackValidator = functionBody(transition, 'validate_rollback_prepare_state');
assertInOrder(
  rollbackValidator,
  [
    'require_no_new_runtime_artifacts',
    'require_legacy_authorized_keys',
    'require_legacy_sudoers_boundary',
    'if [[ -e "$PREPARED_MARKER"',
    'require_prepared_contract',
    'else',
    'require_partial_new_identity',
    'require_new_helper',
    'require_exact_new_sudoers',
    'require_exact_rollback_new_sshd_dropin',
    'matches_exact_stranded_new_sshd_dropin',
    'require_new_helper_source',
    'if [[ "$stranded_sshd_dropin" != \'true\' ]]',
    'sshd -t',
  ],
  'Rollback must safely recognize both complete and interrupted preparation',
);
assertInOrder(
  rollback,
  ['require_exact_rollback_new_sshd_dropin', 'rm -f -- "$NEW_SSHD_DROPIN"', 'reload_sshd'],
  'Rollback must validate the exact owned fragment before removal and validate restored SSH before reload',
);
assert.match(
  runbook,
  /Local forwarding\s+remains restricted to `127\.0\.0\.1:3002` by `AllowTcpForwarding local` and the exact `PermitOpen`/u,
);
const partialIdentity = functionBody(transition, 'require_partial_new_identity');
assert.match(partialIdentity, /unexpected partial FetanAgent SSH artifact/);
assert.match(partialIdentity, /cmp -s -- "\$\(legacy_authorized_keys\)" "\$authorized_keys"/);
assert.doesNotMatch(partialIdentity, /\b(?:userdel|usermod|install|chown|chmod)\b/);
assert.deepEqual(
  [...partialIdentity.matchAll(/\brm\s+[^\n]+/gu)].map((match) => match[0]),
  ['rm -f -- "$ssh_listing"', 'rm -f -- "$ssh_listing"'],
  'Partial identity inspection may remove only its own temporary inventory file.',
);

const retire = functionBody(transition, 'retire_legacy_boundary');
assertInOrder(
  retire,
  [
    'require_prepared_contract',
    'require_acknowledged_marker',
    'require_legacy_stopped_marker',
    'require_legacy_residue_absent',
    'require_new_runtime_healthy',
    'disable_legacy_execution_boundary',
    'require_legacy_execution_boundary_disabled',
    'write_marker "$RETIRED_MARKER"',
  ],
  'Retirement must resumably seal legacy access after exact private runtime smoke',
);
assert.match(retire, /require_legacy_helper[\s\S]*?rm -f -- "\$LEGACY_HELPER"/);
assert.doesNotMatch(retire, /rm -rf|docker_local\s+(?:rm|stop|kill|prune)/);
const retireAlreadyComplete = /if \[\[ -e "\$RETIRED_MARKER" \]\]; then([\s\S]*?)\n\s*fi/u.exec(
  retire,
)?.[1];
assert.ok(retireAlreadyComplete, 'Retirement resume path must be explicit.');
assert.match(
  retireAlreadyComplete,
  /verify_retired_contract "\$commit_sha"/,
  'An existing retirement receipt must trigger the complete live contract, not a receipt-only check.',
);
const disableLegacyAccess = functionBody(transition, 'disable_legacy_execution_boundary');
assertInOrder(
  disableLegacyAccess,
  [
    'require_legacy_identity_for_disable',
    'require_legacy_sudoers_boundary_or_absent',
    'require_legacy_authorized_keys_present_or_absent',
    'require_legacy_sudoers_boundary',
    'rm -f -- "$LEGACY_SUDOERS"',
    'visudo -cf /etc/sudoers',
    'rm -f -- "$authorized_keys"',
    'usermod --lock --shell /usr/sbin/nologin "$LEGACY_ADMIN"',
    'pkill -KILL -u "$legacy_uid"',
    'require_legacy_execution_boundary_disabled',
  ],
  'Legacy access disable must prevalidate and converge idempotently to a sealed boundary',
);
const disabledLegacyAccess = functionBody(transition, 'require_legacy_execution_boundary_disabled');
assertInOrder(
  disabledLegacyAccess,
  [
    'require_legacy_sudoers_absent',
    'require_legacy_authorized_keys_absent',
    'require_legacy_identity_disabled',
  ],
  'The transition live disabled-access contract must cover sudo, SSH keys, and login/process state',
);

const retiredFields = [
  '"transition_version=$TRANSITION_VERSION"',
  '"droplet_id=$DROPLET_ID"',
  '"legacy_helper_sha=$LEGACY_HELPER_SHA"',
  '"new_helper_sha=$NEW_HELPER_SHA"',
  '"acknowledged_commit=$commit_sha"',
  "'retired=true'",
];
assertExactReceiptWriter(retire, 'RETIRED_MARKER', retiredFields);
const retiredValidator = functionBody(transition, 'require_retired_marker');
assertInOrder(
  retiredValidator,
  ['require_exact_marker "$RETIRED_MARKER"', ...retiredFields],
  'The retired receipt validator must require the exact written schema',
);

const baseRotationBoundary = functionBody(transition, 'require_base_retired_overlay_boundary');
assertInOrder(
  baseRotationBoundary,
  [
    '[[ "$old_commit" == "$BASE_REVIEWED_COMMIT" ]]',
    'require_prepared_marker',
    'require_acknowledged_marker "$old_commit"',
    'require_legacy_stopped_marker "$old_commit"',
    'require_retired_marker "$old_commit"',
    'require_new_identity',
    'require_exact_new_sshd_dropin',
    'require_legacy_residue_absent',
    'require_legacy_execution_boundary_disabled',
    '[[ ! -e "$LEGACY_HELPER"',
    'require_legacy_secret_root_absent',
  ],
  'Helper rotation must start from every exact immutable receipt and the full retired live boundary',
);

const writeRotationMarker = functionBody(transition, 'write_helper_rotation_marker');
assertInOrder(
  writeRotationMarker,
  [
    'write_marker "$HELPER_ROTATION_MARKER"',
    'transition_version=$TRANSITION_VERSION',
    'droplet_id=$DROPLET_ID',
    'old_helper_sha=$NEW_HELPER_SHA',
    'new_helper_sha=$ROTATED_HELPER_SHA',
    'old_reviewed_commit=$old_commit',
    'new_reviewed_commit=$new_commit',
    'rotation_$state=true',
  ],
  'The helper-rotation overlay must have one exact commit- and helper-bound schema',
);
const rotationMarkerState = functionBody(transition, 'helper_rotation_marker_state');
assertInOrder(
  rotationMarkerState,
  [
    'old_helper_sha=$NEW_HELPER_SHA',
    'new_helper_sha=$ROTATED_HELPER_SHA',
    'old_reviewed_commit=$old_commit',
    'new_reviewed_commit=$new_commit',
    'rotation_pending=true',
    "printf 'pending'",
    'rotation_complete=true',
    "printf 'complete'",
  ],
  'Overlay inspection must accept only the exact pending or complete receipts',
);

const rotationState = functionBody(transition, 'helper_rotation_state');
assertInOrder(
  rotationState,
  [
    '[[ "$helper_sha" == "$ROTATED_HELPER_SHA" ]]',
    'marker_state="$(helper_rotation_marker_state "$old_commit" "$new_commit")"',
    '"$NEW_HELPER_SHA") printf \'initial\'',
    '"$ROTATED_HELPER_SHA") printf \'helper-installed\'',
    "die 'the installed helper is not an allowed helper-rotation prefix'",
  ],
  'Interrupted rotation must classify only initial, helper-installed, pending, or complete prefixes',
);

const publicEdgeAbsent = functionBody(transition, 'require_public_edge_absent');
assertInOrder(
  publicEdgeAbsent,
  [
    'label=com.docker.compose.service=gateway',
    '[[ -z "$gateway_containers" ]]',
    'ss -ltnH',
    '/:(80|443)$/',
    '[[ ! -e "$GATEWAY_STATE_ROOT" && ! -L "$GATEWAY_STATE_ROOT" ]]',
  ],
  'Every unpublished rotation mutation must prove gateway, state root, and ports 80/443 are absent',
);
const privateRotationBoundary = functionBody(transition, 'require_rotation_private_boundary');
assertInOrder(
  privateRotationBoundary,
  ['require_public_edge_absent', 'require_rotation_live_boundary "$@"'],
  'The mutation boundary must prove public-edge absence before the exact helper/runtime contract',
);

const rotatedRuntime = functionBody(transition, 'require_new_runtime_healthy');
assert.match(rotatedRuntime, /owner-control:private-or-public/);
assert.match(rotatedRuntime, /gateway\\nowner-control:private-or-public/);
assert.match(rotatedRuntime, /expected_services\+=\(gateway\)/);
assert.match(rotatedRuntime, /service set is not exact for the required runtime mode/);
assertInOrder(
  rotatedRuntime,
  [
    '[[ "$ids" =~ ^[0-9a-f]{12,64}$ ]]',
    '[[ "$state" == \'running\' ]]',
    'org.opencontainers.image.revision',
    '[[ "$revision" == "$commit_sha" ]]',
    '[[ "$health" == \'healthy\' ]]',
  ],
  'Completed inspection may classify one exact gateway but must validate every classified service',
);
const rotationLiveBoundary = functionBody(transition, 'require_rotation_live_boundary');
assert.doesNotMatch(rotationLiveBoundary, /require_public_edge_absent/);
assertInOrder(
  rotationLiveBoundary,
  [
    'require_base_retired_overlay_boundary "$old_commit"',
    'require_rotated_helper_source',
    'complete) require_rotated_helper',
    '[[ "$runtime_commit" == "$new_commit" ]]',
    'require_new_runtime_healthy "$runtime_commit" private-or-public',
    'require_new_runtime_healthy "$runtime_commit" private',
  ],
  'The core completed contract must validate C1 while allowing only exact private or classified public service sets',
);

const rotateHelper = functionBody(transition, 'rotate_retired_helper');
assert.doesNotMatch(rotateHelper, /\btrap\b/);
const rotateMutation = rotateHelper.slice(
  rotateHelper.indexOf('require_new_sudoers_state present-or-absent'),
);
assertInOrder(
  rotateMutation,
  [
    'require_rotation_private_boundary "$state" "$old_commit" "$new_commit"',
    'disable_new_deploy_sudoers',
    'require_no_new_helper_processes',
    'require_rotation_private_boundary "$state" "$old_commit" "$new_commit"',
    'install_exact_file "$NEW_HELPER_SOURCE" "$NEW_HELPER" 0755',
    'helper-installed',
    'write_helper_rotation_marker pending "$old_commit" "$new_commit"',
    'require_rotation_private_boundary pending "$old_commit" "$new_commit"',
    'restore_new_deploy_sudoers',
    'require_new_sudoers_state present',
    'require_rotation_private_boundary pending "$old_commit" "$new_commit"',
  ],
  'Rotation must seal sudo, install H1, receipt pending, fully validate, then restore exact sudo',
);
const pendingResume = /if \[\[ "\$state" == 'pending' \]\]; then([\s\S]*?)\n\s*fi/u.exec(
  rotateHelper,
)?.[1];
assert.ok(pendingResume, 'Rotation must have an explicit pending resume branch.');
assertInOrder(
  pendingResume,
  [
    'require_rotation_private_boundary pending',
    'require_no_new_helper_processes',
    'require_rotation_private_boundary pending',
    'restore_new_deploy_sudoers',
  ],
  'A pending resume may restore sudo only after the exact unpublished state validates twice',
);

const finalizeHelper = functionBody(transition, 'finalize_retired_helper');
assert.doesNotMatch(finalizeHelper, /\btrap\b/);
const finalizeMutation = finalizeHelper.slice(
  finalizeHelper.indexOf('require_rotation_private_boundary pending'),
);
assertInOrder(
  finalizeMutation,
  [
    'require_rotation_private_boundary pending "$old_commit" "$new_commit"',
    '[[ "$(rotation_runtime_commit)" == "$new_commit" ]]',
    'disable_new_deploy_sudoers',
    'require_no_new_helper_processes',
    'require_rotation_private_boundary pending "$old_commit" "$new_commit"',
    '[[ "$(rotation_runtime_commit)" == "$new_commit" ]]',
    'write_helper_rotation_marker complete "$old_commit" "$new_commit"',
    'require_rotation_private_boundary complete "$old_commit" "$new_commit"',
    'restore_new_deploy_sudoers',
    'require_new_sudoers_state present',
    'require_rotation_private_boundary complete "$old_commit" "$new_commit"',
  ],
  'Finalization must recheck exact C1 under sealed sudo, write complete last, validate, and only then restore sudo',
);
assert.doesNotMatch(
  `${rotateHelper}\n${finalizeHelper}`,
  /write_marker "\$(?:PREPARED|ACKNOWLEDGED|LEGACY_STOPPED|RETIRED)_MARKER"/,
  'Rotation must never rewrite an immutable v1 transition receipt',
);

const inspectRotation = functionBody(transition, 'inspect_helper_rotation');
assertInOrder(
  inspectRotation,
  [
    'require_rotation_live_boundary "$state"',
    '[[ "$state" != \'complete\' ]]',
    'require_public_edge_absent',
    'complete:present)',
    'public_edge=managed-separately',
  ],
  'Pending inspection must require an unpublished edge while completed inspection permits classified publication',
);

assert.doesNotMatch(
  transition,
  /\bwget\b|\bgit\s+(?:clone|fetch|pull)|\.env\b|docker\s+(?:system|container|network)\s+prune|NOPASSWD:\s*(?:ALL|\/bin\/bash|\/usr\/bin\/docker)|usermod[^\n]*(?:\bdocker\b|\bsudo\b)|service_role|FINANCIAL_ACTIONS_MODE=live|xzztugbgtulptnbpoelr/i,
);
assert.doesNotMatch(transition, /cat[^\n]*(?:secret|token|password)|set\s+-x/i);

const transitionLegacyResidue = functionBody(transition, 'require_legacy_residue_absent');
assert.match(
  transitionLegacyResidue,
  /systemctl list-units --all --full --plain --no-legend --no-pager/,
);
assert.match(
  transitionLegacyResidue,
  /systemctl list-unit-files --full --plain --no-legend --no-pager/,
);

assert.match(deployHelper, /readonly EXPECTED_SUDO_USER='fetanagent-admin'/);
assert.match(deployHelper, /readonly LEGACY_BRAND='pay''replayy'/);
assert.match(deployHelper, /readonly LEGACY_PROJECT_NAME="\$\{LEGACY_BRAND\}-staging-beta"/);
assert.match(
  deployHelper,
  /readonly LEGACY_SECRET_ROOT="\/srv\/\$\{LEGACY_BRAND\}\/secrets\/staging"/,
);
assert.match(deployHelper, /readonly LEGACY_SYSTEMD_MARKER="\$LEGACY_BRAND"/);
assert.match(
  deployHelper,
  /readonly LEGACY_STOPPED_RECEIPT='\/var\/lib\/fetanagent-vm-transition\/legacy-stopped-v1'/,
);
assert.match(
  deployHelper,
  /readonly TRANSITION_RECEIPT='\/var\/lib\/fetanagent-vm-transition\/retired-v1'/,
);
assert.match(deployHelper, /readonly TRANSITION_VERSION='1'/);
assert.match(deployHelper, /readonly STAGING_DROPLET_ID='590666364'/);
assert.match(deployHelper, /readonly FRESH_STAGING_DROPLET_ID='593344964'/);
assert.match(deployHelper, /readonly FRESH_PUBLIC_IPV4='161\.35\.41\.232'/);
assert.match(deployHelper, new RegExp(`readonly LEGACY_HELPER_SHA='${legacyHelperSha}'`));

const cutoverReady = functionBody(deployHelper, 'require_cutover_ready');
assert.match(cutoverReady, /label=com\.docker\.compose\.project=\$LEGACY_PROJECT_NAME/g);
assert.match(cutoverReady, /systemctl list-units --all --full --plain --no-legend --no-pager/);
assert.match(cutoverReady, /systemctl list-unit-files --full --no-legend --no-pager/);
assert.match(cutoverReady, /find "\$LEGACY_SECRET_ROOT" -mindepth 1 -print -quit/);
assert.doesNotMatch(cutoverReady, /\b(?:rm|rmdir|mv|stop|disable|kill|prune)\b/);
const helperPortFree = functionBody(deployHelper, 'require_port_3002_free');
assert.match(helperPortFree, /ss -ltnH/);
assert.match(helperPortFree, /:3002\$/);
assert.doesNotMatch(helperPortFree, /\b(?:rm|rmdir|mv|stop|disable|kill|prune)\b/);

const assertReceiptGate = (body, receipt, fields) => {
  assert.match(body, new RegExp(`! -L \"\\$${receipt}\"`));
  assert.match(body, new RegExp(`-f \"\\$${receipt}\"`));
  assert.match(body, /root:root:600/);
  for (const field of fields) assert.ok(body.includes(field), `Receipt gate missing ${field}.`);
  const exactComparison = `cmp -s -- "$${receipt}" <(printf '%s\\n'`;
  if (body.includes(exactComparison)) {
    assertInOrder(
      body,
      [exactComparison, ...fields],
      `${receipt} must exactly equal its ordered six-line schema`,
    );
  } else {
    assert.match(body, /awk 'END \{ print NR \+ 0 \}'/);
    assert.match(body, /\[\[ "\$line_count" == '6' \]\]/);
    assert.match(body, /key_count/);
    assert.match(body, /exact_count/);
    assert.match(body, /\[\[ "\$key_count" == '1' && "\$exact_count" == '1' \]\]/);
  }
};

const baseStoppedReceipt = functionBody(deployHelper, 'require_base_legacy_stopped_receipt');
assertReceiptGate(baseStoppedReceipt, 'LEGACY_STOPPED_RECEIPT', [
  'transition_version=$TRANSITION_VERSION',
  'droplet_id=$STAGING_DROPLET_ID',
  'legacy_helper_sha=$LEGACY_HELPER_SHA',
  'new_helper_sha=$BASE_HELPER_SHA',
  'acknowledged_commit=$BASE_REVIEWED_COMMIT',
  'legacy_stopped=true',
]);
const stoppedReceipt = functionBody(deployHelper, 'require_legacy_stopped');
assert.match(stoppedReceipt, /\[\[ "\$commit_sha" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
assert.match(stoppedReceipt, /sha256sum "\$HELPER_PATH" \| awk '\{ print \$1 \}'/);
assertInOrder(
  stoppedReceipt,
  [
    'require_base_legacy_stopped_receipt',
    'require_base_retired_receipt',
    'require_helper_rotation_overlay pending-or-complete',
  ],
  'A rotated private start must extend both immutable stopped and retired receipts with an exact overlay',
);

const baseRetiredReceipt = functionBody(deployHelper, 'require_base_retired_receipt');
assertInOrder(
  baseRetiredReceipt,
  [
    'cmp -s -- "$TRANSITION_RECEIPT"',
    'transition_version=$TRANSITION_VERSION',
    'droplet_id=$STAGING_DROPLET_ID',
    'legacy_helper_sha=$LEGACY_HELPER_SHA',
    'new_helper_sha=$BASE_HELPER_SHA',
    'acknowledged_commit=$BASE_REVIEWED_COMMIT',
    'retired=true',
  ],
  'The immutable retirement receipt must remain bound to the original helper and commit',
);

const helperRotationOverlay = functionBody(deployHelper, 'require_helper_rotation_overlay');
assertInOrder(
  helperRotationOverlay,
  [
    'old_helper_sha=$BASE_HELPER_SHA',
    'new_helper_sha=$current_helper_sha',
    'old_reviewed_commit=$BASE_REVIEWED_COMMIT',
    'new_reviewed_commit=$commit_sha',
    'rotation_complete=true',
    '[[ "$expected_state" == \'pending-or-complete\' ]]',
    'rotation_pending=true',
  ],
  'The helper must accept only exact complete, or explicitly allowed pending, overlay receipts',
);

const retirementReceipt = functionBody(deployHelper, 'require_transition_retired');
assert.match(retirementReceipt, /local commit_sha="\$1"/);
assert.match(retirementReceipt, /\[\[ "\$commit_sha" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
assertInOrder(
  retirementReceipt,
  [
    'require_base_legacy_stopped_receipt',
    'require_base_retired_receipt',
    'require_helper_rotation_overlay complete "$commit_sha" "$current_helper_sha"',
    'require_legacy_access_retired',
    'require_cutover_ready',
    'require_exact_private_runtime "$commit_sha"',
  ],
  'The public gate must prove both immutable receipts, a complete overlay, live retirement, and the full reviewed runtime',
);
const sealedLegacyAccess = functionBody(deployHelper, 'require_legacy_execution_boundary_sealed');
assertInOrder(
  sealedLegacyAccess,
  [
    '[[ ! -L "$LEGACY_HOME" && -d "$LEGACY_HOME" ]]',
    '[[ ! -e "$authorized_keys"',
    '[[ ! -e "$LEGACY_SUDOERS" && ! -L "$LEGACY_SUDOERS" ]]',
    '[[ ! -L /etc/sudoers && -f /etc/sudoers ]]',
    '[[ ! -L /etc/sudoers.d && -d /etc/sudoers.d ]]',
    'find /etc/sudoers.d -mindepth 1 ! -type f -print -quit',
    'grep -Fq -- "$marker" /etc/sudoers',
    'grep -r -Fq -- "$marker" /etc/sudoers.d',
    'getent passwd "$LEGACY_ADMIN"',
    '[[ "$uid" =~ ^[0-9]+$ && "$uid" -ne 0 ]]',
    '[[ "$shell" == \'/usr/sbin/nologin\' ]]',
    'passwd --status "$LEGACY_ADMIN"',
    '[[ "$password_status" == \'L\' ]]',
    'id -nG "$LEGACY_ADMIN"',
    "! grep -Eq '^(docker|sudo)$'",
    'require_no_legacy_identity_processes',
    'require_no_legacy_helper_processes',
  ],
  'The shared stopped boundary must live-check legacy SSH, sudo, account, group, UID, and process state',
);
assert.doesNotMatch(sealedLegacyAccess, /\b(?:rm|mv|usermod|userdel|pkill|kill|chmod|chown)\b/);
const noLegacyIdentityProcesses = functionBody(
  deployHelper,
  'require_no_legacy_identity_processes',
);
assertInOrder(
  noLegacyIdentityProcesses,
  [
    'legacy_uid="$(id -u "$LEGACY_ADMIN")"',
    '[[ "$legacy_uid" =~ ^[0-9]+$ && "$legacy_uid" -ne 0 ]]',
    'pgrep -u "$legacy_uid"',
    '[[ "$process_status" -eq 1 ]]',
  ],
  'The live stopped boundary must reject any process owned by the exact non-root legacy UID',
);
const noLegacyHelperProcesses = functionBody(deployHelper, 'require_no_legacy_helper_processes');
assertInOrder(
  noLegacyHelperProcesses,
  ['pgrep -f -- "$LEGACY_HELPER"', '[[ "$process_status" -eq 1 ]]'],
  'The live stopped boundary must reject a process executing the legacy helper path',
);
const publicLegacyAccess = functionBody(deployHelper, 'require_legacy_access_retired');
assertInOrder(
  publicLegacyAccess,
  [
    'require_legacy_execution_boundary_sealed',
    '[[ ! -e "$LEGACY_HELPER"',
    '[[ ! -e "$LEGACY_SECRET_ROOT"',
  ],
  'Public activation must extend the shared sealed boundary with retired helper and secret-root absence',
);
assert.doesNotMatch(publicLegacyAccess, /\b(?:rm|mv|usermod|userdel|pkill|kill|chmod|chown)\b/);

const reviewedOwner = functionBody(deployHelper, 'require_reviewed_owner_port_3002');
assertInOrder(
  reviewedOwner,
  [
    'label=com.docker.compose.project=$PROJECT_NAME',
    'label=com.docker.compose.service=owner-control',
    "'health=healthy'",
    '[[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]]',
    'org.opencontainers.image.revision',
    '== "$commit_sha"',
    'container port "$owner_container" \'3002/tcp\'',
    '[[ "$owner_binding" == \'127.0.0.1:3002\' ]]',
    'port_listener_count=',
    'exact_listener_count=',
    '[[ "$port_listener_count" == \'1\' && "$exact_listener_count" == \'1\' ]]',
  ],
  'Public activation must bind one healthy exact-commit Owner container to exactly one loopback listener',
);
assert.doesNotMatch(reviewedOwner, /\b(?:rm|mv|stop|disable|kill|prune)\b/);

const exactPrivateRuntime = functionBody(deployHelper, 'require_exact_private_runtime');
assertInOrder(
  exactPrivateRuntime,
  [
    'expected_services=(api beta-admission bot customer-web owner-control)',
    'label=com.docker.compose.project=$PROJECT_NAME',
    'com.docker.compose.service',
    "$'api\\nbeta-admission\\nbot\\ncustomer-web\\nowner-control'",
    'label=com.docker.compose.service=$service',
    '[[ "$ids" =~ ^[0-9a-f]{12,64}$ ]]',
    '[[ "$state" == \'running\' ]]',
    'org.opencontainers.image.revision',
    '[[ "$revision" == "$commit_sha" ]]',
    '[[ "$service" != \'bot\' ]]',
    '[[ "$health" == \'healthy\' ]]',
    'require_reviewed_owner_port_3002 "$commit_sha"',
  ],
  'Public activation must classify exactly the five private services and validate every revision and health state',
);
assert.doesNotMatch(exactPrivateRuntime, /\b(?:rm|mv|stop|disable|kill|prune)\b/);

const helperMain = deployHelper.slice(deployHelper.indexOf('case "$command" in'));
const privateStartGate = functionBody(deployHelper, 'require_private_start_cutover_ready');
assertInOrder(
  privateStartGate,
  [
    'local commit_sha="$1"',
    'require_legacy_stopped "$commit_sha"',
    'require_legacy_access_retired',
    'require_cutover_ready',
    'require_port_3002_free',
  ],
  'Every direct private start must prove the commit-bound stopped receipt and all live stopped-state gates',
);
assert.doesNotMatch(privateStartGate, /\b(?:rm|mv|stop|disable|kill|prune)\b/);
const startArm = /(?:^|\n)\s*start\|fresh-start\)([\s\S]*?)\n\s*;;/u.exec(helperMain)?.[1];
assert.ok(startArm, 'The helper must expose guarded direct private and fresh-host start commands.');
assertInOrder(
  startArm,
  [
    'validate_commit_and_tag "$commit_sha" "$image_tag"',
    'require_private_start_cutover_ready "$commit_sha"',
    'compose_file=',
    'require_service_file',
    'docker_local image inspect',
    'require_ipv6_host_ready',
    'run_bounded_database_preflight',
    'up -d --no-build --wait --wait-timeout 90',
  ],
  'The start gates must run before deploy inputs, database preflights, and container start',
);
const freshStartGate = functionBody(deployHelper, 'require_fresh_host_start_ready');
assertInOrder(
  freshStartGate,
  [
    'local commit_sha="$1"',
    'validate_commit_and_tag "$commit_sha" "${commit_sha:0:12}"',
    'require_fresh_host_identity',
    'require_ipv6_host_ready',
    'require_port_3002_free',
    'docker_local container ls',
    'docker_local network ls',
  ],
  'Fresh-host start must prove the exact commit, host network, free Owner port, and empty Compose project before launch',
);
assert.doesNotMatch(freshStartGate, /\b(?:rm|mv|stop|disable|kill|prune)\b/);
const freshHostIdentity = functionBody(deployHelper, 'require_fresh_host_identity');
assertInOrder(
  freshHostIdentity,
  [
    'command -v curl',
    "--noproxy '*'",
    'http://169.254.169.254/metadata/v1/id',
    'http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address',
    '[[ "$metadata_droplet_id" == "$FRESH_STAGING_DROPLET_ID" ]]',
    '[[ "$metadata_ipv4" == "$FRESH_PUBLIC_IPV4" ]]',
  ],
  'Fresh-host operations must prove the exact DigitalOcean metadata identity.',
);
assert.deepEqual(
  [...freshHostIdentity.matchAll(/https?:\/\/[^\s)"]+/gu)].map(([url]) => url),
  [
    'http://169.254.169.254/metadata/v1/id',
    'http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address',
  ],
  'Fresh-host identity proof may contact only the two fixed DigitalOcean metadata paths.',
);
assert.match(startArm, /if \[\[ "\$command" == \'fresh-start\' \]\]/);
assert.match(
  startArm,
  /up -d --no-build --wait --wait-timeout 90 owner-control customer-web api beta-admission/,
  'Fresh-host start must keep Telegram and the public gateway out of the initial launch.',
);
const cutoverArm = /cutover-ready\)([\s\S]*?)\n\s*;;/u.exec(helperMain)?.[1];
assert.ok(cutoverArm, 'The helper must expose the cutover-ready command.');
assertInOrder(
  cutoverArm,
  ['[[ $# -eq 2', 'require_legacy_stopped "$2"', 'require_cutover_ready', 'require_port_3002_free'],
  'The commit-bound stopped receipt and residue checks must pass before proving the pre-provision Owner port is free',
);
const freshHostReadyArm = /fresh-host-ready\)([\s\S]*?)\n\s*;;/u.exec(helperMain)?.[1];
assert.ok(freshHostReadyArm, 'The helper must expose a read-only fresh-host readiness command.');
assertInOrder(
  freshHostReadyArm,
  ['[[ $# -eq 2', 'require_fresh_host_start_ready "$2"'],
  'Fresh-host readiness must reuse the same exact gate as fresh-start.',
);

const publicEdgeReady = functionBody(deployHelper, 'require_public_edge_ready');
assertInOrder(
  publicEdgeReady,
  [
    'local commit_sha="$1"',
    'require_transition_retired "$commit_sha"',
    'require_public_network_ready "$PUBLIC_IPV4"',
  ],
  'The legacy public gate must retain the retired transition proof and reviewed IPv4.',
);
const publicNetworkReady = functionBody(deployHelper, 'require_public_network_ready');
assertInOrder(
  publicNetworkReady,
  ['local public_ipv4="$1"', 'ufw status', 'ss -ltnH', 'getent ahostsv4 "$domain"'],
  'The common public network gate must prove UFW, free ports, and exact DNS before publication.',
);
assert.ok(
  publicNetworkReady.includes(
    'grep -Eq "^${port}/tcp[[:blank:]]+ALLOW[[:blank:]]+Anywhere[[:blank:]]*$"',
  ),
  'The IPv4 UFW gate must allow only trailing horizontal whitespace.',
);
assert.ok(
  publicNetworkReady.includes(
    'grep -Eq "^${port}/tcp \\(v6\\)[[:blank:]]+ALLOW[[:blank:]]+Anywhere \\(v6\\)[[:blank:]]*$"',
  ),
  'The IPv6 UFW gate must allow only trailing horizontal whitespace.',
);
assert.doesNotMatch(
  publicNetworkReady,
  /\[\[:space:\]\]/,
  'The UFW parser must not let vertical whitespace satisfy an exact rule line.',
);
const exactFreshRuntime = functionBody(deployHelper, 'require_exact_fresh_private_runtime');
assertInOrder(
  exactFreshRuntime,
  [
    'local -a expected_services=(api beta-admission customer-web owner-control)',
    '[[ "$services" == $\'api\\nbeta-admission\\ncustomer-web\\nowner-control\' ]]',
    "'NODE_ENV=production'",
    "'FINANCIAL_ACTIONS_MODE=dry_run'",
    "'TELEGRAM_BOT_ENABLED=false'",
    "'TELEGRAM_BETA_ADMISSION_ENABLED=false'",
    "'KEMERBET_EXECUTOR_ENABLED=false'",
    "'KEMERBET_FINAL_ACTION_ENABLED=false'",
    "'INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED=true'",
    "'INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED=true'",
    "'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false'",
    "'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED=true'",
    'require_reviewed_owner_port_3002 "$commit_sha"',
  ],
  'The fresh-host public gate must pin the exact private services and fail-closed environment.',
);
assert.doesNotMatch(exactFreshRuntime, /\b(?:rm|mv|stop|disable|kill|prune)\b/);
const freshPublicEdgeReady = functionBody(deployHelper, 'require_fresh_public_edge_ready');
assertInOrder(
  freshPublicEdgeReady,
  [
    'validate_commit_and_tag "$commit_sha" "${commit_sha:0:12}"',
    'require_fresh_host_identity',
    'require_exact_fresh_bot_runtime "$commit_sha"',
    'require_public_network_ready "$FRESH_PUBLIC_IPV4"',
  ],
  'The fresh public gate must bind the commit, Droplet identity, activated private bot runtime, and new IPv4.',
);
const ufwAllowsExactWebRules = (status) =>
  [
    /^80\/tcp[\t ]+ALLOW[\t ]+Anywhere[\t ]*$/mu,
    /^80\/tcp \(v6\)[\t ]+ALLOW[\t ]+Anywhere \(v6\)[\t ]*$/mu,
    /^443\/tcp[\t ]+ALLOW[\t ]+Anywhere[\t ]*$/mu,
    /^443\/tcp \(v6\)[\t ]+ALLOW[\t ]+Anywhere \(v6\)[\t ]*$/mu,
  ].every((rule) => rule.test(status));
const paddedUfwFixture = [
  'Status: active',
  '80/tcp      ALLOW       Anywhere   \t',
  '443/tcp\tALLOW\tAnywhere\t  ',
  '80/tcp (v6)      ALLOW       Anywhere (v6)   ',
  '443/tcp (v6)\tALLOW\tAnywhere (v6)\t',
].join('\n');
assert.equal(ufwAllowsExactWebRules(paddedUfwFixture), true);
assert.equal(ufwAllowsExactWebRules(paddedUfwFixture.replace('ALLOW', 'DENY')), false);
assert.equal(
  ufwAllowsExactWebRules(
    paddedUfwFixture
      .split('\n')
      .filter((line) => !line.startsWith('443/tcp (v6)'))
      .join('\n'),
  ),
  false,
);
assert.equal(ufwAllowsExactWebRules(paddedUfwFixture.replaceAll('443/tcp', '444/tcp')), false);
assert.equal(
  ufwAllowsExactWebRules(
    paddedUfwFixture.replace(
      '80/tcp      ALLOW       Anywhere   \t',
      '80/tcp      ALLOW       Anywhere extra',
    ),
  ),
  false,
);
const publicEdgeArm = /public-edge-ready\|fresh-public-edge-ready\)([\s\S]*?)\n\s*;;/u.exec(
  helperMain,
)?.[1];
assert.ok(publicEdgeArm, 'The helper must expose a commit-bound public-edge readiness command.');
assertInOrder(
  publicEdgeArm,
  [
    '[[ $# -eq 2',
    'if [[ "$command" == \'fresh-public-edge-ready\' ]]',
    'require_fresh_public_edge_ready "$2"',
    'require_public_edge_ready "$2"',
  ],
  'Public-edge readiness must select only the explicit fresh or legacy gate.',
);
const startPublicEdgeArm = /start-public-edge\|start-fresh-public-edge\)([\s\S]*?)\n\s*;;/u.exec(
  helperMain,
)?.[1];
assert.ok(startPublicEdgeArm, 'The helper must expose the guarded public-edge start command.');
assertInOrder(
  startPublicEdgeArm,
  [
    'commit_sha="$2"',
    'if [[ "$command" == \'start-fresh-public-edge\' ]]',
    'require_fresh_public_edge_ready "$commit_sha"',
    'require_exact_fresh_bot_runtime "$commit_sha"',
    'install -d -o root -g root -m 0755 "$GATEWAY_STATE_ROOT"',
    'compose_command=(',
    'require_public_edge_ready "$commit_sha"',
    'up -d --no-build --wait --wait-timeout 90 gateway',
  ],
  'Starting the public edge must recheck the full commit, DNS, UFW, ports, and runtime gate before gateway activation',
);

const freshHostStep =
  /- name: Verify the fresh-host deployment boundary is empty([\s\S]*?)\n\s+- name:/u.exec(
    deployWorkflow,
  )?.[1];
assert.ok(freshHostStep, 'Deployment must have a distinct fresh-host readiness gate.');
assert.match(freshHostStep, /fetanagent-admin@/);
assert.match(freshHostStep, /fetanagent-staging-deploy-helper verify/);
assert.match(freshHostStep, /fetanagent-staging-deploy-helper fresh-host-ready '\$GITHUB_SHA'/);
assert.doesNotMatch(freshHostStep, /fetanagent-staging-deploy-helper cutover-ready/);
assert.doesNotMatch(freshHostStep, /rm |docker |systemctl |sudo -n (?:bash|sh)\b/);
assertInOrder(
  deployWorkflow,
  [
    'Stop any prior staging project and disable old logins',
    'Verify the fresh-host deployment boundary is empty',
    'Verify the VM has direct IPv6 database readiness',
    'Start the private staging profile and smoke readiness',
  ],
  'The legacy runtime must stop and pass cutover checks before FetanAgent starts',
);
assert.match(deployWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(deployWorkflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(deployWorkflow, /GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(deployWorkflow, /STAGING_DROPLET_ID: '593344964'/);
assert.doesNotMatch(deployWorkflow, /root@|StrictHostKeyChecking=no/);
assert.match(
  publicWorkflow,
  /fetanagent-staging-deploy-helper fresh-public-edge-ready '\$GITHUB_SHA'/,
);
assert.match(
  publicWorkflow,
  /fetanagent-staging-deploy-helper start-fresh-public-edge '\$GITHUB_SHA' '\$\{GITHUB_SHA:0:12\}'/,
);
assert.doesNotMatch(
  publicWorkflow,
  /fetanagent-staging-deploy-helper (?:public-edge-ready|start-public-edge)\b/,
);

for (const phase of [
  'inspect',
  'prepare',
  'acknowledge',
  'mark-legacy-stopped',
  'rollback-prepare',
  'retire',
  'rotate-retired-helper',
  'finalize-retired-helper',
  'verify',
]) {
  assert.match(runbook, new RegExp(`\\b${phase}\\b`));
}
assert.match(runbook, /20260813115809_rename_runtime_roles_to_fetanagent\.sql/);
assert.match(runbook, /590666364/);
assert.match(runbook, /root:root.*0700/);
assert.match(runbook, new RegExp(baseReviewedCommit));
assert.match(runbook, new RegExp(baseHelperSha));
assert.match(runbook, new RegExp(expectedRotatedHelperSha));
assert.match(runbook, /TRANSITION_SHA='<out-of-band-reviewed-LF-C1-transition-sha256>'/);
const extractGate =
  /bash -euo pipefail <<'FETANAGENT_EXTRACT'\n([\s\S]*?)\nFETANAGENT_EXTRACT/u.exec(runbook)?.[1];
assert.ok(extractGate, 'The clean-checkout extraction must run in a fail-closed Bash process.');
assertInOrder(
  extractGate,
  [
    "C1='<exact-40-lowercase-C1-from-reviewed-main>'",
    "TRANSITION_SHA='<out-of-band-reviewed-LF-C1-transition-sha256>'",
    '[[ "$C1" =~ ^[0-9a-f]{40}$ ]]',
    '[[ "$TRANSITION_SHA" =~ ^[0-9a-f]{64}$ ]]',
    'git show "$C1:infra/operations/fetanagent-staging-deploy-helper.sh"',
    'git show "$C1:infra/operations/fetanagent-vm-transition.sh"',
    'sha256sum fetanagent-staging-deploy-helper',
    'sha256sum fetanagent-vm-transition',
    'bash -n fetanagent-staging-deploy-helper',
    'bash -n fetanagent-vm-transition',
  ],
  'The extraction process must abort on commit, helper, transition, or syntax mismatch',
);
const installGate =
  /bash -euo pipefail <<'FETANAGENT_INSTALL'\n([\s\S]*?)\nFETANAGENT_INSTALL/u.exec(runbook)?.[1];
assert.ok(installGate, 'The root installation must run in a fail-closed Bash process.');
assertInOrder(
  installGate,
  [
    'install -d -o root -g root -m 0700 /root/fetanagent-vm-transition-input',
    '/root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper',
    '/root/fetanagent-vm-transition-input/fetanagent-vm-transition.next',
    "TRANSITION_SHA='<out-of-band-reviewed-LF-C1-transition-sha256>'",
    '[[ "$TRANSITION_SHA" =~ ^[0-9a-f]{64}$ ]]',
    'sha256sum /root/fetanagent-vm-transition-input/fetanagent-staging-deploy-helper',
    'sha256sum /root/fetanagent-vm-transition-input/fetanagent-vm-transition.next',
    'bash -n /root/fetanagent-vm-transition-input/fetanagent-vm-transition.next',
    'TRANSITION_INSTALL_TMP="$(mktemp /usr/local/sbin/.fetanagent-vm-transition.XXXXXX)"',
    'install -o root -g root -m 0700',
    'stat --format=\'%U:%G:%a\' "$TRANSITION_INSTALL_TMP"',
    'sha256sum "$TRANSITION_INSTALL_TMP"',
    'mv -f -- "$TRANSITION_INSTALL_TMP" /usr/local/sbin/fetanagent-vm-transition',
    "stat --format='%U:%G:%a' /usr/local/sbin/fetanagent-vm-transition",
    'sha256sum /usr/local/sbin/fetanagent-vm-transition',
  ],
  'The root process must abort before atomic T1 replacement on every hash, syntax, or metadata mismatch',
);
assert.ok(
  runbook.indexOf('\nFETANAGENT_INSTALL\n') < runbook.indexOf('rotate-retired-helper'),
  'The fail-closed install block must finish before the first rotation command.',
);
assert.match(runbook, /visudo -cf/);
assert.match(runbook, /rollback/i);
assert.match(runbook, /sshd -T -C user=fetanagent-admin,host=localhost,addr=127\.0\.0\.1/u);
assert.match(runbook, /user-environment access/u);
assert.ok(
  runbook.includes(`/etc/sudoers.d/${legacyBrand}-staging-deploy`),
  'The runbook must identify the one proven live legacy sudoers path.',
);
assert.ok(
  runbook.includes(
    `${legacyBrand}-admin ALL=(root) NOPASSWD: /usr/local/sbin/${legacyBrand}-staging-deploy-helper`,
  ),
  'The runbook must record the exact proven live sudoers content.',
);
assert.ok(
  runbook.includes(legacySudoersSha),
  'The runbook must record the normalized LF digest of the proven live sudoers content.',
);
assert.equal(
  createHash('sha256')
    .update(
      `${legacyBrand}-admin ALL=(root) NOPASSWD: /usr/local/sbin/${legacyBrand}-staging-deploy-helper\n`,
    )
    .digest('hex'),
  legacySudoersSha,
  'The recorded legacy sudoers digest must represent the exact one-line content plus LF.',
);
assertInOrder(
  runbook,
  [
    '## Phase 3: stop the legacy runtime',
    '## Phase 4: apply the database role rename',
    '## Phase 5: private FetanAgent deploy and smoke',
    '## Phase 6: retire legacy access',
    '## Phase 7: public edge only after retirement',
  ],
  'The runbook must preserve the stop, database, private-smoke, retire, then publish sequence',
);
assert.match(runbook, /root:root` mode\s*`0600` receipt containing:/);
for (const line of [
  'transition_version=1',
  `droplet_id=${dropletId}`,
  `legacy_helper_sha=${legacyHelperSha}`,
  'new_helper_sha=<final-new-helper-lf-sha256>',
  'acknowledged_commit=<reviewed-main-commit>',
  'retired=true',
]) {
  assert.ok(runbook.includes(line), `Runbook receipt schema missing ${line}.`);
}
assert.doesNotMatch(runbook, /Delete all records|docker system prune|sudo (?:bash|docker)/i);

console.log(
  `FetanAgent VM transition verified: version ${transitionVersion}, exact Droplet, explicit root phases, sealed stopped/retired receipts, and stop-before-start ordering`,
);
