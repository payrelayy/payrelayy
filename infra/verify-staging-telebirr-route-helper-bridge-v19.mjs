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

const installerPath = 'infra/operations/fetanagent-staging-telebirr-route-helper-bridge-v19.sh';
const helperPath = 'infra/operations/fetanagent-staging-deploy-helper.sh';
const guardPath = 'infra/operations/fetanagent-production-ingress-h19.sh';
const finalizerPath = 'infra/operations/fetanagent-staging-continuous-availability.sh';
const sudoersPath = 'infra/operations/fetanagent-staging-continuous-availability.sudoers';
const caddyPath = 'infra/gateway/Caddyfile';
const installer = normalized(installerPath);
const helper = normalized(helperPath);
const guard = normalized(guardPath);
const finalizer = normalized(finalizerPath);
const sudoers = normalized(sudoersPath);
const caddy = normalized(caddyPath);
const packageJson = normalized('package.json');
const helperDigest = sha256(helper);
const guardDigest = sha256(guard);
const finalizerDigest = sha256(finalizer);
const sudoersDigest = sha256(sudoers);
const caddyDigest = sha256(caddy);

const protectedRelease = '69be82ac3e49ff8c63c64c9aa7926e0046b48a10';
const predecessorHelper = '3adb799d17c3f51e2f6c49957d3a170e63151c30509962acdaf08c105dc65267';
const predecessorFinalizer = '103b40c6ef76cca08e92bb5b475104f775b054b3981c5bb55057a085126745ea';
const predecessorSudoers = 'd33645e4767102a64463d27d90b63685dd71d1352fb175eb64a738a06b21f958';
const baselineCaddy = '181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24';
const candidateCaddy = 'afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616';
const networkId = '5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738';
const protectedCompose = '98d7e763754868ba978d5c042c722664a1c1aec6f85e9011410d74e5d5f1928c';

assert.equal(caddyDigest, candidateCaddy, 'H19 must pin the exact reviewed LF Caddyfile');
for (const [name, digest] of [
  ['REVIEWED_SUCCESSOR_HELPER_SHA256', helperDigest],
  ['REVIEWED_SUCCESSOR_FINALIZER_SHA256', finalizerDigest],
  ['REVIEWED_SUCCESSOR_SUDOERS_SHA256', sudoersDigest],
  ['REVIEWED_INGRESS_GUARD_SHA256', guardDigest],
]) {
  assert.match(installer, new RegExp(`^readonly ${name}='${digest}'$`, 'mu'));
}
for (const [name, digest] of [
  ['PREDECESSOR_HELPER_SHA256', predecessorHelper],
  ['PREDECESSOR_FINALIZER_SHA256', predecessorFinalizer],
  ['PREDECESSOR_SUDOERS_SHA256', predecessorSudoers],
]) {
  assert.match(installer, new RegExp(`^readonly ${name}='${digest}'$`, 'mu'));
}
assert.match(finalizer, new RegExp(`^readonly HELPER_SHA='${helperDigest}'$`, 'mu'));
assert.equal(
  sudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${finalizerDigest} /usr/local/sbin/fetanagent-staging-continuous-availability preflight *\n` +
    `fetanagent-admin ALL=(root) NOPASSWD: sha256:${finalizerDigest} /usr/local/sbin/fetanagent-staging-continuous-availability disable-expiry *\n`,
  'continuous sudoers must checksum-bind both narrow operations to the successor finalizer',
);

for (const source of [installer, helper, guard]) {
  assert.ok(source.includes(protectedRelease));
  assert.ok(source.includes(baselineCaddy));
  assert.ok(source.includes(candidateCaddy));
  assert.ok(source.includes(networkId));
}
assert.match(installer, /"\$CANDIDATE_RELEASE" == "\$BRIDGE_RELEASE"/u);
assert.match(installer, /"\$BRIDGE_RELEASE" != "\$PROTECTED_RELEASE"/u);
assert.match(helper, /candidate_release != bridge_release/u);
assert.match(guard, /candidate != release/u);
assert.doesNotMatch(installer, /candidate_release in \(protected_release, bridge_release\)/u);

const intentFields = [
  'contract=fetanagent-staging-telebirr-route-helper-bridge-v19',
  'state=authorized',
  'bridge_release=$BRIDGE_RELEASE',
  'candidate_gateway_release=$CANDIDATE_RELEASE',
  'h18_bridge_release=${H18_RECORD[0]}',
  'predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256',
  'successor_helper_sha256=$SUCCESSOR_HELPER_SHA256',
  'predecessor_continuous_finalizer_sha256=$PREDECESSOR_FINALIZER_SHA256',
  'successor_continuous_finalizer_sha256=$SUCCESSOR_FINALIZER_SHA256',
  'predecessor_continuous_sudoers_sha256=$PREDECESSOR_SUDOERS_SHA256',
  'successor_continuous_sudoers_sha256=$SUCCESSOR_SUDOERS_SHA256',
  'ingress_guard_sha256=$INGRESS_GUARD_SHA256',
  'h18_bridge_intent_sha256=${H18_RECORD[1]}',
  'h18_bridge_completion_sha256=${H18_RECORD[2]}',
  'stopped_staging_boundary_sha256=$BASELINE_STOPPED_STAGING_BOUNDARY_SHA256',
  'baseline_production_boundary_sha256=$BASELINE_PRODUCTION_BOUNDARY_SHA256',
  'baseline_shared_ingress_boundary_sha256=$BASELINE_SHARED_INGRESS_BOUNDARY_SHA256',
  'baseline_tls_leaf_sha256=$BASELINE_TLS_LEAF_SHA256',
  'baseline_gateway_caddyfile_sha256=$BASELINE_CADDY_SHA256',
  'candidate_gateway_caddyfile_sha256=$CANDIDATE_CADDY_SHA256',
  'staging_runtime_stopped=true',
  'shared_ingress_network=$SHARED_NETWORK',
  'shared_ingress_network_id=$SHARED_NETWORK_ID',
  'protected_production_release=$PROTECTED_RELEASE',
  'accepted_production_ingress_states=baseline-or-reviewed-gateway-only',
  'continuous_pair_rotated=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
];
assertInOrder(
  shellFunction(installer, 'expected_intent'),
  intentFields,
  'H19 provenance intent must remain canonical',
);
assert.match(shellFunction(installer, 'expected_completion'), /state=route-helper-pair-installed/u);
assert.match(helper, /len\(intent\) != 32/u);
assert.match(helper, /len\(completion\) != 33/u);
assert.match(helper, /completion\[2:32\] != intent\[2:32\]/u);
assert.match(guard, /len\(intent\) != 32/u);
assert.match(guard, /len\(completed\) != 33/u);

const h19Parser = shellFunction(helper, 'inspect_kemerbet_h19_route_bridge');
for (const contract of [
  'predecessor-continuous-finalizer',
  'predecessor-continuous-sudoers',
  'predecessor-helper',
  'hashlib.sha256(predecessor_helper).hexdigest()',
  'hashlib.sha256(predecessor_finalizer).hexdigest()',
  'hashlib.sha256(predecessor_sudoers).hexdigest()',
  'hashlib.sha256(helper_data).hexdigest()',
  'hashlib.sha256(finalizer_data).hexdigest()',
  'hashlib.sha256(sudoers_data).hexdigest()',
  'hashlib.sha256(ingress_guard_data).hexdigest()',
  'baseline_tls_leaf_sha256=',
]) {
  assert.ok(h19Parser.includes(contract), `missing H19 parser invariant: ${contract}`);
}
const h14Gate = shellFunction(helper, 'inspect_kemerbet_h14_recovery_gate');
assertInOrder(
  h14Gate,
  [
    'inspect_kemerbet_h19_route_bridge',
    `if [[ "$KEMERBET_H19_ROUTE_BRIDGE_STATE" == 'active' ]]`,
    'inspect_kemerbet_h18_shared_ingress_bridge',
    '"$KEMERBET_H19_ROUTE_BRIDGE_PREDECESSOR_HELPER" 400',
    '"$KEMERBET_H19_ROUTE_BRIDGE_H18_INTENT_SHA256" ==',
    '"$KEMERBET_H18_SHARED_INGRESS_BRIDGE_INTENT_SHA256"',
    '"$KEMERBET_H19_ROUTE_BRIDGE_H18_COMPLETION_SHA256" ==',
    '"$KEMERBET_H18_SHARED_INGRESS_BRIDGE_COMPLETION_SHA256"',
    '"$KEMERBET_H19_ROUTE_BRIDGE_HELPER_SHA256" == "$current_helper_sha"',
  ],
  'H19 must chain through the exact archived H18 helper and record hashes',
);
const successorGate = shellFunction(helper, 'inspect_kemerbet_v2_v3_successor_gate');
assertInOrder(
  successorGate,
  [
    `if [[ "$KEMERBET_H19_ROUTE_BRIDGE_STATE" == 'active' ]]`,
    'KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$KEMERBET_H19_ROUTE_BRIDGE_HELPER_SHA256"',
    `elif [[ "$KEMERBET_H18_SHARED_INGRESS_BRIDGE_STATE" == 'active' ]]`,
  ],
  'the successor gate must prefer H19 and retain H18 fallback',
);

const sharedIngress = shellFunction(helper, 'require_shared_telebirr_ingress_network_contract');
assert.match(
  sharedIngress,
  /production_telebirr_bridge_revision" == "\$PRODUCTION_PROTECTED_RELEASE"/u,
);
assert.match(sharedIngress, /"\$PRODUCTION_PROTECTED_RELEASE"\) ;;/u);
assert.match(sharedIngress, /"\$KEMERBET_H19_CANDIDATE_GATEWAY_RELEASE"\)/u);
assert.match(sharedIngress, /require_h19_production_ingress_guard/u);
assert.doesNotMatch(
  sharedIngress,
  /production_gateway_revision" == "\$production_telebirr_bridge_revision/u,
);
const helperGuard = shellFunction(helper, 'require_h19_production_ingress_guard');
assert.match(helperGuard, /"\$guard_digest" == "\$KEMERBET_H19_INGRESS_GUARD_SHA256"/u);
assert.match(helperGuard, /inspect "\$expected_gateway_release"/u);

const productionContract = shellFunction(guard, 'require_production_contract');
for (const invariant of [
  '"api", "beta-admission", "bot", "customer-web", "gateway", "owner-control"',
  '"production-companion-device-bridge"',
  '"telebirr-assignment-broker"',
  '"telebirr-device-bridge"',
  '"telebirr-device-state-broker"',
  '.Config.Labels["org.opencontainers.image.revision"] == $protected',
  '.Config.Labels["org.opencontainers.image.revision"] == $expected',
  'FINANCIAL_ACTIONS_MODE=dry_run',
  'KEMERBET_EXECUTOR_ENABLED=false',
  'KEMERBET_FINAL_ACTION_ENABLED=false',
  '.HostConfig.ReadonlyRootfs == true',
  '.HostConfig.CapDrop == ["ALL"]',
  'FETANAGENT_COMPANION_BRIDGE_UPSTREAM=production-companion-device-bridge:8085',
  '/var/lib/fetanagent-gateway/config:/config:rw',
  '/var/lib/fetanagent-gateway/data:/data:rw',
  '.HostConfig.Memory == 134217728',
  '.HostConfig.NanoCpus == 250000000',
  '.HostConfig.PidsLimit == 128',
  '.HostConfig.LogConfig == {',
  '.Config.Healthcheck == {',
  '"443/tcp"',
  '"80/tcp"',
  'fetanagent-telebirr-device-ingress',
]) {
  assert.ok(productionContract.includes(invariant), `missing production invariant: ${invariant}`);
}
assert.match(shellFunction(guard, 'production_inspection'), /"\$\{#PRODUCTION_IDS\[@\]\}" -eq 10/u);
for (const name of [
  'production_boundary_digest',
  'immutable_nine_digest',
  'shared_ingress_digest',
  'tls_leaf_digest',
  'gateway_caddy_sha256',
  'gateway_image_id',
  'read_interrupted_transition_intent',
  'require_transition_record',
  'require_current_state',
]) {
  shellFunction(guard, name);
}
const currentState = shellFunction(guard, 'require_current_state');
assert.match(currentState, /"\$PROTECTED_RELEASE:absent"/u);
assert.match(currentState, /"\$PROTECTED_RELEASE:rolled-back"\|"\$\{H19_RECORD\[1\]\}:completed"/u);
assert.match(currentState, /"\$tls_digest" == "\$\{H19_RECORD\[11\]\}"/u);
assert.match(currentState, /"\$gateway_id" == "\$\{TRANSITION_RECORD\[4\]\}"/u);

const candidateImage = shellFunction(guard, 'require_gateway_image');
for (const invariant of [
  '.Config.User == "10001:10001"',
  'org.opencontainers.image.revision',
  'org.opencontainers.image.title',
  '.Config.Entrypoint == null',
  'caddy validate',
  'CANDIDATE_CADDY_SHA256',
]) {
  if (invariant === 'CANDIDATE_CADDY_SHA256') {
    assert.ok(
      shellFunction(guard, 'require_candidate_image').includes(invariant),
      `missing candidate-image invariant: ${invariant}`,
    );
  } else {
    assert.ok(
      candidateImage.includes(invariant),
      `missing candidate-image invariant: ${invariant}`,
    );
  }
}
assert.match(candidateImage, /docker_local run[\s\S]*?"\$expected_id"/u);
assert.match(shellFunction(guard, 'require_baseline_image'), /BASELINE_CADDY_SHA256/u);
assert.match(shellFunction(guard, 'current_gateway_revision'), /printf '%s' missing/u);
const immutableNine = shellFunction(guard, 'immutable_nine_digest');
assert.doesNotMatch(immutableNine, /production_inspection/u);
assert.match(immutableNine, /\(\$nine \| length\) == 9/u);

const transitionState = shellFunction(guard, 'transition_state');
for (const state of ['preparing', 'interrupted', 'completing', 'rolling-back']) {
  assert.ok(transitionState.includes(`print('${state}')`), `missing resumable ${state} state`);
}
assert.match(transitionState, /completed-v1\.installing/u);
assert.match(transitionState, /rolled-back-v1\.installing/u);
const transitionPhase = shellFunction(guard, 'require_transition_phase');
for (const accepted of [
  'transition:absent',
  'transition:preparing',
  'transition:interrupted',
  'transition:completing',
  'rollback:interrupted',
  'rollback:rolling-back',
]) {
  assert.ok(transitionPhase.includes(accepted), `missing accepted transition phase: ${accepted}`);
}
const recoverableRevision = shellFunction(guard, 'require_recoverable_gateway_revision');
assert.match(recoverableRevision, /"\$PROTECTED_RELEASE"\|"\$\{H19_RECORD\[1\]\}"\|missing/u);
const reconcileTransition = shellFunction(guard, 'reconcile_atomic_file');
assert.match(reconcileTransition, /expected\[:len\(data\)\] != data if prefix/u);
assert.match(reconcileTransition, /os\.fsync\(descriptor\)/u);
assert.match(reconcileTransition, /os\.rename\(temporary, target\)/u);

const interruptedIntent = shellFunction(guard, 'read_interrupted_transition_intent');
assert.match(interruptedIntent, /len\(intent\) != 22/u);
assert.match(interruptedIntent, /baseline_gateway_image_id=/u);
const terminalRecord = shellFunction(guard, 'require_transition_record');
assert.match(terminalRecord, /len\(intent\)!=22 or len\(result\)!=27/u);
assert.match(terminalRecord, /expected_post_image = candidate_image if state == 'completed'/u);
assert.match(terminalRecord, /result\[25\]!=f'post_gateway_image_id=\{expected_post_image\}'/u);
const h19GuardRecord = shellFunction(guard, 'read_h19_record');
for (const archiveInvariant of [
  'hashlib.sha256(archived_helper).hexdigest() != predecessor_helper',
  'hashlib.sha256(archived_finalizer).hexdigest() != predecessor_finalizer',
  'hashlib.sha256(archived_sudoers).hexdigest() != predecessor_sudoers',
]) {
  assert.ok(
    h19GuardRecord.includes(archiveInvariant),
    `missing guard provenance: ${archiveInvariant}`,
  );
}
const composeGateway = shellFunction(guard, 'compose_gateway');
assert.match(composeGateway, /--profile production up --detach --no-deps --no-build --wait/u);
assert.match(composeGateway, /gateway\n/u);
assert.doesNotMatch(composeGateway, /(?:api|owner-control|telebirr-device-bridge)\s*$/mu);
const protectedComposeSource = shellFunction(guard, 'protected_compose_source');
assert.match(guard, new RegExp(`^readonly PROTECTED_COMPOSE_SHA256='${protectedCompose}'$`, 'mu'));
assert.match(protectedComposeSource, /PROTECTED_COMPOSE_SHA256/u);
assert.match(protectedComposeSource, /root:root:444:1/u);
assert.match(composeGateway, /protected_compose_source/u);
const publicSmoke = shellFunction(guard, 'public_smoke');
assert.match(publicSmoke, /X-FetanAgent-Deployment-Target: staging/u);
assert.match(publicSmoke, /X-FetanAgent-Deployment-Target: production/u);
assert.match(publicSmoke, /X-FetanAgent-Deployment-Target: Staging/u);
assert.ok(
  publicSmoke.match(/X-FetanAgent-Deployment-Target: staging/gu)?.length >= 3,
  'candidate smoke must include the staging and duplicate-header cases',
);
assert.match(publicSmoke, /"\$code" == '404'/u);

for (const name of [
  'resolve_h18_record',
  'expiry_guard_snapshot',
  'stopped_staging_boundary_digest',
  'production_boundary_digest',
  'shared_ingress_boundary_digest',
  'tls_leaf_digest',
  'publish_record_atomically',
  'reconcile_copy',
  'reconcile_replace',
  'require_installing_record',
  'require_exact_record',
  'require_causal_topology',
  'transaction_snapshot',
  'archive_predecessors',
  'install_successor_artifacts',
  'install_successor_continuous_sudoers',
  'remove_disabled_predecessor_sudoers',
]) {
  shellFunction(installer, name);
}
const expiryGuardSnapshot = shellFunction(installer, 'expiry_guard_snapshot');
for (const invariant of [
  'loaded:loaded',
  'not-found:not-found',
  'root:root:644:1',
  '! -e "$TIMER_PATH" && ! -L "$TIMER_PATH"',
  '! -e "$SERVICE_PATH" && ! -L "$SERVICE_PATH"',
]) {
  assert.ok(
    expiryGuardSnapshot.includes(invariant),
    `missing stopped expiry-guard invariant: ${invariant}`,
  );
}
assert.match(
  shellFunction(installer, 'stopped_staging_boundary_digest'),
  /systemd_snapshot="\$\(expiry_guard_snapshot\)"/u,
);
assertInOrder(
  installer,
  [
    'require_predecessor_helper_boundary || die',
    'BASELINE_PRODUCTION_BOUNDARY_SHA256="$(production_boundary_digest)"',
    'BASELINE_SHARED_INGRESS_BOUNDARY_SHA256="$(shared_ingress_boundary_digest)"',
    'BASELINE_TLS_LEAF_SHA256="$(tls_leaf_digest)"',
    'BASELINE_STOPPED_STAGING_BOUNDARY_SHA256="$(stopped_staging_boundary_digest)"',
    'PREFLIGHT_SNAPSHOT="$(transaction_snapshot)"',
    'open_lock || die',
    'LOCKED_SNAPSHOT="$(transaction_snapshot)"',
    '"$LOCKED_SNAPSHOT" == "$PREFLIGHT_SNAPSHOT"',
    'disable_deploy_grant || die',
    'disable_continuous_grant || die',
    'publish_record_atomically "$H19_INSTALLING" intent-v1',
    'archive_predecessors || die',
    'install_successor_artifacts || die',
    'publish_record_atomically "$H19_INSTALLING" completed-v1',
    'mv -- "$H19_INSTALLING" "$H19_ROOT"',
    'install_successor_continuous_sudoers ||',
    'remove_disabled_predecessor_sudoers || die',
    'require_successor_bundle && require_preserved_boundaries',
    'require_successor_helper_boundary ||',
    'restore_deploy_grant || die',
    'close_lock || die',
    'require_successor_helper_boundary ||',
  ],
  'H19 installation must preserve its isolation, archive, rotation, and attestation order',
);
const transitionCase = guard.slice(guard.indexOf('  transition)'), guard.indexOf('  rollback)'));
assertInOrder(
  transitionCase,
  [
    "open_lock || die 'the shared staging mutation lock is unavailable'",
    "require_staging_absent || die 'staging and the device pilot must be stopped'",
    'state="$(transition_state)"',
    'require_candidate_image "$image_id"',
    'ensure_preparing_namespace || die',
    'publish_transition_record "$installing" intent-v1',
    'compose_gateway "${H19_RECORD[1]}"',
    'publish_transition_record "$installing" completed-v1',
    'mv -- "$installing" "$TRANSITION_PARENT/${H19_RECORD[1]}"',
  ],
  'gateway transition must lock, seal a resumable intent, mutate only the gateway, and terminalize',
);
assert.match(transitionCase, /require_transition_phase transition "\$state"/u);
assert.match(transitionCase, /"\$\{#intent\[@\]\}" -eq 6/u);
const rollbackStart = guard.indexOf('  rollback)');
const rollbackCase = guard.slice(
  rollbackStart,
  guard.indexOf("  *) die 'expected inspect, transition, or rollback'", rollbackStart),
);
assertInOrder(
  rollbackCase,
  [
    "open_lock || die 'the shared staging mutation lock is unavailable'",
    "require_staging_absent || die 'staging and the device pilot must be stopped'",
    'require_baseline_image "$baseline_gateway_image_id"',
    'compose_gateway "$PROTECTED_RELEASE"',
    '"$post_gateway_image_id" == "$baseline_gateway_image_id"',
    'publish_transition_record "$installing" rolled-back-v1',
  ],
  'rollback must remain lock-held and restore only the image ID sealed before cutover',
);
assert.match(rollbackCase, /require_transition_phase rollback "\$state"/u);
for (const forbidden of [
  /\b(?:psql|createdb|dropdb)\b/iu,
  /FINANCIAL_ACTIONS_MODE=live/u,
  /KEMERBET_(?:EXECUTOR|FINAL_ACTION)_ENABLED=true/u,
  /docker_local\s+(?:container|network)\s+(?:create|connect|disconnect|kill|rm|run|start|stop|update)\b/u,
  /docker\s+compose[\s\S]*?\b(?:down|restart|stop)\b/u,
]) {
  assert.doesNotMatch(installer, forbidden);
}
assert.match(installer, /production_runtime_mutation=false/u);
assert.match(installer, /database_mutation=false/u);
assert.match(installer, /money_moved=false/u);

assert.match(
  packageJson,
  /verify-shared-telebirr-ingress-helper-bridge-v18\.mjs && node infra\/verify-staging-telebirr-route-helper-bridge-v19\.mjs/u,
  'test:infra must run H19 immediately after its H18 predecessor',
);

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash);
let executableChecks = 0;
for (const [name, timerLoad, serviceLoad, residue, pass] of [
  ['fully absent expiry pair', 'not-found', 'not-found', 'none', true],
  ['absent expiry pair with timer residue', 'not-found', 'not-found', 'timer', false],
  ['mixed absent and loaded expiry pair', 'not-found', 'loaded', 'none', false],
  ['loaded inactive and disabled expiry pair', 'loaded', 'loaded', 'pair', true],
  ['loaded expiry pair with missing unit files', 'loaded', 'loaded', 'none', false],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
fixture_root="$(mktemp -d)"
trap 'rm -rf -- "$fixture_root"' EXIT
TIMER='expiry.timer'
SERVICE='expiry.service'
TIMER_PATH="$fixture_root/$TIMER"
SERVICE_PATH="$fixture_root/$SERVICE"
[[ '${residue}' != timer ]] || printf residue >"$TIMER_PATH"
if [[ '${residue}' == pair ]]; then
  printf timer >"$TIMER_PATH"
  printf service >"$SERVICE_PATH"
fi
realpath() {
  [[ "$1" == -- && $# == 2 ]] || return 90
  printf '%s\n' "$2"
}
stat() {
  [[ "$1" == "--format=%U:%G:%a:%h" && $# == 2 ]] || return 90
  printf '%s\n' 'root:root:644:1'
}
systemctl() {
  [[ "$1" == show ]] || return 91
  local property="\${2#--property=}"
  if [[ "$3" == --value ]]; then
    case "$property:$4" in
      LoadState:$TIMER) printf '%s\n' '${timerLoad}' ;;
      LoadState:$SERVICE) printf '%s\n' '${serviceLoad}' ;;
      ActiveState:*) printf '%s\n' inactive ;;
      UnitFileState:$TIMER)
        [[ '${timerLoad}' == loaded ]] && printf '%s\n' disabled || printf '\n'
        ;;
      UnitFileState:$SERVICE) printf '\n' ;;
      FragmentPath:$TIMER)
        [[ '${timerLoad}' == loaded ]] && printf '%s\n' "$TIMER_PATH" || printf '\n'
        ;;
      FragmentPath:$SERVICE)
        [[ '${serviceLoad}' == loaded ]] && printf '%s\n' "$SERVICE_PATH" || printf '\n'
        ;;
      NextElapseUSecRealtime:*|DropInPaths:*) printf '\n' ;;
      *) return 92 ;;
    esac
    return
  fi
  [[ "$property" == 'LoadState,ActiveState,UnitFileState,NextElapseUSecRealtime,DropInPaths' &&
    "$3" == "$TIMER" && "$4" == "$SERVICE" ]] || return 93
  printf '%s\n' \
    'LoadState=${timerLoad}' 'ActiveState=inactive' 'UnitFileState=' \
    'NextElapseUSecRealtime=' 'DropInPaths=' '' \
    'LoadState=${serviceLoad}' 'ActiveState=inactive' 'UnitFileState=' 'DropInPaths='
}
${expiryGuardSnapshot}
expiry_guard_snapshot >/dev/null
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  executableChecks += 1;
}

const causal = shellFunction(installer, 'require_causal_topology');
const allowed = new Set([
  'absent:old:old:missing:old:missing:active',
  'absent:old:old:missing:old:missing:disabled',
  'absent:old:old:missing:missing:old:disabled',
  'empty-parent:old:old:missing:missing:old:disabled',
  'interrupted:old:old:missing:missing:old:disabled',
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
  'interrupted:old:old:missing:missing:old:active',
  'interrupted:new:old:missing:missing:old:disabled',
  'interrupted:old:new:new:missing:old:disabled',
  'completed:new:new:missing:new:missing:active',
  'completed:new:new:new:old:missing:active',
  'absent:new:new:new:new:missing:active',
];
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

const allowedPhases = new Set([
  'transition:absent',
  'transition:preparing',
  'transition:interrupted',
  'transition:completing',
  'rollback:interrupted',
  'rollback:rolling-back',
]);
for (const operation of ['transition', 'rollback', 'inspect']) {
  for (const state of [
    'absent',
    'preparing',
    'interrupted',
    'completing',
    'rolling-back',
    'completed',
    'rolled-back',
    'invalid',
  ]) {
    const result = spawnSync(bash, ['-s'], {
      input: `set -euo pipefail
${transitionPhase}
require_transition_phase '${operation}' '${state}'
`,
      encoding: 'utf8',
      timeout: 10000,
    });
    const key = `${operation}:${state}`;
    assert.equal(result.status, allowedPhases.has(key) ? 0 : 1, `transition phase ${key}`);
    executableChecks += 1;
  }
}

const candidateRelease = '1111111111111111111111111111111111111111';
for (const [revision, accepted] of [
  [protectedRelease, true],
  [candidateRelease, true],
  ['missing', true],
  ['2222222222222222222222222222222222222222', false],
  ['', false],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
PROTECTED_RELEASE='${protectedRelease}'
H19_RECORD=('unused' '${candidateRelease}')
${recoverableRevision}
require_recoverable_gateway_revision '${revision}'
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, accepted ? 0 : 1, `gateway recovery revision ${revision}`);
  executableChecks += 1;
}

const intentResult = spawnSync(bash, ['-s'], {
  input: `set -euo pipefail
BRIDGE_RELEASE='1111111111111111111111111111111111111111'
CANDIDATE_RELEASE="$BRIDGE_RELEASE"
H18_RECORD=('2222222222222222222222222222222222222222' '${'a'.repeat(64)}' '${'b'.repeat(64)}' '${'c'.repeat(64)}')
PREDECESSOR_HELPER_SHA256='${predecessorHelper}'
SUCCESSOR_HELPER_SHA256='${helperDigest}'
PREDECESSOR_FINALIZER_SHA256='${predecessorFinalizer}'
SUCCESSOR_FINALIZER_SHA256='${finalizerDigest}'
PREDECESSOR_SUDOERS_SHA256='${predecessorSudoers}'
SUCCESSOR_SUDOERS_SHA256='${sudoersDigest}'
INGRESS_GUARD_SHA256='${guardDigest}'
BASELINE_STOPPED_STAGING_BOUNDARY_SHA256='${'d'.repeat(64)}'
BASELINE_PRODUCTION_BOUNDARY_SHA256='${'e'.repeat(64)}'
BASELINE_SHARED_INGRESS_BOUNDARY_SHA256='${'f'.repeat(64)}'
BASELINE_TLS_LEAF_SHA256='${'1'.repeat(64)}'
BASELINE_CADDY_SHA256='${baselineCaddy}'
CANDIDATE_CADDY_SHA256='${candidateCaddy}'
SHARED_NETWORK='fetanagent-telebirr-device-ingress'
SHARED_NETWORK_ID='${networkId}'
PROTECTED_RELEASE='${protectedRelease}'
${shellFunction(installer, 'expected_intent')}
expected_intent
`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(intentResult.status, 0, intentResult.stderr);
assert.equal(intentResult.stdout.trimEnd().split('\n').length, 32);
assert.deepEqual(intentResult.stdout.trimEnd().split('\n').slice(-7), [
  'continuous_pair_rotated=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
]);
executableChecks += 1;

console.log(
  `FetanAgent H19 TeleBirr route-helper bridge contracts and ${executableChecks} executable adversarial cases verified; helper ${helperDigest}; guard ${guardDigest}.`,
);
