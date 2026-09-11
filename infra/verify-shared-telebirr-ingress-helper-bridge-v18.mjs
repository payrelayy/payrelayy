import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const normalized = (path) => readFileSync(resolve(path), 'utf8').replaceAll('\r\n', '\n');

const bridgePath = 'infra/operations/fetanagent-shared-telebirr-ingress-helper-bridge-v18.sh';
const helperPath = 'infra/operations/fetanagent-staging-deploy-helper.sh';
const bridge = normalized(bridgePath);
const helper = normalized(helperPath);
const packageJson = normalized('package.json');
// H18 is a historical bridge once H19 exists. Its installer must retain the
// exact artifacts it installed rather than following the current successor files.
const helperSha256 = '3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267';
const continuousFinalizerSha256 =
  '103b40c6ef76cca08e92bb5b475104f775b054b3981c5bb55057a085126745ea';
const continuousSudoersSha256 = 'd33645e4767102a64463d27d90b63685dd71d1352fb175eb64a738a06b21f958';

const predecessorHelperSha256 = '77e4822a0827413290fba94747698536b6af5bca3f2f7cdc58975dce390f7c84';
const productionRelease = '69be82ac3e49ff8c63c64c9aa7926e0046b48a10';
const networkId = '5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738';
const networkConfigHash = 'ac7f178b6d4280a708b951cb93740b0f8323fb2cb2c75d05cf040f44e2c34209';
const confirmation = 'I-UNDERSTAND-THIS-INSTALLS-ONE-H18-SHARED-INGRESS-HELPER-WITH-NO-MONEY';

const shellFunction = (source, name) => {
  const start = source.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `missing shell function ${name}`);
  const next = source.indexOf('\n}\n\n', start);
  assert.notEqual(next, -1, `unterminated shell function ${name}`);
  return source.slice(start, next + 3);
};

const assertInOrder = (source, needles, message) => {
  let cursor = -1;
  for (const needle of needles) {
    const found = source.indexOf(needle, cursor + 1);
    assert.ok(found > cursor, `${message}: missing or out of order: ${needle}`);
    cursor = found;
  }
};

assert.match(
  bridge,
  new RegExp(`^readonly PREDECESSOR_HELPER_SHA256='${predecessorHelperSha256}'$`, 'mu'),
);
assert.match(
  bridge,
  new RegExp(`^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${helperSha256}'$`, 'mu'),
  'the H18 bridge must pin the exact LF-normalized successor helper',
);
assert.match(bridge, new RegExp(`^readonly PRODUCTION_RELEASE='${productionRelease}'$`, 'mu'));
assert.match(bridge, new RegExp(`^readonly SHARED_NETWORK_ID='${networkId}'$`, 'mu'));
assert.match(
  bridge,
  new RegExp(`^readonly SHARED_NETWORK_CONFIG_HASH='${networkConfigHash}'$`, 'mu'),
);
assert.match(bridge, /^readonly EXPECTED_DROPLET_ID='593344964'$/mu);
assert.match(bridge, /^readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'$/mu);
assert.match(bridge, /^readonly LOCAL_DOCKER_SOCKET='unix:\/\/\/var\/run\/docker\.sock'$/mu);
assert.match(
  bridge,
  new RegExp(
    `^readonly SUCCESSOR_CONTINUOUS_FINALIZER_SHA256='${continuousFinalizerSha256}'$`,
    'mu',
  ),
);
assert.match(
  bridge,
  new RegExp(`^readonly SUCCESSOR_CONTINUOUS_SUDOERS_SHA256='${continuousSudoersSha256}'$`, 'mu'),
);
assert.match(
  bridge,
  /^readonly H17_CONTINUOUS_FINALIZER_SHA256='8e7e00aa8f83b08bb07a7b09c7d0ade3c89b4014c82d7047a7677a96b13b78d5'$/mu,
);
assert.match(
  bridge,
  /^readonly H17_CONTINUOUS_SUDOERS_SHA256='6a00778d52e4f2e58596ab8c287eebad0069f4997ef4439fa775115d8f7aabc0'$/mu,
);
assert.match(bridge, new RegExp(`^readonly CONFIRMATION='${confirmation}'$`, 'mu'));
assert.match(bridge, /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u);
assert.match(bridge, /\[\[ "\$\(id -u\)" == '0' && "\$\(id -un\)" == 'root' \]\]/u);
assert.match(bridge, /"\$\(realpath -- "\$0"\)" == "\$STAGED_INSTALLER"/u);

const intentFields = [
  'contract=fetanagent-shared-telebirr-ingress-helper-bridge-v18',
  'state=authorized',
  'bridge_release=$BRIDGE_RELEASE',
  'h17_bridge_release=$H17_RELEASE',
  'predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256',
  'successor_helper_sha256=$SUCCESSOR_HELPER_SHA256',
  'h17_bridge_intent_sha256=$H17_INTENT_SHA256',
  'h17_bridge_completion_sha256=$H17_COMPLETION_SHA256',
  'stopped_boundary_sha256=$STOPPED_BOUNDARY_SHA256',
  'production_boundary_sha256=$PRODUCTION_BOUNDARY_SHA256',
  'shared_ingress_boundary_sha256=$SHARED_INGRESS_BOUNDARY_SHA256',
  'staging_runtime_stopped=true',
  'shared_ingress_network=$SHARED_NETWORK',
  'shared_ingress_network_id=$SHARED_NETWORK_ID',
  'shared_ingress_contract=exact',
  'production_release=$PRODUCTION_RELEASE',
  'production_endpoint_set=exact',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
];
const expectedIntent = shellFunction(bridge, 'expected_intent');
assertInOrder(expectedIntent, intentFields, 'the H18 intent field order must remain canonical');
const expectedCompletion = shellFunction(bridge, 'expected_completion');
assert.match(expectedCompletion, /NR == 2 \{ print "state=shared-ingress-helper-installed"/u);
assert.match(expectedCompletion, /bridge_intent_sha256=%s\\n/u);

for (const name of [
  'require_stopped_staging_boundary',
  'require_ipv6_host_ready',
  'require_port_3002_free',
  'require_successor_readiness',
  'successor_readiness_digest',
  'require_production_runtime',
  'require_shared_ingress_boundary',
  'stopped_boundary_digest',
  'production_boundary_digest',
  'shared_ingress_boundary_digest',
  'resolve_h17_record',
  'require_exact_record',
  'classify_namespace',
  'prepare_helper_copy_resumably',
  'require_record_prefix',
  'require_helper_prefix',
  'require_interrupted_predecessor_record',
  'require_interrupted_successor_record',
  'current_target_state',
  'current_grant_state',
  'classify_continuous_finalizer_topology',
  'capture_transaction_snapshot',
  'require_recoverable_transaction_state',
  'install_successor_atomically',
  'require_all_boundaries',
]) {
  shellFunction(bridge, name);
}

const bridgeSharedIngress = shellFunction(bridge, 'require_shared_ingress_boundary');
assert.match(bridgeSharedIngress, /Internal == true/u);
assert.match(bridgeSharedIngress, /Attachable == false/u);
assert.match(bridgeSharedIngress, /ConfigOnly == false/u);
assert.match(bridgeSharedIngress, /fetanagent-production-gateway-1/u);
assert.match(bridgeSharedIngress, /fetanagent-production-telebirr-device-bridge-1/u);
assert.match(bridgeSharedIngress, /FINANCIAL_ACTIONS_MODE=dry_run/u);
assert.match(bridgeSharedIngress, /KEMERBET_EXECUTOR_ENABLED=false/u);
assert.match(bridgeSharedIngress, /KEMERBET_FINAL_ACTION_ENABLED=false/u);
assert.match(bridgeSharedIngress, /container_endpoints" == "\$network_endpoints/u);
assert.match(
  bridgeSharedIngress,
  /\.NetworkSettings\.Networks \| keys \| sort\) == \[\s*"fetanagent-companion-device-ingress",\s*"fetanagent-production_public_application",\s*"fetanagent-telebirr-device-ingress"/u,
);
assert.match(bridgeSharedIngress, /\.NetworkSettings\.Networks \| keys\) == \[\$network\]/u);
assert.match(bridgeSharedIngress, /\.Aliases \| unique \| sort/u);
assert.match(bridgeSharedIngress, /\.HostConfig\.PortBindings == \{/u);
assert.match(bridgeSharedIngress, /"443\/tcp"/u);
assert.match(bridgeSharedIngress, /"80\/tcp"/u);
assert.match(bridgeSharedIngress, /\.HostConfig\.PortBindings == \{\}/u);
assert.match(bridgeSharedIngress, /\.Config\.ExposedPorts == null/u);
assert.match(bridgeSharedIngress, /\.NetworkSettings\.Ports == \{\}/u);
const stoppedStagingBoundary = shellFunction(bridge, 'require_stopped_staging_boundary');
assert.match(
  bridge,
  /^readonly PROFILE_VOLUME_CONFIG_HASH='a32bd0939846bcf3962c5f6fce0b4faeb20ed73332d44d4fbde4c2441f83217a'$/mu,
);
assert.match(
  bridge,
  /^readonly SESSION_CONTROL_VOLUME_CONFIG_HASH='ece38b330a5f072e571f8d000a89f7622e8b790c3e02bce42df7a844fba7a085'$/mu,
);
assert.match(stoppedStagingBoundary, /\.Driver == "local"/u);
assert.match(stoppedStagingBoundary, /\.Scope == "local"/u);
assert.match(stoppedStagingBoundary, /\.Options == null/u);
assert.match(stoppedStagingBoundary, /10001:10001:700/u);
assert.match(stoppedStagingBoundary, /SESSION_CONTROL_VOLUME/u);
assert.match(stoppedStagingBoundary, /stat --format='%h'/u);
assert.match(stoppedStagingBoundary, /"name=\^\$\{PROJECT_NAME\}_"/u);
assert.match(stoppedStagingBoundary, /\[\[ -z "\$namespace_networks" \]\]/u);
const readiness = shellFunction(bridge, 'require_successor_readiness');
assert.match(readiness, /require_ipv6_host_ready && require_port_3002_free/u);
const readinessDigest = shellFunction(bridge, 'successor_readiness_digest');
assert.match(readinessDigest, /ip -6 -o address show scope global/u);
assert.match(readinessDigest, /ip -6 route show default/u);
assert.match(readinessDigest, /getent ahostsv6 "\$STAGING_DIRECT_DATABASE_HOST"/u);
assert.match(readinessDigest, /name=\^\$\{PROJECT_NAME\}_/u);
assert.match(readinessDigest, /port_3002=free/u);
assert.match(shellFunction(bridge, 'stopped_boundary_digest'), /successor_readiness_sha256=/u);

assertInOrder(
  bridge,
  [
    'require_stopped_staging_boundary || die',
    'require_production_runtime || die',
    'STOPPED_BOUNDARY_SHA256="$(stopped_boundary_digest)"',
    'PRODUCTION_BOUNDARY_SHA256="$(production_boundary_digest)"',
    'SHARED_INGRESS_BOUNDARY_SHA256="$(shared_ingress_boundary_digest)"',
    'capture_transaction_snapshot || die',
    'open_lock || die',
    'capture_transaction_snapshot || die',
    '"$TRANSACTION_SNAPSHOT" == "$PREFLIGHT_TRANSACTION_SNAPSHOT"',
    'require_all_boundaries || die',
    'disable_sudoers || die',
    'require_disabled_grant_only || die',
    'require_all_boundaries || die',
    'publish_record_atomically "$H18_INSTALLING" intent-v1',
    'copy_predecessor_atomically',
    'install_successor_atomically',
    'publish_record_atomically "$H18_INSTALLING" completed-v1',
    'require_exact_record "$H18_INSTALLING"',
    'mv -- "$H18_INSTALLING" "$H18_ROOT"',
    'require_exact_record "$H18_ROOT"',
    'require_helper_boundary "$SUCCESSOR_HELPER_SHA256"',
    'open_lock || die',
    'require_exact_record "$H18_ROOT"',
    'restore_sudoers || die',
  ],
  'the one-use bridge must preserve its fail-closed provenance transaction',
);
const transactionValidator = shellFunction(bridge, 'require_recoverable_transaction_state');
for (const state of [
  'absent:predecessor:active',
  'absent:predecessor:disabled',
  'empty-parent:predecessor:disabled',
  'interrupted:predecessor:disabled',
  'interrupted:successor:disabled',
  'completed:successor:active',
  'completed:successor:disabled',
]) {
  assert.ok(transactionValidator.includes(state), `missing causal transaction state: ${state}`);
}
assert.doesNotMatch(transactionValidator, /interrupted:predecessor:active/u);
const predecessorRecord = shellFunction(bridge, 'require_interrupted_predecessor_record');
for (const inventory of [
  "'.intent-v1.installing:f'",
  "$'.predecessor-helper.installing:f\\nintent-v1:f'",
  "$'intent-v1:f\\npredecessor-helper:f'",
]) {
  assert.ok(predecessorRecord.includes(inventory), `missing predecessor prefix: ${inventory}`);
}
assert.doesNotMatch(predecessorRecord, /completed-v1/u);
const successorRecord = shellFunction(bridge, 'require_interrupted_successor_record');
assert.match(successorRecord, /\.completed-v1\.installing:f/u);
assert.match(successorRecord, /completed-v1:f/u);
assert.match(successorRecord, /require_global_installing_helper_absent/u);
const continuousTopology = shellFunction(bridge, 'classify_continuous_finalizer_topology');
assert.match(continuousTopology, /predecessor:h17:h17/u);
assert.match(continuousTopology, /successor:h17:h17/u);
assert.match(continuousTopology, /successor:successor:h17/u);
assert.match(continuousTopology, /successor:successor:successor/u);
assert.doesNotMatch(continuousTopology, /predecessor:successor/u);

assert.doesNotMatch(
  bridge,
  /docker_local_read_only\s+(?:container|network)\s+(?:create|connect|disconnect|exec|kill|pause|prune|restart|rm|run|start|stop|unpause|update)\b/u,
  'the H18 bridge may inspect Docker but may not mutate Docker state',
);
assert.doesNotMatch(bridge, /\b(?:psql|createdb|dropdb|ALTER\s+ROLE|CREATE\s+ROLE)\b/iu);
assert.doesNotMatch(
  bridge,
  /systemctl\s+(?:daemon-reload|disable|enable|mask|restart|start|stop|unmask)\b/u,
);
assert.doesNotMatch(bridge, /FINANCIAL_ACTIONS_MODE=live/u);
assert.doesNotMatch(bridge, /KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true/u);
assert.match(bridge, /awk bash chmod chown cmp curl dirname docker/u);
assert.match(bridge, /interrupted:successor/u);
assert.match(bridge, /existing != expected\[:len\(existing\)\]/u);
assertInOrder(
  shellFunction(bridge, 'restore_sudoers'),
  ['mv -- "$SUDOERS_DISABLED" "$SUDOERS"', "grant_disabled='false'"],
  'the grant state must change immediately after the sudoers rename',
);
for (const name of [
  'production_boundary_digest',
  'shared_ingress_boundary_digest',
  'stopped_boundary_digest',
]) {
  assert.match(
    shellFunction(bridge, name),
    /\|\|\s*return 1/u,
    `${name} must propagate failed boundary reads`,
  );
}
assert.match(
  shellFunction(bridge, 'require_stopped_staging_boundary'),
  /containers="\$\(docker_local_read_only container ls[\s\S]*?\)" \|\| return 1/u,
);

const h17Parser = shellFunction(helper, 'inspect_kemerbet_h17_availability_bridge');
const h18Parser = shellFunction(helper, 'inspect_kemerbet_h18_shared_ingress_bridge');
const h14Gate = shellFunction(helper, 'inspect_kemerbet_h14_recovery_gate');
const successorGate = shellFunction(helper, 'inspect_kemerbet_v2_v3_successor_gate');
assert.match(
  helper,
  /^readonly KEMERBET_SHARED_TELEBIRR_INGRESS_HELPER_BRIDGE_V18_PARENT='\/var\/lib\/fetanagent\/shared-telebirr-ingress-helper-bridge-v18'$/mu,
);
assert.match(
  helper,
  new RegExp(`^readonly SHARED_TELEBIRR_INGRESS_NETWORK_ID='${networkId}'$`, 'mu'),
);
assert.match(
  helper,
  new RegExp(`^readonly SHARED_TELEBIRR_INGRESS_CONFIG_HASH='${networkConfigHash}'$`, 'mu'),
);
assert.match(helper, /^readonly SHARED_TELEBIRR_INGRESS_COMPOSE_VERSION='5\.1\.4'$/mu);
assert.match(
  h17Parser,
  /local helper_mode="\$\{2:-755\}" helper_path="\$\{1:-\$HELPER_PATH\}" inspection/u,
);
assert.match(h17Parser, /"\$\{#inspection_lines\[@\]\}" -eq 7/u);
assert.match(
  h18Parser,
  /local helper_mode="\$\{2:-755\}" helper_path="\$\{1:-\$HELPER_PATH\}" inspection/u,
);
assert.match(h18Parser, new RegExp(predecessorHelperSha256, 'u'));
assert.match(h18Parser, /len\(intent\) != 23/u);
assert.match(h18Parser, /len\(completion\) != 24/u);
assert.match(h18Parser, /helper_data = exact_file\(helper, helper_mode,/u);
assert.match(h18Parser, /completion\[2:23\] != intent\[2:23\]/u);
assert.match(h18Parser, /hashlib\.sha256\(intent_data\)\.hexdigest\(\)/u);
assert.match(h18Parser, /hashlib\.sha256\(predecessor_data\)\.hexdigest\(\) != predecessor_sha/u);
assert.match(h18Parser, /hashlib\.sha256\(helper_data\)\.hexdigest\(\) != successor_sha/u);
assert.match(h18Parser, /"\$\{#inspection_lines\[@\]\}" -eq 9/u);
assert.match(h18Parser, /hashlib\.sha256\(intent_data\)\.hexdigest\(\)/u);
assert.match(h18Parser, /hashlib\.sha256\(completion_data\)\.hexdigest\(\)/u);
for (const field of intentFields.slice(11).filter((field) => !field.includes('$'))) {
  assert.match(h18Parser, new RegExp(field, 'u'));
}

assertInOrder(
  h14Gate,
  [
    'inspect_kemerbet_h18_shared_ingress_bridge',
    `if [[ "$KEMERBET_H18_SHARED_INGRESS_BRIDGE_STATE" == 'active' ]]`,
    'inspect_kemerbet_h17_availability_bridge',
    '"$KEMERBET_H18_SHARED_INGRESS_BRIDGE_PREDECESSOR_HELPER" 400',
    `if [[ "$KEMERBET_H17_AVAILABILITY_BRIDGE_STATE" == 'active' ]]`,
    'inspect_kemerbet_h16_preview_bridge',
    '"$KEMERBET_H17_AVAILABILITY_BRIDGE_PREDECESSOR_HELPER" 400',
    '"$KEMERBET_H18_SHARED_INGRESS_BRIDGE_H17_RELEASE" ==',
    '"$KEMERBET_H17_AVAILABILITY_BRIDGE_RELEASE"',
    '"$KEMERBET_H18_SHARED_INGRESS_BRIDGE_H17_INTENT_SHA256" ==',
    '"$KEMERBET_H17_AVAILABILITY_BRIDGE_INTENT_SHA256"',
    '"$KEMERBET_H18_SHARED_INGRESS_BRIDGE_H17_COMPLETION_SHA256" ==',
    '"$KEMERBET_H17_AVAILABILITY_BRIDGE_COMPLETION_SHA256"',
    'elif [[ "$KEMERBET_H18_SHARED_INGRESS_BRIDGE_HELPER_SHA256" !=',
  ],
  'the H14 gate must validate H18 through H17, H16, and H14 in order',
);
assertInOrder(
  successorGate,
  [
    `if [[ "$KEMERBET_H18_SHARED_INGRESS_BRIDGE_STATE" == 'active' ]]`,
    'KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$KEMERBET_H18_SHARED_INGRESS_BRIDGE_HELPER_SHA256"',
    `elif [[ "$KEMERBET_H17_AVAILABILITY_BRIDGE_STATE" == 'active' ]]`,
    'KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$KEMERBET_H17_AVAILABILITY_BRIDGE_HELPER_SHA256"',
    `elif [[ "$KEMERBET_H16_PREVIEW_BRIDGE_STATE" == 'active' ]]`,
  ],
  'the successor gate must prefer H18 while retaining H17 and H16 fallback',
);

const sharedNetworkContract = shellFunction(
  helper,
  'require_shared_telebirr_ingress_network_contract',
);
for (const contract of [
  '.Scope == "local"',
  '.Driver == "bridge"',
  '.EnableIPv6 == false',
  '.Internal == true',
  '.Attachable == false',
  '.Ingress == false',
  '.ConfigOnly == false',
  'production_gateway_seen',
  'production_telebirr_bridge_seen',
  'FINANCIAL_ACTIONS_MODE=dry_run',
  'KEMERBET_EXECUTOR_ENABLED=false',
  'KEMERBET_FINAL_ACTION_ENABLED=false',
  'MacAddress == $endpoint_mac',
  'EndpointID == $endpoint_id',
  'inspection_after',
]) {
  assert.ok(
    sharedNetworkContract.includes(contract),
    `missing shared-ingress contract: ${contract}`,
  );
}
assert.match(sharedNetworkContract, /fetanagent-gateway/u);
assert.match(sharedNetworkContract, /fetanagent-telebirr-device-bridge/u);
assert.doesNotMatch(sharedNetworkContract, /staging-device-pilot-bridge/u);
assert.match(
  sharedNetworkContract,
  /\.NetworkSettings\.Networks \| keys \| sort\) == \[\s*"fetanagent-companion-device-ingress",\s*"fetanagent-production_public_application",\s*"fetanagent-telebirr-device-ingress"/u,
);
assert.match(
  sharedNetworkContract,
  /\.NetworkSettings\.Networks \| keys\) == \["fetanagent-telebirr-device-ingress"\]/u,
);
assert.match(sharedNetworkContract, /\.Aliases \| unique \| sort/u);
assert.match(sharedNetworkContract, /\.HostConfig\.PortBindings == \{\}/u);
assert.match(sharedNetworkContract, /\.Config\.ExposedPorts == null/u);
assert.match(sharedNetworkContract, /\.NetworkSettings\.Ports == \{\}/u);
assert.match(sharedNetworkContract, /container_inspection_after/u);
assert.match(sharedNetworkContract, /container_inspection_digest/u);
assert.match(
  sharedNetworkContract,
  /\[\.\[0\]\.Config\.Env\[\] \| select\(startswith\("FINANCIAL_ACTIONS_MODE="\)\)\] ==/u,
);

const cleanup = shellFunction(helper, 'remove_disposable_project_networks_best_effort');
for (const network of [
  'kemerbet_readiness_control',
  'kemerbet_readiness_proxy',
  'kemerbet_readiness_egress',
  'owner_control_service',
  'staging_service',
]) {
  assert.match(cleanup, new RegExp(network, 'u'));
}
assert.match(cleanup, /docker_local network rm "\$network_id"/u);
assert.doesNotMatch(cleanup, /docker_local network rm \$network_ids/u);

const stoppedNetworkBoundary = shellFunction(helper, 'require_stopped_project_network_boundary');
assert.match(stoppedNetworkBoundary, /"\$project_networks" == "\$shared_id"/u);
assert.match(stoppedNetworkBoundary, /"name=\^\$\{PROJECT_NAME\}_"/u);
assert.match(stoppedNetworkBoundary, /\[\[ -z "\$namespace_networks" \]\]/u);
assert.match(stoppedNetworkBoundary, /require_shared_telebirr_ingress_network_contract/u);

for (const name of [
  'require_kemerbet_v1_retirement_reinstall_boundary',
  'require_kemerbet_v1_retirement_safe_reset_boundary',
  'require_fresh_host_start_ready',
  'require_kemerbet_v3_successor_stopped_durable_boundary',
]) {
  assert.match(
    shellFunction(helper, name),
    /require_stopped_project_network_boundary/u,
    `${name} must accept only the exact preserved shared-ingress stopped state`,
  );
}
const runtimeCleanup = shellFunction(helper, 'remove_project_runtime_best_effort');
assertInOrder(
  runtimeCleanup,
  [
    'docker_local container rm --force',
    'remove_disposable_project_networks_best_effort',
    'require_stopped_project_network_boundary',
  ],
  'runtime cleanup must remove containers, classify disposable networks, and re-attest shared ingress',
);
assert.doesNotMatch(runtimeCleanup, /docker_local network rm/u);

assert.match(
  packageJson,
  /verify-kemerbet-continuous-availability-helper-bridge-v17\.mjs && node infra\/verify-shared-telebirr-ingress-helper-bridge-v18\.mjs/u,
  'test:infra must run the H18 verifier immediately after H17',
);

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash);

let executableChecks = 0;
const lockedSnapshotGuard =
  /capture_transaction_snapshot \|\| die 'the H18 transaction topology became invalid under lock'\n\[\[ "\$TRANSACTION_SNAPSHOT" == "\$PREFLIGHT_TRANSACTION_SNAPSHOT" \]\] \|\|\n  die 'the H18 transaction topology changed before the lock was acquired'/u.exec(
    bridge,
  )?.[0];
assert.ok(lockedSnapshotGuard);
for (const [name, lockedSnapshot, pass] of [
  ['unchanged lock snapshot', 'captured-state', true],
  ['stale pre-lock snapshot', 'changed-state', false],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
PREFLIGHT_TRANSACTION_SNAPSHOT='captured-state'
LOCKED_SNAPSHOT='${lockedSnapshot}'
capture_transaction_snapshot() { TRANSACTION_SNAPSHOT="$LOCKED_SNAPSHOT"; }
die() { exit 1; }
${lockedSnapshotGuard}
printf '%s' mutation-reached
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  assert.equal(result.stdout, pass ? 'mutation-reached' : '', name);
  executableChecks += 1;
}
for (const [name, state, pass] of [
  ['fresh active transaction', ['absent', 'predecessor', 'active'], true],
  ['disabled before namespace creation', ['absent', 'predecessor', 'disabled'], true],
  ['disabled empty parent', ['empty-parent', 'predecessor', 'disabled'], true],
  ['interrupted predecessor', ['interrupted', 'predecessor', 'disabled'], true],
  ['interrupted successor', ['interrupted', 'successor', 'disabled'], true],
  ['completed active successor', ['completed', 'successor', 'active'], true],
  ['completed disabled successor', ['completed', 'successor', 'disabled'], true],
  ['active interrupted predecessor', ['interrupted', 'predecessor', 'active'], false],
  ['active empty parent', ['empty-parent', 'predecessor', 'active'], false],
  ['completion before successor', ['completed', 'predecessor', 'disabled'], false],
]) {
  const [namespaceState, targetState, grantState] = state;
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
h18_state='${namespaceState}'
target_state='${targetState}'
grant_state='${grantState}'
H18_ROOT='/unreachable-h18-root'
classify_namespace() { printf '%s' "$h18_state"; }
current_target_state() { printf '%s' "$target_state"; }
current_grant_state() { printf '%s' "$grant_state"; }
classify_continuous_finalizer_topology() { return 0; }
require_global_installing_helper_absent() { return 0; }
require_interrupted_predecessor_record() { return 0; }
require_interrupted_successor_record() { return 0; }
require_exact_record() { return 0; }
${transactionValidator}
require_recoverable_transaction_state
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  executableChecks += 1;
}

for (const [name, targetState, finalizerState, sudoersState, pass] of [
  ['predecessor with H17 pair', 'predecessor', 'h17', 'h17', true],
  ['predecessor with successor pair', 'predecessor', 'successor', 'successor', false],
  ['successor with H17 pair', 'successor', 'h17', 'h17', true],
  ['successor partial finalizer rotation', 'successor', 'successor', 'h17', true],
  ['successor finalizer pair', 'successor', 'successor', 'successor', true],
  ['reverse finalizer rotation', 'successor', 'h17', 'successor', false],
  ['unknown finalizer', 'successor', 'unknown', 'h17', false],
  ['unknown sudo capability', 'successor', 'h17', 'unknown', false],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
target_state='${targetState}'
FINALIZER_STATE='${finalizerState}'
SUDOERS_STATE='${sudoersState}'
CONTINUOUS_FINALIZER='/finalizer'
CONTINUOUS_SUDOERS='/sudoers'
H17_CONTINUOUS_FINALIZER_SHA256='h17-finalizer'
H17_CONTINUOUS_SUDOERS_SHA256='h17-sudoers'
SUCCESSOR_CONTINUOUS_FINALIZER_SHA256='successor-finalizer'
SUCCESSOR_CONTINUOUS_SUDOERS_SHA256='successor-sudoers'
require_checksum_file() {
  case "$1:$2" in
    /finalizer:h17-finalizer) [[ "$FINALIZER_STATE" == h17 ]] ;;
    /finalizer:successor-finalizer) [[ "$FINALIZER_STATE" == successor ]] ;;
    /sudoers:h17-sudoers) [[ "$SUDOERS_STATE" == h17 ]] ;;
    /sudoers:successor-sudoers) [[ "$SUDOERS_STATE" == successor ]] ;;
    *) return 1 ;;
  esac
}
bash() { [[ "$1" == -n ]]; }
visudo() { return 0; }
${continuousTopology}
classify_continuous_finalizer_topology
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  executableChecks += 1;
}

const ipv6Ready = shellFunction(bridge, 'require_ipv6_host_ready');
const portReady = shellFunction(bridge, 'require_port_3002_free');
for (const [name, ipv6State, portState, namespaceState, pass] of [
  ['exact successor readiness', 'exact', 'free', 'empty', true],
  ['missing global IPv6 address', 'address-missing', 'free', 'empty', false],
  ['missing default IPv6 route', 'route-missing', 'free', 'empty', false],
  ['database IPv6 resolution failure', 'dns-missing', 'free', 'empty', false],
  ['port 3002 occupied', 'exact', 'busy', 'empty', false],
  ['namespaced network residue', 'exact', 'free', 'present', false],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
IPV6_STATE='${ipv6State}'
PORT_STATE='${portState}'
NAMESPACE_STATE='${namespaceState}'
STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'
PROJECT_NAME='fetanagent-staging-beta'
SAFE_PATH="$PATH"
ip() {
  case "$*" in
    '-6 address show scope global') [[ "$IPV6_STATE" != address-missing ]] && echo '2: eth0 inet6 2001:db8::2/64 scope global' ;;
    '-6 -o address show scope global') [[ "$IPV6_STATE" != address-missing ]] && echo '2: eth0 inet6 2001:db8::2/64 scope global' ;;
    '-6 route show default') [[ "$IPV6_STATE" != route-missing ]] && echo 'default via 2001:db8::1 dev eth0' ;;
    *) return 91 ;;
  esac
}
getent() {
  [[ "$IPV6_STATE" != dns-missing ]] || return 1
  echo '2001:db8::10 STREAM db.spzpiyxheappsfyswewl.supabase.co'
}
ss() {
  [[ "$*" == '-ltnH' ]] || return 92
  [[ "$PORT_STATE" == busy ]] && echo 'LISTEN 0 128 0.0.0.0:3002 0.0.0.0:*' || true
}
docker_local_read_only() {
  [[ "$NAMESPACE_STATE" == present ]] && echo '${'a'.repeat(64)}' || true
}
${ipv6Ready}
${portReady}
${readiness}
${readinessDigest}
successor_readiness_digest >/dev/null
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  executableChecks += 1;
}

if (process.platform !== 'win32') {
  let prefixRunner;
  if (process.getuid?.() === 0) {
    prefixRunner = { command: bash, args: ['-s'] };
  } else {
    const unshare = spawnSync('unshare', ['--user', '--map-root-user', 'true'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (unshare.status === 0) {
      prefixRunner = {
        command: 'unshare',
        args: ['--user', '--map-root-user', bash, '-s'],
      };
    } else {
      const sudo = spawnSync('sudo', ['-n', '--', 'true'], {
        encoding: 'utf8',
        timeout: 10000,
      });
      if (sudo.status === 0) {
        prefixRunner = { command: 'sudo', args: ['-n', '--', bash, '-s'] };
      }
    }
  }
  assert.ok(
    prefixRunner,
    'The real H18 prefix validators require a root or mapped-root temporary-file environment.',
  );
  const prefixFixture = `set -euo pipefail
umask 077
SAFE_PATH="$PATH"
${shellFunction(bridge, 'require_record_prefix')}
${shellFunction(bridge, 'require_helper_prefix')}
fixture_root="$(mktemp -d /tmp/fetanagent-h18-prefix.XXXXXX)"
[[ "$fixture_root" == /tmp/fetanagent-h18-prefix.* && ! -L "$fixture_root" && -d "$fixture_root" ]]
cleanup_prefix_fixture() {
  chmod -R u+rwX "$fixture_root" 2>/dev/null || true
  rm -rf -- "$fixture_root"
}
trap cleanup_prefix_fixture EXIT
record_target="$fixture_root/record"
helper_source="$fixture_root/helper-source"
helper_target="$fixture_root/helper-target"
expected_record() {
  printf '%s\\n' \
    'contract=fetanagent-h18-prefix-v1' \
    'state=authorized' \
    'money_moved=false'
}
printf '%s\\n' '#!/usr/bin/env bash' 'printf helper-prefix-v1' >"$helper_source"
chmod 600 "$helper_source"
helper_sha="$(sha256sum -- "$helper_source" | awk '{print $1}')"
`;
  for (const [name, fixture] of [
    [
      'real prefix validators accept valid partial bytes',
      `printf '%s' 'contract=fetanagent-' >"$record_target"
chmod 600 "$record_target"
head -c 11 "$helper_source" >"$helper_target"
chmod 400 "$helper_target"
require_record_prefix "$record_target" 600 expected_record
require_helper_prefix "$helper_source" 600 "$helper_target" 400 "$helper_sha"`,
    ],
    [
      'real prefix validators reject corrupt bytes',
      `printf 'X' >"$record_target"
chmod 600 "$record_target"
printf 'X' >"$helper_target"
chmod 400 "$helper_target"
! require_record_prefix "$record_target" 600 expected_record
! require_helper_prefix "$helper_source" 600 "$helper_target" 400 "$helper_sha"`,
    ],
    [
      'real prefix validators reject oversized bytes',
      `expected_record >"$record_target"
printf 'X' >>"$record_target"
chmod 600 "$record_target"
cp -- "$helper_source" "$helper_target"
printf 'X' >>"$helper_target"
chmod 400 "$helper_target"
! require_record_prefix "$record_target" 600 expected_record
! require_helper_prefix "$helper_source" 600 "$helper_target" 400 "$helper_sha"`,
    ],
    [
      'real prefix validators reject invalid modes',
      `printf '%s' 'contract=fetanagent-' >"$record_target"
chmod 640 "$record_target"
head -c 11 "$helper_source" >"$helper_target"
chmod 600 "$helper_target"
! require_record_prefix "$record_target" 600 expected_record
! require_helper_prefix "$helper_source" 600 "$helper_target" 400 "$helper_sha"`,
    ],
  ]) {
    const result = spawnSync(prefixRunner.command, prefixRunner.args, {
      input: `${prefixFixture}\n${fixture}\n`,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`);
    executableChecks += 1;
  }

  const h18FallbackStart = h14Gate.indexOf('  inspect_kemerbet_h18_shared_ingress_bridge\n');
  const h18FallbackEnd = h14Gate.indexOf(
    `  [[ "$KEMERBET_H17_AVAILABILITY_BRIDGE_STATE" != 'invalid' ]]`,
    h18FallbackStart,
  );
  assert.ok(h18FallbackStart >= 0 && h18FallbackEnd > h18FallbackStart);
  const h18FallbackGuard = h14Gate.slice(h18FallbackStart, h18FallbackEnd);
  const malformedH18 = spawnSync(prefixRunner.command, prefixRunner.args, {
    input: `set -euo pipefail
umask 077
SAFE_PATH="$PATH"
fixture_root="$(mktemp -d /tmp/fetanagent-h18-parser.XXXXXX)"
[[ "$fixture_root" == /tmp/fetanagent-h18-parser.* && ! -L "$fixture_root" && -d "$fixture_root" ]]
cleanup_parser_fixture() {
  chmod -R u+rwX "$fixture_root" 2>/dev/null || true
  rm -rf -- "$fixture_root"
}
trap cleanup_parser_fixture EXIT
KEMERBET_SHARED_TELEBIRR_INGRESS_HELPER_BRIDGE_V18_PARENT="$fixture_root/h18"
HELPER_PATH="$fixture_root/helper"
mkdir -m 700 "$KEMERBET_SHARED_TELEBIRR_INGRESS_HELPER_BRIDGE_V18_PARENT"
mkdir -m 700 "$KEMERBET_SHARED_TELEBIRR_INGRESS_HELPER_BRIDGE_V18_PARENT/unexpected"
printf '%s\\n' '#!/usr/bin/env bash' >"$HELPER_PATH"
chmod 755 "$HELPER_PATH"
fallback_called='false'
inspect_kemerbet_h17_availability_bridge() { fallback_called='true'; }
${h18Parser}
check_malformed_h18() {
${h18FallbackGuard}
}
KEMERBET_H14_RECOVERY_STATE='cohort-prepared'
check_malformed_h18
[[ "$KEMERBET_H18_SHARED_INGRESS_BRIDGE_STATE" == 'invalid' &&
  "$KEMERBET_H14_RECOVERY_STATE" == 'invalid' && "$fallback_called" == 'false' ]]
`,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(
    malformedH18.status,
    0,
    `malformed-present H18 must block historical fallback: ${malformedH18.stderr || malformedH18.stdout}`,
  );
  executableChecks += 1;
}

for (const [name, inventory, mode, pass] of [
  ['empty predecessor prefix', '', 'predecessor', true],
  ['partial intent prefix', '.intent-v1.installing:f\n', 'predecessor', true],
  ['final intent prefix', 'intent-v1:f\n', 'predecessor', true],
  [
    'partial predecessor archive',
    '.predecessor-helper.installing:f\nintent-v1:f\n',
    'predecessor',
    true,
  ],
  ['final predecessor archive', 'intent-v1:f\npredecessor-helper:f\n', 'predecessor', true],
  ['completion before successor', 'completed-v1:f\n', 'predecessor', false],
  ['archive without intent', 'predecessor-helper:f\n', 'predecessor', false],
  ['temp and final intent twins', '.intent-v1.installing:f\nintent-v1:f\n', 'predecessor', false],
  ['successor before completion', 'intent-v1:f\npredecessor-helper:f\n', 'successor', true],
  [
    'partial successor completion',
    '.completed-v1.installing:f\nintent-v1:f\npredecessor-helper:f\n',
    'successor',
    true,
  ],
  [
    'final successor completion',
    'completed-v1:f\nintent-v1:f\npredecessor-helper:f\n',
    'successor',
    true,
  ],
  ['successor missing archive', 'intent-v1:f\n', 'successor', false],
]) {
  const selected = mode === 'predecessor' ? predecessorRecord : successorRecord;
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
ENTRIES=$'${inventory.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'
H18_INSTALLING='/unreachable-h18-installing'
INSTALLING_HELPER='/unreachable-helper-installing'
TARGET='/unreachable-target'
STAGED_HELPER='/unreachable-staged-helper'
PREDECESSOR_HELPER_SHA256='${predecessorHelperSha256}'
SUCCESSOR_HELPER_SHA256='${helperSha256}'
find() { printf '%s' "$ENTRIES"; }
require_installing_root() { return 0; }
require_record_prefix() { return 0; }
require_global_installing_helper_absent() { return 0; }
require_exact_record_payload() { return 0; }
require_helper_prefix() { return 0; }
require_helper_file() { return 0; }
${selected}
${mode === 'predecessor' ? 'require_interrupted_predecessor_record' : 'require_interrupted_successor_record'}
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  executableChecks += 1;
}

if (process.platform !== 'win32') {
  const networkFilterMarker = `--arg id "$SHARED_NETWORK_ID" --arg release "$PRODUCTION_RELEASE" '\n`;
  const networkFilterStart =
    bridgeSharedIngress.indexOf(networkFilterMarker) + networkFilterMarker.length;
  const networkFilterEndMarker = `\n      )' <<<"$inspection" >/dev/null`;
  const networkFilterEnd = bridgeSharedIngress.indexOf(networkFilterEndMarker, networkFilterStart);
  assert.ok(
    networkFilterStart >= networkFilterMarker.length && networkFilterEnd > networkFilterStart,
  );
  const networkFilter = bridgeSharedIngress.slice(
    networkFilterStart,
    networkFilterEnd + '\n      )'.length,
  );
  const filterMarker = `--arg release "$PRODUCTION_RELEASE" '\n`;
  const filterStart = bridgeSharedIngress.lastIndexOf(filterMarker) + filterMarker.length;
  const filterEndMarker = "\n        )' >/dev/null";
  const filterEnd = bridgeSharedIngress.indexOf(filterEndMarker, filterStart);
  assert.ok(filterStart >= filterMarker.length && filterEnd > filterStart);
  const endpointFilter = bridgeSharedIngress.slice(filterStart, filterEnd + '\n        )'.length);
  const network = (aliases, networkID = 'b'.repeat(64)) => ({
    NetworkID: networkID,
    Aliases: aliases,
  });
  const gatewayContainerId = '1'.repeat(64);
  const bridgeContainerId = '2'.repeat(64);
  const gatewayEndpointId = '3'.repeat(64);
  const bridgeEndpointId = '4'.repeat(64);
  const endpoint = (name, endpointID, macAddress, ipv4Address) => ({
    Name: name,
    EndpointID: endpointID,
    MacAddress: macAddress,
    IPv4Address: ipv4Address,
    IPv6Address: '',
  });
  const makeNetworkInspection = () => [
    {
      Id: networkId,
      Name: 'fetanagent-telebirr-device-ingress',
      Scope: 'local',
      Driver: 'bridge',
      EnableIPv6: false,
      Internal: true,
      Attachable: false,
      Ingress: false,
      ConfigOnly: false,
      Options: {},
      IPAM: {
        Driver: 'default',
        Options: null,
        Config: [{ Subnet: '172.23.0.0/16', Gateway: '172.23.0.1' }],
      },
      Labels: {
        'com.docker.compose.config-hash': networkConfigHash,
        'com.docker.compose.network': 'telebirr_device_ingress',
        'com.docker.compose.project': 'fetanagent-staging-beta',
        'com.docker.compose.version': '5.1.4',
      },
      Containers: {
        [gatewayContainerId]: endpoint(
          'fetanagent-production-gateway-1',
          gatewayEndpointId,
          '02:42:ac:17:00:03',
          '172.23.0.3/16',
        ),
        [bridgeContainerId]: endpoint(
          'fetanagent-production-telebirr-device-bridge-1',
          bridgeEndpointId,
          '02:42:ac:17:00:02',
          '172.23.0.2/16',
        ),
      },
    },
  ];
  for (const [name, mutate, pass] of [
    ['exact network inspection', () => {}, true],
    [
      'extra network endpoint',
      (items) => {
        items[0].Containers['5'.repeat(64)] = endpoint(
          'unreviewed-endpoint',
          '6'.repeat(64),
          '02:42:ac:17:00:04',
          '172.23.0.4/16',
        );
      },
      false,
    ],
    [
      'mismatched network identity',
      (items) => {
        items[0].Id = '7'.repeat(64);
      },
      false,
    ],
  ]) {
    const fixture = makeNetworkInspection();
    mutate(fixture);
    const result = spawnSync(
      'jq',
      [
        '-e',
        '--arg',
        'config_hash',
        networkConfigHash,
        '--arg',
        'id',
        networkId,
        '--arg',
        'release',
        productionRelease,
        networkFilter,
      ],
      { input: JSON.stringify(fixture), encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
    executableChecks += 1;
  }

  const endpointCrosscheckStart = bridgeSharedIngress.indexOf('network_endpoints="$(jq -r');
  const endpointCrosscheckEndMarker =
    '[[ -n "$network_endpoints" && "$container_endpoints" == "$network_endpoints" ]] || return 1';
  const endpointCrosscheckEnd = bridgeSharedIngress.indexOf(
    endpointCrosscheckEndMarker,
    endpointCrosscheckStart,
  );
  assert.ok(endpointCrosscheckStart >= 0 && endpointCrosscheckEnd > endpointCrosscheckStart);
  const endpointCrosscheck = bridgeSharedIngress.slice(
    endpointCrosscheckStart,
    endpointCrosscheckEnd + endpointCrosscheckEndMarker.length,
  );
  const makeContainerEndpointInspection = () => [
    {
      Id: gatewayContainerId,
      NetworkSettings: {
        Networks: {
          'fetanagent-telebirr-device-ingress': {
            EndpointID: gatewayEndpointId,
            MacAddress: '02:42:ac:17:00:03',
            IPAddress: '172.23.0.3',
            IPPrefixLen: 16,
            GlobalIPv6Address: '',
          },
        },
      },
    },
    {
      Id: bridgeContainerId,
      NetworkSettings: {
        Networks: {
          'fetanagent-telebirr-device-ingress': {
            EndpointID: bridgeEndpointId,
            MacAddress: '02:42:ac:17:00:02',
            IPAddress: '172.23.0.2',
            IPPrefixLen: 16,
            GlobalIPv6Address: '',
          },
        },
      },
    },
  ];
  const shellSingleQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
  for (const [name, mutateNetwork, mutateContainers, pass] of [
    ['exact endpoint crosscheck', () => {}, () => {}, true],
    [
      'mismatched container endpoint',
      () => {},
      (items) => {
        items[1].NetworkSettings.Networks['fetanagent-telebirr-device-ingress'].EndpointID =
          '8'.repeat(64);
      },
      false,
    ],
    [
      'extra network endpoint crosscheck',
      (items) => {
        items[0].Containers['5'.repeat(64)] = endpoint(
          'unreviewed-endpoint',
          '6'.repeat(64),
          '02:42:ac:17:00:04',
          '172.23.0.4/16',
        );
      },
      () => {},
      false,
    ],
  ]) {
    const networkFixture = makeNetworkInspection();
    const containerFixture = makeContainerEndpointInspection();
    mutateNetwork(networkFixture);
    mutateContainers(containerFixture);
    const result = spawnSync(bash, ['-s'], {
      input: `set -euo pipefail
SHARED_NETWORK='fetanagent-telebirr-device-ingress'
inspection=${shellSingleQuote(JSON.stringify(networkFixture))}
CONTAINER_INSPECTION=${shellSingleQuote(JSON.stringify(containerFixture))}
docker_local_read_only() {
  [[ "$1" == container && "$2" == inspect ]] || return 97
  printf '%s' "$CONTAINER_INSPECTION"
}
check_endpoint_crosscheck() {
  local container_endpoints network_endpoints
${endpointCrosscheck}
}
check_endpoint_crosscheck
`,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
    executableChecks += 1;
  }

  const makeEndpoints = () => [
    {
      Name: '/fetanagent-production-gateway-1',
      RestartCount: 0,
      Config: {
        User: '10001:10001',
        Image: `fetanagent-gateway:${productionRelease.slice(0, 12)}`,
        Entrypoint: null,
        Cmd: ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
        Labels: {
          'com.docker.compose.project': 'fetanagent-production',
          'com.docker.compose.service': 'gateway',
          'org.opencontainers.image.revision': productionRelease,
          'org.opencontainers.image.title': 'fetanagent-gateway',
        },
      },
      HostConfig: {
        PortBindings: {
          '443/tcp': [{ HostIp: '', HostPort: '443' }],
          '80/tcp': [{ HostIp: '', HostPort: '80' }],
        },
      },
      State: { Running: true, Health: { Status: 'healthy' } },
      NetworkSettings: {
        Networks: {
          'fetanagent-companion-device-ingress': network([
            'fetanagent-production-gateway-1',
            'gateway',
          ]),
          'fetanagent-production_public_application': network([
            'fetanagent-production-gateway-1',
            'gateway',
          ]),
          'fetanagent-telebirr-device-ingress': network(
            ['fetanagent-production-gateway-1', 'gateway'],
            networkId,
          ),
        },
        Ports: {},
      },
    },
    {
      Name: '/fetanagent-production-telebirr-device-bridge-1',
      RestartCount: 0,
      Config: {
        User: '10001:10001',
        Image: `fetanagent-telebirr-device-bridge:${productionRelease.slice(0, 12)}`,
        Entrypoint: ['docker-entrypoint.sh'],
        Cmd: ['node', 'apps/telebirr-device-bridge/dist/telebirr-device-bridge-main.js'],
        Env: [
          'FINANCIAL_ACTIONS_MODE=dry_run',
          'KEMERBET_EXECUTOR_ENABLED=false',
          'KEMERBET_FINAL_ACTION_ENABLED=false',
        ],
        ExposedPorts: null,
        Labels: {
          'com.docker.compose.project': 'fetanagent-production',
          'com.docker.compose.service': 'telebirr-device-bridge',
          'org.opencontainers.image.revision': productionRelease,
          'org.opencontainers.image.title': 'fetanagent-telebirr-device-bridge',
        },
      },
      HostConfig: { PortBindings: {} },
      State: { Running: true, Health: { Status: 'healthy' } },
      NetworkSettings: {
        Networks: {
          'fetanagent-telebirr-device-ingress': network(
            [
              'fetanagent-production-telebirr-device-bridge-1',
              'telebirr-device-bridge',
              'telebirr-device-bridge',
            ],
            networkId,
          ),
        },
        Ports: {},
      },
    },
  ];
  for (const [name, mutate, pass] of [
    ['exact endpoint isolation', () => {}, true],
    [
      'extra bridge network',
      (items) => {
        items[1].NetworkSettings.Networks.egress = network(['telebirr-device-bridge']);
      },
      false,
    ],
    [
      'published bridge port',
      (items) => {
        items[1].HostConfig.PortBindings = {
          '8084/tcp': [{ HostIp: '0.0.0.0', HostPort: '8084' }],
        };
      },
      false,
    ],
    [
      'cross-role bridge alias',
      (items) => {
        items[1].NetworkSettings.Networks['fetanagent-telebirr-device-ingress'].Aliases.push(
          'gateway',
        );
      },
      false,
    ],
    [
      'extra gateway network',
      (items) => {
        items[0].NetworkSettings.Networks.unreviewed = network(['gateway']);
      },
      false,
    ],
    [
      'extra gateway port',
      (items) => {
        items[0].HostConfig.PortBindings['3002/tcp'] = [{ HostIp: '', HostPort: '3002' }];
      },
      false,
    ],
    [
      'conflicting financial-actions assignment',
      (items) => {
        items[1].Config.Env.push('FINANCIAL_ACTIONS_MODE=live');
      },
      false,
    ],
  ]) {
    const fixture = makeEndpoints();
    mutate(fixture);
    const result = spawnSync(
      'jq',
      [
        '-e',
        '--arg',
        'network',
        'fetanagent-telebirr-device-ingress',
        '--arg',
        'network_id',
        networkId,
        '--arg',
        'release',
        productionRelease,
        endpointFilter,
      ],
      { input: JSON.stringify(fixture), encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
    executableChecks += 1;
  }
}

for (const file of [bridgePath, helperPath]) {
  const syntax = spawnSync(bash, ['-n', file], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
}

console.info(
  `FetanAgent H18 shared-TeleBirr-ingress helper bridge contracts and ${executableChecks} executable cases verified; successor helper ${helperSha256}.`,
);
