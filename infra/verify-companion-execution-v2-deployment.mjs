import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const [
  executionContracts,
  windowsConfig,
  windowsEntry,
  windowsLaunchProof,
  windowsLaunchChannel,
  windowsLaunchVerifier,
  windowsHandoff,
  windowsInstallationTree,
  windowsWorker,
  localDeposit,
  providerRoute,
  bridgeConfig,
  bridgeApplication,
  bridgePostgresRuntime,
  bridgeServer,
  caddyfile,
  productionCompose,
  executionOverlay,
  bundleBuilder,
  deployHelper,
  productionWorkflow,
  migration,
  privilegeGateMigration,
  emergencyStopMigration,
  oneUseRequestMigration,
  emergencyStopOperation,
  packageBuilder,
  windowsPackageWorkflow,
  operatorReleasePreflight,
  operatorLaunchPreflight,
  operatorClaimBindingTest,
] = await Promise.all([
  read('packages/agent-platform-companion-execution-contracts/src/index.ts'),
  read('apps/windows-companion/src/config.ts'),
  read('apps/windows-companion/src/index.ts'),
  read('packages/agent-platform-companion-execution-contracts/src/launch-proof.ts'),
  read('apps/windows-companion/src/launch-proof-channel.ts'),
  read('apps/windows-companion/src/launch-proof-verify-cli.ts'),
  read('apps/windows-companion/src/execution-activation-handoff.ts'),
  read('apps/windows-companion/src/installation-tree.ts'),
  read('apps/windows-companion/src/execution-worker.ts'),
  read('apps/windows-companion/src/local-kemerbet-deposit.ts'),
  read('apps/windows-companion/src/provider-route.ts'),
  read('apps/companion-device-bridge/src/config.ts'),
  read('apps/companion-device-bridge/src/application.ts'),
  read('apps/companion-device-bridge/src/postgres-runtime.ts'),
  read('apps/companion-device-bridge/src/server.ts'),
  read('infra/gateway/Caddyfile'),
  read('infra/compose.production.yaml'),
  read('infra/compose.production.companion-execution-v2.yaml'),
  read('infra/operations/prepare-production-companion-bundle.mjs'),
  read('infra/operations/fetanagent-production-deploy-helper.sh'),
  read('.github/workflows/production-runtime.yml'),
  read('supabase/migrations/20260914030000_agent_platform_companion_execution_bridge.sql'),
  read('supabase/migrations/20260914123000_companion_execution_privilege_gate.sql'),
  read('supabase/migrations/20260926132338_companion_execution_emergency_stop.sql'),
  read('supabase/migrations/20260926124051_companion_execution_one_use_request.sql'),
  read('infra/sql/production-companion-execution-emergency-disable.sql'),
  read('scripts/build-windows-companion-package.ps1'),
  read('.github/workflows/windows-companion-package.yml'),
  read('infra/operations/verify-windows-companion-release-installation.ps1'),
  read('infra/operations/observe-windows-companion-verified-launch.ps1'),
  read('scripts/test-companion-activation-claim-binding.ps1'),
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
assert.match(windowsEntry, /loadWindowsCompanionExecutionHandoff/u);
assert.match(windowsEntry, /certificateBodyDigest: baseDevice\.certificate\.bodyDigest/u);
assert.match(windowsEntry, /if \(handoff\) \{/u);
assert.match(windowsEntry, /setTimeout\(\(\) => lookupAbort\.abort\(\), remainingHandoffMs\)/u);
assert.match(windowsEntry, /signed_handoff_or_installation_unavailable/u);
assert.match(windowsEntry, /baseDevice\.createSignedLaunchProof/u);
assert.match(windowsEntry, /deliverCompanionLaunchProof/u);
assert.match(
  windowsEntry,
  /takeCompanionLaunchProofRequest\(\s*process\.env,\s*config\.executionV2Enabled,?\s*\)/u,
);
assert.match(windowsEntry, /await deliverCompanionExecutionLaunchProofAndAwaitPermit\(/u);
assert.match(windowsEntry, /verifyWindowsCompanionInstallationTree/u);
assert.match(windowsLaunchProof, /paired-process-launch-proof:v1/u);
assert.match(windowsLaunchProof, /verify\(\s*'sha256',\s*transcript\(/u);
assert.match(windowsLaunchChannel, /fetanagent-companion-launch-/u);
assert.match(
  windowsLaunchChannel,
  /A protected local launch channel is required for guarded execution/u,
);
assert.match(windowsLaunchChannel, /FETANAGENT_GUARDED_LAUNCH_PERMIT_V1\|/u);
assert.match(windowsLaunchChannel, /received === expectedPermit/u);
assert.match(windowsLaunchChannel, /proof\.body\.challengeDigest !==/u);
assert.match(windowsLaunchVerifier, /verifyCompanionLaunchProof\(proof/u);
assert.doesNotMatch(windowsLaunchVerifier, /execution-authorities:consume|execute_deposit/iu);
assert.match(windowsEntry, /stage === 'execution_handoff' \|\| stage === 'launch_proof'/u);
assert.match(windowsEntry, /\? \{ moneyMoved: false \}/u);
assert.match(windowsHandoff, /COMPANION_EXECUTION_HANDOFF_PURPOSE/u);
assert.match(executionContracts, /export function signCompanionExecutionActivationHandoff\(/u);
assert.match(executionContracts, /signer\.publicKey\.digest !== signerDigest/u);
assert.match(executionContracts, /COMPANION_EXECUTION_MAX_ACTIVATION_HANDOFF_LIFETIME_MS/u);
assert.match(windowsHandoff, /body\.platformAgentAccountId !== context\.expectedAccountId/u);
assert.match(windowsHandoff, /body\.companionReleaseSha !== context\.releaseSha/u);
assert.match(windowsHandoff, /body\.companionInstallationTreeSha256/u);
assert.match(oneUseRequestMigration, /companion_installation_tree_sha256 text not null/u);
assert.match(oneUseRequestMigration, /existing_request\.companion_installation_tree_sha256/u);
assert.match(windowsHandoff, /verifyWindowsCompanionInstallationTree\(/u);
assert.match(windowsInstallationTree, /measureWindowsCompanionInstallationTree/u);
assert.match(windowsInstallationTree, /INSTALLATION_TREE_SHA256/u);
assert.match(packageBuilder, /installation-tree-cli\.js/u);
assert.match(packageBuilder, /extractedTreeDigest -ne \$treeDigest/u);
const packageJob = windowsPackageWorkflow.split(/^  attest:/mu)[0];
const attestJob = windowsPackageWorkflow.split(/^  attest:/mu)[1]?.split(/^  publish:/mu)[0];
assert.ok(attestJob, 'The tag-only companion attestation job is missing.');
assert.doesNotMatch(packageJob, /id-token: write/u);
assert.match(attestJob, /if: startsWith\(github\.ref, 'refs\/tags\/windows-companion-v'\)/u);
assert.match(attestJob, /id-token: write/u);
assert.match(attestJob, /attestations: write/u);
assert.match(windowsPackageWorkflow, /name: Attest immutable companion archive/u);
assert.match(windowsPackageWorkflow, /uses: actions\/attest@[0-9a-f]{40}/u);
assert.match(windowsPackageWorkflow, /needs: \[package, attest\]/u);
assert.match(windowsPackageWorkflow, /gh attestation verify "\$immutableZip"/u);
assert.match(windowsPackageWorkflow, /name: Parse read-only companion launch preflights/u);
assert.match(windowsPackageWorkflow, /name: Test activation archive claim binding/u);
assert.match(operatorClaimBindingTest, /ExpectedArchiveSha256 "sha256:\$\('0' \* 64\)"/u);
assert.match(operatorClaimBindingTest, /failed at input; no activation was performed/u);
assert.match(windowsPackageWorkflow, /--signer-workflow/u);
assert.match(windowsPackageWorkflow, /--source-ref \$env:GITHUB_REF/u);
assert.match(windowsPackageWorkflow, /--source-digest \$releaseSha/u);
assert.match(operatorReleasePreflight, /gh attestation verify "\$archive"/u);
assert.match(operatorReleasePreflight, /--signer-workflow \$workflow/u);
assert.match(operatorReleasePreflight, /--source-ref "refs\/tags\/\$ReleaseTag"/u);
assert.match(operatorReleasePreflight, /--source-digest \$ReleaseSha/u);
assert.match(
  operatorReleasePreflight,
  /\[ValidatePattern\('\^sha256:\[0-9a-f\]\{64\}\$'\)\]\s+\[string\] \$ExpectedArchiveSha256/u,
);
assert.match(
  operatorReleasePreflight,
  /\[ValidatePattern\('\^sha256:\[0-9a-f\]\{64\}\$'\)\]\s+\[string\] \$ExpectedInstallationTreeSha256/u,
);
assert.match(operatorReleasePreflight, /"sha256:\$archiveHash" -cne \$ExpectedArchiveSha256/u);
assert.match(operatorReleasePreflight, /\$treeMarker -cne \$ExpectedInstallationTreeSha256/u);
assert.match(operatorReleasePreflight, /gh release download \$ReleaseTag --repo \$repository/u);
assert.match(operatorReleasePreflight, /\$stableChecksumAsset\.digest -cne/u);
assert.match(operatorReleasePreflight, /\$tagObject\.sha -cne \$ReleaseSha/u);
assert.match(operatorReleasePreflight, /\$measuredArchiveTree -cne \$treeMarker/u);
assert.match(operatorReleasePreflight, /\$measuredInstalledTree -cne \$treeMarker/u);
assert.match(operatorReleasePreflight, /COMPANION_RELEASE_INSTALLATION_VERIFIED/u);
assert.doesNotMatch(operatorReleasePreflight, /KEMERBET|execution-authorities:consume/iu);
assert.match(operatorLaunchPreflight, /verify-windows-companion-release-installation\.ps1/u);
assert.match(operatorLaunchPreflight, /\[string\] \$ExpectedArchiveSha256/u);
assert.match(operatorLaunchPreflight, /\[string\] \$ExpectedInstallationTreeSha256/u);
assert.match(operatorLaunchPreflight, /-ExpectedArchiveSha256 \$ExpectedArchiveSha256/u);
assert.match(
  operatorLaunchPreflight,
  /-ExpectedInstallationTreeSha256 \$ExpectedInstallationTreeSha256/u,
);
assert.match(
  operatorLaunchPreflight,
  /\[IO\.File\]::ReadAllText\(\$treeMarker\) -cne \$ExpectedInstallationTreeSha256/u,
);
assert.match(operatorLaunchPreflight, /\$expectedTree = \$ExpectedInstallationTreeSha256/u);
assert.match(operatorLaunchPreflight, /Start-Process -FilePath \$node/u);
assert.match(operatorLaunchPreflight, /-WindowStyle Hidden/u);
assert.match(
  operatorLaunchPreflight,
  /COMPANION_VERIFIED_LAUNCH_OBSERVED; this launch did not activate execution/u,
);
assert.doesNotMatch(
  operatorLaunchPreflight,
  /Set-ManagedEnvironment 'INTERNAL_COMPANION_EXECUTION_V2_ENABLED'/u,
);
assert.doesNotMatch(operatorLaunchPreflight, /execution-authorities:consume|execute_deposit/iu);
assert.match(windowsHandoff, /verify\('sha256', transcript/u);
assert.match(windowsWorker, /consumeWindowsCompanionExecutionV2AuthorityOnce/u);
assert.match(windowsWorker, /currentTrusted\.getTime\(\) < options\.handoffExpiresAtMs/u);
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
assert.match(bridgeConfig, /COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_ROLE/u);
assert.match(bridgeConfig, /COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_URL_FILE/u);
assert.match(bridgeConfig, /executionConnectionFromUrl\(/u);
assert.match(bridgeConfig, /execution\.connection\.password === connectionWithoutCa\.password/u);
assert.match(bridgeApplication, /createCompanionExecutionPostgresRuntime/u);
assert.match(bridgeApplication, /executionState\.claimExecutionAssignment/u);
assert.doesNotMatch(bridgeApplication, /state\.claimExecutionAssignment/u);
assert.match(
  bridgePostgresRuntime,
  /const EXECUTION_ALLOWED_FUNCTIONS = \[\s*CLAIM_EXECUTION_ASSIGNMENT_FUNCTION/u,
);
assert.doesNotMatch(
  bridgePostgresRuntime,
  /const EXECUTION_ALLOWED_FUNCTIONS = \[\s*\.\.\.BASELINE_ALLOWED_FUNCTIONS/u,
);
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
assert.doesNotMatch(baseBridge, /companion_execution_database_url/u);
assert.match(executionOverlay, /INTERNAL_COMPANION_EXECUTION_V2_ENABLED: 'true'/u);
assert.match(
  executionOverlay,
  /file: \/etc\/fetanagent\/companion-execution-secrets\/production-execution-signer\.pkcs8\.der/u,
);
assert.match(executionOverlay, /companion-bridge-runtime-manifest\.v3\.json/u);
assert.match(
  executionOverlay,
  /COMPANION_DEVICE_BRIDGE_EXECUTION_DATABASE_URL_FILE: \/run\/secrets\/companion_execution_database_url/u,
);
assert.match(executionOverlay, /production-execution-database-url/u);
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
assert.match(
  emergencyStopMigration,
  /create role fetanagent_companion_execution_bridge_runtime\s+nologin/iu,
);
assert.match(
  emergencyStopMigration,
  /create function app\.disable_agent_platform_companion_execution_transport\(\)/u,
);
assert.match(emergencyStopMigration, /session_user <> 'postgres'/u);
assert.match(emergencyStopMigration, /control_state = 'disabled'/u);
assert.doesNotMatch(emergencyStopMigration, /\bgrant execute\b/iu);
assert.doesNotMatch(emergencyStopMigration, /\bgrant fetanagent_companion_execution_bridge\b/iu);
const roleRevocation = emergencyStopOperation.indexOf(
  'alter role fetanagent_companion_execution_bridge_runtime',
);
const sessionTermination = emergencyStopOperation.indexOf('pg_catalog.pg_terminate_backend');
const financialStop = emergencyStopOperation.indexOf(
  'app.request_private_trusted_telebirr_emergency_disable',
);
assert.ok(roleRevocation >= 0 && roleRevocation < sessionTermination);
assert.ok(sessionTermination < financialStop);
assert.match(
  emergencyStopOperation,
  /app\.disable_agent_platform_companion_execution_transport\(\)/u,
);
assert.match(emergencyStopOperation, /pg_catalog\.pg_advisory_unlock/u);
assert.match(emergencyStopOperation, /providerOutcomeRequiresReconciliation', true/u);
assert.doesNotMatch(emergencyStopOperation, /\b(?:insert|update)\s+app\.deposit_jobs\b/iu);
assert.match(packageBuilder, /packages\/agent-platform-companion-execution-contracts/u);

console.log(
  'Companion execution-v2 deployment remains explicit, signer-pinned, and inert by default.',
);
