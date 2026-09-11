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

const installer = normalized('infra/operations/fetanagent-h19-canonical-cap-guard-bridge-v20.sh');
const helper = normalized('infra/operations/fetanagent-staging-deploy-helper.sh');
const guard = normalized('infra/operations/fetanagent-production-ingress-h19.sh');
const finalizer = normalized('infra/operations/fetanagent-staging-continuous-availability.sh');
const sudoers = normalized('infra/operations/fetanagent-staging-continuous-availability.sudoers');
const packageJson = normalized('package.json');

const helperDigest = sha256(helper);
const guardDigest = sha256(guard);
const finalizerDigest = sha256(finalizer);
const sudoersDigest = sha256(sudoers);
const h19Release = '90b1f059577682b6bc458d239f6bdcb591077085';
const h19Intent = '51e0f03017e8986d5bd76bbb97759437d86011ce448c34999ef1bb9836d056a3';
const h19Completion = 'fdccf275bb43f95ea140411c0cee044a6c8e13d884dae640c64123936a8119d5';
const h19Helper = 'b4a5975f97be388b8862e8d21c207815f02708e6476fa5e79b795825b3a01381';
const h19Finalizer = 'a1951a5559ef735e507b762369861fd71fefbde518a415f8c928956f7e20df39';
const h19Sudoers = '5e92a8c42d6b44ae22fa837efc9b35e54033a00a1e830a7bad8de2d3382f3796';
const h19Guard = '13e6f430d1fb6e83736265055bed9569431403411e5d459fd86c1d32b00adced';
const stopped = 'e6bc16831fd5172076bd02b655dfa1605cf622aa23bf576e1a28b8ee4e3502b5';
const production = '5dad1d4193f55450bb0b50c5132fd3ae91c64e6978cb6318bbfdbdb0846b7b00';
const ingress = 'c1161bba74e998ddc1282e23b7e269dcd4b552e0e39532d914ace73b1c05378a';
const tls = '2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8';

for (const [name, digest] of [
  ['REVIEWED_SUCCESSOR_HELPER_SHA256', helperDigest],
  ['REVIEWED_SUCCESSOR_FINALIZER_SHA256', finalizerDigest],
  ['REVIEWED_SUCCESSOR_SUDOERS_SHA256', sudoersDigest],
  ['REVIEWED_INGRESS_GUARD_SHA256', guardDigest],
  ['PREDECESSOR_HELPER_SHA256', h19Helper],
  ['PREDECESSOR_FINALIZER_SHA256', h19Finalizer],
  ['PREDECESSOR_SUDOERS_SHA256', h19Sudoers],
  ['PREDECESSOR_INGRESS_GUARD_SHA256', h19Guard],
  ['H19_RELEASE', h19Release],
  ['H19_INTENT_SHA256', h19Intent],
  ['H19_COMPLETION_SHA256', h19Completion],
  ['H19_STOPPED_STAGING_SHA256', stopped],
  ['H19_PRODUCTION_BOUNDARY_SHA256', production],
  ['H19_SHARED_INGRESS_SHA256', ingress],
  ['H19_TLS_LEAF_SHA256', tls],
]) {
  assert.match(installer, new RegExp(`^readonly ${name}='${digest}'$`, 'mu'));
}

assert.match(finalizer, new RegExp(`^readonly HELPER_SHA='${helperDigest}'$`, 'mu'));
assert.equal(
  sudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${finalizerDigest} /usr/local/sbin/fetanagent-staging-continuous-availability preflight *\n` +
    `fetanagent-admin ALL=(root) NOPASSWD: sha256:${finalizerDigest} /usr/local/sbin/fetanagent-staging-continuous-availability disable-expiry *\n`,
);

const productionContract = shellFunction(guard, 'require_production_contract');
assert.match(productionContract, /\.HostConfig\.CapAdd == \["CAP_NET_BIND_SERVICE"\]/u);
assert.doesNotMatch(productionContract, /\.HostConfig\.CapAdd == \["NET_BIND_SERVICE"\]/u);
assert.match(
  shellFunction(installer, 'require_protected_gateway_and_bridge'),
  /CAP_NET_BIND_SERVICE/u,
);

const correctedRecord = shellFunction(guard, 'read_h19_record');
for (const invariant of [
  'h19-canonical-cap-guard-bridge-v20',
  `h19_release = '${h19Release}'`,
  `h19_intent_sha = '${h19Intent}'`,
  `h19_completion_sha = '${h19Completion}'`,
  'predecessor-ingress-guard',
  'state=canonical-cap-guard-installed',
  'correction=docker-capability-canonicalization',
  'h19_terminal_evidence_preserved=true',
  'digest(archived_guard) != h19_guard_sha',
  'digest(exact_file(helper, 0o755',
  'digest(exact_file(guard, 0o755',
]) {
  assert.ok(
    correctedRecord.includes(invariant),
    `missing corrected-record invariant: ${invariant}`,
  );
}

const helperOverlay = shellFunction(helper, 'inspect_kemerbet_h19_route_bridge');
assert.match(helper, /KEMERBET_H19_CANONICAL_CAP_GUARD_BRIDGE_V20_PARENT/u);
assert.match(helperOverlay, /"\$STAGING_TELEBIRR_ROUTE_INGRESS_GUARD" record/u);
assert.match(helperOverlay, /"\$\{#inspection_lines\[@\]\}" -eq 11/u);
assert.match(helperOverlay, /KEMERBET_H19_ROUTE_BRIDGE_HELPER_SHA256=/u);
assert.match(helperOverlay, /KEMERBET_H19_INGRESS_GUARD_SHA256=/u);
const recordMode = guard.slice(guard.indexOf('  record)'), guard.indexOf('  inspect)'));
assert.match(recordMode, /3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267/u);
assert.match(recordMode, /"\$\{H19_RECORD\[5\]\}"/u);

const intentFields = [
  'contract=fetanagent-h19-canonical-cap-guard-bridge-v20',
  'state=authorized',
  'bridge_release=',
  'h19_bridge_release=',
  'candidate_gateway_release=',
  'h19_bridge_intent_sha256=',
  'h19_bridge_completion_sha256=',
  'predecessor_helper_sha256=',
  'successor_helper_sha256=',
  'predecessor_continuous_finalizer_sha256=',
  'successor_continuous_finalizer_sha256=',
  'predecessor_continuous_sudoers_sha256=',
  'successor_continuous_sudoers_sha256=',
  'predecessor_ingress_guard_sha256=',
  'successor_ingress_guard_sha256=',
  'stopped_staging_boundary_sha256=',
  'baseline_production_boundary_sha256=',
  'baseline_shared_ingress_boundary_sha256=',
  'baseline_tls_leaf_sha256=',
  'correction=docker-capability-canonicalization',
  'h19_terminal_evidence_preserved=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
];
assertInOrder(shellFunction(installer, 'expected_intent'), intentFields, 'H20 intent');
assert.match(
  shellFunction(installer, 'expected_completion'),
  /state=canonical-cap-guard-installed/u,
);

const installingRecord = shellFunction(installer, 'require_installing_record');
assert.match(installingRecord, /\.predecessor-ingress-guard\.installing/u);
assert.match(installingRecord, /PREDECESSOR_INGRESS_GUARD_SHA256/u);
const exactRecord = shellFunction(installer, 'require_exact_record');
assert.match(exactRecord, /predecessor-ingress-guard/u);
const archive = shellFunction(installer, 'archive_predecessors');
assert.match(archive, /reconcile_copy "\$INGRESS_GUARD" 755/u);
const installArtifacts = shellFunction(installer, 'install_successor_artifacts');
assert.match(
  installArtifacts,
  /reconcile_replace "\$STAGED_GUARD" 600 "\$INGRESS_GUARD" 755[\s\S]*PREDECESSOR_INGRESS_GUARD_SHA256/u,
);

assertInOrder(
  installer,
  [
    'resolve_h19_record ||',
    'disable_deploy_grant ||',
    'disable_continuous_grant ||',
    'archive_predecessors ||',
    'install_successor_artifacts ||',
    'publish_record_atomically "$H20_INSTALLING" completed-v1',
    'install_successor_continuous_sudoers ||',
    'remove_disabled_predecessor_sudoers ||',
    'require_successor_helper_boundary ||',
    'restore_deploy_grant ||',
  ],
  'H20 fail-closed transaction',
);
assert.match(installer, /require_transition_namespace_absent/u);
assert.match(
  installer,
  /"\$\(production_boundary_digest\)" == "\$H19_PRODUCTION_BOUNDARY_SHA256"/u,
);
assert.match(
  installer,
  /"\$\(stopped_staging_boundary_digest\)" == "\$H19_STOPPED_STAGING_SHA256"/u,
);
assert.doesNotMatch(installer, /docker_local\s+(?:compose|run|create|start|stop|rm)\b/u);
assert.match(installer, /production_runtime_mutation=false/u);
assert.match(installer, /database_mutation=false/u);
assert.match(installer, /money_moved=false/u);

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash);
const expectedIntent = shellFunction(installer, 'expected_intent');
const intentResult = spawnSync(bash, ['-s'], {
  input: `set -euo pipefail
BRIDGE_RELEASE=1111111111111111111111111111111111111111
CANDIDATE_RELEASE=${h19Release}
H19_RECORD=(${h19Release} ${h19Release} ${h19Intent} ${h19Completion})
PREDECESSOR_HELPER_SHA256=${h19Helper}
SUCCESSOR_HELPER_SHA256=${helperDigest}
PREDECESSOR_FINALIZER_SHA256=${h19Finalizer}
SUCCESSOR_FINALIZER_SHA256=${finalizerDigest}
PREDECESSOR_SUDOERS_SHA256=${h19Sudoers}
SUCCESSOR_SUDOERS_SHA256=${sudoersDigest}
PREDECESSOR_INGRESS_GUARD_SHA256=${h19Guard}
INGRESS_GUARD_SHA256=${guardDigest}
BASELINE_STOPPED_STAGING_BOUNDARY_SHA256=${stopped}
BASELINE_PRODUCTION_BOUNDARY_SHA256=${production}
BASELINE_SHARED_INGRESS_BOUNDARY_SHA256=${ingress}
BASELINE_TLS_LEAF_SHA256=${tls}
BASELINE_CADDY_SHA256=181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24
CANDIDATE_CADDY_SHA256=afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616
SHARED_NETWORK=fetanagent-telebirr-device-ingress
SHARED_NETWORK_ID=5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738
PROTECTED_RELEASE=69be82ac3e49ff8c63c64c9aa7926e0046b48a10
${expectedIntent}
expected_intent
`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(intentResult.status, 0, intentResult.stderr);
const producedIntent = intentResult.stdout.trimEnd().split('\n');
assert.deepEqual(producedIntent, [
  'contract=fetanagent-h19-canonical-cap-guard-bridge-v20',
  'state=authorized',
  'bridge_release=1111111111111111111111111111111111111111',
  `h19_bridge_release=${h19Release}`,
  `candidate_gateway_release=${h19Release}`,
  `h19_bridge_intent_sha256=${h19Intent}`,
  `h19_bridge_completion_sha256=${h19Completion}`,
  `predecessor_helper_sha256=${h19Helper}`,
  `successor_helper_sha256=${helperDigest}`,
  `predecessor_continuous_finalizer_sha256=${h19Finalizer}`,
  `successor_continuous_finalizer_sha256=${finalizerDigest}`,
  `predecessor_continuous_sudoers_sha256=${h19Sudoers}`,
  `successor_continuous_sudoers_sha256=${sudoersDigest}`,
  `predecessor_ingress_guard_sha256=${h19Guard}`,
  `successor_ingress_guard_sha256=${guardDigest}`,
  `stopped_staging_boundary_sha256=${stopped}`,
  `baseline_production_boundary_sha256=${production}`,
  `baseline_shared_ingress_boundary_sha256=${ingress}`,
  `baseline_tls_leaf_sha256=${tls}`,
  'baseline_gateway_caddyfile_sha256=181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24',
  'candidate_gateway_caddyfile_sha256=afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616',
  'staging_runtime_stopped=true',
  'shared_ingress_network=fetanagent-telebirr-device-ingress',
  'shared_ingress_network_id=5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738',
  'protected_production_release=69be82ac3e49ff8c63c64c9aa7926e0046b48a10',
  'accepted_production_ingress_states=baseline-or-reviewed-gateway-only',
  'correction=docker-capability-canonicalization',
  'h19_terminal_evidence_preserved=true',
  'continuous_pair_rotated=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
]);
const causal = shellFunction(installer, 'require_causal_topology');
const allowed = new Set([
  'absent:old:old:old:old:missing:active',
  'absent:old:old:old:old:missing:disabled',
  'absent:old:old:old:missing:old:disabled',
  'empty-parent:old:old:old:missing:old:disabled',
  'interrupted:old:old:old:missing:old:disabled',
  'interrupted:old:old:new:missing:old:disabled',
  'interrupted:new:old:new:missing:old:disabled',
  'interrupted:new:new:new:missing:old:disabled',
  'completed:new:new:new:missing:old:disabled',
  'completed:new:new:new:new:old:disabled',
  'completed:new:new:new:new:missing:disabled',
  'completed:new:new:new:new:missing:active',
]);
const cases = [
  ...allowed,
  'absent:old:old:missing:old:missing:disabled',
  'interrupted:new:old:old:missing:old:disabled',
  'completed:new:new:old:new:missing:active',
  'completed:old:new:new:new:missing:active',
  'absent:new:new:new:new:missing:active',
];
let executableChecks = 0;
for (const topology of cases) {
  const [namespace, helperState, finalizerState, guardState, continuous, disabled, deploy] =
    topology.split(':');
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
TARGET=helper
CONTINUOUS_FINALIZER=finalizer
INGRESS_GUARD=guard
CONTINUOUS_SUDOERS=continuous
CONTINUOUS_SUDOERS_DISABLED=disabled
PREDECESSOR_HELPER_SHA256=o
SUCCESSOR_HELPER_SHA256=n
PREDECESSOR_FINALIZER_SHA256=o
SUCCESSOR_FINALIZER_SHA256=n
PREDECESSOR_INGRESS_GUARD_SHA256=o
INGRESS_GUARD_SHA256=n
PREDECESSOR_SUDOERS_SHA256=o
SUCCESSOR_SUDOERS_SHA256=n
classify_namespace() { printf '%s' '${namespace}'; }
artifact_state() {
  case "$1" in
    helper) printf '%s' '${helperState}' ;;
    finalizer) printf '%s' '${finalizerState}' ;;
    guard) printf '%s' '${guardState}' ;;
    continuous) printf '%s' '${continuous}' ;;
    disabled) printf '%s' '${disabled}' ;;
  esac
}
require_active_deploy_grant() { [[ '${deploy}' == active ]]; }
require_disabled_deploy_grant() { [[ '${deploy}' == disabled ]]; }
${causal}
require_causal_topology
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, allowed.has(topology) ? 0 : 1, `${topology}: ${result.stderr}`);
  executableChecks += 1;
}

assert.match(
  packageJson,
  /verify-staging-telebirr-route-helper-bridge-v19\.mjs && node infra\/verify-h19-canonical-cap-guard-bridge-v20\.mjs/u,
  'test:infra must run H20 immediately after H19',
);

console.log(
  `FetanAgent H20 canonical-cap guard bridge contracts and ${executableChecks} topology cases verified; helper ${helperDigest}; guard ${guardDigest}.`,
);
