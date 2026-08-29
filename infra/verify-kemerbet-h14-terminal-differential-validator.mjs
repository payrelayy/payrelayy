import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const diagnosticPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-h14-terminal-differential-validator.py',
);
const diagnostic = readFileSync(diagnosticPath, 'utf8').replaceAll('\r\n', '\n');

const canonicalRepairCommit = 'a579e3bf96c075dde9c36dbe3c66c09aaf84bc52';
const h13Release = '306818ca812bd2abce8479396c4eea8383ea00f9';
const emptyCheckpointRelease = '4239201b5496bd08912cce4b5581fe19b29a84d4';
const release = 'a'.repeat(40);
const authorizationSha = '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874';
const h13HelperSha = '3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa';
const helperSha = 'c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58';
const claim = '11111111-1111-4111-8111-111111111111';
const otherClaim = '99999999-9999-4999-8999-999999999999';
const profile = '22222222-2222-4222-8222-222222222222';
const ownerId = '3'.repeat(64);
const ownerContract = '4'.repeat(64);
const playerSha = '5'.repeat(64);
const identitySha = '6'.repeat(64);
const terminalName = 'kemerbet-readiness-cohort-security-recovery-failed-terminal-v1';
const finalizedName = 'kemerbet-readiness-cohort-security-recovery-profile-finalized-v1';
const profileAckName = 'kemerbet-quarantine-recovery-profile-prepared-v1';

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolvePython() {
  const candidates = [
    process.env.FETANAGENT_TEST_PYTHON,
    process.platform === 'win32'
      ? join(
          process.env.USERPROFILE ?? '',
          '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
        )
      : '/usr/bin/python3',
    'python3',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Python 3 is required for the H14 differential-validator fixtures');
}

const python = resolvePython();
const portableDiagnostic = diagnostic.replace(
  'PORTABLE_FIXTURE = False',
  'PORTABLE_FIXTURE = True',
);
assert.notEqual(portableDiagnostic, diagnostic, 'portable fixture rewrite must be test-only');

const predecessor = spawnSync(
  'git',
  ['show', `${h13Release}:infra/operations/fetanagent-staging-deploy-helper.sh`],
  { cwd: root, encoding: null, maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(predecessor.status, 0, predecessor.stderr?.toString('utf8'));
assert.equal(sha(predecessor.stdout), h13HelperSha, 'fixture needs the exact H13 helper bytes');
const canonicalHelper = spawnSync(
  'git',
  ['show', `${canonicalRepairCommit}:infra/operations/fetanagent-staging-deploy-helper.sh`],
  { cwd: root, encoding: null, maxBuffer: 4 * 1024 * 1024 },
);
assert.equal(canonicalHelper.status, 0, canonicalHelper.stderr?.toString('utf8'));
assert.equal(
  sha(canonicalHelper.stdout),
  helperSha,
  'diagnostic must be tested against canonical c36 helper bytes',
);

function writeExact(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) chmodSync(path, 0o600);
  writeFileSync(path, value, { mode });
  chmodSync(path, mode);
}

function record(lines) {
  return Buffer.from(`${lines.join('\n')}\n`, 'ascii');
}

function devIno(path) {
  const result = spawnSync(
    python,
    [
      '-I',
      '-c',
      'import os,sys; value=os.stat(sys.argv[1]); print(f"{value.st_dev}:{value.st_ino}")',
      path,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^[0-9]+:[0-9]+\r?\n$/);
  return result.stdout.trim();
}

function makeFixture(name) {
  const fixture = mkdtempSync(join(tmpdir(), `fetanagent-h14-diff-${name}-`));
  const parent = join(fixture, 'h14');
  const h14 = join(parent, release);
  const profileRoot = join(fixture, 'profile-volume');
  const controlRoot = join(fixture, 'control-volume');
  const ownerRoot = join(fixture, 'owner-receipts');
  const helperCopy = join(fixture, 'installed-helper');
  const sealBinding = join(fixture, 'seal-output', 'kemerbet_agent_identity_bindings');
  const finalBinding = join(fixture, 'executor-secrets', 'kemerbet_agent_identity_bindings');
  const recheckReceipt = join(fixture, 'recheck', 'ready-v1');
  for (const directory of [parent, h14, profileRoot, controlRoot, ownerRoot]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }

  writeExact(helperCopy, canonicalHelper.stdout, 0o755);
  writeExact(join(h14, 'predecessor-helper'), predecessor.stdout, 0o400);

  const binding = Buffer.from(
    `${profile} hmac-sha256-agent-identity-v1:${identitySha} ` +
      `hmac-sha256-agent-profile-pin-v3:${identitySha}\n`,
    'ascii',
  );
  assert.equal(binding.length, 230);
  const retiredBinding = join(h14, 'retired-binding-v3');
  writeExact(retiredBinding, binding, 0o600);

  const quarantined = join(h14, 'quarantined-profile-v1');
  mkdirSync(quarantined, { mode: 0o700 });
  chmodSync(quarantined, 0o700);
  writeExact(
    join(quarantined, '.fetanagent-unclean-session-generation-v1'),
    Buffer.from('fetanagent-kemerbet-session-active-v1\n', 'ascii'),
    0o600,
  );

  const intent = record([
    'contract=fetanagent-kemerbet-quarantine-recovery-v14',
    'state=authorized',
    `recovery_release=${release}`,
    `predecessor_release=${h13Release}`,
    `predecessor_helper_sha256=${h13HelperSha}`,
    `successor_helper_sha256=${helperSha}`,
    `authorization_sha256=${authorizationSha}`,
    `old_claim_id=${claim}`,
    `old_profile_id=${profile}`,
    `old_binding_sha256=${sha(binding)}`,
    `old_player_ids_sha256=${playerSha}`,
    `binding_dev_ino=${devIno(retiredBinding)}`,
    'player_stage_dev_ino=7:8',
    'claim_stage_dev_ino=9:10',
    `profile_dev_ino=${devIno(quarantined)}`,
    'financial_actions_mode=dry_run',
    'kemerbet_executor_enabled=false',
    'kemerbet_final_action_enabled=false',
    'transfer_enabled=false',
    'amount_entry_enabled=false',
    'lookup_authorized=false',
    'recheck_authorized=false',
  ]);
  writeExact(join(h14, 'intent-v1'), intent);

  writeExact(
    join(h14, 'empty-predecessor-checkpoint-adoption-v1'),
    record([
      'version=1',
      'contract=fetanagent-kemerbet-quarantine-recovery-v14-empty-checkpoint-adoption',
      'state=adoption-prepared',
      'same_inode_target_rename_authorized=true',
      'namespace_rename_pending_at_publication=true',
      `predecessor_recovery_release=${emptyCheckpointRelease}`,
      `successor_recovery_release=${release}`,
      `checkpoint_dev_ino=${devIno(h14)}`,
      `source_namespace=.installing-${emptyCheckpointRelease}`,
      `target_namespace=.installing-${release}`,
      'durable_retirement_intent_present=false',
      'deployment_grant_changed=false',
      'helper_changed=false',
      'runtime_mutated=false',
      'financial_actions_mode=dry_run',
      'kemerbet_executor_enabled=false',
      'kemerbet_final_action_enabled=false',
      'amount_entry_enabled=false',
      'transfer_enabled=false',
      'money_moved=false',
    ]),
  );

  writeExact(
    join(h14, 'runtime-retirement-intent-v1'),
    record([
      'version=1',
      `recovery_release=${release}`,
      `runtime_release=${h13Release}`,
      'coordinator_container_id=absent',
      'coordinator_contract_sha256=absent',
      `owner_container_id=${ownerId}`,
      `owner_contract_sha256=${ownerContract}`,
      'financial_actions_mode=dry_run',
      'kemerbet_executor_enabled=false',
      'kemerbet_final_action_enabled=false',
      'transfer_enabled=false',
      'money_moved=false',
    ]),
  );
  writeExact(
    join(h14, 'runtime-retired-v1'),
    record([
      'version=1',
      `recovery_release=${release}`,
      `runtime_release=${h13Release}`,
      'coordinator_container_id=absent',
      `owner_container_id=${ownerId}`,
      'coordinator_removed=true',
      'owner_stopped=true',
      'profile_volume_holders=none',
      `control_volume_holder=${ownerId}-stopped`,
      'chromium_processes=none',
      'transfer_disabled=true',
      'amount_entry_enabled=false',
      'money_moved=false',
    ]),
  );
  writeExact(
    join(h14, 'owner-runtime-restored-v1'),
    record([
      'version=1',
      `recovery_release=${release}`,
      `runtime_release=${h13Release}`,
      `owner_container_id=${ownerId}`,
      `owner_contract_sha256=${ownerContract}`,
      'owner_running=true',
      'owner_healthy=true',
      'coordinator_absent=true',
      'transfer_disabled=true',
      'amount_entry_enabled=false',
      'money_moved=false',
    ]),
  );
  writeExact(
    join(h14, 'player-stage-consumption-v1'),
    record([
      'version=1',
      'stage=player-ids',
      'source_dev_ino=7:8',
      `source_sha256=${playerSha}`,
      'raw_player_ids_preserved=false',
    ]),
  );
  const claimData = Buffer.from(`${claim}\n`, 'ascii');
  writeExact(
    join(h14, 'claim-stage-consumption-v1'),
    record([
      'version=1',
      'stage=claim',
      `claim_id=${claim}`,
      'source_dev_ino=9:10',
      `source_sha256=${sha(claimData)}`,
      'raw_stage_preserved=false',
    ]),
  );
  writeExact(join(h14, 'retired-retryable-failure-v1'), claimData, 0o440);
  writeExact(
    join(h14, 'host-retired-v1'),
    record([
      'version=1',
      `recovery_release=${release}`,
      `old_claim_id=${claim}`,
      `old_profile_id=${profile}`,
      `old_binding_sha256=${sha(binding)}`,
      `old_player_ids_sha256=${playerSha}`,
      `intent_sha256=${sha(intent)}`,
      'transfer_disabled=true',
      'amount_entry_enabled=false',
      'money_moved=false',
    ]),
  );
  writeExact(join(ownerRoot, terminalName), claimData, 0o440);

  return {
    fixture,
    h14,
    parent,
    profileRoot,
    controlRoot,
    ownerRoot,
    helperCopy,
    sealBinding,
    finalBinding,
    recheckReceipt,
    args: [
      parent,
      helperCopy,
      profileRoot,
      controlRoot,
      sealBinding,
      finalBinding,
      recheckReceipt,
      ownerRoot,
      authorizationSha,
      profileAckName,
      terminalName,
      finalizedName,
    ],
  };
}

function run(args, source = portableDiagnostic) {
  const result = spawnSync(python, ['-I', '-', ...args], {
    cwd: root,
    encoding: 'utf8',
    input: source,
    maxBuffer: 1024 * 1024,
  });
  result.stdout = result.stdout.replaceAll('\r\n', '\n');
  result.stderr = result.stderr.replaceAll('\r\n', '\n');
  return result;
}

function replaceLine(path, before, after) {
  const value = readFileSync(path, 'utf8');
  assert.ok(value.includes(before), `fixture line is absent: ${before}`);
  writeExact(path, Buffer.from(value.replace(before, after), 'ascii'));
}

function expectFailure(name, expected, mutate) {
  const fixture = makeFixture(name);
  try {
    mutate(fixture);
    const result = run(fixture.args);
    assert.equal(result.status, 1, `${name} unexpectedly passed: ${result.stdout}`);
    assert.equal(result.stdout, `FAIL ${expected}\n`, `${name} leaked or misclassified output`);
    assert.equal(result.stderr, '', `${name} must not emit diagnostic detail to stderr`);
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
}

assert.equal((diagnostic.match(/PORTABLE_FIXTURE = False/g) ?? []).length, 1);
assert.doesNotMatch(
  diagnostic,
  /\bos\.(?:remove|unlink|rename|replace|mkdir|makedirs|chmod|chown|link|symlink)\b/,
);
assert.doesNotMatch(diagnostic, /\b(?:subprocess|socket|docker)\b/i);
assert.doesNotMatch(diagnostic, /\b(?:O_WRONLY|O_RDWR|O_CREAT|O_EXCL|O_TRUNC|O_APPEND)\b/);
assert.doesNotMatch(diagnostic, /\bopen\s*\([^\n]*["'](?:w|a|x|\+)/);
assert.equal((diagnostic.match(/sys\.stdout\.write/g) ?? []).length, 2);
for (const code of [
  'H14-D001',
  'H14-D010',
  'H14-D020',
  'H14-D030',
  'H14-D040',
  'H14-D050',
  'H14-D060',
  'H14-D070',
  'H14-D080',
  'H14-D090',
  'H14-D100',
  'H14-D110',
  'H14-D120',
  'H14-D130',
  'H14-D140',
  'H14-D150',
  'H14-D160',
  'H14-D170',
]) {
  assert.match(diagnostic, new RegExp(`(?:current_predicate =|at\\()\\"${code}\\"`));
}
assert.match(diagnostic, /os\.open\(path, READ_ONLY_FLAGS\)/);
assert.match(diagnostic, /os\.O_RDONLY/);
assert.match(diagnostic, /getattr\(os, "O_NOFOLLOW", 0\)/);
assert.match(diagnostic, /before_tuple != after_tuple/);

let fixture = makeFixture('pass');
try {
  let result = run(fixture.args);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, 'PASS H14-D000\n');
  assert.equal(result.stderr, '');
  const allBefore = statSync(fixture.h14, { bigint: true });
  result = run(fixture.args);
  const allAfter = statSync(fixture.h14, { bigint: true });
  assert.equal(result.status, 0);
  assert.equal(allAfter.mtimeNs, allBefore.mtimeNs, 'validator must not mutate the H14 namespace');
} finally {
  rmSync(fixture.fixture, { recursive: true, force: true });
}

let result = run([]);
assert.equal(result.status, 1);
assert.equal(result.stdout, 'FAIL H14-D001\n');
assert.equal(result.stderr, '');

expectFailure('parent', 'H14-D010', ({ parent }) => {
  writeExact(join(parent, 'foreign'), Buffer.from('x', 'ascii'));
});
expectFailure('root-entries', 'H14-D020', ({ h14 }) => {
  writeExact(join(h14, 'foreign'), Buffer.from('x', 'ascii'));
});
expectFailure('adoption', 'H14-D030', ({ h14 }) => {
  replaceLine(
    join(h14, 'empty-predecessor-checkpoint-adoption-v1'),
    'state=adoption-prepared',
    'state=foreign__________',
  );
});
expectFailure('intent', 'H14-D040', ({ h14 }) => {
  replaceLine(join(h14, 'intent-v1'), 'lookup_authorized=false', 'lookup_authorized=true_');
});
expectFailure('runtime-intent', 'H14-D050', ({ h14 }) => {
  replaceLine(
    join(h14, 'runtime-retirement-intent-v1'),
    'financial_actions_mode=dry_run',
    'financial_actions_mode=live___',
  );
});
expectFailure('runtime-retired', 'H14-D060', ({ h14 }) => {
  replaceLine(join(h14, 'runtime-retired-v1'), 'owner_stopped=true', 'owner_stopped=no__');
});
expectFailure('owner-restored', 'H14-D070', ({ h14 }) => {
  replaceLine(join(h14, 'owner-runtime-restored-v1'), 'owner_healthy=true', 'owner_healthy=no__');
});
expectFailure('player-consumption', 'H14-D080', ({ h14 }) => {
  replaceLine(
    join(h14, 'player-stage-consumption-v1'),
    'raw_player_ids_preserved=false',
    'raw_player_ids_preserved=true_',
  );
});
expectFailure('claim-consumption', 'H14-D090', ({ h14 }) => {
  replaceLine(
    join(h14, 'claim-stage-consumption-v1'),
    'raw_stage_preserved=false',
    'raw_stage_preserved=true_',
  );
});
expectFailure('helper-chain', 'H14-D100', ({ helperCopy }) => {
  writeExact(helperCopy, Buffer.from('#!/bin/sh\nexit 0\n', 'ascii'), 0o755);
});
expectFailure('retired-binding', 'H14-D110', ({ h14 }) => {
  const foreign = Buffer.from(
    `${profile} hmac-sha256-agent-identity-v1:${'7'.repeat(64)} ` +
      `hmac-sha256-agent-profile-pin-v3:${'7'.repeat(64)}\n`,
    'ascii',
  );
  writeExact(join(h14, 'retired-binding-v3'), foreign);
});
expectFailure('retired-failure', 'H14-D120', ({ h14 }) => {
  writeExact(
    join(h14, 'retired-retryable-failure-v1'),
    Buffer.from(`${otherClaim}\n`, 'ascii'),
    0o440,
  );
});
expectFailure('quarantined-profile', 'H14-D130', ({ h14 }) => {
  writeExact(
    join(h14, 'quarantined-profile-v1', '.fetanagent-unclean-session-generation-v1'),
    Buffer.from('fetanagent-kemerbet-session-inactive-v1\n', 'ascii'),
  );
});
expectFailure('host-record', 'H14-D140', ({ h14 }) => {
  replaceLine(join(h14, 'host-retired-v1'), 'money_moved=false', 'money_moved=true_');
});
expectFailure('adjacent-cohort', 'H14-D150', ({ controlRoot }) => {
  writeExact(
    join(controlRoot, 'kemerbet-readiness-player-ids.stage-v1'),
    Buffer.from('redacted\n', 'ascii'),
    0o400,
  );
});
expectFailure('binding-state', 'H14-D160', ({ sealBinding }) => {
  writeExact(sealBinding, Buffer.alloc(230, 0x78));
});
expectFailure('terminal-marker', 'H14-D170', ({ ownerRoot }) => {
  writeExact(join(ownerRoot, terminalName), Buffer.from(`${otherClaim}\n`, 'ascii'), 0o440);
});

console.log('Canonical H14 terminal differential validator fixtures passed (H14-D001..H14-D170).');
