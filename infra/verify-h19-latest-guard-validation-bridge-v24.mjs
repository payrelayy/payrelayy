import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const normalized = (path) => readFileSync(resolve(path), 'utf8').replaceAll('\r\n', '\n');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const shellFunction = (source, name) => {
  const start = source.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `missing shell function ${name}`);
  const end = source.indexOf('\n}\n\n', start);
  assert.notEqual(end, -1, `unterminated shell function ${name}`);
  return source.slice(start, end + 3);
};
const assertInOrder = (source, needles, message) => {
  let cursor = -1;
  for (const needle of needles) {
    const found = source.indexOf(needle, cursor + 1);
    assert.ok(found > cursor, `${message}: missing or out of order: ${needle}`);
    cursor = found;
  }
};

const installer = normalized(
  'infra/operations/fetanagent-h19-latest-guard-validation-bridge-v24.sh',
);
const guard = normalized('infra/operations/fetanagent-production-ingress-h19.sh');
const runbook = normalized('infra/production-gateway-staging-telebirr-route-h19.md');
const v23Verifier = normalized('infra/verify-h19-runtime-reattest-guard-bridge-v23.mjs');
const guardDigest = sha256(guard);

const h19Release = '90b1f059577682b6bc458d239f6bdcb591077085';
const h23Release = '837f3addad1e1acf9707099c0590824739e8c788';
const h23Intent = '0d842ba7013b9af71543e906d5db7fec6ecf509485f21c6b814b3c4486213489';
const h23Completion = 'b51c3074d25daea13cd525c34de62a5a0efbf414cd16f5e0277cea76514f0d6a';
const h23Guard = '351156b4d6d18d1f7920ebee7b8817ca937d126faabf9863f31d8811662dd759';
const h23Correction = '930a76e11cd8f7ad77726a81981f2d25694d24da';
const h23Installer = '0e991a51096e57067857e005baea147f0c03cc865fb58e82e6c9ee13900a92a1';

for (const [name, value] of [
  ['H23_RELEASE', h23Release],
  ['H23_INTENT_SHA256', h23Intent],
  ['H23_COMPLETION_SHA256', h23Completion],
  ['H23_GUARD_SHA256', h23Guard],
  ['H23_CORRECTION_RELEASE', h23Correction],
  ['H23_INSTALLER_SHA256', h23Installer],
  ['H19_RELEASE', h19Release],
  ['REVIEWED_SUCCESSOR_GUARD_SHA256', guardDigest],
]) {
  assert.match(installer, new RegExp(`^readonly ${name}='${value}'$`, 'mu'));
}

assert.match(
  guard,
  /readonly H24_PARENT='\/var\/lib\/fetanagent\/h19-latest-guard-validation-bridge-v24'/u,
);
const recordReader = shellFunction(guard, 'read_h19_record');
for (const invariant of [
  'fetanagent-h19-latest-guard-validation-bridge-v24',
  `h23_intent_sha = '${h23Intent}'`,
  `h23_completion_sha = '${h23Completion}'`,
  `h23_guard_sha = '${h23Guard}'`,
  `h23_correction_release_expected = '${h23Correction}'`,
  'state=latest-guard-validation-installed',
  'correction=validate-installed-guard-at-latest-terminal-bridge',
  'h19_through_h23_evidence_preserved=true',
  'digest(h24_archived_guard) != h23_guard_sha',
  '!= h24_successor_guard_sha',
  'print(h24_successor_guard_sha)',
]) {
  assert.ok(recordReader.includes(invariant), `missing H24 record invariant: ${invariant}`);
}

const h22Block = recordReader.slice(
  recordReader.indexOf('h22_expected = ['),
  recordReader.indexOf('h23_children = os.listdir(h23_parent)'),
);
const h23Block = recordReader.slice(
  recordReader.indexOf('h23_expected = ['),
  recordReader.indexOf('h24_children = os.listdir(h24_parent)'),
);
const h24Block = recordReader.slice(recordReader.indexOf('h24_expected = ['));
assert.doesNotMatch(
  h22Block,
  /exact_file\(guard/u,
  'an historical H22 bridge must not require its guard to remain installed after H24',
);
assert.doesNotMatch(
  h23Block,
  /exact_file\(guard/u,
  'an historical H23 bridge must not require its rejected guard to remain installed after H24',
);
assert.match(
  h24Block,
  /digest\(exact_file\(guard, 0o755, 2 \* 1024 \* 1024\)\)[\s\S]*!= h24_successor_guard_sha/u,
  'only the newest terminal bridge must bind the installed guard',
);
assert.match(guard, /"\$H24_PARENT"[\s\S]*h24_parent[\s\S]*= sys\.argv\[1:\]/u);
assert.match(guard, /"\$\{#H19_RECORD\[@\]\}" -eq 30/u);

for (const invariant of [
  `"$H23_RELEASE" "$H23_GUARD_SHA256" "$H23_CONFIRMATION"`,
  `"$H23_CORRECTION_RELEASE" preflight`,
  'require_disabled_deploy_grant',
  'require_h23_boundary',
  'probe_successor_guard',
  'archive_predecessor_guard',
  'install_successor_guard',
  'require_successor_record_output',
]) {
  assert.ok(installer.includes(invariant), `missing H24 installer invariant: ${invariant}`);
}
assertInOrder(
  installer,
  [
    'require_staged_bundle ||',
    'require_exact_droplet ||',
    'require_h23_boundary ||',
    'require_disabled_deploy_grant ||',
    "probe_successor_guard || die 'the H24 successor rejected the real H19-H23 chain during preinstall probing'",
    'if [[ "$MODE" == preflight ]]',
    "open_lock || die 'the shared staging mutation lock is unavailable'",
    'publish_record "$H24_INSTALLING" intent-v1 expected_intent',
    'archive_predecessor_guard ||',
    'install_successor_guard ||',
    'publish_record "$H24_INSTALLING" completed-v1 expected_completion',
    'mv -- "$H24_INSTALLING" "$H24_ROOT"',
    '"$INGRESS_GUARD" inspect "$H19_RELEASE"',
    'require_successor_record_output ||',
    'restore_deploy_grant ||',
  ],
  'H24 fail-closed transaction',
);
assert.doesNotMatch(installer, /docker\s+(?:compose|create|start|stop|rm|run)\b/u);
assert.doesNotMatch(installer, /supabase|psql|migration|edge function/iu);
assert.match(installer, /production_runtime_mutation=false/u);
assert.match(installer, /database_mutation=false/u);
assert.match(installer, /financial_actions_mode=disabled/u);
assert.match(installer, /money_moved=false/u);
const successorProbe = shellFunction(installer, 'probe_successor_guard');
for (const invariant of [
  'mktemp -d /run/fetanagent-h24-guard-probe.XXXXXXXX',
  'expected_intent >"$probe_release/intent-v1"',
  'expected_completion >"$probe_release/completed-v1"',
  '"$probe_release/predecessor-ingress-guard"',
  'install -o root -g root -m 0755 "$STAGED_GUARD" "$probe_guard"',
  '"$H19_PARENT" "$H20_PARENT" "$H21_PARENT" "$H22_PARENT" "$H23_PARENT"',
  '"$probe_parent" "$TRANSITION_PARENT"',
  'rm -rf -- "$probe_root"',
]) {
  assert.ok(
    successorProbe.includes(invariant),
    `missing H24 live-parser probe invariant: ${invariant}`,
  );
}

const intentFields = [
  'contract=fetanagent-h19-latest-guard-validation-bridge-v24',
  'state=authorized',
  'bridge_release=',
  'h23_bridge_release=',
  'h23_bridge_intent_sha256=',
  'h23_bridge_completion_sha256=',
  'h19_bridge_release=',
  'candidate_gateway_release=',
  'predecessor_ingress_guard_sha256=',
  'successor_ingress_guard_sha256=',
  'correction=validate-installed-guard-at-latest-terminal-bridge',
  'h19_through_h23_evidence_preserved=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
];
assertInOrder(shellFunction(installer, 'expected_intent'), intentFields, 'H24 intent');
assert.match(
  shellFunction(installer, 'expected_completion'),
  /state=latest-guard-validation-installed[\s\S]*bridge_intent_sha256=/u,
);

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash);
for (const path of [
  'infra/operations/fetanagent-production-ingress-h19.sh',
  'infra/operations/fetanagent-h19-latest-guard-validation-bridge-v24.sh',
]) {
  const result = spawnSync(bash, ['-n', path], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, `${path}: ${result.stderr}`);
}

const bridgeRelease = '3'.repeat(40);
const shellVariables = `set -euo pipefail
BRIDGE_RELEASE=${bridgeRelease}
SUCCESSOR_GUARD_SHA256=${guardDigest}
H23_RELEASE=${h23Release}
H23_INTENT_SHA256=${h23Intent}
H23_COMPLETION_SHA256=${h23Completion}
H23_GUARD_SHA256=${h23Guard}
H19_RELEASE=${h19Release}
`;
const intentResult = spawnSync(bash, ['-s'], {
  input: `${shellVariables}${shellFunction(installer, 'expected_intent')}\nexpected_intent\n`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(intentResult.status, 0, intentResult.stderr);
const producedIntent = intentResult.stdout.trimEnd().split('\n');
assert.equal(producedIntent.length, 18);
assert.deepEqual(producedIntent, [
  'contract=fetanagent-h19-latest-guard-validation-bridge-v24',
  'state=authorized',
  `bridge_release=${bridgeRelease}`,
  `h23_bridge_release=${h23Release}`,
  `h23_bridge_intent_sha256=${h23Intent}`,
  `h23_bridge_completion_sha256=${h23Completion}`,
  `h19_bridge_release=${h19Release}`,
  `candidate_gateway_release=${h19Release}`,
  `predecessor_ingress_guard_sha256=${h23Guard}`,
  `successor_ingress_guard_sha256=${guardDigest}`,
  'correction=validate-installed-guard-at-latest-terminal-bridge',
  'h19_through_h23_evidence_preserved=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
]);
const completionResult = spawnSync(bash, ['-s'], {
  input: `${shellVariables}${shellFunction(installer, 'expected_intent')}
${shellFunction(installer, 'expected_completion')}
expected_completion
`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(completionResult.status, 0, completionResult.stderr);
const producedCompletion = completionResult.stdout.trimEnd().split('\n');
assert.equal(producedCompletion.length, 19);
assert.equal(producedCompletion[1], 'state=latest-guard-validation-installed');
assert.deepEqual(producedCompletion.slice(2, 18), producedIntent.slice(2));
assert.equal(
  producedCompletion[18],
  `bridge_intent_sha256=${sha256(`${producedIntent.join('\n')}\n`)}`,
);

assert.match(runbook, /## H24 latest-terminal guard validation correction/u);
assert.match(
  v23Verifier,
  /await import\('\.\/verify-h19-latest-guard-validation-bridge-v24\.mjs'\)/u,
  'the existing H23 infrastructure gate must immediately extend through H24',
);

console.log(
  `FetanAgent H24 latest-guard validation contracts verified; predecessor ${h23Guard}; successor ${guardDigest}.`,
);
