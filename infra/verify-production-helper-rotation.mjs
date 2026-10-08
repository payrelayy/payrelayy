import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const helperPath = 'infra/operations/fetanagent-production-deploy-helper.sh';
const scriptPath = 'infra/operations/fetanagent-production-helper-rotation-v1.sh';
const docsPath = 'infra/operations/production-helper-rotation-v1.md';
const nextScriptPath = 'infra/operations/fetanagent-production-helper-rotation-v2.sh';
const nextDocsPath = 'infra/operations/production-helper-rotation-v2.md';
const latestScriptPath = 'infra/operations/fetanagent-production-helper-rotation-v3.sh';
const latestDocsPath = 'infra/operations/production-helper-rotation-v3.md';
const newestScriptPath = 'infra/operations/fetanagent-production-helper-rotation-v4.sh';
const newestDocsPath = 'infra/operations/production-helper-rotation-v4.md';
const sourceCommit = '7d8c930d5a587967664f05c849ebdb85966c0fd3';
const predecessorCommit = '966efd652a1183b9c9d8b7faf743e1af166a0ef6';
const predecessor = 'd2f537641dacb1f01d8f6a00f4ab295ee145a1cc31bc27fcaa596f9031a04996';
const successor = '7d144ca5c7a3524f5b6c17c9608737d70438c7261c2d44d10e6d597c9a902343';
const nextSuccessor = '4c50500ad040890ca639bac5423a86c7d8c0ee348b33a6999498c6257947bd79';
const latestSuccessor = 'cb23a2940f0cb6d523435ff98691b7ed06761e39b2161b1dd2e7e4c86c71c051';
const newestSuccessor = 'd3f8f285e410573e17968830ab5eb85fb9785497c4d58e876cb8a993b68ce792';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const blob = (commit) => execFileSync('git', ['show', `${commit}:${helperPath}`], { cwd: root });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));

assert.equal(sha256(blob(predecessorCommit)), predecessor);
assert.equal(sha256(blob(sourceCommit)), successor);
assert.equal(sha256(read(helperPath)), newestSuccessor);

const sudoers = read('infra/operations/fetanagent-production-deploy-helper.sudoers').toString();
assert.equal(
  sudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${newestSuccessor} /usr/local/sbin/fetanagent-production-deploy-helper *\n`,
);

const script = read(scriptPath).toString();
const docs = read(docsPath).toString();
for (const value of [sourceCommit, predecessor, successor, '593344964']) {
  assert.ok(script.includes(value), `rotation script does not pin ${value}`);
  assert.ok(docs.includes(value), `rotation runbook does not pin ${value}`);
}
for (const value of [
  '/usr/local/sbin/fetanagent-production-deploy-helper',
  '/etc/sudoers.d/fetanagent-production-deploy-helper',
  '/var/lib/fetanagent/production/helper.lock',
  '/var/lib/fetanagent/production/routine-deposits.release',
  '/var/lib/fetanagent/production/companion-execution-v2.release',
  'metadata/v1/id',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(script.includes(value), `rotation script lost a required boundary: ${value}`);
}

const rotationStart = script.indexOf('rotate() {');
const rotation = script.slice(rotationStart);
assert.ok(rotationStart > 0);
const step = (value) => {
  const index = rotation.indexOf(value);
  assert.ok(index >= 0, `rotation step absent: ${value}`);
  return index;
};
assert.ok(script.indexOf('flock --nonblock 9') < rotationStart);
assert.ok(step('acquire_lock') < step('install_record "$INTENT" intent_body'));
assert.ok(
  step('install_record "$INTENT" intent_body') < step('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  step('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') < step('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(step('mv -T -- "$NEXT_HELPER" "$HELPER"') < step('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'));
assert.ok(
  step('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    step('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(script, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const nextScript = read(nextScriptPath).toString();
const nextDocs = read(nextDocsPath).toString();
for (const value of [
  successor,
  nextSuccessor,
  '593344964',
  'ROTATE EXACT PRODUCTION DEPLOY HELPER V2',
]) {
  assert.ok(nextScript.includes(value), `v2 rotation script does not pin ${value}`);
  assert.ok(nextDocs.includes(value), `v2 rotation runbook does not pin ${value}`);
}
for (const value of [
  '/usr/local/sbin/fetanagent-production-deploy-helper',
  '/etc/sudoers.d/fetanagent-production-deploy-helper',
  '/var/lib/fetanagent/production/helper.lock',
  '/var/lib/fetanagent/production/routine-deposits.release',
  '/var/lib/fetanagent/production/companion-execution-v2.release',
  'metadata/v1/id',
  'routine-receipt-signer-v2',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(nextScript.includes(value), `v2 rotation script lost a required boundary: ${value}`);
}
const nextRotationStart = nextScript.indexOf('rotate() {');
const nextRotation = nextScript.slice(nextRotationStart);
const nextStep = (value) => {
  const index = nextRotation.indexOf(value);
  assert.ok(index >= 0, `v2 rotation step absent: ${value}`);
  return index;
};
assert.ok(nextRotationStart > 0);
assert.ok(nextScript.indexOf('flock --nonblock 9') < nextRotationStart);
assert.ok(nextStep('acquire_lock') < nextStep('install_record "$INTENT" intent_body'));
assert.ok(
  nextStep('install_record "$INTENT" intent_body') <
    nextStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  nextStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    nextStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  nextStep('mv -T -- "$NEXT_HELPER" "$HELPER"') < nextStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  nextStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    nextStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(nextScript, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const latestScript = read(latestScriptPath).toString();
const latestDocs = read(latestDocsPath).toString();
for (const value of [
  nextSuccessor,
  latestSuccessor,
  '593344964',
  'ROTATE EXACT PRODUCTION DEPLOY HELPER V3',
]) {
  assert.ok(latestScript.includes(value), `v3 rotation script does not pin ${value}`);
  assert.ok(latestDocs.includes(value), `v3 rotation runbook does not pin ${value}`);
}
for (const value of [
  '/usr/local/sbin/fetanagent-production-deploy-helper',
  '/etc/sudoers.d/fetanagent-production-deploy-helper',
  '/var/lib/fetanagent/production/helper.lock',
  '/var/lib/fetanagent/production/routine-deposits.release',
  '/var/lib/fetanagent/production/companion-execution-v2.release',
  'metadata/v1/id',
  'routine-no-money-phone-review-v3',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(latestScript.includes(value), `v3 rotation script lost a required boundary: ${value}`);
}
const latestRotationStart = latestScript.indexOf('rotate() {');
const latestRotation = latestScript.slice(latestRotationStart);
const latestStep = (value) => {
  const index = latestRotation.indexOf(value);
  assert.ok(index >= 0, `v3 rotation step absent: ${value}`);
  return index;
};
assert.ok(latestRotationStart > 0);
assert.ok(latestScript.indexOf('flock --nonblock 9') < latestRotationStart);
assert.ok(latestStep('acquire_lock') < latestStep('install_record "$INTENT" intent_body'));
assert.ok(
  latestStep('install_record "$INTENT" intent_body') <
    latestStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  latestStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    latestStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  latestStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    latestStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  latestStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    latestStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(latestScript, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const newestScript = read(newestScriptPath).toString();
const newestDocs = read(newestDocsPath).toString();
for (const value of [
  latestSuccessor,
  newestSuccessor,
  '593344964',
  'ROTATE EXACT PRODUCTION DEPLOY HELPER V4',
]) {
  assert.ok(newestScript.includes(value), `v4 rotation script does not pin ${value}`);
  assert.ok(newestDocs.includes(value), `v4 rotation runbook does not pin ${value}`);
}
for (const value of [
  '/usr/local/sbin/fetanagent-production-deploy-helper',
  '/etc/sudoers.d/fetanagent-production-deploy-helper',
  '/var/lib/fetanagent/production/helper.lock',
  '/var/lib/fetanagent/production/routine-deposits.release',
  '/var/lib/fetanagent/production/companion-execution-v2.release',
  'metadata/v1/id',
  'routine-no-money-bundle-allowlist-v4',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(newestScript.includes(value), `v4 rotation script lost a required boundary: ${value}`);
}
const newestRotationStart = newestScript.indexOf('rotate() {');
const newestRotation = newestScript.slice(newestRotationStart);
const newestStep = (value) => {
  const index = newestRotation.indexOf(value);
  assert.ok(index >= 0, `v4 rotation step absent: ${value}`);
  return index;
};
assert.ok(newestRotationStart > 0);
assert.ok(newestScript.indexOf('flock --nonblock 9') < newestRotationStart);
assert.ok(newestStep('acquire_lock') < newestStep('install_record "$INTENT" intent_body'));
assert.ok(
  newestStep('install_record "$INTENT" intent_body') <
    newestStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  newestStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    newestStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  newestStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    newestStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  newestStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    newestStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(newestScript, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

console.log('Production helper rotation pins and no-runtime-change ordering verified.');
