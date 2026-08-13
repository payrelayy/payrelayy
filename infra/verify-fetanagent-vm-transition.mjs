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
assert.match(transition, new RegExp(`readonly LEGACY_HELPER_SHA='${legacyHelperSha}'`));
assert.match(transition, /readonly NEW_ADMIN='fetanagent-admin'/);
assert.match(
  transition,
  /readonly NEW_HELPER='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'/,
);
assert.match(transition, /readonly NEW_HELPER_SHA='[0-9a-f]{64}'/);
const expectedHelperSha = createHash('sha256')
  .update(deployHelper.replaceAll('\r\n', '\n'))
  .digest('hex');
assert.match(
  transition,
  new RegExp(`readonly NEW_HELPER_SHA='${expectedHelperSha}'`),
  'The transition must pin the normalized LF SHA-256 of the final deploy helper.',
);
assert.match(transition, /readonly STATE_ROOT='\/var\/lib\/fetanagent-vm-transition'/);
for (const [name, suffix] of [
  ['PREPARED_MARKER', 'prepared-v1'],
  ['ACKNOWLEDGED_MARKER', 'acknowledged-v1'],
  ['LEGACY_STOPPED_MARKER', 'legacy-stopped-v1'],
  ['RETIRED_MARKER', 'retired-v1'],
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

const prepare = functionBody(transition, 'prepare_transition');
assertInOrder(
  prepare,
  [
    'require_legacy_identity',
    'require_legacy_helper',
    'require_legacy_authorized_keys',
    'visudo -cf /etc/sudoers',
    'useradd --create-home',
    'expected_new_sudoers',
    'visudo -cf "$temporary"',
    'visudo -cf /etc/sudoers',
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
    'if [[ -e "$PREPARED_MARKER"',
    'require_prepared_contract',
    'else',
    'require_partial_new_identity',
    'require_new_helper',
    'require_exact_new_sudoers',
    'require_exact_new_sshd_dropin',
    'require_new_helper_source',
  ],
  'Rollback must safely recognize both complete and interrupted preparation',
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
    'rm -f -- "$reference"',
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
  assert.match(body, /sha256sum "\$HELPER_PATH" \| awk '\{ print \$1 \}'/);
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

const stoppedReceipt = functionBody(deployHelper, 'require_legacy_stopped');
assert.match(stoppedReceipt, /\[\[ "\$commit_sha" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
assertReceiptGate(stoppedReceipt, 'LEGACY_STOPPED_RECEIPT', [
  'transition_version=$TRANSITION_VERSION',
  'droplet_id=$STAGING_DROPLET_ID',
  'legacy_helper_sha=$LEGACY_HELPER_SHA',
  'new_helper_sha=$current_helper_sha',
  'acknowledged_commit=$commit_sha',
  'legacy_stopped=true',
]);

const retirementReceipt = functionBody(deployHelper, 'require_transition_retired');
assert.match(retirementReceipt, /local commit_sha="\$1"/);
assert.match(retirementReceipt, /\[\[ "\$commit_sha" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
assertReceiptGate(retirementReceipt, 'TRANSITION_RECEIPT', [
  'transition_version=$TRANSITION_VERSION',
  'droplet_id=$STAGING_DROPLET_ID',
  'legacy_helper_sha=$LEGACY_HELPER_SHA',
  'new_helper_sha=$current_helper_sha',
  'acknowledged_commit=$commit_sha',
  'retired=true',
]);
assertInOrder(
  retirementReceipt,
  [
    'retired=true',
    'require_legacy_access_retired',
    'require_cutover_ready',
    'require_reviewed_owner_port_3002 "$commit_sha"',
  ],
  'The public receipt gate must also prove live retired access, legacy runtime absence, and the reviewed Owner loopback',
);
const sealedLegacyAccess = functionBody(deployHelper, 'require_legacy_execution_boundary_sealed');
assertInOrder(
  sealedLegacyAccess,
  [
    '[[ ! -L "$LEGACY_HOME" && -d "$LEGACY_HOME" ]]',
    '[[ ! -e "$authorized_keys"',
    'for candidate in "$LEGACY_SUDOERS_A"',
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

const helperMain = deployHelper.slice(deployHelper.indexOf('case "$command" in'));
const privateStartGate = functionBody(deployHelper, 'require_private_start_cutover_ready');
assertInOrder(
  privateStartGate,
  [
    'local commit_sha="$1"',
    'require_legacy_stopped "$commit_sha"',
    'require_legacy_execution_boundary_sealed',
    'require_cutover_ready',
    'require_port_3002_free',
  ],
  'Every direct private start must prove the commit-bound stopped receipt and all live stopped-state gates',
);
assert.doesNotMatch(privateStartGate, /\b(?:rm|mv|stop|disable|kill|prune)\b/);
const startArm = /(?:^|\n)\s*start\)([\s\S]*?)\n\s*;;/u.exec(helperMain)?.[1];
assert.ok(startArm, 'The helper must expose a guarded direct private start command.');
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
  'The direct start gate must run before deploy inputs, database preflights, and container start',
);
const cutoverArm = /cutover-ready\)([\s\S]*?)\n\s*;;/u.exec(helperMain)?.[1];
assert.ok(cutoverArm, 'The helper must expose the cutover-ready command.');
assertInOrder(
  cutoverArm,
  ['[[ $# -eq 2', 'require_legacy_stopped "$2"', 'require_cutover_ready', 'require_port_3002_free'],
  'The commit-bound stopped receipt and residue checks must pass before proving the pre-provision Owner port is free',
);

const publicEdgeReady = functionBody(deployHelper, 'require_public_edge_ready');
assertInOrder(
  publicEdgeReady,
  ['local commit_sha="$1"', 'require_transition_retired "$commit_sha"', 'ufw status'],
  'The retired receipt must pass before UFW and public-edge prerequisites',
);
const publicEdgeArm = /public-edge-ready\)([\s\S]*?)\n\s*;;/u.exec(helperMain)?.[1];
assert.ok(publicEdgeArm, 'The helper must expose a commit-bound public-edge readiness command.');
assertInOrder(
  publicEdgeArm,
  ['[[ $# -eq 2', 'require_public_edge_ready "$2"'],
  'Public-edge readiness must validate the reviewed commit receipt',
);
const startPublicEdgeArm = /start-public-edge\)([\s\S]*?)\n\s*;;/u.exec(helperMain)?.[1];
assert.ok(startPublicEdgeArm, 'The helper must expose the guarded public-edge start command.');
assertInOrder(
  startPublicEdgeArm,
  ['commit_sha="$2"', 'require_public_edge_ready "$commit_sha"'],
  'Starting the public edge must validate the same commit-bound retirement receipt',
);

const cutoverStep =
  /- name: Verify legacy VM cutover residue is absent([\s\S]*?)\n\s+- name:/u.exec(
    deployWorkflow,
  )?.[1];
assert.ok(cutoverStep, 'Deployment must have a distinct legacy cutover gate.');
assert.match(cutoverStep, /fetanagent-admin@/);
assert.match(cutoverStep, /fetanagent-staging-deploy-helper verify/);
assert.match(cutoverStep, /fetanagent-staging-deploy-helper cutover-ready '\$GITHUB_SHA'/);
assert.doesNotMatch(cutoverStep, /rm |docker |systemctl |sudo -n (?:bash|sh)\b/);
assertInOrder(
  deployWorkflow,
  [
    'Stop any prior staging project and disable old logins',
    'Verify legacy VM cutover residue is absent',
    'Verify the VM has direct IPv6 database readiness',
    'Start the private staging profile and smoke readiness',
  ],
  'The legacy runtime must stop and pass cutover checks before FetanAgent starts',
);
assert.match(deployWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(deployWorkflow, /pull_request:|pull_request_target:|push:|schedule:/);
assert.match(deployWorkflow, /GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(deployWorkflow, /STAGING_DROPLET_ID: '590666364'/);
assert.doesNotMatch(deployWorkflow, /root@|StrictHostKeyChecking=no/);
assert.match(publicWorkflow, /fetanagent-staging-deploy-helper public-edge-ready '\$GITHUB_SHA'/);
assert.doesNotMatch(publicWorkflow, /public-edge-ready(?:\s|'|\")*(?:\r?\n|&&)/);

for (const phase of [
  'inspect',
  'prepare',
  'acknowledge',
  'mark-legacy-stopped',
  'rollback-prepare',
  'retire',
  'verify',
]) {
  assert.match(runbook, new RegExp(`\\b${phase}\\b`));
}
assert.match(runbook, /20260813115809_rename_runtime_roles_to_fetanagent\.sql/);
assert.match(runbook, /590666364/);
assert.match(runbook, /root:root.*0700/);
assert.match(runbook, /visudo -cf/);
assert.match(runbook, /rollback/i);
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
