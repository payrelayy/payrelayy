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
  const next = workflow.indexOf('\n      - name:', step + 1);
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
  "readonly SOURCE_OWNER_BRIDGE_SHA256='b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9'",
  "readonly SOURCE_OWNER_TAR_SHA256='4b6348d76bfef9553fbea799da381cd1b6b27e78237c97386c694d9c9305a80e'",
  "readonly SOURCE_OWNER_TAR_SIZE='405925888'",
  "readonly SOURCE_OWNER_IMAGE_ID='sha256:ce2cb11cb28cd1b16411a94dc6f9225aaa37877bb0de688578645c5d296b3ce3'",
  "readonly SOURCE_OWNER_CLAIM_PARENT_DEV_INO='64769:6102879'",
  "readonly SOURCE_OWNER_CLAIM_ROOT_DEV_INO='64769:6102880'",
  "readonly ORIGINAL_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge'",
  "readonly BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery'",
  'env -i PATH="$SAFE_PATH" python3 -I "$STAGED_VALIDATOR"',
  '"$CLAIM_ROOT/$IMAGE_ARCHIVE_NAME" "$OWNER_IMAGE" "$OWNER_IMAGE_ID" oci 11 30',
  'archive_recovery_bundle_parent_dev_ino=',
  'archive_recovery_manifest_sha256=',
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
assert.ok((script.match(/require_original_bridge_namespace_absent/g) ?? []).length >= 12);

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
  'contract=fetanagent-h14-owner-runtime-bridge-archive-recovery-bundle',
  'failed_owner_bridge_implementation_sha=001316f1f65dc7a9976244e8fc01f90aec665a70',
  'failed_owner_bridge_script_sha256=b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9',
  'archive_encoding=oci',
  'archive_layer_count=11',
  'archive_member_count=30',
  'claim_one() {',
  '.installing-$CONFIRMED_RECOVERY_RELEASE',
  "exec bash '$script' '$CONFIRMED_RECOVERY_RELEASE' '$SCRIPT_SHA' '$VALIDATOR_SHA' '$MANIFEST_SHA' 'a579e3bf96c075dde9c36dbe3c66c09aaf84bc52' '$H14_RECOVERY_AUTHORIZATION_SHA256'",
]) {
  assert.ok(workflow.includes(needle), `workflow is missing ${needle}`);
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
