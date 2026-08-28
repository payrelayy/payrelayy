#!/usr/bin/env bash
# Root-console-only, one-use repair of the H11 helper parser-scope defect. The exact
# completed H11 bridge remains immutable. This operation appends H12 provenance,
# archives the H11 helper, and installs only the reviewed corrected helper. It accepts
# exact monotonic interruption prefixes and performs no lookup, recheck, deposit,
# transfer, withdrawal, executor action, or financial action.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly HISTORICAL_OVERLAY_RELEASE='c061f9dc05e60d641d306f16b5d826e6e1b2c6c4'
readonly REVIEWED_BRIDGE_RELEASE='21ef5f0d987d9dc21efc1a81916316a3f6d7f864'
readonly H10_HELPER_SHA256='73eabc728bc25462ab96d17dc8faa5775526571caae9d2ab0265f523b84a387e'
readonly H10_PREDECESSOR_ARCHIVE_SHA256='d3284d1c268fdba227ff5628f2ac28f9e30375a8a85517e06258a97dfab5e4e1'
readonly PREDECESSOR_HELPER_SHA256='8696fd6d606b7c3440ab180e9d409bb113da2ba14434752b47fca07e34a09728'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='9f9c7f124820c1c8c8aabbe411de5ccc0d914bf7f4696904d6ba557eee62b3da'
readonly CONFIRMATION='I-UNDERSTAND-THIS-INSTALLS-ONE-H12-PARSER-SCOPE-REPAIR-WITH-TRANSFER-DISABLED'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v3-runtime-bridge-v11-disabled'
readonly ROTATION_V10_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v10'
readonly ROTATION_V10_ROOT="$ROTATION_V10_PARENT/$HISTORICAL_OVERLAY_RELEASE"
readonly ROTATION_V11_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v11'
readonly ROTATION_V11_ROOT="$ROTATION_V11_PARENT/$REVIEWED_BRIDGE_RELEASE"
readonly ROTATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v12'
readonly SOURCE_BINDING='/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
readonly PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly SESSION_CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly KEMERBET_RECHECK_SNAPSHOT_VOLUME="$PROJECT_NAME-kemerbet-readiness-profile-snapshot-once"
readonly KEMERBET_RECHECK_RPC_ROOT='/run/fetanagent-kemerbet-readiness-rpc-v1'
readonly BOT_STARTUP_RECEIPT_ROOT='/var/lib/fetanagent-bot-startup-receipt'
readonly EXPIRY_STOP_SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly EXPIRY_STOP_TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly EXPIRY_STOP_SERVICE_PATH="/etc/systemd/system/$EXPIRY_STOP_SERVICE"
readonly EXPIRY_STOP_TIMER_PATH="/etc/systemd/system/$EXPIRY_STOP_TIMER"
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-parser-scope-repair-v12-installing'
readonly INSTALLING_HELPER_PARTIAL='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-parser-scope-repair-v12-installing.partial'
readonly ORIGINAL_PROMOTION_BASENAME='fetanagent-kemerbet-v3-runtime-bridge-helper-promotion-v11.sh'
readonly RECOVERY_BASENAME='fetanagent-kemerbet-v3-runtime-bridge-helper-promotion-v11-empty-checkpoint-recovery.sh'
readonly REPAIR_BASENAME='fetanagent-kemerbet-v3-runtime-bridge-parser-scope-repair-v12.sh'

export PATH="$SAFE_PATH"
umask 022

die() {
  printf 'FetanAgent H12 parser-scope repair failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the repair release, reviewed helper digest, and exact H12 confirmation'
readonly REPAIR_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly STAGING_ROOT="/root/fetanagent-v3-parser-scope-repair-v12-$REPAIR_RELEASE"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly ROTATION_ROOT="$ROTATION_PARENT/$REPAIR_RELEASE"
readonly ROTATION_INSTALLING="$ROTATION_PARENT/.installing-$REPAIR_RELEASE"

[[ "$REPAIR_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$REPAIR_RELEASE" != "$REVIEWED_BRIDGE_RELEASE" &&
  "$REPAIR_RELEASE" != "$HISTORICAL_OVERLAY_RELEASE" ]] ||
  die 'the repair release must be a distinct full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct hard-pinned reviewed H12 artifact'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] || die 'the exact H12 confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this repair only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl docker env find flock id install mkdir mv python3 \
  realpath seq sha256sum sort stat sync systemctl visudo; do
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
      case "$basename" in
        "$ORIGINAL_PROMOTION_BASENAME"|"$RECOVERY_BASENAME"|"$REPAIR_BASENAME") return 1 ;;
      esac
    done <"$cmdline" || true
  done
}

H10_INTENT_SHA256=''
H10_COMPLETION_SHA256=''
H10_ARCHIVE_SHA256=''
BASE_BINDING_V3_SHA256=''
COMPOSE5_DURABLE_VOLUME_DIGEST=''
COMPOSE5_PROFILE_CONFIG_HASH=''
COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
COMPOSE5_VOLUME_VERSION=''

load_exact_h10_evidence() {
  local archive completion index intent
  local -a intent_lines completion_lines
  [[ ! -L "$ROTATION_V10_PARENT" && -d "$ROTATION_V10_PARENT" &&
    "$(realpath -- "$ROTATION_V10_PARENT")" == "$ROTATION_V10_PARENT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_V10_PARENT")" == 'root:root:700' &&
    "$(find -P "$ROTATION_V10_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
      "$HISTORICAL_OVERLAY_RELEASE" ]] || return 1
  [[ ! -L "$ROTATION_V10_ROOT" && -d "$ROTATION_V10_ROOT" &&
    "$(realpath -- "$ROTATION_V10_ROOT")" == "$ROTATION_V10_ROOT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_V10_ROOT")" == 'root:root:700' &&
    "$(find -P "$ROTATION_V10_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  intent="$ROTATION_V10_ROOT/intent-v1"
  completion="$ROTATION_V10_ROOT/completed-v1"
  archive="$ROTATION_V10_ROOT/predecessor-helper"
  [[ ! -L "$intent" && -f "$intent" && "$(realpath -- "$intent")" == "$intent" &&
    "$(stat --format='%U:%G:%a:%h' "$intent")" == 'root:root:600:1' ]] || return 1
  [[ ! -L "$completion" && -f "$completion" && "$(realpath -- "$completion")" == "$completion" &&
    "$(stat --format='%U:%G:%a:%h' "$completion")" == 'root:root:600:1' ]] || return 1
  require_helper_file "$archive" "$H10_PREDECESSOR_ARCHIVE_SHA256" 400 || return 1
  mapfile -t intent_lines <"$intent"
  mapfile -t completion_lines <"$completion"
  [[ "${#intent_lines[@]}" -eq 18 && "${#completion_lines[@]}" -eq 19 &&
    "${intent_lines[0]}" == 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v10' &&
    "${intent_lines[1]}" == 'state=authorized' &&
    "${intent_lines[3]}" == "successor_release=$HISTORICAL_OVERLAY_RELEASE" &&
    "${intent_lines[5]}" == "successor_helper_sha256=$H10_HELPER_SHA256" &&
    "${intent_lines[10]}" =~ ^base_binding_v3_sha256=[0-9a-f]{64}$ &&
    "${intent_lines[14]}" =~ ^compose5_durable_volume_digest=[0-9a-f]{64}$ &&
    "${intent_lines[15]}" =~ ^compose5_profile_config_hash=[0-9a-f]{64}$ &&
    "${intent_lines[16]}" =~ ^compose5_session_control_config_hash=[0-9a-f]{64}$ &&
    "${intent_lines[17]}" =~ ^compose5_volume_version=[0-9]+\.[0-9]+\.[0-9]+ &&
    "${completion_lines[0]}" == "${intent_lines[0]}" &&
    "${completion_lines[1]}" == 'state=successor-installed' ]] || return 1
  for index in $(seq 2 17); do
    [[ "${completion_lines[$index]}" == "${intent_lines[$index]}" ]] || return 1
  done
  H10_INTENT_SHA256="$(sha256sum -- "$intent" | awk '{print $1}')"
  H10_COMPLETION_SHA256="$(sha256sum -- "$completion" | awk '{print $1}')"
  H10_ARCHIVE_SHA256="$(sha256sum -- "$archive" | awk '{print $1}')"
  [[ "${completion_lines[18]}" == "rotation_intent_sha256=$H10_INTENT_SHA256" ]] || return 1
  BASE_BINDING_V3_SHA256="${intent_lines[10]#base_binding_v3_sha256=}"
  COMPOSE5_DURABLE_VOLUME_DIGEST="${intent_lines[14]}"
  COMPOSE5_PROFILE_CONFIG_HASH="${intent_lines[15]}"
  COMPOSE5_SESSION_CONTROL_CONFIG_HASH="${intent_lines[16]}"
  COMPOSE5_VOLUME_VERSION="${intent_lines[17]}"
}

H11_INTENT_SHA256=''
H11_COMPLETION_SHA256=''
H11_ARCHIVE_SHA256=''

load_exact_h11_evidence() {
  local archive completion index intent
  local -a intent_lines completion_lines
  [[ "$H10_INTENT_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$H10_COMPLETION_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$H10_ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ ! -L "$ROTATION_V11_PARENT" && -d "$ROTATION_V11_PARENT" &&
    "$(realpath -- "$ROTATION_V11_PARENT")" == "$ROTATION_V11_PARENT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_V11_PARENT")" == 'root:root:700' &&
    "$(find -P "$ROTATION_V11_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
      "$REVIEWED_BRIDGE_RELEASE" ]] || return 1
  [[ ! -L "$ROTATION_V11_ROOT" && -d "$ROTATION_V11_ROOT" &&
    "$(realpath -- "$ROTATION_V11_ROOT")" == "$ROTATION_V11_ROOT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_V11_ROOT")" == 'root:root:700' &&
    "$(find -P "$ROTATION_V11_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  intent="$ROTATION_V11_ROOT/intent-v1"
  completion="$ROTATION_V11_ROOT/completed-v1"
  archive="$ROTATION_V11_ROOT/predecessor-helper"
  [[ ! -L "$intent" && -f "$intent" && "$(realpath -- "$intent")" == "$intent" &&
    "$(stat --format='%U:%G:%a:%h' "$intent")" == 'root:root:600:1' ]] || return 1
  [[ ! -L "$completion" && -f "$completion" &&
    "$(realpath -- "$completion")" == "$completion" &&
    "$(stat --format='%U:%G:%a:%h' "$completion")" == 'root:root:600:1' ]] || return 1
  require_helper_file "$archive" "$H10_HELPER_SHA256" 400 || return 1
  mapfile -t intent_lines <"$intent"
  mapfile -t completion_lines <"$completion"
  [[ "${#intent_lines[@]}" -eq 21 && "${#completion_lines[@]}" -eq 22 &&
    "${intent_lines[0]}" == 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v11' &&
    "${intent_lines[1]}" == 'state=authorized' &&
    "${intent_lines[2]}" == "overlay_release=$HISTORICAL_OVERLAY_RELEASE" &&
    "${intent_lines[3]}" == "bridge_release=$REVIEWED_BRIDGE_RELEASE" &&
    "${intent_lines[4]}" == "predecessor_helper_sha256=$H10_HELPER_SHA256" &&
    "${intent_lines[5]}" == "successor_helper_sha256=$PREDECESSOR_HELPER_SHA256" &&
    "${intent_lines[6]}" == "predecessor_rotation_intent_sha256=$H10_INTENT_SHA256" &&
    "${intent_lines[7]}" == "predecessor_rotation_completion_sha256=$H10_COMPLETION_SHA256" &&
    "${intent_lines[8]}" == "predecessor_rotation_helper_archive_sha256=$H10_ARCHIVE_SHA256" &&
    "${intent_lines[9]}" == "base_binding_v3_sha256=$BASE_BINDING_V3_SHA256" &&
    "${intent_lines[10]}" == "$COMPOSE5_DURABLE_VOLUME_DIGEST" &&
    "${intent_lines[11]}" == "$COMPOSE5_PROFILE_CONFIG_HASH" &&
    "${intent_lines[12]}" == "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" &&
    "${intent_lines[13]}" == "$COMPOSE5_VOLUME_VERSION" &&
    "${intent_lines[14]}" == 'transition=historical-overlay-current-runtime-separated-v1' &&
    "${intent_lines[15]}" == 'financial_actions_mode=dry_run' &&
    "${intent_lines[16]}" == 'kemerbet_executor_enabled=false' &&
    "${intent_lines[17]}" == 'kemerbet_final_action_enabled=false' &&
    "${intent_lines[18]}" == 'transfer_enabled=false' &&
    "${intent_lines[19]}" == 'lookup_authorized=false' &&
    "${intent_lines[20]}" == 'recheck_authorized=false' &&
    "${completion_lines[0]}" == "${intent_lines[0]}" &&
    "${completion_lines[1]}" == 'state=runtime-bridge-installed' ]] || return 1
  for index in $(seq 2 20); do
    [[ "${completion_lines[$index]}" == "${intent_lines[$index]}" ]] || return 1
  done
  H11_INTENT_SHA256="$(sha256sum -- "$intent" | awk '{print $1}')"
  H11_COMPLETION_SHA256="$(sha256sum -- "$completion" | awk '{print $1}')"
  H11_ARCHIVE_SHA256="$(sha256sum -- "$archive" | awk '{print $1}')"
  [[ "$H11_ARCHIVE_SHA256" == "$H10_HELPER_SHA256" &&
    "${completion_lines[21]}" == "rotation_intent_sha256=$H11_INTENT_SHA256" ]]
}

OBSERVED_COMPOSE5_DURABLE_VOLUME_DIGEST=''
OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH=''
OBSERVED_COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
OBSERVED_COMPOSE5_VOLUME_VERSION=''

require_compose5_durable_volume_compatibility() {
  local compose_config_hash compose_version contract control_contract driver expected_volumes
  local expected_volume_label holders label_count mountpoint name options profile_contract
  local project project_volumes residue scope volume volume_label
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
      --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{json .Options}}|{{len .Labels}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.version" }}|{{ index .Labels "com.docker.compose.volume" }}|{{with index .Labels "com.docker.compose.config-hash"}}{{.}}{{end}}|{{.Mountpoint}}')" ||
      return 1
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
    holders="$(docker_local_read_only container ls --all --quiet --filter "volume=$volume")" ||
      return 1
    [[ -z "$holders" ]] || return 1
    case "$volume" in
      "$PROFILE_VOLUME")
        [[ "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] || return 1
        OBSERVED_COMPOSE5_PROFILE_CONFIG_HASH="$compose_config_hash"
        profile_contract="$contract"
        ;;
      "$SESSION_CONTROL_VOLUME")
        [[ "$(stat --format='%u:%g:%a:%h' "$mountpoint")" == '10001:10001:700:2' ]] ||
          return 1
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
  load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)" ||
    return 1
  [[ "$load_state" == 'not-found' ]]
}

require_no_recheck_transients() {
  local value
  value="$(docker_local_read_only volume ls --quiet \
    --filter "name=^${KEMERBET_RECHECK_SNAPSHOT_VOLUME}$")" || return 1
  [[ -z "$value" && ! -e "$KEMERBET_RECHECK_RPC_ROOT" && ! -L "$KEMERBET_RECHECK_RPC_ROOT" ]]
}

require_stopped_durable_boundary() {
  local containers networks
  containers="$(docker_local_read_only container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  networks="$(docker_local_read_only network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  [[ -z "$containers" && -z "$networks" ]] || return 1
  require_expiry_guard_disarmed || return 1
  require_no_recheck_transients || return 1
  [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] || return 1
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
    "$(sha256sum -- "$SOURCE_BINDING" | awk '{print $1}')" == "$BASE_BINDING_V3_SHA256" ]]
}

require_exact_h11_repair_boundary() {
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  load_exact_h10_evidence || return 1
  load_exact_h11_evidence || return 1
  require_disabled_grant_only || return 1
  require_stopped_durable_boundary
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v12' \
    'state=authorized' \
    "overlay_release=$HISTORICAL_OVERLAY_RELEASE" \
    "runtime_bridge_release=$REVIEWED_BRIDGE_RELEASE" \
    "repair_release=$REPAIR_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "predecessor_rotation_intent_sha256=$H11_INTENT_SHA256" \
    "predecessor_rotation_completion_sha256=$H11_COMPLETION_SHA256" \
    "predecessor_rotation_helper_archive_sha256=$H11_ARCHIVE_SHA256" \
    "base_binding_v3_sha256=$BASE_BINDING_V3_SHA256" \
    "$COMPOSE5_DURABLE_VOLUME_DIGEST" \
    "$COMPOSE5_PROFILE_CONFIG_HASH" \
    "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" \
    "$COMPOSE5_VOLUME_VERSION" \
    'transition=runtime-bridge-parser-scope-repair-v1' \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'lookup_authorized=false' \
    'recheck_authorized=false'
}

expected_completion() {
  local intent_sha256
  intent_sha256="$(expected_intent | sha256sum | awk '{print $1}')"
  expected_intent | awk 'NR == 2 { print "state=parser-repair-installed"; next } { print }'
  printf 'rotation_intent_sha256=%s\n' "$intent_sha256"
}

publish_record() {
  local root="$1" name="$2" mode="$3" producer="$4" expected expected_fd status
  expected="$("$producer")" || return 1
  exec {expected_fd}< <(printf '%s\n' "$expected") || return 1
  env -i PATH="$SAFE_PATH" python3 -I - "$root" "$name" "$mode" "$expected_fd" <<'PY'
import os
import stat
import sys

root, target, mode_text, expected_fd_text = sys.argv[1:]
if target not in ('intent-v1', 'completed-v1'):
    raise RuntimeError()
mode = int(mode_text, 8)
expected_fd = int(expected_fd_text)
expected = bytearray()
while len(expected) <= 4096:
    chunk = os.read(expected_fd, 4097 - len(expected))
    if not chunk:
        break
    expected.extend(chunk)
expected = bytes(expected)
if not expected or len(expected) > 4096 or not expected.endswith(b'\n'):
    raise RuntimeError()


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            raise RuntimeError()
        offset += written


def read_bounded(descriptor, maximum):
    data = bytearray()
    while len(data) <= maximum:
        chunk = os.read(descriptor, maximum + 1 - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    directory_before = os.fstat(directory)
    if (
        not stat.S_ISDIR(directory_before.st_mode)
        or (directory_before.st_uid, directory_before.st_gid,
            stat.S_IMODE(directory_before.st_mode)) != (0, 0, 0o700)
    ):
        raise RuntimeError()
    temporary = f'.{target}.installing'
    entries = os.listdir(directory)
    if target in entries:
        if temporary in entries:
            raise RuntimeError()
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                             dir_fd=directory)
        try:
            value = os.fstat(descriptor)
            data = read_bounded(descriptor, len(expected))
        finally:
            os.close(descriptor)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) !=
               (0, 0, mode, 1)
            or data != expected
        ):
            raise RuntimeError()
    else:
        if temporary in entries:
            descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
                                 dir_fd=directory)
            try:
                value = os.fstat(descriptor)
                existing = read_bounded(descriptor, len(expected))
                if (
                    not stat.S_ISREG(value.st_mode)
                    or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode),
                        value.st_nlink) != (0, 0, mode, 1)
                    or not expected.startswith(existing)
                ):
                    raise RuntimeError()
                os.lseek(descriptor, len(existing), os.SEEK_SET)
                write_all(descriptor, expected[len(existing):])
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        else:
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                mode,
                dir_fd=directory,
            )
            try:
                os.fchmod(descriptor, mode)
                write_all(descriptor, expected)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        os.rename(temporary, target, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    directory_after = os.fstat(directory)
    if (
        (directory_before.st_dev, directory_before.st_ino, directory_before.st_mode,
         directory_before.st_uid, directory_before.st_gid) !=
        (directory_after.st_dev, directory_after.st_ino, directory_after.st_mode,
         directory_after.st_uid, directory_after.st_gid)
    ):
        raise RuntimeError()
finally:
    os.close(directory)
PY
  status=$?
  exec {expected_fd}<&-
  return "$status"
}

copy_root_file_atomically() {
  local source="$1" temporary="$2" target="$3" source_mode="$4" target_mode="$5"
  local expected_digest="$6"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$temporary" "$target" "$source_mode" "$target_mode" "$expected_digest" <<'PY'
import hashlib
import os
import stat
import sys

source, temporary, target, source_mode_text, target_mode_text, expected_digest = sys.argv[1:]
source_mode = int(source_mode_text, 8)
target_mode = int(target_mode_text, 8)


def reject():
    raise RuntimeError()


def write_all(descriptor, data):
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            reject()
        offset += written


def read_bounded(descriptor, maximum):
    data = bytearray()
    while len(data) <= maximum:
        chunk = os.read(descriptor, maximum + 1 - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    before = os.fstat(descriptor)
    named = os.lstat(source)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink) !=
           (0, 0, source_mode, 1)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or before.st_size > 2 * 1024 * 1024
        or os.path.realpath(source) != source
    ):
        reject()
    data = bytearray()
    while len(data) <= 2 * 1024 * 1024:
        chunk = os.read(descriptor, 65536)
        if not chunk:
            break
        data.extend(chunk)
    after = os.fstat(descriptor)
    named_after = os.lstat(source)
    if (
        (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
         before.st_nlink, before.st_size, before.st_mtime_ns) !=
        (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
         after.st_nlink, after.st_size, after.st_mtime_ns)
        or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        or hashlib.sha256(data).hexdigest() != expected_digest
    ):
        reject()
finally:
    os.close(descriptor)

if os.path.lexists(target):
    reject()
if os.path.lexists(temporary):
    descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        existing = read_bounded(descriptor, len(data))
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) !=
               (0, 0, target_mode, 1)
            or not bytes(data).startswith(existing)
        ):
            reject()
        os.lseek(descriptor, len(existing), os.SEEK_SET)
        write_all(descriptor, bytes(data[len(existing):]))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
else:
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        target_mode,
    )
    try:
        os.fchmod(descriptor, target_mode)
        write_all(descriptor, bytes(data))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
os.rename(temporary, target)
directory = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

classify_rotation() {
  env -i PATH="$SAFE_PATH" python3 -I - "$ROTATION_PARENT" "$REPAIR_RELEASE" <<'PY'
import os
import stat
import sys

parent, release = sys.argv[1:]
if not os.path.lexists(parent):
    print('absent')
    raise SystemExit(0)
value = os.lstat(parent)
if (
    not stat.S_ISDIR(value.st_mode)
    or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
    or os.path.realpath(parent) != parent
):
    raise SystemExit(1)
entries = sorted(os.listdir(parent))
if entries == []:
    print('empty-parent')
elif entries == [f'.installing-{release}']:
    print('interrupted')
elif entries == [release]:
    print('completed')
else:
    raise SystemExit(1)
PY
}

require_rotation_prefix() {
  env -i PATH="$SAFE_PATH" python3 -I - "$ROTATION_INSTALLING" <<'PY'
import os
import stat
import sys

root = sys.argv[1]
allowed = {
    '.completed-v1.installing': (0o600, 4096),
    '.intent-v1.installing': (0o600, 4096),
    '.predecessor-helper.installing': (0o400, 2 * 1024 * 1024),
    'completed-v1': (0o600, 4096),
    'intent-v1': (0o600, 4096),
    'predecessor-helper': (0o400, 2 * 1024 * 1024),
}
value = os.lstat(root)
if (
    not stat.S_ISDIR(value.st_mode)
    or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
    or os.path.realpath(root) != root
):
    raise SystemExit(1)
entries = os.listdir(root)
if any(name not in allowed for name in entries):
    raise SystemExit(1)
for final in ('intent-v1', 'predecessor-helper', 'completed-v1'):
    if final in entries and f'.{final}.installing' in entries:
        raise SystemExit(1)
for name in entries:
    mode, maximum = allowed[name]
    item = os.lstat(f'{root}/{name}')
    if (
        not stat.S_ISREG(item.st_mode)
        or (item.st_uid, item.st_gid, stat.S_IMODE(item.st_mode), item.st_nlink) !=
           (0, 0, mode, 1)
        or item.st_size > maximum
    ):
        raise SystemExit(1)
PY
}

require_record_prefix() {
  local final="$1" temporary="$2" mode="$3" producer="$4" size
  if [[ -e "$final" || -L "$final" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" && ! -L "$final" && -f "$final" &&
      "$(realpath -- "$final")" == "$final" &&
      "$(stat --format='%U:%G:%a:%h' "$final")" == "root:root:$mode:1" ]] || return 1
    cmp -s -- "$final" <("$producer")
    return
  fi
  if [[ -e "$temporary" || -L "$temporary" ]]; then
    [[ ! -L "$temporary" && -f "$temporary" && "$(realpath -- "$temporary")" == "$temporary" &&
      "$(stat --format='%U:%G:%a:%h' "$temporary")" == "root:root:$mode:1" ]] || return 1
    size="$(stat --format='%s' "$temporary")" || return 1
    [[ "$size" -le 4096 ]] || return 1
    cmp -n "$size" -s -- "$temporary" <("$producer")
  fi
}

require_copy_prefix() {
  local candidate="$1" source="$2" candidate_mode="$3" source_mode="$4" digest="$5" size
  require_helper_file "$source" "$digest" "$source_mode" || return 1
  [[ ! -L "$candidate" && -f "$candidate" && "$(realpath -- "$candidate")" == "$candidate" &&
    "$(stat --format='%U:%G:%a:%h' "$candidate")" == "root:root:$candidate_mode:1" ]] || return 1
  size="$(stat --format='%s' "$candidate")" || return 1
  [[ "$size" -le "$(stat --format='%s' "$source")" ]] || return 1
  cmp -n "$size" -s -- "$candidate" "$source"
}

require_interrupted_prefix_consistency() {
  local target_state=''
  require_rotation_prefix || return 1
  require_disabled_grant_only || return 1
  require_record_prefix "$ROTATION_INSTALLING/intent-v1" \
    "$ROTATION_INSTALLING/.intent-v1.installing" 600 expected_intent || return 1
  require_record_prefix "$ROTATION_INSTALLING/completed-v1" \
    "$ROTATION_INSTALLING/.completed-v1.installing" 600 expected_completion || return 1
  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    target_state='predecessor'
  elif require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
    target_state='successor'
  else
    return 1
  fi

  if [[ ! -e "$ROTATION_INSTALLING/intent-v1" && ! -L "$ROTATION_INSTALLING/intent-v1" ]]; then
    [[ "$target_state" == 'predecessor' &&
      ! -e "$ROTATION_INSTALLING/predecessor-helper" &&
      ! -L "$ROTATION_INSTALLING/predecessor-helper" &&
      ! -e "$ROTATION_INSTALLING/.predecessor-helper.installing" &&
      ! -L "$ROTATION_INSTALLING/.predecessor-helper.installing" &&
      ! -e "$ROTATION_INSTALLING/completed-v1" && ! -L "$ROTATION_INSTALLING/completed-v1" &&
      ! -e "$ROTATION_INSTALLING/.completed-v1.installing" &&
      ! -L "$ROTATION_INSTALLING/.completed-v1.installing" &&
      ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
      ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
    return 0
  fi

  [[ ! -e "$ROTATION_INSTALLING/.intent-v1.installing" &&
    ! -L "$ROTATION_INSTALLING/.intent-v1.installing" ]] || return 1
  if [[ -e "$ROTATION_INSTALLING/.predecessor-helper.installing" ||
    -L "$ROTATION_INSTALLING/.predecessor-helper.installing" ]]; then
    [[ "$target_state" == 'predecessor' &&
      ! -e "$ROTATION_INSTALLING/predecessor-helper" &&
      ! -L "$ROTATION_INSTALLING/predecessor-helper" &&
      ! -e "$ROTATION_INSTALLING/completed-v1" && ! -L "$ROTATION_INSTALLING/completed-v1" &&
      ! -e "$ROTATION_INSTALLING/.completed-v1.installing" &&
      ! -L "$ROTATION_INSTALLING/.completed-v1.installing" &&
      ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
      ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
    require_copy_prefix "$ROTATION_INSTALLING/.predecessor-helper.installing" \
      "$TARGET" 400 755 "$PREDECESSOR_HELPER_SHA256"
    return
  fi
  if [[ ! -e "$ROTATION_INSTALLING/predecessor-helper" &&
    ! -L "$ROTATION_INSTALLING/predecessor-helper" ]]; then
    [[ "$target_state" == 'predecessor' &&
      ! -e "$ROTATION_INSTALLING/completed-v1" && ! -L "$ROTATION_INSTALLING/completed-v1" &&
      ! -e "$ROTATION_INSTALLING/.completed-v1.installing" &&
      ! -L "$ROTATION_INSTALLING/.completed-v1.installing" &&
      ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
      ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]
    return
  fi
  require_helper_file "$ROTATION_INSTALLING/predecessor-helper" \
    "$PREDECESSOR_HELPER_SHA256" 400 || return 1

  if [[ "$target_state" == 'predecessor' ]]; then
    [[ ! -e "$ROTATION_INSTALLING/completed-v1" && ! -L "$ROTATION_INSTALLING/completed-v1" &&
      ! -e "$ROTATION_INSTALLING/.completed-v1.installing" &&
      ! -L "$ROTATION_INSTALLING/.completed-v1.installing" ]] || return 1
    [[ ! ( -e "$INSTALLING_HELPER" || -L "$INSTALLING_HELPER" ) ||
      ! ( -e "$INSTALLING_HELPER_PARTIAL" || -L "$INSTALLING_HELPER_PARTIAL" ) ]] || return 1
    if [[ -e "$INSTALLING_HELPER" || -L "$INSTALLING_HELPER" ]]; then
      require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
    elif [[ -e "$INSTALLING_HELPER_PARTIAL" || -L "$INSTALLING_HELPER_PARTIAL" ]]; then
      require_copy_prefix "$INSTALLING_HELPER_PARTIAL" "$STAGED_HELPER" 755 600 \
        "$SUCCESSOR_HELPER_SHA256" || return 1
    fi
    return 0
  fi

  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]
}

require_exact_rotation_record() {
  local root="$1"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' &&
    "$(find -P "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
      $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  [[ ! -L "$root/intent-v1" && -f "$root/intent-v1" &&
    "$(stat --format='%U:%G:%a:%h' "$root/intent-v1")" == 'root:root:600:1' ]] || return 1
  [[ ! -L "$root/completed-v1" && -f "$root/completed-v1" &&
    "$(stat --format='%U:%G:%a:%h' "$root/completed-v1")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$root/intent-v1" <(expected_intent) || return 1
  cmp -s -- "$root/completed-v1" <(expected_completion) || return 1
  require_helper_file "$root/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400
}

require_initial_namespace() {
  local expected_state="$1"
  case "$expected_state" in
    absent)
      [[ ! -e "$ROTATION_PARENT" && ! -L "$ROTATION_PARENT" ]] || return 1
      ;;
    empty-parent)
      [[ ! -L "$ROTATION_PARENT" && -d "$ROTATION_PARENT" &&
        "$(realpath -- "$ROTATION_PARENT")" == "$ROTATION_PARENT" &&
        "$(stat --format='%U:%G:%a' "$ROTATION_PARENT")" == 'root:root:700' &&
        -z "$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] ||
        return 1
      ;;
    *) return 1 ;;
  esac
  [[ ! -e "$ROTATION_INSTALLING" && ! -L "$ROTATION_INSTALLING" &&
    ! -e "$ROTATION_ROOT" && ! -L "$ROTATION_ROOT" &&
    ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
  require_exact_h11_repair_boundary
}

require_exact_empty_checkpoint() {
  [[ ! -L "$ROTATION_PARENT" && -d "$ROTATION_PARENT" &&
    "$(realpath -- "$ROTATION_PARENT")" == "$ROTATION_PARENT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_PARENT")" == 'root:root:700' &&
    "$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
      ".installing-$REPAIR_RELEASE" ]] || return 1
  [[ ! -L "$ROTATION_INSTALLING" && -d "$ROTATION_INSTALLING" &&
    "$(realpath -- "$ROTATION_INSTALLING")" == "$ROTATION_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_INSTALLING")" == 'root:root:700' &&
    -z "$(find -P "$ROTATION_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] || return 1
  [[ ! -e "$ROTATION_ROOT" && ! -L "$ROTATION_ROOT" &&
    ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
  require_disabled_grant_only || return 1
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755
}

require_exact_completed_namespace() {
  [[ ! -L "$ROTATION_PARENT" && -d "$ROTATION_PARENT" &&
    "$(realpath -- "$ROTATION_PARENT")" == "$ROTATION_PARENT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_PARENT")" == 'root:root:700' &&
    "$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
      "$REPAIR_RELEASE" ]] || return 1
  [[ ! -e "$ROTATION_INSTALLING" && ! -L "$ROTATION_INSTALLING" &&
    ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
  require_exact_rotation_record "$ROTATION_ROOT" || return 1
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755
}

restore_sudoers() {
  require_disabled_grant_only || return 1
  visudo -cf "$SUDOERS_DISABLED" >/dev/null || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  if sync -f /etc/sudoers.d && require_exact_sudoers_file "$SUDOERS" &&
    [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] &&
    visudo -cf /etc/sudoers >/dev/null; then
    return 0
  fi
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" &&
    -e "$SUDOERS" && ! -L "$SUDOERS" ]] && require_exact_sudoers_file "$SUDOERS"; then
    mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
    sync -f /etc/sudoers.d || return 1
    require_disabled_grant_only || return 1
  fi
  return 1
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
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" || {
    exec 9>&-
    return 1
  }
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" || {
    exec 9>&-
    return 1
  }
  [[ "$fd_identity" == '0:0:600:1:'* && "$fd_identity" == "$path_identity" ]] || {
    exec 9>&-
    return 1
  }
  flock --exclusive --nonblock 9 || {
    exec 9>&-
    return 1
  }
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$fd_identity" ]] || {
    flock --unlock 9 || true
    exec 9>&-
    return 1
  }
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
      'FetanAgent H12 parser repair stopped with the deployment grant disabled. Rerun this exact reviewed repair; do not delete evidence or restore the grant manually.' >&2
  fi
  exit "$status"
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed staging root is absent or unsafe'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged successor helper is invalid'
load_exact_h10_evidence || die 'the immutable H10 rotation evidence is invalid'
load_exact_h11_evidence || die 'the immutable H11 runtime-bridge evidence is invalid'
rotation_state="$(classify_rotation)" ||
  die 'the H12 namespace is not absent, empty, an exact interrupted prefix, or completed'
case "$rotation_state" in
  absent|empty-parent)
    require_initial_namespace "$rotation_state" ||
      die 'the initial H12 namespace, H11 helper, disabled grant, or stopped boundary is inconsistent'
    grant_disabled='true'
    ;;
  interrupted)
    require_interrupted_prefix_consistency ||
      die 'the interrupted H12 prefix, helper, installer, or disabled grant is inconsistent'
    require_stopped_durable_boundary ||
      die 'the stopped Docker volumes or identity binding changed during H12 recovery'
    grant_disabled='true'
    ;;
  completed)
    require_exact_completed_namespace || die 'the completed H12 namespace is invalid'
    if [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
      require_disabled_grant_only || die 'the disabled deployment grant is invalid'
      require_stopped_durable_boundary ||
        die 'the stopped Docker volumes or identity binding changed before H12 attestation'
      grant_disabled='true'
    else
      require_exact_sudoers_file "$SUDOERS" || die 'the active deployment grant is invalid'
      visudo -cf /etc/sudoers >/dev/null || die 'the active sudoers configuration is invalid'
    fi
    ;;
  *) die 'the H12 parser-repair state is impossible' ;;
esac

trap cleanup EXIT
open_lock || die 'the exact staging mutation lock is unsafe or another mutation is active'
require_no_other_mutator_processes || die 'another helper or H11/H12 mutation process is active'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed under lock'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged successor helper changed under lock'
load_exact_h10_evidence || die 'the immutable H10 rotation evidence changed under lock'
load_exact_h11_evidence || die 'the immutable H11 runtime-bridge evidence changed under lock'
[[ "$(classify_rotation)" == "$rotation_state" ]] ||
  die 'the H12 namespace changed before lock acquisition'

if [[ "$rotation_state" == 'absent' || "$rotation_state" == 'empty-parent' ]]; then
  require_initial_namespace "$rotation_state" ||
    die 'the initial H12 repair boundary changed under lock'
  if [[ "$rotation_state" == 'absent' ]]; then
    install -d -o root -g root -m 0700 "$ROTATION_PARENT"
    sync -f "$(dirname -- "$ROTATION_PARENT")"
  fi
  [[ "$(classify_rotation)" == 'empty-parent' ]] ||
    die 'the H12 parent could not be initialized exactly'
  install -d -o root -g root -m 0700 "$ROTATION_INSTALLING"
  sync -f "$ROTATION_PARENT"
  rotation_state='interrupted'
  require_exact_empty_checkpoint || die 'the empty H12 installing checkpoint is invalid'
fi

if [[ "$rotation_state" == 'completed' ]]; then
  require_exact_completed_namespace || die 'the completed H12 namespace changed under lock'
else
  require_interrupted_prefix_consistency || die 'the interrupted H12 prefix changed under lock'
  require_stopped_durable_boundary ||
    die 'the exact stopped durable boundary is no longer ready'
  require_no_other_mutator_processes ||
    die 'another helper or H11/H12 mutation process appeared during revalidation'
  require_interrupted_prefix_consistency ||
    die 'the interrupted H12 prefix changed after stopped-boundary revalidation'

  publish_record "$ROTATION_INSTALLING" intent-v1 0600 expected_intent ||
    die 'the H12 intent could not be completed atomically'
  require_interrupted_prefix_consistency || die 'the H12 intent publication is inconsistent'

  if [[ ! -e "$ROTATION_INSTALLING/predecessor-helper" &&
    ! -L "$ROTATION_INSTALLING/predecessor-helper" ]]; then
    copy_root_file_atomically "$TARGET" \
      "$ROTATION_INSTALLING/.predecessor-helper.installing" \
      "$ROTATION_INSTALLING/predecessor-helper" 0755 0400 "$PREDECESSOR_HELPER_SHA256" ||
      die 'the H11 helper archive could not be completed atomically'
  fi
  require_helper_file "$ROTATION_INSTALLING/predecessor-helper" \
    "$PREDECESSOR_HELPER_SHA256" 400 || die 'the archived H11 helper is invalid'
  require_interrupted_prefix_consistency || die 'the H11 helper archive is inconsistent'

  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    if [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]; then
      copy_root_file_atomically "$STAGED_HELPER" "$INSTALLING_HELPER_PARTIAL" \
        "$INSTALLING_HELPER" 0600 0755 "$SUCCESSOR_HELPER_SHA256" ||
        die 'the H12 helper installer could not be completed atomically'
    fi
    require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 ||
      die 'the installing H12 helper is invalid'
    [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
      die 'a partial H12 helper installer remains'
    mv -- "$INSTALLING_HELPER" "$TARGET"
    sync -f /usr/local/sbin
  fi
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
    die 'the installed H12 helper is invalid'
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
    die 'an H12 helper installer residue remains after replacement'
  require_interrupted_prefix_consistency || die 'the H12 helper replacement is inconsistent'

  publish_record "$ROTATION_INSTALLING" completed-v1 0600 expected_completion ||
    die 'the H12 completion could not be completed atomically'
  require_exact_rotation_record "$ROTATION_INSTALLING" ||
    die 'the completed installing H12 record is invalid'
  [[ ! -e "$ROTATION_ROOT" && ! -L "$ROTATION_ROOT" ]] ||
    die 'the final H12 rotation root appeared unexpectedly'
  mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"
  sync -f "$ROTATION_PARENT"
  rotation_state='completed'
  require_exact_completed_namespace || die 'the final H12 rotation evidence is invalid'
fi

close_lock
run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the corrected H12 helper rejected its reviewed digest'
run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the corrected H12 helper rejected the durable runtime bridge'
if [[ "$grant_disabled" == 'true' ]]; then
  require_stopped_durable_boundary ||
    die 'the stopped Docker volumes or identity binding changed after successor attestation'
fi

open_lock || die 'the exact staging mutation lock changed or another mutation appeared'
require_no_other_mutator_processes || die 'another helper or H11/H12 mutation process remained'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed before grant restoration'
load_exact_h10_evidence || die 'the immutable H10 rotation evidence changed before grant restoration'
load_exact_h11_evidence || die 'the immutable H11 runtime-bridge evidence changed before grant restoration'
[[ "$(classify_rotation)" == 'completed' ]] || die 'the completed H12 namespace disappeared'
require_exact_completed_namespace || die 'the H12 state changed before grant restoration'
if [[ "$grant_disabled" == 'true' ]]; then
  require_disabled_grant_only || die 'the disabled deployment grant changed before restoration'
  require_stopped_durable_boundary ||
    die 'the stopped Docker volumes or identity binding changed before grant restoration'
  restore_sudoers || die 'the deployment grant could not be restored safely'
  grant_disabled='false'
else
  require_exact_sudoers_file "$SUDOERS" || die 'the active deployment grant changed'
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] ||
    die 'a disabled deployment grant appeared unexpectedly'
  visudo -cf /etc/sudoers >/dev/null || die 'the active sudoers configuration changed'
fi
close_lock
trap - EXIT

printf '%s\n' \
  'KemerBet H12 parser-scope repair completed or validated: immutable H11 bridge preserved; Transfer disabled.'
