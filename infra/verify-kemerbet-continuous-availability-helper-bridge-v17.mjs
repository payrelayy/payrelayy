import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const normalized = (path) => readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n');
const installer = normalized(
  'infra/operations/fetanagent-kemerbet-continuous-availability-helper-bridge-v17.sh',
);
const helper = normalized('infra/operations/fetanagent-staging-deploy-helper.sh');
const helperSha256 = createHash('sha256').update(helper).digest('hex');
const predecessorHelperSha256 = 'da555f29ac6260e1dff6c969218eb55ea9bd66c8167600e3ecc700118c8ea9e6';
const runtimeRelease = '70d46b9642c7d1fd781fd7200289b7a2fff068ec';
const parent = '/var/lib/fetanagent/kemerbet-continuous-availability-helper-bridge-v17';
const confirmation =
  'I-UNDERSTAND-THIS-INSTALLS-ONE-H17-CONTINUOUS-AVAILABILITY-HELPER-WITH-NO-MONEY';

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

assert.match(installer, /^#!\/usr\/bin\/env bash$/mu);
assert.match(installer, /^set -euo pipefail$/mu);
assert.match(installer, /^umask 077$/mu);
assert.match(
  installer,
  /^readonly TARGET='\/usr\/local\/sbin\/fetanagent-staging-deploy-helper'$/mu,
);
assert.match(
  installer,
  new RegExp(`^readonly H17_PARENT='${parent.replaceAll('/', '\\/')}'$`, 'mu'),
);
assert.match(installer, new RegExp(`^readonly CURRENT_RUNTIME_RELEASE='${runtimeRelease}'$`, 'mu'));
assert.match(
  installer,
  new RegExp(`^readonly PREDECESSOR_HELPER_SHA256='${predecessorHelperSha256}'$`, 'mu'),
);
assert.match(
  installer,
  new RegExp(`^readonly REVIEWED_SUCCESSOR_HELPER_SHA256='${helperSha256}'$`, 'mu'),
  'the H17 installer must pin the exact LF-normalized successor helper',
);
assert.match(installer, new RegExp(`^readonly CONFIRMATION='${confirmation}'$`, 'mu'));
assert.match(installer, /"\$PROVIDED_CONFIRMATION" == "\$CONFIRMATION"/u);
assert.match(installer, /"\$SUCCESSOR_HELPER_SHA256" == "\$REVIEWED_SUCCESSOR_HELPER_SHA256"/u);
assert.match(installer, /"\$SUCCESSOR_HELPER_SHA256" != "\$PREDECESSOR_HELPER_SHA256"/u);
assert.match(installer, /"\$BRIDGE_RELEASE" != "\$CURRENT_RUNTIME_RELEASE"/u);
assert.match(installer, /"\$BRIDGE_RELEASE" != "\$CANONICAL_H14_RELEASE"/u);
assert.match(installer, /"\$\(id -u\)" == '0'/u);
assert.match(installer, /SUDO_USER:-/u);
assert.match(installer, /EXPECTED_DROPLET_ID='593344964'/u);
assert.match(installer, /EXPECTED_PUBLIC_IPV4='161\.35\.41\.232'/u);

const intent = shellFunction(installer, 'expected_intent');
const completion = shellFunction(installer, 'expected_completion');
const fields = [
  'contract=fetanagent-kemerbet-continuous-availability-helper-bridge-v17',
  'state=authorized',
  'bridge_release=$BRIDGE_RELEASE',
  'runtime_release=$CURRENT_RUNTIME_RELEASE',
  'h16_bridge_release=$H16_RELEASE',
  'predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256',
  'successor_helper_sha256=$SUCCESSOR_HELPER_SHA256',
  'continuous_application_availability=true',
  'expiry_timer_active=false',
  'expiry_timer_enabled=false',
  'expiry_timer_next_trigger=false',
  'financial_actions_mode=dry_run',
  'kemerbet_executor_enabled=false',
  'kemerbet_final_action_enabled=false',
  'transfer_enabled=false',
  'money_moved=false',
];
assertInOrder(intent, fields, 'the H17 intent must be canonical');
for (const field of fields) {
  assert.equal(intent.split(field).length - 1, 1, `the H17 intent must contain one ${field}`);
}
assertInOrder(
  completion,
  [
    'intent_sha256="$(expected_intent | sha256sum',
    'state=availability-helper-installed',
    "printf 'bridge_intent_sha256=%s\\n'",
  ],
  'the H17 completion must derive from and bind the exact intent',
);

for (const contract of [
  /require_exact_finalizer_inspection\(\)/u,
  /require_runtime_services\(\)/u,
  /require_continuous_timer\(\)/u,
  /require_continuous_credentials\(\)/u,
  /require_helper_boundary\(\)/u,
  /runtime_boundary_digest\(\)/u,
  /publish_record_atomically\(\)/u,
  /copy_predecessor_atomically\(\)/u,
  /install_successor_atomically\(\)/u,
  /disable_sudoers\(\)/u,
  /restore_sudoers\(\)/u,
  /flock --exclusive --nonblock 9/u,
]) {
  assert.match(installer, contract);
}
assert.match(installer, /role\.rolvaliduntil = 'infinity'::timestamptz/u);
assert.match(installer, /connectionTimeoutMillis: 5000/u);
assert.match(installer, /statement_timeout: 5000/u);
assert.match(installer, /fetanagent_deposit_executor_runtime/u);
assert.match(installer, /fetanagent_trusted_telebirr_verifier_runtime/u);
assert.match(installer, /and not rolcanlogin/u);
assert.match(installer, /UnitFileState --value "\$TIMER"/u);
assert.match(installer, /NextElapseUSecRealtime --value "\$TIMER"/u);
assert.match(installer, /DropInPaths --value "\$TIMER"/u);
assert.match(installer, /DropInPaths --value "\$SERVICE"/u);
assert.match(installer, /require_exact_record "\$H17_ROOT"/u);
assert.match(installer, /require_helper_file "\$final" "\$PREDECESSOR_HELPER_SHA256" 400/u);
assert.doesNotMatch(
  installer,
  /FINANCIAL_ACTIONS_MODE=live|KEMERBET_(?:EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY)_ENABLED=true/u,
);
assert.doesNotMatch(
  installer,
  /docker(?:_local_read_only)? (?:stop|start|restart|rm|compose|run)\b/u,
);
assert.doesNotMatch(installer, /\b(?:psql|alter role|update app\.|insert into|delete from)\b/iu);
assert.doesNotMatch(installer, /\b(?:password|secret|token)=/iu);

const execution = installer.slice(installer.indexOf("require_exact_droplet || die '"));
assertInOrder(
  execution,
  [
    'require_exact_finalizer_inspection',
    'require_helper_boundary "$PREDECESSOR_HELPER_SHA256"',
    'require_continuous_boundary',
    'runtime_before="$(runtime_boundary_digest)"',
    'open_lock',
    'require_no_other_mutator_processes',
    'disable_sudoers',
    'publish_record_atomically "$H17_INSTALLING" intent-v1',
    'copy_predecessor_atomically',
    'publish_record_atomically "$H17_INSTALLING" completed-v1',
    'mv -- "$H17_INSTALLING" "$H17_ROOT"',
    'install_successor_atomically',
    'close_lock',
    'require_helper_boundary "$SUCCESSOR_HELPER_SHA256"',
    'open_lock',
    'restore_sudoers',
    'close_lock',
  ],
  'H17 must attest, isolate mutation, append evidence, replace one helper, re-attest, and restore',
);

const h17Parser = shellFunction(helper, 'inspect_kemerbet_h17_availability_bridge');
const h16Parser = shellFunction(helper, 'inspect_kemerbet_h16_preview_bridge');
const h14Gate = shellFunction(helper, 'inspect_kemerbet_h14_recovery_gate');
const successorGate = shellFunction(helper, 'inspect_kemerbet_v2_v3_successor_gate');
assert.match(
  helper,
  /^readonly KEMERBET_CONTINUOUS_AVAILABILITY_HELPER_BRIDGE_V17_PARENT='\/var\/lib\/fetanagent\/kemerbet-continuous-availability-helper-bridge-v17'$/mu,
);
assert.match(h17Parser, /runtime_release = '70d46b9642c7d1fd781fd7200289b7a2fff068ec'/u);
assert.match(h17Parser, new RegExp(predecessorHelperSha256, 'u'));
assert.match(h17Parser, /len\(intent\) != 16/u);
assert.match(h17Parser, /len\(completion\) != 17/u);
assert.match(h17Parser, /hashlib\.sha256\(predecessor_data\)\.hexdigest\(\) != predecessor_sha/u);
assert.match(h17Parser, /hashlib\.sha256\(helper_data\)\.hexdigest\(\) != successor_sha/u);
for (const field of fields.slice(7)) assert.match(h17Parser, new RegExp(field, 'u'));
assert.match(h16Parser, /local helper_mode="\$\{2:-755\}" helper_path="\$\{1:-\$HELPER_PATH\}"/u);
assert.match(
  h16Parser,
  /"\$KEMERBET_SECURITY_RECOVERY_PREVIEW_BRIDGE_V16_PARENT" "\$helper_path" \\/u,
);
assert.match(h14Gate, /"\$KEMERBET_H17_AVAILABILITY_BRIDGE_PREDECESSOR_HELPER" 400/u);
assertInOrder(
  h14Gate,
  [
    'inspect_kemerbet_h17_availability_bridge',
    `[[ "$KEMERBET_H17_AVAILABILITY_BRIDGE_STATE" != 'invalid' ]]`,
    `if [[ "$KEMERBET_H17_AVAILABILITY_BRIDGE_STATE" == 'active' ]]`,
    'inspect_kemerbet_h16_preview_bridge',
    '"$KEMERBET_H17_AVAILABILITY_BRIDGE_PREDECESSOR_HELPER_SHA256" ==',
    '"$KEMERBET_H16_PREVIEW_BRIDGE_HELPER_SHA256"',
    '"$KEMERBET_H17_AVAILABILITY_BRIDGE_HELPER_SHA256" == "$current_helper_sha"',
  ],
  'the H14 gate must validate H16 through the archived predecessor and bind H17 to the current helper',
);
assertInOrder(
  successorGate,
  [
    `if [[ "$KEMERBET_H17_AVAILABILITY_BRIDGE_STATE" == 'active' ]]`,
    'KEMERBET_V2_V3_SUCCESSOR_HELPER_SHA256="$KEMERBET_H17_AVAILABILITY_BRIDGE_HELPER_SHA256"',
    `elif [[ "$KEMERBET_H16_PREVIEW_BRIDGE_STATE" == 'active' ]]`,
  ],
  'the successor gate must prefer the terminal H17 helper identity while retaining H16 fallback',
);

const bash =
  process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe'].find(
        existsSync,
      )
    : 'bash';
assert.ok(bash);
for (const file of [
  'infra/operations/fetanagent-kemerbet-continuous-availability-helper-bridge-v17.sh',
  'infra/operations/fetanagent-staging-deploy-helper.sh',
]) {
  const result = spawnSync(bash, ['-n', resolve(root, file)], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}

console.info(
  `KemerBet H17 continuous-availability helper bridge contracts verified; successor helper ${helperSha256}.`,
);
