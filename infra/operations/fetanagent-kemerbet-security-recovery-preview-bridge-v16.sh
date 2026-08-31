#!/usr/bin/env bash
# One-use, root-console-only promotion from the exact canonical H14 helper to
# the H16 security-recovery preview bridge. The canonical H14 recovery tree,
# its exact-five cohort, and all runtime containers remain immutable. This
# operation changes only the reviewed root helper and appends root-only H16
# provenance. It never starts a browser, performs a lookup, enters Amount,
# clicks Transfer, enables an executor/final action, or moves money.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly CANONICAL_H14_RELEASE='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly CURRENT_RUNTIME_RELEASE='30fc8196356d3bb1f6f279c4ff40ad2b4a91a44c'
readonly PREDECESSOR_HELPER_SHA256='c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='da555f29ac6260e1dff6c969218eb55ea9bd66c8167600e3ecc700118c8ea9e6'
readonly H14_AUTHORIZATION_PROMPT_SHA256='6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
readonly H14_RECOVERY_AUTHORIZATION_SHA256='192e055032a45c83a5311b769a69dab9d6bacc2f1a256bc2f8bc3cb9395bdb25'
readonly CONFIRMATION='I-UNDERSTAND-THIS-INSTALLS-ONE-H16-SECURITY-RECOVERY-PREVIEW-BRIDGE-WITH-TRANSFER-DISABLED'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.kemerbet-security-recovery-preview-bridge-v16-disabled'
readonly H16_PARENT='/var/lib/fetanagent/kemerbet-security-recovery-preview-bridge-v16'
readonly H14_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14'
readonly H14_ROOT="$H14_PARENT/$CANONICAL_H14_RELEASE"
readonly H14_RECOVERY_AUTHORIZATION="$H14_ROOT/recovery-identity-authorization-v1"
readonly FINAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly BOT_STARTUP_RECEIPT_ROOT='/var/lib/fetanagent-bot-startup-receipt'
readonly BOT_STARTUP_RECEIPT="$BOT_STARTUP_RECEIPT_ROOT/bot-v1"
readonly BOT_STARTUP_RECEIPT_VERSION='1'
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-security-recovery-preview-bridge-v16-installing'
readonly INSTALLING_HELPER_PARTIAL="${INSTALLING_HELPER}.partial"
readonly SCRIPT_BASENAME='fetanagent-kemerbet-security-recovery-preview-bridge-v16.sh'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H16 security-recovery preview bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the bridge release, reviewed helper digest, and exact confirmation'
readonly BRIDGE_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly STAGING_ROOT="/root/fetanagent-kemerbet-security-recovery-preview-bridge-v16-$BRIDGE_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly H16_ROOT="$H16_PARENT/$BRIDGE_RELEASE"
readonly H16_INSTALLING="$H16_PARENT/.installing-$BRIDGE_RELEASE"

[[ "$REVIEWED_SUCCESSOR_HELPER_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the reviewed H16 successor helper digest placeholder has not been finalized'
[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$BRIDGE_RELEASE" != "$CANONICAL_H14_RELEASE" &&
  "$BRIDGE_RELEASE" != "$CURRENT_RUNTIME_RELEASE" ]] ||
  die 'the H16 bridge release must be a distinct full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct hard-pinned reviewed H16 artifact'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact one-use H16 confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this installer only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl dirname docker env find flock grep id install mkdir mv \
  python3 realpath sha256sum sort stat sync visudo; do
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

disable_sudoers() {
  require_active_grant_only || return 1
  mv -- "$SUDOERS" "$SUDOERS_DISABLED" || return 1
  grant_disabled='true'
  sync -f /etc/sudoers.d || return 1
  require_disabled_grant_only
}

restore_sudoers() {
  require_disabled_grant_only || return 1
  visudo -cf "$SUDOERS_DISABLED" >/dev/null || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  if sync -f /etc/sudoers.d && require_active_grant_only; then
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
        "$TARGET"|"$STAGED_HELPER"|"$INSTALLING_HELPER"|"$INSTALLING_HELPER_PARTIAL") return 1 ;;
      esac
      [[ "$basename" == "$SCRIPT_BASENAME" ]] && return 1
    done <"$cmdline" || true
  done
}

has_enabled_financial_gate() {
  local entry environment="$1" status
  while IFS= read -r entry; do
    case "$entry" in
      FINANCIAL_ACTIONS_MODE=dry_run) continue ;;
      FINANCIAL_ACTIONS_MODE=*) return 0 ;;
      KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true) continue ;;
      FETANAGENT_*EXECUTOR*=false|FETANAGENT_*FINAL_ACTION*=false|FETANAGENT_*TRANSFER*=false|FETANAGENT_*AMOUNT_ENTRY*=false) continue ;;
      KEMERBET_*EXECUTOR*=false|KEMERBET_*FINAL_ACTION*=false|KEMERBET_*TRANSFER*=false|KEMERBET_*AMOUNT_ENTRY*=false) continue ;;
      INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false) continue ;;
    esac
    if grep -Eiq '^(FETANAGENT_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*|KEMERBET_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED)=' \
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
  local container environment inventory
  [[ ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" ]] || return 1
  inventory="$(docker_local_read_only container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    [[ "$container" =~ ^[0-9a-f]{64}$ ]] || return 1
    environment="$(docker_local_read_only container inspect "$container" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
    if has_enabled_financial_gate "$environment"; then
      return 1
    fi
  done <<<"$inventory"
}

runtime_boundary_digest() {
  local container receipt_sha256 receipt_stat service
  local -a expected_services=(api beta-admission bot customer-web gateway owner-control)
  {
    for service in "${expected_services[@]}"; do
      container="$(docker_local_read_only container ls --all --quiet --no-trunc \
        --filter "label=com.docker.compose.project=$PROJECT_NAME" \
        --filter "label=com.docker.compose.service=$service")" || return 1
      [[ "$container" =~ ^[0-9a-f]{64}$ ]] || return 1
      docker_local_read_only container inspect "$container" --format \
        '{{.Id}}|{{.Image}}|{{json .Config.Cmd}}|{{json .Config.Entrypoint}}|{{.Config.User}}|{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}|{{.HostConfig.NetworkMode}}'
    done
    receipt_stat="$(stat --format='%u:%g:%a:%h:%s' "$BOT_STARTUP_RECEIPT")" || return 1
    receipt_sha256="$(sha256sum -- "$BOT_STARTUP_RECEIPT" | awk '{print $1}')" || return 1
    printf 'bot-startup-receipt|%s|%s\n' "$receipt_stat" "$receipt_sha256"
  } | sha256sum | awk '{print $1}'
}

require_exact_current_bot_startup_receipt() {
  local container="$1" container_started_at entries full_container_id
  [[ ! -L "$BOT_STARTUP_RECEIPT_ROOT" && -d "$BOT_STARTUP_RECEIPT_ROOT" &&
    "$(realpath -- "$BOT_STARTUP_RECEIPT_ROOT")" == "$BOT_STARTUP_RECEIPT_ROOT" &&
    "$(stat --format='%U:%G:%a:%h' "$BOT_STARTUP_RECEIPT_ROOT")" == 'root:root:700:2' ]] ||
    return 1
  entries="$(find -P "$BOT_STARTUP_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 \
    -printf '%f\n' | LC_ALL=C sort)" || return 1
  [[ "$entries" == 'bot-v1' &&
    ! -L "$BOT_STARTUP_RECEIPT" && -f "$BOT_STARTUP_RECEIPT" &&
    "$(realpath -- "$BOT_STARTUP_RECEIPT")" == "$BOT_STARTUP_RECEIPT" &&
    "$(stat --format='%U:%G:%a:%h' "$BOT_STARTUP_RECEIPT")" == 'root:root:600:1' &&
    "$(stat --format='%s' "$BOT_STARTUP_RECEIPT")" -gt 0 &&
    "$(stat --format='%s' "$BOT_STARTUP_RECEIPT")" -le 4096 ]] || return 1
  full_container_id="$(docker_local_read_only container inspect "$container" --format '{{.Id}}')" ||
    return 1
  [[ "$full_container_id" == "$container" && "$full_container_id" =~ ^[0-9a-f]{64}$ ]] ||
    return 1
  container_started_at="$(docker_local_read_only container inspect "$container" \
    --format '{{.State.StartedAt}}')" || return 1
  [[ "$container_started_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$ ]] ||
    return 1
  cmp -s -- "$BOT_STARTUP_RECEIPT" <(printf '%s\n' \
    "receipt_version=$BOT_STARTUP_RECEIPT_VERSION" \
    "commit_sha=$CURRENT_RUNTIME_RELEASE" \
    "container_id=$full_container_id" \
    "container_started_at=$container_started_at" \
    'restart_count=0' \
    'startup_contract=telegram-private-admission-actions-v1')
}

require_exact_current_runtime_boundary() {
  local container health health_contract ids observed service services state
  local -a expected_services=(api beta-admission bot customer-web gateway owner-control)
  services="$({
    docker_local_read_only container ls --all --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container; do
        [[ -n "$container" ]] || continue
        docker_local_read_only container inspect "$container" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | LC_ALL=C sort)" || return 1
  [[ "$services" == $'api\nbeta-admission\nbot\ncustomer-web\ngateway\nowner-control' ]] || return 1
  for service in "${expected_services[@]}"; do
    ids="$(docker_local_read_only container ls --all --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" || return 1
    [[ "$ids" =~ ^[0-9a-f]{64}$ ]] || return 1
    state="$(docker_local_read_only container inspect "$ids" --format '{{.State.Status}}')" || return 1
    health="$(docker_local_read_only container inspect "$ids" \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}absent{{end}}')" || return 1
    health_contract="$(docker_local_read_only container inspect "$ids" \
      --format '{{if .Config.Healthcheck}}present{{else}}absent{{end}}')" || return 1
    [[ "$state" == 'running' ]] || return 1
    if [[ "$service" == 'bot' ]]; then
      [[ ( "$health_contract" == 'absent' && "$health" == 'absent' ) ||
        ( "$health_contract" == 'present' && "$health" == 'healthy' ) ]] || return 1
      require_exact_current_bot_startup_receipt "$ids" || return 1
    else
      [[ "$health_contract" == 'present' && "$health" == 'healthy' ]] || return 1
    fi
    observed="$(docker_local_read_only container inspect "$ids" --format \
      '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "org.opencontainers.image.revision" }}|{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{.RestartCount}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}')" || return 1
    [[ "$observed" == \
      "$PROJECT_NAME|$service|$CURRENT_RUNTIME_RELEASE|10001:10001|true|0|[\"ALL\"]|[\"no-new-privileges:true\"]" ]] || return 1
  done
  [[ -z "$(docker_local_read_only container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter 'label=com.docker.compose.service=kemerbet-session-provision')" ]] || return 1
  require_financial_gates_disabled
}

h14_evidence_digest() {
  env -i PATH="$SAFE_PATH" python3 -I - "$H14_PARENT" "$CANONICAL_H14_RELEASE" <<'PY'
import hashlib
import os
import stat
import sys

parent, release = sys.argv[1:]
root = f'{parent}/{release}'
MAX_FILES = 512
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024


def reject():
    raise RuntimeError()


parent_stat = os.lstat(parent)
root_stat = os.lstat(root)
if (
    not stat.S_ISDIR(parent_stat.st_mode)
    or not stat.S_ISDIR(root_stat.st_mode)
    or (parent_stat.st_uid, parent_stat.st_gid, stat.S_IMODE(parent_stat.st_mode)) != (0, 0, 0o700)
    or (root_stat.st_uid, root_stat.st_gid, stat.S_IMODE(root_stat.st_mode)) != (0, 0, 0o700)
    or os.path.realpath(parent) != parent
    or os.path.realpath(root) != root
    or os.listdir(parent) != [release]
):
    reject()

digest = hashlib.sha256()
count = 0
total = 0
for current, directories, files in os.walk(root, topdown=True, followlinks=False):
    directories.sort()
    files.sort()
    relative_directory = os.path.relpath(current, root)
    current_stat = os.lstat(current)
    if not stat.S_ISDIR(current_stat.st_mode) or stat.S_ISLNK(current_stat.st_mode):
        reject()
    digest.update(
        f'D|{relative_directory}|{current_stat.st_uid}|{current_stat.st_gid}|'
        f'{stat.S_IMODE(current_stat.st_mode):o}|{current_stat.st_nlink}\n'.encode('ascii')
    )
    for name in files:
        path = os.path.join(current, name)
        relative = os.path.relpath(path, root)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            before = os.fstat(descriptor)
            named = os.lstat(path)
            if (
                not stat.S_ISREG(before.st_mode)
                or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
                or before.st_nlink != 1
                or before.st_size > MAX_FILE_BYTES
                or os.path.realpath(path) != path
            ):
                reject()
            data = bytearray()
            while len(data) <= MAX_FILE_BYTES:
                chunk = os.read(descriptor, 65536)
                if not chunk:
                    break
                data.extend(chunk)
            after = os.fstat(descriptor)
            if (
                len(data) != before.st_size
                or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                    before.st_nlink, before.st_size, before.st_mtime_ns)
                != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                    after.st_nlink, after.st_size, after.st_mtime_ns)
            ):
                reject()
        finally:
            os.close(descriptor)
        count += 1
        total += len(data)
        if count > MAX_FILES or total > MAX_TOTAL_BYTES:
            reject()
        digest.update(
            f'F|{relative}|{before.st_uid}|{before.st_gid}|{stat.S_IMODE(before.st_mode):o}|'
            f'{before.st_nlink}|{before.st_size}|'.encode('ascii')
        )
        digest.update(hashlib.sha256(data).hexdigest().encode('ascii'))
        digest.update(b'\n')
print(digest.hexdigest())
PY
}

require_static_h14_cohort_prepared_boundary() {
  [[ ! -L "$H14_RECOVERY_AUTHORIZATION" && -f "$H14_RECOVERY_AUTHORIZATION" &&
    "$(realpath -- "$H14_RECOVERY_AUTHORIZATION")" == "$H14_RECOVERY_AUTHORIZATION" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$H14_RECOVERY_AUTHORIZATION")" == \
      '0:10001:440:1:389' &&
    "$(sha256sum -- "$H14_RECOVERY_AUTHORIZATION" | awk '{print $1}')" == \
      "$H14_RECOVERY_AUTHORIZATION_SHA256" ]] || return 1
  [[ "$(h14_evidence_digest)" =~ ^[0-9a-f]{64}$ ]]
}

require_helper_h14_cohort_prepared_boundary() {
  local helper_digest="$1" output
  run_helper_direct verify "$helper_digest" >/dev/null || return 1
  run_helper_direct kemerbet-v3-runtime-bridge-ready "$helper_digest" >/dev/null || return 1
  output="$(run_helper_direct kemerbet-quarantine-recovery-ready \
    "$CANONICAL_H14_RELEASE")" || return 1
  [[ "$output" == \
    'KemerBet H14 recovery state: cohort-prepared; Transfer and Amount disabled.' ]]
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-kemerbet-security-recovery-preview-bridge-v16' \
    'state=authorized' \
    "bridge_release=$BRIDGE_RELEASE" \
    "runtime_release=$CURRENT_RUNTIME_RELEASE" \
    "h14_recovery_release=$CANONICAL_H14_RELEASE" \
    'h14_recovery_state=cohort-prepared' \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    "h14_authorization_prompt_sha256=$H14_AUTHORIZATION_PROMPT_SHA256" \
    "h14_recovery_authorization_sha256=$H14_RECOVERY_AUTHORIZATION_SHA256" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'internal_execution_runtime_enabled=false' \
    'private_live_deposit_pilot_enabled=false' \
    'amount_entry_enabled=false' \
    'transfer_enabled=false' \
    'lookup_authorized=false' \
    'recheck_authorized=false' \
    'money_moved=false'
}

expected_completion() {
  local intent_sha256
  intent_sha256="$(expected_intent | sha256sum | awk '{print $1}')"
  expected_intent | awk 'NR == 2 { print "state=preview-bridge-installed"; next } { print }'
  printf 'bridge_intent_sha256=%s\n' "$intent_sha256"
}

publish_record_atomically() {
  local root="$1" name="$2" mode="$3" producer="$4"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$root/.$name.installing" "$root/$name" "$mode" \
    3< <("$producer") <<'PY'
import os
import stat
import sys

temporary, target, mode_text = sys.argv[1:]
mode = int(mode_text, 8)
expected_parts = []
expected_size = 0
while expected_size <= 4096:
    chunk = os.read(3, 4097 - expected_size)
    if not chunk:
        break
    expected_parts.append(chunk)
    expected_size += len(chunk)
expected = b''.join(expected_parts)
if not expected or len(expected) > 4096 or not expected.endswith(b'\n'):
    raise SystemExit(1)


def exact(path, allow_prefix):
    descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        named = os.lstat(path)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
            != (0, 0, mode, 1)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or os.path.realpath(path) != path
            or value.st_size > len(expected)
        ):
            raise RuntimeError()
        existing = os.read(descriptor, len(expected) + 1)
        if (allow_prefix and not expected.startswith(existing)) or (
            not allow_prefix and existing != expected
        ):
            raise RuntimeError()
        return descriptor, existing
    except Exception:
        os.close(descriptor)
        raise


if os.path.lexists(target):
    if os.path.lexists(temporary):
        raise SystemExit(1)
    descriptor, _ = exact(target, False)
    os.close(descriptor)
    raise SystemExit(0)

if os.path.lexists(temporary):
    descriptor, existing = exact(temporary, True)
    try:
        os.lseek(descriptor, len(existing), os.SEEK_SET)
        remaining = expected[len(existing):]
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise RuntimeError()
            remaining = remaining[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
else:
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        mode,
    )
    try:
        os.fchmod(descriptor, mode)
        remaining = expected
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise RuntimeError()
            remaining = remaining[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
os.rename(temporary, target)
directory = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
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


def read_all(descriptor, maximum):
    data = bytearray()
    while len(data) <= maximum:
        chunk = os.read(descriptor, min(65536, maximum + 1 - len(data)))
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
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
        != (0, 0, source_mode, 1)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or before.st_size > 2 * 1024 * 1024
        or os.path.realpath(source) != source
    ):
        raise RuntimeError()
    data = read_all(descriptor, 2 * 1024 * 1024)
    after = os.fstat(descriptor)
    if (
        (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
         before.st_nlink, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
            after.st_nlink, after.st_size, after.st_mtime_ns)
        or len(data) != before.st_size
        or hashlib.sha256(data).hexdigest() != expected_digest
    ):
        raise RuntimeError()
finally:
    os.close(descriptor)

if os.path.lexists(target):
    descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        existing = read_all(descriptor, len(data))
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
            != (0, 0, target_mode, 1)
            or existing != data
            or os.path.lexists(temporary)
        ):
            raise RuntimeError()
    finally:
        os.close(descriptor)
    raise SystemExit(0)

if os.path.lexists(temporary):
    descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        existing = read_all(descriptor, len(data))
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink)
            != (0, 0, target_mode, 1)
            or not data.startswith(existing)
        ):
            raise RuntimeError()
        os.lseek(descriptor, len(existing), os.SEEK_SET)
        remaining = data[len(existing):]
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise RuntimeError()
            remaining = remaining[written:]
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
        remaining = data
        while remaining:
            written = os.write(descriptor, remaining)
            if written <= 0:
                raise RuntimeError()
            remaining = remaining[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
os.rename(temporary, target)
directory = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

classify_h16_namespace() {
  env -i PATH="$SAFE_PATH" python3 -I - "$H16_PARENT" "$BRIDGE_RELEASE" <<'PY'
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

require_h16_prefix_inventory() {
  env -i PATH="$SAFE_PATH" python3 -I - "$H16_INSTALLING" <<'PY'
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
if len(entries) != len(set(entries)) or any(name not in allowed for name in entries):
    raise SystemExit(1)
for name in entries:
    item = os.lstat(f'{root}/{name}')
    mode, maximum = allowed[name]
    if (
        not stat.S_ISREG(item.st_mode)
        or (item.st_uid, item.st_gid, stat.S_IMODE(item.st_mode), item.st_nlink)
        != (0, 0, mode, 1)
        or item.st_size > maximum
        or os.path.realpath(f'{root}/{name}') != f'{root}/{name}'
    ):
        raise SystemExit(1)
PY
}

require_record_or_prefix() {
  local final="$1" temporary="$2" mode="$3" producer="$4" size
  if [[ -e "$final" || -L "$final" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" && ! -L "$final" && -f "$final" &&
      "$(realpath -- "$final")" == "$final" &&
      "$(stat --format='%U:%G:%a:%h' "$final")" == "root:root:$mode:1" ]] || return 1
    cmp -s -- "$final" <("$producer")
    return
  fi
  if [[ -e "$temporary" || -L "$temporary" ]]; then
    [[ ! -L "$temporary" && -f "$temporary" &&
      "$(realpath -- "$temporary")" == "$temporary" &&
      "$(stat --format='%U:%G:%a:%h' "$temporary")" == "root:root:$mode:1" ]] || return 1
    size="$(stat --format='%s' "$temporary")" || return 1
    [[ "$size" -le 4096 ]] || return 1
    cmp -n "$size" -s -- "$temporary" <("$producer")
  fi
}

require_copy_or_prefix() {
  local final="$1" temporary="$2" source="$3" final_mode="$4" source_mode="$5" digest="$6" size
  require_helper_file "$source" "$digest" "$source_mode" || return 1
  if [[ -e "$final" || -L "$final" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    require_helper_file "$final" "$digest" "$final_mode"
    return
  fi
  if [[ -e "$temporary" || -L "$temporary" ]]; then
    [[ ! -L "$temporary" && -f "$temporary" && "$(realpath -- "$temporary")" == "$temporary" &&
      "$(stat --format='%U:%G:%a:%h' "$temporary")" == "root:root:$final_mode:1" ]] || return 1
    size="$(stat --format='%s' "$temporary")" || return 1
    [[ "$size" -le "$(stat --format='%s' "$source")" ]] || return 1
    cmp -n "$size" -s -- "$temporary" "$source"
  fi
}

require_exact_h16_record() {
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

require_interrupted_h16_prefix() {
  local target_state=''
  require_h16_prefix_inventory || return 1
  require_disabled_grant_only || return 1
  require_record_or_prefix "$H16_INSTALLING/intent-v1" \
    "$H16_INSTALLING/.intent-v1.installing" 600 expected_intent || return 1
  require_record_or_prefix "$H16_INSTALLING/completed-v1" \
    "$H16_INSTALLING/.completed-v1.installing" 600 expected_completion || return 1
  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    target_state='predecessor'
  elif require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
    target_state='successor'
  else
    return 1
  fi

  if [[ ! -e "$H16_INSTALLING/intent-v1" && ! -L "$H16_INSTALLING/intent-v1" ]]; then
    [[ "$target_state" == 'predecessor' &&
      ! -e "$H16_INSTALLING/predecessor-helper" &&
      ! -L "$H16_INSTALLING/predecessor-helper" &&
      ! -e "$H16_INSTALLING/.predecessor-helper.installing" &&
      ! -L "$H16_INSTALLING/.predecessor-helper.installing" &&
      ! -e "$H16_INSTALLING/completed-v1" && ! -L "$H16_INSTALLING/completed-v1" &&
      ! -e "$H16_INSTALLING/.completed-v1.installing" &&
      ! -L "$H16_INSTALLING/.completed-v1.installing" &&
      ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
      ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
    return 0
  fi
  [[ ! -e "$H16_INSTALLING/.intent-v1.installing" &&
    ! -L "$H16_INSTALLING/.intent-v1.installing" ]] || return 1

  if [[ -e "$H16_INSTALLING/.predecessor-helper.installing" ||
    -L "$H16_INSTALLING/.predecessor-helper.installing" ]]; then
    [[ "$target_state" == 'predecessor' &&
      ! -e "$H16_INSTALLING/predecessor-helper" &&
      ! -L "$H16_INSTALLING/predecessor-helper" &&
      ! -e "$H16_INSTALLING/completed-v1" && ! -L "$H16_INSTALLING/completed-v1" &&
      ! -e "$H16_INSTALLING/.completed-v1.installing" &&
      ! -L "$H16_INSTALLING/.completed-v1.installing" &&
      ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
      ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
    require_copy_or_prefix "$H16_INSTALLING/predecessor-helper" \
      "$H16_INSTALLING/.predecessor-helper.installing" "$TARGET" 400 755 \
      "$PREDECESSOR_HELPER_SHA256"
    return
  fi
  if [[ ! -e "$H16_INSTALLING/predecessor-helper" &&
    ! -L "$H16_INSTALLING/predecessor-helper" ]]; then
    [[ "$target_state" == 'predecessor' &&
      ! -e "$H16_INSTALLING/completed-v1" && ! -L "$H16_INSTALLING/completed-v1" &&
      ! -e "$H16_INSTALLING/.completed-v1.installing" &&
      ! -L "$H16_INSTALLING/.completed-v1.installing" &&
      ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
      ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]
    return
  fi
  require_helper_file "$H16_INSTALLING/predecessor-helper" \
    "$PREDECESSOR_HELPER_SHA256" 400 || return 1

  if [[ "$target_state" == 'predecessor' ]]; then
    [[ ! -e "$H16_INSTALLING/completed-v1" && ! -L "$H16_INSTALLING/completed-v1" &&
      ! -e "$H16_INSTALLING/.completed-v1.installing" &&
      ! -L "$H16_INSTALLING/.completed-v1.installing" ]] || return 1
    [[ ! ( -e "$INSTALLING_HELPER" || -L "$INSTALLING_HELPER" ) ||
      ! ( -e "$INSTALLING_HELPER_PARTIAL" || -L "$INSTALLING_HELPER_PARTIAL" ) ]] || return 1
    if [[ -e "$INSTALLING_HELPER" || -L "$INSTALLING_HELPER" ]]; then
      require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
    elif [[ -e "$INSTALLING_HELPER_PARTIAL" || -L "$INSTALLING_HELPER_PARTIAL" ]]; then
      require_copy_or_prefix "$INSTALLING_HELPER" "$INSTALLING_HELPER_PARTIAL" \
        "$STAGED_HELPER" 755 600 "$SUCCESSOR_HELPER_SHA256" || return 1
    fi
    return 0
  fi

  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]]
}

require_pristine_initial_h16_boundary() {
  local state="$1"
  case "$state" in
    absent)
      [[ ! -e "$H16_PARENT" && ! -L "$H16_PARENT" ]] || return 1
      ;;
    empty-parent)
      [[ ! -L "$H16_PARENT" && -d "$H16_PARENT" &&
        "$(realpath -- "$H16_PARENT")" == "$H16_PARENT" &&
        "$(stat --format='%U:%G:%a' "$H16_PARENT")" == 'root:root:700' &&
        -z "$(find -P "$H16_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] || return 1
      ;;
    *) return 1 ;;
  esac
  [[ ! -e "$H16_INSTALLING" && ! -L "$H16_INSTALLING" &&
    ! -e "$H16_ROOT" && ! -L "$H16_ROOT" &&
    ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  require_static_h14_cohort_prepared_boundary || return 1
  require_helper_h14_cohort_prepared_boundary "$PREDECESSOR_HELPER_SHA256" || return 1
  require_exact_current_runtime_boundary
}

require_initial_h16_namespace() {
  local state="$1"
  require_pristine_initial_h16_boundary "$state" || return 1
  require_active_grant_only
}

require_disabled_initial_h16_checkpoint() {
  local state="$1"
  require_pristine_initial_h16_boundary "$state" || return 1
  require_disabled_grant_only
}

require_exact_completed_h16_namespace() {
  [[ ! -L "$H16_PARENT" && -d "$H16_PARENT" &&
    "$(realpath -- "$H16_PARENT")" == "$H16_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H16_PARENT")" == 'root:root:700' &&
    "$(find -P "$H16_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == \
      "$BRIDGE_RELEASE" ]] || return 1
  [[ ! -e "$H16_INSTALLING" && ! -L "$H16_INSTALLING" &&
    ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
  require_exact_h16_record "$H16_ROOT" || return 1
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755
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
initial_grant_state=''
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$grant_disabled" == 'true' ]]; then
    printf '%s\n' \
      'FetanAgent H16 bridge stopped with the deployment grant disabled. Rerun this exact reviewed installer; do not delete evidence or restore the grant manually.' >&2
  fi
  exit "$status"
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed H16 staging root is absent or unsafe'
[[ ! -L "$STAGED_INSTALLER" && -f "$STAGED_INSTALLER" &&
  "$(realpath -- "$0")" == "$STAGED_INSTALLER" &&
  "$(realpath -- "$STAGED_INSTALLER")" == "$STAGED_INSTALLER" &&
  "$(stat --format='%U:%G:%a:%h' "$STAGED_INSTALLER")" == 'root:root:700:1' ]] ||
  die 'run only the root-owned installer staged at the exact reviewed H16 path'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged H16 successor helper is invalid'

h16_state="$(classify_h16_namespace)" ||
  die 'the H16 namespace is not absent, empty, an exact interrupted prefix, or completed'
case "$h16_state" in
  absent|empty-parent)
    if require_initial_h16_namespace "$h16_state"; then
      initial_grant_state='active'
    elif require_disabled_initial_h16_checkpoint "$h16_state"; then
      initial_grant_state='disabled'
      grant_disabled='true'
    else
      die 'the initial H16 namespace, canonical H14 cohort, live runtime, or grant is inconsistent'
    fi
    ;;
  interrupted)
    require_interrupted_h16_prefix ||
      die 'the interrupted H16 prefix, helper, installer, or disabled grant is inconsistent'
    require_static_h14_cohort_prepared_boundary ||
      die 'the canonical H14 cohort changed during interrupted H16 recovery'
    require_exact_current_runtime_boundary ||
      die 'the exact current runtime changed during interrupted H16 recovery'
    grant_disabled='true'
    ;;
  completed)
    require_exact_completed_h16_namespace || die 'the completed H16 namespace is invalid'
    if [[ -e "$SUDOERS_DISABLED" || -L "$SUDOERS_DISABLED" ]]; then
      require_disabled_grant_only || die 'the disabled deployment grant is invalid'
      grant_disabled='true'
    else
      require_active_grant_only || die 'the active deployment grant is invalid'
    fi
    require_static_h14_cohort_prepared_boundary ||
      die 'the canonical H14 cohort is not exact after completed H16 promotion'
    require_exact_current_runtime_boundary ||
      die 'the exact current runtime is not ready after completed H16 promotion'
    ;;
  *) die 'the H16 namespace state is impossible' ;;
esac

trap cleanup EXIT
open_lock || die 'the exact staging mutation lock is unsafe or another mutation is active'
require_no_other_mutator_processes || die 'another helper or H16 installer process is active'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed under lock'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged H16 successor helper changed under lock'
[[ "$(classify_h16_namespace)" == "$h16_state" ]] ||
  die 'the H16 namespace changed before lock acquisition'
require_static_h14_cohort_prepared_boundary || die 'the canonical H14 evidence changed under lock'
require_exact_current_runtime_boundary || die 'the current no-transfer runtime changed under lock'
h14_evidence_before="$(h14_evidence_digest)" || die 'the canonical H14 evidence digest is unavailable'
runtime_boundary_before="$(runtime_boundary_digest)" || die 'the current runtime digest is unavailable'
[[ "$h14_evidence_before" =~ ^[0-9a-f]{64}$ &&
  "$runtime_boundary_before" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the pre-promotion immutable digests are invalid'

if [[ "$h16_state" == 'absent' || "$h16_state" == 'empty-parent' ]]; then
  case "$initial_grant_state" in
    active)
      require_initial_h16_namespace "$h16_state" || die 'the initial H16 boundary changed under lock'
      disable_sudoers || die 'the deployment grant could not be disabled safely'
      ;;
    disabled)
      require_disabled_initial_h16_checkpoint "$h16_state" ||
        die 'the disabled initial H16 checkpoint changed under lock'
      ;;
    *) die 'the initial H16 grant state is impossible' ;;
  esac
  require_no_other_mutator_processes ||
    die 'another helper or H16 installer process appeared after grant disablement'
  if [[ "$h16_state" == 'absent' ]]; then
    install -d -o root -g root -m 0700 "$H16_PARENT"
    sync -f "$(dirname -- "$H16_PARENT")"
  fi
  [[ "$(classify_h16_namespace)" == 'empty-parent' ]] ||
    die 'the H16 parent could not be initialized exactly'
  install -d -o root -g root -m 0700 "$H16_INSTALLING"
  sync -f "$H16_PARENT"
  h16_state='interrupted'
  require_interrupted_h16_prefix || die 'the empty H16 installing checkpoint is invalid'
fi

if [[ "$h16_state" == 'completed' ]]; then
  require_exact_completed_h16_namespace || die 'the completed H16 namespace changed under lock'
else
  require_interrupted_h16_prefix || die 'the interrupted H16 prefix changed under lock'
  require_static_h14_cohort_prepared_boundary ||
    die 'the canonical H14 cohort changed before H16 evidence publication'
  require_exact_current_runtime_boundary ||
    die 'the exact current runtime changed before H16 evidence publication'

  publish_record_atomically "$H16_INSTALLING" intent-v1 0600 expected_intent ||
    die 'the H16 intent could not be completed atomically'
  require_interrupted_h16_prefix || die 'the H16 intent publication is inconsistent'

  if [[ ! -e "$H16_INSTALLING/predecessor-helper" &&
    ! -L "$H16_INSTALLING/predecessor-helper" ]]; then
    copy_root_file_atomically "$TARGET" \
      "$H16_INSTALLING/.predecessor-helper.installing" \
      "$H16_INSTALLING/predecessor-helper" 0755 0400 "$PREDECESSOR_HELPER_SHA256" ||
      die 'the canonical H14 helper archive could not be completed atomically'
  fi
  require_helper_file "$H16_INSTALLING/predecessor-helper" \
    "$PREDECESSOR_HELPER_SHA256" 400 || die 'the archived canonical H14 helper is invalid'
  require_interrupted_h16_prefix || die 'the canonical H14 helper archive is inconsistent'

  if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
    if [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]; then
      copy_root_file_atomically "$STAGED_HELPER" "$INSTALLING_HELPER_PARTIAL" \
        "$INSTALLING_HELPER" 0600 0755 "$SUCCESSOR_HELPER_SHA256" ||
        die 'the H16 helper installer could not be completed atomically'
    fi
    require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 ||
      die 'the installing H16 helper is invalid'
    [[ ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
      die 'a partial H16 helper installer remains'
    mv -- "$INSTALLING_HELPER" "$TARGET"
    sync -f /usr/local/sbin
  fi
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
    die 'the installed H16 helper is invalid'
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] ||
    die 'an H16 helper installer residue remains after replacement'
  require_interrupted_h16_prefix || die 'the H16 helper replacement is inconsistent'

  publish_record_atomically "$H16_INSTALLING" completed-v1 0600 expected_completion ||
    die 'the H16 completion could not be completed atomically'
  require_exact_h16_record "$H16_INSTALLING" ||
    die 'the completed installing H16 record is invalid'
  [[ ! -e "$H16_ROOT" && ! -L "$H16_ROOT" ]] ||
    die 'the final H16 root appeared unexpectedly'
  mv -- "$H16_INSTALLING" "$H16_ROOT"
  sync -f "$H16_PARENT"
  h16_state='completed'
  require_exact_completed_h16_namespace || die 'the final H16 evidence is invalid'
fi

[[ "$(h14_evidence_digest)" == "$h14_evidence_before" ]] ||
  die 'the canonical H14 evidence changed during H16 promotion'
require_exact_current_runtime_boundary || die 'the current runtime changed during H16 promotion'
[[ "$(runtime_boundary_digest)" == "$runtime_boundary_before" ]] ||
  die 'the current runtime identity changed during H16 promotion'
close_lock

run_helper_direct verify "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the installed H16 helper rejected its reviewed digest'
run_helper_direct kemerbet-v3-runtime-bridge-ready "$SUCCESSOR_HELPER_SHA256" >/dev/null ||
  die 'the installed H16 helper rejected the durable runtime bridge'
require_helper_h14_cohort_prepared_boundary "$SUCCESSOR_HELPER_SHA256" ||
  die 'the installed H16 helper rejected the canonical cohort-prepared recovery boundary'
require_static_h14_cohort_prepared_boundary ||
  die 'the canonical H14 recovery evidence changed after H16 helper attestation'
require_exact_current_runtime_boundary ||
  die 'the exact current no-transfer runtime changed after H16 helper attestation'
[[ "$(h14_evidence_digest)" == "$h14_evidence_before" &&
  "$(runtime_boundary_digest)" == "$runtime_boundary_before" ]] ||
  die 'an immutable H14 or runtime identity changed after H16 helper attestation'

open_lock || die 'the exact mutation lock changed or another mutation appeared before grant restoration'
require_no_other_mutator_processes || die 'another helper or H16 installer process remained'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed before grant restoration'
[[ "$(classify_h16_namespace)" == 'completed' ]] || die 'the completed H16 namespace disappeared'
require_exact_completed_h16_namespace || die 'the H16 state changed before grant restoration'
require_static_h14_cohort_prepared_boundary ||
  die 'the canonical H14 cohort changed before grant restoration'
require_exact_current_runtime_boundary ||
  die 'the exact current runtime changed before grant restoration'
[[ "$(h14_evidence_digest)" == "$h14_evidence_before" &&
  "$(runtime_boundary_digest)" == "$runtime_boundary_before" ]] ||
  die 'an immutable H14 or runtime identity changed before grant restoration'
if [[ "$grant_disabled" == 'true' ]]; then
  restore_sudoers || die 'the deployment grant could not be restored safely'
  grant_disabled='false'
else
  require_active_grant_only || die 'the active deployment grant changed'
fi
close_lock
trap - EXIT

printf '%s\n' \
  'KemerBet H16 security-recovery preview bridge installed or validated: canonical H14 cohort preserved; Transfer disabled.'
