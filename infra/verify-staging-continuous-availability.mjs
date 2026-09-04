import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const workflow = read('.github/workflows/staging-continuous-availability.yml');
const operation = read('infra/operations/fetanagent-staging-continuous-availability.sh');
const sql = read('infra/sql/staging-runtimes-enable-continuous.sql');
const inspection = read('infra/sql/staging-runtimes-availability-inspect.sql');
const helper = read('infra/operations/fetanagent-staging-deploy-helper.sh');
const deployWorkflow = read('.github/workflows/staging-beta-deploy-smoke.yml');
const sudoers = read('infra/operations/fetanagent-staging-continuous-availability.sudoers');
const installer = read('infra/operations/install-staging-continuous-availability.sh');
const expectedRoles = [
  'fetanagent_beta_admission_runtime',
  'fetanagent_customer_web_runtime',
  'fetanagent_owner_control_runtime',
  'fetanagent_player_actions_runtime',
];
const changedRoles = [...sql.matchAll(/^alter role (\w+) valid until 'infinity';$/gm)].map(
  (match) => match[1],
);
assert.deepEqual(changedRoles, expectedRoles);
assert.equal((sql.match(/\balter\s+role\b/gi) ?? []).length, 4);
assert.doesNotMatch(sql, /\b(?:password|grant|revoke|create\s+role|update|delete|insert)\s/iu);
assert.match(sql, /lock table app\.feature_switches in share mode/);
assert.match(sql, /interval '5 minutes'/);
assert.match(sql, /membership\.inherit_option/);
assert.match(sql, /not membership\.set_option/);
assert.match(sql, /not membership\.admin_option/);
assert.match(sql, /<> 7/);
assert.match(sql, /fetanagent_deposit_executor_runtime/);
assert.match(sql, /fetanagent_trusted_telebirr_verifier_runtime/);
assert.match(inspection, /begin transaction read only/);
assert.doesNotMatch(inspection, /\b(?:alter|update|delete|insert|grant|revoke)\b/iu);
assert.match(workflow, /group: fetanagent-staging-beta-deploy/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /environment: staging/);
assert.match(workflow, /"\$GITHUB_REF" == 'refs\/heads\/main'/);
assert.match(workflow, /git merge-base --is-ancestor "\$DEPLOYED_RELEASE_SHA" "\$GITHUB_SHA"/);
assert.match(workflow, /continuous-availability-no-money/);
assert.match(workflow, /PGSSLMODE: verify-full/);
assert.match(workflow, /StrictHostKeyChecking=yes/);
assert.doesNotMatch(workflow, /fetanagent-staging-deploy-helper (?:stop|start|install)\b/);
const preflightCommand =
  'sudo -n /usr/local/sbin/fetanagent-staging-continuous-availability preflight';
assert.ok(workflow.includes(preflightCommand));
assert.ok(workflow.indexOf(preflightCommand) < workflow.indexOf('psql -X'));
assert.doesNotMatch(workflow, /(?:fresh-)?public-edge-ready/);
assert.ok(operation.includes(createHash('sha256').update(helper).digest('hex')));
const finalizerDigest = createHash('sha256').update(operation).digest('hex');
assert.equal(
  sudoers.trim(),
  ['preflight', 'disable-expiry']
    .map(
      (mode) =>
        `fetanagent-admin ALL=(root) NOPASSWD: sha256:${finalizerDigest} /usr/local/sbin/fetanagent-staging-continuous-availability ${mode} *`,
    )
    .join('\n'),
);
assert.match(installer, /visudo -cf/);
assert.match(installer, /different sudo capability already exists; no files were replaced/);
assert.match(installer, /verify_predecessor "\$TARGET" "\$PREDECESSOR_FINALIZER_SHA" 755/);
assert.match(installer, /verify_predecessor "\$SUDOERS" "\$PREDECESSOR_SUDOERS_SHA" 440/);
assert.ok(
  installer.indexOf('different sudo capability already exists') <
    installer.indexOf('install -o root -g root -m 0755'),
);
assert.doesNotMatch(installer, /\b(?:psql|systemctl|docker|rm)\s/);
assert.match(operation, /invoked_from_installed_file "\$0"/);
assert.match(operation, /"\$\{SUDO_COMMAND:-\}" == "\$INSTALLED_PATH \$MODE \$RELEASE_SHA"/);
assert.doesNotMatch(sudoers, /fdexec=never/);
assert.match(operation, /SUDO_USER:-\}" == fetanagent-admin/);
assert.match(
  deployWorkflow,
  /sudo -n -l \/usr\/local\/sbin\/fetanagent-staging-continuous-availability disable-expiry '\$GITHUB_SHA'/,
);
const completion =
  /- name: Finalize continuous non-financial availability([\s\S]*?)\n\s+- name: Capture bounded Owner-control startup diagnostics/u.exec(
    deployWorkflow,
  )?.[1];
assert.ok(completion);
assert.ok(
  deployWorkflow.indexOf('Start the private staging profile and smoke readiness') <
    deployWorkflow.indexOf('Finalize continuous non-financial availability'),
);
assert.match(completion, /psql -X --file=infra\/sql\/staging-runtimes-enable-continuous\.sql/);
assert.ok(
  completion.indexOf('staging-runtimes-enable-continuous.sql') <
    completion.indexOf(
      'sudo -n /usr/local/sbin/fetanagent-staging-continuous-availability disable-expiry',
    ),
);
assert.ok(
  workflow.indexOf('staging-runtimes-enable-continuous.sql') <
    workflow.indexOf(
      'sudo -n /usr/local/sbin/fetanagent-staging-continuous-availability disable-expiry',
    ),
);
assert.match(operation, /flock --exclusive --nonblock 9/);
assert.match(operation, /\/metadata\/v1\/id\)" == 593344964/);
assert.doesNotMatch(
  operation,
  /systemctl (?:start|enable|restart)|docker (?:stop|start|restart|rm)|\brm\s|sudoers|FINANCIAL_ACTIONS_MODE=live/,
);
assert.equal((operation.match(/systemctl disable --now/g) ?? []).length, 1);
assert.ok(
  operation.indexOf('\n  verify_continuous_credentials\n') <
    operation.indexOf('\n  disarm_existing_timer\n'),
);
assert.ok(
  operation.indexOf('\nverify_timer_identity\n') < operation.indexOf('\n  disarm_existing_timer\n'),
);

const credentialProgram = /<<'NODE'\n([\s\S]*?)\nNODE/u.exec(operation)?.[1];
assert.ok(credentialProgram);
assert.match(credentialProgram, /role\.rolvaliduntil = 'infinity'::timestamptz/);
assert.match(credentialProgram, /connectionTimeoutMillis: 5000/);
assert.match(credentialProgram, /statement_timeout: 5000/);
const programWithoutImports = credentialProgram.replace(/^import .*;\r?\n/gm, '');
const helperUnitGuard =
  /require_kemerbet_v1_retirement_expiry_guard_unit_files\(\) \{[\s\S]*?\n\}/u.exec(helper)?.[0];
const helperContinuousGuard =
  /require_continuous_application_availability_guard\(\) \{[\s\S]*?\nNODE\n\}/u.exec(helper)?.[0];
const helperComponentGuard = /require_component_availability_guard\(\) \{[\s\S]*?\n\}/u.exec(
  helper,
)?.[0];
const helperCredentialProgram =
  /require_continuous_application_availability_guard\(\) \{[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE\n\}/u.exec(
    helper,
  )?.[1];
assert.ok(helperUnitGuard);
assert.ok(helperContinuousGuard);
assert.ok(helperComponentGuard);
assert.ok(helperCredentialProgram);
assert.match(helperUnitGuard, /root:root:644:1/);
assert.match(helperUnitGuard, /FETANAGENT_STAGING_EXPIRY_GUARD=1/);
assert.match(helperUnitGuard, /date -u -d "\$\{timer_lines\[4\]#OnCalendar=\}" \+%s/);
assert.match(helperContinuousGuard, /--property=ActiveState --value "\$EXPIRY_STOP_TIMER"/);
assert.match(helperContinuousGuard, /--property=UnitFileState --value "\$EXPIRY_STOP_TIMER"/);
assert.match(
  helperContinuousGuard,
  /--property=NextElapseUSecRealtime --value "\$EXPIRY_STOP_TIMER"/,
);
assert.match(helperContinuousGuard, /--property=DropInPaths --value "\$EXPIRY_STOP_TIMER"/);
assert.match(helperContinuousGuard, /--property=DropInPaths --value "\$EXPIRY_STOP_SERVICE"/);
assert.match(helperContinuousGuard, /--property=ActiveState --value "\$EXPIRY_STOP_SERVICE"/);
assert.match(helperContinuousGuard, /label=com\.docker\.compose\.service=api/);
assert.match(helperContinuousGuard, /org\.opencontainers\.image\.revision/);
assert.match(helperCredentialProgram, /role\.rolvaliduntil = 'infinity'::timestamptz/);
assert.match(helperCredentialProgram, /connectionTimeoutMillis: 5000/);
assert.match(helperCredentialProgram, /statement_timeout: 5000/);
assert.doesNotMatch(
  helperContinuousGuard,
  /(?:SUPABASE_DB_PASSWORD|DATABASE_URL_FILE|service_role|administrator)/iu,
);
assert.match(
  helperComponentGuard,
  /require_kemerbet_v1_retirement_expiry_guard_armed && return 0[\s\S]*require_continuous_application_availability_guard "\$commit_sha"/,
);
let checks = 0;
if (process.platform !== 'win32') {
  const serviceFilter =
    /docker inspect "\$\{containers\[@\]\}" \| jq -e --arg release "\$RELEASE_SHA" '\n([\s\S]*?)' >\/dev\/null/u.exec(
      operation,
    )?.[1];
  assert.ok(serviceFilter);
  const release = 'a'.repeat(40);
  const makeService = (name) => ({
    Config: {
      Labels: { 'com.docker.compose.service': name, 'org.opencontainers.image.revision': release },
      Env: [
        'FINANCIAL_ACTIONS_MODE=dry_run',
        'KEMERBET_EXECUTOR_ENABLED=false',
        'KEMERBET_FINAL_ACTION_ENABLED=false',
      ],
    },
    State: { Running: true, Health: { Status: 'healthy' } },
  });
  const core = ['api', 'beta-admission', 'customer-web', 'owner-control'].map(makeService);
  const complete = [...core, makeService('bot'), makeService('gateway')];
  const wrongRelease = structuredClone(complete);
  wrongRelease[0].Config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40);
  const moneyEnabled = structuredClone(core);
  moneyEnabled[0].Config.Env.push('KEMERBET_EXECUTOR_ENABLED=true');
  const unhealthy = structuredClone(core);
  unhealthy[0].State.Health.Status = 'starting';
  for (const [name, fixture, pass] of [
    ['healthy private core', core, true],
    ['healthy complete release', complete, true],
    ['partial public release', [...core, makeService('bot')], false],
    ['wrong image revision', wrongRelease, false],
    ['extra executor service', [...complete, makeService('executor')], false],
    ['duplicate service identity', [...core, makeService('api')], false],
    ['conflicting financial flag', moneyEnabled, false],
    ['unhealthy service', unhealthy, false],
  ]) {
    const result = spawnSync('jq', ['-e', '--arg', 'release', release, serviceFilter], {
      input: JSON.stringify(fixture),
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
    checks += 1;
  }
}
for (const [name, fixture, pass] of [
  ['verified catalog', {}, true],
  ['non-continuous or unsafe catalog', { ready: false }, false],
  ['missing catalog result', { rows: [] }, false],
  ['ambiguous catalog result', { rows: [{ ready: true }, { ready: true }] }, false],
  ['wrong database host', { host: 'unrelated.invalid' }, false],
  ['wrong database identity', { user: 'postgres' }, false],
  ['runtime disabled', { enabled: false }, false],
  ['connection failure', { fail: true }, false],
]) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: `
      const fixture = ${JSON.stringify(fixture)};
      const loadApiConfig = () => ({ telegramPlayerActionRuntime: {
        enabled: fixture.enabled ?? true,
        connection: {
          host: fixture.host ?? 'db.spzpiyxheappsfyswewl.supabase.co',
          user: fixture.user ?? 'fetanagent_player_actions_runtime',
        },
      }});
      const createTelegramPlayerActionPoolConfig = () => ({});
      class Pool {
        async query() {
          if (fixture.fail) throw new Error('SECRET_CREDENTIAL_MUST_NOT_APPEAR');
          return { rows: fixture.rows ?? [{ ready: fixture.ready ?? true }] };
        }
        async end() {}
      }
      ${programWithoutImports}
    `,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, name);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET_CREDENTIAL_MUST_NOT_APPEAR/);
  assert.match(
    pass ? result.stdout : result.stderr,
    pass ? /continuous_runtime_credentials=verified/ : /shutdown timer was not changed/,
  );
  checks += 1;
}

const helperProgramWithoutImports = helperCredentialProgram.replace(/^import .*;\r?\n/gm, '');
for (const [name, fixture, pass] of [
  ['component guard accepts the verified catalog', {}, true],
  ['component guard rejects bounded or unsafe roles', { ready: false }, false],
  ['component guard rejects a missing catalog result', { rows: [] }, false],
  [
    'component guard rejects an ambiguous catalog result',
    { rows: [{ ready: true }, { ready: true }] },
    false,
  ],
  ['component guard rejects the wrong database host', { host: 'unrelated.invalid' }, false],
  ['component guard rejects the wrong database identity', { user: 'postgres' }, false],
  ['component guard rejects a disabled runtime', { enabled: false }, false],
  ['component guard rejects a database connection failure', { fail: true }, false],
]) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: `
      const fixture = ${JSON.stringify(fixture)};
      const loadApiConfig = () => ({ telegramPlayerActionRuntime: {
        enabled: fixture.enabled ?? true,
        connection: {
          host: fixture.host ?? 'db.spzpiyxheappsfyswewl.supabase.co',
          user: fixture.user ?? 'fetanagent_player_actions_runtime',
        },
      }});
      const createTelegramPlayerActionPoolConfig = () => ({});
      class Pool {
        async query() {
          if (fixture.fail) throw new Error('SECRET_CREDENTIAL_MUST_NOT_APPEAR');
          return { rows: fixture.rows ?? [{ ready: fixture.ready ?? true }] };
        }
        async end() {}
      }
      ${helperProgramWithoutImports}
    `,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, name);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET_CREDENTIAL_MUST_NOT_APPEAR/);
  if (pass) {
    assert.equal(result.stdout + result.stderr, '');
  } else {
    assert.match(result.stderr, /Continuous application availability verification failed\./);
  }
  checks += 1;
}

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash, 'Bash is required to test the real systemd disarm function.');
for (const [name, release, armedState, continuousState, pass, expectedTrace] of [
  ['component guard accepts the bounded timer first', 'a'.repeat(40), 'exact', 'reject', true, 'A'],
  [
    'component guard falls back to continuous availability',
    'a'.repeat(40),
    'reject',
    'exact',
    true,
    'AC',
  ],
  [
    'component guard fails when both postures fail',
    'a'.repeat(40),
    'reject',
    'reject',
    false,
    'AC',
  ],
  ['component guard rejects an invalid release', 'invalid', 'exact', 'exact', false, ''],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
ARMED_STATE='${armedState}'
CONTINUOUS_STATE='${continuousState}'
TRACE=''
require_kemerbet_v1_retirement_expiry_guard_armed() {
  TRACE="\${TRACE}A"
  [[ "$ARMED_STATE" == exact ]]
}
require_continuous_application_availability_guard() {
  TRACE="\${TRACE}C"
  [[ "$CONTINUOUS_STATE" == exact && "$1" == '${'a'.repeat(40)}' ]]
}
${helperComponentGuard}
set +e
require_component_availability_guard '${release}'
status=$?
set -e
printf '%s' "$TRACE"
exit "$status"
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  assert.equal(result.stdout, expectedTrace, name);
  checks += 1;
}

for (const [
  name,
  release,
  unitState,
  timerState,
  timerEnablement,
  timerSchedule,
  timerDropIns,
  serviceState,
  serviceDropIns,
  apiState,
  catalogState,
  pass,
] of [
  [
    'exact continuous component posture',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'exact',
    'exact',
    true,
  ],
  [
    'changed expiry unit files',
    'a'.repeat(40),
    'changed',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'exact',
    'exact',
    false,
  ],
  [
    'active old timer',
    'a'.repeat(40),
    'exact',
    'active',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'exact',
    'exact',
    false,
  ],
  [
    'boot-enabled old timer',
    'a'.repeat(40),
    'exact',
    'inactive',
    'enabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'exact',
    'exact',
    false,
  ],
  [
    'scheduled old timer',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'scheduled',
    'empty',
    'inactive',
    'empty',
    'exact',
    'exact',
    false,
  ],
  [
    'timer drop-in override',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'empty',
    'present',
    'inactive',
    'empty',
    'exact',
    'exact',
    false,
  ],
  [
    'active old shutdown service',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'active',
    'empty',
    'exact',
    'exact',
    false,
  ],
  [
    'shutdown service drop-in override',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'present',
    'exact',
    'exact',
    false,
  ],
  [
    'wrong API release',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'wrong-release',
    'exact',
    false,
  ],
  [
    'ambiguous API inventory',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'ambiguous',
    'exact',
    false,
  ],
  [
    'non-continuous runtime catalog',
    'a'.repeat(40),
    'exact',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'exact',
    'reject',
    false,
  ],
  [
    'invalid reviewed release',
    'invalid',
    'exact',
    'inactive',
    'disabled',
    'empty',
    'empty',
    'inactive',
    'empty',
    'exact',
    'exact',
    false,
  ],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
PROJECT_NAME='fetanagent-staging-beta'
EXPIRY_STOP_TIMER='fetanagent-staging-runtime-expiry-stop.timer'
EXPIRY_STOP_SERVICE='fetanagent-staging-runtime-expiry-stop.service'
EXPIRY_STOP_TIMER_PATH="/etc/systemd/system/$EXPIRY_STOP_TIMER"
EXPIRY_STOP_SERVICE_PATH="/etc/systemd/system/$EXPIRY_STOP_SERVICE"
UNIT_STATE='${unitState}'
TIMER_STATE='${timerState}'
TIMER_ENABLEMENT='${timerEnablement}'
TIMER_SCHEDULE='${timerSchedule}'
TIMER_DROP_INS='${timerDropIns}'
SERVICE_STATE='${serviceState}'
SERVICE_DROP_INS='${serviceDropIns}'
API_STATE='${apiState}'
CATALOG_STATE='${catalogState}'
require_kemerbet_v1_retirement_expiry_guard_unit_files() { [[ "$UNIT_STATE" == exact ]]; }
systemctl() {
  [[ "$1" == show && "$3" == --value ]] || return 91
  property="\${2#--property=}"
  unit="$4"
  case "$property:$unit" in
    "LoadState:$EXPIRY_STOP_TIMER"|"LoadState:$EXPIRY_STOP_SERVICE") echo loaded ;;
    "FragmentPath:$EXPIRY_STOP_TIMER") echo "$EXPIRY_STOP_TIMER_PATH" ;;
    "FragmentPath:$EXPIRY_STOP_SERVICE") echo "$EXPIRY_STOP_SERVICE_PATH" ;;
    "DropInPaths:$EXPIRY_STOP_TIMER") [[ "$TIMER_DROP_INS" == empty ]] || echo /override.conf ;;
    "DropInPaths:$EXPIRY_STOP_SERVICE") [[ "$SERVICE_DROP_INS" == empty ]] || echo /override.conf ;;
    "ActiveState:$EXPIRY_STOP_TIMER") echo "$TIMER_STATE" ;;
    "UnitFileState:$EXPIRY_STOP_TIMER") echo "$TIMER_ENABLEMENT" ;;
    "NextElapseUSecRealtime:$EXPIRY_STOP_TIMER") [[ "$TIMER_SCHEDULE" == empty ]] || echo tomorrow ;;
    "ActiveState:$EXPIRY_STOP_SERVICE") echo "$SERVICE_STATE" ;;
    *) return 92 ;;
  esac
}
docker_local() {
  case "$1:$2" in
    container:ls)
      case "$API_STATE" in
        ambiguous) printf '%s\\n%s\\n' aaaaaaaaaaaa bbbbbbbbbbbb ;;
        *) printf '%s\\n' aaaaaaaaaaaa ;;
      esac
      ;;
    container:inspect)
      [[ "$API_STATE" == wrong-release ]] && printf '%s\\n' '${'b'.repeat(40)}' || printf '%s\\n' '${'a'.repeat(40)}'
      ;;
    container:exec)
      cat >/dev/null
      [[ "$CATALOG_STATE" == exact ]]
      ;;
    *) return 93 ;;
  esac
}
${helperContinuousGuard}
require_continuous_application_availability_guard '${release}'
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET|password|credential/iu);
  checks += 1;
}

if (process.platform !== 'win32') {
  const invocationFunction = /invoked_from_installed_file\(\) \{[\s\S]*?\n\}/u.exec(operation)?.[0];
  assert.ok(invocationFunction);
  for (const [name, invokedPath, sudoUser, commandSuffix, pass] of [
    ['direct installed path', '$INSTALLED_PATH', '', '', true],
    ['sudo digest proc descriptor', '/proc/self/fd/7', 'fetanagent-admin', '', true],
    ['sudo digest dev descriptor', '/dev/fd/7', 'fetanagent-admin', '', true],
    ['unrelated open descriptor', '/dev/fd/8', 'fetanagent-admin', '', false],
    ['different invoking identity', '/dev/fd/7', 'unrelated-user', '', false],
    ['different original command', '/dev/fd/7', 'fetanagent-admin', ' extra', false],
    ['copied script path', '/tmp/unreviewed-script', 'fetanagent-admin', '', false],
  ]) {
    const result = spawnSync(bash, ['-s'], {
      input: `set -euo pipefail
INSTALLED_PATH="$BASH"
MODE=preflight
RELEASE_SHA='${'a'.repeat(40)}'
SUDO_USER='${sudoUser}'
SUDO_COMMAND="$INSTALLED_PATH $MODE $RELEASE_SHA${commandSuffix}"
exec 7<"$INSTALLED_PATH"
exec 8</dev/null
${invocationFunction}
invoked_from_installed_file "${invokedPath}"
`,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
    checks += 1;
  }
}
const disarmFunction = /disarm_existing_timer\(\) \{[\s\S]*?\n\}/u.exec(operation)?.[0];
assert.ok(disarmFunction);
const operationSequence = operation.slice(
  operation.lastIndexOf('\nverify_services\nbefore_containers='),
);
assert.match(
  operationSequence,
  /if \[\[ "\$MODE" != 'preflight' \]\]; then\n  verify_continuous_credentials\nfi/,
);
for (const [name, mode, continuous, healthy, pass, expectDisarm] of [
  ['read-only preflight before conversion', 'preflight', false, true, true, false],
  ['read-only preflight after conversion', 'preflight', true, true, true, false],
  ['preflight rejects unhealthy deployment', 'preflight', false, false, false, false],
  ['inspection requires continuous credentials', 'inspect', false, true, false, false],
  ['continuous inspection never disarms', 'inspect', true, true, true, false],
  ['disarm rejects bounded credentials', 'disable-expiry', false, true, false, false],
  ['disarm follows credential verification', 'disable-expiry', true, true, true, true],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
MODE='${mode}'
TIMER='fetanagent-staging-runtime-expiry-stop.timer'
die() { printf '%s\\n' "$1" >&2; exit 1; }
verify_services() { ${healthy}; containers=(verified-container); }
verify_continuous_credentials() { echo 'credentials_checked'; ${continuous}; }
verify_timer_identity() { echo 'timer_identity_checked'; }
disarm_existing_timer() { echo 'timer_disarmed'; }
systemctl() { [[ "$1" == show ]]; }
${operationSequence}
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  assert.equal(result.stdout.includes('timer_disarmed'), expectDisarm, name);
  if (mode === 'preflight') assert.doesNotMatch(result.stdout, /credentials_checked/);
  if (expectDisarm) {
    assert.ok(
      result.stdout.indexOf('credentials_checked') < result.stdout.indexOf('timer_disarmed'),
    );
    assert.ok(
      result.stdout.indexOf('timer_identity_checked') < result.stdout.indexOf('timer_disarmed'),
    );
  }
  checks += 1;
}
for (const [name, behavior, pass] of [
  ['disable active timer', 'normal', true],
  ['already absent timer', 'absent', true],
  ['disable failure', 'reject', false],
  ['timer remains active', 'active', false],
  ['boot enablement remains', 'enabled', false],
  ['next trigger remains', 'scheduled', false],
]) {
  const result = spawnSync(bash, ['-s'], {
    input: `set -euo pipefail
TIMER='fetanagent-staging-runtime-expiry-stop.timer'
BEHAVIOR='${behavior}'
DISABLED=false
die() { printf '%s\\n' "$1" >&2; exit 1; }
systemctl() {
  if [[ "$1" == disable ]]; then
    [[ "$*" == "disable --now $TIMER" ]] || exit 91
    [[ "$BEHAVIOR" != reject ]] || return 1
    DISABLED=true
    return 0
  fi
  [[ "$1" == show && "$3" == --value && "$4" == "$TIMER" ]] || exit 92
  case "$2" in
    --property=LoadState) [[ "$BEHAVIOR" == absent ]] && echo not-found || echo loaded ;;
    --property=ActiveState) [[ "$BEHAVIOR" == active ]] && echo active || echo inactive ;;
    --property=UnitFileState) [[ "$BEHAVIOR" == enabled ]] && echo enabled || echo disabled ;;
    --property=NextElapseUSecRealtime) [[ "$BEHAVIOR" == scheduled ]] && echo tomorrow || true ;;
    *) exit 93 ;;
  esac
}
${disarmFunction}
disarm_existing_timer
if [[ "$BEHAVIOR" == absent ]]; then [[ "$DISABLED" == false ]]; else [[ "$DISABLED" == true ]]; fi
`,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, pass ? 0 : 1, `${name}: ${result.stderr}`);
  checks += 1;
}
console.info(`Continuous staging availability contract and ${checks} executable cases passed.`);
