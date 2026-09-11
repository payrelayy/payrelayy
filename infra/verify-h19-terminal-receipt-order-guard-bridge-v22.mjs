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
  'infra/operations/fetanagent-h19-terminal-receipt-order-guard-bridge-v22.sh',
);
const guard = normalized('infra/operations/fetanagent-production-ingress-h19.sh');
const runbook = normalized('infra/production-gateway-staging-telebirr-route-h19.md');
const packageJson = normalized('package.json');
const guardDigest = sha256(guard);

const h19Release = '90b1f059577682b6bc458d239f6bdcb591077085';
const h21Release = 'ac0df375fb2ef6257d30c39f6cb4c2fa1dab01e2';
const h21Intent = 'e28e67e611ca8ece8cdddaa9c98634c0fb93324d547d50aa771920c89e59cc18';
const h21Completion = '15e1c3e5860aa6355f85be4114a5146f20e2683b1eb5da9b8351baf7a6b6d9ea';
const h20Guard = '4481190534fb41f057f0f3c716d74ba1f6445da009d491936c1098bdaa756f5a';
const h21Guard = 'a4e31a95bfb4826634069cdc31f745ed53cccb0db2cc01578851ac8330623813';
const helper = '8c7230cea5101f182f05b11b094049822ddbe43884d7bda80a9a46b883eee4b4';
const finalizer = '1ab7df7d5e530db75ba5f378169de0fda178c1a264df3a48fbb5acf76220f34f';
const sudoers = '0978f4785d4661db46d8fe9bb8e29d81fa5ff2954aceb36aa6cc7d2ec4a71807';
const transitionIntent = 'b0dd0ff0f66d961448e6e214feea8806627bf9f5aac1995436b2105f3fce6537';
const terminalReceipt = 'd33d2e51852fabdfd8f750bfd16118fe987e8b4201483b1cc2f688063047d559';
const postProduction = '72a619a6418030098a2ebb862d35d48f56118de886ae6ef88b09a782b29d2aac';
const postIngress = '98e3464ba86981b592c678d65b58eb10e747f9cb18a7b25cd6e697a2f27f6d89';
const tls = '2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8';
const canonicalNine = 'c3b49d74c01931601c829ddcf9d9d0edc237afe88fb0768794d5349549136f70';
const candidateImage = 'sha256:443aac301bb8c26a51f7877a9cf016e8fd2101831c0cac6f59f7bd88a17189e8';
const candidateCaddy = 'afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616';
const protectedRelease = '69be82ac3e49ff8c63c64c9aa7926e0046b48a10';

for (const [name, value] of [
  ['H21_RELEASE', h21Release],
  ['H21_INTENT_SHA256', h21Intent],
  ['H21_COMPLETION_SHA256', h21Completion],
  ['H20_GUARD_SHA256', h20Guard],
  ['H21_GUARD_SHA256', h21Guard],
  ['H20_HELPER_SHA256', helper],
  ['H20_FINALIZER_SHA256', finalizer],
  ['H20_SUDOERS_SHA256', sudoers],
  ['H19_RELEASE', h19Release],
  ['TRANSITION_INTENT_SHA256', transitionIntent],
  ['REVIEWED_TERMINAL_RECEIPT_SHA256', terminalReceipt],
  ['REVIEWED_SUCCESSOR_GUARD_SHA256', guardDigest],
  ['POST_PRODUCTION_BOUNDARY_SHA256', postProduction],
  ['POST_SHARED_INGRESS_SHA256', postIngress],
  ['TLS_LEAF_SHA256', tls],
  ['CANONICAL_NINE_SHA256', canonicalNine],
  ['REVIEWED_CANDIDATE_IMAGE_ID', candidateImage],
  ['CANDIDATE_CADDY_SHA256', candidateCaddy],
  ['PROTECTED_RELEASE', protectedRelease],
]) {
  assert.match(installer, new RegExp(`^readonly ${name}='${value}'$`, 'mu'));
}

const recordReader = shellFunction(guard, 'read_h19_record');
for (const invariant of [
  'h19-terminal-receipt-order-guard-bridge-v22',
  `h21_release_expected = '${h21Release}'`,
  `h21_intent_sha = '${h21Intent}'`,
  `h21_completion_sha = '${h21Completion}'`,
  `h21_guard_sha = '${h21Guard}'`,
  `terminal_receipt_sha = '${terminalReceipt}'`,
  `post_production_sha = '${postProduction}'`,
  `post_ingress_sha = '${postIngress}'`,
  'terminal-transition-receipt',
  'state=terminal-receipt-order-guard-installed',
  'correction=sorted-terminal-receipt-entry-order',
  'transition_terminal_evidence_preserved=true',
  'digest(h22_archived_guard) != h21_guard_sha',
  'digest(h22_archived_receipt) != terminal_receipt_sha',
  'digest(exact_file(guard, 0o755',
  "exact_dir(transition_terminal, ['completed-v1', 'intent-v1'])",
  'live_terminal_receipt != h22_archived_receipt',
]) {
  assert.ok(recordReader.includes(invariant), `missing H22 record invariant: ${invariant}`);
}
assert.match(
  guard,
  /readonly H22_PARENT='\/var\/lib\/fetanagent\/h19-terminal-receipt-order-guard-bridge-v22'/u,
);
assert.match(guard, /"\$\{#H19_RECORD\[@\]\}" -eq 20/u);
assert.match(
  recordReader,
  /print\(h22_release\)\s+print\(terminal_receipt_sha\)/u,
  'H22 identity and terminal receipt must be returned by the provenance reader',
);

const transitionParser = shellFunction(guard, 'require_transition_record');
assert.match(
  transitionParser,
  /sorted\(os\.listdir\(root\)\)!=sorted\(\['intent-v1',terminal\]\)/u,
  'terminal receipt entries must be compared in one canonical order',
);
assert.doesNotMatch(
  transitionParser,
  /sorted\(os\.listdir\(root\)\)!=\['intent-v1',terminal\]/u,
  'the reversed completed-receipt comparison must not return',
);

const intentFields = [
  'contract=fetanagent-h19-terminal-receipt-order-guard-bridge-v22',
  'state=authorized',
  'bridge_release=',
  'h21_bridge_release=',
  'h21_bridge_intent_sha256=',
  'h21_bridge_completion_sha256=',
  'h19_bridge_release=',
  'candidate_gateway_release=',
  'predecessor_ingress_guard_sha256=',
  'successor_ingress_guard_sha256=',
  'transition_intent_sha256=',
  'terminal_transition_receipt_sha256=',
  'post_production_boundary_sha256=',
  'post_shared_ingress_sha256=',
  'post_tls_leaf_sha256=',
  'candidate_gateway_image_id=',
  'correction=sorted-terminal-receipt-entry-order',
  'transition_terminal_evidence_preserved=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
];
assertInOrder(shellFunction(installer, 'expected_intent'), intentFields, 'H22 intent');
assert.match(
  shellFunction(installer, 'expected_completion'),
  /state=terminal-receipt-order-guard-installed/u,
);

assertInOrder(
  installer,
  [
    'require_staged_bundle ||',
    'require_h21_record_and_artifacts ||',
    'require_terminal_transition ||',
    'require_candidate_boundaries ||',
    'open_lock ||',
    'disable_deploy_grant ||',
    'publish_record "$H22_INSTALLING" intent-v1',
    'archive_file "$INGRESS_GUARD"',
    'archive_file "$TRANSITION_ROOT/completed-v1"',
    'install_successor_guard ||',
    'publish_record "$H22_INSTALLING" completed-v1',
    'mv -- "$H22_INSTALLING" "$H22_ROOT"',
    '"$INGRESS_GUARD" inspect "$H19_RELEASE"',
    'require_successor_record_output ||',
    'restore_deploy_grant ||',
  ],
  'H22 fail-closed transaction',
);
assert.doesNotMatch(installer, /docker_local\s+(?:compose|create|start|stop|rm|run)\b/u);
assert.doesNotMatch(installer, /supabase|psql|migration|edge function/iu);
assert.match(
  shellFunction(installer, 'canonical_nine_digest'),
  /del\(\.ExecIDs,\.State\.Health\.Log\)/u,
  'active health-check exec IDs must be excluded from the H22 preflight fingerprint',
);
assert.match(installer, /production_runtime_mutation=false/u);
assert.match(installer, /database_mutation=false/u);
assert.match(installer, /financial_actions_mode=disabled/u);
assert.match(installer, /amount_enabled=false/u);
assert.match(installer, /money_moved=false/u);

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash);

for (const path of [
  'infra/operations/fetanagent-production-ingress-h19.sh',
  'infra/operations/fetanagent-h19-terminal-receipt-order-guard-bridge-v22.sh',
]) {
  const result = spawnSync(bash, ['-n', path], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, `${path}: ${result.stderr}`);
}

const shellVariables = `set -euo pipefail
BRIDGE_RELEASE=${'1'.repeat(40)}
H21_RELEASE=${h21Release}
H21_INTENT_SHA256=${h21Intent}
H21_COMPLETION_SHA256=${h21Completion}
H19_RELEASE=${h19Release}
H21_GUARD_SHA256=${h21Guard}
SUCCESSOR_GUARD_SHA256=${guardDigest}
TRANSITION_INTENT_SHA256=${transitionIntent}
TERMINAL_RECEIPT_SHA256=${terminalReceipt}
POST_PRODUCTION_BOUNDARY_SHA256=${postProduction}
POST_SHARED_INGRESS_SHA256=${postIngress}
TLS_LEAF_SHA256=${tls}
CANDIDATE_IMAGE_ID=${candidateImage}
`;
const intentResult = spawnSync(bash, ['-s'], {
  input: `${shellVariables}${shellFunction(installer, 'expected_intent')}\nexpected_intent\n`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(intentResult.status, 0, intentResult.stderr);
const producedIntent = intentResult.stdout.trimEnd().split('\n');
assert.equal(producedIntent.length, 24);
assert.deepEqual(producedIntent, [
  'contract=fetanagent-h19-terminal-receipt-order-guard-bridge-v22',
  'state=authorized',
  `bridge_release=${'1'.repeat(40)}`,
  `h21_bridge_release=${h21Release}`,
  `h21_bridge_intent_sha256=${h21Intent}`,
  `h21_bridge_completion_sha256=${h21Completion}`,
  `h19_bridge_release=${h19Release}`,
  `candidate_gateway_release=${h19Release}`,
  `predecessor_ingress_guard_sha256=${h21Guard}`,
  `successor_ingress_guard_sha256=${guardDigest}`,
  `transition_intent_sha256=${transitionIntent}`,
  `terminal_transition_receipt_sha256=${terminalReceipt}`,
  `post_production_boundary_sha256=${postProduction}`,
  `post_shared_ingress_sha256=${postIngress}`,
  `post_tls_leaf_sha256=${tls}`,
  `candidate_gateway_image_id=${candidateImage}`,
  'correction=sorted-terminal-receipt-entry-order',
  'transition_terminal_evidence_preserved=true',
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
assert.equal(producedCompletion.length, 25);
assert.equal(producedCompletion[1], 'state=terminal-receipt-order-guard-installed');
assert.deepEqual(producedCompletion.slice(2, 24), producedIntent.slice(2, 24));
assert.equal(
  producedCompletion[24],
  `bridge_intent_sha256=${sha256(`${producedIntent.join('\n')}\n`)}`,
);

assert.match(runbook, /## H22 terminal receipt ordering correction/u);
assert.match(
  packageJson,
  /verify-h19-stable-nine-guard-bridge-v21\.mjs && node infra\/verify-h19-terminal-receipt-order-guard-bridge-v22\.mjs/u,
  'test:infra must run H22 immediately after H21',
);

console.log(
  `FetanAgent H22 terminal-receipt order guard bridge contracts verified; predecessor ${h21Guard}; successor ${guardDigest}; receipt ${terminalReceipt}.`,
);
