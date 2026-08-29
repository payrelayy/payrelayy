import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const operation = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery.sh',
);
const original = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh',
);
const validator = resolve(root, 'infra/operations/fetanagent-owner-archive-validator.py');
const fixtures = resolve(root, 'infra/verify-owner-archive-validator-fixtures.py');
const workflowPath = resolve(root, '.github/workflows/staging-beta-deploy-smoke.yml');
const normalized = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const script = normalized(operation);
const workflow = normalized(workflowPath);
assert.ok(
  workflow.includes(
    'For h14-owner-runtime-bridge-stage type owner-only-no-provider-action-no-money; for h14-owner-runtime-bridge-archive-recovery-stage type owner-unchanged-customer-web-only-no-provider-action-no-money',
  ),
);
assert.ok(
  workflow.includes('[[ "$CONFIRMED_OWNER_ONLY" == \'owner-only-no-provider-action-no-money\' ]]'),
);
assert.ok(
  workflow.includes(
    '[[ "$CONFIRMED_OWNER_ONLY" == \'owner-unchanged-customer-web-only-no-provider-action-no-money\' ]]',
  ),
);
for (const exact020 of [
  "readonly FAILED_COUNTER_CORRECTION_RELEASE='0202304e3c606d2a7927a5b027d76926c0117189'",
  "readonly FAILED_COUNTER_CORRECTION_BUNDLE_ROOT_DEV_INO='64769:6102972'",
  "readonly FAILED_COUNTER_CORRECTION_SCRIPT_DEV_INO='64769:6102973'",
  "readonly FAILED_COUNTER_CORRECTION_SCRIPT_SHA256='7e4d1d7cbcc8494b0120ee6477b4a3e355e8bb88c55a68a9f1ca6f02b9d1d244'",
  "readonly FAILED_COUNTER_CORRECTION_SCRIPT_SIZE='294196'",
  "readonly FAILED_COUNTER_CORRECTION_VALIDATOR_DEV_INO='64769:6102974'",
  "readonly FAILED_COUNTER_CORRECTION_VALIDATOR_SHA256='6814f14708da844167b0f00a2b37c848eebb15eed64b7e1844f6bbeb0a9d36aa'",
  "readonly FAILED_COUNTER_CORRECTION_VALIDATOR_SIZE='11689'",
  "readonly FAILED_COUNTER_CORRECTION_MANIFEST_DEV_INO='64769:6102975'",
  "readonly FAILED_COUNTER_CORRECTION_MANIFEST_SHA256='25b5f8e1a6b9fd9c853bbf6f6290b1c516329c85ef5bb57155bae503e1f85d67'",
  "readonly FAILED_COUNTER_CORRECTION_MANIFEST_SIZE='17270'",
  "readonly FAILED_COUNTER_CORRECTION_WORKFLOW_RUN_ID='33258358642'",
  "readonly FAILED_COUNTER_CORRECTION_WORKFLOW_RUN_ATTEMPT='1'",
  "readonly FAILED_COUNTER_BRIDGE_PARENT_DEV_INO='64769:6102976'",
  "readonly FAILED_COUNTER_BRIDGE_INSTALLING_DEV_INO='64769:6102977'",
])
  assert.ok(script.includes(exact020), `missing exact 020 pin ${exact020}`);
for (const exactLivePin of [
  "readonly SOURCE_API_CONTAINER_ID='8c1b665a0aa76c18f2bc9b4d5f58eb1f81d65a9b2eb8f75ec2bbd5e585b25f40'",
  "readonly SOURCE_API_IMAGE_ID='sha256:b78679b7c8bcf0a1ac5a54de980135909bde02d51bb340f19f40f2976a674a82'",
  "readonly SOURCE_API_ENV_SHA256='8d4492013a9b2759a4c3c6f191232a05b32838ebb4fad916ccc5cf54580d0a0e'",
  "readonly SOURCE_API_COMPOSE_CONFIG_SHA256='ee42feef7beb518881d5ab726e806ae4a25acf922127be111c016064b54f5591'",
  "readonly SOURCE_CUSTOMER_WEB_CONTAINER_ID='fb7151ac21d99795939ec0dbbec05676109edabf8fa8a7bb349627fbbdd6dc49'",
  "readonly SOURCE_CUSTOMER_WEB_IMAGE_ID='sha256:7551b33fd126a47898998dcc5a8a62e751e444e16a854be138abe6fedb35aa82'",
  "readonly SOURCE_CUSTOMER_WEB_ENV_SHA256='eeaf8dee7d2d4f0bbb849dbe9f48e58b5e762520e06bb9162fd656cca7072f29'",
  "readonly SOURCE_CUSTOMER_WEB_COMPOSE_CONFIG_SHA256='b176e9d8b8c17796c92bdf1e59ac3b9c588f0b1c6291c86284d5d6c25ab07edd'",
  "readonly SOURCE_CUSTOMER_WEB_HEALTHY_RUNTIME_SHA256='5e80a968bf1d4450789492d57d87b2099118c1f4c323e0354036f82ed5c50208'",
  "readonly SOURCE_CUSTOMER_WEB_UNHEALTHY_RUNTIME_SHA256='b5ce7d0c73ae297c7f92215077ccd6a0a61073034efe23c91f7199fba1869113'",
  "readonly SOURCE_CUSTOMER_WEB_PID='179321'",
  "readonly SOURCE_CUSTOMER_WEB_STARTED_AT='2026-08-28T14:49:52.189193639Z'",
  "readonly SOURCE_CUSTOMER_WEB_NORMALIZED_SHA256='c2d31ec2e32fb27ba760ee28eed24865416a3481693fedf2b7daf803737dc168'",
  "readonly SOURCE_NON_OWNER_INVENTORY_SHA256='e26ef85318a9e2829b409536cd28043fd0a71f8625cb1afe9968da28895bffd7'",
  "readonly SOURCE_OTHER_SERVICE_INVENTORY_SHA256='61fab7e78ea2e288a60f73b3683e749ff4a57fc753a7c6c419516cff99766bfd'",
  "readonly SOURCE_GATEWAY_CONTAINER_ID='4aad462e26441c0d660ffeb2d3f825068522da83ee025caeb6eebb695cf5bc45'",
  "readonly SOURCE_BOT_CONTAINER_ID='5e2b2eaa85f02f8bcc746415e693c5cbe8e3cd2ee01831ee7facf7d4185b3e52'",
  "readonly SOURCE_BETA_CONTAINER_ID='c551f228d247c638b7865f739d5422b3e10eeec1534582d3a458daf0b2f56e14'",
  "readonly SOURCE_OWNER_PID='685566'",
  "readonly SOURCE_OWNER_STARTED_AT='2026-08-29T13:57:40.258370212Z'",
])
  assert.ok(script.includes(exactLivePin), `missing exact live pin ${exactLivePin}`);
const failedCounterStart = script.indexOf('require_failed_counter_runtime() {');
const failedCounterEnd = script.indexOf('\n}\n', failedCounterStart);
const failedCounterHelper = script.slice(failedCounterStart, failedCounterEnd);
for (const exactCounterBoundary of [
  '! -L "$FAILED_COUNTER_BRIDGE_PARENT"',
  '"$(realpath -- "$FAILED_COUNTER_BRIDGE_PARENT")" == "$FAILED_COUNTER_BRIDGE_PARENT"',
  '"$FAILED_COUNTER_BRIDGE_PARENT_DEV_INO:root:root:700:3"',
  '".installing-$FAILED_COUNTER_CORRECTION_RELEASE:d"',
  '! -L "$FAILED_COUNTER_BRIDGE_INSTALLING"',
  '"$(realpath -- "$FAILED_COUNTER_BRIDGE_INSTALLING")" == "$FAILED_COUNTER_BRIDGE_INSTALLING"',
  '"$FAILED_COUNTER_BRIDGE_INSTALLING_DEV_INO:root:root:700:2"',
])
  assert.ok(
    failedCounterHelper.includes(exactCounterBoundary),
    `failed-counter helper lacks ${exactCounterBoundary}`,
  );
assert.ok(
  (script.match(/require_failed_counter_runtime/gu) ?? []).length >= 7,
  '020 boundary is not connected to pre-intent, completion, replay, and finalization paths',
);
for (const transport of [
  'docker image save --output "$customer_archive" "$customer_tag"',
  'customer_archive_sha="$(sha256sum "$customer_archive"',
  'customer_archive_size="$(stat -c %s "$customer_archive")"',
  'customer_image_id="$(docker image inspect "$customer_tag" --format \'{{.Id}}\')"',
  'CUSTOMER_ARCHIVE_SHA: ${{ steps.bundle.outputs.customer_archive_sha }}',
  'CUSTOMER_ARCHIVE_SIZE: ${{ steps.bundle.outputs.customer_archive_size }}',
  'CUSTOMER_IMAGE_ID: ${{ steps.bundle.outputs.customer_image_id }}',
  "claim_one '$REMOTE_BUNDLE/fetanagent-customer-web-self-recovery.tar'",
  "'$CUSTOMER_ARCHIVE_SHA' '$CUSTOMER_ARCHIVE_SIZE' '$CUSTOMER_IMAGE_ID'",
  'scp "${opts[@]}" infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery.sh infra/operations/fetanagent-owner-archive-validator.py "$MANIFEST" "$CUSTOMER_ARCHIVE" "$remote:$bundle/"',
  'sha256sum "$bundle/fetanagent-customer-web-self-recovery.tar"',
  'stat -c %s "$bundle/fetanagent-customer-web-self-recovery.tar"',
])
  assert.ok(workflow.includes(transport), `missing archive/image transport ${transport}`);
assert.ok(
  workflow.includes(
    'fetanagent-customer-web-self-recovery.tar:f\n          fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery.sh:f\n          fetanagent-owner-archive-validator.py:f\n          manifest-v1:f',
  ),
);
assert.ok(workflow.includes("config.get('Entrypoint') == ['docker-entrypoint.sh']"));
assert.equal(
  (script.match(/config\.get\('Entrypoint'\) != \['docker-entrypoint\.sh'\]/gu) ?? []).length,
  3,
  'all customer image, successor-delta, and replacement security comparators must require the exact Node entrypoint',
);
assert.ok(
  !script.includes("config.get('Entrypoint') not in (None, [])"),
  'a stale empty customer entrypoint comparator remains',
);
assert.ok(workflow.includes("config['WorkingDir'] == '/workspace'"));
assert.ok(workflow.includes("config['Healthcheck'] =="));

const workflowManifestStart = workflow.indexOf('cat >"$manifest" <<EOF');
assert.ok(workflowManifestStart >= 0, 'workflow recovery manifest emitter is missing');
const workflowManifestEnd = workflow.indexOf('\n          EOF', workflowManifestStart);
assert.ok(
  workflowManifestEnd > workflowManifestStart,
  'workflow recovery manifest terminator is missing',
);
const workflowManifestKeys = workflow
  .slice(workflowManifestStart, workflowManifestEnd)
  .split('\n')
  .map((line) => /^\s{10}([a-z0-9_]+)=/.exec(line)?.[1])
  .filter(Boolean);
const shellManifestStart = script.indexOf('cmp -s -- "$STAGED_RECOVERY_MANIFEST"');
assert.ok(shellManifestStart >= 0, 'shell recovery manifest comparator is missing');
const shellManifestEnd = script.indexOf(
  "die 'the append-only archive-recovery bundle manifest is not exact'",
  shellManifestStart,
);
assert.ok(
  shellManifestEnd > shellManifestStart,
  'shell recovery manifest comparator terminator is missing',
);
const shellManifestKeys = [
  ...script.slice(shellManifestStart, shellManifestEnd).matchAll(/["']([a-z0-9_]+)=/g),
].map((match) => match[1]);
assert.deepEqual(
  shellManifestKeys,
  workflowManifestKeys,
  'workflow recovery manifest key order/schema drifted from the shell exact comparator',
);
for (const fixedManifestLine of [
  'customer_web_lifecycle_mutation=exact-single-self-recovery-replacement-v1',
  'all_other_lifecycle_mutation=forbidden',
  'failed_counter_bridge_inventory=empty-no-intent',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'provider_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'money_moved=false',
]) {
  assert.ok(workflow.slice(workflowManifestStart, workflowManifestEnd).includes(fixedManifestLine));
  assert.ok(
    script.slice(shellManifestStart, shellManifestEnd).includes(`'${fixedManifestLine}'`) ||
      script.slice(shellManifestStart, shellManifestEnd).includes(`"${fixedManifestLine}"`),
  );
}
for (const runtimeConnectivityContract of [
  "if next(iter(networks)) != 'fetanagent-staging-beta_service': raise RuntimeError()",
  "if host.get('PortBindings') not in (None, {}) or len(networks) != 1: raise RuntimeError()",
  "if host.get('Privileged') is not False or host.get('ReadonlyRootfs') is not True or host.get('Init') is not True: raise RuntimeError()",
  "if host.get('SecurityOpt') != ['no-new-privileges:true']: raise RuntimeError()",
  'classify_customer_web_replacement_state() {',
  '[[ "$inventory" =~ ^[0-9a-f]{64}$ && "$inventory" != "$SOURCE_CUSTOMER_WEB_CONTAINER_ID" ]] || return 1',
  'up --detach --no-deps --no-build --wait --wait-timeout 90 customer-web',
  "ipv4 = ipaddress.ip_interface(new_ep.get('IPv4Address') or '')",
  "ipv6 = ipaddress.ip_interface(new_ep.get('IPv6Address') or '')",
  'ipv4.network.prefixlen == subnet.prefixlen',
  'ipv6.network.prefixlen == subnet.prefixlen',
  'require_failed_counter_runtime || return 1',
  'require_resumed_intent_pre_mutation_boundary || return 1',
  'PRE_CREATE_DOCKER_INVENTORY="$(emit_exact_nofollow_file',
])
  assert.ok(
    script.includes(runtimeConnectivityContract),
    `missing helper connectivity/negative contract ${runtimeConnectivityContract}`,
  );
const otherGuard = script.indexOf('replace_customer_web_once() {');
const preMutationExact = script.indexOf(
  'require_other_service_inventory_exact || return 1',
  otherGuard,
);
const archiveLoad = script.indexOf(
  'docker_local image load --input "$STAGED_CUSTOMER_WEB_IMAGE_ARCHIVE"',
  otherGuard,
);
assert.ok(
  otherGuard >= 0 && preMutationExact > otherGuard && archiveLoad > preMutationExact,
  'unrelated services are not proved exact before archive/load replacement mutation',
);
const resumedBoundary = script.indexOf(
  'require_resumed_intent_pre_mutation_boundary || return 1',
  otherGuard,
);
assert.ok(
  resumedBoundary > otherGuard && resumedBoundary < archiveLoad,
  'full resumed-intent Docker boundary is not proved before image load',
);
const resumedHelperStart = script.indexOf('require_resumed_intent_pre_mutation_boundary() {');
const resumedHelperEnd = script.indexOf(
  '\n}\n\nrequire_complete_owner_endpoint_phase_boundary()',
  resumedHelperStart,
);
assert.ok(resumedHelperStart >= 0 && resumedHelperEnd > resumedHelperStart);
const resumedHelper = script.slice(resumedHelperStart, resumedHelperEnd);
for (const exactReplacementEndpointCheck of [
  "re.fullmatch(r'[0-9a-f]{64}', endpoint.get('EndpointID') or '')",
  "re.fullmatch(r'(?:[0-9a-f]{2}:){5}[0-9a-f]{2}', endpoint.get('MacAddress') or '')",
  'ipv4.network.prefixlen == subnet.prefixlen',
  'ipv6.network.prefixlen == subnet.prefixlen',
  'ipv4.ip in subnet',
  'ipv6.ip in subnet',
])
  assert.ok(
    resumedHelper.includes(exactReplacementEndpointCheck),
    `resumed boundary lacks ${exactReplacementEndpointCheck}`,
  );
for (const serviceIdentityCheck of [
  'container_full_ids_for_service gateway',
  'container_full_ids_for_service bot',
  'container_full_ids_for_service beta-admission',
])
  assert.ok(
    script.includes(serviceIdentityCheck),
    `service identity is not enforced: ${serviceIdentityCheck}`,
  );
const acceptsReplacementAddressFixture = (ipv4, ipv6) =>
  /^172\.2[0-9]\.[0-9]{1,3}\.[0-9]{1,3}\/16$/u.test(ipv4) &&
  /^fd[0-9a-f]{2}:[0-9a-f:]+\/64$/u.test(ipv6);
assert.ok(acceptsReplacementAddressFixture('172.20.0.8/16', 'fd00:1234::8/64'));
for (const pair of [
  ['not-an-ip', 'fd00:1234::8/64'],
  ['172.20.0.8/24', 'fd00:1234::8/64'],
  ['10.0.0.8/16', 'fd00:1234::8/64'],
  ['172.20.0.8/16', '172.20.0.9/16'],
  ['172.20.0.8/16', 'fd00:1234::8/48'],
])
  assert.ok(
    !acceptsReplacementAddressFixture(...pair),
    `invalid endpoint address fixture accepted: ${pair}`,
  );

function workflowRunBlock(stepName) {
  const step = workflow.indexOf(`      - name: ${stepName}\n`);
  assert.ok(step >= 0, `missing workflow step ${stepName}`);
  const boundaries = [
    workflow.indexOf('\n      - name:', step + 1),
    workflow.indexOf('\n  connectivity:\n', step + 1),
  ].filter((index) => index > step);
  const next = Math.min(...boundaries);
  assert.ok(next > step, `unterminated workflow step ${stepName}`);
  const section = workflow.slice(step, next);
  const marker = section.indexOf('        run: |\n');
  assert.ok(marker >= 0, `missing run block for ${stepName}`);
  return section
    .slice(marker + '        run: |\n'.length)
    .split('\n')
    .map((line) => {
      assert.ok(line === '' || line.startsWith('          '), `bad run-block indent: ${line}`);
      return line.slice(10);
    })
    .join('\n');
}

function resolvePython() {
  const candidates = [
    process.env.FETANAGENT_TEST_PYTHON,
    process.platform === 'win32'
      ? join(
          process.env.USERPROFILE ?? '',
          '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
        )
      : '/usr/bin/python3',
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Python 3 is required for Owner archive fixtures');
}

function resolveBash() {
  const candidates = [
    process.env.FETANAGENT_TEST_BASH,
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
    'bash',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Bash is required for Owner archive recovery verification');
}

assert.equal(
  createHash('sha256').update(readFileSync(original)).digest('hex'),
  'b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9',
  'the immutable 001 Owner bridge changed',
);

for (const needle of [
  "readonly SOURCE_ATTESTATION_RELEASE='001316f1f65dc7a9976244e8fc01f90aec665a70'",
  "readonly SOURCE_ATTESTATION_INTENT_SHA256='36c59fee9df1e0ffcf311e8abba1bef22d17c3bf786b8ba2a2f3f34af14245ab'",
  "readonly SOURCE_OWNER_BRIDGE_SHA256='b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9'",
  "readonly SOURCE_OWNER_TAR_SHA256='4b6348d76bfef9553fbea799da381cd1b6b27e78237c97386c694d9c9305a80e'",
  "readonly SOURCE_OWNER_TAR_SIZE='405925888'",
  "readonly SOURCE_OWNER_IMAGE_ID='sha256:ce2cb11cb28cd1b16411a94dc6f9225aaa37877bb0de688578645c5d296b3ce3'",
  "readonly SOURCE_OWNER_LOADED_IMAGE_ID='sha256:45932c0e99318e305223bec96c166a82aa0330195e5cdd651c0b435756f7feeb'",
  "readonly SOURCE_OWNER_CLAIM_PARENT_DEV_INO='64769:6102879'",
  "readonly SOURCE_OWNER_CLAIM_ROOT_DEV_INO='64769:6102880'",
  "readonly PRIOR_FAILED_RECOVERY_RELEASE='911758fa1407093bee700918d5a663a7735f1658'",
  "readonly PRIOR_FAILED_RECOVERY_BUNDLE_PARENT_DEV_INO='64769:6102884'",
  "readonly PRIOR_FAILED_RECOVERY_BUNDLE_ROOT_DEV_INO='64769:6102885'",
  "readonly PRIOR_FAILED_RECOVERY_SCRIPT_DEV_INO='64769:6102886'",
  "readonly PRIOR_FAILED_RECOVERY_SCRIPT_SHA256='d3b61365d07325569089fab80415b595fa7a8b8486ae245fa4f6dcaa50ff5b9d'",
  "readonly PRIOR_FAILED_RECOVERY_SCRIPT_SIZE='151404'",
  "readonly PRIOR_FAILED_RECOVERY_VALIDATOR_DEV_INO='64769:6102887'",
  "readonly PRIOR_FAILED_RECOVERY_VALIDATOR_SHA256='6814f14708da844167b0f00a2b37c848eebb15eed64b7e1844f6bbeb0a9d36aa'",
  "readonly PRIOR_FAILED_RECOVERY_MANIFEST_DEV_INO='64769:6102888'",
  "readonly PRIOR_FAILED_RECOVERY_MANIFEST_SHA256='9c38e6fe7f5e24fd5309564fd0eda3a469794ab868718bc95ce65ecf64ac028a'",
  "readonly ORIGINAL_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge'",
  "readonly FAILED_CORRECTION_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery'",
  "readonly FAILED_PG_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-docker-inspect-tmpfs-correction'",
  "readonly FAILED_IMAGE_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-admin-pg-resolution-correction'",
  "readonly FAILED_CATALOG_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-oci-manifest-image-id-correction'",
  "readonly FAILED_OIDVECTOR_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-api-catalog-proof-correction'",
  "readonly FAILED_COMPOSE_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-oidvector-argument-correction'",
  "readonly FAILED_HOLDER_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-compose-create-flag-correction'",
  "readonly FAILED_ORDER_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-holder-inventory-parser-correction'",
  "readonly FAILED_ENDPOINT_PHASE_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-nofollow-definition-order-correction'",
  "readonly FAILED_RUNNING_STATUS_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-created-network-endpoint-phase-correction'",
  "readonly FAILED_COUNTER_BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-running-network-status-counter-correction'",
  "readonly BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-archive-recovery-customer-web-self-recovery-correction'",
  'env -i PATH="$SAFE_PATH" python3 -I "$STAGED_VALIDATOR"',
  '"$CLAIM_ROOT/$IMAGE_ARCHIVE_NAME" "$OWNER_IMAGE" "$OWNER_IMAGE_ID" oci 11 30',
  'archive_recovery_bundle_parent_dev_ino=',
  'archive_recovery_manifest_sha256=',
  'prior_failed_archive_recovery_runtime_ledger_absent=true',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'provider_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'money_moved=false',
]) {
  assert.ok(script.includes(needle), `recovery script is missing ${needle}`);
}
for (const needle of [
  "FAILED_CATALOG_CORRECTION_RELEASE='04f51a521280fed43cd1504107c702940e523688'",
  "FAILED_CATALOG_CORRECTION_BUNDLE_ROOT_DEV_INO='64769:6102909'",
  "FAILED_CATALOG_CORRECTION_SCRIPT_SHA256='6f2812be35d632c7b9d4430be0de21241b5ad9e57a9b61193d7d360c32bf6e36'",
  "FAILED_CATALOG_CORRECTION_MANIFEST_SHA256='c2502c5add54b0414d4e0e3d538554ec8e6057f5dbafc537ec8ed8f84a340dc1'",
  "FAILED_CATALOG_BRIDGE_PARENT_DEV_INO='64769:6102913'",
  "FAILED_CATALOG_BRIDGE_INSTALLING_DEV_INO='64769:6102914'",
  "FAILED_CATALOG_BRIDGE_INTENT_DEV_INO='64769:6102916'",
  "FAILED_CATALOG_BRIDGE_INTENT_SHA256='994082f6fb44d6c667f06c0382a677be5669cce273a62d7e60d6b730b3020799'",
  "FAILED_OIDVECTOR_CORRECTION_RELEASE='f67cf783528f090169dbea1ebfdc6c46f90996bb'",
  "FAILED_OIDVECTOR_CORRECTION_BUNDLE_ROOT_DEV_INO='64769:6102918'",
  "FAILED_OIDVECTOR_CORRECTION_SCRIPT_SHA256='440ed90b8c0987f7d94ab19f4b80513ef6bcf2984dd91c99d4d4caf27b0d077f'",
  "FAILED_OIDVECTOR_CORRECTION_MANIFEST_SHA256='8a6dcce2ec79854c47f028e630075073b5d35a6922048fce47aea91f745023ed'",
  "FAILED_OIDVECTOR_BRIDGE_PARENT_DEV_INO='64769:6102925'",
  "FAILED_OIDVECTOR_BRIDGE_INSTALLING_DEV_INO='64769:6102926'",
  "FAILED_OIDVECTOR_BRIDGE_INTENT_DEV_INO='64769:6102930'",
  "FAILED_OIDVECTOR_BRIDGE_INTENT_SHA256='7abf900b8fdf66e1c1d0b735afc25c10965b9cda9c26999e4fdfe01a1c0d80cd'",
  "FAILED_COMPOSE_CORRECTION_RELEASE='e95ad99122ebf9f7257ea25d7cf215dd38c73b40'",
  "FAILED_COMPOSE_CORRECTION_SCRIPT_SHA256='163d2adb74912daa8cb3663cefa5220a6e3f4766bd25a07f3bd13a31a077ef63'",
  "FAILED_COMPOSE_CORRECTION_MANIFEST_SHA256='fa1115800d977eedde7a5339414f689e9c65bc417ad5495db7c12a0353829ea1'",
  "FAILED_COMPOSE_BRIDGE_INTENT_SHA256='d8566a94851d3b53454b06ad308c71d85ac76c5478dfd5d967e40a17ec71a651'",
  "FAILED_COMPOSE_BRIDGE_API_PROOF_SHA256='868638d00d56bf4351a63cd4b1cfd48b95b79e9aa50cf330cc930d6b01c320ee'",
  "FAILED_HOLDER_CORRECTION_RELEASE='35d28aaa41cde5a2ccce7c2017dffc7c9d503238'",
  "FAILED_HOLDER_CORRECTION_SCRIPT_SHA256='f861a8106b454b43167d46a3dd55ef05a6d586c65ffc2142f90d7272b59f973f'",
  "FAILED_HOLDER_CORRECTION_MANIFEST_SHA256='3685d5197a39a1805970712eaeae24116fa8b6633f08434622d3e22864a759dd'",
  "FAILED_HOLDER_BRIDGE_INTENT_SHA256='2b80e49bd0aa3c3060ff09b8b2593f5caf57ea079e0d54a3f897a7317cfbfc6b'",
  "FAILED_HOLDER_BRIDGE_API_PROOF_SHA256='868638d00d56bf4351a63cd4b1cfd48b95b79e9aa50cf330cc930d6b01c320ee'",
  'holder_inventory_parser_contract=tab-preserving-exact-complete-v1',
  'for line in holders.splitlines():',
  "if line.count('\\t') != 1",
  'if set(holder_map) != volume_names',
  "FAILED_ORDER_CORRECTION_RELEASE='132603c34afff4e0e6c78d89864c761034c0f3fa'",
  "FAILED_ORDER_CORRECTION_SCRIPT_SHA256='dbea82dc71e3a61ce2c3392ad507eb952c1054c64c07f2145650f7aeac0d0e4e'",
  "FAILED_ORDER_CORRECTION_MANIFEST_SHA256='1cfa9ddba283f1b6ae053a420aaea0caa2af39791271cd6e936bb109b2f42c4f'",
  'failed_order_runtime_namespace=exact-absent',
  'nofollow_helper_definition_order=before-first-top-level-claim',
  "FAILED_ENDPOINT_PHASE_CORRECTION_RELEASE='51e5170488d720fd04decd1896971ab72cfe9603'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_BUNDLE_ROOT_DEV_INO='64769:6102952'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_SCRIPT_DEV_INO='64769:6102953'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_SCRIPT_SHA256='9cd67e0d820075fd8fac3bf6100ce26cfdc65f67540a8d086fcae8b2bf9f0ac8'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_SCRIPT_SIZE='262609'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_VALIDATOR_DEV_INO='64769:6102954'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_VALIDATOR_SHA256='6814f14708da844167b0f00a2b37c848eebb15eed64b7e1844f6bbeb0a9d36aa'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_MANIFEST_DEV_INO='64769:6102955'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_MANIFEST_SHA256='8c3682673339a7d57740b4890987932eee14013df0a6f05e50bda994cc5aaaac'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_MANIFEST_SIZE='12911'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_WORKFLOW_RUN_ID='33252232473'",
  "FAILED_ENDPOINT_PHASE_CORRECTION_WORKFLOW_RUN_ATTEMPT='1'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_PARENT_DEV_INO='64769:6102956'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_INSTALLING_DEV_INO='64769:6102957'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_INTENT_DEV_INO='64769:6102958'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_INTENT_SHA256='5eebab9353a3f251020a997706c2c1a85c00209f08ae83a1b32cf9b64e55d5fb'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_API_PROOF_DEV_INO='64769:6102959'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_API_PROOF_SHA256='868638d00d56bf4351a63cd4b1cfd48b95b79e9aa50cf330cc930d6b01c320ee'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_DOCKER_SNAPSHOT_DEV_INO='64769:6102960'",
  "FAILED_ENDPOINT_PHASE_BRIDGE_DOCKER_SNAPSHOT_SHA256='460926b641db4c4d5a09151fab780cf7ac215ead736c34c2b1bfb5422ae776c7'",
  "FAILED_RUNNING_STATUS_CORRECTION_RELEASE='8f1ef460a231fe2c21e2df2d986749400d08c38c'",
  "FAILED_RUNNING_STATUS_CORRECTION_BUNDLE_ROOT_DEV_INO='64769:6102961'",
  "FAILED_RUNNING_STATUS_CORRECTION_SCRIPT_DEV_INO='64769:6102962'",
  "FAILED_RUNNING_STATUS_CORRECTION_SCRIPT_SHA256='9cd020e2b79d5d53b5686f56ab9a291ae20af3ca700f581ec44f7b5eeb421d0e'",
  "FAILED_RUNNING_STATUS_CORRECTION_SCRIPT_SIZE='278033'",
  "FAILED_RUNNING_STATUS_CORRECTION_VALIDATOR_DEV_INO='64769:6102963'",
  "FAILED_RUNNING_STATUS_CORRECTION_MANIFEST_DEV_INO='64769:6102964'",
  "FAILED_RUNNING_STATUS_CORRECTION_MANIFEST_SHA256='b58fb16735c70bd4d7f9fd3022d675d11b4e815715fcb3e3804b55daa23364e5'",
  "FAILED_RUNNING_STATUS_BRIDGE_PARENT_DEV_INO='64769:6102965'",
  "FAILED_RUNNING_STATUS_BRIDGE_INSTALLING_DEV_INO='64769:6102966'",
  "FAILED_RUNNING_STATUS_BRIDGE_INTENT_DEV_INO='64769:6102967'",
  "FAILED_RUNNING_STATUS_BRIDGE_INTENT_SHA256='d02d6076765c789b45b1aa973183fc0c159a6e10c3b928927e7bee72de839e14'",
  "FAILED_RUNNING_STATUS_BRIDGE_API_PROOF_DEV_INO='64769:6102968'",
  "FAILED_RUNNING_STATUS_BRIDGE_API_PROOF_SHA256='868638d00d56bf4351a63cd4b1cfd48b95b79e9aa50cf330cc930d6b01c320ee'",
  "FAILED_RUNNING_STATUS_BRIDGE_DOCKER_SNAPSHOT_DEV_INO='64769:6102969'",
  "FAILED_RUNNING_STATUS_BRIDGE_DOCKER_SNAPSHOT_SHA256='460926b641db4c4d5a09151fab780cf7ac215ead736c34c2b1bfb5422ae776c7'",
  "FAILED_RUNNING_STATUS_BRIDGE_REPLACEMENT_DEV_INO='64769:6102970'",
  "FAILED_RUNNING_STATUS_BRIDGE_REPLACEMENT_SHA256='6e85eeb5e09ea7941bb5da4cf27890c37faa956ce81bf0d6e35c59d2c8066be1'",
  "FAILED_RUNNING_STATUS_BRIDGE_START_DEV_INO='64769:6102971'",
  "FAILED_RUNNING_STATUS_BRIDGE_START_SHA256='518341dc096934ce1166c68cb09b3ff727587bafa21e3e2e97ce36bc07d03a52'",
  "CREATED_OWNER_CONTAINER_ID='44040e1c0b94f574115b189571af6ca9c9c16cbe32d36cc0ac365654751eba1f'",
  'failed_endpoint_phase_owner_state=created-never-started',
  'compose_reentry=forbidden',
  'docker_endpoint_phase_contract=created-no-endpoint-running-one-owner-endpoint-v1',
  'failed_running_status_owner_state=running-healthy-no-completion',
  'docker_inventory_contract=complete-exact-owner-only-phase-delta-v3',
  'network_status_counter_contract=running-owner-dual-stack-plus-one-in-use-minus-one-available-v1',
  'owner_lifecycle_mutation=forbidden-already-running',
  'complete_phase_boundary_contract=single-final-phase-aware-command-v1',
  'emit_exact_nofollow_file() {',
  'os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW',
  'before != after',
  'os.path.realpath(path) != path',
  'capture_complete_docker_create_inventory() {',
  'require_exact_owner_inventory_delta_phase() {',
  'require_owner_endpoint_phase_boundary() {',
  'require_complete_owner_endpoint_phase_boundary() {',
  'require_exact_compose_create_contract() {',
  "compose version --short)\" == '5.1.4'",
  'owner.get("depends_on") not in (None, {})',
  "fs.readFileSync('/run/secrets/player_action_database_url'",
  "fs.existsSync('/run/secrets/owner_control_database_url')",
  "has_function_privilege(\n          'fetanagent_owner_control_runtime'",
  'not has_function_privilege(\n          current_user',
  "not has_function_privilege(\n          'public'",
  'role.rolconnlimit = 2',
  'role.rolconnlimit = 1',
  "await client.query('begin transaction read only')",
  "await client.query('rollback')",
  'publish_exact_record "$BRIDGE_WORK_ROOT/api-catalog-proof-v1"',
  'require_exact_api_catalog_container_contract() {',
  "config.get('Image') != f'fetanagent-api:{release[:12]}'",
  "config.get('Cmd') != ['node','apps/api/dist/index.js']",
  "'/run/secrets/owner_control_database_url' in destinations",
  'len(mounts) != 12',
  "len({m['Destination'] for m in mounts}) != 12",
  "(m['Type'],m['Source'],m['Mode'],m['RW'],m['Propagation'])",
  "source_root='/srv/fetanagent/secrets/staging'",
  "f'{source_root}/player-action-database-url','',False,'rprivate'",
  "f'{source_root}/api-action-capability-hmac','',False,'rprivate'",
  "f'{source_root}/cbe-deposit-reference-fingerprint-key','',False,'rprivate'",
  "f'{source_root}/deposit-proof-reference-fingerprint-master','',False,'rprivate'",
  "f'{source_root}/api-action-transport-hmac','',False,'rprivate'",
  "f'{source_root}/cbe-deposit-reference-key-profile.v1.json','',False,'rprivate'",
  "f'{source_root}/api-action-semantic-hmac','',False,'rprivate'",
  "f'{source_root}/cbe-deposit-reference-encryption-key','',False,'rprivate'",
  "f'{source_root}/deposit-proof-reference-encryption-master','',False,'rprivate'",
  "f'{source_root}/supabase-ca.crt','',False,'rprivate'",
  "f'{source_root}/api-action-payload-hmac','',False,'rprivate'",
  "f'{source_root}/deposit-proof-reference-profile.v2.json','',False,'rprivate'",
  "host.get('NetworkMode') != expected_network",
  "host.get('PublishAllPorts') is not False",
  "config.get('ExposedPorts') is not None",
  'select count(*) = 1',
  'select count(*) = 2',
  "count(*) filter (where grantee.rolname = 'postgres') = 1",
  "count(*) filter (where grantee.rolname = 'fetanagent_owner_control') = 1",
  'count(*) filter (where grantee.rolname is null) = 0',
  "p.proconfig = array['search_path=pg_catalog']::text[]",
  "p.prorettype = 'record'::regtype",
  "p.proargtypes = array['uuid'::regtype::oid, 'uuid'::regtype::oid, 'uuid'::regtype::oid]::oidvector",
  "privilege.privilege_type = 'EXECUTE'",
]) {
  assert.ok(script.includes(needle), `API catalog correction proof is missing ${needle}`);
}
const catalogProofStart = script.indexOf('require_migration_through_api_catalog()');
const catalogProofEnd = script.indexOf('\n}\n\nexpected_api_catalog_proof()', catalogProofStart);
const catalogProof = script.slice(catalogProofStart, catalogProofEnd);
assert.doesNotMatch(
  catalogProof,
  /p\.proargtypes::oid\[\]\s*=\s*array\[/u,
  'zero-based oidvector must not be cast to an array and compared with a one-based array',
);
const postgresArrayEqual = (left, right) =>
  left.lowerBound === right.lowerBound &&
  left.values.length === right.values.length &&
  left.values.every((value, index) => value === right.values[index]);
const oidvectorCast = { lowerBound: 0, values: [2950, 2950, 2950] };
const ordinaryArray = { lowerBound: 1, values: [2950, 2950, 2950] };
assert.ok(
  !postgresArrayEqual(oidvectorCast, ordinaryArray),
  'fixture must reproduce the zero-based oidvector versus one-based array trap',
);
assert.deepEqual(
  oidvectorCast.values,
  ordinaryArray.values,
  'oidvector equality alternative must compare the exact three ordered UUID OIDs',
);
const acceptsExactFunctionAcl = (rows) =>
  rows.length === 2 &&
  rows.filter(
    (row) =>
      row.grantee === 'postgres' &&
      row.grantor === 'postgres' &&
      row.privilege === 'EXECUTE' &&
      row.grantable === false,
  ).length === 1 &&
  rows.filter(
    (row) =>
      row.grantee === 'fetanagent_owner_control' &&
      row.grantor === 'postgres' &&
      row.privilege === 'EXECUTE' &&
      row.grantable === false,
  ).length === 1;
const exactFunctionAcl = [
  { grantee: 'postgres', grantor: 'postgres', privilege: 'EXECUTE', grantable: false },
  {
    grantee: 'fetanagent_owner_control',
    grantor: 'postgres',
    privilege: 'EXECUTE',
    grantable: false,
  },
];
assert.ok(acceptsExactFunctionAcl(exactFunctionAcl), 'exact function ACL fixture rejected');
for (const invalidAcl of [
  [exactFunctionAcl[0], exactFunctionAcl[0]],
  [exactFunctionAcl[1], exactFunctionAcl[1]],
  [exactFunctionAcl[0], { ...exactFunctionAcl[1], grantee: null }],
  [exactFunctionAcl[0], { ...exactFunctionAcl[1], grantee: 'PUBLIC' }],
  [exactFunctionAcl[0], { ...exactFunctionAcl[1], grantable: true }],
  [exactFunctionAcl[0], { ...exactFunctionAcl[1], grantor: 'other' }],
]) {
  assert.ok(
    !acceptsExactFunctionAcl(invalidAcl),
    `invalid function ACL fixture accepted: ${JSON.stringify(invalidAcl)}`,
  );
}
for (const forbidden of [
  /\bcall\b/iu,
  /\bdo\s+\$/iu,
  /\bset\s+role\b/iu,
  /\binsert\b/iu,
  /\bupdate\b/iu,
  /\bdelete\b/iu,
  /\btruncate\b/iu,
  /\balter\b/iu,
  /\bdrop\b/iu,
  /select\s+.+\s+from\s+app\./isu,
]) {
  assert.doesNotMatch(
    catalogProof,
    forbidden,
    `catalog proof contains forbidden operation ${forbidden}`,
  );
}

assert.equal((script.match(/^#!\/usr\/bin\/env bash$/gm) ?? []).length, 1);
const nofollowDefinition = script.indexOf('emit_exact_nofollow_file() {');
const priorClaimDefinition = script.indexOf('require_prior_failed_recovery_claim() {');
const priorClaimInvocation = script.indexOf(
  "require_prior_failed_recovery_claim ||\n  die 'the immutable failed 911 recovery bundle claim is not exact or the append-only chain is incomplete'",
);
assert.ok(nofollowDefinition >= 0 && nofollowDefinition < priorClaimDefinition);
assert.ok(priorClaimDefinition < priorClaimInvocation);
assert.equal((script.match(/emit_exact_nofollow_file\(\) \{/gu) ?? []).length, 1);
assert.ok(
  script.includes('[[ ! -e "$FAILED_ORDER_BRIDGE_PARENT" && ! -L "$FAILED_ORDER_BRIDGE_PARENT" ]]'),
);
const authorizedCustomerReplacementStart = script.indexOf('replace_customer_web_once() {');
const authorizedCustomerReplacementEnd = script.indexOf(
  '\n}\n',
  authorizedCustomerReplacementStart,
);
assert.ok(
  authorizedCustomerReplacementStart >= 0 &&
    authorizedCustomerReplacementEnd > authorizedCustomerReplacementStart,
);
const withoutAuthorizedCustomerReplacement =
  script.slice(0, authorizedCustomerReplacementStart) +
  script.slice(authorizedCustomerReplacementEnd + 3);
assert.ok(script.includes('docker_local image load --input "$STAGED_CUSTOMER_WEB_IMAGE_ARCHIVE"'));
assert.ok(
  script.includes('up --detach --no-deps --no-build --wait --wait-timeout 90 customer-web'),
);
assert.ok(script.includes('[[ "$state" == \'running|true|unhealthy\' ]]'));
assert.ok(script.includes('require_owner_never_restarted'));
assert.ok(script.includes("capture_non_owner_inventory | awk -F'|' '$2 != \"customer-web\"'"));
for (const forbiddenMutation of [
  /create --no-build/u,
  /\$\{compose_command\[@\]\}"\s+(?:create|up|down|rm|start|stop|restart)\b/u,
  /docker_local (?:container|network|image|volume) (?:start|create|rm|remove|restart|stop|kill|connect|disconnect|load|tag|prune)\b/u,
]) {
  assert.doesNotMatch(
    withoutAuthorizedCustomerReplacement,
    forbiddenMutation,
    `the correction must consume the exact created Owner without a Compose/container lifecycle mutation ${forbiddenMutation}`,
  );
}
assert.ok(
  script.includes(
    'publish_exact_record "$BRIDGE_WORK_ROOT/api-catalog-proof-v1" 0600 < <(expected_api_catalog_proof)',
  ),
  'the customer-web successor must publish a fresh exact read-only catalog proof',
);
assert.doesNotMatch(script, /36c59fee9df1e0ffcf311e8abba1bef22d17c3bf786b8ba2a2f3f34af14245'/);
assert.ok((script.match(/require_original_bridge_namespace_absent/g) ?? []).length >= 10);
assert.ok((script.match(/require_prior_failed_runtime_ledger_absent/g) ?? []).length >= 6);
assert.ok((script.match(/require_failed_endpoint_phase_runtime/g) ?? []).length >= 9);
assert.ok((script.match(/require_failed_running_status_runtime/g) ?? []).length >= 6);
for (const needle of [
  "FAILED_CORRECTION_RELEASE='ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b'",
  "FAILED_CORRECTION_BRIDGE_PARENT_DEV_INO='64769:6102893'",
  "FAILED_CORRECTION_BRIDGE_INSTALLING_DEV_INO='64769:6102894'",
  '! docker_local container inspect "$OLD_OWNER_CONTAINER_ID" >/dev/null 2>&1',
  "'/tmp': 'rw,noexec,nosuid,size=32m,mode=1777'",
  'owner_tmpfs_host_config=required-exact',
  'owner_inspect_mount_inventory=non-tmpfs-eight',
]) {
  assert.ok(script.includes(needle), `correction script is missing ${needle}`);
}
for (const needle of [
  "FAILED_IMAGE_CORRECTION_RELEASE='0a2adc0bf3591fe2449379ac2bf76c21538fadf5'",
  "FAILED_IMAGE_CORRECTION_BUNDLE_ROOT_DEV_INO='64769:6102902'",
  "FAILED_IMAGE_CORRECTION_SCRIPT_SHA256='338ad5f16d4761c9ce1d048eae5d7a38341aa5dee734a2a0c87cf47416564a6b'",
  "FAILED_IMAGE_CORRECTION_MANIFEST_SHA256='845d891088a30878e2162f050aa45f7110fadb9831c5bcd7dddd5cec2e3999d8'",
  "FAILED_IMAGE_BRIDGE_PARENT_DEV_INO='64769:6102906'",
  "FAILED_IMAGE_BRIDGE_INSTALLING_DEV_INO='64769:6102907'",
  "FAILED_IMAGE_BRIDGE_INTENT_DEV_INO='64769:6102908'",
  "FAILED_IMAGE_BRIDGE_INTENT_SHA256='89e94ea533e51d07747cb07324a309ce3cb47f32205c5a7631069fdcc1ad917b'",
  'source_owner_config_id=',
  'loaded_owner_manifest_image_id=',
  'oci_import_mapping=manifest-descriptor-id-with-exact-uncompressed-diffids',
  "docker_local version --format '{{.Server.Version}}|{{.Server.APIVersion}}|{{.Server.Os}}|{{.Server.Arch}}'",
  '\'overlayfs|[["driver-type","io.containerd.snapshotter.v1"]]|null\'',
  "image.get('Descriptor')",
  "image.get('RepoTags') != [expected_tag]",
  "image.get('RepoDigests')",
  "image.get('RootFS') != {'Type': 'layers', 'Layers': layers}",
  "image.get('Config') != config['config']",
  'require_loaded_image_unused() {',
  'require_loaded_image_used_only_by() {',
  'require_loaded_image_used_only_by "$NEW_OWNER_CONTAINER_ID"',
]) {
  assert.ok(script.includes(needle), `OCI import identity proof is missing ${needle}`);
}
assert.ok(
  !script.includes("expected_mounts['/tmp']"),
  'Docker tmpfs must not be conflated with inspect Mounts',
);
assert.ok(
  !script.includes('historical-absent'),
  'the disproved historical-absent mode must not survive',
);
assert.ok(
  !script.includes('tmpfs_mode'),
  'all Owner generations must use one exact tmpfs contract',
);
for (const needle of [
  "createRequire('/workspace/apps/api/dist/index.js')",
  "apiRequire.resolve('pg')",
  "'/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js'",
  "pgPackage.version !== '8.22.0'",
  "const { Client } = apiRequire('pg')",
  "typeof Client !== 'function'",
]) {
  assert.ok(script.includes(needle), `immutable admin pg resolution proof is missing ${needle}`);
}
assert.ok(
  !script.includes("const { Client } = require('pg')"),
  'stdin-relative pg resolution must not return',
);
for (const needle of [
  "FAILED_PG_CORRECTION_RELEASE='fa35244c8e8e2b9f10fe7abb2cd2341864b43471'",
  "FAILED_PG_BRIDGE_PARENT_DEV_INO='64769:6102899'",
  "FAILED_PG_BRIDGE_INSTALLING_DEV_INO='64769:6102900'",
  "FAILED_PG_BRIDGE_INTENT_DEV_INO='64769:6102901'",
  "FAILED_PG_BRIDGE_INTENT_SHA256='417ee01138b1bef14c6dd44646de66fb60584c439633794fcb02aa3974afae72'",
  'require_prior_failed_runtime_ledger_absent || return 1\n  require_non_owner_inventory_unchanged || return 1',
]) {
  assert.ok(script.includes(needle), `failed fa35244 evidence is missing ${needle}`);
}
const completeBoundaryStart = script.indexOf('require_complete_owner_endpoint_phase_boundary() {');
const completeBoundaryEnd = script.indexOf(
  '\n}\n\nrequire_running_owner_boundary_before_successor_intent()',
  completeBoundaryStart,
);
assert.ok(
  completeBoundaryStart >= 0 && completeBoundaryEnd > completeBoundaryStart,
  'complete phase-aware boundary helper is missing or unterminated',
);
const completeBoundary = script.slice(completeBoundaryStart, completeBoundaryEnd);
for (const helperConstituent of [
  'require_bridge_intent || return 1',
  'require_api_catalog_proof || return 1',
  'require_exact_recovery_source_anchors || return 1',
  'require_prior_failed_recovery_claim || return 1',
  'require_original_bridge_namespace_absent || return 1',
  'require_prior_failed_runtime_ledger_absent || return 1',
  'require_failed_endpoint_phase_runtime || return 1',
  'require_failed_running_status_runtime || return 1',
  'require_exact_droplet || return 1',
  'require_no_other_mutator_processes || return 1',
  'require_financial_gates_disabled || return 1',
  'require_owner_image_contract || return 1',
  'require_loaded_image_used_only_by "$NEW_OWNER_CONTAINER_ID" || return 1',
  'require_non_owner_inventory_unchanged || return 1',
  'load_pre_create_docker_inventory || return 1',
  'cmp -s -- "$BRIDGE_WORK_ROOT/docker-pre-create-v1" <(emit_exact_nofollow_file',
  'require_successor_endpoint_phase_boundary "$phase"',
]) {
  assert.ok(
    completeBoundary.includes(helperConstituent),
    `complete phase-boundary helper is missing ${helperConstituent}`,
  );
}
assert.match(
  completeBoundary,
  /require_successor_endpoint_phase_boundary "\$phase"\s*$/u,
  'the exact successor Docker delta must be the final constituent of the complete helper',
);
assert.ok(
  script.includes(
    'require_exact_owner_inventory_delta_phase "$before" "$normalized_after" "$new_owner" running',
  ),
  'successor comparison must normalize only the customer delta and reuse the full immutable Owner comparator',
);
const acceptsSuccessorDeltaFixture = ({
  addedImages,
  customerSwaps,
  extraEndpoint,
  statusDrift,
  volumeDrift,
  holderDrift,
}) =>
  addedImages === 1 &&
  customerSwaps === 1 &&
  !extraEndpoint &&
  !statusDrift &&
  !volumeDrift &&
  !holderDrift;
assert.ok(
  acceptsSuccessorDeltaFixture({
    addedImages: 1,
    customerSwaps: 1,
    extraEndpoint: false,
    statusDrift: false,
    volumeDrift: false,
    holderDrift: false,
  }),
  'exact customer image/endpoint successor fixture rejected',
);
for (const invalid of [
  {
    addedImages: 2,
    customerSwaps: 1,
    extraEndpoint: false,
    statusDrift: false,
    volumeDrift: false,
    holderDrift: false,
  },
  {
    addedImages: 1,
    customerSwaps: 2,
    extraEndpoint: false,
    statusDrift: false,
    volumeDrift: false,
    holderDrift: false,
  },
  {
    addedImages: 1,
    customerSwaps: 1,
    extraEndpoint: true,
    statusDrift: false,
    volumeDrift: false,
    holderDrift: false,
  },
  {
    addedImages: 1,
    customerSwaps: 1,
    extraEndpoint: false,
    statusDrift: true,
    volumeDrift: false,
    holderDrift: false,
  },
  {
    addedImages: 1,
    customerSwaps: 1,
    extraEndpoint: false,
    statusDrift: false,
    volumeDrift: true,
    holderDrift: false,
  },
  {
    addedImages: 1,
    customerSwaps: 1,
    extraEndpoint: false,
    statusDrift: false,
    volumeDrift: false,
    holderDrift: true,
  },
])
  assert.ok(
    !acceptsSuccessorDeltaFixture(invalid),
    `extra successor delta fixture accepted: ${JSON.stringify(invalid)}`,
  );
const classifyReplacementFixture = ({ source, replacements, exact, healthy }) => {
  if (source && replacements === 0) return 'source';
  if (!source && replacements === 0) return 'retry';
  if (!source && replacements === 1 && exact) return healthy ? 'complete' : 'retry';
  return 'reject';
};
assert.equal(
  classifyReplacementFixture({ source: false, replacements: 0, exact: false, healthy: false }),
  'retry',
);
assert.equal(
  classifyReplacementFixture({ source: false, replacements: 1, exact: true, healthy: false }),
  'retry',
);
assert.equal(
  classifyReplacementFixture({ source: false, replacements: 1, exact: true, healthy: true }),
  'complete',
);
assert.equal(
  classifyReplacementFixture({ source: true, replacements: 1, exact: true, healthy: false }),
  'reject',
);
assert.equal(
  (script.match(/require_complete_owner_endpoint_phase_boundary created/gu) ?? []).length,
  0,
  'the successor must never re-enter a created-phase execution path',
);
assert.equal(
  (script.match(/require_complete_owner_endpoint_phase_boundary running/gu) ?? []).length,
  3,
  'running phase must close on completed replay, pre-completion, and pre-finalization',
);
for (const guardedBoundary of [
  'require_complete_owner_endpoint_phase_boundary running ||\n  die \'the complete running-phase boundary changed before completion publication\'\npublish_exact_record "$BRIDGE_WORK_ROOT/completed-v1"',
  'require_complete_owner_endpoint_phase_boundary running ||\n  die \'the complete running-phase boundary changed before ledger finalization\'\nmv -- "$BRIDGE_INSTALLING" "$BRIDGE_ROOT"',
]) {
  assert.ok(
    script.includes(guardedBoundary),
    `missing, reordered, or interposed complete endpoint-phase boundary ${guardedBoundary}`,
  );
}
const acceptsAtomicBoundaryCommands = (commands, phase, target) =>
  JSON.stringify(commands) === JSON.stringify([`complete:${phase}`, target]);
assert.ok(
  acceptsAtomicBoundaryCommands(
    ['complete:running', 'publish:completion'],
    'running',
    'publish:completion',
  ),
);
for (const invalidCommands of [
  ['phase:running', 'post-image', 'publish:completion'],
  ['complete:running', 'financial-check', 'publish:completion'],
  ['complete:running', 'inspect', 'rename:ledger'],
  ['complete:running', 'publish:completion', 'rename:ledger'],
]) {
  assert.ok(
    !acceptsAtomicBoundaryCommands(invalidCommands, 'running', 'publish:completion'),
    `an interposed or split boundary fixture was accepted: ${JSON.stringify(invalidCommands)}`,
  );
}
for (const finalizationGuard of [
  "require_exact_recovery_source_anchors || die 'an immutable 001 terminal or Owner bundle source anchor changed before ledger finalization'",
  "require_original_bridge_namespace_absent || die 'the immutable 001 Owner bridge namespace appeared before ledger finalization'",
  "require_prior_failed_runtime_ledger_absent || die 'the chained failed runtime evidence changed before ledger finalization'",
  "require_financial_gates_disabled || die 'a financial, executor, provider, Amount, or Transfer gate changed before ledger finalization'",
  "require_no_other_mutator_processes || die 'another staging mutation appeared before ledger finalization'",
  "require_exact_droplet || die 'the staging Droplet identity changed before ledger finalization'",
]) {
  const guardIndex = script.indexOf(finalizationGuard);
  const renameIndex = script.indexOf('mv -- "$BRIDGE_INSTALLING" "$BRIDGE_ROOT"');
  assert.ok(
    guardIndex >= 0 && guardIndex < renameIndex,
    `missing finalization guard ${finalizationGuard}`,
  );
}
assert.equal(
  (script.match(/docker_local image load --input "\$STAGED_CUSTOMER_WEB_IMAGE_ARCHIVE"/gu) ?? [])
    .length,
  1,
  'the successor must import exactly one attested customer-web archive',
);
assert.ok(!script.includes('image tag '), 'the chained correction must never retag an image');
assert.ok(!script.includes('image rm '), 'the chained correction must never remove an image');
assert.ok(!script.includes('image prune'), 'the chained correction must never prune images');
const exactTmpfs = { '/tmp': 'rw,noexec,nosuid,size=32m,mode=1777' };
const acceptsTmpfs = (observed, mountDestinations) =>
  JSON.stringify(observed) === JSON.stringify(exactTmpfs) &&
  mountDestinations.length === 8 &&
  !mountDestinations.includes('/tmp');
const eightMounts = Array.from({ length: 8 }, (_, index) => `/non-tmpfs-${index}`);
assert.ok(acceptsTmpfs(exactTmpfs, eightMounts), 'H13 exact HostConfig.Tmpfs fixture rejected');
assert.ok(acceptsTmpfs(exactTmpfs, eightMounts), 'H14 exact HostConfig.Tmpfs fixture rejected');
for (const [tmpfs, mounts] of [
  [null, eightMounts],
  [{}, eightMounts],
  [{ '/tmp': 'rw,noexec,nosuid,size=64m,mode=1777' }, eightMounts],
  [{ ...exactTmpfs, '/extra': 'rw' }, eightMounts],
  [exactTmpfs, [...eightMounts, '/tmp']],
]) {
  assert.ok(
    !acceptsTmpfs(tmpfs, mounts),
    `invalid tmpfs fixture accepted: ${JSON.stringify(tmpfs)}`,
  );
}

const executionStart = script.indexOf(
  "create_or_discover_bridge_ledger || die 'the separate Owner-runtime bridge ledger is unsafe'",
);
assert.ok(executionStart >= 0, 'missing recovery ledger discovery');
const execution = script.slice(executionStart);
const intentPublish = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/intent-v1" 0600 < <(expected_bridge_intent)',
);
const postIntentValidation = execution.indexOf(
  "require_bridge_intent || die 'the published Owner-runtime bridge intent is invalid'",
);
const customerReplacementPublish = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/customer-web-replacement-v1" 0600',
);
const republishedProof = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/api-catalog-proof-v1" 0600 < <(expected_api_catalog_proof)',
);
const republishedSnapshot = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/docker-pre-create-v1" 0600 < <(emit_exact_nofollow_file',
);
const exactSnapshotComparison = execution.indexOf(
  'cmp -s -- "$BRIDGE_WORK_ROOT/docker-pre-create-v1" <(emit_exact_nofollow_file',
);
const replacementPublish = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/replacement-owner-v1" 0600 < <(emit_exact_nofollow_file',
);
const startIntentPublish = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/start-owner-v1" 0600 < <(emit_exact_nofollow_file',
);
const completionPublish = execution.indexOf(
  'publish_exact_record "$BRIDGE_WORK_ROOT/completed-v1" 0600 < <(expected_bridge_completed)',
);
assert.ok(intentPublish > 0, 'intent is not published');
assert.ok(postIntentValidation > intentPublish, 'intent is not validated after publication');
assert.ok(
  customerReplacementPublish > postIntentValidation,
  'customer replacement record must follow durable intent',
);
assert.ok(
  republishedProof > customerReplacementPublish,
  'fresh read-only proof must follow customer replacement',
);
assert.ok(
  republishedSnapshot > republishedProof && exactSnapshotComparison > republishedSnapshot,
  'the exact 8f pre-create snapshot is not durably republished and byte-compared after the proof',
);
assert.ok(
  replacementPublish > exactSnapshotComparison && startIntentPublish > replacementPublish,
  'replacement identity and start authorization must follow the immutable 8f proof/snapshot publication',
);
assert.ok(
  completionPublish > startIntentPublish,
  'completion must follow all four exact predecessor record republications',
);
assert.equal(
  (execution.match(/require_complete_owner_endpoint_phase_boundary running/gu) ?? []).length,
  3,
  'the execution must use only the three closed already-running boundaries',
);
assert.ok(
  execution.includes('NEW_OWNER_CONTAINER_ID="$CREATED_OWNER_CONTAINER_ID"'),
  'the successor must bind the exact already-running Owner identity',
);
const executionWithoutAuthorizedCustomerReplacement = execution.replace(
  script.slice(authorizedCustomerReplacementStart, authorizedCustomerReplacementEnd + 3),
  '',
);
assert.doesNotMatch(
  executionWithoutAuthorizedCustomerReplacement,
  /docker_local (?:container|image|network|volume) (?:start|create|rm|remove|restart|stop|kill|prune|connect|disconnect)|\$\{compose_command\[@\]\}"\s+(?:create|up|down|rm|start|stop|restart)\b/u,
  'outside the exact customer-web replacement, the successor must contain no reachable lifecycle mutation',
);
assert.ok(
  execution.includes(
    'require_running_owner_boundary_before_successor_intent ||\n    die \'the exact already-running Owner boundary changed before successor intent publication\'\n  publish_exact_record "$BRIDGE_WORK_ROOT/intent-v1"',
  ),
  'the complete pre-intent running boundary must be adjacent to intent publication',
);

const acceptsNofollowEvidence = (entry) =>
  entry.type === 'file' &&
  entry.symlink === false &&
  entry.realpathExact === true &&
  entry.fdStable === true &&
  entry.mode === 0o600 &&
  entry.nlink === 1 &&
  entry.hashExact === true;
const exactEvidence = {
  type: 'file',
  symlink: false,
  realpathExact: true,
  fdStable: true,
  mode: 0o600,
  nlink: 1,
  hashExact: true,
};
assert.ok(acceptsNofollowEvidence(exactEvidence));
for (const invalid of [
  { ...exactEvidence, symlink: true },
  { ...exactEvidence, type: 'directory' },
  { ...exactEvidence, realpathExact: false },
  { ...exactEvidence, fdStable: false },
  { ...exactEvidence, nlink: 2 },
  { ...exactEvidence, hashExact: false },
])
  assert.ok(
    !acceptsNofollowEvidence(invalid),
    `unsafe predecessor evidence accepted: ${JSON.stringify(invalid)}`,
  );

const exactOwnerEndpoint = {
  Name: 'fetanagent-staging-beta-owner-control-1',
  EndpointID: 'a'.repeat(64),
  MacAddress: '02:42:ac:12:00:02',
  IPv4Address: '172.18.0.2/16',
  IPv6Address: 'fd00::2/64',
};
const exactStatusBefore = {
  IPAM: {
    Subnets: {
      '172.18.0.0/16': { IPsInUse: 5, DynamicIPsAvailable: 65531 },
      'fd00::/64': { IPsInUse: 4, DynamicIPsAvailable: 18446744073709551612n },
    },
  },
};
const exactStatusRunning = {
  IPAM: {
    Subnets: {
      '172.18.0.0/16': { IPsInUse: 6, DynamicIPsAvailable: 65530 },
      'fd00::/64': { IPsInUse: 5, DynamicIPsAvailable: 18446744073709551611n },
    },
  },
};
const sameStatus = (left, right) =>
  JSON.stringify(left, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)) ===
  JSON.stringify(right, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
const stringifyStatusFixture = (value) =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
const acceptsStatusPhaseDelta = (phase, before, after) => {
  if (phase === 'created') return sameStatus(before, after);
  if (phase !== 'running') return false;
  if (
    !before ||
    !after ||
    JSON.stringify(Object.keys(before)) !== JSON.stringify(['IPAM']) ||
    JSON.stringify(Object.keys(after)) !== JSON.stringify(['IPAM']) ||
    JSON.stringify(Object.keys(before.IPAM)) !== JSON.stringify(['Subnets']) ||
    JSON.stringify(Object.keys(after.IPAM)) !== JSON.stringify(['Subnets'])
  )
    return false;
  const oldSubnets = before.IPAM.Subnets;
  const newSubnets = after.IPAM.Subnets;
  if (!sameStatus(Object.keys(oldSubnets), Object.keys(newSubnets))) return false;
  const changed = new Set(['172.18.0.0/16', 'fd00::/64']);
  if (![...changed].every((subnet) => Object.hasOwn(oldSubnets, subnet))) return false;
  return Object.keys(oldSubnets).every((subnet) => {
    const oldValue = oldSubnets[subnet];
    const newValue = newSubnets[subnet];
    if (
      !oldValue ||
      !newValue ||
      !sameStatus(Object.keys(oldValue).sort(), ['DynamicIPsAvailable', 'IPsInUse']) ||
      !sameStatus(Object.keys(newValue).sort(), ['DynamicIPsAvailable', 'IPsInUse'])
    )
      return false;
    return changed.has(subnet)
      ? newValue.IPsInUse === oldValue.IPsInUse + 1 &&
          newValue.DynamicIPsAvailable ===
            (typeof oldValue.DynamicIPsAvailable === 'bigint'
              ? oldValue.DynamicIPsAvailable - 1n
              : oldValue.DynamicIPsAvailable - 1)
      : sameStatus(oldValue, newValue);
  });
};
const acceptsOwnerOnlyPhaseDelta = ({
  phase = 'created',
  imagesSame = true,
  networkIdsSame = true,
  volumeIdsSame = true,
  specsSame = true,
  oldEndpointsSame = true,
  addedEndpointIds = phase === 'running' ? ['owner'] : [],
  ownerEndpoint = phase === 'running' ? exactOwnerEndpoint : null,
  statusBefore = exactStatusBefore,
  statusAfter = phase === 'running' ? exactStatusRunning : exactStatusBefore,
  profileHolders = [[], []],
  controlHolders = [[], ['owner']],
  otherHoldersSame = true,
} = {}) =>
  ['created', 'running'].includes(phase) &&
  imagesSame &&
  networkIdsSame &&
  volumeIdsSame &&
  specsSame &&
  oldEndpointsSame &&
  acceptsStatusPhaseDelta(phase, statusBefore, statusAfter) &&
  (phase === 'created'
    ? addedEndpointIds.length === 0 && ownerEndpoint === null
    : JSON.stringify(addedEndpointIds) === JSON.stringify(['owner']) &&
      JSON.stringify(ownerEndpoint) === JSON.stringify(exactOwnerEndpoint)) &&
  JSON.stringify(profileHolders) === JSON.stringify([[], []]) &&
  JSON.stringify(controlHolders) === JSON.stringify([[], ['owner']]) &&
  otherHoldersSame;
assert.ok(acceptsOwnerOnlyPhaseDelta({ phase: 'created' }), 'exact created-phase delta rejected');
assert.ok(acceptsOwnerOnlyPhaseDelta({ phase: 'running' }), 'exact running-phase delta rejected');
for (const invalid of [
  { phase: 'invalid' },
  { networkIdsSame: false },
  { volumeIdsSame: false },
  { imagesSame: false },
  { specsSame: false },
  { oldEndpointsSame: false },
  { phase: 'created', addedEndpointIds: ['owner'], ownerEndpoint: exactOwnerEndpoint },
  { phase: 'running', addedEndpointIds: [], ownerEndpoint: null },
  { phase: 'running', addedEndpointIds: ['owner', 'extra'] },
  { phase: 'running', addedEndpointIds: ['wrong'], ownerEndpoint: exactOwnerEndpoint },
  { phase: 'running', ownerEndpoint: { ...exactOwnerEndpoint, Name: 'wrong-owner' } },
  { phase: 'running', ownerEndpoint: { ...exactOwnerEndpoint, EndpointID: 'bad' } },
  { phase: 'running', ownerEndpoint: { ...exactOwnerEndpoint, Unexpected: true } },
  { phase: 'created', statusAfter: exactStatusRunning },
  {
    phase: 'running',
    statusAfter: {
      IPAM: {
        Subnets: {
          ...exactStatusRunning.IPAM.Subnets,
          'extra/24': { IPsInUse: 1, DynamicIPsAvailable: 1 },
        },
      },
    },
  },
  {
    phase: 'running',
    statusAfter: {
      IPAM: {
        Subnets: {
          ...exactStatusRunning.IPAM.Subnets,
          '172.18.0.0/16': { IPsInUse: 7, DynamicIPsAvailable: 65530 },
        },
      },
    },
  },
  {
    phase: 'running',
    statusAfter: {
      IPAM: {
        Subnets: {
          ...exactStatusRunning.IPAM.Subnets,
          'fd00::/64': { IPsInUse: 5, DynamicIPsAvailable: 18446744073709551612n },
        },
      },
    },
  },
  { phase: 'running', statusAfter: { ...exactStatusRunning, Unexpected: true } },
  { profileHolders: [[], ['owner']] },
  { controlHolders: [[], ['other']] },
  { controlHolders: [[], ['owner', 'extra']] },
  { otherHoldersSame: false },
])
  assert.ok(
    !acceptsOwnerOnlyPhaseDelta(invalid),
    `unsafe phase-aware Docker delta accepted: ${stringifyStatusFixture(invalid)}`,
  );

const parseHolderRows = (text, expectedVolumes) => {
  const result = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (line === '') continue;
    if ((line.match(/\t/gu) ?? []).length !== 1) throw new Error('malformed');
    const [name, ids] = line.split('\t');
    if (!name || result.has(name)) throw new Error('duplicate');
    const values = ids === '' ? [] : ids.split(',');
    if (
      values.some((value) => !/^[0-9a-f]{64}$/u.test(value)) ||
      JSON.stringify(values) !== JSON.stringify([...new Set(values)].sort())
    )
      throw new Error('ids');
    result.set(name, values);
  }
  if (JSON.stringify([...result.keys()].sort()) !== JSON.stringify([...expectedVolumes].sort()))
    throw new Error('missing');
  return result;
};
const emptyLastHolder = 'control\t' + 'a'.repeat(64) + '\nprofile\t\n';
assert.deepEqual([...parseHolderRows(emptyLastHolder, ['control', 'profile']).get('profile')], []);
for (const invalid of [
  'control\nprofile\t\n',
  'control\t\ncontrol\t\nprofile\t\n',
  'control\t\n',
  'control\tbad\nprofile\t\n',
  `control\t${'b'.repeat(64)},${'a'.repeat(64)}\nprofile\t\n`,
])
  assert.throws(() => parseHolderRows(invalid, ['control', 'profile']));

for (const needle of [
  'h14-owner-runtime-bridge-archive-recovery-stage:',
  'git fetch --no-tags --depth=1 origin 001316f1f65dc7a9976244e8fc01f90aec665a70',
  'git fetch --no-tags --depth=1 origin 911758fa1407093bee700918d5a663a7735f1658',
  'git fetch --no-tags --depth=1 origin ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b',
  'git fetch --no-tags --depth=1 origin 0a2adc0bf3591fe2449379ac2bf76c21538fadf5',
  'git fetch --no-tags --depth=1 origin 04f51a521280fed43cd1504107c702940e523688',
  'git fetch --no-tags --depth=1 origin 51e5170488d720fd04decd1896971ab72cfe9603',
  'git fetch --no-tags --depth=1 origin 8f1ef460a231fe2c21e2df2d986749400d08c38c',
  'contract=fetanagent-h14-owner-runtime-bridge-archive-recovery-bundle',
  'failed_owner_bridge_implementation_sha=001316f1f65dc7a9976244e8fc01f90aec665a70',
  'failed_owner_bridge_script_sha256=b064970bd3b580df14bdb1d9bf5efef2c72c7082b8fe1b76d459df4ef648bea9',
  'prior_failed_recovery_implementation_sha=911758fa1407093bee700918d5a663a7735f1658',
  'prior_failed_recovery_bundle_parent_dev_ino=64769:6102884',
  'prior_failed_recovery_bundle_root_dev_ino=64769:6102885',
  'prior_failed_recovery_script_dev_ino=64769:6102886',
  'prior_failed_recovery_script_sha256=d3b61365d07325569089fab80415b595fa7a8b8486ae245fa4f6dcaa50ff5b9d',
  'prior_failed_archive_validator_dev_ino=64769:6102887',
  'prior_failed_archive_validator_sha256=6814f14708da844167b0f00a2b37c848eebb15eed64b7e1844f6bbeb0a9d36aa',
  'prior_failed_recovery_manifest_dev_ino=64769:6102888',
  'prior_failed_recovery_manifest_sha256=9c38e6fe7f5e24fd5309564fd0eda3a469794ab868718bc95ce65ecf64ac028a',
  'failed_correction_implementation_sha=ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b',
  'failed_correction_manifest_sha256=1431f2148bda24dd18bc8cf3441f84fc2cad021be9d49e6ff33e8796ca60508d',
  'failed_correction_bridge_parent_dev_ino=64769:6102893',
  'failed_correction_bridge_installing_dev_ino=64769:6102894',
  'failed_pg_correction_implementation_sha=fa35244c8e8e2b9f10fe7abb2cd2341864b43471',
  'failed_pg_correction_manifest_sha256=ff2e34b97ba5dfaa8228e920ca0290ab9298b43601da94e2477a63047da77f5d',
  'failed_pg_bridge_intent_sha256=417ee01138b1bef14c6dd44646de66fb60584c439633794fcb02aa3974afae72',
  'admin_pg_resolution=exact-create-require-admin-dist-pg-8.22.0',
  'failed_image_correction_implementation_sha=0a2adc0bf3591fe2449379ac2bf76c21538fadf5',
  'failed_image_correction_manifest_sha256=845d891088a30878e2162f050aa45f7110fadb9831c5bcd7dddd5cec2e3999d8',
  'failed_image_bridge_intent_sha256=89e94ea533e51d07747cb07324a309ce3cb47f32205c5a7631069fdcc1ad917b',
  'failed_catalog_correction_implementation_sha=04f51a521280fed43cd1504107c702940e523688',
  'failed_catalog_bridge_intent_sha256=994082f6fb44d6c667f06c0382a677be5669cce273a62d7e60d6b730b3020799',
  'failed_oidvector_correction_implementation_sha=f67cf783528f090169dbea1ebfdc6c46f90996bb',
  'failed_oidvector_correction_manifest_sha256=8a6dcce2ec79854c47f028e630075073b5d35a6922048fce47aea91f745023ed',
  'failed_oidvector_bridge_intent_sha256=7abf900b8fdf66e1c1d0b735afc25c10965b9cda9c26999e4fdfe01a1c0d80cd',
  'failed_endpoint_phase_correction_implementation_sha=51e5170488d720fd04decd1896971ab72cfe9603',
  'failed_endpoint_phase_correction_bundle_root_dev_ino=64769:6102952',
  'failed_endpoint_phase_correction_script_dev_ino=64769:6102953',
  'failed_endpoint_phase_correction_script_sha256=9cd67e0d820075fd8fac3bf6100ce26cfdc65f67540a8d086fcae8b2bf9f0ac8',
  'failed_endpoint_phase_correction_script_size=262609',
  'failed_endpoint_phase_correction_validator_dev_ino=64769:6102954',
  'failed_endpoint_phase_correction_manifest_dev_ino=64769:6102955',
  'failed_endpoint_phase_correction_manifest_sha256=8c3682673339a7d57740b4890987932eee14013df0a6f05e50bda994cc5aaaac',
  'failed_endpoint_phase_bridge_parent_dev_ino=64769:6102956',
  'failed_endpoint_phase_bridge_installing_dev_ino=64769:6102957',
  'failed_endpoint_phase_bridge_intent_dev_ino=64769:6102958',
  'failed_endpoint_phase_bridge_intent_sha256=5eebab9353a3f251020a997706c2c1a85c00209f08ae83a1b32cf9b64e55d5fb',
  'failed_endpoint_phase_bridge_api_proof_dev_ino=64769:6102959',
  'failed_endpoint_phase_bridge_api_proof_sha256=868638d00d56bf4351a63cd4b1cfd48b95b79e9aa50cf330cc930d6b01c320ee',
  'failed_endpoint_phase_bridge_docker_snapshot_dev_ino=64769:6102960',
  'failed_endpoint_phase_bridge_docker_snapshot_sha256=460926b641db4c4d5a09151fab780cf7ac215ead736c34c2b1bfb5422ae776c7',
  'failed_running_status_correction_implementation_sha=8f1ef460a231fe2c21e2df2d986749400d08c38c',
  'failed_running_status_correction_bundle_root_dev_ino=64769:6102961',
  'failed_running_status_correction_script_dev_ino=64769:6102962',
  'failed_running_status_correction_script_sha256=9cd020e2b79d5d53b5686f56ab9a291ae20af3ca700f581ec44f7b5eeb421d0e',
  'failed_running_status_correction_manifest_dev_ino=64769:6102964',
  'failed_running_status_correction_manifest_sha256=b58fb16735c70bd4d7f9fd3022d675d11b4e815715fcb3e3804b55daa23364e5',
  'failed_running_status_bridge_parent_dev_ino=64769:6102965',
  'failed_running_status_bridge_installing_dev_ino=64769:6102966',
  'failed_running_status_bridge_intent_dev_ino=64769:6102967',
  'failed_running_status_bridge_intent_sha256=d02d6076765c789b45b1aa973183fc0c159a6e10c3b928927e7bee72de839e14',
  'failed_running_status_bridge_api_proof_dev_ino=64769:6102968',
  'failed_running_status_bridge_docker_snapshot_dev_ino=64769:6102969',
  'failed_running_status_bridge_replacement_dev_ino=64769:6102970',
  'failed_running_status_bridge_replacement_sha256=6e85eeb5e09ea7941bb5da4cf27890c37faa956ce81bf0d6e35c59d2c8066be1',
  'failed_running_status_bridge_start_dev_ino=64769:6102971',
  'failed_running_status_bridge_start_sha256=518341dc096934ce1166c68cb09b3ff727587bafa21e3e2e97ce36bc07d03a52',
  'created_owner_container_id=44040e1c0b94f574115b189571af6ca9c9c16cbe32d36cc0ac365654751eba1f',
  'failed_endpoint_phase_owner_state=created-never-started',
  'compose_reentry=forbidden',
  'docker_endpoint_phase_contract=created-no-endpoint-running-one-owner-endpoint-v1',
  'failed_running_status_owner_state=running-healthy-no-completion',
  'docker_inventory_contract=complete-exact-owner-only-phase-delta-v3',
  'network_status_counter_contract=running-owner-dual-stack-plus-one-in-use-minus-one-available-v1',
  'owner_lifecycle_mutation=forbidden-already-running',
  'complete_phase_boundary_contract=single-final-phase-aware-command-v1',
  'catalog_argument_contract=exact-zero-based-oidvector-equality',
  'canonical_h14_image_initial_state=exact-loaded-before-intent',
  'owner_tmpfs_host_config=required-exact',
  'owner_inspect_mount_inventory=non-tmpfs-eight',
  'archive_encoding=oci',
  'archive_layer_count=11',
  'archive_member_count=30',
  'claim_one() {',
  '.installing-$CONFIRMED_RECOVERY_RELEASE',
  "exec bash '$script' '$CONFIRMED_RECOVERY_RELEASE' '$SCRIPT_SHA' '$VALIDATOR_SHA' '$MANIFEST_SHA' 'a579e3bf96c075dde9c36dbe3c66c09aaf84bc52' '$H14_RECOVERY_AUTHORIZATION_SHA256'",
]) {
  assert.ok(workflow.includes(needle), `workflow is missing ${needle}`);
}

const rootEmission = workflowRunBlock('Emit exact root-console invocation without execution');
const preExec020Rehash = rootEmission.lastIndexOf(
  '# Rehash the exact 020 bundle and empty runtime immediately before execution.',
);
const finalExec = rootEmission.lastIndexOf("exec bash '$script'");
assert.ok(
  preExec020Rehash >= 0 && finalExec > preExec020Rehash,
  'exact 020 evidence is not rehashed immediately before execution',
);
assert.ok(rootEmission.slice(preExec020Rehash, finalExec).includes('6102977:root:root:700:2'));
assert.ok(
  rootEmission
    .slice(preExec020Rehash, finalExec)
    .includes('25b5f8e1a6b9fd9c853bbf6f6290b1c516329c85ef5bb57155bae503e1f85d67'),
);
for (const state of [
  '"$(basename "$prior_root")" "$(basename "$failed_root")"',
  '"$(basename "$failed_root")" "$(basename "$failed_pg_root")"',
  '"$(basename "$failed_pg_root")" "$(basename "$failed_image_root")"',
  '"$(basename "$failed_image_root")" "$(basename "$failed_catalog_root")"',
  '"$(basename "$failed_catalog_root")" "$(basename "$failed_oidvector_root")"',
  '"$(basename "$failed_oidvector_root")" "$(basename "$failed_compose_root")"',
  '"$(basename "$failed_compose_root")" "$(basename "$failed_holder_root")"',
  '"$(basename "$failed_holder_root")" "$(basename "$failed_order_root")"',
  '"$(basename "$failed_order_root")" "$(basename "$failed_endpoint_phase_root")"',
  '"$(basename "$failed_endpoint_phase_root")" "$(basename "$failed_running_status_root")"',
  '"$(basename "$failed_running_status_root")" "$(basename "$failed_counter_root")"',
  '"$(basename "$failed_counter_root")" "$(basename "$installing")"',
  '"$(basename "$failed_counter_root")" "$(basename "$root")"',
]) {
  assert.ok(rootEmission.includes(state), `missing two-claim interruption state ${state}`);
}
assert.ok(
  !rootEmission.includes('if [[ ! -e "$parent" && ! -L "$parent" ]]'),
  'the chained claim must never create or replace the existing 911 parent',
);
for (const finalIdentityGuard of [
  "require_customer_web_replacement_record || die 'the finalized customer-web replacement record is invalid'",
  "require_owner_never_restarted || die 'Owner lifecycle changed before final immutable verification'",
  "require_other_service_inventory_exact || die 'a non-customer service changed before final immutable verification'",
  "require_failed_counter_runtime || die 'the immutable 020 empty pre-intent evidence changed during finalization'",
  "require_financial_gates_disabled || die 'a financial, executor, provider, Amount, or Transfer gate changed during finalization'",
  'Owner unchanged; customer-web only; all financial gates disabled; no provider action and no money moved.',
])
  assert.ok(
    script.includes(finalIdentityGuard),
    `missing final no-money identity guard ${finalIdentityGuard}`,
  );
assert.ok(
  rootEmission.indexOf('64769:6102885:root:root:700') <
    rootEmission.indexOf("claim_one '$REMOTE_BUNDLE/"),
  'the prior claim must be proved before appending the new claim',
);

const prior = '911758fa1407093bee700918d5a663a7735f1658';
const failed = 'ff989bc5e1a0488ffa34bfa7c2c49ec3225bc51b';
const failedPg = 'fa35244c8e8e2b9f10fe7abb2cd2341864b43471';
const failedImage = '0a2adc0bf3591fe2449379ac2bf76c21538fadf5';
const failedCatalog = '04f51a521280fed43cd1504107c702940e523688';
const failedOidvector = 'f67cf783528f090169dbea1ebfdc6c46f90996bb';
const failedCompose = 'e95ad99122ebf9f7257ea25d7cf215dd38c73b40';
const failedHolder = '35d28aaa41cde5a2ccce7c2017dffc7c9d503238';
const failedOrder = '132603c34afff4e0e6c78d89864c761034c0f3fa';
const failedEndpointPhase = '51e5170488d720fd04decd1896971ab72cfe9603';
const failedRunningStatus = '8f1ef460a231fe2c21e2df2d986749400d08c38c';
const failedCounter = '0202304e3c606d2a7927a5b027d76926c0117189';
const current = '0123456789abcdef0123456789abcdef01234567';
const installing = `.installing-${current}`;
const classifyChain = (children) => {
  const exact = [...children].sort().join('\n');
  if (
    exact ===
    [
      prior,
      failed,
      failedPg,
      failedImage,
      failedCatalog,
      failedOidvector,
      failedCompose,
      failedHolder,
      failedOrder,
      failedEndpointPhase,
      failedRunningStatus,
      failedCounter,
    ]
      .sort()
      .join('\n')
  )
    return 'append';
  if (
    exact ===
    [
      prior,
      failed,
      failedPg,
      failedImage,
      failedCatalog,
      failedOidvector,
      failedCompose,
      failedHolder,
      failedOrder,
      failedEndpointPhase,
      failedRunningStatus,
      failedCounter,
      installing,
    ]
      .sort()
      .join('\n')
  )
    return 'resume';
  if (
    exact ===
    [
      prior,
      failed,
      failedPg,
      failedImage,
      failedCatalog,
      failedOidvector,
      failedCompose,
      failedHolder,
      failedOrder,
      failedEndpointPhase,
      failedRunningStatus,
      failedCounter,
      current,
    ]
      .sort()
      .join('\n')
  )
    return 'complete';
  return 'reject';
};
for (const [children, expected] of [
  [
    [
      prior,
      failed,
      failedPg,
      failedImage,
      failedCatalog,
      failedOidvector,
      failedCompose,
      failedHolder,
      failedOrder,
      failedEndpointPhase,
      failedRunningStatus,
      failedCounter,
    ],
    'append',
  ],
  [
    [
      prior,
      failed,
      failedPg,
      failedImage,
      failedCatalog,
      failedOidvector,
      failedCompose,
      failedHolder,
      failedOrder,
      failedEndpointPhase,
      failedRunningStatus,
      failedCounter,
      installing,
    ],
    'resume',
  ],
  [
    [
      prior,
      failed,
      failedPg,
      failedImage,
      failedCatalog,
      failedOidvector,
      failedCompose,
      failedHolder,
      failedOrder,
      failedEndpointPhase,
      failedRunningStatus,
      failedCounter,
      current,
    ],
    'complete',
  ],
  [[], 'reject'],
  [[current], 'reject'],
  [[prior, installing, current], 'reject'],
  [[prior, 'unexpected'], 'reject'],
]) {
  assert.equal(classifyChain(children), expected, `bad two-claim fixture ${children}`);
}

const bash = resolveBash();
const bashCheck = spawnSync(bash, ['-n', operation], { encoding: 'utf8' });
assert.equal(bashCheck.status, 0, bashCheck.stderr || bashCheck.stdout);
const orderSyntaxOnly = spawnSync(bash, ['-n'], {
  encoding: 'utf8',
  input: 'caller() { late_helper; }\ncaller\nlate_helper() { :; }\n',
});
assert.equal(orderSyntaxOnly.status, 0, 'bash -n fixture must miss the definition-order hazard');
const orderExecution = spawnSync(bash, [], {
  encoding: 'utf8',
  input: 'set -e\ncaller() { late_helper; }\ncaller\nlate_helper() { :; }\n',
});
assert.notEqual(orderExecution.status, 0, 'execution fixture must expose call-before-definition');
const terminalEmissionCheck = spawnSync(bash, ['-n'], {
  encoding: 'utf8',
  input: workflowRunBlock('Emit the exact terminal-attestation root-console invocation'),
});
assert.equal(
  terminalEmissionCheck.status,
  0,
  terminalEmissionCheck.stderr || terminalEmissionCheck.stdout,
);
const rootEmissionCheck = spawnSync(bash, ['-n'], {
  encoding: 'utf8',
  input: rootEmission,
});
assert.equal(rootEmissionCheck.status, 0, rootEmissionCheck.stderr || rootEmissionCheck.stdout);

const python = resolvePython();
const compile = spawnSync(python, ['-m', 'py_compile', validator, fixtures], { encoding: 'utf8' });
assert.equal(compile.status, 0, compile.stderr || compile.stdout);
const fixtureResult = spawnSync(python, ['-I', fixtures, validator], {
  encoding: 'utf8',
  timeout: 60_000,
});
assert.equal(fixtureResult.status, 0, fixtureResult.stderr || fixtureResult.stdout);
assert.match(fixtureResult.stdout, /classic\/OCI fixtures passed/);

console.log('H14 Owner archive-recovery workflow and fixtures verified');
