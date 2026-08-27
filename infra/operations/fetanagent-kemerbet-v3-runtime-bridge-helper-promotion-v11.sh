#!/usr/bin/env bash
# One-use, root-console-only promotion from the exact H10 helper to the durable H11
# runtime bridge. The historical R10 KemerBet overlay remains immutable; this operation
# changes only the reviewed root helper and appends provenance. It performs no lookup,
# recheck, deposit, transfer, withdrawal, or other financial action.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly HISTORICAL_OVERLAY_RELEASE='c061f9dc05e60d641d306f16b5d826e6e1b2c6c4'
readonly PREDECESSOR_HELPER_SHA256='73eabc728bc25462ab96d17dc8faa5775526571caae9d2ab0265f523b84a387e'
readonly PREDECESSOR_ARCHIVE_SHA256='d3284d1c268fdba227ff5628f2ac28f9e30375a8a85517e06258a97dfab5e4e1'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='8696fd6d606b7c3440ab180e9d409bb113da2ba14434752b47fca07e34a09728'
readonly CONFIRMATION='I-UNDERSTAND-THIS-INSTALLS-ONE-FUTURE-RELEASE-NEUTRAL-V3-RUNTIME-BRIDGE-WITH-TRANSFER-DISABLED'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v3-runtime-bridge-v11-disabled'
readonly ROTATION_V10_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v10'
readonly ROTATION_V10_ROOT="$ROTATION_V10_PARENT/$HISTORICAL_OVERLAY_RELEASE"
readonly ROTATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v11'
readonly SOURCE_BINDING='/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
readonly PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly SESSION_CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-runtime-bridge-v11-installing'

export PATH="$SAFE_PATH"
umask 022

die() {
  printf 'FetanAgent v3 runtime-bridge H11 promotion failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the bridge release, reviewed helper digest, and exact confirmation'
readonly BRIDGE_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly STAGING_ROOT="/root/fetanagent-v3-runtime-bridge-v11-$BRIDGE_RELEASE"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly ROTATION_ROOT="$ROTATION_PARENT/$BRIDGE_RELEASE"
readonly ROTATION_INSTALLING="$ROTATION_PARENT/.installing-$BRIDGE_RELEASE"

[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$BRIDGE_RELEASE" != "$HISTORICAL_OVERLAY_RELEASE" ]] ||
  die 'the bridge release must be a distinct full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct hard-pinned reviewed H11 artifact'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] || die 'the exact one-use confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this operation only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl docker env find flock id install mkdir mv python3 \
  realpath seq sha256sum sort stat sync visudo; do
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

require_no_helper_processes() {
  local argument cmdline found
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    found='false'
    while IFS= read -r -d '' argument; do
      if [[ "$argument" == "$TARGET" ]]; then
        found='true'
        break
      fi
    done <"$cmdline" || true
    [[ "$found" == 'false' ]] || return 1
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
  local archive completion intent
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
  [[ ! -L "$completion" && -f "$completion" &&
    "$(realpath -- "$completion")" == "$completion" &&
    "$(stat --format='%U:%G:%a:%h' "$completion")" == 'root:root:600:1' ]] || return 1
  require_helper_file "$archive" "$PREDECESSOR_ARCHIVE_SHA256" 400 || return 1
  mapfile -t intent_lines <"$intent"
  mapfile -t completion_lines <"$completion"
  [[ "${#intent_lines[@]}" -eq 18 && "${#completion_lines[@]}" -eq 19 &&
    "${intent_lines[0]}" == 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v10' &&
    "${intent_lines[1]}" == 'state=authorized' &&
    "${intent_lines[3]}" == "successor_release=$HISTORICAL_OVERLAY_RELEASE" &&
    "${intent_lines[5]}" == "successor_helper_sha256=$PREDECESSOR_HELPER_SHA256" &&
    "${intent_lines[10]}" =~ ^base_binding_v3_sha256=[0-9a-f]{64}$ &&
    "${intent_lines[14]}" =~ ^compose5_durable_volume_digest=[0-9a-f]{64}$ &&
    "${intent_lines[15]}" =~ ^compose5_profile_config_hash=[0-9a-f]{64}$ &&
    "${intent_lines[16]}" =~ ^compose5_session_control_config_hash=[0-9a-f]{64}$ &&
    "${intent_lines[17]}" =~ ^compose5_volume_version=[0-9]+\.[0-9]+\.[0-9]+ &&
    "${completion_lines[0]}" == "${intent_lines[0]}" &&
    "${completion_lines[1]}" == 'state=successor-installed' ]] || return 1
  local index
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

require_stopped_historical_overlay() {
  local containers networks project_volumes expected_volumes holders volume mountpoint
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  run_helper_direct verify "$PREDECESSOR_HELPER_SHA256" >/dev/null || return 1
  run_helper_direct kemerbet-v3-successor-ready \
    "$HISTORICAL_OVERLAY_RELEASE" "$PREDECESSOR_HELPER_SHA256" >/dev/null || return 1
  run_helper_direct fresh-host-ready "$HISTORICAL_OVERLAY_RELEASE" >/dev/null || return 1
  containers="$(docker_local_read_only container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  networks="$(docker_local_read_only network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  [[ -z "$containers" && -z "$networks" ]] || return 1
  project_volumes="$(docker_local_read_only volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  expected_volumes="$(printf '%s\n%s\n' "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME" | LC_ALL=C sort)"
  [[ "$project_volumes" == "$expected_volumes" ]] || return 1
  for volume in "$PROFILE_VOLUME" "$SESSION_CONTROL_VOLUME"; do
    [[ "$(docker_local_read_only volume inspect "$volume" \
      --format '{{.Driver}}|{{index .Labels "com.docker.compose.project"}}|{{.Mountpoint}}')" == \
      "local|$PROJECT_NAME|/"* ]] || return 1
    holders="$(docker_local_read_only container ls --all --quiet --filter "volume=$volume")" || return 1
    [[ -z "$holders" ]] || return 1
    mountpoint="$(docker_local_read_only volume inspect "$volume" --format '{{.Mountpoint}}')" || return 1
    [[ "$mountpoint" == /* && ! -L "$mountpoint" && -d "$mountpoint" &&
      "$(realpath -- "$mountpoint")" == "$mountpoint" ]] || return 1
  done
  [[ ! -L "$SOURCE_BINDING" && -f "$SOURCE_BINDING" &&
    "$(realpath -- "$SOURCE_BINDING")" == "$SOURCE_BINDING" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$SOURCE_BINDING")" == '10001:10001:600:1:230' &&
    "$(sha256sum -- "$SOURCE_BINDING" | awk '{print $1}')" == "$BASE_BINDING_V3_SHA256" ]] || return 1
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v11' \
    'state=authorized' \
    "overlay_release=$HISTORICAL_OVERLAY_RELEASE" \
    "bridge_release=$BRIDGE_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "predecessor_rotation_intent_sha256=$H10_INTENT_SHA256" \
    "predecessor_rotation_completion_sha256=$H10_COMPLETION_SHA256" \
    "predecessor_rotation_helper_archive_sha256=$H10_ARCHIVE_SHA256" \
    "base_binding_v3_sha256=$BASE_BINDING_V3_SHA256" \
    "$COMPOSE5_DURABLE_VOLUME_DIGEST" \
    "$COMPOSE5_PROFILE_CONFIG_HASH" \
    "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" \
    "$COMPOSE5_VOLUME_VERSION" \
    'transition=historical-overlay-current-runtime-separated-v1' \
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
  expected_intent | awk 'NR == 2 { print "state=runtime-bridge-installed"; next } { print }'
  printf 'rotation_intent_sha256=%s\n' "$intent_sha256"
}

publish_record() {
  local root="$1" name="$2" mode="$3" producer="$4" candidate="$root/.$name.installing"
  [[ ! -e "$candidate" && ! -L "$candidate" ]] || return 1
  (umask 077; "$producer" >"$candidate") || return 1
  chown root:root "$candidate" || return 1
  chmod "$mode" "$candidate" || return 1
  sync -f "$candidate" || return 1
  [[ ! -e "$root/$name" && ! -L "$root/$name" ]] || return 1
  mv -- "$candidate" "$root/$name" || return 1
  sync -f "$root" || return 1
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

disable_sudoers() {
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] || return 1
  require_exact_sudoers_file "$SUDOERS" || return 1
  mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
  sync -f /etc/sudoers.d || return 1
  [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  visudo -cf /etc/sudoers >/dev/null
}

restore_sudoers() {
  [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_exact_sudoers_file "$SUDOERS" || return 1
  visudo -cf /etc/sudoers >/dev/null
}

[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == \
  "$EXPECTED_DROPLET_ID" ]] || die 'the DigitalOcean Droplet identity is not exact'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]] ||
  die 'the DigitalOcean public IPv4 is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed staging root is absent or unsafe'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged successor helper is invalid'
load_exact_h10_evidence || die 'the immutable H10 rotation evidence is invalid'

if [[ -e "$ROTATION_ROOT" || -L "$ROTATION_ROOT" ]]; then
  require_exact_rotation_record "$ROTATION_ROOT" || die 'the completed H11 bridge evidence is invalid'
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
    die 'the installed H11 helper is invalid'
  if [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
    restore_sudoers || die 'the deployment grant could not be restored'
  else
    require_exact_sudoers_file "$SUDOERS" || die 'the deployment grant is invalid'
  fi
  run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
    die 'the installed H11 helper rejected its reviewed digest'
  run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
    die 'the installed H11 helper rejected the runtime bridge'
  printf '%s\n' 'KemerBet H11 runtime bridge already installed: historical R10 overlay preserved; Transfer disabled.'
  exit 0
fi

[[ ! -e "$ROTATION_INSTALLING" && ! -L "$ROTATION_INSTALLING" ]] ||
  die 'an interrupted H11 promotion requires explicit recovery review before retry'
[[ ! -e "$ROTATION_PARENT" && ! -L "$ROTATION_PARENT" ]] || {
  [[ ! -L "$ROTATION_PARENT" && -d "$ROTATION_PARENT" &&
    "$(realpath -- "$ROTATION_PARENT")" == "$ROTATION_PARENT" &&
    "$(stat --format='%U:%G:%a' "$ROTATION_PARENT")" == 'root:root:700' &&
    -z "$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] ||
    die 'the H11 rotation namespace is non-empty, foreign, or unsafe'
}
require_exact_sudoers_file "$SUDOERS" || die 'the deployment sudoers grant is invalid'
require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
  die 'the exact H10 predecessor helper is not installed'
run_helper_direct verify "$PREDECESSOR_HELPER_SHA256" >/dev/null ||
  die 'the H10 helper rejected its reviewed digest'
run_helper_direct kemerbet-v3-successor-ready \
  "$HISTORICAL_OVERLAY_RELEASE" "$PREDECESSOR_HELPER_SHA256" >/dev/null ||
  die 'the H10 helper rejected the immutable historical overlay'
run_helper_direct stop >/dev/null || die 'the H10 helper could not stop staging safely'
load_exact_h10_evidence || die 'the H10 evidence changed during the stop'
require_stopped_historical_overlay || die 'the exact stopped historical overlay boundary is not ready'

install -d -o root -g root -m 0700 "$LOCK_ROOT"
exec 9<>"$LOCK"
flock --exclusive --nonblock 9 || die 'another staging mutation is active'
require_no_helper_processes || die 'a helper process remained after lock acquisition'
load_exact_h10_evidence || die 'the H10 evidence changed under lock'
require_stopped_historical_overlay || die 'the stopped historical overlay changed under lock'
disable_sudoers || die 'the deployment sudoers grant could not be disabled safely'
require_no_helper_processes || die 'a helper process appeared after the grant was disabled'

if [[ ! -e "$ROTATION_PARENT" && ! -L "$ROTATION_PARENT" ]]; then
  install -d -o root -g root -m 0700 "$ROTATION_PARENT"
  sync -f "$(dirname -- "$ROTATION_PARENT")"
fi
[[ ! -L "$ROTATION_PARENT" && -d "$ROTATION_PARENT" &&
  "$(stat --format='%U:%G:%a' "$ROTATION_PARENT")" == 'root:root:700' &&
  -z "$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] ||
  die 'the H11 rotation parent changed before evidence publication'
install -d -o root -g root -m 0700 "$ROTATION_INSTALLING"
publish_record "$ROTATION_INSTALLING" intent-v1 0600 expected_intent ||
  die 'the H11 intent could not be published atomically'
install -o root -g root -m 0400 "$TARGET" "$ROTATION_INSTALLING/predecessor-helper"
require_helper_file "$ROTATION_INSTALLING/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400 ||
  die 'the archived H10 helper is invalid'
sync -f "$ROTATION_INSTALLING"

[[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]] ||
  die 'a helper installer residue already exists'
install -o root -g root -m 0755 "$STAGED_HELPER" "$INSTALLING_HELPER"
require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the installing H11 helper is invalid'
mv -- "$INSTALLING_HELPER" "$TARGET"
sync -f /usr/local/sbin
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the installed H11 helper is invalid'

publish_record "$ROTATION_INSTALLING" completed-v1 0600 expected_completion ||
  die 'the H11 completion could not be published atomically'
require_exact_rotation_record "$ROTATION_INSTALLING" ||
  die 'the installing H11 rotation record is invalid'
[[ ! -e "$ROTATION_ROOT" && ! -L "$ROTATION_ROOT" ]] ||
  die 'the final H11 rotation root appeared unexpectedly'
mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"
sync -f "$ROTATION_PARENT"
require_exact_rotation_record "$ROTATION_ROOT" || die 'the final H11 rotation evidence is invalid'

flock --unlock 9
exec 9>&-
run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the H11 helper rejected its reviewed digest'
run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the H11 helper rejected the durable runtime bridge'
exec 9<>"$LOCK"
flock --exclusive --nonblock 9 || die 'another mutation appeared before grant restoration'
require_no_helper_processes || die 'a helper process remained before grant restoration'
require_exact_rotation_record "$ROTATION_ROOT" || die 'the H11 evidence changed before grant restoration'
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the H11 helper changed before grant restoration'
restore_sudoers || die 'the deployment sudoers grant could not be restored safely'

printf '%s\n' \
  'KemerBet H11 runtime bridge installed: historical R10 overlay preserved; future reviewed releases enabled; Transfer disabled.'
