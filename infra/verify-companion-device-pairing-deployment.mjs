import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [
  compose,
  dockerfile,
  caddyfile,
  stagingCompose,
  migration,
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
  /COMPANION_DEVICE_BRIDGE_RUNTIME_MANIFEST_FILE: \/run\/configs\/companion_device_bridge_runtime_manifest\.v1\.json/u,
);
assert.match(compose, /NODE_EXTRA_CA_CERTS: \/run\/configs\/supabase_ca_certificate/u);
assert.match(compose, /FINANCIAL_ACTIONS_MODE: dry_run/u);
assert.match(compose, /COMPANION_DEVICE_BRIDGE_NO_MONEY_PAIRING_ENABLED: 'true'/u);
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
assert.match(
  companionMatcher,
  /header Content-Type application\/vnd\.fetanagent\.companion-device-bridge\+json/u,
);
assert.match(
  companionMatcher,
  /header Accept application\/vnd\.fetanagent\.companion-device-bridge\+json/u,
);
assert.doesNotMatch(companionMatcher, /lookup|amount|transfer|settlement|execute/iu);
assert.match(caddyfile, /max_size 64KiB/u);
assert.match(caddyfile, /reverse_proxy companion-device-bridge:8085/u);
assert.match(stagingCompose, /- companion_device_ingress/u);
assert.match(stagingCompose, /name: fetanagent-companion-device-ingress/u);
assert.match(stagingCompose, /companion_device_ingress:[\s\S]*?internal: true/u);

assert.match(migration, /create role fetanagent_companion_device_bridge\s+nologin/u);
assert.match(migration, /create role fetanagent_companion_device_bridge_runtime\s+nologin/u);
assert.match(
  migration,
  /grant execute on function[\s\S]*?app\.claim_agent_platform_companion_pairing\([\s\S]*?app\.complete_agent_platform_companion_pairing\(text, text, text, text, jsonb\),[\s\S]*?app\.release_agent_platform_companion_pairing\(text\)[\s\S]*?to fetanagent_companion_device_bridge;/u,
);
assert.match(
  migration,
  /revoke all privileges on all tables in schema app\s+from fetanagent_companion_device_bridge, fetanagent_companion_device_bridge_runtime;/u,
);
assert.match(migration, /device_id text not null unique/u);
assert.match(migration, /device_key_id text not null unique/u);
assert.match(migration, /'moneyMovementAllowed', false/u);
assert.match(migration, /'transferAllowed', false/u);
assert.match(migration, /feature_switch\.mode not in \('disabled', 'dry_run'\)/u);
assert.match(migration, /role\.rolvaliduntil = 'infinity'::timestamptz/u);
assert.doesNotMatch(migration, /2026-09-04|interval '24 hours'/u);

const parsedManifest = JSON.parse(packageManifest);
assert.equal(parsedManifest.scripts.start, 'node dist/main.js');
assert.equal(parsedManifest.dependencies.pg, '8.22.0');

assert.match(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /pull_request:|pull_request_target:|push:|schedule:/u);
assert.match(workflow, /provision-companion-pairing-only-no-money/u);
assert.match(workflow, /disable-companion-pairing-runtime-no-money/u);
assert.match(workflow, /staging-companion-server-signer-provision\.sql/u);
assert.match(workflow, /staging-companion-bridge-runtime-enable-continuous\.sql/u);
assert.match(workflow, /staging-companion-bridge-runtime-disable\.sql/u);
assert.match(workflow, /staging-companion-pairing-inspect\.sql/u);
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
assert.match(deploymentWorkflow, /deploy-companion-pairing-only-no-money/u);
assert.match(deploymentWorkflow, /stop-companion-pairing-bridge-no-money/u);
assert.match(deploymentWorkflow, /--target companion-device-bridge/u);
assert.match(deploymentWorkflow, /COMPANION_DEVICE_BRIDGE_RUNTIME_PASSWORD/u);
assert.match(deploymentWorkflow, /COMPANION_SERVER_SIGNER_PKCS8_BASE64/u);
assert.match(deploymentWorkflow, /fetanagent-companion-device-pairing-helper install/u);
assert.match(deploymentWorkflow, /fetanagent-companion-device-pairing-helper activate/u);
assert.match(deploymentWorkflow, /fetanagent-companion-device-pairing-helper ready/u);
assert.doesNotMatch(
  deploymentWorkflow,
  /SUPABASE_SERVICE_ROLE|service_role|FINANCIAL_ACTIONS_MODE: live|2026-09-04/u,
);

assert.match(deploymentHelper, /EXPECTED_SUDO_USER='fetanagent-admin'/u);
assert.match(deploymentHelper, /STAGING_DROPLET_ID='593344964'/u);
assert.match(deploymentHelper, /STAGING_PUBLIC_IPV4='161\.35\.41\.232'/u);
assert.match(deploymentHelper, /MUTATION_LOCK="\$MUTATION_LOCK_ROOT\/mutation\.lock"/u);
assert.match(deploymentHelper, /--driver bridge --internal --attachable=false/u);
assert.match(deploymentHelper, /COMPANION_DEVICE_BRIDGE_NO_MONEY_PAIRING_ENABLED=true/u);
assert.match(deploymentHelper, /database-preflight-cli\.js/u);
assert.match(deploymentHelper, /the companion bridge unexpectedly publishes a host port/u);
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
  /PREVIOUS_HELPER_SHA256='b541bed882ed3a9209caeb9aea9829d4436d508b2975e317c1f9f9323d05d5a3'/u,
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

assert.match(windowsLauncher, /Enter FetanAgent Pairing Package\.ps1/u);
assert.match(windowsLauncher, /FETANAGENT_COMPANION_PAIRING_PACKAGE/u);
assert.match(windowsLauncher, /If Not fileSystem\.FileExists\(enrollmentPath\) Then/u);
assert.match(windowsLauncher, /This is not your password/u);
assert.match(windowsPairingDialog, /fetanagent-companion-pairing-v1\./u);
assert.match(windowsPairingDialog, /Player lookup, Amount, Notes, Transfer, settlement/u);
assert.match(windowsPackageBuilder, /Enter FetanAgent Pairing Package\.ps1/u);

console.log('Companion device pairing deployment contract verified.');
