import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [
  compose,
  dockerfile,
  caddyfile,
  stagingCompose,
  pairingMigration,
  lookupMigration,
  packageManifest,
  workflow,
  signerProvision,
  runtimeEnableContinuous,
  runtimeDisable,
  inspection,
  secretProvisioner,
  deploymentWorkflow,
  deploymentHelper,
  deploymentInstaller,
  databasePreflight,
  postgresRuntime,
  lookupHandler,
  lookupWorker,
  windowsLauncher,
  windowsPairingDialog,
  windowsPackageBuilder,
] = await Promise.all([
  readFile(new URL('infra/compose.companion-device-pairing.yaml', root), 'utf8'),
  readFile(new URL('Dockerfile', root), 'utf8'),
  readFile(new URL('infra/gateway/Caddyfile', root), 'utf8'),
  readFile(new URL('infra/compose.staging-beta.yaml', root), 'utf8'),
  readFile(
    new URL('supabase/migrations/20260904174500_agent_platform_companion_pairing.sql', root),
    'utf8',
  ),
  readFile(
    new URL(
      'supabase/migrations/20260905010000_agent_platform_companion_exact_five_lookup.sql',
      root,
    ),
    'utf8',
  ),
  readFile(new URL('apps/companion-device-bridge/package.json', root), 'utf8'),
  readFile(new URL('.github/workflows/staging-companion-device-pairing.yml', root), 'utf8'),
  readFile(new URL('infra/sql/staging-companion-server-signer-provision.sql', root), 'utf8'),
  readFile(
    new URL('infra/sql/staging-companion-bridge-runtime-enable-continuous.sql', root),
    'utf8',
  ),
  readFile(new URL('infra/sql/staging-companion-bridge-runtime-disable.sql', root), 'utf8'),
  readFile(new URL('infra/sql/staging-companion-pairing-inspect.sql', root), 'utf8'),
  readFile(new URL('infra/operations/provision-companion-operational-secrets.ps1', root), 'utf8'),
  readFile(new URL('.github/workflows/staging-companion-device-pairing-deploy.yml', root), 'utf8'),
  readFile(new URL('infra/operations/fetanagent-companion-device-pairing-helper.sh', root), 'utf8'),
  readFile(
    new URL('infra/operations/install-fetanagent-companion-device-pairing-helper.sh', root),
    'utf8',
  ),
  readFile(new URL('apps/companion-device-bridge/src/database-preflight-cli.ts', root), 'utf8'),
  readFile(new URL('apps/companion-device-bridge/src/postgres-runtime.ts', root), 'utf8'),
  readFile(new URL('apps/companion-device-bridge/src/lookup-handler.ts', root), 'utf8'),
  readFile(new URL('apps/windows-companion/src/lookup-worker.ts', root), 'utf8'),
  readFile(new URL('apps/windows-companion/release/Start FetanAgent Companion.vbs', root), 'utf8'),
  readFile(
    new URL('apps/windows-companion/release/Enter FetanAgent Pairing Package.ps1', root),
    'utf8',
  ),
  readFile(new URL('scripts/build-windows-companion-package.ps1', root), 'utf8'),
]);

assert.match(compose, /^name: fetanagent-companion-device-pairing$/mu);
assert.equal([...compose.matchAll(/^    profiles: \[companion-device-pairing\]$/gmu)].length, 1);
assert.match(compose, /target: companion-device-bridge/u);
assert.match(compose, /user: '10001:10001'/u);
assert.match(compose, /read_only: true/u);
assert.match(compose, /cap_drop:\s*\r?\n\s*- ALL/u);
assert.match(compose, /no-new-privileges:true/u);
assert.match(compose, /restart: unless-stopped/u);
assert.doesNotMatch(compose, /^    ports:/mu);
assert.match(
  compose,
  /COMPANION_DEVICE_BRIDGE_DATABASE_URL_FILE: \/run\/secrets\/companion_device_bridge_database_url/u,
);
assert.match(
  compose,
  /COMPANION_DEVICE_BRIDGE_SIGNER_PRIVATE_KEY_FILE: \/run\/secrets\/companion_device_bridge_server_signer\.pkcs8\.der/u,
);
assert.match(
  compose,
  /COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE: \/run\/configs\/companion_device_bridge_runtime_manifest\.v2\.json/u,
);
assert.match(compose, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/u);
assert.match(compose, /FINANCIAL_ACTIONS_MODE: dry_run/u);
assert.match(compose, /COMPANION_DEVICE_BRIDGE_NO_MONEY_READ_ONLY_LOOKUP_ENABLED: 'true'/u);
assert.doesNotMatch(compose, /^\s+(?:uid|gid|mode):/mu);
assert.match(compose, /internal: false/u);
assert.match(compose, /external: true\s*\r?\n\s*name: fetanagent-companion-device-ingress/u);
assert.match(compose, /host:'127\.0\.0\.1',port:8085/u);
for (const forbidden of [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
  'OWNER_CONTROL_DATABASE_URL',
  'KEMERBET_EXECUTOR_DATABASE_URL',
  'TELEGRAM_BOT_TOKEN',
]) {
  assert.doesNotMatch(compose, new RegExp(forbidden, 'u'));
}

assert.match(dockerfile, /FROM build-base AS companion-device-bridge-build/u);
assert.match(dockerfile, /pnpm --filter @fetanagent\/companion-device-bridge\.\.\. run build/u);
assert.match(dockerfile, /FROM runtime-base AS companion-device-bridge/u);
assert.match(dockerfile, /CMD \["node", "apps\/companion-device-bridge\/dist\/main\.js"\]/u);

const companionMatcher = /@companion_device_bridge \{([\s\S]*?)\n\t\}/u.exec(caddyfile)?.[1];
assert.ok(companionMatcher);
assert.match(companionMatcher, /method POST/u);
assert.match(companionMatcher, /path \/v1\/companion\/device\/enrollments:pair/u);
assert.match(companionMatcher, /\/v1\/companion\/device\/lookup-assignments:poll/u);
assert.match(companionMatcher, /\/v1\/companion\/device\/lookup-results:submit/u);
assert.match(
  companionMatcher,
  /header Content-Type application\/vnd\.fetanagent\.companion-device-bridge\+json/u,
);
assert.match(
  companionMatcher,
  /header Accept application\/vnd\.fetanagent\.companion-device-bridge\+json/u,
);
assert.doesNotMatch(companionMatcher, /amount|transfer|settlement|execute/iu);
assert.match(caddyfile, /max_size 64KiB/u);
assert.match(caddyfile, /reverse_proxy companion-device-bridge:8085/u);
assert.match(stagingCompose, /- companion_device_ingress/u);
assert.match(
  stagingCompose,
  /  companion_device_ingress:\r?\n    external: true\r?\n    name: fetanagent-companion-device-ingress(?:\r?\n|$)/u,
);

assert.match(pairingMigration, /create role fetanagent_companion_device_bridge\s+nologin/u);
assert.match(pairingMigration, /create role fetanagent_companion_device_bridge_runtime\s+nologin/u);
assert.match(
  pairingMigration,
  /grant execute on function[\s\S]*?app\.claim_agent_platform_companion_pairing\([\s\S]*?app\.complete_agent_platform_companion_pairing\(text, text, text, text, jsonb\),[\s\S]*?app\.release_agent_platform_companion_pairing\(text\)[\s\S]*?to fetanagent_companion_device_bridge;/u,
);
assert.match(
  pairingMigration,
  /revoke all privileges on all tables in schema app\s+from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;/u,
);
assert.match(pairingMigration, /device_id text not null unique/u);
assert.match(pairingMigration, /device_key_id text not null unique/u);
assert.match(pairingMigration, /'moneyMovementAllowed', false/u);
assert.match(pairingMigration, /'transferAllowed', false/u);
assert.match(pairingMigration, /feature_switch\.mode not in \('disabled', 'dry_run'\)/u);
assert.match(pairingMigration, /role\.rolvaliduntil = 'infinity'::timestamptz/u);
assert.doesNotMatch(pairingMigration, /2026-09-04|interval '24 hours'/u);

assert.match(lookupMigration, /create table app\.agent_platform_companion_lookup_assignments/u);
assert.match(lookupMigration, /create table app\.agent_platform_companion_lookup_members/u);
assert.match(lookupMigration, /requires exactly five immutable members/u);
assert.match(lookupMigration, /force row level security/u);
assert.match(lookupMigration, /issue_agent_platform_companion_exact_five_lookup/u);
assert.match(lookupMigration, /claim_agent_platform_companion_lookup_assignment/u);
assert.match(lookupMigration, /accept_agent_platform_companion_lookup_result/u);
assert.match(lookupMigration, /require_private_owner_kemerbet_readiness_safe_boundary/u);
assert.match(lookupMigration, /p_assessed_at < now_at - interval '30 seconds'/u);
assert.match(lookupMigration, /'financialActionAllowed', false/u);
assert.match(lookupMigration, /'moneyMovementAllowed', false/u);
assert.doesNotMatch(lookupMigration, /2026-09-04|interval '24 hours'/u);

const parsedManifest = JSON.parse(packageManifest);
assert.equal(parsedManifest.scripts.start, 'node dist/main.js');
assert.equal(parsedManifest.dependencies.pg, '8.22.0');

assert.match(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/u);
assert.match(workflow, /provision-companion-read-only-lookup-no-money/u);
assert.match(workflow, /disable-companion-read-only-runtime-no-money/u);
assert.match(workflow, /staging-companion-server-signer-provision\.sql/u);
assert.match(workflow, /staging-companion-bridge-runtime-enable-continuous\.sql/u);
assert.match(workflow, /staging-companion-bridge-runtime-disable\.sql/u);
assert.match(workflow, /staging-companion-pairing-inspect\.sql/u);
assert.match(inspection, /select count\(\*\) = 7/u);
for (const routine of [
  'claim_agent_platform_companion_lookup_assignment',
  'complete_agent_platform_companion_lookup_assignment',
  'release_agent_platform_companion_lookup_assignment',
  'accept_agent_platform_companion_lookup_result',
]) {
  assert.equal(
    (inspection.match(new RegExp(routine, 'gu')) ?? []).length,
    2,
    `the staging inspector must admit only the reviewed ${routine} function in both exact allowlists`,
  );
}
assert.match(workflow, /PGSSLMODE: verify-full/u);
assert.match(workflow, /PGUSER: postgres\.\$\{\{ env\.STAGING_PROJECT_REF \}\}/u);
assert.match(workflow, /calendarShutdown == false/u);
assert.doesNotMatch(
  workflow,
  /SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE|service_role|FINANCIAL_ACTIONS_MODE: live/u,
);

assert.match(signerProvision, /operation', 'companion_trust_only'/u);
assert.match(signerProvision, /moneyMoved', false/u);
assert.match(runtimeEnableContinuous, /valid until %L/u);
assert.match(runtimeEnableContinuous, /'infinity'/u);
assert.match(runtimeEnableContinuous, /operation', 'companion_runtime_enable_continuous'/u);
assert.match(runtimeEnableContinuous, /calendarShutdown', false/u);
assert.match(runtimeEnableContinuous, /not role\.rolinherit and not role\.rolsuper/u);
assert.doesNotMatch(runtimeEnableContinuous, /^\s*nosuperuser\s*$/mu);
assert.doesNotMatch(runtimeEnableContinuous, /interval '24 hours'|2026-09-04/u);
assert.match(runtimeDisable, /nologin/u);
assert.match(runtimeDisable, /password null/u);
assert.match(runtimeDisable, /operation', 'companion_runtime_disable'/u);
assert.match(runtimeDisable, /not role\.rolinherit and not role\.rolsuper/u);
assert.doesNotMatch(runtimeDisable, /^\s*nosuperuser\s*$/mu);
assert.match(inspection, /expected_runtime_state/u);
assert.match(inspection, /no_broader_authority/u);
assert.match(inspection, /calendarShutdown', false/u);
assert.match(
  inspection,
  /array_agg\(namespace\.nspname::text order by namespace\.nspname\)[\s\S]*?array\['app', 'public'\]::text\[\]/u,
);
assert.match(inspection, /has_schema_privilege\([\s\S]*?'USAGE'/u);
assert.match(inspection, /has_schema_privilege\([\s\S]*?'CREATE'/u);
assert.match(inspection, /has_any_column_privilege/u);
assert.match(inspection, /member\.rolname = 'postgres'/u);
assert.match(
  inspection,
  /not membership\.inherit_option\s+and not membership\.set_option\s+and membership\.admin_option/u,
);

assert.match(secretProvisioner, /COMPANION_SERVER_SIGNER_PKCS8_BASE64/u);
assert.match(secretProvisioner, /COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD/u);
assert.match(secretProvisioner, /ExportPkcs8PrivateKey/u);
assert.match(secretProvisioner, /ExportSubjectPublicKeyInfo/u);
assert.match(secretProvisioner, /RandomNumberGenerator/u);
assert.match(secretProvisioner, /Rotation requires a separate reviewed operation/u);
assert.doesNotMatch(secretProvisioner, /Write-Host|Write-Output|2026-09-04/u);

assert.match(deploymentWorkflow, /workflow_dispatch:/u);
assert.doesNotMatch(deploymentWorkflow, /pull_request:|pull_request_target:|push:|schedule:/u);
assert.match(deploymentWorkflow, /deploy-companion-read-only-lookup-no-money/u);
assert.match(deploymentWorkflow, /stop-companion-read-only-bridge-no-money/u);
assert.match(deploymentWorkflow, /--target companion-device-bridge/u);
assert.match(deploymentWorkflow, /COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD/u);
assert.match(deploymentWorkflow, /COMPANION_SERVER_SIGNER_PKCS8_BASE64/u);
assert.match(deploymentWorkflow, /fetanagent-companion-device-pairing-helper install/u);
assert.match(deploymentWorkflow, /fetanagent-companion-device-pairing-helper activate/u);
assert.match(deploymentWorkflow, /fetanagent-companion-device-pairing-helper ready/u);
assert.match(
  deploymentWorkflow,
  /printf '%s' \\\s*"postgresql:\/\/\$\{COMPANION_RUNTIME_ROLE\}:\$\{COMPANION_RUNTIME_PASSWORD\}@\$\{STAGING_DIRECT_DATABASE_HOST\}:5432\/postgres\?sslmode=verify-full"/u,
);
assert.match(deploymentWorkflow, /printf '%s' "\$SUPABASE_CA_CERTIFICATE_PEM"/u);
assert.doesNotMatch(deploymentWorkflow, /postgres\?sslmode=verify-full\\n/u);
assert.doesNotMatch(deploymentWorkflow, /printf '%s\\n' "\$SUPABASE_CA_CERTIFICATE_PEM"/u);
assert.doesNotMatch(
  deploymentWorkflow,
  /SUPABASE_SERVICE_ROLE|service_role|FINANCIAL_ACTIONS_MODE: live|2026-09-04/u,
);

assert.match(deploymentHelper, /EXPECTED_SUDO_USER='fetanagent-admin'/u);
assert.match(deploymentHelper, /STAGING_DROPLET_ID='593344964'/u);
assert.match(deploymentHelper, /STAGING_PUBLIC_IPV4='161\.35\.41\.232'/u);
assert.match(deploymentHelper, /MUTATION_LOCK="\$MUTATION_LOCK_ROOT\/mutation\.lock"/u);
assert.match(deploymentHelper, /--driver bridge --internal --attachable=false/u);
assert.match(deploymentHelper, /COMPANION_DEVICE_BRIDGE_NO_MONEY_READ_ONLY_LOOKUP_ENABLED=true/u);
assert.match(deploymentHelper, /database-preflight-cli\.js/u);
assert.match(deploymentHelper, /"\$\(stat --format='%u:%g:%a' "\$path"\)" == '10001:10001:400'/u);
assert.match(deploymentHelper, /install -o 10001 -g 10001 -m 0400/u);
assert.match(deploymentHelper, /file_stat\.st_size > 512/u);
assert.match(deploymentHelper, /re\.fullmatch\(pattern, raw\) is None/u);
assert.match(deploymentHelper, /the companion database URL is not exact canonical bytes/u);
assert.match(deploymentHelper, /the companion bridge unexpectedly publishes a host port/u);
assert.match(
  deploymentHelper,
  /NetworkSettings\.Networks\}\}\{\{println \$name\}\}\{\{end\}\}' \|\s+sed '\/\^\$\/d' \| LC_ALL=C sort/u,
);
assert.match(deploymentHelper, /SUPABASE_SERVICE_ROLE_KEY/u);
assert.match(deploymentHelper, /expected verify, install, activate, ready, stop, or discard/u);
assert.match(deploymentHelper, /installed_helper_identity/u);
assert.match(deploymentHelper, /stat -L --format='%d:%i' -- "\$0"/u);
assert.match(deploymentHelper, /the executing helper is not the installed helper/u);
assert.doesNotMatch(deploymentHelper, /"\$0" == "\$HELPER_PATH"/u);
assert.doesNotMatch(deploymentHelper, /2026-09-04/u);

const helperSha256 = createHash('sha256').update(deploymentHelper).digest('hex');
assert.match(deploymentInstaller, new RegExp(`EXPECTED_HELPER_SHA256='${helperSha256}'`, 'u'));
assert.match(
  deploymentInstaller,
  /PREVIOUS_HELPER_SHA256='1ec327191eb013d7e62d79ceed7013a273c5bd58ca04494dd4ddaac60c75a8ef'/u,
);
assert.match(deploymentInstaller, /NOPASSWD: sha256:\$digest \$TARGET \*/u);
assert.match(
  deploymentInstaller,
  /expected_sudoers\(\) \{[\s\S]*?sudoers_for_digest "\$EXPECTED_HELPER_SHA256"/u,
);
assert.match(deploymentInstaller, /install_mode='upgrade'/u);
assert.match(deploymentInstaller, /require_previous_backup_state/u);
assert.match(deploymentInstaller, /require_installed_state_for_digest "\$PREVIOUS_HELPER_SHA256"/u);
assert.match(deploymentInstaller, /mv -f -- "\$TARGET_PREVIOUS" "\$TARGET"/u);
assert.match(deploymentInstaller, /mv -f -- "\$SUDOERS_PREVIOUS" "\$SUDOERS"/u);
assert.match(
  deploymentInstaller,
  /run this installer directly in the authenticated DigitalOcean root console/u,
);
assert.match(deploymentInstaller, /visudo -cf \/etc\/sudoers/u);

assert.match(databasePreflight, /loadCompanionDeviceBridgeConfig/u);
assert.match(databasePreflight, /startCompanionDeviceBridgeApplication/u);
assert.match(databasePreflight, /function-only staging runtime configuration/u);
assert.doesNotMatch(databasePreflight, /listen\(8085|money|transfer/iu);
assert.match(postgresRuntime, /owner\.rolname = 'postgres' and defaults\.defaclnamespace = 0/u);
assert.doesNotMatch(postgresRuntime, /namespace\.oid = defaults\.defaclnamespace/u);
assert.match(postgresRuntime, /select count\(\*\) = 7/u);

assert.match(lookupHandler, /verifyKemerBetExactFiveLookupExchange/u);
assert.match(lookupHandler, /AGENT_PLATFORM_COMPANION_LOOKUP_POLL_PATH/u);
assert.match(lookupHandler, /AGENT_PLATFORM_COMPANION_LOOKUP_RESULT_PATH/u);
assert.doesNotMatch(lookupHandler, /amountMinor|enterAmount|clickTransfer/u);
assert.match(lookupWorker, /executeExactFiveLookup/u);
assert.match(lookupWorker, /windows-dpapi-current-user/u);
assert.match(lookupWorker, /moneyMoved: false/u);
assert.doesNotMatch(lookupWorker, /amountMinor|enterAmount|clickTransfer/u);

assert.match(windowsLauncher, /Enter FetanAgent Pairing Package\.ps1/u);
assert.match(windowsLauncher, /FETANAGENT_COMPANION_PAIRING_PACKAGE/u);
assert.match(windowsLauncher, /If Not fileSystem\.FileExists\(enrollmentPath\) Then/u);
assert.match(windowsLauncher, /This is not your password/u);
assert.match(windowsPairingDialog, /fetanagent-companion-pairing-v1\./u);
assert.match(windowsPairingDialog, /Player lookup, Amount, Notes, Transfer, settlement/u);
assert.match(windowsPackageBuilder, /Enter FetanAgent Pairing Package\.ps1/u);

console.log('Companion pairing and signed read-only lookup deployment contract verified.');
