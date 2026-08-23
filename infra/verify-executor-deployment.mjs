import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const infraDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const compose = await readFile(`${infraDirectory}compose.executor.yaml`, 'utf8');
const dockerfile = await readFile(`${repositoryRoot}Dockerfile`, 'utf8');
const executorImageSmokeWorkflow = await readFile(
  `${repositoryRoot}.github/workflows/executor-image-smoke.yml`,
  'utf8',
);
const provisionSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-session-provision.ts`,
  'utf8',
);
const privateSessionProvisionServerSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-session-provision-server.ts`,
  'utf8',
);
const noTransferReadinessSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-no-transfer-readiness.ts`,
  'utf8',
);
const noTransferReadinessSealSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-no-transfer-readiness-seal.ts`,
  'utf8',
);
const reviewedSelectorContract = JSON.parse(
  await readFile(`${infraDirectory}config/kemerbet-selector-contract.v2.json`, 'utf8'),
);
const registrySource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-agent-session-registry.ts`,
  'utf8',
);
const postgresRuntimeSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-deposit-postgres-runtime.ts`,
  'utf8',
);
const executorApplicationSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-executor-application.ts`,
  'utf8',
);
const executorConfigSource = await readFile(
  `${repositoryRoot}packages/config/src/executor.ts`,
  'utf8',
);
const executorPackage = JSON.parse(
  await readFile(`${repositoryRoot}apps/executor/package.json`, 'utf8'),
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(value, expression) {
  return [...value.matchAll(expression)].length;
}

function topLevelSection(value, name) {
  const header = new RegExp(`^${escapeRegExp(name)}:\\s*$`, 'm').exec(value);
  assert.ok(header, `missing top-level ${name} section`);
  const start = header.index + header[0].length;
  const remainder = value.slice(start);
  const next = /^\S[^\r\n]*:\s*$/m.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function childBlock(section, name) {
  const header = new RegExp(`^  ${escapeRegExp(name)}:\\s*$`, 'm').exec(section);
  assert.ok(header, `missing ${name} block`);
  const start = header.index + header[0].length;
  const remainder = section.slice(start);
  const next = /^  [a-z][a-z0-9_-]*:\s*$/m.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function servicePropertyBlock(service, name) {
  const header = new RegExp(`^    ${escapeRegExp(name)}:\\s*$`, 'm').exec(service);
  assert.ok(header, `missing service ${name} block`);
  const start = header.index + header[0].length;
  const remainder = service.slice(start);
  const next = /^    [a-z][a-z0-9_-]*:\s*/m.exec(remainder);
  return remainder.slice(0, next?.index ?? remainder.length);
}

function sourceNames(block) {
  return [...block.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]);
}

function environmentNames(block) {
  return [...block.matchAll(/^\s{6}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]);
}

function isImmutableExecutorImageReference(value) {
  return /^[^\s@]+@sha256:[0-9a-f]{64}$/u.test(value);
}

assert.equal(
  isImmutableExecutorImageReference(
    `registry.example/fetanagent/executor@sha256:${'a'.repeat(64)}`,
  ),
  true,
);
for (const invalid of [
  'fetanagent-deposit-executor:latest',
  `fetanagent-deposit-executor@sha256:${'A'.repeat(64)}`,
  `fetanagent-deposit-executor@sha256:${'a'.repeat(63)}`,
  `fetanagent-deposit-executor@sha512:${'a'.repeat(64)}`,
]) {
  assert.equal(isImmutableExecutorImageReference(invalid), false);
}
const suppliedImageReference = process.env.FETANAGENT_EXECUTOR_IMAGE_REFERENCE;
const suppliedDeploymentTarget = process.env.FETANAGENT_EXECUTOR_DEPLOYMENT_TARGET;
assert.equal(
  suppliedImageReference === undefined,
  suppliedDeploymentTarget === undefined,
  'activation verification requires both the immutable image reference and explicit target',
);
if (suppliedImageReference !== undefined) {
  assert.equal(
    isImmutableExecutorImageReference(suppliedImageReference),
    true,
    'FETANAGENT_EXECUTOR_IMAGE_REFERENCE must be one repository@sha256:<64 lowercase hex> reference',
  );
}
if (suppliedDeploymentTarget !== undefined) {
  assert.match(
    suppliedDeploymentTarget,
    /^(?:staging|production)$/u,
    'FETANAGENT_EXECUTOR_DEPLOYMENT_TARGET must be explicit',
  );
}

function assertCommonContainerHardening(name, service) {
  assert.match(service, /platform: linux\/amd64/, `${name} must pin linux/amd64`);
  assert.match(
    service,
    /image: \$\{FETANAGENT_EXECUTOR_IMAGE_REFERENCE:\?set the reviewed repository@sha256 immutable image reference\}/,
  );
  assert.match(service, /pull_policy: always/);
  assert.doesNotMatch(service, /^    build:|^      context:|^      dockerfile:|^      target:/m);
  assert.match(service, /init: true/);
  assert.match(service, /user: '10001:10001'/);
  assert.match(service, /read_only: true/);
  assert.match(service, /\/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777/);
  assert.match(service, /shm_size: 512m/);
  assert.match(service, /cap_drop:\s*\r?\n\s+- ALL/);
  assert.match(service, /security_opt:\s*\r?\n\s+- no-new-privileges:true/);
  assert.match(service, /pids_limit: 512/);
  assert.match(service, /mem_limit: 1536m/);
  assert.match(service, /cpus: 2\.0/);
  assert.match(service, /stop_grace_period: 60s/);
  assert.match(service, /networks:\s*\r?\n\s+- executor_egress/);
  assert.doesNotMatch(service, /^\s+(?:ports|expose|devices|privileged|network_mode|ipc):/m);
}

assert.match(compose, /^name: fetanagent-deposit-executor$/m);

const services = topLevelSection(compose, 'services');
const executorService = childBlock(services, 'executor');
const provisionService = childBlock(services, 'session-provision');
const noTransferReadinessService = childBlock(services, 'no-transfer-readiness');
const networks = topLevelSection(compose, 'networks');
const secrets = topLevelSection(compose, 'secrets');
const configs = topLevelSection(compose, 'configs');

assert.deepEqual(
  [...services.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]),
  ['executor', 'session-provision', 'no-transfer-readiness'],
  'the dedicated deployment may define only the executor and two transient no-money tools',
);
assert.equal(
  countMatches(services, /^    profiles:\s*\[/gm),
  3,
  'all services must remain inert without an explicit profile',
);
assert.match(executorService, /profiles: \[executor\]/);
assert.match(provisionService, /profiles: \[executor-session-provision\]/);
assert.match(noTransferReadinessService, /profiles: \[executor-no-transfer-readiness\]/);
assert.doesNotMatch(executorService, /executor-session-provision/);
assert.doesNotMatch(provisionService, /profiles: \[executor\]/);

assertCommonContainerHardening('executor', executorService);
assertCommonContainerHardening('session-provision', provisionService);
assertCommonContainerHardening('no-transfer-readiness', noTransferReadinessService);
assert.equal(
  countMatches(compose, /^    image: \$\{FETANAGENT_EXECUTOR_IMAGE_REFERENCE:/gm),
  3,
  'all services must consume the same single immutable image-reference input',
);
assert.doesNotMatch(compose, /FETANAGENT_EXECUTOR_IMAGE_TAG|^\s+build:\s*$|pull_policy: never/m);

assert.match(executorService, /restart: unless-stopped/);
assert.match(provisionService, /restart: 'no'/);
assert.match(noTransferReadinessService, /restart: 'no'/);
assert.match(executorService, /logging:\s*\r?\n\s+driver: json-file/);
assert.match(executorService, /max-size: 10m/);
assert.match(executorService, /max-file: '5'/);

const executorDeploy = servicePropertyBlock(executorService, 'deploy');
assert.equal(executorDeploy.trim(), 'replicas: 1', 'the executor must remain a single replica');
assert.doesNotMatch(provisionService, /^    deploy:/m);
assert.doesNotMatch(noTransferReadinessService, /^    deploy:/m);

const executorEnvironment = servicePropertyBlock(executorService, 'environment');
assert.deepEqual(environmentNames(executorEnvironment), [
  'NODE_ENV',
  'LOG_LEVEL',
  'FINANCIAL_ACTIONS_MODE',
  'KEMERBET_EXECUTOR_ENABLED',
  'KEMERBET_FINAL_ACTION_ENABLED',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE',
  'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
  'KEMERBET_EXECUTOR_DEPLOYMENT_TARGET',
  'KEMERBET_EXECUTOR_DATABASE_URL_FILE',
  'KEMERBET_AGENT_IDENTITY_BINDINGS_FILE',
  'KEMERBET_AGENT_PROFILES_ROOT',
  'KEMERBET_BROWSER_EXECUTABLE_PATH',
  'KEMERBET_SELECTOR_CONTRACT_FILE',
  'KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE',
  'KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE',
  'NODE_EXTRA_CA_CERTS',
  'EXECUTOR_HEALTH_HOST',
  'EXECUTOR_HEALTH_PORT',
]);
for (const requiredSetting of [
  /NODE_ENV: production/,
  /LOG_LEVEL: info/,
  /FINANCIAL_ACTIONS_MODE: live/,
  /KEMERBET_EXECUTOR_ENABLED: 'true'/,
  /KEMERBET_FINAL_ACTION_ENABLED: 'true'/,
  /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'true'/,
  /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE: \/run\/configs\/private_live_deposit_pilot\.v1\.json/,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true'/,
  /KEMERBET_EXECUTOR_DEPLOYMENT_TARGET: \$\{FETANAGENT_EXECUTOR_DEPLOYMENT_TARGET:\?set staging or production\}/,
  /KEMERBET_EXECUTOR_DATABASE_URL_FILE: \/run\/secrets\/kemerbet_executor_database_url/,
  /KEMERBET_AGENT_IDENTITY_BINDINGS_FILE: \/run\/secrets\/kemerbet_agent_identity_bindings/,
  /KEMERBET_AGENT_PROFILES_ROOT: \/var\/lib\/fetanagent\/kemerbet-sessions/,
  /KEMERBET_BROWSER_EXECUTABLE_PATH: \/usr\/bin\/chromium/,
  /KEMERBET_SELECTOR_CONTRACT_FILE: \/etc\/fetanagent\/kemerbet-selector-contract\.v2\.json/,
  /KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE: \/run\/secrets\/kemerbet_history_reference_hmac_key/,
  /KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE: \/run\/secrets\/kemerbet_agent_identity_hmac_key/,
  /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/,
  /EXECUTOR_HEALTH_HOST: 127\.0\.0\.1/,
  /EXECUTOR_HEALTH_PORT: '8090'/,
]) {
  assert.match(executorEnvironment, requiredSetting);
}
assert.doesNotMatch(executorEnvironment, /^\s+KEMERBET_EXECUTOR_DATABASE_URL:/m);

const executorSecrets = servicePropertyBlock(executorService, 'secrets');
assert.deepEqual(sourceNames(executorSecrets), [
  'kemerbet_executor_database_url',
  'kemerbet_agent_identity_bindings',
  'kemerbet_history_reference_hmac_key',
  'kemerbet_agent_identity_hmac_key',
]);
for (const secretName of sourceNames(executorSecrets)) {
  assert.match(
    executorSecrets,
    new RegExp(
      `source: ${escapeRegExp(secretName)}\\s*\\r?\\n\\s+target: ${escapeRegExp(secretName)}\\s*\\r?\\n\\s+uid: '10001'\\s*\\r?\\n\\s+gid: '10001'\\s*\\r?\\n\\s+mode: 0400`,
    ),
  );
}

const executorConfigs = servicePropertyBlock(executorService, 'configs');
assert.deepEqual(sourceNames(executorConfigs), [
  'private_live_deposit_pilot_manifest',
  'kemerbet_selector_contract',
  'supabase_ca_certificate',
]);
assert.match(
  executorConfigs,
  /source: private_live_deposit_pilot_manifest\s*\r?\n\s+target: \/run\/configs\/private_live_deposit_pilot\.v1\.json\s*\r?\n\s+uid: '10001'\s*\r?\n\s+gid: '10001'\s*\r?\n\s+mode: 0444/,
);
assert.match(
  executorConfigs,
  /source: kemerbet_selector_contract\s*\r?\n\s+target: \/etc\/fetanagent\/kemerbet-selector-contract\.v2\.json\s*\r?\n\s+uid: '10001'\s*\r?\n\s+gid: '10001'\s*\r?\n\s+mode: 0444/,
);
assert.match(
  executorConfigs,
  /source: supabase_ca_certificate\s*\r?\n\s+target: \/run\/configs\/supabase_ca_certificate\s*\r?\n\s+uid: '10001'\s*\r?\n\s+gid: '10001'\s*\r?\n\s+mode: 0444/,
);

const executorVolumes = servicePropertyBlock(executorService, 'volumes');
assert.equal(countMatches(executorVolumes, /^\s+- type: bind$/gm), 1);
assert.match(
  executorVolumes,
  /source: \/var\/lib\/fetanagent\/kemerbet-sessions\s*\r?\n\s+target: \/var\/lib\/fetanagent\/kemerbet-sessions\s*\r?\n\s+read_only: false/,
);
assert.doesNotMatch(executorService, /\.X11-unix|kemerbet_session_xauthority|stdin_open|tty:/);

const executorHealth = servicePropertyBlock(executorService, 'healthcheck');
assert.match(executorHealth, /http:\/\/127\.0\.0\.1:8090\/readyz/);
assert.match(executorHealth, /interval: 60s/);
assert.match(executorHealth, /timeout: 45s/);
assert.match(executorHealth, /start_period: 120s/);
assert.match(executorHealth, /retries: 3/);

assert.match(
  provisionService,
  /command: \['node', 'apps\/executor\/dist\/kemerbet-session-provision\.js'\]/,
);
assert.match(provisionService, /stdin_open: true/);
assert.match(provisionService, /tty: true/);
assert.doesNotMatch(provisionService, /^    (?:configs|deploy):/m);
assert.match(provisionService, /healthcheck:\s*\r?\n\s+disable: true/);

const provisionEnvironment = servicePropertyBlock(provisionService, 'environment');
assert.deepEqual(environmentNames(provisionEnvironment), [
  'NODE_ENV',
  'LOG_LEVEL',
  'DISPLAY',
  'XAUTHORITY',
  'KEMERBET_SESSION_PROVISION_ACCOUNT_ID',
]);
assert.match(provisionEnvironment, /NODE_ENV: production/);
assert.match(provisionEnvironment, /LOG_LEVEL: info/);
assert.match(provisionEnvironment, /DISPLAY: \$\{FETANAGENT_KEMERBET_SESSION_DISPLAY:-\}/);
assert.match(provisionEnvironment, /XAUTHORITY: \/run\/secrets\/kemerbet_session_xauthority/);
assert.match(
  provisionEnvironment,
  /KEMERBET_SESSION_PROVISION_ACCOUNT_ID: \$\{FETANAGENT_KEMERBET_AGENT_ACCOUNT_ID:-\}/,
);
assert.doesNotMatch(
  provisionEnvironment,
  /DATABASE|HMAC|IDENTITY_BINDINGS|SELECTOR_CONTRACT|PRIVATE_LIVE_DEPOSIT_PILOT|NODE_EXTRA_CA_CERTS|FINANCIAL_ACTIONS_MODE|KEMERBET_EXECUTOR_ENABLED|KEMERBET_FINAL_ACTION_ENABLED|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED|KEMERBET_EXECUTOR_DEPLOYMENT_TARGET/,
);

assert.match(
  noTransferReadinessService,
  /command: \['node', 'apps\/executor\/dist\/kemerbet-no-transfer-readiness\.js'\]/,
);
assert.match(noTransferReadinessService, /healthcheck:\s*\r?\n\s+disable: true/);
assert.doesNotMatch(noTransferReadinessService, /stdin_open|tty:|\.X11-unix|DISPLAY|XAUTHORITY/);
const noTransferReadinessEnvironment = servicePropertyBlock(
  noTransferReadinessService,
  'environment',
);
assert.deepEqual(environmentNames(noTransferReadinessEnvironment), [
  'NODE_ENV',
  'LOG_LEVEL',
  'FINANCIAL_ACTIONS_MODE',
  'KEMERBET_NO_TRANSFER_READINESS_ENABLED',
  'KEMERBET_EXECUTOR_ENABLED',
  'KEMERBET_FINAL_ACTION_ENABLED',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED',
  'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
]);
for (const requiredSetting of [
  /NODE_ENV: production/,
  /FINANCIAL_ACTIONS_MODE: dry_run/,
  /KEMERBET_NO_TRANSFER_READINESS_ENABLED: 'true'/,
  /KEMERBET_EXECUTOR_ENABLED: 'false'/,
  /KEMERBET_FINAL_ACTION_ENABLED: 'false'/,
  /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false'/,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false'/,
]) {
  assert.match(noTransferReadinessEnvironment, requiredSetting);
}
assert.doesNotMatch(
  noTransferReadinessService,
  /kemerbet_executor_database_url|kemerbet_history_reference_hmac_key|private_live_deposit_pilot_manifest|supabase_ca_certificate|NODE_EXTRA_CA_CERTS|FINANCIAL_ACTIONS_MODE: live|KEMERBET_EXECUTOR_ENABLED: 'true'|KEMERBET_FINAL_ACTION_ENABLED: 'true'|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'true'|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true'/,
  'no-transfer readiness must have no database, pilot, history, or live-action capability',
);
const noTransferReadinessSecrets = servicePropertyBlock(noTransferReadinessService, 'secrets');
assert.deepEqual(sourceNames(noTransferReadinessSecrets), [
  'kemerbet_agent_identity_bindings',
  'kemerbet_agent_identity_hmac_key',
  'kemerbet_no_transfer_readiness_player_ids',
]);
for (const secretName of sourceNames(noTransferReadinessSecrets)) {
  assert.match(
    noTransferReadinessSecrets,
    new RegExp(
      `source: ${escapeRegExp(secretName)}\\s*\\r?\\n\\s+target: ${escapeRegExp(secretName)}\\s*\\r?\\n\\s+uid: '10001'\\s*\\r?\\n\\s+gid: '10001'\\s*\\r?\\n\\s+mode: 0400`,
    ),
  );
}
const noTransferReadinessConfigs = servicePropertyBlock(noTransferReadinessService, 'configs');
assert.deepEqual(sourceNames(noTransferReadinessConfigs), ['kemerbet_selector_contract']);
assert.match(
  noTransferReadinessConfigs,
  /source: kemerbet_selector_contract\s*\r?\n\s+target: \/etc\/fetanagent\/kemerbet-selector-contract\.v2\.json\s*\r?\n\s+uid: '10001'\s*\r?\n\s+gid: '10001'\s*\r?\n\s+mode: 0444/,
);
const noTransferReadinessVolumes = servicePropertyBlock(noTransferReadinessService, 'volumes');
assert.equal(countMatches(noTransferReadinessVolumes, /^\s+- type: bind$/gm), 1);
assert.match(
  noTransferReadinessVolumes,
  /source: \/var\/lib\/fetanagent\/kemerbet-sessions\s*\r?\n\s+target: \/var\/lib\/fetanagent\/kemerbet-sessions\s*\r?\n\s+read_only: false/,
);

const provisionSecrets = servicePropertyBlock(provisionService, 'secrets');
assert.deepEqual(sourceNames(provisionSecrets), ['kemerbet_session_xauthority']);
assert.match(
  provisionSecrets,
  /source: kemerbet_session_xauthority\s*\r?\n\s+target: kemerbet_session_xauthority\s*\r?\n\s+uid: '10001'\s*\r?\n\s+gid: '10001'\s*\r?\n\s+mode: 0400/,
);

const provisionVolumes = servicePropertyBlock(provisionService, 'volumes');
assert.equal(countMatches(provisionVolumes, /^\s+- type: bind$/gm), 2);
assert.match(
  provisionVolumes,
  /source: \/var\/lib\/fetanagent\/kemerbet-sessions\s*\r?\n\s+target: \/var\/lib\/fetanagent\/kemerbet-sessions\s*\r?\n\s+read_only: false/,
);
assert.match(
  provisionVolumes,
  /source: \/tmp\/\.X11-unix\s*\r?\n\s+target: \/tmp\/\.X11-unix\s*\r?\n\s+read_only: true/,
);
assert.doesNotMatch(
  provisionService,
  /kemerbet_executor_database_url|kemerbet_agent_identity_bindings|kemerbet_history_reference_hmac_key|kemerbet_agent_identity_hmac_key|private_live_deposit_pilot_manifest|kemerbet_selector_contract|supabase_ca_certificate|NODE_EXTRA_CA_CERTS|FINANCIAL_ACTIONS_MODE: live|KEMERBET_EXECUTOR_ENABLED: 'true'|KEMERBET_FINAL_ACTION_ENABLED: 'true'|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'true'|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'true'/,
  'session provisioning must have no database, HMAC, binding, selector, or live-action capability',
);

assert.deepEqual(
  [...networks.matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gm)].map((match) => match[1]),
  ['executor_egress'],
);
const executorNetwork = childBlock(networks, 'executor_egress');
assert.match(executorNetwork, /driver: bridge/);
assert.match(executorNetwork, /enable_ipv6: true/);
assert.match(executorNetwork, /internal: false/);
assert.match(executorNetwork, /attachable: false/);

const expectedSecretDeclarations = [
  'kemerbet_executor_database_url',
  'kemerbet_agent_identity_bindings',
  'kemerbet_history_reference_hmac_key',
  'kemerbet_agent_identity_hmac_key',
  'kemerbet_session_xauthority',
  'kemerbet_no_transfer_readiness_player_ids',
];
assert.deepEqual(
  [...secrets.matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gm)].map((match) => match[1]),
  expectedSecretDeclarations,
);
for (const secretName of expectedSecretDeclarations) {
  assert.match(secrets, new RegExp(`^  ${escapeRegExp(secretName)}:\\s*$`, 'm'));
}
assert.match(secrets, /FETANAGENT_EXECUTOR_DATABASE_URL_FILE/);
assert.match(secrets, /FETANAGENT_KEMERBET_AGENT_IDENTITY_BINDINGS_FILE/);
assert.match(secrets, /FETANAGENT_KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE/);
assert.match(secrets, /FETANAGENT_KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE/);
assert.match(secrets, /FETANAGENT_KEMERBET_SESSION_XAUTHORITY_FILE/);
assert.match(secrets, /FETANAGENT_KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE/);
assert.match(
  secrets,
  /FETANAGENT_EXECUTOR_DATABASE_URL_FILE:-\/etc\/fetanagent\/executor-secrets\/kemerbet_executor_database_url/,
);
assert.match(
  secrets,
  /FETANAGENT_KEMERBET_SESSION_XAUTHORITY_FILE:-\/etc\/fetanagent\/session-provision\/kemerbet_session_xauthority/,
);

assert.deepEqual(
  [...configs.matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gm)].map((match) => match[1]),
  ['private_live_deposit_pilot_manifest', 'kemerbet_selector_contract', 'supabase_ca_certificate'],
);
assert.match(configs, /FETANAGENT_KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE/);
assert.match(
  configs,
  /FETANAGENT_KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE:-\/etc\/fetanagent\/executor-config\/private_live_deposit_pilot\.v1\.json/,
);
assert.match(configs, /FETANAGENT_KEMERBET_SELECTOR_CONTRACT_FILE/);
assert.match(
  configs,
  /FETANAGENT_KEMERBET_SELECTOR_CONTRACT_FILE:-\/etc\/fetanagent\/executor-config\/kemerbet-selector-contract\.v2\.json/,
);
assert.match(configs, /FETANAGENT_SUPABASE_CA_CERTIFICATE_FILE/);
assert.match(
  configs,
  /FETANAGENT_SUPABASE_CA_CERTIFICATE_FILE:-\/etc\/fetanagent\/executor-config\/supabase-ca-certificate\.crt/,
);

assert.equal(countMatches(compose, /^\s+mode: 0400$/gm), 8);
assert.equal(countMatches(compose, /^\s+mode: 0444$/gm), 4);
assert.equal(countMatches(compose, /^\s+uid: '10001'$/gm), 12);
assert.equal(countMatches(compose, /^\s+gid: '10001'$/gm), 12);
assert.doesNotMatch(compose, /^volumes:\s*$/m, 'named volumes are forbidden');
assert.doesNotMatch(compose, /^\s+(?:ports|expose|devices|privileged|network_mode|ipc):/m);
assert.doesNotMatch(compose, /docker\.sock|\/var\/run\/docker|service_role|telegram/i);
assert.doesNotMatch(compose, /staging_service|owner_control_service/);
assert.doesNotMatch(compose, /spzpiyxheappsfyswewl|xzztugbgtulptnbpoelr/i);

assert.match(dockerfile, /FROM build-base AS executor-build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/executor\.\.\. run build/);
assert.match(dockerfile, /FROM runtime-base AS executor-runtime-base/);
assert.match(dockerfile, /ARG FETANAGENT_CHROMIUM_PACKAGE_VERSION/);
assert.match(dockerfile, /test -n "\$\{FETANAGENT_CHROMIUM_PACKAGE_VERSION\}"/);
assert.match(
  dockerfile,
  /apt-get install --yes --no-install-recommends ca-certificates "chromium=\$\{FETANAGENT_CHROMIUM_PACKAGE_VERSION\}" fonts-liberation/,
);
assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
assert.match(dockerfile, /ENV HOME=\/tmp/);

const executorRuntimeBase = dockerfile
  .split('FROM runtime-base AS executor-runtime-base')[1]
  ?.split('FROM executor-runtime-base AS executor')[0];
assert.ok(executorRuntimeBase, 'missing executor runtime base body');
assert.match(executorRuntimeBase, /USER root/);
assert.match(executorRuntimeBase, /USER 10001:10001/);

const executorImage = dockerfile
  .split('FROM executor-runtime-base AS executor')[1]
  ?.split('FROM --platform=linux/amd64 caddy:')[0];
assert.ok(executorImage, 'missing executor image body');
assert.match(executorImage, /org\.opencontainers\.image\.title="fetanagent-deposit-executor"/);
assert.match(executorImage, /org\.opencontainers\.image\.revision="\$\{VCS_REF\}"/);
assert.match(
  executorImage,
  /org\.opencontainers\.image\.chromium-package-version="\$\{FETANAGENT_CHROMIUM_PACKAGE_VERSION\}"/,
);
assert.match(
  executorImage,
  /COPY --from=executor-build --chown=10001:10001 \/workspace\/node_modules/,
);
assert.match(executorImage, /COPY --from=executor-build --chown=10001:10001 \/workspace\/packages/);
assert.match(
  executorImage,
  /COPY --from=executor-build --chown=10001:10001 \/workspace\/apps\/executor \.\/apps\/executor/,
);
assert.match(executorImage, /HEALTHCHECK .*127\.0\.0\.1:8090\/readyz/);
assert.match(executorImage, /HEALTHCHECK --interval=60s --timeout=45s --start-period=120s/);
assert.match(executorImage, /CMD \["node", "apps\/executor\/dist\/index\.js"\]/);
assert.match(executorImage, /playwright-core\/browsers\.json/);
assert.match(executorImage, /entry\.name==='chromium'/);
assert.ok(executorImage.includes("actual.startsWith('Chromium '+expected+'.')"));
assert.doesNotMatch(executorImage, /\bEXPOSE\b|docker\.sock|\/run\/secrets/);

const executorSmokeTriggers = topLevelSection(executorImageSmokeWorkflow, 'on');
assert.deepEqual(
  [...executorSmokeTriggers.matchAll(/^  ([a-z][a-z_]*)\s*:\s*$/gm)].map((match) => match[1]),
  ['push', 'pull_request'],
  'the executor image smoke must run only for main pushes and pull requests',
);
for (const trigger of ['push', 'pull_request']) {
  assert.match(
    executorSmokeTriggers,
    new RegExp(
      `^  ${escapeRegExp(trigger)}:\\s*\\r?\\n    branches:\\s*\\r?\\n      - main\\s*$`,
      'm',
    ),
  );
}
assert.doesNotMatch(
  executorImageSmokeWorkflow,
  /^\s*(?:workflow_dispatch|schedule|workflow_call|repository_dispatch):/m,
);

const executorBaseImage =
  /^FROM --platform=linux\/amd64 (node:[^\s]+@sha256:[0-9a-f]{64}) AS build-base$/m.exec(
    dockerfile,
  )?.[1];
assert.ok(executorBaseImage, 'missing pinned executor build base image');
assert.match(
  executorImageSmokeWorkflow,
  new RegExp(`EXECUTOR_BASE_IMAGE:\\s*${escapeRegExp(executorBaseImage)}`),
);
assert.match(executorImageSmokeWorkflow, /apt-cache policy chromium/);
assert.match(
  executorImageSmokeWorkflow,
  /docker build --pull=false --target executor[\s\S]*--build-arg "VCS_REF=\$GITHUB_SHA"[\s\S]*--build-arg "FETANAGENT_CHROMIUM_PACKAGE_VERSION=\$CHROMIUM_PACKAGE_VERSION"/,
);
assert.match(
  executorImageSmokeWorkflow,
  /org\.opencontainers\.image\.revision[\s\S]*= "\$GITHUB_SHA"/,
);
assert.match(
  executorImageSmokeWorkflow,
  /org\.opencontainers\.image\.chromium-package-version[\s\S]*=\s*\\?[\r\n\s]*"\$CHROMIUM_PACKAGE_VERSION"/,
);
assert.match(executorImageSmokeWorkflow, /'10001:10001'/);
assert.match(executorImageSmokeWorkflow, /'\["node","apps\/executor\/dist\/index\.js"\]'/);

assert.match(
  executorImageSmokeWorkflow,
  /docker run --rm --network none --read-only[\s\S]*"\$EXECUTOR_IMAGE" 2>&1/,
);
assert.match(executorImageSmokeWorkflow, /test "\$startup_status" -eq 1/);
assert.match(
  executorImageSmokeWorkflow,
  /grep -Fx 'FetanAgent deposit executor failed closed\.' <<<"\$startup_output"/,
);
assert.match(
  executorImageSmokeWorkflow,
  /docker run --detach --name "\$container_name" --network none --read-only/,
);
assert.match(
  executorImageSmokeWorkflow,
  /import\([\s\S]*apps\/executor\/dist\/executor-health\.js[\s\S]*\)/,
);
assert.match(
  executorImageSmokeWorkflow,
  /import\([\s\S]*apps\/executor\/dist\/executor-health-server\.js[\s\S]*\)/,
);
assert.match(executorImageSmokeWorkflow, /platformAgentAccountIds: \[\]/);
assert.match(executorImageSmokeWorkflow, /probeDatabase: forbiddenProbe/);
assert.match(executorImageSmokeWorkflow, /probeSessionReadiness: forbiddenProbe/);
assert.match(executorImageSmokeWorkflow, /health\.status !== 200/);
assert.match(executorImageSmokeWorkflow, /readiness\.status !== 503/);
assert.match(executorImageSmokeWorkflow, /readinessBody\.reason !== 'sessions_not_configured'/);

assert.doesNotMatch(executorImageSmokeWorkflow, /\$\{\{\s*secrets\./);
const executorSmokeDockerRuns = [
  ...executorImageSmokeWorkflow.matchAll(/^\s*docker run\b[^\r\n]*(?:\\\r?\n[^\r\n]*)*/gm),
].map((match) => match[0]);
assert.equal(executorSmokeDockerRuns.length, 3, 'unexpected executor image smoke container');
const requiredExecutorSmokeEnvironment = new Map([
  ['NODE_ENV', 'production'],
  ['FINANCIAL_ACTIONS_MODE', 'dry_run'],
  ['KEMERBET_EXECUTOR_ENABLED', 'false'],
  ['KEMERBET_FINAL_ACTION_ENABLED', 'false'],
]);
for (const dockerRun of executorSmokeDockerRuns) {
  assert.doesNotMatch(dockerRun, /--mount\b|--volume\b|(?:^|\s)-v(?:\s|=)/m);
  assert.doesNotMatch(dockerRun, /--env-file\b/);
  assert.doesNotMatch(dockerRun, /(?:^|\s)-e(?:\s|=|[^\s\\])/m);

  if (!dockerRun.includes('$EXECUTOR_IMAGE')) {
    assert.doesNotMatch(
      dockerRun,
      /--env\b|(?:^|\s)-e(?:\s|=|[^\s\\])/m,
      'non-executor image smoke runs must not inject environment values',
    );
    continue;
  }

  const environmentOptionCount = [...dockerRun.matchAll(/--env\b/g)].length;
  const environmentAssignments = [...dockerRun.matchAll(/--env(?:\s+|=)([^\s\\]+)/g)].map(
    (match) => match[1],
  );
  assert.equal(
    environmentAssignments.length,
    environmentOptionCount,
    'executor image smoke environment options must use explicit NAME=value assignments',
  );
  const parsedEnvironment = environmentAssignments.map((assignment) => {
    const separator = assignment.indexOf('=');
    assert.ok(separator > 0, 'executor image smoke environment assignments must name a value');
    return [assignment.slice(0, separator), assignment.slice(separator + 1)];
  });
  assert.equal(
    new Set(parsedEnvironment.map(([name]) => name)).size,
    parsedEnvironment.length,
    'executor image smoke environment assignments must not contain duplicates',
  );
  assert.deepEqual(
    new Map(parsedEnvironment),
    requiredExecutorSmokeEnvironment,
    'executor image smoke must use the exact fail-closed environment assignment set',
  );
}
assert.doesNotMatch(
  executorImageSmokeWorkflow,
  /FINANCIAL_ACTIONS_MODE\s*[:=]\s*live\b/,
  'the executor image smoke must never enable live financial actions',
);
assert.doesNotMatch(
  executorImageSmokeWorkflow,
  /KEMERBET_EXECUTOR_ENABLED\s*[:=]\s*true\b/,
  'the executor image smoke must never enable the executor',
);
assert.doesNotMatch(
  executorImageSmokeWorkflow,
  /KEMERBET_FINAL_ACTION_ENABLED\s*[:=]\s*true\b/,
  'the executor image smoke must never enable final actions',
);
assert.doesNotMatch(
  executorImageSmokeWorkflow,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED/,
  'the executor image smoke must not enable the internal execution runtime',
);
assert.doesNotMatch(
  executorImageSmokeWorkflow,
  /KEMERBET_EXECUTOR_DEPLOYMENT_TARGET/,
  'the executor image smoke must not select a deployment target',
);
assert.doesNotMatch(
  executorImageSmokeWorkflow,
  /\b(?:docker\s+(?:push|compose)|kubectl|helm|ssh|scp|rsync|doctl)\b/,
  'the executor image smoke must not contain a deployment command',
);

assert.equal(executorPackage.dependencies?.['playwright-core'], '1.62.1');
assert.equal(
  executorPackage.scripts?.['session:provision'],
  'node dist/kemerbet-session-provision.js',
);
assert.equal(
  executorPackage.scripts?.['readiness:no-transfer'],
  'node dist/kemerbet-no-transfer-readiness.js',
);
assert.equal(
  executorPackage.scripts?.['readiness:seal'],
  'node dist/kemerbet-no-transfer-readiness-seal.js',
);
assert.match(
  provisionSource,
  /const FIXED_XAUTHORITY_PATH = '\/run\/secrets\/kemerbet_session_xauthority'/,
);
assert.match(provisionSource, /KEMERBET_AGENT_PROFILES_ROOT/);
assert.match(provisionSource, /KEMERBET_BROWSER_EXECUTABLE_PATH/);
assert.match(provisionSource, /environment\.FINANCIAL_ACTIONS_MODE === 'live'/);
assert.match(provisionSource, /environment\.KEMERBET_EXECUTOR_ENABLED === 'true'/);
assert.match(provisionSource, /environment\.KEMERBET_FINAL_ACTION_ENABLED === 'true'/);
assert.match(
  provisionSource,
  /environment\.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED === 'true'/,
);
assert.match(
  provisionSource,
  /environment\.INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED === 'true'/,
);
assert.match(provisionSource, /environment\.XAUTHORITY !== FIXED_XAUTHORITY_PATH/);
assert.match(provisionSource, /KEMERBET_SESSION_PROVISION_ACCOUNT_ID/);
assert.match(provisionSource, /\(stat\.mode & 0o777\) === 0o700/);
assert.match(provisionSource, /mkdir\(profilePath, \{ mode: 0o700 \}\)/);
assert.match(provisionSource, /headless: false/);
assert.match(provisionSource, /chromiumSandbox: true/);
assert.match(provisionSource, /acceptDownloads: false/);
assert.match(provisionSource, /bypassCSP: false/);
assert.match(provisionSource, /ignoreHTTPSErrors: false/);
assert.match(provisionSource, /serviceWorkers: 'block'/);
assert.match(provisionSource, /accountDetailsRedacted: true/);
assert.match(provisionSource, /financialActionAvailable: false/);
assert.doesNotMatch(
  provisionSource,
  /KEMERBET_EXECUTOR_DATABASE_(?:RUNTIME_ROLE|DIRECT_HOST|SECRET_FILE)|KEMERBET_AGENT_IDENTITY_BINDINGS_FILE|KEMERBET_SELECTOR_CONTRACT_FILE|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE|KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE|KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE|loadExecutorConfig|createKemerBetDeposit|runOnce\(|enqueueVerifiedDeposit|fenceDeposit|\.goto\(|\.click\(|\.fill\(|\.selectOption\(/,
  'the manual provisioner must not acquire a database or automated financial-action surface',
);
assert.match(noTransferReadinessSource, /KEMERBET_NO_TRANSFER_READINESS_ENABLED !== 'true'/);
assert.match(noTransferReadinessSource, /FINANCIAL_ACTIONS_MODE !== 'dry_run'/);
assert.match(noTransferReadinessSource, /players\.playerIds\.length !== 5/);
assert.match(noTransferReadinessSource, /bindings\.platformAgentAccountIds\.length !== 1/);
assert.match(noTransferReadinessSource, /probePlayerLookup/);
assert.match(noTransferReadinessSource, /transferDisabled !== true/);
assert.match(noTransferReadinessSource, /identifiersRedacted: true/);
assert.match(noTransferReadinessSource, /moneyMoved: false/);
assert.match(noTransferReadinessSource, /'KEMERBET_HISTORY_REFERENCE_HMAC_KEY_FILE'/);
assert.doesNotMatch(
  noTransferReadinessSource,
  /loadExecutorConfig|createKemerBetDepositService|resolveBrowser|\.prepare\(|submitOnceAfterFence|\.transferOnce\(|\.fillDeposit\(|leaseNext|fenceFinalAction|KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE/,
  'no-transfer readiness source must not acquire execution, amount, transfer, database, or history authority',
);
assert.match(
  noTransferReadinessSealSource,
  /KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED !== 'true'/,
);
assert.match(noTransferReadinessSealSource, /players\.playerIds\.length !== 5/);
assert.match(noTransferReadinessSealSource, /READ_METHODS\.has\(input\.method\)/);
assert.match(noTransferReadinessSealSource, /probePlayerLookup/);
assert.match(noTransferReadinessSealSource, /transferDisabled !== true/);
assert.match(noTransferReadinessSealSource, /identifiersRedacted: true/);
assert.match(noTransferReadinessSealSource, /moneyMoved: false/);
assert.match(
  noTransferReadinessSealSource,
  /const OUTPUT_ROOT = '\/run\/fetanagent-kemerbet-readiness-seal-output'/,
);
assert.match(noTransferReadinessSealSource, /chromiumSandbox: false/);
assert.doesNotMatch(
  noTransferReadinessSealSource,
  /loadExecutorConfig|createKemerBetDepositService|\.prepare\(|submitOnceAfterFence|\.transferOnce\(|\.fillDeposit\(|leaseNext|fenceFinalAction|KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE/,
  'the readiness seal must not acquire execution, amount, transfer, database, or history authority',
);
assert.equal(reviewedSelectorContract.version, 2);
assert.deepEqual(reviewedSelectorContract.depositWorkflow.depositMenuItem, {
  by: 'role',
  role: 'menuitem',
  name: 'Deposit',
});
assert.match(reviewedSelectorContract.signedInAgentIdentity.root, /rt--header-actions-content/);
assert.equal(reviewedSelectorContract.signedInAgentIdentity.value.source, 'text');
assert.equal(
  reviewedSelectorContract.sessionFailure.signInForm,
  'form.ant-form:has(input#userName):has(input#password[type="password"])',
);
assert.notEqual(reviewedSelectorContract.sessionFailure.signInForm, 'form.ant-form');
assert.match(registrySource, /readonly chromiumSandbox: true/);
assert.match(registrySource, /chromiumSandbox: true/);
assert.doesNotMatch(
  `${registrySource}\n${provisionSource}`,
  /--no-sandbox|--disable-setuid-sandbox/,
);
assert.match(privateSessionProvisionServerSource, /chromiumSandbox: false/);
assert.doesNotMatch(privateSessionProvisionServerSource, /chromiumSandbox: true/);
assert.match(privateSessionProvisionServerSource, /const LOGIN_LIFETIME_MS = 10 \* 60 \* 1_000/);
assert.match(
  privateSessionProvisionServerSource,
  /environment\.KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED !== 'true'/,
);
assert.match(privateSessionProvisionServerSource, /\/v1\/readiness\/seal/);
assert.match(privateSessionProvisionServerSource, /runReadinessSeal\(\{/);
assert.match(privateSessionProvisionServerSource, /FINANCIAL_ACTIONS_MODE: 'dry_run'/);
assert.match(privateSessionProvisionServerSource, /playersChecked: 5/);
assert.match(privateSessionProvisionServerSource, /transferDisabled: true/);
assert.match(privateSessionProvisionServerSource, /moneyMoved: false/);
assert.match(
  privateSessionProvisionServerSource,
  /const AUTHENTICATED_SESSION_LIFETIME_MS = 12 \* 60 \* 60 \* 1_000/,
);
assert.match(
  privateSessionProvisionServerSource,
  /if \(signedIn && !signedInLogged\) \{[\s\S]*?armExpiry\(AUTHENTICATED_SESSION_LIFETIME_MS\)/,
);
assert.match(
  executorConfigSource,
  /KEMERBET_SUPABASE_CA_CERTIFICATE_FILE\s*=\s*\r?\n\s*'\/run\/configs\/supabase_ca_certificate'/,
);
assert.match(
  executorConfigSource,
  /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE\s*=\s*\r?\n\s*'\/run\/configs\/private_live_deposit_pilot\.v1\.json'/,
);
assert.match(executorConfigSource, /environment\.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED/);
assert.match(
  executorConfigSource,
  /environment\.KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_MANIFEST_FILE/,
);
assert.match(
  executorConfigSource,
  /record\.contractVersion !== KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_CONTRACT_VERSION/,
);
assert.match(executorConfigSource, /keys\[0\] !== 'contractVersion'/);
assert.match(executorConfigSource, /keys\[1\] !== 'pilotRevisionId'/);
assert.match(executorConfigSource, /keys\[2\] !== 'configurationDigest'/);
assert.match(
  executorConfigSource,
  /environment\.NODE_EXTRA_CA_CERTS !== KEMERBET_SUPABASE_CA_CERTIFICATE_FILE/,
);
assert.match(executorConfigSource, /KemerBetExecutorDeploymentTarget = 'staging' \| 'production'/);
assert.match(executorConfigSource, /projectReference: 'spzpiyxheappsfyswewl'/);
assert.match(executorConfigSource, /host: 'db\.spzpiyxheappsfyswewl\.supabase\.co'/);
assert.match(executorConfigSource, /projectReference: 'xzztugbgtulptnbpoelr'/);
assert.match(executorConfigSource, /host: 'db\.xzztugbgtulptnbpoelr\.supabase\.co'/);
assert.match(executorConfigSource, /environment\.KEMERBET_EXECUTOR_DEPLOYMENT_TARGET/);
assert.match(executorConfigSource, /url\.hostname !== expectedDatabaseTarget\.host/);

assert.match(postgresRuntimeSource, /pg_catalog\.pg_try_advisory_lock/);
assert.match(postgresRuntimeSource, /pg_catalog\.pg_advisory_unlock/);
assert.match(postgresRuntimeSource, /readonly Client: new/);
assert.match(postgresRuntimeSource, /new Client\(clientConfig\)/);
assert.doesNotMatch(postgresRuntimeSource, /new Pool\(|allowExitOnIdle|idleTimeoutMillis/);
const privatePilotFunctionsBlock = /const PRIVATE_PILOT_FUNCTIONS = \[([\s\S]*?)\] as const;/u.exec(
  postgresRuntimeSource,
);
assert.ok(privatePilotFunctionsBlock, 'missing private-pilot executor function allowlist');
assert.deepEqual(
  [...privatePilotFunctionsBlock[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]),
  [
    'app.lease_next_private_live_deposit_execution(uuid,integer)',
    'app.fence_private_live_deposit_execution_final_action(uuid,uuid,uuid,uuid,uuid)',
  ],
  'the executor must use only the pilot-bound lease and final-action fence',
);
const recoveryFunctionsBlock = /const RECOVERY_FUNCTIONS = \[([\s\S]*?)\] as const;/u.exec(
  postgresRuntimeSource,
);
assert.ok(recoveryFunctionsBlock, 'missing executor recovery function allowlist');
assert.deepEqual(
  [...recoveryFunctionsBlock[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]),
  [
    'app.cancel_deposit_execution_before_action(uuid,uuid,text)',
    'app.require_deposit_execution_reconciliation(uuid,uuid,boolean)',
    'app.lease_next_deposit_execution_reconciliation(uuid,integer)',
    'app.record_deposit_execution_reconciliation(uuid,uuid,text,text,smallint,text,timestamptz,boolean,boolean,boolean,boolean)',
  ],
  'the executor must expose exactly four recovery-only transition procedures',
);
assert.match(
  postgresRuntimeSource,
  /const ALLOWED_FUNCTIONS = \[\.\.\.PRIVATE_PILOT_FUNCTIONS, \.\.\.RECOVERY_FUNCTIONS\] as const;/,
);
assert.doesNotMatch(
  postgresRuntimeSource,
  /app\.lease_next_deposit_execution\(uuid,integer\)|app\.fence_deposit_execution_final_action\(uuid,uuid\)/,
  'the executor must not retain either legacy unscoped lease or final-action fence',
);
assert.doesNotMatch(
  postgresRuntimeSource,
  /enqueue_verified_deposit_execution|enqueueVerifiedDeposit/,
  'the executor startup/runtime surface must not originate execution work',
);
assert.ok(
  executorApplicationSource.indexOf('service = await dependencies.createService') <
    executorApplicationSource.indexOf('await sessionsReady'),
  'the lifetime database singleton must be acquired before any browser session probe',
);

console.log(
  'executor deployment artifacts verified: immutable image activation, explicit database target, lifetime singleton, isolated provisioning, and no public action surface',
);
