import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const pilotCompose = await readFile(
  `${repositoryRoot}infra/compose.telebirr-device-pilot.yaml`,
  'utf8',
);
const productionCompose = await readFile(`${repositoryRoot}infra/compose.production.yaml`, 'utf8');
const caddyfile = await readFile(`${repositoryRoot}infra/gateway/Caddyfile`, 'utf8');
const caddyRoutingTest = await readFile(
  `${repositoryRoot}infra/test-telebirr-gateway-routing.mjs`,
  'utf8',
);
const gitAttributes = await readFile(`${repositoryRoot}.gitattributes`, 'utf8');
const qualityWorkflow = await readFile(`${repositoryRoot}.github/workflows/quality.yml`, 'utf8');
const deployWorkflow = await readFile(
  `${repositoryRoot}.github/workflows/staging-telebirr-device-pilot.yml`,
  'utf8',
);
const pilotRunbook = await readFile(`${repositoryRoot}infra/telebirr-device-pilot.md`, 'utf8');
const deployHelper = await readFile(
  `${repositoryRoot}infra/operations/fetanagent-telebirr-device-pilot-helper.sh`,
  'utf8',
);
const helperInstaller = await readFile(
  `${repositoryRoot}infra/operations/install-fetanagent-telebirr-device-pilot-helper-v2.sh`,
  'utf8',
);
const androidTransport = await readFile(
  `${repositoryRoot}android/telebirr-verifier/app/src/main/java/com/fetanagent/telebirrverifier/FixedDeviceBridgeHttpsExchange.kt`,
  'utf8',
);
const androidComposition = await readFile(
  `${repositoryRoot}android/telebirr-verifier/app/src/main/java/com/fetanagent/telebirrverifier/VerifierRuntimeComposition.kt`,
  'utf8',
);
const directDatabaseTunnel = await readFile(
  `${repositoryRoot}infra/operations/fetanagent-staging-direct-database-tunnel.sh`,
  'utf8',
);
const deploySudoers = await readFile(
  `${repositoryRoot}infra/operations/fetanagent-telebirr-device-pilot.sudoers`,
  'utf8',
);
const provisionSql = await readFile(
  `${repositoryRoot}infra/sql/staging-telebirr-device-pilot-provision.sql`,
  'utf8',
);
const disableSql = await readFile(
  `${repositoryRoot}infra/sql/staging-telebirr-device-pilot-disable.sql`,
  'utf8',
);
const runtimeInputSql = await readFile(
  `${repositoryRoot}infra/sql/staging-telebirr-device-pilot-runtime-input.sql`,
  'utf8',
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function serviceSection(source, name) {
  const startPattern = new RegExp(`^  ${escapeRegExp(name)}:\\s*$`, 'mu');
  const start = startPattern.exec(source);
  assert.ok(start, `missing service ${name}`);
  const remainder = source.slice(start.index + start[0].length);
  const next = /^  [a-z][a-z0-9_-]*:\s*$/mu.exec(remainder);
  const topLevel = /^\S[^\r\n]*:\s*$/mu.exec(remainder);
  const candidates = [next?.index, topLevel?.index].filter((value) => value !== undefined);
  const end = candidates.length === 0 ? remainder.length : Math.min(...candidates);
  return remainder.slice(0, end);
}

const assignment = serviceSection(pilotCompose, 'telebirr-assignment-broker');
const deviceState = serviceSection(pilotCompose, 'telebirr-device-state-broker');
const bridge = serviceSection(pilotCompose, 'staging-device-pilot-bridge');
const productionBridge = serviceSection(productionCompose, 'telebirr-device-bridge');
const gateway = serviceSection(productionCompose, 'gateway');

assert.match(pilotCompose, /^name: fetanagent-telebirr-device-pilot$/mu);
assert.equal(
  [...pilotCompose.matchAll(/^    profiles: \[telebirr-device-pilot\]$/gmu)].length,
  3,
  'only the exact three-service pilot profile may activate the stack',
);
assert.doesNotMatch(pilotCompose, /^\s+ports:\s*$/mu);
assert.doesNotMatch(pilotCompose, /^  telebirr-device-bridge:\s*$/mu);
assert.doesNotMatch(pilotCompose, /2026-09-04|shutdownAt|stopAt/u);
assert.equal(
  (
    pilotCompose.match(
      /DEPLOYMENT_TARGET: \$\{FETANAGENT_TELEBIRR_DEPLOYMENT_TARGET:-staging\}/gu,
    ) ?? []
  ).length,
  3,
  'one explicit target input must bind all three TeleBirr services',
);

for (const [name, section, target] of [
  ['assignment broker', assignment, 'telebirr-assignment-broker'],
  ['device-state broker', deviceState, 'telebirr-device-state-broker'],
  ['device bridge', bridge, 'telebirr-device-bridge'],
]) {
  assert.match(section, new RegExp(`target: ${escapeRegExp(target)}`, 'u'), `${name} target`);
  assert.match(section, /user: '10001:10001'/u, `${name} must be non-root`);
  assert.match(section, /restart: unless-stopped/u, `${name} must survive ordinary host restarts`);
  assert.match(section, /read_only: true/u, `${name} root filesystem must be read-only`);
  assert.match(section, /cap_drop:\s*\r?\n      - ALL/u, `${name} must drop capabilities`);
  assert.match(section, /no-new-privileges:true/u, `${name} must forbid privilege gain`);
  assert.match(section, /FINANCIAL_ACTIONS_MODE: dry_run/u, `${name} must stay no-money`);
  assert.match(section, /condition: service_healthy|healthcheck:/u, `${name} must be health-gated`);
  assert.doesNotMatch(section, /service.?role|TELEGRAM_BOT_TOKEN|KEMERBET/u);
}

assert.match(assignment, /INTERNAL_TELEBIRR_ASSIGNMENT_BROKER_ENABLED: 'true'/u);
assert.match(assignment, /TELEBIRR_ASSIGNMENT_BROKER_NO_MONEY_PILOT_ENABLED: 'true'/u);
assert.match(
  assignment,
  /TELEBIRR_ASSIGNMENT_BROKER_DATABASE_URL_FILE: \/run\/secrets\/telebirr_assignment_broker_database_url/u,
);
assert.match(
  assignment,
  /TELEBIRR_ASSIGNMENT_BROKER_REFERENCE_OPENING_KEY_FILE: \/run\/secrets\/telebirr_assignment_broker_reference_opening_key\.v1\.json/u,
);
assert.match(assignment, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/u);
assert.match(assignment, /- telebirr_assignment_database_egress/u);
assert.doesNotMatch(assignment, /telebirr_device_ingress|telebirr_device_state_database_egress/u);

assert.match(deviceState, /INTERNAL_TELEBIRR_DEVICE_STATE_BROKER_ENABLED: 'true'/u);
assert.match(deviceState, /TELEBIRR_DEVICE_STATE_BROKER_NO_MONEY_PILOT_ENABLED: 'true'/u);
assert.match(
  deviceState,
  /TELEBIRR_DEVICE_STATE_BROKER_DATABASE_URL_FILE: \/run\/secrets\/telebirr_device_state_broker_database_url/u,
);
assert.match(deviceState, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/u);
assert.match(deviceState, /- telebirr_device_state_database_egress/u);
assert.doesNotMatch(deviceState, /telebirr_device_ingress|telebirr_assignment_database_egress/u);

assert.match(bridge, /INTERNAL_TELEBIRR_DEVICE_BRIDGE_ENABLED: 'true'/u);
assert.match(bridge, /TELEBIRR_DEVICE_BRIDGE_NO_MONEY_PILOT_ENABLED: 'true'/u);
assert.match(bridge, /TELEBIRR_DEVICE_BRIDGE_LISTEN_HOST: 0\.0\.0\.0/u);
assert.match(bridge, /TELEBIRR_DEVICE_BRIDGE_LISTEN_PORT: '8084'/u);
assert.match(bridge, /source: telebirr_assignment_socket[\s\S]*?read_only: true/u);
assert.match(bridge, /source: telebirr_device_state_socket[\s\S]*?read_only: true/u);
assert.match(bridge, /telebirr_device_ingress:[\s\S]*?- staging-device-pilot-bridge/u);
assert.doesNotMatch(bridge, /- telebirr-device-bridge/u);
assert.doesNotMatch(bridge, /database_egress|DATABASE_URL|NODE_EXTRA_CA_CERTS/u);
assert.match(
  bridge,
  /telebirr-assignment-broker:[\s\S]*?condition: service_healthy[\s\S]*?telebirr-device-state-broker:[\s\S]*?condition: service_healthy/u,
);

assert.match(
  pilotCompose,
  /telebirr_assignment_database_egress:[\s\S]*?enable_ipv6: true[\s\S]*?internal: false[\s\S]*?telebirr_device_state_database_egress:[\s\S]*?enable_ipv6: true[\s\S]*?internal: false/u,
);
assert.match(
  pilotCompose,
  /telebirr_device_ingress:\s*\r?\n    external: true\s*\r?\n    name: fetanagent-telebirr-device-ingress/u,
);
assert.match(
  productionCompose,
  /telebirr_device_ingress:\s*\r?\n    external: true\s*\r?\n    name: fetanagent-telebirr-device-ingress/u,
);
assert.match(gateway, /- telebirr_device_ingress/u);
assert.match(productionBridge, /aliases:[\s\S]*?- telebirr-device-bridge/u);
assert.doesNotMatch(productionBridge, /staging-device-pilot-bridge/u);

for (const variable of [
  'FETANAGENT_TELEBIRR_SUPABASE_CA_CERTIFICATE_FILE',
  'FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_KEY_FILE',
  'FETANAGENT_TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE',
  'FETANAGENT_TELEBIRR_ASSIGNMENT_DATABASE_URL_FILE',
  'FETANAGENT_TELEBIRR_REFERENCE_OPENING_KEY_FILE',
  'FETANAGENT_TELEBIRR_ASSIGNMENT_RUNTIME_MANIFEST_FILE',
  'FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_PRIVATE_KEY_FILE',
  'FETANAGENT_TELEBIRR_DEVICE_STATE_DATABASE_URL_FILE',
  'FETANAGENT_TELEBIRR_DEVICE_BRIDGE_SERVER_SIGNER_PRIVATE_KEY_FILE',
]) {
  assert.match(pilotCompose, new RegExp(`\\$\\{${variable}:\\?`, 'u'));
  assert.match(qualityWorkflow, new RegExp(`${variable}=\\/dev\\/null`, 'u'));
}

assert.match(caddyfile, /^device\.fetanagent\.com \{$/mu);
for (const path of [
  '/v1/telebirr/device/enrollments:pair',
  '/v1/telebirr/device/assignments:poll',
  '/v1/telebirr/device/heartbeat',
  '/v1/telebirr/device/observations:upload',
]) {
  assert.match(caddyfile, new RegExp(escapeRegExp(path), 'u'));
}
assert.match(caddyfile, /method POST/u);
assert.match(caddyfile, /max_size 256KiB/u);
assert.match(caddyfile, /reverse_proxy telebirr-device-bridge:8084/u);
assert.match(caddyfile, /\{http\.request\.header\.X-FetanAgent-Deployment-Target\} == "staging"/u);
assert.match(
  caddyfile,
  /\{http\.request\.header\.X-FetanAgent-Deployment-Target\} == "production"/u,
);
assert.match(caddyfile, /header X-FetanAgent-Deployment-Target \*\s*\r?\n/u);
assert.match(caddyfile, /header !X-FetanAgent-Deployment-Target/u);
assert.match(caddyfile, /reverse_proxy staging-device-pilot-bridge:8084/u);
const stagingTargetRoute = caddyfile.indexOf('handle @staging_telebirr_device_bridge');
const productionTargetRoute = caddyfile.indexOf('handle @production_telebirr_device_bridge');
const invalidTargetRoute = caddyfile.indexOf('handle @invalid_telebirr_device_target');
const legacyTargetRoute = caddyfile.indexOf('handle @legacy_telebirr_device_bridge');
assert.ok(
  stagingTargetRoute >= 0 &&
    stagingTargetRoute < productionTargetRoute &&
    productionTargetRoute < invalidTargetRoute &&
    invalidTargetRoute < legacyTargetRoute,
  'staging, production, invalid-present rejection, and header-absent legacy routes must stay ordered',
);
assert.equal(
  (caddyfile.match(/reverse_proxy telebirr-device-bridge:8084/gu) ?? []).length,
  2,
  'only the exact production-target and header-absent legacy routes use the production alias',
);
assert.doesNotMatch(caddyfile, /@telebirr_device_bridge\s*\{/u);
assert.match(
  caddyfile,
  /\{http\.request\.header\.Content-Type\} == "application\/vnd\.fetanagent\.telebirr-device-bridge\+json"/u,
);
assert.match(caddyfile, /dial_timeout 3s/u);
assert.match(caddyfile, /response_header_timeout 15s/u);
assert.match(caddyfile, /respond 404/u);
assert.match(gitAttributes, /^infra\/gateway\/Caddyfile text eol=lf$/mu);
assert.doesNotMatch(caddyfile, /device\.fetanagent\.com[\s\S]*?encode /u);
for (const runtimePredicate of [
  "['staging'], 204",
  "['production'], 202",
  'gatewayPort, [], 202',
  "['Staging']",
  "['PRODUCTION']",
  "['staging,production']",
  "['staging', 'production']",
  "['staging', 'staging']",
  "['production', 'preview']",
  "['Content-Type', 'application/json']",
]) {
  assert.ok(
    caddyRoutingTest.includes(runtimePredicate),
    `the runtime Caddy matrix is missing: ${runtimePredicate}`,
  );
}
assert.match(caddyRoutingTest, /--network[\s\S]*?'host'/u);
assert.match(caddyRoutingTest, /target values[\s\S]*?reached an upstream/u);

assert.match(
  qualityWorkflow,
  /docker compose --env-file \/dev\/null[\s\S]*?--file infra\/compose\.telebirr-device-pilot\.yaml[\s\S]*?--profile telebirr-device-pilot config --quiet/u,
);
assert.match(
  qualityWorkflow,
  /bash -n infra\/operations\/fetanagent-telebirr-device-pilot-helper\.sh[\s\S]*?bash -n infra\/operations\/fetanagent-staging-direct-database-tunnel\.sh/u,
);
assert.match(
  qualityWorkflow,
  /bash -n infra\/operations\/install-fetanagent-telebirr-device-pilot-helper-v2\.sh/u,
);
assert.match(
  qualityWorkflow,
  /node infra\/test-telebirr-gateway-routing\.mjs fetanagent-gateway:ci/u,
);

assert.match(deployWorkflow, /^name: Staging TeleBirr Android device transport$/mu);
assert.match(deployWorkflow, /^  workflow_dispatch:$/mu);
assert.doesNotMatch(deployWorkflow, /^  schedule:$/mu);
assert.match(deployWorkflow, /confirm_no_money_operation:/u);
assert.match(deployWorkflow, /deploy-telebirr-device-transport-no-money/u);
assert.match(deployWorkflow, /secrets\.TELEBIRR_REFERENCE_OPENING_KEY_V2_BASE64/u);
assert.match(deployWorkflow, /deposit-proof-reference-opening/u);
assert.match(deployWorkflow, /\.keyVersion == 2/u);
assert.doesNotMatch(deployWorkflow, /TELEBIRR_REFERENCE_OPENING_KEY_V1_BASE64/u);
assert.doesNotMatch(deployWorkflow, /private_live_reference_opening/u);
assert.match(deployWorkflow, /environment: staging/u);
assert.match(deployWorkflow, /permissions:\s*\r?\n  contents: read/u);
assert.match(deployWorkflow, /concurrency:\s*\r?\n  group: fetanagent-staging-beta-deploy/u);
for (const target of [
  'telebirr-assignment-broker',
  'telebirr-device-state-broker',
  'telebirr-device-bridge',
]) {
  assert.match(deployWorkflow, new RegExp(`docker build[\\s\\S]*?${target}`, 'u'));
}
assert.doesNotMatch(deployWorkflow, /docker build[\s\S]*?--target gateway/u);
assert.doesNotMatch(deployWorkflow, /fetanagent-gateway:\$tag/u);
assert.doesNotMatch(deployWorkflow, /infra\/compose\.staging-beta\.yaml/u);
for (const contract of [
  'staging-telebirr-device-pilot-runtime-input.sql',
  'build-telebirr-assignment-runtime-manifest.mjs',
  'staging-telebirr-device-pilot-provision.sql',
  'staging-telebirr-device-pilot-disable.sql',
  'staging-runtime-login-preflight.sql',
  'fetanagent-telebirr-device-pilot-helper',
  'fetanagent-staging-direct-database-tunnel.sh',
]) {
  assert.match(deployWorkflow, new RegExp(escapeRegExp(contract), 'u'));
}
assert.match(deployWorkflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
assert.doesNotMatch(deployWorkflow, /echo "vm_host=.*GITHUB_OUTPUT/u);
assert.equal(
  (deployWorkflow.match(/^\s+VM_HOST: \$\{\{ secrets\.STAGING_VM_HOST \}\}$/gmu) ?? []).length,
  8,
  'Each protected SSH step must consume the masked VM host directly.',
);
assert.doesNotMatch(deployWorkflow, /pull_request_target|contents: write|service.?role|KEMERBET/u);
assert.doesNotMatch(deployWorkflow, /sslmode=verify-full\\n/u);
assert.doesNotMatch(
  deployWorkflow,
  /printf '%s\\n' "\$SUPABASE_CA_CERTIFICATE_PEM"/u,
  'the workflow must not append a second line terminator to the stored PEM secret',
);
assert.equal(
  (deployWorkflow.match(/printf '%s' "\$SUPABASE_CA_CERTIFICATE_PEM"/gu) ?? []).length,
  2,
  'deploy and stop paths must preserve the exact PEM secret bytes',
);
assert.equal(
  (
    deployWorkflow.match(
      /printf 'postgresql:\/\/%s:%s@%s:5432\/postgres\?sslmode=verify-full'/gu,
    ) ?? []
  ).length,
  2,
  'both direct runtime database URL files must be emitted without a line terminator',
);
assert.match(pilotRunbook, /exact URL bytes, with no line terminator or surrounding\s+whitespace/u);
assert.match(pilotRunbook, /TLS-verified direct database endpoint on port `5432`/u);
assert.match(pilotRunbook, /bare, dedicated runtime role/u);
assert.match(pilotRunbook, /host-key-pinned SSH tunnel/u);
assert.match(
  deployWorkflow,
  /STAGING_DIRECT_DATABASE_HOST: db\.spzpiyxheappsfyswewl\.supabase\.co/u,
);
assert.match(deployWorkflow, /STAGING_DATABASE_TUNNEL_PORT: '15432'/u);
assert.equal(
  (deployWorkflow.match(/^\s+PGPORT: \$\{\{ env\.STAGING_DATABASE_TUNNEL_PORT \}\}$/gmu) ?? [])
    .length,
  5,
  'all five database steps must use the fixed local SSH-tunnel port',
);
assert.equal(
  (deployWorkflow.match(/^\s+PGHOSTADDR: 127\.0\.0\.1$/gmu) ?? []).length,
  5,
  'all five database steps must connect through the loopback end of the SSH tunnel',
);
assert.equal(
  (deployWorkflow.match(/^\s+PGHOST: \$\{\{ env\.STAGING_DIRECT_DATABASE_HOST \}\}$/gmu) ?? [])
    .length,
  5,
  'verify-full must retain the direct database hostname on every tunneled connection',
);
assert.equal(
  (
    deployWorkflow.match(
      /source infra\/operations\/fetanagent-staging-direct-database-tunnel\.sh/gu,
    ) ?? []
  ).length,
  5,
  'every database step must load the reviewed tunnel lifecycle',
);
assert.doesNotMatch(deployWorkflow, /STAGING_POOLER_HOST|pooler\.supabase\.com/u);
assert.match(deployWorkflow, /for delay in 0 5 10 20 40/u);
assert.match(
  deployWorkflow,
  /runtime_input="\$protected\/pilot-runtime-input\.json"[\s\S]*?partial_input="\$runtime_input\.partial"[\s\S]*?>"\$partial_input" 2>\/dev\/null && \[\[ -s "\$partial_input" \]\][\s\S]*?mv -- "\$partial_input" "\$runtime_input"/u,
  'the read-only manifest query must retry into an atomic, non-empty protected output',
);
assert.doesNotMatch(
  deployWorkflow,
  /result="\$\(for delay in 0 5 10 20 40/u,
  'only the read-only manifest query may use the connection retry schedule',
);
assert.match(deployWorkflow, /for delay in 0 2 5 10/u);
assert.match(
  deployWorkflow,
  /PGUSER="\$role" PGPASSWORD="\$password"[\s\S]*?--set=expected_runtime_role="\$role"/u,
  'activation must prove each bounded identity through its exact direct runtime login',
);
assert.match(
  deployWorkflow,
  /Build the exact armed-pilot runtime manifest[\s\S]*?Quiesce the exact healthy active transport[\s\S]*?quiesce-active-for-upgrade[\s\S]*?Provision only the two bounded no-money database logins/u,
  'an upgrade must quiesce the exact active release after read-only inspection and before opening its single-slot runtime logins',
);
assert.match(
  deployWorkflow,
  /echo 'attempted=true' >>"\$GITHUB_OUTPUT"[\s\S]*?quiesce-active-for-upgrade[\s\S]*?echo 'completed=true' >>"\$GITHUB_OUTPUT"/u,
  'cleanup must be able to detect every attempted quiescence',
);
assert.match(
  deployWorkflow,
  /steps\.quiesce\.outputs\.attempted == 'true' \|\| steps\.provision\.outputs\.attempted == 'true'/u,
  'an interrupted upgrade must disable both runtime logins even before provisioning starts',
);

assert.match(deployHelper, /^set -euo pipefail$/mu);
assert.match(deployHelper, /EXPECTED_SUDO_USER='fetanagent-admin'/u);
assert.match(deployHelper, /FINANCIAL_ACTIONS_MODE|compose\.telebirr-device-pilot\.yaml/u);
for (const [name, value] of [
  ['PRODUCTION_RELEASE', '69be82ac3e49ff8c63c64c9aa7926e0046b48a10'],
  ['INGRESS_NETWORK_ID', '5b3dc890fad4f062ac570e4bbc66f950d002b536843b2630473eb817537af738'],
  [
    'INGRESS_NETWORK_CONFIG_HASH',
    'ac7f178b6d4280a708b951cb93740b0f8323fb2cb2c75d05cf040f44e2c34209',
  ],
  ['INGRESS_NETWORK_COMPOSE_VERSION', '5.1.4'],
  ['INGRESS_NETWORK_IPV4_SUBNET', '172.23.0.0/16'],
  ['INGRESS_NETWORK_IPV4_GATEWAY', '172.23.0.1'],
  [
    'BASELINE_GATEWAY_CADDYFILE_SHA256',
    '181992c8958397d63a7ae34137d51d4186ce0383c8cfd2bf8df137da11e12f24',
  ],
]) {
  assert.match(deployHelper, new RegExp(`readonly ${name}='${value}'`, 'u'));
}
assert.match(
  deployHelper,
  /require_shared_ingress_boundary\(\)[\s\S]*?\.\[0\]\.EnableIPv4 == true[\s\S]*?\.\[0\]\.Attachable == false[\s\S]*?\.\[0\]\.Labels == \{[\s\S]*?\.\[0\]\.IPAM\.Config == \[\{"Subnet":\$subnet,"Gateway":\$gateway\}\][\s\S]*?\.value\.EndpointID[\s\S]*?container_rows/u,
  'the device helper must retain the exact H18 network and endpoint cross-check shape',
);
assert.match(
  deployHelper,
  /require_current_shared_ingress_boundary\(\)[\s\S]*?index \.NetworkSettings\.Networks[\s\S]*?recoverable/u,
  'stale-release recovery must classify a pilot bridge by its exact shared-network attachment, not merely its running state',
);
assert.match(
  deployHelper,
  /\$expected_state == "recoverable"[\s\S]*?\.State\.Status == "created"[\s\S]*?\.State\.Status == "exited"[\s\S]*?\.State\.Running == false/u,
  'an attached stopped pilot bridge must remain exactly shaped and inert before receipt-bound removal',
);
assert.match(
  deployHelper,
  /require_production_endpoint_boundary\(\)[\s\S]*?\/fetanagent-production-gateway-1[\s\S]*?\/fetanagent-production-telebirr-device-bridge-1[\s\S]*?org\.opencontainers\.image\.title[\s\S]*?FINANCIAL_ACTIONS_MODE=dry_run[\s\S]*?KEMERBET_EXECUTOR_ENABLED=false[\s\S]*?KEMERBET_FINAL_ACTION_ENABLED=false/u,
  'the two production endpoints must retain their exact H18-derived identity and no-money shape',
);
for (const command of ['start', 'ready', 'stop', 'stop-active', 'rollback']) {
  assert.match(deployHelper, new RegExp(`^  ${command}\\)$`, 'mu'));
}
assert.match(deployHelper, /^  quiesce-active-for-upgrade\)$/mu);
assert.match(
  deployHelper,
  /bridge_service_for_release\(\)[\s\S]*?grep -Fqx '  staging-device-pilot-bridge:'[\s\S]*?grep -Fqx '  telebirr-device-bridge:'[\s\S]*?ambiguous bridge service identity/u,
  'stale-release recovery must select exactly one bridge identity from the sealed Compose file',
);
assert.match(
  deployHelper,
  /require_stoppable_pilot_inventory\(\)[\s\S]*?FINANCIAL_ACTIONS_MODE=dry_run[\s\S]*?\.HostConfig\.Privileged == false[\s\S]*?TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET=staging[\s\S]*?TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET=staging[\s\S]*?TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET=staging/u,
  'receipt-bound cleanup must reject containers outside the exact unprivileged no-money staging shape',
);
assert.match(
  deployHelper,
  /quiesce_active_for_upgrade\(\)[\s\S]*?validate_commit_and_tag "\$next_commit_sha" "\$next_image_tag"[\s\S]*?active_commit_sha="\$\(read_active_commit\)"[\s\S]*?"\$active_commit_sha" != "\$next_commit_sha"[\s\S]*?stop_release "\$active_commit_sha" "\$active_image_tag"/u,
  'quiescence must derive and stop only the exact receipt-bound predecessor',
);
assert.match(
  deployHelper,
  /start_release\(\)[\s\S]*?\[\[ ! -e "\$ACTIVE_RECEIPT" && ! -L "\$ACTIVE_RECEIPT" \]\][\s\S]*?require_production_ingress stopped "\$commit_sha" "\$image_tag"[\s\S]*?production_ingress_runtime_digest "\$commit_sha"[\s\S]*?run_pilot_compose[\s\S]*?production_ingress_runtime_digest "\$commit_sha"/u,
  'start must bind the route revision and preserve the full production runtime digest',
);
assert.doesNotMatch(deployHelper, /run_gateway_compose|STAGING_PROJECT|gateway-rollback-v1/u);
assert.match(
  deployHelper,
  /stop_active_release\(\)[\s\S]*?active_commit_sha="\$\(read_active_commit\)"[\s\S]*?stop_release "\$active_commit_sha" "\$active_image_tag"/u,
  'stop-active must derive the release from the exact sealed active receipt',
);
assert.match(
  deployWorkflow,
  /fetanagent-telebirr-device-pilot-helper stop-active/u,
  'operator stop must never bind recovery to the workflow commit',
);
assert.doesNotMatch(
  deployWorkflow,
  /fetanagent-telebirr-device-pilot-helper stop ['"]?\$GITHUB_SHA/u,
);
const stopReleaseStart = deployHelper.indexOf('stop_release() {');
const stopReleaseEnd = deployHelper.indexOf('\nread_active_commit() {', stopReleaseStart);
assert.ok(stopReleaseStart >= 0 && stopReleaseEnd > stopReleaseStart);
const stopRelease = deployHelper.slice(stopReleaseStart, stopReleaseEnd);
for (const predicate of [
  'validate_stoppable_release',
  'bridge_service_for_release',
  'production_fingerprint_before',
  'rm --stop --force "$bridge_service" telebirr-device-state-broker telebirr-assignment-broker',
  'require_no_pilot_containers',
  'remove_exact_empty_pilot_networks',
  'require_shared_ingress_boundary',
  'production_fingerprint_after',
  'rm -f -- "$ACTIVE_RECEIPT"',
]) {
  assert.ok(stopRelease.includes(predicate), `stop recovery must retain ${predicate}`);
}
assert.ok(
  stopRelease.indexOf('production_fingerprint_after') <
    stopRelease.indexOf('rm -f -- "$ACTIVE_RECEIPT"'),
  'the exact receipt must remain until production attachment preservation is proved',
);
assert.doesNotMatch(deployHelper, /\brm\s+-rf\b/u);
assert.doesNotMatch(deployHelper, /docker_local\s+container\s+rm\b/u);
assert.doesNotMatch(deployHelper, /run_pilot_compose[^\n]*\bdown\b/u);
const networkCleanupStart = deployHelper.indexOf('remove_exact_empty_pilot_networks() {');
const networkCleanupEnd = deployHelper.indexOf(
  '\nrequire_stoppable_pilot_inventory() {',
  networkCleanupStart,
);
assert.ok(networkCleanupStart >= 0 && networkCleanupEnd > networkCleanupStart);
const networkCleanup = deployHelper.slice(networkCleanupStart, networkCleanupEnd);
for (const predicate of [
  'length >= 1 and length <= 2',
  '.EnableIPv4 == true',
  '.EnableIPv6 == true',
  '.Internal == false',
  '.Attachable == false',
  '(.Containers // {}) == {}',
  'com.docker.compose.config-hash',
  'telebirr_assignment_database_egress',
  'telebirr_device_state_database_egress',
  '172.24.0.0/16',
  '172.25.0.0/16',
  'fdfe:628:7be8:3::/64',
  'fdfe:628:7be8:4::/64',
  'docker_local network rm "$network_id"',
]) {
  assert.ok(
    networkCleanup.includes(predicate),
    `exact pilot network cleanup must retain ${predicate}`,
  );
}
for (const pinnedValue of [
  '1478fc81b2d68fbfda31c954cd2fd7141044f0d2',
  '2d934c613623a579d463e080ecf6769d45cc781f7ceae340b9b989b5dea3e7ed',
  '2d9952e6b2e6d8cd0a3e8c4c6a91afc996b91bc1a1a2d00b99b8f69e5c261598',
  'f360d1a51d3a3e8469bacc65c776a94657fadb0fd2106cb9c24fad0e5911c928',
  '4995938523f921b6722ed64688aeadc173fc3351209d4ad4a557b7e7cfcc514c',
]) {
  assert.ok(
    deployHelper.includes(pinnedValue),
    `missing pinned stale-network value: ${pinnedValue}`,
  );
}
assert.doesNotMatch(
  deployHelper.slice(0, networkCleanupStart) + deployHelper.slice(networkCleanupEnd),
  /docker_local\s+network\s+rm\b/u,
  'network deletion is allowed only inside the exact empty pilot-network classifier',
);
assert.doesNotMatch(deployHelper, /docker_local\s+network\s+(?:prune|disconnect)\b/u);
assert.match(deployHelper, /negative_public_smoke/u);
assert.match(
  deployHelper,
  /enrollments:pair[\s\S]*?\[\[ "\$status" == '401' \]\][\s\S]*?assignments:poll[\s\S]*?\[\[ "\$status" == '400' \]\]/u,
);
assert.match(deployHelper, /require_database_url_file/u);
assert.match(deployHelper, /exact no-whitespace byte contract/u);
assert.match(
  deployHelper,
  /STAGING_DIRECT_DATABASE_HOST='db\.spzpiyxheappsfyswewl\.supabase\.co'/u,
);
assert.match(deployHelper, /getent ahostsv6 "\$STAGING_DIRECT_DATABASE_HOST"/u);
assert.match(deployHelper, /\/dev\/tcp\/\$STAGING_DIRECT_DATABASE_HOST\/5432/u);
assert.doesNotMatch(deployHelper, /STAGING_SESSION_POOLER_HOST|pooler\.supabase\.com/u);
assert.match(
  deployHelper,
  /prefix="postgresql:\/\/\$role:"[\s\S]*?suffix="@\$STAGING_DIRECT_DATABASE_HOST:5432\/postgres\?sslmode=verify-full"/u,
);

assert.match(directDatabaseTunnel, /^fetanagent_open_staging_direct_database_tunnel\(\) \{$/mu);
assert.match(directDatabaseTunnel, /^fetanagent_close_staging_direct_database_tunnel\(\) \{$/mu);
assert.match(directDatabaseTunnel, /db\.spzpiyxheappsfyswewl\.supabase\.co/u);
assert.match(directDatabaseTunnel, /"\$local_port" == '15432'/u);
assert.match(directDatabaseTunnel, /StrictHostKeyChecking=yes/u);
assert.match(directDatabaseTunnel, /ExitOnForwardFailure=yes/u);
assert.match(directDatabaseTunnel, /-L "127\.0\.0\.1:\$local_port:\$database_host:5432"/u);
assert.doesNotMatch(directDatabaseTunnel, /PGPASSWORD|SUPABASE_DB_PASSWORD|service.?role/iu);
assert.match(
  qualityWorkflow,
  /--file infra\/compose\.staging-beta\.yaml\s*\\\s*\r?\n\s*--profile staging-manual --profile public-domain config --quiet/u,
  'CI must exercise the exact dependency-complete gateway profile set used by the VM installer',
);
assert.match(deployHelper, /HostConfig\.ReadonlyRootfs/u);
assert.match(deployHelper, /HostConfig\.PortBindings == \{\}/u);
assert.match(deployHelper, /State\.Health\.Status == "healthy"/u);
assert.match(deployHelper, /'10001:10001:400'/u);
assert.match(deployHelper, /'0:0:444'/u);
assert.match(deployHelper, /less than 2 GiB free/u);
assert.match(deployHelper, /ip -6 route show default/u);
assert.match(deployHelper, /getent ahostsv6/u);
assert.match(deployHelper, /query-bearing route/u);
assert.doesNotMatch(deployHelper, /service.?role|2026-09-04|shutdownAt|stopAt/u);
const caddyfileSha256 = createHash('sha256')
  .update(caddyfile.replace(/\r\n/gu, '\n'))
  .digest('hex');
assert.match(
  deployHelper,
  new RegExp(`EXPECTED_GATEWAY_CADDYFILE_SHA256='${caddyfileSha256}'`, 'u'),
  'runtime ingress attestation must pin the exact reviewed dual-route Caddyfile bytes',
);
assert.match(
  deployHelper,
  /production_ingress_runtime_digest\(\)[\s\S]*?StartedAt: \.State\.StartedAt[\s\S]*?Networks: \.NetworkSettings\.Networks[\s\S]*?gateway_caddyfile_sha256/u,
  'start/stop preservation must cover stable config, state, attachments, and route bytes',
);
const deployHelperSha256 = createHash('sha256').update(deployHelper).digest('hex');
assert.match(
  helperInstaller,
  new RegExp(`EXPECTED_HELPER_SHA256='${deployHelperSha256}'`, 'u'),
  'the one-time root installer must pin the exact successor helper bytes',
);
assert.match(
  helperInstaller,
  /PREVIOUS_HELPER_SHA256='69f422e98ec9816b608ef0b5fdacb2a223274883ae10979501b25b07abbed4b3'/u,
);
assert.match(helperInstaller, /run directly in the authenticated DigitalOcean root console/u);
assert.match(helperInstaller, /"\$0" == "\$INSTALLER"/u);
assert.match(
  helperInstaller,
  /fetanagent-telebirr-device-pilot-helper\.sh:f\\ninstall-fetanagent-telebirr-device-pilot-helper-v2\.sh:f/u,
);
assert.match(helperInstaller, /flock --exclusive --nonblock 9/u);
assert.match(helperInstaller, /mv -f -- "\$TARGET_INSTALLING" "\$TARGET"/u);
for (const topology of [
  'successor:absent:absent',
  'successor:predecessor:absent',
  'predecessor:absent:absent',
  'predecessor:predecessor:absent',
  'predecessor:predecessor:successor',
]) {
  assert.ok(helperInstaller.includes(topology), `missing resumable helper topology: ${topology}`);
}
assert.match(
  helperInstaller,
  /require_helper_digest "\$TARGET_PREVIOUS" "\$PREVIOUS_HELPER_SHA256" 755[\s\S]*?rm -f -- "\$TARGET_PREVIOUS"/u,
  'an interrupted predecessor backup may be removed only after exact attestation',
);
assert.doesNotMatch(helperInstaller, /(?:^|\n)\s*(?:docker|psql)(?:\s|$)|supabase|service.?role/iu);
assert.match(androidTransport, /DEPLOYMENT_TARGET_HEADER = "X-FetanAgent-Deployment-Target"/u);
assert.match(
  androidTransport,
  /setRequestProperty\([\s\S]*?DEPLOYMENT_TARGET_HEADER[\s\S]*?deploymentTarget/u,
);
assert.equal(
  (
    androidComposition.match(
      /FixedDeviceBridgeHttpsExchange\(BuildConfig\.VERIFIER_DEPLOYMENT_TARGET\)/gu,
    ) ?? []
  ).length,
  2,
  'pairing and enrolled runtimes must bind transport routing to the signed build target',
);
assert.equal(
  deploySudoers.trim(),
  'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-telebirr-device-pilot-helper *',
);

for (const sql of [provisionSql, runtimeInputSql]) {
  assert.match(sql, /payment_verification/u);
  assert.match(sql, /deposit_execution/u);
  assert.match(sql, /telebirr_authoritative_verification/u);
  assert.match(sql, /private_live_deposit_pilot/u);
  assert.match(sql, /dry_run/u);
  assert.doesNotMatch(sql, /mode\s*=\s*'live'|service.?role|KEMERBET/u);
}
assert.match(provisionSql, /interval '24 hours'/u);
assert.match(provisionSql, /fetanagent_telebirr_assignment_broker_runtime/u);
assert.match(provisionSql, /fetanagent_telebirr_device_state_runtime/u);
assert.match(runtimeInputSql, /receiverAccountHolderNameSnapshot/u);
assert.match(runtimeInputSql, /expectedReceiverNameDigest/u);
assert.match(disableSql, /password null valid until 'infinity'/u);
assert.match(disableSql, /pg_terminate_backend/u);
assert.equal(
  (disableSql.match(/^begin transaction isolation level serializable;$/gmu) ?? []).length,
  2,
  'runtime disablement must commit NOLOGIN before terminating pooled sessions',
);
assert.ok(
  disableSql.indexOf('commit;') < disableSql.indexOf('pg_catalog.pg_terminate_backend'),
  'NOLOGIN must be committed before the termination loop can observe and drain runtime sessions',
);

console.log(
  'TeleBirr device pilot deployment verified: three isolated no-money services, read-only socket consumers, database-free ingress, and exact HTTPS routes.',
);
