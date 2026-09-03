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
assert.ok(workflow.indexOf('public-edge-ready') < workflow.indexOf('psql -X'));
assert.ok(operation.includes(createHash('sha256').update(helper).digest('hex')));
const finalizerDigest = createHash('sha256').update(operation).digest('hex');
assert.equal(
  sudoers.trim(),
  `fetanagent-admin ALL=(root) NOPASSWD: sha256:${finalizerDigest} /usr/local/sbin/fetanagent-staging-continuous-availability disable-expiry *`,
);
assert.match(installer, /visudo -cf/);
assert.match(installer, /different sudo capability already exists; no files were replaced/);
assert.doesNotMatch(installer, /\b(?:psql|systemctl|docker|rm)\s/);
assert.match(operation, /"\$0" == "\$INSTALLED_PATH"/);
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
  operation.indexOf('\nverify_continuous_credentials\n') <
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

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash, 'Bash is required to test the real systemd disarm function.');
const disarmFunction = /disarm_existing_timer\(\) \{[\s\S]*?\n\}/u.exec(operation)?.[0];
assert.ok(disarmFunction);
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
