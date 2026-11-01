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
const paidScriptPath = 'infra/operations/fetanagent-production-helper-rotation-v5.sh';
const paidDocsPath = 'infra/operations/production-helper-rotation-v5.md';
const settlementScriptPath = 'infra/operations/fetanagent-production-helper-rotation-v6.sh';
const settlementDocsPath = 'infra/operations/production-helper-rotation-v6.md';
const accessScriptPath = 'infra/operations/fetanagent-production-helper-rotation-v7.sh';
const accessDocsPath = 'infra/operations/production-helper-rotation-v7.md';
const sourceCommit = '7d8c930d5a587967664f05c849ebdb85966c0fd3';
const predecessorCommit = '966efd652a1183b9c9d8b7faf743e1af166a0ef6';
const predecessor = 'd2f537641dacb1f01d8f6a00f4ab295ee145a1cc31bc27fcaa596f9031a04996';
const successor = '7d144ca5c7a3524f5b6c17c9608737d70438c7261c2d44d10e6d597c9a902343';
const nextSuccessor = '4c50500ad040890ca639bac5423a86c7d8c0ee348b33a6999498c6257947bd79';
const latestSuccessor = 'cb23a2940f0cb6d523435ff98691b7ed06761e39b2161b1dd2e7e4c86c71c051';
const newestSuccessor = 'd3f8f285e410573e17968830ab5eb85fb9785497c4d58e876cb8a993b68ce792';
const paidSuccessor = 'ed18df6909769489eb4b3b562dc8f50f4bfb144cce3bc89393bea97ae013aff8';
const settlementSuccessor = '9cb11c2962d728355cc5884839cb12bde982726260925b2de220605b91673003';
const accessSuccessor = '38a8f424fa92d39805bfb8d8fe45e94dff547379d1940af976f35c15e1e6b8da';
const settlementCommit = 'df1126faaf3ac9887e8726a4e3c6b6829a34cf13';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const blob = (commit) => execFileSync('git', ['show', `${commit}:${helperPath}`], { cwd: root });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));

assert.equal(sha256(blob(predecessorCommit)), predecessor);
assert.equal(sha256(blob(sourceCommit)), successor);
assert.equal(sha256(blob(settlementCommit)), settlementSuccessor);
assert.equal(sha256(read(helperPath)), accessSuccessor);

const sudoers = read('infra/operations/fetanagent-production-deploy-helper.sudoers').toString();
assert.equal(
  sudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${accessSuccessor} /usr/local/sbin/fetanagent-production-deploy-helper *\n`,
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

const paidScript = read(paidScriptPath).toString();
const paidDocs = read(paidDocsPath).toString();
for (const value of [
  newestSuccessor,
  paidSuccessor,
  '593344964',
  'ROTATE EXACT PRODUCTION DEPLOY HELPER V5',
]) {
  assert.ok(paidScript.includes(value), `v5 rotation script does not pin ${value}`);
  assert.ok(paidDocs.includes(value), `v5 rotation runbook does not pin ${value}`);
}
for (const value of [
  '/usr/local/sbin/fetanagent-production-deploy-helper',
  '/etc/sudoers.d/fetanagent-production-deploy-helper',
  '/var/lib/fetanagent/production/helper.lock',
  '/var/lib/fetanagent/production/routine-deposits.release',
  '/var/lib/fetanagent/production/companion-execution-v2.release',
  'metadata/v1/id',
  'routine-paid-observation-bundle-allowlist-v5',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(paidScript.includes(value), `v5 rotation script lost a required boundary: ${value}`);
}
const paidRotationStart = paidScript.indexOf('rotate() {');
const paidRotation = paidScript.slice(paidRotationStart);
const paidStep = (value) => {
  const index = paidRotation.indexOf(value);
  assert.ok(index >= 0, `v5 rotation step absent: ${value}`);
  return index;
};
assert.ok(paidRotationStart > 0);
assert.ok(paidScript.indexOf('flock --nonblock 9') < paidRotationStart);
assert.ok(paidStep('acquire_lock') < paidStep('install_record "$INTENT" intent_body'));
assert.ok(
  paidStep('install_record "$INTENT" intent_body') <
    paidStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  paidStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    paidStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  paidStep('mv -T -- "$NEXT_HELPER" "$HELPER"') < paidStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  paidStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    paidStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(paidScript, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const settlementScript = read(settlementScriptPath).toString();
const settlementDocs = read(settlementDocsPath).toString();
for (const value of [
  paidSuccessor,
  settlementSuccessor,
  '593344964',
  'ROTATE EXACT PRODUCTION DEPLOY HELPER V6',
]) {
  assert.ok(settlementScript.includes(value), `v6 rotation script does not pin ${value}`);
  assert.ok(settlementDocs.includes(value), `v6 rotation runbook does not pin ${value}`);
}
for (const value of [
  '/usr/local/sbin/fetanagent-production-deploy-helper',
  '/etc/sudoers.d/fetanagent-production-deploy-helper',
  '/var/lib/fetanagent/production/helper.lock',
  '/var/lib/fetanagent/production/routine-deposits.release',
  '/var/lib/fetanagent/production/companion-execution-v2.release',
  'metadata/v1/id',
  'routine-paid-settlement-worker-v6',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(
    settlementScript.includes(value),
    `v6 rotation script lost a required boundary: ${value}`,
  );
}
const settlementRotationStart = settlementScript.indexOf('rotate() {');
const settlementRotation = settlementScript.slice(settlementRotationStart);
const settlementStep = (value) => {
  const index = settlementRotation.indexOf(value);
  assert.ok(index >= 0, `v6 rotation step absent: ${value}`);
  return index;
};
assert.ok(settlementRotationStart > 0);
assert.ok(settlementScript.indexOf('flock --nonblock 9') < settlementRotationStart);
assert.ok(settlementStep('acquire_lock') < settlementStep('install_record "$INTENT" intent_body'));
assert.ok(
  settlementStep('install_record "$INTENT" intent_body') <
    settlementStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  settlementStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    settlementStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  settlementStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    settlementStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  settlementStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    settlementStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(settlementScript, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const accessScript = read(accessScriptPath).toString();
const accessDocs = read(accessDocsPath).toString();
for (const value of [
  settlementSuccessor,
  accessSuccessor,
  '593344964',
  'ROTATE EXACT PRODUCTION DEPLOY HELPER V7',
]) {
  assert.ok(accessScript.includes(value), `v7 rotation script does not pin ${value}`);
  assert.ok(accessDocs.includes(value), `v7 rotation runbook does not pin ${value}`);
}
for (const value of [
  '/usr/local/sbin/fetanagent-production-deploy-helper',
  '/etc/sudoers.d/fetanagent-production-deploy-helper',
  '/var/lib/fetanagent/production/helper.lock',
  '/var/lib/fetanagent/production/routine-deposits.release',
  '/var/lib/fetanagent/production/companion-execution-v2.release',
  'metadata/v1/id',
  'routine-container-secret-access-v7',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(accessScript.includes(value), `v7 rotation script lost a required boundary: ${value}`);
}
const accessRotationStart = accessScript.indexOf('rotate() {');
const accessRotation = accessScript.slice(accessRotationStart);
const accessStep = (value) => {
  const index = accessRotation.indexOf(value);
  assert.ok(index >= 0, `v7 rotation step absent: ${value}`);
  return index;
};
assert.ok(accessRotationStart > 0);
assert.ok(accessScript.indexOf('flock --nonblock 9') < accessRotationStart);
assert.ok(accessStep('acquire_lock') < accessStep('install_record "$INTENT" intent_body'));
assert.ok(
  accessStep('install_record "$INTENT" intent_body') <
    accessStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  accessStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    accessStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  accessStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    accessStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  accessStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    accessStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(accessScript, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const unifiedHelperPath = 'infra/operations/fetanagent-production-deploy-helper-v2.sh';
const unifiedRotationPath =
  'infra/operations/fetanagent-production-v2-unified-deposit-rotation-v7.sh';
const unifiedDocsPath = 'infra/operations/production-unified-deposit-release.md';
const unifiedPredecessor = 'e00b5721a2b48cad8f5a7828081ebe9b05c239c6283a0123ac9f561e951ea1d2';
const unifiedSuccessor = '255b545f55df67038bdc737eb3aeaade49ebafcee5edd054b25e1926cf391336';
const unifiedCurrent = 'aa5db75897ac63e29917836aa7d52843b4a69ef6';
const unifiedHelper = read(unifiedHelperPath).toString();
const unifiedRotation = read(unifiedRotationPath).toString();
const unifiedDocs = read(unifiedDocsPath).toString();
assert.ok(
  unifiedHelper.includes("CBE_GUARDED_PREDECESSOR_SHA='6b7cbde53436037faf1c72af4fd589afb1a3122e'"),
);
for (const value of [
  unifiedPredecessor,
  unifiedSuccessor,
  unifiedCurrent,
  '593344964',
  'ROTATE EXACT PRODUCTION V2 UNIFIED DEPOSIT HELPER V7',
]) {
  assert.ok(unifiedRotation.includes(value), `unified rotation script does not pin ${value}`);
  assert.ok(unifiedDocs.includes(value), `unified release runbook does not pin ${value}`);
}
for (const value of [
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(unifiedRotation.includes(value), `unified rotation lost boundary: ${value}`);
}
const unifiedRotate = unifiedRotation.slice(unifiedRotation.indexOf('rotate() {'));
const unifiedStep = (value) => {
  const index = unifiedRotate.indexOf(value);
  assert.ok(index >= 0, `unified rotation step absent: ${value}`);
  return index;
};
assert.ok(unifiedRotation.indexOf('flock --nonblock 9') < unifiedRotation.indexOf('rotate() {'));
assert.ok(unifiedStep('acquire_lock') < unifiedStep('install_record "$INTENT" intent_body'));
assert.ok(
  unifiedStep('install_record "$INTENT" intent_body') <
    unifiedStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  unifiedStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    unifiedStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  unifiedStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    unifiedStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  unifiedStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    unifiedStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(unifiedRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const shortDepositRotationPath =
  'infra/operations/fetanagent-production-v2-short-deposit-rotation-v8.sh';
const shortDepositDocsPath = 'infra/operations/production-short-deposit-release.md';
const shortDepositPredecessor = unifiedSuccessor;
const shortDepositSuccessor = 'a345584d30466ef0d2265e1347f5ea5d8bece054e1e2d98ad9ee842fa101dd1b';
const shortDepositCurrent = '08420128eb114b33ef1b8fdaf8d41dc9fa3f4277';
const shortDepositRotation = read(shortDepositRotationPath).toString();
const shortDepositDocs = read(shortDepositDocsPath).toString();
for (const value of [
  shortDepositPredecessor,
  shortDepositSuccessor,
  shortDepositCurrent,
  '593344964',
  'ROTATE EXACT PRODUCTION V2 SHORT DEPOSIT HELPER V8',
]) {
  assert.ok(
    shortDepositRotation.includes(value),
    `short deposit rotation script does not pin ${value}`,
  );
  assert.ok(
    shortDepositDocs.includes(value),
    `short deposit release runbook does not pin ${value}`,
  );
}
for (const value of [
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(shortDepositRotation.includes(value), `short deposit rotation lost boundary: ${value}`);
}
const shortDepositRotate = shortDepositRotation.slice(shortDepositRotation.indexOf('rotate() {'));
const shortDepositStep = (value) => {
  const index = shortDepositRotate.indexOf(value);
  assert.ok(index >= 0, `short deposit rotation step absent: ${value}`);
  return index;
};
assert.ok(
  shortDepositRotation.indexOf('flock --nonblock 9') < shortDepositRotation.indexOf('rotate() {'),
);
assert.ok(
  shortDepositStep('acquire_lock') < shortDepositStep('install_record "$INTENT" intent_body'),
);
assert.ok(
  shortDepositStep('install_record "$INTENT" intent_body') <
    shortDepositStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  shortDepositStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    shortDepositStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  shortDepositStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    shortDepositStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  shortDepositStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    shortDepositStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(shortDepositRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const copyNumbersRotationPath =
  'infra/operations/fetanagent-production-v2-copy-numbers-rotation-v9.sh';
const copyNumbersDocsPath = 'infra/operations/production-copy-numbers-release.md';
const copyNumbersPredecessor = shortDepositSuccessor;
const copyNumbersSuccessor = '4df544545234de40bdb0a4fbf3f624e5938abbdc06619dd4b688088e2fac4329';
const copyNumbersCurrent = '05de2df452f844bcd49f022d52559eb7aff8ab78';
const copyNumbersRotation = read(copyNumbersRotationPath).toString();
const copyNumbersDocs = read(copyNumbersDocsPath).toString();
for (const value of [
  copyNumbersPredecessor,
  copyNumbersSuccessor,
  copyNumbersCurrent,
  '593344964',
  'ROTATE EXACT PRODUCTION V2 COPY NUMBERS HELPER V9',
]) {
  assert.ok(
    copyNumbersRotation.includes(value),
    `copy numbers rotation script does not pin ${value}`,
  );
  assert.ok(copyNumbersDocs.includes(value), `copy numbers release runbook does not pin ${value}`);
}
for (const value of [
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(copyNumbersRotation.includes(value), `copy numbers rotation lost boundary: ${value}`);
}
const copyNumbersRotate = copyNumbersRotation.slice(copyNumbersRotation.indexOf('rotate() {'));
const copyNumbersStep = (value) => {
  const index = copyNumbersRotate.indexOf(value);
  assert.ok(index >= 0, `copy numbers rotation step absent: ${value}`);
  return index;
};
assert.ok(
  copyNumbersRotation.indexOf('flock --nonblock 9') < copyNumbersRotation.indexOf('rotate() {'),
);
assert.ok(
  copyNumbersStep('acquire_lock') < copyNumbersStep('install_record "$INTENT" intent_body'),
);
assert.ok(
  copyNumbersStep('install_record "$INTENT" intent_body') <
    copyNumbersStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  copyNumbersStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    copyNumbersStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  copyNumbersStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    copyNumbersStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  copyNumbersStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    copyNumbersStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(copyNumbersRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const inlineNumbersRotationPath =
  'infra/operations/fetanagent-production-v2-inline-numbers-rotation-v10.sh';
const inlineNumbersDocsPath = 'infra/operations/production-inline-numbers-release.md';
const inlineNumbersPredecessor = copyNumbersSuccessor;
const inlineNumbersSuccessor = '7f775dee43c95aa9a044bacdcc10b2e8479c06165257e85c463545c5912c1c04';
const inlineNumbersCurrent = 'e0a880a808477397c800986856de2fd2c94184f9';
const inlineNumbersRotation = read(inlineNumbersRotationPath).toString();
const inlineNumbersDocs = read(inlineNumbersDocsPath).toString();
for (const value of [
  inlineNumbersPredecessor,
  inlineNumbersSuccessor,
  inlineNumbersCurrent,
  '593344964',
  'ROTATE EXACT PRODUCTION V2 INLINE NUMBERS HELPER V10',
]) {
  assert.ok(
    inlineNumbersRotation.includes(value),
    `inline numbers rotation script does not pin ${value}`,
  );
  assert.ok(
    inlineNumbersDocs.includes(value),
    `inline numbers release runbook does not pin ${value}`,
  );
}
for (const value of [
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(
    inlineNumbersRotation.includes(value),
    `inline numbers rotation lost boundary: ${value}`,
  );
}
const inlineNumbersRotate = inlineNumbersRotation.slice(
  inlineNumbersRotation.indexOf('rotate() {'),
);
const inlineNumbersStep = (value) => {
  const index = inlineNumbersRotate.indexOf(value);
  assert.ok(index >= 0, `inline numbers rotation step absent: ${value}`);
  return index;
};
assert.ok(
  inlineNumbersRotation.indexOf('flock --nonblock 9') < inlineNumbersRotation.indexOf('rotate() {'),
);
assert.ok(
  inlineNumbersStep('acquire_lock') < inlineNumbersStep('install_record "$INTENT" intent_body'),
);
assert.ok(
  inlineNumbersStep('install_record "$INTENT" intent_body') <
    inlineNumbersStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  inlineNumbersStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    inlineNumbersStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  inlineNumbersStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    inlineNumbersStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  inlineNumbersStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    inlineNumbersStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(inlineNumbersRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const telebirrRevisionRotation = read(
  'infra/operations/fetanagent-production-v2-telebirr-revision-helper-rotation-v1.sh',
).toString();
const telebirrRevisionHelperDigest =
  '455e3aa718e11d5d729861c02e507b3a1eb4f23905625c1f3bad8455a43dbd5e';
for (const value of [
  inlineNumbersSuccessor,
  telebirrRevisionHelperDigest,
  'ded01070ec1521af1ad940c4ab580abf47fc9d78',
  '593344964',
  'ROTATE EXACT PRODUCTION V2 TELEBIRR REVISION HELPER V1',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(telebirrRevisionRotation.includes(value), `TeleBirr receiver rotation lost ${value}`);
}
const telebirrRevisionRotate = telebirrRevisionRotation.slice(
  telebirrRevisionRotation.indexOf('rotate() {'),
);
const telebirrRevisionStep = (value) => {
  const index = telebirrRevisionRotate.indexOf(value);
  assert.ok(index >= 0, `TeleBirr receiver rotation step absent: ${value}`);
  return index;
};
assert.ok(
  telebirrRevisionRotation.indexOf('flock --nonblock 9') <
    telebirrRevisionRotation.indexOf('rotate() {'),
);
assert.ok(
  telebirrRevisionStep('acquire_lock') <
    telebirrRevisionStep('install_record "$INTENT" intent_body'),
);
assert.ok(
  telebirrRevisionStep('install_record "$INTENT" intent_body') <
    telebirrRevisionStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  telebirrRevisionStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    telebirrRevisionStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  telebirrRevisionStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    telebirrRevisionStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  telebirrRevisionStep(
    'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
  ) < telebirrRevisionStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(telebirrRevisionRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const pausedCreditRotation = read(
  'infra/operations/fetanagent-production-v2-paused-credit-helper-rotation-v1.sh',
).toString();
const pausedCreditHelperDigest = '040cf1ceb65e514e4812503d6010e2f0c3a86506e764076d63d904fd6428e429';
for (const value of [
  telebirrRevisionHelperDigest,
  pausedCreditHelperDigest,
  'f86b00e8e566428c3b81303a012973f8adb53137',
  '593344964',
  'ROTATE EXACT PRODUCTION V2 PAUSED CREDIT HELPER V1',
  'production-v2-paused-credit-helper-rotation-v1',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(pausedCreditRotation.includes(value), `Paused credit rotation lost ${value}`);
}
const pausedCreditRotate = pausedCreditRotation.slice(pausedCreditRotation.indexOf('rotate() {'));
const pausedCreditStep = (value) => {
  const index = pausedCreditRotate.indexOf(value);
  assert.ok(index >= 0, `Paused credit rotation step absent: ${value}`);
  return index;
};
assert.ok(
  pausedCreditRotation.indexOf('flock --nonblock 9') < pausedCreditRotation.indexOf('rotate() {'),
);
assert.ok(
  pausedCreditStep('acquire_lock') < pausedCreditStep('install_record "$INTENT" intent_body'),
);
assert.ok(
  pausedCreditStep('install_record "$INTENT" intent_body') <
    pausedCreditStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"'),
);
assert.ok(
  pausedCreditStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    pausedCreditStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  pausedCreditStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    pausedCreditStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.ok(
  pausedCreditStep('runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"') <
    pausedCreditStep('install_record "$COMPLETE" complete_body'),
);
assert.doesNotMatch(pausedCreditRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const uncertainIsolationRotation = read(
  'infra/operations/fetanagent-production-v2-uncertain-isolation-helper-rotation-v1.sh',
).toString();
for (const value of [
  pausedCreditHelperDigest,
  'be573f41360106411a4e121a7dc5a88a90944b87440b03712bbffea8ee255e85',
  '0cf74de563b8e332cc84b57eea21d64b331e1f7c',
  '593344964',
  'ROTATE EXACT PRODUCTION V2 UNCERTAIN ISOLATION HELPER V1',
  'production-v2-uncertain-isolation-helper-rotation-v1',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(uncertainIsolationRotation.includes(value), `Isolation rotation lost ${value}`);
}
const isolationRotate = uncertainIsolationRotation.slice(
  uncertainIsolationRotation.indexOf('rotate() {'),
);
const isolationStep = (value) => {
  const index = isolationRotate.indexOf(value);
  assert.ok(index >= 0, `Isolation rotation step absent: ${value}`);
  return index;
};
assert.ok(isolationStep('acquire_lock') < isolationStep('install_record "$INTENT" intent_body'));
assert.ok(
  isolationStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    isolationStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  isolationStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    isolationStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.doesNotMatch(uncertainIsolationRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const customerCopyRotation = read(
  'infra/operations/fetanagent-production-v2-customer-copy-helper-rotation-v1.sh',
).toString();
for (const value of [
  'be573f41360106411a4e121a7dc5a88a90944b87440b03712bbffea8ee255e85',
  '136f2a70767a1bc51e330f595116ded5f3af5eb7a9726b65ed38a4e4b695c620',
  '45535eca31446b0d652850398b3777eefb345507',
  '593344964',
  'ROTATE EXACT PRODUCTION V2 CUSTOMER COPY HELPER V1',
  'production-v2-customer-copy-helper-rotation-v1',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(customerCopyRotation.includes(value), `Customer-copy rotation lost ${value}`);
}
const customerCopyRotate = customerCopyRotation.slice(customerCopyRotation.indexOf('rotate() {'));
const customerCopyStep = (value) => {
  const index = customerCopyRotate.indexOf(value);
  assert.ok(index >= 0, `Customer-copy rotation step absent: ${value}`);
  return index;
};
assert.ok(
  customerCopyStep('acquire_lock') < customerCopyStep('install_record "$INTENT" intent_body'),
);
assert.ok(
  customerCopyStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    customerCopyStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  customerCopyStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    customerCopyStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.doesNotMatch(customerCopyRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const playerIdRotation = read(
  'infra/operations/fetanagent-production-v2-player-id-auto-detect-helper-rotation-v1.sh',
).toString();
for (const value of [
  '136f2a70767a1bc51e330f595116ded5f3af5eb7a9726b65ed38a4e4b695c620',
  '01f94e178365dd2c237f9b2c79bea139193a57f2e5096e03dd4b731e5ee988f8',
  '40dd8c1c02eb3f787d66d89ff7f9bd23d8fe518a',
  '593344964',
  'ROTATE EXACT PRODUCTION V2 PLAYER ID AUTO DETECT HELPER V1',
  'production-v2-player-id-auto-detect-helper-rotation-v1',
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(playerIdRotation.includes(value), `Player-ID rotation lost ${value}`);
}
const playerIdRotate = playerIdRotation.slice(playerIdRotation.indexOf('rotate() {'));
const playerIdStep = (value) => {
  const index = playerIdRotate.indexOf(value);
  assert.ok(index >= 0, `Player-ID rotation step absent: ${value}`);
  return index;
};
assert.ok(playerIdStep('acquire_lock') < playerIdStep('install_record "$INTENT" intent_body'));
assert.ok(
  playerIdStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    playerIdStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  playerIdStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    playerIdStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.doesNotMatch(playerIdRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const shortMenuRotation = read(
  'infra/operations/fetanagent-production-v2-short-player-id-menu-helper-rotation-v1.sh',
).toString();
const shortMenuRunbook = read(
  'infra/operations/production-short-player-id-menu-release.md',
).toString();
for (const value of [
  '01f94e178365dd2c237f9b2c79bea139193a57f2e5096e03dd4b731e5ee988f8',
  '263535acea17f8c16fa2ef6cbc866989905a6134d7b7258ac091f1ec08ba67e4',
  'b4f0449a3956256a4cf2345956476745a43f2ebc',
  '593344964',
  'ROTATE EXACT PRODUCTION V2 SHORT PLAYER ID MENU HELPER V1',
]) {
  assert.ok(shortMenuRotation.includes(value), `short-menu rotation lost ${value}`);
  assert.ok(shortMenuRunbook.includes(value), `short-menu runbook lost ${value}`);
}
for (const value of [
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(shortMenuRotation.includes(value), `short-menu rotation lost boundary: ${value}`);
}
const shortMenuRotate = shortMenuRotation.slice(shortMenuRotation.indexOf('rotate() {'));
const shortMenuStep = (value) => {
  const index = shortMenuRotate.indexOf(value);
  assert.ok(index >= 0, `short-menu rotation step absent: ${value}`);
  return index;
};
assert.ok(shortMenuStep('acquire_lock') < shortMenuStep('install_record "$INTENT" intent_body'));
assert.ok(
  shortMenuStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    shortMenuStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  shortMenuStep('mv -T -- "$NEXT_HELPER" "$HELPER"') <
    shortMenuStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.doesNotMatch(shortMenuRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

const speedRotation = read(
  'infra/operations/fetanagent-production-v2-player-credit-speed-helper-rotation-v1.sh',
).toString();
const speedRunbook = read('infra/operations/production-player-credit-speed-release.md').toString();
for (const value of [
  '263535acea17f8c16fa2ef6cbc866989905a6134d7b7258ac091f1ec08ba67e4',
  '64e976802d4f6719a4589ffe47e3029dba772d3690fa1f6762642d01cfb65e0e',
  '6fc3b00b492efb1b9ee7f6bbdad41d6225d62293',
  '593344964',
  'ROTATE EXACT PRODUCTION V2 PLAYER CREDIT SPEED HELPER V1',
]) {
  assert.ok(speedRotation.includes(value), `speed rotation lost ${value}`);
  assert.ok(speedRunbook.includes(value), `speed runbook lost ${value}`);
}
for (const value of [
  'require_staged_successor',
  'require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"',
  'require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"',
  'visudo -cf /etc/sudoers',
  'runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256"',
]) {
  assert.ok(speedRotation.includes(value), `speed rotation lost boundary: ${value}`);
}
const speedRotate = speedRotation.slice(speedRotation.indexOf('rotate() {'));
const speedStep = (value) => {
  const index = speedRotate.indexOf(value);
  assert.ok(index >= 0, `speed rotation step absent: ${value}`);
  return index;
};
assert.ok(speedStep('acquire_lock') < speedStep('install_record "$INTENT" intent_body'));
assert.ok(
  speedStep('mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"') <
    speedStep('mv -T -- "$NEXT_HELPER" "$HELPER"'),
);
assert.ok(
  speedStep('mv -T -- "$NEXT_HELPER" "$HELPER"') < speedStep('mv -T -- "$NEXT_SUDOERS" "$SUDOERS"'),
);
assert.doesNotMatch(speedRotation, /\b(?:docker|psql|rm|sed|chmod|chown)\s/u);

console.log('Production helper rotation pins and no-runtime-change ordering verified.');
