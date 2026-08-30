import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-h14-host-retired-empty-profile-finalization-bridge.sh',
);
const enginePath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-h14-empty-profile-finalization-engine.py',
);
const installerPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-h14-empty-profile-finalization-bundle-installer.py',
);
const helperPath = resolve(root, 'infra/operations/fetanagent-staging-deploy-helper.sh');
const diagnosticPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-h14-terminal-differential-validator.py',
);
const workflowPath = resolve(root, '.github/workflows/staging-kemerbet-session-provision.yml');
const removedStandaloneWorkflowPath = resolve(
  root,
  '.github/workflows/staging-h14-empty-profile-finalization-bridge.yml',
);
const packagePath = resolve(root, 'package.json');
const read = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const script = read(scriptPath);
const engine = read(enginePath);
const installer = read(installerPath);
const helper = read(helperPath);
const diagnostic = read(diagnosticPath);
const workflow = read(workflowPath);
const packageSource = read(packagePath);
assert.equal(
  existsSync(removedStandaloneWorkflowPath),
  false,
  'the undispatchable standalone workflow must remain removed',
);

const canonicalRelease = '06459511d9330a0e1d956c42529b81aa9970e7a2';
const helperSha = 'c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58';
const authorizationSha = '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

for (const source of [script, engine, workflow]) {
  assert.ok(source.includes(canonicalRelease), 'canonical H14 release pin is absent');
  assert.ok(source.includes('spzpiyxheappsfyswewl'), 'staging project pin is absent');
  assert.ok(source.includes('593344964'), 'staging Droplet pin is absent');
}
assert.match(installer, /PORTABLE_FIXTURE = False/);
assert.match(installer, /\.installing-\{release\}/);
assert.match(installer, /prefix != expected\[: len\(prefix\)\]/);
assert.match(installer, /os\.O_CREAT \| os\.O_EXCL/);
assert.match(installer, /sync_directory\(parent\)/);
assert.match(installer, /fcntl\.flock\(descriptor, fcntl\.LOCK_EX \| fcntl\.LOCK_NB\)/);
assert.match(installer, /fetanagent-h14-empty-profile-bundle-installer/);
assert.match(installer, /identity\(after\) != identity\(before\)/);
assert.match(installer, /def validate_bundle_parent\(/);
assert.match(installer, /HISTORICAL_RELEASE = "066572953de652e53634f562b4a63c0d9103865d"/);
assert.match(installer, /HISTORICAL_FILES = \{/);
assert.match(installer, /expected_sha=expected_sha/);
assert.doesNotMatch(
  installer,
  /\b(?:subprocess|socket)\b|docker_local|transfer_enabled=true|money_moved=true/i,
);
assert.ok(script.includes(helperSha));
assert.ok(engine.includes(helperSha));
assert.ok(script.includes(authorizationSha));
assert.match(script, /PASS H14-D000/);
assert.match(script, /acquire_staging_mutation_lock/);
assert.match(script, /exec 9<>"\$MUTATION_LOCK"/);
assert.match(script, /stat -L --format='%u:%g:%a:%h:%d:%i' \/proc\/self\/fd\/9/);
assert.match(script, /flock --exclusive --nonblock 9/);
assert.match(script, /require_fresh_host_identity/);
assert.match(script, /require_live_fail_closed_boundary/);
assert.match(script, /api\\nbeta-admission\\nbot\\ncustomer-web\\ngateway\\nowner-control/);
assert.match(script, /\.State\.Status/);
assert.match(script, /\.Config\.Healthcheck/);
assert.match(script, /\.State\.Health\.Status/);
assert.match(script, /health_status" == healthy/);
assert.match(script, /the live KemerBet profile root is not exact and empty/);
assert.match(script, /the KemerBet profile volume has a live or stopped holder/);
assert.match(script, /a Chromium or provider process still references the KemerBet profile root/);
assert.match(script, /int\(name\) == current_pid/);
assert.match(script, /require_no_host_chromium/);
assert.match(script, /require_container_no_chromium/);
assert.match(script, /docker_local container top/);
assert.match(script, /OWNER_CONTROL_SUPABASE_URL=https:\/\/\$STAGING_PROJECT_REF\.supabase\.co/);
assert.match(script, /CUSTOMER_WEB_SUPABASE_URL=https:\/\/\$STAGING_PROJECT_REF\.supabase\.co/);
assert.match(script, /xzztugbgtulptnbpoelr/);
const healthAccepted = (service, runtime, contract, health) =>
  runtime === 'running' &&
  (service === 'bot'
    ? contract === 'absent' && health === 'absent'
    : contract === 'present' && health === 'healthy');
for (const service of ['api', 'beta-admission', 'customer-web', 'gateway', 'owner-control']) {
  assert.equal(healthAccepted(service, 'running', 'present', 'healthy'), true);
  assert.equal(
    healthAccepted(service, 'running', 'absent', 'absent'),
    false,
    `${service}: a removed required healthcheck was accepted`,
  );
  assert.equal(healthAccepted(service, 'running', 'present', 'unhealthy'), false);
}
assert.equal(healthAccepted('bot', 'running', 'absent', 'absent'), true);
assert.equal(healthAccepted('bot', 'running', 'present', 'healthy'), false);
assert.equal(healthAccepted('bot', 'exited', 'absent', 'absent'), false);
assert.match(
  script,
  /a KemerBet binding, recheck receipt, or RPC capability is unexpectedly present/,
);
assert.match(script, /publish_append_complete/);
assert.match(script, /O_CREAT \| os\.O_EXCL \| os\.O_NOFOLLOW/);
assert.match(script, /data != expected\[:len\(data\)\]/);
assert.match(script, /sync -f \/var\/lib\/fetanagent/);
assert.match(
  script,
  /''\|'\.expiry-guard-retirement-intent-v1\.installing:f'\|'expiry-guard-retirement-intent-v1:f'/,
);
assert.match(
  script,
  /the installing bridge ledger has an invalid crash prefix or unexpected entry/,
);
assert.ok(
  script.split('require_exact_host_retired_diagnostic').length - 1 >= 4,
  'host-retired diagnostic is not rerun across ledger publication prefixes',
);
assert.match(script, /engine verify-completed/);
assert.match(script, /PREDECESSOR_BRIDGE_RELEASE='066572953de652e53634f562b4a63c0d9103865d'/);
assert.match(script, /require_exact_failed_predecessor_evidence/);
assert.match(script, /host-retired-profile-tree-finalization-bridge/);
assert.ok(script.includes('c206af7923aae32743ddf841ee8e673544e963e5a8730c3c6074fa7852dcd063'));
assert.ok(script.includes('d155578fb560103d3452ba2d489828f29a8a6b8b1d604eb37235f7d5ef07eb48'));
assert.match(script, /expiry-guard-retirement-intent-v1/);
assert.match(script, /expiry-guard-retired-v1/);
assert.match(script, /contract=fetanagent-staging-expired-runtime-guard-retirement-v1/);
assert.match(script, /state=authorized/);
assert.match(script, /state=completed/);
assert.match(script, /require_exact_expired_guard_present/);
assert.match(script, /require_expiry_guard_transition_exact/);
assert.match(script, /require_expiry_guard_absent/);
assert.match(script, /systemctl stop "\$EXPIRY_STOP_SERVICE"/);
assert.match(script, /systemctl disable --now "\$EXPIRY_STOP_TIMER"/);
assert.match(script, /rm -f -- "\$EXPIRY_STOP_SERVICE_PATH" "\$EXPIRY_STOP_TIMER_PATH"/);
assert.match(script, /systemctl daemon-reload/);
assert.match(
  script,
  /EXPIRY_STOP_TIMER_ENABLE_LINK="\/etc\/systemd\/system\/timers\.target\.wants\/\$EXPIRY_STOP_TIMER"/,
);
assert.match(script, /readlink -- "\$EXPIRY_STOP_TIMER_ENABLE_LINK"/);
assert.match(
  script,
  /! -e "\$EXPIRY_STOP_TIMER_ENABLE_LINK" && ! -L "\$EXPIRY_STOP_TIMER_ENABLE_LINK"/,
);
assert.match(script, /systemd_value "\$EXPIRY_STOP_SERVICE" MainPID/);
assert.match(script, /systemd_value "\$EXPIRY_STOP_SERVICE" ActiveState/);
assert.match(script, /systemd_value "\$EXPIRY_STOP_SERVICE" Job/);
assert.match(script, /systemd_value "\$EXPIRY_STOP_TIMER" Job/);
assert.match(
  script,
  /if \[\[ "\$load_state" == 'loaded' \]\]; then\n\s+\[\[ "\$\(systemd_value "\$name" FragmentPath\)" == "\$path"/,
);
assert.match(
  script,
  /require_exact_failed_predecessor_evidence\n\nif \[\[ -e "\$FINAL_ROOT" \|\| -L "\$FINAL_ROOT" \]\]/,
  'completed replay can bypass failed-predecessor attestation',
);
assert.match(
  script,
  /completed-v1:f\\nexpiry-guard-retired-v1:f\\nexpiry-guard-retirement-intent-v1:f\\nintent-v1:f/,
);
assert.doesNotMatch(script, /rmdir -- "\$predecessor_installing"/);
assert.doesNotMatch(script, /rm\s+(?:-[^\n]*r[^\n]*f|--recursive)/);
assert.match(script, /manifest-v1/);
assert.doesNotMatch(script, /exec \{mutation_lock_fd\}>"\$MUTATION_LOCK"/);

// Model every durable systemd retirement prefix accepted by the bridge.  The
// live bridge additionally proves exact root ownership, unit hashes, systemd
// fragment paths, the expired calendar, and the shared mutation lock.
const exactUnit = Object.freeze({ present: true, exact: true });
const absentUnit = Object.freeze({ present: false, exact: false });
const exactEnableLink = Object.freeze({ present: true, exact: true });
const absentEnableLink = Object.freeze({ present: false, exact: false });
const transitionalGuardAccepted = (state) =>
  [state.serviceFile, state.timerFile].every((entry) => !entry.present || entry.exact) &&
  (!state.enableLink.present || state.enableLink.exact) &&
  ['loaded', 'not-found'].includes(state.serviceLoad) &&
  ['loaded', 'not-found'].includes(state.timerLoad) &&
  (state.serviceLoad !== 'loaded' || state.serviceFragmentExact) &&
  (state.timerLoad !== 'loaded' || state.timerFragmentExact);
const retiredGuardAccepted = (state) =>
  !state.serviceFile.present &&
  !state.timerFile.present &&
  !state.enableLink.present &&
  state.serviceLoad === 'not-found' &&
  state.serviceActive === 'inactive' &&
  state.serviceSub === 'dead' &&
  state.servicePid === 0 &&
  state.serviceJob === '' &&
  state.timerLoad === 'not-found' &&
  state.timerActive === 'inactive' &&
  state.timerSub === 'dead' &&
  state.timerJob === '';
const guardPresent = {
  serviceFile: exactUnit,
  timerFile: exactUnit,
  enableLink: exactEnableLink,
  serviceLoad: 'loaded',
  serviceFragmentExact: true,
  serviceActive: 'activating',
  serviceSub: 'auto-restart',
  servicePid: 0,
  serviceJob: '',
  timerLoad: 'loaded',
  timerFragmentExact: true,
  timerActive: 'active',
  timerSub: 'elapsed',
  timerJob: '',
};
assert.equal(transitionalGuardAccepted(guardPresent), true);
assert.equal(
  transitionalGuardAccepted({ ...guardPresent, serviceFile: { present: true, exact: false } }),
  false,
  'a tampered expiry service unit was accepted',
);
assert.equal(
  transitionalGuardAccepted({ ...guardPresent, serviceFragmentExact: false }),
  false,
  'a loaded same-name expiry service with a different FragmentPath was accepted',
);
const afterServiceStop = {
  ...guardPresent,
  serviceActive: 'inactive',
  serviceSub: 'dead',
};
assert.equal(transitionalGuardAccepted(afterServiceStop), true);
const afterTimerDisable = {
  ...afterServiceStop,
  enableLink: absentEnableLink,
  timerActive: 'inactive',
  timerSub: 'dead',
};
assert.equal(transitionalGuardAccepted(afterTimerDisable), true);
assert.equal(
  transitionalGuardAccepted({ ...afterTimerDisable, serviceFile: absentUnit }),
  true,
  'the one-file-removed crash prefix was not recoverable',
);
assert.equal(
  transitionalGuardAccepted({ ...afterTimerDisable, timerFile: absentUnit }),
  true,
  'the timer-file-removed crash prefix was not recoverable',
);
const afterDaemonReload = {
  serviceFile: absentUnit,
  timerFile: absentUnit,
  enableLink: absentEnableLink,
  serviceLoad: 'not-found',
  serviceActive: 'inactive',
  serviceSub: 'dead',
  servicePid: 0,
  serviceJob: '',
  timerLoad: 'not-found',
  timerFragmentExact: false,
  timerActive: 'inactive',
  timerSub: 'dead',
  timerJob: '',
};
assert.equal(retiredGuardAccepted(afterDaemonReload), true);
assert.equal(
  retiredGuardAccepted({ ...afterDaemonReload, enableLink: exactEnableLink }),
  false,
  'a dangling expiry-timer enablement link was accepted',
);
assert.equal(
  retiredGuardAccepted({ ...afterDaemonReload, serviceActive: 'active', serviceSub: 'running' }),
  false,
  'an active retired expiry service was accepted',
);
assert.equal(
  retiredGuardAccepted({ ...afterDaemonReload, servicePid: 42 }),
  false,
  'a retired expiry service with a live PID was accepted',
);
assert.equal(
  retiredGuardAccepted({ ...afterDaemonReload, timerJob: '/org/freedesktop/systemd1/job/42' }),
  false,
  'a retired expiry timer with a pending systemd job was accepted',
);

const baseNames = [
  'claim-stage-consumption-v1',
  'empty-predecessor-checkpoint-adoption-v1',
  'host-retired-v1',
  'intent-v1',
  'owner-runtime-restored-v1',
  'player-stage-consumption-v1',
  'predecessor-helper',
  'quarantined-profile-v1',
  'retired-binding-v3',
  'retired-retryable-failure-v1',
  'runtime-retired-v1',
  'runtime-retirement-intent-v1',
];
for (const name of baseNames) assert.ok(engine.includes(`"${name}"`), `base pin absent: ${name}`);
assert.match(engine, /base_entry_\{index:02d\}/);
assert.match(engine, /def quarantined_tree_snapshot\(/);
assert.match(engine, /QUARANTINED_PROFILE_MAX_OBJECTS = 512/);
assert.match(engine, /QUARANTINED_PROFILE_MAX_TOTAL_BYTES = 16 \* 1024 \* 1024/);
assert.match(engine, /QUARANTINED_PROFILE_MAX_DEPTH = 8/);
assert.match(engine, /QUARANTINED_PROFILE_MAX_NAME_BYTES = 128/);
assert.match(engine, /QUARANTINED_PROFILE_MAX_PATH_BYTES = 256/);
assert.match(engine, /first_snapshot != second_snapshot/);
assert.match(engine, /DESCRIPTOR_RELATIVE_TREE/);
assert.match(
  engine,
  /if DESCRIPTOR_RELATIVE_TREE:\n\s+return quarantined_tree_snapshot_descriptor_relative\(path\)/,
);
assert.match(
  engine,
  /if PORTABLE_FIXTURE:\n\s+return quarantined_tree_snapshot_portable_path\(path\)\n\s+reject\(\)/,
);
assert.match(engine, /os\.listdir\(current_descriptor\)/);
assert.match(engine, /dir_fd=current_descriptor/);
assert.match(engine, /follow_symlinks=False/);
assert.match(engine, /os\.open\(name, READ_FLAGS, dir_fd=current_descriptor\)/);
assert.match(engine, /bindings\.append\(\(current_descriptor, name, descriptor, identity\)\)/);
assert.match(engine, /object_identity\(os\.fstat\(descriptor\)\) != expected_identity/);
assert.doesNotMatch(engine, /os\.walk\(/);
assert.match(engine, /except OSError:\n\s+reject\(\)/);
assert.match(engine, /named\.st_dev != root_device/);
assert.match(engine, /\/proc\/self\/mountinfo/);
assert.match(engine, /os\.listxattr\(f"\/proc\/self\/fd\/\{descriptor\}", follow_symlinks=True\)/);
assert.match(engine, /elif stat\.S_ISREG\(named\.st_mode\):/);
assert.match(engine, /getattr\(os, "O_NONBLOCK", 0\)/);
assert.match(engine, /exact_failed_predecessor_pins/);
assert.match(engine, /failed_predecessor_ledger_pin_sha256/);
assert.match(engine, /failed_predecessor_bundle_pin_sha256/);
assert.match(engine, /exact_expiry_guard_records/);
assert.match(engine, /expiry_guard_retirement_intent_sha256/);
assert.match(engine, /expiry_guard_retired_sha256/);
assert.ok(engine.includes('c206af7923aae32743ddf841ee8e673544e963e5a8730c3c6074fa7852dcd063'));
assert.ok(engine.includes('d155578fb560103d3452ba2d489828f29a8a6b8b1d604eb37235f7d5ef07eb48'));
assert.match(engine, /profile_revision=\[1-9\]\[0-9\]\{0,8\}/);
assert.match(engine, /def exact_ledger\(/);
assert.match(engine, /def expected_completion\(/);
assert.match(engine, /def publish_exact\(/);
assert.match(engine, /data != expected\[: len\(data\)\]/);
assert.match(engine, /sync_directory\(source_directory\)/);
assert.match(engine, /sync_directory\(target_directory\)/);
assert.match(engine, /set\(os\.listdir\(root\)\) != P0_TO_P5\[-1\]/);
assert.match(engine, /ack_selected == ack_target/);
assert.match(engine, /marker_selected == marker_target and not terminal_ready/);
assert.match(engine, /database_ready and marker_selected != marker_target/);
for (const gate of [
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'provider_action_enabled=false',
  'amount_entry_enabled=false',
  'transfer_enabled=false',
  'money_moved=false',
]) {
  assert.ok(script.includes(gate) || engine.includes(gate), `fail-closed gate absent: ${gate}`);
}
for (const source of [script, engine, workflow]) {
  assert.doesNotMatch(
    source,
    /(?:amount_entry_enabled|transfer_enabled|provider_action_enabled)=true/,
  );
  assert.doesNotMatch(
    source,
    /docker\s+(?:run|create|start|stop|rm|compose|image|volume|network)/i,
  );
}
assert.doesNotMatch(script, /(?:cp|mv|install)[^\n]*\$HELPER_PATH/);

const bugNeedle =
  '  mapfile -t inspection_lines <<<"$inspection"\n  [[ "${#inspection_lines[@]}" -eq 4 &&';
assert.equal(
  helper.split(bugNeedle).length - 1,
  1,
  'canonical empty-field defect must stay singular',
);
const emitted = `host-retired\n${canonicalRelease}\n${helperSha}\n\n`;
assert.equal(
  emitted.replace(/\n+$/u, '').split('\n').length,
  3,
  'fixture did not reproduce Bash loss',
);
assert.equal(
  script.includes('source /dev/stdin'),
  false,
  'installed helper stream patch is forbidden',
);

function resolvePython() {
  for (const candidate of [
    process.env.FETANAGENT_TEST_PYTHON,
    process.platform === 'win32'
      ? join(
          process.env.USERPROFILE ?? '',
          '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
        )
      : '/usr/bin/python3',
    'python3',
  ].filter(Boolean)) {
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Python 3 is required');
}
function resolveBash() {
  for (const candidate of [
    process.env.FETANAGENT_TEST_BASH,
    process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash',
    'bash',
  ].filter(Boolean)) {
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Bash is required');
}
const temporary = mkdtempSync(join(tmpdir(), 'fetanagent-h14-empty-profile-engine-'));
try {
  for (const [name, source] of [
    ['engine.py', engine],
    ['diagnostic.py', diagnostic],
    ['installer.py', installer],
  ]) {
    const path = join(temporary, name);
    writeFileSync(path, source, 'utf8');
    const compiled = spawnSync(resolvePython(), ['-m', 'py_compile', path], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, `${compiled.stdout}${compiled.stderr}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

// Run the immutable bundle installer through every ordered publication prefix.
// This proves parent-only, empty-installing, partial-file, fully copied, final
// publication, exact replay, foreign-entry, and non-prefix fail-closed paths.
const installerFixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-h14-installer-fixture-'));
const installerName = 'fetanagent-kemerbet-h14-empty-profile-finalization-bundle-installer.py';
const bundleNames = [
  'fetanagent-kemerbet-h14-host-retired-empty-profile-finalization-bridge.sh',
  'fetanagent-kemerbet-h14-terminal-differential-validator.py',
  'fetanagent-kemerbet-h14-empty-profile-finalization-engine.py',
  'manifest-v1',
];
const installerRelease = 'e'.repeat(40);
const portableInstaller = installer
  .replace('PORTABLE_FIXTURE = False', 'PORTABLE_FIXTURE = True')
  .replace(
    'except BaseException:\n    raise SystemExit(1)',
    'except BaseException:\n    import traceback\n    traceback.print_exc()\n    raise SystemExit(1)',
  );
const installerPayloads = new Map([
  [bundleNames[0], Buffer.from('#!/usr/bin/env bash\nexit 0\n', 'ascii')],
  [bundleNames[1], Buffer.from('print("diagnostic")\n', 'ascii')],
  [bundleNames[2], Buffer.from('print("engine")\n', 'ascii')],
  [bundleNames[3], Buffer.from('version=1\nstate=fixture\n', 'ascii')],
  [installerName, Buffer.from(portableInstaller, 'utf8')],
]);

function runInstallerFixture(name, prefix) {
  const area = join(installerFixtureRoot, name);
  const staging = join(area, 'staging');
  const parent = join(area, 'bundles');
  const installing = join(parent, `.installing-${installerRelease}`);
  mkdirSync(staging, { recursive: true });
  for (const [entry, data] of installerPayloads) writeFileSync(join(staging, entry), data);
  const completed = [];
  if (prefix !== 'absent-parent') mkdirSync(parent, { recursive: true });
  if (!['absent-parent', 'parent-only'].includes(prefix))
    mkdirSync(installing, { recursive: true });
  const phase = bundleNames.indexOf(prefix.replace(/^(?:partial-|after-)/u, ''));
  if (phase >= 0) {
    for (let index = 0; index < phase; index += 1) {
      writeFileSync(
        join(installing, bundleNames[index]),
        installerPayloads.get(bundleNames[index]),
      );
      completed.push(bundleNames[index]);
    }
    const phaseName = bundleNames[phase];
    if (prefix.startsWith('partial-')) {
      const data = installerPayloads.get(phaseName);
      writeFileSync(
        join(installing, `.${phaseName}.installing`),
        data.subarray(0, Math.max(1, data.length >> 1)),
      );
    } else {
      writeFileSync(join(installing, phaseName), installerPayloads.get(phaseName));
      completed.push(phaseName);
    }
  }
  const installerPathFixture = join(staging, installerName);
  const digestAndSize = (entry) => {
    const data = installerPayloads.get(entry);
    return [sha256(data), String(data.length)];
  };
  const args = [
    staging,
    parent,
    installerRelease,
    ...digestAndSize(installerName),
    ...digestAndSize(bundleNames[0]),
    ...digestAndSize(bundleNames[1]),
    ...digestAndSize(bundleNames[2]),
    ...digestAndSize(bundleNames[3]),
  ];
  const runInstaller = (environment = {}) =>
    spawnSync(resolvePython(), [installerPathFixture, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FETANAGENT_FIXTURE_BUNDLE_PARENT: parent,
        ...environment,
      },
    });
  return { area, args, completed, installerPathFixture, installing, parent, runInstaller };
}

try {
  for (const [fixtureIndex, prefix] of [
    'absent-parent',
    'parent-only',
    'empty-installing',
    ...bundleNames.flatMap((name) => [`partial-${name}`, `after-${name}`]),
  ].entries()) {
    const fixture = runInstallerFixture(`resume-${fixtureIndex}`, prefix);
    let result = fixture.runInstaller();
    assert.equal(result.status, 0, `${prefix}: ${result.stdout}${result.stderr}`);
    const final = join(fixture.parent, installerRelease);
    assert.equal(result.stdout.trim(), final);
    assert.deepEqual(readdirSync(final).sort(), [...bundleNames].sort());
    result = fixture.runInstaller();
    assert.equal(result.status, 0, `${prefix}: exact replay failed: ${result.stderr}`);
  }
  let malformed = runInstallerFixture('reject-foreign', 'empty-installing');
  writeFileSync(join(malformed.installing, 'foreign-v1'), 'x\n');
  assert.notEqual(malformed.runInstaller().status, 0, 'foreign installer entry was accepted');
  malformed = runInstallerFixture('reject-prefix', 'empty-installing');
  writeFileSync(join(malformed.installing, `.${bundleNames[0]}.installing`), 'wrong-prefix\n');
  assert.notEqual(malformed.runInstaller().status, 0, 'non-prefix bundle bytes were accepted');

  const historical = runInstallerFixture('preserve-historical-bundle', 'parent-only');
  const historicalRelease = 'd'.repeat(40);
  const historicalRoot = join(historical.parent, historicalRelease);
  const historicalPayloads = bundleNames.map((name) =>
    Buffer.from(`historical ${name}\n`, 'ascii'),
  );
  mkdirSync(historicalRoot);
  for (const [index, name] of bundleNames.entries())
    writeFileSync(join(historicalRoot, name), historicalPayloads[index]);
  const historicalEnvironment = {
    FETANAGENT_FIXTURE_HISTORICAL_RELEASE: historicalRelease,
    FETANAGENT_FIXTURE_HISTORICAL_CONTRACT: historicalPayloads
      .map((data) => `${data.length}:${sha256(data)}`)
      .join(','),
  };
  let historicalResult = historical.runInstaller(historicalEnvironment);
  assert.equal(
    historicalResult.status,
    0,
    `historical bundle blocked successor install: ${historicalResult.stderr}`,
  );
  assert.deepEqual(
    readdirSync(historical.parent).sort(),
    [historicalRelease, installerRelease].sort(),
  );

  const mutatedHistorical = runInstallerFixture('reject-mutated-historical', 'parent-only');
  const mutatedRoot = join(mutatedHistorical.parent, historicalRelease);
  mkdirSync(mutatedRoot);
  for (const [index, name] of bundleNames.entries())
    writeFileSync(
      join(mutatedRoot, name),
      index === 2 ? Buffer.from('mutated historical engine\n', 'ascii') : historicalPayloads[index],
    );
  assert.notEqual(
    mutatedHistorical.runInstaller(historicalEnvironment).status,
    0,
    'a content-mutated historical bundle was accepted',
  );

  const unknownHistorical = runInstallerFixture('reject-unknown-historical', 'parent-only');
  const unknownRoot = join(unknownHistorical.parent, 'b'.repeat(40));
  mkdirSync(unknownRoot);
  for (const [index, name] of bundleNames.entries())
    writeFileSync(join(unknownRoot, name), historicalPayloads[index]);
  assert.notEqual(
    unknownHistorical.runInstaller(historicalEnvironment).status,
    0,
    'an unknown historical release was accepted',
  );

  const malformedHistorical = runInstallerFixture('reject-malformed-historical', 'parent-only');
  mkdirSync(join(malformedHistorical.parent, 'c'.repeat(40)));
  writeFileSync(join(malformedHistorical.parent, 'c'.repeat(40), 'foreign-v1'), 'x\n');
  assert.notEqual(
    malformedHistorical.runInstaller().status,
    0,
    'malformed historical bundle was accepted',
  );

  if (process.platform !== 'win32') {
    const concurrent = runInstallerFixture('concurrent-lock', 'empty-installing');
    const lockRoot = join(concurrent.area, 'lock');
    const ready = join(concurrent.area, 'lock-ready');
    const lockEnvironment = {
      ...process.env,
      FETANAGENT_FIXTURE_BUNDLE_PARENT: concurrent.parent,
      FETANAGENT_FIXTURE_BUNDLE_LOCK_ROOT: lockRoot,
    };
    const first = spawn(resolvePython(), [concurrent.installerPathFixture, ...concurrent.args], {
      encoding: 'utf8',
      env: {
        ...lockEnvironment,
        FETANAGENT_FIXTURE_BUNDLE_LOCK_READY: ready,
        FETANAGENT_FIXTURE_BUNDLE_LOCK_HOLD_SECONDS: '1.0',
      },
    });
    for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    assert.equal(existsSync(ready), true, 'the first installer never acquired its lock');
    const contender = spawnSync(
      resolvePython(),
      [concurrent.installerPathFixture, ...concurrent.args],
      { encoding: 'utf8', env: lockEnvironment },
    );
    assert.notEqual(contender.status, 0, 'a concurrent bundle installer acquired the same lease');
    const firstResult = await new Promise((resolvePromise) => {
      let stdout = '';
      let stderr = '';
      first.stdout.on('data', (chunk) => (stdout += chunk));
      first.stderr.on('data', (chunk) => (stderr += chunk));
      first.on('close', (status) => resolvePromise({ status, stderr, stdout }));
    });
    assert.equal(firstResult.status, 0, `${firstResult.stdout}${firstResult.stderr}`);
  }
} finally {
  rmSync(installerFixtureRoot, { recursive: true, force: true });
}

// Execute the real transaction engine against a portable, no-network P0
// fixture.  This covers P0->P5, exact replay, a P1 short-write resume, and a
// pinned-base tamper rejection without touching Docker or any live path.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-h14-engine-fixture-'));
const posix = (value) => value.replaceAll('\\', '/');
const oldClaim = '22222222-2222-4222-8222-222222222222';
const oldProfile = '11111111-1111-4111-8111-111111111111';
const newProfile = '33333333-3333-4333-8333-333333333333';
const receiptId = '44444444-4444-4444-8444-444444444444';
const fingerprint = 'a'.repeat(64);
const binding = `${oldProfile} hmac-sha256-agent-identity-v1:${fingerprint} hmac-sha256-agent-profile-pin-v3:${fingerprint}\n`;
assert.equal(Buffer.byteLength(binding), 230);
const helperFixture = 'fixture-installed-helper\n';
const helperFixtureSha = sha256(helperFixture);
const ackFixture =
  [
    'version=1',
    `claim_id=${oldClaim}`,
    `receipt_id=${receiptId}`,
    'platform_code=kemerbet',
    `platform_agent_account_id=${newProfile}`,
    'profile_revision=2',
    'configuration_reason=security_recovery',
    'transfer_disabled=true',
    'money_moved=false',
  ].join('\n') + '\n';
const authorizationFixture =
  [
    'version=1',
    'contract=fetanagent-kemerbet-quarantine-recovery-identity-authorization-v1',
    `old_profile_id=${oldProfile}`,
    `old_identity_fingerprint=hmac-sha256-agent-identity-v1:${fingerprint}`,
    `new_profile_id=${newProfile}`,
    'configuration_reason=security_recovery',
    'transfer_disabled=true',
    'money_moved=false',
  ].join('\n') + '\n';
const terminalFixture = `${oldClaim}\n`;
const runtimeFixture =
  [
    'version=1',
    `recovery_release=${canonicalRelease}`,
    `old_claim_id=${oldClaim}`,
    `new_profile_id=${newProfile}`,
    `recovery_identity_authorization_sha256=${sha256(authorizationFixture)}`,
    `database_ack_sha256=${sha256(ackFixture)}`,
    'transfer_disabled=true',
    'money_moved=false',
  ].join('\n') + '\n';
const bridgeRelease = 'a'.repeat(40);
const predecessorBridgeRelease = '066572953de652e53634f562b4a63c0d9103865d';
const expiryServiceSha = 'c206af7923aae32743ddf841ee8e673544e963e5a8730c3c6074fa7852dcd063';
const expiryTimerSha = 'd155578fb560103d3452ba2d489828f29a8a6b8b1d604eb37235f7d5ef07eb48';
const expiryRetirementIntentFixture =
  [
    'version=1',
    'contract=fetanagent-staging-expired-runtime-guard-retirement-v1',
    'state=authorized',
    `bridge_release=${bridgeRelease}`,
    `canonical_h14_release=${canonicalRelease}`,
    'staging_project_ref=spzpiyxheappsfyswewl',
    'staging_droplet_id=593344964',
    'service_name=fetanagent-staging-runtime-expiry-stop.service',
    `service_unit_sha256=${expiryServiceSha}`,
    'timer_name=fetanagent-staging-runtime-expiry-stop.timer',
    `timer_unit_sha256=${expiryTimerSha}`,
    'timer_on_calendar=2026-08-29 12:47:49 UTC',
    'timer_expired=true',
    `installed_helper_sha256=${helperFixtureSha}`,
    'financial_actions_mode=dry_run',
    'provider_action_enabled=false',
    'amount_entry_enabled=false',
    'transfer_enabled=false',
    'money_moved=false',
  ].join('\n') + '\n';
const expiryRetiredFixture =
  [
    'version=1',
    'contract=fetanagent-staging-expired-runtime-guard-retirement-v1',
    'state=completed',
    `bridge_release=${bridgeRelease}`,
    `canonical_h14_release=${canonicalRelease}`,
    `retirement_intent_sha256=${sha256(expiryRetirementIntentFixture)}`,
    'service_load_state=not-found',
    'timer_load_state=not-found',
    'unit_files_absent=true',
    'timer_enablement_link_absent=true',
    'service_active_state=inactive',
    'service_sub_state=dead',
    'service_main_pid=0',
    'service_job_absent=true',
    'timer_active_state=inactive',
    'timer_sub_state=dead',
    'timer_job_absent=true',
    'installed_helper_changed=false',
    'financial_actions_mode=dry_run',
    'provider_action_enabled=false',
    'amount_entry_enabled=false',
    'transfer_enabled=false',
    'money_moved=false',
  ].join('\n') + '\n';
const predecessorPayloads = new Map(
  bundleNames.map((name) => [name, Buffer.from(`predecessor ${name}\n`, 'ascii')]),
);
assert.equal(Buffer.byteLength(authorizationFixture), 389);
const portableEnginePath = join(fixtureRoot, 'portable-engine.py');
writeFileSync(
  portableEnginePath,
  engine
    .replace('PORTABLE_FIXTURE = False', 'PORTABLE_FIXTURE = True')
    .replace('QUARANTINED_PROFILE_MAX_OBJECTS = 512', 'QUARANTINED_PROFILE_MAX_OBJECTS = 32')
    .replace(
      'QUARANTINED_PROFILE_MAX_FILE_BYTES = 8 * 1024 * 1024',
      'QUARANTINED_PROFILE_MAX_FILE_BYTES = 1024',
    )
    .replace(
      'QUARANTINED_PROFILE_MAX_TOTAL_BYTES = 16 * 1024 * 1024',
      'QUARANTINED_PROFILE_MAX_TOTAL_BYTES = 2048',
    )
    .replace(
      'except BaseException:\n    raise SystemExit(1)',
      'except BaseException:\n    import traceback\n    traceback.print_exc()\n    raise SystemExit(1)',
    )
    .replace(
      '        if invalid:\n            reject()',
      '        if invalid:\n            print("portable exact failure", path, before.st_nlink, before.st_size, maximum, exact_size, file=sys.stderr)\n            reject()',
    ),
);

function makeEngineFixture(name) {
  const area = posix(join(fixtureRoot, name));
  const h14Parent = `${area}/h14`;
  const h14Root = `${h14Parent}/${canonicalRelease}`;
  const helper = `${area}/helper`;
  const control = `${area}/control`;
  const receipts = `${area}/receipts`;
  const bridgeParent = `${area}/bridge`;
  const ledger = `${bridgeParent}/.installing-${bridgeRelease}`;
  const intentPath = `${ledger}/intent-v1`;
  const completionPath = `${ledger}/completed-v1`;
  const expiryIntentPath = `${ledger}/expiry-guard-retirement-intent-v1`;
  const expiryRetiredPath = `${ledger}/expiry-guard-retired-v1`;
  const predecessorBridgeParent = `${area}/predecessor-bridge`;
  const predecessorInstalling = `${predecessorBridgeParent}/.installing-${predecessorBridgeRelease}`;
  const predecessorBundleRoot = `${area}/predecessor-bundle`;
  for (const path of [h14Root, control, receipts, ledger]) mkdirSync(path, { recursive: true });
  mkdirSync(predecessorInstalling, { recursive: true });
  mkdirSync(predecessorBundleRoot, { recursive: true });
  for (const [entry, data] of predecessorPayloads)
    writeFileSync(`${predecessorBundleRoot}/${entry}`, data);
  writeFileSync(expiryIntentPath, expiryRetirementIntentFixture);
  writeFileSync(expiryRetiredPath, expiryRetiredFixture);
  chmodSync(expiryIntentPath, 0o600);
  chmodSync(expiryRetiredPath, 0o600);
  writeFileSync(helper, helperFixture);
  const h14Intent =
    [
      'contract=fetanagent-kemerbet-quarantine-recovery-v14',
      'state=authorized',
      `recovery_release=${canonicalRelease}`,
      `predecessor_release=${'b'.repeat(40)}`,
      `predecessor_helper_sha256=${'c'.repeat(64)}`,
      `successor_helper_sha256=${helperFixtureSha}`,
      `authorization_sha256=${authorizationSha}`,
      `old_claim_id=${oldClaim}`,
      `old_profile_id=${oldProfile}`,
      `old_binding_sha256=${sha256(binding)}`,
      `old_player_ids_sha256=${'d'.repeat(64)}`,
      'retired_binding_dev_ino=1:1',
      'player_stage_dev_ino=1:2',
      'claim_stage_dev_ino=1:3',
      'quarantined_profile_dev_ino=1:4',
      'financial_actions_mode=dry_run',
      'kemerbet_executor_enabled=false',
      'kemerbet_final_action_enabled=false',
      'transfer_enabled=false',
      'amount_entry_enabled=false',
      'lookup_authorized=false',
      'recheck_authorized=false',
    ].join('\n') + '\n';
  for (const entry of baseNames) {
    if (entry === 'quarantined-profile-v1') continue;
    let data = 'fixture\n';
    if (entry === 'intent-v1') data = h14Intent;
    if (entry === 'retired-binding-v3') data = binding;
    if (entry === 'retired-retryable-failure-v1') data = `${oldClaim}\n`;
    writeFileSync(`${h14Root}/${entry}`, data);
  }
  mkdirSync(`${h14Root}/quarantined-profile-v1`);
  chmodSync(`${h14Root}/quarantined-profile-v1`, 0o700);
  writeFileSync(
    `${h14Root}/quarantined-profile-v1/.fetanagent-unclean-session-generation-v1`,
    'fetanagent-kemerbet-session-active-v1\n',
  );
  chmodSync(`${h14Root}/quarantined-profile-v1/.fetanagent-unclean-session-generation-v1`, 0o600);
  mkdirSync(`${h14Root}/quarantined-profile-v1/Default/Session Storage`, { recursive: true });
  chmodSync(`${h14Root}/quarantined-profile-v1/Default`, 0o700);
  chmodSync(`${h14Root}/quarantined-profile-v1/Default/Session Storage`, 0o700);
  writeFileSync(`${h14Root}/quarantined-profile-v1/Local State`, '{"retired":true}\n');
  chmodSync(`${h14Root}/quarantined-profile-v1/Local State`, 0o600);
  writeFileSync(
    `${h14Root}/quarantined-profile-v1/Default/Session Storage/000001.log`,
    'retained quarantined browser state\n',
  );
  chmodSync(`${h14Root}/quarantined-profile-v1/Default/Session Storage/000001.log`, 0o600);
  const ackSource = `${control}/kemerbet-quarantine-recovery-profile-prepared-v1`;
  writeFileSync(ackSource, ackFixture);
  const markerSource = `${receipts}/kemerbet-readiness-cohort-security-recovery-failed-terminal-v1`;
  const markerTarget = `${receipts}/kemerbet-readiness-cohort-security-recovery-profile-finalized-v1`;
  writeFileSync(markerSource, `${oldClaim}\n`);
  const env = {
    ...process.env,
    FETANAGENT_FIXTURE_HELPER_SHA256: helperFixtureSha,
    FETANAGENT_FIXTURE_H14_PARENT: h14Parent,
    FETANAGENT_FIXTURE_BRIDGE_PARENT: bridgeParent,
    FETANAGENT_FIXTURE_HELPER_PATH: helper,
    FETANAGENT_FIXTURE_ACK_SOURCE: ackSource,
    FETANAGENT_FIXTURE_MARKER_SOURCE: markerSource,
    FETANAGENT_FIXTURE_MARKER_TARGET: markerTarget,
    FETANAGENT_FIXTURE_PREDECESSOR_BRIDGE_PARENT: predecessorBridgeParent,
    FETANAGENT_FIXTURE_PREDECESSOR_BUNDLE_ROOT: predecessorBundleRoot,
  };
  for (const [index, data] of [...predecessorPayloads.values()].entries()) {
    env[`FETANAGENT_FIXTURE_PREDECESSOR_SIZE_${index}`] = String(data.length);
    env[`FETANAGENT_FIXTURE_PREDECESSOR_SHA256_${index}`] = sha256(data);
  }
  const common = [
    h14Root,
    helper,
    ackSource,
    markerSource,
    markerTarget,
    bridgeRelease,
    '1'.repeat(64),
    '2'.repeat(64),
    '3'.repeat(64),
    '4'.repeat(64),
    intentPath,
    completionPath,
  ];
  const run = (mode) =>
    spawnSync(resolvePython(), [portableEnginePath, mode, ...common], {
      encoding: null,
      env,
    });
  return {
    ackSource,
    completionPath,
    expiryIntentPath,
    expiryRetiredPath,
    h14Root,
    intentPath,
    markerSource,
    markerTarget,
    predecessorBridgeParent,
    predecessorBundleRoot,
    run,
  };
}

try {
  const normal = makeEngineFixture('normal');
  let result = normal.run('emit-intent');
  assert.equal(result.status, 0, result.stderr?.toString());
  writeFileSync(normal.intentPath, result.stdout);
  chmodSync(normal.intentPath, 0o600);
  const emittedAgain = normal.run('emit-intent');
  assert.equal(emittedAgain.status, 0, emittedAgain.stderr?.toString());
  assert.deepEqual(emittedAgain.stdout, result.stdout, 'portable intent was not stable');
  result = normal.run('finalize');
  assert.equal(result.status, 0, result.stderr?.toString());
  result = normal.run('emit-completion');
  assert.equal(result.status, 0, result.stderr?.toString());
  writeFileSync(normal.completionPath, result.stdout);
  chmodSync(normal.completionPath, 0o600);
  assert.equal(normal.run('verify-completed').status, 0, 'exact completed replay failed');
  assert.equal(normal.run('verify-completed').status, 0, 'second exact replay failed');
  writeFileSync(`${normal.h14Root}/host-retired-v1`, 'tampered\n');
  assert.notEqual(normal.run('verify-completed').status, 0, 'pinned-base tamper was accepted');

  const predecessorReplay = makeEngineFixture('completed-predecessor-replay');
  result = predecessorReplay.run('emit-intent');
  assert.equal(result.status, 0, result.stderr?.toString());
  writeFileSync(predecessorReplay.intentPath, result.stdout);
  chmodSync(predecessorReplay.intentPath, 0o600);
  assert.equal(predecessorReplay.run('finalize').status, 0);
  result = predecessorReplay.run('emit-completion');
  assert.equal(result.status, 0, result.stderr?.toString());
  writeFileSync(predecessorReplay.completionPath, result.stdout);
  chmodSync(predecessorReplay.completionPath, 0o600);
  assert.equal(predecessorReplay.run('verify-completed').status, 0);
  rmSync(`${predecessorReplay.predecessorBundleRoot}/${bundleNames[0]}`);
  assert.notEqual(
    predecessorReplay.run('verify-completed').status,
    0,
    'completed replay ignored missing failed-predecessor evidence',
  );

  const interrupted = makeEngineFixture('p1-short-write');
  result = interrupted.run('emit-intent');
  assert.equal(result.status, 0, result.stderr?.toString());
  writeFileSync(interrupted.intentPath, result.stdout);
  chmodSync(interrupted.intentPath, 0o600);
  const partial = `${interrupted.h14Root}/.recovery-identity-authorization-v1.installing`;
  writeFileSync(partial, authorizationFixture.slice(0, 71));
  chmodSync(partial, 0o600);
  result = interrupted.run('finalize');
  assert.equal(result.status, 0, result.stderr?.toString() || 'P1 append-complete recovery failed');

  const seedPhase = (fixture, phase) => {
    const authorizationPath = `${fixture.h14Root}/recovery-identity-authorization-v1`;
    const terminalPath = `${fixture.h14Root}/terminal-recovery-marker-v1`;
    const ackTarget = `${fixture.h14Root}/database-profile-prepared-v1`;
    const runtimePath = `${fixture.h14Root}/runtime-ready-v1`;
    if (phase === 'P0') return;
    if (phase === 'P1-auth-prefix') {
      writeFileSync(
        `${fixture.h14Root}/.recovery-identity-authorization-v1.installing`,
        authorizationFixture.slice(0, 137),
      );
      return;
    }
    writeFileSync(authorizationPath, authorizationFixture);
    chmodSync(authorizationPath, 0o440);
    if (phase === 'P1-auth') return;
    if (phase === 'P2-terminal-prefix') {
      writeFileSync(
        `${fixture.h14Root}/.terminal-recovery-marker-v1.installing`,
        terminalFixture.slice(0, 19),
      );
      return;
    }
    writeFileSync(terminalPath, terminalFixture);
    chmodSync(terminalPath, 0o440);
    if (phase === 'P2-terminal') return;
    renameSync(fixture.markerSource, fixture.markerTarget);
    if (phase === 'P2-latch-moved') return;
    renameSync(fixture.ackSource, ackTarget);
    if (phase === 'P3-ack') return;
    if (phase === 'P4-runtime-prefix') {
      writeFileSync(
        `${fixture.h14Root}/.runtime-ready-v1.installing`,
        runtimeFixture.slice(0, 211),
      );
      return;
    }
    writeFileSync(runtimePath, runtimeFixture);
    chmodSync(runtimePath, 0o600);
    assert.equal(phase, 'P5-runtime');
  };

  // Exercise the real engine from every append/rename crash prefix.  Each
  // fixture starts with the same durable intent, is interrupted at one exact
  // P0-P5 boundary, resumes to P5, emits its full completion ledger, and then
  // accepts only exact replay.
  for (const phase of [
    'P0',
    'P1-auth-prefix',
    'P1-auth',
    'P2-terminal-prefix',
    'P2-terminal',
    'P2-latch-moved',
    'P3-ack',
    'P4-runtime-prefix',
    'P5-runtime',
  ]) {
    const fixture = makeEngineFixture(`phase-${phase}`);
    result = fixture.run('emit-intent');
    assert.equal(result.status, 0, `${phase}: ${result.stderr?.toString()}`);
    writeFileSync(fixture.intentPath, result.stdout);
    chmodSync(fixture.intentPath, 0o600);
    seedPhase(fixture, phase);
    result = fixture.run('finalize');
    assert.equal(result.status, 0, `${phase} resume: ${result.stderr?.toString()}`);
    result = fixture.run('emit-completion');
    assert.equal(result.status, 0, `${phase} completion: ${result.stderr?.toString()}`);
    writeFileSync(fixture.completionPath, result.stdout);
    chmodSync(fixture.completionPath, 0o600);
    assert.equal(fixture.run('verify-completed').status, 0, `${phase} replay failed`);
  }

  const expectRejected = (name, mutate, mode = 'finalize') => {
    const fixture = makeEngineFixture(`reject-${name}`);
    const emitted = fixture.run('emit-intent');
    assert.equal(emitted.status, 0, `${name}: fixture intent failed`);
    writeFileSync(fixture.intentPath, emitted.stdout);
    chmodSync(fixture.intentPath, 0o600);
    mutate(fixture);
    assert.notEqual(fixture.run(mode).status, 0, `${name} was accepted`);
  };
  expectRejected('foreign-entry', (fixture) =>
    writeFileSync(`${fixture.h14Root}/foreign-v1`, 'x\n'),
  );
  expectRejected('missing-base', (fixture) => rmSync(`${fixture.h14Root}/host-retired-v1`));
  expectRejected('non-prefix-auth', (fixture) =>
    writeFileSync(
      `${fixture.h14Root}/.recovery-identity-authorization-v1.installing`,
      'not-a-prefix\n',
    ),
  );
  expectRejected('marker-moved-before-terminal', (fixture) =>
    renameSync(fixture.markerSource, fixture.markerTarget),
  );
  expectRejected('ack-moved-before-marker', (fixture) => {
    writeFileSync(`${fixture.h14Root}/recovery-identity-authorization-v1`, authorizationFixture);
    writeFileSync(`${fixture.h14Root}/terminal-recovery-marker-v1`, terminalFixture);
    renameSync(fixture.ackSource, `${fixture.h14Root}/database-profile-prepared-v1`);
  });
  expectRejected('duplicate-ack', (fixture) =>
    writeFileSync(`${fixture.h14Root}/database-profile-prepared-v1`, ackFixture),
  );
  expectRejected('tampered-intent', (fixture) =>
    writeFileSync(
      fixture.intentPath,
      `${readFileSync(fixture.intentPath, 'utf8')}unexpected=true\n`,
    ),
  );
  expectRejected('ack-same-bytes-new-inode', (fixture) => {
    const before = statSync(fixture.ackSource).ino;
    renameSync(fixture.ackSource, `${fixture.ackSource}.replaced`);
    writeFileSync(fixture.ackSource, ackFixture);
    assert.notEqual(statSync(fixture.ackSource).ino, before);
  });
  expectRejected('terminal-same-bytes-new-inode', (fixture) => {
    const before = statSync(fixture.markerSource).ino;
    renameSync(fixture.markerSource, `${fixture.markerSource}.replaced`);
    writeFileSync(fixture.markerSource, terminalFixture);
    assert.notEqual(statSync(fixture.markerSource).ino, before);
  });
  expectRejected('changed-valid-profile-ack', (fixture) => {
    renameSync(fixture.ackSource, `${fixture.ackSource}.replaced`);
    writeFileSync(
      fixture.ackSource,
      ackFixture.replace(newProfile, '55555555-5555-4555-8555-555555555555'),
    );
  });
  expectRejected('expiry-retirement-intent-tamper', (fixture) =>
    writeFileSync(fixture.expiryIntentPath, `${expiryRetirementIntentFixture}unexpected=true\n`),
  );
  expectRejected('expiry-retired-tamper', (fixture) =>
    writeFileSync(fixture.expiryRetiredPath, `${expiryRetiredFixture}unexpected=true\n`),
  );
  expectRejected('quarantined-profile-content-tamper', (fixture) =>
    writeFileSync(`${fixture.h14Root}/quarantined-profile-v1/Local State`, '{"retired":false}\n'),
  );
  expectRejected('quarantined-profile-foreign-file', (fixture) =>
    writeFileSync(`${fixture.h14Root}/quarantined-profile-v1/foreign-v1`, 'unexpected\n'),
  );
  expectRejected('quarantined-profile-same-bytes-new-inode', (fixture) => {
    const path = `${fixture.h14Root}/quarantined-profile-v1/Local State`;
    const replacement = `${path}.replaced`;
    const before = statSync(path).ino;
    const data = readFileSync(path);
    renameSync(path, replacement);
    writeFileSync(path, data);
    assert.notEqual(statSync(path).ino, before);
  });
  expectRejected('quarantined-profile-object-limit', (fixture) => {
    const directory = `${fixture.h14Root}/quarantined-profile-v1/Default/too-many`;
    mkdirSync(directory);
    chmodSync(directory, 0o700);
    for (let index = 0; index < 40; index += 1) {
      const path = `${directory}/${String(index).padStart(2, '0')}`;
      writeFileSync(path, 'x');
      chmodSync(path, 0o600);
    }
  });
  expectRejected('quarantined-profile-file-limit', (fixture) =>
    writeFileSync(
      `${fixture.h14Root}/quarantined-profile-v1/Default/oversized`,
      Buffer.alloc(1025),
    ),
  );
  expectRejected('quarantined-profile-total-limit', (fixture) => {
    for (let index = 0; index < 3; index += 1)
      writeFileSync(
        `${fixture.h14Root}/quarantined-profile-v1/Default/total-${index}`,
        Buffer.alloc(800, index),
      );
  });
  if (process.platform !== 'win32') {
    expectRejected('quarantined-profile-hardlink', (fixture) =>
      linkSync(
        `${fixture.h14Root}/quarantined-profile-v1/Local State`,
        `${fixture.h14Root}/quarantined-profile-v1/linked-state`,
      ),
    );
    expectRejected('quarantined-profile-file-mode', (fixture) =>
      chmodSync(`${fixture.h14Root}/quarantined-profile-v1/Local State`, 0o755),
    );
    expectRejected('quarantined-profile-directory-mode', (fixture) =>
      chmodSync(`${fixture.h14Root}/quarantined-profile-v1/Default`, 0o755),
    );
    expectRejected('quarantined-profile-depth-limit', (fixture) => {
      let directory = `${fixture.h14Root}/quarantined-profile-v1`;
      for (let depth = 0; depth < 9; depth += 1) {
        directory = `${directory}/d${depth}`;
        mkdirSync(directory);
        chmodSync(directory, 0o700);
      }
    });
    expectRejected('quarantined-profile-name-limit', (fixture) => {
      const path = `${fixture.h14Root}/quarantined-profile-v1/${'n'.repeat(129)}`;
      writeFileSync(path, 'x');
      chmodSync(path, 0o600);
    });
    expectRejected('quarantined-profile-path-limit', (fixture) => {
      const directory = `${fixture.h14Root}/quarantined-profile-v1/${'p'.repeat(128)}`;
      mkdirSync(directory);
      chmodSync(directory, 0o700);
      const path = `${directory}/${'q'.repeat(128)}`;
      writeFileSync(path, 'x');
      chmodSync(path, 0o600);
    });
    expectRejected('quarantined-profile-symlink', (fixture) =>
      symlinkSync('Local State', `${fixture.h14Root}/quarantined-profile-v1/profile-state-link`),
    );
    expectRejected('quarantined-profile-fifo', (fixture) => {
      const fifo = `${fixture.h14Root}/quarantined-profile-v1/profile-state-fifo`;
      assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
      chmodSync(fifo, 0o600);
    });
    if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
      expectRejected('quarantined-profile-scan-error', (fixture) => {
        const unreadable = `${fixture.h14Root}/quarantined-profile-v1/unreadable`;
        mkdirSync(unreadable);
        chmodSync(unreadable, 0o000);
      });
    }
  }
} finally {
  const resolvedFixtureRoot = resolve(fixtureRoot);
  const fixtureRelativeToTemp = relative(resolve(tmpdir()), resolvedFixtureRoot);
  assert.ok(
    fixtureRelativeToTemp !== '' &&
      fixtureRelativeToTemp !== '..' &&
      !fixtureRelativeToTemp.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
      !isAbsolute(fixtureRelativeToTemp),
    'the H14 engine fixture cleanup target must remain inside the OS temporary directory',
  );
  try {
    rmSync(resolvedFixtureRoot, { recursive: true, force: true });
  } catch (error) {
    if (
      process.platform === 'win32' ||
      typeof process.getuid !== 'function' ||
      process.getuid() === 0 ||
      !(error instanceof Error && 'code' in error && ['EACCES', 'EPERM'].includes(error.code))
    ) {
      throw error;
    }
    const removal = spawnSync('sudo', ['-n', 'rm', '-rf', '--', resolvedFixtureRoot], {
      encoding: 'utf8',
    });
    assert.equal(removal.status, 0, removal.stderr || 'root-owned H14 fixture cleanup failed');
    assert.equal(existsSync(resolvedFixtureRoot), false);
  }
}

// Execute the bridge-ledger namespace classifier and append-complete publisher
// against the filesystem prefixes a crash can leave before H14 mutation.  The
// production publisher additionally enforces root ownership, mode, link count,
// O_NOFOLLOW, fsync, and directory identity; those Linux-only invariants are
// asserted directly against the staged script above.
const ledgerFixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-h14-ledger-fixture-'));
const portableIntent = Buffer.from(
  'version=1\ncontract=fetanagent-h14-empty-profile-fixture\nstate=authorized\n',
  'ascii',
);
const portableCompletion = Buffer.from(
  'version=1\ncontract=fetanagent-h14-empty-profile-fixture\nstate=completed\n',
  'ascii',
);
const appendCompletePortable = (target, expected) => {
  const temporary = join(resolve(target, '..'), `.${target.split(/[\\/]/u).at(-1)}.installing`);
  if (existsSync(target)) {
    assert.equal(existsSync(temporary), false);
    assert.deepEqual(readFileSync(target), expected);
    return;
  }
  if (!existsSync(temporary)) writeFileSync(temporary, Buffer.alloc(0));
  const prefix = readFileSync(temporary);
  assert.ok(prefix.length <= expected.length && prefix.equals(expected.subarray(0, prefix.length)));
  appendFileSync(temporary, expected.subarray(prefix.length));
  assert.deepEqual(readFileSync(temporary), expected);
  renameSync(temporary, target);
};
const allowedInstallingEntries = new Set([
  'expiry-guard-retired-v1\nexpiry-guard-retirement-intent-v1',
  '.intent-v1.installing\nexpiry-guard-retired-v1\nexpiry-guard-retirement-intent-v1',
  'expiry-guard-retired-v1\nexpiry-guard-retirement-intent-v1\nintent-v1',
  '.completed-v1.installing\nexpiry-guard-retired-v1\nexpiry-guard-retirement-intent-v1\nintent-v1',
  'completed-v1\nexpiry-guard-retired-v1\nexpiry-guard-retirement-intent-v1\nintent-v1',
]);
const resumeLedgerPortable = (name, prefix) => {
  const parent = join(ledgerFixtureRoot, name);
  const installing = join(parent, `.installing-${'a'.repeat(40)}`);
  mkdirSync(parent, { recursive: true });
  if (prefix !== 'parent-only') mkdirSync(installing);
  if (prefix === 'partial-intent') {
    writeFileSync(join(installing, '.intent-v1.installing'), portableIntent.subarray(0, 31));
  } else if (prefix === 'intent') {
    writeFileSync(join(installing, 'intent-v1'), portableIntent);
  }
  if (!existsSync(installing)) mkdirSync(installing);
  writeFileSync(
    join(installing, 'expiry-guard-retirement-intent-v1'),
    expiryRetirementIntentFixture,
  );
  writeFileSync(join(installing, 'expiry-guard-retired-v1'), expiryRetiredFixture);
  const before = readdirSync(installing).sort().join('\n');
  assert.ok(allowedInstallingEntries.has(before), `${prefix}: invalid initial namespace`);
  appendCompletePortable(join(installing, 'intent-v1'), portableIntent);
  assert.deepEqual(readFileSync(join(installing, 'intent-v1')), portableIntent);
  assert.deepEqual(readdirSync(installing).sort(), [
    'expiry-guard-retired-v1',
    'expiry-guard-retirement-intent-v1',
    'intent-v1',
  ]);
  return installing;
};
try {
  for (const prefix of ['parent-only', 'empty-installing', 'partial-intent', 'intent']) {
    const installing = resumeLedgerPortable(`resume-${prefix}`, prefix);
    for (let fault = 0; fault <= portableCompletion.length; fault += 1) {
      const temporary = join(installing, '.completed-v1.installing');
      if (existsSync(temporary)) rmSync(temporary);
      if (existsSync(join(installing, 'completed-v1'))) rmSync(join(installing, 'completed-v1'));
      writeFileSync(temporary, portableCompletion.subarray(0, fault));
      appendCompletePortable(join(installing, 'completed-v1'), portableCompletion);
      assert.deepEqual(readFileSync(join(installing, 'completed-v1')), portableCompletion);
    }
  }
  const foreign = join(ledgerFixtureRoot, 'foreign', `.installing-${'a'.repeat(40)}`);
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'foreign-v1'), 'x\n');
  assert.equal(allowedInstallingEntries.has(readdirSync(foreign).sort().join('\n')), false);
  const tampered = join(ledgerFixtureRoot, 'tampered', `.installing-${'a'.repeat(40)}`);
  mkdirSync(tampered, { recursive: true });
  writeFileSync(join(tampered, '.intent-v1.installing'), 'wrong-prefix\n');
  assert.throws(() => appendCompletePortable(join(tampered, 'intent-v1'), portableIntent));
} finally {
  rmSync(ledgerFixtureRoot, { recursive: true, force: true });
}

const base = new Set(baseNames);
const plus = (...names) => new Set([...base, ...names]);
const phases = [
  base,
  plus('.recovery-identity-authorization-v1.installing'),
  plus('recovery-identity-authorization-v1'),
  plus('recovery-identity-authorization-v1', '.terminal-recovery-marker-v1.installing'),
  plus('recovery-identity-authorization-v1', 'terminal-recovery-marker-v1'),
  plus(
    'recovery-identity-authorization-v1',
    'terminal-recovery-marker-v1',
    'database-profile-prepared-v1',
  ),
  plus(
    'recovery-identity-authorization-v1',
    'terminal-recovery-marker-v1',
    'database-profile-prepared-v1',
    '.runtime-ready-v1.installing',
  ),
  plus(
    'recovery-identity-authorization-v1',
    'terminal-recovery-marker-v1',
    'database-profile-prepared-v1',
    'runtime-ready-v1',
  ),
];
const key = (entries) => [...entries].sort().join('\n');
const accepted = new Set(phases.map(key));
for (const [index, phase] of phases.entries()) {
  assert.ok(accepted.has(key(phase)), `P${index} was rejected`);
}
for (const name of baseNames) {
  const missing = new Set(base);
  missing.delete(name);
  assert.equal(accepted.has(key(missing)), false, `missing base entry accepted: ${name}`);
  assert.equal(accepted.has(key(new Set([...base, `${name}.tampered`]))), false);
}
for (const malformed of [
  plus('foreign-v1'),
  plus('runtime-ready-v1'),
  plus('cohort-prepared-v1'),
  plus('recovery-identity-authorization-v1', 'terminal-recovery-marker-v1', 'resealed-v1'),
  plus(
    'recovery-identity-authorization-v1',
    'terminal-recovery-marker-v1',
    'database-profile-prepared-v1',
    'runtime-ready-v1',
    'cohort-prepared-v1',
  ),
]) {
  assert.equal(accepted.has(key(malformed)), false, 'malformed/late state was accepted');
}

const expectedLedger = Buffer.from('version=1\nstate=completed\n', 'ascii');
for (let fault = 0; fault <= expectedLedger.length; fault += 1) {
  const prefix = expectedLedger.subarray(0, fault);
  assert.deepEqual(Buffer.concat([prefix, expectedLedger.subarray(prefix.length)]), expectedLedger);
}
const tamperedLedger = Buffer.from(expectedLedger);
tamperedLedger[5] ^= 1;
assert.equal(tamperedLedger.equals(expectedLedger), false, 'ledger tamper fixture is invalid');
assert.deepEqual(Buffer.from(expectedLedger), expectedLedger, 'exact replay fixture failed');

assert.match(workflow, /h14-empty-profile-finalization-bridge-stage/);
assert.match(
  workflow,
  /session-action:\n[\s\S]*?if: inputs\.mode != 'h14-empty-profile-finalization-bridge-stage'\n\s+needs: validate-target/,
);
assert.match(
  workflow,
  /h14-empty-profile-finalization-bridge-stage:\n\s+name: Stage immutable H14 empty-profile finalization bridge\n\s+if: inputs\.mode == 'h14-empty-profile-finalization-bridge-stage'\n\s+needs: validate-target/,
);
assert.match(workflow, /pull-requests: read/);
assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
assert.match(
  workflow,
  /else\n\s+\[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]\n\s+\[\[ "\$CONFIRMED_COMMIT" =~ \^\[0-9a-f\]\{40\}\$ && "\$CONFIRMED_COMMIT" == "\$GITHUB_SHA" \]\]\n\s+\[\[ -z "\$CONFIRMED_BRIDGE_IMPLEMENTATION_SHA" && -z "\$CONFIRMED_NO_PROVIDER_ACTION" \]\]/,
);
assert.equal(
  workflow.split('gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main"').length - 1,
  2,
  'the exact canonical-main API proof must run before and inside the protected stage job',
);
assert.equal(
  workflow.split('gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls"').length - 1,
  2,
  'the exact open-PR relationship must be proved before and inside the protected stage job',
);
assert.equal(
  workflow.split('!= "$CANONICAL_H14_COMMIT"').length - 1,
  2,
  'both branch gates must reject the canonical main SHA as the bridge implementation',
);
const bridgeJob = workflow.split('  h14-empty-profile-finalization-bridge-stage:\n')[1];
assert.ok(bridgeJob, 'the registered branch-only bridge job is absent');
assert.match(
  bridgeJob,
  /Check out the exact bridge release[\s\S]*?persist-credentials: false\n\s+fetch-depth: 0\n\s+ref: \$\{\{ env\.CONFIRMED_BRIDGE_IMPLEMENTATION_SHA \}\}/,
  'the bridge verifier fixtures require the exact historical helper commits',
);
const bridgeSteps = bridgeJob.split('    steps:\n')[1];
assert.ok(bridgeSteps, 'the registered branch-only bridge steps are absent');
assert.doesNotMatch(
  bridgeSteps,
  /\$\{\{ inputs\./,
  'a user input is interpolated directly into a bridge shell or action step',
);
assert.doesNotMatch(bridgeJob, /^\s+(?:sudo\s|exec bash|\/usr\/bin\/python3 -I)/mu);
assert.match(workflow, /fetanagent-kemerbet-h14-empty-profile-finalization-engine\.py/);
assert.match(workflow, /contract=fetanagent-kemerbet-h14-empty-profile-finalization-bundle/);
assert.match(workflow, /manifest_sha/);
assert.match(workflow, /Stage four immutable bundle files and the no-secret installer/);
assert.match(
  workflow,
  /Staged only; execute after the Owner security-recovery acknowledgement exists\./,
);
assert.match(workflow, /fetanagent-kemerbet-h14-empty-profile-finalization-bundle-installer\.py/);
assert.match(
  workflow,
  /PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin; export PATH/,
);
assert.match(workflow, /\/usr\/bin\/install -o root -g root -m 0400 -T "\$installer" "\$loader"/);
assert.match(workflow, /\/usr\/bin\/python3 -I "\$loader"/);
assert.doesNotMatch(workflow, /python3 -I "\$installer"/);
assert.match(workflow, /rm -f -- "\$loader"; sync -f \/run; trap - EXIT/);
assert.match(workflow, /exec bash/);
assert.doesNotMatch(workflow, /supabase\s+(?:db|migration|functions|secrets)/i);
assert.match(diagnostic, /sys\.stdout\.write\("PASS H14-D000\\n"\)/);
assert.match(
  packageSource,
  /node infra\/verify-kemerbet-h14-host-retired-empty-profile-finalization-bridge\.mjs/,
);

const emitterMarker = '      - name: Emit exact root-console installation without execution\n';
assert.equal(workflow.split(emitterMarker).length - 1, 1);
const emitterTail = workflow.split(emitterMarker)[1];
const emitterRunMarker = '        run: |\n';
assert.equal(emitterTail.split(emitterRunMarker).length - 1, 1);
const emitter = emitterTail
  .split(emitterRunMarker)[1]
  .split('\n')
  .map((line) => line.replace(/^ {10}/u, ''))
  .join('\n');
const bash = resolveBash();
assert.equal(spawnSync(bash, ['-n'], { input: emitter, encoding: 'utf8' }).status, 0);
const summaryFixture = mkdtempSync(join(tmpdir(), 'fetanagent-h14-workflow-summary-'));
try {
  const summaryPath = join(summaryFixture, 'summary.md');
  const result = spawnSync(bash, ['-s'], {
    input: emitter,
    encoding: 'utf8',
    env: {
      ...process.env,
      CONFIRMED_BRIDGE_IMPLEMENTATION_SHA: 'e'.repeat(40),
      staging: `/tmp/fetanagent-h14-empty-profile-finalization-1-1-${'e'.repeat(40)}`,
      script_sha: '1'.repeat(64),
      diagnostic_sha: '2'.repeat(64),
      engine_sha: '3'.repeat(64),
      installer_sha: '4'.repeat(64),
      manifest_sha: '5'.repeat(64),
      script_size: '10',
      diagnostic_size: '11',
      engine_size: '12',
      installer_size: '13',
      manifest_size: '14',
      GITHUB_STEP_SUMMARY: summaryPath,
    },
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const summary = read(summaryPath);
  const emittedBlock = summary.match(/```bash\n([\s\S]*?)\n```/u);
  assert.ok(emittedBlock, 'the root-console block was not emitted');
  const syntax = spawnSync(bash, ['-n'], { input: emittedBlock[1], encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${syntax.stdout}${syntax.stderr}`);
} finally {
  rmSync(summaryFixture, { recursive: true, force: true });
}

console.log('KemerBet H14 empty-profile finalization bridge verification passed.');
