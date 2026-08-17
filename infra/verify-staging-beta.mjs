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
const gatewayService = childBlock(services, 'gateway');
const apiService = childBlock(services, 'api');
const betaService = childBlock(services, 'beta-admission');
const botService = childBlock(services, 'bot');
const networks = topLevelSection(compose, 'networks');
const configs = topLevelSection(compose, 'configs');
const secrets = topLevelSection(compose, 'secrets');

const serviceNames = [...services.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]);
assert.deepEqual(
  serviceNames,
  ['owner-control', 'gateway', 'api', 'beta-admission', 'bot'],
  'only Owner control, the gated public gateway, Player-ID API, beta-admission, and bot are allowed',
);

for (const [name, service] of [
  ['owner-control', ownerService],
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
assert.match(gatewayService, /networks:\s*\r?\n\s+- owner_control_service/);
assert.doesNotMatch(gatewayService, /staging_service|secrets:|configs:|docker\.sock/);
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
assert.match(ownerService, /ports:\s*\r?\n\s+- 127\.0\.0\.1:3002:3002/);
assert.match(ownerService, /networks:\s*\r?\n\s+- owner_control_service/);
assert.doesNotMatch(ownerService, /staging_service/);
assert.match(ownerService, /http:\/\/127\.0\.0\.1:3002\/readyz/);
assert.doesNotMatch(ownerService, /TELEGRAM_BOT_ENABLED: 'true'/);

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
assert.match(apiService, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/);
assert.match(apiService, /http:\/\/127\.0\.0\.1:3000\/readyz/);
assert.match(apiService, /networks:\s*\r?\n\s+- staging_service/);
assert.doesNotMatch(apiService, /^\s+ports:/m);
assert.doesNotMatch(apiService, /owner_control_service/);
for (const service of [ownerService, gatewayService, betaService, botService]) {
  assert.doesNotMatch(
    service,
    /CBE_DEPOSIT_REFERENCE|cbe_deposit_reference|cbe-deposit-reference/,
    'CBE deposit-reference key material and its profile must remain API-only',
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
const botSecrets = servicePropertyBlock(botService, 'secrets');
const betaSecretSources = [...betaSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
  (match) => match[1],
);
const botSecretSources = [...botSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
  (match) => match[1],
);
assert.deepEqual(
  [...ownerSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]),
  ['owner_control_database_url', 'owner_control_supabase_publishable_key'],
  'Owner control must receive only its database URL and public Auth client key',
);
assert.deepEqual(
  [...ownerConfigs.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]),
  ['supabase_ca_certificate'],
  'Owner control must receive the verified staging Supabase CA',
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
  ],
  'the API must receive only its seven dedicated Player-ID and deposit-intake secrets',
);
assert.deepEqual(
  [...apiConfigs.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map((match) => match[1]),
  ['supabase_ca_certificate', 'cbe_deposit_reference_key_profile'],
  'the API must receive only the verified staging Supabase CA and immutable key profile',
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

assert.equal(countMatches(compose, /^\s+mode: 0400$/gm), 15, 'every secret mount must be 0400');
assert.equal(
  countMatches(compose, /^\s+mode: 0444$/gm),
  4,
  'each immutable config mount must be 0444',
);
assert.equal(
  countMatches(compose, /^\s+uid: '10001'$/gm),
  19,
  'every mounted input must target UID 10001',
);
assert.equal(
  countMatches(compose, /^\s+gid: '10001'$/gm),
  19,
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
  ['supabase_ca_certificate', 'cbe_deposit_reference_key_profile'],
  'only the staging Supabase CA and immutable CBE key-profile configs are allowed',
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
]) {
  assert.doesNotMatch(
    compose,
    new RegExp(`^\\s+${directSecretName}:`, 'm'),
    `${directSecretName} must never be placed directly in the environment`,
  );
}

const ownerControlNetwork = childBlock(networks, 'owner_control_service');
const stagingNetwork = childBlock(networks, 'staging_service');
for (const [networkName, network] of [
  ['owner_control_service', ownerControlNetwork],
  ['staging_service', stagingNetwork],
]) {
  assert.match(network, /driver: bridge/);
  assert.match(network, /internal: false/, `${networkName} must retain outbound Internet access`);
  assert.match(network, /attachable: false/);
}
assert.match(
  ownerControlNetwork,
  /enable_ipv6: true/,
  'the Owner-control service bridge must provide IPv6',
);
assert.match(stagingNetwork, /enable_ipv6: true/, 'the staging service bridge must provide IPv6');

assert.equal(
  countMatches(compose, /^\s+ports:\s*$/gm),
  2,
  'Owner control and the separately gated HTTPS gateway are the only services that may bind ports',
);
assert.doesNotMatch(compose, /^\s+(expose|devices|privileged|network_mode):/m);
for (const service of [ownerService, apiService, betaService, botService]) {
  assert.doesNotMatch(service, /^\s+volumes:/m);
}
assert.doesNotMatch(betaService, /^\s+ports:/m);
assert.doesNotMatch(apiService, /^\s+ports:/m);
assert.doesNotMatch(botService, /^\s+ports:/m);
assert.doesNotMatch(compose, /docker\.sock|\/var\/run\/docker/i);
assert.doesNotMatch(compose, /\b(?:nginx|traefik|haproxy)\b/i);
assert.doesNotMatch(compose, /xzztugbgtulptnbpoelr/i, 'the production project ref is forbidden');
assert.doesNotMatch(services, /^  (?:worker|executor|maintenance|proxy):\s*$/m);
assert.doesNotMatch(compose, /^volumes:\s*$/m, 'named volumes are forbidden');

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
assert.match(dockerfile, /pnpm --filter @fetanagent\/api\.\.\. run build/);
assert.match(dockerfile, /FROM build-base AS beta-admission-build/);
assert.match(dockerfile, /FROM build-base AS bot-build/);
assert.match(dockerfile, /FROM build-base AS admin-build/);
assert.match(dockerfile, /FROM runtime-base AS beta-admission/);
assert.match(dockerfile, /FROM runtime-base AS bot/);
assert.match(dockerfile, /FROM runtime-base AS admin/);
assert.match(dockerfile, /USER 10001:10001/);
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
assert.match(adminImage, /127\.0\.0\.1:3002\/readyz/);
assert.match(adminImage, /CMD \["node", "apps\/admin\/dist\/index\.js"\]/);
const apiImage = dockerfile.split('FROM runtime-base AS api')[1];
assert.match(apiImage, /USER fetanagent:fetanagent/);

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
assert.match(caddyfile, /reverse_proxy owner-control:3002/);
assert.match(caddyfile, /Strict-Transport-Security "max-age=86400"/);
assert.match(caddyfile, /Content-Security-Policy/);
assert.doesNotMatch(caddyfile, /api:3000|beta-admission:3001|docker\.sock/);
assert.match(landingPage, /https:\/\/t\.me\/FetanAgentBot/);
assert.match(landingPage, /https:\/\/owner\.fetanagent\.com\/owner/);
assert.doesNotMatch(landingPage, /\bPayRe(?:layy?|playy)\b/i);

console.log(
  'staging beta artifacts verified: four private services, a separately gated HTTPS gateway, isolated inputs, and locked financial/provider gates',
);
