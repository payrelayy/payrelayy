import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const infraDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const compose = await readFile(`${infraDirectory}compose.staging-beta.yaml`, 'utf8');
const dockerfile = await readFile(`${repositoryRoot}Dockerfile`, 'utf8');
const caddyfile = await readFile(`${infraDirectory}gateway/Caddyfile`, 'utf8');
const landingPage = await readFile(`${infraDirectory}gateway/site/index.html`, 'utf8');
const retiredDepositReferenceProtection = new RegExp(
  ['api', 'deposit', 'reference', 'protection'].join('[_-]'),
  'iu',
);
const dockerProxyEnvironmentNames = [
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
];

assert.doesNotMatch(
  compose,
  retiredDepositReferenceProtection,
  'the retired single-key deposit-reference input must remain absent',
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

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

const services = topLevelSection(compose, 'services');
const ownerService = childBlock(services, 'owner-control');
const kemerbetSessionService = childBlock(services, 'kemerbet-session-provision');
const kemerbetRecheckService = childBlock(services, 'kemerbet-no-transfer-readiness');
const kemerbetReadinessBrowserService = childBlock(services, 'kemerbet-readiness-browser');
const kemerbetReadinessProxyService = childBlock(services, 'kemerbet-readiness-egress-proxy');
const customerWebService = childBlock(services, 'customer-web');
const gatewayService = childBlock(services, 'gateway');
const apiService = childBlock(services, 'api');
const betaService = childBlock(services, 'beta-admission');
const botService = childBlock(services, 'bot');
const networks = topLevelSection(compose, 'networks');
const volumes = topLevelSection(compose, 'volumes');
const configs = topLevelSection(compose, 'configs');
const secrets = topLevelSection(compose, 'secrets');

const serviceNames = [...services.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]);
assert.deepEqual(
  serviceNames,
  [
    'owner-control',
    'kemerbet-session-provision',
    'kemerbet-no-transfer-readiness',
    'kemerbet-readiness-browser',
    'kemerbet-readiness-egress-proxy',
    'customer-web',
    'gateway',
    'api',
    'beta-admission',
    'bot',
  ],
  'only the five private services, no-transfer sign-in/recheck tools, and gated public gateway are allowed',
);

for (const [name, service] of [
  ['owner-control', ownerService],
  ['customer-web', customerWebService],
  ['api', apiService],
  ['beta-admission', betaService],
  ['bot', botService],
]) {
  assert.match(service, /profiles: \[staging-manual\]/, `${name} must require staging-manual`);
  assert.match(service, /platform: linux\/amd64/, `${name} must pin linux\/amd64`);
  assert.match(service, /user: '10001:10001'/, `${name} must run as UID 10001`);
  assert.match(service, /restart: 'no'/, `${name} must not restart automatically`);
  assert.match(service, /read_only: true/, `${name} must be read-only`);
  assert.match(service, /cap_drop:\s*\r?\n\s+- ALL/, `${name} must drop every capability`);
  assert.match(service, /no-new-privileges:true/, `${name} must forbid privilege escalation`);
  assert.match(service, /pids_limit: 128/, `${name} must have a PID limit`);
  assert.match(service, /logging:\s*\r?\n\s+driver: json-file/);
  assert.match(service, /max-size: 10m/);
  assert.match(service, /max-file: '3'/);
  assert.match(service, /FINANCIAL_ACTIONS_MODE: dry_run/, `${name} must be dry-run only`);
  assert.match(service, /INTERNAL_POSTGRES_RUNTIME_ENABLED: 'false'/);
  assert.match(service, /INTERNAL_NONCE_RETENTION_RUNTIME_ENABLED: 'false'/);
  assert.match(service, /INTERNAL_TELEGRAM_INGRESS_ENABLED: 'false'/);
  assert.match(service, /INTERNAL_TELEGRAM_PRIVATE_INGRESS_RUNTIME_ENABLED: 'false'/);
  assert.match(service, /KEMERBET_EXECUTOR_ENABLED: 'false'/);
  assert.match(service, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/);
}

assert.match(gatewayService, /profiles: \[public-domain\]/);
assert.match(gatewayService, /platform: linux\/amd64/);
assert.match(gatewayService, /target: gateway/);
assert.match(gatewayService, /user: '10001:10001'/);
assert.match(gatewayService, /restart: 'no'/);
assert.match(gatewayService, /read_only: true/);
assert.match(gatewayService, /cap_drop:\s*\r?\n\s+- ALL/);
assert.match(gatewayService, /cap_add:\s*\r?\n\s+- NET_BIND_SERVICE/);
assert.match(gatewayService, /no-new-privileges:true/);
assert.match(gatewayService, /pids_limit: 128/);
assert.match(gatewayService, /max-size: 10m/);
assert.match(gatewayService, /max-file: '3'/);
assert.match(gatewayService, /ports:\s*\r?\n\s+- '80:80\/tcp'\s*\r?\n\s+- '443:443\/tcp'/);
assert.match(
  gatewayService,
  /source: \/var\/lib\/fetanagent-gateway\/data\s*\r?\n\s+target: \/data/,
);
assert.match(
  gatewayService,
  /source: \/var\/lib\/fetanagent-gateway\/config\s*\r?\n\s+target: \/config/,
);
assert.match(
  gatewayService,
  /networks:\s*\r?\n\s+- owner_control_service\s*\r?\n\s+- telebirr_device_ingress/,
);
assert.doesNotMatch(gatewayService, /staging_service|secrets:|configs:|docker\.sock/);
assert.equal(
  countMatches(compose, /telebirr_device_ingress/g),
  2,
  'only the gateway attachment and the fixed internal network declaration may name the TeleBirr ingress',
);
assert.match(gatewayService, /condition: service_healthy/);
assert.match(gatewayService, /caddy\s*\r?\n\s+- validate/);

for (const service of [ownerService, betaService]) {
  assert.match(service, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'false'/);
  assert.match(service, /INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'false'/);
}

assert.doesNotMatch(ownerService, /INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true'/);

assert.match(ownerService, /target: admin/);
assert.match(ownerService, /INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED: 'true'/);
assert.match(ownerService, /OWNER_CONTROL_HOST: 0\.0\.0\.0/);
assert.match(ownerService, /OWNER_CONTROL_PORT: '3002'/);
assert.match(
  ownerService,
  /OWNER_CONTROL_SUPABASE_URL: https:\/\/spzpiyxheappsfyswewl\.supabase\.co/,
);
assert.match(ownerService, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/);
assert.match(
  ownerService,
  /OWNER_CONTROL_DATABASE_URL_FILE: \/run\/secrets\/owner_control_database_url/,
);
assert.match(
  ownerService,
  /OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE: \/run\/secrets\/owner_control_supabase_publishable_key/,
);
assert.match(
  ownerService,
  /OWNER_RECEIVER_REFERENCE_ENCRYPTION_MASTER_FILE: \/run\/secrets\/owner_receiver_reference_encryption_master/,
);
assert.match(
  ownerService,
  /OWNER_RECEIVER_REFERENCE_FINGERPRINT_MASTER_FILE: \/run\/secrets\/owner_receiver_reference_fingerprint_master/,
);
assert.match(
  ownerService,
  /OWNER_RECEIVER_REFERENCE_PROFILE_FILE: \/etc\/fetanagent\/deposit-proof-reference-profile\.v2\.json/,
);
assert.match(
  ownerService,
  /OWNER_TELEBIRR_ASSIGNMENT_SIGNER_KEY_ID: telebirr-assignment-staging-v1/,
);
assert.doesNotMatch(ownerService, /^\s+DEPOSIT_PROOF_REFERENCE_/mu);
assert.match(ownerService, /ports:\s*\r?\n\s+- 127\.0\.0\.1:3002:3002/);
assert.match(ownerService, /networks:\s*\r?\n\s+- owner_control_service/);
assert.doesNotMatch(ownerService, /staging_service/);
assert.match(ownerService, /http:\/\/127\.0\.0\.1:3002\/readyz/);
assert.doesNotMatch(ownerService, /TELEGRAM_BOT_ENABLED: 'true'/);
const ownerVolumes = servicePropertyBlock(ownerService, 'volumes');
assert.match(ownerVolumes, /source: kemerbet_session_control/);
assert.match(ownerVolumes, /target: \/run\/fetanagent-kemerbet-session-control/);
assert.match(
  ownerVolumes,
  /type: bind\s*\r?\n\s+source: \/var\/lib\/fetanagent\/kemerbet-readiness-cohort-receipts\s*\r?\n\s+target: \/run\/fetanagent-kemerbet-readiness-cohort-receipts\s*\r?\n\s+read_only: true\s*\r?\n\s+bind:\s*\r?\n\s+create_host_path: false/,
);
assert.doesNotMatch(ownerVolumes, /kemerbet_sessions|docker\.sock|\/run\/secrets/);
for (const service of [
  kemerbetSessionService,
  kemerbetRecheckService,
  kemerbetReadinessBrowserService,
  kemerbetReadinessProxyService,
  customerWebService,
  gatewayService,
  apiService,
  betaService,
  botService,
]) {
  assert.doesNotMatch(service, /kemerbet-readiness-cohort-receipts/);
}

assert.match(kemerbetSessionService, /profiles: \[kemerbet-session-provision\]/);
assert.match(kemerbetSessionService, /platform: linux\/amd64/);
assert.match(kemerbetSessionService, /fetanagent-deposit-executor:/);
assert.match(
  kemerbetSessionService,
  /command: \['node', 'apps\/executor\/dist\/kemerbet-session-provision-server\.js'\]/,
);
assert.match(kemerbetSessionService, /user: '10001:10001'/);
assert.match(kemerbetSessionService, /restart: 'no'/);
assert.match(kemerbetSessionService, /read_only: true/);
assert.match(kemerbetSessionService, /cap_drop:\s*\r?\n\s+- ALL/);
assert.match(kemerbetSessionService, /no-new-privileges:true/);
assert.match(kemerbetSessionService, /pids_limit: 512/);
assert.match(kemerbetSessionService, /mem_limit: 1536m/);
assert.match(kemerbetSessionService, /cpus: 2\.00/);
assert.match(kemerbetSessionService, /FINANCIAL_ACTIONS_MODE: dry_run/);
assert.match(kemerbetSessionService, /KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED: 'true'/);
assert.match(kemerbetSessionService, /KEMERBET_EXECUTOR_ENABLED: 'false'/);
assert.match(kemerbetSessionService, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/);
assert.match(kemerbetSessionService, /KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED: 'false'/);
assert.match(kemerbetSessionService, /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED: 'false'/);
assert.match(kemerbetSessionService, /source: kemerbet_session_control/);
assert.match(kemerbetSessionService, /source: kemerbet_sessions/);
const kemerbetSessionVolumes = servicePropertyBlock(kemerbetSessionService, 'volumes');
assert.equal(
  countMatches(kemerbetSessionVolumes, /^\s+- type: /gm),
  6,
  'the long-lived sign-in coordinator must have exactly six non-lookup mounts',
);
assert.match(
  kemerbetSessionService,
  /source: \/etc\/fetanagent\/executor-secrets\/kemerbet_agent_identity_hmac_key[\s\S]*?target: \/run\/secrets\/kemerbet_agent_identity_hmac_key[\s\S]*?read_only: true[\s\S]*?create_host_path: false/,
);
assert.match(
  kemerbetSessionService,
  /source: \$\{FETANAGENT_STAGING_KEMERBET_SESSION_BINDING_FILE:-\/etc\/fetanagent\/executor-secrets\/kemerbet_agent_identity_bindings\}[\s\S]*?target: \/run\/secrets\/kemerbet_agent_identity_bindings[\s\S]*?read_only: true[\s\S]*?create_host_path: false/,
);
assert.doesNotMatch(
  kemerbetSessionService,
  /^\s+FETANAGENT_STAGING_KEMERBET_SESSION_BINDING_FILE:/mu,
  'the host-selected private-session binding path must never be passed into the container environment',
);
assert.doesNotMatch(
  kemerbetSessionVolumes,
  /kemerbet_no_transfer_readiness_player_ids/u,
  'ordinary private sign-in must not mount the separately authorized exact-five lookup cohort',
);
assert.match(
  kemerbetSessionService,
  /source: \/etc\/fetanagent\/executor-config\/kemerbet-selector-contract\.v2\.json[\s\S]*?target: \/etc\/fetanagent\/kemerbet-selector-contract\.v2\.json[\s\S]*?read_only: true[\s\S]*?create_host_path: false/,
);
assert.match(
  kemerbetSessionService,
  /source: \/var\/lib\/fetanagent\/kemerbet-readiness-seal-output[\s\S]*?target: \/run\/fetanagent-kemerbet-readiness-seal-output[\s\S]*?create_host_path: false/,
);
assert.match(kemerbetSessionService, /session\.sock/);
assert.match(kemerbetSessionService, /networks:\s*\r?\n\s+- owner_control_service/);
assert.doesNotMatch(
  kemerbetSessionService,
  /secrets:|configs:|ports:|expose:|DATABASE|PASSWORD|TOKEN|SUPABASE|RECEIVER|docker\.sock/,
);
const kemerbetSessionEnvironment = servicePropertyBlock(kemerbetSessionService, 'environment');
assert.doesNotMatch(
  kemerbetSessionEnvironment,
  /DATABASE|PASSWORD|TOKEN|HMAC|SUPABASE|PLAYER|RECEIVER|SELECTOR|IDENTITY/,
);

const readinessServices = [
  ['controller', kemerbetRecheckService],
  ['browser', kemerbetReadinessBrowserService],
  ['Layer-7 proxy', kemerbetReadinessProxyService],
];
for (const [name, service] of readinessServices) {
  assert.match(service, /profiles: \[kemerbet-no-transfer-readiness\]/);
  assert.match(service, /platform: linux\/amd64/);
  assert.match(
    service,
    /image: fetanagent-deposit-executor:\$\{FETANAGENT_IMAGE_TAG:\?set a commit-derived image tag\}/,
  );
  assert.match(service, /pull_policy: never/);
  assert.match(service, /init: true/);
  assert.match(service, /restart: 'no'/);
  assert.match(service, /read_only: true/);
  assert.match(service, /cap_drop:\s*\r?\n\s+- ALL/);
  assert.match(service, /no-new-privileges:true/);
  assert.match(service, /logging:\s*\r?\n\s+driver: none/);
  assert.match(service, /FINANCIAL_ACTIONS_MODE: dry_run/);
  for (const disabledGate of [
    'KEMERBET_EXECUTOR_ENABLED',
    'KEMERBET_FINAL_ACTION_ENABLED',
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED',
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
  ]) {
    assert.match(service, new RegExp(`${disabledGate}: 'false'`), `${name} must remain inert`);
  }
  assert.doesNotMatch(
    service,
    /^    (?:ports|expose|depends_on|secrets|configs|stdin_open|tty):/m,
    `${name} must expose no port and inherit no Compose secret/config authority`,
  );
}

assert.match(
  kemerbetRecheckService,
  /container_name: fetanagent-staging-beta-kemerbet-no-transfer-readiness-once/,
);
assert.match(
  kemerbetRecheckService,
  /command: \['node', 'apps\/executor\/dist\/kemerbet-no-transfer-readiness\.js'\]/,
);
assert.match(kemerbetRecheckService, /user: '10002:10002'/);
assert.match(
  kemerbetRecheckService,
  /tmpfs:\s*\r?\n\s+- \/tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777/,
);
assert.doesNotMatch(kemerbetRecheckService, /shm_size:/);
assert.match(kemerbetRecheckService, /pids_limit: 64/);
assert.match(kemerbetRecheckService, /mem_limit: 128m/);
assert.match(kemerbetRecheckService, /cpus: 0\.50/);
assert.match(kemerbetRecheckService, /stop_grace_period: 15s/);
assert.match(kemerbetRecheckService, /KEMERBET_NO_TRANSFER_READINESS_ENABLED: 'true'/);
assert.match(kemerbetRecheckService, /KEMERBET_READINESS_BROWSER_RPC_ENABLED: 'true'/);
assert.match(
  kemerbetRecheckService,
  /dns:\s*\r?\n\s+- 127\.0\.0\.1\s*\r?\n\s+dns_opt:\s*\r?\n\s+- attempts:1\s*\r?\n\s+- timeout:1\s*\r?\n\s+- ndots:0/,
  'the controller must not use Docker or external DNS',
);

assert.match(
  kemerbetReadinessBrowserService,
  /container_name: fetanagent-staging-beta-kemerbet-readiness-browser-once/,
);
assert.match(
  kemerbetReadinessBrowserService,
  /command: \['node', 'apps\/executor\/dist\/kemerbet-readiness-browser-driver\.js'\]/,
);
assert.match(kemerbetReadinessBrowserService, /user: '10001:10001'/);
assert.match(
  kemerbetReadinessBrowserService,
  /tmpfs:\s*\r?\n\s+- \/tmp:rw,noexec,nosuid,nodev,size=268435456,mode=1777/,
);
assert.match(kemerbetReadinessBrowserService, /shm_size: 512m/);
assert.match(kemerbetReadinessBrowserService, /pids_limit: 512/);
assert.match(kemerbetReadinessBrowserService, /mem_limit: 1536m/);
assert.match(kemerbetReadinessBrowserService, /cpus: 2\.00/);
assert.match(kemerbetReadinessBrowserService, /stop_grace_period: 60s/);
assert.match(kemerbetReadinessBrowserService, /KEMERBET_READINESS_BROWSER_DRIVER_ENABLED: 'true'/);
assert.match(kemerbetReadinessBrowserService, /KEMERBET_READINESS_L7_PROXY_IPV4: 172\.31\.254\.10/);
assert.match(
  kemerbetReadinessBrowserService,
  /KEMERBET_READINESS_L7_PROXY_SPKI_SHA256: Ngu9uL2STHWC7Uton\/GYw7d8hDQdhliykEz2XnJZd3M=/,
);
assert.match(
  kemerbetReadinessBrowserService,
  /dns:\s*\r?\n\s+- 127\.0\.0\.1\s*\r?\n\s+dns_opt:\s*\r?\n\s+- attempts:1\s*\r?\n\s+- timeout:1\s*\r?\n\s+- ndots:0/,
  'the browser must rely only on fixed IPs and Chromium host mapping',
);

assert.match(
  kemerbetReadinessProxyService,
  /container_name: fetanagent-staging-beta-kemerbet-readiness-egress-proxy-once/,
);
assert.match(
  kemerbetReadinessProxyService,
  /command: \['node', 'apps\/executor\/dist\/kemerbet-readiness-layer7-proxy\.js'\]/,
);
assert.match(kemerbetReadinessProxyService, /user: '10003:10003'/);
assert.match(
  kemerbetReadinessProxyService,
  /tmpfs:\s*\r?\n\s+- \/tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777/,
);
assert.doesNotMatch(kemerbetReadinessProxyService, /shm_size:/);
assert.match(kemerbetReadinessProxyService, /pids_limit: 64/);
assert.match(kemerbetReadinessProxyService, /mem_limit: 128m/);
assert.match(kemerbetReadinessProxyService, /cpus: 0\.50/);
assert.match(kemerbetReadinessProxyService, /stop_grace_period: 15s/);

const kemerbetRecheckEnvironment = servicePropertyBlock(kemerbetRecheckService, 'environment');
const kemerbetBrowserEnvironment = servicePropertyBlock(
  kemerbetReadinessBrowserService,
  'environment',
);
const kemerbetProxyEnvironment = servicePropertyBlock(kemerbetReadinessProxyService, 'environment');
const readinessEnvironmentNames = (environment) =>
  [...environment.matchAll(/^      ([A-Za-z_][A-Za-z0-9_]*):/gm)].map((match) => match[1]);
assert.deepEqual(
  readinessEnvironmentNames(kemerbetRecheckEnvironment),
  [
    'NODE_ENV',
    ...dockerProxyEnvironmentNames,
    'FINANCIAL_ACTIONS_MODE',
    'KEMERBET_NO_TRANSFER_READINESS_ENABLED',
    'KEMERBET_READINESS_BROWSER_RPC_ENABLED',
    'KEMERBET_EXECUTOR_ENABLED',
    'KEMERBET_FINAL_ACTION_ENABLED',
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED',
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
  ],
  'the readiness controller environment allowlist must remain exact',
);
assert.deepEqual(
  readinessEnvironmentNames(kemerbetBrowserEnvironment),
  [
    'NODE_ENV',
    ...dockerProxyEnvironmentNames,
    'FINANCIAL_ACTIONS_MODE',
    'KEMERBET_READINESS_BROWSER_DRIVER_ENABLED',
    'KEMERBET_READINESS_L7_PROXY_IPV4',
    'KEMERBET_READINESS_L7_PROXY_SPKI_SHA256',
    'KEMERBET_EXECUTOR_ENABLED',
    'KEMERBET_FINAL_ACTION_ENABLED',
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED',
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
  ],
  'the readiness browser environment allowlist must remain exact',
);
assert.deepEqual(
  readinessEnvironmentNames(kemerbetProxyEnvironment),
  [
    'NODE_ENV',
    ...dockerProxyEnvironmentNames,
    'FINANCIAL_ACTIONS_MODE',
    'KEMERBET_EXECUTOR_ENABLED',
    'KEMERBET_FINAL_ACTION_ENABLED',
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED',
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
  ],
  'the Layer-7 proxy environment allowlist must remain exact',
);
for (const environment of [
  kemerbetRecheckEnvironment,
  kemerbetBrowserEnvironment,
  kemerbetProxyEnvironment,
]) {
  for (const proxyName of dockerProxyEnvironmentNames) {
    assert.equal(
      countMatches(environment, new RegExp(`^      ${escapeRegExp(proxyName)}: ''$`, 'gm')),
      1,
      `${proxyName} must be present exactly once with an empty value`,
    );
  }
}
assert.doesNotMatch(
  `${kemerbetRecheckEnvironment}\n${kemerbetBrowserEnvironment}\n${kemerbetProxyEnvironment}`,
  /DATABASE|PASSWORD|TOKEN|SUPABASE|RECEIVER|(?:^|_)AMOUNT|(?:^|_)NOTES|TRANSFER_METHOD/,
  'the readiness services must contain no database, credential, receiver, or financial-action environment authority',
);
const executorRuntimeBase = dockerfile
  .split('FROM runtime-base AS executor-runtime-base')[1]
  ?.split('FROM executor-runtime-base AS executor')[0];
assert.ok(executorRuntimeBase, 'missing executor runtime base body');
for (const proxyName of dockerProxyEnvironmentNames) {
  assert.equal(
    countMatches(
      executorRuntimeBase,
      new RegExp(`^\\s+(?:ENV\\s+)?${escapeRegExp(proxyName)}=\\s*(?:\\\\)?$`, 'gm'),
    ),
    1,
    `the executor image must declare exactly one empty ${proxyName} baseline`,
  );
}
const kemerbetRecheckVolumes = servicePropertyBlock(kemerbetRecheckService, 'volumes');
const kemerbetBrowserVolumes = servicePropertyBlock(kemerbetReadinessBrowserService, 'volumes');
const kemerbetProxyVolumes = servicePropertyBlock(kemerbetReadinessProxyService, 'volumes');
const assertExactReadOnlyBind = (volumesBlock, source, target) => {
  assert.match(
    volumesBlock,
    new RegExp(
      `type: bind\\s*\\r?\\n\\s+source: ${escapeRegExp(source)}\\s*\\r?\\n\\s+target: ${escapeRegExp(target)}\\s*\\r?\\n\\s+read_only: true\\s*\\r?\\n\\s+bind:\\s*\\r?\\n\\s+create_host_path: false`,
    ),
  );
};
const assertExactWritableBind = (volumesBlock, source, target) => {
  assert.match(
    volumesBlock,
    new RegExp(
      `type: bind\\s*\\r?\\n\\s+source: ${escapeRegExp(source)}\\s*\\r?\\n\\s+target: ${escapeRegExp(target)}\\s*\\r?\\n\\s+bind:\\s*\\r?\\n\\s+create_host_path: false`,
    ),
  );
};
assert.equal(countMatches(kemerbetRecheckVolumes, /^\s+- type: /gm), 7);
for (const [source, target] of [
  [
    '/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate/kemerbet_agent_identity_bindings',
    '/run/secrets/kemerbet_agent_identity_bindings',
  ],
  [
    '/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key',
    '/run/secrets/kemerbet_agent_identity_hmac_key',
  ],
  [
    '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids',
    '/run/secrets/kemerbet_no_transfer_readiness_player_ids',
  ],
  [
    '/run/fetanagent-kemerbet-readiness-rpc-v1/controller-capability',
    '/run/secrets/kemerbet_readiness_browser_rpc_capability',
  ],
  [
    '/run/fetanagent-kemerbet-readiness-rpc-v1/layer7-authorizations',
    '/run/secrets/kemerbet_readiness_layer7_authorizations',
  ],
  [
    '/run/fetanagent-kemerbet-readiness-rpc-v1/controller-firewall-release',
    '/run/secrets/kemerbet_readiness_controller_firewall_release',
  ],
]) {
  assertExactReadOnlyBind(kemerbetRecheckVolumes, source, target);
}
assertExactWritableBind(
  kemerbetRecheckVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/controller-stage-output',
  '/run/fetanagent-kemerbet-readiness-controller-stage-output',
);
assert.doesNotMatch(
  kemerbetRecheckVolumes,
  /kemerbet_sessions|kemerbet_readiness_profile_snapshot|kemerbet-selector-contract|browser-capability|browser-account-id|browser-firewall-release|proxy-hmac-key|proxy-run-nonce|proxy-output|kemerbet-readiness-seal-output/,
  'the controller must have no browser profile, selector, browser-only input, proxy secret, or output mount',
);

assert.equal(countMatches(kemerbetBrowserVolumes, /^\s+- type: /gm), 6);
assert.match(
  kemerbetBrowserVolumes,
  /type: volume\s*\r?\n\s+source: kemerbet_readiness_profile_snapshot\s*\r?\n\s+target: \/var\/lib\/fetanagent\/kemerbet-sessions/,
);
assertExactReadOnlyBind(
  kemerbetBrowserVolumes,
  '/etc/fetanagent/executor-config/kemerbet-selector-contract.v2.json',
  '/etc/fetanagent/kemerbet-selector-contract.v2.json',
);
assertExactWritableBind(
  kemerbetBrowserVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/browser-stage-output',
  '/run/fetanagent-kemerbet-readiness-browser-stage-output',
);
assertExactReadOnlyBind(
  kemerbetBrowserVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/browser-capability',
  '/run/secrets/kemerbet_readiness_browser_rpc_capability',
);
assertExactReadOnlyBind(
  kemerbetBrowserVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/browser-account-id',
  '/run/secrets/kemerbet_readiness_account_id',
);
assertExactReadOnlyBind(
  kemerbetBrowserVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/browser-firewall-release',
  '/run/secrets/kemerbet_readiness_browser_firewall_release',
);
assert.doesNotMatch(
  kemerbetBrowserVolumes,
  /source: kemerbet_sessions(?:\r?\n)|kemerbet_agent_identity_bindings|kemerbet_agent_identity_hmac_key|kemerbet_no_transfer_readiness_player_ids|layer7-authorizations|proxy-hmac-key|proxy-run-nonce|controller-capability|controller-firewall-release|proxy-output|kemerbet-readiness-seal-output/,
  'the browser must receive only its disposable snapshot, selector, account file, RPC capability, and browser firewall gate',
);

assert.equal(countMatches(kemerbetProxyVolumes, /^\s+- type: /gm), 7);
assertExactReadOnlyBind(
  kemerbetProxyVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/proxy-hmac-key',
  '/run/secrets/kemerbet_readiness_proxy_hmac_key',
);
assertExactReadOnlyBind(
  kemerbetProxyVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/proxy-run-nonce',
  '/run/secrets/kemerbet_readiness_proxy_run_nonce',
);
assertExactReadOnlyBind(
  kemerbetProxyVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/release-sha',
  '/run/secrets/kemerbet_readiness_release_sha',
);
assertExactReadOnlyBind(
  kemerbetProxyVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/proxy-agent-identity-bindings',
  '/run/secrets/kemerbet_readiness_proxy_agent_identity_bindings',
);
assertExactReadOnlyBind(
  kemerbetProxyVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/proxy-agent-identity-hmac-key',
  '/run/secrets/kemerbet_readiness_proxy_agent_identity_hmac_key',
);
assert.match(
  kemerbetProxyVolumes,
  /type: bind\s*\r?\n\s+source: \/run\/fetanagent-kemerbet-readiness-rpc-v1\/proxy-output\s*\r?\n\s+target: \/run\/output\s*\r?\n\s+bind:\s*\r?\n\s+create_host_path: false/,
  'the trusted proxy alone must publish the generic completion receipt',
);
assertExactWritableBind(
  kemerbetProxyVolumes,
  '/run/fetanagent-kemerbet-readiness-rpc-v1/proxy-stage-output',
  '/run/fetanagent-kemerbet-readiness-proxy-stage-output',
);
assert.doesNotMatch(
  kemerbetProxyVolumes,
  /kemerbet_sessions|readiness_profile_snapshot|selector|player_ids|kemerbet_agent_identity_bindings|kemerbet_agent_identity_hmac_key|capability|account-id|firewall-release|layer7-authorizations|cohort|seal-output/,
  'the proxy must receive only its one-run verifier material, exact proxy-only identity copies, release SHA, and completion output, never the cohort',
);

assert.match(
  kemerbetRecheckService,
  /networks:\s*\r?\n\s+kemerbet_readiness_control:\s*\r?\n\s+ipv4_address: 172\.31\.254\.2\s*\r?\n\s+ipv6_address: fd5e:7a9e:1::2/,
);
assert.match(
  kemerbetReadinessBrowserService,
  /networks:\s*\r?\n\s+kemerbet_readiness_control:\s*\r?\n\s+ipv4_address: 172\.31\.254\.3\s*\r?\n\s+ipv6_address: fd5e:7a9e:1::3\s*\r?\n\s+kemerbet_readiness_proxy:\s*\r?\n\s+ipv4_address: 172\.31\.254\.11\s*\r?\n\s+ipv6_address: fd5e:7a9e:2::3/,
);
assert.match(
  kemerbetReadinessProxyService,
  /networks:\s*\r?\n\s+kemerbet_readiness_proxy:\s*\r?\n\s+ipv4_address: 172\.31\.254\.10\s*\r?\n\s+ipv6_address: fd5e:7a9e:2::2\s*\r?\n\s+kemerbet_readiness_egress: \{\}/,
);
assert.equal(
  countMatches(services, /^      kemerbet_readiness_egress: \{\}$/gm),
  1,
  'only the Layer-7 proxy may join the Internet-facing readiness bridge',
);
assert.match(kemerbetRecheckService, /healthcheck:\s*\r?\n\s+disable: true/);
assert.match(kemerbetReadinessBrowserService, /host:'172\.31\.254\.3',port:4587/);
for (const proxyApplicationReadinessContract of [
  /p='\/tmp\/fetanagent-kemerbet-readiness-layer7-proxy\.ready'/,
  /fetanagent-kemerbet-readiness-layer7-proxy-ready-v1\\\\n/,
  /lstatSync\(p,\{bigint:true\}\)/,
  /O_RDONLY\|f\.constants\.O_NOFOLLOW/,
  /fstatSync\(d,\{bigint:true\}\)/,
  /s\.uid!==10003n\|\|s\.gid!==10003n/,
  /\(s\.mode&0o7777n\)!==0o600n/,
  /s\.nlink!==1n/,
  /s\.dev!==b\.dev\|\|s\.ino!==b\.ino/,
  /f\.readSync\(d,x,0,1,v\.length\)!==0/,
  /a\.dev!==s\.dev\|\|a\.ino!==s\.ino/,
  /retries: 120/,
  /start_period: 90s/,
]) {
  assert.match(kemerbetReadinessProxyService, proxyApplicationReadinessContract);
}
assert.doesNotMatch(
  kemerbetReadinessProxyService,
  /connect\(18443,'127\.0\.0\.1'\)/,
  'proxy health must require the post-prefetch application marker, not TCP-listen readiness',
);
assert.doesNotMatch(
  `${kemerbetRecheckService}\n${kemerbetReadinessBrowserService}\n${kemerbetReadinessProxyService}`,
  /owner_control_service|staging_service|kemerbet_session_control|kemerbet-readiness-seal-output|DATABASE|SUPABASE|RECEIVER|PILOT_MANIFEST|history|docker\.sock|kemerbet_readiness_bootstrap|network-gate-ready|network-gate-release/iu,
  'the static three-service recheck must remain isolated from application, database, pilot, history, Docker, and the retired dynamic gate design',
);

assert.match(customerWebService, /target: customer-web/);
assert.match(customerWebService, /CUSTOMER_WEB_HOST: 0\.0\.0\.0/);
assert.match(customerWebService, /CUSTOMER_WEB_PORT: '3003'/);
assert.match(
  customerWebService,
  /CUSTOMER_WEB_SUPABASE_URL: https:\/\/spzpiyxheappsfyswewl\.supabase\.co/,
);
assert.match(
  customerWebService,
  /CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE: \/run\/secrets\/customer_web_supabase_publishable_key/,
);
assert.match(
  customerWebService,
  /CUSTOMER_WEB_DATABASE_URL_FILE: \/run\/secrets\/customer_web_database_url/,
);
assert.match(
  customerWebService,
  /CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET_FILE: \/run\/secrets\/customer_web_rate_limit_hmac/,
);
assert.match(customerWebService, /INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED: 'true'/);
assert.match(customerWebService, /INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED: 'true'/);
assert.match(customerWebService, /INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED: 'false'/);
assert.match(
  customerWebService,
  /INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED: 'true'/,
);
assert.match(customerWebService, /INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED: 'true'/);
assert.match(
  customerWebService,
  /DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE: \/run\/secrets\/deposit_proof_reference_encryption_master/,
);
assert.match(
  customerWebService,
  /DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE: \/run\/secrets\/deposit_proof_reference_fingerprint_master/,
);
assert.match(
  customerWebService,
  /DEPOSIT_PROOF_REFERENCE_PROFILE_FILE: \/etc\/fetanagent\/deposit-proof-reference-profile\.v2\.json/,
);
assert.match(customerWebService, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/);
assert.match(customerWebService, /http:\/\/127\.0\.0\.1:3003\/readyz/);
assert.match(customerWebService, /networks:\s*\r?\n\s+- owner_control_service/);
assert.doesNotMatch(customerWebService, /^\s+ports:/m);
assert.doesNotMatch(customerWebService, /staging_service/);

assert.match(apiService, /target: api/);
assert.match(apiService, /API_HOST: 0\.0\.0\.0/);
assert.match(apiService, /API_PORT: '3000'/);
assert.match(apiService, /INTERNAL_TELEGRAM_PLAYER_ACTION_RUNTIME_ENABLED: 'true'/);
assert.match(apiService, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true'/);
assert.match(apiService, /INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'true'/);
assert.match(
  apiService,
  /PLAYER_ACTION_DATABASE_URL_FILE: \/run\/secrets\/player_action_database_url/,
);
assert.match(
  apiService,
  /BOT_TO_API_ACTION_HMAC_SECRET_FILE: \/run\/secrets\/api_player_action_transport_hmac/,
);
assert.match(
  apiService,
  /API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET_FILE: \/run\/secrets\/api_player_action_payload_hmac/,
);
assert.match(
  apiService,
  /API_TELEGRAM_CAPABILITY_HMAC_SECRET_FILE: \/run\/secrets\/api_player_action_capability_hmac/,
);
assert.match(
  apiService,
  /API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET_FILE: \/run\/secrets\/api_player_action_semantic_hmac/,
);
assert.match(
  apiService,
  /CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE: \/run\/secrets\/cbe_deposit_reference_encryption_key/,
);
assert.match(
  apiService,
  /CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE: \/run\/secrets\/cbe_deposit_reference_fingerprint_key/,
);
assert.match(
  apiService,
  /CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE: \/etc\/fetanagent\/cbe-deposit-reference-key-profile\.v1\.json/,
);
assert.match(
  apiService,
  /DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE: \/run\/secrets\/deposit_proof_reference_encryption_master/,
);
assert.match(
  apiService,
  /DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE: \/run\/secrets\/deposit_proof_reference_fingerprint_master/,
);
assert.match(
  apiService,
  /DEPOSIT_PROOF_REFERENCE_PROFILE_FILE: \/etc\/fetanagent\/deposit-proof-reference-profile\.v2\.json/,
);
assert.match(apiService, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/);
assert.match(apiService, /http:\/\/127\.0\.0\.1:3000\/readyz/);
assert.match(apiService, /networks:\s*\r?\n\s+- staging_service/);
assert.doesNotMatch(apiService, /^\s+ports:/m);
assert.doesNotMatch(apiService, /owner_control_service/);
for (const service of [ownerService, customerWebService, gatewayService, betaService, botService]) {
  assert.doesNotMatch(
    service,
    /CBE_DEPOSIT_REFERENCE|cbe_deposit_reference|cbe-deposit-reference/,
    'CBE deposit-reference key material and its profile must remain API-only',
  );
}
for (const service of [gatewayService, betaService, botService]) {
  assert.doesNotMatch(
    service,
    /DEPOSIT_PROOF_REFERENCE|deposit_proof_reference|deposit-proof-reference/,
    'provider-proof v2 roots and profile must remain limited to API, customer web, and the cryptographically domain-separated Owner receiver protector',
  );
}

assert.match(betaService, /target: beta-admission/);
assert.match(betaService, /INTERNAL_TELEGRAM_BETA_ADMISSION_RUNTIME_ENABLED: 'true'/);
assert.match(betaService, /TELEGRAM_BOT_ENABLED: 'false'/);
assert.match(betaService, /TELEGRAM_BETA_ADMISSION_ENABLED: 'false'/);
assert.match(betaService, /BETA_ADMISSION_HOST: 0\.0\.0\.0/);
assert.match(betaService, /BETA_ADMISSION_PORT: '3001'/);
assert.match(betaService, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/);
assert.match(
  betaService,
  /BETA_ADMISSION_DATABASE_URL_FILE: \/run\/secrets\/beta_admission_database_url/,
);
assert.match(
  betaService,
  /BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE: \/run\/secrets\/beta_admission_bot_transport_hmac/,
);
assert.match(
  betaService,
  /BETA_ADMISSION_PAYLOAD_HMAC_SECRET_FILE: \/run\/secrets\/beta_admission_payload_hmac/,
);
assert.match(betaService, /healthcheck:/, 'only the beta service may have a healthcheck');
assert.match(betaService, /http:\/\/127\.0\.0\.1:3001\/readyz/);
assert.match(betaService, /networks:\s*\r?\n\s+- staging_service/);
assert.doesNotMatch(betaService, /owner_control_service/);

assert.match(botService, /target: bot/);
assert.match(botService, /TELEGRAM_BOT_ENABLED: 'true'/);
assert.match(botService, /TELEGRAM_BETA_ADMISSION_ENABLED: 'true'/);
assert.match(botService, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'true'/);
assert.match(botService, /INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'false'/);
assert.match(botService, /BOT_TO_BETA_ADMISSION_BASE_URL: http:\/\/beta-admission:3001\//);
assert.match(botService, /BOT_TO_API_ACTION_BASE_URL: http:\/\/api:3000\//);
assert.match(botService, /TELEGRAM_BOT_TOKEN_FILE: \/run\/secrets\/telegram_bot_token/);
assert.match(
  botService,
  /BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE: \/run\/secrets\/bot_beta_admission_transport_hmac/,
);
assert.match(
  botService,
  /BOT_TO_API_ACTION_HMAC_SECRET_FILE: \/run\/secrets\/bot_player_action_transport_hmac/,
);
assert.doesNotMatch(botService, /healthcheck:/, 'the bot must not define a healthcheck');
assert.match(botService, /condition: service_healthy/);
assert.match(botService, /networks:\s*\r?\n\s+- staging_service/);
assert.doesNotMatch(botService, /owner_control_service/);

const betaSecrets = servicePropertyBlock(betaService, 'secrets');
const betaConfigs = servicePropertyBlock(betaService, 'configs');
const apiSecrets = servicePropertyBlock(apiService, 'secrets');
const apiConfigs = servicePropertyBlock(apiService, 'configs');
const ownerSecrets = servicePropertyBlock(ownerService, 'secrets');
const ownerConfigs = servicePropertyBlock(ownerService, 'configs');
const customerWebSecrets = servicePropertyBlock(customerWebService, 'secrets');
const customerWebConfigs = servicePropertyBlock(customerWebService, 'configs');
const botSecrets = servicePropertyBlock(botService, 'secrets');
const betaSecretSources = [...betaSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
  (match) => match[1],
);
const botSecretSources = [...botSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
  (match) => match[1],
);
assert.deepEqual(
  [...customerWebSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
    (match) => match[1],
  ),
  [
    'customer_web_database_url',
    'customer_web_supabase_publishable_key',
    'customer_web_rate_limit_hmac',
    'deposit_proof_reference_encryption_master',
    'deposit_proof_reference_fingerprint_master',
  ],
  'customer web must receive only its database URL, public Auth client key, rate-limit HMAC, and provider-proof v2 roots',
);
assert.deepEqual(
  [...customerWebConfigs.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
    (match) => match[1],
  ),
  ['supabase_ca_certificate', 'deposit_proof_reference_profile'],
  'customer web must receive only the verified staging Supabase CA and provider-proof v2 profile',
);
assert.deepEqual(
  [...ownerSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]),
  [
    'owner_control_database_url',
    'owner_control_supabase_publishable_key',
    'deposit_proof_reference_encryption_master',
    'deposit_proof_reference_fingerprint_master',
  ],
  'Owner control must receive only its database URL, public Auth client key, and receiver-reference protection roots',
);
assert.deepEqual(
  [...ownerConfigs.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]),
  ['supabase_ca_certificate', 'deposit_proof_reference_profile'],
  'Owner control must receive the verified staging Supabase CA and immutable master-key profile',
);
assert.deepEqual(
  betaSecretSources,
  [
    'beta_admission_database_url',
    'beta_admission_bot_transport_hmac',
    'beta_admission_payload_hmac',
  ],
  'the beta service must receive only its three dedicated secrets',
);
assert.deepEqual(
  botSecretSources,
  ['telegram_bot_token', 'bot_beta_admission_transport_hmac', 'bot_player_action_transport_hmac'],
  'the bot must receive only its three dedicated secrets',
);
assert.deepEqual(
  [...apiSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]),
  [
    'player_action_database_url',
    'api_player_action_transport_hmac',
    'api_player_action_payload_hmac',
    'api_player_action_capability_hmac',
    'api_player_action_semantic_hmac',
    'cbe_deposit_reference_encryption_key',
    'cbe_deposit_reference_fingerprint_key',
    'deposit_proof_reference_encryption_master',
    'deposit_proof_reference_fingerprint_master',
  ],
  'the API must receive only its nine dedicated Player-ID and deposit-intake secrets',
);
assert.deepEqual(
  [...apiConfigs.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]),
  [
    'supabase_ca_certificate',
    'cbe_deposit_reference_key_profile',
    'deposit_proof_reference_profile',
  ],
  'the API must receive only the verified staging Supabase CA and immutable v1/v2 profiles',
);
const betaConfigSources = [...betaConfigs.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
  (match) => match[1],
);
assert.deepEqual(
  betaConfigSources,
  ['supabase_ca_certificate'],
  'the beta service must receive the verified staging Supabase CA',
);
assert.doesNotMatch(botService, /supabase_ca_certificate|NODE_EXTRA_CA_CERTS/);

assert.equal(countMatches(compose, /^\s+mode: 0400$/gm), 24, 'every secret mount must be 0400');
assert.equal(
  countMatches(compose, /^\s+mode: 0444$/gm),
  8,
  'each immutable config mount must be 0444',
);
assert.equal(
  countMatches(compose, /^\s+uid: '10001'$/gm),
  32,
  'every mounted input must target UID 10001',
);
assert.equal(
  countMatches(compose, /^\s+gid: '10001'$/gm),
  32,
  'every mounted input must target GID 10001',
);

const expectedSecrets = [
  'beta_admission_bot_transport_hmac',
  'beta_admission_database_url',
  'beta_admission_payload_hmac',
  'api_player_action_capability_hmac',
  'api_player_action_payload_hmac',
  'api_player_action_semantic_hmac',
  'api_player_action_transport_hmac',
  'cbe_deposit_reference_encryption_key',
  'cbe_deposit_reference_fingerprint_key',
  'deposit_proof_reference_encryption_master',
  'deposit_proof_reference_fingerprint_master',
  'customer_web_database_url',
  'customer_web_rate_limit_hmac',
  'customer_web_supabase_publishable_key',
  'bot_beta_admission_transport_hmac',
  'bot_player_action_transport_hmac',
  'player_action_database_url',
  'telegram_bot_token',
  'owner_control_database_url',
  'owner_control_supabase_publishable_key',
];
const declaredSecrets = [...secrets.matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gm)].map(
  (match) => match[1],
);
assert.deepEqual(sorted(declaredSecrets), sorted(expectedSecrets), 'unexpected Compose secret set');

for (const secret of expectedSecrets) {
  assert.match(compose, new RegExp(`source: ${escapeRegExp(secret)}(?:\\r?\\n|$)`));
  assert.match(secrets, new RegExp(`  ${escapeRegExp(secret)}:\\s*\\r?\\n\\s+file: \\$\\{`));
}

assert.deepEqual(
  [...configs.matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gm)].map((match) => match[1]),
  [
    'supabase_ca_certificate',
    'cbe_deposit_reference_key_profile',
    'deposit_proof_reference_profile',
  ],
  'only the staging Supabase CA and immutable v1/v2 reference-profile configs are allowed',
);
assert.match(
  configs,
  /FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE:\?set the verified staging Supabase CA file/,
);
assert.match(
  configs,
  /FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE:\?set the immutable CBE deposit-reference key-profile file/,
);
assert.match(
  configs,
  /FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE:\?set the immutable provider-proof v2 reference profile file/,
);
assert.match(
  apiSecrets,
  /source: cbe_deposit_reference_encryption_key\s*\r?\n\s+target: cbe_deposit_reference_encryption_key/,
);
assert.match(
  apiSecrets,
  /source: cbe_deposit_reference_fingerprint_key\s*\r?\n\s+target: cbe_deposit_reference_fingerprint_key/,
);
assert.match(
  apiConfigs,
  /source: cbe_deposit_reference_key_profile\s*\r?\n\s+target: \/etc\/fetanagent\/cbe-deposit-reference-key-profile\.v1\.json/,
);
for (const serviceSecrets of [apiSecrets, customerWebSecrets]) {
  assert.match(
    serviceSecrets,
    /source: deposit_proof_reference_encryption_master\s*\r?\n\s+target: deposit_proof_reference_encryption_master/,
  );
  assert.match(
    serviceSecrets,
    /source: deposit_proof_reference_fingerprint_master\s*\r?\n\s+target: deposit_proof_reference_fingerprint_master/,
  );
}
for (const serviceConfigs of [apiConfigs, customerWebConfigs]) {
  assert.match(
    serviceConfigs,
    /source: deposit_proof_reference_profile\s*\r?\n\s+target: \/etc\/fetanagent\/deposit-proof-reference-profile\.v2\.json/,
  );
}

for (const directSecretName of [
  'BETA_ADMISSION_DATABASE_URL',
  'BOT_TO_BETA_ADMISSION_HMAC_SECRET',
  'BETA_ADMISSION_PAYLOAD_HMAC_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'OWNER_CONTROL_DATABASE_URL',
  'OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY',
  'PLAYER_ACTION_DATABASE_URL',
  'BOT_TO_API_ACTION_HMAC_SECRET',
  'API_TELEGRAM_PLAYER_ACTION_PAYLOAD_HMAC_SECRET',
  'API_TELEGRAM_CAPABILITY_HMAC_SECRET',
  'API_TELEGRAM_ACTION_SEMANTIC_HMAC_SECRET',
  'CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET',
  'CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET',
  'CBE_DEPOSIT_REFERENCE_KEY_PROFILE',
  'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET',
  'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET',
  'DEPOSIT_PROOF_REFERENCE_PROFILE',
  'CUSTOMER_WEB_DATABASE_URL',
  'CUSTOMER_WEB_RATE_LIMIT_HMAC_SECRET',
  'CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY',
]) {
  assert.doesNotMatch(
    compose,
    new RegExp(`^\\s+${directSecretName}:`, 'm'),
    `${directSecretName} must never be placed directly in the environment`,
  );
}

const ownerControlNetwork = childBlock(networks, 'owner_control_service');
const stagingNetwork = childBlock(networks, 'staging_service');
const kemerbetReadinessControlNetwork = childBlock(networks, 'kemerbet_readiness_control');
const kemerbetReadinessProxyNetwork = childBlock(networks, 'kemerbet_readiness_proxy');
const kemerbetReadinessEgressNetwork = childBlock(networks, 'kemerbet_readiness_egress');
const telebirrDeviceIngressNetwork = childBlock(networks, 'telebirr_device_ingress');
assert.deepEqual(
  sorted([...networks.matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gm)].map((match) => match[1])),
  sorted([
    'owner_control_service',
    'staging_service',
    'kemerbet_readiness_control',
    'kemerbet_readiness_proxy',
    'kemerbet_readiness_egress',
    'telebirr_device_ingress',
  ]),
  'only the two application bridges, three static readiness bridges, and TeleBirr ingress are allowed',
);
for (const [networkName, network] of [
  ['owner_control_service', ownerControlNetwork],
  ['staging_service', stagingNetwork],
  ['kemerbet_readiness_egress', kemerbetReadinessEgressNetwork],
]) {
  assert.match(network, /driver: bridge/);
  assert.match(network, /internal: false/, `${networkName} must retain outbound Internet access`);
  assert.match(network, /attachable: false/);
  assert.match(network, /enable_ipv6: true/);
}
assert.doesNotMatch(
  kemerbetReadinessEgressNetwork,
  /driver_opts:|ipam:|com\.docker\.network\.bridge\.gateway_mode_ipv[46]/,
  'the proxy-only egress bridge must not inherit isolated static-network configuration',
);
assert.match(
  telebirrDeviceIngressNetwork,
  /name: fetanagent-telebirr-device-ingress\s*\r?\n\s+driver: bridge\s*\r?\n\s+internal: true\s*\r?\n\s+attachable: false/,
  'the cross-project TeleBirr bridge must be fixed, internal-only, and non-attachable',
);
assert.doesNotMatch(
  telebirrDeviceIngressNetwork,
  /driver_opts:|ipam:/,
  'the TeleBirr ingress must remain a simple Docker-internal bridge',
);

const assertExactIsolatedReadinessNetwork = (
  name,
  network,
  ipv4Subnet,
  ipv4Gateway,
  ipv6Subnet,
  ipv6Gateway,
) => {
  assert.match(network, /driver: bridge/);
  assert.match(network, /internal: true/, `${name} must have no Internet route`);
  assert.match(network, /attachable: false/);
  assert.match(network, /enable_ipv6: true/);
  assert.deepEqual(
    [
      ...network.matchAll(
        /^      (com\.docker\.network\.bridge\.gateway_mode_ipv[46]): ([^\r\n]+)$/gm,
      ),
    ].map((match) => [match[1], match[2]]),
    [
      ['com.docker.network.bridge.gateway_mode_ipv4', 'isolated'],
      ['com.docker.network.bridge.gateway_mode_ipv6', 'isolated'],
    ],
    `${name} must isolate exactly its IPv4 and IPv6 host gateways`,
  );
  assert.match(
    network,
    new RegExp(
      `ipam:\\s*\\r?\\n\\s+config:\\s*\\r?\\n\\s+- subnet: ${escapeRegExp(ipv4Subnet)}\\s*\\r?\\n\\s+gateway: ${escapeRegExp(ipv4Gateway)}\\s*\\r?\\n\\s+- subnet: ${escapeRegExp(ipv6Subnet)}\\s*\\r?\\n\\s+gateway: ${escapeRegExp(ipv6Gateway)}`,
    ),
    `${name} must retain its reviewed static dual-stack IPAM`,
  );
};
assertExactIsolatedReadinessNetwork(
  'kemerbet_readiness_control',
  kemerbetReadinessControlNetwork,
  '172.31.254.0/29',
  '172.31.254.1',
  'fd5e:7a9e:1::/64',
  'fd5e:7a9e:1::1',
);
assertExactIsolatedReadinessNetwork(
  'kemerbet_readiness_proxy',
  kemerbetReadinessProxyNetwork,
  '172.31.254.8/29',
  '172.31.254.9',
  'fd5e:7a9e:2::/64',
  'fd5e:7a9e:2::1',
);
assert.doesNotMatch(
  compose,
  /kemerbet_readiness_bootstrap|fetanagent-kemerbet-readiness-network-gate-(?:ready|release)-v1/,
  'the retired dynamic marker/attach topology must remain absent',
);

assert.equal(
  countMatches(compose, /^\s+ports:\s*$/gm),
  2,
  'Owner control and the separately gated HTTPS gateway are the only services that may bind ports',
);
assert.doesNotMatch(compose, /^\s+(expose|devices|privileged|network_mode):/m);
for (const service of [customerWebService, apiService, betaService, botService]) {
  assert.doesNotMatch(service, /^\s+volumes:/m);
}
assert.doesNotMatch(betaService, /^\s+ports:/m);
assert.doesNotMatch(customerWebService, /^\s+ports:/m);
assert.doesNotMatch(apiService, /^\s+ports:/m);
assert.doesNotMatch(botService, /^\s+ports:/m);
assert.doesNotMatch(compose, /docker\.sock|\/var\/run\/docker/i);
assert.doesNotMatch(compose, /\b(?:nginx|traefik|haproxy)\b/i);
assert.doesNotMatch(compose, /xzztugbgtulptnbpoelr/i, 'the production project ref is forbidden');
assert.doesNotMatch(services, /^  (?:worker|executor|maintenance|proxy):\s*$/m);
assert.deepEqual(
  [...volumes.matchAll(/^  ([a-z][a-z0-9_]*):\s*$/gm)].map((match) => match[1]),
  ['kemerbet_session_control', 'kemerbet_sessions', 'kemerbet_readiness_profile_snapshot'],
  'only the private socket, long-lived profile, and one external disposable readiness snapshot are allowed',
);
const readinessSnapshotVolume = childBlock(volumes, 'kemerbet_readiness_profile_snapshot');
assert.match(readinessSnapshotVolume, /external: true/);
assert.match(
  readinessSnapshotVolume,
  /name: fetanagent-staging-beta-kemerbet-readiness-profile-snapshot-once/,
);

const reviewedBase =
  'node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066';
assert.equal(
  countMatches(dockerfile, new RegExp(`FROM --platform=linux/amd64 ${reviewedBase}`, 'g')),
  2,
  'both build and runtime bases must use the reviewed linux/amd64 digest',
);
assert.match(dockerfile, /pnpm --filter @fetanagent\/beta-admission\.\.\. run build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/bot\.\.\. run build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/admin\.\.\. run build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/customer-web\.\.\. run build/);
assert.match(dockerfile, /pnpm --filter @fetanagent\/api\.\.\. run build/);
assert.match(dockerfile, /FROM build-base AS beta-admission-build/);
assert.match(dockerfile, /FROM build-base AS bot-build/);
assert.match(dockerfile, /FROM build-base AS admin-build/);
assert.match(dockerfile, /FROM build-base AS customer-web-build/);
assert.match(dockerfile, /FROM runtime-base AS beta-admission/);
assert.match(dockerfile, /FROM runtime-base AS bot/);
assert.match(dockerfile, /FROM runtime-base AS admin/);
assert.match(dockerfile, /FROM runtime-base AS customer-web/);
assert.match(dockerfile, /USER 10001:10001/);
assert.match(
  dockerfile,
  /groupadd --gid 10001 fetanagent[\s\S]*?useradd --uid 10001 --gid 10001[\s\S]*?groupadd --gid 10002 fetanagent-readiness-controller[\s\S]*?useradd --uid 10002 --gid 10002[\s\S]*?groupadd --gid 10003 fetanagent-readiness-proxy[\s\S]*?useradd --uid 10003 --gid 10003[\s\S]*?groupadd --gid 10004 fetanagent-readiness-authorizer[\s\S]*?useradd --uid 10004 --gid 10004/,
  'the runtime image must contain distinct browser, controller, proxy, and offline-authorizer identities',
);
assert.match(
  dockerfile,
  /caddy:2\.11\.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS gateway/,
);

const betaImage = dockerfile
  .split('FROM runtime-base AS beta-admission')[1]
  .split('FROM runtime-base AS bot')[0];
const botImage = dockerfile
  .split('FROM runtime-base AS bot')[1]
  .split('FROM runtime-base AS admin')[0];
const adminImage = dockerfile
  .split('FROM runtime-base AS admin')[1]
  .split('FROM runtime-base AS api')[0];
assert.match(betaImage, /HEALTHCHECK .*127\.0\.0\.1:3001\/readyz/);
assert.match(betaImage, /CMD \["node", "apps\/beta-admission\/dist\/index\.js"\]/);
assert.doesNotMatch(botImage, /HEALTHCHECK/);
assert.match(botImage, /CMD \["node", "apps\/bot\/dist\/index\.js"\]/);
assert.match(
  adminImage,
  /install -d -o root -g root -m 0755 \/run\/fetanagent-kemerbet-readiness-cohort-receipts/,
);
assert.match(adminImage, /127\.0\.0\.1:3002\/readyz/);
assert.match(adminImage, /CMD \["node", "apps\/admin\/dist\/index\.js"\]/);
const apiImage = dockerfile.split('FROM runtime-base AS api')[1];
assert.match(apiImage, /USER fetanagent:fetanagent/);
const customerWebImage = dockerfile
  .split('FROM runtime-base AS customer-web')[1]
  .split('FROM runtime-base AS beta-admission')[0];
assert.match(customerWebImage, /127\.0\.0\.1:3003\/readyz/);
assert.match(customerWebImage, /CMD \["node", "apps\/customer-web\/dist\/index\.js"\]/);

const gatewayImage = dockerfile.split(' AS gateway')[1];
assert.match(gatewayImage, /org\.opencontainers\.image\.title="fetanagent-gateway"/);
assert.match(gatewayImage, /COPY infra\/gateway\/Caddyfile \/etc\/caddy\/Caddyfile/);
assert.match(gatewayImage, /COPY infra\/gateway\/site \/srv/);
assert.match(gatewayImage, /USER 10001:10001/);
assert.match(gatewayImage, /caddy", "validate"/);

assert.match(caddyfile, /^\s*admin off$/m);
assert.match(caddyfile, /protocols h1 h2/);
assert.doesNotMatch(caddyfile, /\bh3\b|:80\s*\{|tls internal|on_demand_tls|acme_dns/i);
assert.match(caddyfile, /fetanagent\.com, www\.fetanagent\.com/);
assert.match(caddyfile, /owner\.fetanagent\.com/);
assert.match(caddyfile, /reverse_proxy customer-web:3003/);
assert.match(caddyfile, /reverse_proxy owner-control:3002/);
assert.match(caddyfile, /Strict-Transport-Security "max-age=86400"/);
assert.doesNotMatch(caddyfile, /file_server|root \* \/srv/);
assert.doesNotMatch(caddyfile, /api:3000|beta-admission:3001|docker\.sock/);
assert.match(landingPage, /https:\/\/t\.me\/FetanAgentBot/);
assert.match(landingPage, /https:\/\/owner\.fetanagent\.com\/owner/);
assert.doesNotMatch(landingPage, /\bPayRe(?:layy?|playy)\b/i);

console.log(
  'staging beta artifacts verified: private application services, a gated HTTPS gateway, a static three-service no-transfer readiness boundary with an external disposable profile snapshot, and locked financial/provider gates',
);
