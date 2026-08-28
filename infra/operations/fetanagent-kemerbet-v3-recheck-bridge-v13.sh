#!/usr/bin/env bash
# Root-console-only, one-use installation of the release-bound KemerBet v3
# exact-five recheck bridge. This operation appends immutable H13 provenance and
# rotates only the reviewed staging helper. It does not start a browser, perform
# a lookup or recheck, enter Amount, click Transfer, move money, or enable an
# executor/final action.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly HISTORICAL_OVERLAY_RELEASE='c061f9dc05e60d641d306f16b5d826e6e1b2c6c4'
readonly RUNTIME_BRIDGE_RELEASE='21ef5f0d987d9dc21efc1a81916316a3f6d7f864'
readonly PREDECESSOR_HELPER_SHA256='9f9c7f124820c1c8c8aabbe411de5ccc0d914bf7f4696904d6ba557eee62b3da'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa'
readonly CONFIRMATION='CONFIRM EXACT-FIVE NO-TRANSFER KEMERBET RECHECK'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v3-recheck-bridge-v13-disabled'
readonly ROTATION_V12_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v12'
readonly BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-recheck-bridge-v13'
readonly SOURCE_BINDING='/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
readonly FINAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly SESSION_CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly RECHECK_SNAPSHOT_VOLUME="$PROJECT_NAME-kemerbet-readiness-profile-snapshot-once"
readonly RECHECK_RPC_ROOT='/run/fetanagent-kemerbet-readiness-rpc-v1'
readonly RECHECK_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck'
readonly RECHECK_PROMOTION_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck-promotion-v1'
readonly RECHECK_CANDIDATE_ROOT='/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate'
readonly BOT_STARTUP_RECEIPT_ROOT='/var/lib/fetanagent-bot-startup-receipt'
readonly EXPIRY_STOP_SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly EXPIRY_STOP_TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly EXPIRY_STOP_SERVICE_PATH="/etc/systemd/system/$EXPIRY_STOP_SERVICE"
readonly EXPIRY_STOP_TIMER_PATH="/etc/systemd/system/$EXPIRY_STOP_TIMER"
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-recheck-bridge-v13-installing'
readonly INSTALLING_HELPER_PARTIAL="${INSTALLING_HELPER}.partial"
readonly SCRIPT_BASENAME='fetanagent-kemerbet-v3-recheck-bridge-v13.sh'

export PATH="$SAFE_PATH"
umask 022

die() {
  printf 'FetanAgent H13 recheck-bridge installation failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the recheck release, reviewed helper digest, and exact confirmation'
readonly RECHECK_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly STAGING_ROOT="/root/fetanagent-v3-recheck-bridge-v13-$RECHECK_RELEASE"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly BRIDGE_ROOT="$BRIDGE_PARENT/$RECHECK_RELEASE"
readonly BRIDGE_INSTALLING="$BRIDGE_PARENT/.installing-$RECHECK_RELEASE"

[[ "$RECHECK_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$RECHECK_RELEASE" != "$HISTORICAL_OVERLAY_RELEASE" &&
  "$RECHECK_RELEASE" != "$RUNTIME_BRIDGE_RELEASE" ]] ||
  die 'the H13 recheck release must be a distinct full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct hard-pinned reviewed H13 artifact'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact no-transfer exact-five confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this installer only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl docker env find flock grep id install mkdir mv \
  python3 realpath seq sha256sum sort stat sync systemctl visudo wc; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

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

require_helper_file() {
  local path="$1" expected_digest="$2" expected_mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$expected_mode:1" &&
    "$(sha256sum -- "$path" | awk '{print $1}')" == "$expected_digest" ]] || return 1
  bash -n "$path"
}

run_helper_direct() {
  env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' "$TARGET" "$@"
}

docker_local_read_only() {
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

H12_RELEASE=''
H12_INTENT_SHA256=''
H12_COMPLETION_SHA256=''
H12_ARCHIVE_SHA256=''
BASE_BINDING_V3_SHA256=''
COMPOSE5_DURABLE_VOLUME_DIGEST=''
COMPOSE5_PROFILE_CONFIG_HASH=''
COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
COMPOSE5_VOLUME_VERSION=''

load_exact_h12_evidence() {
  local archive children completion index intent root
  local -a completion_lines intent_lines
  [[ ! -L "$ROTATION_V12_PARENT" && -d "$ROTATION_V12_PARENT" &&
    "$(realpath -- "$ROTATION_V12_PARENT")" == "$ROTATION_V12_PARENT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_V12_PARENT")" == 'root:root:700' ]] || return 1
  children="$(find -P "$ROTATION_V12_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  [[ "$children" =~ ^[0-9a-f]{40}$ ]] || return 1
  H12_RELEASE="$children"
  root="$ROTATION_V12_PARENT/$H12_RELEASE"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' &&
    "$(find -P "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  intent="$root/intent-v1"
  completion="$root/completed-v1"
  archive="$root/predecessor-helper"
  [[ ! -L "$intent" && -f "$intent" && "$(realpath -- "$intent")" == "$intent" &&
    "$(stat --format='%U:%G:%a:%h' "$intent")" == 'root:root:600:1' &&
    ! -L "$completion" && -f "$completion" &&
    "$(realpath -- "$completion")" == "$completion" &&
    "$(stat --format='%U:%G:%a:%h' "$completion")" == 'root:root:600:1' ]] || return 1
  mapfile -t intent_lines <"$intent"
  mapfile -t completion_lines <"$completion"
  [[ "${#intent_lines[@]}" -eq 22 && "${#completion_lines[@]}" -eq 23 &&
    "${intent_lines[0]}" == 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v12' &&
    "${intent_lines[1]}" == 'state=authorized' &&
    "${intent_lines[2]}" == "overlay_release=$HISTORICAL_OVERLAY_RELEASE" &&
    "${intent_lines[3]}" == "runtime_bridge_release=$RUNTIME_BRIDGE_RELEASE" &&
    "${intent_lines[4]}" == "repair_release=$H12_RELEASE" &&
    "${intent_lines[6]}" == "successor_helper_sha256=$PREDECESSOR_HELPER_SHA256" &&
    "${intent_lines[10]}" =~ ^base_binding_v3_sha256=[0-9a-f]{64}$ &&
    "${intent_lines[11]}" =~ ^compose5_durable_volume_digest=[0-9a-f]{64}$ &&
    "${intent_lines[12]}" =~ ^compose5_profile_config_hash=[0-9a-f]{64}$ &&
    "${intent_lines[13]}" =~ ^compose5_session_control_config_hash=[0-9a-f]{64}$ &&
    "${intent_lines[14]}" =~ ^compose5_volume_version=[0-9]+\.[0-9]+\.[0-9]+ &&
    "${intent_lines[15]}" == 'transition=runtime-bridge-parser-scope-repair-v1' &&
    "${intent_lines[16]}" == 'financial_actions_mode=dry_run' &&
    "${intent_lines[17]}" == 'kemerbet_executor_enabled=false' &&
    "${intent_lines[18]}" == 'kemerbet_final_action_enabled=false' &&
    "${intent_lines[19]}" == 'transfer_enabled=false' &&
    "${intent_lines[20]}" == 'lookup_authorized=false' &&
    "${intent_lines[21]}" == 'recheck_authorized=false' &&
    "${completion_lines[0]}" == "${intent_lines[0]}" &&
    "${completion_lines[1]}" == 'state=parser-repair-installed' ]] || return 1
  for index in $(seq 2 21); do
    [[ "${completion_lines[$index]}" == "${intent_lines[$index]}" ]] || return 1
  done
  H12_INTENT_SHA256="$(sha256sum -- "$intent" | awk '{print $1}')"
  H12_COMPLETION_SHA256="$(sha256sum -- "$completion" | awk '{print $1}')"
  H12_ARCHIVE_SHA256="$(sha256sum -- "$archive" | awk '{print $1}')"
  [[ "${completion_lines[22]}" == "rotation_intent_sha256=$H12_INTENT_SHA256" &&
    "${intent_lines[5]}" == "predecessor_helper_sha256=$H12_ARCHIVE_SHA256" ]] || return 1
  require_helper_file "$archive" "$H12_ARCHIVE_SHA256" 400 || return 1
  BASE_BINDING_V3_SHA256="${intent_lines[10]#base_binding_v3_sha256=}"
  COMPOSE5_DURABLE_VOLUME_DIGEST="${intent_lines[11]}"
  COMPOSE5_PROFILE_CONFIG_HASH="${intent_lines[12]}"
  COMPOSE5_SESSION_CONTROL_CONFIG_HASH="${intent_lines[13]}"
  COMPOSE5_VOLUME_VERSION="${intent_lines[14]}"
}

OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST=''
OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH=''
OBSERVED_COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
OBSERVED_COMPOSE5_VOLUME_VERSION=''

require_compose5_durable_volume_compatibility() {
  local compose_config_hash compose_version contract control_contract='' expected_volume_label
  local expected_volumes holders mountpoint name options profile_contract='' project project_volumes
  local residue scope driver volume volume_label label_count
  OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST=''
  OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH=''
  OBSERVED_COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
  OBSERVED_COMPOSE5_VOLUME_VERSION=''
  project_volumes="$(docker_local_read_only volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  expected_volumes="$(printf '%s\n%s\n' "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME" | LC_ALL=C sort)"
  [[ "$project_volumes" == "$expected_volumes" ]] || return 1
  for volume in "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME"; do
    case "$volume" in
      "$PROFILE_VOLUME") expected_volume_label='kemerbet_sessions' ;;
      "$SESSION_CONTROL_VOLUME") expected_volume_label='kemerbet_session_control' ;;
      *) return 1 ;;
    esac
    contract="$(docker_local_read_only volume inspect "$volume" \
      --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{json .Options}}|{{len .Labels}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.version" }}|{{ index .Labels "com.docker.compose.volume" }}|{{with index .Labels "com.docker.compose.config-hash"}}{{.}}{{end}}|{{.Mountpoint}}')" || return 1
    IFS='|' read -r name driver scope options label_count project compose_version \
      volume_label compose_config_hash mountpoint residue <<<"$contract"
    [[ -z "$residue" && "$name" == "$volume" && "$driver" == 'local' &&
      "$scope" == 'local' && "$options" == 'null' && "$label_count" == '4' &&
      "$project" == "$PROJECT_NAME" &&
      "$compose_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+~-][0-9A-Za-z._-]+)?$ &&
      "$volume_label" == "$expected_volume_label" &&
      "$compose_config_hash" =~ ^[0-9a-f]{64}$ &&
      "$mountpoint" == "/var/lib/docker/volumes/$volume/_data" &&
      ! -L "$mountpoint" && -d "$mountpoint" && "$(realpath -- "$mountpoint")" == "$mountpoint" ]] ||
      return 1
    if [[ -z "$OBSERVED_COMPOSE5_VOLUME_VERSION" ]]; then
      OBSERVED_COMPOSE5_VOLUME_VERSION="$compose_version"
    else
      [[ "$compose_version" == "$OBSERVED_COMPOSE5_VOLUME_VERSION" ]] || return 1
    fi
    holders="$(docker_local_read_only container ls --all --quiet --filter "volume=$volume")" || return 1
    [[ -z "$holders" ]] || return 1
    case "$volume" in
      "$PROFILE_VOLUME")
        [[ "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] || return 1
        OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH="$compose_config_hash"
        profile_contract="$contract"
        ;;
      "$SESSION_CONTROL_VOLUME")
        [[ "$(stat --format='%u:%g:%a:%h' "$mountpoint")" == '10001:10001:700:2' ]] || return 1
        OBSERVED_COMPOSE5_SESSION_CONTROL_CONFIG_HASH="$compose_config_hash"
        control_contract="$contract"
        ;;
    esac
  done
  OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST="$({
    printf '%s\n' \
      "profile_contract=$profile_contract" \
      "control_contract=$control_contract" \
      "profile=$(stat --format='%d:%i:%u:%g:%a' "/var/lib/docker/volumes/$PROFILE_VOLUME/_data")" \
      "control=$(stat --format='%d:%i:%u:%g:%a:%h' "/var/lib/docker/volumes/$SESSION_CONTROL_VOLUME/_data")"
  } | sha256sum | awk '{print $1}')" || return 1
  [[ "$OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST" =~ ^[0-9a-f]{64}$ &&
    "$OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH" =~ ^[0-9a-f]{64}$ &&
    "$OBSERVED_COMPOSE5_SESSION_CONTROL_CONFIG_HASH" =~ ^[0-9a-f]{64}$ ]]
}

require_expiry_guard_disarmed() {
  local load_state
  [[ ! -e "$EXPIRY_STOP_TIMER_PATH" && ! -L "$EXPIRY_STOP_TIMER_PATH" &&
    ! -e "$EXPIRY_STOP_SERVICE_PATH" && ! -L "$EXPIRY_STOP_SERVICE_PATH" ]] || return 1
  load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)" || return 1
  [[ "$load_state" == 'not-found' ]]
}

require_stopped_durable_boundary() {
  local containers networks snapshot
  containers="$(docker_local_read_only container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  networks="$(docker_local_read_only network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  snapshot="$(docker_local_read_only volume ls --quiet \
    --filter "name=^${RECHECK_SNAPSHOT_VOLUME}$")" || return 1
  [[ -z "$containers" && -z "$networks" && -z "$snapshot" ]] || return 1
  require_expiry_guard_disarmed || return 1
  [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" &&
    ! -e "$RECHECK_RPC_ROOT" && ! -L "$RECHECK_RPC_ROOT" &&
    ! -e "$RECHECK_RECEIPT_ROOT" && ! -L "$RECHECK_RECEIPT_ROOT" &&
    ! -e "$RECHECK_PROMOTION_ROOT" && ! -L "$RECHECK_PROMOTION_ROOT" &&
    ! -e "$RECHECK_CANDIDATE_ROOT" && ! -L "$RECHECK_CANDIDATE_ROOT" &&
    ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" ]] || return 1
  require_compose5_durable_volume_compatibility || return 1
  [[ "compose5_durable_volume_digest=$OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST" == \
      "$COMPOSE5_DURABLE_VOLUME_DIGEST" &&
    "compose5_profile_config_hash=$OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH" == \
      "$COMPOSE5_PROFILE_CONFIG_HASH" &&
    "compose5_session_control_config_hash=$OBSERVED_COMPOSE5_SESSION_CONTROL_CONFIG_HASH" == \
      "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" &&
    "compose5_volume_version=$OBSERVED_COMPOSE5_VOLUME_VERSION" == "$COMPOSE5_VOLUME_VERSION" ]] ||
    return 1
  [[ ! -L "$SOURCE_BINDING" && -f "$SOURCE_BINDING" &&
    "$(realpath -- "$SOURCE_BINDING")" == "$SOURCE_BINDING" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$SOURCE_BINDING")" == '10001:10001:600:1:230' &&
    "$(wc -l <"$SOURCE_BINDING")" == '1' &&
    "$(sha256sum -- "$SOURCE_BINDING" | awk '{print $1}')" == "$BASE_BINDING_V3_SHA256" ]] ||
    return 1
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:([0-9a-f]{64}) hmac-sha256-agent-profile-pin-v3:\1$' \
    "$SOURCE_BINDING"
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-v3-recheck-bridge-v13' \
    'state=authorized' \
    "overlay_release=$HISTORICAL_OVERLAY_RELEASE" \
    "runtime_bridge_release=$RUNTIME_BRIDGE_RELEASE" \
    "parser_repair_release=$H12_RELEASE" \
    "recheck_release=$RECHECK_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "predecessor_rotation_intent_sha256=$H12_INTENT_SHA256" \
    "predecessor_rotation_completion_sha256=$H12_COMPLETION_SHA256" \
    "predecessor_rotation_helper_archive_sha256=$H12_ARCHIVE_SHA256" \
    "base_binding_v3_sha256=$BASE_BINDING_V3_SHA256" \
    "$COMPOSE5_DURABLE_VOLUME_DIGEST" \
    "$COMPOSE5_PROFILE_CONFIG_HASH" \
    "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" \
    "$COMPOSE5_VOLUME_VERSION" \
    "authorization=$CONFIRMATION" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'lookup_authorized=exact-five-profile-read-only-once' \
    'recheck_authorized=exact-five-no-transfer-once' \
    'executor_final_action_enabled=false'
}

expected_completion() {
  local intent_sha256
  intent_sha256="$(expected_intent | sha256sum | awk '{print $1}')"
  expected_intent | awk 'NR == 2 { print "state=recheck-bridge-installed"; next } { print }'
  printf 'rotation_intent_sha256=%s\n' "$intent_sha256"
}

publish_record() {
  local root="$1" name="$2" mode="$3" producer="$4"
  local temporary="$root/.$name.installing"
  if [[ -e "$root/$name" || -L "$root/$name" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    cmp -s -- "$root/$name" <("$producer") || return 1
    [[ "$(stat --format='%U:%G:%a:%h' "$root/$name")" == "root:root:$mode:1" ]] || return 1
    return 0
  fi
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
  (set -o noclobber; "$producer" >"$temporary") || return 1
  chown root:root "$temporary" || return 1
  chmod "$mode" "$temporary" || return 1
  [[ ! -L "$temporary" && "$(stat --format='%U:%G:%a:%h' "$temporary")" == \
    "root:root:$mode:1" ]] || return 1
  cmp -s -- "$temporary" <("$producer") || return 1
  sync -f "$temporary" || return 1
  mv -- "$temporary" "$root/$name" || return 1
  sync -f "$root" || return 1
  cmp -s -- "$root/$name" <("$producer")
}

copy_root_file_atomically() {
  local source="$1" partial="$2" installing="$3" source_mode="$4" final_mode="$5" digest="$6"
  require_helper_file "$source" "$digest" "$source_mode" || return 1
  if [[ ! -e "$installing" && ! -L "$installing" ]]; then
    [[ ! -e "$partial" && ! -L "$partial" ]] || return 1
    install -o root -g root -m 0600 -- "$source" "$partial" || return 1
    require_helper_file "$partial" "$digest" 600 || return 1
    chmod "$final_mode" "$partial" || return 1
    mv -- "$partial" "$installing" || return 1
    sync -f "$(dirname -- "$installing")" || return 1
  fi
  [[ ! -e "$partial" && ! -L "$partial" ]] || return 1
  require_helper_file "$installing" "$digest" "$final_mode"
}

require_exact_bridge_record() {
  local root="$1"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' &&
    "$(find -P "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  [[ "$(stat --format='%U:%G:%a:%h' "$root/intent-v1")" == 'root:root:600:1' &&
    "$(stat --format='%U:%G:%a:%h' "$root/completed-v1")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$root/intent-v1" <(expected_intent) || return 1
  cmp -s -- "$root/completed-v1" <(expected_completion) || return 1
  require_helper_file "$root/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400
}

classify_bridge() {
  local children entries
  if [[ ! -e "$BRIDGE_PARENT" && ! -L "$BRIDGE_PARENT" ]]; then
    printf '%s\n' absent
    return 0
  fi
  [[ ! -L "$BRIDGE_PARENT" && -d "$BRIDGE_PARENT" &&
    "$(realpath -- "$BRIDGE_PARENT")" == "$BRIDGE_PARENT" &&
    "$(stat --format='%U:%G:%a' "$BRIDGE_PARENT")" == 'root:root:700' ]] || return 1
  children="$(find -P "$BRIDGE_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    return 1
  case "$children" in
    '') printf '%s\n' empty-parent ;;
    ".installing-$RECHECK_RELEASE")
      [[ ! -L "$BRIDGE_INSTALLING" && -d "$BRIDGE_INSTALLING" &&
        "$(realpath -- "$BRIDGE_INSTALLING")" == "$BRIDGE_INSTALLING" &&
        "$(stat --format='%U:%G:%a' "$BRIDGE_INSTALLING")" == 'root:root:700' ]] || return 1
      entries="$(find -P "$BRIDGE_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
        return 1
      case "$entries" in
        ''|'intent-v1'|$'intent-v1\npredecessor-helper'|$'completed-v1\nintent-v1\npredecessor-helper')
          printf '%s\n' interrupted
          ;;
        *) return 1 ;;
      esac
      ;;
    "$RECHECK_RELEASE")
      require_exact_bridge_record "$BRIDGE_ROOT" || return 1
      printf '%s\n' completed
      ;;
    *) return 1 ;;
  esac
}

require_interrupted_consistency() {
  local entries
  [[ "$(classify_bridge)" == 'interrupted' ]] || return 1
  entries="$(find -P "$BRIDGE_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)"
  if [[ "$entries" == *'intent-v1'* ]]; then
    [[ "$(stat --format='%U:%G:%a:%h' "$BRIDGE_INSTALLING/intent-v1")" == 'root:root:600:1' ]] ||
      return 1
    cmp -s -- "$BRIDGE_INSTALLING/intent-v1" <(expected_intent) || return 1
  fi
  if [[ "$entries" == *'predecessor-helper'* ]]; then
    require_helper_file "$BRIDGE_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 ||
      return 1
  fi
  if [[ "$entries" == *'completed-v1'* ]]; then
    [[ "$(stat --format='%U:%G:%a:%h' "$BRIDGE_INSTALLING/completed-v1")" == 'root:root:600:1' ]] ||
      return 1
    cmp -s -- "$BRIDGE_INSTALLING/completed-v1" <(expected_completion) || return 1
    require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
  else
    if [[ "$entries" == *'predecessor-helper'* ]]; then
      require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
        require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
    else
      require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
    fi
  fi
  if [[ -e "$INSTALLING_HELPER" || -L "$INSTALLING_HELPER" ]]; then
    require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
  fi
  [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]
}

disable_sudoers() {
  require_active_grant_only || return 1
  mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
  sync -f /etc/sudoers.d || return 1
  require_disabled_grant_only
}

restore_sudoers() {
  require_disabled_grant_only || return 1
  visudo -cf "$SUDOERS_DISABLED" >/dev/null || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_active_grant_only
}

open_lock() {
  local fd_identity path_identity
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] || return 1
  if [[ ! -e "$LOCK_ROOT" && ! -L "$LOCK_ROOT" ]]; then
    (umask 077 && mkdir --mode=0700 -- "$LOCK_ROOT") || return 1
  fi
  [[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' ]] || return 1
  if [[ ! -e "$LOCK" && ! -L "$LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] || return 1
  exec 9<>"$LOCK" || return 1
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" || return 1
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" || return 1
  [[ "$fd_identity" == '0:0:600:1:'* && "$fd_identity" == "$path_identity" ]] || return 1
  flock --exclusive --nonblock 9 || return 1
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$fd_identity" ]]
}

close_lock() {
  flock --unlock 9 || return 1
  exec 9>&- || return 1
}

grant_disabled='false'
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$grant_disabled" == 'true' ]]; then
    printf '%s\n' \
      'FetanAgent H13 installation stopped with the deployment grant disabled. Rerun this exact reviewed installer; do not delete evidence or restore the grant manually.' >&2
  fi
  exit "$status"
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed H13 staging root is absent or unsafe'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged H13 successor helper is invalid'
load_exact_h12_evidence || die 'the immutable H12 parser-repair evidence is invalid'
bridge_state="$(classify_bridge)" ||
  die 'the H13 namespace is not absent, empty, an exact interrupted prefix, or completed'
case "$bridge_state" in
  absent|empty-parent)
    if require_active_grant_only; then
      grant_disabled='false'
    elif require_disabled_grant_only; then
      grant_disabled='true'
    else
      die 'the deployment grant topology is invalid before H13 installation'
    fi
    require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
      die 'the installed predecessor helper is not exact'
    ;;
  interrupted)
    require_disabled_grant_only || die 'an interrupted H13 installation must retain the disabled grant'
    require_interrupted_consistency || die 'the interrupted H13 prefix is inconsistent'
    grant_disabled='true'
    ;;
  completed)
    require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
      die 'the completed H13 helper is not exact'
    if require_disabled_grant_only; then
      grant_disabled='true'
    else
      require_active_grant_only || die 'the completed H13 deployment grant topology is invalid'
    fi
    ;;
  *) die 'the H13 bridge state is impossible' ;;
esac
require_stopped_durable_boundary ||
  die 'the stopped no-transfer Docker, retained profile, or one-use binding boundary is not exact'

if [[ "$bridge_state" =~ ^(absent|empty-parent)$ ]]; then
  run_helper_direct verify "$PREDECESSOR_HELPER_SHA256" >/dev/null ||
    die 'the H12 helper rejected its reviewed digest'
  run_helper_direct kemerbet-v3-runtime-bridge-ready "$PREDECESSOR_HELPER_SHA256" >/dev/null ||
    die 'the H12 helper rejected the immutable runtime bridge'
fi

trap cleanup EXIT
open_lock || die 'the exact staging mutation lock is unsafe or another mutation is active'
require_no_other_mutator_processes || die 'another helper or H13 mutation process is active'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed under lock'
load_exact_h12_evidence || die 'the immutable H12 evidence changed under lock'
require_stopped_durable_boundary || die 'the stopped no-transfer boundary changed under lock'

if [[ "$grant_disabled" == 'false' ]]; then
  disable_sudoers || die 'the deployment grant could not be disabled safely'
  grant_disabled='true'
fi

if [[ "$bridge_state" == 'absent' ]]; then
  install -d -o root -g root -m 0700 "$BRIDGE_PARENT"
  sync -f "$(dirname -- "$BRIDGE_PARENT")"
  bridge_state='empty-parent'
fi
if [[ "$bridge_state" == 'empty-parent' ]]; then
  [[ -z "$(find -P "$BRIDGE_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] ||
    die 'the H13 parent changed before initialization'
  install -d -o root -g root -m 0700 "$BRIDGE_INSTALLING"
  sync -f "$BRIDGE_PARENT"
  bridge_state='interrupted'
fi

if [[ "$bridge_state" == 'completed' ]]; then
  require_exact_bridge_record "$BRIDGE_ROOT" || die 'the completed H13 record changed under lock'
else
  require_interrupted_consistency || die 'the interrupted H13 prefix changed under lock'
  publish_record "$BRIDGE_INSTALLING" intent-v1 600 expected_intent ||
    die 'the H13 authorization record could not be published atomically'
  if [[ ! -e "$BRIDGE_INSTALLING/predecessor-helper" &&
    ! -L "$BRIDGE_INSTALLING/predecessor-helper" ]]; then
    copy_root_file_atomically "$TARGET" \
      "$BRIDGE_INSTALLING/.predecessor-helper.partial" \
      "$BRIDGE_INSTALLING/predecessor-helper" 755 400 "$PREDECESSOR_HELPER_SHA256" ||
      die 'the H12 helper archive could not be completed atomically'
  fi
  require_helper_file "$BRIDGE_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 ||
    die 'the archived H12 helper is invalid'
  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    copy_root_file_atomically "$STAGED_HELPER" "$INSTALLING_HELPER_PARTIAL" \
      "$INSTALLING_HELPER" 600 755 "$SUCCESSOR_HELPER_SHA256" ||
      die 'the H13 helper installer could not be completed atomically'
    mv -- "$INSTALLING_HELPER" "$TARGET"
    sync -f /usr/local/sbin
  fi
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
    die 'the installed H13 helper is invalid'
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
    die 'an H13 helper installer residue remains'
  publish_record "$BRIDGE_INSTALLING" completed-v1 600 expected_completion ||
    die 'the H13 completion record could not be published atomically'
  require_exact_bridge_record "$BRIDGE_INSTALLING" ||
    die 'the completed installing H13 record is invalid'
  [[ ! -e "$BRIDGE_ROOT" && ! -L "$BRIDGE_ROOT" ]] ||
    die 'the final H13 root appeared unexpectedly'
  mv -- "$BRIDGE_INSTALLING" "$BRIDGE_ROOT"
  sync -f "$BRIDGE_PARENT"
  bridge_state='completed'
  require_exact_bridge_record "$BRIDGE_ROOT" || die 'the final H13 record is invalid'
fi

close_lock
run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the installed H13 helper rejected its reviewed digest'
run_helper_direct kemerbet-v3-recheck-bridge-ready "$SUCCESSOR_HELPER_SHA256" "$RECHECK_RELEASE" >/dev/null ||
  die 'the installed helper rejected the exact H13 recheck bridge'
require_stopped_durable_boundary ||
  die 'the stopped no-transfer boundary changed after H13 attestation'

open_lock || die 'the exact staging mutation lock changed before grant restoration'
require_no_other_mutator_processes || die 'another helper or H13 mutation process appeared'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed before grant restoration'
load_exact_h12_evidence || die 'the immutable H12 evidence changed before grant restoration'
[[ "$(classify_bridge)" == 'completed' ]] || die 'the completed H13 namespace disappeared'
require_exact_bridge_record "$BRIDGE_ROOT" || die 'the H13 record changed before grant restoration'
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the installed H13 helper changed before grant restoration'
require_stopped_durable_boundary ||
  die 'the stopped no-transfer boundary changed before grant restoration'
if [[ "$grant_disabled" == 'true' ]]; then
  restore_sudoers || die 'the deployment grant could not be restored safely'
  grant_disabled='false'
else
  require_active_grant_only || die 'the active deployment grant changed unexpectedly'
fi
close_lock
trap - EXIT

printf '%s\n' \
  'KemerBet H13 exact-five recheck bridge installed or validated: lookup-only once; Transfer disabled.'
