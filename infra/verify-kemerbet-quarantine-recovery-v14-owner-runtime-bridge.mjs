import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflowPath = resolve(root, '.github/workflows/staging-beta-deploy-smoke.yml');
const bridgePath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh',
);
const composePath = resolve(root, 'infra/compose.staging-beta.yaml');

const normalized = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const workflow = normalized(workflowPath);
const bridge = normalized(bridgePath);
const compose = normalized(composePath);

const canonicalH14 = '06459511d9330a0e1d956c42529b81aa9970e7a2';
const h13Release = '306818ca812bd2abce8479396c4eea8383ea00f9';
const reviewedRepairRelease = 'a579e3bf96c075dde9c36dbe3c66c09aaf84bc52';
const authorizationSha256 = '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874';
const successorHelperSha256 = 'c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58';
const previousAttestation = '38e9d2660b871c691afdd69541e17c17a7b55821';
const previousScript = 'dfad82098c2042a5cd884f7c1116a9b4e424ac8685a68db3c7633f58a7e22bfb';
const previousValidator = 'd4e4f91603956e2051d9b77ce8a43392b6d46c062c3d397d28fa18f499b15542';
const previousManifest = '25ff5bb29342bbb1404ff888dacb43d464867c113f8f3db04ebb2df4e90ae733';
const interruptedAttestation = '635557273ce4010df91b9e1be838479ad049528c';
const interruptedScript = '6c8b9b9c00f9b701c48043242e94b90f5a7c225dbf3ff2a674d269f5b9f13251';
const interruptedValidator = 'd4e4f91603956e2051d9b77ce8a43392b6d46c062c3d397d28fa18f499b15542';
const interruptedManifest = '131dce3956028251b023318cb88917fab9d237b3a11d8599e1bff986cefeb077';
const stagingProjectRef = 'spzpiyxheappsfyswewl';
const productionProjectRef = 'xzztugbgtulptnbpoelr';
const stagingDropletId = '593344964';
const bridgeMode = 'h14-owner-runtime-bridge-stage';

function section(source, startNeedle, endNeedle, description) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing ${description}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `unterminated ${description}`);
  return source.slice(start, end);
}

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
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  throw new Error('Python 3 is required for the H14 Owner-runtime bridge fixture verifier');
}

function indexOrFail(source, needle, description = needle) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, `missing ${description}`);
  return index;
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

const validateJob = section(
  workflow,
  '  validate-target:\n',
  '\n  build:\n',
  'target-validation job',
);
const stageJob = section(
  workflow,
  '  h14-owner-runtime-bridge-stage:\n',
  '\n  connectivity:\n',
  'Owner-only bridge staging job',
);

assert.match(workflow, /          - h14-owner-runtime-bridge-stage\n/);
for (const input of [
  'confirm_repair_implementation_sha',
  'confirm_quarantine_recovery_authorization_sha256',
  'confirm_owner_only_no_provider_action',
]) {
  assert.match(workflow, new RegExp(`^      ${input}:$`, 'm'), `missing workflow input ${input}`);
}
assert.match(workflow, new RegExp(`CANONICAL_H14_COMMIT: ${canonicalH14}`));
assert.match(workflow, new RegExp(`H14_RECOVERY_AUTHORIZATION_SHA256: ${authorizationSha256}`));
assert.match(workflow, new RegExp(`STAGING_PROJECT_REF: ${stagingProjectRef}`));
assert.match(workflow, new RegExp(`PRODUCTION_PROJECT_REF: ${productionProjectRef}`));
assert.match(workflow, new RegExp(`STAGING_DROPLET_ID: '${stagingDropletId}'`));

assert.match(
  validateJob,
  /if \[\[ "\$REQUESTED_MODE" == 'h14-owner-runtime-bridge-stage' \]\]; then/,
);
assert.match(validateJob, /"\$GITHUB_REF" != 'refs\/heads\/main'/);
assert.match(validateJob, /"\$CONFIRMED_COMMIT" == "\$CANONICAL_H14_COMMIT"/);
assert.match(validateJob, /"\$CONFIRMED_REPAIR_IMPLEMENTATION" == "\$GITHUB_SHA"/);
assert.match(validateJob, /"\$CONFIRMED_REPAIR_IMPLEMENTATION" != "\$CANONICAL_H14_COMMIT"/);
assert.match(
  validateJob,
  /"\$CONFIRMED_H14_AUTHORIZATION" == "\$H14_RECOVERY_AUTHORIZATION_SHA256"/,
);
assert.match(validateJob, /"\$CONFIRMED_OWNER_ONLY" == 'owner-only-no-provider-action-no-money'/);
assert.match(validateJob, /gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
assert.match(validateJob, /"\$main_sha" == "\$CANONICAL_H14_COMMIT"/);
for (const exactPrBinding of [
  '.state == \\"open\\"',
  '.base.ref == \\"main\\"',
  '.base.sha == \\"$CANONICAL_H14_COMMIT\\"',
  '.head.sha == \\"$GITHUB_SHA\\"',
  '.head.ref == \\"$branch_name\\"',
  '.head.repo.full_name == \\"$GITHUB_REPOSITORY\\"',
]) {
  assert.ok(validateJob.includes(exactPrBinding), `missing exact PR binding ${exactPrBinding}`);
}
assert.match(validateJob, /"\$\{#matching_pulls\[@\]\}" -eq 1/);
assert.match(
  validateJob,
  /\^\(plan\|transition-ssh-verify\|transition-stop-legacy\|unban-and-connectivity-check\|deploy-and-smoke\|h14-owner-runtime-bridge-stage\|recover-v1-retirement-after-expiry\|predecessor-stop-and-disable\|ecd47f5d-predecessor-stop-and-disable\|stop-and-disable\)\$/,
);
assert.match(validateJob, /else\n            \[\[ "\$GITHUB_REF" == 'refs\/heads\/main' \]\]/);
assert.match(validateJob, /\[\[ -z "\$CONFIRMED_REPAIR_IMPLEMENTATION" \]\]/);
assert.match(validateJob, /\[\[ -z "\$CONFIRMED_H14_AUTHORIZATION" \]\]/);
assert.match(validateJob, /\[\[ -z "\$CONFIRMED_OWNER_ONLY" \]\]/);

assert.match(stageJob, /if: inputs\.mode == 'h14-owner-runtime-bridge-stage'/);
assert.match(stageJob, /needs: validate-target/);
assert.match(stageJob, /environment: staging/);
assert.match(stageJob, /permissions:\n      contents: read\n      pull-requests: read/);
assert.match(
  stageJob,
  /"\$GITHUB_SHA" =~ \^\[0-9a-f\]\{40\}\$ && "\$CONFIRMED_REPAIR_IMPLEMENTATION" == "\$GITHUB_SHA"/,
);
assert.match(stageJob, /gh api "repos\/\$GITHUB_REPOSITORY\/git\/ref\/heads\/main"/);
assert.match(
  stageJob,
  /"\$\(git -C repair rev-parse HEAD\)" == "\$CONFIRMED_REPAIR_IMPLEMENTATION"/,
);
assert.match(stageJob, /"\$\(git -C canonical-h14 rev-parse HEAD\)" == "\$CANONICAL_H14_COMMIT"/);
assert.match(stageJob, new RegExp(`ref: ${canonicalH14}`));
assert.match(stageJob, /persist-credentials: false/g);

const buildStep = section(
  stageJob,
  '      - name: Build and seal only the canonical H14 Owner image\n',
  '      - name: Stage the no-secret Owner-only bundle as the unprivileged deployment identity\n',
  'canonical Owner build step',
);
assert.equal(
  countMatches(buildStep, /\bdocker build\b/g),
  1,
  'bridge must build exactly one image',
);
assert.match(buildStep, /docker build --pull=false --target admin/);
assert.match(buildStep, /--build-arg "VCS_REF=\$CANONICAL_H14_COMMIT"/);
assert.match(buildStep, /--tag "\$image" canonical-h14/);
assert.equal(
  countMatches(buildStep, /\bdocker save\b/g),
  1,
  'bridge must save exactly one image bundle',
);
assert.match(buildStep, /docker save --output "\$tar_path" "\$image"/);
assert.match(buildStep, /\.Config\.Labels "org\.opencontainers\.image\.revision"/);
assert.match(buildStep, /\.Config\.User.*'10001:10001'/s);
assert.match(buildStep, /\.Config\.Cmd.*'\["node","apps\/admin\/dist\/index\.js"\]'/s);
assert.match(buildStep, /len\(manifest\) != 1/);
assert.match(buildStep, /manifest\[0\]\.get\('RepoTags'\) != \[expected_tag\]/);
assert.match(buildStep, /target\.is_absolute\(\) or '\.\.' in target\.parts/);
assert.match(buildStep, /len\(members\) > 4096/);
assert.match(buildStep, /owner_image_tar_size=\$tar_size/);
assert.match(buildStep, /"\$tar_size" -le 1073741824/);

const requiredManifestLines = [
  'version=1',
  'contract=fetanagent-h14-owner-runtime-bridge-bundle',
  'repair_implementation_sha=$REVIEWED_REPAIR_RELEASE',
  'terminal_attestation_implementation_sha=$CONFIRMED_REPAIR_IMPLEMENTATION',
  'canonical_h14_sha=$CANONICAL_H14_COMMIT',
  'staging_project_ref=$STAGING_PROJECT_REF',
  'staging_droplet_id=$STAGING_DROPLET_ID',
  'authorization_sha256=$H14_RECOVERY_AUTHORIZATION_SHA256',
  'owner_image_tag=$image',
  'owner_image_id=$image_id',
  'owner_image_tar_sha256=$tar_sha',
  'canonical_compose_sha256=$compose_sha',
  'owner_runtime_bridge_script_sha256=$script_sha',
  'provider_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'money_moved=false',
];
for (const line of requiredManifestLines) {
  assert.ok(buildStep.includes(line), `bundle manifest is missing ${line}`);
}
assert.doesNotMatch(
  buildStep,
  /password|captcha|otp|player[_ -]?id|receiver[_ -]?(?:account|identifier)|cookie|session[_ -]?token/i,
  'the no-secret bundle must not contain credential, Player, or receiving-account material',
);

const stageStep = section(
  stageJob,
  '      - name: Stage the no-secret Owner-only bundle as the unprivileged deployment identity\n',
  '      - name: Emit the exact root-console invocation without executing it\n',
  'unprivileged bridge staging step',
);
assert.match(stageStep, /remote="fetanagent-admin@\$STAGING_VM_HOST"/);
assert.equal(
  countMatches(stageStep, /test "\$\(id -u\)" -ne 0/g),
  2,
  'both remote heredocs must prove the unprivileged deployment identity',
);
assert.match(stageStep, /test ! -e "\$remote_bundle"\n          test ! -L "\$remote_bundle"/);
assert.match(stageStep, /install -d -m 0700 "\$remote_bundle"/);
assert.equal(countMatches(stageStep, /ssh "\$\{ssh_opts\[@\]\}" "\$remote" bash -s --/g), 2);
assert.equal(countMatches(stageStep, /<<'REMOTE'/g), 2);
assert.match(stageStep, /StrictHostKeyChecking=yes/);
assert.match(stageStep, /IdentitiesOnly=yes/);
assert.match(stageStep, /UserKnownHostsFile="\$secret_dir\/known-hosts"/);
assert.match(stageStep, /fetanagent-owner-control-canonical-h14\.tar/);
assert.match(stageStep, /compose\.staging-beta\.yaml/);
assert.match(stageStep, /manifest-v1/);
assert.equal(countMatches(stageStep, /\bscp\b/g), 1, 'the bridge should have one bounded SCP');
assert.doesNotMatch(stageStep, /\bsudo\b/);
assert.doesNotMatch(stageStep, /\bdocker\b/);
assert.doesNotMatch(stageStep, /\bsupabase\b|\bpsql\b/);
assert.doesNotMatch(stageStep, /kemerbet\.co|agentsystem\.admindigi\.com/i);
assert.doesNotMatch(stageStep, /\b(?:Amount|Transfer)\b/);

const scpCommand =
  /scp "\$\{ssh_opts\[@\]\}" \\\n+            "\$BUNDLE_ROOT\/fetanagent-owner-control-canonical-h14\.tar" \\\n+            "\$BUNDLE_ROOT\/compose\.staging-beta\.yaml" \\\n+            "\$BUNDLE_ROOT\/manifest-v1" \\\n+            "\$remote:\$remote_bundle\/"/;
assert.match(stageStep, scpCommand, 'SCP must contain exactly the three reviewed files');
assert.match(
  stageStep,
  /find -P "\$remote_bundle" -mindepth 1 -maxdepth 1 -printf '%f:%y\\n'.*compose\.staging-beta\.yaml:f\n          fetanagent-owner-control-canonical-h14\.tar:f\n          manifest-v1:f/s,
);
assert.match(stageStep, /sha256sum "\$remote_bundle\/fetanagent-owner-control-canonical-h14\.tar"/);
assert.match(stageStep, /sha256sum "\$remote_bundle\/compose\.staging-beta\.yaml"/);
assert.match(stageStep, /sha256sum "\$remote_bundle\/manifest-v1"/);

const emitStep = stageJob.slice(
  stageJob.indexOf('      - name: Emit the exact root-console invocation'),
);
assert.match(
  emitStep,
  /This was staged only\. No remote Docker, Supabase, provider, helper, or financial mutation was performed\./,
);
assert.match(
  emitStep,
  /raw\.githubusercontent\.com\/\$GITHUB_REPOSITORY\/\$CONFIRMED_REPAIR_IMPLEMENTATION\/infra\/operations\/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge\.sh/,
);
assert.match(emitStep, /sha256sum '\$root_script'/);
assert.match(
  emitStep,
  /invocation="bash '\$root_script' '\$REVIEWED_REPAIR_RELEASE' '\$CANONICAL_H14_COMMIT' '\$CONFIRMED_REPAIR_IMPLEMENTATION' '\$REMOTE_BUNDLE' '\$MANIFEST_SHA' '\$H14_RECOVERY_AUTHORIZATION_SHA256'"/,
);
assert.doesNotMatch(emitStep, /\beval\b/);

// The SSH deployment key and known-hosts value are the only secrets the staging
// job may consume; neither is copied into the bundle or passed to the root bridge.
const secretExpressions = [...stageJob.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)].map(
  (match) => match[1],
);
assert.deepEqual(
  secretExpressions.sort(),
  ['STAGING_VM_HOST', 'STAGING_VM_KNOWN_HOSTS', 'STAGING_VM_SSH_PRIVATE_KEY'].sort(),
);

// Canonical compose is itself fail-closed for Owner-only creation.
const ownerCompose = section(
  compose,
  '  owner-control:\n',
  '\n  kemerbet-session-provision:\n',
  'Owner compose service',
);
assert.match(ownerCompose, /image: fetanagent-owner-control:/);
assert.match(ownerCompose, /target: admin/);
assert.match(ownerCompose, /user: '10001:10001'/);
assert.match(ownerCompose, /restart: 'no'/);
assert.match(ownerCompose, /read_only: true/);
assert.match(ownerCompose, /cap_drop:\n      - ALL/);
assert.match(ownerCompose, /no-new-privileges:true/);
assert.match(ownerCompose, /FINANCIAL_ACTIONS_MODE: dry_run/);
assert.match(ownerCompose, /KEMERBET_EXECUTOR_ENABLED: 'false'/);
assert.match(ownerCompose, /KEMERBET_FINAL_ACTION_ENABLED: 'false'/);
assert.match(ownerCompose, /127\.0\.0\.1:3002:3002/);

const repairFixture = reviewedRepairRelease;
const attestationFixture = 'a'.repeat(40);
const imageFixture = `fetanagent-owner-control:${canonicalH14.slice(0, 12)}`;
const imageIdFixture = `sha256:${'b'.repeat(64)}`;
const digestFixture = 'c'.repeat(64);
const scriptDigestFixture = 'd'.repeat(64);
const manifestFixtureLines = [
  'version=1',
  'contract=fetanagent-h14-owner-runtime-bridge-bundle',
  `repair_implementation_sha=${repairFixture}`,
  `terminal_attestation_implementation_sha=${attestationFixture}`,
  `canonical_h14_sha=${canonicalH14}`,
  `staging_project_ref=${stagingProjectRef}`,
  `staging_droplet_id=${stagingDropletId}`,
  `authorization_sha256=${authorizationSha256}`,
  'workflow_run_id=123456789',
  'workflow_run_attempt=1',
  `owner_image_tag=${imageFixture}`,
  `owner_image_id=${imageIdFixture}`,
  `owner_image_tar_sha256=${digestFixture}`,
  'owner_image_tar_size=1234567',
  `canonical_compose_sha256=${digestFixture}`,
  `owner_runtime_bridge_script_sha256=${scriptDigestFixture}`,
  'provider_action_enabled=false',
  'transfer_enabled=false',
  'amount_entry_enabled=false',
  'money_moved=false',
];

function validateManifestModel(lines) {
  assert.deepEqual(
    lines,
    manifestFixtureLines,
    'manifest must be exact, ordered, and duplicate-free',
  );
  assert.equal(new Set(lines.map((line) => line.split('=', 1)[0])).size, lines.length);
  assert.ok(lines.every((line) => !/[\0\r]/u.test(line)));
  return Object.fromEntries(
    lines.map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

const parsedManifestFixture = validateManifestModel(manifestFixtureLines);
assert.equal(parsedManifestFixture.repair_implementation_sha, repairFixture);
assert.equal(parsedManifestFixture.terminal_attestation_implementation_sha, attestationFixture);
assert.equal(parsedManifestFixture.canonical_h14_sha, canonicalH14);
assert.equal(parsedManifestFixture.owner_image_tag, imageFixture);
assert.equal(parsedManifestFixture.owner_image_id, imageIdFixture);
assert.equal(parsedManifestFixture.provider_action_enabled, 'false');
assert.equal(parsedManifestFixture.transfer_enabled, 'false');
assert.equal(parsedManifestFixture.amount_entry_enabled, 'false');
assert.equal(parsedManifestFixture.money_moved, 'false');

for (const mutate of [
  (lines) => lines.slice(0, -1),
  (lines) => [...lines, 'foreign=true'],
  (lines) => [...lines, lines[2]],
  (lines) => [lines[1], lines[0], ...lines.slice(2)],
  (lines) =>
    lines.map((line) =>
      line.startsWith('canonical_h14_sha=') ? `canonical_h14_sha=${repairFixture}` : line,
    ),
  (lines) =>
    lines.map((line) => (line === 'transfer_enabled=false' ? 'transfer_enabled=true' : line)),
  (lines) =>
    lines.map((line) =>
      line === 'amount_entry_enabled=false' ? 'amount_entry_enabled=true' : line,
    ),
  (lines) => lines.map((line) => (line === 'money_moved=false' ? 'money_moved=true' : line)),
  (lines) => [...lines.slice(0, 7), 'password=must-never-appear', ...lines.slice(7)],
]) {
  assert.throws(() => validateManifestModel(mutate([...manifestFixtureLines])));
}

const baseBridgeState = Object.freeze({
  h14Complete: true,
  liveRepairComplete: true,
  migrationApplied: true,
  canonicalHelper: true,
  terminalMarkerOnly: true,
  profileAbsent: true,
  cohortAbsent: true,
  finalBindingAbsent: true,
  coordinatorCount: 0,
  chromiumCount: 0,
  profileVolumeHolders: 0,
  controlVolumeHolder: 'old-owner',
  financialMode: 'dry_run',
  executorEnabled: false,
  finalActionEnabled: false,
  providerExecutionEnabled: false,
  transferEnabled: false,
  amountEnabled: false,
  nonOwnerInventory: 'public-api|running-healthy',
  currentNonOwnerInventory: 'public-api|running-healthy',
  oldOwner: 'running-healthy-h13',
  newOwner: 'absent',
  intent: false,
  replacementRecord: false,
  startRecord: false,
  completion: false,
  imageLoaded: false,
});

function requireModelPreconditions(state) {
  assert.equal(state.h14Complete, true);
  assert.equal(state.liveRepairComplete, true);
  assert.equal(state.migrationApplied, true);
  assert.equal(state.canonicalHelper, true);
  assert.equal(state.terminalMarkerOnly, true);
  assert.equal(state.profileAbsent, true);
  assert.equal(state.cohortAbsent, true);
  assert.equal(state.finalBindingAbsent, true);
  assert.equal(state.coordinatorCount, 0);
  assert.equal(state.chromiumCount, 0);
  assert.equal(state.profileVolumeHolders, 0);
  assert.equal(state.financialMode, 'dry_run');
  assert.equal(state.executorEnabled, false);
  assert.equal(state.finalActionEnabled, false);
  assert.equal(state.providerExecutionEnabled, false);
  assert.equal(state.transferEnabled, false);
  assert.equal(state.amountEnabled, false);
  assert.equal(
    state.currentNonOwnerInventory,
    state.nonOwnerInventory,
    'every non-Owner project container must remain byte-for-byte and state-for-state unchanged',
  );
}

function advanceBridgeModel(input, stopAfter = 'complete') {
  const state = structuredClone(input);
  requireModelPreconditions(state);
  if (state.completion) {
    assert.equal(state.intent, true);
    assert.equal(state.replacementRecord, true);
    assert.equal(state.startRecord, true);
    assert.equal(state.oldOwner, 'absent');
    assert.equal(state.newOwner, 'running-healthy-h14');
    assert.equal(state.controlVolumeHolder, 'new-owner');
    return state;
  }
  if (!state.intent) {
    assert.equal(state.oldOwner, 'running-healthy-h13');
    assert.equal(state.newOwner, 'absent');
    state.intent = true;
  }
  if (stopAfter === 'intent') return state;

  if (!state.imageLoaded) state.imageLoaded = true;
  if (stopAfter === 'image-loaded') return state;

  if (state.oldOwner === 'running-healthy-h13') {
    state.oldOwner = 'exited-h13';
    if (stopAfter === 'old-owner-stopped') return state;
  }
  assert.ok(
    ['exited-h13', 'absent'].includes(state.oldOwner),
    'only exact running H13 or its post-stop exited state is resumable',
  );
  if (state.oldOwner === 'exited-h13') {
    state.oldOwner = 'absent';
    state.controlVolumeHolder = 'none';
  }
  assert.equal(state.oldOwner, 'absent');
  if (stopAfter === 'old-owner-removed') return state;

  if (state.newOwner === 'absent') {
    state.newOwner = 'created-h14';
    state.controlVolumeHolder = 'new-owner';
  }
  if (!state.replacementRecord) {
    assert.equal(
      state.newOwner,
      'created-h14',
      'an unrecorded replacement must be exactly never-started created',
    );
    if (stopAfter === 'new-owner-created-unrecorded') return state;
    state.replacementRecord = true;
  }
  if (stopAfter === 'replacement-recorded') return state;

  if (!state.startRecord) {
    assert.equal(
      state.newOwner,
      'created-h14',
      'a replacement without durable start intent must remain created',
    );
    state.startRecord = true;
  }
  if (stopAfter === 'start-intent') return state;

  if (state.newOwner === 'created-h14') {
    state.newOwner = 'running-healthy-h14';
  } else {
    assert.equal(
      state.newOwner,
      'running-healthy-h14',
      'after durable start intent only exact created or already-running healthy is resumable',
    );
  }
  if (stopAfter === 'new-owner-started') return state;

  state.completion = true;
  return state;
}

const completedModel = advanceBridgeModel(baseBridgeState);
assert.equal(completedModel.completion, true);
assert.deepEqual(
  advanceBridgeModel(completedModel),
  completedModel,
  'terminal replay must be read-only',
);
for (const phase of [
  'intent',
  'image-loaded',
  'old-owner-stopped',
  'old-owner-removed',
  'new-owner-created-unrecorded',
  'replacement-recorded',
  'start-intent',
  'new-owner-started',
]) {
  const interrupted = advanceBridgeModel(baseBridgeState, phase);
  const resumed = advanceBridgeModel(interrupted);
  assert.equal(resumed.completion, true, `safe ${phase} interruption must resume exactly`);
  assert.equal(resumed.oldOwner, 'absent');
  assert.equal(resumed.newOwner, 'running-healthy-h14');
}
const unrecordedReplacement = advanceBridgeModel(baseBridgeState, 'new-owner-created-unrecorded');
for (const unsafeOwnerState of ['exited-h14', 'running-healthy-h14', 'running-unhealthy-h14']) {
  assert.throws(() => advanceBridgeModel({ ...unrecordedReplacement, newOwner: unsafeOwnerState }));
}
const recordedReplacement = advanceBridgeModel(baseBridgeState, 'replacement-recorded');
for (const unsafeOwnerState of ['exited-h14', 'running-healthy-h14', 'running-unhealthy-h14']) {
  assert.throws(() => advanceBridgeModel({ ...recordedReplacement, newOwner: unsafeOwnerState }));
}
const startIntent = advanceBridgeModel(baseBridgeState, 'start-intent');
assert.equal(
  advanceBridgeModel({ ...startIntent, newOwner: 'running-healthy-h14' }).completion,
  true,
  'a durably authorized already-running healthy replacement is safely resumable',
);
for (const unsafeOwnerState of ['exited-h14', 'running-unhealthy-h14', 'dead-h14']) {
  assert.throws(
    () => advanceBridgeModel({ ...startIntent, newOwner: unsafeOwnerState }),
    `a ${unsafeOwnerState} replacement must never be restarted`,
  );
}
for (const unsafeOldOwnerState of ['created-h13', 'dead-h13', 'running-unhealthy-h13']) {
  assert.throws(() =>
    advanceBridgeModel({
      ...advanceBridgeModel(baseBridgeState, 'image-loaded'),
      oldOwner: unsafeOldOwnerState,
    }),
  );
}
for (const [field, unsafeValue] of [
  ['h14Complete', false],
  ['liveRepairComplete', false],
  ['migrationApplied', false],
  ['canonicalHelper', false],
  ['terminalMarkerOnly', false],
  ['profileAbsent', false],
  ['cohortAbsent', false],
  ['finalBindingAbsent', false],
  ['coordinatorCount', 1],
  ['chromiumCount', 1],
  ['profileVolumeHolders', 1],
  ['financialMode', 'live'],
  ['executorEnabled', true],
  ['finalActionEnabled', true],
  ['providerExecutionEnabled', true],
  ['transferEnabled', true],
  ['amountEnabled', true],
  ['currentNonOwnerInventory', 'public-api|restarted'],
]) {
  assert.throws(
    () => advanceBridgeModel({ ...baseBridgeState, [field]: unsafeValue }),
    `unsafe ${field} state must fail closed`,
  );
}

// Root bridge assertions follow below. Keeping them in this focused verifier
// prevents a workflow-only change from being mistaken for a safe live bridge.
assert.match(bridge, /^#!\/usr\/bin\/env bash\n/);
assert.match(bridge, /set -euo pipefail/);
assert.match(bridge, /umask 077/);
assert.match(bridge, new RegExp(`readonly CANONICAL_H14='${canonicalH14}'`));
assert.match(bridge, new RegExp(`readonly PREDECESSOR_RELEASE='${h13Release}'`));
assert.match(bridge, new RegExp(`readonly REVIEWED_REPAIR_RELEASE='${reviewedRepairRelease}'`));
assert.match(bridge, new RegExp(`readonly AUTHORIZATION_SHA256='${authorizationSha256}'`));
assert.match(bridge, new RegExp(`readonly H14_HELPER_SHA256='${successorHelperSha256}'`));
assert.match(bridge, new RegExp(`readonly STAGING_PROJECT_REF='${stagingProjectRef}'`));
assert.match(bridge, new RegExp(`readonly EXPECTED_DROPLET_ID='${stagingDropletId}'`));
assert.match(bridge, /readonly EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'/);
assert.match(bridge, /\[\[ \$# -eq 6 \]\]/);
assert.match(bridge, /readonly ATTESTATION_RELEASE="\$3"/);
assert.match(bridge, /\[\[ "\$REPAIR_RELEASE" == "\$REVIEWED_REPAIR_RELEASE" \]\]/);
assert.match(bridge, /\[\[ "\$PROVIDED_CANONICAL_H14" == "\$CANONICAL_H14" \]\]/);
assert.match(bridge, /\[\[ "\$PROVIDED_AUTHORIZATION_SHA256" == "\$AUTHORIZATION_SHA256" \]\]/);
assert.match(bridge, /run only in a fresh DigitalOcean root console/);
assert.match(
  bridge,
  /-z "\$\{SUDO_USER:-\}" && -z "\$\{DOCKER_HOST:-\}" && -z "\$\{DOCKER_CONTEXT:-\}"/,
);
assert.match(bridge, /DOCKER_HOST="\$LOCAL_DOCKER_SOCKET"/);
assert.match(bridge, /--host "\$LOCAL_DOCKER_SOCKET"/);
assert.match(
  bridge,
  /curl --fail --silent --show-error --noproxy '\*' --max-time 3 "\$METADATA\/id"/,
);
assert.match(bridge, /"\$METADATA\/interfaces\/public\/0\/ipv4\/address"/);

const loadH14Function = shellFunction(bridge, 'load_exact_h14_and_mount_repair');
for (const required of [
  'h14_value = directory(h14_root, 0o700, [',
  "'claim-stage-consumption-v1'",
  "'host-retired-v1'",
  "'owner-runtime-restored-v1'",
  "'quarantined-profile-v1'",
  "'retired-binding-v3'",
  "'runtime-retired-v1'",
  "directory(repair_root, 0o700, ['completed-v1', 'intent-v1'])",
  "'state=completed'",
  "'owner_running=true'",
  "'owner_healthy=true'",
  "'coordinator_absent=true'",
  "'profile_volume_holders=none'",
  "'financial_actions_mode=dry_run'",
  "'kemerbet_executor_enabled=false'",
  "'kemerbet_final_action_enabled=false'",
  "'transfer_enabled=false'",
  "'amount_entry_enabled=false'",
  "'money_moved=false'",
]) {
  assert.ok(loadH14Function.includes(required), `canonical H14 evidence loader omits: ${required}`);
}
assert.match(loadH14Function, /os\.O_RDONLY \| os\.O_NOFOLLOW \| os\.O_CLOEXEC/);
assert.match(
  loadH14Function,
  /before\.st_dev, before\.st_ino, before\.st_size, before\.st_mtime_ns/,
);
assert.match(loadH14Function, /tree\.hexdigest\(\)/);
assert.doesNotMatch(loadH14Function, /os\.O_(?:WRONLY|RDWR)|os\.write|os\.rename|unlink|remove/);

const terminalAttestationFunction = shellFunction(bridge, 'load_exact_terminal_attestation');
assert.match(
  terminalAttestationFunction,
  /\['completed-v1', 'grant-restoration-intent-v1', 'intent-v1'\]/,
);
assert.match(terminalAttestationFunction, /attestation_implementation_release/);
assert.match(terminalAttestationFunction, /grant_restoration_intent_sha256/);
assert.match(terminalAttestationFunction, /repair_completion_sha256/);
assert.match(terminalAttestationFunction, /provider_action_enabled/);
for (const preservedInterruptedAttempt of [
  "directory(parent, [f'.installing-{interrupted_attestation}', attestation]",
  "directory(f'{parent}/.installing-{interrupted_attestation}', []",
  'interrupted_parent_dev_ino',
  'interrupted_empty_ledger_dev_ino',
  'interrupted_empty_ledger_state',
  'interrupted_attempt_preserved',
]) {
  assert.ok(
    terminalAttestationFunction.includes(preservedInterruptedAttempt),
    `terminal parser omits preserved interrupted attempt gate: ${preservedInterruptedAttempt}`,
  );
}
for (const binding of [
  "intent['deployment_grant_dev_ino']",
  "intent['deployment_grant_sha256']",
  "intent['repair_ledger_dev_ino']",
  "intent['profile_volume_root_dev_ino']",
  "intent['control_volume_root_dev_ino']",
  "intent['owner_receipt_root_dev_ino']",
  "intent['terminal_marker_dev_ino']",
  "intent['terminal_marker_sha256']",
  "intent['bundle_validator_dev_ino']",
  "intent['differential_validator_sha256']",
  "intent['differential_validator_size']",
]) {
  assert.ok(
    terminalAttestationFunction.includes(binding),
    `terminal parser omits live binding: ${binding}`,
  );
}
assert.doesNotMatch(
  terminalAttestationFunction,
  /(?:lookup|recheck|private-sign-in|profile|cohort|executor|final-action)-?(?:start|run|create|prepare|arm)/,
);
assert.doesNotMatch(bridge, /kemerbet-quarantine-recovery-ready/);

const liveTerminalBoundary = shellFunction(bridge, 'require_live_terminal_attestation_boundary');
for (const required of [
  'load_exact_terminal_attestation',
  'load_exact_h14_and_mount_repair',
  'require_active_grant_only',
  'ATTESTED_SUDOERS_DEV_INO',
  'ATTESTED_REPAIR_ROOT_DEV_INO',
  'ATTESTED_PROFILE_ROOT_DEV_INO',
  'ATTESTED_CONTROL_ROOT_DEV_INO',
  'ATTESTED_RECEIPT_ROOT_DEV_INO',
  'ATTESTED_TERMINAL_MARKER_DEV_INO',
  'ATTESTED_VALIDATOR_DEV_INO',
  'ATTESTED_CLAIM_ROOT_DEV_INO',
  'ATTESTED_TERMINAL_BRIDGE_DEV_INO',
  'ATTESTED_TERMINAL_MANIFEST_DEV_INO',
  'directory(profile_root, (10001, 10001), 0o700, profile_dev_ino, [])',
  'directory(control_root, (10001, 10001), 0o700, control_dev_ino, [])',
  'directory(receipt_root, (0, 0), 0o755, receipt_dev_ino, [marker_name])',
  "['completed-v1', 'intent-v1']",
  'os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC',
  '[previous_attestation, interrupted_attestation, attestation]',
  "previous_root = f'{claim_parent}/{previous_attestation}'",
  "interrupted_root = f'{claim_parent}/{interrupted_attestation}'",
  'directory(previous_root, (0, 0), 0o700, previous_root_dev_ino, names)',
  'directory(interrupted_root, (0, 0), 0o700, interrupted_root_dev_ino, names)',
  "exact_file(f'{previous_root}/{bridge_name}', (0, 0), 0o400,",
  "exact_file(f'{previous_root}/{validator_name}', (0, 0), 0o400,",
  "exact_file(f'{previous_root}/{manifest_name}', (0, 0), 0o400,",
  'exact_file(bridge, (0, 0), 0o400, bridge_dev_ino, bridge_sha, bridge_size)',
  'exact_file(manifest, (0, 0), 0o400, manifest_dev_ino, manifest_sha,',
  'PASS H14-D000',
  'require_financial_gates_disabled',
  'require_no_host_chromium',
  'container_full_ids_for_service kemerbet-session-provision',
  'container_full_ids_for_volume "$PROFILE_VOLUME"',
  'container_full_ids_for_volume "$CONTROL_VOLUME"',
  'require_container_no_chromium "$expected_control_holder"',
  'owner_state="$(docker_local container inspect "$expected_control_holder"',
  'running)',
  "owner_running\" == 'true'",
  "owner_health\" == 'healthy'",
  'exited|created)',
  "owner_running\" == 'false'",
  "owner_pid\" == '0'",
  'kemerbet-readiness-cohort-completed-v1',
  'kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1',
  'terminal-recovery-marker-v1',
]) {
  assert.ok(liveTerminalBoundary.includes(required), `live terminal boundary omits: ${required}`);
}
for (const exact of [
  `PREVIOUS_ATTESTATION_RELEASE='${previousAttestation}'`,
  `PREVIOUS_ATTESTATION_SCRIPT_SHA256='${previousScript}'`,
  `PREVIOUS_DIFFERENTIAL_VALIDATOR_SHA256='${previousValidator}'`,
  `PREVIOUS_BUNDLE_MANIFEST_SHA256='${previousManifest}'`,
  "PREVIOUS_ATTESTATION_SCRIPT_SIZE='92946'",
  "PREVIOUS_DIFFERENTIAL_VALIDATOR_SIZE='17941'",
  "PREVIOUS_BUNDLE_MANIFEST_SIZE='928'",
  "PREVIOUS_CLAIM_PARENT_DEV_INO='64769:6102851'",
  "PREVIOUS_CLAIM_ROOT_DEV_INO='64769:6102854'",
  "PREVIOUS_ATTESTATION_SCRIPT_DEV_INO='64769:6102855'",
  "PREVIOUS_DIFFERENTIAL_VALIDATOR_DEV_INO='64769:6102856'",
  "PREVIOUS_BUNDLE_MANIFEST_DEV_INO='64769:6102857'",
]) {
  assert.ok(bridge.includes(exact), `Owner bridge omits prior terminal claim binding: ${exact}`);
}
for (const exact of [
  `INTERRUPTED_ATTESTATION_RELEASE='${interruptedAttestation}'`,
  `INTERRUPTED_ATTESTATION_SCRIPT_SHA256='${interruptedScript}'`,
  `INTERRUPTED_DIFFERENTIAL_VALIDATOR_SHA256='${interruptedValidator}'`,
  `INTERRUPTED_BUNDLE_MANIFEST_SHA256='${interruptedManifest}'`,
  "INTERRUPTED_ATTESTATION_SCRIPT_SIZE='97783'",
  "INTERRUPTED_DIFFERENTIAL_VALIDATOR_SIZE='17941'",
  "INTERRUPTED_BUNDLE_MANIFEST_SIZE='928'",
  "INTERRUPTED_CLAIM_ROOT_DEV_INO='64769:6102860'",
  "INTERRUPTED_ATTESTATION_SCRIPT_DEV_INO='64769:6102861'",
  "INTERRUPTED_DIFFERENTIAL_VALIDATOR_DEV_INO='64769:6102862'",
  "INTERRUPTED_BUNDLE_MANIFEST_DEV_INO='64769:6102863'",
  "INTERRUPTED_ATTESTATION_PARENT_DEV_INO='64769:6102864'",
  "INTERRUPTED_EMPTY_LEDGER_DEV_INO='64769:6102865'",
]) {
  assert.ok(bridge.includes(exact), `Owner bridge omits interrupted attempt binding: ${exact}`);
}
assert.doesNotMatch(
  liveTerminalBoundary,
  /sorted\(os\.listdir\(claim_parent\)\) != \[attestation\]/,
);
function acceptsTerminalClaimEntries(actual, current) {
  return (
    [...actual].sort().join('\0') ===
    [previousAttestation, interruptedAttestation, current].sort().join('\0')
  );
}
const correctionAttestation = 'f'.repeat(40);
assert.equal(
  acceptsTerminalClaimEntries(
    [previousAttestation, interruptedAttestation, correctionAttestation],
    correctionAttestation,
  ),
  true,
);
for (const invalid of [
  [],
  [correctionAttestation],
  [previousAttestation, correctionAttestation],
  [previousAttestation, interruptedAttestation, 'unknown-third-claim'],
  [previousAttestation, interruptedAttestation, correctionAttestation, 'unknown-fourth-claim'],
  [previousAttestation, interruptedAttestation, `.installing-${correctionAttestation}`],
  [
    previousAttestation,
    interruptedAttestation,
    correctionAttestation,
    `.installing-${correctionAttestation}`,
  ],
]) {
  assert.equal(acceptsTerminalClaimEntries(invalid, correctionAttestation), false);
}
assert.doesNotMatch(
  liveTerminalBoundary,
  /os\.O_(?:WRONLY|RDWR)|os\.write|os\.rename|unlink|remove/,
);

const claimFunction = shellFunction(bridge, 'claim_and_load_bundle_manifest');
for (const required of [
  "names = ['compose.staging-beta.yaml', 'fetanagent-owner-control-canonical-h14.tar', 'manifest-v1']",
  'if len(lines) != 20',
  "'terminal_attestation_implementation_sha'",
  'def exact_descriptor(path, uid, gid, mode, maximum):',
  'os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC',
  'before.st_nlink',
  'before.st_mtime_ns',
  'def stream_archive(root, source_path, digest, size):',
  'maximum = 1024 * 1024 * 1024',
  'partial.st_size > size',
  'partial_block != source_block',
  'min(1024 * 1024, size - consumed)',
  "os.read(source_descriptor, 1) != b''",
  'running.hexdigest() != digest',
  'os.fsync(output)',
  'os.rename(temporary, destination)',
  'sync_directory(root)',
  "values['provider_action_enabled'] != 'false'",
  "values['transfer_enabled'] != 'false'",
  "values['amount_entry_enabled'] != 'false'",
  "values['money_moved'] != 'false'",
]) {
  assert.ok(claimFunction.includes(required), `streaming exact bundle claim omits: ${required}`);
}
assert.doesNotMatch(
  claimFunction,
  /archive_data|archive_bytes|b''\.join|b""\.join|read_bytes\(|\.read\(\)/,
  'the image archive must never be accumulated into one in-memory value',
);
assert.doesNotMatch(claimFunction, /O_TRUNC/);
assert.match(
  claimFunction,
  /if completed_claim:[\s\S]*?hash_exact\([\s\S]*?owner_image_tar_size[\s\S]*?owner_image_tar_sha256/,
  'a completed bundle claim must re-hash exact archive size and digest',
);

const archiveInspectionFunction = shellFunction(bridge, 'inspect_image_archive');
for (const required of [
  'or len(manifest) != 1',
  "manifest[0].get('RepoTags') != [expected_tag]",
  "manifest[0].get('Config') != expected_config",
  'len(members) > 4096',
  "target.is_absolute() or '..' in target.parts",
]) {
  assert.ok(
    archiveInspectionFunction.includes(required),
    `canonical one-image archive inspection omits: ${required}`,
  );
}
assert.doesNotMatch(archiveInspectionFunction, /\.extract\(|\.extractall\(/);

// Exercise the archive-resume contract with real files. This deliberately uses
// bounded 64 KiB reads and covers fresh, exact-prefix, corrupt-prefix, wrong-size,
// wrong-digest, and already-final cases. Static assertions above bind that model
// to the production Python implementation and reject whole-archive materialization.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'fetanagent-h14-owner-bridge-'));
const archiveSource = join(fixtureRoot, 'canonical-owner.tar');
const archiveClaim = join(fixtureRoot, 'claimed-owner.tar');
const archivePartial = `${archiveClaim}.installing`;
const archiveBytes = Buffer.alloc(3 * 1024 * 1024 + 137);
for (let index = 0; index < archiveBytes.length; index += 1)
  archiveBytes[index] = (index * 131 + 17) % 251;
writeFileSync(archiveSource, archiveBytes, { mode: 0o600 });
const archiveDigest = createHash('sha256').update(archiveBytes).digest('hex');

function hashFileBounded(path, maximum = 1024 * 1024 * 1024) {
  const descriptor = openSync(path, 'r');
  const digest = createHash('sha256');
  const block = Buffer.alloc(64 * 1024);
  let total = 0;
  try {
    while (true) {
      const count = readSync(descriptor, block, 0, block.length, null);
      if (count === 0) break;
      total += count;
      assert.ok(total <= maximum, 'fixture archive exceeded the bound');
      digest.update(block.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return { size: total, digest: digest.digest('hex') };
}

function resumeArchiveClaim(source, temporary, destination, expectedSize, expectedDigest) {
  const sourceBefore = statSync(source);
  assert.equal(sourceBefore.size, expectedSize, 'source size must be exact before claim');
  if (existsSync(destination)) {
    assert.equal(existsSync(temporary), false, 'final and partial archive may not coexist');
    assert.deepEqual(hashFileBounded(source), { size: expectedSize, digest: expectedDigest });
    assert.deepEqual(hashFileBounded(destination), { size: expectedSize, digest: expectedDigest });
    return;
  }

  if (!existsSync(temporary)) writeFileSync(temporary, Buffer.alloc(0), { mode: 0o600 });
  const partialSize = statSync(temporary).size;
  assert.ok(partialSize <= expectedSize, 'partial archive may not exceed the exact source');
  const sourceDescriptor = openSync(source, 'r');
  const outputDescriptor = openSync(temporary, 'r+');
  const digest = createHash('sha256');
  const sourceBlock = Buffer.alloc(64 * 1024);
  const partialBlock = Buffer.alloc(64 * 1024);
  let consumed = 0;
  try {
    while (consumed < partialSize) {
      const wanted = Math.min(sourceBlock.length, partialSize - consumed);
      assert.equal(readSync(sourceDescriptor, sourceBlock, 0, wanted, consumed), wanted);
      assert.equal(readSync(outputDescriptor, partialBlock, 0, wanted, consumed), wanted);
      assert.deepEqual(
        partialBlock.subarray(0, wanted),
        sourceBlock.subarray(0, wanted),
        'a corrupt partial prefix must fail closed',
      );
      digest.update(sourceBlock.subarray(0, wanted));
      consumed += wanted;
    }
    while (consumed < expectedSize) {
      const wanted = Math.min(sourceBlock.length, expectedSize - consumed);
      const count = readSync(sourceDescriptor, sourceBlock, 0, wanted, consumed);
      assert.ok(count > 0 && count <= sourceBlock.length);
      assert.equal(writeSync(outputDescriptor, sourceBlock, 0, count, consumed), count);
      digest.update(sourceBlock.subarray(0, count));
      consumed += count;
    }
  } finally {
    closeSync(outputDescriptor);
    closeSync(sourceDescriptor);
  }
  assert.equal(consumed, expectedSize);
  assert.equal(digest.digest('hex'), expectedDigest, 'streamed archive digest must be exact');
  assert.deepEqual(
    { size: statSync(source).size, mtimeMs: statSync(source).mtimeMs },
    { size: sourceBefore.size, mtimeMs: sourceBefore.mtimeMs },
    'source archive must remain stable during claim',
  );
  assert.deepEqual(hashFileBounded(temporary), { size: expectedSize, digest: expectedDigest });
  renameSync(temporary, destination);
  assert.deepEqual(hashFileBounded(destination), { size: expectedSize, digest: expectedDigest });
}

resumeArchiveClaim(archiveSource, archivePartial, archiveClaim, archiveBytes.length, archiveDigest);
resumeArchiveClaim(archiveSource, archivePartial, archiveClaim, archiveBytes.length, archiveDigest);
rmSync(archiveClaim);
writeFileSync(archivePartial, archiveBytes.subarray(0, 777_777), { mode: 0o600 });
resumeArchiveClaim(archiveSource, archivePartial, archiveClaim, archiveBytes.length, archiveDigest);
rmSync(archiveClaim);
const corruptPrefix = Buffer.from(archiveBytes.subarray(0, 123_457));
corruptPrefix[123_456] ^= 0xff;
writeFileSync(archivePartial, corruptPrefix, { mode: 0o600 });
assert.throws(() =>
  resumeArchiveClaim(
    archiveSource,
    archivePartial,
    archiveClaim,
    archiveBytes.length,
    archiveDigest,
  ),
);
assert.deepEqual(
  readFileSync(archivePartial),
  corruptPrefix,
  'a corrupt partial must not be rewritten',
);
rmSync(archivePartial);
assert.throws(() =>
  resumeArchiveClaim(
    archiveSource,
    archivePartial,
    archiveClaim,
    archiveBytes.length + 1,
    archiveDigest,
  ),
);
assert.throws(() =>
  resumeArchiveClaim(
    archiveSource,
    archivePartial,
    archiveClaim,
    archiveBytes.length,
    '0'.repeat(64),
  ),
);
rmSync(archivePartial, { force: true });

const composeInputFunction = shellFunction(bridge, 'require_all_compose_inputs');
assert.match(composeInputFunction, /require_service_file/);
assert.match(composeInputFunction, /require_immutable_config_file/);
assert.match(composeInputFunction, /owner-database-url/);
assert.match(composeInputFunction, /supabase-ca\.crt/);
const composeParseFunction = shellFunction(bridge, 'require_compose_contract_parses');
assert.match(composeParseFunction, /config --quiet/);
assert.match(composeParseFunction, /config --images/);
assert.match(composeParseFunction, /grep -Fxq "\$OWNER_IMAGE" <<<"\$images"/);
assert.doesNotMatch(composeParseFunction, /\bup\b|\bcreate\b|\bstart\b|\brun\b/);

const ownerContractFunction = shellFunction(bridge, 'require_owner_contract');
for (const required of [
  "config['User'] != '10001:10001'",
  "config['Cmd'] != ['node', 'apps/admin/dist/index.js']",
  "host['ReadonlyRootfs'] is not True",
  "host['Privileged'] is not False",
  "host['RestartPolicy'].get('Name') != 'no'",
  "host.get('CapDrop') != ['ALL']",
  "host.get('SecurityOpt') != ['no-new-privileges:true']",
  "environments.count('FINANCIAL_ACTIONS_MODE=dry_run') != 1",
  "'KEMERBET_EXECUTOR_ENABLED=false' not in environments",
  "'KEMERBET_FINAL_ACTION_ENABLED=false' not in environments",
]) {
  assert.ok(ownerContractFunction.includes(required), `Owner contract omits: ${required}`);
}
assert.match(ownerContractFunction, /127\.0\.0\.1/);
assert.match(ownerContractFunction, /3002/);

const nonOwnerCaptureFunction = shellFunction(bridge, 'capture_non_owner_inventory');
for (const required of [
  '--filter "label=com.docker.compose.project=$PROJECT_NAME"',
  'com.docker.compose.service',
  '[[ "$service" != \'kemerbet-session-provision\' ]]',
  '[[ "$service" == "$OWNER_SERVICE" ]] && continue',
  'container_semantic_contract_digest "$container_id"',
  'container_runtime_state_digest "$container_id"',
  'LC_ALL=C sort',
]) {
  assert.ok(nonOwnerCaptureFunction.includes(required), `non-Owner snapshot omits: ${required}`);
}
const nonOwnerUnchangedFunction = shellFunction(bridge, 'require_non_owner_inventory_unchanged');
assert.match(nonOwnerUnchangedFunction, /current_count.*NON_OWNER_INVENTORY_COUNT/s);
assert.match(nonOwnerUnchangedFunction, /current_sha.*NON_OWNER_INVENTORY_SHA256/s);
const runtimeBoundaryFunction = shellFunction(bridge, 'require_runtime_boundary');
assert.match(runtimeBoundaryFunction, /require_exact_owner_inventory "\$owner_id"/);
assert.match(runtimeBoundaryFunction, /require_non_owner_inventory_unchanged/);
assert.match(runtimeBoundaryFunction, /require_financial_gates_disabled/);
assert.match(runtimeBoundaryFunction, /require_no_host_chromium/);

const migrationFunction = shellFunction(bridge, 'require_migration_through_old_owner');
assert.match(migrationFunction, /container exec -i "\$owner_id" node -/);
assert.match(migrationFunction, /begin transaction read only/);
assert.match(migrationFunction, /await client\.query\('rollback'\)/);
assert.match(
  migrationFunction,
  new RegExp(`target\\.hostname !== 'db\\.${stagingProjectRef}\\.supabase\\.co'`),
);
assert.match(
  migrationFunction,
  new RegExp(`target\\.hostname\\.includes\\('${productionProjectRef}'\\)`),
);
assert.match(migrationFunction, /username !== 'fetanagent_owner_control_runtime'/);
assert.match(migrationFunction, /searchEntries\[0\]\[0\] !== 'sslmode'/);
assert.match(migrationFunction, /searchEntries\[0\]\[1\] !== 'verify-full'/);
assert.doesNotMatch(
  migrationFunction,
  /client\.query\([^)]*\b(?:insert|update|delete|merge|truncate|alter|create|drop|grant|revoke)\b/i,
  'migration preflight must remain catalog-only and read-only',
);

const financialGateFunction = shellFunction(bridge, 'require_financial_gates_disabled');
const enabledGateFunction = shellFunction(bridge, 'has_enabled_financial_gate');
for (const required of [
  'FINANCIAL_ACTIONS_MODE=dry_run',
  'EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY|WITHDRAW|SETTLEMENT',
  'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED',
  'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED',
  'TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED',
]) {
  assert.ok(enabledGateFunction.includes(required), `enabled-gate classifier omits ${required}`);
}
for (const required of [
  '"$FINAL_BINDING"',
  'com.docker.compose.project=$PROJECT_NAME',
  'com.docker.compose.service',
  'FINANCIAL_ACTIONS_MODE=dry_run',
  'has_enabled_financial_gate "$environment"',
]) {
  assert.ok(financialGateFunction.includes(required), `financial gate check omits ${required}`);
}
assert.match(
  financialGateFunction,
  /if \[\[ "\$service" == 'gateway' \]\]; then[\s\S]*?"\$mode_count" == '0'[\s\S]*?else[\s\S]*?"\$mode_count" == '1'/,
  'only the exact canonical gateway service may omit FINANCIAL_ACTIONS_MODE',
);

function validateFinancialGateCardinality(service, environment) {
  assert.match(service, /^[a-z0-9][a-z0-9_-]*$/u);
  const modes = environment.filter((entry) => entry.startsWith('FINANCIAL_ACTIONS_MODE='));
  if (service === 'gateway') {
    assert.deepEqual(modes, [], 'the canonical gateway has no financial-mode variable');
  } else {
    assert.deepEqual(
      modes,
      ['FINANCIAL_ACTIONS_MODE=dry_run'],
      'every non-gateway service, including an unknown service, needs exactly one dry-run mode',
    );
  }
  for (const entry of environment) {
    assert.doesNotMatch(
      entry,
      /^(?:KEMERBET_EXECUTOR_ENABLED|KEMERBET_FINAL_ACTION_ENABLED|KEMERBET_TRANSFER_ENABLED|KEMERBET_AMOUNT_ENTRY_ENABLED|FETANAGENT_INTERNAL_KEMERBET_ENABLED|FETANAGENT_PRIVATE_LIVE_MODE)=(?:1|true|yes|on)$/iu,
      'an enabled financial or provider gate must fail closed',
    );
  }
}

assert.doesNotThrow(() => validateFinancialGateCardinality('gateway', []));
assert.doesNotThrow(() =>
  validateFinancialGateCardinality('api', ['FINANCIAL_ACTIONS_MODE=dry_run']),
);
assert.doesNotThrow(() =>
  validateFinancialGateCardinality('future-provider-neutral-service', [
    'FINANCIAL_ACTIONS_MODE=dry_run',
  ]),
);
for (const [service, environment] of [
  ['gateway', ['FINANCIAL_ACTIONS_MODE=dry_run']],
  ['gateway', ['FINANCIAL_ACTIONS_MODE=live']],
  ['api', []],
  ['unknown-service', []],
  ['api', ['FINANCIAL_ACTIONS_MODE=dry_run', 'FINANCIAL_ACTIONS_MODE=dry_run']],
  ['unknown-service', ['FINANCIAL_ACTIONS_MODE=live']],
  ['api', ['FINANCIAL_ACTIONS_MODE=dry_run', 'KEMERBET_EXECUTOR_ENABLED=true']],
  ['gateway', ['KEMERBET_TRANSFER_ENABLED=on']],
]) {
  assert.throws(
    () => validateFinancialGateCardinality(service, environment),
    `unsafe financial gate fixture must fail for ${service}`,
  );
}

const createLedgerFunction = shellFunction(bridge, 'create_or_discover_bridge_ledger');
assert.match(
  createLedgerFunction,
  /completed-v1\\nintent-v1\\nreplacement-owner-v1\\nstart-owner-v1/,
);
for (const entry of [
  '.intent-v1.installing',
  '.replacement-owner-v1.installing',
  '.start-owner-v1.installing',
  '.completed-v1.installing',
]) {
  assert.ok(
    createLedgerFunction.includes(entry),
    `ledger omits exact interruption prefix ${entry}`,
  );
}
assert.doesNotMatch(createLedgerFunction, /\brm\b|unlink|rmdir|O_TRUNC/);

const intentRecordFunction = shellFunction(bridge, 'expected_bridge_intent');
const replacementRecordFunction = shellFunction(bridge, 'expected_replacement_record');
const startRecordFunction = shellFunction(bridge, 'expected_start_record');
const completedRecordFunction = shellFunction(bridge, 'expected_bridge_completed');
for (const record of [
  intentRecordFunction,
  replacementRecordFunction,
  startRecordFunction,
  completedRecordFunction,
]) {
  for (const claim of [
    'non_owner_project_container_count=',
    'non_owner_project_inventory_sha256=',
    'provider_action_enabled=false',
    'transfer_enabled=false',
    'amount_entry_enabled=false',
    'money_moved=false',
  ]) {
    assert.ok(record.includes(claim), `immutable bridge record omits ${claim}`);
  }
}
assert.match(replacementRecordFunction, /new_owner_state=created-never-started-at-publication/);
assert.match(startRecordFunction, /state=start-authorized/);
assert.match(startRecordFunction, /new_owner_state=created-at-publication/);
assert.match(startRecordFunction, /restart_after_exit_authorized=false/);
assert.match(completedRecordFunction, /old_owner_absent=true/);
assert.match(completedRecordFunction, /new_owner_running=true/);
assert.match(completedRecordFunction, /new_owner_healthy=true/);
assert.match(completedRecordFunction, /start_owner_record_sha256=/);
assert.match(completedRecordFunction, /canonical_h14_evidence_rewritten=false/);
assert.match(completedRecordFunction, /canonical_h14_helper_changed=false/);

const publishRecordFunction = shellFunction(bridge, 'publish_exact_record');
for (const required of [
  'os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC',
  'os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC',
  'expected.startswith(data)',
  'os.fsync(descriptor)',
  'os.rename(temporary, path)',
  'sync_directory(root)',
]) {
  assert.ok(
    publishRecordFunction.includes(required),
    `append-only record publication omits: ${required}`,
  );
}
assert.doesNotMatch(publishRecordFunction, /O_TRUNC|unlink|remove|rmdir/);

const lockFunction = shellFunction(bridge, 'acquire_staging_mutation_lock');
for (const required of [
  'os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC',
  'flags | os.O_CREAT | os.O_EXCL',
  "os.open('mutation.lock', flags, dir_fd=root_descriptor)",
  "os.stat('mutation.lock', dir_fd=root_descriptor, follow_symlinks=False)",
  'stat.S_ISREG(before.st_mode)',
  'before.st_nlink',
  'before.st_size != 0',
  'before.st_mtime_ns',
  'fcntl.LOCK_EX | fcntl.LOCK_NB',
]) {
  assert.ok(lockFunction.includes(required), `hardened staging lock omits: ${required}`);
}
assert.doesNotMatch(lockFunction, /O_TRUNC|>"\$LOCK"|: >|exec 9<>/);

// Execute the exact embedded lock validator against hostile POSIX fixtures.
// The production uid/gid assertions are retained statically above; only those
// two values are substituted so unprivileged CI can execute the same code.
if (process.platform !== 'win32' && typeof process.getuid === 'function') {
  const python = resolvePython();
  const fixtureUid = process.getuid();
  const fixtureGid = process.getgid();
  let lockPython = heredocBody(lockFunction)
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
  const lockPythonPath = join(fixtureRoot, 'owner-bridge-lock.py');
  writeFileSync(lockPythonPath, lockPython, { mode: 0o600 });
  const lockParent = join(fixtureRoot, 'lock-parent');
  const lockRoot = join(lockParent, 'lock-root');
  const lockPath = join(lockRoot, 'mutation.lock');
  mkdirSync(lockParent, { mode: 0o700 });
  const runLock = () =>
    spawnSync(python, ['-I', lockPythonPath, lockRoot, lockPath], {
      encoding: 'utf8',
      input: '',
    });
  let result = runLock();
  assert.equal(result.status, 0, `absent lock create failed: ${result.stderr}`);
  assert.match(result.stdout, /^locked:[0-9]+:[0-9]+\n$/);
  result = runLock();
  assert.equal(result.status, 0, `exact existing lock failed: ${result.stderr}`);
  chmodSync(lockPath, 0o644);
  assert.notEqual(runLock().status, 0, 'wrong lock mode must fail closed');
  rmSync(lockPath);
  writeFileSync(lockPath, 'foreign\n', { mode: 0o600 });
  assert.notEqual(runLock().status, 0, 'nonempty lock must fail without truncation');
  assert.equal(readFileSync(lockPath, 'utf8'), 'foreign\n');
  rmSync(lockPath);
  const foreign = join(lockParent, 'foreign');
  writeFileSync(foreign, '', { mode: 0o600 });
  symlinkSync(foreign, lockPath);
  assert.notEqual(runLock().status, 0, 'symlink lock must fail closed');
  rmSync(lockPath);
  linkSync(foreign, lockPath);
  assert.notEqual(runLock().status, 0, 'hardlinked lock must fail closed');
  rmSync(lockPath);
  if (fixtureUid === 0) {
    writeFileSync(lockPath, '', { mode: 0o600 });
    chownSync(lockPath, 1, 1);
    assert.notEqual(runLock().status, 0, 'wrong lock owner must fail closed');
    rmSync(lockPath);
  }
}

const mainStart = indexOrFail(
  bridge,
  "require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'",
  'Owner-runtime bridge main entry',
);
const main = bridge.slice(mainStart);
const completeBranch = section(
  main,
  'if [[ "$BRIDGE_STATE" == \'complete\' ]]; then\n',
  '\nfi\n\n# Intent is durable',
  'terminal completed bridge branch',
);
for (const required of [
  'load_replacement_record',
  'require_start_record',
  'require_bridge_completed',
  'require_non_owner_inventory_unchanged',
  'require_owner_image_contract',
  'running|healthy',
  'require_runtime_boundary',
  'require_live_terminal_attestation_boundary',
  'exit 0',
]) {
  assert.ok(completeBranch.includes(required), `terminal replay omits: ${required}`);
}
assert.doesNotMatch(
  completeBranch,
  /container (?:stop|rm|start|kill|restart|create|run|update)|image load|compose_command\[@\].*(?:create|up|run|start)/,
  'terminal replay must be read-only',
);

assert.ok(
  countMatches(main, /require_non_owner_inventory_unchanged/g) >= 12,
  'non-Owner continuity must bracket every Owner/image mutation and terminal check',
);
assert.ok(
  countMatches(main, /require_live_terminal_attestation_boundary/g) >= 9,
  'live terminal evidence must be revalidated before intent, every Docker mutation, and completion replay',
);
assert.doesNotMatch(
  main,
  /"\$\(load_exact_terminal_attestation\)"/,
  'multi-field terminal attestation output must never be compared as one scalar',
);
assert.doesNotMatch(
  main,
  /require_live_terminal_attestation_boundary\s+\|\|/,
  'every live-boundary call must supply an exact phase-appropriate control holder',
);
for (const [call, minimum] of [
  ['require_live_terminal_attestation_boundary "$OLD_OWNER_CONTAINER_ID" running', 3],
  ['require_live_terminal_attestation_boundary "$OLD_OWNER_CONTAINER_ID" exited', 1],
  ['require_live_terminal_attestation_boundary none none', 1],
  ['require_live_terminal_attestation_boundary "$NEW_OWNER_CONTAINER_ID" created', 1],
  ['require_live_terminal_attestation_boundary "$NEW_OWNER_CONTAINER_ID" running', 3],
]) {
  assert.ok(
    countMatches(main, new RegExp(call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) >= minimum,
  );
}

const phaseFixture = (expected, actual, running, pid, health = '') => {
  if (expected === 'none') return actual === 'none' && running === false && pid === 0;
  if (expected !== actual) return false;
  if (expected === 'running') return running === true && pid > 0 && health === 'healthy';
  if (expected === 'exited' || expected === 'created') return running === false && pid === 0;
  return false;
};
assert.equal(phaseFixture('running', 'running', true, 71, 'healthy'), true);
assert.equal(phaseFixture('exited', 'exited', false, 0), true);
assert.equal(phaseFixture('none', 'none', false, 0), true);
assert.equal(phaseFixture('created', 'created', false, 0), true);
assert.equal(phaseFixture('running', 'running', true, 83, 'healthy'), true);
assert.equal(phaseFixture('exited', 'exited', true, 83), false);
assert.equal(phaseFixture('created', 'created', false, 12), false);
assert.match(
  main,
  /running\)[\s\S]*?container stop --time 15 "\$OLD_OWNER_CONTAINER_ID"[\s\S]*?exited\) ;;[\s\S]*?\*\) die 'the historical Owner is in an unreviewed state'/,
  'the historical Owner may resume only running -> exited or exact post-stop exited',
);
assert.doesNotMatch(main, /old_state[\s\S]{0,500}created\)/);
assert.match(
  main,
  /an unrecorded replacement Owner must be in its exact never-started created state/,
);
assert.match(
  main,
  /a replacement without durable start intent must remain in its never-started created state/,
);
assert.match(
  main,
  /created\)[\s\S]*?docker_local container start "\$NEW_OWNER_CONTAINER_ID"[\s\S]*?running\)[\s\S]*?healthy[\s\S]*?exited\) die 'the replacement Owner exited after its durable start intent; manual review is required'/,
  'created may start once after intent; running+healthy may resume; exited must never restart',
);
assert.equal(
  countMatches(main, /docker_local container start "\$NEW_OWNER_CONTAINER_ID"/g),
  1,
  'there must be exactly one narrow new-Owner start command',
);

const dockerContainerMutations = [
  ...main.matchAll(
    /docker_local container (stop|rm|start|kill|restart|create|run|update|rename|commit|cp)\b[^\n]*/g,
  ),
].map((match) => match[0]);
assert.deepEqual(
  dockerContainerMutations,
  [
    'docker_local container stop --time 15 "$OLD_OWNER_CONTAINER_ID" >/dev/null || die \'the exact historical Owner could not be stopped\'',
    'docker_local container rm "$OLD_OWNER_CONTAINER_ID" >/dev/null || die \'the exact stopped historical Owner could not be removed\'',
    'docker_local container start "$NEW_OWNER_CONTAINER_ID" >/dev/null || die \'the exact canonical Owner could not be started\'',
  ],
  'the bridge may mutate only old Owner stop/remove and canonical Owner start',
);
assert.equal(countMatches(main, /create --no-build --no-deps "\$OWNER_SERVICE"/g), 1);
assert.doesNotMatch(main, /\b(?:up|down|run|restart|kill|pause|unpause)\b[^\n]*"\$OWNER_SERVICE"/);
assert.equal(countMatches(main, /docker_local image load --input/g), 1);
assert.doesNotMatch(main, /docker_local image (?:pull|rm|prune|tag|push|build)\b/);
assert.doesNotMatch(
  main,
  /docker_local (?:volume|network) (?:create|rm|prune|connect|disconnect)\b/,
);
assert.equal(
  countMatches(bridge, /container exec -i "\$owner_id" node -/g),
  1,
  'the only container exec is the read-only migration preflight through historical Owner',
);
assert.doesNotMatch(bridge, /run_helper_direct|agentsystem\.admindigi\.com|kemerbet\.co/i);
assert.doesNotMatch(bridge, /(?:lookup|recheck)_authorized=true/);
assert.doesNotMatch(
  bridge,
  /KEMERBET_(?:EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY)_ENABLED=(?:true|1|yes|on)/i,
);
assert.doesNotMatch(
  bridge,
  /FINANCIAL_ACTIONS_MODE=(?:live|production|enabled|execute|real_money)/i,
);
assert.doesNotMatch(main, /\bsupabase\b|\bpsql\b/);

const intentIndex = indexOrFail(main, 'publish_exact_record "$BRIDGE_WORK_ROOT/intent-v1"');
const imageLoadIndex = indexOrFail(main, 'docker_local image load --input');
const oldStopIndex = indexOrFail(main, 'docker_local container stop --time 15');
const oldRemoveIndex = indexOrFail(main, 'docker_local container rm "$OLD_OWNER_CONTAINER_ID"');
const createIndex = indexOrFail(main, 'create --no-build --no-deps "$OWNER_SERVICE"');
const replacementIndex = indexOrFail(
  main,
  'publish_exact_record "$BRIDGE_WORK_ROOT/replacement-owner-v1"',
);
const startIntentIndex = indexOrFail(
  main,
  'publish_exact_record "$BRIDGE_WORK_ROOT/start-owner-v1"',
);
const ownerStartIndex = indexOrFail(main, 'docker_local container start "$NEW_OWNER_CONTAINER_ID"');
const completionIndex = indexOrFail(main, 'publish_exact_record "$BRIDGE_WORK_ROOT/completed-v1"');
const finalRenameIndex = indexOrFail(main, 'mv -- "$BRIDGE_INSTALLING" "$BRIDGE_ROOT"');
assert.ok(
  intentIndex < imageLoadIndex &&
    imageLoadIndex < oldStopIndex &&
    oldStopIndex < oldRemoveIndex &&
    oldRemoveIndex < createIndex &&
    createIndex < replacementIndex &&
    replacementIndex < startIntentIndex &&
    startIntentIndex < ownerStartIndex &&
    ownerStartIndex < completionIndex &&
    completionIndex < finalRenameIndex,
  'required order is intent -> image -> old stop/remove -> create -> replacement/start records -> start -> completion -> final ledger',
);
assert.match(
  main,
  /env -i PATH="\$SAFE_PATH" curl --fail --silent --show-error --noproxy '\*' --max-time 5/,
);
assert.match(main, /http:\/\/127\.0\.0\.1:3002\/readyz/);

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
const syntax = spawnSync(bash, ['-n', bridgePath], { encoding: 'utf8' });
assert.equal(syntax.status, 0, `Owner-runtime bridge Bash syntax failed: ${syntax.stderr}`);

const packageJson = JSON.parse(normalized(resolve(root, 'package.json')));
assert.match(
  packageJson.scripts['test:infra'],
  /node infra\/verify-kemerbet-quarantine-recovery-v14-owner-runtime-bridge\.mjs/,
);

rmSync(fixtureRoot, { recursive: true, force: true });

console.log(
  'KemerBet quarantine-recovery v14 canonical H14 Owner-only runtime bridge verified (streaming exact bundle, hostile locks, immutable interruption ledger, non-Owner continuity, read-only migration, and no provider or money action).',
);
