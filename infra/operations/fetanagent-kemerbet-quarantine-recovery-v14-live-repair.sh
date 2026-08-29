#!/usr/bin/env bash
# Root-console-only, live-state-specific repair of the interrupted canonical H14
# quarantine recovery. The canonical H14 release and its evidence namespace are
# never renamed, rewritten, or superseded. This installer bridges only the
# Docker Mounts serialization-order defect through a separate root-only ledger,
# then resumes the reviewed H14 state machine with a deterministic semantic
# Docker contract. It never starts a browser, enters Amount, clicks Transfer,
# enables an executor/final action, or moves money.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly PREDECESSOR_RELEASE='306818ca812bd2abce8479396c4eea8383ea00f9'
readonly RECOVERY_RELEASE='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly PREDECESSOR_HELPER_SHA256='3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58'
readonly AUTHORIZATION_SHA256='6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-disabled'
readonly H13_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-recheck-bridge-v13'
readonly H14_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14'
readonly REPAIR_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-live-repair'
readonly EMPTY_CHECKPOINT_RELEASE='4239201b5496bd08912cce4b5581fe19b29a84d4'
readonly EMPTY_CHECKPOINT_RECORD_NAME='empty-predecessor-checkpoint-adoption-v1'
readonly SOURCE_BINDING='/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
readonly FINAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly OWNER_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-cohort-receipts'
readonly FAILED_MARKER_NAME='kemerbet-readiness-cohort-failed-v1'
readonly TERMINAL_MARKER_NAME='kemerbet-readiness-cohort-security-recovery-failed-terminal-v1'
readonly PLAYER_STAGE_NAME='kemerbet-readiness-player-ids.stage-v1'
readonly CLAIM_STAGE_NAME='kemerbet-readiness-cohort-claim.stage-v1'
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-installing'
readonly INSTALLING_HELPER_PARTIAL="${INSTALLING_HELPER}.partial"
readonly SCRIPT_BASENAME='fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh'
readonly CANONICAL_SCRIPT_BASENAME='fetanagent-kemerbet-quarantine-recovery-v14.sh'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H14 live repair failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the repair implementation release, reviewed helper digest, and authorization digest'
readonly REPAIR_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_AUTHORIZATION_SHA256="$3"
readonly STAGING_ROOT="/root/fetanagent-kemerbet-quarantine-recovery-v14-live-repair-$REPAIR_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly RECOVERY_ROOT="$H14_PARENT/$RECOVERY_RELEASE"
readonly RECOVERY_INSTALLING="$H14_PARENT/.installing-$RECOVERY_RELEASE"
readonly EMPTY_CHECKPOINT_INSTALLING="$H14_PARENT/.installing-$EMPTY_CHECKPOINT_RELEASE"
readonly REPAIR_ROOT="$REPAIR_PARENT/$REPAIR_RELEASE"
readonly REPAIR_INSTALLING="$REPAIR_PARENT/.installing-$REPAIR_RELEASE"

[[ "$REPAIR_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$REPAIR_RELEASE" != "$RECOVERY_RELEASE" &&
  "$REPAIR_RELEASE" != "$PREDECESSOR_RELEASE" &&
  "$REPAIR_RELEASE" != "$EMPTY_CHECKPOINT_RELEASE" ]] ||
  die 'the H14 repair implementation must be a distinct full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct hard-pinned reviewed H14 artifact'
[[ "$PROVIDED_AUTHORIZATION_SHA256" == "$AUTHORIZATION_SHA256" ]] ||
  die 'the exact reviewed quarantine-recovery authorization digest is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this installer only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl dirname docker env find flock grep head id install mkdir mv \
  python3 realpath seq sha256sum sleep sort stat sync tail visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

[[ ! -L "$STAGED_INSTALLER" && -f "$STAGED_INSTALLER" &&
  "$(realpath -- "$0")" == "$STAGED_INSTALLER" &&
  "$(realpath -- "$STAGED_INSTALLER")" == "$STAGED_INSTALLER" &&
  "$(stat --format='%U:%G:%a:%h' "$STAGED_INSTALLER")" == 'root:root:600:1' ]] ||
  die 'run only the root-owned exact-release installer staged at the reviewed H14 path'

expected_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}

require_exact_sudoers_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:440:1' ]] || return 1
  cmp -s -- "$path" <(expected_sudoers)
}

require_active_grant_only() {
  require_exact_sudoers_file "$SUDOERS" || return 1
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] || return 1
  visudo -cf /etc/sudoers >/dev/null
}

require_disabled_grant_only() {
  [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  visudo -cf /etc/sudoers >/dev/null
}

disable_sudoers() {
  require_active_grant_only || return 1
  mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
  sync -f /etc/sudoers.d || return 1
  require_disabled_grant_only
}

restore_sudoers() {
  require_disabled_grant_only || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_active_grant_only
}

require_helper_file() {
  local path="$1" digest="$2" mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$mode:1" &&
    "$(sha256sum -- "$path" | awk '{print $1}')" == "$digest" ]] || return 1
  bash -n "$path"
}

run_helper_direct() {
  env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' "$TARGET" "$@"
}

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

require_exact_droplet() {
  [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == \
    "$EXPECTED_DROPLET_ID" ]] || return 1
  [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]]
}

require_no_other_mutator_processes() {
  local argument basename cmdline pid
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    pid="${cmdline#/proc/}"
    pid="${pid%/cmdline}"
    [[ "$pid" == "$$" ]] && continue
    while IFS= read -r -d '' argument; do
      basename="${argument##*/}"
      case "$argument" in
        "$TARGET"|"$INSTALLING_HELPER"|"$INSTALLING_HELPER_PARTIAL"|"$STAGED_HELPER") return 1 ;;
      esac
      [[ "$basename" == "$SCRIPT_BASENAME" || "$basename" == "$CANONICAL_SCRIPT_BASENAME" ]] &&
        return 1
    done <"$cmdline" || true
  done
}

require_exact_h13_evidence() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$H13_PARENT" "$PREDECESSOR_RELEASE" "$PREDECESSOR_HELPER_SHA256" <<'PY'
import hashlib
import os
import stat
import sys

parent, release, helper_sha = sys.argv[1:]


def reject():
    raise RuntimeError()


def exact_file(path, mode, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
            != (0, 0, mode, 1)
            or value.st_size > maximum
            or os.path.realpath(path) != path
        ):
            reject()
        data = os.pread(descriptor, maximum + 1, 0)
        if len(data) != value.st_size:
            reject()
        return data
    finally:
        os.close(descriptor)


try:
    for path in (parent, f'{parent}/{release}'):
        value = os.lstat(path)
        if (
            not stat.S_ISDIR(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
            or os.path.realpath(path) != path
        ):
            reject()
    if os.listdir(parent) != [release]:
        reject()
    root = f'{parent}/{release}'
    if sorted(os.listdir(root)) != ['completed-v1', 'intent-v1', 'predecessor-helper']:
        reject()
    intent = exact_file(f'{root}/intent-v1', 0o600, 8192)
    completed = exact_file(f'{root}/completed-v1', 0o600, 8192)
    exact_file(f'{root}/predecessor-helper', 0o400, 2 * 1024 * 1024)
    intent_lines = intent.decode('ascii').splitlines()
    completed_lines = completed.decode('ascii').splitlines()
    if (
        len(intent_lines) != 25
        or len(completed_lines) != 26
        or intent != ('\n'.join(intent_lines) + '\n').encode('ascii')
        or completed != ('\n'.join(completed_lines) + '\n').encode('ascii')
        or intent_lines[0] != 'contract=fetanagent-kemerbet-readiness-v3-recheck-bridge-v13'
        or intent_lines[1] != 'state=authorized'
        or f'recheck_release={release}' not in intent_lines
        or f'successor_helper_sha256={helper_sha}' not in intent_lines
        or 'financial_actions_mode=dry_run' not in intent_lines
        or 'kemerbet_executor_enabled=false' not in intent_lines
        or 'kemerbet_final_action_enabled=false' not in intent_lines
        or 'transfer_enabled=false' not in intent_lines
        or 'amount_entry_enabled=false' not in intent_lines
        or completed_lines[1] != 'state=recheck-bridge-installed'
        or completed_lines[2:25] != intent_lines[2:25]
        or completed_lines[25] != f'rotation_intent_sha256={hashlib.sha256(intent).hexdigest()}'
    ):
        reject()
except Exception:
    raise SystemExit(1)
PY
}

has_enabled_financial_gate() {
  local entry environment="$1" status
  while IFS= read -r entry; do
    case "$entry" in
      FINANCIAL_ACTIONS_MODE=dry_run) continue ;;
      FINANCIAL_ACTIONS_MODE=*) return 0 ;;
    esac
    [[ "$entry" == 'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' ]] && continue
    if grep -Eiq '^(FETANAGENT_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY|WITHDRAW|SETTLEMENT).*|KEMERBET_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED|TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED)=(1|true|yes|on)$' \
      <<<"$entry"; then
      return 0
    else
      status=$?
      [[ "$status" -eq 1 ]] || return 0
    fi
  done <<<"$environment"
  return 1
}

require_financial_gates_disabled() {
  local container environment inventory mode_count
  [[ ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" ]] || return 1
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    environment="$(docker_local container inspect "$container" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
    mode_count="$(awk '$0 == "FINANCIAL_ACTIONS_MODE=dry_run" { count += 1 } END { print count + 0 }' \
      <<<"$environment")" || return 1
    [[ "$mode_count" == '1' ]] || return 1
    if has_enabled_financial_gate "$environment"; then
      return 1
    fi
  done <<<"$inventory"
}

container_semantic_contract_digest() {
  local container_id="$1"
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  docker_local container inspect "$container_id" |
    env -i PATH="$SAFE_PATH" python3 -I /dev/fd/3 "$container_id" 3<<'PY'
import hashlib
import json
import sys

expected_id = sys.argv[1]


def reject():
    raise SystemExit(1)


def member(value, name):
    if not isinstance(value, dict) or name not in value:
        reject()
    return value[name]


try:
    payload = json.load(sys.stdin)
    if not isinstance(payload, list) or len(payload) != 1:
        reject()
    inspected = payload[0]
    if not isinstance(inspected, dict) or member(inspected, 'Id') != expected_id:
        reject()
    config = member(inspected, 'Config')
    host = member(inspected, 'HostConfig')
    mounts = member(inspected, 'Mounts')
    if not isinstance(config, dict) or not isinstance(host, dict):
        reject()
    cmd = member(config, 'Cmd')
    environment = member(config, 'Env')
    if (
        not isinstance(cmd, list)
        or any(not isinstance(value, str) for value in cmd)
        or not isinstance(environment, list)
        or any(not isinstance(value, str) for value in environment)
    ):
        reject()
    if not isinstance(mounts, list) or any(not isinstance(item, dict) for item in mounts):
        reject()
    destinations = [member(item, 'Destination') for item in mounts]
    if (
        any(not isinstance(value, str) or not value.startswith('/') for value in destinations)
        or len(set(destinations)) != len(destinations)
    ):
        reject()
    labels = member(config, 'Labels')
    restart = member(host, 'RestartPolicy')
    if not isinstance(labels, dict) or not isinstance(restart, dict):
        reject()

    # The old v1 digest serialized Docker's Go map-backed Mounts projection.
    # Mount order was therefore not stable.  The v2 contract parses one raw
    # inspect response, retains every field of every mount, and treats mounts
    # as a multiset by sorting their full canonical JSON encodings.  No other
    # array is reordered: Config.Cmd and Config.Env remain byte-order-sensitive.
    canonical_mounts = sorted(
        mounts,
        key=lambda item: json.dumps(
            item, sort_keys=True, separators=(',', ':'), ensure_ascii=True
        ),
    )
    contract = {
        'version': 'fetanagent-docker-semantic-contract-v2',
        'Id': member(inspected, 'Id'),
        'Image': member(inspected, 'Image'),
        'Config.Image': member(config, 'Image'),
        'Config.User': member(config, 'User'),
        'Config.Cmd': cmd,
        'Config.Env': environment,
        'HostConfig.ReadonlyRootfs': member(host, 'ReadonlyRootfs'),
        'HostConfig.CapAdd': member(host, 'CapAdd'),
        'HostConfig.CapDrop': member(host, 'CapDrop'),
        'HostConfig.SecurityOpt': member(host, 'SecurityOpt'),
        'HostConfig.RestartPolicy': restart,
        'Mounts': canonical_mounts,
        'Config.Labels': labels,
    }
    encoded = (
        json.dumps(contract, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
        + '\n'
    ).encode('ascii')
    print(hashlib.sha256(encoded).hexdigest())
except (KeyError, TypeError, ValueError, json.JSONDecodeError):
    reject()
PY
}

container_full_ids_for_volume() {
  local container_id full_id inventory volume="$1"
  inventory="$(docker_local container ls --all --quiet --filter "volume=$volume")" || return 1
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    full_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" || return 1
    [[ "$full_id" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$full_id"
  done <<<"$inventory" | LC_ALL=C sort
}

require_recovery_container_contract() {
  local container_id="$1" service="$2" expected_release="$3" environment profile_source control_source
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker_local container inspect "$container_id" --format '{{.Id}}')" == "$container_id" &&
    "$(docker_local container inspect "$container_id" --format '{{ index .Config.Labels "com.docker.compose.project" }}')" == "$PROJECT_NAME" &&
    "$(docker_local container inspect "$container_id" --format '{{ index .Config.Labels "com.docker.compose.service" }}')" == "$service" &&
    "$(docker_local container inspect "$container_id" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$expected_release" &&
    "$(docker_local container inspect "$container_id" --format '{{.Config.User}}')" == '10001:10001' &&
    "$(docker_local container inspect "$container_id" --format '{{.HostConfig.ReadonlyRootfs}}')" == 'true' &&
    "$(docker_local container inspect "$container_id" --format '{{.HostConfig.RestartPolicy.Name}}')" == 'no' &&
    "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapAdd}}')" == 'null' &&
    "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapDrop}}')" == '["ALL"]' &&
    "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.SecurityOpt}}')" == '["no-new-privileges:true"]' ]] ||
    return 1
  environment="$(docker_local container inspect "$container_id" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
  grep -Fxq 'FINANCIAL_ACTIONS_MODE=dry_run' <<<"$environment" || return 1
  grep -Fxq 'KEMERBET_EXECUTOR_ENABLED=false' <<<"$environment" || return 1
  grep -Fxq 'KEMERBET_FINAL_ACTION_ENABLED=false' <<<"$environment" || return 1
  ! has_enabled_financial_gate "$environment" || return 1
  control_source="$(docker_local container inspect "$container_id" --format \
    '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-session-control"}}{{.Name}}{{end}}{{end}}')" ||
    return 1
  [[ "$control_source" == "$CONTROL_VOLUME" ]] || return 1
  if [[ "$service" == 'kemerbet-session-provision' ]]; then
    grep -Fxq 'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false' <<<"$environment" || return 1
    grep -Fxq 'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' <<<"$environment" || return 1
    [[ "$(docker_local container inspect "$container_id" --format '{{json .Config.Cmd}}')" == \
      '["node","apps/executor/dist/kemerbet-session-provision-server.js"]' ]] || return 1
    profile_source="$(docker_local container inspect "$container_id" --format \
      '{{range .Mounts}}{{if eq .Destination "/var/lib/fetanagent/kemerbet-sessions"}}{{.Name}}{{end}}{{end}}')" ||
      return 1
    [[ "$profile_source" == "$PROFILE_VOLUME" ]] || return 1
  else
    [[ "$service" == 'owner-control' ]] || return 1
  fi
}

require_container_no_chromium() {
  local container_id="$1" processes
  processes="$(docker_local container top "$container_id" -eo pid,comm,args)" || return 1
  [[ "$(head -n 1 <<<"$processes")" =~ ^[[:space:]]*PID[[:space:]]+COMMAND[[:space:]]+COMMAND([[:space:]]|$) ]] ||
    return 1
  [[ "$(tail -n +2 <<<"$processes")" =~ ^[[:space:]]*[0-9]+[[:space:]] ]] || return 1
  ! grep -Eiq '(^|[[:space:]/])(chromium|chrome|google-chrome|headless_shell|chromedriver)([[:space:]/-]|$)' \
    <<<"$(tail -n +2 <<<"$processes")"
}

require_no_host_chromium() {
  env -i PATH="$SAFE_PATH" python3 -I - <<'PY'
import os
import re

browser = re.compile(rb'(^|[\s/])(chromium|chrome|google-chrome|headless_shell|chromedriver)([\s/-]|$)', re.I)
for entry in os.listdir('/proc'):
    if not entry.isdigit():
        continue
    try:
        with open(f'/proc/{entry}/cmdline', 'rb') as source:
            command = source.read(65537).replace(b'\x00', b' ')
        with open(f'/proc/{entry}/comm', 'rb') as source:
            name = source.read(257).strip()
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        continue
    if browser.search(name) or browser.search(command):
        raise SystemExit(1)
PY
}

require_exact_empty_predecessor_checkpoint_prefix() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$H14_PARENT" "$EMPTY_CHECKPOINT_RELEASE" "$RECOVERY_RELEASE" \
    "$EMPTY_CHECKPOINT_RECORD_NAME" <<'PY' || return 1
import os
import stat
import sys

parent, predecessor_release, successor_release, record_name = sys.argv[1:]
source_name = f'.installing-{predecessor_release}'
source = f'{parent}/{source_name}'
target = f'{parent}/.installing-{successor_release}'
temporary_name = f'.{record_name}.installing'


def reject():
    raise RuntimeError()


def expected_record(value):
    return ('\n'.join([
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-empty-checkpoint-adoption',
        'state=adoption-prepared',
        'same_inode_target_rename_authorized=true',
        'namespace_rename_pending_at_publication=true',
        f'predecessor_recovery_release={predecessor_release}',
        f'successor_recovery_release={successor_release}',
        f'checkpoint_dev_ino={value.st_dev}:{value.st_ino}',
        f'source_namespace={source_name}',
        f'target_namespace=.installing-{successor_release}',
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
    ]) + '\n').encode('ascii')


def exact_candidate(path, expected, allow_prefix):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        data = os.pread(descriptor, len(expected) + 1, 0)
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, 0o600, 1)
            or len(data) != before.st_size
            or before.st_size > len(expected)
            or (data != expected if not allow_prefix else not expected.startswith(data))
            or os.path.realpath(path) != path
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                after.st_nlink, after.st_size, after.st_mtime_ns)
        ):
            reject()
    finally:
        os.close(descriptor)


try:
    parent_value = os.lstat(parent)
    source_value = os.lstat(source)
    if (
        not stat.S_ISDIR(parent_value.st_mode)
        or (parent_value.st_uid, parent_value.st_gid, stat.S_IMODE(parent_value.st_mode))
        != (0, 0, 0o700)
        or os.path.realpath(parent) != parent
        or os.listdir(parent) != [source_name]
        or not stat.S_ISDIR(source_value.st_mode)
        or (source_value.st_uid, source_value.st_gid, stat.S_IMODE(source_value.st_mode))
        != (0, 0, 0o700)
        or source_value.st_dev != parent_value.st_dev
        or os.path.realpath(source) != source
        or os.path.lexists(target)
    ):
        reject()
    entries = os.listdir(source)
    if entries not in ([], [temporary_name], [record_name]):
        reject()
    expected = expected_record(source_value)
    if entries == [temporary_name]:
        exact_candidate(f'{source}/{temporary_name}', expected, True)
    elif entries == [record_name]:
        exact_candidate(f'{source}/{record_name}', expected, False)
except Exception:
    raise SystemExit(1)
PY
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]
}

adopt_exact_empty_predecessor_checkpoint() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$H14_PARENT" "$EMPTY_CHECKPOINT_RELEASE" "$RECOVERY_RELEASE" \
    "$EMPTY_CHECKPOINT_RECORD_NAME" <<'PY'
import os
import stat
import sys

parent, predecessor_release, successor_release, record_name = sys.argv[1:]
source_name = f'.installing-{predecessor_release}'
target_name = f'.installing-{successor_release}'
source = f'{parent}/{source_name}'
target = f'{parent}/{target_name}'
temporary_name = f'.{record_name}.installing'
temporary = f'{source}/{temporary_name}'
final = f'{source}/{record_name}'


def reject():
    raise RuntimeError()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def expected_record(value):
    return ('\n'.join([
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-empty-checkpoint-adoption',
        'state=adoption-prepared',
        'same_inode_target_rename_authorized=true',
        'namespace_rename_pending_at_publication=true',
        f'predecessor_recovery_release={predecessor_release}',
        f'successor_recovery_release={successor_release}',
        f'checkpoint_dev_ino={value.st_dev}:{value.st_ino}',
        f'source_namespace={source_name}',
        f'target_namespace={target_name}',
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
    ]) + '\n').encode('ascii')


def exact_file(path, expected, allow_prefix=False):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        data = os.pread(descriptor, len(expected) + 1, 0)
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, 0o600, 1)
            or len(data) != before.st_size
            or before.st_size > len(expected)
            or (data != expected if not allow_prefix else not expected.startswith(data))
            or os.path.realpath(path) != path
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                after.st_nlink, after.st_size, after.st_mtime_ns)
        ):
            reject()
        return data
    finally:
        os.close(descriptor)


try:
    parent_value = os.lstat(parent)
    source_value = os.lstat(source)
    if (
        not stat.S_ISDIR(parent_value.st_mode)
        or (parent_value.st_uid, parent_value.st_gid, stat.S_IMODE(parent_value.st_mode))
        != (0, 0, 0o700)
        or os.path.realpath(parent) != parent
        or os.listdir(parent) != [source_name]
        or not stat.S_ISDIR(source_value.st_mode)
        or (source_value.st_uid, source_value.st_gid, stat.S_IMODE(source_value.st_mode))
        != (0, 0, 0o700)
        or source_value.st_dev != parent_value.st_dev
        or os.path.realpath(source) != source
        or os.path.lexists(target)
    ):
        reject()
    entries = os.listdir(source)
    if entries not in ([], [temporary_name], [record_name]):
        reject()
    expected = expected_record(source_value)
    if entries == [record_name]:
        exact_file(final, expected)
        sync_directory(source)
    else:
        if entries == []:
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
            )
            existing = b''
        else:
            existing = exact_file(temporary, expected, True)
            descriptor = os.open(temporary, os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            os.fchmod(descriptor, 0o600)
            os.lseek(descriptor, len(existing), os.SEEK_SET)
            write_all(descriptor, expected[len(existing):])
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        exact_file(temporary, expected)
        os.rename(temporary, final)
        sync_directory(source)
        exact_file(final, expected)
    if os.listdir(source) != [record_name]:
        reject()
    os.rename(source, target)
    sync_directory(parent)
    target_value = os.lstat(target)
    if (
        os.listdir(parent) != [target_name]
        or (target_value.st_dev, target_value.st_ino) != (source_value.st_dev, source_value.st_ino)
        or os.path.realpath(target) != target
    ):
        reject()
    exact_file(f'{target}/{record_name}', expected)
except Exception:
    raise SystemExit(1)
PY
}

require_adopted_empty_checkpoint_record() {
  local root="$1"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$root" "$EMPTY_CHECKPOINT_RELEASE" "$RECOVERY_RELEASE" \
    "$EMPTY_CHECKPOINT_RECORD_NAME" <<'PY'
import os
import stat
import sys

root, predecessor_release, successor_release, record_name = sys.argv[1:]
path = f'{root}/{record_name}'

try:
    root_value = os.lstat(root)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        data = os.pread(descriptor, 4097, 0)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    lines = data.decode('ascii').splitlines()
    expected = [
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-empty-checkpoint-adoption',
        'state=adoption-prepared',
        'same_inode_target_rename_authorized=true',
        'namespace_rename_pending_at_publication=true',
        f'predecessor_recovery_release={predecessor_release}',
        f'successor_recovery_release={successor_release}',
        f'checkpoint_dev_ino={root_value.st_dev}:{root_value.st_ino}',
        f'source_namespace=.installing-{predecessor_release}',
        f'target_namespace=.installing-{successor_release}',
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
    ]
    if (
        not stat.S_ISDIR(root_value.st_mode)
        or (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode))
        != (0, 0, 0o700)
        or os.path.realpath(root) != root
        or not stat.S_ISREG(before.st_mode)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
        != (0, 0, 0o600, 1)
        or data != ('\n'.join(expected) + '\n').encode('ascii')
        or lines != expected
        or os.path.realpath(path) != path
        or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
            before.st_nlink, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
            after.st_nlink, after.st_size, after.st_mtime_ns)
    ):
        raise RuntimeError()
except Exception:
    raise SystemExit(1)
PY
}

prepare_h14_recovery_root() {
  [[ ! -L "$H14_PARENT" && -d "$H14_PARENT" &&
    "$(realpath -- "$H14_PARENT")" == "$H14_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H14_PARENT")" == 'root:root:700' ]] || return 1
  if [[ -e "$RECOVERY_ROOT" || -L "$RECOVERY_ROOT" ]]; then
    [[ ! -e "$RECOVERY_INSTALLING" && ! -L "$RECOVERY_INSTALLING" &&
      ! -L "$RECOVERY_ROOT" && -d "$RECOVERY_ROOT" &&
      "$(realpath -- "$RECOVERY_ROOT")" == "$RECOVERY_ROOT" &&
      "$(stat --format='%U:%G:%a' "$RECOVERY_ROOT")" == 'root:root:700' ]] || return 1
    H14_WORK_ROOT="$RECOVERY_ROOT"
    require_adopted_empty_checkpoint_record "$H14_WORK_ROOT" || return 1
    sync -f "$H14_PARENT" || return 1
    return 0
  fi
  [[ ! -L "$RECOVERY_INSTALLING" && -d "$RECOVERY_INSTALLING" &&
    "$(realpath -- "$RECOVERY_INSTALLING")" == "$RECOVERY_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$RECOVERY_INSTALLING")" == 'root:root:700' ]] || return 1
  H14_WORK_ROOT="$RECOVERY_INSTALLING"
  require_adopted_empty_checkpoint_record "$H14_WORK_ROOT" || return 1
  sync -f "$H14_PARENT"
}

require_h14_installer_prefix_namespace() {
  local entries entry path
  entries="$(find -P "$H14_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    path="$H14_WORK_ROOT/$entry"
    [[ ! -L "$path" && "$(realpath -- "$path")" == "$path" ]] || return 1
    case "$entry" in
      runtime-retirement-intent-v1|.runtime-retirement-intent-v1.installing|\
        runtime-retired-v1|.runtime-retired-v1.installing|\
        empty-predecessor-checkpoint-adoption-v1|\
        intent-v1|.intent-v1.installing|\
        player-stage-consumption-v1|.player-stage-consumption-v1.installing|\
        claim-stage-consumption-v1|.claim-stage-consumption-v1.installing|\
        host-retired-v1|.host-retired-v1.installing|\
        owner-runtime-restored-v1|.owner-runtime-restored-v1.installing)
        [[ -f "$path" && "$(stat --format='%u:%g:%a:%h' "$path")" == '0:0:600:1' ]] ||
          return 1
        ;;
      predecessor-helper|.predecessor-helper.installing)
        [[ -f "$path" && "$(stat --format='%u:%g:%a:%h' "$path")" == '0:0:400:1' ]] ||
          return 1
        ;;
      retired-binding-v3)
        [[ -f "$path" && "$(stat --format='%u:%g:%a:%h' "$path")" == '10001:10001:600:1' ]] ||
          return 1
        ;;
      retired-retryable-failure-v1)
        [[ -f "$path" && "$(stat --format='%u:%g:%a:%h' "$path")" == '0:10001:440:1' ]] ||
          return 1
        ;;
      quarantined-profile-v1)
        [[ -d "$path" && "$(stat --format='%u:%g:%a' "$path")" == '10001:10001:700' ]] ||
          return 1
        ;;
      *) return 1 ;;
    esac
  done <<<"$entries"
  require_adopted_empty_checkpoint_record "$H14_WORK_ROOT"
}

classify_h14_base_phase() {
  local root="$1"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' ]] || return 1
  H14_WORK_ROOT="$root"
  require_h14_installer_prefix_namespace || return 1
  H14_PREFIX_PHASE="$(env -i PATH="$SAFE_PATH" python3 -I - "$root" \
    "$EMPTY_CHECKPOINT_RECORD_NAME" <<'PY'
import os
import sys

root, adoption_name = sys.argv[1:]
entries = set(os.listdir(root))
completed = {adoption_name}


def accept(phase):
    print(phase)
    raise SystemExit(0)


if entries == completed:
    accept('adoption-only')
if entries == completed | {'.runtime-retirement-intent-v1.installing'}:
    accept('runtime-intent-prepared')
completed.add('runtime-retirement-intent-v1')
if entries == completed:
    accept('runtime-intent')

for name, has_temporary in [
    ('runtime-retired-v1', True),
    ('intent-v1', True),
    ('predecessor-helper', True),
    ('retired-binding-v3', False),
    ('player-stage-consumption-v1', True),
    ('claim-stage-consumption-v1', True),
    ('retired-retryable-failure-v1', False),
    ('quarantined-profile-v1', False),
    ('host-retired-v1', True),
    ('owner-runtime-restored-v1', True),
]:
    if has_temporary and entries == completed | {f'.{name}.installing'}:
        accept('post-retirement')
    completed.add(name)
    if entries == completed:
        if name == 'owner-runtime-restored-v1':
            accept('complete')
        accept('post-retirement')

raise SystemExit(1)
PY
  )" || return 1
  if [[ "$H14_PREFIX_PHASE" != 'adoption-only' &&
    "$H14_PREFIX_PHASE" != 'runtime-intent-prepared' ]]; then
    load_runtime_retirement_intent || return 1
  fi
}

publish_recovery_record() {
  local root="$1" name="$2" mode="$3" producer="$4" expected final temporary
  final="$root/$name"
  temporary="$root/.$name.installing"
  expected="$("$producer")" || return 1
  expected+=$'\n'
  if [[ -e "$final" || -L "$final" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" && ! -L "$final" && -f "$final" &&
      "$(realpath -- "$final")" == "$final" &&
      "$(stat --format='%U:%G:%a:%h' "$final")" == "root:root:$mode:1" ]] || return 1
    cmp -s -- "$final" <(printf '%s' "$expected") || return 1
    sync -f "$root"
    return
  fi
  env -i PATH="$SAFE_PATH" python3 -I - "$temporary" "$mode" "$expected" <<'PY' || return 1
import os
import re
import stat
import sys

path, mode_text, text = sys.argv[1:]
if re.fullmatch(r'[0-7]{3}', mode_text) is None:
    raise SystemExit(1)
try:
    data = text.encode('ascii')
except UnicodeEncodeError:
    raise SystemExit(1)
mode = int(mode_text, 8)
flags = os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW | os.O_CLOEXEC
created = False
try:
    descriptor = os.open(path, flags)
except FileNotFoundError:
    try:
        descriptor = os.open(path, flags | os.O_CREAT | os.O_EXCL, mode)
        created = True
    except OSError:
        raise SystemExit(1)
except OSError:
    raise SystemExit(1)
try:
    if created:
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, mode)
    before = os.fstat(descriptor)
    named = os.lstat(path)
    current = os.pread(descriptor, len(data) + 1, 0)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
        != (0, 0, mode, 1)
        or before.st_size > len(data)
        or len(current) != before.st_size
        or current != data[:before.st_size]
        or os.path.realpath(path) != path
    ):
        raise SystemExit(1)
    offset = before.st_size
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            raise SystemExit(1)
        offset += written
    os.fsync(descriptor)
    after = os.fstat(descriptor)
    completed = os.pread(descriptor, len(data) + 1, 0)
    if (
        (after.st_dev, after.st_ino, after.st_uid, after.st_gid,
         stat.S_IMODE(after.st_mode), after.st_nlink, after.st_size)
        != (before.st_dev, before.st_ino, 0, 0, mode, 1, len(data))
        or completed != data
    ):
        raise SystemExit(1)
finally:
    os.close(descriptor)
PY
  mv -- "$temporary" "$final" || return 1
  sync -f "$root"
}

load_runtime_retirement_intent() {
  local path="$H14_WORK_ROOT/runtime-retirement-intent-v1"
  local -a lines
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  mapfile -t lines <"$path"
  [[ "${#lines[@]}" -eq 12 && "${lines[0]}" == 'version=1' &&
    "${lines[1]}" == "recovery_release=$RECOVERY_RELEASE" &&
    "${lines[2]}" == "runtime_release=$PREDECESSOR_RELEASE" &&
    "${lines[3]}" =~ ^coordinator_container_id=(absent|[0-9a-f]{64})$ &&
    "${lines[4]}" =~ ^coordinator_contract_sha256=(absent|[0-9a-f]{64})$ &&
    "${lines[5]}" =~ ^owner_container_id=[0-9a-f]{64}$ &&
    "${lines[6]}" =~ ^owner_contract_sha256=[0-9a-f]{64}$ &&
    "${lines[7]}" == 'financial_actions_mode=dry_run' &&
    "${lines[8]}" == 'kemerbet_executor_enabled=false' &&
    "${lines[9]}" == 'kemerbet_final_action_enabled=false' &&
    "${lines[10]}" == 'transfer_enabled=false' && "${lines[11]}" == 'money_moved=false' ]] || return 1
  COORDINATOR_CONTAINER_ID="${lines[3]#coordinator_container_id=}"
  COORDINATOR_CONTRACT_SHA256="${lines[4]#coordinator_contract_sha256=}"
  OWNER_CONTAINER_ID="${lines[5]#owner_container_id=}"
  OWNER_CONTRACT_SHA256="${lines[6]#owner_contract_sha256=}"
  [[ ( "$COORDINATOR_CONTAINER_ID" == 'absent' && "$COORDINATOR_CONTRACT_SHA256" == 'absent' ) ||
    ( "$COORDINATOR_CONTAINER_ID" =~ ^[0-9a-f]{64}$ &&
      "$COORDINATOR_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ) ]]
}

prepare_or_load_runtime_retirement_intent() {
  prepare_h14_recovery_root || return 1
  require_h14_installer_prefix_namespace || return 1
  [[ -e "$H14_WORK_ROOT/runtime-retirement-intent-v1" &&
    ! -L "$H14_WORK_ROOT/runtime-retirement-intent-v1" ]] || return 1
  load_runtime_retirement_intent
}

expected_runtime_retired() {
  printf '%s\n' \
    'version=1' \
    "recovery_release=$RECOVERY_RELEASE" \
    "runtime_release=$PREDECESSOR_RELEASE" \
    "coordinator_container_id=$COORDINATOR_CONTAINER_ID" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    'coordinator_removed=true' \
    'owner_stopped=true' \
    'profile_volume_holders=none' \
    "control_volume_holder=$OWNER_CONTAINER_ID-stopped" \
    'chromium_processes=none' \
    'transfer_disabled=true' \
    'amount_entry_enabled=false' \
    'money_moved=false'
}

host_retired_prefix_exists() {
  local path="$H14_WORK_ROOT/host-retired-v1"
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    return 1
  fi
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]]
}

require_pre_retirement_intent_only() {
  local entries
  [[ "$H14_WORK_ROOT" == "$RECOVERY_INSTALLING" ]] || return 1
  entries="$(find -P "$H14_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    return 1
  case "$entries" in
    $'empty-predecessor-checkpoint-adoption-v1\nruntime-retirement-intent-v1')
      require_adopted_empty_checkpoint_record "$H14_WORK_ROOT" || return 1
      ;;
    *) return 1 ;;
  esac
  load_runtime_retirement_intent
}

retire_recovery_runtime() {
  local actual_digest coordinator_inventory owner_state profile_holders control_holders
  local running_control_holders running_profile_holders
  load_runtime_retirement_intent || return 1
  # The interrupted canonical installer already removed the exact coordinator
  # after publishing its immutable intent.  Reappearance is not repairable.
  [[ "$COORDINATOR_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] || return 1
  ! docker_local container inspect "$COORDINATOR_CONTAINER_ID" >/dev/null 2>&1 || return 1
  coordinator_inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  [[ -z "$coordinator_inventory" ]] || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control "$PREDECESSOR_RELEASE" || return 1
  actual_digest="$(container_semantic_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_SEMANTIC_CONTRACT_SHA256" ]] || return 1
  owner_state="$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Status}}')" || return 1
  case "$owner_state" in
    running) docker_local container stop --time 20 "$OWNER_CONTAINER_ID" >/dev/null || return 1 ;;
    exited) ;;
    *) return 1 ;;
  esac
  [[ "$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Status}}')" == 'exited' ]] ||
    return 1
  actual_digest="$(container_semantic_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_SEMANTIC_CONTRACT_SHA256" ]] || return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$profile_holders" && "$control_holders" == "$OWNER_CONTAINER_ID" ]] || return 1
  running_profile_holders="$(docker_local container ls --quiet \
    --filter "volume=$PROFILE_VOLUME")" || return 1
  running_control_holders="$(docker_local container ls --quiet \
    --filter "volume=$CONTROL_VOLUME")" || return 1
  [[ -z "$running_profile_holders" && -z "$running_control_holders" ]] || return 1
  require_no_host_chromium || return 1
  publish_recovery_record "$H14_WORK_ROOT" runtime-retired-v1 600 expected_runtime_retired
}

expected_owner_runtime_restored() {
  printf '%s\n' \
    'version=1' \
    "recovery_release=$RECOVERY_RELEASE" \
    "runtime_release=$PREDECESSOR_RELEASE" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    "owner_contract_sha256=$OWNER_CONTRACT_SHA256" \
    'owner_running=true' \
    'owner_healthy=true' \
    'coordinator_absent=true' \
    'transfer_disabled=true' \
    'amount_entry_enabled=false' \
    'money_moved=false'
}

restore_owner_runtime_and_finalize() {
  local actual_digest attempt control_holders coordinator_inventory expected_entries profile_holders state
  [[ "$H14_WORK_ROOT" == "$RECOVERY_INSTALLING" ]] || return 1
  load_runtime_retirement_intent || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control "$PREDECESSOR_RELEASE" || return 1
  actual_digest="$(container_semantic_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_SEMANTIC_CONTRACT_SHA256" ]] || return 1
  state="$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Status}}')" || return 1
  case "$state" in
    exited) docker_local container start "$OWNER_CONTAINER_ID" >/dev/null || return 1 ;;
    running) ;;
    *) return 1 ;;
  esac
  for attempt in $(seq 1 45); do
    state="$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Status}}')" || return 1
    if [[ "$state" == 'running' &&
      "$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Health.Status}}')" == 'healthy' ]]; then
      break
    fi
    [[ "$state" == 'running' ]] || return 1
    sleep 1
  done
  [[ "$state" == 'running' &&
    "$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Health.Status}}')" == 'healthy' ]] ||
    return 1
  actual_digest="$(container_semantic_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_SEMANTIC_CONTRACT_SHA256" ]] || return 1
  coordinator_inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$coordinator_inventory" && -z "$profile_holders" &&
    "$control_holders" == "$OWNER_CONTAINER_ID" ]] || return 1
  require_no_host_chromium || return 1
  publish_recovery_record "$H14_WORK_ROOT" owner-runtime-restored-v1 600 \
    expected_owner_runtime_restored || return 1
  require_adopted_empty_checkpoint_record "$H14_WORK_ROOT" || return 1
  expected_entries=$'claim-stage-consumption-v1\nempty-predecessor-checkpoint-adoption-v1\nhost-retired-v1\nintent-v1\nowner-runtime-restored-v1\nplayer-stage-consumption-v1\npredecessor-helper\nquarantined-profile-v1\nretired-binding-v3\nretired-retryable-failure-v1\nruntime-retired-v1\nruntime-retirement-intent-v1'
  [[ "$(find -P "$H14_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
    "$expected_entries" ]] || return 1
  [[ ! -e "$RECOVERY_ROOT" && ! -L "$RECOVERY_ROOT" ]] || return 1
  mv -- "$RECOVERY_INSTALLING" "$RECOVERY_ROOT" || return 1
  sync -f "$H14_PARENT" || return 1
  H14_WORK_ROOT="$RECOVERY_ROOT"
}

copy_helper_atomically() {
  local source="$1" source_mode="$2" digest="$3"
  if [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]; then
    require_helper_file "$source" "$digest" "$source_mode" || return 1
    env -i PATH="$SAFE_PATH" python3 -I - \
      "$source" "$INSTALLING_HELPER_PARTIAL" "$digest" "$source_mode" <<'PY' || return 1
import hashlib
import os
import re
import stat
import sys

source, partial, digest, source_mode_text = sys.argv[1:]
if re.fullmatch(r'[0-9a-f]{64}', digest) is None or re.fullmatch(r'[0-7]{3}', source_mode_text) is None:
    raise SystemExit(1)
source_mode = int(source_mode_text, 8)


def reject():
    raise SystemExit(1)


source_descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    source_before = os.fstat(source_descriptor)
    source_named = os.lstat(source)
    if (
        not stat.S_ISREG(source_before.st_mode)
        or (source_before.st_dev, source_before.st_ino) != (source_named.st_dev, source_named.st_ino)
        or (source_before.st_uid, source_before.st_gid,
            stat.S_IMODE(source_before.st_mode), source_before.st_nlink)
        != (0, 0, source_mode, 1)
        or not 0 < source_before.st_size <= 2 * 1024 * 1024
        or os.path.realpath(source) != source
    ):
        reject()
    expected = os.pread(source_descriptor, source_before.st_size + 1, 0)
    if len(expected) != source_before.st_size or hashlib.sha256(expected).hexdigest() != digest:
        reject()

    flags = os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW | os.O_CLOEXEC
    created = False
    try:
        partial_descriptor = os.open(partial, flags)
    except FileNotFoundError:
        partial_descriptor = os.open(partial, flags | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
    try:
        if created:
            os.fchown(partial_descriptor, 0, 0)
            os.fchmod(partial_descriptor, 0o600)
        before = os.fstat(partial_descriptor)
        named = os.lstat(partial)
        partial_mode = stat.S_IMODE(before.st_mode)
        current = os.pread(partial_descriptor, len(expected) + 1, 0)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, before.st_nlink) != (0, 0, 1)
            or partial_mode not in (0o600, 0o755)
            or before.st_size > len(expected)
            or len(current) != before.st_size
            or current != expected[:before.st_size]
            or (partial_mode == 0o755 and before.st_size != len(expected))
            or os.path.realpath(partial) != partial
        ):
            reject()
        offset = before.st_size
        while offset < len(expected):
            written = os.write(partial_descriptor, expected[offset:])
            if written <= 0:
                reject()
            offset += written
        os.fsync(partial_descriptor)
        after = os.fstat(partial_descriptor)
        completed = os.pread(partial_descriptor, len(expected) + 1, 0)
        if (
            (after.st_dev, after.st_ino, after.st_uid, after.st_gid,
             stat.S_IMODE(after.st_mode), after.st_nlink, after.st_size)
            != (before.st_dev, before.st_ino, 0, 0, partial_mode, 1, len(expected))
            or completed != expected
        ):
            reject()
    finally:
        os.close(partial_descriptor)
    source_after = os.fstat(source_descriptor)
    if (
        source_after.st_dev,
        source_after.st_ino,
        source_after.st_mode,
        source_after.st_uid,
        source_after.st_gid,
        source_after.st_nlink,
        source_after.st_size,
        source_after.st_mtime_ns,
    ) != (
        source_before.st_dev,
        source_before.st_ino,
        source_before.st_mode,
        source_before.st_uid,
        source_before.st_gid,
        source_before.st_nlink,
        source_before.st_size,
        source_before.st_mtime_ns,
    ):
        reject()
finally:
    os.close(source_descriptor)
PY
    chmod 0755 "$INSTALLING_HELPER_PARTIAL" || return 1
    sync -f "$INSTALLING_HELPER_PARTIAL" || return 1
    mv -- "$INSTALLING_HELPER_PARTIAL" "$INSTALLING_HELPER" || return 1
    sync -f /usr/local/sbin || return 1
  fi
  [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
  require_helper_file "$INSTALLING_HELPER" "$digest" 755
}

run_forward_only_recovery() {
  local profile_mountpoint="$1" control_mountpoint="$2"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$H14_PARENT" "$RECOVERY_RELEASE" "$TARGET" "$PREDECESSOR_HELPER_SHA256" \
    "$SUCCESSOR_HELPER_SHA256" "$AUTHORIZATION_SHA256" "$EMPTY_CHECKPOINT_RELEASE" \
    "$EMPTY_CHECKPOINT_RECORD_NAME" "$profile_mountpoint" "$control_mountpoint" \
    "$SOURCE_BINDING" "$OWNER_RECEIPT_ROOT" \
    "$PLAYER_STAGE_NAME" "$CLAIM_STAGE_NAME" "$FAILED_MARKER_NAME" \
    "$TERMINAL_MARKER_NAME" <<'PY'
import hashlib
import os
import re
import stat
import sys

(
    parent,
    release,
    helper,
    predecessor_sha,
    successor_sha,
    authorization_sha,
    empty_checkpoint_release,
    empty_checkpoint_record_name,
    profile_root,
    control_root,
    source_binding,
    owner_root,
    player_name,
    claim_name,
    failed_name,
    terminal_name,
) = sys.argv[1:]

RELEASE = re.compile(r'[0-9a-f]{40}')
SHA = re.compile(r'[0-9a-f]{64}')
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
PROFILE_UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CONTAINER_ID = re.compile(r'[0-9a-f]{64}')
V3 = re.compile(
    rb'([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) '
    rb'hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'hmac-sha256-agent-profile-pin-v3:\2\n'
)
CRASH_MARKER = b'fetanagent-kemerbet-session-active-v1\n'
PREDECESSOR_RUNTIME_RELEASE = '306818ca812bd2abce8479396c4eea8383ea00f9'


def reject():
    raise RuntimeError()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exact_directory(path, owner=None, mode=None):
    value = os.lstat(path)
    if not stat.S_ISDIR(value.st_mode) or os.path.realpath(path) != path:
        reject()
    if owner is not None and (value.st_uid, value.st_gid) != owner:
        reject()
    if mode is not None and stat.S_IMODE(value.st_mode) != mode:
        reject()
    return value


def exact_file(path, owner, mode, maximum, exact_size=None):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (*owner, mode, 1)
            or before.st_size > maximum
            or (exact_size is not None and before.st_size != exact_size)
            or os.path.realpath(path) != path
        ):
            reject()
        data = os.pread(descriptor, maximum + 1, 0)
        after = os.fstat(descriptor)
        if len(data) != before.st_size or (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_uid,
            before.st_gid,
            before.st_nlink,
            before.st_size,
            before.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_uid,
            after.st_gid,
            after.st_nlink,
            after.st_size,
            after.st_mtime_ns,
        ):
            reject()
        return data, before
    finally:
        os.close(descriptor)


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def create_exact(path, data, uid, gid, mode):
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        mode,
    )
    try:
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
        write_all(descriptor, data)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def complete_empty_creation_metadata(path, uid, gid, mode):
    expected_created_mode = mode & ~0o077
    descriptor = os.open(
        path,
        os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        identity = (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode))
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_nlink != 1
            or before.st_size != 0
            or identity not in {
                (0, 0, expected_created_mode),
                (uid, gid, expected_created_mode),
            }
            or os.path.realpath(path) != path
        ):
            reject()
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
        after = os.fstat(descriptor)
        if (
            (after.st_dev, after.st_ino, after.st_uid, after.st_gid,
             stat.S_IMODE(after.st_mode), after.st_nlink, after.st_size)
            != (before.st_dev, before.st_ino, uid, gid, mode, 1, 0)
        ):
            reject()
    finally:
        os.close(descriptor)


def append_complete_exact(path, data, uid, gid, mode):
    if not os.path.lexists(path):
        create_exact(path, data, uid, gid, mode)
        return
    initial = os.lstat(path)
    if (initial.st_uid, initial.st_gid, stat.S_IMODE(initial.st_mode)) != (uid, gid, mode):
        complete_empty_creation_metadata(path, uid, gid, mode)
    current, before = exact_file(path, (uid, gid), mode, len(data))
    if current != data[:len(current)]:
        reject()
    descriptor = os.open(
        path,
        os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        opened = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
            or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or (opened.st_uid, opened.st_gid, stat.S_IMODE(opened.st_mode), opened.st_nlink)
            != (uid, gid, mode, 1)
            or opened.st_size != len(current)
        ):
            reject()
        write_all(descriptor, data[len(current):])
        os.fsync(descriptor)
        after = os.fstat(descriptor)
        completed = os.pread(descriptor, len(data) + 1, 0)
        if (
            (after.st_dev, after.st_ino, after.st_uid, after.st_gid,
             stat.S_IMODE(after.st_mode), after.st_nlink, after.st_size)
            != (before.st_dev, before.st_ino, uid, gid, mode, 1, len(data))
            or completed != data
        ):
            reject()
    finally:
        os.close(descriptor)


def publish_record(root, name, data, uid=0, gid=0, mode=0o600):
    final = f'{root}/{name}'
    temporary = f'{root}/.{name}.installing'
    if os.path.lexists(final):
        if os.path.lexists(temporary):
            reject()
        current, _ = exact_file(final, (uid, gid), mode, len(data), len(data))
        if current != data:
            reject()
        sync_directory(root)
        return
    append_complete_exact(temporary, data, uid, gid, mode)
    current, _ = exact_file(temporary, (uid, gid), mode, len(data), len(data))
    if current != data:
        reject()
    os.rename(temporary, final)
    sync_directory(root)


def exact_ascii_record(path, owner, mode, count):
    data, value = exact_file(path, owner, mode, 8192)
    lines = data.decode('ascii').splitlines()
    if len(lines) != count or data != ('\n'.join(lines) + '\n').encode('ascii'):
        reject()
    return lines, data, value


def validate_profile_tree(path, expected_dev):
    root_value = exact_directory(path, (10001, 10001), 0o700)
    if root_value.st_dev != expected_dev:
        reject()
    marker = f'{path}/.fetanagent-unclean-session-generation-v1'
    marker_data, _ = exact_file(marker, (10001, 10001), 0o600, len(CRASH_MARKER), len(CRASH_MARKER))
    if marker_data != CRASH_MARKER:
        reject()
    for current, directories, files in os.walk(path, topdown=True, followlinks=False):
        for name in directories + files:
            candidate = f'{current}/{name}'
            value = os.lstat(candidate)
            if value.st_dev != expected_dev or (value.st_uid, value.st_gid) != (10001, 10001):
                reject()
            if stat.S_ISLNK(value.st_mode):
                reject()
            if stat.S_ISDIR(value.st_mode):
                if stat.S_IMODE(value.st_mode) & 0o022:
                    reject()
            elif stat.S_ISREG(value.st_mode):
                if value.st_nlink != 1 or stat.S_IMODE(value.st_mode) & 0o022:
                    reject()
            else:
                reject()


def rename_file(source, target, owner, mode, expected_data, expected_dev_ino, expected_sha=None):
    target_present = os.path.lexists(target)
    if target_present:
        if os.path.lexists(source):
            reject()
        data, value = exact_file(target, owner, mode, max(8192, len(expected_data)), len(expected_data))
    else:
        data, value = exact_file(source, owner, mode, max(8192, len(expected_data)), len(expected_data))
        if value.st_dev != os.lstat(os.path.dirname(target)).st_dev:
            reject()
        os.rename(source, target)
        sync_directory(os.path.dirname(source))
        sync_directory(os.path.dirname(target))
        moved = os.lstat(target)
        if (moved.st_dev, moved.st_ino) != (value.st_dev, value.st_ino):
            reject()
    if data != expected_data or f'{value.st_dev}:{value.st_ino}' != expected_dev_ino:
        reject()
    if expected_sha is not None and hashlib.sha256(data).hexdigest() != expected_sha:
        reject()
    if target_present:
        sync_directory(os.path.dirname(source))
        sync_directory(os.path.dirname(target))


def attest_stage(
    source,
    owner,
    mode,
    expected_dev_ino,
    expected_data=None,
    expected_sha=None,
    player_stage=False,
):
    data, value = exact_file(source, owner, mode, 1024)
    if f'{value.st_dev}:{value.st_ino}' != expected_dev_ino:
        reject()
    if expected_data is not None and data != expected_data:
        reject()
    if expected_sha is not None and hashlib.sha256(data).hexdigest() != expected_sha:
        reject()
    if player_stage:
        player_lines = data[:-1].split(b'\n') if data.endswith(b'\n') else []
        if (
            len(player_lines) != 5
            or len(set(player_lines)) != 5
            or any(PLAYER_ID.fullmatch(line) is None for line in player_lines)
        ):
            reject()


def consume_stage(
    source,
    owner,
    mode,
    expected_dev_ino,
    authorization_path,
    authorization_data,
    expected_data=None,
    expected_sha=None,
    player_stage=False,
):
    authorization, _ = exact_file(
        authorization_path,
        (0, 0),
        0o600,
        len(authorization_data),
        len(authorization_data),
    )
    if authorization != authorization_data:
        reject()
    if not os.path.lexists(source):
        sync_directory(os.path.dirname(source))
        return
    parent_path = os.path.dirname(source)
    basename = os.path.basename(source)
    parent_descriptor = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    descriptor = -1
    try:
        descriptor = os.open(
            basename,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=parent_descriptor,
        )
        before = os.fstat(descriptor)
        named = os.stat(basename, dir_fd=parent_descriptor, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (*owner, mode, 1)
            or f'{before.st_dev}:{before.st_ino}' != expected_dev_ino
            or before.st_size > 1024
        ):
            reject()
        data = os.pread(descriptor, 1025, 0)
        after = os.fstat(descriptor)
        if len(data) != before.st_size or (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_uid,
            before.st_gid,
            before.st_nlink,
            before.st_size,
            before.st_mtime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_uid,
            after.st_gid,
            after.st_nlink,
            after.st_size,
            after.st_mtime_ns,
        ):
            reject()
        if expected_data is not None and data != expected_data:
            reject()
        if expected_sha is not None and hashlib.sha256(data).hexdigest() != expected_sha:
            reject()
        if player_stage:
            player_lines = data[:-1].split(b'\n') if data.endswith(b'\n') else []
            if (
                len(player_lines) != 5
                or len(set(player_lines)) != 5
                or any(PLAYER_ID.fullmatch(line) is None for line in player_lines)
            ):
                reject()
        os.unlink(basename, dir_fd=parent_descriptor)
        if os.fstat(descriptor).st_nlink != 0:
            reject()
        os.fsync(parent_descriptor)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(parent_descriptor)


def rename_profile(source, target, profile_id, expected_dev_ino):
    target_present = os.path.lexists(target)
    if target_present:
        if os.path.lexists(source):
            reject()
        value = os.lstat(target)
    else:
        value = os.lstat(source)
        if value.st_dev != os.lstat(os.path.dirname(target)).st_dev:
            reject()
        validate_profile_tree(source, value.st_dev)
        os.rename(source, target)
        sync_directory(os.path.dirname(source))
        sync_directory(os.path.dirname(target))
        moved = os.lstat(target)
        if (moved.st_dev, moved.st_ino) != (value.st_dev, value.st_ino):
            reject()
    if f'{value.st_dev}:{value.st_ino}' != expected_dev_ino:
        reject()
    validate_profile_tree(target, value.st_dev)
    if target_present:
        sync_directory(os.path.dirname(source))
        sync_directory(os.path.dirname(target))


try:
    if (
        RELEASE.fullmatch(release) is None
        or RELEASE.fullmatch(empty_checkpoint_release) is None
        or release == empty_checkpoint_release
        or SHA.fullmatch(authorization_sha) is None
    ):
        reject()
    exact_directory(profile_root)
    exact_directory(control_root)
    exact_directory(owner_root, (0, 0), 0o755)
    parent_value = exact_directory(parent, (0, 0), 0o700)
    installing = f'{parent}/.installing-{release}'
    final_root = f'{parent}/{release}'
    parent_entries = set(os.listdir(parent))
    if parent_entries not in ({f'.installing-{release}'}, {release}):
        reject()
    if os.path.lexists(final_root):
        if os.path.lexists(installing):
            reject()
        root = final_root
        exact_directory(root, (0, 0), 0o700)
    else:
        if not os.path.lexists(installing):
            reject()
        root = installing
        exact_directory(root, (0, 0), 0o700)
    root_value = os.lstat(root)
    if root_value.st_dev != parent_value.st_dev:
        reject()

    adoption_path = f'{root}/{empty_checkpoint_record_name}'
    adoption, _, _ = exact_ascii_record(adoption_path, (0, 0), 0o600, 20)
    if adoption != [
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-empty-checkpoint-adoption',
        'state=adoption-prepared',
        'same_inode_target_rename_authorized=true',
        'namespace_rename_pending_at_publication=true',
        f'predecessor_recovery_release={empty_checkpoint_release}',
        f'successor_recovery_release={release}',
        f'checkpoint_dev_ino={root_value.st_dev}:{root_value.st_ino}',
        f'source_namespace=.installing-{empty_checkpoint_release}',
        f'target_namespace=.installing-{release}',
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
    ]:
        reject()

    allowed_root_entries = {
        empty_checkpoint_record_name,
        'runtime-retirement-intent-v1',
        'runtime-retired-v1',
        'intent-v1',
        '.intent-v1.installing',
        'predecessor-helper',
        '.predecessor-helper.installing',
        'player-stage-consumption-v1',
        '.player-stage-consumption-v1.installing',
        'claim-stage-consumption-v1',
        '.claim-stage-consumption-v1.installing',
        'quarantined-profile-v1',
        'retired-binding-v3',
        'retired-retryable-failure-v1',
        'host-retired-v1',
        '.host-retired-v1.installing',
        'owner-runtime-restored-v1',
        '.owner-runtime-restored-v1.installing',
    }
    if not set(os.listdir(root)).issubset(allowed_root_entries):
        reject()

    runtime_intent, _, _ = exact_ascii_record(
        f'{root}/runtime-retirement-intent-v1', (0, 0), 0o600, 12
    )
    if (
        runtime_intent[0] != 'version=1'
        or runtime_intent[1] != f'recovery_release={release}'
        or runtime_intent[2] != f'runtime_release={PREDECESSOR_RUNTIME_RELEASE}'
        or re.fullmatch(r'coordinator_container_id=(absent|[0-9a-f]{64})', runtime_intent[3]) is None
        or re.fullmatch(r'coordinator_contract_sha256=(absent|[0-9a-f]{64})', runtime_intent[4]) is None
        or re.fullmatch(r'owner_container_id=[0-9a-f]{64}', runtime_intent[5]) is None
        or re.fullmatch(r'owner_contract_sha256=[0-9a-f]{64}', runtime_intent[6]) is None
        or runtime_intent[7:] != [
            'financial_actions_mode=dry_run',
            'kemerbet_executor_enabled=false',
            'kemerbet_final_action_enabled=false',
            'transfer_enabled=false',
            'money_moved=false',
        ]
        or (runtime_intent[3].endswith('=absent')) != (runtime_intent[4].endswith('=absent'))
    ):
        reject()
    coordinator_id = runtime_intent[3].split('=', 1)[1]
    owner_container_id = runtime_intent[5].split('=', 1)[1]
    runtime_retired, _, _ = exact_ascii_record(
        f'{root}/runtime-retired-v1', (0, 0), 0o600, 13
    )
    if runtime_retired != [
        'version=1',
        f'recovery_release={release}',
        f'runtime_release={PREDECESSOR_RUNTIME_RELEASE}',
        f'coordinator_container_id={coordinator_id}',
        f'owner_container_id={owner_container_id}',
        'coordinator_removed=true',
        'owner_stopped=true',
        'profile_volume_holders=none',
        f'control_volume_holder={owner_container_id}-stopped',
        'chromium_processes=none',
        'transfer_disabled=true',
        'amount_entry_enabled=false',
        'money_moved=false',
    ]:
        reject()

    intent_path = f'{root}/intent-v1'
    intent_temporary = f'{root}/.intent-v1.installing'
    if os.path.lexists(intent_path) and os.path.lexists(intent_temporary):
        reject()
    if not os.path.lexists(intent_path):
        profile_entries = os.listdir(profile_root)
        control_entries = set(os.listdir(control_root))
        owner_entries = set(os.listdir(owner_root))
        binding_parent = os.path.dirname(source_binding)
        if (
            len(profile_entries) != 1
            or PROFILE_UUID.fullmatch(profile_entries[0]) is None
            or control_entries != {player_name, claim_name}
            or owner_entries != {failed_name}
            or os.listdir(binding_parent) != [os.path.basename(source_binding)]
        ):
            reject()
        old_profile = profile_entries[0]
        profile_path = f'{profile_root}/{old_profile}'
        profile_value = os.lstat(profile_path)
        validate_profile_tree(profile_path, profile_value.st_dev)
        binding, binding_value = exact_file(source_binding, (10001, 10001), 0o600, 230, 230)
        matched = V3.fullmatch(binding)
        if matched is None or matched.group(1).decode('ascii') != old_profile:
            reject()
        player, player_value = exact_file(f'{control_root}/{player_name}', (10001, 10001), 0o400, 1024)
        claim, claim_value = exact_file(f'{control_root}/{claim_name}', (10001, 10001), 0o400, 37, 37)
        failed, _ = exact_file(f'{owner_root}/{failed_name}', (0, 10001), 0o440, 37, 37)
        player_lines = player[:-1].split(b'\n') if player.endswith(b'\n') else []
        old_claim = claim[:-1].decode('ascii') if claim.endswith(b'\n') else ''
        if (
            len(player_lines) != 5
            or len(set(player_lines)) != 5
            or any(PLAYER_ID.fullmatch(line) is None for line in player_lines)
            or UUID.fullmatch(old_claim) is None
            or failed != claim
            or any(value.st_dev != os.lstat(root).st_dev for value in (
                profile_value,
                binding_value,
                player_value,
                claim_value,
            ))
        ):
            reject()
        intent_lines = [
            'contract=fetanagent-kemerbet-quarantine-recovery-v14',
            'state=authorized',
            f'recovery_release={release}',
            'predecessor_release=306818ca812bd2abce8479396c4eea8383ea00f9',
            f'predecessor_helper_sha256={predecessor_sha}',
            f'successor_helper_sha256={successor_sha}',
            f'authorization_sha256={authorization_sha}',
            f'old_claim_id={old_claim}',
            f'old_profile_id={old_profile}',
            f'old_binding_sha256={hashlib.sha256(binding).hexdigest()}',
            f'old_player_ids_sha256={hashlib.sha256(player).hexdigest()}',
            f'binding_dev_ino={binding_value.st_dev}:{binding_value.st_ino}',
            f'player_stage_dev_ino={player_value.st_dev}:{player_value.st_ino}',
            f'claim_stage_dev_ino={claim_value.st_dev}:{claim_value.st_ino}',
            f'profile_dev_ino={profile_value.st_dev}:{profile_value.st_ino}',
            'financial_actions_mode=dry_run',
            'kemerbet_executor_enabled=false',
            'kemerbet_final_action_enabled=false',
            'transfer_enabled=false',
            'amount_entry_enabled=false',
            'lookup_authorized=false',
            'recheck_authorized=false',
        ]
        intent_data = ('\n'.join(intent_lines) + '\n').encode('ascii')
        publish_record(root, 'intent-v1', intent_data)

    intent, intent_data, _ = exact_ascii_record(intent_path, (0, 0), 0o600, 22)
    if (
        intent[0:7] != [
            'contract=fetanagent-kemerbet-quarantine-recovery-v14',
            'state=authorized',
            f'recovery_release={release}',
            'predecessor_release=306818ca812bd2abce8479396c4eea8383ea00f9',
            f'predecessor_helper_sha256={predecessor_sha}',
            f'successor_helper_sha256={successor_sha}',
            f'authorization_sha256={authorization_sha}',
        ]
        or intent[15:] != [
            'financial_actions_mode=dry_run',
            'kemerbet_executor_enabled=false',
            'kemerbet_final_action_enabled=false',
            'transfer_enabled=false',
            'amount_entry_enabled=false',
            'lookup_authorized=false',
            'recheck_authorized=false',
        ]
    ):
        reject()
    values = dict(line.split('=', 1) for line in intent)
    old_claim = values['old_claim_id']
    old_profile = values['old_profile_id']
    if UUID.fullmatch(old_claim) is None or PROFILE_UUID.fullmatch(old_profile) is None:
        reject()

    archive_data, _ = exact_file(helper, (0, 0), 0o755, 2 * 1024 * 1024)
    if hashlib.sha256(archive_data).hexdigest() not in (predecessor_sha, successor_sha):
        reject()
    archive_path = f'{root}/predecessor-helper'
    if not os.path.lexists(archive_path):
        if hashlib.sha256(archive_data).hexdigest() != predecessor_sha:
            reject()
        publish_record(root, 'predecessor-helper', archive_data, 0, 0, 0o400)
    archived, _ = exact_file(archive_path, (0, 0), 0o400, 2 * 1024 * 1024)
    if hashlib.sha256(archived).hexdigest() != predecessor_sha:
        reject()

    retired_binding = f'{root}/retired-binding-v3'
    binding_path = retired_binding if os.path.lexists(retired_binding) else source_binding
    binding, _ = exact_file(binding_path, (10001, 10001), 0o600, 230, 230)
    if V3.fullmatch(binding) is None or hashlib.sha256(binding).hexdigest() != values['old_binding_sha256']:
        reject()
    rename_file(
        source_binding,
        retired_binding,
        (10001, 10001),
        0o600,
        binding,
        values['binding_dev_ino'],
        values['old_binding_sha256'],
    )

    player_consumption_data = (
        '\n'.join([
            'version=1',
            'stage=player-ids',
            f'source_dev_ino={values["player_stage_dev_ino"]}',
            f'source_sha256={values["old_player_ids_sha256"]}',
            'raw_player_ids_preserved=false',
        ]) + '\n'
    ).encode('ascii')
    player_consumption_path = f'{root}/player-stage-consumption-v1'
    if not os.path.lexists(player_consumption_path):
        attest_stage(
            f'{control_root}/{player_name}',
            (10001, 10001),
            0o400,
            values['player_stage_dev_ino'],
            expected_sha=values['old_player_ids_sha256'],
            player_stage=True,
        )
    publish_record(root, 'player-stage-consumption-v1', player_consumption_data)
    consume_stage(
        f'{control_root}/{player_name}',
        (10001, 10001),
        0o400,
        values['player_stage_dev_ino'],
        player_consumption_path,
        player_consumption_data,
        expected_sha=values['old_player_ids_sha256'],
        player_stage=True,
    )
    claim_data = (old_claim + '\n').encode('ascii')
    claim_sha = hashlib.sha256(claim_data).hexdigest()
    claim_consumption_data = (
        '\n'.join([
            'version=1',
            'stage=claim',
            f'claim_id={old_claim}',
            f'source_dev_ino={values["claim_stage_dev_ino"]}',
            f'source_sha256={claim_sha}',
            'raw_stage_preserved=false',
        ]) + '\n'
    ).encode('ascii')
    claim_consumption_path = f'{root}/claim-stage-consumption-v1'
    if not os.path.lexists(claim_consumption_path):
        attest_stage(
            f'{control_root}/{claim_name}',
            (10001, 10001),
            0o400,
            values['claim_stage_dev_ino'],
            expected_data=claim_data,
        )
    publish_record(root, 'claim-stage-consumption-v1', claim_consumption_data)
    consume_stage(
        f'{control_root}/{claim_name}',
        (10001, 10001),
        0o400,
        values['claim_stage_dev_ino'],
        claim_consumption_path,
        claim_consumption_data,
        expected_data=claim_data,
    )
    failed_source = f'{owner_root}/{failed_name}'
    failed_target = f'{root}/retired-retryable-failure-v1'
    failed_path = failed_target if os.path.lexists(failed_target) else failed_source
    _, failed_value = exact_file(failed_path, (0, 10001), 0o440, 37, 37)
    rename_file(
        failed_source,
        failed_target,
        (0, 10001),
        0o440,
        claim_data,
        f'{failed_value.st_dev}:{failed_value.st_ino}',
    )
    rename_profile(
        f'{profile_root}/{old_profile}',
        f'{root}/quarantined-profile-v1',
        old_profile,
        values['profile_dev_ino'],
    )
    if (
        os.listdir(profile_root)
        or os.listdir(control_root)
        or os.listdir(os.path.dirname(source_binding))
    ):
        reject()
    owner_entries = set(os.listdir(owner_root))
    terminal_temporary = f'.{terminal_name}.installing'
    if owner_entries not in (set(), {terminal_temporary}, {terminal_name}):
        reject()

    host_lines = [
        'version=1',
        f'recovery_release={release}',
        f'old_claim_id={old_claim}',
        f'old_profile_id={old_profile}',
        f'old_binding_sha256={values["old_binding_sha256"]}',
        f'old_player_ids_sha256={values["old_player_ids_sha256"]}',
        f'intent_sha256={hashlib.sha256(intent_data).hexdigest()}',
        'transfer_disabled=true',
        'amount_entry_enabled=false',
        'money_moved=false',
    ]
    publish_record(root, 'host-retired-v1', ('\n'.join(host_lines) + '\n').encode('ascii'))
    publish_record(owner_root, terminal_name, claim_data, 0, 10001, 0o440)

    expected_entries = {
        'claim-stage-consumption-v1',
        empty_checkpoint_record_name,
        'host-retired-v1',
        'intent-v1',
        'player-stage-consumption-v1',
        'predecessor-helper',
        'quarantined-profile-v1',
        'retired-binding-v3',
        'retired-retryable-failure-v1',
        'runtime-retired-v1',
        'runtime-retirement-intent-v1',
    }
    owner_restored_lines = [
        'version=1',
        f'recovery_release={release}',
        f'runtime_release={PREDECESSOR_RUNTIME_RELEASE}',
        f'owner_container_id={owner_container_id}',
        f'owner_contract_sha256={runtime_intent[6].split("=", 1)[1]}',
        'owner_running=true',
        'owner_healthy=true',
        'coordinator_absent=true',
        'transfer_disabled=true',
        'amount_entry_enabled=false',
        'money_moved=false',
    ]
    owner_restored_data = ('\n'.join(owner_restored_lines) + '\n').encode('ascii')
    if root == installing:
        owner_restored_path = f'{root}/owner-runtime-restored-v1'
        owner_restored_temporary = f'{root}/.owner-runtime-restored-v1.installing'
        if os.path.lexists(owner_restored_path) and os.path.lexists(owner_restored_temporary):
            reject()
        owner_restore_entries = set()
        if os.path.lexists(owner_restored_temporary):
            owner_restored_prefix, _ = exact_file(
                owner_restored_temporary,
                (0, 0),
                0o600,
                len(owner_restored_data),
            )
            if owner_restored_prefix != owner_restored_data[:len(owner_restored_prefix)]:
                reject()
            owner_restore_entries.add('.owner-runtime-restored-v1.installing')
        elif os.path.lexists(owner_restored_path):
            owner_restored, _, _ = exact_ascii_record(
                owner_restored_path, (0, 0), 0o600, 11
            )
            if owner_restored != owner_restored_lines:
                reject()
            owner_restore_entries.add('owner-runtime-restored-v1')
        if set(os.listdir(root)) != expected_entries | owner_restore_entries or set(os.listdir(owner_root)) != {terminal_name}:
            reject()
        if os.path.lexists(final_root) or set(os.listdir(parent)) != {f'.installing-{release}'}:
            reject()
    else:
        if set(os.listdir(root)) != expected_entries | {'owner-runtime-restored-v1'} or set(os.listdir(owner_root)) != {terminal_name}:
            reject()
        owner_restored, _, _ = exact_ascii_record(
            f'{root}/owner-runtime-restored-v1', (0, 0), 0o600, 11
        )
        if owner_restored != owner_restored_lines:
            reject()
        expected_entries.add('owner-runtime-restored-v1')
        if set(os.listdir(parent)) != {release} or set(os.listdir(root)) != expected_entries:
            reject()
except Exception:
    raise SystemExit(1)
PY
}

container_full_ids_for_service() {
  local service="$1" container_id full_id inventory
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter "label=com.docker.compose.service=$service")" || return 1
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    full_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" || return 1
    [[ "$full_id" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$full_id"
  done <<<"$inventory" | LC_ALL=C sort
}

set_h14_current_root() {
  local children
  [[ ! -L "$H14_PARENT" && -d "$H14_PARENT" &&
    "$(realpath -- "$H14_PARENT")" == "$H14_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H14_PARENT")" == 'root:root:700' ]] || return 1
  children="$(find -P "$H14_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  case "$children" in
    ".installing-$RECOVERY_RELEASE")
      h14_state='interrupted'
      H14_WORK_ROOT="$RECOVERY_INSTALLING"
      ;;
    "$RECOVERY_RELEASE")
      h14_state='retired'
      H14_WORK_ROOT="$RECOVERY_ROOT"
      ;;
    *) return 1 ;;
  esac
  [[ ! -L "$H14_WORK_ROOT" && -d "$H14_WORK_ROOT" &&
    "$(realpath -- "$H14_WORK_ROOT")" == "$H14_WORK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$H14_WORK_ROOT")" == 'root:root:700' ]]
}

require_no_helper_installer_residue() {
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]
}

require_resumable_helper_installation_prefix() {
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 || return 1
  if require_no_helper_installer_residue; then
    return 0
  fi
  if [[ -e "$INSTALLING_HELPER" || -L "$INSTALLING_HELPER" ]]; then
    [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
      return 1
    require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755
    return
  fi
  [[ -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
    return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$STAGED_HELPER" "$INSTALLING_HELPER_PARTIAL" "$SUCCESSOR_HELPER_SHA256" <<'PY'
import hashlib
import os
import re
import stat
import sys

source, partial, digest = sys.argv[1:]
if re.fullmatch(r'[0-9a-f]{64}', digest) is None:
    raise SystemExit(1)


def exact_open(path, allowed_modes, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    value = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISREG(value.st_mode)
        or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
        or (value.st_uid, value.st_gid, value.st_nlink) != (0, 0, 1)
        or stat.S_IMODE(value.st_mode) not in allowed_modes
        or not 0 <= value.st_size <= maximum
        or os.path.realpath(path) != path
    ):
        os.close(descriptor)
        raise SystemExit(1)
    return descriptor, value


source_descriptor, source_value = exact_open(source, {0o600}, 2 * 1024 * 1024)
try:
    if source_value.st_size <= 0:
        raise SystemExit(1)
    expected = os.pread(source_descriptor, source_value.st_size + 1, 0)
    if len(expected) != source_value.st_size or hashlib.sha256(expected).hexdigest() != digest:
        raise SystemExit(1)
    partial_descriptor, partial_value = exact_open(partial, {0o600, 0o755}, len(expected))
    try:
        actual = os.pread(partial_descriptor, partial_value.st_size + 1, 0)
        if actual != expected[:partial_value.st_size]:
            raise SystemExit(1)
        if stat.S_IMODE(partial_value.st_mode) == 0o755 and actual != expected:
            raise SystemExit(1)
    finally:
        os.close(partial_descriptor)
finally:
    os.close(source_descriptor)
PY
}

require_exact_initial_live_prefix() {
  local coordinator_inventory control_holders entries owner_inventory owner_state profile_holders
  set_h14_current_root || return 1
  [[ "$h14_state" == 'interrupted' ]] || return 1
  entries="$(find -P "$H14_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' |
    LC_ALL=C sort)" || return 1
  [[ "$entries" == $'empty-predecessor-checkpoint-adoption-v1\nruntime-retirement-intent-v1' ]] ||
    return 1
  require_adopted_empty_checkpoint_record "$H14_WORK_ROOT" || return 1
  load_runtime_retirement_intent || return 1
  [[ "$COORDINATOR_CONTAINER_ID" =~ ^[0-9a-f]{64}$ &&
    "$COORDINATOR_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$OWNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ &&
    "$OWNER_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  require_disabled_grant_only || return 1
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  require_no_helper_installer_residue || return 1
  run_helper_direct verify "$PREDECESSOR_HELPER_SHA256" >/dev/null || return 1
  coordinator_inventory="$(container_full_ids_for_service kemerbet-session-provision)" ||
    return 1
  [[ -z "$coordinator_inventory" ]] || return 1
  ! docker_local container inspect "$COORDINATOR_CONTAINER_ID" >/dev/null 2>&1 || return 1
  owner_inventory="$(container_full_ids_for_service owner-control)" || return 1
  [[ "$owner_inventory" == "$OWNER_CONTAINER_ID" ]] || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control \
    "$PREDECESSOR_RELEASE" || return 1
  owner_state="$(docker_local container inspect "$OWNER_CONTAINER_ID" \
    --format '{{.State.Status}}')" || return 1
  [[ "$owner_state" == 'running' &&
    "$(docker_local container inspect "$OWNER_CONTAINER_ID" \
      --format '{{.State.Health.Status}}')" == 'healthy' ]] || return 1
  OWNER_SEMANTIC_CONTRACT_SHA256="$(
    container_semantic_contract_digest "$OWNER_CONTAINER_ID"
  )" || return 1
  [[ "$OWNER_SEMANTIC_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$profile_holders" && "$control_holders" == "$OWNER_CONTAINER_ID" ]] || return 1
  require_no_host_chromium || return 1
  require_financial_gates_disabled || return 1
  H14_NAMESPACE_DEVICE="$(stat --format='%d' "$H14_WORK_ROOT")" || return 1
  H14_NAMESPACE_INODE="$(stat --format='%i' "$H14_WORK_ROOT")" || return 1
  H14_ADOPTION_DEVICE="$(stat --format='%d' \
    "$H14_WORK_ROOT/$EMPTY_CHECKPOINT_RECORD_NAME")" || return 1
  H14_ADOPTION_INODE="$(stat --format='%i' \
    "$H14_WORK_ROOT/$EMPTY_CHECKPOINT_RECORD_NAME")" || return 1
  H14_ADOPTION_SHA256="$(sha256sum -- \
    "$H14_WORK_ROOT/$EMPTY_CHECKPOINT_RECORD_NAME" | awk '{print $1}')" || return 1
  H14_RUNTIME_INTENT_DEVICE="$(stat --format='%d' \
    "$H14_WORK_ROOT/runtime-retirement-intent-v1")" || return 1
  H14_RUNTIME_INTENT_INODE="$(stat --format='%i' \
    "$H14_WORK_ROOT/runtime-retirement-intent-v1")" || return 1
  H14_RUNTIME_INTENT_SHA256="$(sha256sum -- \
    "$H14_WORK_ROOT/runtime-retirement-intent-v1" | awk '{print $1}')" || return 1
  [[ "$H14_NAMESPACE_DEVICE" =~ ^[0-9]+$ && "$H14_NAMESPACE_INODE" =~ ^[0-9]+$ &&
    "$H14_ADOPTION_DEVICE" =~ ^[0-9]+$ && "$H14_ADOPTION_INODE" =~ ^[0-9]+$ &&
    "$H14_ADOPTION_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$H14_RUNTIME_INTENT_DEVICE" =~ ^[0-9]+$ &&
    "$H14_RUNTIME_INTENT_INODE" =~ ^[0-9]+$ &&
    "$H14_RUNTIME_INTENT_SHA256" =~ ^[0-9a-f]{64}$ ]]
}

discover_repair_ledger() {
  local children entries
  repair_state='absent'
  REPAIR_WORK_ROOT=''
  if [[ ! -e "$REPAIR_PARENT" && ! -L "$REPAIR_PARENT" ]]; then
    return 0
  fi
  [[ ! -L "$REPAIR_PARENT" && -d "$REPAIR_PARENT" &&
    "$(realpath -- "$REPAIR_PARENT")" == "$REPAIR_PARENT" &&
    "$(stat --format='%U:%G:%a' "$REPAIR_PARENT")" == 'root:root:700' ]] || return 1
  children="$(find -P "$REPAIR_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  case "$children" in
    '') return 0 ;;
    ".installing-$REPAIR_RELEASE")
      repair_state='installing'
      REPAIR_WORK_ROOT="$REPAIR_INSTALLING"
      ;;
    "$REPAIR_RELEASE")
      repair_state='complete'
      REPAIR_WORK_ROOT="$REPAIR_ROOT"
      ;;
    *) return 1 ;;
  esac
  [[ ! -L "$REPAIR_WORK_ROOT" && -d "$REPAIR_WORK_ROOT" &&
    "$(realpath -- "$REPAIR_WORK_ROOT")" == "$REPAIR_WORK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$REPAIR_WORK_ROOT")" == 'root:root:700' ]] || return 1
  entries="$(find -P "$REPAIR_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' |
    LC_ALL=C sort)" || return 1
  if [[ "$repair_state" == 'installing' ]]; then
    case "$entries" in
      ''|'.intent-v1.installing'|'intent-v1'|$'.completed-v1.installing\nintent-v1'|\
        $'completed-v1\nintent-v1') ;;
      *) return 1 ;;
    esac
  else
    [[ "$entries" == $'completed-v1\nintent-v1' ]] || return 1
  fi
}

create_repair_installing_root() {
  if [[ ! -e "$REPAIR_PARENT" && ! -L "$REPAIR_PARENT" ]]; then
    mkdir --mode=0700 -- "$REPAIR_PARENT" || return 1
    chown root:root "$REPAIR_PARENT" || return 1
    chmod 0700 "$REPAIR_PARENT" || return 1
    sync -f "$(dirname "$REPAIR_PARENT")" || return 1
  fi
  [[ ! -L "$REPAIR_PARENT" && -d "$REPAIR_PARENT" &&
    "$(realpath -- "$REPAIR_PARENT")" == "$REPAIR_PARENT" &&
    "$(stat --format='%U:%G:%a' "$REPAIR_PARENT")" == 'root:root:700' ]] || return 1
  if [[ ! -e "$REPAIR_INSTALLING" && ! -L "$REPAIR_INSTALLING" ]]; then
    [[ -z "$(find -P "$REPAIR_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] ||
      return 1
    mkdir --mode=0700 -- "$REPAIR_INSTALLING" || return 1
    chown root:root "$REPAIR_INSTALLING" || return 1
    chmod 0700 "$REPAIR_INSTALLING" || return 1
    sync -f "$REPAIR_PARENT" || return 1
  fi
  discover_repair_ledger || return 1
  [[ "$repair_state" == 'installing' && "$REPAIR_WORK_ROOT" == "$REPAIR_INSTALLING" ]]
}

expected_repair_intent() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair' \
    'state=authorized' \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_recovery_release=$RECOVERY_RELEASE" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "h14_authorized_namespace=.installing-$RECOVERY_RELEASE" \
    "h14_namespace_device=$H14_NAMESPACE_DEVICE" \
    "h14_namespace_inode=$H14_NAMESPACE_INODE" \
    "h14_adoption_record_device=$H14_ADOPTION_DEVICE" \
    "h14_adoption_record_inode=$H14_ADOPTION_INODE" \
    "h14_adoption_record_sha256=$H14_ADOPTION_SHA256" \
    "h14_runtime_retirement_intent_device=$H14_RUNTIME_INTENT_DEVICE" \
    "h14_runtime_retirement_intent_inode=$H14_RUNTIME_INTENT_INODE" \
    "h14_runtime_retirement_intent_sha256=$H14_RUNTIME_INTENT_SHA256" \
    "coordinator_container_id=$COORDINATOR_CONTAINER_ID" \
    "coordinator_historical_contract_sha256=$COORDINATOR_CONTRACT_SHA256" \
    'coordinator_absent=true' \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    "owner_historical_contract_sha256=$OWNER_CONTRACT_SHA256" \
    'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2' \
    "owner_semantic_contract_sha256=$OWNER_SEMANTIC_CONTRACT_SHA256" \
    'mounts_order=full-canonical-json-sorted' \
    'config_cmd_order=preserved' \
    'config_env_order=preserved' \
    'deployment_grant=disabled' \
    "installed_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    'owner_state=running' \
    'owner_health=healthy' \
    'profile_volume_holders=none' \
    "control_volume_holder=$OWNER_CONTAINER_ID" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'internal_kemerbet_execution_runtime_enabled=false' \
    'kemerbet_private_live_deposit_pilot_enabled=false' \
    'money_moved=false' \
    'legacy_contract_digest_compared=false' \
    'canonical_h14_evidence_rewritten=false' \
    'canonical_h14_release_superseded=false'
}

load_repair_intent() {
  local path="$REPAIR_WORK_ROOT/intent-v1"
  local current_adoption_device current_adoption_inode current_adoption_sha
  local current_device current_inode current_runtime_device current_runtime_inode
  local current_runtime_sha
  local -a lines
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  mapfile -t lines <"$path"
  [[ "${#lines[@]}" -eq 42 &&
    "${lines[0]}" == 'version=1' &&
    "${lines[1]}" == 'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair' &&
    "${lines[2]}" == 'state=authorized' &&
    "${lines[3]}" == "repair_implementation_release=$REPAIR_RELEASE" &&
    "${lines[4]}" == "canonical_h14_recovery_release=$RECOVERY_RELEASE" &&
    "${lines[5]}" == "authorization_sha256=$AUTHORIZATION_SHA256" &&
    "${lines[6]}" == "h14_authorized_namespace=.installing-$RECOVERY_RELEASE" &&
    "${lines[7]}" =~ ^h14_namespace_device=[0-9]+$ &&
    "${lines[8]}" =~ ^h14_namespace_inode=[0-9]+$ &&
    "${lines[9]}" =~ ^h14_adoption_record_device=[0-9]+$ &&
    "${lines[10]}" =~ ^h14_adoption_record_inode=[0-9]+$ &&
    "${lines[11]}" =~ ^h14_adoption_record_sha256=[0-9a-f]{64}$ &&
    "${lines[12]}" =~ ^h14_runtime_retirement_intent_device=[0-9]+$ &&
    "${lines[13]}" =~ ^h14_runtime_retirement_intent_inode=[0-9]+$ &&
    "${lines[14]}" =~ ^h14_runtime_retirement_intent_sha256=[0-9a-f]{64}$ &&
    "${lines[15]}" =~ ^coordinator_container_id=[0-9a-f]{64}$ &&
    "${lines[16]}" =~ ^coordinator_historical_contract_sha256=[0-9a-f]{64}$ &&
    "${lines[18]}" =~ ^owner_container_id=[0-9a-f]{64}$ &&
    "${lines[19]}" =~ ^owner_historical_contract_sha256=[0-9a-f]{64}$ &&
    "${lines[21]}" =~ ^owner_semantic_contract_sha256=[0-9a-f]{64}$ ]] || return 1
  H14_NAMESPACE_DEVICE="${lines[7]#h14_namespace_device=}"
  H14_NAMESPACE_INODE="${lines[8]#h14_namespace_inode=}"
  H14_ADOPTION_DEVICE="${lines[9]#h14_adoption_record_device=}"
  H14_ADOPTION_INODE="${lines[10]#h14_adoption_record_inode=}"
  H14_ADOPTION_SHA256="${lines[11]#h14_adoption_record_sha256=}"
  H14_RUNTIME_INTENT_DEVICE="${lines[12]#h14_runtime_retirement_intent_device=}"
  H14_RUNTIME_INTENT_INODE="${lines[13]#h14_runtime_retirement_intent_inode=}"
  H14_RUNTIME_INTENT_SHA256="${lines[14]#h14_runtime_retirement_intent_sha256=}"
  LEDGER_COORDINATOR_CONTAINER_ID="${lines[15]#coordinator_container_id=}"
  LEDGER_COORDINATOR_CONTRACT_SHA256="${lines[16]#coordinator_historical_contract_sha256=}"
  LEDGER_OWNER_CONTAINER_ID="${lines[18]#owner_container_id=}"
  LEDGER_OWNER_CONTRACT_SHA256="${lines[19]#owner_historical_contract_sha256=}"
  OWNER_SEMANTIC_CONTRACT_SHA256="${lines[21]#owner_semantic_contract_sha256=}"
  set_h14_current_root || return 1
  require_adopted_empty_checkpoint_record "$H14_WORK_ROOT" || return 1
  load_runtime_retirement_intent || return 1
  [[ "$COORDINATOR_CONTAINER_ID" == "$LEDGER_COORDINATOR_CONTAINER_ID" &&
    "$COORDINATOR_CONTRACT_SHA256" == "$LEDGER_COORDINATOR_CONTRACT_SHA256" &&
    "$OWNER_CONTAINER_ID" == "$LEDGER_OWNER_CONTAINER_ID" &&
    "$OWNER_CONTRACT_SHA256" == "$LEDGER_OWNER_CONTRACT_SHA256" ]] || return 1
  current_device="$(stat --format='%d' "$H14_WORK_ROOT")" || return 1
  current_inode="$(stat --format='%i' "$H14_WORK_ROOT")" || return 1
  current_adoption_device="$(stat --format='%d' \
    "$H14_WORK_ROOT/$EMPTY_CHECKPOINT_RECORD_NAME")" || return 1
  current_adoption_inode="$(stat --format='%i' \
    "$H14_WORK_ROOT/$EMPTY_CHECKPOINT_RECORD_NAME")" || return 1
  current_adoption_sha="$(sha256sum -- \
    "$H14_WORK_ROOT/$EMPTY_CHECKPOINT_RECORD_NAME" | awk '{print $1}')" || return 1
  current_runtime_device="$(stat --format='%d' \
    "$H14_WORK_ROOT/runtime-retirement-intent-v1")" || return 1
  current_runtime_inode="$(stat --format='%i' \
    "$H14_WORK_ROOT/runtime-retirement-intent-v1")" || return 1
  current_runtime_sha="$(sha256sum -- \
    "$H14_WORK_ROOT/runtime-retirement-intent-v1" | awk '{print $1}')" || return 1
  [[ "$current_device" == "$H14_NAMESPACE_DEVICE" &&
    "$current_inode" == "$H14_NAMESPACE_INODE" &&
    "$current_adoption_device" == "$H14_ADOPTION_DEVICE" &&
    "$current_adoption_inode" == "$H14_ADOPTION_INODE" &&
    "$current_adoption_sha" == "$H14_ADOPTION_SHA256" &&
    "$current_runtime_device" == "$H14_RUNTIME_INTENT_DEVICE" &&
    "$current_runtime_inode" == "$H14_RUNTIME_INTENT_INODE" &&
    "$current_runtime_sha" == "$H14_RUNTIME_INTENT_SHA256" ]] || return 1
  cmp -s -- "$path" <(expected_repair_intent)
}

require_exact_owner_restored_record() {
  local path="$RECOVERY_ROOT/owner-runtime-restored-v1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$path" <(expected_owner_runtime_restored)
}

resume_final_owner_for_repair_completion() {
  local actual_digest attempt coordinator_inventory control_holders owner_inventory
  local owner_state profile_holders
  set_h14_current_root || return 1
  [[ "$h14_state" == 'retired' ]] || return 0
  load_repair_intent || return 1
  owner_state="$(docker_local container inspect "$OWNER_CONTAINER_ID" \
    --format '{{.State.Status}}')" || return 1
  if [[ "$owner_state" == 'running' ]]; then
    [[ "$(docker_local container inspect "$OWNER_CONTAINER_ID" \
      --format '{{.State.Health.Status}}')" == 'healthy' ]]
    return
  fi
  [[ "$repair_state" == 'installing' && "$owner_state" == 'exited' ]] || return 1
  classify_h14_base_phase "$RECOVERY_ROOT" || return 1
  [[ "$H14_PREFIX_PHASE" == 'complete' ]] || return 1
  require_exact_owner_restored_record || return 1
  owner_inventory="$(container_full_ids_for_service owner-control)" || return 1
  coordinator_inventory="$(container_full_ids_for_service kemerbet-session-provision)" ||
    return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ "$owner_inventory" == "$OWNER_CONTAINER_ID" && -z "$coordinator_inventory" &&
    -z "$profile_holders" && "$control_holders" == "$OWNER_CONTAINER_ID" ]] || return 1
  ! docker_local container inspect "$COORDINATOR_CONTAINER_ID" >/dev/null 2>&1 || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control \
    "$PREDECESSOR_RELEASE" || return 1
  actual_digest="$(container_semantic_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_SEMANTIC_CONTRACT_SHA256" ]] || return 1
  require_no_host_chromium || return 1
  require_financial_gates_disabled || return 1
  docker_local container start "$OWNER_CONTAINER_ID" >/dev/null || return 1
  for attempt in $(seq 1 45); do
    owner_state="$(docker_local container inspect "$OWNER_CONTAINER_ID" \
      --format '{{.State.Status}}')" || return 1
    if [[ "$owner_state" == 'running' &&
      "$(docker_local container inspect "$OWNER_CONTAINER_ID" \
        --format '{{.State.Health.Status}}')" == 'healthy' ]]; then
      break
    fi
    [[ "$owner_state" == 'running' ]] || return 1
    sleep 1
  done
  [[ "$owner_state" == 'running' &&
    "$(docker_local container inspect "$OWNER_CONTAINER_ID" \
      --format '{{.State.Health.Status}}')" == 'healthy' ]] || return 1
  actual_digest="$(container_semantic_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_SEMANTIC_CONTRACT_SHA256" ]] || return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$profile_holders" && "$control_holders" == "$OWNER_CONTAINER_ID" ]] || return 1
  require_financial_gates_disabled
}

prepare_or_load_repair_intent() {
  local entries
  discover_repair_ledger || return 1
  if [[ "$repair_state" == 'absent' ]]; then
    require_exact_initial_live_prefix || return 1
    create_repair_installing_root || return 1
  elif [[ "$repair_state" == 'complete' ]]; then
    set_h14_current_root || return 1
    [[ "$h14_state" == 'retired' ]] || return 1
    require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
    require_active_grant_only || return 1
    load_repair_intent || return 1
    require_repair_completed_record
    return
  fi
  entries="$(find -P "$REPAIR_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' |
    LC_ALL=C sort)" || return 1
  if [[ "$entries" == $'.completed-v1.installing\nintent-v1' ||
    "$entries" == $'completed-v1\nintent-v1' ]]; then
    set_h14_current_root || return 1
    [[ "$h14_state" == 'retired' ]] || return 1
    require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
    require_active_grant_only || return 1
  fi
  case "$entries" in
    ''|'.intent-v1.installing')
      require_exact_initial_live_prefix || return 1
      publish_recovery_record "$REPAIR_WORK_ROOT" intent-v1 600 expected_repair_intent ||
        return 1
      ;;
  esac
  load_repair_intent || return 1
  if [[ "$entries" == $'.completed-v1.installing\nintent-v1' ]]; then
    require_repair_completion_temporary_prefix || return 1
  elif [[ "$entries" == $'completed-v1\nintent-v1' ]]; then
    require_repair_completed_record || return 1
  fi
}

attest_repair_runtime_continuity() {
  local actual_digest coordinator_inventory control_holders owner_inventory owner_state
  local profile_holders
  set_h14_current_root || return 1
  classify_h14_base_phase "$H14_WORK_ROOT" || return 1
  load_repair_intent || return 1
  coordinator_inventory="$(container_full_ids_for_service kemerbet-session-provision)" ||
    return 1
  [[ -z "$coordinator_inventory" && "$COORDINATOR_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  ! docker_local container inspect "$COORDINATOR_CONTAINER_ID" >/dev/null 2>&1 || return 1
  owner_inventory="$(container_full_ids_for_service owner-control)" || return 1
  [[ "$owner_inventory" == "$OWNER_CONTAINER_ID" ]] || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control \
    "$PREDECESSOR_RELEASE" || return 1
  actual_digest="$(container_semantic_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_SEMANTIC_CONTRACT_SHA256" ]] || return 1
  owner_state="$(docker_local container inspect "$OWNER_CONTAINER_ID" \
    --format '{{.State.Status}}')" || return 1
  case "$owner_state" in
    running)
      [[ "$(docker_local container inspect "$OWNER_CONTAINER_ID" \
        --format '{{.State.Health.Status}}')" == 'healthy' ]] || return 1
      ;;
    exited)
      [[ "$h14_state" == 'interrupted' ]] || return 1
      ;;
    *) return 1 ;;
  esac
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$profile_holders" && "$control_holders" == "$OWNER_CONTAINER_ID" ]] || return 1
  require_no_host_chromium || return 1
  require_financial_gates_disabled || return 1
  if [[ "$h14_state" == 'interrupted' ]]; then
    [[ "$H14_PREFIX_PHASE" == 'runtime-intent' ||
      "$H14_PREFIX_PHASE" == 'post-retirement' ||
      "$H14_PREFIX_PHASE" == 'complete' ]] || return 1
    require_disabled_grant_only || return 1
    require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
    require_no_helper_installer_residue || return 1
  else
    [[ "$H14_PREFIX_PHASE" == 'complete' ]] || return 1
    if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
      require_disabled_grant_only || return 1
      require_resumable_helper_installation_prefix || return 1
    else
      require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
      require_no_helper_installer_residue || return 1
      if ! require_active_grant_only; then
        require_disabled_grant_only || return 1
      fi
    fi
  fi
}

expected_repair_completed() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair' \
    'state=completed' \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_recovery_release=$RECOVERY_RELEASE" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "h14_final_namespace=$RECOVERY_RELEASE" \
    "h14_namespace_device=$H14_NAMESPACE_DEVICE" \
    "h14_namespace_inode=$H14_NAMESPACE_INODE" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    'owner_running=true' \
    'owner_healthy=true' \
    'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2' \
    "owner_semantic_contract_sha256=$OWNER_SEMANTIC_CONTRACT_SHA256" \
    "coordinator_container_id=$COORDINATOR_CONTAINER_ID" \
    'coordinator_absent=true' \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    'deployment_grant=active' \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'money_moved=false' \
    "repair_intent_sha256=$REPAIR_INTENT_SHA256" \
    "h14_owner_runtime_restored_sha256=$H14_OWNER_RESTORED_SHA256" \
    'legacy_contract_digest_compared=false' \
    'canonical_h14_evidence_rewritten=false' \
    'canonical_h14_release_superseded=false'
}

prepare_completion_values() {
  [[ "$h14_state" == 'retired' && "$H14_WORK_ROOT" == "$RECOVERY_ROOT" ]] || return 1
  REPAIR_INTENT_SHA256="$(sha256sum -- "$REPAIR_WORK_ROOT/intent-v1" | awk '{print $1}')" ||
    return 1
  H14_OWNER_RESTORED_SHA256="$(sha256sum -- \
    "$RECOVERY_ROOT/owner-runtime-restored-v1" | awk '{print $1}')" || return 1
  [[ "$REPAIR_INTENT_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$H14_OWNER_RESTORED_SHA256" =~ ^[0-9a-f]{64}$ ]]
}

require_repair_completion_temporary_prefix() {
  local expected temporary="$REPAIR_WORK_ROOT/.completed-v1.installing"
  [[ ! -e "$REPAIR_WORK_ROOT/completed-v1" &&
    ! -L "$REPAIR_WORK_ROOT/completed-v1" ]] || return 1
  prepare_completion_values || return 1
  expected="$(expected_repair_completed)" || return 1
  expected+=$'\n'
  env -i PATH="$SAFE_PATH" python3 -I - "$temporary" "$expected" <<'PY'
import os
import stat
import sys

path, expected_text = sys.argv[1:]
try:
    expected = expected_text.encode('ascii')
except UnicodeEncodeError:
    raise SystemExit(1)
descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    value = os.fstat(descriptor)
    named = os.lstat(path)
    data = os.pread(descriptor, len(expected) + 1, 0)
    if (
        not stat.S_ISREG(value.st_mode)
        or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
        != (0, 0, 0o600, 1)
        or value.st_size > len(expected)
        or len(data) != value.st_size
        or data != expected[:value.st_size]
        or os.path.realpath(path) != path
    ):
        raise SystemExit(1)
finally:
    os.close(descriptor)
PY
}

require_repair_completed_record() {
  local path="$REPAIR_WORK_ROOT/completed-v1"
  local -a lines
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  mapfile -t lines <"$path"
  [[ "${#lines[@]}" -eq 29 ]] || return 1
  prepare_completion_values || return 1
  cmp -s -- "$path" <(expected_repair_completed)
}

finalize_repair_ledger() {
  local entries
  [[ "$repair_state" == 'installing' && "$REPAIR_WORK_ROOT" == "$REPAIR_INSTALLING" ]] ||
    return 1
  prepare_completion_values || return 1
  publish_recovery_record "$REPAIR_WORK_ROOT" completed-v1 600 expected_repair_completed ||
    return 1
  require_repair_completed_record || return 1
  entries="$(find -P "$REPAIR_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' |
    LC_ALL=C sort)" || return 1
  [[ "$entries" == $'completed-v1\nintent-v1' &&
    ! -e "$REPAIR_ROOT" && ! -L "$REPAIR_ROOT" ]] || return 1
  mv -- "$REPAIR_INSTALLING" "$REPAIR_ROOT" || return 1
  sync -f "$REPAIR_PARENT" || return 1
  repair_state='complete'
  REPAIR_WORK_ROOT="$REPAIR_ROOT"
  require_repair_completed_record
}

acquire_exact_mutation_lock() {
  local lock_status
  coproc H14_LOCK_HOLDER {
    exec env -i PATH="$SAFE_PATH" python3 -I /dev/fd/3 \
      "$LOCK_ROOT" "$LOCK" 3<<'PY'
import errno
import fcntl
import os
import stat
import sys

root, path = sys.argv[1:]
if path != f'{root}/mutation.lock' or os.path.realpath(os.path.dirname(root)) != os.path.dirname(root):
    raise SystemExit(1)
parent = os.path.dirname(root)
parent_value = os.lstat(parent)
if not stat.S_ISDIR(parent_value.st_mode):
    raise SystemExit(1)
created_root = False
try:
    os.mkdir(root, 0o700)
    created_root = True
except FileExistsError:
    pass
root_descriptor = os.open(
    root,
    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
)
try:
    if created_root:
        os.fchown(root_descriptor, 0, 0)
        os.fchmod(root_descriptor, 0o700)
        os.fsync(root_descriptor)
        parent_descriptor = os.open(
            parent,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        )
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)
    root_value = os.fstat(root_descriptor)
    root_named = os.lstat(root)
    if (
        not stat.S_ISDIR(root_value.st_mode)
        or (root_value.st_dev, root_value.st_ino) != (root_named.st_dev, root_named.st_ino)
        or (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode))
        != (0, 0, 0o700)
        or os.path.realpath(root) != root
    ):
        raise SystemExit(1)
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
    created_lock = False
    try:
        lock_descriptor = os.open('mutation.lock', flags, dir_fd=root_descriptor)
    except FileNotFoundError:
        try:
            lock_descriptor = os.open(
                'mutation.lock',
                flags | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=root_descriptor,
            )
            created_lock = True
        except FileExistsError:
            raise SystemExit(1)
    try:
        if created_lock:
            os.fchown(lock_descriptor, 0, 0)
            os.fchmod(lock_descriptor, 0o600)
            os.fsync(lock_descriptor)
            os.fsync(root_descriptor)
        before = os.fstat(lock_descriptor)
        named = os.stat('mutation.lock', dir_fd=root_descriptor, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
            != (0, 0, 0o600, 1)
            or before.st_size != 0
            or os.path.realpath(path) != path
        ):
            raise SystemExit(1)
        try:
            fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(73)
        after = os.fstat(lock_descriptor)
        named_after = os.stat('mutation.lock', dir_fd=root_descriptor, follow_symlinks=False)
        if (
            (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
             after.st_nlink, after.st_size, after.st_mtime_ns)
            != (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            raise SystemExit(1)
        print(f'locked:{after.st_dev}:{after.st_ino}', flush=True)
        sys.stdin.buffer.read()
    finally:
        os.close(lock_descriptor)
finally:
    os.close(root_descriptor)
PY
  }
  LOCK_HOLDER_PROCESS_ID="$H14_LOCK_HOLDER_PID"
  LOCK_STATUS_FD="${H14_LOCK_HOLDER[0]}"
  LOCK_CONTROL_FD="${H14_LOCK_HOLDER[1]}"
  if ! IFS= read -r lock_status <&"$LOCK_STATUS_FD"; then
    exec {LOCK_CONTROL_FD}>&- || true
    wait "$LOCK_HOLDER_PROCESS_ID" || true
    return 1
  fi
  exec {LOCK_STATUS_FD}<&-
  [[ "$lock_status" =~ ^locked:[0-9]+:[0-9]+$ ]]
}

release_exact_mutation_lock() {
  exec {LOCK_CONTROL_FD}>&- || return 1
  wait "$LOCK_HOLDER_PROCESS_ID" || return 1
  unset LOCK_HOLDER_PROCESS_ID LOCK_STATUS_FD LOCK_CONTROL_FD
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed H14 live-repair staging root is absent or unsafe'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged H14 successor helper is invalid'
require_exact_h13_evidence || die 'the immutable H13 predecessor evidence is invalid'
require_financial_gates_disabled || die 'a financial, executor, final-action, Amount, or Transfer gate is not disabled'

[[ -e "$H14_PARENT" || -L "$H14_PARENT" ]] ||
  die 'the exact predecessor H14 checkpoint namespace is absent'
[[ ! -L "$H14_PARENT" && -d "$H14_PARENT" && "$(realpath -- "$H14_PARENT")" == "$H14_PARENT" &&
  "$(stat --format='%U:%G:%a' "$H14_PARENT")" == 'root:root:700' ]] ||
  die 'the H14 recovery parent is unsafe'
h14_children="$(find -P "$H14_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
  die 'the H14 recovery namespace could not be read'
case "$h14_children" in
  ".installing-$RECOVERY_RELEASE") h14_state='interrupted' ;;
  "$RECOVERY_RELEASE") h14_state='retired' ;;
  *) die 'the H14 recovery namespace is foreign or ambiguous' ;;
esac

discover_repair_ledger || die 'the separate H14 live-repair ledger is unsafe'
if [[ "$repair_state" == 'absent' ]] ||
  { [[ "$repair_state" == 'installing' ]] &&
    [[ ! -e "$REPAIR_WORK_ROOT/intent-v1" && ! -L "$REPAIR_WORK_ROOT/intent-v1" ]]; }; then
  require_exact_initial_live_prefix ||
    die 'this repair accepts only the exact current two-record H14 prefix'
else
  load_repair_intent || die 'the existing H14 live-repair intent is invalid'
fi

if [[ "$h14_state" == 'interrupted' ]]; then
  require_adopted_empty_checkpoint_record "$RECOVERY_INSTALLING" ||
    die 'the interrupted H14 hotfix prefix is missing its exact predecessor-checkpoint adoption record'
  classify_h14_base_phase "$RECOVERY_INSTALLING" ||
    die 'the interrupted H14 hotfix prefix phase is not exact'
  initial_h14_prefix_phase="$H14_PREFIX_PHASE"
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
    die 'an interrupted pre-install H14 recovery must retain the exact predecessor helper'
  case "$initial_h14_prefix_phase" in
    runtime-intent)
      require_disabled_grant_only ||
        die 'the live-repair runtime-intent prefix requires the exact disabled grant'
      initial_grant_state='disabled-runtime-intent'
      ;;
    post-retirement)
      require_disabled_grant_only ||
        die 'a post-retirement H14 prefix requires the disabled deployment grant'
      initial_grant_state='disabled-post-retirement'
      ;;
    complete)
      require_disabled_grant_only ||
        die 'a complete installing H14 prefix requires the disabled deployment grant'
      initial_grant_state='disabled-installing-complete'
      ;;
    *) die 'the interrupted H14 prefix phase is unrecognized' ;;
  esac
else
  require_adopted_empty_checkpoint_record "$RECOVERY_ROOT" ||
    die 'the completed H14 hotfix prefix is missing its exact predecessor-checkpoint adoption record'
  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    classify_h14_base_phase "$RECOVERY_ROOT" ||
      die 'the completed H14 predecessor-helper namespace is not an exact installer base'
    [[ "$H14_PREFIX_PHASE" == 'complete' ]] ||
      die 'the completed H14 predecessor-helper namespace is an impossible partial prefix'
    require_disabled_grant_only ||
      die 'a completed H14 prefix with the predecessor helper requires the disabled grant'
    initial_grant_state='disabled-retired-predecessor'
  elif require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
    run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
      die 'the completed H14 successor helper rejected its reviewed digest'
    run_helper_direct kemerbet-quarantine-recovery-ready "$RECOVERY_RELEASE" >/dev/null ||
      die 'the completed H14 successor helper rejected its exact derived namespace'
    if require_active_grant_only; then
      initial_grant_state='active-retired-successor'
    else
      require_disabled_grant_only ||
        die 'the completed H14 successor-helper grant topology is invalid'
      initial_grant_state='disabled-retired-successor'
    fi
  else
    die 'the retired H14 state has an unreviewed installed helper'
  fi
fi

acquire_exact_mutation_lock || die 'the exact staging mutation lock could not be acquired'
require_no_other_mutator_processes || die 'another helper or H14 mutation process is active'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed under lock'
require_exact_h13_evidence || die 'the H13 evidence changed under lock'
require_financial_gates_disabled || die 'a financial gate changed under lock'
prepare_or_load_repair_intent ||
  die 'the exact current two-record H14 prefix could not be durably authorized in the repair ledger'
resume_final_owner_for_repair_completion ||
  die 'the exact final H14 Owner could not be safely resumed for repair completion'
attest_repair_runtime_continuity ||
  die 'the authorized repair lost exact Owner/coordinator/volume/gate continuity'

if require_active_grant_only; then
  locked_grant_state='active'
else
  require_disabled_grant_only || die 'the deployment grant topology changed under lock'
  locked_grant_state='disabled'
fi
case "$initial_grant_state:$locked_grant_state" in
  active-retired-successor:active|disabled-runtime-intent:disabled|disabled-post-retirement:disabled|disabled-installing-complete:disabled|disabled-retired-predecessor:disabled|disabled-retired-successor:disabled) ;;
  *) die 'the exact deployment grant prefix changed before durable intent preparation' ;;
esac
sync -f /etc/sudoers.d || die 'the exact deployment grant namespace could not be durably re-attested'

case "$h14_state" in
  interrupted)
    classify_h14_base_phase "$RECOVERY_INSTALLING" ||
      die 'the interrupted H14 prefix phase changed before durable intent preparation'
    [[ "$H14_PREFIX_PHASE" == "$initial_h14_prefix_phase" ]] ||
      die 'the interrupted H14 prefix advanced outside the mutation lock'
    require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
      die 'the interrupted H14 predecessor helper changed before durable intent preparation'
    case "$H14_PREFIX_PHASE:$locked_grant_state" in
      runtime-intent:disabled|post-retirement:disabled|complete:disabled) ;;
      *) die 'the interrupted H14 phase/grant topology is unsafe' ;;
    esac
    sync -f "$H14_PARENT" ||
      die 'the interrupted H14 namespace rename could not be durably re-attested'
    ;;
  retired)
    require_adopted_empty_checkpoint_record "$RECOVERY_ROOT" ||
      die 'the completed H14 adoption record changed before helper attestation'
    if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
      classify_h14_base_phase "$RECOVERY_ROOT" ||
        die 'the completed H14 predecessor-helper namespace changed before attestation'
      [[ "$H14_PREFIX_PHASE" == 'complete' ]] ||
        die 'the completed H14 predecessor-helper namespace became partial'
      [[ "$locked_grant_state" == 'disabled' ]] ||
        die 'the completed H14 predecessor-helper topology became active'
    else
      require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
        die 'the completed H14 helper changed before attestation'
      run_helper_direct kemerbet-quarantine-recovery-ready "$RECOVERY_RELEASE" >/dev/null ||
        die 'the completed H14 derived namespace changed before attestation'
    fi
    sync -f "$H14_PARENT" ||
      die 'the completed H14 namespace rename could not be durably re-attested'
    ;;
  *) die 'the H14 state changed before durable intent preparation' ;;
esac

if [[ "$h14_state" == 'retired' ]] &&
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
    die 'the completed H14 successor-helper topology contains installer residue'
  sync -f /usr/local/sbin ||
    die 'the completed H14 successor-helper rename could not be durably re-attested'
  run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
    die 'the completed H14 successor helper failed its under-lock digest verification'
  run_helper_direct kemerbet-quarantine-recovery-ready "$RECOVERY_RELEASE" >/dev/null ||
    die 'the completed H14 successor helper rejected its exact derived recovery state'
  require_financial_gates_disabled ||
    die 'a financial gate changed during completed H14 idempotent attestation'
  require_no_other_mutator_processes ||
    die 'another helper or H14 mutation process appeared during completed-state attestation'
  require_exact_droplet ||
    die 'the DigitalOcean Droplet identity changed during completed-state attestation'
  if [[ "$locked_grant_state" == 'disabled' ]]; then
    restore_sudoers || die 'the deployment grant could not be restored after completed-state attestation'
  else
    require_active_grant_only || die 'the active deployment grant changed during completed-state attestation'
  fi
  discover_repair_ledger || die 'the live-repair ledger changed before completion'
  attest_repair_runtime_continuity ||
    die 'the completed canonical H14 runtime failed semantic continuity attestation'
  if [[ "$repair_state" == 'installing' ]]; then
    finalize_repair_ledger || die 'the live-repair completion ledger could not be published'
  else
    [[ "$repair_state" == 'complete' ]] && require_repair_completed_record ||
      die 'the completed live-repair ledger is invalid'
  fi
  release_exact_mutation_lock || die 'the exact staging mutation lock could not be released'
  printf '%s\n' \
    'KemerBet H14 live repair already valid: canonical evidence preserved; Amount and Transfer disabled; no money moved.'
  exit 0
fi

prepare_or_load_runtime_retirement_intent ||
  die 'the exact coordinator/Owner retirement intent could not be durably prepared or resumed'

if [[ "$locked_grant_state" == 'active' ]]; then
  case "$h14_state" in
    interrupted)
      require_pre_retirement_intent_only ||
        die 'an active grant is allowed only beside the exact durable pre-retirement intent prefix'
      ;;
    retired)
      require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
        die 'an active grant beside retired H14 evidence requires the exact installed successor helper'
      ;;
    *) die 'the active deployment grant is not paired with a recognized H14 prefix' ;;
  esac
  disable_sudoers || die 'the deployment grant could not be disabled safely'
else
  require_disabled_grant_only || die 'the disabled deployment grant is unsafe'
fi

if [[ "$H14_WORK_ROOT" == "$RECOVERY_INSTALLING" ]] && ! host_retired_prefix_exists; then
  retire_recovery_runtime ||
    die 'the exact coordinator could not be retired or the durable volumes could not be quiesced'
fi

profile_mountpoint="$(docker_local volume inspect --format '{{.Mountpoint}}' "$PROFILE_VOLUME")" ||
  die 'the KemerBet profile volume could not be resolved'
control_mountpoint="$(docker_local volume inspect --format '{{.Mountpoint}}' "$CONTROL_VOLUME")" ||
  die 'the KemerBet session-control volume could not be resolved'
run_forward_only_recovery "$profile_mountpoint" "$control_mountpoint" ||
  die 'the append-only same-filesystem evidence retirement failed'
if [[ "$H14_WORK_ROOT" == "$RECOVERY_INSTALLING" ]]; then
  restore_owner_runtime_and_finalize ||
    die 'the exact Owner runtime could not be restored or the H14 namespace could not be finalized'
fi
[[ "$H14_WORK_ROOT" == "$RECOVERY_ROOT" ]] ||
  die 'the H14 recovery namespace did not reach its exact final name'

if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
  copy_helper_atomically "$STAGED_HELPER" 600 "$SUCCESSOR_HELPER_SHA256" ||
    die 'the H14 successor helper installer could not be completed'
  mv -- "$INSTALLING_HELPER" "$TARGET"
  sync -f /usr/local/sbin
fi
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the installed H14 successor helper is invalid'
[[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
  ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
  die 'an H14 helper installer residue remains'

run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the installed H14 helper rejected its reviewed digest'
run_helper_direct kemerbet-quarantine-recovery-ready "$RECOVERY_RELEASE" >/dev/null ||
  die 'the installed helper rejected the exact H14 host-retired state'
require_financial_gates_disabled || die 'a financial gate changed after H14 attestation'
require_no_other_mutator_processes || die 'another helper or H14 mutation process appeared'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed before grant restoration'

restore_sudoers || die 'the deployment grant could not be restored safely'
discover_repair_ledger || die 'the live-repair ledger changed before completion'
attest_repair_runtime_continuity ||
  die 'the completed canonical H14 runtime failed semantic continuity attestation'
require_active_grant_only || die 'the restored deployment grant is not exact'
finalize_repair_ledger || die 'the live-repair completion ledger could not be published'
release_exact_mutation_lock || die 'the exact staging mutation lock could not be released'

printf '%s\n' \
  'KemerBet H14 live repair installed: canonical evidence preserved; Amount and Transfer disabled; no money moved.'
