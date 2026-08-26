#!/usr/bin/env bash
# One-use, root-console-only recovery for one exact emergency-stopped KemerBet
# candidate_bound transaction. This never starts a runtime or contacts KemerBet.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly EXPECTED_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'
readonly EXPECTED_HELPER_SHA256='05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe'
readonly EXPECTED_PYTHON_SHA256='206945947823be1db0657aa731a081dbbfdc349d3b76b8560ef2d6c5e94ce4ed'
readonly CONFIRMATION='I-UNDERSTAND-THIS-ADOPTS-THE-EXACT-FAILED-LATCH-AND-RECOVERS-NO-TRANSFER'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly SNAPSHOT_VOLUME="${PROJECT_NAME}-kemerbet-readiness-profile-snapshot-once"
readonly RPC_ROOT='/run/fetanagent-kemerbet-readiness-rpc-v1'
readonly BOT_RECEIPT_ROOT='/var/lib/fetanagent-bot-startup-receipt'
readonly EXPIRY_SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly EXPIRY_TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly EXPIRY_SERVICE_PATH="/etc/systemd/system/$EXPIRY_SERVICE"
readonly EXPIRY_TIMER_PATH="/etc/systemd/system/$EXPIRY_TIMER"
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly STAGING_ROOT="/root/fetanagent-candidate-bound-recovery-$EXPECTED_RELEASE"
readonly RECOVERY_SCRIPT="$STAGING_ROOT/fetanagent-kemerbet-candidate-bound-root-recovery-v1.sh"
readonly RECOVERY_PYTHON="$STAGING_ROOT/fetanagent-kemerbet-candidate-bound-root-recovery-v1.py"

export PATH="$SAFE_PATH"
umask 077

die() {
  printf '%s\n' 'FetanAgent candidate-bound recovery failed closed. No transfer was enabled and no money moved.' >&2
  exit 1
}

[[ $# -eq 3 ]] || die
readonly PROVIDED_RELEASE="$1"
readonly PROVIDED_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"

[[ "$PROVIDED_RELEASE" == "$EXPECTED_RELEASE" &&
  "$PROVIDED_HELPER_SHA256" == "$EXPECTED_HELPER_SHA256" &&
  "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] || die
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] || die
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die

for command in awk bash cmp curl docker env find flock id python3 realpath sed sha256sum sort stat systemctl; do
  command -v "$command" >/dev/null 2>&1 || die
done

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

python_recovery() {
  env -i PATH="$SAFE_PATH" HOME='/root' python3 -I "$RECOVERY_PYTHON" "$@"
}

expected_sudoers() {
  printf '%s\n' \
    'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
}

require_exact_staged_assets() {
  local entries script_path
  script_path="$(realpath -- "${BASH_SOURCE[0]}")" || return 1
  [[ "$script_path" == "$RECOVERY_SCRIPT" &&
    ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
    "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
    "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] || return 1
  entries="$(find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$entries" == $'fetanagent-kemerbet-candidate-bound-root-recovery-v1.py\nfetanagent-kemerbet-candidate-bound-root-recovery-v1.sh' ]] || return 1
  [[ ! -L "$RECOVERY_SCRIPT" && -f "$RECOVERY_SCRIPT" &&
    "$(realpath -- "$RECOVERY_SCRIPT")" == "$RECOVERY_SCRIPT" &&
    "$(stat --format='%U:%G:%a:%h' "$RECOVERY_SCRIPT")" == 'root:root:700:1' &&
    ! -L "$RECOVERY_PYTHON" && -f "$RECOVERY_PYTHON" &&
    "$(realpath -- "$RECOVERY_PYTHON")" == "$RECOVERY_PYTHON" &&
    "$(stat --format='%U:%G:%a:%h' "$RECOVERY_PYTHON")" == 'root:root:600:1' &&
    "$(sha256sum -- "$RECOVERY_PYTHON" | awk '{print $1}')" == "$EXPECTED_PYTHON_SHA256" ]] || return 1
  bash -n "$RECOVERY_SCRIPT" && python_recovery self-test
}

require_exact_installed_authority() {
  [[ ! -L "$TARGET" && -f "$TARGET" && "$(realpath -- "$TARGET")" == "$TARGET" &&
    "$(stat --format='%U:%G:%a:%h' "$TARGET")" == 'root:root:755:1' &&
    "$(sha256sum -- "$TARGET" | awk '{print $1}')" == "$EXPECTED_HELPER_SHA256" ]] || return 1
  bash -n "$TARGET" || return 1
  [[ ! -L "$SUDOERS" && -f "$SUDOERS" && "$(realpath -- "$SUDOERS")" == "$SUDOERS" &&
    "$(stat --format='%U:%G:%a:%h' "$SUDOERS")" == 'root:root:440:1' ]] || return 1
  cmp -s -- "$SUDOERS" <(expected_sudoers)
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

acquire_mutation_lock() {
  local fd_identity path_identity
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] || return 1
  if [[ ! -e "$LOCK_ROOT" && ! -L "$LOCK_ROOT" ]]; then
    mkdir --mode=0700 -- "$LOCK_ROOT" || return 1
  fi
  [[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' ]] || return 1
  if [[ ! -e "$LOCK" && ! -L "$LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] || return 1
  exec 9<>"$LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" || return 1
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" || return 1
  [[ "$fd_identity" == '0:0:600:1:'* && "$fd_identity" == "$path_identity" ]] || return 1
  flock --exclusive --nonblock 9 || return 1
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$fd_identity" ]] || return 1
}

require_host_identity() {
  local droplet_id public_ipv4
  droplet_id="$(metadata_get 'id')" || return 1
  public_ipv4="$(metadata_get 'interfaces/public/0/ipv4/address')" || return 1
  [[ "$droplet_id" == "$EXPECTED_DROPLET_ID" && "$public_ipv4" == "$EXPECTED_PUBLIC_IPV4" ]]
}

metadata_get() {
  local metadata_path="$1"
  case "$metadata_path" in
    'id' | 'interfaces/public/0/ipv4/address') ;;
    *) return 1 ;;
  esac
  env -i PATH="$SAFE_PATH" HOME='/root' \
    curl --disable --fail --silent --show-error --noproxy '*' --proto '=http' \
    --max-time 3 "$METADATA/$metadata_path"
}

require_absent_path() {
  [[ ! -e "$1" && ! -L "$1" ]]
}

require_expiry_disarmed() {
  local service_state timer_state
  require_absent_path "$EXPIRY_SERVICE_PATH" && require_absent_path "$EXPIRY_TIMER_PATH" || return 1
  service_state="$(systemctl show --property=LoadState --value "$EXPIRY_SERVICE" 2>/dev/null)" || return 1
  timer_state="$(systemctl show --property=LoadState --value "$EXPIRY_TIMER" 2>/dev/null)" || return 1
  [[ "$service_state" == 'not-found' && "$timer_state" == 'not-found' ]]
}

require_runtime_secrets_absent() {
  local path
  local -a paths=(
    "$SECRET_ROOT/owner-database-url"
    "$SECRET_ROOT/publishable-key"
    "$SECRET_ROOT/customer-web-database-url"
    "$SECRET_ROOT/customer-web-publishable-key"
    "$SECRET_ROOT/customer-web-rate-limit-hmac"
    "$SECRET_ROOT/beta-database-url"
    "$SECRET_ROOT/beta-transport-hmac"
    "$SECRET_ROOT/bot-transport-hmac"
    "$SECRET_ROOT/beta-payload-hmac"
    "$SECRET_ROOT/player-action-database-url"
    "$SECRET_ROOT/api-action-transport-hmac"
    "$SECRET_ROOT/api-action-payload-hmac"
    "$SECRET_ROOT/api-action-capability-hmac"
    "$SECRET_ROOT/api-action-semantic-hmac"
    "$SECRET_ROOT/cbe-deposit-reference-encryption-key"
    "$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
    "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
    "$SECRET_ROOT/deposit-proof-reference-encryption-master"
    "$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
    "$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
    "$SECRET_ROOT/bot-action-transport-hmac"
    "$SECRET_ROOT/bot-token"
    "$SECRET_ROOT/supabase-ca.crt"
  )
  for path in "${paths[@]}"; do
    require_absent_path "$path" || return 1
  done
}

require_no_named_transients() {
  local actual name
  local -a forbidden_containers=(
    "$PROJECT_NAME-kemerbet-no-transfer-readiness-once"
    "$PROJECT_NAME-kemerbet-readiness-browser-once"
    "$PROJECT_NAME-kemerbet-readiness-egress-proxy-once"
    "$PROJECT_NAME-kemerbet-readiness-authorizer-once"
    "$PROJECT_NAME-kemerbet-readiness-profile-snapshot-copy-once"
    "$PROJECT_NAME-kemerbet-readiness-profile-snapshot-verify-once"
    "$PROJECT_NAME-kemerbet-readiness-profile-original-verify-once"
  )
  local -a forbidden_networks=(
    "${PROJECT_NAME}_kemerbet_readiness_control"
    "${PROJECT_NAME}_kemerbet_readiness_proxy"
    "${PROJECT_NAME}_kemerbet_readiness_egress"
  )
  actual="$(docker_local container ls --all --format '{{.Names}}')" || return 1
  for name in "${forbidden_containers[@]}"; do
    while IFS= read -r value; do
      [[ "$value" != "$name" ]] || return 1
    done <<<"$actual"
  done
  actual="$(docker_local network ls --format '{{.Name}}')" || return 1
  for name in "${forbidden_networks[@]}"; do
    while IFS= read -r value; do
      [[ "$value" != "$name" ]] || return 1
    done <<<"$actual"
  done
}

require_stopped_project() {
  local containers networks
  containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sed '/^$/d')" || return 1
  networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sed '/^$/d')" || return 1
  [[ -z "$containers" && -z "$networks" ]] || return 1
  require_no_named_transients
}

SNAPSHOT_PRESENT=''
require_exact_project_volumes() {
  local actual expected_without expected_with snapshot_named
  actual="$(docker_local volume ls --format '{{.Name}}' \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sed '/^$/d' | LC_ALL=C sort)" || return 1
  snapshot_named="$(docker_local volume ls --format '{{.Name}}' \
    --filter "name=^${SNAPSHOT_VOLUME}$" | LC_ALL=C sed '/^$/d')" || return 1
  expected_without="$(printf '%s\n%s\n' "$CONTROL_VOLUME" "$PROFILE_VOLUME" | LC_ALL=C sort)"
  expected_with="$(printf '%s\n%s\n%s\n' "$CONTROL_VOLUME" "$PROFILE_VOLUME" "$SNAPSHOT_VOLUME" | LC_ALL=C sort)"
  case "$actual" in
    "$expected_without")
      [[ -z "$snapshot_named" ]] || return 1
      SNAPSHOT_PRESENT='false'
      ;;
    "$expected_with")
      [[ "$snapshot_named" == "$SNAPSHOT_VOLUME" ]] || return 1
      SNAPSHOT_PRESENT='true'
      ;;
    *) return 1 ;;
  esac
}

require_volume_holder_free() {
  local holders
  holders="$(docker_local container ls --all --quiet --filter "volume=$1" | LC_ALL=C sed '/^$/d')" || return 1
  [[ -z "$holders" ]]
}

DURABLE_VOLUME_DIGEST=''
require_durable_volumes() {
  local json
  json="$(docker_local volume inspect "$PROFILE_VOLUME" "$CONTROL_VOLUME")" || return 1
  printf '%s\n' "$json" | python_recovery verify-durable-volumes-json || return 1
  require_volume_holder_free "$PROFILE_VOLUME" && require_volume_holder_free "$CONTROL_VOLUME" || return 1
  DURABLE_VOLUME_DIGEST="$(printf '%s\n' "$json" | sha256sum | awk '{print $1}')" || return 1
  [[ "$DURABLE_VOLUME_DIGEST" =~ ^[0-9a-f]{64}$ ]]
}

require_fixed_stopped_boundary() {
  require_stopped_project || return 1
  require_exact_project_volumes || return 1
  require_durable_volumes || return 1
  require_expiry_disarmed || return 1
  require_absent_path "$RPC_ROOT" || return 1
  require_absent_path "$BOT_RECEIPT_ROOT" || return 1
  require_runtime_secrets_absent
}

require_exact_staged_assets || die
require_exact_installed_authority || die
require_no_helper_processes || die
require_host_identity || die
acquire_mutation_lock || die
require_no_helper_processes || die
require_fixed_stopped_boundary || die
readonly DURABLE_VOLUME_DIGEST_BEFORE="$DURABLE_VOLUME_DIGEST"

if [[ "$SNAPSHOT_PRESENT" == 'true' ]]; then
  snapshot_json="$(docker_local volume inspect "$SNAPSHOT_VOLUME")" || die
  printf '%s\n' "$snapshot_json" | python_recovery authorize-snapshot-removal || die
  require_fixed_stopped_boundary || die
  [[ "$SNAPSHOT_PRESENT" == 'true' && "$DURABLE_VOLUME_DIGEST" == "$DURABLE_VOLUME_DIGEST_BEFORE" ]] || die
  snapshot_json="$(docker_local volume inspect "$SNAPSHOT_VOLUME")" || die
  printf '%s\n' "$snapshot_json" | python_recovery verify-authorized-snapshot-volume-json || die
  require_volume_holder_free "$SNAPSHOT_VOLUME" || die
  docker_local volume rm "$SNAPSHOT_VOLUME" >/dev/null || die
  require_exact_project_volumes || die
  [[ "$SNAPSHOT_PRESENT" == 'false' ]] || die
else
  python_recovery verify-snapshot-authorization || die
fi

require_fixed_stopped_boundary || die
[[ "$SNAPSHOT_PRESENT" == 'false' && "$DURABLE_VOLUME_DIGEST" == "$DURABLE_VOLUME_DIGEST_BEFORE" ]] || die
python_recovery recover || die
python_recovery verify-terminal || die
require_fixed_stopped_boundary || die
[[ "$SNAPSHOT_PRESENT" == 'false' && "$DURABLE_VOLUME_DIGEST" == "$DURABLE_VOLUME_DIGEST_BEFORE" ]] || die
require_no_helper_processes || die

printf '%s\n' \
  'FetanAgent exact candidate-bound recovery completed. Runtime and Transfer remained disabled; no provider was contacted and no money moved.'
