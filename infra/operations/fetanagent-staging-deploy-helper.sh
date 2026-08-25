#!/usr/bin/env bash
# Root-owned, fail-closed helper for the exact FetanAgent staging beta Compose project.
# Install this reviewed file as /usr/local/sbin/fetanagent-staging-deploy-helper with
# root:root ownership and mode 0755. The SSH deployment identity may sudo only this helper.

set -euo pipefail

readonly EXPECTED_SUDO_USER='fetanagent-admin'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly RELEASE_ROOT='/srv/fetanagent/releases'
readonly SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LEGACY_BRAND='pay''replayy'
readonly LEGACY_ADMIN="${LEGACY_BRAND}-admin"
readonly LEGACY_HOME="/home/$LEGACY_ADMIN"
readonly LEGACY_HELPER="/usr/local/sbin/${LEGACY_BRAND}-staging-deploy-helper"
readonly LEGACY_PROJECT_NAME="${LEGACY_BRAND}-staging-beta"
readonly LEGACY_SECRET_ROOT="/srv/${LEGACY_BRAND}/secrets/staging"
readonly LEGACY_SYSTEMD_MARKER="$LEGACY_BRAND"
readonly LEGACY_SUDOERS="/etc/sudoers.d/${LEGACY_BRAND}-staging-deploy"
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly STAGING_DIRECT_DATABASE_HOST='db.spzpiyxheappsfyswewl.supabase.co'
readonly PUBLIC_IPV4='178.128.39.89'
readonly FRESH_PUBLIC_IPV4='161.35.41.232'
readonly PUBLIC_DOMAINS=('fetanagent.com' 'www.fetanagent.com' 'owner.fetanagent.com')
readonly GATEWAY_STATE_ROOT='/var/lib/fetanagent-gateway'
readonly BOT_STARTUP_RECEIPT_ROOT='/var/lib/fetanagent-bot-startup-receipt'
readonly BOT_STARTUP_RECEIPT="$BOT_STARTUP_RECEIPT_ROOT/bot-v1"
readonly BOT_STARTUP_RECEIPT_VERSION='1'
readonly KEMERBET_AGENT_IDENTITY_HMAC_KEY='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key'
readonly KEMERBET_AGENT_IDENTITY_BINDINGS='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly KEMERBET_READINESS_PLAYER_IDS='/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
readonly KEMERBET_SELECTOR_CONTRACT='/etc/fetanagent/executor-config/kemerbet-selector-contract.v2.json'
readonly KEMERBET_READINESS_OUTPUT_ROOT='/var/lib/fetanagent/kemerbet-readiness-seal-output'
readonly KEMERBET_READINESS_BINDING="$KEMERBET_READINESS_OUTPUT_ROOT/kemerbet_agent_identity_bindings"
readonly KEMERBET_RECHECK_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck'
readonly KEMERBET_RECHECK_RECEIPT="$KEMERBET_RECHECK_RECEIPT_ROOT/ready-v1"
readonly KEMERBET_RECHECK_PROMOTION_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck-promotion'
readonly KEMERBET_RECHECK_PROMOTION_JOURNAL="$KEMERBET_RECHECK_PROMOTION_ROOT/pending-v1"
readonly KEMERBET_RECHECK_CANDIDATE_ROOT='/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate'
readonly KEMERBET_RECHECK_CANDIDATE_BINDING="$KEMERBET_RECHECK_CANDIDATE_ROOT/kemerbet_agent_identity_bindings"
readonly KEMERBET_RECHECK_CONTAINER="$PROJECT_NAME-kemerbet-no-transfer-readiness-once"
readonly KEMERBET_RECHECK_NETWORK="${PROJECT_NAME}_kemerbet_readiness_egress"
readonly KEMERBET_SESSION_CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly KEMERBET_OWNER_RECEIPT_PARENT='/var/lib/fetanagent'
readonly KEMERBET_OWNER_RECEIPT_ROOT="$KEMERBET_OWNER_RECEIPT_PARENT/kemerbet-readiness-cohort-receipts"
readonly KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT='/run/fetanagent-kemerbet-readiness-cohort-receipts'
readonly KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME='kemerbet-readiness-player-ids.stage-v1'
readonly KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME='.kemerbet-readiness-player-ids.stage-v1.installing'
readonly KEMERBET_OWNER_STAGED_CLAIM_NAME='kemerbet-readiness-cohort-claim.stage-v1'
readonly KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-claim.stage-v1.installing'
readonly KEMERBET_OWNER_IMPORTED_CLAIM_NAME='kemerbet-readiness-cohort-imported-v1'
readonly KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-imported-v1.installing'
readonly KEMERBET_OWNER_COMPLETED_CLAIM_NAME='kemerbet-readiness-cohort-completed-v1'
readonly KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-completed-v1.installing'
readonly KEMERBET_OWNER_FAILED_CLAIM_NAME='kemerbet-readiness-cohort-failed-v1'
readonly KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME='.kemerbet-readiness-cohort-failed-v1.installing'
readonly KEMERBET_RECOVERY_LATCH_NAME='kemerbet-readiness-recovery-in-progress-or-failed-v1'
readonly KEMERBET_RECOVERY_LATCH_INSTALLING_NAME='.kemerbet-readiness-recovery-in-progress-or-failed-v1.installing'
readonly KEMERBET_RECOVERY_FALLBACK_NAME='recovery-in-progress-or-failed-v1'
readonly KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME='.recovery-in-progress-or-failed-v1.installing'
readonly KEMERBET_PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly KEMERBET_RECHECK_TIMEOUT_SECONDS='300'
readonly KEMERBET_RECHECK_KILL_AFTER_SECONDS='15'
readonly STAGING_MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly STAGING_MUTATION_LOCK="$STAGING_MUTATION_LOCK_ROOT/mutation.lock"
readonly EXPIRY_STOP_SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly EXPIRY_STOP_TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly EXPIRY_STOP_SERVICE_PATH="/etc/systemd/system/$EXPIRY_STOP_SERVICE"
readonly EXPIRY_STOP_TIMER_PATH="/etc/systemd/system/$EXPIRY_STOP_TIMER"
readonly LEGACY_STOPPED_RECEIPT='/var/lib/fetanagent-vm-transition/legacy-stopped-v1'
readonly TRANSITION_RECEIPT='/var/lib/fetanagent-vm-transition/retired-v1'
readonly HELPER_ROTATION_RECEIPT='/var/lib/fetanagent-vm-transition/helper-rotation-v1'
readonly TRANSITION_VERSION='1'
readonly STAGING_DROPLET_ID='590666364'
readonly FRESH_STAGING_DROPLET_ID='593344964'
readonly LEGACY_HELPER_SHA='4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69'
readonly BASE_HELPER_SHA='e530efcc0781be8d298c0527f1a27bf1b7c97f9e0c9584adc0dd6ced0a7770af'
readonly BASE_REVIEWED_COMMIT='e636de89be179514af3aae3972ee0b086cd8c816'

export PATH="$SAFE_PATH"

die() {
  printf 'staging deploy helper failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i \
    PATH="$SAFE_PATH" \
    HOME='/root' \
    DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

validate_commit_and_tag() {
  local commit_sha="$1"
  local image_tag="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die 'the commit must be 40 lowercase hexadecimal characters'
  [[ "$image_tag" =~ ^[0-9a-f]{12}$ ]] || die 'the image tag must be 12 lowercase hexadecimal characters'
  [[ "$image_tag" == "${commit_sha:0:12}" ]] || die 'the image tag does not match the commit'
}

require_service_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required service file is absent or symbolic'
  [[ "$(stat --format='%u:%g:%a' "$path")" == '10001:10001:400' ]] ||
    die 'a service secret does not have the required ownership and mode'
}

require_root_readable_immutable_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required root-managed file is absent or symbolic'
  [[ "$(realpath -- "$path")" == "$path" ]] || die 'a required root-managed file is not canonical'
  [[ "$(stat --format='%U:%G:%a' "$path")" == 'root:root:444' ]] ||
    die 'a required root-managed file does not have the required ownership and mode'
}

require_kemerbet_identity_key_file() {
  local metadata path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'the KemerBet identity key is absent or symbolic'
  [[ "$(realpath -- "$path")" == "$path" ]] || die 'the KemerBet identity key is not canonical'
  metadata="$(stat --format='%u:%g:%a' "$path")"
  [[ "$metadata" == '10001:10001:400' || "$metadata" == '0:0:444' ]] ||
    die 'the KemerBet identity key ownership or mode is unsafe'
}

acquire_staging_mutation_lock() {
  local fd_identity path_identity
  command -v flock >/dev/null 2>&1 || die 'the staging mutation lock utility is unavailable'
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] ||
    die 'the runtime directory is unsafe for the staging mutation lock'
  if [[ ! -e "$STAGING_MUTATION_LOCK_ROOT" && ! -L "$STAGING_MUTATION_LOCK_ROOT" ]]; then
    (umask 077 && mkdir --mode=0700 -- "$STAGING_MUTATION_LOCK_ROOT") ||
      die 'the staging mutation lock root could not be created'
  fi
  [[ ! -L "$STAGING_MUTATION_LOCK_ROOT" && -d "$STAGING_MUTATION_LOCK_ROOT" &&
    "$(realpath -- "$STAGING_MUTATION_LOCK_ROOT")" == "$STAGING_MUTATION_LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$STAGING_MUTATION_LOCK_ROOT")" == 'root:root:700' ]] ||
    die 'the staging mutation lock root is unsafe'
  if [[ ! -e "$STAGING_MUTATION_LOCK" && ! -L "$STAGING_MUTATION_LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$STAGING_MUTATION_LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$STAGING_MUTATION_LOCK" && -f "$STAGING_MUTATION_LOCK" &&
    "$(realpath -- "$STAGING_MUTATION_LOCK")" == "$STAGING_MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$STAGING_MUTATION_LOCK")" == 'root:root:600:1' ]] ||
    die 'the staging mutation lock is unsafe'
  exec 9<>"$STAGING_MUTATION_LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$STAGING_MUTATION_LOCK")" ||
    die 'the staging mutation lock path could not be inspected'
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" ||
    die 'the opened staging mutation lock could not be inspected'
  [[ "$fd_identity" == '0:0:600:1:'* && "$fd_identity" == "$path_identity" ]] ||
    die 'the opened staging mutation lock does not match its root-managed path'
  flock --exclusive --nonblock 9 || die 'another staging mutation is already active'
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$STAGING_MUTATION_LOCK")" == "$fd_identity" ]] ||
    die 'the staging mutation lock path changed while acquiring the lock'
}

clear_bot_startup_receipt() {
  if [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]]; then
    return
  fi
  [[ ! -L "$BOT_STARTUP_RECEIPT_ROOT" && -d "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'the Telegram startup-receipt root is not a safe directory'
  [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'the Telegram startup-receipt root ownership or mode is unsafe'
  if [[ -e "$BOT_STARTUP_RECEIPT" || -L "$BOT_STARTUP_RECEIPT" ]]; then
    [[ ! -L "$BOT_STARTUP_RECEIPT" && -f "$BOT_STARTUP_RECEIPT" ]] ||
      die 'the Telegram startup receipt is not a safe regular file'
    [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT")" == 'root:root:600' ]] ||
      die 'the Telegram startup receipt ownership or mode is unsafe'
    rm -f -- "$BOT_STARTUP_RECEIPT"
  fi
  rmdir -- "$BOT_STARTUP_RECEIPT_ROOT" ||
    die 'the Telegram startup-receipt root contains unexpected residue'
}

require_immutable_config_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required immutable config file is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$path")" == 'root:root:444' ]] ||
    die 'an immutable config file does not have the required ownership and mode'
}

require_kemerbet_readiness_output_directory() {
  local entry
  [[ ! -L "$KEMERBET_READINESS_OUTPUT_ROOT" && -d "$KEMERBET_READINESS_OUTPUT_ROOT" ]] ||
    die 'the KemerBet readiness output root is absent or symbolic'
  [[ "$(stat --format='%u:%g:%a' "$KEMERBET_READINESS_OUTPUT_ROOT")" == '10001:10001:700' ]] ||
    die 'the KemerBet readiness output root ownership or mode is unsafe'
  [[ "$(realpath -- "$KEMERBET_READINESS_OUTPUT_ROOT")" == "$KEMERBET_READINESS_OUTPUT_ROOT" ]] ||
    die 'the KemerBet readiness output root is not canonical'
  while IFS= read -r entry; do
    [[ "$entry" == 'kemerbet_agent_identity_bindings' ]] ||
      die 'the KemerBet readiness output root contains unexpected residue'
  done < <(find -P "$KEMERBET_READINESS_OUTPUT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')
  if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
    [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the KemerBet readiness binding is not a safe regular file'
    [[ "$(stat --format='%u:%g:%a' "$KEMERBET_READINESS_BINDING")" == '10001:10001:600' ]] ||
      die 'the KemerBet readiness binding ownership or mode is unsafe'
  fi
}

consume_exact_one_use_kemerbet_file() {
  local path="$1" expected_dev_ino="$2" expected_digest="$3"
  local digest_fd python_status
  exec {digest_fd}<<<"$expected_digest" || return 1
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$path" "$expected_dev_ino" "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
CONTRACTS = {
    '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids': (
        (0, 0, 0o700),
        {
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
            (0, 0, 0o400),
            (0, 0, 0o444),
        },
    ),
    '/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings': (
        (10001, 10001, 0o700),
        {(10001, 10001, 0o600)},
    ),
}


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def consume(path, expected_identity_text, expected_digest):
    contract = CONTRACTS.get(path)
    match = DEV_INO.fullmatch(expected_identity_text)
    if contract is None or match is None or DIGEST.fullmatch(expected_digest) is None:
        reject()
    expected_identity = (int(match.group(1)), int(match.group(2)))
    directory = os.path.dirname(path)
    name = os.path.basename(path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    descriptor = None
    try:
        opened_directory = os.fstat(directory_descriptor)
        named_directory = os.lstat(directory)
        if (
            not stat.S_ISDIR(opened_directory.st_mode)
            or not stat.S_ISDIR(named_directory.st_mode)
            or (opened_directory.st_dev, opened_directory.st_ino)
            != (named_directory.st_dev, named_directory.st_ino)
            or (opened_directory.st_uid, opened_directory.st_gid, mode(opened_directory))
            != contract[0]
            or named_directory.st_mode != opened_directory.st_mode
            or named_directory.st_uid != opened_directory.st_uid
            or named_directory.st_gid != opened_directory.st_gid
            or os.path.realpath(directory) != directory
        ):
            reject()
        try:
            named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        except FileNotFoundError:
            try:
                os.lstat(path)
            except FileNotFoundError:
                return
            reject()
        absolute = os.lstat(path)
        if (
            not stat.S_ISREG(named.st_mode)
            or (named.st_dev, named.st_ino) != expected_identity
            or (absolute.st_dev, absolute.st_ino) != expected_identity
            or named.st_mode != absolute.st_mode
            or named.st_uid != absolute.st_uid
            or named.st_gid != absolute.st_gid
            or named.st_nlink != 1
            or absolute.st_nlink != 1
            or named.st_size != absolute.st_size
            or (named.st_uid, named.st_gid, mode(named)) not in contract[1]
            or named.st_size < 1
            or named.st_size > 4096
        ):
            reject()
        descriptor = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=directory_descriptor,
        )
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, named.st_size + 1, 0)
        if (
            (opened.st_dev, opened.st_ino) != expected_identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != named.st_size
            or len(content) != named.st_size
            or hashlib.sha256(content).hexdigest() != expected_digest
        ):
            reject()
        named_again = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if (
            (named_again.st_dev, named_again.st_ino) != expected_identity
            or named_again.st_mode != opened.st_mode
            or named_again.st_uid != opened.st_uid
            or named_again.st_gid != opened.st_gid
            or named_again.st_nlink != 1
            or named_again.st_size != opened.st_size
        ):
            reject()
        os.unlink(name, dir_fd=directory_descriptor)
        os.fsync(directory_descriptor)
        try:
            os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        except FileNotFoundError:
            try:
                os.lstat(path)
            except FileNotFoundError:
                return
        reject()
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 4:
        reject()
    consume(sys.argv[1], sys.argv[2], read_private_digest(sys.argv[3]))
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- || return 1
  return "$python_status"
}

remove_kemerbet_recheck_container() {
  local container_id
  container_id="$(docker_local container ls --all --quiet \
    --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" || return 1
  if [[ -z "$container_id" ]]; then
    return 0
  fi
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || return 1
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}')" == \
    "$PROJECT_NAME|kemerbet-no-transfer-readiness" ]] || return 1
  docker_local container rm --force "$container_id" >/dev/null 2>&1 || return 1
  container_id="$(docker_local container ls --all --quiet \
    --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" || return 1
  [[ -z "$container_id" ]]
}

remove_kemerbet_recheck_network() {
  local network_id
  network_id="$(docker_local network ls --quiet --filter "name=^${KEMERBET_RECHECK_NETWORK}$")" ||
    return 1
  if [[ -z "$network_id" ]]; then
    return 0
  fi
  [[ "$network_id" =~ ^[0-9a-f]{12,64}$ ]] || return 1
  [[ "$(docker_local network inspect "$network_id" \
    --format '{{.Name}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.network" }}')" == \
    "$KEMERBET_RECHECK_NETWORK|$PROJECT_NAME|kemerbet_readiness_egress" ]] || return 1
  docker_local network rm "$network_id" >/dev/null 2>&1 || return 1
  network_id="$(docker_local network ls --quiet --filter "name=^${KEMERBET_RECHECK_NETWORK}$")" ||
    return 1
  [[ -z "$network_id" ]]
}

remove_kemerbet_recheck_candidate() {
  local candidate_mode root_mode
  if [[ ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" && -d "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_RECHECK_CANDIDATE_ROOT")" == "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]] ||
    return 1
  [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_CANDIDATE_ROOT")" == 'root:root' ]] || return 1
  root_mode="$(stat --format='%a' "$KEMERBET_RECHECK_CANDIDATE_ROOT")" || return 1
  [[ "$root_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$root_mode & 8#022) == 0 )) || return 1
  if [[ -e "$KEMERBET_RECHECK_CANDIDATE_BINDING" || -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]]; then
    [[ ! -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" && -f "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]] ||
      return 1
    [[ "$(realpath -- "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
      "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]] || return 1
    [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == 'root:root' ]] || return 1
    candidate_mode="$(stat --format='%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" || return 1
    [[ "$candidate_mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$candidate_mode & 8#022) == 0 )) || return 1
    rm -f -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" || return 1
  fi
  rmdir -- "$KEMERBET_RECHECK_CANDIDATE_ROOT" >/dev/null 2>&1 || return 1
  sync -f "$(dirname -- "$KEMERBET_RECHECK_CANDIDATE_ROOT")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]]
}

KEMERBET_RECHECK_CLEANUP_ARMED='false'
KEMERBET_RECHECK_CANDIDATE_CREATED='false'
KEMERBET_RECHECK_CANDIDATE_DEV_INO=''
KEMERBET_RECHECK_CANDIDATE_DIGEST=''
KEMERBET_RECHECK_FINAL_INSTALLED='false'
KEMERBET_RECHECK_RECEIPT_OWNED='false'
KEMERBET_RECHECK_PROMOTION_OWNED='false'
KEMERBET_RECHECK_PLAYER_IDS_DEV_INO=''
KEMERBET_RECHECK_PLAYER_IDS_DIGEST=''
KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO=''
KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO=''
KEMERBET_RECHECK_OWNER_CLAIM_ID=''
KEMERBET_RECHECK_RELEASE=''
KEMERBET_RECHECK_SESSION_CONTAINER=''
KEMERBET_RECHECK_SOURCE_DEV_INO=''
KEMERBET_RECHECK_SOURCE_DIGEST=''
KEMERBET_RECHECK_IDENTITY_KEY_DIGEST=''
KEMERBET_RECHECK_COMMITTED='false'
KEMERBET_RECHECK_DURABLE_SUCCESS='false'
KEMERBET_RECHECK_RECOVERY_OUTCOME=''
KEMERBET_TEARDOWN_RECOVERY_FAILED='false'
KEMERBET_EMERGENCY_TEARDOWN_FAILED='false'
KEMERBET_RECOVERY_LATCH_DEV_INO=''

require_retryable_kemerbet_binding_source() {
  local expected_dev_ino="$1" expected_digest="$2"
  [[ "$expected_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$expected_digest" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" ]] || return 1
  [[ "$(stat --format='%d:%i:%u:%g:%a:%h' "$KEMERBET_READINESS_BINDING")" == \
    "$expected_dev_ino:10001:10001:600:1" &&
    "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$expected_digest" ]] ||
    return 1
  require_kemerbet_readiness_output_directory >/dev/null 2>&1
}

consume_exact_kemerbet_binding_source() {
  consume_exact_one_use_kemerbet_file "$KEMERBET_READINESS_BINDING" "$1" "$2"
}

rollback_kemerbet_recheck_final_binding() {
  local final_dev_ino final_digest
  if [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" && -f "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
    return 1
  [[ "$(stat --format='%U:%G' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == 'root:root' ]] || return 1
  final_dev_ino="$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" || return 1
  final_digest="$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" || return 1
  [[ -n "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" &&
    "$final_dev_ino" == "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" &&
    "$final_digest" == "$KEMERBET_RECHECK_CANDIDATE_DIGEST" ]] || return 1
  rm -f -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" || return 1
  sync -f "$(dirname -- "$KEMERBET_AGENT_IDENTITY_BINDINGS")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]]
}

remove_owned_kemerbet_recheck_receipt_root() {
  local entry entry_mode root_mode
  if [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    return 1
  [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root' ]] || return 1
  root_mode="$(stat --format='%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" || return 1
  [[ "$root_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$root_mode & 8#022) == 0 )) || return 1
  while IFS= read -r -d '' entry; do
    [[ "$entry" == "$KEMERBET_RECHECK_RECEIPT" ||
      "$entry" == "$KEMERBET_RECHECK_RECEIPT_ROOT"/.ready-v1.* ]] || return 1
    [[ ! -L "$entry" && -f "$entry" && "$(stat --format='%U:%G' "$entry")" == 'root:root' ]] ||
      return 1
    entry_mode="$(stat --format='%a' "$entry")" || return 1
    [[ "$entry_mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$entry_mode & 8#022) == 0 )) || return 1
  done < <(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -print0)
  find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -type f -delete || return 1
  rmdir -- "$KEMERBET_RECHECK_RECEIPT_ROOT" >/dev/null 2>&1 || return 1
  sync -f "$(dirname -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]
}

remove_owned_kemerbet_recheck_promotion_root() {
  local entry entry_mode root_mode
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    return 1
  [[ "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    return 1
  [[ "$(stat --format='%U:%G' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root' ]] || return 1
  root_mode="$(stat --format='%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" || return 1
  [[ "$root_mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$root_mode & 8#022) == 0 )) || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" ]] ||
    return 1
  while IFS= read -r -d '' entry; do
    [[ "$entry" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ||
      "$entry" == "$KEMERBET_RECHECK_PROMOTION_ROOT"/.pending-v1.* ]] || return 1
    [[ ! -L "$entry" && -f "$entry" && "$(stat --format='%U:%G' "$entry")" == 'root:root' ]] ||
      return 1
    entry_mode="$(stat --format='%a' "$entry")" || return 1
    [[ "$entry_mode" =~ ^[0-7]{3,4}$ ]] || return 1
    (( (8#$entry_mode & 8#022) == 0 )) || return 1
  done < <(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -print0)
  find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -type f -delete || return 1
  rmdir -- "$KEMERBET_RECHECK_PROMOTION_ROOT" >/dev/null 2>&1 || return 1
  sync -f "$(dirname -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" >/dev/null 2>&1 || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]
}

repair_kemerbet_identity_key_readability() {
  local metadata parent parent_mode
  parent="$(dirname -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  [[ ! -L "$parent" && -d "$parent" && "$(realpath -- "$parent")" == "$parent" &&
    "$(stat --format='%U:%G' "$parent")" == 'root:root' ]] || return 1
  parent_mode="$(stat --format='%a' "$parent")" || return 1
  case "$parent_mode" in
    700) ;;
    755) chmod 0700 "$parent" >/dev/null 2>&1 || return 1 ;;
    *) return 1 ;;
  esac
  [[ "$(stat --format='%U:%G:%a' "$parent")" == 'root:root:700' ]] || return 1
  sync -f "$parent" >/dev/null 2>&1 || return 1
  [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" ]] ||
    return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] || return 1
  metadata="$(stat --format='%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  case "$metadata" in
    0:0:444) return 0 ;;
    10001:10001:400|10001:10001:444|0:0:400) ;;
    *) return 1 ;;
  esac
  chown root:root "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" >/dev/null 2>&1 || return 1
  chmod 0444 "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" >/dev/null 2>&1 || return 1
  sync -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" >/dev/null 2>&1 || return 1
  [[ "$(stat --format='%U:%G:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == 'root:root:444' ]]
}

kemerbet_recheck_cleanup_trap() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT
  trap '' INT TERM HUP
  set +e
  if [[ "$KEMERBET_RECHECK_CLEANUP_ARMED" == 'true' ]]; then
    remove_kemerbet_recheck_container || cleanup_status=1
    remove_kemerbet_recheck_network || cleanup_status=1
    if [[ -n "$KEMERBET_RECHECK_RELEASE" && -n "$KEMERBET_RECHECK_SESSION_CONTAINER" ]]; then
      remove_exact_kemerbet_session_provision \
        "$KEMERBET_RECHECK_SESSION_CONTAINER" "$KEMERBET_RECHECK_RELEASE" || cleanup_status=1
    fi
    kemerbet_profile_volume_holders_match '' || cleanup_status=1
    if [[ "$KEMERBET_RECHECK_DURABLE_SUCCESS" != 'true' && "$KEMERBET_RECHECK_COMMITTED" != 'true' ]]; then
      if [[ "$KEMERBET_RECHECK_RECEIPT_OWNED" == 'true' ]]; then
        remove_owned_kemerbet_recheck_receipt_root || cleanup_status=1
      fi
      rollback_kemerbet_recheck_final_binding || cleanup_status=1
      if [[ "$KEMERBET_RECHECK_CANDIDATE_CREATED" == 'true' ]]; then
        remove_kemerbet_recheck_candidate || cleanup_status=1
      fi
      if [[ -n "$KEMERBET_RECHECK_SOURCE_DEV_INO" && -n "$KEMERBET_RECHECK_SOURCE_DIGEST" ]]; then
        require_retryable_kemerbet_binding_source \
          "$KEMERBET_RECHECK_SOURCE_DEV_INO" "$KEMERBET_RECHECK_SOURCE_DIGEST" || cleanup_status=1
      else
        cleanup_status=1
      fi
      if [[ -n "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" &&
        -n "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]]; then
        consume_exact_one_use_kemerbet_file \
          "$KEMERBET_READINESS_PLAYER_IDS" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
          "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" || cleanup_status=1
      else
        # Import may have failed after creating a target but before shell captured its inode.
        # Keep the journal so locked recovery can bind/consume only the exact staged content.
        cleanup_status=1
      fi
      repair_kemerbet_identity_key_readability || cleanup_status=1
      if [[ -n "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" &&
        -n "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" &&
        -n "$KEMERBET_RECHECK_OWNER_CLAIM_ID" &&
        -n "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]]; then
        if [[ "$cleanup_status" -eq 0 ]]; then
          # Publish retryable failure only after the sealed binding source remains exact, the
          # internal copy is durably absent, and both digest-bound Owner stages are restored.
          restore_retryable_owner_staged_kemerbet_cohort || cleanup_status=1
        else
          # Best-effort restoration is safe, but an incomplete rollback must retain its journal
          # and must not expose failed-v1 as a directly retryable state.
          restore_owner_staged_kemerbet_cohort || cleanup_status=1
        fi
      else
        cleanup_status=1
      fi
      if [[ "$KEMERBET_RECHECK_PROMOTION_OWNED" == 'true' ]]; then
        # The journal is the crash-recovery authority. Retire it only after every rollback,
        # source-restoration, marker, and secret-repair step succeeded.
        if [[ "$cleanup_status" -eq 0 ]]; then
          remove_owned_kemerbet_recheck_promotion_root || cleanup_status=1
        fi
      fi
    fi
  fi
  if [[ "$original_status" -eq 0 && "$cleanup_status" -ne 0 ]]; then
    original_status=1
  fi
  exit "$original_status"
}

kemerbet_recheck_signal_trap() {
  local status="$1"
  [[ "$status" =~ ^(129|130|143)$ ]] || status=1
  exit "$status"
}

record_kemerbet_recheck_receipt() {
  local commit_sha="$1"
  local binding_digest="$2"
  local identity_key_digest="$3"
  local selector_digest="$4"
  local image_id="$5"
  local profile_identity_digest="$6"
  local temporary
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the KemerBet recheck receipt release identity is invalid'
  [[ "$binding_digest" =~ ^[0-9a-f]{64}$ && "$identity_key_digest" =~ ^[0-9a-f]{64}$ &&
    "$selector_digest" =~ ^[0-9a-f]{64}$ && "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet recheck receipt digest contract is invalid'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'the KemerBet recheck receipt image identity is invalid'
  [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    die 'the KemerBet recheck receipt root already exists'
  install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_RECEIPT_ROOT"
  sync -f "$(dirname -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" ||
    die 'the KemerBet recheck receipt parent could not be synchronized'
  temporary="$(mktemp "$KEMERBET_RECHECK_RECEIPT_ROOT/.ready-v1.XXXXXX")" ||
    die 'the KemerBet recheck receipt could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    "release=$commit_sha" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "profile_identity_sha256=$profile_identity_digest" >"$temporary"; then
    rm -f -- "$temporary"
    rmdir -- "$KEMERBET_RECHECK_RECEIPT_ROOT" >/dev/null 2>&1 || true
    die 'the KemerBet recheck receipt could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" || die 'the KemerBet recheck receipt could not be synchronized'
  if ! ln -- "$temporary" "$KEMERBET_RECHECK_RECEIPT"; then
    rm -f -- "$temporary"
    rmdir -- "$KEMERBET_RECHECK_RECEIPT_ROOT" >/dev/null 2>&1 || true
    die 'the KemerBet recheck receipt could not be sealed atomically'
  fi
  rm -f -- "$temporary"
  sync -f "$KEMERBET_RECHECK_RECEIPT_ROOT" || die 'the KemerBet recheck receipt directory could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT" && -f "$KEMERBET_RECHECK_RECEIPT" ]] ||
    die 'the KemerBet recheck receipt is not a safe regular file'
  [[ "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT")" == 'root:root:600' ]] ||
    die 'the KemerBet recheck receipt ownership or mode is unsafe'
}

require_kemerbet_recheck_receipt() {
  local commit_sha="$1"
  local binding_digest="$2"
  local identity_key_digest="$3"
  local selector_digest="$4"
  local image_id="$5"
  local profile_identity_digest="$6"
  local actual_digest entries expected_digest
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    die 'the KemerBet recheck receipt root is absent or symbolic'
  [[ "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
    die 'the KemerBet recheck receipt root is not canonical'
  [[ "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'the KemerBet recheck receipt root ownership or mode is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the KemerBet recheck receipt root could not be inspected'
  [[ "$entries" == 'ready-v1' ]] || die 'the KemerBet recheck receipt root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT" && -f "$KEMERBET_RECHECK_RECEIPT" ]] ||
    die 'the KemerBet recheck receipt is absent or symbolic'
  [[ "$(realpath -- "$KEMERBET_RECHECK_RECEIPT")" == "$KEMERBET_RECHECK_RECEIPT" ]] ||
    die 'the KemerBet recheck receipt is not canonical'
  [[ "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_RECEIPT")" == 'root:root:600:1' ]] ||
    die 'the KemerBet recheck receipt ownership, mode, or link count is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      "release=$commit_sha" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "profile_identity_sha256=$profile_identity_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_RECEIPT" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the KemerBet recheck receipt content is not exact'
}

record_kemerbet_recheck_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_digest="$3"
  local identity_key_digest="$4"
  local selector_digest="$5"
  local image_id="$6"
  local session_container="$7"
  local owner_player_ids_dev_ino="$8"
  local owner_claim_dev_ino="$9"
  local claim_id="${10}"
  local player_ids_digest="${11}"
  local temporary
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the KemerBet promotion-journal release identity is invalid'
  [[ "$source_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$owner_player_ids_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$owner_claim_dev_ino" =~ ^[0-9]+:[0-9]+$ ]] ||
    die 'the KemerBet promotion-journal file identity is invalid'
  [[ "$binding_digest" =~ ^[0-9a-f]{64}$ && "$identity_key_digest" =~ ^[0-9a-f]{64}$ &&
    "$selector_digest" =~ ^[0-9a-f]{64}$ && "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet promotion-journal digest contract is invalid'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'the KemerBet promotion-journal image identity is invalid'
  [[ "$session_container" == 'none' || "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the KemerBet promotion-journal session identity is invalid'
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'the KemerBet promotion-journal claim identity is invalid'
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    die 'the KemerBet promotion-journal root already exists'
  install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_PROMOTION_ROOT"
  sync -f "$(dirname -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" ||
    die 'the KemerBet promotion-journal parent could not be synchronized'
  temporary="$(mktemp "$KEMERBET_RECHECK_PROMOTION_ROOT/.pending-v1.XXXXXX")" ||
    die 'the KemerBet promotion journal could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    'state=import_prepared' \
    "release=$commit_sha" \
    "source_dev_ino=$source_dev_ino" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "session_container=$session_container" \
    "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
    "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
    "claim_id=$claim_id" \
    "player_ids_sha256=$player_ids_digest" >"$temporary"; then
    die 'the KemerBet promotion journal could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" || die 'the KemerBet promotion journal could not be synchronized'
  ln -- "$temporary" "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ||
    die 'the KemerBet promotion journal could not be sealed without overwrite'
  rm -f -- "$temporary"
  sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
    die 'the KemerBet promotion-journal root could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the KemerBet promotion-journal root is unsafe'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the KemerBet promotion journal is unsafe'
}

require_kemerbet_recheck_import_prepared_promotion_journal() {
  local commit_sha="$1" source_dev_ino="$2" binding_digest="$3"
  local identity_key_digest="$4" selector_digest="$5" image_id="$6"
  local session_container="$7" owner_player_ids_dev_ino="$8"
  local owner_claim_dev_ino="$9" claim_id="${10}"
  local player_ids_digest="${11}"
  local actual_digest entries expected_digest
  [[ "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the import-prepared KemerBet Player-ID digest is invalid'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the import-prepared KemerBet promotion-journal root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the import-prepared KemerBet promotion-journal root could not be inspected'
  [[ "$entries" == 'pending-v1' ]] || die 'the import-prepared KemerBet promotion-journal root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the import-prepared KemerBet promotion journal is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      'state=import_prepared' \
      "release=$commit_sha" \
      "source_dev_ino=$source_dev_ino" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "session_container=$session_container" \
      "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
      "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
      "claim_id=$claim_id" \
      "player_ids_sha256=$player_ids_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the import-prepared KemerBet promotion journal content is not exact'
}

advance_kemerbet_recheck_import_journal_to_prepared() {
  local commit_sha="$1" source_dev_ino="$2" binding_digest="$3"
  local identity_key_digest="$4" selector_digest="$5" image_id="$6"
  local session_container="$7" player_ids_dev_ino="$8"
  local owner_player_ids_dev_ino="$9" owner_claim_dev_ino="${10}" claim_id="${11}"
  local player_ids_digest="${12}"
  local temporary
  require_kemerbet_recheck_import_prepared_promotion_journal \
    "$commit_sha" "$source_dev_ino" "$binding_digest" "$identity_key_digest" \
    "$selector_digest" "$image_id" "$session_container" \
    "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" "$claim_id" "$player_ids_digest"
  [[ "$player_ids_dev_ino" =~ ^[0-9]+:[0-9]+$ ]] ||
    die 'the prepared KemerBet Player-ID identity is invalid'
  temporary="$(mktemp "$KEMERBET_RECHECK_PROMOTION_ROOT/.pending-v1.XXXXXX")" ||
    die 'the prepared KemerBet promotion journal could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    'state=prepared' \
    "release=$commit_sha" \
    "source_dev_ino=$source_dev_ino" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "session_container=$session_container" \
    "player_ids_dev_ino=$player_ids_dev_ino" \
    "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
    "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
    "claim_id=$claim_id" \
    "player_ids_sha256=$player_ids_digest" >"$temporary"; then
    die 'the prepared KemerBet promotion journal could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" || die 'the prepared KemerBet promotion journal could not be synchronized'
  mv -f -- "$temporary" "$KEMERBET_RECHECK_PROMOTION_JOURNAL"
  sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
    die 'the prepared KemerBet promotion-journal root could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the prepared KemerBet promotion journal is unsafe'
}

advance_kemerbet_recheck_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_dev_ino="$3"
  local binding_digest="$4"
  local identity_key_digest="$5"
  local selector_digest="$6"
  local image_id="$7"
  local profile_identity_digest="$8"
  local session_container="$9"
  local player_ids_dev_ino="${10}"
  local owner_player_ids_dev_ino="${11}"
  local owner_claim_dev_ino="${12}"
  local claim_id="${13}"
  local player_ids_digest="${14}"
  local temporary
  require_kemerbet_recheck_prepared_promotion_journal \
    "$commit_sha" "$source_dev_ino" \
    "$binding_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
    "$session_container" "$player_ids_dev_ino" \
    "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" "$claim_id" "$player_ids_digest"
  [[ "$binding_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet candidate-bound promotion identity is invalid'
  temporary="$(mktemp "$KEMERBET_RECHECK_PROMOTION_ROOT/.pending-v1.XXXXXX")" ||
    die 'the candidate-bound KemerBet promotion journal could not be prepared'
  if ! printf '%s\n' \
    'version=1' \
    'state=candidate_bound' \
    "release=$commit_sha" \
    "source_dev_ino=$source_dev_ino" \
    "binding_dev_ino=$binding_dev_ino" \
    "binding_sha256=$binding_digest" \
    "identity_hmac_key_sha256=$identity_key_digest" \
    "selector_sha256=$selector_digest" \
    "image_id=$image_id" \
    "profile_volume=$KEMERBET_PROFILE_VOLUME" \
    "profile_identity_sha256=$profile_identity_digest" \
    "session_container=$session_container" \
    "player_ids_dev_ino=$player_ids_dev_ino" \
    "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
    "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
    "claim_id=$claim_id" \
    "player_ids_sha256=$player_ids_digest" >"$temporary"; then
    die 'the candidate-bound KemerBet promotion journal could not be written'
  fi
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary" ||
    die 'the candidate-bound KemerBet promotion journal could not be synchronized'
  mv -f -- "$temporary" "$KEMERBET_RECHECK_PROMOTION_JOURNAL"
  sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
    die 'the candidate-bound KemerBet promotion-journal root could not be synchronized'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the candidate-bound KemerBet promotion journal is unsafe'
}

require_kemerbet_recheck_prepared_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_digest="$3"
  local identity_key_digest="$4"
  local selector_digest="$5"
  local image_id="$6"
  local session_container="$7"
  local player_ids_dev_ino="$8"
  local owner_player_ids_dev_ino="$9"
  local owner_claim_dev_ino="${10}"
  local claim_id="${11}"
  local player_ids_digest="${12}"
  local actual_digest entries expected_digest
  [[ "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the prepared KemerBet Player-ID digest is invalid'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the prepared KemerBet promotion-journal root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the prepared KemerBet promotion-journal root could not be inspected'
  [[ "$entries" == 'pending-v1' ]] || die 'the prepared KemerBet promotion-journal root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the prepared KemerBet promotion journal is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      'state=prepared' \
      "release=$commit_sha" \
      "source_dev_ino=$source_dev_ino" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "session_container=$session_container" \
      "player_ids_dev_ino=$player_ids_dev_ino" \
      "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
      "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
      "claim_id=$claim_id" \
      "player_ids_sha256=$player_ids_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the prepared KemerBet promotion journal content is not exact'
}

require_kemerbet_recheck_promotion_journal() {
  local commit_sha="$1"
  local source_dev_ino="$2"
  local binding_dev_ino="$3"
  local binding_digest="$4"
  local identity_key_digest="$5"
  local selector_digest="$6"
  local image_id="$7"
  local profile_identity_digest="$8"
  local session_container="$9"
  local player_ids_dev_ino="${10}"
  local owner_player_ids_dev_ino="${11}"
  local owner_claim_dev_ino="${12}"
  local claim_id="${13}"
  local player_ids_digest="${14}"
  local actual_digest entries expected_digest
  [[ "$source_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$binding_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the KemerBet promotion journal file identity is invalid'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'the KemerBet promotion-journal root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the KemerBet promotion-journal root could not be inspected'
  [[ "$entries" == 'pending-v1' ]] || die 'the KemerBet promotion-journal root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the KemerBet promotion journal is unsafe'
  expected_digest="$({
    printf '%s\n' \
      'version=1' \
      'state=candidate_bound' \
      "release=$commit_sha" \
      "source_dev_ino=$source_dev_ino" \
      "binding_dev_ino=$binding_dev_ino" \
      "binding_sha256=$binding_digest" \
      "identity_hmac_key_sha256=$identity_key_digest" \
      "selector_sha256=$selector_digest" \
      "image_id=$image_id" \
      "profile_volume=$KEMERBET_PROFILE_VOLUME" \
      "profile_identity_sha256=$profile_identity_digest" \
      "session_container=$session_container" \
      "player_ids_dev_ino=$player_ids_dev_ino" \
      "owner_stage_player_ids_dev_ino=$owner_player_ids_dev_ino" \
      "owner_stage_claim_dev_ino=$owner_claim_dev_ino" \
      "claim_id=$claim_id" \
      "player_ids_sha256=$player_ids_digest"
  } | sha256sum | awk '{print $1}')"
  actual_digest="$(sha256sum -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] ||
    die 'the KemerBet promotion journal content is not exact'
}

require_committed_kemerbet_recheck_boundary_shape() {
  local binding_digest entries
  local -a receipt_lines=()
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'an interrupted committed KemerBet receipt root is unsafe'
  entries="$(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'an interrupted committed KemerBet receipt root could not be inspected'
  [[ "$entries" == 'ready-v1' ]] || die 'an interrupted committed KemerBet receipt root is not exact'
  [[ ! -L "$KEMERBET_RECHECK_RECEIPT" && -f "$KEMERBET_RECHECK_RECEIPT" &&
    "$(realpath -- "$KEMERBET_RECHECK_RECEIPT")" == "$KEMERBET_RECHECK_RECEIPT" &&
    "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_RECEIPT")" == 'root:root:600:1' ]] ||
    die 'an interrupted committed KemerBet receipt is unsafe'
  mapfile -t receipt_lines <"$KEMERBET_RECHECK_RECEIPT"
  [[ "${#receipt_lines[@]}" -eq 8 &&
    "${receipt_lines[0]}" == 'version=1' &&
    "${receipt_lines[1]}" =~ ^release=[0-9a-f]{40}$ &&
    "${receipt_lines[2]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
    "${receipt_lines[3]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
    "${receipt_lines[4]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
    "${receipt_lines[5]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
    "${receipt_lines[6]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
    "${receipt_lines[7]}" =~ ^profile_identity_sha256=[0-9a-f]{64}$ ]] ||
    die 'an interrupted committed KemerBet receipt content is invalid'
  binding_digest="${receipt_lines[2]#binding_sha256=}"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '1' &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" ]] ||
    die 'an interrupted committed KemerBet binding does not match its receipt'
}

require_current_kemerbet_success_runtime_boundary() {
  local commit_sha="$1" binding_digest="$2" identity_key_digest="$3"
  local selector_digest="$4" image_id="$5" profile_identity_digest="$6"
  local receipt_policy="$7"
  local account_id binding_fingerprint binding_line binding_residue observed_profile_identity_digest
  local profile_mountpoint
  local recheck_container recheck_network
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ && "$binding_digest" =~ ^[0-9a-f]{64}$ &&
    "$identity_key_digest" =~ ^[0-9a-f]{64}$ && "$selector_digest" =~ ^[0-9a-f]{64}$ &&
    "$image_id" =~ ^sha256:[0-9a-f]{64}$ && "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the committed KemerBet runtime boundary identity is invalid'
  case "$receipt_policy" in
    require-absent-receipt)
      [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
        die 'the precommit KemerBet receipt boundary is not empty'
      ;;
    require-receipt)
      require_kemerbet_recheck_receipt \
        "$commit_sha" "$binding_digest" "$identity_key_digest" "$selector_digest" \
        "$image_id" "$profile_identity_digest"
      ;;
    *) die 'the committed KemerBet receipt policy is invalid' ;;
  esac
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" =~ ^(1|2)$ &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
    "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" ]] ||
    die 'the committed KemerBet runtime input digest changed'
  [[ "$(wc -l <"$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '1' ]] ||
    die 'the committed KemerBet binding shape is invalid'
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
    "$KEMERBET_AGENT_IDENTITY_BINDINGS" || die 'the committed KemerBet binding contract is invalid'
  binding_line="$(<"$KEMERBET_AGENT_IDENTITY_BINDINGS")"
  IFS=' ' read -r account_id binding_fingerprint binding_residue <<<"$binding_line"
  [[ -n "$account_id" && -n "$binding_fingerprint" && -z "$binding_residue" ]] ||
    die 'the committed KemerBet binding fields are invalid'
  profile_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" || return 1
  observed_profile_identity_digest="$(kemerbet_profile_identity_digest \
    "$account_id" "$profile_mountpoint" require-absent-singletons)" || return 1
  [[ "$observed_profile_identity_digest" == "$profile_identity_digest" ]] ||
    die 'the committed KemerBet profile identity changed'
  [[ "$(docker_local image inspect "$image_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{ index .Config.Labels "org.opencontainers.image.title" }}|{{.Config.User}}')" == \
    "$commit_sha|fetanagent-deposit-executor|10001:10001" ]] ||
    die 'the committed KemerBet image provenance is invalid'
  require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
  require_owner_kemerbet_receipt_service_access
  require_kemerbet_profile_volume_holders ''
  recheck_container="$(docker_local container ls --all --quiet \
    --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" ||
    die 'the committed KemerBet recheck container inventory could not be inspected'
  [[ -z "$recheck_container" ]] || die 'the committed KemerBet recheck retained a container'
  recheck_network="$(docker_local network ls --quiet --filter "name=^${KEMERBET_RECHECK_NETWORK}$")" ||
    die 'the committed KemerBet recheck network inventory could not be inspected'
  [[ -z "$recheck_network" ]] || die 'the committed KemerBet recheck retained a network'
}

require_precommit_kemerbet_artifact_boundary() {
  local source_dev_ino="$1" binding_dev_ino="$2" binding_digest="$3"
  local player_ids_dev_ino="$4" player_ids_digest="$5" control_mountpoint claim_path player_path
  [[ "$source_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$binding_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$binding_digest" =~ ^[0-9a-f]{64}$ && "$player_ids_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$player_ids_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the precommit KemerBet artifact identity is invalid'
  require_retryable_kemerbet_binding_source "$source_dev_ino" "$binding_digest" ||
    die 'the precommit sealed KemerBet binding source is not exact'
  require_root_readable_immutable_file "$KEMERBET_READINESS_PLAYER_IDS"
  [[ "$(stat --format='%d:%i:%h' "$KEMERBET_READINESS_PLAYER_IDS")" == "$player_ids_dev_ino:1" &&
    "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" ]] ||
    die 'the precommit KemerBet Player-ID input is not journal-exact'
  require_root_readable_immutable_file "$KEMERBET_RECHECK_CANDIDATE_BINDING"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
  [[ "$(stat --format='%d:%i:%h' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == "$binding_dev_ino:2" &&
    "$(stat --format='%d:%i:%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == "$binding_dev_ino:2" &&
    "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$binding_digest" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" ]] ||
    die 'the precommit canonical KemerBet binding is not journal-exact'
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  player_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  [[ ! -L "$player_path" && -f "$player_path" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h' "$player_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO:0:0:444:1" &&
    "$(sha256sum -- "$player_path" | awk '{print $1}')" == "$player_ids_digest" &&
    ! -L "$claim_path" && -f "$claim_path" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$claim_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO:0:0:444:1:37" ]] ||
    die 'the precommit Owner KemerBet cohort pair is not journal-exact'
  cmp -s -- "$claim_path" <(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID") ||
    die 'the precommit Owner KemerBet claim changed'
  owner_kemerbet_cohort_marker require-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
    die 'the precommit Owner KemerBet imported marker is not exact'
}

require_committed_kemerbet_cleanup_artifacts() {
  local source_dev_ino="$1" binding_dev_ino="$2" binding_digest="$3"
  local player_ids_dev_ino="$4" player_ids_digest="$5" canonical_links
  canonical_links="$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" ||
    die 'the committed canonical KemerBet binding link count is unavailable'
  if [[ -e "$KEMERBET_RECHECK_CANDIDATE_BINDING" || -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]]; then
    [[ "$canonical_links" == '2' && ! -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" &&
      "$(stat --format='%d:%i:%u:%g:%a:%h' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
      "$binding_dev_ino:0:0:444:2" &&
      "$(stat --format='%d:%i:%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == "$binding_dev_ino:2" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$binding_digest" ]] ||
      die 'the committed KemerBet candidate cleanup prefix is unsafe'
  else
    [[ "$canonical_links" == '1' &&
      "$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == "$binding_dev_ino" ]] ||
      die 'the committed canonical KemerBet binding identity is unsafe'
  fi
  if [[ -e "$KEMERBET_READINESS_BINDING" || -L "$KEMERBET_READINESS_BINDING" ]]; then
    require_retryable_kemerbet_binding_source "$source_dev_ino" "$binding_digest" ||
      die 'the committed sealed KemerBet binding cleanup prefix is unsafe'
  fi
  if [[ -e "$KEMERBET_READINESS_PLAYER_IDS" || -L "$KEMERBET_READINESS_PLAYER_IDS" ]]; then
    [[ ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      "$(stat --format='%d:%i:%u:%g:%a:%h' "$KEMERBET_READINESS_PLAYER_IDS")" == \
      "$player_ids_dev_ino:0:0:444:1" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" ]] ||
      die 'the committed KemerBet Player-ID cleanup prefix is unsafe'
  fi
}

require_completed_kemerbet_recheck_for_release() {
  local commit_sha="$1" image_tag="$2"
  local account_id binding_digest binding_fingerprint binding_line binding_residue
  local identity_key_digest image_id observed_profile_identity_digest profile_identity_digest
  local profile_mountpoint
  local recheck_container recheck_network selector_digest
  local -a receipt_lines=()
  validate_commit_and_tag "$commit_sha" "$image_tag"
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    die 'a completed KemerBet recheck still has a promotion journal'
  require_completed_owner_kemerbet_cohort_marker
  require_committed_kemerbet_recheck_boundary_shape
  mapfile -t receipt_lines <"$KEMERBET_RECHECK_RECEIPT"
  [[ "${receipt_lines[1]}" == "release=$commit_sha" ]] ||
    die 'the completed KemerBet recheck belongs to another reviewed release'
  binding_digest="${receipt_lines[2]#binding_sha256=}"
  identity_key_digest="${receipt_lines[3]#identity_hmac_key_sha256=}"
  selector_digest="${receipt_lines[4]#selector_sha256=}"
  image_id="${receipt_lines[5]#image_id=}"
  profile_identity_digest="${receipt_lines[7]#profile_identity_sha256=}"
  require_kemerbet_recheck_receipt \
    "$commit_sha" "$binding_digest" "$identity_key_digest" "$selector_digest" \
    "$image_id" "$profile_identity_digest"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
  [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$binding_digest" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
    "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" ]] ||
    die 'a completed KemerBet recheck digest no longer matches its receipt'
  [[ "$(wc -l <"$KEMERBET_AGENT_IDENTITY_BINDINGS")" == '1' ]] ||
    die 'the completed KemerBet binding shape is invalid'
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
    "$KEMERBET_AGENT_IDENTITY_BINDINGS" || die 'the completed KemerBet binding contract is invalid'
  binding_line="$(<"$KEMERBET_AGENT_IDENTITY_BINDINGS")"
  IFS=' ' read -r account_id binding_fingerprint binding_residue <<<"$binding_line"
  [[ -n "$account_id" && -n "$binding_fingerprint" && -z "$binding_residue" ]] ||
    die 'the completed KemerBet binding fields are invalid'
  profile_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" || return 1
  observed_profile_identity_digest="$(kemerbet_profile_identity_digest \
    "$account_id" "$profile_mountpoint" require-absent-singletons)" || return 1
  [[ "$observed_profile_identity_digest" == "$profile_identity_digest" ]] ||
    die 'the completed KemerBet profile identity changed'
  [[ "$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" --format '{{.Id}}')" == \
    "$image_id" ]] || die 'the completed KemerBet image identity is unavailable or changed'
  [[ "$(docker_local image inspect "$image_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{ index .Config.Labels "org.opencontainers.image.title" }}|{{.Config.User}}')" == \
    "$commit_sha|fetanagent-deposit-executor|10001:10001" ]] ||
    die 'the completed KemerBet image provenance is invalid'
  require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
  require_owner_kemerbet_receipt_service_access
  require_kemerbet_profile_volume_holders ''
  recheck_container="$(docker_local container ls --all --quiet \
    --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" ||
    die 'the completed KemerBet recheck container inventory could not be inspected'
  [[ -z "$recheck_container" ]] || die 'the completed KemerBet recheck retained a container'
  recheck_network="$(docker_local network ls --quiet --filter "name=^${KEMERBET_RECHECK_NETWORK}$")" ||
    die 'the completed KemerBet recheck network inventory could not be inspected'
  [[ -z "$recheck_network" ]] || die 'the completed KemerBet recheck retained a network'
  [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
    die 'a completed KemerBet recheck retained a consumed input'
  require_kemerbet_readiness_output_directory
}

remove_exact_kemerbet_session_provision() {
  local expected_container="$1" commit_sha="$2"
  local actual_container environment mount_source state
  [[ "$expected_container" == 'none' || "$expected_container" =~ ^[0-9a-f]{12,64}$ ]] || return 1
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  actual_container="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  if [[ "$expected_container" == 'none' ]]; then
    [[ -z "$actual_container" ]]
    return $?
  fi
  if [[ -z "$actual_container" ]]; then
    return 0
  fi
  [[ "$actual_container" == "$expected_container" ]] || return 1
  [[ "$(docker_local container inspect "$actual_container" \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.Config.User}}|{{json .Config.Cmd}}')" == \
    "$PROJECT_NAME|kemerbet-session-provision|$commit_sha|10001:10001|[\"node\",\"apps/executor/dist/kemerbet-session-provision-server.js\"]" ]] || return 1
  environment="$(docker_local container inspect "$actual_container" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
  for expected_environment in \
    'NODE_ENV=production' \
    'FINANCIAL_ACTIONS_MODE=dry_run' \
    'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \
    'KEMERBET_EXECUTOR_ENABLED=false' \
    'KEMERBET_FINAL_ACTION_ENABLED=false' \
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false'; do
    grep -Fxq "$expected_environment" <<<"$environment" || return 1
  done
  ! grep -Eq '(DATABASE|PASSWORD|SECRET|TOKEN|HMAC|SUPABASE|PLAYER|RECEIVER|SELECTOR|IDENTITY)' \
    <<<"$environment" || return 1
  mount_source="$(docker_local container inspect "$actual_container" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/fetanagent/kemerbet-sessions"}}{{.Name}}{{end}}{{end}}')" || return 1
  [[ "$mount_source" == "$KEMERBET_PROFILE_VOLUME" ]] || return 1
  state="$(docker_local container inspect "$actual_container" --format '{{.State.Status}}')" || return 1
  case "$state" in
    running) docker_local container stop --time 70 "$actual_container" >/dev/null || return 1 ;;
    exited) ;;
    *) return 1 ;;
  esac
  docker_local container rm "$actual_container" >/dev/null || return 1
  actual_container="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" || return 1
  [[ -z "$actual_container" ]]
}

remove_journaled_kemerbet_session_provision() {
  remove_exact_kemerbet_session_provision "$1" "$2" ||
    die 'the journaled KemerBet session could not be removed safely'
}

inspect_kemerbet_recovery_latch() {
  local ancestor latch_path='' path present_count=0
  for ancestor in / /var /var/lib; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor" 2>/dev/null)" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor" 2>/dev/null)" == '0:0:755' ]] || return 2
  done
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_PARENT" && ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" ]]; then
    [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]] || return 2
    return 1
  fi
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" && -d "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_PARENT" 2>/dev/null)" == "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_PARENT" 2>/dev/null)" == '0:0:755' ]] || return 2
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]]; then
    return 1
  fi
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" && -d "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_ROOT" 2>/dev/null)" == "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_ROOT" 2>/dev/null)" == '0:0:755' ]] || return 2
  for path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME"; do
    if [[ -e "$path" || -L "$path" ]]; then
      present_count=$((present_count + 1))
      latch_path="$path"
    fi
  done
  [[ "$present_count" -ne 0 ]] || return 1
  [[ "$present_count" -eq 1 && ! -L "$latch_path" && -f "$latch_path" &&
    "$(realpath -- "$latch_path" 2>/dev/null)" == "$latch_path" &&
    "$(stat --format='%u:%g:%a:%h' "$latch_path" 2>/dev/null)" == '0:0:400:1' ]] || return 2
  cmp -s -- "$latch_path" \
    <(printf '%s\n' 'fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1') || return 2
  return 0
}

inspect_kemerbet_recovery_fallback() {
  local fallback_path='' path present_count=0
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 1
  fi
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == '0:0:700' ]] || return 2
  for path in \
    "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" \
    "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME"; do
    if [[ -e "$path" || -L "$path" ]]; then
      present_count=$((present_count + 1))
      fallback_path="$path"
    fi
  done
  [[ "$present_count" -ne 0 ]] || return 1
  [[ "$present_count" -eq 1 && ! -L "$fallback_path" && -f "$fallback_path" &&
    "$(realpath -- "$fallback_path" 2>/dev/null)" == "$fallback_path" &&
    "$(stat --format='%u:%g:%a:%h' "$fallback_path" 2>/dev/null)" == '0:0:400:1' ]] || return 2
  cmp -s -- "$fallback_path" \
    <(printf '%s\n' 'fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1') || return 2
  return 0
}

durably_retain_fixed_kemerbet_recovery_residue() {
  local policy="$1" root="$2" final_name="$3" installing_name="$4"
  [[ "$policy" =~ ^(receipt|promotion)$ && "$root" == /* && "$final_name" != */* &&
    "$installing_name" != */* ]] || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$policy" "$root" "$final_name" "$installing_name" \
    "$(basename -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"
RECEIPT_MARKERS = {
    'kemerbet-readiness-cohort-imported-v1',
    '.kemerbet-readiness-cohort-imported-v1.installing',
    'kemerbet-readiness-cohort-completed-v1',
    '.kemerbet-readiness-cohort-completed-v1.installing',
    'kemerbet-readiness-cohort-failed-v1',
    '.kemerbet-readiness-cohort-failed-v1.installing',
}


def reject():
    raise RuntimeError


def same(first, second):
    return (
        first.st_dev == second.st_dev
        and first.st_ino == second.st_ino
        and first.st_mode == second.st_mode
        and first.st_uid == second.st_uid
        and first.st_gid == second.st_gid
        and first.st_nlink == second.st_nlink
        and first.st_size == second.st_size
    )


def open_exact(root_fd, name, expected_mode, maximum_size, expected_content=None):
    named = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    if (
        not stat.S_ISREG(named.st_mode)
        or named.st_uid != 0
        or named.st_gid != 0
        or stat.S_IMODE(named.st_mode) != expected_mode
        or named.st_nlink != 1
        or not 0 <= named.st_size <= maximum_size
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=root_fd,
    )
    opened = os.fstat(descriptor)
    content = os.pread(descriptor, maximum_size + 1, 0)
    if not same(named, opened) or len(content) != named.st_size:
        os.close(descriptor)
        reject()
    if expected_content is not None and content != expected_content:
        os.close(descriptor)
        reject()
    return descriptor, opened, content


def main():
    policy, root, final_name, installing_name, journal_name = sys.argv[1:]
    if policy not in {'receipt', 'promotion'}:
        reject()
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    residue_fd = None
    journal_fd = None
    try:
        root_stat = os.fstat(root_fd)
        expected_root_mode = 0o755 if policy == 'receipt' else 0o700
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != expected_root_mode
        ):
            reject()
        names = set(os.listdir(root_fd))
        residue_names = names & {final_name, installing_name}
        if len(residue_names) != 1:
            reject()
        residue_name = next(iter(residue_names))
        if policy == 'receipt':
            if names - RECEIPT_MARKERS - {residue_name}:
                reject()
        else:
            if names != {journal_name, residue_name}:
                reject()
            journal_fd, journal_stat, journal_content = open_exact(
                root_fd,
                journal_name,
                0o600,
                4096,
            )
            journal_lines = journal_content.splitlines()
            if (
                journal_stat.st_size < 1
                or len(journal_lines) < 2
                or journal_lines[0] != b'version=1'
                or journal_lines[1]
                not in {
                    b'state=import_prepared',
                    b'state=prepared',
                    b'state=candidate_bound',
                }
            ):
                reject()
        residue_fd, residue_stat, residue_content = open_exact(
            root_fd,
            residue_name,
            0o400,
            len(CONTENT),
        )
        if not CONTENT.startswith(residue_content):
            reject()
        os.fsync(residue_fd)
        if journal_fd is not None:
            os.fsync(journal_fd)
        os.fsync(root_fd)
        named_root = os.lstat(root)
        if not same(root_stat, named_root) or os.path.realpath(root) != root:
            reject()
        named_residue = os.stat(residue_name, dir_fd=root_fd, follow_symlinks=False)
        if (
            not same(residue_stat, named_residue)
            or os.pread(residue_fd, len(CONTENT) + 1, 0) != residue_content
        ):
            reject()
        if journal_fd is not None:
            named_journal = os.stat(journal_name, dir_fd=root_fd, follow_symlinks=False)
            if (
                not same(journal_stat, named_journal)
                or os.pread(journal_fd, 4097, 0) != journal_content
            ):
                reject()
    finally:
        if journal_fd is not None:
            os.close(journal_fd)
        if residue_fd is not None:
            os.close(residue_fd)
        os.close(root_fd)


try:
    if len(sys.argv) != 6:
        reject()
    main()
except BaseException:
    raise SystemExit(1)
PY
}

durably_retain_kemerbet_recovery_latch_residue() {
  local ancestor
  for ancestor in / /var /var/lib "$KEMERBET_OWNER_RECEIPT_PARENT" "$KEMERBET_OWNER_RECEIPT_ROOT"; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor" 2>/dev/null)" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor" 2>/dev/null)" == '0:0:755' ]] || return 1
  done
  durably_retain_fixed_kemerbet_recovery_residue \
    receipt "$KEMERBET_OWNER_RECEIPT_ROOT" \
    "$KEMERBET_RECOVERY_LATCH_NAME" "$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME"
}

durably_retain_kemerbet_recovery_fallback_residue() {
  local ancestor
  for ancestor in / /var /var/lib "$KEMERBET_OWNER_RECEIPT_PARENT"; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor" 2>/dev/null)" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor" 2>/dev/null)" == '0:0:755' ]] || return 1
  done
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == '0:0:700' ]] ||
    return 1
  durably_retain_fixed_kemerbet_recovery_residue \
    promotion "$KEMERBET_RECHECK_PROMOTION_ROOT" \
    "$KEMERBET_RECOVERY_FALLBACK_NAME" "$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME"
}

require_kemerbet_recovery_fallback_publish_boundary() {
  local entries journal_size
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT" 2>/dev/null)" == '0:0:700' ]] ||
    return 1
  entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    return 1
  [[ "$entries" == 'pending-v1' ]] || return 1
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL" 2>/dev/null)" == "$KEMERBET_RECHECK_PROMOTION_JOURNAL" &&
    "$(stat --format='%u:%g:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL" 2>/dev/null)" == '0:0:600:1' ]] ||
    return 1
  journal_size="$(stat --format='%s' "$KEMERBET_RECHECK_PROMOTION_JOURNAL" 2>/dev/null)" || return 1
  [[ "$journal_size" =~ ^[0-9]+$ && "$journal_size" -ge 1 && "$journal_size" -le 4096 ]] || return 1
  [[ "$(sed -n '1p' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'version=1' &&
    "$(sed -n '2p' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" =~ ^state=(import_prepared|prepared|candidate_bound)$ ]] ||
    return 1
}

publish_kemerbet_recovery_fallback() {
  local fallback_status=0 publisher_status=0
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 1 ]] || return 1
  require_kemerbet_recovery_fallback_publish_boundary || return 1
  set +e
  (
    set -e
    env -i PATH="$SAFE_PATH" python3 -I - \
      "$KEMERBET_RECHECK_PROMOTION_ROOT" "$(basename -- "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" \
      "$KEMERBET_RECOVERY_FALLBACK_NAME" "$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"


def main():
    root, journal_name, final_name, installing_name = sys.argv[1:]
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    installing_fd = None
    journal_fd = None
    try:
        root_stat = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != 0o700
        ):
            raise RuntimeError
        names = os.listdir(root_fd)
        if names != [journal_name] and sorted(names) != [journal_name]:
            raise RuntimeError
        journal_fd = os.open(
            journal_name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
        journal_stat = os.fstat(journal_fd)
        journal_content = os.pread(journal_fd, 4097, 0)
        journal_lines = journal_content.splitlines()
        if (
            not stat.S_ISREG(journal_stat.st_mode)
            or journal_stat.st_uid != 0
            or journal_stat.st_gid != 0
            or stat.S_IMODE(journal_stat.st_mode) != 0o600
            or journal_stat.st_nlink != 1
            or not 1 <= journal_stat.st_size <= 4096
            or len(journal_content) != journal_stat.st_size
            or len(journal_lines) < 2
            or journal_lines[0] != b'version=1'
            or journal_lines[1]
            not in {b'state=import_prepared', b'state=prepared', b'state=candidate_bound'}
        ):
            raise RuntimeError
        named_journal = os.stat(journal_name, dir_fd=root_fd, follow_symlinks=False)
        if (
            (named_journal.st_dev, named_journal.st_ino)
            != (journal_stat.st_dev, journal_stat.st_ino)
            or named_journal.st_mode != journal_stat.st_mode
            or named_journal.st_uid != journal_stat.st_uid
            or named_journal.st_gid != journal_stat.st_gid
            or named_journal.st_nlink != journal_stat.st_nlink
            or named_journal.st_size != journal_stat.st_size
        ):
            raise RuntimeError
        for name in (final_name, installing_name):
            try:
                os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise RuntimeError
        installing_fd = os.open(
            installing_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o400,
            dir_fd=root_fd,
        )
        os.fchown(installing_fd, 0, 0)
        os.fchmod(installing_fd, 0o400)
        offset = 0
        while offset < len(CONTENT):
            written = os.write(installing_fd, CONTENT[offset:])
            if written <= 0:
                raise RuntimeError
            offset += written
        os.fsync(installing_fd)
        installing_stat = os.fstat(installing_fd)
        if (
            not stat.S_ISREG(installing_stat.st_mode)
            or installing_stat.st_uid != 0
            or installing_stat.st_gid != 0
            or stat.S_IMODE(installing_stat.st_mode) != 0o400
            or installing_stat.st_nlink != 1
            or installing_stat.st_size != len(CONTENT)
        ):
            raise RuntimeError
        os.close(installing_fd)
        installing_fd = None
        os.rename(
            installing_name,
            final_name,
            src_dir_fd=root_fd,
            dst_dir_fd=root_fd,
        )
        os.fsync(root_fd)
        final_fd = os.open(final_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            final_stat = os.fstat(final_fd)
            if (
                not stat.S_ISREG(final_stat.st_mode)
                or final_stat.st_uid != 0
                or final_stat.st_gid != 0
                or stat.S_IMODE(final_stat.st_mode) != 0o400
                or final_stat.st_nlink != 1
                or final_stat.st_size != len(CONTENT)
                or os.read(final_fd, len(CONTENT) + 1) != CONTENT
            ):
                raise RuntimeError
        finally:
            os.close(final_fd)
        named_journal = os.stat(journal_name, dir_fd=root_fd, follow_symlinks=False)
        if (
            (named_journal.st_dev, named_journal.st_ino)
            != (journal_stat.st_dev, journal_stat.st_ino)
            or named_journal.st_mode != journal_stat.st_mode
            or named_journal.st_uid != journal_stat.st_uid
            or named_journal.st_gid != journal_stat.st_gid
            or named_journal.st_nlink != journal_stat.st_nlink
            or named_journal.st_size != journal_stat.st_size
            or os.pread(journal_fd, 4097, 0) != journal_content
        ):
            raise RuntimeError
    finally:
        if journal_fd is not None:
            os.close(journal_fd)
        if installing_fd is not None:
            os.close(installing_fd)
        os.close(root_fd)


try:
    main()
except BaseException:
    raise SystemExit(1)
PY
  )
  publisher_status=$?
  set -e
  [[ "$publisher_status" -eq 0 ]] || return 1
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 0 &&
    -f "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_NAME" &&
    ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" &&
    ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT/$KEMERBET_RECOVERY_FALLBACK_INSTALLING_NAME" ]]
}

publish_kemerbet_recovery_latch() {
  local latch_status=0 publisher_status=0
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  [[ "$latch_status" -eq 1 ]] || return 1
  set +e
  (
    set -e
    env -i PATH="$SAFE_PATH" python3 -I - \
      "$KEMERBET_OWNER_RECEIPT_ROOT" "$KEMERBET_RECOVERY_LATCH_NAME" \
      "$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"


def main():
    root, final_name, installing_name = sys.argv[1:]
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    installing_fd = None
    try:
        root_stat = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != 0o755
        ):
            raise RuntimeError
        for name in (final_name, installing_name):
            try:
                os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise RuntimeError
        installing_fd = os.open(
            installing_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o400,
            dir_fd=root_fd,
        )
        os.fchown(installing_fd, 0, 0)
        os.fchmod(installing_fd, 0o400)
        offset = 0
        while offset < len(CONTENT):
            written = os.write(installing_fd, CONTENT[offset:])
            if written <= 0:
                raise RuntimeError
            offset += written
        os.fsync(installing_fd)
        installing_stat = os.fstat(installing_fd)
        if (
            not stat.S_ISREG(installing_stat.st_mode)
            or installing_stat.st_uid != 0
            or installing_stat.st_gid != 0
            or stat.S_IMODE(installing_stat.st_mode) != 0o400
            or installing_stat.st_nlink != 1
            or installing_stat.st_size != len(CONTENT)
        ):
            raise RuntimeError
        os.close(installing_fd)
        installing_fd = None
        os.rename(
            installing_name,
            final_name,
            src_dir_fd=root_fd,
            dst_dir_fd=root_fd,
        )
        os.fsync(root_fd)
        final_fd = os.open(final_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            final_stat = os.fstat(final_fd)
            if (
                not stat.S_ISREG(final_stat.st_mode)
                or final_stat.st_uid != 0
                or final_stat.st_gid != 0
                or stat.S_IMODE(final_stat.st_mode) != 0o400
                or final_stat.st_nlink != 1
                or final_stat.st_size != len(CONTENT)
                or os.read(final_fd, len(CONTENT) + 1) != CONTENT
            ):
                raise RuntimeError
        finally:
            os.close(final_fd)
    finally:
        if installing_fd is not None:
            os.close(installing_fd)
        os.close(root_fd)


try:
    main()
except BaseException:
    raise SystemExit(1)
PY
  )
  publisher_status=$?
  set -e
  [[ "$publisher_status" -eq 0 ]] || return 1
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  [[ "$latch_status" -eq 0 &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ]] || return 1
  KEMERBET_RECOVERY_LATCH_DEV_INO="$(stat --format='%d:%i' \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME")"
  [[ "$KEMERBET_RECOVERY_LATCH_DEV_INO" =~ ^[0-9]+:[0-9]+$ ]] || return 1
}

require_kemerbet_recovery_latch_authority() {
  local fallback_status=0 latch_status=0
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 1 ]] ||
    die 'a durable KemerBet recovery fallback blocks readiness mutation'
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  if [[ "$latch_status" -eq 1 ]]; then
    [[ -z "$KEMERBET_RECOVERY_LATCH_DEV_INO" ]] ||
      die 'the KemerBet recovery latch authorization is inconsistent'
    return 0
  fi
  [[ "$latch_status" -eq 0 && "$KEMERBET_RECOVERY_LATCH_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    "$(stat --format='%d:%i' "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" 2>/dev/null)" == \
      "$KEMERBET_RECOVERY_LATCH_DEV_INO" ]] ||
    die 'a pre-existing or unsafe KemerBet recovery latch blocks readiness mutation'
}

require_owned_kemerbet_recovery_latch() {
  [[ "$KEMERBET_RECOVERY_LATCH_DEV_INO" =~ ^[0-9]+:[0-9]+$ ]] ||
    die 'the current process does not own the KemerBet recovery latch'
  require_kemerbet_recovery_latch_authority || return 1
}

require_retryable_kemerbet_recovery_boundary() {
  local expected_claim_id="$KEMERBET_RECHECK_OWNER_CLAIM_ID"
  local expected_claim_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"
  local expected_identity_digest="$KEMERBET_RECHECK_IDENTITY_KEY_DIGEST"
  local expected_player_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"
  local expected_player_digest="$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
  local expected_source_dev_ino="$KEMERBET_RECHECK_SOURCE_DEV_INO"
  local expected_source_digest="$KEMERBET_RECHECK_SOURCE_DIGEST"
  local receipt_path
  [[ "$expected_claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$expected_claim_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$expected_player_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$expected_player_digest" =~ ^[0-9a-f]{64}$ &&
    "$expected_source_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$expected_source_digest" =~ ^[0-9a-f]{64}$ &&
    "$expected_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the retryable KemerBet recovery identity is incomplete'
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" ]] ||
    die 'the retryable KemerBet recovery retained an incompatible committed artifact'
  for receipt_path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$receipt_path" && ! -L "$receipt_path" ]] ||
      die 'the retryable KemerBet recovery retained a conflicting receipt or installer'
  done
  require_retryable_kemerbet_binding_source "$expected_source_dev_ino" "$expected_source_digest" ||
    die 'the retryable KemerBet recovery binding source is not exact'
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "$expected_identity_digest" ]] ||
    die 'the retryable KemerBet recovery identity key is not exact'
  inspect_owner_staged_kemerbet_cohort || return 1
  [[ "$KEMERBET_RECHECK_OWNER_CLAIM_ID" == "$expected_claim_id" &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" == "$expected_claim_dev_ino" &&
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" == "$expected_player_dev_ino" &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" == "$expected_player_digest" ]] ||
    die 'the restored retryable Owner KemerBet cohort does not match its journal'
  owner_kemerbet_cohort_marker require-failed "$expected_claim_id" ||
    die 'the restored retryable Owner KemerBet failure marker is not exact'
  for receipt_path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$receipt_path" && ! -L "$receipt_path" ]] ||
      die 'the retryable KemerBet recovery receipt topology changed during inspection'
  done
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  require_retryable_kemerbet_binding_source "$expected_source_dev_ino" "$expected_source_digest" ||
    die 'the retryable KemerBet recovery binding source changed during inspection'
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "$expected_identity_digest" ]] ||
    die 'the retryable KemerBet recovery identity key changed during inspection'
}

require_prejournal_kemerbet_recovery_boundary() {
  local entries failed_path path source_size
  require_owned_kemerbet_recovery_latch || return 1
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" ]] ||
    die 'the pre-journal KemerBet recovery retained a derived artifact'
  require_kemerbet_readiness_output_directory || return 1
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
    "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
    "$(stat --format='%u:%g:%a:%h' "$KEMERBET_READINESS_BINDING")" == '10001:10001:600:1' ]] ||
    die 'the pre-journal KemerBet binding source is unsafe'
  source_size="$(stat --format='%s' "$KEMERBET_READINESS_BINDING")"
  [[ "$source_size" =~ ^[0-9]+$ && "$source_size" -ge 100 && "$source_size" -le 256 &&
    "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] ||
    die 'the pre-journal KemerBet binding source shape is invalid'
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
    "$KEMERBET_READINESS_BINDING" || die 'the pre-journal KemerBet binding source contract is invalid'
  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] ||
    die 'the pre-journal KemerBet identity key has an unsafe link count'
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT" || return 1
  [[ "$(stat --format='%h' "$KEMERBET_SELECTOR_CONTRACT")" == '1' ]] ||
    die 'the pre-journal KemerBet selector has an unsafe link count'
  for path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$path" && ! -L "$path" ]] ||
      die 'the pre-journal KemerBet recovery retained a conflicting receipt or installer'
  done
  inspect_owner_staged_kemerbet_cohort || return 1
  failed_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME"
  if [[ -e "$failed_path" || -L "$failed_path" ]]; then
    owner_kemerbet_cohort_marker require-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the pre-journal retryable KemerBet failure marker is not exact'
  fi
  entries="$(find -P "$KEMERBET_OWNER_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    die 'the pre-journal KemerBet receipt boundary could not be inspected'
  [[ "$entries" == "$KEMERBET_RECOVERY_LATCH_NAME" ||
    "$entries" == "$KEMERBET_OWNER_FAILED_CLAIM_NAME"$'\n'"$KEMERBET_RECOVERY_LATCH_NAME" ]] ||
    die 'the pre-journal KemerBet receipt boundary is not exact'
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  require_kemerbet_readiness_output_directory || return 1
}

require_retired_kemerbet_recovery_boundary() {
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]] ||
    die 'the KemerBet recovery did not retire its promotion root'
  case "$KEMERBET_RECHECK_RECOVERY_OUTCOME" in
    committed)
      require_committed_kemerbet_recheck_boundary_shape || return 1
      require_completed_owner_kemerbet_cohort_marker || return 1
      ;;
    retryable) require_retryable_kemerbet_recovery_boundary || return 1 ;;
    prejournal_no_mutation) require_prejournal_kemerbet_recovery_boundary || return 1 ;;
    *) die 'the retired KemerBet recovery outcome is missing or invalid' ;;
  esac
  require_owned_kemerbet_recovery_latch || return 1
}

retire_owned_kemerbet_recovery_latch() {
  local expected_dev_ino="$KEMERBET_RECOVERY_LATCH_DEV_INO" retire_status=0
  [[ "$expected_dev_ino" =~ ^[0-9]+:[0-9]+$ ]] || return 1
  require_retired_kemerbet_recovery_boundary || return 1
  # The independently verified recovery boundary is necessary but not sufficient to remove the
  # write-ahead latch. Re-prove the exact live Owner/read-only bind immediately before unlink so a
  # stopped Owner or a newly overlapping holder leaves the durable latch for manual remediation.
  require_owner_kemerbet_receipt_service_access || return 1
  set +e
  (
    set -e
    env -i PATH="$SAFE_PATH" python3 -I - \
      "$KEMERBET_OWNER_RECEIPT_ROOT" "$KEMERBET_RECOVERY_LATCH_NAME" \
      "$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" "$expected_dev_ino" <<'PY'
import os
import stat
import sys

CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"


def write_replacement(root_fd, final_name):
    replacement_fd = os.open(
        final_name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o400,
        dir_fd=root_fd,
    )
    try:
        os.fchown(replacement_fd, 0, 0)
        os.fchmod(replacement_fd, 0o400)
        offset = 0
        while offset < len(CONTENT):
            written = os.write(replacement_fd, CONTENT[offset:])
            if written <= 0:
                raise RuntimeError
            offset += written
        os.fsync(replacement_fd)
    finally:
        os.close(replacement_fd)
    os.fsync(root_fd)


def main():
    root, final_name, installing_name, expected_dev_ino = sys.argv[1:]
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    final_fd = None
    unlinked = False
    try:
        root_stat = os.fstat(root_fd)
        if (
            not stat.S_ISDIR(root_stat.st_mode)
            or root_stat.st_uid != 0
            or root_stat.st_gid != 0
            or stat.S_IMODE(root_stat.st_mode) != 0o755
        ):
            raise RuntimeError
        try:
            os.stat(installing_name, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError
        final_fd = os.open(final_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
        final_stat = os.fstat(final_fd)
        if (
            not stat.S_ISREG(final_stat.st_mode)
            or final_stat.st_uid != 0
            or final_stat.st_gid != 0
            or stat.S_IMODE(final_stat.st_mode) != 0o400
            or final_stat.st_nlink != 1
            or final_stat.st_size != len(CONTENT)
            or f"{final_stat.st_dev}:{final_stat.st_ino}" != expected_dev_ino
            or os.read(final_fd, len(CONTENT) + 1) != CONTENT
        ):
            raise RuntimeError
        os.unlink(final_name, dir_fd=root_fd)
        unlinked = True
        try:
            os.fsync(root_fd)
        except BaseException:
            write_replacement(root_fd, final_name)
            raise
        try:
            os.stat(final_name, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError
    except BaseException:
        if unlinked:
            try:
                os.stat(final_name, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                try:
                    write_replacement(root_fd, final_name)
                except BaseException:
                    pass
        raise
    finally:
        if final_fd is not None:
            os.close(final_fd)
        os.close(root_fd)


try:
    main()
except BaseException:
    raise SystemExit(1)
PY
  )
  retire_status=$?
  set -e
  [[ "$retire_status" -eq 0 ]] || return 1
  [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ]] || return 1
  KEMERBET_RECOVERY_LATCH_DEV_INO=''
}

recover_incomplete_kemerbet_recheck_promotion_guarded() {
  local fallback_status=0 latch_status=0
  set +e
  inspect_kemerbet_recovery_fallback
  fallback_status=$?
  set -e
  [[ "$fallback_status" -eq 1 ]] ||
    die 'a durable KemerBet recovery fallback requires manual root remediation'
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  [[ "$latch_status" -eq 1 ]] ||
    die 'a pre-existing or unsafe KemerBet recovery latch requires manual root remediation'
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  # This read-only liveness/mount proof must precede latch publication itself. The raw recovery
  # repeats it after publication and before its first journal, candidate, stage, or marker mutation.
  require_owner_kemerbet_receipt_service_access
  publish_kemerbet_recovery_latch ||
    die 'the KemerBet recovery latch could not be published before recovery'
  require_owned_kemerbet_recovery_latch
  recover_incomplete_kemerbet_recheck_promotion
  require_retired_kemerbet_recovery_boundary
  retire_owned_kemerbet_recovery_latch ||
    die 'the successful KemerBet recovery latch could not be retired durably'
}

recover_incomplete_kemerbet_recheck_promotion() {
  local actual_entries candidate_dev_ino candidate_digest claim_id entry player_ids_dev_ino
  local commit_sha receipt_entries receipt_present canonical_present session_container source_dev_ino state
  local owner_player_ids_dev_ino owner_claim_dev_ino player_ids_digest
  local -a journal_lines=()
  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  KEMERBET_RECHECK_RECOVERY_OUTCOME=''
  require_owned_kemerbet_recovery_latch
  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" && -d "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(realpath -- "$KEMERBET_RECHECK_PROMOTION_ROOT")" == "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_PROMOTION_ROOT")" == 'root:root:700' ]] ||
    die 'an interrupted KemerBet promotion root is unsafe'
  # This liveness/read-only preflight precedes every journal, candidate, stage, or receipt mutation.
  # A rerun after emergency teardown therefore preserves all root recovery evidence unchanged.
  require_owner_kemerbet_receipt_service_access
  actual_entries="$(find -P "$KEMERBET_RECHECK_PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    die 'the interrupted KemerBet promotion root could not be inspected'
  receipt_present='false'
  canonical_present='false'
  if [[ -e "$KEMERBET_RECHECK_RECEIPT_ROOT" || -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]; then
    [[ ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" && -d "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
      "$(realpath -- "$KEMERBET_RECHECK_RECEIPT_ROOT")" == "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
      "$(stat --format='%U:%G:%a' "$KEMERBET_RECHECK_RECEIPT_ROOT")" == 'root:root:700' ]] ||
      die 'an interrupted KemerBet receipt root is unsafe'
    receipt_entries="$(find -P "$KEMERBET_RECHECK_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
      die 'the interrupted KemerBet receipt root could not be inspected'
    if [[ -z "$receipt_entries" ]]; then
      # The receipt directory is durably created before its fixed receipt. A host crash in that
      # interval leaves an empty, root-owned directory that is an uncommitted partial receipt.
      receipt_present='partial'
    elif [[ "$receipt_entries" == 'ready-v1' ]]; then
      receipt_present='true'
    elif [[ "$receipt_entries" =~ ^\.ready-v1\.[A-Za-z0-9]+$'\n'ready-v1$ ]]; then
      entry="$KEMERBET_RECHECK_RECEIPT_ROOT/${receipt_entries%%$'\n'*}"
      [[ ! -L "$entry" && -f "$entry" && ! -L "$KEMERBET_RECHECK_RECEIPT" &&
        -f "$KEMERBET_RECHECK_RECEIPT" &&
        "$(stat --format='%U:%G:%a:%h:%d:%i' "$entry")" == \
        "$(stat --format='%U:%G:%a:%h:%d:%i' "$KEMERBET_RECHECK_RECEIPT")" &&
        "$(stat --format='%U:%G:%a:%h' "$entry")" == 'root:root:600:2' ]] ||
        die 'the interrupted linked KemerBet receipt is unsafe'
      rm -f -- "$entry"
      sync -f "$KEMERBET_RECHECK_RECEIPT_ROOT" ||
        die 'the interrupted linked KemerBet receipt could not be synchronized'
      receipt_present='true'
    elif [[ "$receipt_entries" =~ ^\.ready-v1\.[A-Za-z0-9]+$ ]]; then
      receipt_present='partial'
    else
      die 'the interrupted KemerBet receipt root contains unexpected residue'
    fi
  fi
  [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
    canonical_present='true'

  if [[ ! -e "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ]]; then
    if [[ -z "$actual_entries" ]]; then
      if [[ "$receipt_present" != "$canonical_present" ]]; then
        die 'an interrupted KemerBet promotion has an ambiguous committed boundary'
      fi
      if [[ "$receipt_present" == 'true' ]]; then
        require_committed_kemerbet_recheck_boundary_shape
        require_completed_owner_kemerbet_cohort_marker
        KEMERBET_RECHECK_RECOVERY_OUTCOME='committed'
      else
        KEMERBET_RECHECK_RECOVERY_OUTCOME='prejournal_no_mutation'
      fi
      remove_owned_kemerbet_recheck_promotion_root ||
        die 'the interrupted KemerBet promotion root could not be removed'
      return 0
    fi
    [[ "$actual_entries" =~ ^\.pending-v1\.[A-Za-z0-9]+$ &&
      "$receipt_present" == 'false' && "$canonical_present" == 'false' ]] ||
      die 'an interrupted KemerBet promotion journal is incomplete or ambiguous'
    entry="$KEMERBET_RECHECK_PROMOTION_ROOT/$actual_entries"
    [[ ! -L "$entry" && -f "$entry" &&
      "$(stat --format='%U:%G:%a' "$entry")" == 'root:root:600' ]] ||
      die 'the interrupted KemerBet promotion-journal temporary is unsafe'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted KemerBet promotion root could not be removed'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='prejournal_no_mutation'
    return 0
  fi

  [[ ! -L "$KEMERBET_RECHECK_PROMOTION_JOURNAL" && -f "$KEMERBET_RECHECK_PROMOTION_JOURNAL" ]] ||
    die 'the interrupted KemerBet promotion journal is unsafe'
  if [[ "$actual_entries" != 'pending-v1' ]]; then
    [[ "$actual_entries" =~ ^\.pending-v1\.[A-Za-z0-9]+$'\n'pending-v1$ ]] ||
      die 'the interrupted KemerBet promotion journal contains unexpected residue'
    entry="$KEMERBET_RECHECK_PROMOTION_ROOT/${actual_entries%%$'\n'*}"
    [[ ! -L "$entry" && -f "$entry" &&
      "$(stat --format='%U:%G:%a' "$entry")" == 'root:root:600' ]] ||
      die 'the interrupted KemerBet promotion-journal temporary is unsafe'
    rm -f -- "$entry"
    sync -f "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
      die 'the interrupted KemerBet promotion journal could not be synchronized'
  fi
  [[ "$(stat --format='%U:%G:%a:%h' "$KEMERBET_RECHECK_PROMOTION_JOURNAL")" == 'root:root:600:1' ]] ||
    die 'the interrupted KemerBet promotion journal ownership, mode, or link count is unsafe'
  mapfile -t journal_lines <"$KEMERBET_RECHECK_PROMOTION_JOURNAL"
  [[ "${#journal_lines[@]}" -ge 2 && "${journal_lines[0]}" == 'version=1' ]] ||
    die 'the interrupted KemerBet promotion journal header is invalid'
  state="${journal_lines[1]}"

  if [[ "$state" == 'state=import_prepared' ]]; then
    [[ "${#journal_lines[@]}" -eq 14 &&
      "${journal_lines[2]}" =~ ^release=[0-9a-f]{40}$ &&
      "${journal_lines[3]}" =~ ^source_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[4]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[5]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[6]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[7]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
      "${journal_lines[8]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
      "${journal_lines[9]}" =~ ^session_container=(none|[0-9a-f]{12,64})$ &&
      "${journal_lines[10]}" =~ ^owner_stage_player_ids_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[11]}" =~ ^owner_stage_claim_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[12]}" =~ ^claim_id=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
      "${journal_lines[13]}" =~ ^player_ids_sha256=[0-9a-f]{64}$ &&
      "$receipt_present" == 'false' && "$canonical_present" == 'false' ]] ||
      die 'the interrupted import-prepared KemerBet promotion journal is invalid or ambiguous'
    commit_sha="${journal_lines[2]#release=}"
    source_dev_ino="${journal_lines[3]#source_dev_ino=}"
    candidate_digest="${journal_lines[4]#binding_sha256=}"
    session_container="${journal_lines[9]#session_container=}"
    owner_player_ids_dev_ino="${journal_lines[10]#owner_stage_player_ids_dev_ino=}"
    owner_claim_dev_ino="${journal_lines[11]#owner_stage_claim_dev_ino=}"
    claim_id="${journal_lines[12]#claim_id=}"
    player_ids_digest="${journal_lines[13]#player_ids_sha256=}"
    KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="$owner_player_ids_dev_ino"
    KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="$owner_claim_dev_ino"
    KEMERBET_RECHECK_OWNER_CLAIM_ID="$claim_id"
    KEMERBET_RECHECK_PLAYER_IDS_DIGEST="$player_ids_digest"
    KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
    KEMERBET_RECHECK_SOURCE_DIGEST="$candidate_digest"
    KEMERBET_RECHECK_IDENTITY_KEY_DIGEST="${journal_lines[5]#identity_hmac_key_sha256=}"
    remove_kemerbet_recheck_container || die 'an interrupted KemerBet recheck container could not be removed'
    remove_kemerbet_recheck_network || die 'an interrupted KemerBet recheck network could not be removed'
    remove_journaled_kemerbet_session_provision "$session_container" "$commit_sha"
    require_kemerbet_profile_volume_holders ''
    [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
      "$(stat --format='%d:%i' "$KEMERBET_READINESS_BINDING")" == "$source_dev_ino" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$candidate_digest" ]] ||
      die 'the interrupted import-prepared KemerBet binding source changed'
    [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "${journal_lines[5]#identity_hmac_key_sha256=}" ]] ||
      die 'the interrupted import-prepared KemerBet identity key changed'
    require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
    [[ "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == \
      "${journal_lines[6]#selector_sha256=}" ]] ||
      die 'the interrupted import-prepared KemerBet selector changed'
    owner_kemerbet_cohort_marker remove-failed "$claim_id" ||
      die 'the retryable KemerBet cohort marker could not be retired'
    promote_owner_staged_kemerbet_player_ids
    require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
    player_ids_dev_ino="$(stat --format='%d:%i' "$KEMERBET_READINESS_PLAYER_IDS")"
    KEMERBET_RECHECK_PLAYER_IDS_DEV_INO="$player_ids_dev_ino"
    advance_kemerbet_recheck_import_journal_to_prepared \
      "$commit_sha" "$source_dev_ino" "$candidate_digest" \
      "${journal_lines[5]#identity_hmac_key_sha256=}" \
      "${journal_lines[6]#selector_sha256=}" "${journal_lines[7]#image_id=}" \
      "$session_container" "$player_ids_dev_ino" \
      "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" "$claim_id" "$player_ids_digest"
    owner_kemerbet_cohort_marker publish-imported "$claim_id" ||
      die 'the interrupted KemerBet cohort import marker could not be published'
    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
      die 'the interrupted imported KemerBet Player-ID file could not be removed'
    restore_retryable_owner_staged_kemerbet_cohort ||
      die 'the interrupted Owner KemerBet cohort could not be restored for retry'
    repair_kemerbet_identity_key_readability ||
      die 'the KemerBet identity key could not be repaired after interrupted import'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted import-prepared KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='retryable'
    return 0
  fi

  if [[ "$state" == 'state=prepared' ]]; then
    [[ "${#journal_lines[@]}" -eq 15 &&
      "${journal_lines[2]}" =~ ^release=[0-9a-f]{40}$ &&
      "${journal_lines[3]}" =~ ^source_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[4]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[5]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[6]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
      "${journal_lines[7]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
      "${journal_lines[8]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
      "${journal_lines[9]}" =~ ^session_container=(none|[0-9a-f]{12,64})$ &&
      "${journal_lines[10]}" =~ ^player_ids_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[11]}" =~ ^owner_stage_player_ids_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[12]}" =~ ^owner_stage_claim_dev_ino=[0-9]+:[0-9]+$ &&
      "${journal_lines[13]}" =~ ^claim_id=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
      "${journal_lines[14]}" =~ ^player_ids_sha256=[0-9a-f]{64}$ &&
      "$receipt_present" == 'false' && "$canonical_present" == 'false' ]] ||
      die 'the interrupted prepared KemerBet promotion journal is invalid or ambiguous'
    commit_sha="${journal_lines[2]#release=}"
    source_dev_ino="${journal_lines[3]#source_dev_ino=}"
    candidate_digest="${journal_lines[4]#binding_sha256=}"
    session_container="${journal_lines[9]#session_container=}"
    player_ids_dev_ino="${journal_lines[10]#player_ids_dev_ino=}"
    owner_player_ids_dev_ino="${journal_lines[11]#owner_stage_player_ids_dev_ino=}"
    owner_claim_dev_ino="${journal_lines[12]#owner_stage_claim_dev_ino=}"
    claim_id="${journal_lines[13]#claim_id=}"
    player_ids_digest="${journal_lines[14]#player_ids_sha256=}"
    KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="$owner_player_ids_dev_ino"
    KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="$owner_claim_dev_ino"
    KEMERBET_RECHECK_OWNER_CLAIM_ID="$claim_id"
    KEMERBET_RECHECK_PLAYER_IDS_DIGEST="$player_ids_digest"
    KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
    KEMERBET_RECHECK_SOURCE_DIGEST="$candidate_digest"
    KEMERBET_RECHECK_IDENTITY_KEY_DIGEST="${journal_lines[5]#identity_hmac_key_sha256=}"
    remove_kemerbet_recheck_container || die 'an interrupted KemerBet recheck container could not be removed'
    remove_kemerbet_recheck_network || die 'an interrupted KemerBet recheck network could not be removed'
    remove_journaled_kemerbet_session_provision "$session_container" "$commit_sha"
    require_kemerbet_profile_volume_holders ''
    [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
      "$(stat --format='%d:%i' "$KEMERBET_READINESS_BINDING")" == "$source_dev_ino" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$candidate_digest" ]] ||
      die 'the interrupted prepared KemerBet binding source changed'
    [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "${journal_lines[5]#identity_hmac_key_sha256=}" ]] ||
      die 'the interrupted prepared KemerBet identity key changed'
    require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
    [[ "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == \
      "${journal_lines[6]#selector_sha256=}" ]] ||
      die 'the interrupted prepared KemerBet selector changed'
    # In prepared state the fixed candidate path did not exist before this journal. A crash may
    # interrupt `install` mid-copy, so ownership/path checks—not a completed digest—authorize its
    # rollback. A digest becomes mandatory only after the candidate_bound state is durable.
    remove_kemerbet_recheck_candidate || die 'the interrupted prepared KemerBet candidate could not be removed'
    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
      die 'the interrupted one-use KemerBet Player-ID source could not be removed'
    restore_retryable_owner_staged_kemerbet_cohort ||
      die 'the interrupted Owner KemerBet cohort could not be restored for retry'
    repair_kemerbet_identity_key_readability ||
      die 'the KemerBet identity key could not be repaired after interruption'
    [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
      "${journal_lines[5]#identity_hmac_key_sha256=}" ]] ||
      die 'the repaired KemerBet identity key no longer matches its journal'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted prepared KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='retryable'
    return 0
  fi

  [[ "$state" == 'state=candidate_bound' && "${#journal_lines[@]}" -eq 17 &&
    "${journal_lines[2]}" =~ ^release=[0-9a-f]{40}$ &&
    "${journal_lines[3]}" =~ ^source_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[4]}" =~ ^binding_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[5]}" =~ ^binding_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[6]}" =~ ^identity_hmac_key_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[7]}" =~ ^selector_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[8]}" =~ ^image_id=sha256:[0-9a-f]{64}$ &&
    "${journal_lines[9]}" == "profile_volume=$KEMERBET_PROFILE_VOLUME" &&
    "${journal_lines[10]}" =~ ^profile_identity_sha256=[0-9a-f]{64}$ &&
    "${journal_lines[11]}" =~ ^session_container=(none|[0-9a-f]{12,64})$ &&
    "${journal_lines[12]}" =~ ^player_ids_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[13]}" =~ ^owner_stage_player_ids_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[14]}" =~ ^owner_stage_claim_dev_ino=[0-9]+:[0-9]+$ &&
    "${journal_lines[15]}" =~ ^claim_id=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "${journal_lines[16]}" =~ ^player_ids_sha256=[0-9a-f]{64}$ ]] ||
    die 'the interrupted candidate-bound KemerBet promotion journal is invalid'
  commit_sha="${journal_lines[2]#release=}"
  source_dev_ino="${journal_lines[3]#source_dev_ino=}"
  candidate_dev_ino="${journal_lines[4]#binding_dev_ino=}"
  candidate_digest="${journal_lines[5]#binding_sha256=}"
  session_container="${journal_lines[11]#session_container=}"
  player_ids_dev_ino="${journal_lines[12]#player_ids_dev_ino=}"
  owner_player_ids_dev_ino="${journal_lines[13]#owner_stage_player_ids_dev_ino=}"
  owner_claim_dev_ino="${journal_lines[14]#owner_stage_claim_dev_ino=}"
  claim_id="${journal_lines[15]#claim_id=}"
  player_ids_digest="${journal_lines[16]#player_ids_sha256=}"
  KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="$owner_player_ids_dev_ino"
  KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="$owner_claim_dev_ino"
  KEMERBET_RECHECK_OWNER_CLAIM_ID="$claim_id"
  KEMERBET_RECHECK_PLAYER_IDS_DIGEST="$player_ids_digest"
  KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
  KEMERBET_RECHECK_SOURCE_DIGEST="$candidate_digest"
  KEMERBET_RECHECK_IDENTITY_KEY_DIGEST="${journal_lines[6]#identity_hmac_key_sha256=}"

  remove_kemerbet_recheck_container || die 'an interrupted KemerBet recheck container could not be removed'
  remove_kemerbet_recheck_network || die 'an interrupted KemerBet recheck network could not be removed'
  remove_journaled_kemerbet_session_provision "$session_container" "$commit_sha"
  require_kemerbet_profile_volume_holders ''

  [[ ! -L "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" && -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
    "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
    "${journal_lines[6]#identity_hmac_key_sha256=}" ]] ||
    die 'the interrupted candidate-bound KemerBet identity key changed'
  require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
  [[ "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == \
    "${journal_lines[7]#selector_sha256=}" ]] ||
    die 'the interrupted candidate-bound KemerBet selector changed'

  if [[ "$receipt_present" == 'partial' ]]; then
    remove_owned_kemerbet_recheck_receipt_root ||
      die 'the interrupted partial KemerBet receipt could not be rolled back'
    receipt_present='false'
  fi
  if [[ "$receipt_present" == 'true' && "$canonical_present" != 'true' ]]; then
    die 'an interrupted KemerBet recheck receipt lacks its committed binding'
  fi
  if [[ "$receipt_present" == 'true' && "$canonical_present" == 'true' ]]; then
    require_kemerbet_recheck_receipt \
      "$commit_sha" "$candidate_digest" \
      "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}"
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$candidate_dev_ino" "$candidate_digest" \
      "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" "$session_container" \
      "$player_ids_dev_ino" "$owner_player_ids_dev_ino" "$owner_claim_dev_ino" \
      "$claim_id" "$player_ids_digest"
    # The exact current release/image/profile/runtime/no-holder/singleton/no-transient boundary is
    # re-proved before recovery is allowed to consume anything or publish completed-v1.
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$candidate_digest" "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" require-receipt
    require_committed_kemerbet_cleanup_artifacts \
      "$source_dev_ino" "$candidate_dev_ino" "$candidate_digest" \
      "$player_ids_dev_ino" "$player_ids_digest"
    KEMERBET_RECHECK_CANDIDATE_DEV_INO="$candidate_dev_ino"
    KEMERBET_RECHECK_CANDIDATE_DIGEST="$candidate_digest"
    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
      die 'the interrupted committed KemerBet Player-ID file could not be consumed'
    remove_kemerbet_recheck_candidate ||
      die 'the interrupted committed KemerBet candidate could not be retired'
    consume_exact_kemerbet_binding_source "$source_dev_ino" "$candidate_digest" ||
      die 'the interrupted committed KemerBet binding source could not be consumed'
    repair_kemerbet_identity_key_readability ||
      die 'the KemerBet identity key could not be repaired after committed recovery'
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$candidate_digest" "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" require-receipt
    [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the interrupted committed KemerBet cleanup retained an input'
    complete_owner_staged_kemerbet_cohort ||
      die 'the interrupted committed Owner KemerBet cohort could not be completed'
    require_completed_owner_kemerbet_cohort_marker
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$candidate_digest" "${journal_lines[6]#identity_hmac_key_sha256=}" \
      "${journal_lines[7]#selector_sha256=}" "${journal_lines[8]#image_id=}" \
      "${journal_lines[10]#profile_identity_sha256=}" require-receipt
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the interrupted committed KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_RECOVERY_OUTCOME='committed'
    KEMERBET_RECHECK_CANDIDATE_DEV_INO=''
    KEMERBET_RECHECK_CANDIDATE_DIGEST=''
    return 0
  fi
  KEMERBET_RECHECK_CANDIDATE_DEV_INO="$candidate_dev_ino"
  KEMERBET_RECHECK_CANDIDATE_DIGEST="$candidate_digest"
  rollback_kemerbet_recheck_final_binding ||
    die 'an uncommitted KemerBet identity binding could not be rolled back'
  if [[ -e "$KEMERBET_RECHECK_CANDIDATE_BINDING" || -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" ]]; then
    [[ ! -L "$KEMERBET_RECHECK_CANDIDATE_BINDING" &&
      "$(stat --format='%d:%i' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == "$candidate_dev_ino" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$candidate_digest" ]] ||
      die 'the interrupted KemerBet candidate does not match its durable journal'
  fi
  remove_kemerbet_recheck_candidate || die 'the interrupted KemerBet candidate could not be removed'
  require_retryable_kemerbet_binding_source "$source_dev_ino" "$candidate_digest" ||
    die 'the interrupted KemerBet binding source is not directly retryable'
  consume_exact_one_use_kemerbet_file \
    "$KEMERBET_READINESS_PLAYER_IDS" "$player_ids_dev_ino" "$player_ids_digest" ||
    die 'the interrupted one-use KemerBet Player-ID source could not be removed'
  restore_retryable_owner_staged_kemerbet_cohort ||
    die 'the interrupted Owner KemerBet cohort could not be restored for retry'
  repair_kemerbet_identity_key_readability ||
    die 'the KemerBet identity key could not be repaired after interruption'
  [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == \
    "${journal_lines[6]#identity_hmac_key_sha256=}" ]] ||
    die 'the repaired KemerBet identity key no longer matches its journal'
  remove_owned_kemerbet_recheck_promotion_root ||
    die 'the interrupted KemerBet promotion journal could not be retired'
  KEMERBET_RECHECK_RECOVERY_OUTCOME='retryable'
  KEMERBET_RECHECK_CANDIDATE_DEV_INO=''
  KEMERBET_RECHECK_CANDIDATE_DIGEST=''
}

recover_kemerbet_recheck_before_teardown() {
  local fallback_durable_status=0 fallback_publish_status=0 fallback_status=0
  local latch_durable_status=0 latch_status=0 recovery_status=0
  KEMERBET_TEARDOWN_RECOVERY_FAILED='false'
  KEMERBET_EMERGENCY_TEARDOWN_FAILED='false'
  # The mutation lock is already held by every caller. The guarded recovery publishes a durable,
  # root-owned latch before its first recovery mutation. A pre-existing latch skips recovery.
  set +e
  ( set -e; recover_incomplete_kemerbet_recheck_promotion_guarded )
  recovery_status=$?
  set -e
  if [[ "$recovery_status" -eq 0 &&
    ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ]]; then
    return 0
  fi
  set +e
  inspect_kemerbet_recovery_latch
  latch_status=$?
  set -e
  if [[ "$latch_status" -ne 1 ]]; then
    set +e
    ( set -e; durably_retain_kemerbet_recovery_latch_residue )
    latch_durable_status=$?
    set -e
  else
    latch_durable_status=1
  fi
  if [[ "$latch_durable_status" -ne 0 ]]; then
    set +e
    inspect_kemerbet_recovery_fallback
    fallback_status=$?
    set -e
    if [[ "$fallback_status" -eq 1 ]]; then
      # A primary-latch publisher that leaves no final or installer has not authorized recovery
      # mutation. Bind that exact untouched journal before emergency teardown. If neither durable
      # namespace can retain a residue, preserve the pre-recovery topology and refuse teardown.
      set +e
      ( set -e; publish_kemerbet_recovery_fallback )
      fallback_publish_status=$?
      set -e
      set +e
      inspect_kemerbet_recovery_fallback
      fallback_status=$?
      set -e
    fi
    if [[ "$fallback_publish_status" -eq 0 || "$fallback_status" -ne 1 ]]; then
      set +e
      ( set -e; durably_retain_kemerbet_recovery_fallback_residue )
      fallback_durable_status=$?
      set -e
    else
      fallback_durable_status=1
    fi
    [[ "$fallback_durable_status" -eq 0 ]] ||
      die 'KemerBet recovery could not retain a durable failure block; teardown was not attempted'
  fi
  KEMERBET_TEARDOWN_RECOVERY_FAILED='true'
  printf '%s\n' \
    'KemerBet readiness recovery is durably blocked; full emergency teardown will continue.' >&2
}

require_kemerbet_teardown_recovery_success() {
  if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
    if [[ "$KEMERBET_EMERGENCY_TEARDOWN_FAILED" == 'true' ]]; then
      die 'emergency teardown is incomplete and the interrupted KemerBet readiness journal requires root remediation'
    fi
    die 'the full staging runtime was stopped, but the interrupted KemerBet readiness journal requires root remediation'
  fi
}

harden_kemerbet_identity_key() {
  local digest_before metadata parent
  parent="$(dirname -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  [[ ! -L "$parent" && -d "$parent" && "$(realpath -- "$parent")" == "$parent" ]] ||
    die 'the KemerBet executor secret root is absent, symbolic, or noncanonical'
  [[ "$(stat --format='%U:%G:%a' "$parent")" == 'root:root:700' ]] ||
    die 'the KemerBet executor secret root is not root-managed mode 0700'
  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] ||
    die 'the KemerBet identity key has an unsafe hard-link count'
  digest_before="$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')"
  [[ "$digest_before" =~ ^[0-9a-f]{64}$ ]] || die 'the KemerBet identity key digest is invalid'
  metadata="$(stat --format='%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
  if [[ "$metadata" == '10001:10001:400' ]]; then
    chown root:root "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    chmod 0444 "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    sync -f "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" ||
      die 'the KemerBet identity key could not be synchronized after hardening'
  fi
  require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  [[ "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$digest_before" ]] ||
    die 'the KemerBet identity key changed while it was hardened'
}

harden_kemerbet_player_ids_file() {
  local digest_fd python_status
  [[ "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the journaled KemerBet Player-ID identity is invalid before hardening'
  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ||
    die 'the private KemerBet Player-ID digest channel could not be opened'
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$KEMERBET_READINESS_PLAYER_IDS" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def harden(path, identity_text, expected_digest):
    match = DEV_INO.fullmatch(identity_text)
    if (
        path != '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
        or match is None
        or DIGEST.fullmatch(expected_digest) is None
    ):
        reject()
    identity = (int(match.group(1)), int(match.group(2)))
    directory = os.path.dirname(path)
    name = os.path.basename(path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    descriptor = None
    try:
        opened_directory = os.fstat(directory_descriptor)
        named_directory = os.lstat(directory)
        if (
            not stat.S_ISDIR(opened_directory.st_mode)
            or (opened_directory.st_dev, opened_directory.st_ino)
            != (named_directory.st_dev, named_directory.st_ino)
            or (opened_directory.st_uid, opened_directory.st_gid, mode(opened_directory))
            != (0, 0, 0o700)
            or named_directory.st_mode != opened_directory.st_mode
            or os.path.realpath(directory) != directory
        ):
            reject()
        named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        absolute = os.lstat(path)
        if (
            not stat.S_ISREG(named.st_mode)
            or (named.st_dev, named.st_ino) != identity
            or (absolute.st_dev, absolute.st_ino) != identity
            or named.st_mode != absolute.st_mode
            or named.st_uid != absolute.st_uid
            or named.st_gid != absolute.st_gid
            or named.st_nlink != 1
            or named.st_size != absolute.st_size
            or (named.st_uid, named.st_gid, mode(named))
            not in {
                (10001, 10001, 0o400),
                (10001, 10001, 0o444),
                (0, 0, 0o400),
                (0, 0, 0o444),
            }
        ):
            reject()
        descriptor = os.open(
            name,
            os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=directory_descriptor,
        )
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, opened.st_size + 1, 0)
        if (
            (opened.st_dev, opened.st_ino) != identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or len(content) != opened.st_size
            or hashlib.sha256(content).hexdigest() != expected_digest
        ):
            reject()
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o444)
        os.fsync(descriptor)
        hardened = os.fstat(descriptor)
        named_again = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if (
            (hardened.st_dev, hardened.st_ino) != identity
            or (hardened.st_uid, hardened.st_gid, mode(hardened), hardened.st_nlink)
            != (0, 0, 0o444, 1)
            or named_again.st_mode != hardened.st_mode
            or named_again.st_uid != hardened.st_uid
            or named_again.st_gid != hardened.st_gid
            or (named_again.st_dev, named_again.st_ino) != identity
            or hashlib.sha256(
                os.pread(descriptor, hardened.st_size + 1, 0)
            ).hexdigest() != expected_digest
        ):
            reject()
        os.fsync(directory_descriptor)
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 4:
        reject()
    harden(sys.argv[1], sys.argv[2], read_private_digest(sys.argv[3]))
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- ||
    die 'the private KemerBet Player-ID digest channel could not be closed'
  [[ "$python_status" -eq 0 ]] ||
    die 'the KemerBet Player-ID file could not be hardened safely'
}

resolve_kemerbet_session_control_volume_mountpoint() {
  local mountpoint volume_name
  volume_name="$(docker_local volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.volume=kemerbet_session_control')" ||
    die 'the KemerBet session-control volume inventory could not be inspected'
  [[ "$volume_name" == "$KEMERBET_SESSION_CONTROL_VOLUME" ]] ||
    die 'the KemerBet session-control volume identity is not exact'
  [[ "$(docker_local volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}')" == \
    "$KEMERBET_SESSION_CONTROL_VOLUME|local|local|$PROJECT_NAME|kemerbet_session_control" ]] ||
    die 'the KemerBet session-control volume contract is not exact'
  mountpoint="$(docker_local volume inspect "$volume_name" --format '{{.Mountpoint}}')" ||
    die 'the KemerBet session-control volume mountpoint could not be inspected'
  [[ "$mountpoint" == /* && ! -L "$mountpoint" && -d "$mountpoint" ]] ||
    die 'the KemerBet session-control volume mountpoint is unsafe'
  [[ "$(realpath -- "$mountpoint")" == "$mountpoint" ]] ||
    die 'the KemerBet session-control volume mountpoint is not canonical'
  [[ "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] ||
    die 'the KemerBet session-control volume ownership or mode is unsafe'
  printf '%s' "$mountpoint"
}

require_owner_kemerbet_receipt_ancestors() {
  local ancestor
  for ancestor in / /var /var/lib; do
    [[ ! -L "$ancestor" && -d "$ancestor" && "$(realpath -- "$ancestor")" == "$ancestor" &&
      "$(stat --format='%u:%g:%a' "$ancestor")" == '0:0:755' ]] ||
      die 'a system ancestor is unsafe for the Owner KemerBet receipt boundary'
  done
}

require_owner_kemerbet_receipt_directory() {
  require_owner_kemerbet_receipt_ancestors || return 1
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" && -d "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_PARENT")" == "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_PARENT")" == '0:0:755' ]] ||
    die 'the Owner KemerBet receipt parent is unsafe'
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" && -d "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_ROOT")" == "$KEMERBET_OWNER_RECEIPT_ROOT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_ROOT")" == '0:0:755' ]] ||
    die 'the Owner KemerBet receipt root is unsafe'
}

require_owner_kemerbet_receipt_startup_state() {
  local claim_id entries entry final_count=0 path
  require_owner_kemerbet_receipt_directory || return 1
  entries="$(find -P "$KEMERBET_OWNER_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" ||
    die 'the Owner KemerBet receipt root could not be inspected'
  if [[ -n "$entries" ]]; then
    while IFS= read -r entry; do
      path="$KEMERBET_OWNER_RECEIPT_ROOT/$entry"
      case "$entry" in
        "$KEMERBET_OWNER_IMPORTED_CLAIM_NAME"|"$KEMERBET_OWNER_COMPLETED_CLAIM_NAME"|"$KEMERBET_OWNER_FAILED_CLAIM_NAME")
          [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
            "$(stat --format='%u:%g:%a:%h:%s' "$path")" == '0:10001:440:1:37' ]] ||
            die 'an Owner KemerBet receipt has unsafe metadata'
          IFS= read -r claim_id <"$path" || die 'an Owner KemerBet receipt could not be read'
          [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
            die 'an Owner KemerBet receipt claim is invalid'
          cmp -s -- "$path" <(printf '%s\n' "$claim_id") ||
            die 'an Owner KemerBet receipt content is not exact'
          final_count=$((final_count + 1))
          ;;
        "$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME"|"$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME"|"$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME")
          die 'an incomplete Owner KemerBet receipt installation blocks startup'
          ;;
        *) die 'the Owner KemerBet receipt root contains unexpected residue' ;;
      esac
    done <<<"$entries"
  fi
  [[ "$final_count" -le 1 ]] || die 'the Owner KemerBet receipt state is conflicting'
  require_owner_kemerbet_receipt_directory || return 1
}

ensure_owner_kemerbet_receipt_root() {
  require_owner_kemerbet_receipt_ancestors
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_PARENT" && ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" ]]; then
    install -d -o root -g root -m 0755 "$KEMERBET_OWNER_RECEIPT_PARENT"
    sync -f /var/lib || die 'the Owner KemerBet receipt parent could not be synchronized'
  fi
  [[ ! -L "$KEMERBET_OWNER_RECEIPT_PARENT" && -d "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(realpath -- "$KEMERBET_OWNER_RECEIPT_PARENT")" == "$KEMERBET_OWNER_RECEIPT_PARENT" &&
    "$(stat --format='%u:%g:%a' "$KEMERBET_OWNER_RECEIPT_PARENT")" == '0:0:755' ]] ||
    die 'the Owner KemerBet receipt parent is unsafe'
  if [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT" && ! -L "$KEMERBET_OWNER_RECEIPT_ROOT" ]]; then
    install -d -o root -g root -m 0755 "$KEMERBET_OWNER_RECEIPT_ROOT"
    sync -f "$KEMERBET_OWNER_RECEIPT_PARENT" ||
      die 'the Owner KemerBet receipt root installation could not be synchronized'
  fi
  require_owner_kemerbet_receipt_startup_state
}

require_legacy_owner_kemerbet_receipt_paths_absent() {
  local control_mountpoint legacy_path
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  for legacy_path in \
    "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_FAILED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_RECOVERY_LATCH_NAME" \
    "$control_mountpoint/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME"; do
    [[ ! -e "$legacy_path" && ! -L "$legacy_path" ]] ||
      die 'a legacy Owner-writable KemerBet receipt path blocks the root receipt boundary'
  done
}

require_single_owner_control_runtime_instance() {
  local all_bind_contracts all_container_ids_text bind_container bind_destination bind_rw bind_source
  local bind_source_canonical container_bind_contracts
  local holder_contracts owner_ids receipt_mount
  local -a all_container_ids=()
  owner_ids="$(docker_local container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control')" ||
    die 'the Owner control container inventory could not be inspected'
  require_owner_kemerbet_receipt_directory || return 1
  [[ "$owner_ids" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the reviewed runtime must contain exactly one Owner control container'
  [[ "$(docker_local container inspect "$owner_ids" \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}')" == \
    "$PROJECT_NAME|owner-control" ]] ||
    die 'the singular Owner control container labels are not exact'
  receipt_mount="$(docker_local container inspect "$owner_ids" --format \
    '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-readiness-cohort-receipts"}}{{printf "%s|%s|%s|%t" .Type .Source .Destination .RW}}{{end}}{{end}}')" ||
    die 'the Owner KemerBet receipt mount could not be inspected'
  [[ "$receipt_mount" == \
    "bind|$KEMERBET_OWNER_RECEIPT_ROOT|$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT|false" ]] ||
    die 'the Owner KemerBet receipt mount contract is not exact'
  all_container_ids_text="$(docker_local container ls --all --quiet --no-trunc)" ||
    die 'the container inventory could not be inspected for Owner KemerBet receipt holders'
  if [[ -n "$all_container_ids_text" ]]; then
    mapfile -t all_container_ids <<<"$all_container_ids_text"
  fi
  holder_contracts=''
  all_bind_contracts=''
  if [[ "${#all_container_ids[@]}" -gt 0 ]]; then
    # Docker appends a separator newline for every inspected object. Inspecting several objects in
    # one template call therefore creates ambiguous blank records (especially for a container with
    # no binds). Inspect one exact container at a time and append only a nonempty complete output;
    # the rigid field classifier below continues to reject every partial record.
    for bind_container in "${all_container_ids[@]}"; do
      [[ "$bind_container" =~ ^[0-9a-f]{64}$ ]] ||
        die 'a container identity could not be safely classified'
      container_bind_contracts="$(docker_local container inspect "$bind_container" --format \
        '{{range .Mounts}}{{if eq .Type "bind"}}{{printf "%s|%s|%s|%t\n" $.Id .Source .Destination .RW}}{{end}}{{end}}')" ||
        die 'the Owner KemerBet receipt bind inventory could not be inspected'
      if [[ -n "$container_bind_contracts" ]]; then
        if [[ -n "$all_bind_contracts" ]]; then
          all_bind_contracts+=$'\n'
        fi
        all_bind_contracts+="$container_bind_contracts"
      fi
    done
    if [[ -n "$all_bind_contracts" ]]; then
      while IFS='|' read -r bind_container bind_source bind_destination bind_rw; do
        [[ "$bind_container" =~ ^[0-9a-f]{64}$ && "$bind_source" == /* &&
          "$bind_destination" == /* && "$bind_rw" =~ ^(true|false)$ ]] ||
          die 'a container bind mount could not be safely classified'
        bind_source_canonical="$(realpath -- "$bind_source")" ||
          die 'a container bind source could not be canonically resolved'
        [[ "$bind_source_canonical" == /* && ! -L "$bind_source_canonical" &&
          "$(realpath -- "$bind_source_canonical")" == "$bind_source_canonical" ]] ||
          die 'a container bind source is not canonical'
        if [[ "$bind_source_canonical" == '/' ||
          "$bind_source_canonical" == "$KEMERBET_OWNER_RECEIPT_ROOT" ||
          "$bind_source_canonical" == "$KEMERBET_OWNER_RECEIPT_ROOT/"* ||
          "$KEMERBET_OWNER_RECEIPT_ROOT" == "$bind_source_canonical/"* ]]; then
          holder_contracts+="$bind_container|bind|$bind_source_canonical|$bind_destination|$bind_rw"$'\n'
        fi
      done <<<"$all_bind_contracts"
      holder_contracts="${holder_contracts%$'\n'}"
    fi
  fi
  [[ "$holder_contracts" == \
    "$owner_ids|bind|$KEMERBET_OWNER_RECEIPT_ROOT|$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT|false" ]] ||
    die 'the Owner KemerBet receipt boundary overlaps an unexpected container bind'
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
}

require_owner_kemerbet_receipt_service_access() {
  local owner_id
  require_single_owner_control_runtime_instance || return 1
  owner_id="$(docker_local container ls --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control')" ||
    die 'the running Owner control container could not be inspected'
  [[ "$owner_id" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the exact Owner control container is not running'
  docker_local container exec "$owner_id" node -e \
    "const fs=require('node:fs');const p='$KEMERBET_OWNER_RECEIPT_CONTAINER_ROOT';fs.readdirSync(p);fs.accessSync(p,fs.constants.R_OK|fs.constants.X_OK);try{fs.accessSync(p,fs.constants.W_OK);process.exit(1)}catch(e){if(!e||!['EACCES','EPERM','EROFS'].includes(e.code))process.exit(1)}" \
    >/dev/null 2>&1 || die 'the Owner process receipt mount is not read-only and traversable'
}

inspect_owner_staged_kemerbet_cohort() {
  local claim_path claim_size control_mountpoint inspection installing_path player_path player_size
  local -a inspection_lines=()
  require_single_owner_control_runtime_instance || return 1
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  player_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_path="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  for installing_path in \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$installing_path" && ! -L "$installing_path" ]] ||
      die 'the Owner-staged KemerBet cohort has an incomplete fixed installation'
  done
  [[ ! -e "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -e "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" ]] ||
    die 'the Owner-staged KemerBet cohort has an incompatible claim marker'
  [[ ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME" ]] ||
    die 'the Owner-staged KemerBet cohort has an incompatible root receipt'
  for staged_path in "$player_path" "$claim_path"; do
    [[ ! -L "$staged_path" && -f "$staged_path" && "$(realpath -- "$staged_path")" == "$staged_path" &&
      "$(stat --format='%u:%g:%a:%h' "$staged_path")" == '10001:10001:400:1' ]] ||
      die 'the Owner-staged KemerBet cohort file ownership or mode is unsafe'
  done
  player_size="$(stat --format='%s' "$player_path")"
  claim_size="$(stat --format='%s' "$claim_path")"
  [[ "$player_size" =~ ^[0-9]+$ && "$player_size" -ge 10 && "$player_size" -le 1024 ]] ||
    die 'the Owner-staged KemerBet Player-ID cohort size is invalid'
  [[ "$claim_size" == '37' ]] || die 'the Owner-staged KemerBet claim size is invalid'
  IFS= read -r KEMERBET_RECHECK_OWNER_CLAIM_ID <"$claim_path" ||
    die 'the Owner-staged KemerBet claim could not be read'
  [[ "$KEMERBET_RECHECK_OWNER_CLAIM_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'the Owner-staged KemerBet claim identity is invalid'
  cmp -s -- "$claim_path" <(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID") ||
    die 'the Owner-staged KemerBet claim content is not exact'
  if [[ -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME" ||
    -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME" ]]; then
    owner_kemerbet_cohort_marker require-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the retryable Owner-staged KemerBet failure marker does not match its claim'
  fi
  inspection="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$player_path" "$claim_path" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" <<'PY'
import hashlib
import os
import re
import stat
import sys

PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def open_exact(directory_descriptor, path, player):
    name = os.path.basename(path)
    relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    absolute = os.lstat(path)
    if (
        not stat.S_ISREG(relative.st_mode)
        or (relative.st_dev, relative.st_ino) != (absolute.st_dev, absolute.st_ino)
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or (relative.st_uid, relative.st_gid, mode(relative), relative.st_nlink)
        != (10001, 10001, 0o400, 1)
        or relative.st_size != absolute.st_size
        or relative.st_size < (10 if player else 37)
        or relative.st_size > (1024 if player else 37)
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    opened = os.fstat(descriptor)
    content = os.pread(descriptor, relative.st_size + 1, 0)
    if (
        (opened.st_dev, opened.st_ino) != (relative.st_dev, relative.st_ino)
        or opened.st_mode != relative.st_mode
        or opened.st_uid != relative.st_uid
        or opened.st_gid != relative.st_gid
        or opened.st_nlink != 1
        or opened.st_size != relative.st_size
        or len(content) != relative.st_size
    ):
        os.close(descriptor)
        reject()
    return descriptor, opened, content


def inspect(player_path, claim_path, claim_id):
    if (
        os.path.basename(player_path) != 'kemerbet-readiness-player-ids.stage-v1'
        or os.path.basename(claim_path) != 'kemerbet-readiness-cohort-claim.stage-v1'
        or os.path.dirname(player_path) != os.path.dirname(claim_path)
        or CLAIM_ID.fullmatch(claim_id) is None
    ):
        reject()
    directory = os.path.dirname(player_path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    player_descriptor = None
    claim_descriptor = None
    try:
        opened_directory = os.fstat(directory_descriptor)
        named_directory = os.lstat(directory)
        if (
            not stat.S_ISDIR(opened_directory.st_mode)
            or (opened_directory.st_dev, opened_directory.st_ino)
            != (named_directory.st_dev, named_directory.st_ino)
            or (opened_directory.st_uid, opened_directory.st_gid, mode(opened_directory))
            != (10001, 10001, 0o700)
            or named_directory.st_mode != opened_directory.st_mode
            or os.path.realpath(directory) != directory
        ):
            reject()
        player_descriptor, player, player_content = open_exact(
            directory_descriptor, player_path, True
        )
        claim_descriptor, claim, claim_content = open_exact(
            directory_descriptor, claim_path, False
        )
        lines = player_content[:-1].split(b'\n') if player_content.endswith(b'\n') else []
        if (
            b'\r' in player_content
            or b'\0' in player_content
            or len(lines) != 5
            or len(set(lines)) != 5
            or any(PLAYER_ID.fullmatch(line) is None for line in lines)
            or claim_content != (claim_id + '\n').encode('ascii')
        ):
            reject()
        for descriptor, opened, path in (
            (player_descriptor, player, player_path),
            (claim_descriptor, claim, claim_path),
        ):
            named = os.stat(
                os.path.basename(path),
                dir_fd=directory_descriptor,
                follow_symlinks=False,
            )
            if (
                (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino)
                or named.st_mode != opened.st_mode
                or named.st_uid != opened.st_uid
                or named.st_gid != opened.st_gid
                or os.fstat(descriptor).st_mode != opened.st_mode
            ):
                reject()
        return (
            f'{player.st_dev}:{player.st_ino}',
            f'{claim.st_dev}:{claim.st_ino}',
            hashlib.sha256(player_content).hexdigest(),
        )
    finally:
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        if player_descriptor is not None:
            os.close(player_descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 4:
        reject()
    values = inspect(sys.argv[1], sys.argv[2], sys.argv[3])
    sys.stdout.write('\n'.join(values) + '\n')
except Exception:
    raise SystemExit(1)
PY
)" || die 'the Owner-staged KemerBet cohort could not be inspected safely'
  mapfile -t inspection_lines <<<"$inspection"
  [[ "${#inspection_lines[@]}" -eq 3 ]] ||
    die 'the Owner-staged KemerBet cohort inspection result is invalid'
  KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO="${inspection_lines[0]}"
  KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO="${inspection_lines[1]}"
  KEMERBET_RECHECK_PLAYER_IDS_DIGEST="${inspection_lines[2]}"
  [[ "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the Owner-staged KemerBet cohort file identity is invalid'
  [[ "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$player_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO:10001:10001:400:1:$player_size" &&
    "$(sha256sum -- "$player_path" | awk '{print $1}')" == "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$claim_path")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO:10001:10001:400:1:37" ]] ||
    die 'the Owner-staged KemerBet cohort changed during inspection'
}

prepare_retryable_kemerbet_session_player_ids() {
  local after_claim_dev_ino after_claim_id after_digest after_player_dev_ino
  local before_claim_dev_ino before_claim_id before_digest before_player_dev_ino
  local binding_size candidate_path claim_source control_mountpoint failed_installing_path
  local failed_path metadata_fd python_status source

  failed_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME"
  failed_installing_path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"
  candidate_path="$(dirname -- "$KEMERBET_READINESS_PLAYER_IDS")/.kemerbet-readiness-player-ids.promote-v1"

  if [[ -e "$KEMERBET_READINESS_PLAYER_IDS" || -L "$KEMERBET_READINESS_PLAYER_IDS" ]]; then
    require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
    if [[ ! -e "$failed_path" && ! -L "$failed_path" &&
      ! -e "$failed_installing_path" && ! -L "$failed_installing_path" &&
      ! -e "$candidate_path" && ! -L "$candidate_path" ]]; then
      [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' ]] ||
        die 'the private KemerBet session Player-ID file has an unsafe hard-link count'
      return 0
    fi
  fi

  # A failed one-shot recheck consumes its internal Player-ID copy before restoring the same
  # immutable Owner cohort for retry. Reopen sign-in only from that exact failed cohort. This
  # creates a new service copy without changing either Owner-stage inode, ownership, content, or
  # claim marker; the next recheck will independently freeze and consume the copy again.
  [[ ! -e "$KEMERBET_RECHECK_PROMOTION_ROOT" && ! -L "$KEMERBET_RECHECK_PROMOTION_ROOT" &&
    ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" &&
    ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
    ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" &&
    ! -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" &&
    ! -e "$failed_installing_path" && ! -L "$failed_installing_path" ]] ||
    die 'the retryable KemerBet session boundary contains recovery or committed residue'
  require_kemerbet_readiness_output_directory
  [[ ! -L "$KEMERBET_READINESS_BINDING" && -f "$KEMERBET_READINESS_BINDING" &&
    "$(realpath -- "$KEMERBET_READINESS_BINDING")" == "$KEMERBET_READINESS_BINDING" &&
    "$(stat --format='%u:%g:%a:%h' "$KEMERBET_READINESS_BINDING")" == '10001:10001:600:1' ]] ||
    die 'the sealed KemerBet readiness binding is unavailable or unsafe for retry'
  binding_size="$(stat --format='%s' "$KEMERBET_READINESS_BINDING")"
  [[ "$binding_size" =~ ^[0-9]+$ && "$binding_size" -ge 100 && "$binding_size" -le 256 &&
    "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] ||
    die 'the sealed KemerBet readiness binding shape is invalid for retry'
  LC_ALL=C grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
    "$KEMERBET_READINESS_BINDING" ||
    die 'the sealed KemerBet readiness binding contract is invalid for retry'
  inspect_owner_staged_kemerbet_cohort
  before_player_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"
  before_claim_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"
  before_claim_id="$KEMERBET_RECHECK_OWNER_CLAIM_ID"
  before_digest="$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
  owner_kemerbet_cohort_marker require-failed "$before_claim_id" ||
    die 'the retryable KemerBet cohort failure marker is unavailable'

  command -v python3 >/dev/null 2>&1 ||
    die 'the retryable KemerBet session input verifier is unavailable'
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  exec {metadata_fd}<<<"$before_claim_id
$before_digest" ||
    die 'the private retryable KemerBet cohort metadata channel could not be opened'
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" "$KEMERBET_READINESS_PLAYER_IDS" \
    "$before_player_dev_ino" "$before_claim_dev_ino" "$metadata_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

EXPECTED_SOURCE_NAME = 'kemerbet-readiness-player-ids.stage-v1'
EXPECTED_CLAIM_NAME = 'kemerbet-readiness-cohort-claim.stage-v1'
EXPECTED_TARGET = '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
CANDIDATE_NAME = '.kemerbet-readiness-player-ids.promote-v1'
PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
MAXIMUM_BYTES = 1024


def reject():
    raise RuntimeError()


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def read_private_metadata(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 103)
    finally:
        os.close(descriptor)
    if len(content) != 102 or not content.endswith(b'\n'):
        reject()
    try:
        values = content[:-1].decode('ascii').split('\n')
    except UnicodeDecodeError:
        reject()
    if (
        len(values) != 2
        or CLAIM_ID.fullmatch(values[0]) is None
        or DIGEST.fullmatch(values[1]) is None
    ):
        reject()
    return values[0], values[1]


def parse_identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def validate_player_content(content):
    if len(content) < 10 or len(content) > MAXIMUM_BYTES:
        reject()
    if not content.endswith(b'\n') or b'\r' in content or b'\0' in content:
        reject()
    lines = content[:-1].split(b'\n')
    if len(lines) != 5 or len(set(lines)) != 5:
        reject()
    if any(PLAYER_ID.fullmatch(line) is None for line in lines):
        reject()


def open_exact_directory(path, expected_uid, expected_gid, expected_mode):
    descriptor = os.open(
        path,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        opened = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or (opened.st_uid, opened.st_gid, exact_mode(opened))
            != (expected_uid, expected_gid, expected_mode)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or os.path.realpath(path) != path
        ):
            reject()
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def optional_named_file(directory_descriptor, name, path):
    try:
        relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return None
        reject()
    absolute = os.lstat(path)
    if (
        (relative.st_dev, relative.st_ino) != (absolute.st_dev, absolute.st_ino)
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or relative.st_nlink != absolute.st_nlink
        or relative.st_size != absolute.st_size
    ):
        reject()
    return relative


def read_exact_file(directory_descriptor, name, path, expected_metadata, expected_content):
    named = optional_named_file(directory_descriptor, name, path)
    expected_uid, expected_gid, expected_mode, expected_links = expected_metadata
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_uid, named.st_gid, exact_mode(named), named.st_nlink)
        != (expected_uid, expected_gid, expected_mode, expected_links)
        or named.st_size != len(expected_content)
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != named.st_nlink
            or opened.st_size != named.st_size
            or os.pread(descriptor, len(expected_content) + 1, 0) != expected_content
        ):
            reject()
        return descriptor, (opened.st_dev, opened.st_ino)
    except Exception:
        os.close(descriptor)
        raise


def read_exact_source(directory_descriptor, name, path, expected_identity):
    named = optional_named_file(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_dev, named.st_ino) != expected_identity
        or (named.st_uid, named.st_gid, exact_mode(named), named.st_nlink)
        != (10001, 10001, 0o400, 1)
        or named.st_size < 10
        or named.st_size > MAXIMUM_BYTES
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != expected_identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != named.st_size
        ):
            reject()
        content = os.pread(descriptor, MAXIMUM_BYTES + 1, 0)
        if len(content) != opened.st_size:
            reject()
        validate_player_content(content)
        return descriptor, content
    except Exception:
        os.close(descriptor)
        raise


def require_source_unchanged(
    descriptor,
    directory_descriptor,
    name,
    path,
    expected_identity,
    expected_content,
):
    opened = os.fstat(descriptor)
    named = optional_named_file(directory_descriptor, name, path)
    if (
        named is None
        or (opened.st_dev, opened.st_ino) != expected_identity
        or (named.st_dev, named.st_ino) != expected_identity
        or opened.st_mode != named.st_mode
        or opened.st_uid != named.st_uid
        or opened.st_gid != named.st_gid
        or opened.st_nlink != named.st_nlink
        or opened.st_size != named.st_size
        or (opened.st_uid, opened.st_gid, exact_mode(opened), opened.st_nlink)
        != (10001, 10001, 0o400, 1)
        or os.pread(descriptor, len(expected_content) + 1, 0) != expected_content
    ):
        reject()


def remove_safe_candidate(
    directory_descriptor,
    candidate_name,
    candidate_path,
    source_content,
):
    candidate = optional_named_file(directory_descriptor, candidate_name, candidate_path)
    if candidate is None:
        return
    if (
        not stat.S_ISREG(candidate.st_mode)
        or candidate.st_nlink != 1
        or candidate.st_size > len(source_content)
        or (candidate.st_uid, candidate.st_gid, exact_mode(candidate))
        not in {(0, 0, 0o600), (10001, 10001, 0o600), (10001, 10001, 0o400)}
    ):
        reject()
    descriptor = os.open(
        candidate_name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        content = os.pread(descriptor, len(source_content) + 1, 0)
        if (
            (opened.st_dev, opened.st_ino) != (candidate.st_dev, candidate.st_ino)
            or opened.st_mode != candidate.st_mode
            or opened.st_uid != candidate.st_uid
            or opened.st_gid != candidate.st_gid
            or opened.st_nlink != 1
            or opened.st_size != candidate.st_size
            or content != source_content[: len(content)]
        ):
            reject()
    finally:
        os.close(descriptor)
    os.unlink(candidate_name, dir_fd=directory_descriptor)
    os.fsync(directory_descriptor)
    if optional_named_file(directory_descriptor, candidate_name, candidate_path) is not None:
        reject()


def write_all(descriptor, content):
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written < 1:
            reject()
        offset += written


def prepare(
    source,
    claim_source,
    target,
    expected_identity_text,
    expected_claim_identity_text,
    expected_claim_id,
    expected_digest,
):
    if (
        os.path.basename(source) != EXPECTED_SOURCE_NAME
        or os.path.basename(claim_source) != EXPECTED_CLAIM_NAME
        or target != EXPECTED_TARGET
        or os.path.basename(target) != 'kemerbet_no_transfer_readiness_player_ids'
        or CLAIM_ID.fullmatch(expected_claim_id) is None
        or DIGEST.fullmatch(expected_digest) is None
    ):
        reject()
    expected_identity = parse_identity(expected_identity_text)
    expected_claim_identity = parse_identity(expected_claim_identity_text)
    source_parent = os.path.dirname(source)
    source_name = os.path.basename(source)
    claim_parent = os.path.dirname(claim_source)
    claim_name = os.path.basename(claim_source)
    if claim_parent != source_parent:
        reject()
    claim_content = expected_claim_id.encode('ascii') + b'\n'
    target_parent = os.path.dirname(target)
    target_name = os.path.basename(target)
    candidate_path = os.path.join(target_parent, CANDIDATE_NAME)
    source_directory_descriptor = open_exact_directory(source_parent, 10001, 10001, 0o700)
    target_directory_descriptor = open_exact_directory(target_parent, 0, 0, 0o700)
    source_descriptor = None
    claim_descriptor = None
    candidate_descriptor = None
    target_descriptor = None
    try:
        source_descriptor, source_content = read_exact_source(
            source_directory_descriptor,
            source_name,
            source,
            expected_identity,
        )
        if hashlib.sha256(source_content).hexdigest() != expected_digest:
            reject()
        claim_descriptor, claim_identity = read_exact_file(
            source_directory_descriptor,
            claim_name,
            claim_source,
            (10001, 10001, 0o400, 1),
            claim_content,
        )
        if claim_identity != expected_claim_identity:
            reject()

        target_value = optional_named_file(target_directory_descriptor, target_name, target)
        candidate_value = optional_named_file(
            target_directory_descriptor,
            CANDIDATE_NAME,
            candidate_path,
        )
        if target_value is not None:
            target_descriptor, target_identity = read_exact_file(
                target_directory_descriptor,
                target_name,
                target,
                (10001, 10001, 0o400, target_value.st_nlink),
                source_content,
            )
            if target_value.st_nlink == 2 and candidate_value is not None:
                candidate_descriptor, candidate_identity = read_exact_file(
                    target_directory_descriptor,
                    CANDIDATE_NAME,
                    candidate_path,
                    (10001, 10001, 0o400, 2),
                    source_content,
                )
                if candidate_identity != target_identity:
                    reject()
                os.close(candidate_descriptor)
                candidate_descriptor = None
                os.unlink(CANDIDATE_NAME, dir_fd=target_directory_descriptor)
                os.fsync(target_directory_descriptor)
            elif target_value.st_nlink == 1:
                remove_safe_candidate(
                    target_directory_descriptor,
                    CANDIDATE_NAME,
                    candidate_path,
                    source_content,
                )
            else:
                reject()
        else:
            remove_safe_candidate(
                target_directory_descriptor,
                CANDIDATE_NAME,
                candidate_path,
                source_content,
            )
            candidate_descriptor = os.open(
                CANDIDATE_NAME,
                os.O_RDWR
                | os.O_CREAT
                | os.O_EXCL
                | os.O_NOFOLLOW
                | os.O_CLOEXEC,
                0o600,
                dir_fd=target_directory_descriptor,
            )
            write_all(candidate_descriptor, source_content)
            os.fchown(candidate_descriptor, 10001, 10001)
            os.fchmod(candidate_descriptor, 0o400)
            os.fsync(candidate_descriptor)
            candidate_identity = os.fstat(candidate_descriptor)
            read_descriptor, read_identity = read_exact_file(
                target_directory_descriptor,
                CANDIDATE_NAME,
                candidate_path,
                (10001, 10001, 0o400, 1),
                source_content,
            )
            os.close(read_descriptor)
            if read_identity != (candidate_identity.st_dev, candidate_identity.st_ino):
                reject()
            require_source_unchanged(
                source_descriptor,
                source_directory_descriptor,
                source_name,
                source,
                expected_identity,
                source_content,
            )
            require_source_unchanged(
                claim_descriptor,
                source_directory_descriptor,
                claim_name,
                claim_source,
                expected_claim_identity,
                claim_content,
            )
            os.link(
                CANDIDATE_NAME,
                target_name,
                src_dir_fd=target_directory_descriptor,
                dst_dir_fd=target_directory_descriptor,
                follow_symlinks=False,
            )
            os.fsync(target_directory_descriptor)
            target_descriptor, target_identity = read_exact_file(
                target_directory_descriptor,
                target_name,
                target,
                (10001, 10001, 0o400, 2),
                source_content,
            )
            if target_identity != (candidate_identity.st_dev, candidate_identity.st_ino):
                reject()
            os.unlink(CANDIDATE_NAME, dir_fd=target_directory_descriptor)
            os.fsync(target_directory_descriptor)

        if target_descriptor is not None:
            os.close(target_descriptor)
            target_descriptor = None
        final_descriptor, _ = read_exact_file(
            target_directory_descriptor,
            target_name,
            target,
            (10001, 10001, 0o400, 1),
            source_content,
        )
        os.close(final_descriptor)
        require_source_unchanged(
            source_descriptor,
            source_directory_descriptor,
            source_name,
            source,
            expected_identity,
            source_content,
        )
        require_source_unchanged(
            claim_descriptor,
            source_directory_descriptor,
            claim_name,
            claim_source,
            expected_claim_identity,
            claim_content,
        )
        if optional_named_file(
            target_directory_descriptor,
            CANDIDATE_NAME,
            candidate_path,
        ) is not None:
            reject()
        os.fsync(target_directory_descriptor)
        os.fsync(source_directory_descriptor)
    finally:
        if target_descriptor is not None:
            os.close(target_descriptor)
        if candidate_descriptor is not None:
            os.close(candidate_descriptor)
        if source_descriptor is not None:
            os.close(source_descriptor)
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        os.close(target_directory_descriptor)
        os.close(source_directory_descriptor)


try:
    if len(sys.argv) != 7:
        reject()
    claim_id, digest = read_private_metadata(sys.argv[6])
    prepare(
        sys.argv[1],
        sys.argv[2],
        sys.argv[3],
        sys.argv[4],
        sys.argv[5],
        claim_id,
        digest,
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {metadata_fd}<&- ||
    die 'the private retryable KemerBet cohort metadata channel could not be closed'
  [[ "$python_status" -eq 0 ]] ||
    die 'the retryable KemerBet session Player-ID copy could not be prepared safely'

  inspect_owner_staged_kemerbet_cohort
  after_player_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO"
  after_claim_dev_ino="$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO"
  after_claim_id="$KEMERBET_RECHECK_OWNER_CLAIM_ID"
  after_digest="$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
  [[ "$after_player_dev_ino" == "$before_player_dev_ino" &&
    "$after_claim_dev_ino" == "$before_claim_dev_ino" &&
    "$after_claim_id" == "$before_claim_id" && "$after_digest" == "$before_digest" ]] ||
    die 'the retryable KemerBet Owner cohort changed while preparing private sign-in'
  owner_kemerbet_cohort_marker require-failed "$before_claim_id" ||
    die 'the retryable KemerBet cohort failure marker changed during private sign-in preparation'
  require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
  [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' &&
    "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$before_digest" ]] ||
    die 'the retryable KemerBet session Player-ID copy is not exact'
}

promote_owner_staged_kemerbet_player_ids() {
  local claim_source control_mountpoint digest_fd python_status source
  command -v python3 >/dev/null 2>&1 ||
    die 'the fixed Owner-staged KemerBet cohort verifier is unavailable'
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"

  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ||
    die 'the private Owner-staged KemerBet digest channel could not be opened'
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" "$KEMERBET_READINESS_PLAYER_IDS" \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

EXPECTED_SOURCE_NAME = 'kemerbet-readiness-player-ids.stage-v1'
EXPECTED_CLAIM_NAME = 'kemerbet-readiness-cohort-claim.stage-v1'
EXPECTED_TARGET = '/etc/fetanagent/executor-secrets/kemerbet_no_transfer_readiness_player_ids'
PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
MAXIMUM_BYTES = 1024


def reject():
    raise RuntimeError()


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def require_exact_directory(path, descriptor, expected_uid, expected_gid, expected_mode):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or opened.st_uid != expected_uid
        or opened.st_gid != expected_gid
        or exact_mode(opened) != expected_mode
        or named.st_uid != opened.st_uid
        or named.st_gid != opened.st_gid
        or named.st_mode != opened.st_mode
        or os.path.realpath(path) != path
    ):
        reject()


def open_exact_directory(path, expected_uid, expected_gid, expected_mode):
    descriptor = os.open(
        path,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        require_exact_directory(path, descriptor, expected_uid, expected_gid, expected_mode)
    except Exception:
        os.close(descriptor)
        raise
    return descriptor


def optional_named_file(directory_descriptor, name, absolute_path):
    try:
        relative_value = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(absolute_path)
        except FileNotFoundError:
            return None
        reject()
    try:
        absolute_value = os.lstat(absolute_path)
    except FileNotFoundError:
        reject()
    if (
        (relative_value.st_dev, relative_value.st_ino)
        != (absolute_value.st_dev, absolute_value.st_ino)
        or relative_value.st_mode != absolute_value.st_mode
        or relative_value.st_uid != absolute_value.st_uid
        or relative_value.st_gid != absolute_value.st_gid
        or relative_value.st_nlink != absolute_value.st_nlink
        or relative_value.st_size != absolute_value.st_size
    ):
        reject()
    return relative_value


def require_absent(directory_descriptor, name, absolute_path):
    if optional_named_file(directory_descriptor, name, absolute_path) is not None:
        reject()


def require_open_file(
    descriptor,
    expected_uid,
    expected_gid,
    expected_mode,
    expected_size,
    expected_links=1,
):
    value = os.fstat(descriptor)
    if (
        not stat.S_ISREG(value.st_mode)
        or value.st_uid != expected_uid
        or value.st_gid != expected_gid
        or exact_mode(value) != expected_mode
        or value.st_nlink != expected_links
        or value.st_size != expected_size
    ):
        reject()
    return value


def require_named_identity(
    directory_descriptor,
    name,
    absolute_path,
    identity,
    expected_uid,
    expected_gid,
    expected_mode,
    expected_size,
    expected_links=1,
):
    value = optional_named_file(directory_descriptor, name, absolute_path)
    if (
        value is None
        or not stat.S_ISREG(value.st_mode)
        or (value.st_dev, value.st_ino) != identity
        or value.st_uid != expected_uid
        or value.st_gid != expected_gid
        or exact_mode(value) != expected_mode
        or value.st_nlink != expected_links
        or value.st_size != expected_size
    ):
        reject()
    return value


def read_exact(descriptor, expected_size, maximum_size):
    if expected_size < 1 or expected_size > maximum_size:
        reject()
    content = os.pread(descriptor, maximum_size + 1, 0)
    if len(content) != expected_size:
        reject()
    return content


def validate_player_content(content):
    if len(content) < 10 or len(content) > MAXIMUM_BYTES:
        reject()
    if not content.endswith(b'\n') or b'\r' in content or b'\0' in content:
        reject()
    lines = content[:-1].split(b'\n')
    if len(lines) != 5 or len(set(lines)) != 5:
        reject()
    if any(PLAYER_ID.fullmatch(line) is None for line in lines):
        reject()


def require_content_digest(content, expected_digest):
    if DIGEST.fullmatch(expected_digest) is None:
        reject()
    if hashlib.sha256(content).hexdigest() != expected_digest:
        reject()


def parse_identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def open_stage_file(
    directory_descriptor,
    name,
    path,
    expected_identity,
    expected_content,
    player_file,
):
    named = optional_named_file(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_dev, named.st_ino) != expected_identity
        or named.st_nlink != 1
        or (named.st_uid, named.st_gid, exact_mode(named))
        not in {
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
            (0, 0, 0o400),
            (0, 0, 0o444),
        }
    ):
        reject()
    if player_file:
        if named.st_size < 10 or named.st_size > MAXIMUM_BYTES:
            reject()
    elif named.st_size != len(expected_content):
        reject()
    descriptor = os.open(
        name,
        os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            not stat.S_ISREG(opened.st_mode)
            or (opened.st_dev, opened.st_ino) != expected_identity
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != named.st_size
        ):
            reject()
        content = read_exact(
            descriptor,
            opened.st_size,
            MAXIMUM_BYTES if player_file else len(expected_content),
        )
        if player_file:
            validate_player_content(content)
        elif content != expected_content:
            reject()
        return descriptor, content
    except Exception:
        os.close(descriptor)
        raise


def freeze_stage_file(
    directory_descriptor,
    name,
    path,
    descriptor,
    identity,
    content,
):
    opened = os.fstat(descriptor)
    if (opened.st_dev, opened.st_ino) != identity or opened.st_nlink != 1:
        reject()
    metadata = (opened.st_uid, opened.st_gid, exact_mode(opened))
    if metadata in {
        (10001, 10001, 0o400),
        (10001, 10001, 0o444),
    }:
        os.fchown(descriptor, 0, 0)
    elif metadata not in {(0, 0, 0o400), (0, 0, 0o444)}:
        reject()
    if exact_mode(os.fstat(descriptor)) != 0o444:
        os.fchmod(descriptor, 0o444)
    os.fsync(descriptor)
    require_open_file(descriptor, 0, 0, 0o444, len(content))
    require_named_identity(
        directory_descriptor,
        name,
        path,
        identity,
        0,
        0,
        0o444,
        len(content),
    )
    if read_exact(descriptor, len(content), MAXIMUM_BYTES) != content:
        reject()


def write_all(descriptor, content):
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written < 1:
            reject()
        offset += written


def open_exact_target(
    target_directory_descriptor,
    target_name,
    target,
    expected_links=1,
):
    descriptor = os.open(
        target_name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=target_directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if opened.st_size < 10 or opened.st_size > MAXIMUM_BYTES:
            reject()
        require_open_file(
            descriptor,
            10001,
            10001,
            0o400,
            opened.st_size,
            expected_links,
        )
        require_named_identity(
            target_directory_descriptor,
            target_name,
            target,
            (opened.st_dev, opened.st_ino),
            10001,
            10001,
            0o400,
            opened.st_size,
            expected_links,
        )
        content = read_exact(descriptor, opened.st_size, MAXIMUM_BYTES)
        validate_player_content(content)
        return descriptor, (opened.st_dev, opened.st_ino), content
    except Exception:
        os.close(descriptor)
        raise


def fsync_directory(descriptor):
    os.fsync(descriptor)


def recover_candidate(
    target_directory_descriptor,
    target_name,
    target,
    candidate_name,
    candidate_path,
    expected_player_digest,
):
    candidate = optional_named_file(
        target_directory_descriptor,
        candidate_name,
        candidate_path,
    )
    if candidate is None:
        return
    if not stat.S_ISREG(candidate.st_mode) or candidate.st_size > MAXIMUM_BYTES:
        reject()
    target_value = optional_named_file(target_directory_descriptor, target_name, target)
    if target_value is None:
        if (
            candidate.st_nlink != 1
            or (candidate.st_uid, candidate.st_gid, exact_mode(candidate))
            not in {
                (0, 0, 0o600),
                (10001, 10001, 0o600),
                (10001, 10001, 0o400),
            }
        ):
            reject()
        descriptor = os.open(
            candidate_name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=target_directory_descriptor,
        )
        try:
            opened = os.fstat(descriptor)
            if (
                not stat.S_ISREG(opened.st_mode)
                or (opened.st_dev, opened.st_ino) != (candidate.st_dev, candidate.st_ino)
                or opened.st_mode != candidate.st_mode
                or opened.st_uid != candidate.st_uid
                or opened.st_gid != candidate.st_gid
                or opened.st_nlink != 1
                or opened.st_size != candidate.st_size
            ):
                reject()
            if (
                (opened.st_uid, opened.st_gid, exact_mode(opened))
                == (10001, 10001, 0o400)
            ):
                completed_content = read_exact(descriptor, opened.st_size, MAXIMUM_BYTES)
                validate_player_content(completed_content)
                require_content_digest(completed_content, expected_player_digest)
        finally:
            os.close(descriptor)
        os.unlink(candidate_name, dir_fd=target_directory_descriptor)
        fsync_directory(target_directory_descriptor)
        require_absent(target_directory_descriptor, candidate_name, candidate_path)
        return

    if (
        not stat.S_ISREG(target_value.st_mode)
        or (candidate.st_dev, candidate.st_ino) != (target_value.st_dev, target_value.st_ino)
        or candidate.st_nlink != 2
        or target_value.st_nlink != 2
        or (candidate.st_uid, candidate.st_gid, exact_mode(candidate))
        != (10001, 10001, 0o400)
        or candidate.st_size < 10
    ):
        reject()
    candidate_descriptor, candidate_identity, candidate_content = open_exact_target(
        target_directory_descriptor,
        candidate_name,
        candidate_path,
        2,
    )
    target_descriptor, target_identity, target_content = open_exact_target(
        target_directory_descriptor,
        target_name,
        target,
        2,
    )
    try:
        if candidate_identity != target_identity or candidate_content != target_content:
            reject()
        require_content_digest(candidate_content, expected_player_digest)
        require_content_digest(target_content, expected_player_digest)
    finally:
        os.close(target_descriptor)
        os.close(candidate_descriptor)
    os.unlink(candidate_name, dir_fd=target_directory_descriptor)
    fsync_directory(target_directory_descriptor)
    require_absent(target_directory_descriptor, candidate_name, candidate_path)


def promote(
    source,
    claim_source,
    target,
    expected_player_identity,
    expected_claim_identity,
    claim_id,
    expected_player_digest,
):
    if (
        os.path.basename(source) != EXPECTED_SOURCE_NAME
        or os.path.basename(claim_source) != EXPECTED_CLAIM_NAME
        or os.path.dirname(source) != os.path.dirname(claim_source)
        or target != EXPECTED_TARGET
        or os.path.basename(target)
        != 'kemerbet_no_transfer_readiness_player_ids'
        or CLAIM_ID.fullmatch(claim_id) is None
        or DIGEST.fullmatch(expected_player_digest) is None
    ):
        reject()
    player_identity = parse_identity(expected_player_identity)
    claim_identity = parse_identity(expected_claim_identity)
    source_parent = os.path.dirname(source)
    target_parent = os.path.dirname(target)
    source_name = os.path.basename(source)
    claim_name = os.path.basename(claim_source)
    target_name = os.path.basename(target)
    candidate_name = '.kemerbet-readiness-player-ids.promote-v1'
    candidate_path = os.path.join(target_parent, candidate_name)
    source_directory_descriptor = open_exact_directory(source_parent, 10001, 10001, 0o700)
    target_directory_descriptor = open_exact_directory(target_parent, 0, 0, 0o700)
    player_descriptor = None
    claim_descriptor = None
    candidate_descriptor = None
    target_descriptor = None
    try:
        for forbidden_name in (
            '.kemerbet-readiness-player-ids.stage-v1.installing',
            '.kemerbet-readiness-cohort-claim.stage-v1.installing',
            '.kemerbet-readiness-cohort-imported-v1.installing',
            'kemerbet-readiness-cohort-imported-v1',
            '.kemerbet-readiness-cohort-completed-v1.installing',
            'kemerbet-readiness-cohort-completed-v1',
            '.kemerbet-readiness-cohort-failed-v1.installing',
            'kemerbet-readiness-cohort-failed-v1',
        ):
            require_absent(
                source_directory_descriptor,
                forbidden_name,
                os.path.join(source_parent, forbidden_name),
            )
        player_descriptor, player_content = open_stage_file(
            source_directory_descriptor,
            source_name,
            source,
            player_identity,
            b'',
            True,
        )
        require_content_digest(player_content, expected_player_digest)
        claim_content = (claim_id + '\n').encode('ascii')
        claim_descriptor, actual_claim_content = open_stage_file(
            source_directory_descriptor,
            claim_name,
            claim_source,
            claim_identity,
            claim_content,
            False,
        )
        if actual_claim_content != claim_content:
            reject()
        freeze_stage_file(
            source_directory_descriptor,
            source_name,
            source,
            player_descriptor,
            player_identity,
            player_content,
        )
        require_content_digest(
            read_exact(player_descriptor, len(player_content), MAXIMUM_BYTES),
            expected_player_digest,
        )
        freeze_stage_file(
            source_directory_descriptor,
            claim_name,
            claim_source,
            claim_descriptor,
            claim_identity,
            claim_content,
        )
        fsync_directory(source_directory_descriptor)

        recover_candidate(
            target_directory_descriptor,
            target_name,
            target,
            candidate_name,
            candidate_path,
            expected_player_digest,
        )
        target_present = optional_named_file(
            target_directory_descriptor,
            target_name,
            target,
        )
        if target_present is not None:
            target_descriptor, target_identity, target_content = open_exact_target(
                target_directory_descriptor,
                target_name,
                target,
            )
            if target_content != player_content:
                reject()
            require_content_digest(target_content, expected_player_digest)
        else:
            candidate_descriptor = os.open(
                candidate_name,
                os.O_RDWR
                | os.O_CREAT
                | os.O_EXCL
                | os.O_NOFOLLOW
                | os.O_CLOEXEC,
                0o600,
                dir_fd=target_directory_descriptor,
            )
            os.ftruncate(candidate_descriptor, 0)
            write_all(candidate_descriptor, player_content)
            os.fchown(candidate_descriptor, 10001, 10001)
            os.fchmod(candidate_descriptor, 0o400)
            os.fsync(candidate_descriptor)
            candidate = require_open_file(
                candidate_descriptor,
                10001,
                10001,
                0o400,
                len(player_content),
            )
            candidate_identity = (candidate.st_dev, candidate.st_ino)
            if read_exact(candidate_descriptor, len(player_content), MAXIMUM_BYTES) != player_content:
                reject()
            require_named_identity(
                target_directory_descriptor,
                candidate_name,
                candidate_path,
                candidate_identity,
                10001,
                10001,
                0o400,
                len(player_content),
            )
            fsync_directory(target_directory_descriptor)
            require_named_identity(
                source_directory_descriptor,
                source_name,
                source,
                player_identity,
                0,
                0,
                0o444,
                len(player_content),
            )
            if read_exact(player_descriptor, len(player_content), MAXIMUM_BYTES) != player_content:
                reject()
            require_absent(target_directory_descriptor, target_name, target)
            os.link(
                candidate_name,
                target_name,
                src_dir_fd=target_directory_descriptor,
                dst_dir_fd=target_directory_descriptor,
                follow_symlinks=False,
            )
            fsync_directory(target_directory_descriptor)
            require_open_file(
                candidate_descriptor,
                10001,
                10001,
                0o400,
                len(player_content),
                2,
            )
            require_named_identity(
                target_directory_descriptor,
                candidate_name,
                candidate_path,
                candidate_identity,
                10001,
                10001,
                0o400,
                len(player_content),
                2,
            )
            require_named_identity(
                target_directory_descriptor,
                target_name,
                target,
                candidate_identity,
                10001,
                10001,
                0o400,
                len(player_content),
                2,
            )
            os.unlink(candidate_name, dir_fd=target_directory_descriptor)
            fsync_directory(target_directory_descriptor)
            require_absent(target_directory_descriptor, candidate_name, candidate_path)
            require_open_file(
                candidate_descriptor,
                10001,
                10001,
                0o400,
                len(player_content),
            )
            target_descriptor, target_identity, target_content = open_exact_target(
                target_directory_descriptor,
                target_name,
                target,
            )
            if target_identity != candidate_identity or target_content != player_content:
                reject()
            require_content_digest(target_content, expected_player_digest)

        require_absent(target_directory_descriptor, candidate_name, candidate_path)
        require_named_identity(
            source_directory_descriptor,
            source_name,
            source,
            player_identity,
            0,
            0,
            0o444,
            len(player_content),
        )
        require_named_identity(
            source_directory_descriptor,
            claim_name,
            claim_source,
            claim_identity,
            0,
            0,
            0o444,
            len(claim_content),
        )
        if (
            read_exact(player_descriptor, len(player_content), MAXIMUM_BYTES) != player_content
            or read_exact(claim_descriptor, len(claim_content), len(claim_content))
            != claim_content
        ):
            reject()
        os.fsync(target_descriptor)
        fsync_directory(target_directory_descriptor)
        fsync_directory(source_directory_descriptor)
        require_exact_directory(
            source_parent,
            source_directory_descriptor,
            10001,
            10001,
            0o700,
        )
        require_exact_directory(
            target_parent,
            target_directory_descriptor,
            0,
            0,
            0o700,
        )
        require_absent(target_directory_descriptor, candidate_name, candidate_path)
        require_named_identity(
            target_directory_descriptor,
            target_name,
            target,
            target_identity,
            10001,
            10001,
            0o400,
            len(target_content),
        )
        if read_exact(target_descriptor, len(target_content), MAXIMUM_BYTES) != target_content:
            reject()
        require_content_digest(target_content, expected_player_digest)
    finally:
        if target_descriptor is not None:
            os.close(target_descriptor)
        if candidate_descriptor is not None:
            os.close(candidate_descriptor)
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        if player_descriptor is not None:
            os.close(player_descriptor)
        os.close(target_directory_descriptor)
        os.close(source_directory_descriptor)


try:
    if len(sys.argv) != 8:
        reject()
    promote(
        sys.argv[1],
        sys.argv[2],
        sys.argv[3],
        sys.argv[4],
        sys.argv[5],
        sys.argv[6],
        read_private_digest(sys.argv[7]),
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- ||
    die 'the private Owner-staged KemerBet digest channel could not be closed'
  [[ "$python_status" -eq 0 ]] ||
    die 'the fixed Owner-staged KemerBet cohort could not be promoted safely'

  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)"
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  [[ ! -L "$source" && -f "$source" && "$(realpath -- "$source")" == "$source" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h' "$source")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO:0:0:444:1" &&
    "$(sha256sum -- "$source" | awk '{print $1}')" == "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" &&
    ! -L "$claim_source" && -f "$claim_source" && "$(realpath -- "$claim_source")" == "$claim_source" &&
    "$(stat --format='%d:%i:%u:%g:%a:%h:%s' "$claim_source")" == \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO:0:0:444:1:37" ]] ||
    die 'the imported Owner-staged KemerBet cohort sources are unsafe'
  cmp -s -- "$claim_source" <(printf '%s\n' "$KEMERBET_RECHECK_OWNER_CLAIM_ID") ||
    die 'the imported Owner-staged KemerBet claim changed'
  require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
  [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' ]] ||
    die 'the promoted one-use KemerBet Player-ID file has an unsafe hard-link count'
  [[ "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == \
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]] ||
    die 'the promoted one-use KemerBet Player-ID digest changed'
}

restore_owner_staged_kemerbet_cohort() {
  local claim_source control_mountpoint digest_fd python_status source
  [[ "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ &&
    "$KEMERBET_RECHECK_OWNER_CLAIM_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || return 1
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" || return 1
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

PLAYER_ID = re.compile(rb'[A-Za-z0-9][A-Za-z0-9._-]{0,63}')
CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')
MAXIMUM_BYTES = 1024


def reject():
    raise RuntimeError()


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def exact_mode(value):
    return stat.S_IMODE(value.st_mode)


def require_directory(path, descriptor):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or (opened.st_uid, opened.st_gid, exact_mode(opened)) != (10001, 10001, 0o700)
        or named.st_mode != opened.st_mode
        or named.st_uid != opened.st_uid
        or named.st_gid != opened.st_gid
        or os.path.realpath(path) != path
    ):
        reject()


def require_absent(directory, directory_descriptor, name):
    try:
        os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(os.path.join(directory, name))
        except FileNotFoundError:
            return
    reject()


def open_source(directory, directory_descriptor, path, expected_identity, expected_content, player):
    name = os.path.basename(path)
    relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    absolute = os.lstat(path)
    if (
        not stat.S_ISREG(relative.st_mode)
        or (relative.st_dev, relative.st_ino) != expected_identity
        or (absolute.st_dev, absolute.st_ino) != expected_identity
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or relative.st_nlink != 1
        or absolute.st_nlink != 1
        or relative.st_size != absolute.st_size
        or (relative.st_uid, relative.st_gid, exact_mode(relative))
        not in {
            (10001, 10001, 0o400),
            (10001, 10001, 0o444),
            (0, 0, 0o400),
            (0, 0, 0o444),
        }
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    opened = os.fstat(descriptor)
    if (
        not stat.S_ISREG(opened.st_mode)
        or (opened.st_dev, opened.st_ino) != expected_identity
        or opened.st_mode != relative.st_mode
        or opened.st_uid != relative.st_uid
        or opened.st_gid != relative.st_gid
        or opened.st_nlink != 1
        or opened.st_size != relative.st_size
    ):
        os.close(descriptor)
        reject()
    content = os.pread(descriptor, MAXIMUM_BYTES + 1, 0)
    if len(content) != opened.st_size:
        os.close(descriptor)
        reject()
    if player:
        lines = content[:-1].split(b'\n') if content.endswith(b'\n') else []
        if (
            len(content) < 10
            or len(content) > MAXIMUM_BYTES
            or b'\r' in content
            or b'\0' in content
            or len(lines) != 5
            or len(set(lines)) != 5
            or any(PLAYER_ID.fullmatch(line) is None for line in lines)
        ):
            os.close(descriptor)
            reject()
    elif content != expected_content:
        os.close(descriptor)
        reject()
    return descriptor, content


def restore(player_path, claim_path, player_identity, claim_identity, claim_id, player_digest):
    if (
        os.path.basename(player_path) != 'kemerbet-readiness-player-ids.stage-v1'
        or os.path.basename(claim_path) != 'kemerbet-readiness-cohort-claim.stage-v1'
        or os.path.dirname(player_path) != os.path.dirname(claim_path)
        or CLAIM_ID.fullmatch(claim_id) is None
        or DIGEST.fullmatch(player_digest) is None
    ):
        reject()
    directory = os.path.dirname(player_path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    player_descriptor = None
    claim_descriptor = None
    try:
        require_directory(directory, directory_descriptor)
        # Imported/failed marker installers are journal-owned crash prefixes. The immediately
        # following remove/publish transition validates and normalizes them by exact UUID; only a
        # completed transition is incompatible with restoring a retryable pair.
        for forbidden_name in (
            '.kemerbet-readiness-player-ids.stage-v1.installing',
            '.kemerbet-readiness-cohort-claim.stage-v1.installing',
            '.kemerbet-readiness-cohort-completed-v1.installing',
            'kemerbet-readiness-cohort-completed-v1',
        ):
            require_absent(directory, directory_descriptor, forbidden_name)
        claim_content = (claim_id + '\n').encode('ascii')
        player_descriptor, player_content = open_source(
            directory,
            directory_descriptor,
            player_path,
            identity(player_identity),
            b'',
            True,
        )
        if hashlib.sha256(player_content).hexdigest() != player_digest:
            reject()
        claim_descriptor, actual_claim_content = open_source(
            directory,
            directory_descriptor,
            claim_path,
            identity(claim_identity),
            claim_content,
            False,
        )
        if actual_claim_content != claim_content:
            reject()
        for descriptor, content in (
            (player_descriptor, player_content),
            (claim_descriptor, claim_content),
        ):
            os.fchown(descriptor, 10001, 10001)
            os.fchmod(descriptor, 0o400)
            os.fsync(descriptor)
            opened = os.fstat(descriptor)
            if (
                not stat.S_ISREG(opened.st_mode)
                or (opened.st_uid, opened.st_gid, exact_mode(opened), opened.st_nlink, opened.st_size)
                != (10001, 10001, 0o400, 1, len(content))
                or os.pread(descriptor, MAXIMUM_BYTES + 1, 0) != content
            ):
                reject()
        os.fsync(directory_descriptor)
        require_directory(directory, directory_descriptor)
        # Preserve the same recovery allowance after both restored inodes are durably synchronized.
        for forbidden_name in (
            '.kemerbet-readiness-player-ids.stage-v1.installing',
            '.kemerbet-readiness-cohort-claim.stage-v1.installing',
            '.kemerbet-readiness-cohort-completed-v1.installing',
            'kemerbet-readiness-cohort-completed-v1',
        ):
            require_absent(directory, directory_descriptor, forbidden_name)
        for path, expected_identity, expected_size in (
            (player_path, identity(player_identity), len(player_content)),
            (claim_path, identity(claim_identity), len(claim_content)),
        ):
            value = os.lstat(path)
            if (
                not stat.S_ISREG(value.st_mode)
                or (value.st_dev, value.st_ino) != expected_identity
                or (value.st_uid, value.st_gid, exact_mode(value), value.st_nlink, value.st_size)
                != (10001, 10001, 0o400, 1, expected_size)
            ):
                reject()
        if hashlib.sha256(
            os.pread(player_descriptor, len(player_content) + 1, 0)
        ).hexdigest() != player_digest:
            reject()
    finally:
        if claim_descriptor is not None:
            os.close(claim_descriptor)
        if player_descriptor is not None:
            os.close(player_descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 7:
        reject()
    restore(
        sys.argv[1],
        sys.argv[2],
        sys.argv[3],
        sys.argv[4],
        sys.argv[5],
        read_private_digest(sys.argv[6]),
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- || return 1
  return "$python_status"
}

consume_owner_staged_kemerbet_cohort() {
  local claim_source control_mountpoint digest_fd python_status source
  [[ "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" =~ ^[0-9]+:[0-9]+$ &&
    "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" =~ ^[0-9a-f]{64}$ ]] || return 1
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  source="$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME"
  claim_source="$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME"
  exec {digest_fd}<<<"$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" || return 1
  if env -i PATH="$SAFE_PATH" python3 -I - \
    "$source" "$claim_source" \
    "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
    "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" \
    "$digest_fd" <<'PY'
import hashlib
import os
import re
import stat
import sys

DEV_INO = re.compile(r'([0-9]+):([0-9]+)')
DIGEST = re.compile(r'[0-9a-f]{64}')


def reject():
    raise RuntimeError()


def read_private_digest(descriptor_text):
    if not descriptor_text.isascii() or not descriptor_text.isdecimal():
        reject()
    descriptor = int(descriptor_text, 10)
    if descriptor < 3 or descriptor > 1024:
        reject()
    try:
        content = os.read(descriptor, 66)
    finally:
        os.close(descriptor)
    if len(content) != 65 or not content.endswith(b'\n'):
        reject()
    try:
        value = content[:-1].decode('ascii')
    except UnicodeDecodeError:
        reject()
    if DIGEST.fullmatch(value) is None:
        reject()
    return value


def identity(value):
    match = DEV_INO.fullmatch(value)
    if match is None:
        reject()
    return int(match.group(1)), int(match.group(2))


def mode(value):
    return stat.S_IMODE(value.st_mode)


def require_directory(path, descriptor):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or (opened.st_uid, opened.st_gid, mode(opened)) != (10001, 10001, 0o700)
        or opened.st_mode != named.st_mode
        or opened.st_uid != named.st_uid
        or opened.st_gid != named.st_gid
        or os.path.realpath(path) != path
    ):
        reject()


def optional_file(directory, directory_descriptor, path, expected_identity, expected_size):
    name = os.path.basename(path)
    try:
        named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return None
        reject()
    absolute = os.lstat(path)
    if (
        not stat.S_ISREG(named.st_mode)
        or (named.st_dev, named.st_ino) != expected_identity
        or (absolute.st_dev, absolute.st_ino) != expected_identity
        or named.st_mode != absolute.st_mode
        or named.st_uid != absolute.st_uid
        or named.st_gid != absolute.st_gid
        or named.st_nlink != 1
        or absolute.st_nlink != 1
        or named.st_size != expected_size
        or absolute.st_size != expected_size
        or (named.st_uid, named.st_gid, mode(named)) != (0, 0, 0o444)
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    opened = os.fstat(descriptor)
    if (
        not stat.S_ISREG(opened.st_mode)
        or (opened.st_dev, opened.st_ino) != expected_identity
        or opened.st_mode != named.st_mode
        or opened.st_uid != named.st_uid
        or opened.st_gid != named.st_gid
        or opened.st_nlink != 1
        or opened.st_size != expected_size
    ):
        os.close(descriptor)
        reject()
    return name, path, descriptor, expected_identity, expected_size


def require_named(directory_descriptor, item):
    name, path, descriptor, expected_identity, expected_size = item
    named = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    absolute = os.lstat(path)
    opened = os.fstat(descriptor)
    for value in (named, absolute, opened):
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_dev, value.st_ino) != expected_identity
            or (value.st_uid, value.st_gid, mode(value), value.st_nlink, value.st_size)
            != (0, 0, 0o444, 1, expected_size)
        ):
            reject()


def require_absent(directory, directory_descriptor, path):
    name = os.path.basename(path)
    try:
        os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return
    reject()


def erase(descriptor, size):
    block = b'\0' * min(size, 1024)
    offset = 0
    while offset < size:
        length = min(len(block), size - offset)
        written = os.pwrite(descriptor, block[:length], offset)
        if written <= 0:
            reject()
        offset += written
    os.fsync(descriptor)


def consume(player_path, claim_path, player_identity, claim_identity, player_digest):
    if (
        os.path.basename(player_path) != 'kemerbet-readiness-player-ids.stage-v1'
        or os.path.basename(claim_path) != 'kemerbet-readiness-cohort-claim.stage-v1'
        or os.path.dirname(player_path) != os.path.dirname(claim_path)
        or player_identity == claim_identity
        or DIGEST.fullmatch(player_digest) is None
    ):
        reject()
    directory = os.path.dirname(player_path)
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    items = []
    try:
        require_directory(directory, directory_descriptor)
        player_size = None
        try:
            player_named = os.stat(
                os.path.basename(player_path),
                dir_fd=directory_descriptor,
                follow_symlinks=False,
            )
            player_size = player_named.st_size
        except FileNotFoundError:
            try:
                os.lstat(player_path)
            except FileNotFoundError:
                pass
            else:
                reject()
        if player_size is not None and not 10 <= player_size <= 1024:
            reject()
        player = (
            optional_file(
                directory,
                directory_descriptor,
                player_path,
                player_identity,
                player_size,
            )
            if player_size is not None
            else None
        )
        claim = optional_file(
            directory,
            directory_descriptor,
            claim_path,
            claim_identity,
            37,
        )
        items = [item for item in (player, claim) if item is not None]
        if player is not None:
            player_content = os.pread(player[2], player[4] + 1, 0)
            if (
                len(player_content) != player[4]
                or hashlib.sha256(player_content).hexdigest() != player_digest
            ):
                reject()
        for item in items:
            require_named(directory_descriptor, item)
        for item in items:
            os.unlink(item[0], dir_fd=directory_descriptor)
        os.fsync(directory_descriptor)
        require_directory(directory, directory_descriptor)
        require_absent(directory, directory_descriptor, player_path)
        require_absent(directory, directory_descriptor, claim_path)
        # Durable namespace removal is the recovery authority. Any best-effort wipe happens only
        # through the already-unlinked descriptors, so an interrupted wipe cannot leave a named,
        # partially modified stage file that fails its journaled content digest forever.
        for item in items:
            erase(item[2], item[4])
    finally:
        for item in items:
            os.close(item[2])
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 6:
        reject()
    consume(
        sys.argv[1],
        sys.argv[2],
        identity(sys.argv[3]),
        identity(sys.argv[4]),
        read_private_digest(sys.argv[5]),
    )
except Exception:
    raise SystemExit(1)
PY
  then
    python_status=0
  else
    python_status=$?
  fi
  exec {digest_fd}<&- || return 1
  [[ "$python_status" -eq 0 ]] || return 1
  [[ ! -e "$source" && ! -L "$source" && ! -e "$claim_source" && ! -L "$claim_source" ]] || return 1
  [[ ! -e "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" &&
    ! -e "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME" &&
    ! -L "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME" ]]
}

owner_kemerbet_cohort_marker() {
  local action="$1" claim_id="$2" installing_name marker_name
  case "$action" in
    publish-imported|require-imported|remove-imported)
      marker_name="$KEMERBET_OWNER_IMPORTED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME"
      ;;
    publish-completed|require-completed|remove-completed)
      marker_name="$KEMERBET_OWNER_COMPLETED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME"
      ;;
    publish-failed|require-failed|remove-failed)
      marker_name="$KEMERBET_OWNER_FAILED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"
      ;;
    guard-retry)
      marker_name="$KEMERBET_OWNER_FAILED_CLAIM_NAME"
      installing_name="$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"
      ;;
    *) return 1 ;;
  esac
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    return 1
  [[ $# -eq 2 ]] || return 1
  require_kemerbet_recovery_latch_authority || return 1
  require_owner_kemerbet_receipt_service_access || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$action" "$KEMERBET_OWNER_RECEIPT_ROOT/$marker_name" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$installing_name" "$claim_id" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" \
    "$KEMERBET_RECOVERY_LATCH_DEV_INO" <<'PY'
import os
import re
import stat
import sys

CLAIM_ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')
ALLOWED = {
    'kemerbet-readiness-cohort-imported-v1': '.kemerbet-readiness-cohort-imported-v1.installing',
    'kemerbet-readiness-cohort-completed-v1': '.kemerbet-readiness-cohort-completed-v1.installing',
    'kemerbet-readiness-cohort-failed-v1': '.kemerbet-readiness-cohort-failed-v1.installing',
}
LATCH_CONTENT = b"fetanagent-kemerbet-readiness-recovery-in-progress-or-failed-v1\n"
LATCH_NAME = 'kemerbet-readiness-recovery-in-progress-or-failed-v1'


def reject():
    raise RuntimeError()


def mode(value):
    return stat.S_IMODE(value.st_mode)


def require_directory(path, descriptor):
    opened = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISDIR(opened.st_mode)
        or not stat.S_ISDIR(named.st_mode)
        or (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
        or (opened.st_uid, opened.st_gid, mode(opened)) != (0, 0, 0o755)
        or named.st_mode != opened.st_mode
        or named.st_uid != opened.st_uid
        or named.st_gid != opened.st_gid
        or os.path.realpath(path) != path
    ):
        reject()


def optional(directory_descriptor, name, path):
    try:
        relative = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.lstat(path)
        except FileNotFoundError:
            return None
        reject()
    absolute = os.lstat(path)
    if (
        (relative.st_dev, relative.st_ino) != (absolute.st_dev, absolute.st_ino)
        or relative.st_mode != absolute.st_mode
        or relative.st_uid != absolute.st_uid
        or relative.st_gid != absolute.st_gid
        or relative.st_nlink != absolute.st_nlink
        or relative.st_size != absolute.st_size
    ):
        reject()
    return relative


def exact_marker(directory_descriptor, name, path, content, links=1):
    named = optional(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_uid, named.st_gid, mode(named), named.st_nlink, named.st_size)
        != (0, 10001, 0o440, links, len(content))
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != links
            or opened.st_size != len(content)
            or os.pread(descriptor, len(content) + 1, 0) != content
        ):
            reject()
        return opened.st_dev, opened.st_ino
    finally:
        os.close(descriptor)


def exact_installing_prefix(directory_descriptor, name, named, content):
    if (
        not stat.S_ISREG(named.st_mode)
        or named.st_nlink != 1
        or named.st_size > len(content)
        or (named.st_uid, named.st_gid, mode(named))
        not in {(0, 0, 0o600), (0, 10001, 0o600), (0, 10001, 0o440)}
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != named.st_nlink
            or opened.st_size != named.st_size
            or os.pread(descriptor, len(content) + 1, 0) != content[:named.st_size]
        ):
            reject()
    finally:
        os.close(descriptor)


def exact_recovery_latch(directory_descriptor, name, path, expected_dev_ino):
    named = optional(directory_descriptor, name, path)
    if (
        named is None
        or not stat.S_ISREG(named.st_mode)
        or (named.st_uid, named.st_gid, mode(named), named.st_nlink, named.st_size)
        != (0, 0, 0o400, 1, len(LATCH_CONTENT))
        or f"{named.st_dev}:{named.st_ino}" != expected_dev_ino
    ):
        reject()
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_descriptor,
    )
    try:
        opened = os.fstat(descriptor)
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_mode != named.st_mode
            or opened.st_uid != named.st_uid
            or opened.st_gid != named.st_gid
            or opened.st_nlink != 1
            or opened.st_size != len(LATCH_CONTENT)
            or os.pread(descriptor, len(LATCH_CONTENT) + 1, 0) != LATCH_CONTENT
        ):
            reject()
    finally:
        os.close(descriptor)


def write_all(descriptor, content):
    offset = 0
    while offset < len(content):
        written = os.write(descriptor, content[offset:])
        if written <= 0:
            reject()
        offset += written


def transition(action, marker_path, installing_path, claim_id, latch_path, latch_dev_ino):
    marker_name = os.path.basename(marker_path)
    installing_name = os.path.basename(installing_path)
    directory = os.path.dirname(marker_path)
    if (
        action not in {
            'publish-imported', 'require-imported', 'remove-imported',
            'publish-completed', 'require-completed', 'remove-completed',
            'publish-failed', 'require-failed', 'remove-failed',
            'guard-retry',
        }
        or ALLOWED.get(marker_name) != installing_name
        or os.path.dirname(installing_path) != directory
        or os.path.dirname(latch_path) != directory
        or os.path.basename(latch_path) != LATCH_NAME
        or CLAIM_ID.fullmatch(claim_id) is None
        or (action != 'guard-retry' and action.split('-', 1)[1] not in marker_name)
    ):
        reject()
    content = (claim_id + '\n').encode('ascii')
    directory_descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    installing_descriptor = None
    try:
        require_directory(directory, directory_descriptor)
        latch = optional(directory_descriptor, LATCH_NAME, latch_path)
        namespace = set(ALLOWED) | set(ALLOWED.values())
        if latch is None:
            if latch_dev_ino:
                reject()
        else:
            if re.fullmatch(r'[0-9]+:[0-9]+', latch_dev_ino) is None:
                reject()
            exact_recovery_latch(directory_descriptor, LATCH_NAME, latch_path, latch_dev_ino)
            namespace.add(LATCH_NAME)
        if any(entry not in namespace for entry in os.listdir(directory_descriptor)):
            reject()
        if action == 'guard-retry':
            observed = []
            for final_name, pending_name in ALLOWED.items():
                final_path = os.path.join(directory, final_name)
                pending_path = os.path.join(directory, pending_name)
                pending = optional(directory_descriptor, pending_name, pending_path)
                final = optional(directory_descriptor, final_name, final_path)
                if 'completed' in final_name and (pending is not None or final is not None):
                    reject()
                if pending is not None or final is not None:
                    observed.append((final_name, pending_name, final_path, pending_path, final, pending))
            if len(observed) > 1:
                reject()
            if observed:
                final_name, pending_name, final_path, pending_path, final, pending = observed[0]
                if pending is not None and final is not None:
                    if (
                        (pending.st_dev, pending.st_ino) != (final.st_dev, final.st_ino)
                        or pending.st_nlink != 2
                        or final.st_nlink != 2
                    ):
                        reject()
                    exact_marker(directory_descriptor, pending_name, pending_path, content, 2)
                    exact_marker(directory_descriptor, final_name, final_path, content, 2)
                elif pending is not None:
                    exact_installing_prefix(directory_descriptor, pending_name, pending, content)
                else:
                    exact_marker(directory_descriptor, final_name, final_path, content)
                if pending is not None:
                    os.unlink(pending_name, dir_fd=directory_descriptor)
                    os.fsync(directory_descriptor)
                    if optional(directory_descriptor, pending_name, pending_path) is not None:
                        reject()
                    final = optional(directory_descriptor, final_name, final_path)
                    if final is not None:
                        exact_marker(directory_descriptor, final_name, final_path, content)
            if latch is not None:
                exact_recovery_latch(
                    directory_descriptor,
                    LATCH_NAME,
                    latch_path,
                    latch_dev_ino,
                )
            if any(entry not in namespace for entry in os.listdir(directory_descriptor)):
                reject()
            require_directory(directory, directory_descriptor)
            return
        installing = optional(
            directory_descriptor,
            installing_name,
            installing_path,
        )
        marker = optional(directory_descriptor, marker_name, marker_path)
        verb = action.split('-', 1)[0]
        if installing is not None:
            if marker is not None:
                if (
                    (installing.st_dev, installing.st_ino) != (marker.st_dev, marker.st_ino)
                    or installing.st_nlink != 2
                    or marker.st_nlink != 2
                ):
                    reject()
                exact_marker(directory_descriptor, installing_name, installing_path, content, 2)
                exact_marker(directory_descriptor, marker_name, marker_path, content, 2)
                os.unlink(installing_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
                marker = optional(directory_descriptor, marker_name, marker_path)
            else:
                exact_installing_prefix(directory_descriptor, installing_name, installing, content)
                os.unlink(installing_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
        if verb == 'publish':
            for other_marker_name, other_installing_name in ALLOWED.items():
                if other_marker_name == marker_name:
                    continue
                other_marker_path = os.path.join(directory, other_marker_name)
                other_installing_path = os.path.join(directory, other_installing_name)
                if (
                    optional(
                        directory_descriptor,
                        other_marker_name,
                        other_marker_path,
                    )
                    is not None
                    or optional(
                        directory_descriptor,
                        other_installing_name,
                        other_installing_path,
                    )
                    is not None
                ):
                    reject()
        if verb == 'require':
            exact_marker(directory_descriptor, marker_name, marker_path, content)
        elif verb == 'remove':
            if marker is not None:
                exact_marker(directory_descriptor, marker_name, marker_path, content)
                os.unlink(marker_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
            if optional(directory_descriptor, marker_name, marker_path) is not None:
                reject()
        else:
            if marker is None:
                installing_descriptor = os.open(
                    installing_name,
                    os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                    0o600,
                    dir_fd=directory_descriptor,
                )
                write_all(installing_descriptor, content)
                os.fchown(installing_descriptor, 0, 10001)
                os.fchmod(installing_descriptor, 0o440)
                os.fsync(installing_descriptor)
                exact_marker(directory_descriptor, installing_name, installing_path, content)
                os.link(
                    installing_name,
                    marker_name,
                    src_dir_fd=directory_descriptor,
                    dst_dir_fd=directory_descriptor,
                    follow_symlinks=False,
                )
                os.fsync(directory_descriptor)
                exact_marker(directory_descriptor, installing_name, installing_path, content, 2)
                exact_marker(directory_descriptor, marker_name, marker_path, content, 2)
                os.unlink(installing_name, dir_fd=directory_descriptor)
                os.fsync(directory_descriptor)
            exact_marker(directory_descriptor, marker_name, marker_path, content)
        if optional(directory_descriptor, installing_name, installing_path) is not None:
            reject()
        if latch is not None:
            exact_recovery_latch(
                directory_descriptor,
                LATCH_NAME,
                latch_path,
                latch_dev_ino,
            )
        if any(entry not in namespace for entry in os.listdir(directory_descriptor)):
            reject()
        require_directory(directory, directory_descriptor)
    finally:
        if installing_descriptor is not None:
            os.close(installing_descriptor)
        os.close(directory_descriptor)


try:
    if len(sys.argv) != 7:
        reject()
    transition(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6])
except Exception:
    raise SystemExit(1)
PY
}

require_completed_owner_kemerbet_cohort_marker() {
  local claim_id control_mountpoint path
  control_mountpoint="$(resolve_kemerbet_session_control_volume_mountpoint)" || return 1
  path="$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_NAME"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$path")" == '0:10001:440:1:37' ]] ||
    die 'the completed Owner KemerBet cohort marker is absent or unsafe'
  IFS= read -r claim_id <"$path" || die 'the completed Owner KemerBet cohort claim could not be read'
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
    die 'the completed Owner KemerBet cohort claim is invalid'
  cmp -s -- "$path" <(printf '%s\n' "$claim_id") ||
    die 'the completed Owner KemerBet cohort marker content is not exact'
  owner_kemerbet_cohort_marker require-completed "$claim_id" ||
    die 'the completed Owner KemerBet cohort marker changed during inspection'
  for path in \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_PLAYER_IDS_INSTALLING_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_NAME" \
    "$control_mountpoint/$KEMERBET_OWNER_STAGED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$path" && ! -L "$path" ]] ||
      die 'the completed Owner KemerBet cohort retained a staging residue'
  done
  require_legacy_owner_kemerbet_receipt_paths_absent || return 1
  for path in \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_IMPORTED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_COMPLETED_CLAIM_INSTALLING_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_NAME" \
    "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_OWNER_FAILED_CLAIM_INSTALLING_NAME"; do
    [[ ! -e "$path" && ! -L "$path" ]] ||
      die 'the completed Owner KemerBet cohort retained a receipt residue'
  done
}

complete_owner_staged_kemerbet_cohort() {
  consume_owner_staged_kemerbet_cohort || return 1
  owner_kemerbet_cohort_marker remove-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker remove-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker publish-completed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker require-completed "$KEMERBET_RECHECK_OWNER_CLAIM_ID"
}

restore_retryable_owner_staged_kemerbet_cohort() {
  owner_kemerbet_cohort_marker guard-retry "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  restore_owner_staged_kemerbet_cohort || return 1
  owner_kemerbet_cohort_marker guard-retry "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker remove-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker publish-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" || return 1
  owner_kemerbet_cohort_marker require-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID"
}

resolve_kemerbet_profile_volume_mountpoint() {
  local mountpoint volume_name
  volume_name="$(docker_local volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.volume=kemerbet_sessions')" ||
    die 'the KemerBet profile volume inventory could not be inspected'
  [[ "$volume_name" == "$KEMERBET_PROFILE_VOLUME" ]] ||
    die 'the KemerBet profile volume identity is not exact'
  [[ "$(docker_local volume inspect "$volume_name" \
    --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}')" == \
    "$KEMERBET_PROFILE_VOLUME|local|local|$PROJECT_NAME|kemerbet_sessions" ]] ||
    die 'the KemerBet profile volume contract is not exact'
  mountpoint="$(docker_local volume inspect "$volume_name" --format '{{.Mountpoint}}')" ||
    die 'the KemerBet profile volume mountpoint could not be inspected'
  [[ "$mountpoint" == /* && ! -L "$mountpoint" && -d "$mountpoint" ]] ||
    die 'the KemerBet profile volume mountpoint is unsafe'
  [[ "$(realpath -- "$mountpoint")" == "$mountpoint" ]] ||
    die 'the KemerBet profile volume mountpoint is not canonical'
  [[ "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] ||
    die 'the KemerBet profile volume root ownership or mode is unsafe'
  printf '%s' "$mountpoint"
}

kemerbet_profile_volume_holders_match() {
  local expected_container_id="$1" holders
  holders="$(docker_local container ls --all --quiet --filter "volume=$KEMERBET_PROFILE_VOLUME")" ||
    return 1
  [[ "$holders" == "$expected_container_id" ]]
}

require_kemerbet_profile_volume_holders() {
  kemerbet_profile_volume_holders_match "$1" ||
    die 'the KemerBet profile volume has an unexpected concurrent holder'
}

kemerbet_profile_identity_digest() {
  [[ $# -eq 3 ]] || die 'the KemerBet profile singleton policy is invalid'
  local account_id="$1" mountpoint="$2" singleton_policy="$3"
  local digest mountpoint_stat profile_path profile_stat root_entries singleton singleton_path
  local singleton_stat
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ &&
    "$account_id" != '00000000-0000-0000-0000-000000000000' ]] ||
    die 'the KemerBet profile account identity is invalid'
  case "$singleton_policy" in
    allow-exact-stale-singletons) require_kemerbet_profile_volume_holders '' || return 1 ;;
    require-absent-singletons) ;;
    *) die 'the KemerBet profile singleton policy is invalid' ;;
  esac
  profile_path="$mountpoint/$account_id"
  [[ ! -L "$profile_path" && -d "$profile_path" ]] ||
    die 'the exact KemerBet profile is absent or symbolic'
  [[ "$(realpath -- "$profile_path")" == "$profile_path" ]] ||
    die 'the exact KemerBet profile is not canonical'
  [[ "$(stat --format='%u:%g:%a' "$profile_path")" == '10001:10001:700' ]] ||
    die 'the exact KemerBet profile ownership or mode is unsafe'
  root_entries="$(find -P "$mountpoint" -mindepth 1 -maxdepth 1 -printf '%f\n')" ||
    die 'the KemerBet profile root could not be inspected'
  [[ "$root_entries" == "$account_id" ]] || die 'the KemerBet profile root is not exact'
  for singleton in SingletonCookie SingletonLock SingletonSocket; do
    singleton_path="$profile_path/$singleton"
    if [[ ! -e "$singleton_path" && ! -L "$singleton_path" ]]; then
      continue
    fi
    [[ "$singleton_policy" == 'allow-exact-stale-singletons' && -L "$singleton_path" ]] ||
      die 'the KemerBet profile retains an active or unsafe Chromium singleton artifact'
    singleton_stat="$(stat --format='%u:%g:%a:%h' -- "$singleton_path")" ||
      die 'the KemerBet profile singleton metadata could not be inspected'
    [[ "$singleton_stat" == '10001:10001:777:1' ]] ||
      die 'the KemerBet profile singleton metadata is unsafe'
  done
  mountpoint_stat="$(stat --format='%d:%i:%u:%g:%a' "$mountpoint")" || return 1
  profile_stat="$(stat --format='%d:%i:%u:%g:%a' "$profile_path")" || return 1
  digest="$(printf 'volume=%s\nroot=%s\nprofile=%s\naccount=%s\n' \
    "$KEMERBET_PROFILE_VOLUME" \
    "$mountpoint_stat" \
    "$profile_stat" \
    "$account_id" | sha256sum | awk '{print $1}')" || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$digest"
}

require_kemerbet_recheck_container_contract() {
  local container_id="$1" commit_sha="$2" image_tag="$3" image_id="$4"
  local actual_environment expected_environment image_environment mount_contract network_contract
  local tmpfs_contract
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ && "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die 'the KemerBet recheck container or image identity is invalid'
  [[ "$(docker_local container inspect "$container_id" --format '{{.Name}}')" == "/$KEMERBET_RECHECK_CONTAINER" ]] ||
    die 'the KemerBet recheck container name is not exact'
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == \
    "$PROJECT_NAME|kemerbet-no-transfer-readiness|$commit_sha" ]] ||
    die 'the KemerBet recheck container labels are not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.State.Status}}')" == 'created' ]] ||
    die 'the KemerBet recheck container was started before inspection'
  [[ "$(docker_local container inspect "$container_id" --format '{{.Image}}')" == "$image_id" ]] ||
    die 'the KemerBet recheck container image identity changed'
  [[ "$(docker_local container inspect "$container_id" --format '{{.Config.Image}}')" == \
    "fetanagent-deposit-executor:$image_tag" ]] || die 'the KemerBet recheck image reference is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.Config.User}}')" == '10001:10001' ]] ||
    die 'the KemerBet recheck user is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .Config.Cmd}}')" == \
    '["node","apps/executor/dist/kemerbet-no-transfer-readiness.js"]' ]] ||
    die 'the KemerBet recheck command is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.Config.OpenStdin}}|{{.Config.Tty}}')" == \
    'false|false' ]] || die 'the KemerBet recheck terminal contract is unsafe'
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Privileged}}|{{.HostConfig.AutoRemove}}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.RestartPolicy.MaximumRetryCount}}')" == \
    'true|false|false|no|0' ]] || die 'the KemerBet recheck host isolation contract is unsafe'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.Init}}')" == 'true' ]] ||
    die 'the KemerBet recheck init process is not enabled'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapAdd}}')" == 'null' ]] ||
    die 'the KemerBet recheck container adds a Linux capability'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapDrop}}')" == '["ALL"]' ]] ||
    die 'the KemerBet recheck container does not drop every Linux capability'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.SecurityOpt}}')" == \
    '["no-new-privileges:true"]' ]] || die 'the KemerBet recheck permits privilege escalation'
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{.HostConfig.PidsLimit}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.ShmSize}}')" == \
    '512|1610612736|2000000000|536870912' ]] ||
    die 'the KemerBet recheck resource limits are not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.PortBindings}}')" == '{}' ]] ||
    die 'the KemerBet recheck publishes a port'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .Config.ExposedPorts}}')" == 'null' ]] ||
    die 'the KemerBet recheck image exposes a port'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.LogConfig.Type}}')" == 'none' ]] ||
    die 'the KemerBet recheck log driver is not disabled'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .Config.Healthcheck.Test}}')" == \
    '["NONE"]' ]] || die 'the KemerBet recheck healthcheck is not disabled'
  tmpfs_contract="$(docker_local container inspect "$container_id" --format '{{index .HostConfig.Tmpfs "/tmp"}}')"
  [[ "$(tr ',' '\n' <<<"$tmpfs_contract" | LC_ALL=C sort)" == \
    $'mode=1777\nnodev\nnoexec\nnosuid\nrw\nsize=268435456' ]] ||
    die 'the KemerBet recheck temporary filesystem contract is not exact'

  image_environment="$(docker_local image inspect "$image_id" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
    die 'the KemerBet recheck image environment could not be inspected'
  expected_environment="$({
    grep -Ev '^(NODE_ENV|FINANCIAL_ACTIONS_MODE|KEMERBET_NO_TRANSFER_READINESS_ENABLED|KEMERBET_EXECUTOR_ENABLED|KEMERBET_FINAL_ACTION_ENABLED|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED)=' \
      <<<"$image_environment" || true
    printf '%s\n' \
      'NODE_ENV=production' \
      'FINANCIAL_ACTIONS_MODE=dry_run' \
      'KEMERBET_NO_TRANSFER_READINESS_ENABLED=true' \
      'KEMERBET_EXECUTOR_ENABLED=false' \
      'KEMERBET_FINAL_ACTION_ENABLED=false' \
      'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
      'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false'
  } | LC_ALL=C sort)"
  # Capture the Docker template output before sorting it. The CLI appends its own
  # newline after the template, while each `println` already emits one; piping
  # that double terminator directly into sort manufactures a leading empty
  # record that is not part of Config.Env.
  actual_environment="$(docker_local container inspect "$container_id" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
    die 'the KemerBet recheck environment could not be inspected'
  actual_environment="$(LC_ALL=C sort <<<"$actual_environment")" ||
    die 'the KemerBet recheck environment could not be normalized'
  [[ "$actual_environment" == "$expected_environment" ]] ||
    die 'the KemerBet recheck environment is not exact'

  mount_contract="$(docker_local container inspect "$container_id" --format \
    '{{range .Mounts}}{{if eq .Type "volume"}}{{printf "%s|%s|%s|%t\n" .Type .Name .Destination .RW}}{{else}}{{printf "%s|%s|%s|%t\n" .Type .Source .Destination .RW}}{{end}}{{end}}')" ||
    die 'the KemerBet recheck mount contract could not be inspected'
  mount_contract="$(LC_ALL=C sort <<<"$mount_contract")" ||
    die 'the KemerBet recheck mount contract could not be normalized'
  [[ "$mount_contract" == "$(printf '%s\n' \
    "bind|$KEMERBET_RECHECK_CANDIDATE_BINDING|/run/secrets/kemerbet_agent_identity_bindings|false" \
    "bind|$KEMERBET_AGENT_IDENTITY_HMAC_KEY|/run/secrets/kemerbet_agent_identity_hmac_key|false" \
    "bind|$KEMERBET_READINESS_PLAYER_IDS|/run/secrets/kemerbet_no_transfer_readiness_player_ids|false" \
    "bind|$KEMERBET_SELECTOR_CONTRACT|/etc/fetanagent/kemerbet-selector-contract.v2.json|false" \
    "volume|$KEMERBET_PROFILE_VOLUME|/var/lib/fetanagent/kemerbet-sessions|true" | LC_ALL=C sort)" ]] ||
    die 'the KemerBet recheck mount contract is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.NetworkMode}}')" == \
    "$KEMERBET_RECHECK_NETWORK" ]] || die 'the KemerBet recheck network mode is not exact'
  network_contract="$(docker_local network inspect "$KEMERBET_RECHECK_NETWORK" \
    --format '{{.Name}}|{{.Driver}}|{{.Internal}}|{{.Attachable}}|{{.EnableIPv6}}|{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.network" }}')" ||
    die 'the KemerBet recheck network contract could not be inspected'
  [[ "$network_contract" == \
    "$KEMERBET_RECHECK_NETWORK|bridge|false|false|true|$PROJECT_NAME|kemerbet_readiness_egress" ]] ||
    die 'the KemerBet recheck network contract is not exact'
  [[ "$(docker_local container inspect "$container_id" \
    --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}')" == \
    "$KEMERBET_RECHECK_NETWORK" ]] || die 'the KemerBet recheck network attachment is not singular'
}

remove_project_runtime_best_effort() {
  local cleanup_status=0 containers='' networks='' remaining=''
  if ! containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$containers" ]]; then
    # Container identifiers returned by Docker contain only hexadecimal characters and newlines.
    docker_local container rm --force $containers >/dev/null || cleanup_status=1
  fi
  if ! networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$networks" ]]; then
    # Network identifiers returned by Docker contain only hexadecimal characters and newlines.
    docker_local network rm $networks >/dev/null || cleanup_status=1
  fi
  if ! remaining="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$remaining" ]]; then
    cleanup_status=1
  fi
  if ! remaining="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")"; then
    cleanup_status=1
  elif [[ -n "$remaining" ]]; then
    cleanup_status=1
  fi
  return "$cleanup_status"
}

remove_staging_runtime_secrets_best_effort() {
  local cleanup_status=0 secret_path
  local -a secret_paths=(
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
  for secret_path in "${secret_paths[@]}"; do
    rm -f -- "$secret_path" || cleanup_status=1
  done
  ( clear_bot_startup_receipt ) || cleanup_status=1
  for secret_path in "${secret_paths[@]}"; do
    [[ ! -e "$secret_path" && ! -L "$secret_path" ]] || cleanup_status=1
  done
  [[ ! -e "$BOT_STARTUP_RECEIPT" && ! -L "$BOT_STARTUP_RECEIPT" &&
    ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] || cleanup_status=1
  return "$cleanup_status"
}

stop_project_runtime_only() {
  remove_project_runtime_best_effort ||
    die 'the exact staging project runtime could not be removed completely'
}

stop_project() {
  stop_project_runtime_only
  remove_staging_runtime_secrets_best_effort ||
    die 'the disposable staging credentials or bot receipt could not be removed completely'
}

emergency_stop_project_after_kemerbet_recovery_failure() {
  local cleanup_status=0
  remove_project_runtime_best_effort || cleanup_status=1
  remove_staging_runtime_secrets_best_effort || cleanup_status=1
  return "$cleanup_status"
}

emergency_disarm_expiry_stop_after_kemerbet_recovery_failure() {
  local cleanup_status=0 timer_load_state=''
  if command -v systemctl >/dev/null 2>&1; then
    if timer_load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)"; then
      if [[ "$timer_load_state" != 'not-found' && -n "$timer_load_state" ]]; then
        systemctl disable --now "$EXPIRY_STOP_TIMER" >/dev/null || cleanup_status=1
      fi
    else
      cleanup_status=1
    fi
  else
    cleanup_status=1
  fi
  rm -f -- "$EXPIRY_STOP_TIMER_PATH" "$EXPIRY_STOP_SERVICE_PATH" || cleanup_status=1
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || cleanup_status=1
    if timer_load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null)"; then
      [[ "$timer_load_state" == 'not-found' ]] || cleanup_status=1
    else
      cleanup_status=1
    fi
  fi
  return "$cleanup_status"
}

disarm_expiry_stop() {
  local timer_load_state

  command -v systemctl >/dev/null 2>&1 || die 'systemctl is unavailable'
  timer_load_state="$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null || true)"
  if [[ "$timer_load_state" != 'not-found' && -n "$timer_load_state" ]]; then
    systemctl disable --now "$EXPIRY_STOP_TIMER" >/dev/null ||
      die 'the staging runtime expiry-stop timer could not be disabled'
  fi
  rm -f -- "$EXPIRY_STOP_TIMER_PATH" "$EXPIRY_STOP_SERVICE_PATH"
  systemctl daemon-reload || die 'systemd could not reload after removing the expiry-stop timer'
  [[ "$(systemctl show --property=LoadState --value "$EXPIRY_STOP_TIMER" 2>/dev/null || true)" == 'not-found' ]] ||
    die 'the staging runtime expiry-stop timer remains loaded'
}

arm_expiry_stop() (
  local calendar_stop_at commit_sha compose_file now_epoch stop_at stop_epoch temp_dir

  commit_sha="$1"
  stop_at="$2"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'arm-expiry-stop requires a reviewed 40-character commit'
  [[ "$stop_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    die 'arm-expiry-stop requires one canonical UTC stop time'
  stop_epoch="$(date -u -d "$stop_at" +%s)" || die 'the expiry-stop time is invalid'
  [[ "$(date -u -d "@$stop_epoch" '+%Y-%m-%dT%H:%M:%SZ')" == "$stop_at" ]] ||
    die 'the expiry-stop time is not canonical UTC'
  now_epoch="$(date -u +%s)"
  (( stop_epoch > now_epoch + 21 * 60 * 60 )) ||
    die 'the expiry-stop time does not retain the required lower safety bound'
  (( stop_epoch <= now_epoch + 23 * 60 * 60 )) ||
    die 'the expiry-stop time exceeds the required upper safety bound'

  compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
  [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
    die 'the sealed Compose contract is absent or unsafe before arming expiry-stop'

  command -v systemctl >/dev/null 2>&1 || die 'systemctl is unavailable'
  command -v mktemp >/dev/null 2>&1 || die 'mktemp is unavailable'
  temp_dir="$(mktemp -d /run/fetanagent-expiry-stop.XXXXXX)" ||
    die 'the expiry-stop unit staging directory could not be created'
  trap 'rm -rf -- "$temp_dir"' EXIT
  calendar_stop_at="${stop_at/T/ }"
  calendar_stop_at="${calendar_stop_at/Z/ UTC}"

  cat >"$temp_dir/$EXPIRY_STOP_SERVICE" <<EOF
[Unit]
Description=Stop FetanAgent staging before disposable database credentials expire
StartLimitIntervalSec=0

[Service]
Type=oneshot
Environment=FETANAGENT_STAGING_EXPIRY_GUARD=1
ExecStart=$HELPER_PATH expiry-stop
Restart=on-failure
RestartSec=60
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
EOF
  cat >"$temp_dir/$EXPIRY_STOP_TIMER" <<EOF
[Unit]
Description=FetanAgent staging disposable-credential expiry guard

[Timer]
OnCalendar=$calendar_stop_at
AccuracySec=1min
Persistent=true
Unit=$EXPIRY_STOP_SERVICE

[Install]
WantedBy=timers.target
EOF

  disarm_expiry_stop
  install -o root -g root -m 0644 \
    "$temp_dir/$EXPIRY_STOP_SERVICE" "$EXPIRY_STOP_SERVICE_PATH"
  install -o root -g root -m 0644 \
    "$temp_dir/$EXPIRY_STOP_TIMER" "$EXPIRY_STOP_TIMER_PATH"
  systemctl daemon-reload || die 'systemd could not load the expiry-stop units'
  systemctl enable --now "$EXPIRY_STOP_TIMER" >/dev/null ||
    die 'the staging runtime expiry-stop timer could not be enabled'
  systemctl is-enabled --quiet "$EXPIRY_STOP_TIMER" ||
    die 'the staging runtime expiry-stop timer is not enabled'
  systemctl is-active --quiet "$EXPIRY_STOP_TIMER" ||
    die 'the staging runtime expiry-stop timer is not active'
  [[ "$(stat --format='%U:%G:%a' "$EXPIRY_STOP_SERVICE_PATH")" == 'root:root:644' ]] ||
    die 'the expiry-stop service ownership or mode is unsafe'
  [[ "$(stat --format='%U:%G:%a' "$EXPIRY_STOP_TIMER_PATH")" == 'root:root:644' ]] ||
    die 'the expiry-stop timer ownership or mode is unsafe'
)

require_cutover_ready() {
  local legacy_containers legacy_networks legacy_secret_residue
  local systemd_units systemd_unit_files

  command -v docker >/dev/null 2>&1 || die 'Docker is unavailable'
  command -v systemctl >/dev/null 2>&1 || die 'systemctl is unavailable'
  command -v find >/dev/null 2>&1 || die 'the find utility is unavailable'
  command -v grep >/dev/null 2>&1 || die 'the grep utility is unavailable'

  if ! legacy_containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT_NAME")"; then
    die 'the legacy container inventory could not be inspected'
  fi
  [[ -z "$legacy_containers" ]] || die 'legacy project containers remain'

  if ! legacy_networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT_NAME")"; then
    die 'the legacy network inventory could not be inspected'
  fi
  [[ -z "$legacy_networks" ]] || die 'legacy project networks remain'

  if ! systemd_units="$(systemctl list-units --all --full --plain --no-legend --no-pager)"; then
    die 'the loaded systemd unit inventory could not be inspected'
  fi
  if grep -Fiq -- "$LEGACY_SYSTEMD_MARKER" <<<"$systemd_units"; then
    die 'a legacy systemd unit remains loaded'
  fi

  if ! systemd_unit_files="$(systemctl list-unit-files --full --no-legend --no-pager)"; then
    die 'the installed systemd unit inventory could not be inspected'
  fi
  if grep -Fiq -- "$LEGACY_SYSTEMD_MARKER" <<<"$systemd_unit_files"; then
    die 'a legacy systemd unit file remains installed'
  fi

  if [[ -L "$LEGACY_SECRET_ROOT" ]]; then
    die 'the legacy secret root remains as a symbolic link'
  fi
  if [[ -e "$LEGACY_SECRET_ROOT" ]]; then
    [[ -d "$LEGACY_SECRET_ROOT" ]] || die 'the legacy secret root is not a directory'
    if ! legacy_secret_residue="$(find "$LEGACY_SECRET_ROOT" -mindepth 1 -print -quit)"; then
      die 'the legacy secret root could not be inspected'
    fi
    [[ -z "$legacy_secret_residue" ]] || die 'legacy secret files remain'
  fi
}

require_port_3002_free() {
  local socket_inventory
  command -v awk >/dev/null 2>&1 || die 'the awk utility is unavailable'
  command -v ss >/dev/null 2>&1 || die 'the ss utility is unavailable'
  if ! socket_inventory="$(ss -ltnH)"; then
    die 'the TCP listener inventory could not be inspected'
  fi
  if awk '$4 ~ /:3002$/ { found = 1 } END { exit !found }' <<<"$socket_inventory"; then
    die 'TCP port 3002 is already in use'
  fi
}

require_reviewed_owner_port_3002() {
  local commit_sha="$1"
  local exact_listener_count owner_binding owner_container port_listener_count socket_inventory

  command -v awk >/dev/null 2>&1 || die 'the awk utility is unavailable'
  command -v docker >/dev/null 2>&1 || die 'Docker is unavailable'
  command -v ss >/dev/null 2>&1 || die 'the ss utility is unavailable'

  owner_container="$(docker_local container ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control' \
    --filter 'health=healthy')"
  [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the reviewed Owner-control container is not healthy'
  [[ "$(docker_local image inspect \
    "$(docker_local container inspect "$owner_container" --format '{{.Image}}')" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
    die 'the reviewed Owner-control image does not match the requested commit'
  if ! owner_binding="$(docker_local container port "$owner_container" '3002/tcp')"; then
    die 'the reviewed Owner-control port binding could not be inspected'
  fi
  [[ "$owner_binding" == '127.0.0.1:3002' ]] ||
    die 'the reviewed Owner-control port binding is not exact'

  if ! socket_inventory="$(ss -ltnH)"; then
    die 'the TCP listener inventory could not be inspected'
  fi
  port_listener_count="$(awk '$4 ~ /:3002$/ { count += 1 } END { print count + 0 }' \
    <<<"$socket_inventory")"
  exact_listener_count="$(awk '$4 == "127.0.0.1:3002" { count += 1 } END { print count + 0 }' \
    <<<"$socket_inventory")"
  [[ "$port_listener_count" == '1' && "$exact_listener_count" == '1' ]] ||
    die 'TCP port 3002 has an unexpected or ambiguous listener'
}

require_exact_private_runtime() {
  local commit_sha="$1"
  local container_id health ids revision service services state
  local -a expected_services=(api beta-admission bot customer-web owner-control)

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the private FetanAgent service inventory could not be inspected'
  [[ "$services" == $'api\nbeta-admission\nbot\ncustomer-web\nowner-control' ]] ||
    die 'the private FetanAgent service set is not exact'

  for service in "${expected_services[@]}"; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ||
      die "the $service container inventory could not be inspected"
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] || die "the $service container inventory is not singular"
    state="$(docker_local container inspect "$ids" --format '{{.State.Status}}')"
    [[ "$state" == 'running' ]] || die "$service is not running"
    revision="$(docker_local container inspect "$ids" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$revision" == "$commit_sha" ]] || die "$service does not run the reviewed commit"
    if [[ "$service" != 'bot' ]]; then
      health="$(docker_local container inspect "$ids" --format '{{.State.Health.Status}}')"
      [[ "$health" == 'healthy' ]] || die "$service is not healthy"
    fi
  done

  require_reviewed_owner_port_3002 "$commit_sha"
}

require_live_api_runtime_contract() {
  local container_id="$1"
  local runtime_contract

  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the live API runtime-contract container identity is malformed'
  runtime_contract="$(docker_local container exec "$container_id" \
    node --input-type=module --eval '
      try {
        const response = await fetch("http://127.0.0.1:3000/healthz", {
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        });
        const contentType = response.headers.get("content-type");
        if (response.status !== 200 || !contentType?.startsWith("application/json")) {
          process.exit(22);
        }
        const health = await response.json();
        const runtimeContract = health.runtimeContract;
        if (
          health.status !== "ok" ||
          health.service !== "fetanagent-api" ||
          runtimeContract.financialActionsMode !== "dry_run" ||
          runtimeContract.playerActionRuntimeEnabled !== true ||
          runtimeContract.depositProofReferenceMastersConfigured !== true ||
          runtimeContract.depositProofReferenceProfileVersion !== 2
        ) {
          process.exit(23);
        }
        process.stdout.write(JSON.stringify(runtimeContract));
      } catch {
        process.exit(24);
      }
    ')" || die 'the live API runtime contract could not be evaluated'
  [[ "$runtime_contract" == \
    '{"financialActionsMode":"dry_run","playerActionRuntimeEnabled":true,"depositProofReferenceMastersConfigured":true,"depositProofReferenceProfileVersion":2}' ]] ||
    die 'the live API runtime contract is not the exact reviewed dry-run profile'
}

record_fresh_bot_startup_receipt() {
  local commit_sha="$1"
  local container_id container_started_at full_container_id restart_count revision temporary

  container_id="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=bot')" ||
    die 'the Telegram startup-receipt container inventory could not be inspected'
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the Telegram startup-receipt container inventory is not singular'
  full_container_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" ||
    die 'the Telegram startup-receipt container identity could not be inspected'
  [[ "$full_container_id" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the Telegram startup-receipt container identity is malformed'
  container_started_at="$(docker_local container inspect "$container_id" --format '{{.State.StartedAt}}')" ||
    die 'the Telegram startup-receipt start time could not be inspected'
  [[ "$container_started_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] ||
    die 'the Telegram startup-receipt start time is not canonical UTC'
  revision="$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" ||
    die 'the Telegram startup-receipt revision could not be inspected'
  [[ "$revision" == "$commit_sha" ]] ||
    die 'the Telegram startup-receipt container does not run the reviewed commit'
  [[ "$(docker_local container inspect "$container_id" --format '{{.State.Status}}')" == 'running' ]] ||
    die 'the Telegram startup-receipt container is not running'
  restart_count="$(docker_local container inspect "$container_id" --format '{{.RestartCount}}')" ||
    die 'the Telegram startup-receipt restart count could not be inspected'
  [[ "$restart_count" == '0' ]] ||
    die 'the Telegram startup-receipt container restarted unexpectedly'
  docker_local container logs --tail 80 "$container_id" 2>&1 |
    grep -Fq 'Telegram bot started with configured private admission and action handlers.' ||
    die 'the Telegram startup-receipt container did not report its genuine startup contract'

  [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'a Telegram startup receipt already exists before immediate attestation'
  install -d -o root -g root -m 0700 "$BOT_STARTUP_RECEIPT_ROOT"
  temporary="$(mktemp "$BOT_STARTUP_RECEIPT_ROOT/.bot-v1.XXXXXX")" ||
    die 'the Telegram startup-receipt temporary file could not be created'
  if ! printf '%s\n' \
      "receipt_version=$BOT_STARTUP_RECEIPT_VERSION" \
      "commit_sha=$commit_sha" \
      "container_id=$full_container_id" \
      "container_started_at=$container_started_at" \
      'restart_count=0' \
      'startup_contract=telegram-private-admission-actions-v1' >"$temporary" ||
    ! chown root:root "$temporary" ||
    ! chmod 0600 "$temporary" ||
    ! mv -fT -- "$temporary" "$BOT_STARTUP_RECEIPT"; then
    rm -f -- "$temporary"
    die 'the Telegram startup receipt could not be sealed atomically'
  fi
}

require_fresh_bot_startup_receipt() {
  local commit_sha="$1"
  local container_id="$2"
  local container_started_at full_container_id restart_count

  command -v cmp >/dev/null 2>&1 || die 'cmp is unavailable for Telegram startup receipt'
  [[ ! -L "$BOT_STARTUP_RECEIPT_ROOT" && -d "$BOT_STARTUP_RECEIPT_ROOT" ]] ||
    die 'the Telegram startup-receipt root is absent or unsafe'
  [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT_ROOT")" == 'root:root:700' ]] ||
    die 'the Telegram startup-receipt root ownership or mode is unsafe'
  [[ ! -L "$BOT_STARTUP_RECEIPT" && -f "$BOT_STARTUP_RECEIPT" ]] ||
    die 'the Telegram startup receipt is absent or unsafe'
  [[ "$(stat --format='%U:%G:%a' "$BOT_STARTUP_RECEIPT")" == 'root:root:600' ]] ||
    die 'the Telegram startup receipt ownership or mode is unsafe'
  full_container_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" ||
    die 'the receipted Telegram container identity could not be inspected'
  [[ "$full_container_id" =~ ^[0-9a-f]{64}$ ]] ||
    die 'the receipted Telegram container identity is malformed'
  container_started_at="$(docker_local container inspect "$container_id" --format '{{.State.StartedAt}}')" ||
    die 'the receipted Telegram start time could not be inspected'
  restart_count="$(docker_local container inspect "$container_id" --format '{{.RestartCount}}')" ||
    die 'the receipted Telegram restart count could not be inspected'
  [[ "$restart_count" == '0' ]] || die 'the receipted Telegram bot restarted unexpectedly'
  cmp -s -- "$BOT_STARTUP_RECEIPT" <(printf '%s\n' \
    "receipt_version=$BOT_STARTUP_RECEIPT_VERSION" \
    "commit_sha=$commit_sha" \
    "container_id=$full_container_id" \
    "container_started_at=$container_started_at" \
    'restart_count=0' \
    'startup_contract=telegram-private-admission-actions-v1') ||
    die 'the Telegram startup receipt does not match this exact running container'
}

require_exact_fresh_private_runtime() {
  local commit_sha="$1"
  local container_id environment forbidden_environment health ids revision service services state
  local expected_environment
  local -a expected_services=(api beta-admission customer-web owner-control)

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the fresh-host private FetanAgent service inventory could not be inspected'
  [[ "$services" == $'api\nbeta-admission\ncustomer-web\nowner-control' ]] ||
    die 'the fresh-host private FetanAgent service set is not exact'

  for service in "${expected_services[@]}"; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ||
      die "the fresh-host $service container inventory could not be inspected"
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] ||
      die "the fresh-host $service container inventory is not singular"
    state="$(docker_local container inspect "$ids" --format '{{.State.Status}}')"
    [[ "$state" == 'running' ]] || die "the fresh-host $service service is not running"
    health="$(docker_local container inspect "$ids" --format '{{.State.Health.Status}}')"
    [[ "$health" == 'healthy' ]] || die "the fresh-host $service service is not healthy"
    revision="$(docker_local container inspect "$ids" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$revision" == "$commit_sha" ]] ||
      die "the fresh-host $service service does not run the reviewed commit"

    environment="$(docker_local container inspect "$ids" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
      die "the fresh-host $service environment could not be inspected"
    for expected_environment in \
      'NODE_ENV=production' \
      'FINANCIAL_ACTIONS_MODE=dry_run' \
      'TELEGRAM_BOT_ENABLED=false' \
      'TELEGRAM_BETA_ADMISSION_ENABLED=false' \
      'KEMERBET_EXECUTOR_ENABLED=false' \
      'KEMERBET_FINAL_ACTION_ENABLED=false'; do
      grep -Fxq "$expected_environment" <<<"$environment" ||
        die "the fresh-host $service safety environment is not exact"
    done
    if [[ "$service" == 'customer-web' ]]; then
      for expected_environment in \
        'INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false' \
        'INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true' \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json' \
        'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host customer-web capability environment is not exact'
      done
    fi
    if [[ "$service" == 'api' ]]; then
      for expected_environment in \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host API provider-proof v2 environment is not exact'
      done
      require_live_api_runtime_contract "$ids"
    fi
    if [[ "$service" == 'api' || "$service" == 'customer-web' ]]; then
      for forbidden_environment in \
        DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_PROFILE; do
        ! grep -Eq "^${forbidden_environment}=" <<<"$environment" ||
          die "the fresh-host $service provider-proof v2 material is exposed inline"
      done
    else
      ! grep -Eq '^(DEPOSIT_PROOF_REFERENCE_|INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=)' \
        <<<"$environment" ||
        die "the fresh-host $service unexpectedly receives the provider-proof v2 contract"
    fi
  done

  require_reviewed_owner_port_3002 "$commit_sha"
}

require_exact_fresh_bot_runtime() {
  local commit_sha="$1"
  local startup_contract_mode="$2"
  local container_id environment forbidden_environment health ids restart_count revision service services state
  local expected_environment
  local gateway_container gateway_health gateway_restart gateway_revision services_contract
  local -a expected_services=(api beta-admission bot customer-web owner-control)

  [[ "$startup_contract_mode" == 'immediate-startup' || "$startup_contract_mode" == 'steady-state' ||
    "$startup_contract_mode" == 'published-steady-state' ||
    "$startup_contract_mode" == 'published-with-kemerbet-session' ]] ||
    die 'the fresh-host Telegram startup-contract mode is invalid'

  if [[ "$startup_contract_mode" == 'published-with-kemerbet-session' ]]; then
    services_contract=$'api\nbeta-admission\nbot\ncustomer-web\ngateway\nkemerbet-session-provision\nowner-control'
  elif [[ "$startup_contract_mode" == 'published-steady-state' ]]; then
    services_contract=$'api\nbeta-admission\nbot\ncustomer-web\ngateway\nowner-control'
  else
    services_contract=$'api\nbeta-admission\nbot\ncustomer-web\nowner-control'
  fi

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the fresh-host Telegram service inventory could not be inspected'
  [[ "$services" == "$services_contract" ]] ||
    die 'the fresh-host Telegram service set is not exact'

  for service in "${expected_services[@]}"; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ||
      die "the fresh-host $service container inventory could not be inspected"
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] ||
      die "the fresh-host $service container inventory is not singular"
    state="$(docker_local container inspect "$ids" --format '{{.State.Status}}')"
    [[ "$state" == 'running' ]] || die "the fresh-host $service service is not running"
    revision="$(docker_local container inspect "$ids" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$revision" == "$commit_sha" ]] ||
      die "the fresh-host $service service does not run the reviewed commit"

    environment="$(docker_local container inspect "$ids" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
      die "the fresh-host $service environment could not be inspected"
    for expected_environment in \
      'NODE_ENV=production' \
      'FINANCIAL_ACTIONS_MODE=dry_run' \
      'KEMERBET_EXECUTOR_ENABLED=false' \
      'KEMERBET_FINAL_ACTION_ENABLED=false'; do
      grep -Fxq "$expected_environment" <<<"$environment" ||
        die "the fresh-host $service safety environment is not exact"
    done

    if [[ "$service" == 'customer-web' ]]; then
      for expected_environment in \
        'INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED=true' \
        'INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=false' \
        'INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=true' \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json' \
        'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host customer-web capability environment is not exact'
      done
    fi

    if [[ "$service" == 'api' ]]; then
      for expected_environment in \
        'DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_encryption_master' \
        'DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET_FILE=/run/secrets/deposit_proof_reference_fingerprint_master' \
        'DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=/etc/fetanagent/deposit-proof-reference-profile.v2.json'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host API provider-proof v2 environment is not exact'
      done
      require_live_api_runtime_contract "$ids"
    fi
    if [[ "$service" == 'api' || "$service" == 'customer-web' ]]; then
      for forbidden_environment in \
        DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_SECRET \
        DEPOSIT_PROOF_REFERENCE_PROFILE; do
        ! grep -Eq "^${forbidden_environment}=" <<<"$environment" ||
          die "the fresh-host $service provider-proof v2 material is exposed inline"
      done
    else
      ! grep -Eq '^(DEPOSIT_PROOF_REFERENCE_|INTERNAL_CUSTOMER_WEB_DRY_RUN_DEPOSIT_PROOF_RUNTIME_ENABLED=)' \
        <<<"$environment" ||
        die "the fresh-host $service unexpectedly receives the provider-proof v2 contract"
    fi

    if [[ "$service" == 'bot' ]]; then
      for expected_environment in \
        'TELEGRAM_BOT_ENABLED=true' \
        'TELEGRAM_BETA_ADMISSION_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host Telegram bot activation environment is not exact'
      done
      restart_count="$(docker_local container inspect "$ids" --format '{{.RestartCount}}')"
      [[ "$restart_count" == '0' ]] || die 'the fresh-host Telegram bot restarted unexpectedly'
      if [[ "$startup_contract_mode" == 'immediate-startup' ]]; then
        docker_local container logs --tail 80 "$ids" 2>&1 |
          grep -Fq 'Telegram bot started with configured private admission and action handlers.' ||
          die 'the fresh-host Telegram bot did not report its genuine startup contract'
      else
        require_fresh_bot_startup_receipt "$commit_sha" "$ids"
      fi
    else
      health="$(docker_local container inspect "$ids" --format '{{.State.Health.Status}}')"
      [[ "$health" == 'healthy' ]] || die "the fresh-host $service service is not healthy"
      for expected_environment in \
        'TELEGRAM_BOT_ENABLED=false' \
        'TELEGRAM_BETA_ADMISSION_ENABLED=false'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die "the fresh-host $service Telegram safety environment is not exact"
      done
    fi
  done

  if [[ "$startup_contract_mode" == 'published-steady-state' ||
    "$startup_contract_mode" == 'published-with-kemerbet-session' ]]; then
    gateway_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=gateway')" ||
      die 'the published gateway inventory could not be inspected'
    [[ "$gateway_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'the published gateway inventory is not singular'
    [[ "$(docker_local container inspect "$gateway_container" --format '{{.State.Status}}')" == 'running' ]] ||
      die 'the published gateway is not running'
    gateway_health="$(docker_local container inspect "$gateway_container" --format '{{.State.Health.Status}}')"
    [[ "$gateway_health" == 'healthy' ]] || die 'the published gateway is not healthy'
    gateway_revision="$(docker_local container inspect "$gateway_container" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$gateway_revision" == "$commit_sha" ]] ||
      die 'the published gateway does not run the reviewed commit'
    gateway_restart="$(docker_local container inspect "$gateway_container" --format '{{.RestartCount}}')"
    [[ "$gateway_restart" == '0' ]] || die 'the published gateway restarted unexpectedly'
  fi

  require_reviewed_owner_port_3002 "$commit_sha"
}

require_kemerbet_session_provision_runtime() {
  local commit_sha="$1"
  local container_id environment health mount_contract owner_container owner_socket_source
  local identity_key_source player_ids_source profile_volume_source readiness_output_source revision selector_source
  local session_socket_source

  require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
  require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
  require_immutable_config_file "$KEMERBET_SELECTOR_CONTRACT"
  require_kemerbet_readiness_output_directory

  container_id="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ||
    die 'the private KemerBet session container inventory could not be inspected'
  [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the private KemerBet session container inventory is not singular'
  [[ "$(docker_local container inspect "$container_id" --format '{{.State.Status}}')" == 'running' ]] ||
    die 'the private KemerBet session container is not running'
  health="$(docker_local container inspect "$container_id" --format '{{.State.Health.Status}}')"
  [[ "$health" == 'healthy' ]] || die 'the private KemerBet session container is not healthy'
  revision="$(docker_local container inspect "$container_id" \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  [[ "$revision" == "$commit_sha" ]] ||
    die 'the private KemerBet session container does not run the reviewed commit'
  [[ "$(docker_local container inspect "$container_id" --format '{{.Config.User}}')" == '10001:10001' ]] ||
    die 'the private KemerBet session container user is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .Config.Cmd}}')" == \
    '["node","apps/executor/dist/kemerbet-session-provision-server.js"]' ]] ||
    die 'the private KemerBet session container command is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.ReadonlyRootfs}}')" == 'true' ]] ||
    die 'the private KemerBet session root filesystem is writable'
  [[ "$(docker_local container inspect "$container_id" --format '{{.RestartCount}}')" == '0' ]] ||
    die 'the private KemerBet session container restarted unexpectedly'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapAdd}}')" == 'null' ]] ||
    die 'the private KemerBet session container adds a Linux capability'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.CapDrop}}')" == '["ALL"]' ]] ||
    die 'the private KemerBet session container does not drop every Linux capability'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.SecurityOpt}}')" == '["no-new-privileges:true"]' ]] ||
    die 'the private KemerBet session container permits privilege escalation'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.PidsLimit}}')" == '512' ]] ||
    die 'the private KemerBet session PID limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.Memory}}')" == '1610612736' ]] ||
    die 'the private KemerBet session memory limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.NanoCpus}}')" == '2000000000' ]] ||
    die 'the private KemerBet session CPU limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{.HostConfig.ShmSize}}')" == '536870912' ]] ||
    die 'the private KemerBet session shared-memory limit is not exact'
  [[ "$(docker_local container inspect "$container_id" --format '{{json .HostConfig.PortBindings}}')" == '{}' ]] ||
    die 'the private KemerBet session container publishes a port'

  environment="$(docker_local container inspect "$container_id" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
    die 'the private KemerBet session environment could not be inspected'
  for expected_environment in \
    'NODE_ENV=production' \
    'FINANCIAL_ACTIONS_MODE=dry_run' \
    'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' \
    'KEMERBET_EXECUTOR_ENABLED=false' \
    'KEMERBET_FINAL_ACTION_ENABLED=false' \
    'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false'; do
    grep -Fxq "$expected_environment" <<<"$environment" ||
      die 'the private KemerBet session safety environment is not exact'
  done
  ! grep -Eq '(DATABASE|PASSWORD|SECRET|TOKEN|HMAC|SUPABASE|PLAYER|RECEIVER|SELECTOR|IDENTITY)' \
    <<<"$environment" || die 'the private KemerBet session environment contains forbidden authority'

  mount_contract="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{printf "%s|%s|%t\n" .Type .Destination .RW}}{{end}}')" ||
    die 'the private KemerBet session mount contract could not be inspected'
  [[ "$(grep -c '^' <<<"$mount_contract")" == '6' ]] ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'volume|/run/fetanagent-kemerbet-session-control|true' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'volume|/var/lib/fetanagent/kemerbet-sessions|true' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/run/secrets/kemerbet_agent_identity_hmac_key|false' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/run/secrets/kemerbet_no_transfer_readiness_player_ids|false' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/etc/fetanagent/kemerbet-selector-contract.v2.json|false' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'
  grep -Fxq 'bind|/run/fetanagent-kemerbet-readiness-seal-output|true' <<<"$mount_contract" ||
    die 'the private KemerBet session mount contract is not exact'

  identity_key_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/kemerbet_agent_identity_hmac_key"}}{{.Source}}{{end}}{{end}}')"
  player_ids_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/kemerbet_no_transfer_readiness_player_ids"}}{{.Source}}{{end}}{{end}}')"
  selector_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/etc/fetanagent/kemerbet-selector-contract.v2.json"}}{{.Source}}{{end}}{{end}}')"
  readiness_output_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-readiness-seal-output"}}{{.Source}}{{end}}{{end}}')"
  profile_volume_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/fetanagent/kemerbet-sessions"}}{{.Name}}{{end}}{{end}}')"
  [[ "$identity_key_source" == "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" &&
    "$player_ids_source" == "$KEMERBET_READINESS_PLAYER_IDS" &&
    "$selector_source" == "$KEMERBET_SELECTOR_CONTRACT" &&
    "$readiness_output_source" == "$KEMERBET_READINESS_OUTPUT_ROOT" &&
    "$profile_volume_source" == "$KEMERBET_PROFILE_VOLUME" ]] ||
    die 'the private KemerBet readiness input or output source is not exact'
  require_kemerbet_profile_volume_holders "$container_id"

  owner_container="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=owner-control')" ||
    die 'the Owner container inventory could not be inspected for private socket binding'
  [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
    die 'the Owner container inventory is not singular for private socket binding'
  owner_socket_source="$(docker_local container inspect "$owner_container" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-session-control"}}{{.Name}}{{end}}{{end}}')"
  session_socket_source="$(docker_local container inspect "$container_id" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-session-control"}}{{.Name}}{{end}}{{end}}')"
  [[ "$owner_socket_source" == "$KEMERBET_SESSION_CONTROL_VOLUME" &&
    "$session_socket_source" == "$KEMERBET_SESSION_CONTROL_VOLUME" ]] ||
    die 'the Owner and private KemerBet session containers do not share one exact socket volume'
  docker_local container exec "$owner_container" node --input-type=module --eval '
    import http from "node:http";
    const request = http.get({
      socketPath: "/run/fetanagent-kemerbet-session-control/session.sock",
      path: "/healthz",
    }, (response) => process.exit(response.statusCode === 200 ? 0 : 21));
    request.on("error", () => process.exit(22));
    request.setTimeout(3000, () => request.destroy());
  ' || die 'Owner cannot reach the exact private KemerBet session socket'
}

require_fresh_bot_disabled_ready() {
  local commit_sha="$1"

  require_exact_fresh_private_runtime "$commit_sha"
  require_service_file "$SECRET_ROOT/bot-token"
  grep -Fxq 'telegram-disabled-until-separate-smoke' "$SECRET_ROOT/bot-token" ||
    die 'the fresh-host Telegram token is not the reviewed disabled sentinel'
}

require_ipv6_host_ready() {
  command -v ip >/dev/null 2>&1 || die 'the ip utility is unavailable'
  command -v getent >/dev/null 2>&1 || die 'the getent utility is unavailable'
  ip -6 address show scope global | grep -q 'inet6 ' || die 'the VM has no global IPv6 address'
  ip -6 route show default | grep -q '^default ' || die 'the VM has no default IPv6 route'
  getent ahostsv6 "$STAGING_DIRECT_DATABASE_HOST" >/dev/null ||
    die 'the exact staging direct database host has no resolvable IPv6 address'
}

require_base_legacy_stopped_receipt() {
  command -v cmp >/dev/null 2>&1 || die 'the cmp utility is unavailable'
  command -v stat >/dev/null 2>&1 || die 'the stat utility is unavailable'
  [[ ! -L "$LEGACY_STOPPED_RECEIPT" && -f "$LEGACY_STOPPED_RECEIPT" ]] ||
    die 'the legacy-stopped transition receipt is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$LEGACY_STOPPED_RECEIPT")" == 'root:root:600' ]] ||
    die 'the legacy-stopped transition receipt ownership or mode is unsafe'
  cmp -s -- "$LEGACY_STOPPED_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$BASE_HELPER_SHA" \
    "acknowledged_commit=$BASE_REVIEWED_COMMIT" \
    'legacy_stopped=true') ||
    die 'the immutable legacy-stopped transition receipt does not match the sealed base transition'
}

require_legacy_stopped() {
  local commit_sha="$1"
  local current_helper_sha

  command -v sha256sum >/dev/null 2>&1 || die 'the sha256sum utility is unavailable'
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
  if ! current_helper_sha="$(sha256sum "$HELPER_PATH" | awk '{ print $1 }')"; then
    die 'the installed helper digest could not be computed'
  fi
  require_base_legacy_stopped_receipt
  require_base_retired_receipt
  require_helper_rotation_overlay pending-or-complete "$commit_sha" "$current_helper_sha"
}

require_base_retired_receipt() {
  [[ ! -L "$TRANSITION_RECEIPT" && -f "$TRANSITION_RECEIPT" ]] ||
    die 'the immutable VM retirement receipt is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$TRANSITION_RECEIPT")" == 'root:root:600' ]] ||
    die 'the immutable VM retirement receipt ownership or mode is unsafe'
  cmp -s -- "$TRANSITION_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$BASE_HELPER_SHA" \
    "acknowledged_commit=$BASE_REVIEWED_COMMIT" \
    'retired=true') ||
    die 'the immutable retirement receipt does not match the sealed base transition'
}

require_helper_rotation_overlay() {
  local expected_state="$1"
  local commit_sha="$2"
  local current_helper_sha="$3"

  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ && "$commit_sha" != "$BASE_REVIEWED_COMMIT" ]] ||
    die 'the helper rotation must target a distinct reviewed main commit'
  [[ "$current_helper_sha" =~ ^[0-9a-f]{64}$ && "$current_helper_sha" != "$BASE_HELPER_SHA" ]] ||
    die 'the helper rotation must target a distinct reviewed helper digest'
  [[ ! -L "$HELPER_ROTATION_RECEIPT" && -f "$HELPER_ROTATION_RECEIPT" ]] ||
    die 'the helper-rotation receipt is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$HELPER_ROTATION_RECEIPT")" == 'root:root:600' ]] ||
    die 'the helper-rotation receipt ownership or mode is unsafe'

  if cmp -s -- "$HELPER_ROTATION_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "old_helper_sha=$BASE_HELPER_SHA" \
    "new_helper_sha=$current_helper_sha" \
    "old_reviewed_commit=$BASE_REVIEWED_COMMIT" \
    "new_reviewed_commit=$commit_sha" \
    'rotation_complete=true'); then
    return
  fi
  [[ "$expected_state" == 'pending-or-complete' ]] ||
    die 'the helper-rotation receipt is not finalized for public activation'
  cmp -s -- "$HELPER_ROTATION_RECEIPT" <(printf '%s\n' \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$STAGING_DROPLET_ID" \
    "old_helper_sha=$BASE_HELPER_SHA" \
    "new_helper_sha=$current_helper_sha" \
    "old_reviewed_commit=$BASE_REVIEWED_COMMIT" \
    "new_reviewed_commit=$commit_sha" \
    'rotation_pending=true') ||
    die 'the helper-rotation receipt does not match an allowed pending or complete state'
}

require_no_legacy_identity_processes() {
  local legacy_uid process_status

  command -v id >/dev/null 2>&1 || die 'the id utility is unavailable'
  command -v pgrep >/dev/null 2>&1 || die 'the pgrep utility is unavailable'
  legacy_uid="$(id -u "$LEGACY_ADMIN")" ||
    die 'the legacy deployment identity UID could not be inspected'
  [[ "$legacy_uid" =~ ^[0-9]+$ && "$legacy_uid" -ne 0 ]] ||
    die 'the legacy deployment identity has an unsafe UID'
  if pgrep -u "$legacy_uid" >/dev/null 2>&1; then
    die 'a process owned by the legacy deployment identity remains'
  else
    process_status="$?"
    [[ "$process_status" -eq 1 ]] || die 'the legacy identity process inventory failed'
  fi
}

require_no_legacy_helper_processes() {
  local process_status

  command -v pgrep >/dev/null 2>&1 || die 'the pgrep utility is unavailable'
  if pgrep -f -- "$LEGACY_HELPER" >/dev/null 2>&1; then
    die 'a legacy deployment-helper process remains'
  else
    process_status="$?"
    [[ "$process_status" -eq 1 ]] || die 'the legacy helper process inventory failed'
  fi
}

require_legacy_execution_boundary_sealed() {
  local entry groups home password_status shell status uid unsafe_sudoers_entry
  local authorized_keys="$LEGACY_HOME/.ssh/authorized_keys"
  local marker candidate

  command -v find >/dev/null 2>&1 || die 'the find utility is unavailable'
  command -v getent >/dev/null 2>&1 || die 'the getent utility is unavailable'
  command -v grep >/dev/null 2>&1 || die 'the grep utility is unavailable'
  command -v id >/dev/null 2>&1 || die 'the id utility is unavailable'
  command -v passwd >/dev/null 2>&1 || die 'the passwd utility is unavailable'

  [[ ! -L "$LEGACY_HOME" && -d "$LEGACY_HOME" ]] ||
    die 'the legacy home is absent, non-directory, or symbolic'
  if [[ -e "$LEGACY_HOME/.ssh" || -L "$LEGACY_HOME/.ssh" ]]; then
    [[ ! -L "$LEGACY_HOME/.ssh" && -d "$LEGACY_HOME/.ssh" ]] ||
      die 'the legacy SSH directory is non-directory or symbolic'
  fi
  [[ ! -e "$authorized_keys" && ! -L "$authorized_keys" ]] ||
    die 'legacy authorized_keys remains after execution-boundary sealing'

  [[ ! -e "$LEGACY_SUDOERS" && ! -L "$LEGACY_SUDOERS" ]] ||
    die 'the exact legacy sudoers file remains after retirement'

  [[ ! -L /etc/sudoers && -f /etc/sudoers ]] ||
    die 'the primary sudoers policy cannot be safely inspected'
  [[ ! -L /etc/sudoers.d && -d /etc/sudoers.d ]] ||
    die 'the sudoers fragment directory cannot be safely inspected'
  if ! unsafe_sudoers_entry="$(find /etc/sudoers.d -mindepth 1 ! -type f -print -quit)"; then
    die 'the sudoers fragment tree could not be inspected'
  fi
  [[ -z "$unsafe_sudoers_entry" ]] ||
    die 'the sudoers fragment tree contains a non-regular entry'
  for marker in "$LEGACY_ADMIN" "$LEGACY_HELPER"; do
    if grep -Fq -- "$marker" /etc/sudoers 2>/dev/null; then
      die 'a legacy sudo permission remains in the primary sudoers policy'
    else
      status=$?
      [[ "$status" -eq 1 ]] || die 'the primary sudoers policy could not be inspected'
    fi
    if grep -r -Fq -- "$marker" /etc/sudoers.d 2>/dev/null; then
      die 'a legacy sudo permission remains in a sudoers fragment'
    else
      status=$?
      [[ "$status" -eq 1 ]] || die 'the sudoers fragment tree could not be inspected'
    fi
  done

  if ! entry="$(getent passwd "$LEGACY_ADMIN")"; then
    die 'the legacy deployment identity is absent'
  fi
  IFS=':' read -r _ _ uid _ _ home shell <<<"$entry"
  [[ "$uid" =~ ^[0-9]+$ && "$uid" -ne 0 ]] ||
    die 'the legacy deployment identity has an unsafe UID'
  [[ "$home" == "$LEGACY_HOME" ]] ||
    die 'the legacy deployment identity has an unexpected home'
  [[ "$shell" == '/usr/sbin/nologin' ]] ||
    die 'the legacy deployment identity is still interactive'
  if ! password_status="$(passwd --status "$LEGACY_ADMIN" | awk '{ print $2 }')"; then
    die 'the legacy deployment identity password state could not be inspected'
  fi
  [[ "$password_status" == 'L' ]] ||
    die 'the legacy deployment identity password is not locked'
  groups="$(id -nG "$LEGACY_ADMIN" | tr ' ' '\n')" ||
    die 'the legacy deployment identity groups could not be inspected'
  ! grep -Eq '^(docker|sudo)$' <<<"$groups" ||
    die 'the legacy deployment identity retains broad Docker or sudo-group access'

  require_no_legacy_identity_processes
  require_no_legacy_helper_processes
}

require_legacy_access_retired() {
  require_legacy_execution_boundary_sealed
  [[ ! -e "$LEGACY_HELPER" && ! -L "$LEGACY_HELPER" ]] ||
    die 'the legacy deployment helper remains after retirement'
  [[ ! -e "$LEGACY_SECRET_ROOT" && ! -L "$LEGACY_SECRET_ROOT" ]] ||
    die 'the legacy secret root remains after retirement'
}

require_private_start_cutover_ready() {
  local commit_sha="$1"

  require_legacy_stopped "$commit_sha"
  require_legacy_access_retired
  require_cutover_ready
  require_port_3002_free
}

require_fresh_host_start_ready() {
  local commit_sha="$1"
  local containers networks

  validate_commit_and_tag "$commit_sha" "${commit_sha:0:12}"
  require_fresh_host_identity
  require_ipv6_host_ready
  require_port_3002_free

  containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
    die 'the fresh-host FetanAgent container inventory could not be inspected'
  [[ -z "$containers" ]] || die 'fresh-host startup requires an empty FetanAgent project'

  networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" ||
    die 'the fresh-host FetanAgent network inventory could not be inspected'
  [[ -z "$networks" ]] || die 'fresh-host startup requires no existing FetanAgent networks'
}

require_fresh_host_identity() {
  local metadata_droplet_id metadata_ipv4

  command -v curl >/dev/null 2>&1 || die 'curl is unavailable for fresh-host identity proof'
  metadata_droplet_id="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/id)" ||
    die 'the fresh-host DigitalOcean identity could not be read'
  metadata_ipv4="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)" ||
    die 'the fresh-host DigitalOcean public IPv4 could not be read'
  [[ "$metadata_droplet_id" == "$FRESH_STAGING_DROPLET_ID" ]] ||
    die 'the fresh-host DigitalOcean identity is not the reviewed staging Droplet'
  [[ "$metadata_ipv4" == "$FRESH_PUBLIC_IPV4" ]] ||
    die 'the fresh-host DigitalOcean public IPv4 is not the reviewed staging address'
}

require_transition_retired() {
  local commit_sha="$1"
  local current_helper_sha

  command -v sha256sum >/dev/null 2>&1 || die 'the sha256sum utility is unavailable'
  command -v stat >/dev/null 2>&1 || die 'the stat utility is unavailable'

  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
    die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
  if ! current_helper_sha="$(sha256sum "$HELPER_PATH" | awk '{ print $1 }')"; then
    die 'the installed helper digest could not be computed'
  fi
  require_base_legacy_stopped_receipt
  require_base_retired_receipt

  require_helper_rotation_overlay complete "$commit_sha" "$current_helper_sha"

  require_legacy_access_retired
  require_cutover_ready
  require_exact_private_runtime "$commit_sha"
}

require_public_network_ready() {
  local public_ipv4="$1"
  local domain port resolved_output status
  local -a resolved
  command -v getent >/dev/null 2>&1 || die 'the getent utility is unavailable'
  command -v ss >/dev/null 2>&1 || die 'the ss utility is unavailable'
  command -v ufw >/dev/null 2>&1 || die 'UFW is unavailable'

  status="$(ufw status)"
  grep -Fxq 'Status: active' <<<"$status" || die 'UFW is not active'
  for port in 80 443; do
    grep -Eq "^${port}/tcp[[:blank:]]+ALLOW[[:blank:]]+Anywhere[[:blank:]]*$" <<<"$status" ||
      die "UFW does not allow $port/tcp"
    grep -Eq "^${port}/tcp \(v6\)[[:blank:]]+ALLOW[[:blank:]]+Anywhere \(v6\)[[:blank:]]*$" <<<"$status" ||
      die "UFW does not allow $port/tcp over IPv6"
  done

  if ss -ltnH | awk '$4 ~ /:(80|443)$/ { found = 1 } END { exit !found }'; then
    die 'TCP port 80 or 443 is already in use'
  fi

  for domain in "${PUBLIC_DOMAINS[@]}"; do
    resolved_output="$(getent ahostsv4 "$domain")" || die "$domain is not resolvable over IPv4"
    mapfile -t resolved <<<"$(awk '{ print $1 }' <<<"$resolved_output" | sort -u)"
    [[ "${#resolved[@]}" -eq 1 && "${resolved[0]}" == "$public_ipv4" ]] ||
      die "$domain does not resolve only to the reviewed staging IPv4 address"
  done
}

require_public_edge_ready() {
  local commit_sha="$1"

  require_transition_retired "$commit_sha"
  require_public_network_ready "$PUBLIC_IPV4"
}

require_fresh_public_edge_ready() {
  local commit_sha="$1"

  validate_commit_and_tag "$commit_sha" "${commit_sha:0:12}"
  require_fresh_host_identity
  require_exact_fresh_bot_runtime "$commit_sha" steady-state
  require_public_network_ready "$FRESH_PUBLIC_IPV4"
}

command="${1:-}"
[[ $EUID -eq 0 ]] || die 'the helper must run as root through sudo or the fixed systemd expiry guard'
if [[ "$command" == 'expiry-stop' ]]; then
  [[ -z "${SUDO_USER:-}" && -n "${INVOCATION_ID:-}" && "${FETANAGENT_STAGING_EXPIRY_GUARD:-}" == '1' ]] ||
    die 'expiry-stop may run only from the fixed systemd guard'
else
  [[ "${SUDO_USER:-}" == "$EXPECTED_SUDO_USER" ]] ||
    die 'the helper requires the dedicated deployment identity'
fi
[[ "$0" == "$HELPER_PATH" ]] || die 'the helper must run from its root-owned installed path'
[[ ! -L "$HELPER_PATH" && "$(stat --format='%U:%G:%a' "$HELPER_PATH")" == 'root:root:755' ]] ||
  die 'the installed helper ownership or mode is unsafe'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Docker overrides are forbidden'

case "$command" in
  arm-expiry-stop|bot-ready|discard|expiry-stop|fresh-start|install|install-bot-token|recheck-kemerbet-readiness|seal-kemerbet-readiness|start|start-bot|start-fresh-public-edge|start-kemerbet-session-provision|start-public-edge|stop|stop-bot|stop-kemerbet-session-provision|stop-public-edge)
    acquire_staging_mutation_lock
    if [[ ! "$command" =~ ^(recheck-kemerbet-readiness|expiry-stop|stop|stop-bot|stop-kemerbet-session-provision|stop-public-edge)$ &&
      ( -e "$KEMERBET_RECHECK_PROMOTION_ROOT" || -L "$KEMERBET_RECHECK_PROMOTION_ROOT" ||
        -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" ||
        -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_NAME" ||
        -e "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ||
        -L "$KEMERBET_OWNER_RECEIPT_ROOT/$KEMERBET_RECOVERY_LATCH_INSTALLING_NAME" ) ]]; then
      die 'an interrupted KemerBet readiness recovery blocks state-expanding staging mutations'
    fi
    ;;
esac

case "$command" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum "$HELPER_PATH" | awk '{print $1}')" == "$2" ]] ||
      die 'the installed helper does not match the reviewed repository helper'
    ;;

  stop)
    [[ $# -eq 1 ]] || die 'stop accepts no additional arguments'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
    else
      stop_project
      disarm_expiry_stop
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  arm-expiry-stop)
    [[ $# -eq 3 ]] || die 'arm-expiry-stop requires a reviewed commit and canonical UTC stop time'
    arm_expiry_stop "$2" "$3"
    ;;

  expiry-stop)
    [[ $# -eq 1 ]] || die 'expiry-stop accepts no additional arguments'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
    else
      stop_project
      disarm_expiry_stop
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  cutover-ready)
    [[ $# -eq 2 ]] || die 'cutover-ready requires one reviewed main commit'
    require_legacy_stopped "$2"
    require_cutover_ready
    require_port_3002_free
    ;;

  fresh-host-ready)
    [[ $# -eq 2 ]] || die 'fresh-host-ready requires one reviewed main commit'
    require_fresh_host_start_ready "$2"
    ;;

  network-ready)
    [[ $# -eq 1 ]] || die 'network-ready accepts no additional arguments'
    require_ipv6_host_ready
    ;;

  discard)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{40}$ ]] || die 'discard requires one full commit SHA'
    incoming="/tmp/fetanagent-$2"
    if [[ -e "$incoming" || -L "$incoming" ]]; then
      [[ ! -L "$incoming" && -d "$incoming" ]] || die 'the incoming cleanup target is unsafe'
      [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:700" ]] ||
        die 'the incoming cleanup target ownership or mode is unsafe'
      rm -rf -- "$incoming"
    fi
    ;;

  install)
    [[ $# -eq 4 ]] || die 'install requires a commit, image tag, and incoming directory'
    commit_sha="$2"
    image_tag="$3"
    incoming="$4"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    [[ "$incoming" == "/tmp/fetanagent-$commit_sha" ]] || die 'the incoming directory is outside the approved path'
    [[ ! -L "$incoming" && -d "$incoming" ]] || die 'the incoming directory is absent or symbolic'
    [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:700" ]] ||
      die 'the incoming directory ownership or mode is unsafe'

    expected_files="$({ printf '%s\n' \
      api-action-capability-hmac api-action-payload-hmac api-action-semantic-hmac \
      cbe-deposit-reference-encryption-key cbe-deposit-reference-fingerprint-key \
      cbe-deposit-reference-key-profile.v1.json \
      deposit-proof-reference-encryption-master deposit-proof-reference-fingerprint-master \
      deposit-proof-reference-profile.v2.json \
      customer-web-database-url customer-web-publishable-key customer-web-rate-limit-hmac \
      api-action-transport-hmac \
      beta-database-url beta-payload-hmac beta-transport-hmac bot-token bot-transport-hmac \
      bot-action-transport-hmac player-action-database-url \
      compose.staging-beta.yaml owner-database-url fetanagent-staging-images.tar publishable-key \
      supabase-ca.crt; } | sort)"
    actual_files="$(find "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
    [[ "$actual_files" == "$expected_files" ]] || die 'the incoming release file set is not exact'
    while IFS= read -r incoming_file; do
      [[ ! -L "$incoming/$incoming_file" && -f "$incoming/$incoming_file" ]] ||
        die 'an incoming release input is not a regular file'
    done <<<"$actual_files"

    release="$RELEASE_ROOT/$commit_sha"
    install -d -o root -g root -m 0755 "$release/infra" "$SECRET_ROOT"
    install -o root -g root -m 0444 \
      "$incoming/compose.staging-beta.yaml" "$release/infra/compose.staging-beta.yaml"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-database-url" "$SECRET_ROOT/beta-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/owner-database-url" "$SECRET_ROOT/owner-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/customer-web-database-url" "$SECRET_ROOT/customer-web-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/customer-web-publishable-key" "$SECRET_ROOT/customer-web-publishable-key"
    install -o 10001 -g 10001 -m 0400 "$incoming/customer-web-rate-limit-hmac" "$SECRET_ROOT/customer-web-rate-limit-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-transport-hmac" "$SECRET_ROOT/beta-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-transport-hmac" "$SECRET_ROOT/bot-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/beta-payload-hmac" "$SECRET_ROOT/beta-payload-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/player-action-database-url" "$SECRET_ROOT/player-action-database-url"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-transport-hmac" "$SECRET_ROOT/api-action-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-payload-hmac" "$SECRET_ROOT/api-action-payload-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-capability-hmac" "$SECRET_ROOT/api-action-capability-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/api-action-semantic-hmac" "$SECRET_ROOT/api-action-semantic-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/cbe-deposit-reference-encryption-key" "$SECRET_ROOT/cbe-deposit-reference-encryption-key"
    install -o 10001 -g 10001 -m 0400 "$incoming/cbe-deposit-reference-fingerprint-key" "$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
    install -o root -g root -m 0444 "$incoming/cbe-deposit-reference-key-profile.v1.json" "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
    install -o 10001 -g 10001 -m 0400 "$incoming/deposit-proof-reference-encryption-master" "$SECRET_ROOT/deposit-proof-reference-encryption-master"
    install -o 10001 -g 10001 -m 0400 "$incoming/deposit-proof-reference-fingerprint-master" "$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
    install -o root -g root -m 0444 "$incoming/deposit-proof-reference-profile.v2.json" "$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-action-transport-hmac" "$SECRET_ROOT/bot-action-transport-hmac"
    install -o 10001 -g 10001 -m 0400 "$incoming/bot-token" "$SECRET_ROOT/bot-token"
    install -o 10001 -g 10001 -m 0400 "$incoming/publishable-key" "$SECRET_ROOT/publishable-key"
    install -o root -g root -m 0444 "$incoming/supabase-ca.crt" "$SECRET_ROOT/supabase-ca.crt"

    docker_local image load --input "$incoming/fetanagent-staging-images.tar" >/dev/null
    for image in owner-control customer-web api beta-admission bot gateway; do
      [[ "$(docker_local image inspect "fetanagent-$image:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
        die 'a loaded image revision does not match the reviewed commit'
    done
    rm -rf -- "$incoming"
    ;;

  start|fresh-start)
    [[ $# -eq 3 ]] || die 'start and fresh-start require a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    # This command is an independently callable privileged boundary. Prove the
    # reviewed transition (legacy cutover or clean fresh-host state) before
    # reading deploy inputs, running database preflights, or starting a container.
    if [[ "$command" == 'fresh-start' ]]; then
      require_fresh_host_start_ready "$commit_sha"
      clear_bot_startup_receipt
    else
      require_private_start_cutover_ready "$commit_sha"
    fi
    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    for service_file in \
      owner-database-url publishable-key beta-database-url beta-transport-hmac \
      customer-web-database-url customer-web-publishable-key customer-web-rate-limit-hmac \
      bot-transport-hmac beta-payload-hmac bot-token player-action-database-url \
      api-action-transport-hmac api-action-payload-hmac api-action-capability-hmac \
      api-action-semantic-hmac cbe-deposit-reference-encryption-key \
      cbe-deposit-reference-fingerprint-key deposit-proof-reference-encryption-master \
      deposit-proof-reference-fingerprint-master bot-action-transport-hmac; do
      require_service_file "$SECRET_ROOT/$service_file"
    done
    require_immutable_config_file "$SECRET_ROOT/supabase-ca.crt"
    require_immutable_config_file "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
    require_immutable_config_file "$SECRET_ROOT/deposit-proof-reference-profile.v2.json"

    for image in owner-control customer-web api beta-admission bot gateway; do
      [[ "$(docker_local image inspect "fetanagent-$image:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
        die 'an image revision does not match the reviewed commit'
    done

    require_ipv6_host_ready

    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual -f "$compose_file"
    )
    # Docker may not create this bind source. Its root-owned inode is the
    # aggregate receipt authority and must exist before every Compose preflight.
    ensure_owner_kemerbet_receipt_root

    run_bounded_database_preflight() {
      local service="$1"
      local preflight_cli="$2"
      local attempt

      for attempt in 1 2 3; do
        if env -i "${compose_environment[@]}" "${compose_command[@]}" \
          run --rm --no-deps "$service" node "$preflight_cli"; then
          return 0
        fi
        if [[ "$attempt" -lt 3 ]]; then
          printf '%s database preflight attempt %s failed; waiting before bounded retry.\n' \
            "$service" "$attempt" >&2
          sleep 15
        fi
      done
      return 1
    }

    run_bounded_database_preflight \
      owner-control apps/admin/dist/database-preflight-cli.js ||
      die 'the Owner-control database preflight failed after three bounded attempts'
    run_bounded_database_preflight \
      customer-web apps/customer-web/dist/database-preflight-cli.js ||
      die 'the customer-web database preflight failed after three bounded attempts'
    run_bounded_database_preflight \
      api apps/api/dist/player-action-database-preflight-cli.js ||
      die 'the Player-ID action database preflight failed after three bounded attempts'
    run_bounded_database_preflight \
      beta-admission apps/beta-admission/dist/catalog-preflight-cli.js ||
      die 'the beta-admission database preflight failed after three bounded attempts'
    if [[ "$command" == 'fresh-start' ]]; then
      # Fresh-host staging remains Telegram-disabled until its separately approved
      # token and end-to-end smoke gate are complete. The historical start path
      # retains the reviewed full beta profile behavior.
      env -i "${compose_environment[@]}" "${compose_command[@]}" \
        up -d --no-build --wait --wait-timeout 90 owner-control customer-web api beta-admission
    else
      env -i "${compose_environment[@]}" "${compose_command[@]}" \
        up -d --no-build --wait --wait-timeout 90
    fi
    require_owner_kemerbet_receipt_service_access
    ;;

  bot-disabled-ready)
    [[ $# -eq 2 ]] || die 'bot-disabled-ready requires one reviewed main commit'
    require_fresh_bot_disabled_ready "$2"
    ;;

  install-bot-token)
    [[ $# -eq 3 ]] || die 'install-bot-token requires one reviewed main commit and one incoming file'
    commit_sha="$2"
    incoming="$3"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    [[ "$incoming" == "/tmp/fetanagent-bot-token-$commit_sha" ]] ||
      die 'the incoming Telegram token path is outside the approved boundary'
    require_fresh_bot_disabled_ready "$commit_sha"
    [[ ! -L "$incoming" && -f "$incoming" ]] ||
      die 'the incoming Telegram token is absent or symbolic'
    [[ "$(stat --format='%U:%a' "$incoming")" == "$EXPECTED_SUDO_USER:600" ]] ||
      die 'the incoming Telegram token ownership or mode is unsafe'
    [[ "$(wc -c <"$incoming")" -le 128 ]] || die 'the incoming Telegram token is too large'
    [[ "$(awk 'END { print NR + 0 }' "$incoming")" == '1' ]] ||
      die 'the incoming Telegram token must contain exactly one line'
    grep -Eq '^[0-9]{8,12}:[A-Za-z0-9_-]{35,}$' "$incoming" ||
      die 'the incoming Telegram token shape is invalid'
    grep -q $'\r' "$incoming" && die 'the incoming Telegram token contains a carriage return'
    install -o 10001 -g 10001 -m 0400 "$incoming" "$SECRET_ROOT/bot-token"
    rm -f -- "$incoming"
    require_service_file "$SECRET_ROOT/bot-token"
    ;;

  start-bot)
    [[ $# -eq 3 ]] || die 'start-bot requires one reviewed main commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    require_exact_fresh_private_runtime "$commit_sha"
    require_service_file "$SECRET_ROOT/bot-token"
    grep -Eq '^[0-9]{8,12}:[A-Za-z0-9_-]{35,}$' "$SECRET_ROOT/bot-token" ||
      die 'the installed Telegram token shape is invalid'
    [[ "$(docker_local image inspect "fetanagent-bot:$image_tag" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the Telegram bot image does not match the reviewed commit'

    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual -f "$compose_file"
    )
    clear_bot_startup_receipt
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      up -d --no-build --no-deps bot
    ;;

  bot-ready)
    [[ $# -eq 2 ]] || die 'bot-ready requires one reviewed main commit'
    require_exact_fresh_bot_runtime "$2" immediate-startup
    record_fresh_bot_startup_receipt "$2"
    require_exact_fresh_bot_runtime "$2" steady-state
    ;;

  stop-bot)
    [[ $# -eq 2 ]] || die 'stop-bot requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      require_kemerbet_teardown_recovery_success
    fi
    bot_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=bot')"
    if [[ -n "$bot_container" ]]; then
      [[ "$bot_container" =~ ^[0-9a-f]{12,64}$ ]] ||
        die 'the Telegram bot container inventory is ambiguous'
      docker_local container rm --force "$bot_container" >/dev/null
    fi
    clear_bot_startup_receipt
    disabled_token="$(mktemp "$SECRET_ROOT/.bot-token-disabled.XXXXXX")"
    printf '%s\n' 'telegram-disabled-until-separate-smoke' >"$disabled_token"
    install -o 10001 -g 10001 -m 0400 "$disabled_token" "$SECRET_ROOT/bot-token"
    rm -f -- "$disabled_token"
    require_fresh_bot_disabled_ready "$commit_sha"
    require_kemerbet_teardown_recovery_success
    ;;

  start-kemerbet-session-provision)
    [[ $# -eq 3 ]] ||
      die 'start-kemerbet-session-provision requires one reviewed main commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
    [[ "$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the private KemerBet session image does not match the reviewed commit'
    [[ "$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" \
      --format '{{.Config.User}}')" == '10001:10001' ]] ||
      die 'the private KemerBet session image user is not exact'
    require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    prepare_retryable_kemerbet_session_player_ids
    require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
    require_immutable_config_file "$KEMERBET_SELECTOR_CONTRACT"
    require_kemerbet_readiness_output_directory

    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile kemerbet-session-provision -f "$compose_file"
    )
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      up -d --no-build --no-deps --wait --wait-timeout 90 kemerbet-session-provision
    require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
    require_kemerbet_session_provision_runtime "$commit_sha"
    ;;

  kemerbet-session-provision-ready)
    [[ $# -eq 2 ]] ||
      die 'kemerbet-session-provision-ready requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
    require_kemerbet_session_provision_runtime "$commit_sha"
    ;;

  seal-kemerbet-readiness)
    [[ $# -eq 2 ]] ||
      die 'seal-kemerbet-readiness requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
    require_kemerbet_session_provision_runtime "$commit_sha"
    [[ ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the one-time KemerBet readiness binding already exists'
    owner_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=owner-control')"
    [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'the Owner container inventory is not singular for readiness sealing'
    docker_local container exec "$owner_container" node --input-type=module --eval '
      import { randomUUID } from "node:crypto";
      import http from "node:http";
      const body = JSON.stringify({ requestId: randomUUID() });
      const request = http.request({
        socketPath: "/run/fetanagent-kemerbet-session-control/session.sock",
        path: "/v1/readiness/seal",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      }, (response) => {
        let size = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          size += chunk.byteLength;
          if (size > 4096) request.destroy();
          else chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const keys = Object.keys(result).sort();
            const expectedKeys = [
              "currency",
              "identifiersRedacted",
              "moneyMoved",
              "playersChecked",
              "sealed",
              "transferDisabled",
            ];
            if (
              response.statusCode !== 201 ||
              keys.length !== expectedKeys.length ||
              !keys.every((key, index) => key === expectedKeys[index]) ||
              result.sealed !== true ||
              result.playersChecked !== 5 ||
              result.currency !== "ETB" ||
              result.transferDisabled !== true ||
              result.moneyMoved !== false ||
              result.identifiersRedacted !== true
            ) process.exit(31);
            process.exit(0);
          } catch {
            process.exit(32);
          }
        });
      });
      request.on("error", () => process.exit(33));
      request.setTimeout(180000, () => request.destroy());
      request.end(body);
    ' || die 'the one-time KemerBet readiness seal failed closed'
    require_kemerbet_readiness_output_directory
    [[ -f "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the one-time KemerBet readiness binding was not created'
    printf '%s\n' 'KemerBet readiness sealed: 5 of 5 Players, Transfer disabled.'
    ;;

  recheck-kemerbet-readiness)
    [[ $# -eq 3 ]] ||
      die 'recheck-kemerbet-readiness requires the reviewed release and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    command -v timeout >/dev/null 2>&1 || die 'the bounded execution utility is unavailable'
    command -v sync >/dev/null 2>&1 || die 'the durable synchronization utility is unavailable'
    recover_incomplete_kemerbet_recheck_promotion_guarded
    if [[ -e "$KEMERBET_RECHECK_RECEIPT_ROOT" || -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]]; then
      require_completed_kemerbet_recheck_for_release "$commit_sha" "$image_tag"
      printf '%s\n' 'KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.'
      exit 0
    fi
    [[ ! -e "$KEMERBET_RECHECK_RECEIPT_ROOT" && ! -L "$KEMERBET_RECHECK_RECEIPT_ROOT" ]] ||
      die 'the independent KemerBet readiness recheck already has a receipt'
    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    [[ "$(realpath -- "$compose_file")" == "$compose_file" ]] ||
      die 'the sealed Compose contract is not canonical'
    inspect_owner_staged_kemerbet_cohort
    require_kemerbet_identity_key_file "$KEMERBET_AGENT_IDENTITY_HMAC_KEY"
    [[ "$(stat --format='%h' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == '1' ]] ||
      die 'the KemerBet identity key has an unsafe hard-link count'

    require_root_readable_immutable_file "$KEMERBET_SELECTOR_CONTRACT"
    selector_parent="$(dirname -- "$KEMERBET_SELECTOR_CONTRACT")"
    [[ ! -L "$selector_parent" && -d "$selector_parent" &&
      "$(realpath -- "$selector_parent")" == "$selector_parent" &&
      "$(stat --format='%U:%G' "$selector_parent")" == 'root:root' ]] ||
      die 'the KemerBet selector root is unsafe'
    selector_parent_mode="$(stat --format='%a' "$selector_parent")"
    [[ "$selector_parent_mode" =~ ^[0-7]{3,4}$ ]] || die 'the KemerBet selector root mode is invalid'
    (( (8#$selector_parent_mode & 8#022) == 0 )) ||
      die 'the KemerBet selector root is writable outside root'
    require_kemerbet_readiness_output_directory
    [[ -f "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the sealed KemerBet identity binding is unavailable'
    [[ "$(stat --format='%h' "$KEMERBET_READINESS_BINDING")" == '1' ]] ||
      die 'the sealed KemerBet identity binding has an unsafe hard-link count'
    [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
      die 'the fixed KemerBet identity binding already exists'
    [[ ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" ]] ||
      die 'a KemerBet recheck candidate boundary already exists'
    [[ -z "$(docker_local container ls --all --quiet \
      --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" ]] ||
      die 'a KemerBet recheck container already exists'

    image_id="$(docker_local image inspect "fetanagent-deposit-executor:$image_tag" --format '{{.Id}}')" ||
      die 'the KemerBet recheck image is unavailable'
    [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'the KemerBet recheck image ID is invalid'
    [[ "$(docker_local image inspect "$image_id" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{ index .Config.Labels "org.opencontainers.image.title" }}|{{.Config.User}}')" == \
      "$commit_sha|fetanagent-deposit-executor|10001:10001" ]] ||
      die 'the KemerBet recheck image does not match the reviewed release'

    [[ "$(wc -l <"$KEMERBET_READINESS_BINDING")" == '1' ]] ||
      die 'the sealed KemerBet identity binding shape is invalid'
    LC_ALL=C grep -Eq \
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12} hmac-sha256-agent-identity-v1:[0-9a-f]{64}$' \
      "$KEMERBET_READINESS_BINDING" || die 'the sealed KemerBet identity binding contract is invalid'
    binding_line="$(<"$KEMERBET_READINESS_BINDING")"
    IFS=' ' read -r account_id binding_fingerprint binding_residue <<<"$binding_line"
    [[ -n "$account_id" && -n "$binding_fingerprint" && -z "$binding_residue" ]] ||
      die 'the sealed KemerBet identity binding fields are invalid'
    source_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")"
    source_dev_ino="$(stat --format='%d:%i' "$KEMERBET_READINESS_BINDING")"
    source_digest="$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')"
    identity_key_dev_ino_before="$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
    identity_key_digest="$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')"
    selector_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")"
    selector_digest="$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')"
    for digest in "$source_digest" "$identity_key_digest" "$selector_digest"; do
      [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die 'a KemerBet recheck input digest is invalid'
    done

    session_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ||
      die 'the private KemerBet session inventory could not be inspected before recheck'
    journal_session_container='none'
    if [[ -n "$session_container" ]]; then
      [[ "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
        die 'the private KemerBet session inventory is ambiguous before recheck'
      require_exact_fresh_bot_runtime "$commit_sha" published-with-kemerbet-session
      require_kemerbet_session_provision_runtime "$commit_sha"
      journal_session_container="$session_container"
    else
      require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
      require_kemerbet_profile_volume_holders ''
    fi

    record_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_kemerbet_recheck_import_prepared_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"

    KEMERBET_RECHECK_RELEASE="$commit_sha"
    KEMERBET_RECHECK_SESSION_CONTAINER="$journal_session_container"
    KEMERBET_RECHECK_SOURCE_DEV_INO="$source_dev_ino"
    KEMERBET_RECHECK_SOURCE_DIGEST="$source_digest"
    KEMERBET_RECHECK_PROMOTION_OWNED='true'
    KEMERBET_RECHECK_CLEANUP_ARMED='true'
    trap kemerbet_recheck_cleanup_trap EXIT
    trap 'kemerbet_recheck_signal_trap 130' INT
    trap 'kemerbet_recheck_signal_trap 143' TERM
    trap 'kemerbet_recheck_signal_trap 129' HUP

    owner_kemerbet_cohort_marker remove-failed "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the matching retryable KemerBet cohort failure marker could not be retired'
    promote_owner_staged_kemerbet_player_ids
    require_service_file "$KEMERBET_READINESS_PLAYER_IDS"
    [[ "$(stat --format='%h' "$KEMERBET_READINESS_PLAYER_IDS")" == '1' ]] ||
      die 'the one-use KemerBet Player-ID file has an unsafe hard-link count'
    KEMERBET_RECHECK_PLAYER_IDS_DEV_INO="$(stat --format='%d:%i' "$KEMERBET_READINESS_PLAYER_IDS")"
    player_ids_digest="$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')"
    [[ "$player_ids_digest" =~ ^[0-9a-f]{64}$ &&
      "$player_ids_digest" == "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ]] ||
      die 'the KemerBet Player-ID recheck input digest is invalid'
    advance_kemerbet_recheck_import_journal_to_prepared \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_kemerbet_recheck_prepared_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$source_digest" "$identity_key_digest" "$selector_digest" "$image_id" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    owner_kemerbet_cohort_marker publish-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the KemerBet cohort import marker could not be published'
    owner_kemerbet_cohort_marker require-imported "$KEMERBET_RECHECK_OWNER_CLAIM_ID" ||
      die 'the KemerBet cohort import marker is not exact'

    if [[ "$journal_session_container" != 'none' ]]; then
      docker_local container stop --time 70 "$session_container" >/dev/null
      docker_local container rm "$session_container" >/dev/null
    fi
    require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
    require_kemerbet_profile_volume_holders ''

    secret_parent="$(dirname -- "$KEMERBET_AGENT_IDENTITY_BINDINGS")"
    [[ ! -L "$secret_parent" && -d "$secret_parent" &&
      "$(realpath -- "$secret_parent")" == "$secret_parent" &&
      "$(stat --format='%U:%G' "$secret_parent")" == 'root:root' ]] ||
      die 'the KemerBet executor secret root is absent, symbolic, noncanonical, or unowned'
    case "$(stat --format='%a' "$secret_parent")" in
      700) ;;
      755) chmod 0700 "$secret_parent" ;;
      *) die 'the KemerBet executor secret root mode is unsafe' ;;
    esac
    [[ "$(stat --format='%U:%G:%a' "$secret_parent")" == 'root:root:700' ]] ||
      die 'the KemerBet executor secret root could not be fixed at mode 0700'
    sync -f "$secret_parent" || die 'the KemerBet executor secret root could not be synchronized'
    harden_kemerbet_identity_key
    harden_kemerbet_player_ids_file

    identity_key_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")"
    player_ids_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_PLAYER_IDS")"
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")" == "$source_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(stat --format='%d:%i' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == "$identity_key_dev_ino_before" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")" == "$selector_stat" &&
      "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" &&
      "$(stat --format='%d:%i' "$KEMERBET_READINESS_PLAYER_IDS")" == "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" ]] ||
      die 'a KemerBet recheck input changed while the prepared journal was active'

    profile_mountpoint="$(resolve_kemerbet_profile_volume_mountpoint)" ||
      die 'the KemerBet profile volume could not be resolved before identity attestation'
    profile_identity_digest="$(kemerbet_profile_identity_digest \
      "$account_id" "$profile_mountpoint" allow-exact-stale-singletons)" ||
      die 'the KemerBet profile identity could not be attested'
    [[ "$profile_identity_digest" =~ ^[0-9a-f]{64}$ ]] ||
      die 'the KemerBet profile identity digest is invalid'

    KEMERBET_RECHECK_CANDIDATE_CREATED='true'
    install -d -o root -g root -m 0700 "$KEMERBET_RECHECK_CANDIDATE_ROOT"
    install -o root -g root -m 0444 \
      "$KEMERBET_READINESS_BINDING" "$KEMERBET_RECHECK_CANDIDATE_BINDING"
    sync -f "$KEMERBET_RECHECK_CANDIDATE_BINDING" ||
      die 'the KemerBet recheck binding candidate could not be synchronized'
    sync -f "$KEMERBET_RECHECK_CANDIDATE_ROOT" ||
      die 'the KemerBet recheck candidate directory could not be synchronized'
    require_root_readable_immutable_file "$KEMERBET_RECHECK_CANDIDATE_BINDING"
    candidate_stat="$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")"
    KEMERBET_RECHECK_CANDIDATE_DEV_INO="$(stat --format='%d:%i' "$KEMERBET_RECHECK_CANDIDATE_BINDING")"
    KEMERBET_RECHECK_CANDIDATE_DIGEST="$source_digest"
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")" == "$source_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$source_digest" ]] ||
      die 'the sealed KemerBet identity binding changed during candidate creation'

    advance_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" \
      "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"

    remove_kemerbet_recheck_network || die 'a stale KemerBet recheck network could not be removed'
    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile kemerbet-no-transfer-readiness -f "$compose_file"
    )
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      create --no-build --no-recreate kemerbet-no-transfer-readiness >/dev/null
    recheck_container="$(docker_local container ls --all --quiet \
      --filter "name=^/${KEMERBET_RECHECK_CONTAINER}$")" ||
      die 'the KemerBet recheck container inventory could not be inspected'
    [[ "$recheck_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'the KemerBet recheck container inventory is not singular'
    require_kemerbet_profile_volume_holders "$recheck_container"
    require_kemerbet_recheck_container_contract "$recheck_container" "$commit_sha" "$image_tag" "$image_id"
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == "$identity_key_stat" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")" == "$selector_stat" &&
      "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_PLAYER_IDS")" == "$player_ids_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == "$candidate_stat" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$source_digest" ]] ||
      die 'a KemerBet recheck input changed before execution'

    recheck_status=0
    if timeout --foreground --signal=TERM \
      --kill-after="${KEMERBET_RECHECK_KILL_AFTER_SECONDS}s" \
      "${KEMERBET_RECHECK_TIMEOUT_SECONDS}s" \
      env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
      docker --host "$LOCAL_DOCKER_SOCKET" container start --attach "$recheck_container" \
      >/dev/null 2>&1; then
      recheck_status=0
    else
      recheck_status=$?
    fi
    [[ "$recheck_status" -eq 0 ]] ||
      die 'the independent KemerBet no-transfer readiness recheck failed closed'
    [[ "$(docker_local container inspect "$recheck_container" \
      --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}|{{.RestartCount}}')" == \
      'exited|0|false||0' ]] || die 'the KemerBet recheck exit contract is not exact'
    observed_profile_identity_digest="$(kemerbet_profile_identity_digest \
      "$account_id" "$profile_mountpoint" require-absent-singletons)" ||
      die 'the KemerBet profile identity could not be re-attested after execution'
    [[ "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_RECHECK_CANDIDATE_BINDING")" == \
      "$candidate_stat" &&
      "$(sha256sum -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_BINDING")" == "$source_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_BINDING" | awk '{print $1}')" == "$source_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_AGENT_IDENTITY_HMAC_KEY")" == "$identity_key_stat" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_HMAC_KEY" | awk '{print $1}')" == "$identity_key_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_SELECTOR_CONTRACT")" == "$selector_stat" &&
      "$(sha256sum -- "$KEMERBET_SELECTOR_CONTRACT" | awk '{print $1}')" == "$selector_digest" &&
      "$(stat --format='%d:%i:%h:%s:%Y:%u:%g:%a' "$KEMERBET_READINESS_PLAYER_IDS")" == "$player_ids_stat" &&
      "$(sha256sum -- "$KEMERBET_READINESS_PLAYER_IDS" | awk '{print $1}')" == "$player_ids_digest" &&
      "$observed_profile_identity_digest" == "$profile_identity_digest" ]] ||
      die 'a KemerBet recheck input or profile identity changed during execution'

    remove_kemerbet_recheck_container || die 'the transient KemerBet recheck container could not be removed'
    remove_kemerbet_recheck_network || die 'the transient KemerBet recheck network could not be removed'
    require_kemerbet_profile_volume_holders ''

    [[ ! -e "$KEMERBET_AGENT_IDENTITY_BINDINGS" && ! -L "$KEMERBET_AGENT_IDENTITY_BINDINGS" ]] ||
      die 'the fixed KemerBet identity binding appeared before finalization'
    ln -- "$KEMERBET_RECHECK_CANDIDATE_BINDING" "$KEMERBET_AGENT_IDENTITY_BINDINGS" ||
      die 'the fixed KemerBet identity binding could not be installed without overwrite'
    KEMERBET_RECHECK_FINAL_INSTALLED='true'
    sync -f "$secret_parent" || die 'the fixed KemerBet identity binding directory could not be synchronized'
    require_root_readable_immutable_file "$KEMERBET_AGENT_IDENTITY_BINDINGS"
    [[ "$(stat --format='%d:%i:%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
      "$KEMERBET_RECHECK_CANDIDATE_DEV_INO:2" &&
      "$(sha256sum -- "$KEMERBET_AGENT_IDENTITY_BINDINGS" | awk '{print $1}')" == "$source_digest" ]] ||
      die 'the fixed KemerBet identity binding is not an exact precommit hard link'
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_precommit_kemerbet_artifact_boundary \
      "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-absent-receipt

    KEMERBET_RECHECK_RECEIPT_OWNED='true'
    record_kemerbet_recheck_receipt \
      "$commit_sha" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest"
    require_kemerbet_recheck_receipt \
      "$commit_sha" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest"
    require_kemerbet_recheck_promotion_journal \
      "$commit_sha" "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$identity_key_digest" "$selector_digest" "$image_id" "$profile_identity_digest" \
      "$journal_session_container" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_OWNER_STAGE_CLAIM_DEV_INO" "$KEMERBET_RECHECK_OWNER_CLAIM_ID" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_precommit_kemerbet_artifact_boundary \
      "$source_dev_ino" "$KEMERBET_RECHECK_CANDIDATE_DEV_INO" "$source_digest" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST"
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-receipt
    KEMERBET_RECHECK_DURABLE_SUCCESS='true'

    consume_exact_one_use_kemerbet_file \
      "$KEMERBET_READINESS_PLAYER_IDS" "$KEMERBET_RECHECK_PLAYER_IDS_DEV_INO" \
      "$KEMERBET_RECHECK_PLAYER_IDS_DIGEST" ||
      die 'the committed one-use KemerBet Player-ID file could not be removed'
    remove_kemerbet_recheck_candidate ||
      die 'the committed KemerBet recheck binding candidate could not be retired'
    KEMERBET_RECHECK_CANDIDATE_CREATED='false'
    [[ "$(stat --format='%d:%i:%h' "$KEMERBET_AGENT_IDENTITY_BINDINGS")" == \
      "${KEMERBET_RECHECK_CANDIDATE_DEV_INO}:1" ]] ||
      die 'the committed KemerBet identity binding retains an unexpected hard link'
    consume_exact_kemerbet_binding_source "$source_dev_ino" "$source_digest" ||
      die 'the committed KemerBet binding source could not be removed'
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-receipt
    [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'a committed KemerBet cleanup input remains before Owner completion'
    complete_owner_staged_kemerbet_cohort ||
      die 'the completed Owner KemerBet cohort could not be finalized'
    require_completed_owner_kemerbet_cohort_marker
    require_committed_kemerbet_recheck_boundary_shape
    require_current_kemerbet_success_runtime_boundary \
      "$commit_sha" "$source_digest" "$identity_key_digest" "$selector_digest" \
      "$image_id" "$profile_identity_digest" require-receipt
    [[ ! -e "$KEMERBET_READINESS_PLAYER_IDS" && ! -L "$KEMERBET_READINESS_PLAYER_IDS" &&
      ! -e "$KEMERBET_RECHECK_CANDIDATE_ROOT" && ! -L "$KEMERBET_RECHECK_CANDIDATE_ROOT" &&
      ! -e "$KEMERBET_READINESS_BINDING" && ! -L "$KEMERBET_READINESS_BINDING" ]] ||
      die 'the completed KemerBet boundary retained a consumed input'
    remove_owned_kemerbet_recheck_promotion_root ||
      die 'the committed KemerBet promotion journal could not be retired'
    KEMERBET_RECHECK_PROMOTION_OWNED='false'
    KEMERBET_RECHECK_COMMITTED='true'
    KEMERBET_RECHECK_CLEANUP_ARMED='false'
    trap - EXIT INT TERM HUP
    printf '%s\n' 'KemerBet server readiness passed: 5 of 5 Players, Transfer disabled.'
    ;;

  stop-kemerbet-session-provision)
    [[ $# -eq 2 ]] ||
      die 'stop-kemerbet-session-provision requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      require_kemerbet_teardown_recovery_success
    fi
    session_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=kemerbet-session-provision')"
    if [[ -n "$session_container" ]]; then
      [[ "$session_container" =~ ^[0-9a-f]{12,64}$ ]] ||
        die 'the private KemerBet session container inventory is ambiguous'
      docker_local container stop --time 70 "$session_container" >/dev/null
      docker_local container rm "$session_container" >/dev/null
    fi
    require_exact_fresh_bot_runtime "$commit_sha" published-steady-state
    require_kemerbet_teardown_recovery_success
    ;;

  public-edge-ready|fresh-public-edge-ready)
    [[ $# -eq 2 ]] || die 'public-edge readiness requires one reviewed main commit'
    if [[ "$command" == 'fresh-public-edge-ready' ]]; then
      require_fresh_public_edge_ready "$2"
    else
      require_public_edge_ready "$2"
    fi
    ;;

  start-public-edge|start-fresh-public-edge)
    [[ $# -eq 3 ]] || die 'public-edge start requires a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    compose_file="$RELEASE_ROOT/$commit_sha/infra/compose.staging-beta.yaml"
    [[ ! -L "$compose_file" && "$(stat --format='%U:%G:%a' "$compose_file")" == 'root:root:444' ]] ||
      die 'the sealed Compose contract is absent or unsafe'
    [[ "$(docker_local image inspect "fetanagent-gateway:$image_tag" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the gateway image revision does not match the reviewed commit'
    if [[ "$command" == 'start-fresh-public-edge' ]]; then
      require_fresh_public_edge_ready "$commit_sha"
      require_exact_fresh_bot_runtime "$commit_sha" steady-state
    else
      require_public_edge_ready "$commit_sha"
      require_exact_private_runtime "$commit_sha"
    fi

    [[ ! -L "$GATEWAY_STATE_ROOT" && ! -L "$GATEWAY_STATE_ROOT/data" && ! -L "$GATEWAY_STATE_ROOT/config" ]] ||
      die 'a gateway state path is a symbolic link'
    install -d -o root -g root -m 0755 "$GATEWAY_STATE_ROOT"
    install -d -o 10001 -g 10001 -m 0700 "$GATEWAY_STATE_ROOT/data" "$GATEWAY_STATE_ROOT/config"
    [[ ! -L "$GATEWAY_STATE_ROOT" && "$(stat --format='%U:%G:%a' "$GATEWAY_STATE_ROOT")" == 'root:root:755' ]] ||
      die 'the gateway state root ownership or mode is unsafe'
    for state_directory in data config; do
      [[ ! -L "$GATEWAY_STATE_ROOT/$state_directory" && "$(stat --format='%u:%g:%a' "$GATEWAY_STATE_ROOT/$state_directory")" == '10001:10001:700' ]] ||
        die 'a gateway state directory ownership or mode is unsafe'
    done

    compose_environment=(
      PATH="$SAFE_PATH"
      HOME='/root'
      DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
      FETANAGENT_VCS_REF="$commit_sha"
      FETANAGENT_IMAGE_TAG="$image_tag"
      FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE="$SECRET_ROOT/owner-database-url"
      FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE="$SECRET_ROOT/customer-web-database-url"
      FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE="$SECRET_ROOT/customer-web-publishable-key"
      FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE="$SECRET_ROOT/customer-web-rate-limit-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE="$SECRET_ROOT/beta-database-url"
      FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/beta-transport-hmac"
      FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/beta-payload-hmac"
      FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE="$SECRET_ROOT/player-action-database-url"
      FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/api-action-transport-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE="$SECRET_ROOT/api-action-payload-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE="$SECRET_ROOT/api-action-capability-hmac"
      FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE="$SECRET_ROOT/api-action-semantic-hmac"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-encryption-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE="$SECRET_ROOT/cbe-deposit-reference-fingerprint-key"
      FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE="$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-encryption-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE="$SECRET_ROOT/deposit-proof-reference-fingerprint-master"
      FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE="$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual --profile public-domain -f "$compose_file"
    )
    if [[ "$command" == 'start-fresh-public-edge' ]]; then
      require_fresh_public_edge_ready "$commit_sha"
    else
      require_public_edge_ready "$commit_sha"
    fi
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      up -d --no-build --wait --wait-timeout 90 gateway
    ;;

  stop-public-edge)
    [[ $# -eq 1 ]] || die 'stop-public-edge accepts no additional arguments'
    recover_kemerbet_recheck_before_teardown
    if [[ "$KEMERBET_TEARDOWN_RECOVERY_FAILED" == 'true' ]]; then
      emergency_stop_project_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      emergency_disarm_expiry_stop_after_kemerbet_recovery_failure ||
        KEMERBET_EMERGENCY_TEARDOWN_FAILED='true'
      require_kemerbet_teardown_recovery_success
    fi
    gateway_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=gateway')"
    if [[ -n "$gateway_container" ]]; then
      [[ "$gateway_container" =~ ^[0-9a-f]{12,64}$ ]] || die 'the gateway container inventory is ambiguous'
      docker_local container rm --force "$gateway_container" >/dev/null
    fi
    require_kemerbet_teardown_recovery_success
    ;;

  diagnose-owner-startup)
    [[ $# -eq 3 ]] || die 'diagnose-owner-startup requires a commit and image tag'
    commit_sha="$2"
    image_tag="$3"
    validate_commit_and_tag "$commit_sha" "$image_tag"
    owner_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=owner-control')"
    [[ "$owner_container" =~ ^[0-9a-f]{12,64}$ ]] ||
      die 'exactly one Owner-control container was not available for diagnostics'
    [[ "$(docker_local container inspect "$owner_container" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$commit_sha" ]] ||
      die 'the Owner-control diagnostic target does not match the reviewed commit'

    docker_local container inspect "$owner_container" \
      --format 'owner-control status={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}}'
    printf '%s\n' 'owner-control bounded startup log follows:'
    docker_local container logs --tail 80 "$owner_container"
    ;;

  *)
    die 'expected verify, stop, arm-expiry-stop, expiry-stop, cutover-ready, fresh-host-ready, network-ready, public-edge-ready, fresh-public-edge-ready, discard, install, start, fresh-start, bot-disabled-ready, install-bot-token, start-bot, bot-ready, stop-bot, start-kemerbet-session-provision, kemerbet-session-provision-ready, seal-kemerbet-readiness, recheck-kemerbet-readiness, stop-kemerbet-session-provision, start-public-edge, start-fresh-public-edge, stop-public-edge, or diagnose-owner-startup'
    ;;
esac
