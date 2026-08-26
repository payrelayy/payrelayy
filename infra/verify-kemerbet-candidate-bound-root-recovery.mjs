import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const shellPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-candidate-bound-root-recovery-v1.sh',
);
const pythonPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-candidate-bound-root-recovery-v1.py',
);
const runbookPath = resolve(root, 'infra/staging-beta.md');
const packagePath = resolve(root, 'package.json');
const attributesPath = resolve(root, '.gitattributes');
const shell = readFileSync(shellPath, 'utf8');
const python = readFileSync(pythonPath, 'utf8');
const runbook = readFileSync(runbookPath, 'utf8');
const attributes = readFileSync(attributesPath, 'utf8');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

const release = '4bb491943fb88c50b86166184b929bdbe2698dc4';
const helperSha = '05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe';
const pythonSha = '206945947823be1db0657aa731a081dbbfdc349d3b76b8560ef2d6c5e94ce4ed';
const shellSha = 'ede67ec49a82a87eb3298f0f93fe51a140fceebe673e2af5ddd868e772558552';
const confirmation = 'I-UNDERSTAND-THIS-ADOPTS-THE-EXACT-FAILED-LATCH-AND-RECOVERS-NO-TRANSFER';
const project = 'fetanagent-staging-beta';
const snapshot = `${project}-kemerbet-readiness-profile-snapshot-once`;

const lf = (value) => value.replaceAll('\r\n', '\n');
const digest = (value) => createHash('sha256').update(lf(value)).digest('hex');
const rawDigest = (value) => createHash('sha256').update(value).digest('hex');

function includesOnce(source, text, label = text) {
  assert.equal(source.split(text).length - 1, 1, `${label} must appear exactly once`);
}

function inOrder(source, needles, label) {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.ok(next > cursor, `${label}: ${needle} is absent or out of order`);
    cursor = next;
  }
}

function functionBody(source, name, nextName) {
  const start = source.indexOf(`def ${name}(`);
  const end = source.indexOf(`def ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `cannot isolate ${name}`);
  return source.slice(start, end);
}

function shellFunctionBody(source, name, nextName) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf(`${nextName}() {`, start + 1);
  assert.ok(start >= 0 && end > start, `cannot isolate shell function ${name}`);
  return source.slice(start, end);
}

// Recovery-operation artifact identity and the exact one-use host/release boundary.
assert.ok(attributes.split(/\r?\n/u).includes('*.py text eol=lf'));
assert.ok(!python.includes('\r'), 'recovery Python must contain raw LF line endings only');
assert.equal(rawDigest(python), pythonSha);
assert.equal(digest(shell), shellSha);
for (const fixed of [release, helperSha, pythonSha, confirmation, '593344964', '161.35.41.232']) {
  assert.ok(shell.includes(fixed), `shell is missing hard pin ${fixed}`);
}
assert.ok(shell.includes(`readonly PROJECT_NAME='${project}'`));
assert.ok(
  shell.includes(
    `readonly SNAPSHOT_VOLUME="\${PROJECT_NAME}-kemerbet-readiness-profile-snapshot-once"`,
  ),
);
assert.ok(shell.includes('[[ "$(id -u)" == \'0\' && "$(id -un)" == \'root\' ]]'));
assert.ok(shell.includes('-z "${SUDO_USER:-}"'));
assert.ok(shell.includes('-z "${DOCKER_HOST:-}"'));
assert.ok(shell.includes('-z "${DOCKER_CONTEXT:-}"'));
assert.ok(shell.includes("readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'"));
assert.ok(shell.includes('flock --exclusive --nonblock 9'));
assert.ok(shell.includes("'0:0:600:1:'*"));
assert.ok(shell.includes("'root:root:755:1'"));
assert.ok(shell.includes("'root:root:440:1'"));
assert.ok(shell.includes('require_no_helper_processes'));

// The only network access is DigitalOcean link-local metadata; provider and public endpoints are absent.
includesOnce(shell, "metadata_get 'id'", 'exact droplet metadata lookup');
includesOnce(
  shell,
  "metadata_get 'interfaces/public/0/ipv4/address'",
  'exact public IPv4 metadata lookup',
);
const metadataGet = shellFunctionBody(shell, 'metadata_get', 'require_absent_path');
assert.ok(metadataGet.includes('env -i PATH="$SAFE_PATH" HOME=\'/root\''));
includesOnce(metadataGet, 'curl --disable --fail', 'curl config suppression');
assert.ok(metadataGet.includes('case "$metadata_path" in'));
assert.ok(metadataGet.includes("--noproxy '*' --proto '=http'"));
assert.ok(shell.includes("readonly METADATA='http://169.254.169.254/metadata/v1'"));
for (const forbidden of [
  'agentsystem.admindigi.com',
  'kemerbet.co',
  'fetanagent.com',
  'api.telegram.org',
  'supabase.co',
  'fetch(',
  'requests.',
  'urllib',
  'socket',
  'subprocess',
]) {
  assert.ok(!python.includes(forbidden), `Python contains forbidden capability ${forbidden}`);
  if (!['socket', 'subprocess', 'requests.', 'urllib'].includes(forbidden)) {
    assert.ok(!shell.includes(forbidden), `shell contains forbidden endpoint ${forbidden}`);
  }
}

// Docker scope is one exact disposable volume; every broader cleanup/start primitive is forbidden.
includesOnce(shell, 'docker_local volume rm "$SNAPSHOT_VOLUME"', 'exact snapshot removal');
for (const forbidden of [
  'volume prune',
  'system prune',
  'docker_local container rm',
  'docker_local network rm',
  'docker compose',
  ' compose up',
  ' container start',
  ' container run',
  'rm -rf',
  'rm -r',
  'stop-kemerbet-session-provision',
  'sudo -n "$TARGET"',
]) {
  assert.ok(!shell.includes(forbidden), `shell contains forbidden broad action ${forbidden}`);
}
inOrder(
  shell,
  [
    'require_fixed_stopped_boundary || die',
    'python_recovery authorize-snapshot-removal || die',
    'python_recovery verify-authorized-snapshot-volume-json || die',
    'require_volume_holder_free "$SNAPSHOT_VOLUME" || die',
    'docker_local volume rm "$SNAPSHOT_VOLUME" >/dev/null || die',
    'python_recovery recover || die',
    'python_recovery verify-terminal || die',
  ],
  'root wrapper transaction',
);
assert.ok(shell.includes('[[ "$SNAPSHOT_PRESENT" == \'false\' ]]'));
assert.ok(shell.includes('--filter "name=^${SNAPSHOT_VOLUME}$"'));
assert.ok(shell.includes('"$DURABLE_VOLUME_DIGEST" == "$DURABLE_VOLUME_DIGEST_BEFORE"'));
assert.ok(shell.includes('require_runtime_secrets_absent'));
assert.ok(shell.includes('require_expiry_disarmed'));
assert.ok(shell.includes('require_absent_path "$RPC_ROOT"'));
assert.ok(shell.includes('require_absent_path "$BOT_RECEIPT_ROOT"'));

const authorizedSnapshotVerify = functionBody(
  python,
  'verify_authorized_snapshot_volume_json',
  'authorize_snapshot_removal',
);
inOrder(
  authorizedSnapshotVerify,
  [
    'values = load_volume_json("snapshot")',
    'journal, intent = read_archive_and_intent(paths)',
    'observed = read_snapshot_authorization(paths, journal, intent)',
    'expected = snapshot_authorization_content(journal, intent, values[0])',
    'if observed != expected:',
    'reject()',
  ],
  'second snapshot inspection authorization comparison',
);
for (const mountBinding of [
  'snapshot_contract_sha256=',
  'snapshot_mount_dev_ino=',
  'snapshot_mount_mode=',
]) {
  assert.ok(python.includes(mountBinding), `snapshot authorization is missing ${mountBinding}`);
}
const pythonSelfTest = functionBody(python, 'self_test', 'main');
for (const regression of [
  'snapshot_authorization_content(journal, intent, volume) != authorization',
  'changed_labels["Labels"]',
  'changed_options["Options"]',
  'changed_mount["Mountpoint"]',
  'os.rename(mount, old_mount)',
  'snapshot_authorization_content(journal, intent, volume) == authorization',
]) {
  assert.ok(
    pythonSelfTest.includes(regression),
    `snapshot replacement regression is missing ${regression}`,
  );
}

// Root evidence adopts exact inode identities and archives authorization before mutation.
for (const fixed of [
  'fetanagent-kemerbet-candidate-bound-root-recovery-v1',
  'state=candidate_bound',
  'adopted_latch_dev_ino=',
  'imported_marker_dev_ino=',
  'snapshot-removal-authorized-v1',
  'state=snapshot-removal-authorized',
  'state=retryable-proven',
  'state=completed',
  'transfer_enabled=false',
  'executor_started=false',
  'money_moved=false',
]) {
  assert.ok(python.includes(fixed), `Python evidence is missing ${fixed}`);
}
assert.ok(python.includes('exact_latch(paths.latch, expected_dev_ino)'));
assert.ok(python.includes('dev_ino(value) != intent_values["imported_marker_dev_ino"]'));
assert.ok(python.includes('atomic_publish(paths.recovery_root, "promotion-journal-v1"'));
assert.ok(
  python.includes(
    'atomic_publish(\n        paths.recovery_root,\n        "snapshot-removal-authorized-v1"',
  ),
);

const recover = functionBody(python, 'recover', 'verify_terminal');
inOrder(
  recover,
  [
    'read_snapshot_authorization(paths, journal, intent)',
    'validate_receipt_progress(',
    'consume_internal_player(paths, journal)',
    'repair_identity_key(paths, journal)',
    'restore_stages(paths, journal)',
    'remove_imported(paths, journal, intent_values)',
    'publish_failed(paths, journal, intent_values["adopted_latch_dev_ino"])',
    'validate_retryable_boundary(paths, journal, require_latch=True)',
    'atomic_publish(paths.recovery_root, "retryable-v1"',
    'remove_promotion(paths, journal)',
    'validate_retryable_boundary(paths, journal, require_latch=True)',
    'retire_adopted_latch(paths, intent_values["adopted_latch_dev_ino"])',
    'validate_retryable_boundary(paths, journal, require_latch=False)',
    'atomic_publish(paths.recovery_root, "completed-v1"',
    'verify_terminal(paths)',
  ],
  'journal-authorized retryable rollback',
);
assert.ok(!recover.includes('print('));
assert.ok(!python.includes('print('));
assert.ok(!python.includes('os.system'));
assert.ok(!python.includes('Popen'));

// Both terminal crash prefixes remain executable continuations, never operator-delete states.
const prepare = functionBody(python, 'prepare', 'repair_identity_key');
inOrder(
  prepare,
  [
    'promotion_state = promotion_root_state(os.listdir(paths.promotion_root))',
    'if promotion_state == "retirement-prefix":',
    'snapshot_authorization = validate_snapshot_authorization(paths, journal)',
    'retryable != retryable_content(journal, intent, snapshot_authorization)',
    'validate_retryable_boundary(paths, journal, require_latch=True)',
  ],
  'empty promotion-root retirement prefix',
);
assert.ok(
  prepare.includes('completion_installing_content=None if latch_present else completed'),
  'only the post-latch boundary may admit a completed-v1 installer prefix',
);

const retryableBoundary = functionBody(python, 'validate_retryable_boundary', 'remove_promotion');
assert.ok(retryableBoundary.includes('if completion_installing_content is None:'));
assert.ok(retryableBoundary.includes('require_absent(paths.completed_installing)'));
assert.ok(
  retryableBoundary.includes('require_content_prefix(prefix, completion_installing_content)'),
);
assert.ok(
  recover.includes('completion_installing_content=completed'),
  'post-latch recovery must carry the exact intended completion bytes to prefix validation',
);
inOrder(
  recover,
  [
    'if not path_absent(paths.promotion_root):',
    'promotion_state = promotion_root_state(os.listdir(paths.promotion_root))',
    'if promotion_state == "journal-present":',
    'else:',
    'retryable != retryable_content(journal, intent, snapshot_authorization)',
    'validate_retryable_boundary(paths, journal, require_latch=True)',
    'validate_uncommitted_absences(paths, journal)',
  ],
  'empty promotion-root recovery continuation',
);

const selfTest = functionBody(python, 'self_test', 'main');
for (const executablePrefixCheck of [
  'promotion_root_state([])',
  'promotion_root_state(["pending-v1"])',
  'for invalid_entries in (["unexpected"], ["pending-v1", "unexpected"])',
  'for prefix in (b"", completed[:1], completed[: len(completed) // 2], completed)',
  'require_content_prefix(bytes(corrupted_prefix), completed)',
]) {
  assert.ok(
    selfTest.includes(executablePrefixCheck),
    `Python self-test is missing crash-prefix case: ${executablePrefixCheck}`,
  );
}

// Failed is the final aggregate transition; promotion and the adopted latch retire only after proof.
const publishFailed = functionBody(python, 'publish_failed', 'validate_retryable_boundary');
assert.ok(publishFailed.includes('os.link(paths.failed_installing, paths.failed'));
assert.ok(publishFailed.includes('exact_latch(paths.latch, latch_identity)'));
const retireLatch = functionBody(python, 'retire_adopted_latch', 'recover');
assert.ok(retireLatch.includes('exact_latch(paths.latch, expected_dev_ino)'));
assert.ok(retireLatch.includes('os.unlink(paths.latch)'));
assert.ok(retireLatch.includes('fsync_directory(paths.receipt_root)'));

// Dedicated runbook subsection and test entry remain independently visible.
const heading = '### One-use root-certified `candidate_bound` recovery for release `4bb4919`';
includesOnce(runbook, heading, 'root recovery runbook heading');
const incidentOrderHeading = '#### Current incident order: recover, rotate, deploy, then recheck';
includesOnce(runbook, incidentOrderHeading, 'current incident order heading');
inOrder(
  runbook.slice(
    runbook.indexOf(incidentOrderHeading),
    runbook.indexOf('#### One-use third installed-v3 helper/release rotation'),
  ),
  [
    'Complete the one-use root-certified `candidate_bound` recovery.',
    'complete the one-use third installed-v3 helper/release',
    'Run the separately reviewed ordinary sealed deployment',
    'Only after those deployments pass their normal no-transfer health checks',
  ],
  'current incident recovery, rotation, deployment, and recheck order',
);
for (const fixed of [release, helperSha, pythonSha, shellSha, confirmation, snapshot]) {
  assert.ok(runbook.includes(fixed), `runbook is missing ${fixed}`);
}
assert.ok(
  runbook.includes(
    'Before any ordinary deployment,\ncomplete the one-use third installed-v3 helper/release rotation',
  ),
);
assert.ok(
  packageJson.scripts['test:infra'].includes(
    'node infra/verify-kemerbet-candidate-bound-root-recovery.mjs',
  ),
  'test:infra must include the isolated root-recovery verifier',
);

const bashCandidates =
  process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'bash'] : ['bash'];
const bashPath = bashCandidates.find((candidate) =>
  candidate.includes('\\') ? existsSync(candidate) : true,
);
const bashCheck = spawnSync(bashPath, ['-n', shellPath], { encoding: 'utf8' });
assert.equal(bashCheck.status, 0, bashCheck.stderr || 'recovery shell syntax check failed');

if (process.platform !== 'win32') {
  const compile = spawnSync('python3', ['-m', 'py_compile', pythonPath], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr || 'recovery Python compile failed');
  const selfTest = spawnSync('python3', ['-I', pythonPath, 'self-test'], { encoding: 'utf8' });
  assert.equal(selfTest.status, 0, selfTest.stderr || 'recovery Python self-test failed');
}

console.log('KemerBet exact candidate-bound root recovery contracts verified.');
