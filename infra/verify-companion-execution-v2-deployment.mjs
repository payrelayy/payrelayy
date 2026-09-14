import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [
  windowsConfig,
  windowsWorker,
  localDeposit,
  providerRoute,
  bridgeConfig,
  bridgeServer,
  caddyfile,
  productionCompose,
  executionOverlay,
  bundleBuilder,
  deployHelper,
  productionWorkflow,
  migration,
  privilegeGateMigration,
  packageBuilder,
] = await Promise.all([
  read('apps/windows-companion/src/config.ts'),
  read('apps/windows-companion/src/execution-worker.ts'),
  read('apps/windows-companion/src/local-kemerbet-deposit.ts'),
  read('apps/windows-companion/src/provider-route.ts'),
  read('apps/companion-device-bridge/src/config.ts'),
  read('apps/companion-device-bridge/src/server.ts'),
  read('infra/gateway/Caddyfile'),
  read('infra/compose.production.yaml'),
  read('infra/compose.production.companion-execution-v2.yaml'),
  read('infra/operations/prepare-production-companion-bundle.mjs'),
  read('infra/operations/fetanagent-production-deploy-helper.sh'),
  read('.github/workflows/production-runtime.yml'),
  read('supabase/migrations/20260914030000_agent_platform_companion_execution_bridge.sql'),
  read('supabase/migrations/20260914123000_companion_execution_privilege_gate.sql'),
  read('scripts/build-windows-companion-package.ps1'),
]);

const executionKeyId = 'companion-execution-production-v1';
const executionPublicKey =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7NAIqUp1BqgN1d5qzvSGT_WbZ1Z_LmUSAvI_eUs_OzIeaVtLMKfEzCjg9iqiLy_RQiU-4-WaY8XMtHbEkd6z0g';
const executionDigest = 'sha256:c7028976e436f39a10634631a9e0e610b2b054d78cc7c89f115d6260371d21e2';

for (const value of [executionKeyId, executionPublicKey, executionDigest]) {
  assert.match(windowsConfig, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(bundleBuilder, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
}
assert.match(windowsConfig, /executionFlag !== undefined && executionFlag !== 'true'/u);
assert.match(windowsConfig, /FETANAGENT_COMPANION_EXECUTION_PLATFORM_AGENT_ACCOUNT_ID/u);
assert.match(windowsWorker, /consumeWindowsCompanionExecutionV2AuthorityOnce/u);
assert.match(windowsWorker, /recheckOneUseActionAuthorityDeadlineAfterAtomicConsumption/u);
assert.match(windowsWorker, /signed_result_recorded_reconciliation_required/u);
assert.match(windowsWorker, /authorityRequestStarted = true;[\s\S]*?postTimed/u);
assert.match(localDeposit, /const EXACT_AMOUNT_TEXT = '25\.00'/u);
assert.match(localDeposit, /await amount\.fill\(EXACT_AMOUNT_TEXT/u);
assert.match(localDeposit, /await notes\.fill\(''/u);
assert.match(localDeposit, /await transfer\.click\(\{ timeout: TIMEOUT_MS \}\)/u);
assert.match(providerRoute, /maxRedirects: 0/u);
assert.match(providerRoute, /maxRetries: 0/u);

assert.match(bridgeConfig, /INTERNAL_COMPANION_EXECUTION_V2_ENABLED/u);
assert.match(bridgeConfig, /serverProviderActionAllowed !== false/u);
assert.match(bridgeConfig, /serverMoneyMovementAllowed !== false/u);
assert.match(bridgeConfig, /record\.executionSignerKeyId !== 'companion-execution-production-v1'/u);
for (const path of [
  '/v2/companion/device/execution-assignments:poll',
  '/v2/companion/device/execution-authorities:consume',
  '/v2/companion/device/execution-results:submit',
  '/v2/companion/device/execution-status:query',
]) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  assert.match(caddyfile, new RegExp(escaped, 'u'));
}
for (const constant of [
  'COMPANION_EXECUTION_POLL_PATH',
  'COMPANION_EXECUTION_AUTHORITY_PATH',
  'COMPANION_EXECUTION_RESULT_PATH',
  'COMPANION_EXECUTION_STATUS_PATH',
]) {
  assert.match(bridgeServer, new RegExp(`path !== ${constant}`, 'u'));
}

const baseBridge = /  production-companion-device-bridge:([\s\S]*?)\n  gateway:/u.exec(
  productionCompose,
)?.[1];
assert.ok(baseBridge);
assert.doesNotMatch(baseBridge, /INTERNAL_COMPANION_EXECUTION_V2_ENABLED/u);
assert.doesNotMatch(baseBridge, /companion_execution_signer/u);
assert.match(executionOverlay, /INTERNAL_COMPANION_EXECUTION_V2_ENABLED: 'true'/u);
assert.match(
  executionOverlay,
  /file: \/etc\/fetanagent\/companion-execution-secrets\/production-execution-signer\.pkcs8\.der/u,
);
assert.match(executionOverlay, /companion-bridge-runtime-manifest\.v3\.json/u);
assert.doesNotMatch(
  executionOverlay.replace(/^#.*$/gmu, ''),
  /KEMERBET|credential|service_role|SUPABASE_SERVICE_ROLE/iu,
);

assert.match(bundleBuilder, /contractVersion: 3/u);
assert.match(bundleBuilder, /executionTransportAllowed: true/u);
assert.match(bundleBuilder, /serverProviderActionAllowed: false/u);
assert.match(bundleBuilder, /serverMoneyMovementAllowed: false/u);
assert.match(bundleBuilder, /companion-bridge-runtime-manifest\.v3\.json/u);
assert.match(productionWorkflow, /compose\.production\.companion-execution-v2\.yaml/u);
assert.match(productionWorkflow, /companion-bridge-runtime-manifest\.v3\.json/u);
assert.match(deployHelper, /COMPANION_EXECUTION_V2_MARKER/u);
assert.match(deployHelper, /companion_execution_v2_enabled_for_release/u);
assert.match(
  deployHelper,
  /compose_files\+=\(--file "\$release\/compose\.production\.companion-execution-v2\.yaml"\)/u,
);

assert.match(migration, /create table app\.agent_platform_companion_execution_control/u);
assert.match(
  migration,
  /create function app\.claim_agent_platform_companion_execution_assignment/u,
);
assert.match(migration, /create function app\.claim_agent_platform_companion_execution_authority/u);
assert.match(migration, /create function app\.accept_agent_platform_companion_execution_result/u);
assert.match(migration, /create function app\.claim_agent_platform_companion_execution_status/u);
assert.doesNotMatch(
  migration,
  /create(?: or replace)? function app\.[^(]*(?:activate|enable)[^(]*companion[^\n]*execution/iu,
);
assert.match(migration, /control_state text not null default 'disabled'/u);
assert.match(migration, /this migration exposes no procedure that can arm it/iu);
assert.match(
  privilegeGateMigration,
  /create role fetanagent_companion_execution_bridge[\s\S]*?nologin/iu,
);
assert.match(
  privilegeGateMigration,
  /from[\s\S]*?fetanagent_companion_device_bridge[\s\S]*?fetanagent_companion_device_bridge_runtime[\s\S]*?fetanagent_companion_execution_bridge/iu,
);
assert.match(privilegeGateMigration, /to fetanagent_companion_execution_bridge/iu);
assert.doesNotMatch(
  privilegeGateMigration,
  /grant fetanagent_companion_execution_bridge\s+to\s+fetanagent_companion_device_bridge_runtime/iu,
);
assert.match(packageBuilder, /packages\/agent-platform-companion-execution-contracts/u);

console.log(
  'Companion execution-v2 deployment remains explicit, signer-pinned, and inert by default.',
);
