import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const installerPath = resolve(
  root,
  'infra/operations/fetanagent-kemerbet-security-recovery-preview-bridge-v16.sh',
);
const helperPath = resolve(root, 'infra/operations/fetanagent-staging-deploy-helper.sh');

const normalized = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const installer = normalized(installerPath);
const helper = normalized(helperPath);
const helperSha256 = createHash('sha256').update(helper, 'utf8').digest('hex');

const parent = '/var/lib/fetanagent/kemerbet-security-recovery-preview-bridge-v16';
const canonicalH14Release = '06459511d9330a0e1d956c42529b81aa9970e7a2';
const canonicalRuntimeRelease = '30fc8196356d3bb1f6f279c4ff40ad2b4a91a44c';
const predecessorHelperSha256 = 'c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58';
const h14AuthorizationPromptSha256 =
  '6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874';
const h14RecoveryAuthorizationSha256 =
  '192e055032a45c83a5311b769a69dab9d6bacc2f1a256bc2f8bc3cb9395bdb25';
const h14MaxFiles = 512;
const h14MaxFileBytes = 8 * 1024 * 1024;
const h14MaxTotalBytes = 32 * 1024 * 1024;
const confirmation =
  'I-UNDERSTAND-THIS-INSTALLS-ONE-H16-SECURITY-RECOVERY-PREVIEW-BRIDGE-WITH-TRANSFER-DISABLED';

function shellFunction(source, name) {
  const start = source.indexOf(`${name}() {`);
  assert.ok(start >= 0, `missing shell function ${name}`);
  let cursor = start;
  let depth = 0;
  let heredocEnd = '';
  while (cursor < source.length) {
    const newline = source.indexOf('\n', cursor);
    const end = newline < 0 ? source.length : newline + 1;
    const line = source.slice(cursor, end);
    if (heredocEnd) {
      if (line.trim() === heredocEnd) heredocEnd = '';
    } else {
      const heredoc = line.match(/<<-?\s*['"]?([A-Z][A-Z0-9_]*)['"]?/u);
      const shell = heredoc ? line.slice(0, heredoc.index) : line;
      depth += (shell.match(/\{/gu) ?? []).length;
      depth -= (shell.match(/\}/gu) ?? []).length;
      if (depth === 0) return source.slice(start, end);
      if (heredoc) heredocEnd = heredoc[1];
    }
    cursor = end;
  }
  assert.fail(`unterminated shell function ${name}`);
}

function assertInOrder(source, needles, description) {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    assert.ok(next > cursor, `${description}: missing or out of order: ${needle}`);
    cursor = next;
  }
}

function assertPatternsInOrder(source, patterns, description) {
  let cursor = 0;
  for (const pattern of patterns) {
    const match = pattern.exec(source.slice(cursor));
    assert.ok(match, `${description}: missing or out of order: ${pattern}`);
    cursor += match.index + match[0].length;
  }
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

assert.match(installer, /^#!\/usr\/bin\/env bash$/mu);
assert.match(installer, /^set -euo pipefail$/mu);
assert.match(installer, /^umask 077$/mu);
assert.match(
  installer,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
);
assert.match(
  installer,
  new RegExp(`^readonly [A-Z0-9_]*PARENT='${parent.replaceAll('/', '\\/')}'$`, 'mu'),
  'the H16 installer must use one distinct append-only evidence parent',
);
assert.match(
  installer,
  new RegExp(`^readonly CANONICAL_H14_RELEASE='${canonicalH14Release}'$`, 'mu'),
);
assert.match(
  installer,
  new RegExp(`^readonly CURRENT_RUNTIME_RELEASE='${canonicalRuntimeRelease}'$`, 'mu'),
);
assert.match(
  installer,
  new RegExp(`^readonly H14_AUTHORIZATION_PROMPT_SHA256='${h14AuthorizationPromptSha256}'$`, 'mu'),
);
assert.match(
  installer,
  new RegExp(
    `^readonly H14_RECOVERY_AUTHORIZATION_SHA256='${h14RecoveryAuthorizationSha256}'$`,
    'mu',
  ),
);
assert.match(
  installer,
  new RegExp(`^readonly PREDECESSOR_HELPER_SHA256='${predecessorHelperSha256}'$`, 'mu'),
);
assert.match(
  installer,
  new RegExp(`^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${helperSha256}'$`, 'mu'),
  'the H16 installer must pin the exact LF-normalized successor helper',
);
assert.match(installer, new RegExp(`^readonly CONFIRMATION='${confirmation}'$`, 'mu'));
assert.equal(
  installer.split(`readonly CONFIRMATION='${confirmation}'`).length - 1,
  1,
  'the H16 installer must expose one exact confirmation',
);
assert.match(installer, /\[\[ \$# -eq 3 \]\]/u);
assert.match(installer, /^readonly [A-Z0-9_]*RELEASE="\$1"$/mu);
assert.match(installer, /^readonly SUCCESSOR_HELPER_SHA256="\$2"$/mu);
assert.match(installer, /^readonly PROVIDED_CONFIRMATION="\$3"$/mu);
assert.match(installer, /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u);
assert.match(installer, /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u);
assert.match(installer, /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u);

const intent = shellFunction(installer, 'expected_intent');
const completion = shellFunction(installer, 'expected_completion');
const exactIntentFields = [
  'contract=fetanagent-kemerbet-security-recovery-preview-bridge-v16',
  'state=authorized',
  'bridge_release=$BRIDGE_RELEASE',
  'runtime_release=$CURRENT_RUNTIME_RELEASE',
  'h14_recovery_release=$CANONICAL_H14_RELEASE',
  'h14_recovery_state=cohort-prepared',
  'predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256',
  'successor_helper_sha256=$SUCCESSOR_HELPER_SHA256',
  'h14_authorization_prompt_sha256=$H14_AUTHORIZATION_PROMPT_SHA256',
  'h14_recovery_authorization_sha256=$H14_RECOVERY_AUTHORIZATION_SHA256',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'internal_execution_runtime_enabled=false',
  'private_live_deposit_pilot_enabled=false',
  'amount_entry_enabled=false',
  'transfer_enabled=false',
  'lookup_authorized=false',
  'recheck_authorized=false',
  'money_moved=false',
];
for (const exactIntentField of exactIntentFields) {
  assert.equal(
    (intent.match(new RegExp(exactIntentField.replaceAll('$', '\\$'), 'gu')) ?? []).length,
    1,
    `the H16 intent must contain exactly one ${exactIntentField}`,
  );
}
assertInOrder(
  intent,
  exactIntentFields,
  'the H16 intent fields must be emitted in the exact canonical parser order',
);
assertInOrder(
  completion,
  [
    'intent_sha256="$(expected_intent | sha256sum',
    `expected_intent | awk 'NR == 2 { print "state=preview-bridge-installed"; next } { print }'`,
    `printf 'bridge_intent_sha256=%s\\n' "$intent_sha256"`,
  ],
  'the H16 completion must copy the exact intent, change only its state, and bind its digest',
);
assert.equal(
  countMatches(completion, /expected_intent/gu),
  2,
  'the H16 completion must derive both its body and digest from the same exact intent',
);

assert.match(installer, /cohort-prepared/u);
assert.match(installer, /recovery-identity-authorization-v1/u);
for (const immutableBoundary of [
  /h14_evidence_digest\(\)/u,
  /require_static_h14_cohort_prepared_boundary\(\)/u,
  /require_helper_h14_cohort_prepared_boundary\(\)/u,
  /runtime_boundary_digest\(\)/u,
]) {
  assert.match(installer, immutableBoundary);
}
const h14EvidenceDigest = shellFunction(installer, 'h14_evidence_digest');
for (const exactCapContract of [
  new RegExp(`^MAX_FILES = ${h14MaxFiles}$`, 'mu'),
  new RegExp(`^MAX_FILE_BYTES = ${h14MaxFileBytes / 1024 / 1024} \\* 1024 \\* 1024$`, 'mu'),
  new RegExp(`^MAX_TOTAL_BYTES = ${h14MaxTotalBytes / 1024 / 1024} \\* 1024 \\* 1024$`, 'mu'),
  /before\.st_size > MAX_FILE_BYTES/u,
  /while len\(data\) <= MAX_FILE_BYTES:/u,
  /count > MAX_FILES or total > MAX_TOTAL_BYTES/u,
]) {
  assert.match(
    h14EvidenceDigest,
    exactCapContract,
    'the read-only H14 digest must enforce the exact audited-shape safety caps',
  );
}
assert.doesNotMatch(
  h14EvidenceDigest,
  /before\.st_size > 2 \* 1024 \* 1024|count > 64|total > 8 \* 1024 \* 1024/u,
  'the H14 digest must not retain the pre-audit caps that reject the canonical live tree',
);

const withinH14Caps = (sizes) =>
  sizes.length <= h14MaxFiles &&
  sizes.every((size) => Number.isSafeInteger(size) && size >= 0 && size <= h14MaxFileBytes) &&
  sizes.reduce((total, size) => total + size, 0) <= h14MaxTotalBytes;
const auditedH14TotalBytes = Math.ceil(12.8 * 1024 * 1024);
const auditedBrowserMetricsBytes = 4 * 1024 * 1024;
const remainingAuditedBytes = auditedH14TotalBytes - auditedBrowserMetricsBytes;
const auditedOrdinaryFileBytes = Math.floor(remainingAuditedBytes / 271);
const auditedH14FileSizes = [
  auditedBrowserMetricsBytes,
  ...Array(270).fill(auditedOrdinaryFileBytes),
  remainingAuditedBytes - auditedOrdinaryFileBytes * 270,
];
assert.equal(auditedH14FileSizes.length, 272);
assert.equal(
  auditedH14FileSizes.reduce((total, size) => total + size, 0),
  auditedH14TotalBytes,
);
assert.equal(Math.max(...auditedH14FileSizes), auditedBrowserMetricsBytes);
assert.equal(
  withinH14Caps(auditedH14FileSizes),
  true,
  'the audited 272-file, approximately 12.8 MiB H14 tree with one 4 MiB BrowserMetrics file must fit',
);
assert.equal(withinH14Caps(Array(h14MaxFiles + 1).fill(0)), false);
assert.equal(withinH14Caps([h14MaxFileBytes + 1]), false);
assert.equal(withinH14Caps(Array(5).fill(7 * 1024 * 1024)), false);
assert.doesNotMatch(
  installer,
  /^\s*(?:publish_record|copy_root_file_atomically|install -d|install -o|mv --|rm\b|rmdir\b|unlink\b)[^\n]*(?:\$H14|KEMERBET_QUARANTINE_RECOVERY_V14|kemerbet-quarantine-recovery-v14)/mu,
  'H16 must treat the canonical H14 recovery namespace as immutable input only',
);

const staticH14Boundary = shellFunction(installer, 'require_static_h14_cohort_prepared_boundary');
for (const staticBoundaryContract of [
  /H14_RECOVERY_AUTHORIZATION/u,
  /'0:10001:440:1:389'/u,
  /H14_RECOVERY_AUTHORIZATION_SHA256/u,
  /h14_evidence_digest/u,
]) {
  assert.match(staticH14Boundary, staticBoundaryContract);
}
const helperH14Boundary = shellFunction(installer, 'require_helper_h14_cohort_prepared_boundary');
assertInOrder(
  helperH14Boundary,
  [
    'run_helper_direct verify "$helper_digest"',
    'run_helper_direct kemerbet-v3-runtime-bridge-ready "$helper_digest"',
    'run_helper_direct kemerbet-quarantine-recovery-ready',
    'KemerBet H14 recovery state: cohort-prepared; Transfer and Amount disabled.',
  ],
  'both predecessor and successor helpers must attest the exact active H14 cohort-prepared boundary',
);

const pristineInitialBoundary = shellFunction(installer, 'require_pristine_initial_h16_boundary');
for (const pristineInitialContract of [
  /absent\)[\s\S]*?! -e "\$H16_PARENT"/u,
  /empty-parent\)[\s\S]*?root:root:700[\s\S]*?-z "\$\(find -P "\$H16_PARENT"/u,
  /! -e "\$H16_INSTALLING"/u,
  /! -e "\$H16_ROOT"/u,
  /! -e "\$INSTALLING_HELPER"/u,
  /! -e "\$INSTALLING_HELPER_PARTIAL"/u,
  /require_helper_file "\$TARGET" "\$PREDECESSOR_HELPER_SHA256" 755/u,
  /require_static_h14_cohort_prepared_boundary/u,
  /require_helper_h14_cohort_prepared_boundary "\$PREDECESSOR_HELPER_SHA256"/u,
  /require_exact_current_runtime_boundary/u,
]) {
  assert.match(
    pristineInitialBoundary,
    pristineInitialContract,
    'the resumable initial boundary must be exact, pristine, predecessor-only, and no-transfer',
  );
}
assert.doesNotMatch(
  pristineInitialBoundary,
  /require_(?:active|disabled)_grant_only/u,
  'the shared pristine boundary must not weaken either exact grant-state wrapper',
);
const activeInitialBoundary = shellFunction(installer, 'require_initial_h16_namespace');
assertInOrder(
  activeInitialBoundary,
  ['require_pristine_initial_h16_boundary "$state"', 'require_active_grant_only'],
  'a fresh initial boundary must require the exact active deployment grant',
);
const disabledInitialCheckpoint = shellFunction(
  installer,
  'require_disabled_initial_h16_checkpoint',
);
assertInOrder(
  disabledInitialCheckpoint,
  ['require_pristine_initial_h16_boundary "$state"', 'require_disabled_grant_only'],
  'a disabled-grant recovery must accept only the exact pristine initial checkpoint',
);
const disableSudoers = shellFunction(installer, 'disable_sudoers');
assertInOrder(
  disableSudoers,
  [
    'require_active_grant_only',
    'mv -- "$SUDOERS" "$SUDOERS_DISABLED"',
    "grant_disabled='true'",
    'sync -f /etc/sudoers.d',
    'require_disabled_grant_only',
  ],
  'grant disablement must become cleanup-visible immediately after the atomic rename',
);

const classifier = shellFunction(installer, 'classify_h16_namespace');
for (const classifierContract of [
  /print\('absent'\)/u,
  /print\('empty-parent'\)/u,
  /entries == \[f'\.installing-\{release\}'\]/u,
  /print\('interrupted'\)/u,
  /entries == \[release\]/u,
  /print\('completed'\)/u,
]) {
  assert.match(classifier, classifierContract);
}
const prefixInventory = shellFunction(installer, 'require_h16_prefix_inventory');
for (const prefixContract of [
  /'\.completed-v1\.installing': \(0o600, 4096\)/u,
  /'\.intent-v1\.installing': \(0o600, 4096\)/u,
  /'\.predecessor-helper\.installing': \(0o400, 2 \* 1024 \* 1024\)/u,
  /'completed-v1': \(0o600, 4096\)/u,
  /'intent-v1': \(0o600, 4096\)/u,
  /'predecessor-helper': \(0o400, 2 \* 1024 \* 1024\)/u,
  /any\(name not in allowed for name in entries\)/u,
]) {
  assert.match(prefixInventory, prefixContract);
}
const publishRecord = shellFunction(installer, 'publish_record_atomically');
const copyRootFile = shellFunction(installer, 'copy_root_file_atomically');
for (const atomicWriter of [publishRecord, copyRootFile]) {
  for (const atomicContract of [
    /os\.O_NOFOLLOW/u,
    /os\.O_CLOEXEC/u,
    /os\.O_CREAT \| os\.O_EXCL/u,
    /os\.fsync\(descriptor\)/u,
    /os\.rename\(temporary, target\)/u,
    /os\.fsync\(directory\)/u,
  ]) {
    assert.match(
      atomicWriter,
      atomicContract,
      'each H16 evidence/helper writer must be no-follow, exclusive, durable, and atomic',
    );
  }
}
assert.match(publishRecord, /expected\.startswith\(existing\)/u);
assert.match(copyRootFile, /data\.startswith\(existing\)/u);

const interruptedPrefix = shellFunction(installer, 'require_interrupted_h16_prefix');
for (const interruptedContract of [
  /require_h16_prefix_inventory/u,
  /require_disabled_grant_only/u,
  /require_record_or_prefix "\$H16_INSTALLING\/intent-v1"/u,
  /require_record_or_prefix "\$H16_INSTALLING\/completed-v1"/u,
  /target_state='predecessor'/u,
  /target_state='successor'/u,
  /require_copy_or_prefix "\$H16_INSTALLING\/predecessor-helper"/u,
  /require_helper_file "\$H16_INSTALLING\/predecessor-helper"/u,
  /require_helper_file "\$INSTALLING_HELPER" "\$SUCCESSOR_HELPER_SHA256" 755/u,
]) {
  assert.match(interruptedPrefix, interruptedContract);
}
const exactH16Record = shellFunction(installer, 'require_exact_h16_record');
assert.match(exactH16Record, /\$'completed-v1\\nintent-v1\\npredecessor-helper'/u);
assertInOrder(
  exactH16Record,
  [
    'cmp -s -- "$root/intent-v1" <(expected_intent)',
    'cmp -s -- "$root/completed-v1" <(expected_completion)',
    'require_helper_file "$root/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400',
  ],
  'completed H16 evidence must exactly bind its intent, completion, and immutable predecessor archive',
);

const installerMainStart = installer.indexOf(
  "require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'",
);
assert.ok(installerMainStart >= 0, 'the H16 installer must expose one bounded root-only main path');
const installerMain = installer.slice(installerMainStart);
assertPatternsInOrder(
  installerMain,
  [
    /h16_state="\$\(classify_h16_namespace\)"/u,
    /if require_initial_h16_namespace "\$h16_state"; then[\s\S]*?initial_grant_state='active'/u,
    /elif require_disabled_initial_h16_checkpoint "\$h16_state"; then[\s\S]*?initial_grant_state='disabled'[\s\S]*?grant_disabled='true'/u,
    /open_lock/u,
    /case "\$initial_grant_state" in/u,
    /active\)[\s\S]*?require_initial_h16_namespace "\$h16_state"[\s\S]*?disable_sudoers/u,
    /disabled\)[\s\S]*?require_disabled_initial_h16_checkpoint "\$h16_state"/u,
    /install -d -o root -g root -m 0700 "\$H16_INSTALLING"/u,
    /require_interrupted_h16_prefix/u,
  ],
  'an exact disabled-grant pristine initial checkpoint must resume under lock before evidence publication',
);
assertPatternsInOrder(
  installerMain,
  [
    /classify_h16_namespace/u,
    /require_(?:initial_h16_namespace|interrupted_h16_prefix|exact_completed_h16_namespace)/u,
    /open_lock/u,
    /h14_evidence_before="\$\(h14_evidence_digest\)"/u,
    /runtime_boundary_before="\$\(runtime_boundary_digest\)"/u,
    /disable_sudoers/u,
    /publish_record_atomically "\$H16_INSTALLING" intent-v1 0600 expected_intent/u,
    /copy_root_file_atomically "\$TARGET"[\s\S]*?"\$H16_INSTALLING\/predecessor-helper"[\s\S]*?"\$PREDECESSOR_HELPER_SHA256"/u,
    /copy_root_file_atomically "\$STAGED_HELPER" "\$INSTALLING_HELPER_PARTIAL"[\s\S]*?"\$SUCCESSOR_HELPER_SHA256"/u,
    /mv -- "\$INSTALLING_HELPER" "\$TARGET"/u,
    /publish_record_atomically "\$H16_INSTALLING" completed-v1 0600 expected_completion/u,
    /mv -- "\$H16_INSTALLING" "\$H16_ROOT"/u,
    /"\$\(h14_evidence_digest\)" == "\$h14_evidence_before"/u,
    /"\$\(runtime_boundary_digest\)" == "\$runtime_boundary_before"/u,
    /close_lock/u,
    /run_helper_direct verify "\$SUCCESSOR_HELPER_SHA256"/u,
    /require_helper_h14_cohort_prepared_boundary "\$SUCCESSOR_HELPER_SHA256"/u,
    /open_lock/u,
    /\[\[ "\$\(classify_h16_namespace\)" == 'completed' \]\]/u,
    /require_static_h14_cohort_prepared_boundary/u,
    /"\$\(h14_evidence_digest\)" == "\$h14_evidence_before"/u,
    /"\$\(runtime_boundary_digest\)" == "\$runtime_boundary_before"/u,
    /restore_sudoers/u,
  ],
  'H16 must re-attest H14, append intent, archive and rotate the helper atomically, publish completion, self-attest, re-lock, and restore the grant last',
);
assert.equal(
  countMatches(installerMain, /^\s*restore_sudoers(?:\s|$)/gmu),
  1,
  'the deployment grant may be restored only once and only at the final checkpoint',
);
assert.doesNotMatch(
  installer,
  /(?:^|\n)\s*(?:rm|rmdir|unlink|truncate)\s/u,
  'the H16 installer must preserve all predecessor and interrupted evidence',
);
assert.doesNotMatch(
  installer,
  /run_helper_direct\s+(?:start-kemerbet-session-provision|kemerbet-session-provision-ready|seal-kemerbet-readiness|recheck-kemerbet-readiness)|GeneralInfoByExternalId|PlayerEPOSDeposit|agentsystem\.admindigi\.com|kemerbet\.co|FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY)_ENABLED=true|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=true|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true/iu,
  'H16 must not start a session, contact a provider, lookup a Player, enable Amount or Transfer, or move money',
);
assert.doesNotMatch(
  installer,
  /docker[^\n]*(?:compose\s+up|\s(?:create|start|restart|stop|kill|rm|prune)\b)/iu,
  'H16 Docker access, if any, must remain inspection-only',
);

assert.match(
  helper,
  new RegExp(
    `^readonly KEMERBET_SECURITY_RECOVERY_PREVIEW_BRIDGE_V16_PARENT='${parent.replaceAll('/', '\\/')}'$`,
    'mu',
  ),
);
assert.match(helper, /^KEMERBET_H16_PREVIEW_BRIDGE_STATE='absent'$/mu);
for (const globalName of [
  'KEMERBET_H16_PREVIEW_BRIDGE_RELEASE',
  'KEMERBET_H16_PREVIEW_BRIDGE_HELPER_SHA256',
  'KEMERBET_H16_PREVIEW_BRIDGE_PREDECESSOR_HELPER_SHA256',
  'KEMERBET_H16_PREVIEW_BRIDGE_H14_RELEASE',
]) {
  assert.match(
    helper,
    new RegExp(`^${globalName}=''$`, 'mu'),
    `missing helper global ${globalName}`,
  );
}

const h16Parser = shellFunction(helper, 'inspect_kemerbet_h16_preview_bridge');
for (const parserContract of [
  /KEMERBET_SECURITY_RECOVERY_PREVIEW_BRIDGE_V16_PARENT/u,
  /contract=fetanagent-kemerbet-security-recovery-preview-bridge-v16/u,
  new RegExp(`canonical_h14 = '${canonicalH14Release}'`, 'u'),
  new RegExp(`canonical_runtime = '${canonicalRuntimeRelease}'`, 'u'),
  new RegExp(`canonical_predecessor = '${predecessorHelperSha256}'`, 'u'),
  new RegExp(`canonical_prompt = '${h14AuthorizationPromptSha256}'`, 'u'),
  new RegExp(`canonical_authorization = '${h14RecoveryAuthorizationSha256}'`, 'u'),
  /state=authorized/u,
  /state=preview-bridge-installed/u,
  /completed-v1/u,
  /intent-v1/u,
  /predecessor-helper/u,
  /runtime_release/u,
  /h14_recovery_release/u,
  /h14_recovery_state=cohort-prepared/u,
  /predecessor_helper_sha256/u,
  /successor_helper_sha256/u,
  /bridge_intent_sha256/u,
  /financial_actions_mode=dry_run/u,
  /kemerbet_executor_enabled=false/u,
  /kemerbet_final_action_enabled=false/u,
  /internal_execution_runtime_enabled=false/u,
  /private_live_deposit_pilot_enabled=false/u,
  /lookup_authorized=false/u,
  /recheck_authorized=false/u,
  /amount_entry_enabled=false/u,
  /transfer_enabled=false/u,
  /money_moved=false/u,
  /sys\.stdout\.write\([\s\S]*?f'active\\n/u,
  /"\$\{inspection_lines\[0\]\}" == 'active'/u,
  /KEMERBET_H16_PREVIEW_BRIDGE_RELEASE=/u,
  /KEMERBET_H16_PREVIEW_BRIDGE_HELPER_SHA256=/u,
]) {
  assert.match(h16Parser, parserContract);
}
assert.match(
  h16Parser,
  /exact_directory\(root, 0o700, \['completed-v1', 'intent-v1', 'predecessor-helper'\]\)/u,
  'the H16 parser must reject any namespace other than the three exact completed entries',
);
assert.match(
  h16Parser,
  /KEMERBET_H16_PREVIEW_BRIDGE_STATE='invalid'/u,
  'an existing prefix or malformed namespace must stay invalid until exact completion',
);
assertInOrder(
  h16Parser,
  [
    "exact_directory(root, 0o700, ['completed-v1', 'intent-v1', 'predecessor-helper'])",
    "completion[1] != 'state=preview-bridge-installed'",
    "completion[20] != f'bridge_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'",
    'f\'active\\n{bridge_release}\\n{intent[7].split("=", 1)[1]}\\n\'',
    '"${inspection_lines[0]}" == \'active\'',
    'KEMERBET_H16_PREVIEW_BRIDGE_STATE="${inspection_lines[0]}"',
  ],
  'the H16 parser may report an active successor only after exact completed evidence is validated',
);
assert.doesNotMatch(
  h16Parser,
  /KEMERBET_(?:H14_RECOVERY_RELEASE|V3_RECHECK_BRIDGE_RELEASE|V2_V3_SUCCESSOR_HELPER_SHA256)=/u,
  'the bounded H16 parser may report evidence but must not mutate aggregate H14 or successor state itself',
);

const h14Inspector = shellFunction(helper, 'inspect_kemerbet_h14_recovery_gate');
assertInOrder(
  h14Inspector,
  [
    'KEMERBET_H14_RECOVERY_STATE="${inspection_lines[0]}"',
    'KEMERBET_H14_RECOVERY_RELEASE="${inspection_lines[1]}"',
    'KEMERBET_H14_RECOVERY_HELPER_SHA256="${inspection_lines[2]}"',
    'current_helper_sha="${inspection_lines[4]}"',
    'inspect_kemerbet_h16_preview_bridge',
  ],
  'the H16 parser may run only after exact canonical H14 evidence has been accepted',
);
assert.match(
  h14Inspector,
  /\[\[ "\$KEMERBET_H16_PREVIEW_BRIDGE_STATE" != 'invalid' \]\] \|\| \{[\s\S]*?KEMERBET_H14_RECOVERY_STATE='invalid'[\s\S]*?return 0[\s\S]*?\}/u,
  'invalid or interrupted H16 evidence must poison the accepted H14 aggregate boundary',
);
const h16CrossCheckStart = h14Inspector.indexOf(
  `if [[ "$KEMERBET_H16_PREVIEW_BRIDGE_STATE" == 'active'`,
);
const h16CrossCheckEnd = h14Inspector.indexOf('\n  elif [[', h16CrossCheckStart);
assert.ok(
  h16CrossCheckStart >= 0 && h16CrossCheckEnd > h16CrossCheckStart,
  'the H14 inspector must expose one bounded active-H16 cross-check',
);
const h16CrossCheck = h14Inspector.slice(h16CrossCheckStart, h16CrossCheckEnd);
for (const exactActiveBoundary of [
  /"\$KEMERBET_H14_RECOVERY_STATE" == 'cohort-prepared'/u,
  /"\$KEMERBET_H16_PREVIEW_BRIDGE_H14_RELEASE" == "\$KEMERBET_H14_RECOVERY_RELEASE"/u,
  /"\$KEMERBET_H16_PREVIEW_BRIDGE_PREDECESSOR_HELPER_SHA256" ==[\s\S]*?"\$KEMERBET_H14_RECOVERY_HELPER_SHA256"/u,
  /"\$KEMERBET_H16_PREVIEW_BRIDGE_HELPER_SHA256" == "\$current_helper_sha"/u,
]) {
  assert.match(
    h16CrossCheck,
    exactActiveBoundary,
    'active H16 evidence must stay bound to the exact cohort-prepared H14 predecessor and current helper',
  );
}
assert.doesNotMatch(
  h16CrossCheck,
  /^\s*KEMERBET_(?:H14_RECOVERY_HELPER_SHA256|H14_RECOVERY_RELEASE|V3_RECHECK_BRIDGE_RELEASE)=/mu,
  'the H16 cross-check must leave canonical H14 and recheck evidence unchanged',
);

const successorInspector = shellFunction(helper, 'inspect_kemerbet_v2_v3_successor_gate');
assertInOrder(
  successorInspector,
  [
    'inspect_kemerbet_h14_recovery_gate',
    `if [[ "$KEMERBET_H14_RECOVERY_STATE" == 'invalid'`,
    'KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$KEMERBET_H14_RECOVERY_HELPER_SHA256"',
    `if [[ "$KEMERBET_H16_PREVIEW_BRIDGE_STATE" == 'active'`,
  ],
  'the aggregate successor gate must accept H14 before considering exact active H16 evidence',
);
const effectiveHelperAssignment =
  'KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$KEMERBET_H16_PREVIEW_BRIDGE_HELPER_SHA256"';
assert.equal(
  successorInspector.split(effectiveHelperAssignment).length - 1,
  1,
  'exact completed H16 evidence must be the sole H16 override of the effective helper digest',
);
const h16ActivationStart = successorInspector.indexOf(
  `if [[ "$KEMERBET_H16_PREVIEW_BRIDGE_STATE" == 'active'`,
);
const h16ActivationEnd = successorInspector.indexOf('\n    fi', h16ActivationStart);
assert.ok(
  h16ActivationStart >= 0 && h16ActivationEnd > h16ActivationStart,
  'the aggregate gate must expose one bounded completed-H16 activation block',
);
const h16Activation = successorInspector.slice(h16ActivationStart, h16ActivationEnd);
assert.match(h16Activation, new RegExp(effectiveHelperAssignment.replaceAll('$', '\\$')));
assert.doesNotMatch(
  h16Activation,
  /KEMERBET_(?:H14_RECOVERY_RELEASE|V2_V3_SUCCESSOR_RELEASE|V3_RECHECK_BRIDGE_RELEASE)=/u,
  'H16 may advance only the effective helper digest; the canonical H14 and recheck releases stay unchanged',
);
assert.ok(
  h16Activation.indexOf(`KEMERBET_H16_PREVIEW_BRIDGE_STATE" == 'active'`) <
    h16Activation.indexOf(effectiveHelperAssignment),
  'the H16 successor digest may become effective only inside the exact completed-evidence branch',
);

console.log(
  `KemerBet H16 security-recovery preview bridge contracts verified; successor helper ${helperSha256}.`,
);
