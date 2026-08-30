#!/usr/bin/env bash
# One-use, fail-closed compatibility bridge for the canonical H14 host-retired
# empty-profile serialization defect. The installed helper is never rewritten.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly CANONICAL_H14_RELEASE='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly CANONICAL_HELPER_SHA256='c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58'
readonly AUTHORIZATION_SHA256='6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
readonly STAGING_PROJECT_REF='spzpiyxheappsfyswewl'
readonly PRODUCTION_PROJECT_REF='xzztugbgtulptnbpoelr'
readonly STAGING_DROPLET_ID='593344964'
readonly STAGING_PUBLIC_IPV4='161.35.41.232'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly PROFILE_VOLUME='fetanagent-staging-beta_kemerbet_sessions'
readonly HELPER_PATH='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly DIAGNOSTIC_NAME='fetanagent-kemerbet-h14-terminal-differential-validator.py'
readonly ENGINE_NAME='fetanagent-kemerbet-h14-empty-profile-finalization-engine.py'
readonly MANIFEST_NAME='manifest-v1'
readonly H14_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14'
readonly PROFILE_ROOT='/var/lib/docker/volumes/fetanagent-staging-beta_kemerbet_sessions/_data'
readonly CONTROL_ROOT='/var/lib/docker/volumes/fetanagent-staging-beta_kemerbet_session_control/_data'
readonly OWNER_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-cohort-receipts'
readonly SEAL_BINDING='/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
readonly FINAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly RECHECK_RECEIPT='/var/lib/fetanagent/kemerbet-readiness-recheck/ready-v1'
readonly RECHECK_ROOT='/var/lib/fetanagent/kemerbet-readiness-recheck'
readonly RECHECK_RPC_ROOT='/run/fetanagent-kemerbet-readiness-rpc-v1'
readonly ACK_NAME='kemerbet-quarantine-recovery-profile-prepared-v1'
readonly TERMINAL_NAME='kemerbet-readiness-cohort-security-recovery-failed-terminal-v1'
readonly FINALIZED_NAME='kemerbet-readiness-cohort-security-recovery-profile-finalized-v1'
readonly BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-host-retired-empty-profile-finalization-bridge'
readonly MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"

export PATH="$SAFE_PATH"

die() {
  printf 'H14 empty-profile finalization bridge failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST='unix:///var/run/docker.sock' \
    docker --host 'unix:///var/run/docker.sock' "$@"
}

acquire_staging_mutation_lock() {
  local fd_identity path_identity
  command -v flock >/dev/null 2>&1 || die 'the staging mutation lock utility is unavailable'
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] ||
    die 'the runtime directory is unsafe for the staging mutation lock'
  if [[ ! -e "$MUTATION_LOCK_ROOT" && ! -L "$MUTATION_LOCK_ROOT" ]]; then
    (umask 077 && mkdir --mode=0700 -- "$MUTATION_LOCK_ROOT") ||
      die 'the staging mutation lock root could not be created'
  fi
  [[ ! -L "$MUTATION_LOCK_ROOT" && -d "$MUTATION_LOCK_ROOT" &&
    "$(realpath -- "$MUTATION_LOCK_ROOT")" == "$MUTATION_LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" == 'root:root:700' ]] ||
    die 'the staging mutation lock root is unsafe'
  if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$MUTATION_LOCK" && -f "$MUTATION_LOCK" &&
    "$(realpath -- "$MUTATION_LOCK")" == "$MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" == 'root:root:600:1' ]] ||
    die 'the staging mutation lock is unsafe'
  exec 9<>"$MUTATION_LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" ||
    die 'the staging mutation lock path could not be inspected'
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" ||
    die 'the opened staging mutation lock could not be inspected'
  [[ "$fd_identity" == '0:0:600:1:'* && "$fd_identity" == "$path_identity" ]] ||
    die 'the opened staging mutation lock does not match its root-managed path'
  flock --exclusive --nonblock 9 || die 'another staging mutation is already active'
  [[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")" == "$fd_identity" ]] ||
    die 'the staging mutation lock path changed while acquiring the lock'
}

require_fresh_host_identity() {
  local metadata_droplet_id metadata_ipv4
  command -v curl >/dev/null 2>&1 || die 'curl is unavailable for the staging host identity proof'
  metadata_droplet_id="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/id)" ||
    die 'the DigitalOcean identity could not be read'
  metadata_ipv4="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)" ||
    die 'the DigitalOcean public IPv4 could not be read'
  [[ "$metadata_droplet_id" == "$STAGING_DROPLET_ID" &&
    "$metadata_ipv4" == "$STAGING_PUBLIC_IPV4" ]] ||
    die 'the host is not the exact reviewed staging Droplet'
}

require_no_host_chromium() {
  env -i PATH="$SAFE_PATH" python3 -I - <<'PY'
import os
import re

browser = re.compile(
    rb'(^|[\s/])(chromium|chrome|google-chrome|headless_shell|chromedriver)([\s/-]|$)',
    re.I,
)
current_pid = os.getpid()
for entry in os.listdir('/proc'):
    if not entry.isdigit() or int(entry) == current_pid:
        continue
    try:
        with open(f'/proc/{entry}/cmdline', 'rb') as stream:
            value = stream.read(1024 * 1024).replace(b'\0', b' ')
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        continue
    if browser.search(value):
        raise SystemExit(1)
PY
}

require_container_no_chromium() {
  local container_id="$1" processes
  processes="$(docker_local container top "$container_id" -eo pid,comm,args)" || return 1
  [[ "$(head -n 1 <<<"$processes")" =~ ^[[:space:]]*PID[[:space:]]+COMMAND[[:space:]]+COMMAND([[:space:]]|$) ]] || return 1
  [[ "$(tail -n +2 <<<"$processes")" =~ ^[[:space:]]*[0-9]+[[:space:]] ]] || return 1
  ! grep -Eiq '(^|[[:space:]/])(chromium|chrome|google-chrome|headless_shell|chromedriver)([[:space:]/-]|$)' \
    <<<"$(tail -n +2 <<<"$processes")"
}

require_live_fail_closed_boundary() {
  local container_id environment health_contract health_status ids runtime_state service services state_contract
  local -a forbidden_services=(
    kemerbet-session-provision
    kemerbet-no-transfer-readiness
    kemerbet-readiness-browser
    kemerbet-readiness-egress-proxy
    kemerbet-readiness-authorizer
  )
  [[ ! -L "$PROFILE_ROOT" && -d "$PROFILE_ROOT" &&
    "$(realpath -- "$PROFILE_ROOT")" == "$PROFILE_ROOT" &&
    "$(stat --format='%u:%g:%a' "$PROFILE_ROOT")" == '10001:10001:700' &&
    -z "$(find -P "$PROFILE_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] ||
    die 'the live KemerBet profile root is not exact and empty'
  [[ -z "$(docker_local container ls --all --quiet --filter "volume=$PROFILE_VOLUME")" ]] ||
    die 'the KemerBet profile volume has a live or stopped holder'
  for service in "${forbidden_services[@]}"; do
    [[ -z "$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ]] ||
      die 'a KemerBet provider, coordinator, browser, or recheck container is present'
  done
  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | LC_ALL=C sort)" || die 'the staging service inventory could not be inspected'
  [[ "$services" == $'api\nbeta-admission\nbot\ncustomer-web\ngateway\nowner-control' ]] ||
    die 'the staging service inventory is not the exact fail-closed six-service boundary'
  for service in api beta-admission bot customer-web gateway owner-control; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" ||
      die 'a staging service identity could not be inspected'
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] || die 'a staging service is not singular'
    state_contract="$(docker_local container inspect "$ids" \
      --format '{{.State.Status}}|{{if .Config.Healthcheck}}present{{else}}absent{{end}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}absent{{end}}')" ||
      die 'a staging service runtime state could not be inspected'
    IFS='|' read -r runtime_state health_contract health_status <<<"$state_contract"
    [[ "$runtime_state" == running ]] || die 'a staging service is not running'
    if [[ "$service" == bot ]]; then
      [[ "$health_contract" == absent && "$health_status" == absent ]] ||
        die 'the bot healthcheck contract is not exactly absent'
    else
      [[ "$health_contract" == present && "$health_status" == healthy ]] ||
        die 'a required staging healthcheck is absent or unhealthy'
    fi
    require_container_no_chromium "$ids" ||
      die 'a staging service contains an unexpected Chromium process'
    environment="$(docker_local container inspect "$ids" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" ||
      die 'a staging container safety environment could not be inspected'
    ! grep -Fq "$PRODUCTION_PROJECT_REF" <<<"$environment" ||
      die 'a staging service references the production Supabase project'
    if [[ "$service" == owner-control ]]; then
      [[ "$(grep -Fxc "OWNER_CONTROL_SUPABASE_URL=https://$STAGING_PROJECT_REF.supabase.co" <<<"$environment")" == 1 ]] ||
        die 'Owner control is not pinned to the exact staging Supabase project'
    elif [[ "$service" == customer-web ]]; then
      [[ "$(grep -Fxc "CUSTOMER_WEB_SUPABASE_URL=https://$STAGING_PROJECT_REF.supabase.co" <<<"$environment")" == 1 ]] ||
        die 'Customer web is not pinned to the exact staging Supabase project'
    fi
    if [[ "$service" == gateway ]]; then
      ! grep -Eq '^(FINANCIAL_ACTIONS_MODE|KEMERBET_EXECUTOR_ENABLED|KEMERBET_FINAL_ACTION_ENABLED)=' \
        <<<"$environment" || die 'the gateway unexpectedly receives financial action gates'
    else
      [[ "$(grep -Fxc 'FINANCIAL_ACTIONS_MODE=dry_run' <<<"$environment")" == 1 &&
        "$(grep -Fxc 'KEMERBET_EXECUTOR_ENABLED=false' <<<"$environment")" == 1 &&
        "$(grep -Fxc 'KEMERBET_FINAL_ACTION_ENABLED=false' <<<"$environment")" == 1 &&
        "$(grep -Ec '^(FINANCIAL_ACTIONS_MODE|KEMERBET_EXECUTOR_ENABLED|KEMERBET_FINAL_ACTION_ENABLED)=' <<<"$environment")" == 3 ]] ||
        die 'a staging runtime does not retain the exact fail-closed financial gates'
    fi
    ! grep -Eq '^(FINANCIAL_ACTIONS_MODE=live|KEMERBET_(EXECUTOR|FINAL_ACTION|PRIVATE_LIVE_DEPOSIT_PILOT)_ENABLED=true|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=true)$' \
      <<<"$environment" || die 'a live KemerBet financial or provider gate is enabled'
  done
  require_no_host_chromium || die 'the staging host contains an unexpected Chromium process'
  [[ ! -e "$SEAL_BINDING" && ! -L "$SEAL_BINDING" &&
    ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" &&
    ! -e "$RECHECK_ROOT" && ! -L "$RECHECK_ROOT" &&
    ! -e "$RECHECK_RPC_ROOT" && ! -L "$RECHECK_RPC_ROOT" ]] ||
    die 'a KemerBet binding, recheck receipt, or RPC capability is unexpectedly present'
  for service in \
    "$CONTROL_ROOT/kemerbet-readiness-player-ids.stage-v1" \
    "$CONTROL_ROOT/.kemerbet-readiness-player-ids.stage-v1.installing" \
    "$CONTROL_ROOT/kemerbet-readiness-cohort-claim.stage-v1" \
    "$CONTROL_ROOT/.kemerbet-readiness-cohort-claim.stage-v1.installing"; do
    [[ ! -e "$service" && ! -L "$service" ]] ||
      die 'a stale Player-ID or claim stage is present'
  done
  env -i PATH="$SAFE_PATH" python3 -I - "$PROFILE_ROOT" <<'PY' ||
import os
import sys

profile_root = os.fsencode(sys.argv[1])
container_root = b'/var/lib/fetanagent/kemerbet-sessions'
current_pid = os.getpid()
for name in os.listdir('/proc'):
    if not name.isdigit() or int(name) == current_pid:
        continue
    try:
        with open(f'/proc/{name}/cmdline', 'rb') as handle:
            command = handle.read(1024 * 1024)
    except (FileNotFoundError, PermissionError, ProcessLookupError):
        continue
    if command and (profile_root in command or container_root in command):
        raise SystemExit(1)
PY
    die 'a Chromium or provider process still references the KemerBet profile root'
}

[[ $EUID -eq 0 ]] || die 'root execution is required'
[[ $# -eq 5 ]] || die 'expected bridge release and exact script, diagnostic, engine, and manifest SHA-256 digests'
readonly BRIDGE_RELEASE="$1"
readonly EXPECTED_SCRIPT_SHA256="$2"
readonly EXPECTED_DIAGNOSTIC_SHA256="$3"
readonly EXPECTED_ENGINE_SHA256="$4"
readonly EXPECTED_MANIFEST_SHA256="$5"
[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$BRIDGE_RELEASE" != "$CANONICAL_H14_RELEASE" &&
  "$EXPECTED_SCRIPT_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$EXPECTED_DIAGNOSTIC_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$EXPECTED_ENGINE_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$EXPECTED_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the immutable bridge identity is invalid'

readonly SCRIPT_PATH="$(realpath -- "$0")"
readonly BUNDLE_ROOT="$(dirname -- "$SCRIPT_PATH")"
readonly DIAGNOSTIC_PATH="$BUNDLE_ROOT/$DIAGNOSTIC_NAME"
readonly ENGINE_PATH="$BUNDLE_ROOT/$ENGINE_NAME"
readonly MANIFEST_PATH="$BUNDLE_ROOT/$MANIFEST_NAME"
readonly H14_ROOT="$H14_PARENT/$CANONICAL_H14_RELEASE"
readonly ACK_SOURCE="$CONTROL_ROOT/$ACK_NAME"
readonly ACK_TARGET="$H14_ROOT/database-profile-prepared-v1"
readonly TERMINAL_SOURCE="$OWNER_RECEIPT_ROOT/$TERMINAL_NAME"
readonly FINALIZED_TARGET="$OWNER_RECEIPT_ROOT/$FINALIZED_NAME"
readonly INSTALLING_ROOT="$BRIDGE_PARENT/.installing-$BRIDGE_RELEASE"
readonly FINAL_ROOT="$BRIDGE_PARENT/$BRIDGE_RELEASE"
readonly INTENT="$INSTALLING_ROOT/intent-v1"
readonly COMPLETED="$INSTALLING_ROOT/completed-v1"

[[ ! -L "$SCRIPT_PATH" && -f "$SCRIPT_PATH" &&
  "$(stat -c '%U:%G:%a:%h' "$SCRIPT_PATH")" == 'root:root:400:1' &&
  "$(sha256sum -- "$SCRIPT_PATH" | awk '{print $1}')" == "$EXPECTED_SCRIPT_SHA256" ]] ||
  die 'the staged bridge script is not the reviewed immutable file'
[[ ! -L "$DIAGNOSTIC_PATH" && -f "$DIAGNOSTIC_PATH" &&
  "$(stat -c '%U:%G:%a:%h' "$DIAGNOSTIC_PATH")" == 'root:root:400:1' &&
  "$(sha256sum -- "$DIAGNOSTIC_PATH" | awk '{print $1}')" == "$EXPECTED_DIAGNOSTIC_SHA256" ]] ||
  die 'the staged canonical differential validator is not exact'
[[ ! -L "$ENGINE_PATH" && -f "$ENGINE_PATH" &&
  "$(stat -c '%U:%G:%a:%h' "$ENGINE_PATH")" == 'root:root:400:1' &&
  "$(sha256sum -- "$ENGINE_PATH" | awk '{print $1}')" == "$EXPECTED_ENGINE_SHA256" ]] ||
  die 'the staged standalone transaction engine is not exact'
[[ ! -L "$MANIFEST_PATH" && -f "$MANIFEST_PATH" &&
  "$(stat -c '%U:%G:%a:%h' "$MANIFEST_PATH")" == 'root:root:400:1' &&
  "$(sha256sum -- "$MANIFEST_PATH" | awk '{print $1}')" == "$EXPECTED_MANIFEST_SHA256" ]] ||
  die 'the staged one-use bundle manifest is not exact'
[[ "$(find -P "$BUNDLE_ROOT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)" == \
  $'fetanagent-kemerbet-h14-empty-profile-finalization-engine.py:f\nfetanagent-kemerbet-h14-host-retired-empty-profile-finalization-bridge.sh:f\nfetanagent-kemerbet-h14-terminal-differential-validator.py:f\nmanifest-v1:f' ]] ||
  die 'the immutable bridge bundle contains an unexpected entry'
expected_bundle_manifest() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-h14-empty-profile-finalization-bundle' \
    "bridge_release=$BRIDGE_RELEASE" \
    "canonical_h14_release=$CANONICAL_H14_RELEASE" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "staging_project_ref=$STAGING_PROJECT_REF" \
    "staging_droplet_id=$STAGING_DROPLET_ID" \
    "script_sha256=$EXPECTED_SCRIPT_SHA256" \
    "script_size=$(stat -c %s "$SCRIPT_PATH")" \
    "diagnostic_sha256=$EXPECTED_DIAGNOSTIC_SHA256" \
    "diagnostic_size=$(stat -c %s "$DIAGNOSTIC_PATH")" \
    "engine_sha256=$EXPECTED_ENGINE_SHA256" \
    "engine_size=$(stat -c %s "$ENGINE_PATH")" \
    'execute_after_security_recovery_ack=true' \
    'installed_helper_changed=false' \
    'provider_action_enabled=false' \
    'amount_entry_enabled=false' \
    'transfer_enabled=false' \
    'money_moved=false'
}
cmp -s -- "$MANIFEST_PATH" <(expected_bundle_manifest) ||
  die 'the one-use bundle manifest does not bind the exact reviewed files and staging target'
[[ ! -L "$HELPER_PATH" && -f "$HELPER_PATH" &&
  "$(stat -c '%U:%G:%a:%h' "$HELPER_PATH")" == 'root:root:755:1' &&
  "$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" == "$CANONICAL_HELPER_SHA256" ]] ||
  die 'the installed canonical helper identity changed'
[[ ! -L "$H14_PARENT" && -d "$H14_PARENT" &&
  "$(find -P "$H14_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n')" == "$CANONICAL_H14_RELEASE:d" ]] ||
  die 'the canonical H14 parent is not singular'

acquire_staging_mutation_lock
require_fresh_host_identity
require_live_fail_closed_boundary

engine() {
  env -i PATH="$SAFE_PATH" python3 -I "$ENGINE_PATH" "$1" \
    "$H14_ROOT" "$HELPER_PATH" "$ACK_SOURCE" "$TERMINAL_SOURCE" "$FINALIZED_TARGET" \
    "$BRIDGE_RELEASE" "$EXPECTED_SCRIPT_SHA256" "$EXPECTED_DIAGNOSTIC_SHA256" \
    "$EXPECTED_ENGINE_SHA256" "$EXPECTED_MANIFEST_SHA256" "$2" "$3"
}

publish_append_complete() {
  local path="$1" expected="$2" data_fd
  exec {data_fd}<<<"$expected"
  env -i PATH="$SAFE_PATH" python3 -I - "$path" "$data_fd" <<'PY' || {
import os
import stat
import sys

path, data_fd = sys.argv[1], int(sys.argv[2])
expected = b''
while True:
    chunk = os.read(data_fd, 65536)
    if not chunk:
        break
    expected += chunk
if not expected or expected[-1:] != b'\n':
    raise SystemExit(1)
directory = os.path.dirname(path)
temporary = os.path.join(directory, f'.{os.path.basename(path)}.installing')
if os.path.lexists(path):
    if os.path.lexists(temporary):
        raise SystemExit(1)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        data = os.pread(descriptor, len(expected) + 1, 0)
        if (not stat.S_ISREG(value.st_mode) or
            (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, 0o600, 1) or
            data != expected):
            raise SystemExit(1)
    finally:
        os.close(descriptor)
    raise SystemExit(0)
if os.path.lexists(temporary):
    descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    value = os.fstat(descriptor)
    data = os.pread(descriptor, len(expected) + 1, 0)
    if (not stat.S_ISREG(value.st_mode) or
        (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, 0o600, 1) or
        len(data) > len(expected) or data != expected[:len(data)]):
        os.close(descriptor)
        raise SystemExit(1)
else:
    descriptor = os.open(
        temporary,
        os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
    )
try:
    current = os.lseek(descriptor, 0, os.SEEK_END)
    while current < len(expected):
        written = os.write(descriptor, expected[current:])
        if written <= 0:
            raise SystemExit(1)
        current += written
    os.fsync(descriptor)
finally:
    os.close(descriptor)
directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    os.fsync(directory_fd)
    os.rename(temporary, path)
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
    exec {data_fd}<&-
    die 'an append-complete bridge ledger record could not be published safely'
  }
  exec {data_fd}<&-
}

load_intent() {
  [[ ! -L "$INTENT" && -f "$INTENT" &&
    "$(stat -c '%U:%G:%a:%h' "$INTENT")" == 'root:root:600:1' ]] || return 1
  engine emit-intent "$INTENT" "$COMPLETED" | cmp -s -- "$INTENT" -
}

if [[ -e "$FINAL_ROOT" || -L "$FINAL_ROOT" ]]; then
  final_intent="$FINAL_ROOT/intent-v1"
  final_completed="$FINAL_ROOT/completed-v1"
  [[ ! -L "$BRIDGE_PARENT" && -d "$BRIDGE_PARENT" &&
    "$(realpath -- "$BRIDGE_PARENT")" == "$BRIDGE_PARENT" &&
    "$(stat -c '%U:%G:%a' "$BRIDGE_PARENT")" == 'root:root:700' &&
    ! -e "$INSTALLING_ROOT" && ! -L "$INSTALLING_ROOT" &&
    "$(find -P "$BRIDGE_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n')" == "$BRIDGE_RELEASE:d" &&
    ! -L "$FINAL_ROOT" && -d "$FINAL_ROOT" &&
    "$(stat -c '%U:%G:%a' "$FINAL_ROOT")" == 'root:root:700' &&
    "$(find -P "$FINAL_ROOT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)" == $'completed-v1:f\nintent-v1:f' ]] ||
    die 'the completed one-use bridge ledger namespace is invalid'
  engine verify-completed "$final_intent" "$final_completed" ||
    die 'the completed one-use bridge ledger or live post-state is invalid'
  ready_output="$(env -i PATH="$SAFE_PATH" SUDO_USER='fetanagent-admin' "$HELPER_PATH" \
    kemerbet-quarantine-recovery-ready "$CANONICAL_H14_RELEASE")" ||
    die 'the unchanged installed helper rejected the completed boundary'
  [[ "$ready_output" == 'KemerBet H14 recovery state: runtime-ready; Transfer and Amount disabled.' ]] ||
    die 'the completed runtime-ready result is not exact'
  printf '%s\n' 'KemerBet H14 replacement profile prepared: Transfer and Amount disabled.'
  exit 0
fi

require_exact_host_retired_diagnostic() {
  diagnostic_output="$(env -i PATH="$SAFE_PATH" python3 -I "$DIAGNOSTIC_PATH" \
    "$H14_PARENT" "$HELPER_PATH" "$PROFILE_ROOT" "$CONTROL_ROOT" "$SEAL_BINDING" \
    "$FINAL_BINDING" "$RECHECK_RECEIPT" "$OWNER_RECEIPT_ROOT" "$AUTHORIZATION_SHA256" \
    "$ACK_NAME" "$TERMINAL_NAME" "$FINALIZED_NAME")" ||
    die 'the exact canonical host-retired differential predicate failed'
  [[ "$diagnostic_output" == 'PASS H14-D000' ]] ||
    die 'the canonical host-retired predicate was ambiguous'
}

if [[ ! -e "$BRIDGE_PARENT" && ! -L "$BRIDGE_PARENT" ]]; then
  require_exact_host_retired_diagnostic
  umask 077
  install -d -o root -g root -m 0700 "$BRIDGE_PARENT"
  sync -f /var/lib/fetanagent
  sync -f "$BRIDGE_PARENT"
else
  [[ ! -L "$BRIDGE_PARENT" && -d "$BRIDGE_PARENT" &&
    "$(realpath -- "$BRIDGE_PARENT")" == "$BRIDGE_PARENT" &&
    "$(stat -c '%U:%G:%a' "$BRIDGE_PARENT")" == 'root:root:700' &&
    "$(find -P "$BRIDGE_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n')" =~ ^($|\.installing-$BRIDGE_RELEASE:d)$ ]] ||
    die 'a different or malformed compatibility transaction already exists'
fi

if [[ ! -e "$INSTALLING_ROOT" && ! -L "$INSTALLING_ROOT" ]]; then
  require_exact_host_retired_diagnostic
  install -d -o root -g root -m 0700 "$INSTALLING_ROOT"
  sync -f "$BRIDGE_PARENT"
fi
[[ ! -L "$INSTALLING_ROOT" && -d "$INSTALLING_ROOT" &&
  "$(realpath -- "$INSTALLING_ROOT")" == "$INSTALLING_ROOT" &&
  "$(stat -c '%U:%G:%a' "$INSTALLING_ROOT")" == 'root:root:700' ]] ||
  die 'the installing bridge ledger root is unsafe'
ledger_entries="$(find -P "$INSTALLING_ROOT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)"
case "$ledger_entries" in
  ''|'.intent-v1.installing:f'|'intent-v1:f'|$'.completed-v1.installing:f\nintent-v1:f'|$'completed-v1:f\nintent-v1:f') ;;
  *) die 'the installing bridge ledger has an invalid crash prefix or unexpected entry' ;;
esac
expected_intent_data="$(engine emit-intent "$INTENT" "$COMPLETED")" ||
  die 'the exact current H14 pins could not be generated'
if [[ "$ledger_entries" == '' || "$ledger_entries" == '.intent-v1.installing:f' ]]; then
  require_exact_host_retired_diagnostic
  publish_append_complete "$INTENT" "$expected_intent_data"
  sync -f "$INSTALLING_ROOT"
  sync -f "$BRIDGE_PARENT"
fi

load_intent || die 'the compatibility intent or one of its 12 pinned base records changed'

# The separately staged immutable engine validates all twelve base pins, the
# ACK and terminal identities/digests, and the exact P0-P5 prefix again in the
# same process that performs the canonical append/rename finalization.
engine finalize "$INTENT" "$COMPLETED" ||
  die 'the exact standalone H14 profile finalizer failed closed'

ready_output="$(env -i PATH="$SAFE_PATH" SUDO_USER='fetanagent-admin' "$HELPER_PATH" \
  kemerbet-quarantine-recovery-ready "$CANONICAL_H14_RELEASE")" ||
  die 'the unchanged installed helper rejected the post-finalization boundary'
[[ "$ready_output" == 'KemerBet H14 recovery state: runtime-ready; Transfer and Amount disabled.' ]] ||
  die 'the post-finalization runtime-ready result is not exact'
[[ "$(sha256sum -- "$HELPER_PATH" | awk '{print $1}')" == "$CANONICAL_HELPER_SHA256" ]] ||
  die 'the installed helper changed during standalone compatibility execution'
require_live_fail_closed_boundary
load_intent || die 'the durable compatibility evidence changed during finalization'
expected_completion_data="$(engine emit-completion "$INTENT" "$COMPLETED")" ||
  die 'the exact completed ledger could not be generated from the live post-state'
publish_append_complete "$COMPLETED" "$expected_completion_data"
engine verify-completed "$INTENT" "$COMPLETED" ||
  die 'the exact completion ledger did not bind the live post-state'
[[ "$(find -P "$INSTALLING_ROOT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)" == \
  $'completed-v1:f\nintent-v1:f' ]] ||
  die 'the bridge ledger contains an unexpected entry before publication'
sync -f "$INSTALLING_ROOT"
mv -- "$INSTALLING_ROOT" "$FINAL_ROOT"
sync -f "$BRIDGE_PARENT"
[[ ! -L "$FINAL_ROOT" && -d "$FINAL_ROOT" &&
  "$(stat -c '%U:%G:%a' "$FINAL_ROOT")" == 'root:root:700' &&
  "$(find -P "$FINAL_ROOT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)" == \
    $'completed-v1:f\nintent-v1:f' ]] ||
  die 'the final bridge ledger publication is not exact'
engine verify-completed "$FINAL_ROOT/intent-v1" "$FINAL_ROOT/completed-v1" ||
  die 'the final bridge ledger replay or live post-state is invalid'

printf '%s\n' 'KemerBet H14 replacement profile prepared: Transfer and Amount disabled.'
