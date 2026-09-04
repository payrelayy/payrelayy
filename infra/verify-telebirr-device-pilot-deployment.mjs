import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const pilotCompose = await readFile(
  `${repositoryRoot}infra/compose.telebirr-device-pilot.yaml`,
  'utf8',
);
const stagingCompose = await readFile(`${repositoryRoot}infra/compose.staging-beta.yaml`, 'utf8');
const caddyfile = await readFile(`${repositoryRoot}infra/gateway/Caddyfile`, 'utf8');
const qualityWorkflow = await readFile(`${repositoryRoot}.github/workflows/quality.yml`, 'utf8');

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
const bridge = serviceSection(pilotCompose, 'telebirr-device-bridge');
const gateway = serviceSection(stagingCompose, 'gateway');

assert.match(pilotCompose, /^name: fetanagent-telebirr-device-pilot$/mu);
assert.equal(
  [...pilotCompose.matchAll(/^    profiles: \[telebirr-device-pilot\]$/gmu)].length,
  3,
  'only the exact three-service pilot profile may activate the stack',
);
assert.doesNotMatch(pilotCompose, /^\s+ports:\s*$/mu);
assert.doesNotMatch(pilotCompose, /2026-09-04|shutdownAt|stopAt/u);

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
assert.match(bridge, /telebirr_device_ingress:[\s\S]*?- telebirr-device-bridge/u);
assert.doesNotMatch(bridge, /database_egress|DATABASE_URL|NODE_EXTRA_CA_CERTS/u);
assert.match(
  bridge,
  /telebirr-assignment-broker:[\s\S]*?condition: service_healthy[\s\S]*?telebirr-device-state-broker:[\s\S]*?condition: service_healthy/u,
);

assert.match(
  pilotCompose,
  /telebirr_assignment_database_egress:[\s\S]*?internal: false[\s\S]*?telebirr_device_state_database_egress:[\s\S]*?internal: false/u,
);
assert.match(
  pilotCompose,
  /telebirr_device_ingress:\s*\r?\n    external: true\s*\r?\n    name: fetanagent-telebirr-device-ingress/u,
);
assert.match(
  stagingCompose,
  /telebirr_device_ingress:\s*\r?\n    name: fetanagent-telebirr-device-ingress\s*\r?\n    driver: bridge\s*\r?\n    internal: true\s*\r?\n    attachable: false/u,
);
assert.match(gateway, /- telebirr_device_ingress/u);

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
assert.match(
  caddyfile,
  /header Content-Type application\/vnd\.fetanagent\.telebirr-device-bridge\+json/u,
);
assert.match(caddyfile, /max_size 256KiB/u);
assert.match(caddyfile, /reverse_proxy telebirr-device-bridge:8084/u);
assert.match(caddyfile, /dial_timeout 3s/u);
assert.match(caddyfile, /response_header_timeout 15s/u);
assert.match(caddyfile, /respond 404/u);
assert.doesNotMatch(caddyfile, /device\.fetanagent\.com[\s\S]*?encode /u);

assert.match(
  qualityWorkflow,
  /docker compose --env-file \/dev\/null[\s\S]*?--file infra\/compose\.telebirr-device-pilot\.yaml[\s\S]*?--profile telebirr-device-pilot config --quiet/u,
);

console.log(
  'TeleBirr device pilot deployment verified: three isolated no-money services, read-only socket consumers, database-free ingress, and exact HTTPS routes.',
);
