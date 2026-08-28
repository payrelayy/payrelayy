#!/usr/bin/env bash
# Root-console-only, forward-only H14 recovery of one exact quarantined
# KemerBet browser profile and its stale one-use v3 binding. This installer
# retires evidence by same-filesystem rename, rotates only the reviewed helper,
# and publishes a terminal recovery marker. It never starts a browser, enters
# Amount, clicks Transfer, enables an executor/final action, or moves money.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly PREDECESSOR_RELEASE='306818ca812bd2abce8479396c4eea8383ea00f9'
readonly PREDECESSOR_HELPER_SHA256='3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='951c656b6aac56aeb4c90b7b740abb24785ba70504d3b959ec8384bbe30bb3f7'
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
readonly SCRIPT_BASENAME='fetanagent-kemerbet-quarantine-recovery-v14.sh'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H14 quarantine recovery failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the recovery release, reviewed helper digest, and authorization digest'
readonly RECOVERY_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_AUTHORIZATION_SHA256="$3"
readonly STAGING_ROOT="/root/fetanagent-kemerbet-quarantine-recovery-v14-$RECOVERY_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly RECOVERY_ROOT="$H14_PARENT/$RECOVERY_RELEASE"
readonly RECOVERY_INSTALLING="$H14_PARENT/.installing-$RECOVERY_RELEASE"

[[ "$RECOVERY_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$RECOVERY_RELEASE" != "$PREDECESSOR_RELEASE" ]] ||
  die 'the H14 recovery release must be a distinct full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct hard-pinned reviewed H14 artifact'
[[ "$PROVIDED_AUTHORIZATION_SHA256" == "$AUTHORIZATION_SHA256" ]] ||
  die 'the exact reviewed quarantine-recovery authorization digest is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this installer only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl dirname docker env find flock grep id install mkdir mv \
  python3 realpath seq sha256sum sleep sort stat sync visudo; do
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
      [[ "$basename" == "$SCRIPT_BASENAME" ]] && return 1
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

require_financial_gates_disabled() {
  local container environment
  [[ ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" ]] || return 1
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    environment="$(docker_local container inspect "$container" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
    if grep -Eiq '^(FETANAGENT_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*|KEMERBET_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*)=(1|true|yes|on)$' \
      <<<"$environment"; then
      return 1
    fi
  done < <(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")
}

container_contract_digest() {
  local container_id="$1" contract
  contract="$(docker_local container inspect "$container_id" --format \
    '{{.Id}}|{{.Image}}|{{.Config.Image}}|{{.Config.User}}|{{json .Config.Cmd}}|{{json .Config.Env}}|{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.CapAdd}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{json .HostConfig.RestartPolicy}}|{{json .Mounts}}|{{json .Config.Labels}}')" ||
    return 1
  printf '%s\n' "$contract" | sha256sum | awk '{print $1}'
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
  ! grep -Eiq '^(FETANAGENT_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*|KEMERBET_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*)=(1|true|yes|on)$' \
    <<<"$environment" || return 1
  control_source="$(docker_local container inspect "$container_id" --format \
    '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-session-control"}}{{.Name}}{{end}}{{end}}')" ||
    return 1
  [[ "$control_source" == "$CONTROL_VOLUME" ]] || return 1
  if [[ "$service" == 'kemerbet-session-provision' ]]; then
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
  processes="$(docker_local container top "$container_id" -eo comm,args)" || return 1
  ! grep -Eiq '(^|[[:space:]/])(chromium|chrome|google-chrome|headless_shell|chromedriver)([[:space:]/-]|$)' \
    <<<"$processes"
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

prepare_h14_recovery_root() {
  if [[ ! -e "$H14_PARENT" && ! -L "$H14_PARENT" ]]; then
    mkdir --mode=0700 -- "$H14_PARENT" || return 1
    chown root:root "$H14_PARENT" || return 1
    sync -f "$(dirname -- "$H14_PARENT")" || return 1
  fi
  [[ ! -L "$H14_PARENT" && -d "$H14_PARENT" &&
    "$(realpath -- "$H14_PARENT")" == "$H14_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H14_PARENT")" == 'root:root:700' ]] || return 1
  if [[ -e "$RECOVERY_ROOT" || -L "$RECOVERY_ROOT" ]]; then
    [[ ! -e "$RECOVERY_INSTALLING" && ! -L "$RECOVERY_INSTALLING" &&
      ! -L "$RECOVERY_ROOT" && -d "$RECOVERY_ROOT" &&
      "$(realpath -- "$RECOVERY_ROOT")" == "$RECOVERY_ROOT" &&
      "$(stat --format='%U:%G:%a' "$RECOVERY_ROOT")" == 'root:root:700' ]] || return 1
    H14_WORK_ROOT="$RECOVERY_ROOT"
    return 0
  fi
  if [[ ! -e "$RECOVERY_INSTALLING" && ! -L "$RECOVERY_INSTALLING" ]]; then
    mkdir --mode=0700 -- "$RECOVERY_INSTALLING" || return 1
    chown root:root "$RECOVERY_INSTALLING" || return 1
    sync -f "$H14_PARENT" || return 1
  fi
  [[ ! -L "$RECOVERY_INSTALLING" && -d "$RECOVERY_INSTALLING" &&
    "$(realpath -- "$RECOVERY_INSTALLING")" == "$RECOVERY_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$RECOVERY_INSTALLING")" == 'root:root:700' ]] || return 1
  H14_WORK_ROOT="$RECOVERY_INSTALLING"
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
}

publish_recovery_record() {
  local root="$1" name="$2" mode="$3" producer="$4" final temporary
  final="$root/$name"
  temporary="$root/.$name.installing"
  if [[ -e "$final" || -L "$final" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" && ! -L "$final" && -f "$final" &&
      "$(realpath -- "$final")" == "$final" &&
      "$(stat --format='%U:%G:%a:%h' "$final")" == "root:root:$mode:1" ]] || return 1
    cmp -s -- "$final" <("$producer")
    return
  fi
  if [[ ! -e "$temporary" && ! -L "$temporary" ]]; then
    (set -o noclobber; "$producer" >"$temporary") || return 1
    chown root:root "$temporary" || return 1
    chmod "$mode" "$temporary" || return 1
    sync -f "$temporary" || return 1
  fi
  [[ ! -L "$temporary" && -f "$temporary" && "$(realpath -- "$temporary")" == "$temporary" &&
    "$(stat --format='%U:%G:%a:%h' "$temporary")" == "root:root:$mode:1" ]] || return 1
  cmp -s -- "$temporary" <("$producer") || return 1
  mv -- "$temporary" "$final" || return 1
  sync -f "$root"
}

expected_runtime_retirement_intent() {
  printf '%s\n' \
    'version=1' \
    "recovery_release=$RECOVERY_RELEASE" \
    "runtime_release=$PREDECESSOR_RELEASE" \
    "coordinator_container_id=$COORDINATOR_CONTAINER_ID" \
    "coordinator_contract_sha256=$COORDINATOR_CONTRACT_SHA256" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    "owner_contract_sha256=$OWNER_CONTRACT_SHA256" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'money_moved=false'
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

inspect_runtime_for_retirement_intent() {
  local coordinator owner state profile_holders control_holders expected_control
  coordinator="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  owner="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control')" || return 1
  [[ "$owner" =~ ^[0-9a-f]{12,64}$ && "$coordinator" != *$'\n'* ]] || return 1
  OWNER_CONTAINER_ID="$(docker_local container inspect "$owner" --format '{{.Id}}')" || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control "$PREDECESSOR_RELEASE" || return 1
  [[ "$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Status}}')" == 'running' &&
    "$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Health.Status}}')" == 'healthy' ]] ||
    return 1
  OWNER_CONTRACT_SHA256="$(container_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$OWNER_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -n "$coordinator" ]]; then
    [[ "$coordinator" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    COORDINATOR_CONTAINER_ID="$(docker_local container inspect "$coordinator" --format '{{.Id}}')" || return 1
    require_recovery_container_contract "$COORDINATOR_CONTAINER_ID" kemerbet-session-provision "$PREDECESSOR_RELEASE" || return 1
    state="$(docker_local container inspect "$COORDINATOR_CONTAINER_ID" --format '{{.State.Status}}')" || return 1
    [[ "$state" == 'running' &&
      "$(docker_local container inspect "$COORDINATOR_CONTAINER_ID" --format '{{.State.Health.Status}}')" == 'healthy' ]] ||
      return 1
    require_container_no_chromium "$COORDINATOR_CONTAINER_ID" || return 1
    run_helper_direct kemerbet-session-provision-ready "$PREDECESSOR_RELEASE" >/dev/null || return 1
    COORDINATOR_CONTRACT_SHA256="$(container_contract_digest "$COORDINATOR_CONTAINER_ID")" || return 1
    [[ "$COORDINATOR_CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  else
    COORDINATOR_CONTAINER_ID='absent'
    COORDINATOR_CONTRACT_SHA256='absent'
  fi
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  if [[ "$COORDINATOR_CONTAINER_ID" == 'absent' ]]; then
    [[ -z "$profile_holders" ]] || return 1
    expected_control="$OWNER_CONTAINER_ID"
  else
    [[ "$profile_holders" == "$COORDINATOR_CONTAINER_ID" ]] || return 1
    expected_control="$(printf '%s\n%s\n' "$COORDINATOR_CONTAINER_ID" "$OWNER_CONTAINER_ID" | LC_ALL=C sort)"
  fi
  [[ "$control_holders" == "$expected_control" ]]
}

prepare_or_load_runtime_retirement_intent() {
  prepare_h14_recovery_root || return 1
  require_h14_installer_prefix_namespace || return 1
  if [[ ! -e "$H14_WORK_ROOT/runtime-retirement-intent-v1" &&
    ! -L "$H14_WORK_ROOT/runtime-retirement-intent-v1" ]]; then
    inspect_runtime_for_retirement_intent || return 1
    publish_recovery_record "$H14_WORK_ROOT" runtime-retirement-intent-v1 600 \
      expected_runtime_retirement_intent || return 1
  fi
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
  [[ "$H14_WORK_ROOT" == "$RECOVERY_INSTALLING" ]] || return 1
  [[ "$(find -P "$H14_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
    'runtime-retirement-intent-v1' ]] || return 1
  load_runtime_retirement_intent
}

retire_recovery_runtime() {
  local actual_digest coordinator_inventory owner_state profile_holders control_holders
  load_runtime_retirement_intent || return 1
  if [[ "$COORDINATOR_CONTAINER_ID" != 'absent' ]] &&
    docker_local container inspect "$COORDINATOR_CONTAINER_ID" >/dev/null 2>&1; then
    require_recovery_container_contract "$COORDINATOR_CONTAINER_ID" kemerbet-session-provision "$PREDECESSOR_RELEASE" || return 1
    actual_digest="$(container_contract_digest "$COORDINATOR_CONTAINER_ID")" || return 1
    [[ "$actual_digest" == "$COORDINATOR_CONTRACT_SHA256" ]] || return 1
    case "$(docker_local container inspect "$COORDINATOR_CONTAINER_ID" --format '{{.State.Status}}')" in
      running)
        require_container_no_chromium "$COORDINATOR_CONTAINER_ID" || return 1
        docker_local container stop --time 70 "$COORDINATOR_CONTAINER_ID" >/dev/null || return 1
        ;;
      exited) ;;
      *) return 1 ;;
    esac
    docker_local container rm "$COORDINATOR_CONTAINER_ID" >/dev/null || return 1
  fi
  coordinator_inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  [[ -z "$coordinator_inventory" ]] || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control "$PREDECESSOR_RELEASE" || return 1
  actual_digest="$(container_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_CONTRACT_SHA256" ]] || return 1
  owner_state="$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Status}}')" || return 1
  case "$owner_state" in
    running) docker_local container stop --time 20 "$OWNER_CONTAINER_ID" >/dev/null || return 1 ;;
    exited) ;;
    *) return 1 ;;
  esac
  [[ "$(docker_local container inspect "$OWNER_CONTAINER_ID" --format '{{.State.Status}}')" == 'exited' ]] ||
    return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$profile_holders" && "$control_holders" == "$OWNER_CONTAINER_ID" ]] || return 1
  [[ -z "$(docker_local container ls --quiet --filter "volume=$PROFILE_VOLUME")" &&
    -z "$(docker_local container ls --quiet --filter "volume=$CONTROL_VOLUME")" ]] || return 1
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
  local actual_digest attempt control_holders coordinator_inventory profile_holders state
  [[ "$H14_WORK_ROOT" == "$RECOVERY_INSTALLING" ]] || return 1
  load_runtime_retirement_intent || return 1
  require_recovery_container_contract "$OWNER_CONTAINER_ID" owner-control "$PREDECESSOR_RELEASE" || return 1
  actual_digest="$(container_contract_digest "$OWNER_CONTAINER_ID")" || return 1
  [[ "$actual_digest" == "$OWNER_CONTRACT_SHA256" ]] || return 1
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
  [[ "$(find -P "$H14_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
    $'claim-stage-consumption-v1\nhost-retired-v1\nintent-v1\nowner-runtime-restored-v1\nplayer-stage-consumption-v1\npredecessor-helper\nquarantined-profile-v1\nretired-binding-v3\nretired-retryable-failure-v1\nruntime-retired-v1\nruntime-retirement-intent-v1' ]] || return 1
  [[ ! -e "$RECOVERY_ROOT" && ! -L "$RECOVERY_ROOT" ]] || return 1
  mv -- "$RECOVERY_INSTALLING" "$RECOVERY_ROOT" || return 1
  sync -f "$H14_PARENT" || return 1
  H14_WORK_ROOT="$RECOVERY_ROOT"
}

copy_helper_atomically() {
  local source="$1" source_mode="$2" digest="$3"
  if [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]; then
    if [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]; then
      require_helper_file "$source" "$digest" "$source_mode" || return 1
      install -o root -g root -m 0600 -- "$source" "$INSTALLING_HELPER_PARTIAL" || return 1
    fi
    require_helper_file "$INSTALLING_HELPER_PARTIAL" "$digest" 600 || return 1
    chmod 0755 "$INSTALLING_HELPER_PARTIAL" || return 1
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
    "$SUCCESSOR_HELPER_SHA256" "$AUTHORIZATION_SHA256" "$profile_mountpoint" \
    "$control_mountpoint" "$SOURCE_BINDING" "$OWNER_RECEIPT_ROOT" \
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


def publish_record(root, name, data, uid=0, gid=0, mode=0o600):
    final = f'{root}/{name}'
    temporary = f'{root}/.{name}.installing'
    if os.path.lexists(final):
        if os.path.lexists(temporary):
            reject()
        current, _ = exact_file(final, (uid, gid), mode, len(data), len(data))
        if current != data:
            reject()
        return
    if not os.path.lexists(temporary):
        create_exact(temporary, data, uid, gid, mode)
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
    if os.path.lexists(target):
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
    if os.path.lexists(target):
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


try:
    if RELEASE.fullmatch(release) is None or SHA.fullmatch(authorization_sha) is None:
        reject()
    exact_directory(profile_root)
    exact_directory(control_root)
    exact_directory(owner_root, (0, 0), 0o755)
    if not os.path.lexists(parent):
        os.mkdir(parent, 0o700)
        os.chown(parent, 0, 0)
        os.chmod(parent, 0o700)
        sync_directory(os.path.dirname(parent))
    parent_value = exact_directory(parent, (0, 0), 0o700)
    installing = f'{parent}/.installing-{release}'
    final_root = f'{parent}/{release}'
    parent_entries = set(os.listdir(parent))
    if parent_entries not in ({f'.installing-{release}'}, {release}, set()):
        reject()
    if os.path.lexists(final_root):
        if os.path.lexists(installing):
            reject()
        root = final_root
        exact_directory(root, (0, 0), 0o700)
    else:
        if not os.path.lexists(installing):
            os.mkdir(installing, 0o700)
            os.chown(installing, 0, 0)
            os.chmod(installing, 0o700)
            sync_directory(parent)
        root = installing
        exact_directory(root, (0, 0), 0o700)
    if os.lstat(root).st_dev != parent_value.st_dev:
        reject()

    allowed_root_entries = {
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
    if not os.path.lexists(intent_path) and not os.path.lexists(intent_temporary):
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
    if root == installing:
        if set(os.listdir(root)) != expected_entries or set(os.listdir(owner_root)) != {terminal_name}:
            reject()
        if os.path.lexists(final_root) or set(os.listdir(parent)) != {f'.installing-{release}'}:
            reject()
    else:
        if set(os.listdir(root)) != expected_entries | {'owner-runtime-restored-v1'} or set(os.listdir(owner_root)) != {terminal_name}:
            reject()
        owner_restored, _, _ = exact_ascii_record(
            f'{root}/owner-runtime-restored-v1', (0, 0), 0o600, 11
        )
        if owner_restored != [
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
        ]:
            reject()
        expected_entries.add('owner-runtime-restored-v1')
        if set(os.listdir(parent)) != {release} or set(os.listdir(root)) != expected_entries:
            reject()
except Exception:
    raise SystemExit(1)
PY
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed H14 staging root is absent or unsafe'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged H14 successor helper is invalid'
require_exact_h13_evidence || die 'the immutable H13 predecessor evidence is invalid'
require_financial_gates_disabled || die 'a financial, executor, final-action, Amount, or Transfer gate is not disabled'

h14_state='absent'
if [[ -e "$H14_PARENT" || -L "$H14_PARENT" ]]; then
  [[ ! -L "$H14_PARENT" && -d "$H14_PARENT" && "$(realpath -- "$H14_PARENT")" == "$H14_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H14_PARENT")" == 'root:root:700' ]] ||
    die 'the H14 recovery parent is unsafe'
  h14_children="$(find -P "$H14_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the H14 recovery namespace could not be read'
  case "$h14_children" in
    '') h14_state='interrupted' ;;
    ".installing-$RECOVERY_RELEASE") h14_state='interrupted' ;;
    "$RECOVERY_RELEASE") h14_state='retired' ;;
    *) die 'the H14 recovery namespace is foreign or ambiguous' ;;
  esac
fi

if [[ "$h14_state" == 'absent' ]]; then
  if require_active_grant_only; then
    initial_grant_state='active'
  else
    require_disabled_grant_only ||
      die 'the absent H14 prefix has neither the exact active nor exact disabled deployment grant'
    initial_grant_state='disabled-preintent'
  fi
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
    die 'the installed H13 predecessor helper is not exact'
  run_helper_direct verify "$PREDECESSOR_HELPER_SHA256" >/dev/null ||
    die 'the H13 helper rejected its reviewed digest'
  run_helper_direct kemerbet-v3-recheck-bridge-ready \
    "$PREDECESSOR_HELPER_SHA256" "$PREDECESSOR_RELEASE" >/dev/null ||
    die 'the H13 helper rejected its exact no-transfer predecessor state'
elif [[ "$h14_state" == 'interrupted' ]]; then
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
    die 'an interrupted pre-install H14 recovery must retain the exact predecessor helper'
  if require_disabled_grant_only; then
    initial_grant_state='disabled'
  else
    require_active_grant_only ||
      die 'the interrupted H14 prefix has neither the exact active nor exact disabled deployment grant'
    initial_grant_state='active-prefix-review-required'
  fi
else
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
    require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
    die 'the retired H14 state has an unreviewed installed helper'
  if require_disabled_grant_only; then
    initial_grant_state='disabled'
  else
    require_active_grant_only || die 'the retired H14 deployment grant topology is invalid'
    initial_grant_state='active-retired-review-required'
  fi
fi

install -d -o root -g root -m 0700 "$LOCK_ROOT"
exec {lock_fd}>"$LOCK"
flock -n "$lock_fd" || die 'another staging mutation is active'
chmod 0600 "$LOCK"
chown root:root "$LOCK"
require_no_other_mutator_processes || die 'another helper or H14 mutation process is active'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed under lock'
require_exact_h13_evidence || die 'the H13 evidence changed under lock'
require_financial_gates_disabled || die 'a financial gate changed under lock'

if require_active_grant_only; then
  locked_grant_state='active'
else
  require_disabled_grant_only || die 'the deployment grant topology changed under lock'
  locked_grant_state='disabled'
fi
case "$initial_grant_state:$locked_grant_state" in
  active:active|active-prefix-review-required:active|active-retired-review-required:active|disabled-preintent:disabled|disabled:disabled) ;;
  *) die 'the exact deployment grant prefix changed before durable intent preparation' ;;
esac

prepare_or_load_runtime_retirement_intent ||
  die 'the exact coordinator/Owner retirement intent could not be durably prepared or resumed'

if [[ "$locked_grant_state" == 'active' ]]; then
  case "$h14_state" in
    absent|interrupted)
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

if require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
  run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
    die 'the installed H14 helper rejected its reviewed digest'
  run_helper_direct kemerbet-quarantine-recovery-ready "$RECOVERY_RELEASE" >/dev/null ||
    die 'the installed helper rejected the exact completed H14 recovery namespace'
  require_financial_gates_disabled || die 'a financial gate changed during H14 idempotent attestation'
  restore_sudoers || die 'the deployment grant could not be restored safely'
  flock -u "$lock_fd"
  exec {lock_fd}>&-
  printf '%s\n' \
    'KemerBet H14 quarantine recovery already valid: Amount and Transfer disabled; no money moved.'
  exit 0
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
flock -u "$lock_fd"
exec {lock_fd}>&-

printf '%s\n' \
  'KemerBet H14 quarantine recovery installed: evidence preserved; Amount and Transfer disabled; no money moved.'
