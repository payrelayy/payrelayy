import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chownSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repairPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh',
);
const h14Path = resolve(root, 'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14.sh');
const helperPath = resolve(root, 'infra/operations/fetanagent-staging-deploy-helper.sh');

const normalized = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const repair = normalized(repairPath);
const helper = normalized(helperPath);
const canonicalH14Installer = normalized(h14Path);

const recoveryRelease = '06459511d9330a0e1d956c42529b81aa9970e7a2';
const runtimeRelease = '306818ca812bd2abce8479396c4eea8383ea00f9';
const emptyCheckpointRelease = '4239201b5496bd08912cce4b5581fe19b29a84d4';
const predecessorHelperSha256 = '3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa';
const successorHelperSha256 = 'c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58';
const authorizationSha256 = '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874';
const adoptionName = 'empty-predecessor-checkpoint-adoption-v1';
const ownerId = 'a'.repeat(64);
const coordinatorId = 'b'.repeat(64);

function shellFunction(source, name) {
  const start = source.indexOf(`${name}() {`);
  assert.ok(start >= 0, `missing shell function ${name}`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, `unterminated shell function ${name}`);
  return source.slice(start, end + 3);
}

function heredocBody(functionText, marker = 'PY') {
  const startPattern = new RegExp(`(?:<<|3<<)'${marker}'\\n`);
  const match = startPattern.exec(functionText);
  assert.ok(match, `missing ${marker} heredoc`);
  const start = match.index + match[0].length;
  const end = functionText.indexOf(`\n${marker}\n`, start);
  assert.ok(end > start, `unterminated ${marker} heredoc`);
  return functionText.slice(start, end + 1);
}

function indexOrFail(source, needle, description = needle) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, `missing ${description}`);
  return index;
}

function clone(value) {
  return structuredClone(value);
}

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [
      value,
      ...tail,
    ]),
  );
}

function resolvePython() {
  const configured = process.env.FETANAGENT_TEST_PYTHON;
  const candidates = [
    configured,
    process.platform === 'win32'
      ? join(
          process.env.USERPROFILE ?? '',
          '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
        )
      : '/usr/bin/python3',
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('Python 3 is required for the H14 live-repair fixture verifier');
}

assert.match(repair, /^#!\/usr\/bin\/env bash\n/);
assert.match(repair, /set -euo pipefail/);
assert.match(repair, /umask 077/);
assert.match(repair, new RegExp(`readonly RECOVERY_RELEASE='${recoveryRelease}'`));
assert.match(repair, new RegExp(`readonly PREDECESSOR_RELEASE='${runtimeRelease}'`));
assert.match(repair, new RegExp(`readonly EMPTY_CHECKPOINT_RELEASE='${emptyCheckpointRelease}'`));
assert.match(repair, new RegExp(`readonly PREDECESSOR_HELPER_SHA256='${predecessorHelperSha256}'`));
assert.match(
  repair,
  new RegExp(`readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${successorHelperSha256}'`),
);
assert.match(repair, new RegExp(`readonly AUTHORIZATION_SHA256='${authorizationSha256}'`));
assert.doesNotMatch(
  repair,
  /readonly RECOVERY_RELEASE="\$1"/,
  'the repair implementation SHA must never supersede the canonical H14 release',
);
assert.match(
  repair,
  /readonly REPAIR_PARENT='\/var\/lib\/fetanagent\/kemerbet-quarantine-recovery-v14-live-repair'/,
);
assert.match(repair, /readonly REPAIR_RELEASE="\$1"/);
assert.match(repair, /readonly REPAIR_INSTALLING="\$REPAIR_PARENT\/\.installing-\$REPAIR_RELEASE"/);
assert.match(repair, /readonly REPAIR_ROOT="\$REPAIR_PARENT\/\$REPAIR_RELEASE"/);
assert.doesNotMatch(
  repair,
  /H14_PARENT\/\$REPAIR_RELEASE|H14_PARENT\/\.installing-\$REPAIR_RELEASE/,
  'repair evidence must remain outside the immutable H14 namespace',
);
assert.doesNotMatch(
  repair,
  /mv -- "\$RECOVERY_INSTALLING" "\$H14_PARENT\/\$REPAIR_RELEASE"/,
  'the canonical interrupted H14 directory may only finalize under its canonical release',
);

// Historical H14 repair evidence remains pinned to its original reviewed helper.
// Later helper promotions use distinct append-only namespaces and must never
// rewrite this canonical installer chain.
assert.match(
  canonicalH14Installer,
  new RegExp(`readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${successorHelperSha256}'`),
  'the historical H14 repair must retain its canonical reviewed helper pin',
);
assert.notEqual(
  createHash('sha256').update(helper, 'utf8').digest('hex'),
  successorHelperSha256,
  'the current helper change must be carried by a distinct forward-only promotion',
);
assert.match(repair, /require_helper_file "\$TARGET" "\$PREDECESSOR_HELPER_SHA256" 755/);
assert.match(repair, /require_helper_file "\$STAGED_HELPER" "\$SUCCESSOR_HELPER_SHA256" 600/);
assert.match(repair, /require_disabled_grant_only/);
assert.match(repair, /require_active_grant_only/);
assert.match(repair, /require_no_other_mutator_processes/);
assert.match(repair, /require_exact_droplet/);
assert.match(repair, /require_exact_h13_evidence/);

// Docker's map-backed Go-template Mounts rendering is the defect being repaired.
// The repair must consume one raw JSON inspection and canonicalize only the unordered mount set.
const semanticFunction = shellFunction(repair, 'container_semantic_contract_digest');
assert.match(semanticFunction, /docker_local container inspect "\$container_id" \|/);
assert.doesNotMatch(semanticFunction, /--format|\{\{json \.Mounts\}\}/);
assert.match(semanticFunction, /json\.load\(sys\.stdin\)/);
assert.match(semanticFunction, /len\(payload\) != 1/);
assert.match(semanticFunction, /canonical_mounts = sorted\(/);
assert.match(semanticFunction, /sort_keys=True/);
assert.match(semanticFunction, /separators=\(',', ':'\)/);
assert.match(semanticFunction, /'version': 'fetanagent-docker-semantic-contract-v2'/);
assert.match(semanticFunction, /cmd = member\(config, 'Cmd'\)/);
assert.match(semanticFunction, /environment = member\(config, 'Env'\)/);
assert.match(semanticFunction, /'Config\.Cmd': cmd/);
assert.match(semanticFunction, /'Config\.Env': environment/);
assert.match(semanticFunction, /'Mounts': canonical_mounts/);
assert.match(semanticFunction, /'Config\.Labels': labels/);
assert.match(semanticFunction, /hashlib\.sha256\(encoded\)\.hexdigest\(\)/);
assert.match(
  semanticFunction,
  /Destination/,
  'canonical Mounts must reject duplicate or malformed destinations, not silently merge them',
);
assert.doesNotMatch(
  repair,
  /container_contract_digest\(/,
  'the live repair must not recompute or depend on the nondeterministic legacy v1 digest',
);

const python = resolvePython();
const fixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-h14-live-repair-'));
const semanticPythonPath = join(fixtureRoot, 'semantic-contract.py');
writeFileSync(semanticPythonPath, heredocBody(semanticFunction), { mode: 0o600 });
chmodSync(semanticPythonPath, 0o600);

const baseInspect = {
  Id: ownerId,
  Image: `sha256:${'1'.repeat(64)}`,
  Config: {
    Image: `ghcr.io/fetanagent/owner@sha256:${'2'.repeat(64)}`,
    User: '10001:10001',
    Cmd: ['node', 'apps/api/dist/owner-control-server.js'],
    Env: [
      'NODE_ENV=production',
      'FINANCIAL_ACTIONS_MODE=dry_run',
      'KEMERBET_EXECUTOR_ENABLED=false',
      'KEMERBET_FINAL_ACTION_ENABLED=false',
    ],
    Labels: {
      'com.docker.compose.project': 'fetanagent-staging-beta',
      'com.docker.compose.service': 'owner-control',
      'org.opencontainers.image.revision': runtimeRelease,
    },
  },
  HostConfig: {
    ReadonlyRootfs: true,
    CapAdd: null,
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges:true'],
    RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
  },
  Mounts: [
    {
      Type: 'volume',
      Name: 'fetanagent-staging-beta_kemerbet_session_control',
      Source: '/var/lib/docker/volumes/control/_data',
      Destination: '/run/fetanagent-kemerbet-session-control',
      Driver: 'local',
      Mode: 'rw',
      RW: true,
      Propagation: '',
    },
    {
      Type: 'bind',
      Source: '/etc/fetanagent/owner',
      Destination: '/run/secrets/fetanagent-owner',
      Mode: 'ro',
      RW: false,
      Propagation: 'rprivate',
    },
    {
      Type: 'volume',
      Name: 'fetanagent-staging-beta_owner_receipts',
      Source: '/var/lib/docker/volumes/owner/_data',
      Destination: '/var/lib/fetanagent/owner-receipts',
      Driver: 'local',
      Mode: 'rw',
      RW: true,
      Propagation: '',
      FutureDockerField: { B: 2, A: 1 },
    },
  ],
  State: { Status: 'running', Health: { Status: 'healthy' }, StartedAt: 'first' },
  NetworkSettings: { Networks: { default: { IPAddress: '172.19.0.2' } } },
};

function semanticDigest(inspected, expectedId = ownerId) {
  return spawnSync(python, ['-I', semanticPythonPath, expectedId], {
    encoding: 'utf8',
    input: JSON.stringify([inspected]),
  });
}

try {
  const baseline = semanticDigest(baseInspect);
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
  assert.match(baseline.stdout.trim(), /^[0-9a-f]{64}$/);
  const baselineDigest = baseline.stdout.trim();

  for (const mountOrder of permutations(baseInspect.Mounts)) {
    const result = semanticDigest({ ...clone(baseInspect), Mounts: clone(mountOrder) });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      result.stdout.trim(),
      baselineDigest,
      'every permutation of the same complete Mounts set must have one digest',
    );
  }

  const runtimeOnlyMutation = clone(baseInspect);
  runtimeOnlyMutation.State = {
    Status: 'exited',
    Health: { Status: 'unhealthy' },
    StartedAt: 'second',
  };
  runtimeOnlyMutation.NetworkSettings.Networks.default.IPAddress = '172.19.0.99';
  assert.equal(
    semanticDigest(runtimeOnlyMutation).stdout.trim(),
    baselineDigest,
    'runtime-mutable state must not affect the semantic contract digest',
  );

  for (const [description, mutate] of [
    ['full Owner ID', (value) => (value.Id = 'c'.repeat(64))],
    ['image ID', (value) => (value.Image = `sha256:${'3'.repeat(64)}`)],
    ['image reference', (value) => (value.Config.Image = 'foreign')],
    ['user', (value) => (value.Config.User = '0:0')],
    ['command ordering', (value) => value.Config.Cmd.reverse()],
    ['environment ordering', (value) => value.Config.Env.reverse()],
    ['read-only root', (value) => (value.HostConfig.ReadonlyRootfs = false)],
    ['capabilities', (value) => (value.HostConfig.CapAdd = ['SYS_ADMIN'])],
    ['security options', (value) => (value.HostConfig.SecurityOpt = [])],
    ['restart policy', (value) => (value.HostConfig.RestartPolicy.Name = 'always')],
    ['complete mount field', (value) => (value.Mounts[2].FutureDockerField.A = 9)],
    ['labels', (value) => (value.Config.Labels['com.docker.compose.service'] = 'foreign')],
  ]) {
    const changed = clone(baseInspect);
    mutate(changed);
    const expectedId = description === 'full Owner ID' ? changed.Id : ownerId;
    const result = semanticDigest(changed, expectedId);
    assert.equal(result.status, 0, `${description}: ${result.stderr || result.stdout}`);
    assert.notEqual(result.stdout.trim(), baselineDigest, `${description} must change the digest`);
  }

  const duplicateDestination = clone(baseInspect);
  duplicateDestination.Mounts[2].Destination = duplicateDestination.Mounts[0].Destination;
  assert.notEqual(
    semanticDigest(duplicateDestination).status,
    0,
    'duplicate mount destinations must fail closed',
  );
  const missingDestination = clone(baseInspect);
  delete missingDestination.Mounts[0].Destination;
  assert.notEqual(
    semanticDigest(missingDestination).status,
    0,
    'a mount without an exact Destination must fail closed',
  );
  assert.notEqual(
    semanticDigest(baseInspect, 'd'.repeat(64)).status,
    0,
    'the raw inspection must belong to the exact expected full Owner ID',
  );
  const multiple = spawnSync(python, ['-I', semanticPythonPath, ownerId], {
    encoding: 'utf8',
    input: JSON.stringify([baseInspect, baseInspect]),
  });
  assert.notEqual(multiple.status, 0, 'multiple Docker inspection objects must fail closed');
} finally {
  // More executable prefix fixtures below share this temporary root.
}

const financialGateFunction = shellFunction(repair, 'has_enabled_financial_gate');
const financialInventoryFunction = shellFunction(repair, 'require_financial_gates_disabled');
assert.match(
  financialGateFunction,
  /FINANCIAL_ACTIONS_MODE=dry_run\) continue[\s\S]*?FINANCIAL_ACTIONS_MODE=\*\) return 0/,
);
assert.match(
  financialGateFunction,
  /INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED\|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED\|TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED/,
);
assert.match(
  financialGateFunction,
  /EXECUTOR\|FINAL_ACTION\|TRANSFER\|AMOUNT_ENTRY\|WITHDRAW\|SETTLEMENT/,
);
assert.doesNotMatch(
  financialGateFunction,
  /INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED|FETANAGENT_\.\*\([^)]*DEPOSIT/,
  'dry-run customer request intake is not a provider money-execution gate',
);
assert.match(
  financialGateFunction,
  /\[\[ "\$entry" == 'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \]\] && continue/,
);
assert.match(
  financialInventoryFunction,
  /\[\[ ! -e "\$FINAL_BINDING" && ! -L "\$FINAL_BINDING" \]\]/,
);
assert.match(financialInventoryFunction, /inventory="\$\(docker_local container ls --all --quiet/);
assert.match(
  financialInventoryFunction,
  /service="\$\(docker_local container inspect "\$container" --format[\s\S]*?com\.docker\.compose\.service/,
);
assert.match(
  financialInventoryFunction,
  /\[\[ "\$service" =~ \^\[a-z0-9\]\[a-z0-9_-\]\*\$ \]\] \|\| return 1/,
  'blank and malformed service identities must fail rather than inherit the non-gateway rule',
);
assert.match(
  financialInventoryFunction,
  /mode_count="\$\(awk 'index\(\$0, "FINANCIAL_ACTIONS_MODE="\) == 1 \{ count \+= 1 \} END \{ print count \+ 0 \}'/,
);
assert.match(
  financialInventoryFunction,
  /dry_run_count="\$\(awk '\$0 == "FINANCIAL_ACTIONS_MODE=dry_run" \{ count \+= 1 \} END \{ print count \+ 0 \}'/,
);
assert.match(
  financialInventoryFunction,
  /if \[\[ "\$service" == 'gateway' \]\]; then[\s\S]*?"\$mode_count" == '0' && "\$dry_run_count" == '0'[\s\S]*?else[\s\S]*?"\$mode_count" == '1' && "\$dry_run_count" == '1'/,
  'only the canonical gateway may omit FINANCIAL_ACTIONS_MODE; every other project service needs exactly one dry_run',
);
assert.match(
  financialInventoryFunction,
  /INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=\(1\|true\|yes\|on\)[\s\S]*?"\$dry_run_count" == '1'/,
  'the non-money customer intake exception still requires an exact dry-run container',
);
for (const gate of [
  'KEMERBET_EXECUTOR_ENABLED',
  'KEMERBET_FINAL_ACTION_ENABLED',
  'KEMERBET_TRANSFER_ENABLED',
  'KEMERBET_AMOUNT_ENTRY_ENABLED',
  'FETANAGENT_INTERNAL_KEMERBET_ENABLED',
  'FETANAGENT_PRIVATE_LIVE_MODE',
]) {
  assert.ok(financialInventoryFunction.includes(gate), `financial inventory omits gate: ${gate}`);
}
assert.match(financialInventoryFunction, /done <<<"\$inventory"/);
assert.doesNotMatch(financialInventoryFunction, /done < <\(docker_local container ls/);

const financialHarness = `
${financialGateFunction}
${financialInventoryFunction}
FINAL_BINDING='/__h14_live_repair_verifier_binding'
PROJECT_NAME='fetanagent-staging-beta'
docker_local() {
  if [[ "$1:$2" == 'container:ls' ]]; then
    case "$MOCK_MODE" in
      inventory-error) return 71 ;;
      *) printf '%s\\n' fixture-owner ;;
    esac
    return
  fi
  [[ "$1:$2:$3:$4" == 'container:inspect:fixture-owner:--format' ]] || return 72
  case "$5" in
    *'com.docker.compose.service'*)
      [[ "$MOCK_MODE" == 'service-inspect-error' ]] && return 73
      case "$MOCK_MODE" in
        gateway-*) printf '%s\\n' gateway ;;
        unknown-*) printf '%s\\n' future-project-service ;;
        unlabeled-dry) printf '\\n' ;;
        malformed-service-dry) printf '%s\\n' 'bad/service' ;;
        *) printf '%s\\n' owner-control ;;
      esac
      ;;
    '{{range .Config.Env}}{{println .}}{{end}}')
      [[ "$MOCK_MODE" == 'environment-inspect-error' ]] && return 74
      case "$MOCK_MODE" in
        missing-mode|internal-customer-missing-mode|gateway-absent|gateway-enabled-gate|gateway-internal-customer|gateway-internal-provider|gateway-private-live-mode|gateway-trusted-telebirr|unknown-absent) ;;
        duplicate-mode|internal-customer-duplicate-mode|gateway-duplicate)
          printf '%s\\n' 'FINANCIAL_ACTIONS_MODE=dry_run' 'FINANCIAL_ACTIONS_MODE=dry_run'
          ;;
        mixed-mode|gateway-mixed|unknown-mixed)
          printf '%s\\n' 'FINANCIAL_ACTIONS_MODE=dry_run' 'FINANCIAL_ACTIONS_MODE=live'
          ;;
        gateway-empty-mode|unknown-empty-mode) printf '%s\\n' 'FINANCIAL_ACTIONS_MODE=' ;;
        wrong-mode|gateway-live|unknown-live) printf '%s\\n' 'FINANCIAL_ACTIONS_MODE=live' ;;
        *) printf '%s\\n' 'FINANCIAL_ACTIONS_MODE=dry_run' ;;
      esac
      printf '%s\\n' \\
        'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \\
        'KEMERBET_EXECUTOR_ENABLED=false' \\
        'KEMERBET_FINAL_ACTION_ENABLED=false' \\
        'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false' \\
        'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false'
      case "$MOCK_MODE" in
        transfer-enabled|gateway-enabled-gate) printf '%s\\n' 'KEMERBET_TRANSFER_ENABLED=true' ;;
        internal-customer-runtime|internal-customer-missing-mode|internal-customer-duplicate-mode|gateway-internal-customer)
          printf '%s\\n' 'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true'
          ;;
        trusted-telebirr-pilot|gateway-trusted-telebirr)
          printf '%s\\n' 'TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=true'
          ;;
        internal-provider-enabled|gateway-internal-provider|unknown-internal-provider)
          printf '%s\\n' 'FETANAGENT_INTERNAL_KEMERBET_ENABLED=true'
          ;;
        private-live-mode-enabled|gateway-private-live-mode|unknown-private-live-mode)
          printf '%s\\n' 'FETANAGENT_PRIVATE_LIVE_MODE=true'
          ;;
      esac
      ;;
    *) return 75 ;;
  esac
}
require_financial_gates_disabled
`;

for (const [mode, expectedSuccess] of [
  ['safe', true],
  ['inventory-error', false],
  ['missing-mode', false],
  ['duplicate-mode', false],
  ['mixed-mode', false],
  ['wrong-mode', false],
  ['gateway-absent', true],
  ['gateway-dry', false],
  ['gateway-live', false],
  ['gateway-duplicate', false],
  ['gateway-mixed', false],
  ['gateway-empty-mode', false],
  ['gateway-enabled-gate', false],
  ['gateway-trusted-telebirr', false],
  ['gateway-internal-customer', false],
  ['gateway-internal-provider', false],
  ['gateway-private-live-mode', false],
  ['unknown-absent', false],
  ['unknown-dry', true],
  ['unknown-live', false],
  ['unknown-mixed', false],
  ['unknown-empty-mode', false],
  ['unknown-internal-provider', false],
  ['unknown-private-live-mode', false],
  ['unlabeled-dry', false],
  ['malformed-service-dry', false],
  ['transfer-enabled', false],
  ['internal-provider-enabled', false],
  ['private-live-mode-enabled', false],
  ['internal-customer-runtime', true],
  ['internal-customer-missing-mode', false],
  ['internal-customer-duplicate-mode', false],
  ['trusted-telebirr-pilot', false],
  ['service-inspect-error', false],
  ['environment-inspect-error', false],
]) {
  const result = spawnSync('bash', ['-c', financialHarness], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, MOCK_MODE: mode },
  });
  assert.equal(
    result.status === 0,
    expectedSuccess,
    `financial inventory ${mode}: ${result.stderr || result.stdout}`,
  );
}

for (const [environment, expectedEnabled] of [
  ['FINANCIAL_ACTIONS_MODE=dry_run', false],
  ['FINANCIAL_ACTIONS_MODE=live', true],
  ['KEMERBET_EXECUTOR_ENABLED=true', true],
  ['KEMERBET_FINAL_ACTION_ENABLED=1', true],
  ['KEMERBET_TRANSFER_ENABLED=yes', true],
  ['KEMERBET_AMOUNT_ENTRY_ENABLED=on', true],
  ['INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=true', true],
  ['KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true', true],
  ['INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true', false],
  ['TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED=true', true],
  ['FETANAGENT_EXECUTOR_ENABLED=true', true],
  ['FETANAGENT_FINAL_ACTION_ENABLED=1', true],
  ['FETANAGENT_TRANSFER_ENABLED=yes', true],
  ['FETANAGENT_AMOUNT_ENTRY_ENABLED=on', true],
  ['FETANAGENT_DEPOSIT_ENABLED=true', false],
  ['FETANAGENT_WITHDRAW_ENABLED=true', true],
  ['FETANAGENT_SETTLEMENT_ENABLED=true', true],
  ['KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true', false],
  ['KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=TRUE', true],
  ['KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true\nFETANAGENT_TRANSFER_ENABLED=true', true],
]) {
  const result = spawnSync(
    'bash',
    ['-c', `${financialGateFunction}\nhas_enabled_financial_gate "$(cat)"`],
    { cwd: root, encoding: 'utf8', input: environment },
  );
  assert.equal(
    result.status === 0,
    expectedEnabled,
    `financial gate fixture was misclassified: ${environment}`,
  );
}

const containerContractFunction = shellFunction(repair, 'require_recovery_container_contract');
assert.match(
  containerContractFunction,
  /"\$\(docker_local container inspect "\$container_id" --format '\{\{\.Id\}\}'\)" == "\$container_id"/,
);
assert.match(containerContractFunction, /org\.opencontainers\.image\.revision/);
assert.match(containerContractFunction, /10001:10001/);
assert.match(containerContractFunction, /ReadonlyRootfs/);
assert.match(containerContractFunction, /RestartPolicy\.Name/);
assert.match(containerContractFunction, /CapAdd/);
assert.match(containerContractFunction, /CapDrop/);
assert.match(containerContractFunction, /SecurityOpt/);
assert.match(containerContractFunction, /FINANCIAL_ACTIONS_MODE=dry_run/);
assert.match(containerContractFunction, /KEMERBET_EXECUTOR_ENABLED=false/);
assert.match(containerContractFunction, /KEMERBET_FINAL_ACTION_ENABLED=false/);
assert.match(containerContractFunction, /\$CONTROL_VOLUME/);

const contractHarness = `
${financialGateFunction}
${containerContractFunction}
PROJECT_NAME='fetanagent-staging-beta'
CONTROL_VOLUME='fetanagent-staging-beta_kemerbet_session_control'
PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'
CONTAINER_ID='${ownerId}'
EXPECTED_RELEASE='${runtimeRelease}'
emit_environment() {
  printf '%s\\n' \\
    'FINANCIAL_ACTIONS_MODE=dry_run' \\
    'KEMERBET_EXECUTOR_ENABLED=false' \\
    'KEMERBET_FINAL_ACTION_ENABLED=false'
  case "$MOCK_MODE" in
    executor) printf '%s\\n' 'KEMERBET_EXECUTOR_ENABLED=true' ;;
    final) printf '%s\\n' 'KEMERBET_FINAL_ACTION_ENABLED=true' ;;
    amount) printf '%s\\n' 'FETANAGENT_AMOUNT_ENTRY_ENABLED=true' ;;
    transfer) printf '%s\\n' 'FETANAGENT_TRANSFER_ENABLED=true' ;;
    live-mode) printf '%s\\n' 'FINANCIAL_ACTIONS_MODE=live' ;;
  esac
}
docker_local() {
  [[ "$1:$2:$3:$4" == "container:inspect:$CONTAINER_ID:--format" ]] || return 81
  case "$5" in
    '{{.Id}}')
      [[ "$MOCK_MODE" == 'wrong-id' ]] && printf '%s\\n' '${'e'.repeat(64)}' || printf '%s\\n' "$CONTAINER_ID"
      ;;
    *'com.docker.compose.project'*)
      [[ "$MOCK_MODE" == 'wrong-project' ]] && printf '%s\\n' foreign || printf '%s\\n' "$PROJECT_NAME"
      ;;
    *'com.docker.compose.service'*)
      [[ "$MOCK_MODE" == 'wrong-service' ]] && printf '%s\\n' foreign || printf '%s\\n' owner-control
      ;;
    *'org.opencontainers.image.revision'*)
      [[ "$MOCK_MODE" == 'wrong-release' ]] && printf '%s\\n' '${'f'.repeat(40)}' || printf '%s\\n' "$EXPECTED_RELEASE"
      ;;
    '{{.Config.User}}')
      [[ "$MOCK_MODE" == 'wrong-user' ]] && printf '%s\\n' '0:0' || printf '%s\\n' '10001:10001'
      ;;
    '{{.HostConfig.ReadonlyRootfs}}')
      [[ "$MOCK_MODE" == 'writable-root' ]] && printf '%s\\n' false || printf '%s\\n' true
      ;;
    '{{.HostConfig.RestartPolicy.Name}}')
      [[ "$MOCK_MODE" == 'restart-always' ]] && printf '%s\\n' always || printf '%s\\n' no
      ;;
    '{{json .HostConfig.CapAdd}}')
      [[ "$MOCK_MODE" == 'cap-add' ]] && printf '%s\\n' '["SYS_ADMIN"]' || printf '%s\\n' null
      ;;
    '{{json .HostConfig.CapDrop}}')
      [[ "$MOCK_MODE" == 'cap-drop' ]] && printf '%s\\n' '[]' || printf '%s\\n' '["ALL"]'
      ;;
    '{{json .HostConfig.SecurityOpt}}')
      [[ "$MOCK_MODE" == 'security' ]] && printf '%s\\n' '[]' || printf '%s\\n' '["no-new-privileges:true"]'
      ;;
    '{{range .Config.Env}}{{println .}}{{end}}') emit_environment ;;
    *'/run/fetanagent-kemerbet-session-control'*)
      [[ "$MOCK_MODE" == 'wrong-control-mount' ]] && printf '%s\\n' foreign || printf '%s\\n' "$CONTROL_VOLUME"
      ;;
    *) return 82 ;;
  esac
}
require_recovery_container_contract "$CONTAINER_ID" owner-control "$EXPECTED_RELEASE"
`;

for (const [mode, expectedSuccess] of [
  ['safe', true],
  ['wrong-id', false],
  ['wrong-project', false],
  ['wrong-service', false],
  ['wrong-release', false],
  ['wrong-user', false],
  ['writable-root', false],
  ['restart-always', false],
  ['cap-add', false],
  ['cap-drop', false],
  ['security', false],
  ['wrong-control-mount', false],
  ['executor', false],
  ['final', false],
  ['amount', false],
  ['transfer', false],
  ['live-mode', false],
]) {
  const result = spawnSync('bash', ['-c', contractHarness], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, MOCK_MODE: mode },
  });
  assert.equal(
    result.status === 0,
    expectedSuccess,
    `Owner contract ${mode}: ${result.stderr || result.stdout}`,
  );
}

// A compact state model keeps every live-state rejection explicit. Static checks below bind each
// field back to the production preflight, while the mutation table prevents an accidental test gap.
const exactLiveState = {
  h14Children: [`.installing-${recoveryRelease}`],
  h14Entries: [adoptionName, 'runtime-retirement-intent-v1'],
  h14RecordIdentityStable: true,
  h14RecordContentStable: true,
  recordedOwnerId: ownerId,
  ownerInventory: [ownerId],
  ownerContractExact: true,
  ownerStatus: 'running-healthy',
  recordedCoordinatorId: coordinatorId,
  coordinatorInventory: [],
  predecessorHelperSha256,
  helperResidue: [],
  grant: 'disabled-only',
  financialMode: 'dry_run',
  executorEnabled: false,
  finalActionEnabled: false,
  amountEntryEnabled: false,
  transferEnabled: false,
  internalRuntimeEnabled: false,
  privateLivePilotEnabled: false,
  finalBindingPresent: false,
  profileHolders: [],
  controlHolders: [ownerId],
  hostChromium: false,
  authorizedTopologyExact: true,
  repairLedger: 'absent',
};

function acceptsExactLiveState(value) {
  const exactArray = (actual, expected) =>
    Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
  const ownerStateAllowed =
    value.ownerStatus === 'running-healthy' ||
    (value.ownerStatus === 'exited' && value.repairLedger === 'intent');
  return (
    exactArray(value.h14Children, exactLiveState.h14Children) &&
    exactArray(value.h14Entries, exactLiveState.h14Entries) &&
    value.h14RecordIdentityStable === true &&
    value.h14RecordContentStable === true &&
    value.recordedOwnerId === ownerId &&
    exactArray(value.ownerInventory, [ownerId]) &&
    value.ownerContractExact === true &&
    ownerStateAllowed &&
    value.recordedCoordinatorId === coordinatorId &&
    exactArray(value.coordinatorInventory, []) &&
    value.predecessorHelperSha256 === predecessorHelperSha256 &&
    exactArray(value.helperResidue, []) &&
    value.grant === 'disabled-only' &&
    value.financialMode === 'dry_run' &&
    value.executorEnabled === false &&
    value.finalActionEnabled === false &&
    value.amountEntryEnabled === false &&
    value.transferEnabled === false &&
    value.internalRuntimeEnabled === false &&
    value.privateLivePilotEnabled === false &&
    value.finalBindingPresent === false &&
    exactArray(value.profileHolders, []) &&
    exactArray(value.controlHolders, [ownerId]) &&
    value.hostChromium === false &&
    value.authorizedTopologyExact === true &&
    ['absent', 'intent'].includes(value.repairLedger)
  );
}

assert.equal(acceptsExactLiveState(exactLiveState), true);
const exitedAfterIntent = {
  ...clone(exactLiveState),
  ownerStatus: 'exited',
  repairLedger: 'intent',
};
assert.equal(acceptsExactLiveState(exitedAfterIntent), true);
assert.equal(
  acceptsExactLiveState({ ...clone(exactLiveState), ownerStatus: 'exited' }),
  false,
  'an exited Owner is resumable only after the external repair intent is immutable',
);

for (const [description, mutate] of [
  ['wrong H14 child', (value) => (value.h14Children = ['foreign'])],
  ['foreign H14 file', (value) => value.h14Entries.push('foreign')],
  ['missing H14 record', (value) => value.h14Entries.pop()],
  ['changed H14 inode', (value) => (value.h14RecordIdentityStable = false)],
  ['changed H14 record bytes', (value) => (value.h14RecordContentStable = false)],
  ['wrong recorded Owner', (value) => (value.recordedOwnerId = 'c'.repeat(64))],
  ['second Owner', (value) => value.ownerInventory.push('c'.repeat(64))],
  ['wrong Owner contract', (value) => (value.ownerContractExact = false)],
  ['unhealthy Owner', (value) => (value.ownerStatus = 'running-unhealthy')],
  ['wrong recorded coordinator', (value) => (value.recordedCoordinatorId = 'c'.repeat(64))],
  ['coordinator still present', (value) => value.coordinatorInventory.push(coordinatorId)],
  ['wrong helper', (value) => (value.predecessorHelperSha256 = '0'.repeat(64))],
  ['helper residue', (value) => value.helperResidue.push('.helper.partial')],
  ['active grant', (value) => (value.grant = 'active-only')],
  ['both grants', (value) => (value.grant = 'both')],
  ['malformed disabled grant', (value) => (value.grant = 'malformed-disabled')],
  ['live financial mode', (value) => (value.financialMode = 'live')],
  ['executor enabled', (value) => (value.executorEnabled = true)],
  ['final action enabled', (value) => (value.finalActionEnabled = true)],
  ['Amount enabled', (value) => (value.amountEntryEnabled = true)],
  ['Transfer enabled', (value) => (value.transferEnabled = true)],
  ['internal runtime enabled', (value) => (value.internalRuntimeEnabled = true)],
  ['private live pilot enabled', (value) => (value.privateLivePilotEnabled = true)],
  ['final binding present', (value) => (value.finalBindingPresent = true)],
  ['profile holder', (value) => value.profileHolders.push('c'.repeat(64))],
  ['extra control holder', (value) => value.controlHolders.push('c'.repeat(64))],
  ['host Chromium', (value) => (value.hostChromium = true)],
  ['changed authorized topology', (value) => (value.authorizedTopologyExact = false)],
  ['foreign repair ledger', (value) => (value.repairLedger = 'foreign')],
]) {
  const changed = clone(exactLiveState);
  mutate(changed);
  assert.equal(acceptsExactLiveState(changed), false, `${description} must fail closed`);
}

const phaseFunction = shellFunction(repair, 'classify_h14_base_phase');
const phasePythonPath = join(fixtureRoot, 'classify-h14-phase.py');
writeFileSync(phasePythonPath, heredocBody(phaseFunction), { mode: 0o600 });
chmodSync(phasePythonPath, 0o600);

function makePhaseRoot(name, entries) {
  const path = join(fixtureRoot, name);
  mkdirSync(path, { mode: 0o700 });
  for (const entry of entries) {
    const target = join(path, entry);
    if (entry === 'quarantined-profile-v1') mkdirSync(target, { mode: 0o700 });
    else writeFileSync(target, 'fixture\n', { mode: 0o600 });
  }
  return path;
}

function classifyPhase(path) {
  return spawnSync(python, ['-I', phasePythonPath, path, adoptionName], { encoding: 'utf8' });
}

let phaseCounter = 0;
const adoptionEntries = [adoptionName];
let result = classifyPhase(makePhaseRoot(`phase-${phaseCounter++}`, adoptionEntries));
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.trim(), 'adoption-only');

result = classifyPhase(
  makePhaseRoot(`phase-${phaseCounter++}`, [
    adoptionName,
    '.runtime-retirement-intent-v1.installing',
  ]),
);
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.trim(), 'runtime-intent-prepared');

const completedH14Entries = [adoptionName, 'runtime-retirement-intent-v1'];
result = classifyPhase(makePhaseRoot(`phase-${phaseCounter++}`, completedH14Entries));
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.trim(), 'runtime-intent');

const forwardPhases = [
  ['runtime-retired-v1', true],
  ['intent-v1', true],
  ['predecessor-helper', true],
  ['retired-binding-v3', false],
  ['player-stage-consumption-v1', true],
  ['claim-stage-consumption-v1', true],
  ['retired-retryable-failure-v1', false],
  ['quarantined-profile-v1', false],
  ['host-retired-v1', true],
  ['owner-runtime-restored-v1', true],
];

for (const [name, hasTemporary] of forwardPhases) {
  if (hasTemporary) {
    const temporaryResult = classifyPhase(
      makePhaseRoot(`phase-${phaseCounter++}`, [...completedH14Entries, `.${name}.installing`]),
    );
    assert.equal(temporaryResult.status, 0, `${name} prefix: ${temporaryResult.stderr}`);
    assert.equal(
      temporaryResult.stdout.trim(),
      'post-retirement',
      `${name} publication interruption must be resumable`,
    );
  }
  completedH14Entries.push(name);
  const completedResult = classifyPhase(
    makePhaseRoot(`phase-${phaseCounter++}`, completedH14Entries),
  );
  assert.equal(completedResult.status, 0, `${name}: ${completedResult.stderr}`);
  assert.equal(
    completedResult.stdout.trim(),
    name === 'owner-runtime-restored-v1' ? 'complete' : 'post-retirement',
  );
}

for (const entries of [
  [],
  ['runtime-retirement-intent-v1'],
  [adoptionName, 'runtime-retired-v1'],
  [adoptionName, 'runtime-retirement-intent-v1', 'owner-runtime-restored-v1'],
  [adoptionName, 'runtime-retirement-intent-v1', 'foreign-v1'],
  [...completedH14Entries, 'foreign-v1'],
]) {
  const rejected = classifyPhase(makePhaseRoot(`phase-reject-${phaseCounter++}`, entries));
  assert.notEqual(
    rejected.status,
    0,
    `foreign or non-prefix H14 entries must fail: ${JSON.stringify(entries)}`,
  );
}

const resumableInterruptionStates = [
  {
    name: 'repair-intent-publication-prefix',
    ledger: 'intent-installing-exact-prefix',
    h14: 'runtime-intent',
    owner: 'running-healthy',
    helper: 'predecessor',
    grant: 'disabled',
  },
  {
    name: 'before-owner-stop',
    ledger: 'intent',
    h14: 'runtime-intent',
    owner: 'running-healthy',
    helper: 'predecessor',
    grant: 'disabled',
  },
  {
    name: 'owner-stopped-before-runtime-retired',
    ledger: 'intent',
    h14: 'runtime-intent',
    owner: 'exited',
    helper: 'predecessor',
    grant: 'disabled',
  },
  {
    name: 'forward-evidence-publication-prefix',
    ledger: 'intent',
    h14: 'post-retirement',
    owner: 'exited',
    helper: 'predecessor',
    grant: 'disabled',
  },
  {
    name: 'after-host-retirement-before-owner-restart',
    ledger: 'intent',
    h14: 'post-retirement',
    owner: 'exited',
    helper: 'predecessor',
    grant: 'disabled',
  },
  {
    name: 'owner-restarted-before-restoration-record',
    ledger: 'intent',
    h14: 'post-retirement',
    owner: 'running-healthy',
    helper: 'predecessor',
    grant: 'disabled',
  },
  {
    name: 'h14-finalized-before-helper-rotation',
    ledger: 'intent',
    h14: 'final',
    owner: 'running-healthy',
    helper: 'predecessor',
    grant: 'disabled',
  },
  {
    name: 'helper-copy-partial-exact-prefix',
    ledger: 'intent',
    h14: 'final',
    owner: 'running-healthy',
    helper: 'successor-partial-prefix',
    grant: 'disabled',
  },
  {
    name: 'helper-copy-complete-before-rename',
    ledger: 'intent',
    h14: 'final',
    owner: 'running-healthy',
    helper: 'successor-installing',
    grant: 'disabled',
  },
  {
    name: 'helper-rotated-before-grant-restoration',
    ledger: 'intent',
    h14: 'final',
    owner: 'running-healthy',
    helper: 'successor',
    grant: 'disabled',
  },
  {
    name: 'grant-restored-before-completion-ledger',
    ledger: 'intent',
    h14: 'final',
    owner: 'running-healthy',
    helper: 'successor',
    grant: 'active',
  },
  {
    name: 'completion-ledger-publication-prefix',
    ledger: 'completed-installing-exact-prefix',
    h14: 'final',
    owner: 'running-healthy',
    helper: 'successor',
    grant: 'active',
  },
  {
    name: 'terminal',
    ledger: 'completed',
    h14: 'final',
    owner: 'running-healthy',
    helper: 'successor',
    grant: 'active',
  },
];

function interruptionTopologyIsForwardOnly(value) {
  const exact = resumableInterruptionStates.find((candidate) => candidate.name === value.name);
  return (
    exact !== undefined &&
    ['ledger', 'h14', 'owner', 'helper', 'grant'].every((field) => value[field] === exact[field])
  );
}

for (const state of resumableInterruptionStates) {
  assert.equal(interruptionTopologyIsForwardOnly(state), true, state.name);
  for (const field of ['ledger', 'h14', 'owner', 'helper', 'grant']) {
    const impossible = { ...state, [field]: `foreign-${field}` };
    assert.equal(
      interruptionTopologyIsForwardOnly(impossible),
      false,
      `${state.name} must reject a foreign ${field}`,
    );
  }
}

const exactCompletionTopology = {
  ledger: 'completed',
  h14: 'final',
  owner: 'running-healthy',
  helper: 'successor',
  grant: 'active',
};

function acceptsCompletionTopology(value) {
  return (
    ['completed-installing-exact-prefix', 'completed'].includes(value.ledger) &&
    value.h14 === exactCompletionTopology.h14 &&
    value.owner === exactCompletionTopology.owner &&
    value.helper === exactCompletionTopology.helper &&
    value.grant === exactCompletionTopology.grant
  );
}

for (const ledger of ['completed-installing-exact-prefix', 'completed']) {
  const exact = { ...exactCompletionTopology, ledger };
  assert.equal(acceptsCompletionTopology(exact), true, ledger);
  for (const [field, foreign] of [
    ['h14', 'runtime-intent'],
    ['h14', 'post-retirement'],
    ['owner', 'exited'],
    ['owner', 'running-unhealthy'],
    ['helper', 'predecessor'],
    ['helper', 'partial-successor'],
    ['grant', 'disabled'],
    ['grant', 'both'],
  ]) {
    assert.equal(
      acceptsCompletionTopology({ ...exact, [field]: foreign }),
      false,
      `${ledger} must reject ${field}=${foreign}`,
    );
  }
}

assert.equal(
  resumableInterruptionStates.some(
    ({ ledger, owner }) =>
      ['completed-installing-exact-prefix', 'completed'].includes(ledger) && owner === 'exited',
  ),
  false,
  'an exited Owner is never a completion-ledger topology',
);

const initialLiveFunction = shellFunction(repair, 'require_exact_initial_live_prefix');
for (const required of [
  '[[ "$h14_state" == \'interrupted\' ]]',
  "$'empty-predecessor-checkpoint-adoption-v1\\nruntime-retirement-intent-v1'",
  'require_adopted_empty_checkpoint_record "$H14_WORK_ROOT"',
  'load_runtime_retirement_intent',
  'require_disabled_grant_only',
  'require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755',
  'require_no_helper_installer_residue',
  'container_full_ids_for_service kemerbet-session-provision',
  '! docker_local container inspect "$COORDINATOR_CONTAINER_ID"',
  'container_full_ids_for_service owner-control',
  '[[ "$owner_inventory" == "$OWNER_CONTAINER_ID" ]]',
  'require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control',
  "--format '{{.State.Status}}'",
  "--format '{{.State.Health.Status}}'",
  'container_semantic_contract_digest "$OWNER_CONTAINER_ID"',
  'container_full_ids_for_volume "$PROFILE_VOLUME"',
  'container_full_ids_for_volume "$CONTROL_VOLUME"',
  '[[ -z "$profile_holders" && "$control_holders" == "$OWNER_CONTAINER_ID" ]]',
  'require_no_host_chromium',
  'require_financial_gates_disabled',
]) {
  assert.ok(initialLiveFunction.includes(required), `initial live prefix omits: ${required}`);
}
assert.doesNotMatch(
  initialLiveFunction,
  /container_contract_digest|OWNER_CONTRACT_SHA256" \]\]/,
  'the historical nondeterministic digest must never be a live-state branch condition',
);
assert.match(initialLiveFunction, /H14_ADOPTION_(?:DEVICE|DEV_INO)/);
assert.match(initialLiveFunction, /H14_ADOPTION_(?:INODE|DEV_INO)/);
assert.match(initialLiveFunction, /H14_RUNTIME_INTENT_(?:DEVICE|DEV_INO)/);
assert.match(initialLiveFunction, /H14_RUNTIME_INTENT_(?:INODE|DEV_INO)/);

const ledgerDiscoveryFunction = shellFunction(repair, 'discover_repair_ledger');
assert.match(ledgerDiscoveryFunction, /repair_state='absent'/);
assert.match(ledgerDiscoveryFunction, /"\.installing-\$REPAIR_RELEASE"/);
assert.match(ledgerDiscoveryFunction, /"\$REPAIR_RELEASE"/);
for (const allowedLedgerEntries of [
  "''",
  "'.intent-v1.installing'",
  "'intent-v1'",
  "$'.completed-v1.installing\\nintent-v1'",
  "$'completed-v1\\nintent-v1'",
]) {
  assert.ok(
    ledgerDiscoveryFunction.includes(allowedLedgerEntries),
    `ledger discovery omits the exact prefix ${allowedLedgerEntries}`,
  );
}
assert.match(ledgerDiscoveryFunction, /\[\[ "\$entries" == \$'completed-v1\\nintent-v1' \]\]/);
assert.match(ledgerDiscoveryFunction, /root:root:700/);
assert.match(ledgerDiscoveryFunction, /\*\) return 1/);

function classifyLedgerNamespace(namespace, entries) {
  const sorted = [...entries].sort().join('\n');
  if (namespace === 'absent') return entries.length === 0 ? 'absent' : 'invalid';
  if (namespace === `.installing-${'d'.repeat(40)}`) {
    return [
      '',
      '.intent-v1.installing',
      'intent-v1',
      '.completed-v1.installing\nintent-v1',
      'completed-v1\nintent-v1',
    ].includes(sorted)
      ? 'installing'
      : 'invalid';
  }
  if (namespace === 'd'.repeat(40))
    return sorted === 'completed-v1\nintent-v1' ? 'complete' : 'invalid';
  return 'invalid';
}

for (const entries of [
  [],
  ['.intent-v1.installing'],
  ['intent-v1'],
  ['intent-v1', '.completed-v1.installing'],
  ['intent-v1', 'completed-v1'],
]) {
  assert.equal(classifyLedgerNamespace(`.installing-${'d'.repeat(40)}`, entries), 'installing');
}
assert.equal(classifyLedgerNamespace('d'.repeat(40), ['intent-v1', 'completed-v1']), 'complete');
for (const [namespace, entries] of [
  ['foreign', []],
  [`.installing-${'d'.repeat(40)}`, ['foreign-v1']],
  [`.installing-${'d'.repeat(40)}`, ['intent-v1', 'foreign-v1']],
  [`.installing-${'d'.repeat(40)}`, ['completed-v1']],
  ['d'.repeat(40), ['intent-v1']],
  ['d'.repeat(40), ['intent-v1', 'completed-v1', 'foreign-v1']],
]) {
  assert.equal(classifyLedgerNamespace(namespace, entries), 'invalid');
}

const createLedgerFunction = shellFunction(repair, 'create_repair_installing_root');
assert.match(createLedgerFunction, /mkdir --mode=0700 -- "\$REPAIR_PARENT"/);
assert.match(createLedgerFunction, /mkdir --mode=0700 -- "\$REPAIR_INSTALLING"/);
assert.match(createLedgerFunction, /sync -f "\$\(dirname "\$REPAIR_PARENT"\)"/);
assert.match(createLedgerFunction, /sync -f "\$REPAIR_PARENT"/);
assert.match(createLedgerFunction, /\[\[ -z "\$\(find -P "\$REPAIR_PARENT"/);
assert.doesNotMatch(createLedgerFunction, /\brm\b|unlink|rmdir|O_TRUNC/);

const publishRecordFunction = shellFunction(repair, 'publish_recovery_record');
assert.match(publishRecordFunction, /O_APPEND \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/);
assert.match(publishRecordFunction, /os\.O_CREAT \| os\.O_EXCL/);
assert.match(publishRecordFunction, /current != data\[:before\.st_size\]/);
assert.match(publishRecordFunction, /os\.fsync\(descriptor\)/);
assert.match(publishRecordFunction, /mv -- "\$temporary" "\$final"/);
assert.match(publishRecordFunction, /sync -f "\$root"/);
assert.doesNotMatch(publishRecordFunction, /O_TRUNC|\brm\b|unlink/);

const expectedIntentFunction = shellFunction(repair, 'expected_repair_intent');
for (const field of [
  'repair_implementation_release=$REPAIR_RELEASE',
  'canonical_h14_recovery_release=$RECOVERY_RELEASE',
  'authorization_sha256=$AUTHORIZATION_SHA256',
  'h14_authorized_namespace=.installing-$RECOVERY_RELEASE',
  'h14_namespace_device=$H14_NAMESPACE_DEVICE',
  'h14_namespace_inode=$H14_NAMESPACE_INODE',
  'h14_adoption_record_sha256=$H14_ADOPTION_SHA256',
  'h14_runtime_retirement_intent_sha256=$H14_RUNTIME_INTENT_SHA256',
  'coordinator_container_id=$COORDINATOR_CONTAINER_ID',
  'coordinator_historical_contract_sha256=$COORDINATOR_CONTRACT_SHA256',
  'coordinator_absent=true',
  'owner_container_id=$OWNER_CONTAINER_ID',
  'owner_historical_contract_sha256=$OWNER_CONTRACT_SHA256',
  'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2',
  'owner_semantic_contract_sha256=$OWNER_SEMANTIC_CONTRACT_SHA256',
  'mounts_order=full-canonical-json-sorted',
  'config_cmd_order=preserved',
  'config_env_order=preserved',
  'deployment_grant=disabled',
  'installed_helper_sha256=$PREDECESSOR_HELPER_SHA256',
  'owner_state=running',
  'owner_health=healthy',
  'profile_volume_holders=none',
  'control_volume_holder=$OWNER_CONTAINER_ID',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'internal_kemerbet_execution_runtime_enabled=false',
  'kemerbet_private_live_deposit_pilot_enabled=false',
  'money_moved=false',
  'legacy_contract_digest_compared=false',
  'canonical_h14_evidence_rewritten=false',
  'canonical_h14_release_superseded=false',
]) {
  assert.ok(expectedIntentFunction.includes(field), `repair intent omits: ${field}`);
}
assert.match(expectedIntentFunction, /h14_adoption_record_(?:device|dev_ino)=/);
assert.match(expectedIntentFunction, /h14_adoption_record_(?:inode|dev_ino)=/);
assert.match(expectedIntentFunction, /h14_runtime_retirement_intent_(?:device|dev_ino)=/);
assert.match(expectedIntentFunction, /h14_runtime_retirement_intent_(?:inode|dev_ino)=/);

const loadIntentFunction = shellFunction(repair, 'load_repair_intent');
assert.match(loadIntentFunction, /root:root:600:1/);
assert.match(loadIntentFunction, /cmp -s -- "\$path" <\(expected_repair_intent\)/);
assert.match(loadIntentFunction, /load_runtime_retirement_intent/);
assert.match(loadIntentFunction, /"\$OWNER_CONTRACT_SHA256" == "\$LEDGER_OWNER_CONTRACT_SHA256"/);
assert.match(
  loadIntentFunction,
  /"\$COORDINATOR_CONTRACT_SHA256" == "\$LEDGER_COORDINATOR_CONTRACT_SHA256"/,
);
assert.match(loadIntentFunction, /"\$current_adoption_sha" == "\$H14_ADOPTION_SHA256"/);
assert.match(loadIntentFunction, /"\$current_runtime_sha" == "\$H14_RUNTIME_INTENT_SHA256"/);
assert.match(loadIntentFunction, /"\$current_adoption_(?:device|dev_ino)"/);
assert.match(loadIntentFunction, /"\$current_adoption_(?:inode|dev_ino)"/);
assert.match(loadIntentFunction, /"\$current_runtime_(?:device|dev_ino)"/);
assert.match(loadIntentFunction, /"\$current_runtime_(?:inode|dev_ino)"/);

const expectedCompletedFunction = shellFunction(repair, 'expected_repair_completed');
for (const field of [
  'state=completed',
  'repair_implementation_release=$REPAIR_RELEASE',
  'canonical_h14_recovery_release=$RECOVERY_RELEASE',
  'h14_final_namespace=$RECOVERY_RELEASE',
  'h14_namespace_device=$H14_NAMESPACE_DEVICE',
  'h14_namespace_inode=$H14_NAMESPACE_INODE',
  'owner_container_id=$OWNER_CONTAINER_ID',
  'owner_running=true',
  'owner_healthy=true',
  'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2',
  'owner_semantic_contract_sha256=$OWNER_SEMANTIC_CONTRACT_SHA256',
  'coordinator_absent=true',
  'successor_helper_sha256=$SUCCESSOR_HELPER_SHA256',
  'deployment_grant=active',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'money_moved=false',
  'repair_intent_sha256=$REPAIR_INTENT_SHA256',
  'h14_owner_runtime_restored_sha256=$H14_OWNER_RESTORED_SHA256',
  'legacy_contract_digest_compared=false',
  'canonical_h14_evidence_rewritten=false',
  'canonical_h14_release_superseded=false',
]) {
  assert.ok(expectedCompletedFunction.includes(field), `repair completion omits: ${field}`);
}

const prepareRepairIntentFunction = shellFunction(repair, 'prepare_or_load_repair_intent');
assert.match(
  prepareRepairIntentFunction,
  /elif \[\[ "\$repair_state" == 'complete' \]\]; then[\s\S]*?\[\[ "\$h14_state" == 'retired' \]\] \|\| return 1[\s\S]*?require_helper_file "\$TARGET" "\$SUCCESSOR_HELPER_SHA256" 755 \|\| return 1[\s\S]*?require_active_grant_only \|\| return 1[\s\S]*?load_repair_intent \|\| return 1[\s\S]*?require_repair_completed_record/,
  'a final repair ledger is valid only beside final H14, the successor helper, the active grant, and its exact completed record',
);
assert.match(
  prepareRepairIntentFunction,
  /"\$entries" == \$'\.completed-v1\.installing\\nintent-v1'[\s\S]*?"\$entries" == \$'completed-v1\\nintent-v1'[\s\S]*?\[\[ "\$h14_state" == 'retired' \]\] \|\| return 1[\s\S]*?require_helper_file "\$TARGET" "\$SUCCESSOR_HELPER_SHA256" 755 \|\| return 1[\s\S]*?require_active_grant_only \|\| return 1/,
  'a completion publication prefix must reject an interrupted H14/helper/grant topology before resuming',
);
assert.match(
  prepareRepairIntentFunction,
  /if \[\[ "\$entries" == \$'\.completed-v1\.installing\\nintent-v1' \]\]; then[\s\S]*?require_repair_completion_temporary_prefix \|\| return 1[\s\S]*?elif \[\[ "\$entries" == \$'completed-v1\\nintent-v1' \]\]; then[\s\S]*?require_repair_completed_record \|\| return 1/,
  'both interrupted and final completion records must be validated before the repair can continue',
);

const completionPrefixFunction = shellFunction(
  repair,
  'require_repair_completion_temporary_prefix',
);
assert.match(completionPrefixFunction, /prepare_completion_values \|\| return 1/);
assert.match(completionPrefixFunction, /data != expected\[:value\.st_size\]/);
assert.match(completionPrefixFunction, /value\.st_size > len\(expected\)/);
assert.match(completionPrefixFunction, /0, 0, 0o600, 1/);
assert.doesNotMatch(completionPrefixFunction, /O_TRUNC|O_WRONLY|os\.write|os\.rename/);

const continuityFunction = shellFunction(repair, 'attest_repair_runtime_continuity');
assert.match(
  continuityFunction,
  /running\)[\s\S]*?State\.Health\.Status[\s\S]*?== 'healthy'[\s\S]*?exited\)[\s\S]*?\[\[ "\$h14_state" == 'interrupted' \]\] \|\| return 1/,
  'only an interrupted H14 prefix may resume with the exact Owner exited',
);
assert.match(
  continuityFunction,
  /else[\s\S]*?\[\[ "\$H14_PREFIX_PHASE" == 'complete' \]\] \|\| return 1/,
  'a retired H14 namespace must be structurally complete',
);

const helperPrefixFunction = shellFunction(repair, 'require_resumable_helper_installation_prefix');
for (const required of [
  'require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755',
  'require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600',
  'require_no_helper_installer_residue',
  'require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755',
  '[[ -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]',
  'actual != expected[:partial_value.st_size]',
  'stat.S_IMODE(partial_value.st_mode) == 0o755 and actual != expected',
]) {
  assert.ok(helperPrefixFunction.includes(required), `helper-resume prefix omits: ${required}`);
}
assert.match(
  continuityFunction,
  /if require_helper_file "\$TARGET" "\$PREDECESSOR_HELPER_SHA256" 755; then[\s\S]*?require_disabled_grant_only \|\| return 1[\s\S]*?require_resumable_helper_installation_prefix \|\| return 1/,
  'a final H14 predecessor-helper phase may resume only an exact successor-helper prefix under the disabled grant',
);
assert.match(
  helperPrefixFunction,
  /if \[\[ -e "\$INSTALLING_HELPER" \|\| -L "\$INSTALLING_HELPER" \]\]; then[\s\S]*?\[\[ ! -e "\$INSTALLING_HELPER_PARTIAL" && ! -L "\$INSTALLING_HELPER_PARTIAL" \]\]/,
  'the two helper installer artifacts must never coexist',
);

const resumeFinalOwnerFunction = shellFunction(repair, 'resume_final_owner_for_repair_completion');
for (const required of [
  '[[ "$h14_state" == \'retired\' ]] || return 0',
  '[[ "$repair_state" == \'installing\' && "$owner_state" == \'exited\' ]] || return 1',
  '[[ "$H14_PREFIX_PHASE" == \'complete\' ]] || return 1',
  'require_exact_owner_restored_record',
  '"$owner_inventory" == "$OWNER_CONTAINER_ID"',
  '-z "$coordinator_inventory"',
  '-z "$profile_holders"',
  '"$control_holders" == "$OWNER_CONTAINER_ID"',
  'require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control',
  'container_semantic_contract_digest "$OWNER_CONTAINER_ID"',
  'require_no_host_chromium',
  'require_financial_gates_disabled',
  'docker_local container start "$OWNER_CONTAINER_ID"',
  "--format '{{.State.Health.Status}}'",
]) {
  assert.ok(resumeFinalOwnerFunction.includes(required), `final Owner resume omits: ${required}`);
}
assert.equal(
  (resumeFinalOwnerFunction.match(/docker_local container start "\$OWNER_CONTAINER_ID"/g) ?? [])
    .length,
  1,
  'the only repair-completion restart must target the exact recorded Owner once',
);
assert.ok(
  resumeFinalOwnerFunction.indexOf(
    '[[ "$repair_state" == \'installing\' && "$owner_state" == \'exited\' ]] || return 1',
  ) < resumeFinalOwnerFunction.indexOf('docker_local container start "$OWNER_CONTAINER_ID"'),
  'a final immutable repair ledger must fail before the Owner start mutation',
);
assert.doesNotMatch(
  resumeFinalOwnerFunction.slice(
    0,
    resumeFinalOwnerFunction.indexOf('docker_local container start "$OWNER_CONTAINER_ID"'),
  ),
  /\[\[ "\$repair_state" == 'complete'/,
  'a final repair ledger may never authorize an automatic Owner restart',
);

const finalizeLedgerFunction = shellFunction(repair, 'finalize_repair_ledger');
assert.match(
  finalizeLedgerFunction,
  /publish_recovery_record "\$REPAIR_WORK_ROOT" completed-v1 600/,
);
assert.match(finalizeLedgerFunction, /\$'completed-v1\\nintent-v1'/);
assert.match(finalizeLedgerFunction, /mv -- "\$REPAIR_INSTALLING" "\$REPAIR_ROOT"/);
assert.match(finalizeLedgerFunction, /sync -f "\$REPAIR_PARENT"/);
assert.match(finalizeLedgerFunction, /require_repair_completed_record/);
assert.doesNotMatch(finalizeLedgerFunction, /\brm\b|unlink|rmdir|O_TRUNC/);

const acquireLockFunction = shellFunction(repair, 'acquire_exact_mutation_lock');
for (const required of [
  'os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC',
  'flags | os.O_CREAT | os.O_EXCL',
  "os.open('mutation.lock', flags, dir_fd=root_descriptor)",
  "os.stat('mutation.lock', dir_fd=root_descriptor, follow_symlinks=False)",
  'stat.S_ISREG(before.st_mode)',
  'before.st_nlink',
  'stat.S_IMODE(before.st_mode)',
  'os.path.realpath(path) != path',
  'fcntl.LOCK_EX | fcntl.LOCK_NB',
  'before.st_size',
  'before.st_mtime_ns',
]) {
  assert.ok(acquireLockFunction.includes(required), `exact lock acquisition omits: ${required}`);
}
assert.match(acquireLockFunction, /before\.st_size\s*!=\s*0|before\.st_size[^\n]*0/);
assert.doesNotMatch(acquireLockFunction, /O_TRUNC|chmod 0600|chown root:root|>"\$LOCK"/);
assert.doesNotMatch(
  repair,
  /exec \{lock_fd\}>"\$LOCK"/,
  'the lock path must never be followed or truncated through shell redirection',
);
const releaseLockFunction = shellFunction(repair, 'release_exact_mutation_lock');
assert.match(releaseLockFunction, /exec \{LOCK_CONTROL_FD\}>&-/);
assert.match(releaseLockFunction, /wait "\$LOCK_HOLDER_PROCESS_ID"/);

// On POSIX, execute the exact embedded lock validator against hostile filesystem fixtures. The
// production validator is root-specific; substitute only the fixture uid/gid so CI can run it
// unprivileged without weakening any source assertion above.
if (process.platform !== 'win32' && typeof process.getuid === 'function') {
  const fixtureUid = process.getuid();
  const fixtureGid = process.getgid();
  let lockPython = heredocBody(acquireLockFunction);
  lockPython = lockPython
    .replaceAll(
      'os.fchown(root_descriptor, 0, 0)',
      `os.fchown(root_descriptor, ${fixtureUid}, ${fixtureGid})`,
    )
    .replaceAll(
      'os.fchown(lock_descriptor, 0, 0)',
      `os.fchown(lock_descriptor, ${fixtureUid}, ${fixtureGid})`,
    )
    .replaceAll('(0, 0, 0o700)', `(${fixtureUid}, ${fixtureGid}, 0o700)`)
    .replaceAll('(0, 0, 0o600, 1)', `(${fixtureUid}, ${fixtureGid}, 0o600, 1)`);
  const lockPythonPath = join(fixtureRoot, 'exact-mutation-lock.py');
  writeFileSync(lockPythonPath, lockPython, { mode: 0o600 });
  chmodSync(lockPythonPath, 0o600);

  const lockParent = join(fixtureRoot, 'lock-parent');
  const lockRoot = join(lockParent, 'lock-root');
  const lockPath = join(lockRoot, 'mutation.lock');
  mkdirSync(lockParent, { mode: 0o700 });
  const runLockFixture = () =>
    spawnSync(python, ['-I', lockPythonPath, lockRoot, lockPath], {
      encoding: 'utf8',
      input: '',
    });

  let lockResult = runLockFixture();
  assert.equal(lockResult.status, 0, `absent lock create: ${lockResult.stderr}`);
  assert.match(lockResult.stdout, /^locked:[0-9]+:[0-9]+\n$/);
  lockResult = runLockFixture();
  assert.equal(lockResult.status, 0, `exact existing lock: ${lockResult.stderr}`);

  chmodSync(lockPath, 0o644);
  assert.notEqual(runLockFixture().status, 0, 'wrong lock mode must fail closed');
  rmSync(lockPath);

  writeFileSync(lockPath, 'foreign\n', { mode: 0o600 });
  assert.notEqual(runLockFixture().status, 0, 'nonempty foreign lock must fail without truncation');
  assert.equal(readFileSync(lockPath, 'utf8'), 'foreign\n', 'foreign lock bytes must be preserved');
  rmSync(lockPath);

  const foreignTarget = join(lockParent, 'foreign-target');
  writeFileSync(foreignTarget, '', { mode: 0o600 });
  symlinkSync(foreignTarget, lockPath);
  assert.notEqual(runLockFixture().status, 0, 'symlink lock must fail closed');
  rmSync(lockPath);

  linkSync(foreignTarget, lockPath);
  assert.notEqual(runLockFixture().status, 0, 'hardlinked lock must fail closed');
  rmSync(lockPath);
  rmSync(foreignTarget);

  if (fixtureUid === 0) {
    writeFileSync(lockPath, '', { mode: 0o600 });
    chownSync(lockPath, 1, 1);
    assert.notEqual(runLockFixture().status, 0, 'wrong lock owner must fail closed');
    rmSync(lockPath);
  }
}

const retireRuntimeFunction = shellFunction(repair, 'retire_recovery_runtime');
assert.match(
  retireRuntimeFunction,
  /! docker_local container inspect "\$COORDINATOR_CONTAINER_ID"/,
);
assert.match(retireRuntimeFunction, /docker_local container ls --all --quiet/);
assert.match(retireRuntimeFunction, /com\.docker\.compose\.project=\$PROJECT_NAME/);
assert.match(retireRuntimeFunction, /com\.docker\.compose\.service=kemerbet-session-provision/);
assert.doesNotMatch(
  retireRuntimeFunction,
  /container (?:stop|rm|start) [^\n]*COORDINATOR_CONTAINER_ID/,
  'the already-absent coordinator must never be recreated or mutated by the live repair',
);
assert.match(retireRuntimeFunction, /docker_local container stop --time 20 "\$OWNER_CONTAINER_ID"/);
assert.equal(
  (retireRuntimeFunction.match(/container_semantic_contract_digest "\$OWNER_CONTAINER_ID"/g) ?? [])
    .length,
  2,
  'the exact Owner semantic contract must be identical before and after stop',
);
assert.match(
  retireRuntimeFunction,
  /\[\[ -z "\$profile_holders" && "\$control_holders" == "\$OWNER_CONTAINER_ID" \]\]/,
);
assert.match(
  retireRuntimeFunction,
  /\[\[ -z "\$running_profile_holders" && -z "\$running_control_holders" \]\]/,
);
assert.match(retireRuntimeFunction, /publish_recovery_record "\$H14_WORK_ROOT" runtime-retired-v1/);

const restoreOwnerFunction = shellFunction(repair, 'restore_owner_runtime_and_finalize');
assert.match(restoreOwnerFunction, /docker_local container start "\$OWNER_CONTAINER_ID"/);
assert.doesNotMatch(restoreOwnerFunction, /docker_local container (?:create|run|rm|restart)/);
assert.equal(
  (restoreOwnerFunction.match(/container_semantic_contract_digest "\$OWNER_CONTAINER_ID"/g) ?? [])
    .length,
  2,
  'the same full Owner ID must retain one semantic contract before start and after healthy restore',
);
assert.match(restoreOwnerFunction, /\$control_holders" == "\$OWNER_CONTAINER_ID"/);
assert.match(
  restoreOwnerFunction,
  /publish_recovery_record "\$H14_WORK_ROOT" owner-runtime-restored-v1/,
);
assert.match(restoreOwnerFunction, /mv -- "\$RECOVERY_INSTALLING" "\$RECOVERY_ROOT"/);
assert.match(restoreOwnerFunction, /sync -f "\$H14_PARENT"/);

const shellLines = repair
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const executableShell = shellLines.join('\n');
assert.doesNotMatch(
  executableShell,
  /docker_local container (?:exec|run|create|update|kill|restart|rename|commit|cp)\b/,
  'the repair has no Docker execution or container-creation path',
);
assert.doesNotMatch(
  executableShell,
  /docker_local volume (?:create|rm)\b/,
  'the repair never creates or deletes a volume',
);
assert.doesNotMatch(executableShell, /docker(?:_local)? compose\b/);
assert.doesNotMatch(executableShell, /container rm\b/);
assert.doesNotMatch(
  executableShell,
  /KEMERBET_(?:EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY)_ENABLED=true/,
);
assert.doesNotMatch(
  executableShell,
  /FETANAGENT_.*(?:EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*=(?:1|true|yes|on)/i,
);
assert.doesNotMatch(
  executableShell,
  /FINANCIAL_ACTIONS_MODE=(?:live|production|enabled|execute|real_money)/i,
);
assert.doesNotMatch(executableShell, /lookup_authorized=true|recheck_authorized=true/);
assert.doesNotMatch(
  executableShell,
  /run_helper_direct (?!verify\b|kemerbet-quarantine-recovery-ready\b|kemerbet-v3-recheck-bridge-ready\b)[a-z0-9-]+/,
  'the repair may attest reviewed state but may not invoke preview, lookup, recheck, or execution commands',
);
for (const safetyClaim of [
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'lookup_authorized=false',
  'recheck_authorized=false',
  'money_moved=false',
]) {
  assert.ok(repair.includes(safetyClaim), `repair omits immutable safety claim ${safetyClaim}`);
}

const mainStart = repair.indexOf(
  "\nrequire_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'",
  repair.indexOf('finalize_repair_ledger() {'),
);
assert.ok(mainStart >= 0, 'missing H14 live-repair main entry');
const main = repair.slice(mainStart + 1);
assert.match(
  main,
  /case "\$h14_children" in\s+"\.installing-\$RECOVERY_RELEASE"[\s\S]*?"\$RECOVERY_RELEASE"[\s\S]*?\*\) die/,
);
assert.doesNotMatch(
  main,
  /EMPTY_CHECKPOINT_RELEASE|predecessor-empty|adopt_exact_empty_predecessor_checkpoint/,
);
assert.match(main, /this repair accepts only the exact current two-record H14 prefix/);
const initialPhaseCaseStart = indexOrFail(main, 'case "$initial_h14_prefix_phase" in');
const initialPhaseCaseEnd = indexOrFail(
  main.slice(initialPhaseCaseStart),
  '\n  esac',
  'end of initial H14 phase case',
);
const initialPhaseCase = main.slice(
  initialPhaseCaseStart,
  initialPhaseCaseStart + initialPhaseCaseEnd,
);
const runtimeIntentArmStart = indexOrFail(initialPhaseCase, 'runtime-intent)');
const runtimeIntentArmEnd = indexOrFail(
  initialPhaseCase.slice(runtimeIntentArmStart),
  '\n      ;;',
  'end of runtime-intent arm',
);
const runtimeIntentArm = initialPhaseCase.slice(
  runtimeIntentArmStart,
  runtimeIntentArmStart + runtimeIntentArmEnd,
);
assert.match(runtimeIntentArm, /require_disabled_grant_only/);
assert.doesNotMatch(runtimeIntentArm, /require_active_grant_only/);

const prepareLedgerIndex = indexOrFail(main, 'prepare_or_load_repair_intent ||');
const resumeFinalOwnerIndex = indexOrFail(main, 'resume_final_owner_for_repair_completion ||');
const continuityIndex = indexOrFail(main, 'attest_repair_runtime_continuity ||');
const retireCallIndex = indexOrFail(main, 'retire_recovery_runtime ||');
const forwardCallIndex = indexOrFail(main, 'run_forward_only_recovery "$profile_mountpoint"');
const restoreCallIndex = indexOrFail(main, 'restore_owner_runtime_and_finalize ||');
const helperCopyIndex = indexOrFail(main, 'copy_helper_atomically "$STAGED_HELPER"');
const grantRestoreIndex = main.lastIndexOf(
  "restore_sudoers || die 'the deployment grant could not be restored safely'",
);
const finalContinuityIndex = main.lastIndexOf('attest_repair_runtime_continuity ||');
const finalizeLedgerIndex = main.lastIndexOf('finalize_repair_ledger ||');
const unlockIndex = main.lastIndexOf('release_exact_mutation_lock ||');
assert.ok(
  0 <= prepareLedgerIndex &&
    prepareLedgerIndex < resumeFinalOwnerIndex &&
    resumeFinalOwnerIndex < continuityIndex &&
    continuityIndex < retireCallIndex &&
    retireCallIndex < forwardCallIndex &&
    forwardCallIndex < restoreCallIndex &&
    restoreCallIndex < helperCopyIndex &&
    helperCopyIndex < grantRestoreIndex &&
    grantRestoreIndex < finalContinuityIndex &&
    finalContinuityIndex < finalizeLedgerIndex &&
    finalizeLedgerIndex < unlockIndex,
  'repair sequencing must be ledger -> narrow final-Owner resume -> exact continuity -> stop -> retire -> same-ID restore -> helper -> grant -> final continuity -> completion ledger -> unlock',
);
for (const mutation of [
  'resume_final_owner_for_repair_completion ||',
  'restore_sudoers ||',
  'prepare_or_load_runtime_retirement_intent ||',
  'retire_recovery_runtime ||',
  'run_forward_only_recovery "$profile_mountpoint"',
  'restore_owner_runtime_and_finalize ||',
  'copy_helper_atomically "$STAGED_HELPER"',
]) {
  assert.ok(
    prepareLedgerIndex < indexOrFail(main, mutation),
    `completion-ledger topology validation must precede mutation path: ${mutation}`,
  );
}
assert.match(
  main,
  /require_active_grant_only \|\| die 'the restored deployment grant is not exact'/,
);
assert.match(
  main,
  /KemerBet H14 live repair installed: canonical evidence preserved; Amount and Transfer disabled; no money moved\./,
);
assert.match(
  main,
  /KemerBet H14 live repair already valid: canonical evidence preserved; Amount and Transfer disabled; no money moved\./,
);

assert.ok(
  indexOrFail(main, 'prepare_or_load_repair_intent ||') <
    indexOrFail(
      main,
      'if [[ "$H14_WORK_ROOT" == "$RECOVERY_INSTALLING" ]] && ! host_retired_prefix_exists; then',
    ),
  'the external immutable intent must exist before Owner stop or any forward-only H14 retirement',
);

for (const scriptPath of [repairPath, h14Path, helperPath]) {
  const syntax = spawnSync('bash', ['-n', scriptPath], { cwd: root, encoding: 'utf8' });
  assert.equal(
    syntax.status,
    0,
    `bash syntax failed for ${scriptPath}: ${syntax.stderr || syntax.stdout}`,
  );
}

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.match(
  packageJson.scripts['test:infra'],
  /node infra\/verify-kemerbet-quarantine-recovery-v14-live-repair\.mjs/,
);
assert.ok(
  packageJson.scripts['test:infra'].indexOf(
    'node infra/verify-kemerbet-quarantine-recovery-v14.mjs',
  ) <
    packageJson.scripts['test:infra'].indexOf(
      'node infra/verify-kemerbet-quarantine-recovery-v14-live-repair.mjs',
    ),
  'the canonical H14 verifier must run before the focused live-repair verifier',
);

rmSync(fixtureRoot, { recursive: true, force: true });
console.log(
  `KemerBet H14 live-repair contracts verified: canonical Docker v2, exact ${recoveryRelease} prefix, immutable ledger, and no-money path.`,
);
