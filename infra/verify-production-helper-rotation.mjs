import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const helperPath = 'infra/operations/fetanagent-production-deploy-helper.sh';
const scriptPath = 'infra/operations/fetanagent-production-helper-rotation-v1.sh';
const docsPath = 'infra/operations/production-helper-rotation-v1.md';
const sourceCommit = '7d8c930d5a587967664f05c849ebdb85966c0fd3';
const predecessorCommit = '966efd652a1183b9c9d8b7faf743e1af166a0ef6';
const predecessor = 'd2f537641dacb1f01d8f6a00f4ab295ee145a1cc31bc27fcaa596f9031a04996';
const successor = '7d144ca5c7a3524f5b6c17c9608737d70438c7261c2d44d10e6d597c9a902343';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const blob = (commit) => execFileSync('git', ['show', `${commit}:${helperPath}`], { cwd: root });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));

assert.equal(sha256(blob(predecessorCommit)), predecessor);
assert.equal(sha256(blob(sourceCommit)), successor);
assert.equal(sha256(read(helperPath)), successor);

const sudoers = read('infra/operations/fetanagent-production-deploy-helper.sudoers').toString();
assert.equal(
  sudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${successor} /usr/local/sbin/fetanagent-production-deploy-helper *\n`,
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

console.log('Production helper rotation pins and no-runtime-change ordering verified.');
