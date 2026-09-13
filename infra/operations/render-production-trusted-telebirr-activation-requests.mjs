import { open, readFile, rm } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID}$`, 'u');
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SCRAM_PATTERN =
  /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/u;

function fail(message) {
  throw new Error(`production trusted TeleBirr activation request: ${message}`);
}

function requiredUuid(name, value, pattern = UUID_PATTERN) {
  if (!pattern.test(value ?? '')) fail(`${name} must be one exact lowercase UUID`);
  return value;
}

function requiredPath(value) {
  if (value === undefined || value === '' || !isAbsolute(value)) {
    fail('every file path must be absolute');
  }
  return resolve(value);
}

if (
  process.argv.length !== 12 ||
  process.argv[2] !== '--owner-auth-user-id' ||
  process.argv[4] !== '--pilot-revision-id' ||
  process.argv[6] !== '--request-key' ||
  process.argv[8] !== '--scram-file' ||
  process.argv[10] !== '--output-directory'
) {
  fail('expected exact Owner, pilot, request, SCRAM-file, and output-directory arguments');
}

const ownerAuthUserId = requiredUuid('Owner auth user ID', process.argv[3]);
const pilotRevisionId = requiredUuid('pilot revision ID', process.argv[5]);
const requestKey = requiredUuid('request key', process.argv[7], UUID_V4_PATTERN);
const scramFile = requiredPath(process.argv[9]);
const outputDirectory = requiredPath(process.argv[11]);
const activationOutput = resolve(outputDirectory, 'activation-request.json');
const inspectionOutput = resolve(outputDirectory, 'active-inspection-request.json');
if (activationOutput === scramFile || inspectionOutput === scramFile) {
  fail('the SCRAM input must be distinct from request outputs');
}

const scramVerifier = await readFile(scramFile, 'utf8');
if (!SCRAM_PATTERN.test(scramVerifier)) fail('the SCRAM verifier is malformed');

const activationSql = `begin transaction isolation level serializable;
set local search_path = pg_catalog;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '15s';
do $fetanagent_activate_trusted_telebirr_verification$
begin
  perform app.activate_private_trusted_telebirr_verification(
    '${ownerAuthUserId}'::uuid,
    '${pilotRevisionId}'::uuid,
    '${requestKey}'::uuid,
    '${scramVerifier}'::text
  );
end;
$fetanagent_activate_trusted_telebirr_verification$;
commit;
select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'trusted_telebirr_verification_activation',
  'deploymentTarget', 'production',
  'requestKey', activation_request.request_key,
  'pilotRevisionId', activation_request.pilot_revision_id,
  'activationEpoch', activation_request.activation_epoch,
  'verifierValidUntil', activation_request.verifier_valid_until,
  'currentActivationEpoch', activation_control.current_epoch,
  'executorLogin', case when exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
       and role.rolcanlogin
  ) then 'unsafe' else 'disabled' end,
  'withdrawals', case when (
    select pg_catalog.count(*) from app.feature_switches feature_switch
     where feature_switch.feature_key in ('withdrawal_validation', 'withdrawal_collection')
       and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb
  ) = 2 then 'disabled' else 'unsafe' end
) as result
from app.private_trusted_telebirr_activation_requests activation_request
join app.private_trusted_telebirr_activation_control activation_control
  on activation_control.control_key = 'trusted_telebirr_financial_authority'
where activation_request.request_key = '${requestKey}'::uuid
  and activation_request.pilot_revision_id = '${pilotRevisionId}'::uuid
  and activation_control.current_epoch = activation_request.activation_epoch;
`;

const inspectionSql = `select pg_catalog.jsonb_build_object(
  'schemaVersion', 1,
  'operation', 'trusted_telebirr_verification_active_inspect',
  'deploymentTarget', 'production',
  'requestKey', activation_request.request_key,
  'pilotRevisionId', activation_request.pilot_revision_id,
  'activationEpoch', activation_request.activation_epoch,
  'verifierValidUntil', activation_request.verifier_valid_until,
  'authority', case when
    activation_epoch.authority_state = 'active'
    and activation_epoch.revoked_at is null
    and activation_epoch.expires_at > pg_catalog.clock_timestamp() + interval '5 minutes'
    and activation_control.current_epoch = activation_epoch.epoch
    and app.current_private_trusted_telebirr_activation_epoch() = activation_epoch.epoch
    then 'active' else 'unsafe' end,
  'verifierLogin', case when exists (
    select 1 from pg_catalog.pg_authid role
     where role.rolname = 'fetanagent_trusted_telebirr_verifier_runtime'
       and role.rolcanlogin and not role.rolinherit and not role.rolsuper
       and not role.rolcreatedb and not role.rolcreaterole
       and not role.rolreplication and not role.rolbypassrls
       and role.rolconnlimit = 1
       and role.rolvaliduntil is not distinct from activation_request.verifier_valid_until
       and role.rolpassword like 'SCRAM-SHA-256$4096:%'
  ) then 'bounded' else 'unsafe' end,
  'activeVerifierSessions', (
    select pg_catalog.count(*) from pg_catalog.pg_stat_activity activity
     where activity.usename = 'fetanagent_trusted_telebirr_verifier_runtime'
       and activity.application_name = 'fetanagent_trusted_telebirr_verifier'
       and activity.pid <> pg_catalog.pg_backend_pid()
  ),
  'unexpectedVerifierSessions', (
    select pg_catalog.count(*) from pg_catalog.pg_stat_activity activity
     where activity.usename in (
       'fetanagent_trusted_telebirr_verifier',
       'fetanagent_trusted_telebirr_verifier_runtime'
     )
       and activity.pid <> pg_catalog.pg_backend_pid()
       and not (
         activity.usename = 'fetanagent_trusted_telebirr_verifier_runtime'
         and activity.application_name = 'fetanagent_trusted_telebirr_verifier'
       )
  ),
  'executorLogin', case when exists (
    select 1 from pg_catalog.pg_roles role
     where role.rolname in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
       and role.rolcanlogin
  ) or exists (
    select 1 from pg_catalog.pg_stat_activity activity
     where activity.usename in ('fetanagent_deposit_executor', 'fetanagent_deposit_executor_runtime')
       and activity.pid <> pg_catalog.pg_backend_pid()
  ) then 'unsafe' else 'disabled' end,
  'switchBoundary', case when
    (select pg_catalog.count(*) from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'payment_verification', 'deposit_execution',
        'telebirr_authoritative_verification', 'private_live_deposit_pilot'
      ) and feature_switch.mode = 'live') = 4
    and (select pg_catalog.count(*) from app.feature_switches feature_switch
      where feature_switch.feature_key in (
        'withdrawal_validation', 'withdrawal_collection',
        'cbe_birr_authoritative_verification'
      ) and feature_switch.mode = 'disabled' and feature_switch.settings = '{}'::jsonb) = 3
    then 'live_verification' else 'unsafe' end
) as result
from app.private_trusted_telebirr_activation_requests activation_request
join app.private_trusted_telebirr_activation_epochs activation_epoch
  on activation_epoch.epoch = activation_request.activation_epoch
join app.private_trusted_telebirr_activation_control activation_control
  on activation_control.control_key = 'trusted_telebirr_financial_authority'
where activation_request.request_key = '${requestKey}'::uuid
  and activation_request.pilot_revision_id = '${pilotRevisionId}'::uuid;
`;

const outputs = [activationOutput, inspectionOutput];
const handles = [];
try {
  for (const [path, query] of [
    [activationOutput, activationSql],
    [inspectionOutput, inspectionSql],
  ]) {
    const handle = await open(path, 'wx', 0o600);
    handles.push(handle);
    await handle.writeFile(JSON.stringify({ query }), { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handles.pop();
  }
} catch (error) {
  await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
  await Promise.all(outputs.map((path) => rm(path, { force: true })));
  throw error;
}
