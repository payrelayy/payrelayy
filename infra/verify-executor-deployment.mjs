import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const infraDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const compose = await readFile(`${infraDirectory}compose.executor.yaml`, 'utf8');
const executorRunbook = await readFile(`${infraDirectory}executor.md`, 'utf8');
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
const privateSessionProfileGenerationLeaseSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-session-profile-generation-lease.ts`,
  'utf8',
);
const persistentBrowserCheckpointSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-persistent-browser-checkpoint.ts`,
  'utf8',
);
const persistentBrowserCheckpointSmokeSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-persistent-browser-checkpoint-smoke.ts`,
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
const executorRuntimeIsolationSource = await readFile(
  `${repositoryRoot}apps/executor/src/executor-runtime-isolation.ts`,
  'utf8',
);
const playwrightAgentPageSource = await readFile(
  `${repositoryRoot}apps/executor/src/playwright-kemerbet-agent-page.ts`,
  'utf8',
);
const readinessNetworkGateSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-network-gate.ts`,
  'utf8',
);
const readinessBrowserRpcSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-browser-rpc.ts`,
  'utf8',
);
const readinessBrowserDriverSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-browser-driver.ts`,
  'utf8',
);
const readinessLayer7AuthorizationSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-layer7-authorization.ts`,
  'utf8',
);
const readinessLayer7CertificateSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-layer7-certificate.ts`,
  'utf8',
);
const readinessLayer7ProxySource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-layer7-proxy.ts`,
  'utf8',
);
const readinessSameAgentIdentitySource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-same-agent-identity.ts`,
  'utf8',
);
const chromiumProfileSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-chromium-profile.ts`,
  'utf8',
);
const readinessAccountIdSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-account-id.ts`,
  'utf8',
);
const readinessAuthorizationPremintSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-authorization-premint.ts`,
  'utf8',
);
const readinessLayer7AuthorizationsSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-layer7-authorizations.ts`,
  'utf8',
);
const readinessCompletionReceiptSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-completion-receipt.ts`,
  'utf8',
);
const readinessFirewallReleaseSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-firewall-release.ts`,
  'utf8',
);
const readinessLookupResponseSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-player-lookup-response.ts`,
  'utf8',
);
const readinessProfileSnapshotSource = await readFile(
  `${repositoryRoot}apps/executor/src/kemerbet-readiness-profile-snapshot.ts`,
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

function assertOrderedFragments(value, fragments, message) {
  let cursor = 0;
  for (const fragment of fragments) {
    const index = value.indexOf(fragment, cursor);
    assert.notEqual(index, -1, `${message}: missing ${fragment}`);
    cursor = index + fragment.length;
  }
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
assert.match(
  dockerfile,
  /groupadd --gid 10001 fetanagent[\s\S]*?useradd --uid 10001 --gid 10001[\s\S]*?groupadd --gid 10002 fetanagent-readiness-controller[\s\S]*?useradd --uid 10002 --gid 10002[\s\S]*?groupadd --gid 10003 fetanagent-readiness-proxy[\s\S]*?useradd --uid 10003 --gid 10003[\s\S]*?groupadd --gid 10004 fetanagent-readiness-authorizer[\s\S]*?useradd --uid 10004 --gid 10004/,
  'the executor image must contain distinct browser, controller, proxy, and offline-authorizer identities',
);

const executorRuntimeBase = dockerfile
  .split('FROM runtime-base AS executor-runtime-base')[1]
  ?.split('FROM executor-runtime-base AS executor')[0];
assert.ok(executorRuntimeBase, 'missing executor runtime base body');
assert.match(executorRuntimeBase, /USER root/);
assert.match(executorRuntimeBase, /USER 10001:10001/);
for (const proxyName of [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'FTP_PROXY',
  'ftp_proxy',
  'ALL_PROXY',
  'all_proxy',
]) {
  assert.equal(
    countMatches(
      executorRuntimeBase,
      new RegExp(`^\\s+(?:ENV\\s+)?${proxyName}=\\s*(?:\\\\)?$`, 'gmu'),
    ),
    1,
    `the executor runtime image must contain one empty ${proxyName} baseline`,
  );
  assert.match(executorImageSmokeWorkflow, new RegExp(`\\b${proxyName}\\b`, 'u'));
}
assert.match(executorImageSmokeWorkflow, /grep -Fxc "\$proxy_name="/u);

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
const createdContainerSerializationStep =
  /^      - name: Verify exact created-container serialization\r?\n([\s\S]*?)(?=^      - name: )/mu.exec(
    executorImageSmokeWorkflow,
  )?.[1];
assert.ok(
  createdContainerSerializationStep,
  'the executor smoke must retain one isolated created-container serialization step',
);
assert.equal(
  (createdContainerSerializationStep.match(/^\s*docker create\b/gmu) ?? []).length,
  1,
  'the serialization smoke must create exactly one dormant container',
);
assert.doesNotMatch(
  createdContainerSerializationStep,
  /^\s*docker(?:\s+container)?\s+(?:run|start)\b/mu,
  'the serialization smoke must never start or run its dormant container',
);
const createdContainerCleanup = /^\s*trap '\r?\n([\s\S]*?)^\s*' EXIT$/mu.exec(
  createdContainerSerializationStep,
)?.[1];
assert.ok(createdContainerCleanup, 'the serialization smoke must retain an EXIT cleanup trap');
const cleanupContainer = createdContainerCleanup.indexOf('docker rm --force "$container_name"');
const cleanupVolume = createdContainerCleanup.indexOf('docker volume rm "$volume_name"');
const cleanupFiles = createdContainerCleanup.indexOf('rm -f -- "$identity_binding" "$player_ids"');
const cleanupDirectory = createdContainerCleanup.indexOf('rmdir -- "$mount_root"');
assert.ok(
  cleanupContainer >= 0 &&
    cleanupContainer < cleanupVolume &&
    cleanupVolume < cleanupFiles &&
    cleanupFiles < cleanupDirectory,
  'the serialization smoke must clean the container, volume, files, and temporary directory in order',
);
assert.match(
  createdContainerSerializationStep,
  /docker create --name "\$container_name"[\s\S]*--mount "type=bind,[\s\S]*--mount "type=volume,[\s\S]*"\$EXECUTOR_IMAGE" >\/dev\/null/,
  'the executor smoke must create but never start a container with synthetic bind and volume mounts',
);
assert.match(
  createdContainerSerializationStep,
  /actual_mounts="\$\(docker container inspect "\$container_name" --format[\s\S]*?\{\{range \.Mounts\}\}[\s\S]*?\{\{end\}\}'\)"/,
  'the executor smoke must capture Docker mount template output before sorting it',
);
assert.match(
  createdContainerSerializationStep,
  /actual_mounts="\$\(LC_ALL=C sort <<<"\$actual_mounts"\)"/,
  'the executor smoke must normalize the captured mount contract',
);
assert.doesNotMatch(
  createdContainerSerializationStep,
  /\.Mounts\}\}[\s\S]*?\{\{end\}\}' \| LC_ALL=C sort\)"/,
  'the executor smoke must not pipe Docker mount template output directly to sort',
);

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
for (const providerAuthorizationSealContract of [
  /const EXACT_PROVIDER_AUTHORIZATION_OBSERVATIONS = 5/,
  /\^Bearer \[A-Za-z0-9\._~\+\\\/-\]\{16,4096\}=\{0,2\}\$\/u/,
  /\^sha256-provider-authorization-v1:\[0-9a-f\]\{64\}\$\/u/,
  /headersArray\?\(\): Promise<readonly KemerBetReadinessTransportHeader\[\]>/,
  /header\.name\.toLowerCase\(\) === 'authorization'/,
  /authorizations\.length !== 1/,
  /encodedAuthorization = Buffer\.from\(authorization, 'utf8'\)/,
  /createHash\('sha256'\)\.update\(encodedAuthorization\)\.digest\(\)/,
  /timingSafeEqual\(pinnedDigest, candidateDigest\)/,
  /observations !== EXACT_PROVIDER_AUTHORIZATION_OBSERVATIONS/,
  /encodedAuthorization\?\.fill\(0\)/,
  /candidateDigest\?\.fill\(0\)/,
  /pinnedDigest\?\.fill\(0\)/,
  /`sha256-provider-authorization-v1:\$\{pinnedDigest\.toString\('hex'\)\}`/,
]) {
  assert.match(noTransferReadinessSealSource, providerAuthorizationSealContract);
}
const sealRouteHandlerStart = noTransferReadinessSealSource.indexOf(
  'const routeHandler = (route: Route)',
);
const sealExpectedLookupStart = noTransferReadinessSealSource.indexOf(
  'const isCurrentExpectedLookup =',
  sealRouteHandlerStart,
);
const sealExpectedLookupBoundary = noTransferReadinessSealSource.slice(
  sealExpectedLookupStart,
  noTransferReadinessSealSource.indexOf(
    'await applyKemerBetReadinessSealRouteDecision',
    sealExpectedLookupStart,
  ),
);
assertOrderedFragments(
  sealExpectedLookupBoundary,
  [
    'if (isCurrentExpectedLookup && activeExpectedLookupConsumed)',
    'activeExpectedLookupConsumed = true;',
    "typeof request.headersArray !== 'function'",
    'providerAuthorizationDigestTracker.capture(await request.headersArray())',
  ],
  'the exact lookup must synchronously reserve before its duplicate-preserving transport header read',
);
assert.match(
  chromiumProfileSource,
  /const profileStat = await fileSystem\.lstat\(profilePath\);[\s\S]*?\(profileStat\.mode & 0o7777\) !== 0o700[\s\S]*?const defaultState = await pathState\(fileSystem, defaultRoot\);[\s\S]*?if \(defaultState === 'absent'\)[\s\S]*?stableProfileStat\.dev !== profileStat\.dev[\s\S]*?stableProfileStat\.ino !== profileStat\.ino/u,
  'a fresh profile may omit Default only while its exact owned parent directory remains stable',
);
assert.match(
  noTransferReadinessSealSource,
  /const result = await action\(\);[\s\S]*?while \(operations\.size > 0\)[\s\S]*?if \(invalid\(\)\) unavailable\(\);[\s\S]*?if \(!activeExpectedLookupConsumed\) unavailable\(\)/,
  'every exact lookup, including the initial seal without a Layer-7 token, must consume one real GET',
);
assertOrderedFragments(
  noTransferReadinessSealSource.slice(
    noTransferReadinessSealSource.indexOf('finalizeReadOnlyProof: async () => {'),
    noTransferReadinessSealSource.indexOf(
      'close,',
      noTransferReadinessSealSource.indexOf('finalizeReadOnlyProof: async () => {'),
    ),
  ),
  [
    'requestBoundary.completeProviderAuthorizationDigest()',
    'requestBoundary.beginTerminalClose();',
    'await options.close();',
    'await requestBoundary.drain();',
    'requestBoundary.detachAfterOwnerClose();',
    'closed = true;',
    'requestBoundary.destroyProviderAuthorizationDigest();',
  ],
  'the seal must retain its terminal request latch through exact owner-context shutdown and detach only locally afterward',
);
assert.doesNotMatch(
  noTransferReadinessSealSource.slice(
    noTransferReadinessSealSource.indexOf('detachAfterOwnerClose()'),
    noTransferReadinessSealSource.indexOf(
      'async drain()',
      noTransferReadinessSealSource.indexOf('detachAfterOwnerClose()'),
    ),
  ),
  /await options\.removeRoute|\.unroute\(/,
  'post-close detach must never call Playwright unroute on the destroyed Page',
);
assert.match(
  noTransferReadinessSealSource,
  /const EXACT_BINDING_FILE_BYTES = 230[\s\S]*?export function serializeKemerBetNoTransferReadinessAgentIdentityBinding[\s\S]*?const serializedBinding = `\$\{accountId\} \$\{fingerprint\} \$\{agentProfilePin\}\\n`[\s\S]*?Buffer\.byteLength\(serializedBinding, 'utf8'\) !== EXACT_BINDING_FILE_BYTES[\s\S]*?return serializedBinding;[\s\S]*?async function writeBindingAtomically[\s\S]*?serializeKemerBetNoTransferReadinessAgentIdentityBinding[\s\S]*?await handle\.writeFile\(serializedBinding, \{ encoding: 'utf8' \}\)/,
  'the seal output must atomically serialize the exact 230-byte v3 stable-profile binding line',
);
assert.match(
  noTransferReadinessSealSource,
  /written\.nlink !== 1 \|\|[\s\S]*?written\.size !== EXACT_BINDING_FILE_BYTES/,
  'the fsynced temporary v3 binding must be an exact one-link 230-byte file',
);
assert.match(
  noTransferReadinessSealSource,
  /function isExactInstalledBinding[\s\S]*?candidate\.nlink === 1[\s\S]*?candidate\.size === EXACT_BINDING_FILE_BYTES[\s\S]*?sameBindingIdentity\(candidate, created\)/,
  'every installed v3 binding revalidation must require the exact created one-link 230-byte inode',
);
assert.match(
  noTransferReadinessSealSource,
  /directoryOpenFlag: constants\.O_DIRECTORY,[\s\S]*?noFollowOpenFlag: constants\.O_NOFOLLOW,[\s\S]*?directoryOpenFlag === undefined \|\| noFollowOpenFlag === undefined/,
  'binding publication must fail closed unless the platform exposes no-follow directory handles',
);
const atomicBindingWriter = noTransferReadinessSealSource.slice(
  noTransferReadinessSealSource.indexOf('async function writeBindingAtomically('),
  noTransferReadinessSealSource.indexOf('\nfunction defaultSuccessLog('),
);
assert.match(
  atomicBindingWriter,
  /createTemporaryId: \(\) => string = randomUUID[\s\S]*?`\$\{OUTPUT_ROOT\}\/\.kemerbet_agent_identity_bindings\.\$\{createTemporaryId\(\)\}\.tmp`/,
  'the executor may create only one unpredictable output-root-local binding temporary',
);
assert.match(
  atomicBindingWriter,
  /await fileSystem\.open\(\s*OUTPUT_ROOT,\s*constants\.O_RDONLY \| directoryOpenFlag \| noFollowOpenFlag/u,
);
assert.match(
  atomicBindingWriter,
  /openedDirectory\.isDirectory\(\)[\s\S]*?openedDirectory\.isSymbolicLink\(\)[\s\S]*?sameMetadata\(openedDirectory, namedDirectory\)[\s\S]*?fileSystem\.realpath\(OUTPUT_ROOT\)/,
  'the fsynced output directory handle must be bound to the exact safe named directory',
);
assertOrderedFragments(
  atomicBindingWriter,
  [
    'await handle.writeFile(serializedBinding',
    'await handle.sync();',
    'const written = await handle.stat();',
    '!sameBindingIdentity(createdByThisRun, written)',
    'await handle.close();',
    'await outputDirectoryHandle.sync();',
    'await fileSystem.link(temporary, OUTPUT_FILE);',
    'await unlinkOnlyCreatedBindingInode(fileSystem, temporary, createdByThisRun)',
    'await outputDirectoryHandle.sync();',
    'await revalidateInstalledBinding(',
    'await reattestImportedStage();',
    'await revalidateInstalledBinding(',
  ],
  'the exact fsynced temporary inode must be linked, conditionally unlinked, directory-fsynced, and twice revalidated as the final binding',
);
assert.match(
  atomicBindingWriter,
  /unlinkOnlyCreatedBindingInode\(fileSystem, temporary, createdByThisRun\)[\s\S]*?directoryChanged = true;[\s\S]*?installedByThisRun[\s\S]*?!installationComplete[\s\S]*?unlinkOnlyCreatedBindingInode\(fileSystem, OUTPUT_FILE, createdByThisRun\)[\s\S]*?directoryChanged = true;[\s\S]*?if \(directoryChanged\) await outputDirectoryHandle\?\.sync\(\)\.catch/u,
  'every failed temporary or partial-final cleanup must durably fsync the output directory',
);
assertOrderedFragments(
  noTransferReadinessSealSource.slice(
    noTransferReadinessSealSource.indexOf("reportStage('final_guard')"),
  ),
  [
    'await probe.finalizeReadOnlyProof();',
    'const providerAuthorizationDigest = probe.providerAuthorizationDigest();',
    "reportStage('binding_write');",
    'if (dependencies.writeBinding) {',
    'await players.reattest();',
    'await dependencies.writeBinding(',
    '} else {',
    'await writeBindingAtomically(',
  ],
  'the same-UID browser must be confirmed closed and the five-lookup digest complete before binding installation',
);
assert.doesNotMatch(
  noTransferReadinessSealSource,
  /loadExecutorConfig|createKemerBetDepositService|\.prepare\(|submitOnceAfterFence|\.transferOnce\(|\.fillDeposit\(|leaseNext|fenceFinalAction|KEMERBET_EXECUTOR_DATABASE_RUNTIME_ROLE/,
  'the readiness seal must not acquire execution, amount, transfer, database, or history authority',
);

for (const bindingParserV3Contract of [
  /const AGENT_PROFILE_PIN_PATTERN =\s*\/\^hmac-sha256-agent-profile-pin-v3:\[0-9a-f\]\{64\}\$\/u/,
  /const fields = line\.split\(' '\)/,
  /if \(fields\.length !== 3\) return unavailable\(\)/,
  /!AGENT_PROFILE_PIN_PATTERN\.test\(agentProfilePin\)/,
  /fingerprint\.slice\(AGENT_IDENTITY_FINGERPRINT_PREFIX\.length\) !==\s*agentProfilePin\.slice\(AGENT_PROFILE_PIN_PREFIX\.length\)/,
  /agentProfilePins\.has\(agentProfilePin\)/,
  /agentProfilePins\.add\(agentProfilePin\)/,
]) {
  assert.match(executorRuntimeIsolationSource, bindingParserV3Contract);
}
assert.doesNotMatch(
  executorRuntimeIsolationSource,
  /fields\.length !== 2/,
  'the runtime parser must reject the obsolete v1 two-field binding',
);

for (const sealedResponseContract of [
  /request\.redirectedFrom\(\) === null/,
  /request\.redirectedTo\(\) === null/,
  /responseBody = await response\.body\(\)/,
  /validateKemerBetReadinessPlayerLookupResponse\(\{/,
  /requestedPlayerId: playerId/,
  /statusCode: response\.status\(\)/,
  /new TextDecoder\('utf-8', \{ fatal: true, ignoreBOM: false \}\)\.decode\(responseBody\)/,
  /finally \{\s*responseBody\?\.fill\(0\)/,
]) {
  assert.match(playwrightAgentPageSource, sealedResponseContract);
}
assert.match(readinessNetworkGateSource, /readFile\('\/proc\/self\/net\/route', 'utf8'\)/);
assert.match(readinessNetworkGateSource, /readFile\('\/proc\/self\/net\/ipv6_route', 'utf8'\)/);
assert.match(
  readinessNetworkGateSource,
  /initial\.nonLoopbackInterfaceNames\.length !== options\.exactInterfaceCount \|\|\s*initial\.defaultRouteInterfaceNames\.length !== 0/,
  'every isolated readiness process must start with an exact interface count and zero usable default routes',
);
assert.match(
  readinessNetworkGateSource,
  /current\.defaultRouteInterfaceNames\.length !== 0 \|\|\s*current\.nonLoopbackInterfaceNames\.length !== expectedInterfaces\.length \|\|\s*current\.nonLoopbackInterfaceNames\.some/,
  'the static topology revalidator must reject a new default route or interface drift',
);
assert.match(
  readinessNetworkGateSource,
  /createKemerBetReadinessControllerIsolatedNetworkRevalidator[\s\S]*?exactInterfaceCount: 1/,
);
assert.match(
  readinessNetworkGateSource,
  /createKemerBetReadinessFixedIsolatedNetworkRevalidator[\s\S]*?exactInterfaceCount: 2/,
);
assert.match(
  readinessNetworkGateSource,
  /KEMERBET_READINESS_STATIC_NETWORK_CONTRACT = Object\.freeze\(\{\s*browserInterfaceCount: 2,\s*controllerInterfaceCount: 1,\s*usableDefaultRouteCount: 0,\s*\}\)/,
);
assert.doesNotMatch(
  readinessNetworkGateSource,
  /GATE_ROOT|GATE_READY|GATE_RELEASE|waitForKemerBetReadinessNetworkRelease|publishReadyFile|O_CREAT|O_EXCL/,
  'the executor must not retain the writable marker or dynamic attach/release design',
);

assert.match(noTransferReadinessSource, /const CONTROLLER_EFFECTIVE_USER_ID = 10002/);
assert.match(noTransferReadinessSource, /KEMERBET_READINESS_BROWSER_RPC_ENABLED !== 'true'/);
assert.match(
  noTransferReadinessSource,
  /createKemerBetReadinessControllerIsolatedNetworkRevalidator/,
);
assert.match(
  noTransferReadinessSource,
  /waitForKemerBetReadinessFirewallRelease\(\{ role: 'controller' \}\)/,
);
assertOrderedFragments(
  noTransferReadinessSource.slice(
    noTransferReadinessSource.indexOf('if (useBrowserRpc) {'),
    noTransferReadinessSource.indexOf(
      'const [selectorContract]',
      noTransferReadinessSource.indexOf('if (useBrowserRpc) {'),
    ),
  ),
  [
    'rpcClient = await (dependencies.openRpcClient ?? productionOpenRpcClient)();',
    'let rawAgentIdentity: string | null = await rpcClient.open();',
    'fingerprintAgentIdentity(accountId, rawAgentIdentity)',
    'rawAgentIdentity = null;',
    'loadKemerBetReadinessLayer7Authorizations({',
    'effectiveUserId: CONTROLLER_EFFECTIVE_USER_ID,',
    'layer7Authorizations.authorizations.length !== players.playerIds.length',
    'for (const [index, playerId] of players.playerIds.entries())',
    'await rpcClient.lookup(playerId, layer7Authorizations.authorizations[index]!);',
    'await rpcClient.finalize();',
  ],
  'the UID-10002 controller must send one current Player ID with the matching offline-preminted token and never receive the proxy signing key',
);

assert.match(
  readinessBrowserRpcSource,
  /KEMERBET_READINESS_BROWSER_RPC_CAPABILITY_FILE =\s*'\/run\/secrets\/kemerbet_readiness_browser_rpc_capability'/,
);
assert.match(
  readinessBrowserRpcSource,
  /KEMERBET_READINESS_BROWSER_RPC_ORIGIN = 'http:\/\/172\.31\.254\.3:4587'/,
);
assert.match(
  readinessBrowserRpcSource,
  /KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4 = '172\.31\.254\.3'/,
);
assert.match(readinessBrowserRpcSource, /const MAX_CALLS = 8/);
assert.match(readinessBrowserRpcSource, /const MAX_REQUEST_BYTES = 256/);
assert.match(readinessBrowserRpcSource, /const MAX_RESPONSE_BYTES = 512/);
assert.match(readinessBrowserRpcSource, /effectiveUserId !== 10001 && effectiveUserId !== 10002/);
assert.match(
  readinessBrowserRpcSource,
  /before\.uid !== effectiveUserId \|\|\s*before\.gid !== effectiveUserId \|\|\s*\(before\.mode & 0o777\) !== 0o400 \|\|\s*before\.nlink !== 1 \|\|\s*before\.size !== 65/,
  'each side of the RPC must accept only its own one-run 0400 capability file',
);
assert.match(
  readinessBrowserRpcSource,
  /request\.url === LOOKUP_PATH && state === 'opened' && lookups < 5/,
);
assert.match(
  readinessBrowserRpcSource,
  /request\.url === FINALIZE_PATH &&\s*state === 'opened' &&\s*lookups === 5/,
);
assert.match(
  readinessBrowserRpcSource,
  /state !== 'opened' \|\|\s*lookups >= 5[\s\S]*?isKemerBetReadinessLayer7Authorization/,
);
assert.doesNotMatch(
  readinessBrowserRpcSource,
  /KEMERBET_AGENT_PLAYER_DEPOSIT_PATH|\/Wallet\/PlayerEPOSDeposit|fillDeposit|transferOnce|submitOnceAfterFence|leaseNext|fenceFinalAction/,
  'the browser RPC must expose lookup/finalize/close only, never a financial endpoint',
);

assert.match(readinessBrowserDriverSource, /const DRIVER_EFFECTIVE_USER_ID = 10001/);
assert.match(readinessBrowserDriverSource, /const LAYER7_PROXY_IPV4 = '172\.31\.254\.10'/);
assert.match(
  readinessBrowserDriverSource,
  /createKemerBetReadinessFixedIsolatedNetworkRevalidator\(\)/,
);
assert.match(
  readinessBrowserDriverSource,
  /address\.address === KEMERBET_READINESS_BROWSER_RPC_BIND_IPV4/,
);
assert.match(
  readinessBrowserDriverSource,
  /for \(const path of SENSITIVE_PATHS\)[\s\S]*?await lstat\(path\)[\s\S]*?if \(!isMissing\(error\)\) unavailable\(\)/,
  'the browser must prove every controller, cohort, HMAC, nonce, and output path absent',
);
assert.match(
  readinessBrowserDriverSource,
  /KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,[\s\S]*?KEMERBET_AGENT_IDENTITY_HMAC_KEY_FILE,[\s\S]*?KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE,[\s\S]*?KEMERBET_READINESS_LAYER7_AUTHORIZATIONS_FILE,[\s\S]*?KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,[\s\S]*?KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE,[\s\S]*?'\/run\/output',[\s\S]*?'\/run\/fetanagent-kemerbet-readiness-seal-output'/,
);
assert.match(
  readinessBrowserDriverSource,
  /environment\.KEMERBET_AGENT_IDENTITY_BINDING_ACCOUNT_ID !== undefined/,
  'the browser must reject an account identity supplied through its environment',
);
assert.match(
  readinessBrowserDriverSource,
  /waitForKemerBetReadinessFirewallRelease\(\{ role: 'browser' \}\)/,
);
assert.match(
  readinessBrowserDriverSource,
  /loadKemerBetReadinessAccountId\(\{ effectiveUserId: DRIVER_EFFECTIVE_USER_ID \}\)/,
);
assert.match(readinessBrowserDriverSource, /\(await server\.completed\) !== 'succeeded'/);
assert.doesNotMatch(
  readinessBrowserDriverSource,
  /KEMERBET_AGENT_PLAYER_DEPOSIT_PATH|\/Wallet\/PlayerEPOSDeposit|fillDeposit|transferOnce|submitOnceAfterFence|leaseNext|fenceFinalAction/,
  'the browser driver must not gain a financial endpoint',
);

assert.match(
  readinessLayer7AuthorizationSource,
  /KEMERBET_READINESS_LAYER7_LOOKUP_HOSTNAME = 'admin-api\.agt-digi\.com'/,
);
assert.match(
  readinessLayer7AuthorizationSource,
  /KEMERBET_READINESS_LAYER7_LOOKUP_PATH = '\/Player\/GeneralInfoByExternalId'/,
);
assert.match(
  readinessLayer7AuthorizationSource,
  /const KEY_PATTERN = \/\^\[0-9a-f\]\{64\}\\n\$\/u/,
);
assert.match(
  readinessLayer7AuthorizationSource,
  /const NONCE_PATTERN = \/\^\[0-9a-f\]\{32\}\\n\$\/u/,
);
assert.match(
  readinessLayer7AuthorizationSource,
  /before\.uid !== options\.ownerUserId \|\|\s*before\.gid !== options\.ownerGroupId \|\|\s*\(before\.mode & 0o777\) !== 0o400/,
);
assert.match(readinessLayer7AuthorizationSource, /const PROXY_USER_ID = 10003/);
assert.match(readinessLayer7AuthorizationSource, /const AUTHORIZER_USER_ID = 10004/);
assert.match(
  readinessLayer7AuthorizationSource,
  /hmacKeyFile: KEMERBET_READINESS_LAYER7_HMAC_KEY_FILE,[\s\S]*?ownerGroupId: PROXY_USER_ID,[\s\S]*?ownerUserId: PROXY_USER_ID,[\s\S]*?runNonceFile: KEMERBET_READINESS_LAYER7_RUN_NONCE_FILE/,
);
assert.match(
  readinessLayer7AuthorizationSource,
  /hmacKeyFile: KEMERBET_READINESS_AUTHORIZER_HMAC_KEY_FILE,[\s\S]*?ownerGroupId: AUTHORIZER_USER_ID,[\s\S]*?ownerUserId: AUTHORIZER_USER_ID,[\s\S]*?runNonceFile: KEMERBET_READINESS_AUTHORIZER_RUN_NONCE_FILE/,
);
assert.match(
  readinessLayer7AuthorizationSource,
  /input\.method === 'GET'[\s\S]*?input\.hostname === KEMERBET_READINESS_LAYER7_LOOKUP_HOSTNAME[\s\S]*?candidateSequence === nextSequence/,
  'proxy authorization must bind one exact sequential GET lookup',
);

assert.match(
  readinessLayer7CertificateSource,
  /KEMERBET_READINESS_LAYER7_TLS_HOSTS = Object\.freeze\(\[\s*'agentsystem\.admindigi\.com',\s*'agt-client-akm\.agent-digi\.com',\s*'admin-api\.agt-digi\.com',\s*\]/,
);
assert.match(
  readinessLayer7CertificateSource,
  /KEMERBET_READINESS_LAYER7_TLS_SPKI_SHA256_BASE64 =\s*'Ngu9uL2STHWC7Uton\/GYw7d8hDQdhliykEz2XnJZd3M='/,
);

assert.match(
  readinessLayer7ProxySource,
  /command: Object\.freeze\(\['node', 'apps\/executor\/dist\/kemerbet-readiness-layer7-proxy\.js'\]\)/,
);
assert.match(readinessLayer7ProxySource, /groupId: 10003/);
assert.match(readinessLayer7ProxySource, /userId: 10003/);
assert.match(readinessLayer7ProxySource, /port: 18443/);
assert.match(
  readinessLayer7ProxySource,
  /secretFiles: Object\.freeze\(\[\s*'\/run\/secrets\/kemerbet_readiness_proxy_hmac_key',\s*'\/run\/secrets\/kemerbet_readiness_proxy_run_nonce',\s*'\/run\/secrets\/kemerbet_readiness_release_sha',\s*KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE,\s*KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE,\s*\]\)/,
);
assert.match(readinessLayer7ProxySource, /outputRoot: '\/run\/output'/);
assert.match(
  readinessLayer7ProxySource,
  /readinessFile: '\/tmp\/fetanagent-kemerbet-readiness-layer7-proxy\.ready'/,
);
assert.match(readinessLayer7ProxySource, /const MAX_UPSTREAM_RESPONSE_BYTES = 8 \* 1024 \* 1024/);
assert.match(readinessLayer7ProxySource, /const MAX_BOOTSTRAP_CACHE_BYTES = 32 \* 1024 \* 1024/);
assert.equal(
  countMatches(readinessLayer7ProxySource, /^  '\/prd\/agt-admin-client\/v84\//gm),
  7,
  'the proxy must allow exactly the seven reviewed immutable bootstrap assets',
);
assert.match(
  readinessLayer7ProxySource,
  /KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT = Object\.freeze\(\{[\s\S]*?maximumEntryBytes: MAX_UPSTREAM_RESPONSE_BYTES,[\s\S]*?maximumTotalBytes: MAX_BOOTSTRAP_CACHE_BYTES,[\s\S]*?Object\.freeze\(\{ hostname: AGENT_WEB_HOSTNAME, path: AGENT_WEB_PATH \}\),[\s\S]*?\.\.\.KEMERBET_READINESS_LAYER7_BOOTSTRAP_ASSET_PATHS\.map/,
  'startup must prefetch the exact agent document followed by the seven pinned assets',
);
assert.match(readinessLayer7ProxySource, /input\.method !== 'GET' && input\.method !== 'OPTIONS'/);
assert.match(
  readinessLayer7ProxySource,
  /input\.method === 'GET' &&\s*input\.rawTarget === AGENT_WEB_PATH/,
);
assert.match(
  readinessLayer7ProxySource,
  /input\.method === 'GET' &&\s*BOOTSTRAP_ASSET_PATHS\.has\(input\.rawTarget\)/,
);
assert.match(
  readinessLayer7ProxySource,
  /const lookupPrefix = `\$\{KEMERBET_AGENT_PLAYER_LOOKUP_PATH\}\?externalId=`/,
);
assert.match(readinessLayer7ProxySource, /!hasNoRequestBody\(input\.headers\)/);
assert.match(readinessLayer7ProxySource, /requestsUpgrade\(input\.headers\)/);
assert.match(readinessLayer7ProxySource, /rejectUnauthorized: true/);
assert.match(readinessLayer7ProxySource, /servername: input\.hostname/);
assert.match(
  readinessLayer7ProxySource,
  /const operationTimeoutMs = input\.operationTimeoutMs \?\? UPSTREAM_TIMEOUT_MS;\s*if \(\s*input\.signal\.aborted \|\|\s*\(input\.method !== 'GET' && input\.method !== 'POST'\) \|\|\s*\(input\.method === 'GET' &&\s*\(input\.body !== undefined \|\| operationTimeoutMs !== UPSTREAM_TIMEOUT_MS\)\) \|\|\s*\(input\.method === 'POST' &&\s*!isExactProductionSessionRefreshUpstreamInput\(input, operationTimeoutMs\)\)\s*\) \{\s*return unavailable\(\);\s*\}/,
  'the production HTTPS transport must reject pre-abort, unknown methods, GET bodies/timeouts, and every non-exact refresh POST before socket construction',
);
assert.match(readinessLayer7ProxySource, /signal: input\.signal/);
assert.match(
  readinessLayer7ProxySource,
  /input\.signal\.addEventListener\('abort', abort, \{ once: true \}\);\s*if \(input\.signal\.aborted\)/,
  'the production HTTPS transport must close the pre-abort and construction-to-listener races',
);
assert.match(
  readinessLayer7ProxySource,
  /response\.statusCode >= 300 && response\.statusCode <= 399/,
);
assert.match(
  readinessLayer7ProxySource,
  /buildKemerBetReadinessAgentProfileRequestHeaders[\s\S]*?accept: 'application\/json'[\s\S]*?'accept-encoding': 'identity'[\s\S]*?authorization,[\s\S]*?origin: AGENT_WEB_ORIGIN,[\s\S]*?referer: KEMERBET_AGENT_DEPOSIT_URL,[\s\S]*?'sec-fetch-dest': 'empty'[\s\S]*?'sec-fetch-mode': 'cors'[\s\S]*?'sec-fetch-site': 'cross-site'/,
  'the independent Profile GET must use only the exact bearer and fixed lookup-XHR headers',
);
assert.match(
  readinessLayer7ProxySource,
  /sanitizeKemerBetReadinessLayer7RequestHeaders[\s\S]*?accept: 'application\/json'[\s\S]*?'accept-encoding': 'identity'[\s\S]*?authorization,[\s\S]*?origin: AGENT_WEB_ORIGIN,[\s\S]*?referer: KEMERBET_AGENT_DEPOSIT_URL,[\s\S]*?'sec-fetch-dest': 'empty'[\s\S]*?'sec-fetch-mode': 'cors'[\s\S]*?'sec-fetch-site': 'cross-site'/,
  'the Player lookup GET must use only the exact bearer and fixed cross-site XHR headers',
);
assert.match(
  readinessLayer7ProxySource,
  /interfaces\.length !== 2 \|\|\s*defaults\.length !== 1[\s\S]*?!interfaces\.includes\(defaults\[0\] \?\? ''\)/,
  'only the proxy may have a usable default route and it must be confined to one of two interfaces',
);
assert.doesNotMatch(
  readinessLayer7ProxySource,
  /KEMERBET_AGENT_PLAYER_DEPOSIT_PATH|\/Wallet\/PlayerEPOSDeposit|Withdraw|GiveCredit|PayCommission|fillDeposit|transferOnce|submitOnceAfterFence|leaseNext|fenceFinalAction/,
  'the Layer-7 proxy must have no financial path or execution primitive',
);

const bootstrapPrefetchBoundary = readinessLayer7ProxySource.slice(
  readinessLayer7ProxySource.indexOf('async function prefetchKemerBetReadinessBootstrap'),
  readinessLayer7ProxySource.indexOf('/**\n * Prove the proxy is dual-homed'),
);
assertOrderedFragments(
  bootstrapPrefetchBoundary,
  [
    'for (const request of KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence)',
    'const response = await upstream({',
    'sanitizeKemerBetReadinessLayer7RequestHeaders({}, classification)',
    'response.statusCode !== 200',
    'response.body.length > MAX_UPSTREAM_RESPONSE_BYTES',
    'contentEncodings.length > 1',
    "contentEncodings[0] !== 'identity'",
    'totalBytes > MAX_BOOTSTRAP_CACHE_BYTES - response.body.length',
    'const body = Buffer.from(response.body);',
    'cache.set(',
    'cache.size !== KEMERBET_READINESS_LAYER7_BOOTSTRAP_PREFETCH_CONTRACT.sequence.length',
    'totalBytes > MAX_BOOTSTRAP_CACHE_BYTES',
  ],
  'the proxy must fetch all eight bootstrap resources sequentially under exact response and byte ceilings',
);
assert.match(
  bootstrapPrefetchBoundary,
  /finally \{[\s\S]*?clearBootstrapCache\(cache\)/,
  'a partial startup cache must be zeroed on every failure',
);

const bootstrapCacheServeBoundary = readinessLayer7ProxySource.slice(
  readinessLayer7ProxySource.indexOf("if (classification.route !== 'player_lookup')"),
  readinessLayer7ProxySource.indexOf('let lookupReservation:'),
);
for (const cacheOnlyContract of [
  /bootstrapCache\.get/,
  /status !== 'ready'/,
  /cached === undefined/,
  /bootstrapCache\.size !==/,
  /response\.writeHead\(cached\.statusCode/,
  /response\.end\(cached\.body\)/,
]) {
  assert.match(bootstrapCacheServeBoundary, cacheOnlyContract);
}
assert.doesNotMatch(
  bootstrapCacheServeBoundary,
  /\bupstream\s*\(/,
  'renderer bootstrap requests must be served only from the complete immutable cache',
);

for (const readinessMarkerContract of [
  /const READINESS_PENDING_FILE = `\$\{READINESS_FILE\}\.pending`/,
  /fetanagent-kemerbet-readiness-layer7-proxy-ready-v1\\n/,
  /O_CREAT[\s\S]*?O_EXCL[\s\S]*?O_NOFOLLOW[\s\S]*?O_WRONLY/,
  /await handle\.sync\(\)/,
  /metadata\.uid !== EXECUTOR_USER_ID/,
  /metadata\.gid !== EXECUTOR_GROUP_ID/,
  /\(metadata\.mode & 0o7777\) !== 0o600/,
  /metadata\.nlink !== 1/,
  /await rename\(READINESS_PENDING_FILE, READINESS_FILE\)/,
  /await attestProductionReadinessFile\(READINESS_FILE\)/,
]) {
  assert.match(readinessLayer7ProxySource, readinessMarkerContract);
}
assertOrderedFragments(
  readinessLayer7ProxySource.slice(readinessLayer7ProxySource.indexOf('start: async () => {')),
  [
    'await readinessSignal.clear();',
    'const before = attestKemerBetReadinessLayer7NetworkTopology',
    'bootstrapCache = await prefetchKemerBetReadinessBootstrap(',
    'server.listen(port, host, () => {',
    'const after = attestKemerBetReadinessLayer7NetworkTopology',
    'if (!sameTopologyAttestation(before, after))',
    'bootstrapCache.size !==',
    "status = 'ready';",
    'await readinessSignal.publish();',
  ],
  'the private application-ready marker must be published only after prefetch, listen, final topology, and complete-cache checks',
);
assertOrderedFragments(
  readinessLayer7ProxySource.slice(readinessLayer7ProxySource.indexOf('let lookupReservation:')),
  [
    'options.authorizationVerifier.reserve({',
    'await options.sameAgentIdentityVerifier.verify({',
    'path: KEMERBET_READINESS_AGENT_PROFILE_PATH,',
    'const upstreamResponse = await upstream({',
    'validateKemerBetReadinessPlayerLookupResponse({',
    'const onFinish = () => {',
    'options.authorizationVerifier.complete(lookupReservation)',
    "response.once('finish', onFinish);",
    'response.end(upstreamResponse.body);',
    'if (completion.allCompleted)',
    'await completionReceiptPublisher({',
    'agentIdentityBindingSha256:',
    'sameAgentIdentityValidated: true,',
  ],
  'the trusted proxy must reserve an exact token, prove the same agent before the first lookup, validate each response, complete only after response finish, and publish one generic receipt after all five',
);

assert.match(
  readinessSameAgentIdentitySource,
  /KEMERBET_READINESS_PROXY_AGENT_IDENTITY_BINDINGS_FILE =\s*'\/run\/secrets\/kemerbet_readiness_proxy_agent_identity_bindings'/,
);
assert.match(
  readinessSameAgentIdentitySource,
  /KEMERBET_READINESS_PROXY_AGENT_IDENTITY_HMAC_KEY_FILE =\s*'\/run\/secrets\/kemerbet_readiness_proxy_agent_identity_hmac_key'/,
);
assert.match(
  readinessSameAgentIdentitySource,
  /KEMERBET_READINESS_AGENT_PROFILE_PATH = '\/Account\/Profile'/,
);
assert.match(readinessSameAgentIdentitySource, /const PROXY_USER_ID = 10003/);
assert.match(readinessSameAgentIdentitySource, /const PROXY_GROUP_ID = 10003/);
assert.match(
  readinessSameAgentIdentitySource,
  /stat\.uid === PROXY_USER_ID &&\s*stat\.gid === PROXY_GROUP_ID &&\s*\(stat\.mode & 0o777\) === 0o400 &&\s*stat\.nlink === 1/,
  'both proxy-only identity files must be exact UID/GID-10003 0400 one-link inodes',
);
assert.match(
  readinessSameAgentIdentitySource,
  /hmac-sha256-agent-identity-v1:\(\[0-9a-f\]\{64\}\) hmac-sha256-agent-profile-pin-v3:\(\[0-9a-f\]\{64\}\)\\n\$\/u/,
  'the proxy binding must be exactly one canonical v3 UUID/identity/profile-pin line with a trailing LF',
);
assert.match(readinessSameAgentIdentitySource, /const EXACT_BINDING_FILE_BYTES = 230/);
assert.match(
  readinessSameAgentIdentitySource,
  /expectedBytes: EXACT_BINDING_FILE_BYTES,[\s\S]*?maximumBytes: EXACT_BINDING_FILE_BYTES/,
  'the proxy must read exactly the 230-byte canonical v3 binding, never a legacy prefix',
);
assert.match(
  readinessSameAgentIdentitySource,
  /bindingFileBytes: EXACT_BINDING_FILE_BYTES,[\s\S]*?bindingVersion: 3/,
);
assert.match(
  readinessSameAgentIdentitySource,
  /bindingFileSha256: createHash\('sha256'\)\.update\(input\.bindingFile\)\.digest\('hex'\)/,
);
assert.match(
  readinessSameAgentIdentitySource,
  /new TextDecoder\('utf-8', \{ fatal: true, ignoreBOM: true \}\)\.decode\(body\)/,
);
assert.match(readinessSameAgentIdentitySource, /body\.includes\(0\)/);
assert.match(readinessSameAgentIdentitySource, /hasOnlyUniqueJsonObjectKeys\(serialized\)/);
assert.match(
  readinessSameAgentIdentitySource,
  /values\.length === 0 \|\| \(values\.length === 1 && values\[0\] === 'identity'\)/,
  'Profile parsing must reject compressed or duplicate content-encoding values',
);
assert.match(
  readinessSameAgentIdentitySource,
  /!plainRecord\(decoded\) \|\| !Object\.is\(decoded\.resultCode, 0\) \|\| !plainRecord\(decoded\.value\)/,
);
assert.match(
  readinessSameAgentIdentitySource,
  /createHmac\('sha256', hmacKey\)[\s\S]*?KEMERBET_AGENT_IDENTITY_FINGERPRINT_DOMAIN[\s\S]*?\.update\(accountId\)[\s\S]*?\.update\('\\0', 'utf8'\)[\s\S]*?\.update\(userName\)[\s\S]*?timingSafeEqual\(observedIdentityDigest, expectedAgentProfilePinDigest\)/,
  'the proxy must independently recompute and timing-safely match the bound account identity',
);
assert.match(
  readinessSameAgentIdentitySource,
  /createHash\('sha256'\)\.update\(encoded\)\.digest\(\)[\s\S]*?timingSafeEqual\(pinnedBearerDigest, candidateBearerDigest\)/,
  'the exact complete bearer hash must be pinned and timing-safely compared after sequence one',
);
assertOrderedFragments(
  readinessSameAgentIdentitySource.slice(
    readinessSameAgentIdentitySource.indexOf('verify: async (verificationInput:'),
  ),
  [
    'candidateBearerDigest = bearerDigest(verificationInput.authorization);',
    "if (state === 'validated')",
    '!timingSafeEqual(pinnedBearerDigest, candidateBearerDigest)',
    "if (state !== 'unvalidated')",
    "state = 'validating';",
    'await verificationInput.loadProfile(',
  ],
  'the proxy must validate the first bearer through stable Profile identity and then timing-safely pin it for the run',
);
assert.doesNotMatch(
  readinessSameAgentIdentitySource,
  /expectedProviderAuthorizationDigest/,
  'the v3 runtime must not persistently bind the agent identity to an expiring bearer digest',
);
assert.match(
  readinessSameAgentIdentitySource,
  /state !== 'unvalidated'[\s\S]*?state = 'validating'[\s\S]*?state !== 'validating'[\s\S]*?state = 'validated'/,
  'concurrent first identity validation must fail closed instead of racing',
);
for (const erasedIdentityBuffer of [
  'accountId.fill(0)',
  'expectedIdentityDigest.fill(0)',
  'expectedAgentProfilePinDigest.fill(0)',
  'hmacKey.fill(0)',
  'pinnedBearerDigest?.fill(0)',
  'candidateBearerDigest?.fill(0)',
  'profileResponse?.body.fill(0)',
  'userName?.fill(0)',
  'observedIdentityDigest?.fill(0)',
]) {
  assert.ok(
    readinessSameAgentIdentitySource.includes(erasedIdentityBuffer),
    `missing same-agent identity zeroization ${erasedIdentityBuffer}`,
  );
}
assert.doesNotMatch(
  readinessSameAgentIdentitySource,
  /console\.|\/Wallet\/PlayerEPOSDeposit|KEMERBET_AGENT_PLAYER_DEPOSIT_PATH|transferOnce|moneyMoved: true/,
  'the same-agent identity verifier must neither log sensitive identity material nor gain a financial primitive',
);

assert.match(
  readinessAccountIdSource,
  /KEMERBET_READINESS_ACCOUNT_ID_FILE =\s*'\/run\/secrets\/kemerbet_readiness_account_id'/,
);
assert.match(readinessAccountIdSource, /const BROWSER_USER_ID = 10001/);
assert.match(
  readinessAccountIdSource,
  /before\.uid !== BROWSER_USER_ID \|\|\s*before\.gid !== BROWSER_USER_ID \|\|\s*\(before\.mode & 0o777\) !== 0o400 \|\|\s*before\.nlink !== 1 \|\|\s*before\.size !== 37/,
  'the browser account identity must be a one-link UID-10001 0400 UUID file, never an environment value',
);

assert.match(readinessAuthorizationPremintSource, /const AUTHORIZER_USER_ID = 10004/);
assert.match(
  readinessAuthorizationPremintSource,
  /const OUTPUT_FILE = `\$\{OUTPUT_ROOT\}\/authorizations`/,
);
assert.match(
  readinessAuthorizationPremintSource,
  /playerIds\.length !== 5 \|\|\s*new Set\(playerIds\)\.size !== 5/,
);
assert.match(
  readinessAuthorizationPremintSource,
  /\(dependencies\.assertOfflineNetwork \?\? assertNoNetworkInterfaces\)\(\)/,
);
assert.match(
  readinessAuthorizationPremintSource,
  /command: Object\.freeze\(\[\s*'node',\s*'apps\/executor\/dist\/kemerbet-readiness-authorization-premint\.js',\s*\]\)[\s\S]*?environment: Object\.freeze\(\[\]\)[\s\S]*?groupId: AUTHORIZER_USER_ID,[\s\S]*?networkMode: 'none'/,
);
assertOrderedFragments(
  readinessAuthorizationPremintSource.slice(
    readinessAuthorizationPremintSource.indexOf(
      'export async function writeKemerBetReadinessPremintedAuthorizations',
    ),
  ),
  [
    'await requireAbsent(OUTPUT_FILE);',
    'await requireAbsent(INSTALLING_FILE);',
    'constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL',
    'await handle.sync();',
    'await handle.chmod(0o400);',
    'await rename(INSTALLING_FILE, OUTPUT_FILE);',
    'await directory.sync();',
  ],
  'the offline authorizer must pre-mint its exact-five output through an exclusive, synced, atomic install',
);
assert.doesNotMatch(
  readinessAuthorizationPremintSource,
  /\/Wallet\/PlayerEPOSDeposit|KEMERBET_AGENT_PLAYER_DEPOSIT_PATH|transferOnce|moneyMoved: true/,
);

assert.match(readinessLayer7AuthorizationsSource, /const CONTROLLER_USER_ID = 10002/);
assert.match(readinessLayer7AuthorizationsSource, /const TOKEN_COUNT = 5/);
assert.match(
  readinessLayer7AuthorizationsSource,
  /before\.uid !== CONTROLLER_USER_ID \|\|\s*before\.gid !== CONTROLLER_USER_ID \|\|\s*\(before\.mode & 0o777\) !== 0o400/,
);
assert.match(
  readinessLayer7AuthorizationsSource,
  /lines\.length !== TOKEN_COUNT[\s\S]*?fields\[2\] !== String\(index \+ 1\)[\s\S]*?exactNonce\(fields\[1\], nonce\)/,
  'the controller may load exactly five ordered tokens sharing one run nonce, without authorizer material',
);

assert.match(
  readinessFirewallReleaseSource,
  /KEMERBET_READINESS_CONTROLLER_FIREWALL_RELEASE_FILE =\s*'\/run\/secrets\/kemerbet_readiness_controller_firewall_release'/,
);
assert.match(
  readinessFirewallReleaseSource,
  /KEMERBET_READINESS_BROWSER_FIREWALL_RELEASE_FILE =\s*'\/run\/secrets\/kemerbet_readiness_browser_firewall_release'/,
);
assert.match(
  readinessFirewallReleaseSource,
  /KEMERBET_READINESS_FIREWALL_RELEASE_CONTENT =\s*'fetanagent-kemerbet-readiness-firewall-v1\\n'/,
);
assert.match(
  readinessFirewallReleaseSource,
  /await requireAbsent\(fileSystem, forbiddenPath\)[\s\S]*?initialHandle\.uid !== 0 \|\|\s*initialHandle\.gid !== 0 \|\|\s*\(initialHandle\.mode & 0o777\) !== 0o444/,
  'each process must see only its own root-owned immutable firewall release inode',
);

assert.match(readinessCompletionReceiptSource, /const PROXY_USER_ID = 10003/);
assert.match(
  readinessCompletionReceiptSource,
  /const OUTPUT_FILE = `\$\{OUTPUT_ROOT\}\/completion-receipt`/,
);
assert.match(
  readinessCompletionReceiptSource,
  /const RECEIPT_CONTRACT = 'fetanagent-kemerbet-readiness-layer7-completion-v3'/,
);
for (const receiptInvariant of [
  'agentIdentityBindingSha256: input.agentIdentityBindingSha256',
  'identifiersRedacted: true',
  'moneyMoved: false',
  'responsesValidated: true',
  'sameAgentIdentityValidated: true',
  'stableAgentProfileValidated: true',
  'sequences: [1, 2, 3, 4, 5]',
  'transferDisabled: true',
  'version: 3',
]) {
  assert.ok(
    readinessCompletionReceiptSource.includes(receiptInvariant),
    `missing trusted completion receipt invariant ${receiptInvariant}`,
  );
}
assert.match(
  readinessCompletionReceiptSource,
  /!SHA256_PATTERN\.test\(input\.agentIdentityBindingSha256\)[\s\S]*?input\.sameAgentIdentityValidated !== true/,
  'receipt v3 must require the exact binding-file digest and a true same-agent proof',
);
assertOrderedFragments(
  readinessCompletionReceiptSource.slice(
    readinessCompletionReceiptSource.indexOf(
      'export async function publishKemerBetReadinessCompletionReceipt',
    ),
  ),
  [
    'await requireAbsent(OUTPUT_FILE);',
    'await requireAbsent(INSTALLING_FILE);',
    'constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL',
    'await handle.sync();',
    'await handle.chmod(0o400);',
    'await rename(INSTALLING_FILE, OUTPUT_FILE);',
    'await directory.sync();',
  ],
  'the proxy-only completion receipt must use an exclusive, synced, atomic install',
);

assert.match(readinessLookupResponseSource, /input\.statusCode !== 200/);
assert.match(readinessLookupResponseSource, /value\.externalId !== input\.requestedPlayerId/);
assert.match(readinessLookupResponseSource, /value\.currencyCode !== 'ETB'/);
assert.match(
  readinessLookupResponseSource,
  /const identities = \[\.\.\.new Set\(\[value\.userName, value\.email\]\)\]\.filter\(boundedIdentity\)/,
);

assert.match(readinessProfileSnapshotSource, /const ROOT_USER_ID = 0/);
assert.match(readinessProfileSnapshotSource, /const SOURCE_ROOT = '\/run\/source'/);
assert.match(readinessProfileSnapshotSource, /const SNAPSHOT_ROOT = '\/run\/snapshot'/);
assert.match(readinessProfileSnapshotSource, /const OUTPUT_ROOT = '\/run\/output'/);
assert.match(
  readinessProfileSnapshotSource,
  /\(dependencies\.assertOfflineNetwork \?\? assertNoNetworkInterfaces\)\(\)/,
);
assert.match(
  readinessProfileSnapshotSource,
  /source === undefined \|\|\s*!source\.has\('ro'\) \|\|\s*source\.has\('rw'\)[\s\S]*?mode === 'snapshot'[\s\S]*?!snapshot\.has\('rw'\)[\s\S]*?!output\.has\('rw'\)[\s\S]*?mode === 'verify' \|\| mode === 'verify-original'[\s\S]*?snapshot !== undefined[\s\S]*?!output\.has\('ro'\)/,
  'snapshot mode must mount the source read-only and destinations writable, while both verification modes use a read-only source and manifest with no writable snapshot path',
);
assertOrderedFragments(
  readinessProfileSnapshotSource.slice(
    readinessProfileSnapshotSource.indexOf('async function productionSnapshot'),
    readinessProfileSnapshotSource.indexOf('async function productionVerify'),
  ),
  [
    "assertKemerBetReadinessProfileMountInfo(mountInfoBefore, 'snapshot');",
    'const sourceRecords = await inspectTree({',
    'copyToRoot: SNAPSHOT_ROOT,',
    'ignoreTopLevelChromiumSingletonSymlinks: true,',
    'root: sourceAccount,',
    'const targetRecords = await inspectTree({ root: targetAccount });',
    'const sourceAfter = await inspectTree({',
    'ignoreTopLevelChromiumSingletonSymlinks: true,',
    'root: sourceAccount,',
    'sourceManifest.treeSha256 !== createKemerBetReadinessProfileTreeDigest(targetRecords)',
    'sourceManifest.treeSha256 !== createKemerBetReadinessProfileTreeDigest(sourceAfter)',
    'await writeManifest(sourceManifest);',
    'if (mountInfoBefore !== mountInfoAfter) return unavailable();',
  ],
  'the offline snapshot must copy and verify the source, target, manifest, and unchanged mount table',
);
assert.match(
  readinessProfileSnapshotSource,
  /const STALE_CHROMIUM_SINGLETON_NAMES: ReadonlySet<string> = new Set\(\[\s*'SingletonCookie',\s*'SingletonLock',\s*'SingletonSocket',\s*\]\)/,
  'only the three exact Chromium singleton names may receive source-only stale-link treatment',
);
assert.match(
  readinessProfileSnapshotSource,
  /!relativePath\.includes\('\/'\) && STALE_CHROMIUM_SINGLETON_NAMES\.has\(relativePath\)[\s\S]*?ignoreTopLevelChromiumSingletonSymlinks !== true[\s\S]*?!before\.isSymbolicLink\(\)[\s\S]*?const after = \(await lstat\(sourcePath\)\)[\s\S]*?!after\.isSymbolicLink\(\) \|\| !sameStat\(before, after\)[\s\S]*?return;/,
  'source omission must require an exact top-level, stable symlink and must return before realpath, open, copy, or hashing',
);
assert.match(
  readinessProfileSnapshotSource,
  /async function productionVerify\(accountId: string\)[\s\S]*?const records = await inspectTree\(\{ root: sourceAccount \}\)[\s\S]*?async function productionVerifyOriginal/,
  'verification must keep singleton omission disabled so every target-side symlink or replacement fails closed',
);
assert.match(
  readinessProfileSnapshotSource,
  /async function productionVerifyOriginal[\s\S]*?assertKemerBetReadinessProfileMountInfo\(mountInfoBefore, 'verify-original'\)[\s\S]*?ignoreTopLevelChromiumSingletonSymlinks: true,[\s\S]*?root: sourceAccount/,
  'post-run original-profile verification must explicitly reuse only the source singleton-omission policy',
);
assert.match(
  readinessProfileSnapshotSource,
  /snapshot: Object\.freeze\(\[\s*'node',\s*'apps\/executor\/dist\/kemerbet-readiness-profile-snapshot\.js',\s*'snapshot',[\s\S]*?verify: Object\.freeze\(\[\s*'node',\s*'apps\/executor\/dist\/kemerbet-readiness-profile-snapshot\.js',\s*'verify',[\s\S]*?verifyOriginal: Object\.freeze\(\[\s*'node',\s*'apps\/executor\/dist\/kemerbet-readiness-profile-snapshot\.js',\s*'verify-original'/,
);
assert.match(
  readinessProfileSnapshotSource,
  /mode === 'verify-original'[\s\S]*?dependencies\.verifyOriginal \?\? productionVerifyOriginal/,
  'the explicit original-profile CLI mode must not alias the strict completed-snapshot verifier',
);
for (const documentationContract of [
  /Source traversal alone omits the exact top-level `SingletonCookie`, `SingletonLock`,\s+and `SingletonSocket`/u,
  /distinct `verify-original` command[\s\S]*?cannot weaken completed-snapshot verification/u,
  /explicitly trusted, supervised enrollment ceremony/u,
  /compromised enrollment renderer is outside the confidentiality\/containment guarantee/u,
  /Compromised-renderer containment begins only after that\s+terminal close/u,
  /exact 230-byte v3 UUID, identity-HMAC fingerprint, and stable Profile\s+pin/u,
  /two-field v1 binding[\s\S]*?cannot be\s+upgraded in place/u,
  /explicit, user-confirmed retirement and same-claim\s+reseal ceremony/u,
  /normal deploy, start, and seal commands never retire it automatically/u,
  /previously reviewed v1 file SHA-256 and the exact retirement confirmation/u,
  /I-UNDERSTAND-THIS-RETIRES-THE-EXACT-V1-BINDING-FOR-V2-RESEAL/u,
  /manual\s+`retire-v1-for-v2-reseal` workflow mode/u,
  /global helper gate blocks helper\/release replacement and unrelated state-expanding commands/u,
  /explicit same-commit retirement resume, private-session start\/readiness\/seal/u,
  /UUID\/fingerprint projection matches the archived v1 artifact/u,
  /distinct\s+`resealed-awaiting-recheck` state/u,
  /only the same-release independent recheck plus safe\s+teardown or diagnostics may proceed/u,
  /gate unlocks only after that recheck commits the immutable\s+canonical binding and exact success receipt/u,
  /migration alone does not require rotating the provider token/u,
  /later\s+provider-token rotation\s+does require a new supervised v2 seal/u,
  /`recover-v1-retirement-after-expiry`/u,
  /I-UNDERSTAND-THIS-RECOVERS-THE-EXACT-V1-RETIREMENT-RELEASE/u,
  /separate explicit `confirm_v1_retirement_release_sha`/u,
  /requires that exact 40-character retirement\s+release to be an ancestor of the current workflow commit/u,
  /expected helper plus role\s+provision\/disable SQL as canonical LF blobs with `git show <release>:<fixed-path>`/u,
  /never substitutes the current `GITHUB_SHA`/u,
  /Before bundle creation, upload, database-role provisioning, or any remote mutation/u,
  /`kemerbet-v1-retirement-recovery-ready <explicit-release>` preflight/u,
  /clean initial boundary or an exact helper-recognized safe-to-reset crash\s+residue/u,
  /malformed or foreign residue fails while every mutation flag remains false/u,
  /disable stale roles, run the SHA-verified helper `stop`, and\s+call the read-only preflight again/u,
  /second result must be exactly clean before a local bundle is\s+created/u,
  /incomplete temp-only binding prefix is discarded/u,
  /exact complete\s+230-byte temp must first project to the archived v1 identity/u,
  /atomically hard-links it\s+to the absent final name, removes the temp link, synchronizes the directory/u,
  /reattests the same\s+inode, single link, and content/u,
  /final-plus-same-inode temp likewise removes only the temp link and\s+preserves the final v2 artifact/u,
  /preserved final artifact is then offline-finalized to exact\s+`resealed-awaiting-recheck` continuity/u,
  /exact 23-file bundle/u,
  /run-unique mode-`0700` staging\s+directory/u,
  /captures that directory's device\/inode/u,
  /atomic no-replace rename plus parent-directory synchronization/u,
  /provisions fresh\s+24-hour database roles, invokes only `reinstall-kemerbet-v1-retirement-secrets`/u,
  /starts the exact\s+private core, arms its derived expiry, then starts and verifies the bot and public edge/u,
  /exactly the two durable project volumes\s+`fetanagent-staging-beta_kemerbet_sessions` and\s+`fetanagent-staging-beta_kemerbet_session_control`/u,
  /exact local driver\/scope, three\s+Compose labels, canonical Docker mount paths, mode\/owner contract, zero holders/u,
  /Any readiness snapshot\/RPC\/output volume,\s+third project volume, holder, label\/option drift, or other transient residue fails closed/u,
  /exact staging, incoming, or atomic `\.consumed` path/u,
  /preflight failure cannot clean or mutate pre-existing residue/u,
  /A resealed state\s+must never reopen the private sign-in ceremony/u,
  /first candidate bearer may reach only\s+the fixed read-only Profile request until its stable Profile HMAC matches the v3 pin/u,
  /Any malformed profile, wrong agent, bearer drift, race,\s+abort, timeout, or disconnect is sticky-fatal/u,
  /trusted Layer-7 proxy is part of the trusted computing base/u,
  /proxy RCE or proxy-process\s+compromise is outside this fail-closed guarantee/u,
  /terminates KemerBet TLS[\s\S]*?current bearer and Player identifier[\s\S]*?only egress route/u,
  /depends on the pinned, reviewed image and source/u,
]) {
  assert.match(executorRunbook, documentationContract);
}
assert.match(readinessProfileSnapshotSource, /networkMode: 'none'/);
assert.match(
  readinessProfileSnapshotSource,
  /const MAXIMUM_PROFILE_FILE_BYTES = 256 \* 1024 \* 1024/,
);
assert.match(
  readinessProfileSnapshotSource,
  /const MAXIMUM_PROFILE_TREE_BYTES = 1024 \* 1024 \* 1024/,
);
assert.match(
  readinessProfileSnapshotSource,
  /resourceLimits: KEMERBET_READINESS_PROFILE_SNAPSHOT_LIMITS/,
);
for (const snapshotResourceBoundary of [
  /before\.size > MAXIMUM_PROFILE_FILE_BYTES/,
  /logicalFileBytes > MAXIMUM_PROFILE_TREE_BYTES - before\.size/,
  /const readLength = Math\.min\(buffer\.length, remaining \+ 1\)/,
  /if \(bytesRead > remaining\) return unavailable\(\)/,
  /Math\.min\(MAXIMUM_PROFILE_FILE_BYTES, MAXIMUM_PROFILE_TREE_BYTES - readFileBytes\)/,
  /readFileBytes > MAXIMUM_PROFILE_TREE_BYTES/,
  /hashed\.bytes !== before\.size/,
  /buffer\.fill\(0\)/,
]) {
  assert.match(readinessProfileSnapshotSource, snapshotResourceBoundary);
}
assert.match(
  readinessProfileSnapshotSource,
  /browserRootGroupId: 10001,[\s\S]*?browserRootMode: 0o700,[\s\S]*?browserRootUserId: 10001/,
  'only the verified disposable volume root may be handed to the UID-10001 browser',
);

assert.match(chromiumProfileSource, /const SERVICE_WORKER_DIRECTORY = 'Service Worker'/);
assert.match(
  chromiumProfileSource,
  /const SERVICE_WORKER_TOMBSTONE = '\.Service Worker\.fetanagent-purge-v1'/,
);
assertOrderedFragments(
  chromiumProfileSource.slice(
    chromiumProfileSource.indexOf('export async function purgeKemerBetPersistedServiceWorkerState'),
  ),
  [
    "const defaultRoot = exactChild(profilePath, 'Default');",
    'const live = exactChild(defaultRoot, SERVICE_WORKER_DIRECTORY);',
    'const tombstone = exactChild(defaultRoot, SERVICE_WORKER_TOMBSTONE);',
    "if (liveState === 'present' && tombstoneState === 'present') unavailable();",
    'await fileSystem.rename(live, tombstone);',
    'await syncDirectory(fileSystem, defaultRoot);',
    'await removeExactOwnedTree(fileSystem, tombstone, tombstone, effectiveUserId);',
    'await syncDirectory(fileSystem, defaultRoot);',
  ],
  'service-worker removal must be exact, crash-resumable, and directory-synced',
);

const cleanProfileAttestorStart = chromiumProfileSource.indexOf(
  'export async function assertKemerBetChromiumProfileCleanlyClosed',
);
const cleanProfileAttestorEnd = chromiumProfileSource.indexOf(
  'async function syncDirectory',
  cleanProfileAttestorStart,
);
assert.ok(cleanProfileAttestorStart >= 0 && cleanProfileAttestorEnd > cleanProfileAttestorStart);
const cleanProfileAttestorSource = chromiumProfileSource.slice(
  cleanProfileAttestorStart,
  cleanProfileAttestorEnd,
);
assertOrderedFragments(
  cleanProfileAttestorSource,
  [
    'await requireStableOwnedDirectory(fileSystem, profilePath, effectiveUserId);',
    "const defaultRoot = exactChild(profilePath, 'Default');",
    'for (const singleton of CHROMIUM_SINGLETON_ARTIFACTS)',
    'constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)',
    'contents = await handle.readFile();',
    "profileObject.exit_type !== 'Normal'",
    'contents?.fill(0);',
    'await handle?.close();',
    'const pathAfterClose = await fileSystem.lstat(preferencesPath);',
    '!exactStableStat(openedAfterRead, pathAfterClose)',
    '(await fileSystem.realpath(preferencesPath)) !== preferencesPath',
    'await requireStableOwnedDirectory(fileSystem, profilePath, effectiveUserId);',
  ],
  'clean profile attestation must be read-only, stable, redacted, and require Chromium Normal exit',
);
assert.doesNotMatch(
  cleanProfileAttestorSource,
  /\.(?:write|writeFile|rename|chmod|truncate|unlink|rm)\s*\(|exit_type\s*=(?!=)/u,
  'clean profile attestation must never repair or mutate Chromium Preferences',
);
assert.doesNotMatch(
  cleanProfileAttestorSource,
  /console\.|JSON\.stringify|sessionStorage|localStorage|Cookies?/iu,
  'clean profile attestation must never log or inspect provider session material',
);

const guardedProbeStart = noTransferReadinessSealSource.indexOf(
  'async function createKemerBetNoTransferReadinessGuardedProbeFromPage',
);
const guardedProbeEnd = noTransferReadinessSealSource.indexOf(
  'export async function createKemerBetNoTransferReadinessSealProbeFromPage',
  guardedProbeStart,
);
assert.ok(guardedProbeStart >= 0 && guardedProbeEnd > guardedProbeStart);
const guardedProbeSource = noTransferReadinessSealSource.slice(guardedProbeStart, guardedProbeEnd);
assertOrderedFragments(
  guardedProbeSource,
  [
    'requestBoundary.armCanonicalMainNavigation();',
    'options.startup.armCanonicalNavigation();',
    'await options.startup.setOnline();',
    'await options.page.goto(KEMERBET_AGENT_DEPOSIT_URL, {',
    'await requestBoundary.drain();',
    'requestBoundary.beginTerminalClose();',
    'await options.close();',
    'await requestBoundary.drain();',
    'if (requestBoundary.internalViolation()) unavailable();',
  ],
  'the retained page must arm its exact navigation and enter a sticky terminal abort before close',
);

const persistentProbeStart = noTransferReadinessSealSource.indexOf(
  'export async function openKemerBetNoTransferReadinessPersistentProfileProbe',
);
const persistentProbeEnd = noTransferReadinessSealSource.indexOf(
  'async function productionOpenProbe',
  persistentProbeStart,
);
assert.ok(persistentProbeStart >= 0 && persistentProbeEnd > persistentProbeStart);
const persistentProbeSource = noTransferReadinessSealSource.slice(
  persistentProbeStart,
  persistentProbeEnd,
);
for (const safeArgument of [
  "'--restore-last-session'",
  "'--disable-quic'",
  "'--dns-prefetch-disable'",
  "'--disable-features=NetworkPrediction,PreconnectToSearch,SpeculationRulesPrefetchFuture,WebTransport'",
  "'--disable-network-prediction'",
  "'--disable-preconnect'",
  "'--disable-webrtc'",
  "'--force-webrtc-ip-handling-policy=disable_non_proxied_udp'",
  '`--host-resolver-rules=${buildKemerBetReadinessIsolatedChromiumHostResolverRules(isolatedBoundary.proxyIpv4)}`',
  '`--ignore-certificate-errors-spki-list=${isolatedBoundary.proxySpkiSha256}`',
]) {
  assert.ok(
    persistentProbeSource.includes(safeArgument),
    `missing Chromium safety argument ${safeArgument}`,
  );
}
assert.match(persistentProbeSource, /ignoreDefaultArgs: \['about:blank'\]/);
assert.match(persistentProbeSource, /offline: true/);
assert.match(persistentProbeSource, /serviceWorkers: 'block'/);
assert.match(
  noTransferReadinessSealSource,
  /Storage\.clearDataForOrigin'[\s\S]*?storageTypes: 'service_workers,cache_storage'[\s\S]*?ServiceWorker\.stopAllWorkers'[\s\S]*?Network\.setBypassServiceWorker'[\s\S]*?Network\.setCacheDisabled'/,
);
assert.match(
  noTransferReadinessSealSource,
  /`MAP \$\{KEMERBET_AGENT_WEB_HOSTNAME\}:443 \$\{proxyIpv4\}:\$\{KEMERBET_READINESS_LAYER7_PROXY_PORT\}`,[\s\S]*?`MAP \$\{KEMERBET_AGENT_API_HOSTNAME\}:443 \$\{proxyIpv4\}:\$\{KEMERBET_READINESS_LAYER7_PROXY_PORT\}`,[\s\S]*?`MAP \$\{new URL\(KEMERBET_AGENT_BOOTSTRAP_ORIGIN\)\.hostname\}:443 \$\{proxyIpv4\}:\$\{KEMERBET_READINESS_LAYER7_PROXY_PORT\}`,[\s\S]*?`EXCLUDE \$\{proxyIpv4\}`,[\s\S]*?'EXCLUDE localhost',[\s\S]*?'MAP \* ~NOTFOUND'/,
  'Chromium DNS must map only the three reviewed KemerBet hosts to the fixed proxy and fail every other hostname closed',
);
assert.match(
  persistentProbeSource,
  /await assertKemerBetChromiumProfileCleanlyClosed\(profile, options\.effectiveUserId\)/,
);
assert.match(
  persistentProbeSource,
  /await purgeKemerBetPersistedServiceWorkerState\(profile, options\.effectiveUserId\)/,
);
assert.doesNotMatch(
  persistentProbeSource,
  /\.newPage\(|sessionStorage\.getItem|storageState\(/,
  'the browser must retain the sole restored page without exporting or copying authentication state',
);
assertOrderedFragments(
  persistentProbeSource,
  [
    'await assertKemerBetChromiumProfileCleanlyClosed(profile, options.effectiveUserId);',
    'await removeStaleChromiumSingletonArtifacts(profile);',
    'await purgeKemerBetPersistedServiceWorkerState(profile, options.effectiveUserId);',
    'await isolatedBoundary.revalidateNetworkTopology().catch(() => unavailable());',
    'context = await chromium.launchPersistentContext(profile, {',
    'await isolatedBoundary.revalidateNetworkTopology().catch(() => unavailable());',
    'const restoredPage = await waitForSoleCanonicalKemerBetAgentRestoredPage(retainedContext);',
    "retainedContext.on('serviceworker'",
    'await requestBoundary.install();',
    "await retainedContext.routeWebSocket('**/*'",
    'isolatedCdpSession = await prepareKemerBetIsolatedBrowserDriverOfflineContext(',
    'await isolatedBoundary.revalidateNetworkTopology().catch(() => unavailable());',
    'const probe = await createKemerBetNoTransferReadinessGuardedProbeFromPage({',
  ],
  'static zero-default-route attestations and service-worker/WebSocket guards must surround browser startup before online use',
);

const restoredPageWaitStart = noTransferReadinessSealSource.indexOf(
  'export async function waitForSoleCanonicalKemerBetAgentRestoredPage',
);
const restoredPageWaitEnd = noTransferReadinessSealSource.indexOf(
  'export interface KemerBetReadinessPersistentLifecycleBoundary',
  restoredPageWaitStart,
);
assert.ok(restoredPageWaitStart >= 0 && restoredPageWaitEnd > restoredPageWaitStart);
const restoredPageWaitSource = noTransferReadinessSealSource.slice(
  restoredPageWaitStart,
  restoredPageWaitEnd,
);
assertOrderedFragments(
  restoredPageWaitSource,
  [
    "context.on('page', onPage);",
    'let pages = context.pages();',
    'if (pages.length > 1) return null;',
    "initialUrl !== 'about:blank'",
    'await page.waitForURL(KEMERBET_AGENT_DEPOSIT_URL, {',
    'if (topologyViolated) return null;',
    'return selectSoleCanonicalKemerBetAgentRestoredPage(pages, page);',
    "context.off('page', onPage);",
  ],
  'restored-page admission must wait only for one existing canonical tab and fail sticky on replacement',
);
assert.doesNotMatch(
  restoredPageWaitSource,
  /\.newPage\(|\.goto\(|\.reload\(|sessionStorage|localStorage/u,
  'restored-page waiting must never create, navigate, reload, or export the authenticated tab',
);

assert.match(persistentBrowserCheckpointSource, /input\.effectiveUserId !== 10_001/);
assertOrderedFragments(
  persistentBrowserCheckpointSource.slice(
    persistentBrowserCheckpointSource.indexOf('async function waitForBrowserDisconnect'),
    persistentBrowserCheckpointSource.indexOf('async function waitForCleanProfile'),
  ),
  ["closeSession.send('Browser.close')", 'await disconnected;'],
  'the graceful browser command must be followed by an independently observed disconnection',
);
assertOrderedFragments(
  persistentBrowserCheckpointSource,
  [
    'if (browser === null || !exactLiveTopology(browser, input.context, input.page)) unavailable();',
    'closeSession = await browser.newBrowserCDPSession();',
    'await waitForBrowserDisconnect({',
    'if (!exactClosedTopology(browser, input.context, input.page)) unavailable();',
    'await waitForCleanProfile({',
    'assertProfileCleanlyClosed:',
    'if (!exactClosedTopology(browser, input.context, input.page)) unavailable();',
  ],
  'checkpoint close must use direct graceful CDP shutdown, prove disconnection, then attest a clean profile',
);
assert.doesNotMatch(
  persistentBrowserCheckpointSource,
  /\b(?:input\.)?context\.close\(|\bbrowser\.close\(|Preferences|exit_type\s*=(?!=)|console\./u,
  'checkpoint close must not invoke Playwright force-kill fallbacks, mutate Preferences, or log session data',
);
assert.doesNotMatch(
  `${persistentBrowserCheckpointSource}\n${persistentBrowserCheckpointSmokeSource}`,
  /Amount|Notes|Transfer|Player(?:\s*ID)?|moneyMoved|FINANCIAL_ACTIONS_MODE\s*:\s*'live'/u,
  'checkpoint proof must contain no financial or Player-lookup operation',
);
assertOrderedFragments(
  persistentBrowserCheckpointSmokeSource,
  [
    "const CHROMIUM_PATH = '/usr/bin/chromium';",
    'const EFFECTIVE_USER_ID = 10_001;',
    'const profilePath = await mkdtemp(',
    'page.goto(expectedUrl,',
    'await closeKemerBetPersistentBrowserForRestorableCheckpoint({',
    "args: ['--restore-last-session', ...CHROMIUM_NETWORK_REDUCTION_ARGUMENTS],",
    "ignoreDefaultArgs: ['about:blank'],",
    'offline: true,',
    'page = await waitForRestoredSmokePage(restoredContext, expectedUrl);',
    'if (retained !== true) unavailable();',
    'await closeKemerBetPersistentBrowserForRestorableCheckpoint({',
  ],
  'the disposable image smoke must prove clean close and tab-scoped restoration with the pinned Chromium runtime',
);
assert.doesNotMatch(
  persistentBrowserCheckpointSmokeSource,
  /agentsystem\.admindigi\.com|kemerbet\.co|console\.(?:log|error)\([^\n]*(?:SENTINEL|profilePath|expectedUrl)/u,
  'the image smoke must use only a harmless local page and must not print its profile or sentinel',
);
assert.doesNotMatch(
  `${readinessNetworkGateSource}\n${readinessBrowserRpcSource}\n${readinessBrowserDriverSource}\n${readinessLayer7ProxySource}`,
  /fetanagent-kemerbet-readiness-network-gate-(?:ready|release)-v1|waitForKemerBetReadinessNetworkRelease|publishReadyFile/,
  'the retired dynamic ready/release marker protocol must stay absent',
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
  reviewedSelectorContract.sessionFailure.captcha,
  'iframe[src*="recaptcha"][src*="/bframe"]',
);
assert.notEqual(reviewedSelectorContract.sessionFailure.captcha, 'iframe[src*="recaptcha"]');
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
  /const MAX_GENERATION_LIFETIME_MS = LOGIN_LIFETIME_MS \+ AUTHENTICATED_SESSION_LIFETIME_MS/,
);
const provisionCheckpointIdentityVerifierSource = privateSessionProvisionServerSource.slice(
  privateSessionProvisionServerSource.indexOf(
    'async function verifyKemerBetProvisionCheckpointAuthenticatedPage',
  ),
  privateSessionProvisionServerSource.indexOf(
    'export async function checkpointKemerBetProvisionSignedInPage',
  ),
);
assert.match(
  provisionCheckpointIdentityVerifierSource,
  /loadKemerBetAgentIdentityBindings\(\{[\s\S]*?filePath: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,[\s\S]*?bindings\.platformAgentAccountIds\.length !== 1[\s\S]*?bindings\.platformAgentAccountIds\[0\] !== input\.accountId[\s\S]*?observedFingerprint !== expectedFingerprint/u,
  'the final checkpoint must compare the observed identity with the sole immutable exact-account binding',
);
const provisionAuthenticatedIdentityVerifierSource = privateSessionProvisionServerSource.slice(
  privateSessionProvisionServerSource.indexOf(
    'export async function prepareKemerBetProvisionAuthenticatedIdentityVerifier',
  ),
  privateSessionProvisionServerSource.indexOf('export type KemerBetSessionRequestDecision'),
);
assert.match(
  provisionAuthenticatedIdentityVerifierSource,
  /loadKemerBetSessionIdentityAuthorization\(\{[\s\S]*?filePath: KEMERBET_AGENT_IDENTITY_BINDINGS_FILE,[\s\S]*?authorization\.platformAgentAccountId !== accountId/u,
  'initial authentication must load one exact ordinary-or-recovery identity authorization for the requested Profile',
);
assert.match(
  provisionAuthenticatedIdentityVerifierSource,
  /fingerprintAgentIdentityWithKey\(\s*authorization\.verificationPlatformAgentAccountId,\s*rawIdentity,[\s\S]*?equalAgentIdentityFingerprints\([\s\S]*?authorization\.expectedAgentIdentityFingerprint[\s\S]*?fingerprintAgentIdentityWithKey\(accountId, rawIdentity\)/u,
  'recovery authentication must prove the raw observation under the retired UUID before deriving its fresh UUID-bound digest',
);
assert.match(
  privateSessionProvisionServerSource,
  /createAgentIdentityFingerprinter: async \(\) =>\s*retainedAuthenticatedIdentityVerifier\.fingerprintAgentIdentity/u,
  'the readiness seal must reuse the authenticated identity wrapper so its exact DOM observation is continuity-checked before publication',
);
assert.doesNotMatch(
  provisionAuthenticatedIdentityVerifierSource,
  /console\.(?:debug|error|info|log|warn)\([^\n]*rawIdentity/u,
  'the recovery identity verifier must never log the raw signed-in identity',
);
assert.match(
  privateSessionProvisionServerSource,
  /offline: true,[\s\S]*?observedContext\.on\('page'[\s\S]*?observedContext\.route\('\*\*\/\*'[\s\S]*?observedContext\.routeWebSocket\('\*\*\/\*'[\s\S]*?observedContext\.setOffline\(false\)[\s\S]*?nextPage\.goto\(KEMERBET_AGENT_LOGIN_RETRY_URL/u,
  'the provision browser must remain offline until popup, HTTP, and WebSocket boundaries are installed',
);
assert.match(
  privateSessionProvisionServerSource,
  /serviceWorkers: 'block',[\s\S]*?observedContext\.on\('serviceworker'[\s\S]*?observedContext\.serviceWorkers\(\)\.length !== 0[\s\S]*?observedContext\.setOffline\(false\)/u,
  'service workers must be blocked, observed, and absent before the offline browser is enabled',
);
assertOrderedFragments(
  privateSessionProvisionServerSource.slice(
    privateSessionProvisionServerSource.indexOf('const initialize = async'),
    privateSessionProvisionServerSource.indexOf('const start = ('),
  ),
  [
    'generationLease = await acquireProfileGenerationLease(profile, effectiveUserId);',
    'await purgePersistedServiceWorkerState(profile, effectiveUserId);',
    'nextContext = await launch(profile, {',
    'offline: true,',
  ],
  'a durable profile generation lease and worker purge must precede every offline Chromium launch',
);
assert.match(
  privateSessionProvisionServerSource,
  /closeKemerBetReadinessGuardedWebSocket\(\{[\s\S]*?observeWebSocket: \(\) => observeForbiddenNetworkAttempt\('transport_guard'\)[\s\S]*?webSocket,/u,
  'every socket must reuse the exact reviewed local-close boundary and unknown sockets must fault the generation',
);
assert.match(
  privateSessionProvisionServerSource,
  /const forceQuarantineAtHardDeadline = \(generation: string\)[\s\S]*?now\(\)\.getTime\(\) < generationDeadline\.getTime\(\)[\s\S]*?readMonotonicNow\(\) < generationDeadlineMonotonicMs[\s\S]*?startupStatus\?\.status === 'starting'[\s\S]*?failureCode: 'cleanup_unverified'[\s\S]*?stage: 'cleanup'[\s\S]*?checkpointedForRecheck = true;[\s\S]*?forceQuarantine\(1\);/u,
  'uncertain Chromium cleanup must quarantine the generation no later than its immutable hard deadline',
);
assert.match(
  privateSessionProvisionServerSource,
  /exactObject\(decoded, \['password', 'token', 'userName'\]\)[\s\S]*?userName\.length <= 30[\s\S]*?password\.length >= 8[\s\S]*?password\.length <= 24[\s\S]*?token\.length >= 16/u,
  'login authority must be limited to the exact pinned v84 three-field credential envelope',
);
assert.match(
  privateSessionProvisionServerSource,
  /KEMERBET_RECAPTCHA_SITE_KEY_SHA256[\s\S]*?function exactRecaptchaSiteKey[\s\S]*?createHash\('sha256'\)[\s\S]*?expectedSha256[\s\S]*?exactRecaptchaSiteKey\(siteKey, KEMERBET_RECAPTCHA_SITE_KEY_SHA256\)/u,
  'the application-owned reCAPTCHA bootstrap must pin the exact public site-key digest',
);
const privateSessionRecaptchaStart = privateSessionProvisionServerSource.indexOf(
  'async function fetchKemerBetRecaptchaAsset',
);
const privateSessionRecaptchaEnd = privateSessionProvisionServerSource.indexOf(
  'export function classifyKemerBetSessionRequest',
  privateSessionRecaptchaStart,
);
assert.ok(
  privateSessionRecaptchaStart >= 0 && privateSessionRecaptchaEnd > privateSessionRecaptchaStart,
);
const privateSessionRecaptchaSource = privateSessionProvisionServerSource.slice(
  privateSessionRecaptchaStart,
  privateSessionRecaptchaEnd,
);
const privateSessionRecaptchaFetchEnd = privateSessionProvisionServerSource.indexOf(
  'function normalizedMime',
  privateSessionRecaptchaStart,
);
assert.ok(privateSessionRecaptchaFetchEnd > privateSessionRecaptchaStart);
const privateSessionRecaptchaFetchSource = privateSessionProvisionServerSource.slice(
  privateSessionRecaptchaStart,
  privateSessionRecaptchaFetchEnd,
);
for (const exactPin of [
  'ox8dsmiqR62P1bqhciWOn7Fg',
  'e0c02200d83614704ac5381ecb6319282e1f8dfa24e4cc09b6af0a05ee91174a',
  '072d298ea24238552d7805174c49bc793d13a12d619d4ceb87c209bbc5c0bd67',
  'a41ae6ba81d8d52bd8763a8ea3004297f960f3cfa3f632c761a19fff1d886196',
  '13d2b33f69a7c240b4d8a2825b33d638e42bb00a277f9e590da40eb5e639ccbc',
  '1b9efb22c938500971aac2b2130a475fa23684dd69e43103894968df83145b8a',
]) {
  assert.ok(
    privateSessionProvisionServerSource.includes(exactPin),
    `private sign-in must retain the reviewed reCAPTCHA pin ${exactPin}`,
  );
}
for (const exactSize of [
  'bytes: 1_582',
  'bytes: 843_859',
  'bytes: 102',
  'bytes: 82_980',
  'bytes: 2_228',
]) {
  assert.ok(
    privateSessionProvisionServerSource.includes(exactSize),
    `private sign-in must retain the reviewed reCAPTCHA byte contract ${exactSize}`,
  );
}
for (const startupStage of [
  'browser_launch',
  'cleanup',
  'preflight',
  'preview_ready',
  'profile',
  'provider_asset',
  'provider_navigation',
  'recaptcha_asset',
  'recaptcha_ceremony',
  'transport_guard',
]) {
  assert.ok(
    privateSessionProvisionServerSource.includes(`| '${startupStage}'`),
    `private sign-in must retain the fixed redacted startup stage ${startupStage}`,
  );
}
for (const failureCode of [
  'cleanup_unverified',
  'contract_mismatch',
  'deadline_exceeded',
  'dependency_unavailable',
  'forbidden_request',
]) {
  assert.ok(
    privateSessionProvisionServerSource.includes(`| '${failureCode}'`),
    `private sign-in must retain the fixed redacted startup failure code ${failureCode}`,
  );
}
assert.match(
  privateSessionProvisionServerSource,
  /createKemerBetProvisionStartupFailureEvent[\s\S]*?detailsRedacted: true[\s\S]*?event: 'startup_failed'[\s\S]*?schemaVersion: 1[\s\S]*?reportStartupStage[\s\S]*?recordStartupFailure[\s\S]*?publishStartupFailure/u,
  'startup diagnostics must use one fixed redacted event and a separate record-then-publish lifecycle',
);
assert.match(
  privateSessionProvisionServerSource,
  /terminalStartupRequestId === input\.requestId[\s\S]*?terminalStartupAccountId === input\.platformAgentAccountId\) return snapshot\(\);[\s\S]*?return unavailable\(\);/u,
  'a failed Start request id must stay bound to one account and only its exact duplicate may return the terminal diagnostic',
);
assert.match(
  privateSessionProvisionServerSource,
  /const exactTerminalStartupFailure =[\s\S]*?expectedAccountId !== undefined[\s\S]*?startupStatus\?\.status === 'failed'[\s\S]*?terminalStartupAccountId === expectedAccountId[\s\S]*?!exactTerminalStartupFailure[\s\S]*?return unavailable\(\);/u,
  'a cleanup quarantine may expose only the exact bound terminal startup failure',
);
assert.match(
  privateSessionProvisionServerSource,
  /if \(startupFailureCandidate\?\.generation === generation\) \{[\s\S]*?if \(forcedContextClose\) \{[\s\S]*?failureCode: 'cleanup_unverified'[\s\S]*?stage: 'cleanup'[\s\S]*?\} else \{[\s\S]*?publishStartupFailure\(generation\);/u,
  'forced startup cleanup must override an earlier causal failure with cleanup uncertainty before publication',
);
assert.match(
  privateSessionProvisionServerSource,
  /KEMERBET_ABORTABLE_STATIC_ASSETS[\s\S]*?en-DC_46aZL\.svg[\s\S]*?logo-sign-DirsW9WY\.svg[\s\S]*?fonts\.googleapis\.com\/css2[\s\S]*?return 'abort_optional'[\s\S]*?KEMERBET_REQUIRED_STATIC_ASSETS[\s\S]*?return 'allow'/u,
  'reviewed cosmetic drift must be locally aborted while the exact required translation remains allowed',
);
assert.match(
  privateSessionRecaptchaSource,
  /redirect: 'manual'[\s\S]*?declaredLength[\s\S]*?Number\(declaredLength\) > input\.maxBytes[\s\S]*?reader\.cancel\(\)[\s\S]*?bytes > input\.maxBytes[\s\S]*?reader\.cancel\(\)[\s\S]*?fetched\.finalUrl !== url[\s\S]*?fetched\.status !== 200[\s\S]*?normalizedMime\(fetched\.contentType\) !== pin\.mime[\s\S]*?fetched\.accessControlAllowOrigin[\s\S]*?fetched\.crossOriginEmbedderPolicy[\s\S]*?fetched\.crossOriginResourcePolicy[\s\S]*?body\.byteLength !== pin\.bytes[\s\S]*?createHash\('sha256'\)\.update\(body\)\.digest\('hex'\) !== pin\.sha256[\s\S]*?route\.fulfill/u,
  'executable reCAPTCHA bytes must be streamed under a cap and fulfilled only after URL, status, MIME, length, and digest proof',
);
assert.match(
  privateSessionRecaptchaSource,
  /'access-control-allow-origin': pin\.accessControlAllowOrigin[\s\S]*?'cross-origin-embedder-policy': pin\.crossOriginEmbedderPolicy[\s\S]*?'cross-origin-resource-policy': pin\.crossOriginResourcePolicy[\s\S]*?'x-content-type-options': 'nosniff'/u,
  'synthetic reCAPTCHA fulfills must reproduce only the pinned browser-semantics response headers',
);
assert.match(
  privateSessionRecaptchaSource,
  /const controller = new AbortController\(\);[\s\S]*?setTimeout\(\(\) => controller\.abort\(\), input\.timeoutMs\)[\s\S]*?signal: controller\.signal[\s\S]*?clearTimeout\(timeout\)/u,
  'every pinned asset fetch must retain its independent aborting timeout',
);
assert.match(
  privateSessionProvisionServerSource,
  /MAX_KEMERBET_CHROMIUM_USER_AGENT_BYTES = 192[\s\S]*?KEMERBET_CHROMIUM_USER_AGENT_PATTERN =[\s\S]*?HeadlessChrome[\s\S]*?function exactKemerBetChromiumUserAgent[\s\S]*?value\.length >= 96[\s\S]*?value\.length <= MAX_KEMERBET_CHROMIUM_USER_AGENT_BYTES[\s\S]*?Buffer\.byteLength\(value, 'utf8'\) === value\.length[\s\S]*?KEMERBET_CHROMIUM_USER_AGENT_PATTERN\.test\(value\)/u,
  'only one bounded ASCII retained-browser HeadlessChrome User-Agent grammar may select the reviewed asset variant',
);
assert.match(
  privateSessionRecaptchaFetchSource,
  /if \(!exactKemerBetChromiumUserAgent\(input\.userAgent\)\) return unavailable\(\);[\s\S]*?credentials: 'omit',[\s\S]*?headers: \{ 'user-agent': input\.userAgent \},[\s\S]*?method: 'GET',[\s\S]*?redirect: 'manual'/u,
  'the credential-free asset fetch must forward only the validated retained-browser User-Agent',
);
assert.doesNotMatch(
  privateSessionRecaptchaFetchSource,
  /cookie|authorization|referer|sec-fetch|\.\.\.|headers:\s*(?:input|request)\./iu,
  'the pinned asset fetch must not accept or forward credentials, referrers, sec headers, or arbitrary header bags',
);
assert.match(
  privateSessionRecaptchaSource,
  /const requestHeaders = request\.headers\(\);[\s\S]*?const requestUserAgent = requestKemerBetChromiumUserAgent\(requestHeaders\);[\s\S]*?const exactUserAgentOmittedWebworker =[\s\S]*?step === 'static_subresources'[\s\S]*?chromiumUserAgent !== undefined[\s\S]*?anchorFrame !== undefined[\s\S]*?anchorUrl !== undefined[\s\S]*?candidate\.requestFrame === anchorFrame[\s\S]*?requestHeaderCount\(requestHeaders, 'user-agent'\) === 0[\s\S]*?exactRequestHeader\(requestHeaders, 'referer', anchorUrl\)[\s\S]*?expectedUrl: KEMERBET_RECAPTCHA_WEBWORKER_URL[\s\S]*?const assetFetchUserAgent =[\s\S]*?requestUserAgent \?\? \(exactUserAgentOmittedWebworker \? chromiumUserAgent : undefined\)[\s\S]*?assetFetchUserAgent === undefined[\s\S]*?requestUserAgent !== undefined &&[\s\S]*?requestUserAgent !== chromiumUserAgent[\s\S]*?chromiumUserAgent = assetFetchUserAgent[\s\S]*?fulfillPinnedAsset\([\s\S]*?assetPins\.api,[\s\S]*?assetFetchUserAgent/u,
  'every ceremony request must retain one exact stable browser User-Agent, except the exact Chrome 152 anchor-frame worker bootstrap which reuses the already verified value',
);
assert.match(
  privateSessionProvisionServerSource,
  /PLAYWRIGHT_1_62_1_DISABLED_CHROMIUM_FEATURES[\s\S]*?'AutofillServerCommunication'[\s\S]*?KEMERBET_CHROMIUM_NETWORK_REDUCTION_ARGUMENTS[\s\S]*?args: \[\.\.\.KEMERBET_CHROMIUM_NETWORK_REDUCTION_ARGUMENTS\][\s\S]*?ignoreDefaultArgs: \[PLAYWRIGHT_1_62_1_DISABLED_CHROMIUM_FEATURES_ARGUMENT\][\s\S]*?offline: true/u,
  'the retained browser must atomically preserve Playwright 1.62.1 safety features while suppressing browser-owned Autofill traffic before leaving offline mode',
);
assert.match(
  privateSessionProvisionServerSource,
  /KEMERBET_RECAPTCHA_VERIFIED_CACHE_TTL_MS = 10 \* 60 \* 1_000[\s\S]*?KEMERBET_RECAPTCHA_VERIFIED_CACHE_MAX_ENTRIES = 5[\s\S]*?verifiedRecaptchaAssetCacheKey\([\s\S]*?userAgent: string[\s\S]*?url,[\s\S]*?userAgent,[\s\S]*?pin\.sha256[\s\S]*?pin\.accessControlAllowOrigin[\s\S]*?pin\.crossOriginEmbedderPolicy[\s\S]*?pin\.crossOriginResourcePolicy[\s\S]*?now >= cached\.expiresAtMonotonicMs[\s\S]*?createHash\('sha256'\)\.update\(body\)\.digest\('hex'\) !== pin\.sha256[\s\S]*?Uint8Array\.from\(body\)/u,
  'the process cache must be bounded, expiring, keyed by User-Agent plus the complete reviewed pin contract, digest-rechecked, and copy-isolated',
);
assert.match(
  privateSessionRecaptchaSource,
  /input\.assetPins === undefined[\s\S]*?input\.fetchAsset === undefined \|\| input\.fetchAsset === fetchKemerBetRecaptchaAsset[\s\S]*?readVerifiedRecaptchaAssetCache\(processCacheKey, pin\)[\s\S]*?fetched\.finalUrl !== url[\s\S]*?createHash\('sha256'\)\.update\(body\)\.digest\('hex'\) !== pin\.sha256[\s\S]*?writeVerifiedRecaptchaAssetCache\(processCacheKey, body\)[\s\S]*?route\.fulfill/u,
  'only production default pins/fetching may reuse process-cached bytes, and cache insertion must follow complete origin proof',
);
assertOrderedFragments(
  privateSessionRecaptchaSource.slice(
    privateSessionRecaptchaSource.indexOf("if (step === 'api')"),
    privateSessionRecaptchaSource.indexOf('return forbidden(candidate.route);\n    } catch'),
  ),
  [
    "if (step === 'api')",
    "if (step === 'runtime_main')",
    "if (step === 'anchor')",
    "if (step === 'css')",
    "if (step === 'static_subresources')",
    "if (step === 'reload')",
    "if (step === 'clr')",
    "if (step === 'bcn')",
    "step = 'complete'",
  ],
  'the cold-fresh reCAPTCHA ceremony must preserve the one-use reviewed request order',
);
assert.match(
  privateSessionRecaptchaSource,
  /exactWebworker[\s\S]*?candidate\.requestFrame === anchorFrame[\s\S]*?anchorUrl !== undefined[\s\S]*?exactRequestHeader\(requestHeaders, 'referer', anchorUrl\)[\s\S]*?exactLogo[\s\S]*?candidate\.requestFrame === anchorFrame[\s\S]*?exactWorkerRuntime[\s\S]*?candidate\.requestFrame === anchorFrame[\s\S]*?exactWebworker && !webworkerLoaded[\s\S]*?exactLogo && !logoLoaded[\s\S]*?exactWorkerRuntime && webworkerLoaded && !workerRuntimeLoaded[\s\S]*?webworkerLoaded && logoLoaded && workerRuntimeLoaded/u,
  'logo and Chrome 152 worker startup may race only inside the exact anchor-frame static-subresource set, while the worker import remains causally ordered',
);
assert.ok(
  privateSessionProvisionServerSource.includes(
    "const KEMERBET_RECAPTCHA_ORIGIN_CO = 'aHR0cHM6Ly9hZ2VudHN5c3RlbS5hZG1pbmRpZ2kuY29tOjQ0Mw..';",
  ),
  'the anchor origin binding must retain Google reCAPTCHA dot padding rather than standard base64 padding',
);
assert.match(
  privateSessionRecaptchaSource,
  /\^\[0-9\]\{5\}\$[\s\S]*?query\.length !== expectedKeys\.length[\s\S]*?url\.searchParams\.get\('co'\) !== KEMERBET_RECAPTCHA_ORIGIN_CO[\s\S]*?url\.searchParams\.get\('v'\) !== KEMERBET_RECAPTCHA_VERSION[\s\S]*?\^\[a-z0-9\]\{12\}\$/u,
  'the reCAPTCHA anchor must bind the exact version, origin, query shape, and callback grammar',
);
assert.match(
  privateSessionRecaptchaSource,
  /expectedFrame: 'anchor' \| 'main'[\s\S]*?expectedFrame === 'anchor'[\s\S]*?exactAnchorFrame\(requestFrame, page\)[\s\S]*?: exactMainFrame\(requestFrame, page\)[\s\S]*?exactDynamicPost\([\s\S]*?candidate\.requestFrame,\s*'anchor',\s*'\/recaptcha\/api2\/reload'[\s\S]*?'application\/x-protobuffer'[\s\S]*?exactDynamicPost\([\s\S]*?candidate\.requestFrame,\s*'main',\s*'\/recaptcha\/api2\/clr'[\s\S]*?undefined[\s\S]*?exactDynamicPost\([\s\S]*?candidate\.requestFrame,\s*'anchor',\s*'\/recaptcha\/api2\/bcn'[\s\S]*?'application\/x-protobuf'/u,
  'the three dynamic POSTs must retain their exact per-step frame provenance, MIME, order, and endpoint contracts',
);
assert.match(
  privateSessionRecaptchaSource,
  /deadlineMonotonicMs: number;[\s\S]*?deadlineWallClockMs: number;[\s\S]*?monotonicNow: \(\) => number;[\s\S]*?wallClockNow: \(\) => number;[\s\S]*?monotonicTimestamp < input\.deadlineMonotonicMs[\s\S]*?wallTimestamp < input\.deadlineWallClockMs/u,
  'every reCAPTCHA ceremony must bind immutable wall-clock and monotonic deadlines',
);
assert.match(
  privateSessionRecaptchaSource,
  /verifiedAssetBodies\.set\(url, Buffer\.from\(body\)\);[\s\S]*?if \(poisoned \|\| !beforeDeadline\(\)\) return false;[\s\S]*?await route\.fulfill/u,
  'a pinned asset may be fulfilled only after an immediate dual-clock deadline check',
);
for (const dynamicStep of ['anchor', 'reload', 'clr', 'bcn']) {
  const dynamicStepStart = privateSessionRecaptchaSource.indexOf(`if (step === '${dynamicStep}')`);
  const dynamicStepEnd = privateSessionRecaptchaSource.indexOf(
    dynamicStep === 'bcn' ? "step = 'complete'" : "return 'handled';",
    dynamicStepStart,
  );
  assert.ok(dynamicStepStart >= 0 && dynamicStepEnd > dynamicStepStart);
  const dynamicStepSource = privateSessionRecaptchaSource.slice(dynamicStepStart, dynamicStepEnd);
  assert.match(
    dynamicStepSource,
    /if \(!beforeDeadline\(\)\) return forbidden\(candidate\.route\);[\s\S]*?await candidate\.route\.continue\(\)/u,
    `${dynamicStep} may release its request only after an immediate dual-clock deadline check`,
  );
}
assert.match(
  privateSessionProvisionServerSource,
  /decision !== 'allow' \|\| !loginRequest[\s\S]*?await recaptchaCeremony\.consumeKemerBetLoginPermit\(\)[\s\S]*?const activeSessionDeadlineAccepted = beforeDeadline\(\);[\s\S]*?if \(decision !== 'allow' \|\| !loginPermitAccepted \|\| !activeSessionDeadlineAccepted\)[\s\S]*?if \(!beforeDeadline\(\)\)[\s\S]*?await abortForExpiredDeadline\(\);[\s\S]*?await route\.continue\(\)/u,
  'KemerBet credentials must remain local until one exact lane-serialized login permit and an immediate active-session dual-clock check succeed',
);
assert.match(
  privateSessionRecaptchaSource,
  /const consumeLoginPermit = \(\): boolean => \{[\s\S]*?loginPermitConsumed[\s\S]*?step !== 'complete'[\s\S]*?!beforeDeadline\(\)[\s\S]*?poison\(\);[\s\S]*?loginPermitConsumed = true;[\s\S]*?consumeKemerBetLoginPermit: \(\) => enqueue\(consumeLoginPermit\)[\s\S]*?return enqueue\(\(\) => handle\(candidate\)\)/u,
  'the one-use login permit and all ceremony requests must share one replay-proof lane',
);
assert.match(
  privateSessionRecaptchaSource,
  /ceremonyStarted = true;[\s\S]*?observeMainFrameCommit: \(pageUrl: string\) => \{[\s\S]*?!ceremonyStarted &&[\s\S]*?step === 'api'[\s\S]*?pageState === 'login' \|\| pageState === 'agents'[\s\S]*?step === 'complete' && pageState === 'agents'[\s\S]*?retired = true;[\s\S]*?poison\(\);/u,
  'a ceremony may start on one initial document only and must retire after its sole completed agents transition',
);
assert.match(
  privateSessionRecaptchaSource,
  /poisoned \|\|[\s\S]*?retired \|\|[\s\S]*?retireForReauthentication: \(\) => \{[\s\S]*?poisoned \|\|[\s\S]*?!ceremonyStarted && step === 'api' && siteKey === undefined[\s\S]*?step === 'complete' && loginPermitConsumed[\s\S]*?poison\(\);[\s\S]*?return false;[\s\S]*?retired = true;[\s\S]*?return true;/u,
  'reauthentication may retire only an unused or consumed ceremony, and every retired ceremony must reject later routing',
);
assert.match(
  privateSessionRecaptchaSource,
  /!recaptchaAuthority && !kemerBetLogin[\s\S]*?Promise\.resolve\('not_recaptcha' as const\)/u,
  'unrelated KemerBet requests must bypass the large-asset ceremony lane while the exact login POST remains ordered behind its final beacon',
);
assert.match(
  privateSessionProvisionServerSource,
  /candidate\.kind === 'text'[\s\S]*?exactObject\(value, \[[\s\S]*?'frameSequence'[\s\S]*?'kind'[\s\S]*?'platformAgentAccountId'[\s\S]*?'requestId'[\s\S]*?'sessionGeneration'[\s\S]*?'text'[\s\S]*?\^\[\\u0020-\\u007e\]\{1,64\}\$[\s\S]*?!text\.includes\('`'\)/u,
  'batched preview text must use the exact body shape and a bounded printable non-backtick alphabet',
);
assert.match(
  privateSessionProvisionServerSource,
  /candidate\.frameSequence !== frameSequence[\s\S]*?frameImage = undefined;[\s\S]*?requireUnexpiredInputLease\(\);[\s\S]*?candidate\.kind === 'key'[\s\S]*?candidate\.kind === 'key'[\s\S]*?keyboard\.insertText\(candidate\.text\)/u,
  'one text batch must consume one displayed frame and pass the same dual-deadline gate as pointer and key input',
);
assert.doesNotMatch(
  privateSessionRecaptchaSource,
  /request\.postData\(\)|JSON\.parse\(request|route\.continue\(\{[\s\S]*?postData/u,
  'the reCAPTCHA boundary may count opaque bodies but must never inspect or rewrite them',
);
assert.match(
  privateSessionProvisionServerSource,
  /https:\/\/agt-cdn\.cdn-digi\.com\/prd\/system\/translations\/backoffice_en\.json/u,
  'the exact pinned-v84 default translation fetch must remain available',
);
assert.doesNotMatch(
  privateSessionProvisionServerSource,
  /['"]\/Project\/Balance['"]/u,
  'an endpoint with no pinned-v84 landing call site must not enter the authenticated allowlist',
);
assert.match(
  privateSessionProvisionServerSource,
  /const exactGlobalRefreshHeaders =[\s\S]*?headers\.grant_type === undefined && headers\.authorization === undefined;[\s\S]*?const exactNewServiceRefreshHeaders =[\s\S]*?headers\.grant_type === 'refresh_token'[\s\S]*?exactGlobalRefreshHeaders \|\| exactNewServiceRefreshHeaders/u,
  'only the two statically reachable pinned-v84 refresh header variants may pass',
);
assert.match(
  privateSessionProvisionServerSource,
  /phase = 'authenticating';[\s\S]*?authenticatedIdentityVerifier\.verify\(observedPage\)[\s\S]*?acceptAuthenticatedIdentityProof/u,
  'an agents URL must expose a non-authenticated verification phase until exact identity proof succeeds',
);
assert.match(
  privateSessionProvisionServerSource,
  /nextPage\.on\('framenavigated'[\s\S]*?phase !== 'stopping'[\s\S]*?phase !== 'faulted'[\s\S]*?recaptchaCeremony\.observeMainFrameCommit\(observedPage\.url\(\)\);[\s\S]*?identityVerificationEpoch \+= 1;[\s\S]*?if \(phase === 'authenticated'\) phase = 'authenticating';/u,
  'every committed main-frame document must invalidate identity proofs and bind one-use reCAPTCHA to one document epoch',
);
const privateSessionFrameNavigationStart = privateSessionProvisionServerSource.indexOf(
  "nextPage.on('framenavigated'",
);
const privateSessionFrameNavigationEnd = privateSessionProvisionServerSource.indexOf(
  "nextPage.on('crash'",
  privateSessionFrameNavigationStart,
);
assert.ok(
  privateSessionFrameNavigationStart >= 0 &&
    privateSessionFrameNavigationEnd > privateSessionFrameNavigationStart,
);
const privateSessionFrameNavigationSource = privateSessionProvisionServerSource.slice(
  privateSessionFrameNavigationStart,
  privateSessionFrameNavigationEnd,
);
assertOrderedFragments(
  privateSessionFrameNavigationSource,
  [
    "const returningToLogin = committedState === 'login' && phase === 'authenticated';",
    'if (returningToLogin) {',
    'const wallTimestamp = now().getTime();',
    'const monotonicTimestamp = readMonotonicNow();',
    'wallTimestamp >= expiresAt.getTime()',
    'wallTimestamp >= authenticatedDeadline.getTime()',
    'wallTimestamp >= generationDeadline.getTime()',
    'monotonicTimestamp >= expiresAtMonotonicMs',
    'monotonicTimestamp >= authenticatedDeadlineMonotonicMs',
    'monotonicTimestamp >= generationDeadlineMonotonicMs',
    'const reauthenticationDeadlineWallClockMs = Math.min(',
    'wallTimestamp + LOGIN_LIFETIME_MS,',
    'expiresAt.getTime(),',
    'authenticatedDeadline.getTime(),',
    'generationDeadline.getTime(),',
    'const reauthenticationDeadlineMonotonicMs = Math.min(',
    'monotonicTimestamp + LOGIN_LIFETIME_MS,',
    'expiresAtMonotonicMs,',
    'authenticatedDeadlineMonotonicMs,',
    'generationDeadlineMonotonicMs,',
    'replacement = newRecaptchaCeremony(',
    'reauthenticationDeadlineWallClockMs,',
    'reauthenticationDeadlineMonotonicMs,',
    'if (recaptchaCeremony.retireForReauthentication()) {',
    'recaptchaCeremony = replacement;',
    '} else {',
    'recaptchaCeremony.observeMainFrameCommit(observedPage.url());',
    'identityVerificationEpoch += 1;',
    "if (phase === 'authenticated') phase = 'authenticating';",
  ],
  'authenticated-to-login reauthentication must synchronously swap a fresh one-document ceremony under both clocks without extending the original lease',
);
assert.match(
  privateSessionProvisionServerSource,
  /const beforeActiveSessionDeadline = \(\): boolean => \{[\s\S]*?wallTimestamp < expiresAt\.getTime\(\)[\s\S]*?monotonicTimestamp < expiresAtMonotonicMs[\s\S]*?wallTimestamp < generationDeadline\.getTime\(\)[\s\S]*?monotonicTimestamp < generationDeadlineMonotonicMs[\s\S]*?wallTimestamp < authenticatedDeadline\.getTime\(\)[\s\S]*?monotonicTimestamp < authenticatedDeadlineMonotonicMs[\s\S]*?const newRecaptchaCeremony =[\s\S]*?deadlineWallClockMs: number,[\s\S]*?deadlineMonotonicMs: number,[\s\S]*?deadlineMonotonicMs,[\s\S]*?deadlineWallClockMs,[\s\S]*?let recaptchaCeremony = newRecaptchaCeremony\(expiresAt\.getTime\(\), expiresAtMonotonicMs\);[\s\S]*?observedContext\.route\('\*\*\/\*', \(route\) =>[\s\S]*?guardedRoute\([\s\S]*?recaptchaCeremony,[\s\S]*?beforeActiveSessionDeadline,[\s\S]*?observeActiveSessionDeadlineExceeded,/u,
  'the route closure must dereference the synchronously replaceable ceremony for every request',
);
assert.match(
  privateSessionProvisionServerSource,
  /const start = \(input: StartInput\)[\s\S]*?phase = 'starting';[\s\S]*?const task = initialize\(input, input\.requestId\);[\s\S]*?return snapshot\(\);[\s\S]*?sendJson\(response, 202, start\(candidate\)\)/u,
  'Start must return a bounded starting snapshot immediately while initialization continues asynchronously',
);
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
assert.equal(
  countMatches(privateSessionProvisionServerSource, /checkpointedForRecheck\s*=\s*true/g),
  8,
  'only exact pre-start or Start marker quarantine, hard-deadline, unexpected-close, forced-close, checkpoint, and readiness-seal boundaries may install the irreversible latch',
);
assert.equal(
  countMatches(privateSessionProvisionServerSource, /checkpointedForRecheck\s*=\s*false/g),
  1,
  'the irreversible in-process checkpoint latch must never reset',
);
assert.match(
  privateSessionProvisionServerSource,
  /explicitly trusted supervised enrollment[\s\S]*?not a compromised-renderer confidentiality boundary[\s\S]*?Containment begins only after this exact[\s\S]*?context is terminally closed/u,
  'source must not overclaim containment for the same-UID manual enrollment renderer',
);
const checkpointForRecheckStart = privateSessionProvisionServerSource.indexOf(
  'const checkpointForRecheck = async',
);
const checkpointForRecheckEnd = privateSessionProvisionServerSource.indexOf(
  'const input = async',
  checkpointForRecheckStart,
);
assert.ok(checkpointForRecheckStart >= 0 && checkpointForRecheckEnd > checkpointForRecheckStart);
const checkpointForRecheckSource = privateSessionProvisionServerSource.slice(
  checkpointForRecheckStart,
  checkpointForRecheckEnd,
);
const clearRuntimeStateStart = privateSessionProvisionServerSource.indexOf(
  'const clearRuntimeState = (',
);
const clearRuntimeStateEnd = privateSessionProvisionServerSource.indexOf(
  'const snapshot = (): KemerBetProvisionSessionStatus => {',
  clearRuntimeStateStart,
);
assert.ok(clearRuntimeStateStart >= 0 && clearRuntimeStateEnd > clearRuntimeStateStart);
const clearRuntimeStateSource = privateSessionProvisionServerSource.slice(
  clearRuntimeStateStart,
  clearRuntimeStateEnd,
);
assertOrderedFragments(
  clearRuntimeStateSource,
  [
    "nextPhase: 'checkpointed' | 'idle',",
    'preserveStartupFailure = false,',
    'cancelExpiry();',
    'cancelHardDeadline();',
    'context = undefined;',
    'page = undefined;',
    'profilePath = undefined;',
    'accountId = undefined;',
    'expiresAt = undefined;',
    'signedInLogged = false;',
    'authenticatedDeadline = undefined;',
    'authenticatedDeadlineMonotonicMs = undefined;',
    'generationDeadline = undefined;',
    'generationDeadlineMonotonicMs = undefined;',
    'expiresAtMonotonicMs = undefined;',
    'sessionGeneration = undefined;',
    'frameSequence = 0;',
    'frameImage = undefined;',
    'frameCapturedAtMs = undefined;',
    'pendingContext = undefined;',
    'pendingPage = undefined;',
    'pendingProfilePath = undefined;',
    'profileGenerationLease = undefined;',
    'pendingProfileGenerationLease = undefined;',
    'authenticatedIdentityVerifier = undefined;',
    'identityVerificationPromise = undefined;',
    'identityVerificationEpoch += 1;',
    'contextUnexpectedlyClosed = false;',
    'faultCleanupGeneration = undefined;',
    'if (!preserveStartupFailure) {',
    'startupStatus = undefined;',
    'startupFailureCandidate = undefined;',
    'terminalStartupAccountId = undefined;',
    'terminalStartupRequestId = undefined;',
    'phase = nextPhase;',
  ],
  'central session cleanup must clear every live, pending, preview, generation, and deadline reference',
);
assertOrderedFragments(
  checkpointForRecheckSource,
  [
    'await checkpointSignedInPage({',
    'requireExactCheckpointTopology({',
    'checkpointedForRecheck = true;',
    'await closePersistentBrowserForCheckpoint(',
    'profilePath: retainedProfilePath,',
    'await retainedProfileGenerationLease.releaseAfterCleanCheckpoint();',
    'blockedRequestCounter !== blockedRequestBaseline',
    "clearRuntimeState('checkpointed');",
    'checkpointed: true,',
  ],
  'one-use checkpoint validation and immutable latch must precede clean browser shutdown and state clear',
);
assert.doesNotMatch(
  checkpointForRecheckSource,
  /retainedContext\.close\(|\.catch\([^\n]*closePersistentBrowserForCheckpoint|checkpointedForRecheck\s*=\s*false/u,
  'checkpoint shutdown failure must propagate without a Playwright force-kill fallback or latch reset',
);
assert.match(
  privateSessionProvisionServerSource,
  /const status = async[\s\S]*?const exactTerminalStartupFailure =[\s\S]*?checkpointedForRecheck &&[\s\S]*?phase !== 'checkpointed' &&[\s\S]*?quarantineReasonCode === undefined &&[\s\S]*?!exactTerminalStartupFailure[\s\S]*?return unavailable\(\);[\s\S]*?return snapshot\(\);[\s\S]*?const initialize = async/,
  'a terminal checkpoint latch must expose only an exact bound startup-cleanup diagnostic or suppress ordinary session metadata',
);
assert.match(
  privateSessionProvisionServerSource,
  /const status = async \(expectedAccountId\?: string\)[\s\S]*?inspectRequestedProfileGenerationStatus\([\s\S]*?checkpointedForRecheck = true;[\s\S]*?quarantineReasonCode = inspection\.reasonCode;[\s\S]*?return snapshot\(\);/u,
  'status must surface an exact durable profile marker before Start and irreversibly close ordinary reuse',
);
assert.doesNotMatch(
  privateSessionProvisionServerSource.slice(
    privateSessionProvisionServerSource.indexOf('const status = async'),
    privateSessionProvisionServerSource.indexOf('const initialize = async'),
  ),
  /screenshot/u,
  'metadata status must never capture or return a browser frame',
);
assert.match(
  privateSessionProvisionServerSource,
  /request\.url\?\.startsWith\('\/v1\/session\/frame\?'\)[\s\S]*?if \(!query\)[\s\S]*?checkpointedForRecheck \|\|[\s\S]*?phase === 'checkpointed'/u,
  'the separate frame endpoint must reject every terminal checkpoint latch before returning preview bytes',
);
assert.match(
  privateSessionProvisionServerSource,
  /const input = async[\s\S]*?if \(\s*checkpointedForRecheck \|\|[\s\S]*?const sealReadiness = async/,
  'a terminal checkpoint latch must permanently close the credential-input lane',
);
assert.match(
  privateSessionProvisionServerSource,
  /const sealReadiness = async[\s\S]*?if \(\s*checkpointedForRecheck \|\|[\s\S]*?const closeRetainedContextForSeal/,
  'a terminal checkpoint latch must prevent a failed close from entering another seal attempt',
);
assertOrderedFragments(
  privateSessionProvisionServerSource.slice(
    privateSessionProvisionServerSource.indexOf(
      'const closeRetainedContextForSeal = async (): Promise<void> => {',
    ),
    privateSessionProvisionServerSource.indexOf('await runReadinessSeal({'),
  ),
  [
    'if (checkpointedForRecheck) return unavailable();',
    'checkpointedForRecheck = true;',
    'await closePersistentBrowserForCheckpoint(',
    'profilePath: retainedProfilePath,',
    "clearRuntimeState('checkpointed');",
    'retainedContextClosed = true;',
  ],
  'the supervised same-UID Chromium context must close successfully before the enrollment lane clears and binding write can proceed',
);
assert.match(
  privateSessionProvisionServerSource,
  /close: closeRetainedContextForSeal/,
  'the seal must receive the exact retained-context close callback rather than a no-op',
);
assert.match(
  privateSessionProvisionServerSource,
  /const READINESS_PLAYER_IDS_FILE = `\$\{CONTROL_ROOT\}\/kemerbet-readiness-player-ids\.stage-v1`[\s\S]*?loadExactKemerBetImportedReadinessPlayerIds\(\{[\s\S]*?effectiveUserId,[\s\S]*?filePath: READINESS_PLAYER_IDS_FILE,[\s\S]*?loadPlayerIds: loadReadinessPlayerIds/u,
  'the supervised seal must load the strict imported exact-five stage from the already-mounted private control volume',
);
assert.match(
  executorRuntimeIsolationSource,
  /export async function loadExactKemerBetStandaloneReadinessPlayerIds[\s\S]*?contract: \{[\s\S]*?fileGroupId: 10_001,[\s\S]*?fileMode: 0o400,[\s\S]*?fileUserId: 10_001,/u,
  'the standalone one-shot secret must retain its exact executor-owned 0400 contract',
);
assert.match(
  executorRuntimeIsolationSource,
  /export async function loadExactKemerBetImportedReadinessPlayerIds[\s\S]*?contract: \{[\s\S]*?fileGroupId: 0,[\s\S]*?fileMode: 0o444,[\s\S]*?fileUserId: 0,[\s\S]*?parent: \{[\s\S]*?groupId: 10_001,[\s\S]*?mode: 0o700,[\s\S]*?userId: 10_001,/u,
  'the imported readiness stage must be a frozen root-owned single-link file inside the exact private control directory',
);
assert.match(
  executorRuntimeIsolationSource,
  /function exactReadinessStageStat[\s\S]*?stat\.nlink === 1[\s\S]*?\(stat\.mode & 0o7777\) === contract\.fileMode/u,
  'every exact readiness stage contract must require one regular link and its exact mode',
);
assert.match(
  executorRuntimeIsolationSource,
  /function exactReadinessStageParentStat[\s\S]*?stat\.isDirectory\?\.\(\) === true[\s\S]*?stat\.uid === contract\.userId[\s\S]*?stat\.gid === contract\.groupId[\s\S]*?\(stat\.mode & 0o7777\) === contract\.mode/u,
  'the imported control parent must be the exact executor-owned 0700 directory',
);
assert.match(
  executorRuntimeIsolationSource,
  /options\.platform !== 'linux'[\s\S]*?constants\.O_DIRECTORY !== LINUX_OPEN_DIRECTORY[\s\S]*?constants\.O_NOFOLLOW !== LINUX_OPEN_NOFOLLOW[\s\S]*?constants\.O_RDONLY \| LINUX_OPEN_DIRECTORY \| LINUX_OPEN_NOFOLLOW[\s\S]*?constants\.O_RDONLY \| LINUX_OPEN_NOFOLLOW/u,
  'the exact stage reader must use Linux no-follow handles for both the control directory and stage file',
);
assert.match(
  executorRuntimeIsolationSource,
  /if \(!decoded\.endsWith\([^)]*\)\) return unavailable\(\)[\s\S]*?createHash\('sha256'\)\.update\(bytes\)\.digest\(\)[\s\S]*?reattest:[\s\S]*?!sameFile\(initial\.identity, current\.identity\)[\s\S]*?!sameFile\(initial\.parentIdentity, current\.parentIdentity\)[\s\S]*?!timingSafeEqual\(current\.digest, expectedDigest\)/u,
  'the exact readiness stage must be canonical LF bytes with opaque file, parent, and digest re-attestation',
);
assert.match(
  noTransferReadinessSealSource,
  /loadExactKemerBetStandaloneReadinessPlayerIds\(\{[\s\S]*?filePath: KEMERBET_NO_TRANSFER_READINESS_PLAYER_IDS_FILE/u,
  'the standalone seal entry point must not accept the imported root-owned stage contract',
);
assertOrderedFragments(
  noTransferReadinessSealSource.slice(
    noTransferReadinessSealSource.indexOf("reportStage('binding_write');"),
    noTransferReadinessSealSource.indexOf('(dependencies.logSuccess ?? defaultSuccessLog)'),
  ),
  [
    "reportStage('binding_write');",
    'await players.reattest();',
    'await dependencies.writeBinding(',
  ],
  'an injected binding writer must receive an immediate imported-cohort re-attestation',
);
const atomicReadinessBindingWriterSource = noTransferReadinessSealSource.slice(
  noTransferReadinessSealSource.indexOf('async function writeBindingAtomically('),
  noTransferReadinessSealSource.indexOf('function defaultSuccessLog('),
);
assertOrderedFragments(
  atomicReadinessBindingWriterSource,
  [
    'await reattestImportedStage();',
    'await fileSystem.link(temporary, OUTPUT_FILE);',
    'await unlinkOnlyCreatedBindingInode(fileSystem, temporary, createdByThisRun)',
    'await revalidateInstalledBinding(',
    'await reattestImportedStage();',
    'await revalidateInstalledBinding(',
    'installationComplete = true;',
  ],
  'the production binding transaction must be bracketed by the same imported-stage attestation',
);
assert.match(
  atomicReadinessBindingWriterSource,
  /installedByThisRun[\s\S]*?!installationComplete[\s\S]*?unlinkOnlyCreatedBindingInode\(fileSystem, OUTPUT_FILE, createdByThisRun\)[\s\S]*?if \(directoryChanged\) await outputDirectoryHandle\?\.sync/u,
  "a failed post-install stage attestation must remove and synchronize only this run's binding",
);
assert.doesNotMatch(
  privateSessionProvisionServerSource.slice(
    privateSessionProvisionServerSource.indexOf(
      'const closeRetainedContextForSeal = async (): Promise<void> => {',
    ),
    privateSessionProvisionServerSource.indexOf('await runReadinessSeal({'),
  ),
  /retainedContext\.close\(\)|closePersistentBrowserForCheckpoint\([^)]*\)\.catch|try\s*\{[\s\S]*?await closePersistentBrowserForCheckpoint[\s\S]*?\}\s*catch/,
  'a retained-context close failure must propagate and prevent the binding write',
);
assert.match(
  privateSessionProvisionServerSource,
  /!retainedContextClosed \|\|\s*context !== undefined \|\|\s*page !== undefined \|\|\s*profilePath !== undefined \|\|\s*accountId !== undefined \|\|\s*expiresAt !== undefined \|\|\s*expiryTimer !== undefined \|\|\s*signedInLogged/,
  'seal success must require an exact inactive and cleared supervised enrollment session',
);
assert.match(
  privateSessionProvisionServerSource,
  /const AUTHENTICATED_SESSION_LIFETIME_MS = 12 \* 60 \* 60 \* 1_000/,
);
const acceptIdentityProofSource = privateSessionProvisionServerSource.slice(
  privateSessionProvisionServerSource.indexOf('const acceptAuthenticatedIdentityProof = ('),
  privateSessionProvisionServerSource.indexOf('const beginAuthenticatedIdentityVerification = ('),
);
assertOrderedFragments(
  acceptIdentityProofSource,
  [
    'timestamp >= expiresAt.getTime()',
    'monotonicTimestamp >= expiresAtMonotonicMs',
    'timestamp >= generationDeadline.getTime()',
    'monotonicTimestamp >= generationDeadlineMonotonicMs',
    "phase = 'authenticated';",
    'authenticatedDeadline ??= new Date(',
    'Math.min(timestamp + AUTHENTICATED_SESSION_LIFETIME_MS, generationDeadline.getTime()),',
    'armExpiryAt(authenticatedDeadline, authenticatedDeadlineMonotonicMs, generation);',
    'if (!signedInLogged) {',
    "log('signed_in');",
  ],
  'only an unexpired exact identity proof may install one hard-capped immutable twelve-hour deadline',
);
assert.match(
  privateSessionProfileGenerationLeaseSource,
  /const MARKER_NAME = '\.fetanagent-unclean-session-generation-v1'/u,
);
assert.match(
  privateSessionProfileGenerationLeaseSource,
  /constants\.O_RDONLY \| \(constants\.O_NOFOLLOW \?\? 0\)[\s\S]*?contents\.equals\(MARKER_CONTENTS\)/u,
  'an existing crash marker must be inspected read-only and match the exact fixed contract',
);
assert.match(
  privateSessionProfileGenerationLeaseSource,
  /constants\.O_CREAT \|[\s\S]*?constants\.O_EXCL \|[\s\S]*?constants\.O_WRONLY \|[\s\S]*?constants\.O_NOFOLLOW/u,
  'a profile generation must acquire one atomic no-follow crash marker',
);
assertOrderedFragments(
  privateSessionProfileGenerationLeaseSource.slice(
    privateSessionProfileGenerationLeaseSource.indexOf('async releaseAfterCleanCheckpoint'),
  ),
  [
    'await requireStableOwnedProfile(fileSystem, profilePath, effectiveUserId);',
    'const inspection = await inspectKemerBetSessionProfileGenerationLease(',
    'const beforeUnlink = await fileSystem.lstat(markerPath);',
    'await fileSystem.unlink(markerPath);',
    'await syncProfileDirectory(fileSystem, profilePath);',
  ],
  'only the captured exact generation may release its marker after a clean checkpoint',
);
const updatePagePhaseSource = privateSessionProvisionServerSource.slice(
  privateSessionProvisionServerSource.indexOf('const updatePagePhase = ('),
  privateSessionProvisionServerSource.indexOf('const captureLoginFrame = async'),
);
assertOrderedFragments(
  updatePagePhaseSource,
  [
    "if (state === 'agents' && phase !== 'authenticated') {",
    'beginAuthenticatedIdentityVerification(generation, observedContext, observedPage);',
    "} else if (state === 'login' && phase !== 'login_required') {",
    'const currentDeadline = expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;',
    'Math.min(now().getTime() + LOGIN_LIFETIME_MS, currentDeadline),',
    'armExpiryAt(',
    'authenticatedDeadline && authenticatedDeadline.getTime() < loginDeadline.getTime()',
  ],
  'candidate URL must start identity proof, while later login transitions may only retain or shorten the current deadline',
);
assert.equal(
  countMatches(privateSessionProvisionServerSource, /authenticatedDeadline \?\?= new Date/g),
  1,
  'the authenticated deadline must be initialized at exactly one transition and never reset by polling',
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
  'executor deployment artifacts verified: immutable image activation, explicit database target, lifetime singleton, static controller/browser/proxy readiness isolation, offline pre-mint and profile snapshot contracts, trusted completion receipt, and no financial endpoint',
);
