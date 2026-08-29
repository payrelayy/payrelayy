import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const operation = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery.sh',
);
const original = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh',
);
const validator = resolve(root, 'infra/operations/fetanagent-owner-archive-validator.py');
const fixtures = resolve(root, 'infra/verify-owner-archive-validator-fixtures.py');
const workflowPath = resolve(root, '.github/workflows/staging-beta-deploy-smoke.yml');
const normalized = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const script = normalized(operation);
const workflow = normalized(workflowPath);

function workflowRunBlock(stepName) {
  const step = workflow.indexOf(`      - name: ${stepName}\n`);
  assert.ok(step >= 0, `missing workflow step ${stepName}`);
  const boundaries = [
    workflow.indexOf('\n      - name:', step + 1),
    workflow.indexOf('\n  connectivity:\n', step + 1),
  ].filter((index) => index > step);
  const next = Math.min(...boundaries);
  assert.ok(next > step, `unterminated workflow step ${stepName}`);
  const section = workflow.slice(step, next);
  const marker = section.indexOf('        run: |\n');
  assert.ok(marker >= 0, `missing run block for ${stepName}`);
  return section
    .slice(marker + '        run: |\n'.length)
    .split('\n')
    .map((line) => {
      assert.ok(line === '' || line.startsWith('          '), `bad run-block indent: ${line}`);
      return line.slice(10);
    })
    .join('\n');
}

function resolvePython() {
  const candidates = [
    process.env.FETANAGENT_TEST_PYTHON,
    process.platform === 'win32'
      ? join(
          process.env.USERPROFILE ?? '',
          '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
        )
      : '/usr/bin/python3',
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Python 3 is required for Owner archive fixtures');
}

function resolveBash() {
  const candidates = [
    process.env.FETANAGENT_TEST_BASH,
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
    'bash',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Bash is required for Owner archive recovery verification');
}

assert.equal(
  createHash('sha256').update(readFileSync(original)).digest('hex'),
  'b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9',
  'the immutable 001 Owner bridge changed',
);

for (const needle of [
  "readonly SOURCE_ATTESTATION_RELEASE='001316f1f65dc7a9976244e8fc01f90aec665a70'",
  "readonly SOURCE_ATTESTATION_INTENT_SHA256='36c59fee9df1e0ffcf311e8abba1bef22d17c3bf786b8ba2a2f3f34af14245ab'",
  "readonly SOURCE_OWNER_BRIDGE_SHA256='b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9'",
  "readonly SOURCE_OWNER_TAR_SHA256='4b6348d76bfef9553fbea799da381cd1b6b27e78237c97386c694d9c9305a80e'",
  "readonly SOURCE_OWNER_TAR_SIZE='405925888'",
  "readonly SOURCE_OWNER_IMAGE_ID='sha256:ce2cb11cb28cd1b16411a94dc6f9225aaa37877bb0de688578645c5d296b3ce3'",
  "readonly SOURCE_OWNER_CLAIM_PARENT_DEV_INO='64769:6102879'",
  "readonly SOURCE_OWNER_CLAIM_ROOT_DEV_INO='64769:6102880'",
  "readonly PRIOR_FAILED_RECOVERY_RELEASE='911758fa1407093bee700918d5a663a7735f1658'",
  "readonly PRIOR_FAILED_RECOVERY_BUNDLE_PARENT_DEV_INO='64769:6102884'",
  "readonly PRIOR_FAILED_RECOVERY_BUNDLE_ROOT_DEV_INO='64769:6102885'",
  "readonly PRIOR_FAILED_RECOVERY_SCRIPT_DEV_INO='64769:6102886'",
  "readonly PRIOR_FAILED_RECOVERY_SCRIPT_SHA256='d3b61365d07325569089fab80415b595fa7a8b8486ae245fa4f6dcaa50ff5b9d'",
  "readonly PRIOR_FAILED_RECOVERY_SCRIPT_SIZE='151404'",
  "readonly PRIOR_FAILED_RECOVERY_VALIDATOR_DEV_INO='64769:6102887'",
  "readonly PRIOR_FAILED_RECOVERY_VALIDATOR_SHA256='6814f14708da844167b0f00a2b37c848eebb15eed64b7e1844f6bbeb0a9d36aa'",
  "readonly PRIOR_FAILED_RECOVERY_MANIFEST_DEV_INO='64769:6102888'",
  "readonly PRIOR_FAILED_RECOVERY_MANIFEST_SHA256='9c38e6fe7f5e24fd5309564fd0eda3a469794ab868718bc95ce65ecf64ac028a'",
  "readonly ORIGINAL_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge'",
  "readonly FAILED_CORRECTION_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery'",
  "readonly BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-docker-inspect-tmpfs-correction'",
  'env -i PATH="$SAFE_PATH" python3 -I "$STAGED_VALIDATOR"',
  '"$CLAIM_ROOT/$IMAGE_ARCHIVE_NAME" "$OWNER_IMAGE" "$OWNER_IMAGE_ID" oci 11 30',
  'archive_recovery_bundle_parent_dev_ino=',
  'archive_recovery_manifest_sha256=',
  'prior_failed_archive_recovery_runtime_ledger_absent=true',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'provider_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'money_moved=false',
]) {
  assert.ok(script.includes(needle), `recovery script is missing ${needle}`);
}

assert.equal((script.match(/^#!\/usr\/bin\/env bash$/gm) ?? []).length, 1);
assert.doesNotMatch(script, /36c59fee9df1e0ffcf311e8abba1bef22d17c3bf786b8ba2a2f3f34af14245'/);
assert.ok((script.match(/require_original_bridge_namespace_absent/g) ?? []).length >= 12);
assert.ok((script.match(/require_prior_failed_runtime_ledger_absent/g) ?? []).length >= 6);
for (const needle of [
  "FAILED_CORRECTION_RELEASE='ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b'",
  "FAILED_CORRECTION_BRIDGE_PARENT_DEV_INO='64769:6102893'",
  "FAILED_CORRECTION_BRIDGE_INSTALLING_DEV_INO='64769:6102894'",
  'require_owner_contract "$OLD_OWNER_CONTAINER_ID" "$PREDECESSOR_RELEASE" \'-\'',
  "'/tmp': 'rw,noexec,nosuid,size=32m,mode=1777'",
  'owner_tmpfs_host_config=required-exact',
  'owner_inspect_mount_inventory=non-tmpfs-eight',
]) {
  assert.ok(script.includes(needle), `correction script is missing ${needle}`);
}
assert.ok(
  !script.includes("expected_mounts['/tmp']"),
  'Docker tmpfs must not be conflated with inspect Mounts',
);
assert.ok(
  !script.includes('historical-absent'),
  'the disproved historical-absent mode must not survive',
);
assert.ok(
  !script.includes('tmpfs_mode'),
  'all Owner generations must use one exact tmpfs contract',
);
for (const boundary of [
  "require_prior_failed_runtime_ledger_absent || die 'the ff989 empty pre-intent evidence changed before image load'\n  docker_local image load",
  "require_prior_failed_runtime_ledger_absent || die 'the ff989 empty pre-intent evidence changed before Owner stop'\n      docker_local container stop",
  "require_prior_failed_runtime_ledger_absent || die 'the ff989 empty pre-intent evidence changed before Owner removal'\n  docker_local container rm",
  "require_prior_failed_runtime_ledger_absent || die 'the ff989 empty pre-intent evidence changed before replacement creation'\n    env -i",
  "require_prior_failed_runtime_ledger_absent || die 'the ff989 empty pre-intent evidence changed before replacement startup'\n    docker_local container start",
]) {
  assert.ok(
    script.includes(boundary),
    `missing immediate ff989 proof at mutation boundary: ${boundary}`,
  );
}
const exactTmpfs = { '/tmp': 'rw,noexec,nosuid,size=32m,mode=1777' };
const acceptsTmpfs = (observed, mountDestinations) =>
  JSON.stringify(observed) === JSON.stringify(exactTmpfs) &&
  mountDestinations.length === 8 &&
  !mountDestinations.includes('/tmp');
const eightMounts = Array.from({ length: 8 }, (_, index) => `/non-tmpfs-${index}`);
assert.ok(acceptsTmpfs(exactTmpfs, eightMounts), 'H13 exact HostConfig.Tmpfs fixture rejected');
assert.ok(acceptsTmpfs(exactTmpfs, eightMounts), 'H14 exact HostConfig.Tmpfs fixture rejected');
for (const [tmpfs, mounts] of [
  [null, eightMounts],
  [{}, eightMounts],
  [{ '/tmp': 'rw,noexec,nosuid,size=64m,mode=1777' }, eightMounts],
  [{ ...exactTmpfs, '/extra': 'rw' }, eightMounts],
  [exactTmpfs, [...eightMounts, '/tmp']],
]) {
  assert.ok(
    !acceptsTmpfs(tmpfs, mounts),
    `invalid tmpfs fixture accepted: ${JSON.stringify(tmpfs)}`,
  );
}

const executionStart = script.indexOf(
  "create_or_discover_bridge_ledger || die 'the separate Owner-runtime bridge ledger is unsafe'",
);
assert.ok(executionStart >= 0, 'missing recovery ledger discovery');
const execution = script.slice(executionStart);
const intentPublish = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/intent-v1" 0600 < <(expected_bridge_intent)',
);
const postIntentValidation = execution.indexOf(
  "require_bridge_intent || die 'the published Owner-runtime bridge intent is invalid'",
);
const migrationProof = execution.indexOf(
  'require_migration_through_old_owner "$OLD_OWNER_CONTAINER_ID"',
);
const postIntentTerminalProof = execution.indexOf(
  'require_live_terminal_attestation_boundary "$OLD_OWNER_CONTAINER_ID" running',
  migrationProof,
);
const postIntentNamespaceProof = execution.indexOf(
  'require_original_bridge_namespace_absent ||',
  postIntentTerminalProof,
);
const firstPersistentDockerMutation = Math.min(
  ...[
    'docker_local image load --input',
    'docker_local container stop --time',
    'docker_local container rm "$OLD_OWNER_CONTAINER_ID"',
    'create --no-build --no-deps "$OWNER_SERVICE"',
    'docker_local container start "$NEW_OWNER_CONTAINER_ID"',
  ].map((needle) => {
    const index = execution.indexOf(needle);
    assert.ok(index >= 0, `missing persistent Docker mutation ${needle}`);
    return index;
  }),
);
assert.ok(intentPublish > 0, 'intent is not published');
assert.ok(postIntentValidation > intentPublish, 'intent is not validated after publication');
assert.ok(migrationProof > postIntentValidation, 'container-exec proof precedes durable intent');
assert.ok(
  postIntentTerminalProof > migrationProof,
  'terminal proof does not follow container-exec proof',
);
assert.ok(
  postIntentNamespaceProof > postIntentTerminalProof,
  'original-namespace proof does not follow terminal proof',
);
assert.ok(
  firstPersistentDockerMutation > postIntentNamespaceProof,
  'persistent Docker mutation precedes the post-intent read-only proof boundary',
);

for (const needle of [
  'h14-owner-runtime-bridge-archive-recovery-stage:',
  'git fetch --no-tags --depth=1 origin 001316f1f65dc7a9976244e8fc01f90aec665a70',
  'git fetch --no-tags --depth=1 origin 911758fa1407093bee700918d5a663a7735f1658',
  'git fetch --no-tags --depth=1 origin ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b',
  'contract=fetanagent-h14-owner-runtime-bridge-archive-recovery-bundle',
  'failed_owner_bridge_implementation_sha=001316f1f65dc7a9976244e8fc01f90aec665a70',
  'failed_owner_bridge_script_sha256=b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9',
  'prior_failed_recovery_implementation_sha=911758fa1407093bee700918d5a663a7735f1658',
  'prior_failed_recovery_bundle_parent_dev_ino=64769:6102884',
  'prior_failed_recovery_bundle_root_dev_ino=64769:6102885',
  'prior_failed_recovery_script_dev_ino=64769:6102886',
  'prior_failed_recovery_script_sha256=d3b61365d07325569089fab80415b595fa7a8b8486ae245fa4f6dcaa50ff5b9d',
  'prior_failed_archive_validator_dev_ino=64769:6102887',
  'prior_failed_archive_validator_sha256=6814f14708da844167b0f00a2b37c848eebb15eed64b7e1844f6bbeb0a9d36aa',
  'prior_failed_recovery_manifest_dev_ino=64769:6102888',
  'prior_failed_recovery_manifest_sha256=9c38e6fe7f5e24fd5309564fd0eda3a469794ab868718bc95ce65ecf64ac028a',
  'failed_correction_implementation_sha=ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b',
  'failed_correction_manifest_sha256=1431f2148bda24dd18bc8cf3441f84fc2cad021be9d49e6ff33e8796ca60508d',
  'failed_correction_bridge_parent_dev_ino=64769:6102893',
  'failed_correction_bridge_installing_dev_ino=64769:6102894',
  'owner_tmpfs_host_config=required-exact',
  'owner_inspect_mount_inventory=non-tmpfs-eight',
  'archive_encoding=oci',
  'archive_layer_count=11',
  'archive_member_count=30',
  'claim_one() {',
  '.installing-$CONFIRMED_RECOVERY_RELEASE',
  "exec bash '$script' '$CONFIRMED_RECOVERY_RELEASE' '$SCRIPT_SHA' '$VALIDATOR_SHA' '$MANIFEST_SHA' 'a579e3bf96c075dde9c36dbe3c66c09aaf84bc52' '$H14_RECOVERY_AUTHORIZATION_SHA256'",
]) {
  assert.ok(workflow.includes(needle), `workflow is missing ${needle}`);
}

const rootEmission = workflowRunBlock('Emit exact root-console invocation without execution');
for (const state of [
  '"$(basename "$prior_root")" "$(basename "$failed_root")"',
  '"$(basename "$failed_root")" "$(basename "$installing")"',
  '"$(basename "$failed_root")" "$(basename "$root")"',
]) {
  assert.ok(rootEmission.includes(state), `missing two-claim interruption state ${state}`);
}
assert.ok(
  !rootEmission.includes('if [[ ! -e "$parent" && ! -L "$parent" ]]'),
  'the chained claim must never create or replace the existing 911 parent',
);
assert.ok(
  rootEmission.indexOf('64769:6102885:root:root:700') <
    rootEmission.indexOf("claim_one '$REMOTE_BUNDLE/"),
  'the prior claim must be proved before appending the new claim',
);

const prior = '911758fa1407093bee700918d5a663a7735f1658';
const failed = 'ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b';
const current = '0123456789abcdef0123456789abcdef01234567';
const installing = `.installing-${current}`;
const classifyChain = (children) => {
  const exact = [...children].sort().join('\n');
  if (exact === [prior, failed].sort().join('\n')) return 'append';
  if (exact === [prior, failed, installing].sort().join('\n')) return 'resume';
  if (exact === [prior, failed, current].sort().join('\n')) return 'complete';
  return 'reject';
};
for (const [children, expected] of [
  [[prior, failed], 'append'],
  [[prior, failed, installing], 'resume'],
  [[prior, failed, current], 'complete'],
  [[], 'reject'],
  [[current], 'reject'],
  [[prior, installing, current], 'reject'],
  [[prior, 'unexpected'], 'reject'],
]) {
  assert.equal(classifyChain(children), expected, `bad two-claim fixture ${children}`);
}

const bash = resolveBash();
const bashCheck = spawnSync(bash, ['-n', operation], { encoding: 'utf8' });
assert.equal(bashCheck.status, 0, bashCheck.stderr || bashCheck.stdout);
const terminalEmissionCheck = spawnSync(bash, ['-n'], {
  encoding: 'utf8',
  input: workflowRunBlock('Emit the exact terminal-attestation root-console invocation'),
});
assert.equal(
  terminalEmissionCheck.status,
  0,
  terminalEmissionCheck.stderr || terminalEmissionCheck.stdout,
);
const rootEmissionCheck = spawnSync(bash, ['-n'], {
  encoding: 'utf8',
  input: rootEmission,
});
assert.equal(rootEmissionCheck.status, 0, rootEmissionCheck.stderr || rootEmissionCheck.stdout);

const python = resolvePython();
const compile = spawnSync(python, ['-m', 'py_compile', validator, fixtures], { encoding: 'utf8' });
assert.equal(compile.status, 0, compile.stderr || compile.stdout);
const fixtureResult = spawnSync(python, ['-I', fixtures, validator], {
  encoding: 'utf8',
  timeout: 60_000,
});
assert.equal(fixtureResult.status, 0, fixtureResult.stderr || fixtureResult.stdout);
assert.match(fixtureResult.stdout, /classic\/OCI fixtures passed/);

console.log('H14 Owner archive-recovery workflow and fixtures verified');
