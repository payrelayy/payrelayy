import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const run = promisify(execFile);

const [
  protocol,
  windowsConfig,
  windowsEntry,
  windowsLaunchChannel,
  windowsLauncher,
  windowsStore,
  localDeposit,
  worker,
  bridgeConfig,
  bridgeApplication,
  bridgeHandler,
  bridgeRuntime,
  bridgeServer,
  caddyfile,
  productionCompose,
  routineOverlay,
  deployHelper,
  productionWorkflow,
  qualityWorkflow,
  migration,
  activateSql,
  disableSql,
  packageBuilder,
  localPreparation,
  releaseLauncher,
] = await Promise.all([
  read('packages/agent-platform-companion-execution-contracts/src/routine-deposit.ts'),
  read('apps/windows-companion/src/config.ts'),
  read('apps/windows-companion/src/index.ts'),
  read('apps/windows-companion/src/launch-proof-channel.ts'),
  read('apps/windows-companion/src/routine-deposit-launcher-cli.ts'),
  read('apps/windows-companion/src/routine-deposit-http-store.ts'),
  read('apps/windows-companion/src/local-kemerbet-deposit.ts'),
  read('apps/windows-companion/src/routine-deposit-worker.ts'),
  read('apps/companion-device-bridge/src/config.ts'),
  read('apps/companion-device-bridge/src/application.ts'),
  read('apps/companion-device-bridge/src/routine-deposit-handler.ts'),
  read('apps/companion-device-bridge/src/routine-postgres-runtime.ts'),
  read('apps/companion-device-bridge/src/server.ts'),
  read('infra/gateway/Caddyfile'),
  read('infra/compose.production.yaml'),
  read('infra/compose.production.routine-deposits.yaml'),
  read('infra/operations/fetanagent-production-deploy-helper.sh'),
  read('.github/workflows/production-runtime.yml'),
  read('.github/workflows/quality.yml'),
  read('supabase/migrations/20261005090000_routine_telebirr_execution_broker.sql'),
  read('infra/sql/production-routine-deposit-activate.sql'),
  read('infra/sql/production-routine-deposit-disable.sql'),
  read('scripts/build-windows-companion-package.ps1'),
  read('infra/operations/prepare-windows-companion-routine-local.ps1'),
  read('apps/windows-companion/release/Start FetanAgent Automatic Deposits.ps1'),
]);

const route = '/v3/companion/device/routine-deposits:command';
const mode = 'windows_companion_routine_deposit_execution_v1';
const capability = 'kemerbet.deposit.submit.verified_receipt_amount.routine.v1';
for (const source of [protocol, migration]) {
  assert.match(source, new RegExp(mode, 'u'));
  assert.match(source, new RegExp(capability.replaceAll('.', '\\.'), 'u'));
}
// PostgreSQL 17 gives a non-superuser CREATEROLE creator ADMIN on each new role.
// A redundant self-grant broke the first managed-production broker migration.
assert.doesNotMatch(migration, /grant\s+fetanagent_routine_deposit_broker\s+to\s+postgres\b/iu);
assert.match(windowsStore, /ROUTINE_DEPOSIT_PROTOCOL_MODE/u);
assert.match(windowsStore, /ROUTINE_DEPOSIT_CAPABILITY/u);
assert.match(bridgeHandler, /decodeRoutineDepositCommand/u);
assert.match(bridgeHandler, /protocolMode: ROUTINE_DEPOSIT_PROTOCOL_MODE/u);
for (const source of [protocol, caddyfile]) {
  assert.match(source, new RegExp(route, 'u'));
}
for (const source of [windowsStore, bridgeApplication, bridgeServer]) {
  assert.match(source, /ROUTINE_DEPOSIT_COMMAND_PATH/u);
}
assert.doesNotMatch(protocol, /deposit\.submit\.25etb\.v2/u);

assert.match(windowsConfig, /executionV2Enabled && routineDepositsEnabled/u);
assert.match(windowsConfig, /financial execution modes are mutually exclusive/u);
assert.match(windowsEntry, /deliverCompanionRoutineLaunchProofAndAwaitPermit/u);
assert.match(windowsEntry, /createRoutineDepositHttpStore/u);
assert.match(windowsEntry, /startRoutineDepositQueue/u);
assert.match(windowsEntry, /process\.once\('disconnect', onParentDisconnect\)/u);
assert.match(windowsLaunchChannel, /FETANAGENT_ROUTINE_LAUNCH_PERMIT_V1\|/u);
assert.match(windowsLaunchChannel, /FETANAGENT_ROUTINE_LAUNCH_PERMIT_ACK_V1\|/u);
assert.match(windowsLauncher, /verifyWindowsCompanionInstallationTree/u);
assert.match(windowsLauncher, /verifyCompanionLaunchProof/u);
assert.match(windowsLauncher, /startedAtMs < childStartedAt/u);
assert.match(windowsLauncher, /INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: 'true'/u);
assert.match(windowsLauncher, /stdio: \['ignore', 'inherit', 'inherit', 'ipc'\]/u);
assert.match(windowsStore, /verifySignedRoutineDepositResponse/u);
assert.match(windowsStore, /redirect: 'error'/u);
assert.match(windowsStore, /It never retries a command/u);

assert.match(localDeposit, /Transfer Successful!/u);
assert.match(
  localDeposit,
  /Player Balance \+\$\{routineDepositAmountText\(amountMinor\)\} ETB Success/u,
);
assert.match(localDeposit, /exactPlayerCreditMatch: true/u);
assert.match(worker, /dispatch\.exactPlayerCreditMatch !== true/u);
assert.match(worker, /await options\.store\.completeConfirmed/u);

assert.match(bridgeConfig, /COMPANION_ROUTINE_DEPOSIT_DATABASE_ROLE/u);
assert.match(bridgeConfig, /COMPANION_ROUTINE_DEPOSIT_DATABASE_URL_FILE/u);
assert.match(bridgeConfig, /executionEnabled && routineEnabled/u);
assert.match(bridgeHandler, /noMoneySigner/u);
assert.match(bridgeHandler, /executionSigner/u);
assert.match(bridgeHandler, /createDormantRoutineDepositHandler/u);
assert.match(bridgeRuntime, /max: 1/u);
assert.match(bridgeRuntime, /current_user = 'fetanagent_routine_deposit_broker_runtime'/u);
assert.match(bridgeRuntime, /count\(\*\) = 1/u);
assert.match(bridgeRuntime, /not membership\.set_option/u);
assert.match(bridgeRuntime, /no_app_relation_privileges/u);

assert.doesNotMatch(productionCompose, /INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED/u);
assert.match(routineOverlay, /INTERNAL_COMPANION_ROUTINE_DEPOSITS_ENABLED: 'true'/u);
assert.match(routineOverlay, /companion_routine_deposit_database_url/u);
assert.match(routineOverlay, /companion-bridge-runtime-manifest\.v3\.json/u);
assert.match(deployHelper, /ROUTINE_DEPOSITS_MARKER/u);
assert.match(deployHelper, /routine_deposits_enabled_for_release/u);
assert.match(deployHelper, /routine-deposit markers cannot coexist/u);
assert.match(deployHelper, /compose\.production\.routine-deposits\.yaml/u);
assert.match(deployHelper, /production-routine-deposit-database-url/u);
assert.match(deployHelper, /routine_status=503/u);
assert.match(productionWorkflow, /infra\/compose\.production\.routine-deposits\.yaml/u);
assert.match(qualityWorkflow, /pnpm verify:routine-deposits/u);
assert.match(packageBuilder, /Start FetanAgent Automatic Deposits\.ps1/u);
assert.match(packageBuilder, /routine-deposit-launcher-cli\.js/u);
assert.match(localPreparation, /-CheckOnly -CheckDataRoot/u);
assert.match(releaseLauncher, /routine-deposit-launch\.json/u);
assert.match(releaseLauncher, /if \(\$CheckOnly\)/u);
assert.match(releaseLauncher, /'NODE_OPTIONS'/u);
assert.match(releaseLauncher, /\$document -cne \$canonicalDocument/u);

assert.match(migration, /create role fetanagent_routine_deposit_broker\s+\n?\s*nologin/iu);
assert.match(migration, /create role fetanagent_routine_deposit_broker_runtime\s+\n?\s*nologin/iu);
assert.match(migration, /session_user <> 'postgres'/u);
assert.match(migration, /create function app\.execute_agent_platform_routine_deposit_command/u);
assert.match(migration, /approved_history_match_count = 1/u);
assert.match(migration, /exact_player_credit_match/u);
assert.match(
  migration,
  /grant execute on function app\.execute_agent_platform_routine_deposit_command/u,
);
assert.doesNotMatch(
  migration,
  /grant execute on function app\.activate_routine_telebirr_execution_transport/iu,
);
assert.match(activateSql, /current_user = 'postgres' and session_user = 'postgres'/u);
const nonpilotStopGate = activateSql.indexOf('nonpilot_lineage_not_ready');
const activationInputs = activateSql.indexOf('\\getenv confirmed_project_ref');
const activationCall = activateSql.indexOf('app.activate_routine_telebirr_execution_transport');
assert.ok(nonpilotStopGate >= 0 && activationInputs > nonpilotStopGate);
assert.ok(activationCall > activationInputs);
assert.match(activateSql, /^\\set ON_ERROR_STOP on/mu);
assert.match(activateSql, /select 1 \/ 0 as nonpilot_lineage_not_ready/u);
assert.match(activateSql, /livePaymentPerformed', false/u);
const disableRole = disableSql.indexOf('app.disable_routine_telebirr_execution_transport');
const terminateSession = disableSql.indexOf('pg_catalog.pg_terminate_backend');
assert.ok(disableRole >= 0 && disableRole < terminateSession);
assert.match(disableSql, /providerOutcomeRequiresReconciliation', true/u);

const generator = fileURLToPath(
  new URL('infra/operations/create-production-routine-deposit-runtime-credential.mjs', root),
);
const temporary = await mkdtemp(join(tmpdir(), 'fetanagent-routine-credential-'));
try {
  const databaseUrlPath = join(temporary, 'database-url');
  const activationPasswordPath = join(temporary, 'activation-password');
  await run(process.execPath, [
    generator,
    '--database-url-output',
    databaseUrlPath,
    '--activation-password-output',
    activationPasswordPath,
  ]);
  const [databaseUrl, activationPassword] = await Promise.all([
    readFile(databaseUrlPath, 'utf8'),
    readFile(activationPasswordPath, 'utf8'),
  ]);
  assert.match(activationPassword, /^[0-9a-f]{64}$/u);
  assert.match(
    databaseUrl,
    /^postgresql:\/\/fetanagent_routine_deposit_broker_runtime\.xzztugbgtulptnbpoelr:[0-9a-f]{64}@aws-0-eu-west-1\.pooler\.supabase\.com:5432\/postgres\?sslmode=verify-full$/u,
  );
  assert.ok(databaseUrl.includes(`:${activationPassword}@`));
  if (process.platform !== 'win32') {
    assert.equal((await stat(databaseUrlPath)).mode & 0o777, 0o600);
    assert.equal((await stat(activationPasswordPath)).mode & 0o777, 0o600);
  }

  const preservedDatabaseUrl = join(temporary, 'preserved-database-url');
  const absentPassword = join(temporary, 'must-remain-absent');
  await writeFile(preservedDatabaseUrl, 'preserve-existing-database-url', { flag: 'wx' });
  await assert.rejects(
    run(process.execPath, [
      generator,
      '--database-url-output',
      preservedDatabaseUrl,
      '--activation-password-output',
      absentPassword,
    ]),
  );
  assert.equal(await readFile(preservedDatabaseUrl, 'utf8'), 'preserve-existing-database-url');
  await assert.rejects(access(absentPassword));

  const removedPartialDatabaseUrl = join(temporary, 'removed-partial-database-url');
  const preservedPassword = join(temporary, 'preserved-password');
  await writeFile(preservedPassword, 'preserve-existing-password', { flag: 'wx' });
  await assert.rejects(
    run(process.execPath, [
      generator,
      '--database-url-output',
      removedPartialDatabaseUrl,
      '--activation-password-output',
      preservedPassword,
    ]),
  );
  await assert.rejects(access(removedPartialDatabaseUrl));
  assert.equal(await readFile(preservedPassword, 'utf8'), 'preserve-existing-password');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log(
  'Routine deposits are separately gated, proof-bound, replay-safe, and dormant until explicit activation.',
);
