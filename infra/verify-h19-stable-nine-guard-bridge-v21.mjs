import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const normalized = (path) => readFileSync(resolve(path), 'utf8').replaceAll('\r\n', '\n');
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

const installer = normalized('infra/operations/fetanagent-h19-stable-nine-guard-bridge-v21.sh');
const guard = normalized('infra/operations/fetanagent-production-ingress-h19.sh');
const packageJson = normalized('package.json');

const h19Release = '90b1f059577682b6bc458d239f6bdcb591077085';
const h20Release = 'db8ca9889a63045f4da403eebb028618a400407f';
const h20Intent = '369ac69c0492e870101281af499edf51181bc3b4d4c84b2361ebd1ad053cfb88';
const h20Completion = '37446dca1a59fb190299addf3679f2d4a2be27b8af5c52ad8dffc84232425f62';
const predecessorGuard = '4481190534fb41f057f0f3c716d74ba1f6445da009d491936c1098bdaa756f5a';
const h21Guard = 'a4e31a95bfb4826634069cdc31f745ed53cccb0db2cc01578851ac8330623813';
const interruptedIntent = 'b0dd0ff0f66d961448e6e214feea8806627bf9f5aac1995436b2105f3fce6537';
const legacyRawNine = '6aa4f35860635609b54e0884810b16fdb10a39275b687a8f678e5af86ed00c42';
const canonicalNine = 'a72b855a5b59e2169b9bbdca1dce03aa8dec17b16082fa83b0dc55b1910c90c9';
const production = '5dad1d4193f55450bb0b50c5132fd3ae91c64e6978cb6318bbfdbdb0846b7b00';
const ingress = 'c1161bba74e998ddc1282e23b7e269dcd4b552e0e39532d914ace73b1c05378a';
const tls = '2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8';
const protectedRelease = '69be82ac3e49ff8c63c64c9aa7926e0046b48a10';
const baselineImage = 'sha256:72f13d02d86c41d0b6fd1dd86d2827c16442f417ec5ef61c983eae297f57a209';
const candidateImage = 'sha256:443aac301bb8c26a51f7877a9cf016e8fd2101831c0cac6f59f7bd88a17189e8';

for (const [name, value] of [
  ['H20_RELEASE', h20Release],
  ['H20_INTENT_SHA256', h20Intent],
  ['H20_COMPLETION_SHA256', h20Completion],
  ['H19_RELEASE', h19Release],
  ['PREDECESSOR_GUARD_SHA256', predecessorGuard],
  ['REVIEWED_SUCCESSOR_GUARD_SHA256', h21Guard],
  ['REVIEWED_INTERRUPTED_INTENT_SHA256', interruptedIntent],
  ['LEGACY_RAW_NINE_SHA256', legacyRawNine],
  ['REVIEWED_CANONICAL_NINE_SHA256', canonicalNine],
  ['PRODUCTION_BOUNDARY_SHA256', production],
  ['SHARED_INGRESS_SHA256', ingress],
  ['TLS_LEAF_SHA256', tls],
  ['PROTECTED_RELEASE', protectedRelease],
  ['BASELINE_GATEWAY_IMAGE_ID', baselineImage],
  ['REVIEWED_CANDIDATE_IMAGE_ID', candidateImage],
]) {
  assert.match(installer, new RegExp(`^readonly ${name}='${value}'$`, 'mu'));
}

const recordReader = shellFunction(guard, 'read_h19_record');
for (const invariant of [
  'h19-stable-nine-guard-bridge-v21',
  `h20_release_expected = '${h20Release}'`,
  `h20_intent_sha = '${h20Intent}'`,
  `h20_completion_sha = '${h20Completion}'`,
  `h20_guard_sha = '${predecessorGuard}'`,
  `interrupted_intent_sha = '${interruptedIntent}'`,
  `legacy_raw_nine_sha = '${legacyRawNine}'`,
  `canonical_nine_sha = '${canonicalNine}'`,
  `h21_release_expected = 'ac0df375fb2ef6257d30c39f6cb4c2fa1dab01e2'`,
  `h21_intent_sha = 'e28e67e611ca8ece8cdddaa9c98634c0fb93324d547d50aa771920c89e59cc18'`,
  `h21_completion_sha = '15e1c3e5860aa6355f85be4114a5146f20e2683b1eb5da9b8351baf7a6b6d9ea'`,
  `h21_guard_sha = '${h21Guard}'`,
  'predecessor-ingress-guard',
  'interrupted-transition-intent',
  'state=stable-nine-guard-installed',
  'immutable_nine_canonicalization=drop-health-log-sort-mounts-and-containers',
  'live_transition != h21_archived_transition',
  'h21_successor_guard_sha != h21_guard_sha',
]) {
  assert.ok(recordReader.includes(invariant), `missing H21 record invariant: ${invariant}`);
}
assert.match(
  guard,
  /"\$H19_PARENT" "\$H20_PARENT" "\$H21_PARENT" "\$H22_PARENT"\s+\\\s+"\$TRANSITION_PARENT"/u,
);
assert.match(guard, /"\$\{#H19_RECORD\[@\]\}" -eq 20/u);

const canonicalDigest = shellFunction(guard, 'immutable_nine_digest');
assert.match(canonicalDigest, /del\(\.State\.Health\.Log\)/u);
assert.match(canonicalDigest, /\.Mounts \|= sort_by\(\[/u);
assert.match(
  canonicalDigest,
  /\.Type,\.Name,\.Source,\.Destination,\.Driver,\.Mode,\.RW,\.Propagation/u,
);
assert.match(canonicalDigest, /sort_by\(\.Name\)/u);
const legacyBridge = shellFunction(guard, 'expected_immutable_nine_digest');
assert.match(legacyBridge, /"\$recorded" == "\$\{H19_RECORD\[16\]\}"/u);
assert.match(legacyBridge, /"\$\{H19_RECORD\[17\]\}"/u);
assert.equal(
  [
    ...guard.matchAll(
      /immutable_nine_digest\)" == "\$\(expected_immutable_nine_digest "\$pre_immutable"\)"/gu,
    ),
  ].length,
  4,
  'transition and rollback must canonicalize all four immutable-nine comparisons',
);

const recoveryMode = guard.slice(guard.indexOf('  recovery-inspect)'), guard.indexOf('  inspect)'));
for (const invariant of [
  "$(transition_state)\" == 'interrupted'",
  'read_interrupted_transition_intent',
  '$CANDIDATE_GATEWAY_IMAGE_ID',
  '$BASELINE_GATEWAY_IMAGE_ID',
  'require_staging_absent',
  'require_candidate_image',
  'require_production_contract "$PROTECTED_RELEASE"',
  'require_shared_ingress',
  '$(immutable_nine_digest)" == "${H19_RECORD[17]}"',
  'public_smoke "$PROTECTED_RELEASE"',
  'money moved=false',
]) {
  assert.ok(recoveryMode.includes(invariant), `missing recovery-inspect invariant: ${invariant}`);
}

const intentFields = [
  'contract=fetanagent-h19-stable-nine-guard-bridge-v21',
  'state=authorized',
  'bridge_release=',
  'h20_bridge_release=',
  'h20_bridge_intent_sha256=',
  'h20_bridge_completion_sha256=',
  'h19_bridge_release=',
  'candidate_gateway_release=',
  'predecessor_ingress_guard_sha256=',
  'successor_ingress_guard_sha256=',
  'interrupted_transition_intent_sha256=',
  'legacy_raw_immutable_nine_sha256=',
  'canonical_immutable_nine_sha256=',
  'immutable_nine_canonicalization=drop-health-log-sort-mounts-and-containers',
  'baseline_production_boundary_sha256=',
  'baseline_shared_ingress_boundary_sha256=',
  'baseline_tls_leaf_sha256=',
  'baseline_gateway_image_id=',
  'candidate_gateway_image_id=',
  'protected_production_release=',
  'transition_contract=fetanagent-production-gateway-staging-route-v1',
  'interrupted_transition_state=authorized',
  'transition_evidence_preserved=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
];
assertInOrder(shellFunction(installer, 'expected_intent'), intentFields, 'H21 intent');
assert.match(shellFunction(installer, 'expected_completion'), /state=stable-nine-guard-installed/u);

assertInOrder(
  installer,
  [
    'require_staged_bundle ||',
    'require_interrupted_transition ||',
    'require_protected_boundaries ||',
    'open_lock ||',
    'disable_deploy_grant ||',
    'publish_record "$H21_INSTALLING" intent-v1',
    'archive_file "$INGRESS_GUARD"',
    'archive_file "$TRANSITION_INSTALLING/intent-v1"',
    'install_successor_guard ||',
    'publish_record "$H21_INSTALLING" completed-v1',
    'mv -- "$H21_INSTALLING" "$H21_ROOT"',
    '"$INGRESS_GUARD" recovery-inspect',
    'require_successor_record_output ||',
    'restore_deploy_grant ||',
  ],
  'H21 fail-closed transaction',
);
assert.doesNotMatch(installer, /docker_local\s+(?:compose|create|start|stop|rm)\b/u);
assert.doesNotMatch(installer, /supabase|psql|migration|edge function/iu);
assert.match(installer, /production_runtime_mutation=false/u);
assert.match(installer, /database_mutation=false/u);
assert.match(installer, /financial_actions_mode=disabled/u);
assert.match(installer, /money_moved=false/u);

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash);

const intentResult = spawnSync(bash, ['-s'], {
  input: `set -euo pipefail
BRIDGE_RELEASE=${'1'.repeat(40)}
H20_RELEASE=${h20Release}
H20_INTENT_SHA256=${h20Intent}
H20_COMPLETION_SHA256=${h20Completion}
H19_RELEASE=${h19Release}
PREDECESSOR_GUARD_SHA256=${predecessorGuard}
SUCCESSOR_GUARD_SHA256=${h21Guard}
INTERRUPTED_INTENT_SHA256=${interruptedIntent}
LEGACY_RAW_NINE_SHA256=${legacyRawNine}
CANONICAL_NINE_SHA256=${canonicalNine}
PRODUCTION_BOUNDARY_SHA256=${production}
SHARED_INGRESS_SHA256=${ingress}
TLS_LEAF_SHA256=${tls}
BASELINE_GATEWAY_IMAGE_ID=${baselineImage}
CANDIDATE_IMAGE_ID=${candidateImage}
PROTECTED_RELEASE=${protectedRelease}
${shellFunction(installer, 'expected_intent')}
expected_intent
`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(intentResult.status, 0, intentResult.stderr);
const producedIntent = intentResult.stdout.trimEnd().split('\n');
assert.equal(producedIntent.length, 29);
assert.deepEqual(producedIntent, [
  'contract=fetanagent-h19-stable-nine-guard-bridge-v21',
  'state=authorized',
  `bridge_release=${'1'.repeat(40)}`,
  `h20_bridge_release=${h20Release}`,
  `h20_bridge_intent_sha256=${h20Intent}`,
  `h20_bridge_completion_sha256=${h20Completion}`,
  `h19_bridge_release=${h19Release}`,
  `candidate_gateway_release=${h19Release}`,
  `predecessor_ingress_guard_sha256=${predecessorGuard}`,
  `successor_ingress_guard_sha256=${h21Guard}`,
  `interrupted_transition_intent_sha256=${interruptedIntent}`,
  `legacy_raw_immutable_nine_sha256=${legacyRawNine}`,
  `canonical_immutable_nine_sha256=${canonicalNine}`,
  'immutable_nine_canonicalization=drop-health-log-sort-mounts-and-containers',
  `baseline_production_boundary_sha256=${production}`,
  `baseline_shared_ingress_boundary_sha256=${ingress}`,
  `baseline_tls_leaf_sha256=${tls}`,
  `baseline_gateway_image_id=${baselineImage}`,
  `candidate_gateway_image_id=${candidateImage}`,
  `protected_production_release=${protectedRelease}`,
  'transition_contract=fetanagent-production-gateway-staging-route-v1',
  'interrupted_transition_state=authorized',
  'transition_evidence_preserved=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
]);

for (const [recorded, expected] of [
  [legacyRawNine, canonicalNine],
  [canonicalNine, canonicalNine],
  ['f'.repeat(64), 'f'.repeat(64)],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
H19_RECORD=(${'x '.repeat(16)}${legacyRawNine} ${canonicalNine})
${legacyBridge}
expected_immutable_nine_digest ${recorded}
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected);
}

assert.match(
  packageJson,
  /verify-h19-canonical-cap-guard-bridge-v20\.mjs && node infra\/verify-h19-stable-nine-guard-bridge-v21\.mjs/u,
  'test:infra must run H21 immediately after H20',
);

console.log(
  `FetanAgent H21 stable-nine guard bridge contracts verified; predecessor ${predecessorGuard}; historical successor ${h21Guard}; canonical nine ${canonicalNine}.`,
);
