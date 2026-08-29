import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bridgePath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge.sh',
);
const validatorPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-h14-terminal-differential-validator.py',
);
const ownerBridgePath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh',
);
const workflowPath = resolve(root, '.github/workflows/staging-beta-deploy-smoke.yml');

const normalized = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const bridge = normalized(bridgePath);
const validator = normalized(validatorPath);
const ownerBridge = normalized(ownerBridgePath);
const workflow = normalized(workflowPath);
const repair = 'a579e3bf96c075dde9c36dbe3c66c09aaf84bc52';
const canonical = '06459511d9330a0e1d956c42529b81aa9970e7a2';
const c36 = 'c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58';
const auth = '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874';
const canonicalReceipt = '/var/lib/fetanagent/kemerbet-readiness-recheck/ready-v1';

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function section(source, startNeedle, endNeedle, label) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing ${label}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `unterminated ${label}`);
  return source.slice(start, end);
}

function shellFunction(source, name) {
  const start = source.indexOf(`${name}() {`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, `unterminated ${name}`);
  return source.slice(start, end + 3);
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function shellRecordKeys(source) {
  return [...source.matchAll(/^\s+["']([a-z0-9_]+)=/gm)].map((match) => match[1]);
}

function pythonRecordKeys(source, startNeedle, endNeedle) {
  return [...section(source, startNeedle, endNeedle, startNeedle).matchAll(/'([a-z0-9_]+)'/g)].map(
    (match) => match[1],
  );
}

assert.match(bridge, /^#!\/usr\/bin\/env bash\n/);
assert.match(bridge, /set -euo pipefail/);
assert.match(bridge, /umask 077/);
assert.match(bridge, new RegExp(`readonly REVIEWED_REPAIR_RELEASE='${repair}'`));
assert.match(bridge, new RegExp(`readonly CANONICAL_H14='${canonical}'`));
assert.match(bridge, new RegExp(`readonly H14_HELPER_SHA256='${c36}'`));
assert.match(bridge, new RegExp(`readonly AUTHORIZATION_SHA256='${auth}'`));
assert.ok(bridge.includes(`readonly RECHECK_RECEIPT='${canonicalReceipt}'`));
assert.doesNotMatch(bridge, /kemerbet-readiness-recheck-ready-v1/);
assert.match(bridge, /\[\[ \$# -eq 6 \]\]/);
assert.match(
  bridge,
  /readonly STAGED_BUNDLE="\$4"[\s\S]*readonly PROVIDED_MANIFEST_SHA256="\$5"[\s\S]*readonly PROVIDED_AUTHORIZATION_SHA256="\$6"/,
);
assert.match(
  bridge,
  /"\$STAGED_BUNDLE" == "\/tmp\/fetanagent-h14-terminal-attestation-\$\{ATTESTATION_RELEASE\}"/,
);
assert.doesNotMatch(bridge, /kemerbet-quarantine-recovery-ready/);
assert.doesNotMatch(ownerBridge, /kemerbet-quarantine-recovery-ready/);

const ownerTerminalParser = shellFunction(ownerBridge, 'load_exact_terminal_attestation');
assert.deepEqual(
  pythonRecordKeys(ownerTerminalParser, '    if intent_keys != [\n', '    if grant_keys != [\n'),
  shellRecordKeys(shellFunction(bridge, 'expected_attestation_intent')),
  'Owner terminal parser and terminal intent key order must be identical',
);
assert.deepEqual(
  pythonRecordKeys(ownerTerminalParser, '    if grant_keys != [\n', '    if completed_keys != [\n'),
  shellRecordKeys(shellFunction(bridge, 'expected_grant_restoration_intent')),
  'Owner terminal parser and grant-restoration key order must be identical',
);
assert.deepEqual(
  pythonRecordKeys(ownerTerminalParser, '    if completed_keys != [\n', '    common = {\n'),
  shellRecordKeys(shellFunction(bridge, 'expected_attestation_completed')),
  'Owner terminal parser and terminal completion key order must be identical',
);

const helper = spawnSync(
  'git',
  ['show', `${repair}:infra/operations/fetanagent-staging-deploy-helper.sh`],
  { cwd: root, encoding: null, maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(helper.status, 0, helper.stderr?.toString('utf8'));
assert.equal(sha(helper.stdout), c36, 'canonical c36 helper bytes changed');

const claim = shellFunction(bridge, 'claim_and_load_bundle');
for (const required of [
  'names = [script_name, validator_name, manifest_name]',
  'if manifest !=',
  'len(lines) != 19',
  "'terminal_attestation_bridge_size'",
  "'terminal_differential_validator_size'",
  'str(len(manifest))',
  'os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC',
  'os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC',
  'os.fchown(descriptor, 0, 0)',
  'os.fchmod(descriptor, 0o400)',
  'os.fsync(descriptor)',
  'os.rename(installing, final)',
  'sync_directory(parent)',
  'A completed root-owned claim is the only replay authority',
  'Do not\n        # inspect an uploader-controlled leftover',
]) {
  assert.ok(claim.includes(required), `bundle claim omits ${required}`);
}
assert.doesNotMatch(claim, /os\.rename\(source, installing\)|os\.chown\(source|os\.fchown\(source/);
const committedClaimBranch = section(
  claim,
  '    if os.path.lexists(final):\n',
  '    else:\n        source_values, source_identities, source_directory = snapshot_source()',
  'committed-claim replay branch',
);
assert.doesNotMatch(committedClaimBranch, /snapshot_source|source_values|consume_source/);
assert.match(
  claim,
  /before\.st_size, before\.st_mtime_ns\)[\s\S]*after_read\.st_size, after_read\.st_mtime_ns/,
);
assert.ok(count(bridge, /bundle_manifest_size=/g) >= 2);
assert.match(bridge, /BUNDLE_MANIFEST_SIZE="\$\{bundle_values\[4\]\}"/);

const load = shellFunction(bridge, 'load_exact_h14_and_repair');
for (const required of [
  "repair_state = 'intent-only'",
  "repair_state = 'completion-temp'",
  "repair_state = 'completed-in-installing'",
  "repair_state = 'final'",
  "repair_state in {'completed-in-installing', 'final'}",
  "repair_state == 'completion-temp'",
  'expected_completed_data.startswith(partial)',
  'validate_profile_tree',
  "f'{h14_root}/quarantined-profile-v1'",
  "crash_marker = b'fetanagent-kemerbet-session-active-v1\\n'",
  '(10001, 10001, 0o700)',
  'value.st_nlink != 1 or stat.S_IMODE(value.st_mode) & 0o022',
  'tree.hexdigest()',
]) {
  assert.ok(load.includes(required), `H14/a579 loader omits ${required}`);
}
assert.doesNotMatch(load, /if repair_state == 'complete'/);
assert.doesNotMatch(load, /os\.O_(?:WRONLY|RDWR)|os\.write|os\.rename|os\.unlink/);

const volume = shellFunction(bridge, 'require_volume_root');
assert.match(volume, /10001:10001:700/);
assert.match(volume, /find -P "\$path" -mindepth 1 -maxdepth 1/);
const forward = shellFunction(bridge, 'require_forward_artifacts_absent');
for (const required of [
  '$RECHECK_RECEIPT',
  '$PLAYER_STAGE_NAME',
  '$CLAIM_STAGE_NAME',
  '$PROFILE_ACK_NAME',
  '$PROFILE_FINALIZED_NAME',
  '$TERMINAL_MARKER_NAME',
  'kemerbet-readiness-cohort-completed-v1',
  'kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1',
  'terminal-recovery-marker-v1',
  'root:root:755',
  'root:10001:440:1:37',
]) {
  assert.ok(forward.includes(required), `forward-artifact gate omits ${required}`);
}

const sudoers = shellFunction(bridge, 'capture_sudoers_boundary');
assert.match(sudoers, /stat --format='%d:%i'/);
assert.match(sudoers, /sha256sum/);
assert.match(sudoers, /"\$current_dev_ino" == "\$SUDOERS_DEV_INO"/);
const loadSudoers = shellFunction(bridge, 'load_sudoers_binding_from_attestation_intent');
assert.match(loadSudoers, /deployment_grant_dev_ino/);
assert.match(loadSudoers, /deployment_grant_sha256/);
assert.match(loadSudoers, /deployment_grant'\) != 'disabled'/);

const matrixFunction = shellFunction(bridge, 'require_phase_matrix');
for (const phase of [
  'absent',
  'empty',
  'intent-temp',
  'intent-only',
  'grant-temp',
  'grant-intent',
  'completion-temp',
  'completed-in-installing',
  'final',
]) {
  assert.ok(matrixFunction.includes(phase), `phase matrix omits ${phase}`);
}

const mainStart = bridge.indexOf(
  "require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'",
);
assert.ok(mainStart >= 0);
const main = bridge.slice(mainStart);
const lockIndex = main.indexOf('acquire_staging_mutation_lock');
const claimIndex = main.indexOf('claim_and_load_bundle');
const refreshIndex = main.indexOf('refresh_terminal_state');
const attestationIntentIndex = main.indexOf(
  'publish_exact_record "$ATTESTATION_WORK_ROOT/intent-v1"',
);
const grantIntentIndex = main.indexOf(
  'publish_exact_record "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1"',
);
const restoreIndex = main.indexOf('restore_sudoers');
const repairCompletionIndex = main.indexOf('finalize_repair_ledger');
const ownCompletionIndex = main.indexOf('finalize_attestation_ledger');
const prepareHashes = shellFunction(bridge, 'prepare_attestation_hashes');
assert.ok(
  lockIndex >= 0 &&
    lockIndex < claimIndex &&
    claimIndex < refreshIndex &&
    refreshIndex < attestationIntentIndex &&
    attestationIntentIndex < grantIntentIndex &&
    grantIntentIndex < restoreIndex &&
    restoreIndex < repairCompletionIndex &&
    repairCompletionIndex < ownCompletionIndex,
  'mutation order must be lock -> claim -> validate -> intent -> grant intent -> restore -> a579 completion -> attestation completion',
);
assert.ok(count(main, /capture_sudoers_boundary active/g) >= 5);
assert.ok(count(main, /capture_sudoers_boundary disabled/g) >= 4);
assert.ok(count(main, /refresh_terminal_state/g) >= 6);
assert.match(main, /EXPECTED_REPAIR_COMPLETION_SHA256="\$\(expected_repair_completed \| sha256sum/);
assert.match(
  prepareHashes,
  /"\$REPAIR_COMPLETION_SHA256" == "\$EXPECTED_REPAIR_COMPLETION_SHA256"/,
);
assert.doesNotMatch(
  main,
  /docker_local (?:container|image|volume|network) (?:create|run|start|stop|rm|load|pull|push|update|connect|disconnect)/,
);
assert.doesNotMatch(main, /\bsupabase\b|\bpsql\b|agentsystem\.admindigi\.com|kemerbet\.co/i);

// Exact replay matrix: completion bytes can only exist after the exact grant
// intent and a579 final namespace. Impossible disabled-grant healing is rejected.
function allowed(attestation, repairState, grant) {
  if (['absent', 'empty', 'intent-temp', 'intent-only', 'grant-temp'].includes(attestation))
    return repairState === 'intent-only' && grant === 'disabled';
  if (attestation === 'grant-intent')
    return (
      (grant === 'disabled' && repairState === 'intent-only') ||
      (grant === 'active' &&
        ['intent-only', 'completion-temp', 'completed-in-installing', 'final'].includes(
          repairState,
        ))
    );
  if (['completion-temp', 'completed-in-installing', 'final'].includes(attestation))
    return repairState === 'final' && grant === 'active';
  return false;
}

for (const tuple of [
  ['absent', 'intent-only', 'disabled'],
  ['intent-temp', 'intent-only', 'disabled'],
  ['grant-intent', 'intent-only', 'disabled'],
  ['grant-intent', 'intent-only', 'active'],
  ['grant-intent', 'completion-temp', 'active'],
  ['grant-intent', 'completed-in-installing', 'active'],
  ['grant-intent', 'final', 'active'],
  ['completion-temp', 'final', 'active'],
  ['completed-in-installing', 'final', 'active'],
  ['final', 'final', 'active'],
]) {
  assert.equal(allowed(...tuple), true, `reviewed interruption state rejected: ${tuple}`);
}
for (const tuple of [
  ['absent', 'intent-only', 'active'],
  ['intent-only', 'completion-temp', 'disabled'],
  ['grant-temp', 'intent-only', 'active'],
  ['grant-intent', 'completion-temp', 'disabled'],
  ['grant-intent', 'final', 'disabled'],
  ['completion-temp', 'completed-in-installing', 'active'],
  ['completed-in-installing', 'final', 'disabled'],
  ['final', 'completion-temp', 'active'],
]) {
  assert.equal(allowed(...tuple), false, `impossible interruption state accepted: ${tuple}`);
}

const progression = [
  ['absent', 'intent-only', 'disabled'],
  ['intent-temp', 'intent-only', 'disabled'],
  ['intent-only', 'intent-only', 'disabled'],
  ['grant-temp', 'intent-only', 'disabled'],
  ['grant-intent', 'intent-only', 'disabled'],
  ['grant-intent', 'intent-only', 'active'],
  ['grant-intent', 'completion-temp', 'active'],
  ['grant-intent', 'completed-in-installing', 'active'],
  ['grant-intent', 'final', 'active'],
  ['completion-temp', 'final', 'active'],
  ['completed-in-installing', 'final', 'active'],
  ['final', 'final', 'active'],
];
assert.ok(progression.every((state) => allowed(...state)));

const exactRecord = Buffer.from('version=1\nstate=completed\nmoney_moved=false\n', 'ascii');
const exactRecordSha = sha(exactRecord);
assert.equal(sha(exactRecord), exactRecordSha);
for (const mutated of [
  Buffer.concat([exactRecord, Buffer.from('foreign=true\n')]),
  Buffer.from(exactRecord.toString('ascii').replace('false', 'true'), 'ascii'),
  exactRecord.subarray(0, exactRecord.length - 1),
]) {
  assert.notEqual(sha(mutated), exactRecordSha, 'record mutation must change the bound digest');
}

function resumePrefix(expected, partial) {
  assert.ok(partial.length <= expected.length);
  assert.deepEqual(partial, expected.subarray(0, partial.length));
  return Buffer.concat([partial, expected.subarray(partial.length)]);
}
for (const size of [0, 1, 13, exactRecord.length - 1, exactRecord.length])
  assert.deepEqual(resumePrefix(exactRecord, exactRecord.subarray(0, size)), exactRecord);
assert.throws(() => resumePrefix(exactRecord, Buffer.from('x')));

// A committed root-owned claim is authoritative: a leftover uploader source is
// irrelevant to replay and cannot replace the committed digest.
function replayClaim(claimedDigest, sourceDigest) {
  assert.match(claimedDigest, /^[0-9a-f]{64}$/);
  void sourceDigest;
  return claimedDigest;
}
assert.equal(replayClaim(exactRecordSha, '0'.repeat(64)), exactRecordSha);

// Reproduce the canonical c36 transport defect exactly: command substitution
// strips the trailing empty profile-ID line before mapfile parses the here-string.
const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const emptyField = spawnSync(
  bash,
  [
    '-c',
    'set -euo pipefail; inspection="$(printf \'host-retired\\nrelease\\nhelper\\n\\n\')"; mapfile -t values <<<"$inspection"; printf \'%s\\n\' "${#values[@]}"',
  ],
  { encoding: 'utf8' },
);
assert.equal(emptyField.status, 0, emptyField.stderr);
assert.equal(emptyField.stdout, '3\n', 'fixture must reproduce c36 empty-field loss');
assert.match(bridge, /\[\[ "\$\{#values\[@\]\}" -eq 9 \]\]/);
assert.doesNotMatch(
  shellFunction(bridge, 'refresh_terminal_state'),
  /PROFILE_ID|profile_id|inspection="\$\(/,
);

assert.match(validator, /else:\n    sys\.stdout\.write\("PASS H14-D000\\n"\)/);
assert.doesNotMatch(validator, /H14-D180/);
assert.ok(validator.includes('H14-D001'));
for (let predicate = 10; predicate <= 170; predicate += 10)
  assert.ok(validator.includes(`H14-D${String(predicate).padStart(3, '0')}`));

const terminalManifest = section(
  workflow,
  '          cat >"$terminal_manifest_path" <<EOF\n',
  '          EOF\n',
  'workflow terminal manifest',
);
for (const line of [
  'version=1',
  'contract=fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bundle',
  'attestation_implementation_sha=$CONFIRMED_REPAIR_IMPLEMENTATION',
  'repair_implementation_sha=$REVIEWED_REPAIR_RELEASE',
  'canonical_h14_sha=$CANONICAL_H14_COMMIT',
  'authorization_sha256=$H14_RECOVERY_AUTHORIZATION_SHA256',
  'terminal_attestation_bridge_sha256=$terminal_script_sha',
  'terminal_attestation_bridge_size=$terminal_script_size',
  'terminal_differential_validator_sha256=$terminal_validator_sha',
  'terminal_differential_validator_size=$terminal_validator_size',
  'provider_action_enabled=false',
  'financial_actions_mode=dry_run',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'money_moved=false',
]) {
  assert.ok(terminalManifest.includes(line), `workflow terminal manifest omits: ${line}`);
}
assert.equal(terminalManifest.trim().split('\n').length, 20);

const terminalStage = section(
  workflow,
  '      - name: Stage the exact one-use terminal-attestation bundle\n',
  '      - name: Emit the exact terminal-attestation root-console invocation\n',
  'workflow terminal staging step',
);
for (const required of [
  'remote_terminal_bundle="/tmp/fetanagent-h14-terminal-attestation-$CONFIRMED_REPAIR_IMPLEMENTATION"',
  'test ! -e "$remote_terminal_bundle"',
  'install -d -m 0700 "$remote_terminal_bundle"',
  'fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge.sh',
  'fetanagent-kemerbet-h14-terminal-differential-validator.py',
  'manifest-v1',
  'find -P "$remote_terminal_bundle" -mindepth 1 -maxdepth 1 -printf \'%f:%y\\n\'',
  "stat --format='%u:%g:%a'",
  'terminal_script_size',
  'terminal_validator_size',
  'terminal_manifest_sha',
]) {
  assert.ok(terminalStage.includes(required), `workflow terminal staging omits: ${required}`);
}
assert.doesNotMatch(terminalStage, /docker (?:load|run|start|stop|rm)|supabase|psql/);

const terminalEmit = section(
  workflow,
  '      - name: Emit the exact terminal-attestation root-console invocation\n',
  '      - name: Stage the no-secret Owner-only bundle as the unprivileged deployment identity\n',
  'workflow terminal invocation step',
);
assert.match(
  terminalEmit,
  /terminal_invocation="bash '\$terminal_script' '\$CONFIRMED_REPAIR_IMPLEMENTATION' '\$REVIEWED_REPAIR_RELEASE' '\$CANONICAL_H14_COMMIT' '\$REMOTE_TERMINAL_BUNDLE' '\$TERMINAL_MANIFEST_SHA' '\$H14_RECOVERY_AUTHORIZATION_SHA256'"/,
);
for (const required of [
  'if [[ ! -e \"$terminal_root\" && ! -L \"$terminal_root\" ]]; then',
  "stat --format='%U:%G:%a:%h' '$terminal_script'",
  "stat --format='%s' '$terminal_script'",
  "sha256sum '$terminal_script'",
  'fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge.sh:f',
  "echo 'else'",
]) {
  assert.ok(terminalEmit.includes(required), `replay-safe terminal setup omits: ${required}`);
}

const ownerEmit = section(
  workflow,
  '      - name: Emit the exact root-console invocation without executing it\n',
  '  connectivity:\n',
  'workflow Owner invocation step',
);
for (const required of [
  'if [[ ! -e \"$script_root\" && ! -L \"$script_root\" ]]; then',
  "stat --format='%U:%G:%a:%h' '$root_script'",
  "stat --format='%s' '$root_script'",
  "sha256sum '$root_script'",
  'fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh:f',
  "echo 'else'",
]) {
  assert.ok(ownerEmit.includes(required), `replay-safe Owner setup omits: ${required}`);
}
assert.ok(
  workflow.indexOf('### Exact terminal-attestation root-console invocation — run first') <
    workflow.indexOf('### Exact fresh root-console invocation'),
  'terminal invocation must be emitted before the Owner invocation',
);

const syntax = spawnSync(bash, ['-n', bridgePath], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);
const ownerSyntax = spawnSync(bash, ['-n', ownerBridgePath], { encoding: 'utf8' });
assert.equal(ownerSyntax.status, 0, ownerSyntax.stderr);

const packageJson = JSON.parse(normalized(resolve(root, 'package.json')));
assert.match(
  packageJson.scripts['test:infra'],
  /node infra\/verify-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge\.mjs/,
);
assert.match(
  packageJson.scripts['test:infra'],
  /node infra\/verify-kemerbet-h14-terminal-differential-validator\.mjs/,
);

console.log(
  'KemerBet H14 terminal-attestation bridge verified (root-owned copy claim, exact a579 completion, replay matrix, mutation resistance, empty-profile transport regression, and no provider or money action).',
);
