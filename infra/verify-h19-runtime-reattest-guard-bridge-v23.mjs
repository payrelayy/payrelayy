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
  'infra/operations/fetanagent-h19-runtime-reattest-guard-bridge-v23.sh',
);
const guard = normalized('infra/operations/fetanagent-production-ingress-h19.sh');
const runbook = normalized('infra/production-gateway-staging-telebirr-route-h19.md');
const v22Verifier = normalized('infra/verify-h19-terminal-receipt-order-guard-bridge-v22.mjs');
const guardDigest = sha256(guard);

const h19Release = '90b1f059577682b6bc458d239f6bdcb591077085';
const h22Release = '50bd429d58645cf8fde6f9a9757faac689cf864c';
const h22Intent = '67e025161494c63fc7cab2560c4947218afb8f57e7e317c7a37bfeb8f96d5e27';
const h22Completion = '5d0e26765c30bc7a9e6ee828b130de2c09cbbb13bcbca52c67182de3d482aad1';
const h22Guard = '0b4a9b31a893073e725bfc97fc6ef3f6589fd9b5d720da5003e987ad0dcc7f17';
const interruptedBridgeRelease = '837f3addad1e1acf9707099c0590824739e8c788';
const helper = '8c7230cea5101f182f05b11b094049822ddbe43884d7bda80a9a46b883eee4b4';
const finalizer = '1ab7df7d5e530db75ba5f378169de0fda178c1a264df3a48fbb5acf76220f34f';
const sudoers = '0978f4785d4661db46d8fe9bb8e29d81fa5ff2954aceb36aa6cc7d2ec4a71807';
const botRelease = 'bcc479be0f2e807203df5612d380002fd6df2ee5';
const botImage = 'sha256:2f9e1af37575172eae8f31b302aca11bb1b807ac48d007fa14f8467c90fd73e3';
const gatewayImage = 'sha256:443aac301bb8c26a51f7877a9cf016e8fd2101831c0cac6f59f7bd88a17189e8';
const caddy = 'afce01127ba2f428ebca83b09460a27fd96c7a2ac319136eeefcbe5714860616';
const production = 'fc65828179bb1ff86b64a53b3aaca208f60e62e12bf9ccdb5f8f81606199bef5';
const nine = '0b5c68c61794dadb0098470829ce581e6d8f9eec5ffc57429a5d438f72d846d6';
const ingress = '770077ec0bea920eeb2bff9970df0dd30b566a21c2f9b6fb13b209be51b677eb';
const tls = '2c6bbb0eea676963398ea39a76ed974c2863da72236de67be761d19197dd7fd8';

for (const [name, value] of [
  ['H22_RELEASE', h22Release],
  ['H22_INTENT_SHA256', h22Intent],
  ['H22_COMPLETION_SHA256', h22Completion],
  ['H22_GUARD_SHA256', h22Guard],
  ['REVIEWED_SUCCESSOR_GUARD_SHA256', guardDigest],
  ['INTERRUPTED_BRIDGE_RELEASE', interruptedBridgeRelease],
  ['H20_HELPER_SHA256', helper],
  ['H20_FINALIZER_SHA256', finalizer],
  ['H20_SUDOERS_SHA256', sudoers],
  ['H19_RELEASE', h19Release],
  ['APPROVED_BOT_RELEASE', botRelease],
  ['APPROVED_BOT_IMAGE_ID', botImage],
  ['CANDIDATE_GATEWAY_IMAGE_ID', gatewayImage],
  ['CANDIDATE_CADDY_SHA256', caddy],
  ['REATTESTED_PRODUCTION_SHA256', production],
  ['REATTESTED_NINE_SHA256', nine],
  ['REATTESTED_INGRESS_SHA256', ingress],
  ['TLS_LEAF_SHA256', tls],
]) {
  assert.match(installer, new RegExp(`^readonly ${name}='${value}'$`, 'mu'));
}

assert.match(
  guard,
  /readonly H23_PARENT='\/var\/lib\/fetanagent\/h19-runtime-reattest-guard-bridge-v23'/u,
);
const recordReader = shellFunction(guard, 'read_h19_record');
for (const invariant of [
  'fetanagent-h19-runtime-reattest-guard-bridge-v23',
  `h22_release_expected = '${h22Release}'`,
  `h22_intent_sha = '${h22Intent}'`,
  `h22_completion_sha = '${h22Completion}'`,
  `h22_guard_sha = '${h22Guard}'`,
  `interrupted_h23_release = '${interruptedBridgeRelease}'`,
  `approved_bot_release = '${botRelease}'`,
  `approved_bot_image = '${botImage}'`,
  `reattested_production_sha = '${production}'`,
  `reattested_nine_sha = '${nine}'`,
  `reattested_ingress_sha = '${ingress}'`,
  'state=runtime-reattest-guard-installed',
  'correction=approved-runtime-identity-reattest',
  'h19_through_h22_evidence_preserved=true',
  'digest(h23_archived_guard) != h22_guard_sha',
  '!= h23_successor_guard_sha',
  'print(h23_successor_guard_sha)',
  'print(approved_bot_release)',
  'print(approved_bot_image)',
  'resumed_after_archive_initializer_failure=true',
  'resume_correction_release=',
  'resume_correction=split-dependent-local-initializers',
]) {
  assert.ok(recordReader.includes(invariant), `missing H23 record invariant: ${invariant}`);
}
assert.match(guard, /"\$\{#H19_RECORD\[@\]\}" -eq 30/u);
assert.match(guard, /"\$\{H19_RECORD\[22\]\}" =~ \^sha256:/u);

const productionContract = shellFunction(guard, 'require_production_contract');
assert.match(productionContract, /--arg bot "\$\{H19_RECORD\[21\]\}"/u);
assert.match(productionContract, /service"\] == "bot"\s+then \$bot else \$protected end/u);
assert.match(productionContract, /FINANCIAL_ACTIONS_MODE=dry_run/u);
assert.match(productionContract, /KEMERBET_EXECUTOR_ENABLED=false/u);
assert.match(productionContract, /KEMERBET_FINAL_ACTION_ENABLED=false/u);
assert.match(
  shellFunction(guard, 'immutable_nine_digest'),
  /del\(\.ExecIDs,\.State\.Health\.Log\)/u,
  'the H23 guard fingerprint must exclude transient Docker exec sessions',
);

const installerProductionContract = shellFunction(installer, 'require_production_contract');
for (const invariant of [
  '.HostConfig.Memory == 134217728',
  '.HostConfig.NanoCpus == 250000000',
  '.HostConfig.PidsLimit == 128',
  '.HostConfig.LogConfig == {',
  '.Config.Healthcheck == {',
  'all(.NetworkSettings.Networks[];',
  '["fetanagent-production-gateway-1","gateway"]',
]) {
  assert.ok(
    installerProductionContract.includes(invariant),
    `H23 preflight must retain the gateway invariant: ${invariant}`,
  );
}
const installerSharedIngress = shellFunction(installer, 'require_shared_ingress');
for (const invariant of [
  'all(.[0].Containers | to_entries[];',
  '.value.EndpointID',
  '.value.MacAddress',
  '.value.IPv4Address',
  'network_rows=',
  'container_rows=',
  '"$network_rows" == "$container_rows"',
]) {
  assert.ok(
    installerSharedIngress.includes(invariant),
    `H23 preflight must retain the shared-ingress invariant: ${invariant}`,
  );
}
assert.match(
  shellFunction(installer, 'immutable_nine_digest'),
  /del\(\.ExecIDs,\.State\.Health\.Log\)/u,
  'the H23 preflight fingerprint must exclude transient Docker exec sessions',
);

const currentState = shellFunction(guard, 'require_current_state');
for (const boundary of [23, 24, 25, 26, 22]) {
  assert.ok(
    currentState.includes(`H19_RECORD[${boundary}]`),
    `candidate inspection must bind H23 field ${boundary}`,
  );
}
assert.match(currentState, /nine_digest="\$\(immutable_nine_digest\)"/u);
assert.match(currentState, /bot_id="\$\(bot_image_id\)"/u);

const intentFields = [
  'contract=fetanagent-h19-runtime-reattest-guard-bridge-v23',
  'state=authorized',
  'bridge_release=',
  'h22_bridge_release=',
  'h22_bridge_intent_sha256=',
  'h22_bridge_completion_sha256=',
  'h19_bridge_release=',
  'candidate_gateway_release=',
  'predecessor_ingress_guard_sha256=',
  'successor_ingress_guard_sha256=',
  'approved_telegram_bot_release=',
  'approved_telegram_bot_image_id=',
  'reattested_production_boundary_sha256=',
  'reattested_immutable_nine_sha256=',
  'reattested_shared_ingress_sha256=',
  'reattested_tls_leaf_sha256=',
  'candidate_gateway_image_id=',
  'candidate_gateway_caddyfile_sha256=',
  'staging_runtime_stopped=true',
  'correction=approved-runtime-identity-reattest',
  'h19_through_h22_evidence_preserved=true',
  'production_runtime_mutation=false',
  'database_mutation=false',
  'financial_actions_mode=disabled',
  'transfer_enabled=false',
  'amount_enabled=false',
  'money_moved=false',
];
assertInOrder(shellFunction(installer, 'expected_intent'), intentFields, 'H23 intent');
assert.match(
  shellFunction(installer, 'expected_completion'),
  /state=runtime-reattest-guard-installed[\s\S]*resumed_after_archive_initializer_failure=true[\s\S]*resume_correction_release=\$CORRECTION_RELEASE[\s\S]*resume_correction=split-dependent-local-initializers/u,
);
assertInOrder(
  installer,
  [
    'require_staged_bundle ||',
    'require_h22_boundary ||',
    'require_current_boundaries ||',
    'public_smoke ||',
    'open_lock ||',
    'disable_deploy_grant ||',
    'publish_record "$H23_INSTALLING" intent-v1',
    'archive_predecessor_guard ||',
    'install_successor_guard ||',
    'publish_record "$H23_INSTALLING" completed-v1',
    'mv -- "$H23_INSTALLING" "$H23_ROOT"',
    '"$INGRESS_GUARD" inspect "$H19_RELEASE"',
    'require_successor_record_output ||',
    'restore_deploy_grant ||',
  ],
  'H23 fail-closed transaction',
);
assert.doesNotMatch(installer, /docker_local\s+(?:compose|create|start|stop|rm|run)\b/u);
assert.doesNotMatch(installer, /supabase|psql|migration|edge function/iu);
assert.match(installer, /production_runtime_mutation=false/u);
assert.match(installer, /database_mutation=false/u);
assert.match(installer, /financial_actions_mode=disabled/u);
assert.match(installer, /money_moved=false/u);
assertInOrder(
  installer,
  [
    'require_current_boundaries ||',
    'if [[ "$MODE" == preflight ]]',
    'no state changed; money moved=false.',
    'exit 0',
    "open_lock || die 'the shared staging mutation lock is unavailable'",
  ],
  'H23 read-only preflight boundary',
);
assert.match(installer, /\[\[ "\$MODE" == apply \|\| "\$MODE" == preflight \]\]/u);
assert.match(installer, /"\$BRIDGE_RELEASE" == "\$INTERRUPTED_BRIDGE_RELEASE"/u);
assert.doesNotMatch(
  installer,
  /local\s+target="[^"]+"\s+temporary="\$target\.installing"/u,
  'dependent local initializers must be assigned separately under set -u',
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
  'infra/operations/fetanagent-h19-runtime-reattest-guard-bridge-v23.sh',
]) {
  const result = spawnSync(bash, ['-n', path], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, `${path}: ${result.stderr}`);
}

const bridgeRelease = interruptedBridgeRelease;
const correctionRelease = '2'.repeat(40);
const shellVariables = `set -euo pipefail
BRIDGE_RELEASE=${bridgeRelease}
CORRECTION_RELEASE=${correctionRelease}
H22_RELEASE=${h22Release}
H22_INTENT_SHA256=${h22Intent}
H22_COMPLETION_SHA256=${h22Completion}
H19_RELEASE=${h19Release}
H22_GUARD_SHA256=${h22Guard}
SUCCESSOR_GUARD_SHA256=${guardDigest}
APPROVED_BOT_RELEASE=${botRelease}
APPROVED_BOT_IMAGE_ID=${botImage}
REATTESTED_PRODUCTION_SHA256=${production}
REATTESTED_NINE_SHA256=${nine}
REATTESTED_INGRESS_SHA256=${ingress}
TLS_LEAF_SHA256=${tls}
CANDIDATE_GATEWAY_IMAGE_ID=${gatewayImage}
CANDIDATE_CADDY_SHA256=${caddy}
`;
const intentResult = spawnSync(bash, ['-s'], {
  input: `${shellVariables}${shellFunction(installer, 'expected_intent')}\nexpected_intent\n`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(intentResult.status, 0, intentResult.stderr);
const producedIntent = intentResult.stdout.trimEnd().split('\n');
assert.equal(producedIntent.length, 27);
assert.deepEqual(producedIntent, [
  'contract=fetanagent-h19-runtime-reattest-guard-bridge-v23',
  'state=authorized',
  `bridge_release=${bridgeRelease}`,
  `h22_bridge_release=${h22Release}`,
  `h22_bridge_intent_sha256=${h22Intent}`,
  `h22_bridge_completion_sha256=${h22Completion}`,
  `h19_bridge_release=${h19Release}`,
  `candidate_gateway_release=${h19Release}`,
  `predecessor_ingress_guard_sha256=${h22Guard}`,
  `successor_ingress_guard_sha256=${guardDigest}`,
  `approved_telegram_bot_release=${botRelease}`,
  `approved_telegram_bot_image_id=${botImage}`,
  `reattested_production_boundary_sha256=${production}`,
  `reattested_immutable_nine_sha256=${nine}`,
  `reattested_shared_ingress_sha256=${ingress}`,
  `reattested_tls_leaf_sha256=${tls}`,
  `candidate_gateway_image_id=${gatewayImage}`,
  `candidate_gateway_caddyfile_sha256=${caddy}`,
  'staging_runtime_stopped=true',
  'correction=approved-runtime-identity-reattest',
  'h19_through_h22_evidence_preserved=true',
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
assert.equal(producedCompletion.length, 31);
assert.equal(producedCompletion[1], 'state=runtime-reattest-guard-installed');
assert.deepEqual(producedCompletion.slice(2, 27), producedIntent.slice(2, 27));
assert.equal(
  producedCompletion[27],
  `bridge_intent_sha256=${sha256(`${producedIntent.join('\n')}\n`)}`,
);
assert.deepEqual(producedCompletion.slice(28), [
  'resumed_after_archive_initializer_failure=true',
  `resume_correction_release=${correctionRelease}`,
  'resume_correction=split-dependent-local-initializers',
]);

const archiveProbe = spawnSync(bash, ['-s'], {
  input: `set -euo pipefail
H23_INSTALLING="$(mktemp -d)"
trap 'rm -rf -- "$H23_INSTALLING"' EXIT
H22_GUARD_SHA256=${h22Guard}
touch "$H23_INSTALLING/predecessor-ingress-guard"
require_exact_file() { return 0; }
${shellFunction(installer, 'archive_predecessor_guard')}
archive_predecessor_guard
`,
  encoding: 'utf8',
  timeout: 10000,
});
assert.equal(
  archiveProbe.status,
  0,
  `the predecessor archive must execute under set -u: ${archiveProbe.stderr}`,
);

assert.match(runbook, /## H23 exact no-money runtime re-attestation/u);
const h23Runbook = runbook.slice(
  runbook.indexOf('## H23 exact no-money runtime re-attestation'),
  runbook.indexOf('## Build and gateway-only transition'),
);
assert.match(
  h23Runbook,
  /837f3addad1e1acf9707099c0590824739e8c788[\s\S]*?SUCCESSOR_INGRESS_GUARD_SHA256[\s\S]*?H23_RESUME_CORRECTION_MERGE_SHA[\s\S]*?preflight[\s\S]*?without the final `preflight` argument/u,
);
assert.doesNotMatch(
  runbook.slice(
    runbook.indexOf('## H20 canonical-capability correction'),
    runbook.indexOf('## H21 stable immutable-nine recovery'),
  ),
  /runtime-reattest-guard-bridge-v23|preflight/u,
  'the H23 recovery procedure must not appear in the historical H20 instructions',
);
assert.match(
  v22Verifier,
  /await import\('\.\/verify-h19-runtime-reattest-guard-bridge-v23\.mjs'\)/u,
  'the existing H22 infrastructure gate must immediately extend through H23',
);

console.log(
  `FetanAgent H23 runtime re-attestation contracts verified; predecessor ${h22Guard}; successor ${guardDigest}; bot ${botRelease}.`,
);
