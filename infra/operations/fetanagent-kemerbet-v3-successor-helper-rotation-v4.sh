#!/usr/bin/env bash
# One-use, root-console-only fourth rotation of an installed KemerBet v3 successor helper.
# The immutable v2-to-v3 evidence and first three helper-rotation links remain untouched;
# this operation appends one exact fourth link, keeps staging stopped, and never
# enables Transfer.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly BASE_PARENT='/var/lib/fetanagent/kemerbet-readiness-v2-v3-successor'
readonly FIRST_ROTATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation'
readonly SECOND_ROTATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v2'
readonly PREDECESSOR_ROTATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v3'
readonly ROTATION_PARENT='/var/lib/fetanagent/kemerbet-readiness-v3-helper-rotation-v4'
readonly SOURCE='/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
readonly RETIREMENT_ROOT='/var/lib/fetanagent/kemerbet-readiness-binding-v1-retirement'
readonly IDENTITY_KEY='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_hmac_key'
readonly COMMITTED_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly RECHECK_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck'
readonly OWNER_COMPLETION='/var/lib/fetanagent/kemerbet-readiness-cohort-receipts/kemerbet-readiness-cohort-completed-v1'
readonly RECHECK_PROMOTION_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck-promotion'
readonly RECHECK_CANDIDATE_ROOT='/etc/fetanagent/executor-secrets/.kemerbet-readiness-recheck-candidate'
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly FIRST_ROTATION_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v3-rotation-disabled'
readonly SECOND_ROTATION_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v3-rotation-v2-disabled'
readonly PREDECESSOR_SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v3-rotation-v3-disabled'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.v3-rotation-v4-disabled'
readonly FIRST_ROTATION_INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-installing'
readonly FIRST_ROTATION_INSTALLING_HELPER_PARTIAL="${FIRST_ROTATION_INSTALLING_HELPER}.partial"
readonly SECOND_ROTATION_INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-v2-installing'
readonly SECOND_ROTATION_INSTALLING_HELPER_PARTIAL="${SECOND_ROTATION_INSTALLING_HELPER}.partial"
readonly PREDECESSOR_INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-v3-installing'
readonly PREDECESSOR_INSTALLING_HELPER_PARTIAL="${PREDECESSOR_INSTALLING_HELPER}.partial"
readonly FIRST_ROTATION_ROLLBACK_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-rollback'
readonly FIRST_ROTATION_ROLLBACK_HELPER_PARTIAL="${FIRST_ROTATION_ROLLBACK_HELPER}.partial"
readonly SECOND_ROTATION_ROLLBACK_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-v2-rollback'
readonly SECOND_ROTATION_ROLLBACK_HELPER_PARTIAL="${SECOND_ROTATION_ROLLBACK_HELPER}.partial"
readonly PREDECESSOR_ROLLBACK_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-v3-rollback'
readonly PREDECESSOR_ROLLBACK_HELPER_PARTIAL="${PREDECESSOR_ROLLBACK_HELPER}.partial"
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-v4-installing'
readonly INSTALLING_HELPER_PARTIAL="${INSTALLING_HELPER}.partial"
readonly ROLLBACK_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.v3-rotation-v4-rollback'
readonly ROLLBACK_HELPER_PARTIAL="${ROLLBACK_HELPER}.partial"
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly BASE_SUCCESSOR_RELEASE='de14588d4e5b8ee9e80a1a667f2e4d59ef6a62e3'
readonly BASE_SUCCESSOR_HELPER_SHA256='e94dfdcfe90ff6021446fc66e2850ae13198b03d9e2210f454181ab00177f97d'
readonly FIRST_ROTATION_RELEASE='8fe693b51b5426c3f358bba67519459161a0ebf9'
readonly FIRST_ROTATION_HELPER_SHA256='f98047953fb9249d7dbcd13be6cf1a145b53a4952a760b36d5ba8bfab2f36f82'
readonly SECOND_ROTATION_RELEASE='4bb491943fb88c50b86166184b929bdbe2698dc4'
readonly SECOND_ROTATION_HELPER_SHA256='05b0f2c8eb68716d20ad4878f1fff96c2f6a22e532e0b9c52a664e153b49e6fe'
readonly PREDECESSOR_RELEASE='9c83821b4959f5ac52b0d642e476063ca7f3590e'
readonly PREDECESSOR_HELPER_SHA256='020b2b2d7eca153dffd72d7811d58c1a93e41edc24d1217cb459f5828e549b7b'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='8ae567bb50581288600ef8058553fb411d6b04d1177a275b4e59bed936bb1db6'
readonly CONFIRMATION='I-UNDERSTAND-THIS-APPENDS-FOURTH-V3-HELPER-ROTATION-WITH-TRANSFER-DISABLED'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly KEMERBET_PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly KEMERBET_SESSION_CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly KEMERBET_RECHECK_SNAPSHOT_VOLUME="$PROJECT_NAME-kemerbet-readiness-profile-snapshot-once"
readonly KEMERBET_RECHECK_RPC_ROOT='/run/fetanagent-kemerbet-readiness-rpc-v1'
readonly BOT_STARTUP_RECEIPT_ROOT='/var/lib/fetanagent-bot-startup-receipt'
readonly EXPIRY_STOP_SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly EXPIRY_STOP_TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly EXPIRY_STOP_SERVICE_PATH="/etc/systemd/system/$EXPIRY_STOP_SERVICE"
readonly EXPIRY_STOP_TIMER_PATH="/etc/systemd/system/$EXPIRY_STOP_TIMER"
readonly ROTATION_INTENT_NAME='intent-v1'
readonly ROTATION_COMPLETION_NAME='completed-v1'
readonly HELPER_ARCHIVE_NAME='predecessor-helper'

export PATH="$SAFE_PATH"
umask 022

die() {
  printf 'FetanAgent v3 fourth helper rotation failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] ||
  die 'expected successor release, successor helper digest, and exact confirmation'

readonly SUCCESSOR_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly STAGING_ROOT="/root/fetanagent-v3-helper-rotation-v4-$SUCCESSOR_RELEASE"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly ROTATION_ROOT="$ROTATION_PARENT/$SUCCESSOR_RELEASE"
readonly ROTATION_INSTALLING="${ROTATION_ROOT}.installing"

[[ "$SUCCESSOR_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$SUCCESSOR_RELEASE" != "$PREDECESSOR_RELEASE" &&
  "$SUCCESSOR_RELEASE" != "$SECOND_ROTATION_RELEASE" &&
  "$SUCCESSOR_RELEASE" != "$FIRST_ROTATION_RELEASE" &&
  "$SUCCESSOR_RELEASE" != "$BASE_SUCCESSOR_RELEASE" ]] ||
  die 'the successor must be a distinct forward full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$SECOND_ROTATION_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$FIRST_ROTATION_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$BASE_SUCCESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper must have a distinct lowercase SHA-256 digest'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" ]] ||
  die 'the supplied successor helper digest is not the hard-pinned reviewed artifact'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] || die 'the exact one-use confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this operation only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash cmp curl docker env find flock id mkdir mv python3 realpath runuser \
  sha256sum sort stat sudo sync systemctl visudo; do
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

run_predecessor_helper() {
  runuser -u fetanagent-admin -- sudo -n "$TARGET" "$@"
}

run_successor_helper_direct() {
  env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' "$TARGET" "$@"
}

docker_local_read_only() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

COMPOSE5_DURABLE_VOLUME_DIGEST=''
COMPOSE5_PROFILE_CONFIG_HASH=''
COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
COMPOSE5_VOLUME_VERSION=''

require_compose5_durable_volume_compatibility() {
  local compose_config_hash compose_version contract control_contract driver expected_volumes
  local expected_volume_label holders label_count mountpoint name options profile_contract
  local project project_volumes residue scope volume volume_label
  COMPOSE5_DURABLE_VOLUME_DIGEST=''
  COMPOSE5_PROFILE_CONFIG_HASH=''
  COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
  COMPOSE5_VOLUME_VERSION=''
  project_volumes="$(docker_local_read_only volume ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | LC_ALL=C sort)" || return 1
  expected_volumes="$(printf '%s\n%s\n' \
    "$KEMERBET_PROFILE_VOLUME" "$KEMERBET_SESSION_CONTROL_VOLUME" | LC_ALL=C sort)"
  [[ "$project_volumes" == "$expected_volumes" ]] || return 1
  for volume in "$KEMERBET_PROFILE_VOLUME" "$KEMERBET_SESSION_CONTROL_VOLUME"; do
    case "$volume" in
      "$KEMERBET_PROFILE_VOLUME") expected_volume_label='kemerbet_sessions' ;;
      "$KEMERBET_SESSION_CONTROL_VOLUME") expected_volume_label='kemerbet_session_control' ;;
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
    if [[ -z "$COMPOSE5_VOLUME_VERSION" ]]; then
      COMPOSE5_VOLUME_VERSION="$compose_version"
    else
      [[ "$compose_version" == "$COMPOSE5_VOLUME_VERSION" ]] || return 1
    fi
    holders="$(docker_local_read_only container ls --all --quiet --filter "volume=$volume")" ||
      return 1
    [[ -z "$holders" ]] || return 1
    case "$volume" in
      "$KEMERBET_PROFILE_VOLUME")
        [[ "$(stat --format='%u:%g:%a' "$mountpoint")" == '10001:10001:700' ]] || return 1
        COMPOSE5_PROFILE_CONFIG_HASH="$compose_config_hash"
        profile_contract="$contract"
        ;;
      "$KEMERBET_SESSION_CONTROL_VOLUME")
        [[ "$(stat --format='%u:%g:%a:%h' "$mountpoint")" == '10001:10001:700:2' ]] ||
          return 1
        COMPOSE5_SESSION_CONTROL_CONFIG_HASH="$compose_config_hash"
        control_contract="$contract"
        ;;
    esac
  done
  COMPOSE5_DURABLE_VOLUME_DIGEST="$({
    printf '%s\n' \
      "profile_contract=$profile_contract" \
      "control_contract=$control_contract" \
      "profile=$(stat --format='%d:%i:%u:%g:%a' "/var/lib/docker/volumes/$KEMERBET_PROFILE_VOLUME/_data")" \
      "control=$(stat --format='%d:%i:%u:%g:%a:%h' "/var/lib/docker/volumes/$KEMERBET_SESSION_CONTROL_VOLUME/_data")"
  } | sha256sum | awk '{print $1}')" || return 1
  [[ "$COMPOSE5_DURABLE_VOLUME_DIGEST" =~ ^[0-9a-f]{64}$ &&
    "$COMPOSE5_PROFILE_CONFIG_HASH" =~ ^[0-9a-f]{64}$ &&
    "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" =~ ^[0-9a-f]{64}$ ]]
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

require_stopped_no_transfer_boundary() {
  local containers networks
  containers="$(docker_local_read_only container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  networks="$(docker_local_read_only network ls --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  [[ -z "$containers" && -z "$networks" ]] || return 1
  require_expiry_guard_disarmed || return 1
  require_no_recheck_transients || return 1
  [[ ! -e "$BOT_STARTUP_RECEIPT_ROOT" && ! -L "$BOT_STARTUP_RECEIPT_ROOT" ]] || return 1
  require_compose5_durable_volume_compatibility
}

ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST=''
ROTATION_COMPOSE5_PROFILE_CONFIG_HASH=''
ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
ROTATION_COMPOSE5_VOLUME_VERSION=''

capture_rotation_durable_boundary() {
  [[ "$COMPOSE5_DURABLE_VOLUME_DIGEST" =~ ^[0-9a-f]{64}$ &&
    "$COMPOSE5_PROFILE_CONFIG_HASH" =~ ^[0-9a-f]{64}$ &&
    "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" =~ ^[0-9a-f]{64}$ &&
    "$COMPOSE5_VOLUME_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+~-][0-9A-Za-z._-]+)?$ ]] ||
    return 1
  ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST="$COMPOSE5_DURABLE_VOLUME_DIGEST"
  ROTATION_COMPOSE5_PROFILE_CONFIG_HASH="$COMPOSE5_PROFILE_CONFIG_HASH"
  ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH="$COMPOSE5_SESSION_CONTROL_CONFIG_HASH"
  ROTATION_COMPOSE5_VOLUME_VERSION="$COMPOSE5_VOLUME_VERSION"
}

require_preserved_rotation_durable_boundary() {
  local durable_digest="$ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST"
  local profile_hash="$ROTATION_COMPOSE5_PROFILE_CONFIG_HASH"
  local session_control_hash="$ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH"
  local volume_version="$ROTATION_COMPOSE5_VOLUME_VERSION"
  [[ "$durable_digest" =~ ^[0-9a-f]{64}$ && "$profile_hash" =~ ^[0-9a-f]{64}$ &&
    "$session_control_hash" =~ ^[0-9a-f]{64}$ &&
    "$volume_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+~-][0-9A-Za-z._-]+)?$ ]] || return 1
  require_stopped_no_transfer_boundary || return 1
  [[ "$COMPOSE5_DURABLE_VOLUME_DIGEST" == "$durable_digest" &&
    "$COMPOSE5_PROFILE_CONFIG_HASH" == "$profile_hash" &&
    "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" == "$session_control_hash" &&
    "$COMPOSE5_VOLUME_VERSION" == "$volume_version" ]]
}

BASE_SUCCESSOR_INTENT_SHA256=''
BASE_SUCCESSOR_COMPLETION_SHA256=''
BASE_BINDING_V2_SHA256=''
BASE_PREDECESSOR_HELPER_SHA256=''
BASE_BINDING_V3_SHA256=''

load_exact_base_successor_evidence() {
  local inspection
  inspection="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$BASE_PARENT" "$SOURCE" "$BASE_SUCCESSOR_RELEASE" "$BASE_SUCCESSOR_HELPER_SHA256" \
    "$RETIREMENT_ROOT" "$IDENTITY_KEY" "$COMMITTED_BINDING" "$RECHECK_RECEIPT_ROOT" \
    "$OWNER_COMPLETION" "$RECHECK_PROMOTION_ROOT" "$RECHECK_CANDIDATE_ROOT" \
    "$KEMERBET_RECHECK_RPC_ROOT" <<'PY'
import hashlib
import os
import re
import stat
import sys

(
    parent,
    source,
    expected_release,
    expected_helper,
    retirement,
    identity_key,
    committed_binding,
    recheck_receipt_root,
    owner_completion,
    promotion_root,
    candidate_root,
    rpc_root,
) = sys.argv[1:]
sha = re.compile(r'[0-9a-f]{64}')
release = re.compile(r'[0-9a-f]{40}')
dev_ino = re.compile(r'[0-9]+:[0-9]+')
uuid = rb'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
v2 = re.compile(
    b'(' + uuid + rb') hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'sha256-provider-authorization-v1:[0-9a-f]{64}\n'
)
v3 = re.compile(
    b'(' + uuid + rb') hmac-sha256-agent-identity-v1:([0-9a-f]{64}) '
    rb'hmac-sha256-agent-profile-pin-v3:\2\n'
)


def reject():
    raise RuntimeError()


def exact_directory(path, entries):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path
        or sorted(os.listdir(path)) != entries
    ):
        reject()


def exact_file(path, owner, mode, maximum, exact_size=None):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid) != owner
            or stat.S_IMODE(before.st_mode) != mode
            or before.st_nlink != 1
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size > maximum
            or (exact_size is not None and before.st_size != exact_size)
            or os.path.realpath(path) != path
        ):
            reject()
        data = bytearray()
        while len(data) <= maximum:
            chunk = os.read(descriptor, maximum + 1 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (
            (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
             before.st_nlink, before.st_size, before.st_mtime_ns) !=
            (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
             after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            reject()
        return bytes(data)
    finally:
        os.close(descriptor)


exact_directory(parent, [expected_release])
root = f'{parent}/{expected_release}'
exact_directory(root, ['binding-v2', 'completed-v1', 'intent-v1', 'predecessor-helper'])
intent_data = exact_file(f'{root}/intent-v1', (0, 0), 0o600, 4096)
completion_data = exact_file(f'{root}/completed-v1', (0, 0), 0o600, 4096)
binding_v2 = exact_file(f'{root}/binding-v2', (0, 0), 0o400, 230, 230)
old_helper = exact_file(f'{root}/predecessor-helper', (0, 0), 0o400, 2 * 1024 * 1024)
binding_v3 = exact_file(source, (10001, 10001), 0o600, 230, 230)
intent = intent_data.decode('ascii').splitlines()
completion = completion_data.decode('ascii').splitlines()
v2_match = v2.fullmatch(binding_v2)
v3_match = v3.fullmatch(binding_v3)
if (
    len(intent) != 9
    or len(completion) != 10
    or intent[0] != 'contract=fetanagent-kemerbet-readiness-v2-v3-successor-v1'
    or intent[1] != 'state=authorized'
    or not intent[2].startswith('predecessor_release=')
    or release.fullmatch(intent[2].split('=', 1)[1]) is None
    or intent[2].split('=', 1)[1] == expected_release
    or intent[3] != f'successor_release={expected_release}'
    or not intent[4].startswith('predecessor_helper_sha256=')
    or sha.fullmatch(intent[4].split('=', 1)[1]) is None
    or intent[5] != f'successor_helper_sha256={expected_helper}'
    or not intent[6].startswith('v2_binding_sha256=')
    or sha.fullmatch(intent[6].split('=', 1)[1]) is None
    or not intent[7].startswith('retirement_intent_sha256=')
    or sha.fullmatch(intent[7].split('=', 1)[1]) is None
    or not intent[8].startswith('retirement_completion_sha256=')
    or sha.fullmatch(intent[8].split('=', 1)[1]) is None
    or completion[:1] != intent[:1]
    or completion[1] != 'state=successor-installed'
    or completion[2:9] != intent[2:9]
    or not completion[9].startswith('v3_binding_sha256=')
    or sha.fullmatch(completion[9].split('=', 1)[1]) is None
    or hashlib.sha256(binding_v2).hexdigest() != intent[6].split('=', 1)[1]
    or hashlib.sha256(old_helper).hexdigest() != intent[4].split('=', 1)[1]
    or hashlib.sha256(binding_v3).hexdigest() != completion[9].split('=', 1)[1]
    or v2_match is None
    or v3_match is None
    or v2_match.group(1) != v3_match.group(1)
    or v2_match.group(2) != v3_match.group(2)
    or intent_data != ('\n'.join(intent) + '\n').encode('ascii')
    or completion_data != ('\n'.join(completion) + '\n').encode('ascii')
):
    reject()

predecessor_release = intent[2].split('=', 1)[1]
predecessor_helper_sha = intent[4].split('=', 1)[1]
retirement_intent_sha = intent[7].split('=', 1)[1]
retirement_completion_sha = intent[8].split('=', 1)[1]
exact_directory(retirement, ['completed-v1', 'intent-v1'])
retirement_intent_data = exact_file(f'{retirement}/intent-v1', (0, 0), 0o600, 4096)
retirement_completion_data = exact_file(f'{retirement}/completed-v1', (0, 0), 0o600, 4096)
retirement_intent = retirement_intent_data.decode('ascii').splitlines()
retirement_completion = retirement_completion_data.decode('ascii').splitlines()
if (
    len(retirement_intent) != 14
    or len(retirement_completion) != 16
    or retirement_intent[0] != 'contract=fetanagent-kemerbet-readiness-binding-v1-retirement-v1'
    or retirement_intent[1] != 'state=retirement-authorized'
    or retirement_intent[2] != f'release={predecessor_release}'
    or not retirement_intent[3].startswith('helper_dev_ino=')
    or dev_ino.fullmatch(retirement_intent[3].split('=', 1)[1]) is None
    or retirement_intent[4] != f'helper_sha256={predecessor_helper_sha}'
    or not retirement_intent[5].startswith('legacy_binding_dev_ino=')
    or dev_ino.fullmatch(retirement_intent[5].split('=', 1)[1]) is None
    or not retirement_intent[6].startswith('legacy_binding_sha256=')
    or sha.fullmatch(retirement_intent[6].split('=', 1)[1]) is None
    or not retirement_intent[7].startswith('identity_hmac_key_dev_ino=')
    or dev_ino.fullmatch(retirement_intent[7].split('=', 1)[1]) is None
    or not retirement_intent[8].startswith('identity_hmac_key_sha256=')
    or sha.fullmatch(retirement_intent[8].split('=', 1)[1]) is None
    or not retirement_intent[9].startswith('claim_sha256=')
    or sha.fullmatch(retirement_intent[9].split('=', 1)[1]) is None
    or not retirement_intent[10].startswith('owner_stage_player_ids_dev_ino=')
    or dev_ino.fullmatch(retirement_intent[10].split('=', 1)[1]) is None
    or not retirement_intent[11].startswith('owner_stage_player_ids_sha256=')
    or sha.fullmatch(retirement_intent[11].split('=', 1)[1]) is None
    or not retirement_intent[12].startswith('owner_stage_claim_dev_ino=')
    or dev_ino.fullmatch(retirement_intent[12].split('=', 1)[1]) is None
    or not retirement_intent[13].startswith('release_asset_sha256=')
    or sha.fullmatch(retirement_intent[13].split('=', 1)[1]) is None
    or retirement_completion[:1] != retirement_intent[:1]
    or retirement_completion[1] != 'state=resealed-v2'
    or retirement_completion[2:14] != retirement_intent[2:14]
    or not retirement_completion[14].startswith('v2_binding_dev_ino=')
    or dev_ino.fullmatch(retirement_completion[14].split('=', 1)[1]) is None
    or retirement_completion[15] != f'v2_binding_sha256={hashlib.sha256(binding_v2).hexdigest()}'
    or hashlib.sha256(retirement_intent_data).hexdigest() != retirement_intent_sha
    or hashlib.sha256(retirement_completion_data).hexdigest() != retirement_completion_sha
    or retirement_intent_data != ('\n'.join(retirement_intent) + '\n').encode('ascii')
    or retirement_completion_data != ('\n'.join(retirement_completion) + '\n').encode('ascii')
):
    reject()

identity_key_stat = os.stat(identity_key, follow_symlinks=False)
identity_key_owner_mode = (
    identity_key_stat.st_uid,
    identity_key_stat.st_gid,
    stat.S_IMODE(identity_key_stat.st_mode),
)
if identity_key_owner_mode == (0, 0, 0o444):
    identity_key_data = exact_file(identity_key, (0, 0), 0o444, 64, 64)
elif identity_key_owner_mode == (10001, 10001, 0o400):
    identity_key_data = exact_file(identity_key, (10001, 10001), 0o400, 64, 64)
else:
    reject()
if (
    retirement_intent[7] !=
       f'identity_hmac_key_dev_ino={identity_key_stat.st_dev}:{identity_key_stat.st_ino}'
    or retirement_intent[8] !=
       f'identity_hmac_key_sha256={hashlib.sha256(identity_key_data).hexdigest()}'
):
    reject()

for forbidden_installed_residue in (
    committed_binding,
    recheck_receipt_root,
    owner_completion,
    promotion_root,
    candidate_root,
    rpc_root,
):
    if os.path.lexists(forbidden_installed_residue):
        reject()
print(hashlib.sha256(intent_data).hexdigest())
print(hashlib.sha256(completion_data).hexdigest())
print(hashlib.sha256(binding_v2).hexdigest())
print(hashlib.sha256(old_helper).hexdigest())
print(hashlib.sha256(binding_v3).hexdigest())
PY
)" || return 1
  mapfile -t evidence_lines <<<"$inspection"
  [[ "${#evidence_lines[@]}" -eq 5 ]] || return 1
  for value in "${evidence_lines[@]}"; do
    [[ "$value" =~ ^[0-9a-f]{64}$ ]] || return 1
  done
  BASE_SUCCESSOR_INTENT_SHA256="${evidence_lines[0]}"
  BASE_SUCCESSOR_COMPLETION_SHA256="${evidence_lines[1]}"
  BASE_BINDING_V2_SHA256="${evidence_lines[2]}"
  BASE_PREDECESSOR_HELPER_SHA256="${evidence_lines[3]}"
  BASE_BINDING_V3_SHA256="${evidence_lines[4]}"
}

PREDECESSOR_ROTATION_INTENT_SHA256=''
PREDECESSOR_ROTATION_COMPLETION_SHA256=''
PREDECESSOR_ROTATION_HELPER_ARCHIVE_SHA256=''
PREDECESSOR_ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST=''
PREDECESSOR_ROTATION_COMPOSE5_PROFILE_CONFIG_HASH=''
PREDECESSOR_ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH=''
PREDECESSOR_ROTATION_COMPOSE5_VOLUME_VERSION=''

load_exact_predecessor_rotation_evidence() {
  local inspection value
  local -a evidence_lines
  inspection="$(env -i PATH="$SAFE_PATH" python3 -I - \
    "$FIRST_ROTATION_PARENT" "$SECOND_ROTATION_PARENT" "$PREDECESSOR_ROTATION_PARENT" \
    "$BASE_SUCCESSOR_RELEASE" "$FIRST_ROTATION_RELEASE" \
    "$SECOND_ROTATION_RELEASE" "$PREDECESSOR_RELEASE" \
    "$BASE_SUCCESSOR_HELPER_SHA256" "$FIRST_ROTATION_HELPER_SHA256" \
    "$SECOND_ROTATION_HELPER_SHA256" "$PREDECESSOR_HELPER_SHA256" \
    "$BASE_SUCCESSOR_INTENT_SHA256" \
    "$BASE_SUCCESSOR_COMPLETION_SHA256" "$BASE_BINDING_V2_SHA256" \
    "$BASE_PREDECESSOR_HELPER_SHA256" "$BASE_BINDING_V3_SHA256" <<'PY'
import hashlib
import os
import re
import stat
import sys

(
    first_parent,
    second_parent,
    predecessor_parent,
    base_release,
    first_release,
    second_release,
    predecessor_release,
    base_helper,
    first_helper,
    second_helper,
    predecessor_helper,
    base_intent_sha,
    base_completion_sha,
    base_binding_v2_sha,
    base_old_helper_sha,
    base_binding_v3_sha,
) = sys.argv[1:]
sha = re.compile(r'[0-9a-f]{64}')
release = re.compile(r'[0-9a-f]{40}')
compose_version = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+(?:[+~-][0-9A-Za-z._-]+)?')


def reject():
    raise RuntimeError()


def exact_directory(path, entries):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path
        or sorted(os.listdir(path)) != entries
    ):
        reject()


def exact_file(path, mode, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink) !=
               (0, 0, mode, 1)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_size > maximum
            or os.path.realpath(path) != path
        ):
            reject()
        data = bytearray()
        while len(data) <= maximum:
            chunk = os.read(descriptor, maximum + 1 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
        named_after = os.lstat(path)
        if (
            (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
             before.st_nlink, before.st_size, before.st_mtime_ns) !=
            (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
             after.st_nlink, after.st_size, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            reject()
        return bytes(data)
    finally:
        os.close(descriptor)


if (
    any(release.fullmatch(value) is None for value in
        (base_release, first_release, second_release, predecessor_release))
    or len({base_release, first_release, second_release, predecessor_release}) != 4
    or any(sha.fullmatch(value) is None for value in
           (base_helper, first_helper, second_helper, predecessor_helper, base_intent_sha,
            base_completion_sha, base_binding_v2_sha, base_old_helper_sha,
            base_binding_v3_sha))
    or len({base_helper, first_helper, second_helper, predecessor_helper}) != 4
):
    reject()

exact_directory(first_parent, [first_release])
first_root = f'{first_parent}/{first_release}'
exact_directory(first_root, ['completed-v1', 'intent-v1', 'predecessor-helper'])
first_intent_data = exact_file(f'{first_root}/intent-v1', 0o600, 4096)
first_completion_data = exact_file(f'{first_root}/completed-v1', 0o600, 4096)
first_archive = exact_file(f'{first_root}/predecessor-helper', 0o400, 2 * 1024 * 1024)
first_intent = first_intent_data.decode('ascii').splitlines()
first_completion = first_completion_data.decode('ascii').splitlines()
if (
    len(first_intent) != 15
    or len(first_completion) != 16
    or first_intent[0] != 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v1'
    or first_intent[1] != 'state=authorized'
    or first_intent[2] != f'predecessor_release={base_release}'
    or first_intent[3] != f'successor_release={first_release}'
    or first_intent[4] != f'predecessor_helper_sha256={base_helper}'
    or first_intent[5] != f'successor_helper_sha256={first_helper}'
    or first_intent[6] != f'base_successor_intent_sha256={base_intent_sha}'
    or first_intent[7] != f'base_successor_completion_sha256={base_completion_sha}'
    or first_intent[8] != f'base_binding_v2_sha256={base_binding_v2_sha}'
    or first_intent[9] != f'base_predecessor_helper_sha256={base_old_helper_sha}'
    or first_intent[10] != f'base_binding_v3_sha256={base_binding_v3_sha}'
    or not first_intent[11].startswith('compose5_durable_volume_digest=')
    or sha.fullmatch(first_intent[11].split('=', 1)[1]) is None
    or not first_intent[12].startswith('compose5_profile_config_hash=')
    or sha.fullmatch(first_intent[12].split('=', 1)[1]) is None
    or not first_intent[13].startswith('compose5_session_control_config_hash=')
    or sha.fullmatch(first_intent[13].split('=', 1)[1]) is None
    or not first_intent[14].startswith('compose5_volume_version=')
    or compose_version.fullmatch(first_intent[14].split('=', 1)[1]) is None
    or first_completion[:1] != first_intent[:1]
    or first_completion[1] != 'state=successor-installed'
    or first_completion[2:15] != first_intent[2:15]
    or first_completion[15] !=
       f'rotation_intent_sha256={hashlib.sha256(first_intent_data).hexdigest()}'
    or first_intent_data != ('\n'.join(first_intent) + '\n').encode('ascii')
    or first_completion_data != ('\n'.join(first_completion) + '\n').encode('ascii')
    or hashlib.sha256(first_archive).hexdigest() != base_helper
):
    reject()

exact_directory(second_parent, [second_release])
second_root = f'{second_parent}/{second_release}'
exact_directory(second_root, ['completed-v1', 'intent-v1', 'predecessor-helper'])
second_intent_data = exact_file(f'{second_root}/intent-v1', 0o600, 4096)
second_completion_data = exact_file(f'{second_root}/completed-v1', 0o600, 4096)
second_archive = exact_file(
    f'{second_root}/predecessor-helper',
    0o400,
    2 * 1024 * 1024,
)
second_intent = second_intent_data.decode('ascii').splitlines()
second_completion = second_completion_data.decode('ascii').splitlines()
if (
    len(second_intent) != 18
    or len(second_completion) != 19
    or second_intent[0] != 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v2'
    or second_intent[1] != 'state=authorized'
    or second_intent[2] != f'predecessor_release={first_release}'
    or second_intent[3] != f'successor_release={second_release}'
    or second_intent[4] != f'predecessor_helper_sha256={first_helper}'
    or second_intent[5] != f'successor_helper_sha256={second_helper}'
    or second_intent[6] != f'base_successor_intent_sha256={base_intent_sha}'
    or second_intent[7] != f'base_successor_completion_sha256={base_completion_sha}'
    or second_intent[8] != f'base_binding_v2_sha256={base_binding_v2_sha}'
    or second_intent[9] != f'base_predecessor_helper_sha256={base_old_helper_sha}'
    or second_intent[10] != f'base_binding_v3_sha256={base_binding_v3_sha}'
    or second_intent[11] !=
       f'predecessor_rotation_intent_sha256={hashlib.sha256(first_intent_data).hexdigest()}'
    or second_intent[12] !=
       f'predecessor_rotation_completion_sha256={hashlib.sha256(first_completion_data).hexdigest()}'
    or second_intent[13] !=
       f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(first_archive).hexdigest()}'
    or second_intent[14] != first_intent[11]
    or second_intent[15] != first_intent[12]
    or second_intent[16] != first_intent[13]
    or second_intent[17] != first_intent[14]
    or second_completion[:1] != second_intent[:1]
    or second_completion[1] != 'state=successor-installed'
    or second_completion[2:18] != second_intent[2:18]
    or second_completion[18] !=
       f'rotation_intent_sha256={hashlib.sha256(second_intent_data).hexdigest()}'
    or second_intent_data != ('\n'.join(second_intent) + '\n').encode('ascii')
    or second_completion_data != ('\n'.join(second_completion) + '\n').encode('ascii')
    or hashlib.sha256(second_archive).hexdigest() != first_helper
):
    reject()

exact_directory(predecessor_parent, [predecessor_release])
predecessor_root = f'{predecessor_parent}/{predecessor_release}'
exact_directory(predecessor_root, ['completed-v1', 'intent-v1', 'predecessor-helper'])
intent_data = exact_file(f'{predecessor_root}/intent-v1', 0o600, 4096)
completion_data = exact_file(f'{predecessor_root}/completed-v1', 0o600, 4096)
archived_helper = exact_file(f'{predecessor_root}/predecessor-helper', 0o400, 2 * 1024 * 1024)
intent = intent_data.decode('ascii').splitlines()
completion = completion_data.decode('ascii').splitlines()
if (
    len(intent) != 18
    or len(completion) != 19
    or intent[0] != 'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v3'
    or intent[1] != 'state=authorized'
    or intent[2] != f'predecessor_release={second_release}'
    or intent[3] != f'successor_release={predecessor_release}'
    or intent[4] != f'predecessor_helper_sha256={second_helper}'
    or intent[5] != f'successor_helper_sha256={predecessor_helper}'
    or intent[6] != f'base_successor_intent_sha256={base_intent_sha}'
    or intent[7] != f'base_successor_completion_sha256={base_completion_sha}'
    or intent[8] != f'base_binding_v2_sha256={base_binding_v2_sha}'
    or intent[9] != f'base_predecessor_helper_sha256={base_old_helper_sha}'
    or intent[10] != f'base_binding_v3_sha256={base_binding_v3_sha}'
    or intent[11] !=
       f'predecessor_rotation_intent_sha256={hashlib.sha256(second_intent_data).hexdigest()}'
    or intent[12] !=
       f'predecessor_rotation_completion_sha256={hashlib.sha256(second_completion_data).hexdigest()}'
    or intent[13] !=
       f'predecessor_rotation_helper_archive_sha256={hashlib.sha256(second_archive).hexdigest()}'
    or intent[14] != second_intent[14]
    or intent[15] != second_intent[15]
    or intent[16] != second_intent[16]
    or intent[17] != second_intent[17]
    or completion[:1] != intent[:1]
    or completion[1] != 'state=successor-installed'
    or completion[2:18] != intent[2:18]
    or completion[18] !=
       f'rotation_intent_sha256={hashlib.sha256(intent_data).hexdigest()}'
    or intent_data != ('\n'.join(intent) + '\n').encode('ascii')
    or completion_data != ('\n'.join(completion) + '\n').encode('ascii')
    or hashlib.sha256(archived_helper).hexdigest() != second_helper
):
    reject()

print(hashlib.sha256(intent_data).hexdigest())
print(hashlib.sha256(completion_data).hexdigest())
print(hashlib.sha256(archived_helper).hexdigest())
print(intent[14].split('=', 1)[1])
print(intent[15].split('=', 1)[1])
print(intent[16].split('=', 1)[1])
print(intent[17].split('=', 1)[1])
PY
)" || return 1
  mapfile -t evidence_lines <<<"$inspection"
  [[ "${#evidence_lines[@]}" -eq 7 ]] || return 1
  for value in "${evidence_lines[@]:0:6}"; do
    [[ "$value" =~ ^[0-9a-f]{64}$ ]] || return 1
  done
  [[ "${evidence_lines[6]}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+~-][0-9A-Za-z._-]+)?$ ]] ||
    return 1
  PREDECESSOR_ROTATION_INTENT_SHA256="${evidence_lines[0]}"
  PREDECESSOR_ROTATION_COMPLETION_SHA256="${evidence_lines[1]}"
  PREDECESSOR_ROTATION_HELPER_ARCHIVE_SHA256="${evidence_lines[2]}"
  PREDECESSOR_ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST="${evidence_lines[3]}"
  PREDECESSOR_ROTATION_COMPOSE5_PROFILE_CONFIG_HASH="${evidence_lines[4]}"
  PREDECESSOR_ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH="${evidence_lines[5]}"
  PREDECESSOR_ROTATION_COMPOSE5_VOLUME_VERSION="${evidence_lines[6]}"
}

require_current_boundary_matches_predecessor_rotation() {
  [[ "$COMPOSE5_DURABLE_VOLUME_DIGEST" == \
      "$PREDECESSOR_ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST" &&
    "$COMPOSE5_PROFILE_CONFIG_HASH" == \
      "$PREDECESSOR_ROTATION_COMPOSE5_PROFILE_CONFIG_HASH" &&
    "$COMPOSE5_SESSION_CONTROL_CONFIG_HASH" == \
      "$PREDECESSOR_ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH" &&
    "$COMPOSE5_VOLUME_VERSION" == "$PREDECESSOR_ROTATION_COMPOSE5_VOLUME_VERSION" ]]
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4' \
    'state=authorized' \
    "predecessor_release=$PREDECESSOR_RELEASE" \
    "successor_release=$SUCCESSOR_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "base_successor_intent_sha256=$BASE_SUCCESSOR_INTENT_SHA256" \
    "base_successor_completion_sha256=$BASE_SUCCESSOR_COMPLETION_SHA256" \
    "base_binding_v2_sha256=$BASE_BINDING_V2_SHA256" \
    "base_predecessor_helper_sha256=$BASE_PREDECESSOR_HELPER_SHA256" \
    "base_binding_v3_sha256=$BASE_BINDING_V3_SHA256" \
    "predecessor_rotation_intent_sha256=$PREDECESSOR_ROTATION_INTENT_SHA256" \
    "predecessor_rotation_completion_sha256=$PREDECESSOR_ROTATION_COMPLETION_SHA256" \
    "predecessor_rotation_helper_archive_sha256=$PREDECESSOR_ROTATION_HELPER_ARCHIVE_SHA256" \
    "compose5_durable_volume_digest=$ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST" \
    "compose5_profile_config_hash=$ROTATION_COMPOSE5_PROFILE_CONFIG_HASH" \
    "compose5_session_control_config_hash=$ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH" \
    "compose5_volume_version=$ROTATION_COMPOSE5_VOLUME_VERSION"
}

ROTATION_INTENT_SHA256=''
load_rotation_intent_sha256() {
  local path="$1/$ROTATION_INTENT_NAME"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$path" <(expected_intent) || return 1
  ROTATION_INTENT_SHA256="$(sha256sum -- "$path" | awk '{print $1}')" || return 1
  [[ "$ROTATION_INTENT_SHA256" =~ ^[0-9a-f]{64}$ ]]
}

expected_completion() {
  printf '%s\n' \
    'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4' \
    'state=successor-installed' \
    "predecessor_release=$PREDECESSOR_RELEASE" \
    "successor_release=$SUCCESSOR_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "base_successor_intent_sha256=$BASE_SUCCESSOR_INTENT_SHA256" \
    "base_successor_completion_sha256=$BASE_SUCCESSOR_COMPLETION_SHA256" \
    "base_binding_v2_sha256=$BASE_BINDING_V2_SHA256" \
    "base_predecessor_helper_sha256=$BASE_PREDECESSOR_HELPER_SHA256" \
    "base_binding_v3_sha256=$BASE_BINDING_V3_SHA256" \
    "predecessor_rotation_intent_sha256=$PREDECESSOR_ROTATION_INTENT_SHA256" \
    "predecessor_rotation_completion_sha256=$PREDECESSOR_ROTATION_COMPLETION_SHA256" \
    "predecessor_rotation_helper_archive_sha256=$PREDECESSOR_ROTATION_HELPER_ARCHIVE_SHA256" \
    "compose5_durable_volume_digest=$ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST" \
    "compose5_profile_config_hash=$ROTATION_COMPOSE5_PROFILE_CONFIG_HASH" \
    "compose5_session_control_config_hash=$ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH" \
    "compose5_volume_version=$ROTATION_COMPOSE5_VOLUME_VERSION" \
    "rotation_intent_sha256=$ROTATION_INTENT_SHA256"
}

classify_rotation() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$ROTATION_PARENT" "$SUCCESSOR_RELEASE" <<'PY'
import os
import stat
import sys

parent, successor = sys.argv[1:]
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
elif entries == [f'{successor}.installing']:
    print('interrupted')
elif entries == [successor]:
    print('completed')
else:
    raise SystemExit(1)
PY
}

require_rotation_prefix() {
  local root="$1"
  env -i PATH="$SAFE_PATH" python3 -I - "$root" <<'PY'
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

publish_record() {
  local root="$1" kind="$2"
  env -i PATH="$SAFE_PATH" python3 -I - "$root" "$kind" \
    "$PREDECESSOR_RELEASE" "$SUCCESSOR_RELEASE" "$PREDECESSOR_HELPER_SHA256" \
    "$SUCCESSOR_HELPER_SHA256" "$BASE_SUCCESSOR_INTENT_SHA256" \
    "$BASE_SUCCESSOR_COMPLETION_SHA256" "$BASE_BINDING_V2_SHA256" \
    "$BASE_PREDECESSOR_HELPER_SHA256" "$BASE_BINDING_V3_SHA256" \
    "$PREDECESSOR_ROTATION_INTENT_SHA256" \
    "$PREDECESSOR_ROTATION_COMPLETION_SHA256" \
    "$PREDECESSOR_ROTATION_HELPER_ARCHIVE_SHA256" \
    "$ROTATION_COMPOSE5_DURABLE_VOLUME_DIGEST" \
    "$ROTATION_COMPOSE5_PROFILE_CONFIG_HASH" \
    "$ROTATION_COMPOSE5_SESSION_CONTROL_CONFIG_HASH" \
    "$ROTATION_COMPOSE5_VOLUME_VERSION" \
    "$ROTATION_INTENT_SHA256" <<'PY'
import os
import stat
import sys

(
    root,
    kind,
    predecessor,
    successor,
    old_helper,
    new_helper,
    base_intent,
    base_completion,
    base_v2,
    base_old_helper,
    base_v3,
    predecessor_rotation_intent,
    predecessor_rotation_completion,
    predecessor_rotation_helper_archive,
    compose5_durable_volume_digest,
    compose5_profile_config_hash,
    compose5_session_control_config_hash,
    compose5_volume_version,
    rotation_intent,
) = sys.argv[1:]
if kind == 'intent':
    target = 'intent-v1'
    state = 'authorized'
    suffix = ''
elif kind == 'completion':
    target = 'completed-v1'
    state = 'successor-installed'
    if len(rotation_intent) != 64:
        raise SystemExit(1)
    suffix = f'rotation_intent_sha256={rotation_intent}\n'
else:
    raise SystemExit(1)
temporary = f'.{target}.installing'
expected = (
    'contract=fetanagent-kemerbet-readiness-v3-helper-rotation-v4\n'
    f'state={state}\n'
    f'predecessor_release={predecessor}\n'
    f'successor_release={successor}\n'
    f'predecessor_helper_sha256={old_helper}\n'
    f'successor_helper_sha256={new_helper}\n'
    f'base_successor_intent_sha256={base_intent}\n'
    f'base_successor_completion_sha256={base_completion}\n'
    f'base_binding_v2_sha256={base_v2}\n'
    f'base_predecessor_helper_sha256={base_old_helper}\n'
    f'base_binding_v3_sha256={base_v3}\n'
    f'predecessor_rotation_intent_sha256={predecessor_rotation_intent}\n'
    f'predecessor_rotation_completion_sha256={predecessor_rotation_completion}\n'
    f'predecessor_rotation_helper_archive_sha256={predecessor_rotation_helper_archive}\n'
    f'compose5_durable_volume_digest={compose5_durable_volume_digest}\n'
    f'compose5_profile_config_hash={compose5_profile_config_hash}\n'
    f'compose5_session_control_config_hash={compose5_session_control_config_hash}\n'
    f'compose5_volume_version={compose5_volume_version}\n'
    + suffix
).encode('ascii')


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
    entries = os.listdir(directory)
    if target in entries:
        if temporary in entries:
            raise RuntimeError()
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
        try:
            value = os.fstat(descriptor)
            data = read_bounded(descriptor, len(expected))
        finally:
            os.close(descriptor)
        if (
            (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) !=
               (0, 0, 0o600, 1)
            or data != expected
        ):
            raise RuntimeError()
        raise SystemExit(0)
    if temporary in entries:
        descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
        try:
            value = os.fstat(descriptor)
            existing = read_bounded(descriptor, len(expected))
            if (
                (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) !=
                   (0, 0, 0o600, 1)
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
            0o600,
            dir_fd=directory,
        )
        try:
            os.fchmod(descriptor, 0o600)
            write_all(descriptor, expected)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    os.rename(temporary, target, src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)
finally:
    os.close(directory)
PY
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
    if (
        (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
         before.st_nlink, before.st_size, before.st_mtime_ns) !=
        (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
         after.st_nlink, after.st_size, after.st_mtime_ns)
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
            (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) !=
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

require_exact_rotation() {
  local root="$1"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' ]] || return 1
  [[ "$(find -P "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == \
    $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  load_rotation_intent_sha256 "$root" || return 1
  [[ ! -L "$root/$ROTATION_COMPLETION_NAME" && -f "$root/$ROTATION_COMPLETION_NAME" &&
    "$(realpath -- "$root/$ROTATION_COMPLETION_NAME")" == "$root/$ROTATION_COMPLETION_NAME" &&
    "$(stat --format='%U:%G:%a:%h' "$root/$ROTATION_COMPLETION_NAME")" == 'root:root:600:1' ]] ||
    return 1
  cmp -s -- "$root/$ROTATION_COMPLETION_NAME" <(expected_completion) || return 1
  require_helper_file "$root/$HELPER_ARCHIVE_NAME" "$PREDECESSOR_HELPER_SHA256" 400
}

restore_sudoers() {
  [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || return 1
  require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  visudo -cf "$SUDOERS_DISABLED" >/dev/null || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  if sync -f /etc/sudoers.d && require_exact_sudoers_file "$SUDOERS" &&
    visudo -cf /etc/sudoers >/dev/null; then
    return 0
  fi
  if [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" &&
    -e "$SUDOERS" && ! -L "$SUDOERS" ]] && require_exact_sudoers_file "$SUDOERS"; then
    mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
    sync -f /etc/sudoers.d || return 1
    require_exact_sudoers_file "$SUDOERS_DISABLED" || return 1
  fi
  return 1
}

rollback_precompletion_helper() {
  [[ -e "$ROTATION_INSTALLING" && ! -L "$ROTATION_INSTALLING" ]] || return 0
  [[ ! -e "$ROTATION_INSTALLING/$ROTATION_COMPLETION_NAME" &&
    ! -L "$ROTATION_INSTALLING/$ROTATION_COMPLETION_NAME" ]] || return 0
  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    if [[ ! -e "$ROLLBACK_HELPER" && ! -L "$ROLLBACK_HELPER" &&
      ! -e "$ROLLBACK_HELPER_PARTIAL" && ! -L "$ROLLBACK_HELPER_PARTIAL" ]]; then
      return 0
    fi
  else
    require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
  fi
  require_helper_file "$ROTATION_INSTALLING/$HELPER_ARCHIVE_NAME" \
    "$PREDECESSOR_HELPER_SHA256" 400 || return 1
  if [[ ! -e "$ROLLBACK_HELPER" && ! -L "$ROLLBACK_HELPER" ]]; then
    copy_root_file_atomically "$ROTATION_INSTALLING/$HELPER_ARCHIVE_NAME" \
      "$ROLLBACK_HELPER_PARTIAL" "$ROLLBACK_HELPER" 0400 0755 "$PREDECESSOR_HELPER_SHA256" ||
      return 1
  fi
  require_helper_file "$ROLLBACK_HELPER" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  mv -- "$ROLLBACK_HELPER" "$TARGET" || return 1
  sync -f /usr/local/sbin || return 1
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755
}

require_global_installer_residue_absent() {
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" &&
    ! -e "$ROLLBACK_HELPER" && ! -L "$ROLLBACK_HELPER" &&
    ! -e "$ROLLBACK_HELPER_PARTIAL" && ! -L "$ROLLBACK_HELPER_PARTIAL" ]]
}

require_predecessor_rotation_global_residue_absent() {
  [[ ! -e "$FIRST_ROTATION_SUDOERS_DISABLED" && ! -L "$FIRST_ROTATION_SUDOERS_DISABLED" &&
    ! -e "$FIRST_ROTATION_INSTALLING_HELPER" && ! -L "$FIRST_ROTATION_INSTALLING_HELPER" &&
    ! -e "$FIRST_ROTATION_INSTALLING_HELPER_PARTIAL" &&
      ! -L "$FIRST_ROTATION_INSTALLING_HELPER_PARTIAL" &&
    ! -e "$FIRST_ROTATION_ROLLBACK_HELPER" && ! -L "$FIRST_ROTATION_ROLLBACK_HELPER" &&
    ! -e "$FIRST_ROTATION_ROLLBACK_HELPER_PARTIAL" &&
      ! -L "$FIRST_ROTATION_ROLLBACK_HELPER_PARTIAL" &&
    ! -e "$SECOND_ROTATION_SUDOERS_DISABLED" && ! -L "$SECOND_ROTATION_SUDOERS_DISABLED" &&
    ! -e "$SECOND_ROTATION_INSTALLING_HELPER" && ! -L "$SECOND_ROTATION_INSTALLING_HELPER" &&
    ! -e "$SECOND_ROTATION_INSTALLING_HELPER_PARTIAL" &&
      ! -L "$SECOND_ROTATION_INSTALLING_HELPER_PARTIAL" &&
    ! -e "$SECOND_ROTATION_ROLLBACK_HELPER" && ! -L "$SECOND_ROTATION_ROLLBACK_HELPER" &&
    ! -e "$SECOND_ROTATION_ROLLBACK_HELPER_PARTIAL" &&
      ! -L "$SECOND_ROTATION_ROLLBACK_HELPER_PARTIAL" &&
    ! -e "$PREDECESSOR_SUDOERS_DISABLED" && ! -L "$PREDECESSOR_SUDOERS_DISABLED" &&
    ! -e "$PREDECESSOR_INSTALLING_HELPER" && ! -L "$PREDECESSOR_INSTALLING_HELPER" &&
    ! -e "$PREDECESSOR_INSTALLING_HELPER_PARTIAL" &&
      ! -L "$PREDECESSOR_INSTALLING_HELPER_PARTIAL" &&
    ! -e "$PREDECESSOR_ROLLBACK_HELPER" && ! -L "$PREDECESSOR_ROLLBACK_HELPER" &&
    ! -e "$PREDECESSOR_ROLLBACK_HELPER_PARTIAL" &&
      ! -L "$PREDECESSOR_ROLLBACK_HELPER_PARTIAL" ]]
}

require_rollback_residue_absent() {
  [[ ! -e "$ROLLBACK_HELPER" && ! -L "$ROLLBACK_HELPER" &&
    ! -e "$ROLLBACK_HELPER_PARTIAL" && ! -L "$ROLLBACK_HELPER_PARTIAL" ]]
}

sudoers_disabled='false'
rotation_finalized='false'
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$sudoers_disabled" == 'true' ]]; then
    if [[ "$rotation_finalized" == 'false' ]]; then
      rollback_precompletion_helper || status=1
    fi
    printf '%s\n' \
      'FetanAgent v3 fourth helper rotation stopped with the deployment grant disabled. Whether the append-only record is pending or final, rerun this exact operation with the same successor release and helper digest from the root console; do not restore the grant manually.' >&2
  fi
  exit "$status"
}

[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == "$EXPECTED_DROPLET_ID" ]] ||
  die 'the DigitalOcean Droplet identity is wrong'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
  "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]] ||
  die 'the DigitalOcean public IPv4 identity is wrong'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" && "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed staging root is unsafe'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged successor helper is invalid'
require_predecessor_rotation_global_residue_absent ||
  die 'one of the first three helper rotations still has global transaction residue'

rotation_state="$(classify_rotation)" || die 'the rotation namespace is absent, foreign, or ambiguous'
case "$rotation_state" in
  absent)
    require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
      die 'a fresh rotation requires the exact frozen predecessor helper'
    if require_exact_sudoers_file "$SUDOERS"; then
      [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] ||
        die 'both active and disabled grants exist'
      run_predecessor_helper verify "$PREDECESSOR_HELPER_SHA256" >/dev/null
      run_predecessor_helper kemerbet-v3-successor-ready \
        "$PREDECESSOR_RELEASE" "$PREDECESSOR_HELPER_SHA256" >/dev/null
      run_predecessor_helper stop >/dev/null
      run_predecessor_helper kemerbet-v3-successor-ready \
        "$PREDECESSOR_RELEASE" "$PREDECESSOR_HELPER_SHA256" >/dev/null
    elif [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] &&
      require_exact_sudoers_file "$SUDOERS_DISABLED"; then
      sudoers_disabled='true'
    else
      die 'the deployment sudoers grant topology is invalid'
    fi
    ;;
  empty-parent)
    require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
      die 'an empty rotation parent may resume only with the exact predecessor helper'
    [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] &&
      require_exact_sudoers_file "$SUDOERS_DISABLED" ||
      die 'an empty rotation parent may resume only with the deployment grant disabled'
    sudoers_disabled='true'
    ;;
  interrupted)
    [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] &&
      require_exact_sudoers_file "$SUDOERS_DISABLED" ||
      die 'an interrupted rotation must retain the disabled deployment grant'
    sudoers_disabled='true'
    require_rotation_prefix "$ROTATION_INSTALLING" || die 'the interrupted rotation prefix is unsafe'
    ;;
  completed)
    require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
      die 'the completed rotation lost its exact successor helper'
    if require_exact_sudoers_file "$SUDOERS"; then
      [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] ||
        die 'both active and disabled grants exist'
    elif [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] &&
      require_exact_sudoers_file "$SUDOERS_DISABLED"; then
      sudoers_disabled='true'
    else
      die 'the completed rotation has an invalid deployment grant topology'
    fi
    ;;
esac

require_no_helper_processes || die 'another helper invocation is still active'
if [[ ! -e "$LOCK_ROOT" && ! -L "$LOCK_ROOT" ]]; then
  (umask 077 && mkdir --mode=0700 -- "$LOCK_ROOT") || die 'the mutation-lock root could not be created'
fi
[[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
  "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' ]] ||
  die 'the mutation-lock root is unsafe'
if [[ ! -e "$LOCK" && ! -L "$LOCK" ]]; then
  (set -o noclobber; umask 077; : >"$LOCK") 2>/dev/null || true
fi
[[ ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
  "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] ||
  die 'the mutation lock is unsafe'
exec 9<>"$LOCK"
flock --exclusive --nonblock 9 || die 'another staging mutation is active'
require_no_helper_processes || die 'a helper process appeared after the mutation lock was acquired'

[[ "$(classify_rotation)" == "$rotation_state" ]] || die 'the rotation namespace changed before lock acquisition'
load_exact_base_successor_evidence || die 'the immutable v2-to-v3 successor evidence is invalid'
load_exact_predecessor_rotation_evidence ||
  die 'the exact completed three-link helper-rotation chain is invalid'
require_predecessor_rotation_global_residue_absent ||
  die 'predecessor-rotation residue appeared after lock acquisition'
require_stopped_no_transfer_boundary ||
  die 'rotation requires a stopped, disarmed, no-transient, exact Compose 5 durable boundary'
require_current_boundary_matches_predecessor_rotation ||
  die 'the current durable boundary differs from the third helper-rotation link'
capture_rotation_durable_boundary ||
  die 'the exact Compose 5 durable boundary could not be frozen for this rotation'

trap cleanup EXIT
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  require_exact_sudoers_file "$SUDOERS" || die 'the deployment sudoers grant is invalid'
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] ||
    die 'the disabled grant target already exists'
  mv -- "$SUDOERS" "$SUDOERS_DISABLED"
  sudoers_disabled='true'
  sync -f /etc/sudoers.d
fi
require_exact_sudoers_file "$SUDOERS_DISABLED" || die 'the disabled deployment grant is invalid'
[[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || die 'the deployment grant remained active'
visudo -cf /etc/sudoers >/dev/null || die 'sudoers validation failed with the grant disabled'
require_no_helper_processes || die 'a helper process appeared after the deployment grant was disabled'
load_exact_base_successor_evidence || die 'the immutable base successor changed under lock'
load_exact_predecessor_rotation_evidence ||
  die 'the three-link helper-rotation chain changed under lock'
require_predecessor_rotation_global_residue_absent ||
  die 'predecessor-rotation residue appeared while the grant was disabled'
require_preserved_rotation_durable_boundary ||
  die 'the stopped durable boundary changed under lock'
require_current_boundary_matches_predecessor_rotation ||
  die 'the frozen durable boundary diverged from the third helper-rotation link'

if [[ "$rotation_state" == 'completed' ]]; then
  require_exact_rotation "$ROTATION_ROOT" || die 'the completed rotation evidence is invalid'
  require_global_installer_residue_absent ||
    die 'the completed rotation retained a global helper installer or rollback residue'
  rotation_finalized='true'
else
  if [[ "$rotation_state" == 'absent' || "$rotation_state" == 'empty-parent' ]]; then
    if [[ ! -e "$ROTATION_PARENT" && ! -L "$ROTATION_PARENT" ]]; then
      (umask 077 && mkdir --mode=0700 -- "$ROTATION_PARENT") ||
        die 'the rotation parent could not be created'
      sync -f "$(dirname -- "$ROTATION_PARENT")"
    fi
    [[ ! -L "$ROTATION_PARENT" && -d "$ROTATION_PARENT" &&
      "$(realpath -- "$ROTATION_PARENT")" == "$ROTATION_PARENT" &&
      "$(stat --format='%U:%G:%a' "$ROTATION_PARENT")" == 'root:root:700' ]] ||
      die 'the rotation parent is unsafe'
    [[ -z "$(find -P "$ROTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] ||
      die 'the fresh rotation parent is not empty'
    (umask 077 && mkdir --mode=0700 -- "$ROTATION_INSTALLING") ||
      die 'the append-only rotation prefix could not be created'
    sync -f "$ROTATION_PARENT"
  fi
  require_rotation_prefix "$ROTATION_INSTALLING" || die 'the append-only rotation prefix is unsafe'
  rollback_precompletion_helper ||
    die 'the exact interrupted predecessor rollback could not be completed safely'
  require_rollback_residue_absent ||
    die 'a global predecessor rollback residue survived interrupted recovery'
  publish_record "$ROTATION_INSTALLING" intent
  load_rotation_intent_sha256 "$ROTATION_INSTALLING" || die 'the rotation intent changed under lock'

  if [[ ! -e "$ROTATION_INSTALLING/$HELPER_ARCHIVE_NAME" &&
    ! -L "$ROTATION_INSTALLING/$HELPER_ARCHIVE_NAME" ]]; then
    require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 ||
      die 'the predecessor helper changed before archival'
    copy_root_file_atomically "$TARGET" \
      "$ROTATION_INSTALLING/.${HELPER_ARCHIVE_NAME}.installing" \
      "$ROTATION_INSTALLING/$HELPER_ARCHIVE_NAME" 0755 0400 "$PREDECESSOR_HELPER_SHA256"
  fi
  require_helper_file "$ROTATION_INSTALLING/$HELPER_ARCHIVE_NAME" \
    "$PREDECESSOR_HELPER_SHA256" 400 || die 'the predecessor helper archive is invalid'

  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    if [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]; then
      copy_root_file_atomically "$STAGED_HELPER" "$INSTALLING_HELPER_PARTIAL" \
        "$INSTALLING_HELPER" 0600 0755 "$SUCCESSOR_HELPER_SHA256"
    else
      [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
        die 'both complete and partial successor helper installers exist'
    fi
    require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 ||
      die 'the successor helper installer is invalid'
    mv -- "$INSTALLING_HELPER" "$TARGET"
    sync -f /usr/local/sbin
  fi
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
    die 'the installed successor helper is invalid'
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
    die 'a successor helper installer residue remains'
  load_rotation_intent_sha256 "$ROTATION_INSTALLING" || die 'the intent changed after helper replacement'
  publish_record "$ROTATION_INSTALLING" completion
  require_exact_rotation "$ROTATION_INSTALLING" || die 'the completed installing evidence is invalid'
  [[ ! -e "$ROTATION_ROOT" && ! -L "$ROTATION_ROOT" ]] ||
    die 'the final rotation root appeared unexpectedly'
  mv -- "$ROTATION_INSTALLING" "$ROTATION_ROOT"
  sync -f "$ROTATION_PARENT"
  rotation_finalized='true'
fi

require_exact_rotation "$ROTATION_ROOT" || die 'the final append-only rotation evidence is invalid'
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the final successor helper is invalid'
require_global_installer_residue_absent ||
  die 'the final rotation retained a global helper installer or rollback residue'
require_preserved_rotation_durable_boundary ||
  die 'the final stopped no-transfer boundary changed'

# The sudo grant remains disabled while the newly installed helper independently parses the
# completed chain. Release this script's lock only for those two non-mutating helper checks.
flock --unlock 9
exec 9>&-
run_successor_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the successor helper rejected its reviewed digest'
run_successor_helper_direct kemerbet-v3-successor-ready \
  "$SUCCESSOR_RELEASE" "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the successor helper rejected the exact completed rotation chain'
exec 9<>"$LOCK"
flock --exclusive --nonblock 9 || die 'another staging mutation appeared before grant restoration'
require_no_helper_processes || die 'a helper process remained before grant restoration'
load_exact_base_successor_evidence || die 'the immutable base successor changed after helper verification'
load_exact_predecessor_rotation_evidence ||
  die 'the three-link helper-rotation chain changed after helper verification'
require_predecessor_rotation_global_residue_absent ||
  die 'predecessor-rotation residue appeared during successor verification'
require_exact_rotation "$ROTATION_ROOT" || die 'the rotation evidence changed after helper verification'
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the successor helper changed after verification'
require_global_installer_residue_absent ||
  die 'a global helper installer or rollback residue appeared during successor verification'
require_preserved_rotation_durable_boundary ||
  die 'the stopped boundary changed before grant restoration'
require_current_boundary_matches_predecessor_rotation ||
  die 'the durable boundary no longer matches the third helper-rotation link'

restore_sudoers || die 'the exact deployment grant could not be restored'
sudoers_disabled='false'
rotation_finalized='true'
trap - EXIT
printf '%s\n' \
  'FetanAgent v3 fourth successor helper/release rotation completed. Transfer and the live executor remained disabled; no money moved.'
