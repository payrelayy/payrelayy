import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const infraDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const compose = await readFile(`${infraDirectory}compose.staging-beta.yaml`, 'utf8');
const dockerfile = await readFile(`${repositoryRoot}Dockerfile`, 'utf8');

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
const betaService = childBlock(services, 'beta-admission');
const botService = childBlock(services, 'bot');
const networks = topLevelSection(compose, 'networks');
const configs = topLevelSection(compose, 'configs');
const secrets = topLevelSection(compose, 'secrets');

const serviceNames = [...services.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]);
assert.deepEqual(
  serviceNames,
  ['beta-admission', 'bot'],
  'only beta-admission and bot are allowed',
);

for (const [name, service] of [
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
  assert.match(service, /INTERNAL_TELEGRAM_ACTION_CHANNEL_ENABLED: 'false'/);
  assert.match(service, /INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED: 'false'/);
  assert.match(service, /KEMERBET_EXECUTOR_ENABLED: 'false'/);
  assert.match(service, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/);
  assert.match(service, /networks:\s*\r?\n\s+- staging_service/);
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

assert.match(botService, /target: bot/);
assert.match(botService, /TELEGRAM_BOT_ENABLED: 'true'/);
assert.match(botService, /TELEGRAM_BETA_ADMISSION_ENABLED: 'true'/);
assert.match(botService, /BOT_TO_BETA_ADMISSION_BASE_URL: http:\/\/beta-admission:3001\//);
assert.match(botService, /TELEGRAM_BOT_TOKEN_FILE: \/run\/secrets\/telegram_bot_token/);
assert.match(
  botService,
  /BOT_TO_BETA_ADMISSION_HMAC_SECRET_FILE: \/run\/secrets\/bot_beta_admission_transport_hmac/,
);
assert.doesNotMatch(botService, /healthcheck:/, 'the bot must not define a healthcheck');
assert.match(botService, /condition: service_healthy/);

const betaSecrets = servicePropertyBlock(betaService, 'secrets');
const betaConfigs = servicePropertyBlock(betaService, 'configs');
const botSecrets = servicePropertyBlock(botService, 'secrets');
const betaSecretSources = [...betaSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
  (match) => match[1],
);
const botSecretSources = [...botSecrets.matchAll(/^\s+- source: ([a-z][a-z0-9_]*)\r?$/gm)].map(
  (match) => match[1],
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
  ['telegram_bot_token', 'bot_beta_admission_transport_hmac'],
  'the bot must receive only its two dedicated secrets',
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

assert.equal(countMatches(compose, /^\s+mode: 0400$/gm), 5, 'every secret mount must be 0400');
assert.equal(countMatches(compose, /^\s+mode: 0444$/gm), 1, 'the public CA mount must be 0444');
assert.equal(
  countMatches(compose, /^\s+uid: '10001'$/gm),
  6,
  'every mounted input must target UID 10001',
);
assert.equal(
  countMatches(compose, /^\s+gid: '10001'$/gm),
  6,
  'every mounted input must target GID 10001',
);

const expectedSecrets = [
  'beta_admission_bot_transport_hmac',
  'beta_admission_database_url',
  'beta_admission_payload_hmac',
  'bot_beta_admission_transport_hmac',
  'telegram_bot_token',
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
  ['supabase_ca_certificate'],
  'only the staging Supabase CA config is allowed',
);
assert.match(
  configs,
  /PAYREPLAYY_STAGING_SUPABASE_CA_CERTIFICATE_FILE:\?set the verified staging Supabase CA file/,
);

for (const directSecretName of [
  'BETA_ADMISSION_DATABASE_URL',
  'BOT_TO_BETA_ADMISSION_HMAC_SECRET',
  'BETA_ADMISSION_PAYLOAD_HMAC_SECRET',
  'TELEGRAM_BOT_TOKEN',
]) {
  assert.doesNotMatch(
    compose,
    new RegExp(`^\\s+${directSecretName}:`, 'm'),
    `${directSecretName} must never be placed directly in the environment`,
  );
}

assert.match(networks, /^  staging_service:\s*$/m);
assert.match(networks, /driver: bridge/);
assert.match(
  networks,
  /internal: false/,
  'the private bridge must retain outbound Internet access',
);
assert.match(networks, /attachable: false/);

assert.doesNotMatch(compose, /^\s+(ports|expose|volumes|devices|privileged|network_mode):/m);
assert.doesNotMatch(compose, /docker\.sock|\/var\/run\/docker/i);
assert.doesNotMatch(compose, /\b(?:nginx|caddy|traefik|haproxy)\b/i);
assert.doesNotMatch(compose, /xzztugbgtulptnbpoelr/i, 'the production project ref is forbidden');
assert.doesNotMatch(services, /^  (?:api|worker|executor|maintenance|proxy):\s*$/m);

const reviewedBase =
  'node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066';
assert.equal(
  countMatches(dockerfile, new RegExp(`FROM --platform=linux/amd64 ${reviewedBase}`, 'g')),
  2,
  'both build and runtime bases must use the reviewed linux/amd64 digest',
);
assert.match(dockerfile, /pnpm --filter @payreplayy\/beta-admission\.\.\. run build/);
assert.match(dockerfile, /pnpm --filter @payreplayy\/bot\.\.\. run build/);
assert.match(dockerfile, /FROM build-base AS beta-admission-build/);
assert.match(dockerfile, /FROM build-base AS bot-build/);
assert.match(dockerfile, /FROM runtime-base AS beta-admission/);
assert.match(dockerfile, /FROM runtime-base AS bot/);
assert.match(dockerfile, /USER 10001:10001/);

const betaImage = dockerfile
  .split('FROM runtime-base AS beta-admission')[1]
  .split('FROM runtime-base AS bot')[0];
const botImage = dockerfile
  .split('FROM runtime-base AS bot')[1]
  .split('FROM runtime-base AS api')[0];
assert.match(betaImage, /HEALTHCHECK .*127\.0\.0\.1:3001\/readyz/);
assert.match(betaImage, /CMD \["node", "apps\/beta-admission\/dist\/index\.js"\]/);
assert.doesNotMatch(botImage, /HEALTHCHECK/);
assert.match(botImage, /CMD \["node", "apps\/bot\/dist\/index\.js"\]/);
const apiImage = dockerfile.split('FROM runtime-base AS api')[1];
assert.match(apiImage, /USER payreplayy:payreplayy/);

console.log(
  'staging beta artifacts verified: two manual-profile services, isolated file secrets, no host ingress, and locked financial/provider gates',
);
