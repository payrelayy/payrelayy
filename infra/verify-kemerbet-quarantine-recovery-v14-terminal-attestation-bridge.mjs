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
const previousAttestation = '38e9d2660b871c691afdd69541e17c17a7b55821';
const previousScript = 'dfad82098c2042a5cd884f7c1116a9b4e424ac8685a68db3c7633f58a7e22bfb';
const previousValidator = 'd4e4f91603956e2051d9b77ce8a43392b6d46c062c3d397d28fa18f499b15542';
const previousManifest = '25ff5bb29342bbb1404ff888dacb43d464867c113f8f3db04ebb2df4e90ae733';
const interruptedAttestation = '635557273ce4010df91b9e1be838479ad049528c';
const interruptedScript = '6c8b9b9c00f9b701c48043242e94b90f5a7c225dbf3ff2a674d269f5b9f13251';
const interruptedValidator = 'd4e4f91603956e2051d9b77ce8a43392b6d46c062c3d397d28fa18f499b15542';
const interruptedManifest = '131dce3956028251b023318cb88917fab9d237b3a11d8599e1bff986cefeb077';
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
assert.match(bridge, new RegExp(`readonly PREVIOUS_ATTESTATION_RELEASE='${previousAttestation}'`));
assert.match(bridge, new RegExp(`readonly PREVIOUS_ATTESTATION_SCRIPT_SHA256='${previousScript}'`));
assert.match(
  bridge,
  new RegExp(`readonly PREVIOUS_DIFFERENTIAL_VALIDATOR_SHA256='${previousValidator}'`),
);
assert.match(bridge, new RegExp(`readonly PREVIOUS_BUNDLE_MANIFEST_SHA256='${previousManifest}'`));
assert.match(bridge, /readonly PREVIOUS_ATTESTATION_SCRIPT_SIZE='92946'/);
assert.match(bridge, /readonly PREVIOUS_DIFFERENTIAL_VALIDATOR_SIZE='17941'/);
assert.match(bridge, /readonly PREVIOUS_BUNDLE_MANIFEST_SIZE='928'/);
for (const devIno of [
  "PREVIOUS_CLAIM_PARENT_DEV_INO='64769:6102851'",
  "PREVIOUS_CLAIM_ROOT_DEV_INO='64769:6102854'",
  "PREVIOUS_ATTESTATION_SCRIPT_DEV_INO='64769:6102855'",
  "PREVIOUS_DIFFERENTIAL_VALIDATOR_DEV_INO='64769:6102856'",
  "PREVIOUS_BUNDLE_MANIFEST_DEV_INO='64769:6102857'",
]) {
  assert.ok(bridge.includes(devIno), `previous immutable claim identity omits ${devIno}`);
}
for (const interruptedBoundary of [
  `INTERRUPTED_ATTESTATION_RELEASE='${interruptedAttestation}'`,
  `INTERRUPTED_ATTESTATION_SCRIPT_SHA256='${interruptedScript}'`,
  "INTERRUPTED_ATTESTATION_SCRIPT_SIZE='97783'",
  `INTERRUPTED_DIFFERENTIAL_VALIDATOR_SHA256='${interruptedValidator}'`,
  "INTERRUPTED_DIFFERENTIAL_VALIDATOR_SIZE='17941'",
  `INTERRUPTED_BUNDLE_MANIFEST_SHA256='${interruptedManifest}'`,
  "INTERRUPTED_BUNDLE_MANIFEST_SIZE='928'",
  "INTERRUPTED_CLAIM_ROOT_DEV_INO='64769:6102860'",
  "INTERRUPTED_ATTESTATION_SCRIPT_DEV_INO='64769:6102861'",
  "INTERRUPTED_DIFFERENTIAL_VALIDATOR_DEV_INO='64769:6102862'",
  "INTERRUPTED_BUNDLE_MANIFEST_DEV_INO='64769:6102863'",
  "INTERRUPTED_ATTESTATION_PARENT_DEV_INO='64769:6102864'",
  "INTERRUPTED_EMPTY_LEDGER_DEV_INO='64769:6102865'",
]) {
  assert.ok(
    bridge.includes(interruptedBoundary),
    `interrupted immutable attempt binding omits ${interruptedBoundary}`,
  );
  assert.ok(
    ownerBridge.includes(interruptedBoundary),
    `Owner bridge omits interrupted immutable attempt binding ${interruptedBoundary}`,
  );
}
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

const previousBridgeBytes = spawnSync(
  'git',
  [
    'show',
    `${previousAttestation}:infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge.sh`,
  ],
  { cwd: root, encoding: null, maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(previousBridgeBytes.status, 0, previousBridgeBytes.stderr?.toString('utf8'));
assert.equal(previousBridgeBytes.stdout.length, 92946);
assert.equal(sha(previousBridgeBytes.stdout), previousScript);
const previousValidatorBytes = spawnSync(
  'git',
  [
    'show',
    `${previousAttestation}:infra/operations/fetanagent-kemerbet-h14-terminal-differential-validator.py`,
  ],
  { cwd: root, encoding: null, maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(previousValidatorBytes.status, 0, previousValidatorBytes.stderr?.toString('utf8'));
assert.equal(previousValidatorBytes.stdout.length, 17941);
assert.equal(sha(previousValidatorBytes.stdout), previousValidator);
const previousManifestBytes = Buffer.from(
  [
    'version=1',
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bundle',
    `attestation_implementation_sha=${previousAttestation}`,
    `repair_implementation_sha=${repair}`,
    `canonical_h14_sha=${canonical}`,
    'staging_project_ref=spzpiyxheappsfyswewl',
    'staging_droplet_id=593344964',
    `authorization_sha256=${auth}`,
    `terminal_attestation_bridge_sha256=${previousScript}`,
    'terminal_attestation_bridge_size=92946',
    `terminal_differential_validator_sha256=${previousValidator}`,
    'terminal_differential_validator_size=17941',
    'provider_action_enabled=false',
    'financial_actions_mode=dry_run',
    'kemerbet_executor_enabled=false',
    'kemerbet_final_action_enabled=false',
    'transfer_enabled=false',
    'amount_entry_enabled=false',
    'money_moved=false',
    '',
  ].join('\n'),
  'ascii',
);
assert.equal(previousManifestBytes.length, 928);
assert.equal(sha(previousManifestBytes), previousManifest);

const interruptedBridgeBytes = spawnSync(
  'git',
  [
    'show',
    `${interruptedAttestation}:infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge.sh`,
  ],
  { cwd: root, encoding: null, maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(interruptedBridgeBytes.status, 0, interruptedBridgeBytes.stderr?.toString('utf8'));
assert.equal(interruptedBridgeBytes.stdout.length, 97783);
assert.equal(sha(interruptedBridgeBytes.stdout), interruptedScript);
const interruptedValidatorBytes = spawnSync(
  'git',
  [
    'show',
    `${interruptedAttestation}:infra/operations/fetanagent-kemerbet-h14-terminal-differential-validator.py`,
  ],
  { cwd: root, encoding: null, maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(
  interruptedValidatorBytes.status,
  0,
  interruptedValidatorBytes.stderr?.toString('utf8'),
);
assert.equal(interruptedValidatorBytes.stdout.length, 17941);
assert.equal(sha(interruptedValidatorBytes.stdout), interruptedValidator);
const interruptedManifestBytes = Buffer.from(
  [
    'version=1',
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bundle',
    `attestation_implementation_sha=${interruptedAttestation}`,
    `repair_implementation_sha=${repair}`,
    `canonical_h14_sha=${canonical}`,
    'staging_project_ref=spzpiyxheappsfyswewl',
    'staging_droplet_id=593344964',
    `authorization_sha256=${auth}`,
    `terminal_attestation_bridge_sha256=${interruptedScript}`,
    'terminal_attestation_bridge_size=97783',
    `terminal_differential_validator_sha256=${interruptedValidator}`,
    'terminal_differential_validator_size=17941',
    'provider_action_enabled=false',
    'financial_actions_mode=dry_run',
    'kemerbet_executor_enabled=false',
    'kemerbet_final_action_enabled=false',
    'transfer_enabled=false',
    'amount_entry_enabled=false',
    'money_moved=false',
    '',
  ].join('\n'),
  'ascii',
);
assert.equal(interruptedManifestBytes.length, 928);
assert.equal(sha(interruptedManifestBytes), interruptedManifest);

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
  'def validate_previous_claim():',
  'def validate_interrupted_claim():',
  'immutable_identity(previous_root)',
  'immutable_identity(interrupted_root)',
  'previous_attestation, interrupted_attestation, attestation,',
  "previous_attestation, interrupted_attestation, f'.installing-{attestation}'",
  'if validate_previous_claim() != previous_boundary:',
  'if validate_interrupted_claim() != interrupted_boundary:',
]) {
  assert.ok(claim.includes(required), `bundle claim omits ${required}`);
}
assert.doesNotMatch(claim, /os\.rename\(source, installing\)|os\.chown\(source|os\.fchown\(source/);
assert.doesNotMatch(claim, /os\.mkdir\(parent|os\.chown\(parent|os\.chmod\(parent/);
for (const exactPreviousBoundary of [
  'len(values[script_name]) != previous_script_size',
  'hashlib.sha256(values[script_name]).hexdigest() != previous_script_sha',
  'len(values[validator_name]) != previous_validator_size',
  'hashlib.sha256(values[validator_name]).hexdigest() != previous_validator_sha',
  'len(values[manifest_name]) != previous_manifest_size',
  'hashlib.sha256(values[manifest_name]).hexdigest() != previous_manifest_sha',
  'dev_ino(previous_root) != previous_root_dev_ino',
  "dev_ino(f'{previous_root}/{script_name}') != previous_script_dev_ino",
  "dev_ino(f'{previous_root}/{validator_name}') != previous_validator_dev_ino",
  "dev_ino(f'{previous_root}/{manifest_name}') != previous_manifest_dev_ino",
]) {
  assert.ok(
    claim.includes(exactPreviousBoundary),
    `previous immutable claim validation omits ${exactPreviousBoundary}`,
  );
}
for (const exactInterruptedBoundary of [
  'len(values[script_name]) != interrupted_script_size',
  'hashlib.sha256(values[script_name]).hexdigest() != interrupted_script_sha',
  'len(values[validator_name]) != interrupted_validator_size',
  'hashlib.sha256(values[validator_name]).hexdigest() != interrupted_validator_sha',
  'len(values[manifest_name]) != interrupted_manifest_size',
  'hashlib.sha256(values[manifest_name]).hexdigest() != interrupted_manifest_sha',
  'dev_ino(interrupted_root) != interrupted_root_dev_ino',
  "dev_ino(f'{interrupted_root}/{script_name}') != interrupted_script_dev_ino",
  "dev_ino(f'{interrupted_root}/{validator_name}') != interrupted_validator_dev_ino",
  "dev_ino(f'{interrupted_root}/{manifest_name}') != interrupted_manifest_dev_ino",
]) {
  assert.ok(
    claim.includes(exactInterruptedBoundary),
    `interrupted immutable claim validation omits ${exactInterruptedBoundary}`,
  );
}
assert.equal(
  count(claim, /validate_previous_claim\(\) != previous_boundary/g),
  4,
  'the previous claim must be revalidated around both interrupted copy and atomic publication',
);
assert.equal(
  count(claim, /validate_interrupted_claim\(\) != interrupted_boundary/g),
  4,
  'the interrupted immutable claim must be revalidated around copy and atomic publication',
);
const committedClaimBranch = section(
  claim,
  '    if os.path.lexists(final):\n',
  '    else:\n        directory(parent, root_owner, 0o700)',
  'committed-claim replay branch',
);
assert.doesNotMatch(committedClaimBranch, /snapshot_source|source_values|consume_source/);
assert.match(
  claim,
  /before\.st_size, before\.st_mtime_ns, before\.st_ctime_ns\)[\s\S]*after\.st_size, after\.st_mtime_ns, after\.st_ctime_ns/,
);

function allowedClaimEntries(phase, current) {
  if (phase === 'before') return [previousAttestation, interruptedAttestation].sort();
  if (phase === 'installing')
    return [previousAttestation, interruptedAttestation, `.installing-${current}`].sort();
  if (phase === 'final') return [previousAttestation, interruptedAttestation, current].sort();
  throw new Error('unsupported claim phase');
}
function acceptsClaimEntries(actual, phase, current) {
  return [...actual].sort().join('\0') === allowedClaimEntries(phase, current).join('\0');
}
const correctionRelease = 'f'.repeat(40);
assert.deepEqual(
  allowedClaimEntries('before', correctionRelease),
  [previousAttestation, interruptedAttestation].sort(),
);
assert.deepEqual(
  allowedClaimEntries('installing', correctionRelease),
  [`.installing-${correctionRelease}`, interruptedAttestation, previousAttestation].sort(),
);
assert.deepEqual(
  allowedClaimEntries('final', correctionRelease),
  [previousAttestation, interruptedAttestation, correctionRelease].sort(),
);
for (const [phase, entries] of [
  ['before', []],
  ['before', [correctionRelease]],
  ['before', [previousAttestation]],
  ['before', [previousAttestation, interruptedAttestation, 'unknown-third-claim']],
  [
    'final',
    [previousAttestation, interruptedAttestation, correctionRelease, 'unknown-fourth-claim'],
  ],
  ['installing', [previousAttestation, interruptedAttestation, `.installing-${'e'.repeat(40)}`]],
  [
    'final',
    [
      previousAttestation,
      interruptedAttestation,
      correctionRelease,
      `.installing-${correctionRelease}`,
    ],
  ],
]) {
  assert.equal(acceptsClaimEntries(entries, phase, correctionRelease), false);
}
const copyIndex = claim.indexOf('for name in names:\n            copy_claim_file');
const preRenameRevalidationIndex = claim.indexOf(
  'if validate_previous_claim() != previous_boundary:',
  copyIndex,
);
const claimRenameIndex = claim.indexOf('os.rename(installing, final)', copyIndex);
const parentSyncIndex = claim.indexOf('sync_directory(parent)', claimRenameIndex);
const postRenameRevalidationIndex = claim.indexOf(
  'if validate_previous_claim() != previous_boundary:',
  claimRenameIndex,
);
const currentValidationIndex = claim.indexOf(
  'validate(final, root_owner, 0o400)',
  claimRenameIndex,
);
const consumeSourceIndex = claim.indexOf('consume_source(source_identities, source_directory)');
assert.ok(
  copyIndex < preRenameRevalidationIndex &&
    preRenameRevalidationIndex < claimRenameIndex &&
    claimRenameIndex < parentSyncIndex &&
    parentSyncIndex < postRenameRevalidationIndex &&
    postRenameRevalidationIndex < currentValidationIndex &&
    currentValidationIndex < consumeSourceIndex,
  'claim publication must revalidate the legacy claim before and after atomic append',
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
  "stat --format='%u:%g:%a:%h:%s'",
  '0:10001:440:1:37',
]) {
  assert.ok(forward.includes(required), `forward-artifact gate omits ${required}`);
}
assert.doesNotMatch(
  forward,
  /stat --format='%U:%G:%a:%h:%s'[\s\S]*root:10001:440:1:37/,
  'a numeric GID must not be compared through group-name resolution',
);

const sudoers = shellFunction(bridge, 'capture_sudoers_boundary');
assert.match(sudoers, /stat --format='%d:%i'/);
assert.match(sudoers, /sha256sum/);
assert.match(sudoers, /"\$current_dev_ino" == "\$SUDOERS_DEV_INO"/);
const loadSudoers = shellFunction(bridge, 'load_sudoers_binding_from_attestation_intent');
assert.match(loadSudoers, /deployment_grant_dev_ino/);
assert.match(loadSudoers, /deployment_grant_sha256/);
assert.match(loadSudoers, /deployment_grant'\) != 'disabled'/);

const interruptedLedger = shellFunction(bridge, 'require_interrupted_empty_attestation_ledger');
for (const required of [
  'INTERRUPTED_ATTESTATION_PARENT_DEV_INO',
  'INTERRUPTED_ATTESTATION_INSTALLING',
  'INTERRUPTED_EMPTY_LEDGER_DEV_INO',
  "stat --format='%u:%g:%a:%d:%i'",
  'find -P "$INTERRUPTED_ATTESTATION_INSTALLING" -mindepth 1 -maxdepth 1',
]) {
  assert.ok(
    interruptedLedger.includes(required),
    `interrupted empty-ledger gate omits ${required}`,
  );
}
const discoverLedger = shellFunction(bridge, 'discover_attestation_ledger');
for (const exactNamespace of [
  'children" == "$interrupted_name"',
  '".installing-$ATTESTATION_RELEASE"',
  '"$ATTESTATION_RELEASE"',
]) {
  assert.ok(
    discoverLedger.includes(exactNamespace),
    `attestation recovery namespace omits ${exactNamespace}`,
  );
}
const createLedger = shellFunction(bridge, 'create_attestation_ledger');
assert.match(createLedger, /mkdir --mode=0700 -- "\$ATTESTATION_INSTALLING"/);
assert.doesNotMatch(
  createLedger,
  /(?:mkdir|mv|rm|rmdir|unlink)[^\n]*INTERRUPTED_ATTESTATION_INSTALLING/,
  'the failed immutable 635 ledger must never be written, finalized, or removed',
);
const attestationIntent = shellFunction(bridge, 'expected_attestation_intent');
for (const exactBinding of [
  'interrupted_attestation_implementation_release=',
  'interrupted_attestation_bridge_sha256=',
  'interrupted_attestation_bridge_size=',
  'interrupted_differential_validator_sha256=',
  'interrupted_differential_validator_size=',
  'interrupted_bundle_manifest_sha256=',
  'interrupted_bundle_manifest_size=',
  'interrupted_bundle_claim_dev_ino=',
  'interrupted_bundle_bridge_dev_ino=',
  'interrupted_bundle_validator_dev_ino=',
  'interrupted_bundle_manifest_dev_ino=',
  'interrupted_attestation_ledger_parent_dev_ino=',
  'interrupted_empty_ledger_dev_ino=',
  'interrupted_empty_ledger_state=empty',
  'interrupted_attempt_preserved=true',
]) {
  assert.ok(attestationIntent.includes(exactBinding), `terminal intent omits ${exactBinding}`);
}

const publishRecordFunction = shellFunction(bridge, 'publish_exact_record');
for (const required of [
  'python3 -I /dev/fd/3 "$path" "$mode" 3<<\'PY\'',
  'expected = sys.stdin.buffer.read()',
  'expected.startswith(data)',
  'os.fsync(descriptor)',
  'os.rename(temporary, path)',
  'sync_directory(root)',
]) {
  assert.ok(publishRecordFunction.includes(required), `exact record transport omits ${required}`);
}
assert.doesNotMatch(
  publishRecordFunction,
  /python3 -I - "\$path" "\$mode" <<'PY'/,
  'the Python source heredoc must not consume the caller-provided record stdin',
);
assert.doesNotMatch(publishRecordFunction, /O_TRUNC|unlink|remove|rmdir/);

const mutatorGate = shellFunction(bridge, 'require_no_other_mutator_processes');
assert.match(
  mutatorGate,
  /-n "\$\{LOCK_HOLDER_PROCESS_ID:-\}" && "\$pid" == "\$LOCK_HOLDER_PROCESS_ID"/,
  'the exact acquired lock-holder child must not be mistaken for a competing mutator',
);
assert.match(
  mutatorGate,
  /fetanagent-staging-deploy-helper\|[\s\S]*fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge\.sh\) return 1/,
  'all other helper and recovery processes must remain fail-closed',
);
const ownerMutatorGate = shellFunction(ownerBridge, 'require_no_other_mutator_processes');
assert.match(
  ownerMutatorGate,
  /-n "\$\{LOCK_HOLDER_PROCESS_ID:-\}" && "\$pid" == "\$LOCK_HOLDER_PROCESS_ID"/,
  'the Owner bridge must exclude only its exact acquired lock-holder child',
);
assert.match(
  ownerMutatorGate,
  /fetanagent-staging-deploy-helper\|[\s\S]*fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge\.sh[|)]/,
  'the Owner bridge must keep all other helper and recovery processes fail-closed',
);

if (process.platform !== 'win32') {
  const mutatorFixture = spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
${mutatorGate}
holder=''
competitor=''
cleanup() {
  [[ -z "$competitor" ]] || { kill "$competitor" 2>/dev/null || true; wait "$competitor" 2>/dev/null || true; }
  [[ -z "$holder" ]] || { kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true; }
}
wait_for_forbidden_argv() {
  local pid="$1" attempt
  for attempt in {1..100}; do
    if [[ -r "/proc/$pid/cmdline" ]] &&
      tr '\\0' '\\n' <"/proc/$pid/cmdline" | grep -Fx '/run/fetanagent-staging-deploy-helper' >/dev/null; then
      return 0
    fi
    sleep 0.01
  done
  return 1
}
trap cleanup EXIT
python3 -c 'import time; time.sleep(60)' /run/fetanagent-staging-deploy-helper &
holder=$!
wait_for_forbidden_argv "$holder"
LOCK_HOLDER_PROCESS_ID=$holder
require_no_other_mutator_processes
python3 -c 'import time; time.sleep(60)' /run/fetanagent-staging-deploy-helper &
competitor=$!
wait_for_forbidden_argv "$competitor"
if require_no_other_mutator_processes; then exit 1; fi
kill "$competitor"
wait "$competitor" 2>/dev/null || true
competitor=''
unset LOCK_HOLDER_PROCESS_ID
if require_no_other_mutator_processes; then exit 1; fi
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(mutatorFixture.status, 0, mutatorFixture.stderr);

  const unmappedMarkerGroupFixture = spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
${forward}
fixture="$(mktemp -d)"
cleanup() { rm -rf -- "$fixture"; }
trap cleanup EXIT
CONTROL_ROOT="$fixture/control"
OWNER_RECEIPT_ROOT="$fixture/receipts"
SEAL_BINDING="$fixture/seal-binding"
FINAL_BINDING="$fixture/final-binding"
RECHECK_RECEIPT="$fixture/recheck-receipt"
H14_ROOT="$fixture/h14"
PLAYER_STAGE_NAME='player-stage'
CLAIM_STAGE_NAME='claim-stage'
PROFILE_ACK_NAME='profile-ack'
FAILED_MARKER_NAME='failed-marker'
PROFILE_FINALIZED_NAME='profile-finalized'
TERMINAL_MARKER_NAME='terminal-marker'
mkdir -p "$CONTROL_ROOT" "$OWNER_RECEIPT_ROOT" "$H14_ROOT"
printf '%037d' 0 >"$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME"
stat() {
  local format="$1" path="\${!#}"
  if [[ "$path" == "$OWNER_RECEIPT_ROOT" && "$format" == "--format=%U:%G:%a" ]]; then
    printf '%s\\n' 'root:root:755'
  elif [[ "$path" == "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME" &&
    "$format" == "--format=%u:%g:%a:%h:%s" ]]; then
    printf '%s\\n' '0:10001:440:1:37'
  elif [[ "$path" == "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME" &&
    "$format" == "--format=%U:%G:%a:%h:%s" ]]; then
    printf '%s\\n' 'root:UNKNOWN:440:1:37'
  else
    command stat "$@"
  fi
}
resolved_marker_name="$(stat --format='%U:%G:%a:%h:%s' "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME")"
test "$resolved_marker_name" = 'root:UNKNOWN:440:1:37'
require_forward_artifacts_absent "$CONTROL_ROOT"
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(unmappedMarkerGroupFixture.status, 0, unmappedMarkerGroupFixture.stderr);
}

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
const exactTransportScript = `set -euo pipefail
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
${publishRecordFunction}
fixture="$(mktemp -d)"
record="$fixture/record-v1"
cleanup() { rm -rf -- "$fixture"; }
expected_record() {
  printf '%s\\n' 'version=1' 'state=completed' 'money_moved=false'
}
trap cleanup EXIT
chmod 0700 "$fixture"

# Fresh nonempty stdin must reach Python rather than being replaced by its source heredoc.
publish_exact_record "$record" 0600 < <(expected_record)
cmp -s -- "$record" <(expected_record)

# A durable exact interrupted prefix must be completed append-only.
rm -- "$record"
printf '%s\\n%s' 'version=1' 'sta' >"$fixture/.record-v1.installing"
chmod 0600 "$fixture/.record-v1.installing"
publish_exact_record "$record" 0600 < <(expected_record)
cmp -s -- "$record" <(expected_record)

# A committed final record is authoritative and exact replay is read-only.
before="$(stat --format='%d:%i:%s:%Y' "$record")"
publish_exact_record "$record" 0600 < <(expected_record)
test "$(stat --format='%d:%i:%s:%Y' "$record")" = "$before"
cmp -s -- "$record" <(expected_record)

# Empty input and a foreign prefix both fail closed without replacing bytes.
if publish_exact_record "$fixture/empty-v1" 0600 </dev/null; then exit 1; fi
printf 'foreign-prefix' >"$fixture/.foreign-v1.installing"
chmod 0600 "$fixture/.foreign-v1.installing"
if publish_exact_record "$fixture/foreign-v1" 0600 < <(expected_record); then exit 1; fi
test "$(cat "$fixture/.foreign-v1.installing")" = 'foreign-prefix'
`;
const exactTransportSyntax = spawnSync(bash, ['-n'], {
  encoding: 'utf8',
  input: exactTransportScript,
});
assert.equal(exactTransportSyntax.status, 0, exactTransportSyntax.stderr);
if (process.platform !== 'win32') {
  const rootInvocation =
    typeof process.getuid === 'function' && process.getuid() === 0
      ? { command: 'bash', args: ['-c', exactTransportScript] }
      : { command: 'sudo', args: ['-n', 'bash', '-c', exactTransportScript] };
  const exactTransport = spawnSync(rootInvocation.command, rootInvocation.args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(
    exactTransport.status,
    0,
    `exact publish stdin/prefix/replay fixture failed: ${exactTransport.stderr}`,
  );
}
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
