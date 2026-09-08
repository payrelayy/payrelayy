import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${repositoryRoot}/${path}`, 'utf8');

const [compose, workflow, helper, sudoers, provisionSql, disableSql, packageJson, quality] =
  await Promise.all([
    read('infra/compose.production.yaml'),
    read('.github/workflows/production-runtime.yml'),
    read('infra/operations/fetanagent-production-deploy-helper.sh'),
    read('infra/operations/fetanagent-production-deploy-helper.sudoers'),
    read('infra/sql/production-nonfinancial-runtimes-provision.sql'),
    read('infra/sql/production-nonfinancial-runtimes-disable.sql'),
    read('package.json'),
    read('.github/workflows/quality.yml'),
  ]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function topLevelSection(source, name) {
  const header = new RegExp(`^${escapeRegExp(name)}:\\s*$`, 'mu').exec(source);
  assert.ok(header, `missing top-level ${name} section`);
  const remainder = source.slice(header.index + header[0].length);
  const next = /^\S[^\r\n]*:\s*$/mu.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function childBlock(section, name) {
  const header = new RegExp(`^  ${escapeRegExp(name)}:\\s*$`, 'mu').exec(section);
  assert.ok(header, `missing ${name} block`);
  const remainder = section.slice(header.index + header[0].length);
  const next = /^  [a-z][a-z0-9_-]*:\s*$/mu.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

const services = topLevelSection(compose, 'services');
const serviceNames = [...services.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gmu)].map(
  (match) => match[1],
);
assert.deepEqual(serviceNames, [
  'owner-control',
  'customer-web',
  'api',
  'beta-admission',
  'bot',
  'telebirr-assignment-broker',
  'telebirr-device-state-broker',
  'telebirr-device-bridge',
  'production-companion-device-bridge',
  'gateway',
]);

const applicationServices = serviceNames
  .slice(0, 5)
  .map((name) => [name, childBlock(services, name)]);
const gateway = childBlock(services, 'gateway');
for (const [name, service] of applicationServices) {
  assert.match(service, /image: fetanagent-[a-z-]+:\$\{FETANAGENT_IMAGE_TAG:\?/u, name);
  assert.match(service, /<<: \*runtime-defaults/u, name);
  assert.match(service, /NODE_ENV: production/u, name);
  assert.match(service, /FINANCIAL_ACTIONS_MODE: dry_run/u, name);
  assert.match(service, /KEMERBET_EXECUTOR_ENABLED: 'false'/u, name);
  assert.match(service, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u, name);
  assert.doesNotMatch(service, /password|token:\s*[^/\s$]/iu, `${name} contains inline authority`);
}

for (const invariant of [
  /profiles: \[production\]/u,
  /platform: linux\/amd64/u,
  /pull_policy: never/u,
  /user: '10001:10001'/u,
  /restart: unless-stopped/u,
  /read_only: true/u,
  /cap_drop:\s*\r?\n    - ALL/u,
  /no-new-privileges:true/u,
  /pids_limit: 128/u,
  /max-size: 10m/u,
  /max-file: '3'/u,
]) {
  assert.match(compose.slice(0, compose.indexOf('services:')), invariant);
}

const owner = childBlock(services, 'owner-control');
assert.match(owner, /OWNER_CONTROL_DEPLOYMENT_TARGET: production/u);
assert.match(owner, /INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true'/u);
assert.match(
  owner,
  /OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID: \$\{FETANAGENT_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID:\?/u,
);
assert.match(owner, /OWNER_COMPANION_SERVER_SIGNER_KEY_ID: companion-server-production-v1/u);

const customer = childBlock(services, 'customer-web');
assert.match(customer, /CUSTOMER_WEB_DEPLOYMENT_TARGET: production/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED: 'true'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'false'/u);
assert.match(customer, /INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED: 'false'/u);

const api = childBlock(services, 'api');
assert.match(api, /PLAYER_ACTION_DEPLOYMENT_TARGET: production/u);
assert.match(api, /INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true'/u);
assert.match(api, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true'/u);
assert.match(api, /INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true'/u);

const beta = childBlock(services, 'beta-admission');
assert.match(beta, /BETA_ADMISSION_DEPLOYMENT_TARGET: production/u);
assert.match(beta, /INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED: 'true'/u);

const bot = childBlock(services, 'bot');
assert.match(bot, /TELEGRAM_BOT_ENABLED: 'true'/u);
assert.match(bot, /TELEGRAM_BETA_ADMISSION_ENABLED: 'true'/u);
assert.match(bot, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true'/u);
assert.match(bot, /condition: service_healthy/u);
assert.match(
  bot,
  /healthcheck:\s*test: \['CMD', 'node', 'apps\/bot\/dist\/telegram-polling-healthcheck\.js'\]/u,
);
assert.match(bot, /interval: 15s\s*timeout: 3s\s*start_period: 45s\s*retries: 3/u);
assert.doesNotMatch(bot, /ports:|api\.telegram\.org/u);

const telebirrAssignment = childBlock(services, 'telebirr-assignment-broker');
const telebirrDeviceState = childBlock(services, 'telebirr-device-state-broker');
const telebirrBridge = childBlock(services, 'telebirr-device-bridge');
for (const [name, service] of [
  ['TeleBirr assignment broker', telebirrAssignment],
  ['TeleBirr device-state broker', telebirrDeviceState],
  ['TeleBirr device bridge', telebirrBridge],
]) {
  assert.match(service, /image: fetanagent-telebirr-[a-z-]+:\$\{FETANAGENT_IMAGE_TAG:\?/u, name);
  assert.match(service, /<<: \*runtime-defaults/u, name);
  assert.match(service, /NODE_ENV: production/u, name);
  assert.match(service, /FINANCIAL_ACTIONS_MODE: dry_run/u, name);
  assert.match(service, /KEMERBET_EXECUTOR_ENABLED: 'false'/u, name);
  assert.match(service, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u, name);
}
assert.match(telebirrAssignment, /TELEBIRR_ASSIGNMENT_BROKER_ENROLLMENT_ONLY_ENABLED: 'true'/u);
assert.match(telebirrAssignment, /TELEBIRR_ASSIGNMENT_BROKER_DEPLOYMENT_TARGET: production/u);
assert.match(telebirrAssignment, /network_mode: none/u);
assert.doesNotMatch(
  telebirrAssignment,
  /DATABASE_URL|REFERENCE_OPENING|RUNTIME_MANIFEST|SIGNER_PRIVATE|NODE_EXTRA_CA_CERTS|secrets:/u,
);
assert.match(telebirrDeviceState, /TELEBIRR_DEVICE_STATE_BROKER_DEPLOYMENT_TARGET: production/u);
assert.match(telebirrDeviceState, /telebirr_device_state_database_egress/u);
assert.match(telebirrBridge, /TELEBIRR_DEVICE_BRIDGE_DEPLOYMENT_TARGET: production/u);
assert.match(telebirrBridge, /aliases:\s*\r?\n\s*- telebirr-device-bridge/u);
assert.match(telebirrBridge, /telebirr-assignment-broker:[\s\S]*?service_healthy/u);
assert.match(telebirrBridge, /telebirr-device-state-broker:[\s\S]*?service_healthy/u);

const companion = childBlock(services, 'production-companion-device-bridge');
for (const expression of [
  /image: fetanagent-companion-device-bridge:\$\{FETANAGENT_IMAGE_TAG:\?/u,
  /<<: \*runtime-defaults/u,
  /COMPANION_DEVICE_BRIDGE_DEPLOYMENT_TARGET: production/u,
  /COMPANION_DEVICE_BRIDGE_NO_MONEY_READ_ONLY_LOOKUP_ENABLED: 'true'/u,
  /FINANCIAL_ACTIONS_MODE: dry_run/u,
  /KEMERBET_EXECUTOR_ENABLED: 'false'/u,
  /KEMERBET_FINAL_ACTION_ENABLED: 'false'/u,
  /companion_device_database_egress/u,
])
  assert.match(companion, expression);
assert.doesNotMatch(
  companion,
  /ports:|aliases:|public_application|private_application|OWNER_CONTROL_|SUPABASE_DB_PASSWORD|SERVICE_ROLE|ASSIGNMENT_SIGNER/u,
);
assert.equal(count(companion, /- source: /gu), 4);
assert.match(
  gateway,
  /FETANAGENT_COMPANION_BRIDGE_UPSTREAM: production-companion-device-bridge:8085/u,
);
assert.match(gateway, /production-companion-device-bridge:[\s\S]*?condition: service_healthy/u);

assert.match(gateway, /ports:\s*\r?\n      - '80:80\/tcp'\s*\r?\n      - '443:443\/tcp'/u);
assert.match(gateway, /cap_add:\s*\r?\n      - NET_BIND_SERVICE/u);
assert.match(gateway, /- companion_device_ingress\s*\r?\n      - telebirr_device_ingress/u);
assert.match(gateway, /telebirr-device-bridge:[\s\S]*?condition: service_healthy/u);
assert.doesNotMatch(gateway, /secrets:|docker\.sock/u);

assert.match(compose, /^name: fetanagent-production$/mu);
assert.doesNotMatch(compose, /fetanagent-staging|2026-09-0|shutdown|expires|systemd|timer/iu);
assert.doesNotMatch(compose, /deposit-executor|trusted-telebirr-verifier|target: executor/iu);
assert.equal(count(compose, /KEMERBET_EXECUTOR_ENABLED: 'false'/gu), 9);
assert.equal(count(compose, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/gu), 9);
assert.equal(count(compose, /restart: unless-stopped/gu), 1);

const networks = topLevelSection(compose, 'networks');
assert.match(
  networks,
  /companion_device_ingress:\s*\r?\n    external: true\s*\r?\n    name: fetanagent-companion-device-ingress/u,
);
assert.match(
  networks,
  /telebirr_device_ingress:\s*\r?\n    external: true\s*\r?\n    name: fetanagent-telebirr-device-ingress/u,
);
assert.match(
  networks,
  /telebirr_device_state_database_egress:\s*\r?\n    driver: bridge\s*\r?\n    enable_ipv6: true/u,
);
const configs = topLevelSection(compose, 'configs');
assert.equal(count(configs, /^  [a-z][a-z0-9_]*:\s*$/gmu), 6);
assert.equal(count(configs, /\$\{FETANAGENT_PRODUCTION_SECRET_DIR:\?/gu), 6);
const secrets = topLevelSection(compose, 'secrets');
assert.equal(count(secrets, /^  [a-z][a-z0-9_]*:\s*$/gmu), 23);
assert.equal(count(secrets, /\$\{FETANAGENT_PRODUCTION_SECRET_DIR:\?/gu), 23);
assert.doesNotMatch(secrets, /sb_publishable_|postgresql:\/\/|[0-9a-f]{64}/u);

assert.match(workflow, /^name: Production application runtime$/mu);
assert.match(workflow, /^  workflow_dispatch:$/mu);
assert.doesNotMatch(workflow, /^  (?:push|pull_request|pull_request_target|schedule):/mu);
assert.match(workflow, /^permissions:\s*\r?\n  contents: read$/mu);
assert.match(
  workflow,
  /concurrency:\s*\r?\n  group: fetanagent-production-runtime\s*\r?\n  cancel-in-progress: false/u,
);
assert.match(workflow, /environment: production/u);
assert.match(workflow, /'deploy:DEPLOY PRODUCTION RUNTIME'/u);
assert.match(workflow, /\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/u);
assert.match(workflow, /"\$CONFIRMED_COMMIT" == "\$GITHUB_SHA"/u);
assert.match(workflow, /"\$CONFIRMED_PROJECT" != "\$STAGING_PROJECT_REF"/u);
assert.match(workflow, /Verify restricted server boundary and storage/u);
assert.match(workflow, /current-state/u);
assert.match(workflow, /Provision continuous least-privilege production logins/u);
assert.match(workflow, /production-nonfinancial-runtimes-provision\.sql/u);
assert.match(workflow, /Atomically activate production and switch the public edge/u);
assert.match(workflow, /Verify live public production services/u);
assert.match(workflow, /Private production control/u);
assert.match(workflow, /Attest and finalize the production cutover/u);
assert.match(workflow, /Roll back a failed production activation/u);
assert.match(workflow, /PREVIOUS_PRODUCTION_STATE/u);
assert.match(workflow, /cleanup-incoming/u);
assert.match(workflow, /production-nonfinancial-runtimes-disable\.sql/u);
assert.doesNotMatch(workflow, /^  schedule:|2026-09-0|systemctl|service[_-]?role/imu);
assert.doesNotMatch(workflow, /echo[^\r\n]*(?:PASSWORD|TOKEN|PRIVATE_KEY)/u);
for (const target of [
  'companion-device-bridge',
  'telebirr-assignment-broker',
  'telebirr-device-state-broker',
  'telebirr-device-bridge',
]) {
  assert.match(workflow, new RegExp(`docker build[\\s\\S]*?${target}`, 'u'));
  assert.match(workflow, new RegExp(`fetanagent-${target}:\\$tag`, 'u'));
}
for (const protectedName of [
  'TELEBIRR_ASSIGNMENT_SIGNER_PUBLIC_SPKI_BASE64',
  'TELEBIRR_BRIDGE_SERVER_SIGNER_PKCS8_BASE64',
  'TELEBIRR_DEVICE_BRIDGE_RUNTIME_MANIFEST_V1_BASE64',
  'telebirr-device-state-database-url',
]) {
  assert.match(workflow, new RegExp(escapeRegExp(protectedName), 'u'));
}
assert.match(
  workflow,
  /printf 'postgresql:\/\/%s:%s@%s:5432\/postgres\?sslmode=verify-full' \\\s*'fetanagent_telebirr_device_state_runtime'/u,
);
assert.doesNotMatch(
  workflow,
  /printf 'postgresql:\/\/%s:%s@%s:5432\/postgres\?sslmode=verify-full\\n' \\\s*'fetanagent_telebirr_device_state_runtime'/u,
);
assert.doesNotMatch(
  workflow,
  /secrets\.TELEBIRR_ASSIGNMENT_SIGNER_PKCS8_BASE64|secrets\.TELEBIRR_REFERENCE_OPENING_KEY_V2_BASE64/u,
);

for (const action of [
  'actions/checkout',
  'actions/setup-node',
  'actions/upload-artifact',
  'actions/download-artifact',
]) {
  assert.match(workflow, new RegExp(`${escapeRegExp(action)}@[0-9a-f]{40}`, 'u'));
}
for (const secret of [
  'SUPABASE_DB_PASSWORD',
  'PRODUCTION_SUPABASE_PUBLISHABLE_KEY',
  'PRODUCTION_TELEGRAM_BOT_TOKEN',
  'PRODUCTION_VM_HOST',
  'PRODUCTION_VM_KNOWN_HOSTS',
  'PRODUCTION_VM_SSH_PRIVATE_KEY',
]) {
  assert.match(workflow, new RegExp(`secrets\\.${secret}`, 'u'));
}

assert.match(helper, /^set -euo pipefail$/mu);
assert.match(helper, /\[\[ "\$\(id -u\)" == '0' \]\]/u);
assert.match(helper, /readonly ROOT='\/srv\/fetanagent\/production'/u);
assert.match(
  helper,
  /readonly HELPER_PATH='\/usr\/local\/sbin\/fetanagent-production-deploy-helper'/u,
);
assert.match(helper, /sha256sum "\$HELPER_PATH"/u);
assert.match(helper, /current-state\)/u);
assert.match(helper, /cleanup-incoming\)/u);
assert.match(helper, /rollback_transition/u);
assert.match(helper, /chown 10001:10001 "\$incoming\/secrets"\/\*/u);
assert.match(helper, /'10001:10001:400'/u);
assert.match(helper, /'0:0:444'/u);
assert.match(helper, /compose_release "\$release" up --detach --no-build --wait/u);
assert.match(helper, /Private production control/u);
assert.match(helper, /quiesce_legacy_telebirr_bridge/u);
assert.match(helper, /restore_legacy_telebirr_bridge/u);
assert.match(helper, /negative_telebirr_public_smoke/u);
assert.match(helper, /negative_companion_public_smoke/u);
assert.match(helper, /expected_count=29/u);
assert.match(helper, /expected_count=32/u);
assert.match(helper, /images\+=\(companion-device-bridge\)/u);
assert.match(helper, /services\+=\(production-companion-device-bridge\)/u);
assert.match(
  helper,
  /if grep -Fq 'apps\/bot\/dist\/telegram-polling-healthcheck\.js' "\$release\/compose\.production\.yaml"; then[\s\S]*?die 'the Telegram bot has no recent successful polling check'/u,
);
assert.match(helper, /Legacy release: Telegram polling health is unverified/u);
assert.match(helper, /LEGACY_TELEBIRR_PROJECT='fetanagent-telebirr-device-pilot'/u);
assert.match(helper, /finalize\)/u);
assert.doesNotMatch(helper, /curl[^\r\n]*-k\b|StrictHostKeyChecking=no|2026-09-0/u);

const helperDigest = createHash('sha256').update(helper).digest('hex');
assert.equal(
  sudoers,
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${helperDigest} /usr/local/sbin/fetanagent-production-deploy-helper *\n`,
  'sudoers must bind the restricted deploy account to this exact helper digest',
);

for (const role of [
  'fetanagent_beta_admission_runtime',
  'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime',
  'fetanagent_player_actions_runtime',
  'fetanagent_telebirr_assignment_broker_runtime',
  'fetanagent_telebirr_device_state_runtime',
]) {
  assert.match(provisionSql, new RegExp(`alter role ${role} with login password`, 'u'));
  assert.match(disableSql, new RegExp(`alter role ${role} nologin password null`, 'u'));
}
assert.equal(count(provisionSql, /valid until 'infinity'/gu), 6);
assert.match(provisionSql, /count\(distinct credential\) = 6/u);
assert.doesNotMatch(provisionSql, /pg_catalog\.array\(/u);
assert.match(provisionSql, /rolvaliduntil = 'infinity'::timestamptz/u);
assert.match(provisionSql, /where mode <> 'disabled'/u);
assert.match(provisionSql, /Financial runtime logins must remain disabled/u);
assert.match(provisionSql, /begin transaction isolation level serializable/u);
assert.match(disableSql, /begin transaction isolation level serializable/u);
assert.doesNotMatch(`${provisionSql}\n${disableSql}`, /2026-09-0|interval '24 hours'/u);

assert.match(packageJson, /node infra\/verify-production-runtime\.mjs/u);
assert.match(quality, /bash -n infra\/operations\/fetanagent-production-deploy-helper\.sh/u);
assert.match(quality, /--file infra\/compose\.production\.yaml/u);
assert.match(quality, /--profile production config --quiet/u);
assert.match(
  quality,
  /node --test infra\/operations\/prepare-production-companion-bundle\.test\.mjs/u,
);
assert.match(workflow, /node infra\/operations\/prepare-production-companion-bundle\.mjs/u);
assert.match(workflow, /COMPANION_PREVIOUS_LOGIN/u);
assert.match(workflow, /production-companion-runtime-disable\.sql/u);
assert.match(
  disableSql,
  /alter role fetanagent_companion_device_bridge_runtime nologin password null/u,
);
const companionTrust = await read('infra/sql/production-companion-server-signer-provision.sql');
const companionLogin = await read(
  'infra/sql/production-companion-bridge-runtime-enable-continuous.sql',
);
for (const sql of [companionTrust, companionLogin]) {
  assert.match(sql, /xzztugbgtulptnbpoelr/u);
  assert.match(sql, /begin transaction isolation level serializable/u);
  assert.match(sql, /financial_features_safe/u);
  assert.doesNotMatch(sql, /staging|spzpiyxheappsfyswewl|supabase_admin/u);
}
assert.match(companionTrust, /companion-server-production-v1/u);
assert.match(companionTrust, /exact_safe_replay/u);
assert.match(companionTrust, /server_signer_revocations/u);
assert.match(companionLogin, /rolconnlimit = 1/u);
assert.match(companionLogin, /not role\.rolbypassrls/u);
assert.match(companionLogin, /not membership\.set_option/u);
assert.match(companionLogin, /role\.rolvaliduntil = 'infinity'::timestamptz/u);

console.log(
  'Production runtime verified: production-only target binding, permanent least-privilege logins, sealed secrets, non-root web and Android enrollment services, fail-closed financial authority, atomic public cutover, and rollback.',
);
