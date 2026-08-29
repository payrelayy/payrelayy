#!/usr/bin/env bash
# Root-console-only terminal attestation for the exact interrupted a579 H14
# live-repair prefix. Canonical H14 and its c36 helper are immutable inputs.
# This bridge repairs only the release-bound completion ledger and deployment
# grant after independently revalidating the host-retired state. It never opens
# a browser, performs a provider action, enters Amount, clicks Transfer, enables
# a financial gate, or moves money.

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly PREDECESSOR_RELEASE='306818ca812bd2abce8479396c4eea8383ea00f9'
readonly REVIEWED_REPAIR_RELEASE='a579e3bf96c075dde9c36dbe3c66c09aaf84bc52'
readonly CANONICAL_H14='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly H13_HELPER_SHA256='3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa'
readonly H14_HELPER_SHA256='c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58'
readonly AUTHORIZATION_SHA256='6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
readonly PREVIOUS_ATTESTATION_RELEASE='38e9d2660b871c691afdd69541e17c17a7b55821'
readonly PREVIOUS_ATTESTATION_SCRIPT_SHA256='dfad82098c2042a5cd884f7c1116a9b4e424ac8685a68db3c7633f58a7e22bfb'
readonly PREVIOUS_ATTESTATION_SCRIPT_SIZE='92946'
readonly PREVIOUS_DIFFERENTIAL_VALIDATOR_SHA256='d4e4f91603956e2051d9b77ce8a43392b6d46c062c3d397d28fa18f499b15542'
readonly PREVIOUS_DIFFERENTIAL_VALIDATOR_SIZE='17941'
readonly PREVIOUS_BUNDLE_MANIFEST_SHA256='25ff5bb29342bbb1404ff888dacb43d464867c113f8f3db04ebb2df4e90ae733'
readonly PREVIOUS_BUNDLE_MANIFEST_SIZE='928'
readonly PREVIOUS_CLAIM_PARENT_DEV_INO='64769:6102851'
readonly PREVIOUS_CLAIM_ROOT_DEV_INO='64769:6102854'
readonly PREVIOUS_ATTESTATION_SCRIPT_DEV_INO='64769:6102855'
readonly PREVIOUS_DIFFERENTIAL_VALIDATOR_DEV_INO='64769:6102856'
readonly PREVIOUS_BUNDLE_MANIFEST_DEV_INO='64769:6102857'
readonly STAGING_PROJECT_REF='spzpiyxheappsfyswewl'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-installing'
readonly INSTALLING_HELPER_PARTIAL="${INSTALLING_HELPER}.partial"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-disabled'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="${LOCK_ROOT}/mutation.lock"
readonly H14_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14'
readonly H14_ROOT="${H14_PARENT}/${CANONICAL_H14}"
readonly REPAIR_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-live-repair'
readonly ATTESTATION_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-terminal-attestation'
readonly CLAIM_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-terminal-attestation-bundles'
readonly PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly OWNER_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-cohort-receipts'
readonly SEAL_BINDING='/var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings'
readonly FINAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly RECHECK_RECEIPT='/var/lib/fetanagent/kemerbet-readiness-recheck/ready-v1'
readonly PROFILE_ACK_NAME='kemerbet-quarantine-recovery-profile-prepared-v1'
readonly TERMINAL_MARKER_NAME='kemerbet-readiness-cohort-security-recovery-failed-terminal-v1'
readonly PROFILE_FINALIZED_NAME='kemerbet-readiness-cohort-security-recovery-profile-finalized-v1'
readonly FAILED_MARKER_NAME='kemerbet-readiness-cohort-failed-v1'
readonly PLAYER_STAGE_NAME='kemerbet-readiness-player-ids.stage-v1'
readonly CLAIM_STAGE_NAME='kemerbet-readiness-cohort-claim.stage-v1'
readonly SCRIPT_BASENAME='fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge.sh'
readonly VALIDATOR_BASENAME='fetanagent-kemerbet-h14-terminal-differential-validator.py'
readonly MANIFEST_BASENAME='manifest-v1'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H14 terminal attestation failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 6 ]] ||
  die 'expected attestation SHA, exact a579 repair SHA, canonical H14 SHA, staged bundle path, manifest digest, and authorization digest'
readonly ATTESTATION_RELEASE="$1"
readonly REPAIR_RELEASE="$2"
readonly PROVIDED_CANONICAL_H14="$3"
readonly STAGED_BUNDLE="$4"
readonly PROVIDED_MANIFEST_SHA256="$5"
readonly PROVIDED_AUTHORIZATION_SHA256="$6"
readonly STAGING_ROOT="/root/fetanagent-h14-terminal-attestation-${ATTESTATION_RELEASE}"
readonly STAGED_INSTALLER="${STAGING_ROOT}/${SCRIPT_BASENAME}"
readonly REPAIR_INSTALLING="${REPAIR_PARENT}/.installing-${REPAIR_RELEASE}"
readonly REPAIR_ROOT="${REPAIR_PARENT}/${REPAIR_RELEASE}"
readonly ATTESTATION_INSTALLING="${ATTESTATION_PARENT}/.installing-${ATTESTATION_RELEASE}"
readonly ATTESTATION_ROOT="${ATTESTATION_PARENT}/${ATTESTATION_RELEASE}"
readonly CLAIM_INSTALLING="${CLAIM_PARENT}/.installing-${ATTESTATION_RELEASE}"
readonly CLAIM_ROOT="${CLAIM_PARENT}/${ATTESTATION_RELEASE}"

[[ "$ATTESTATION_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$ATTESTATION_RELEASE" != "$PREVIOUS_ATTESTATION_RELEASE" &&
  "$ATTESTATION_RELEASE" != "$REPAIR_RELEASE" &&
  "$ATTESTATION_RELEASE" != "$CANONICAL_H14" &&
  "$ATTESTATION_RELEASE" != "$PREDECESSOR_RELEASE" ]] ||
  die 'the attestation implementation must be one distinct full lowercase commit SHA'
[[ "$REPAIR_RELEASE" == "$REVIEWED_REPAIR_RELEASE" ]] ||
  die 'the interrupted live-repair release is not exact a579'
[[ "$PROVIDED_CANONICAL_H14" == "$CANONICAL_H14" ]] ||
  die 'the canonical H14 release is not exact'
[[ "$PROVIDED_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the staged manifest digest is invalid'
[[ "$PROVIDED_AUTHORIZATION_SHA256" == "$AUTHORIZATION_SHA256" ]] ||
  die 'the exact reviewed quarantine-recovery authorization digest is required'
[[ "$STAGED_BUNDLE" == "/tmp/fetanagent-h14-terminal-attestation-${ATTESTATION_RELEASE}" ]] ||
  die 'the one-use staged bundle path is not exact'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run only in a fresh DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl dirname docker env find grep head id mkdir mv \
  python3 realpath sha256sum sort stat sync tail visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

[[ ! -L "$STAGED_INSTALLER" && -f "$STAGED_INSTALLER" &&
  "$(realpath -- "$0")" == "$STAGED_INSTALLER" &&
  "$(realpath -- "$STAGED_INSTALLER")" == "$STAGED_INSTALLER" &&
  "$(stat --format='%U:%G:%a:%h' "$STAGED_INSTALLER")" == 'root:root:600:1' ]] ||
  die 'run only the root-owned immutable attestation script from its exact staging path'

docker_local() {
  env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

require_exact_droplet() {
  [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA/id")" == "$EXPECTED_DROPLET_ID" ]] || return 1
  [[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]]
}

expected_sudoers() {
  printf '%s\n' 'fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *'
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

require_active_grant_only() {
  require_exact_sudoers_file "$SUDOERS" || return 1
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] || return 1
  visudo -cf /etc/sudoers >/dev/null
}

restore_sudoers() {
  require_disabled_grant_only || return 1
  mv -- "$SUDOERS_DISABLED" "$SUDOERS" || return 1
  sync -f /etc/sudoers.d || return 1
  require_active_grant_only
}

require_helper_exact() {
  [[ ! -L "$TARGET" && -f "$TARGET" && "$(realpath -- "$TARGET")" == "$TARGET" &&
    "$(stat --format='%U:%G:%a:%h' "$TARGET")" == 'root:root:755:1' &&
    "$(sha256sum -- "$TARGET" | awk '{print $1}')" == "$H14_HELPER_SHA256" ]] || return 1
  bash -n "$TARGET" || return 1
  [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" &&
    ! -e "$INSTALLING_HELPER_PARTIAL" && ! -L "$INSTALLING_HELPER_PARTIAL" ]] || return 1
  env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' \
    "$TARGET" verify "$H14_HELPER_SHA256" >/dev/null
}

require_no_other_mutator_processes() {
  local argument basename cmdline pid
  for cmdline in /proc/[0-9]*/cmdline; do
    [[ -r "$cmdline" ]] || continue
    pid="${cmdline#/proc/}"
    pid="${pid%/cmdline}"
    if [[ "$pid" == "$$" ||
      ( -n "${LOCK_HOLDER_PROCESS_ID:-}" && "$pid" == "$LOCK_HOLDER_PROCESS_ID" ) ]]; then
      continue
    fi
    while IFS= read -r -d '' argument; do
      basename="${argument##*/}"
      case "$basename" in
        fetanagent-staging-deploy-helper|fetanagent-kemerbet-quarantine-recovery-v14.sh|\
        fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh|\
        fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh|\
        fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bridge.sh) return 1 ;;
      esac
    done <"$cmdline" || true
  done
}

has_enabled_financial_gate() {
  local entry environment="$1" status
  while IFS= read -r entry; do
    case "$entry" in
      FINANCIAL_ACTIONS_MODE=dry_run) continue ;;
      FINANCIAL_ACTIONS_MODE=*) return 0 ;;
    esac
    [[ "$entry" == 'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' ]] && continue
    if grep -Eiq '^(FETANAGENT_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY|WITHDRAW|SETTLEMENT).*|KEMERBET_.*(EXECUTOR|FINAL_ACTION|TRANSFER|AMOUNT_ENTRY).*|INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED|KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED|TRUSTED_TELEBIRR_PRIVATE_LIVE_PILOT_ENABLED)=(1|true|yes|on)$' <<<"$entry"; then
      return 0
    else
      status=$?
      [[ "$status" -eq 1 ]] || return 0
    fi
  done <<<"$environment"
  return 1
}

require_financial_gates_disabled() {
  local container dry_run_count environment inventory mode_count service
  [[ ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" ]] || return 1
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    service="$(docker_local container inspect "$container" \
      --format '{{index .Config.Labels "com.docker.compose.service"}}')" || return 1
    [[ "$service" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || return 1
    environment="$(docker_local container inspect "$container" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
    mode_count="$(awk 'index($0, "FINANCIAL_ACTIONS_MODE=") == 1 { count += 1 } END { print count + 0 }' <<<"$environment")" || return 1
    dry_run_count="$(awk '$0 == "FINANCIAL_ACTIONS_MODE=dry_run" { count += 1 } END { print count + 0 }' <<<"$environment")" || return 1
    if [[ "$service" == 'gateway' ]]; then
      [[ "$mode_count" == '0' && "$dry_run_count" == '0' ]] || return 1
    else
      [[ "$mode_count" == '1' && "$dry_run_count" == '1' ]] || return 1
    fi
    ! has_enabled_financial_gate "$environment" || return 1
  done <<<"$inventory"
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

require_container_no_chromium() {
  local container_id="$1" processes
  processes="$(docker_local container top "$container_id" -eo pid,comm,args)" || return 1
  [[ "$(head -n 1 <<<"$processes")" =~ ^[[:space:]]*PID[[:space:]]+COMMAND[[:space:]]+COMMAND([[:space:]]|$) ]] || return 1
  [[ "$(tail -n +2 <<<"$processes")" =~ ^[[:space:]]*[0-9]+[[:space:]] ]] || return 1
  ! grep -Eiq '(^|[[:space:]/])(chromium|chrome|google-chrome|headless_shell|chromedriver)([[:space:]/-]|$)' \
    <<<"$(tail -n +2 <<<"$processes")"
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
payload = json.load(sys.stdin)
if not isinstance(payload, list) or len(payload) != 1 or payload[0].get('Id') != expected_id:
    raise SystemExit(1)
item = payload[0]
config = item.get('Config')
host = item.get('HostConfig')
mounts = item.get('Mounts')
if not isinstance(config, dict) or not isinstance(host, dict) or not isinstance(mounts, list):
    raise SystemExit(1)
if any(not isinstance(value, dict) for value in mounts):
    raise SystemExit(1)
destinations = [value.get('Destination') for value in mounts]
if any(not isinstance(value, str) or not value.startswith('/') for value in destinations) or len(set(destinations)) != len(destinations):
    raise SystemExit(1)
contract = {
    'version': 'fetanagent-docker-semantic-contract-v2',
    'Id': item.get('Id'),
    'Image': item.get('Image'),
    'Config.Image': config.get('Image'),
    'Config.User': config.get('User'),
    'Config.Cmd': config.get('Cmd'),
    'Config.Env': config.get('Env'),
    'HostConfig.ReadonlyRootfs': host.get('ReadonlyRootfs'),
    'HostConfig.CapAdd': host.get('CapAdd'),
    'HostConfig.CapDrop': host.get('CapDrop'),
    'HostConfig.SecurityOpt': host.get('SecurityOpt'),
    'HostConfig.RestartPolicy': host.get('RestartPolicy'),
    'Mounts': sorted(mounts, key=lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)),
    'Config.Labels': config.get('Labels'),
}
encoded = (json.dumps(contract, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode('ascii')
print(hashlib.sha256(encoded).hexdigest())
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

container_full_ids_for_volume() {
  local volume="$1" container_id full_id inventory
  inventory="$(docker_local container ls --all --quiet --filter "volume=$volume")" || return 1
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    full_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" || return 1
    [[ "$full_id" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$full_id"
  done <<<"$inventory" | LC_ALL=C sort
}

require_owner_contract() {
  local owner_id="$1" environment control_source
  [[ "$owner_id" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker_local container inspect "$owner_id" --format '{{.Id}}')" == "$owner_id" &&
    "$(docker_local container inspect "$owner_id" --format '{{index .Config.Labels "com.docker.compose.project"}}')" == "$PROJECT_NAME" &&
    "$(docker_local container inspect "$owner_id" --format '{{index .Config.Labels "com.docker.compose.service"}}')" == 'owner-control' &&
    "$(docker_local container inspect "$owner_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$PREDECESSOR_RELEASE" &&
    "$(docker_local container inspect "$owner_id" --format '{{.Config.User}}')" == '10001:10001' &&
    "$(docker_local container inspect "$owner_id" --format '{{.HostConfig.ReadonlyRootfs}}')" == 'true' &&
    "$(docker_local container inspect "$owner_id" --format '{{.HostConfig.RestartPolicy.Name}}')" == 'no' &&
    "$(docker_local container inspect "$owner_id" --format '{{json .HostConfig.CapAdd}}')" == 'null' &&
    "$(docker_local container inspect "$owner_id" --format '{{json .HostConfig.CapDrop}}')" == '["ALL"]' &&
    "$(docker_local container inspect "$owner_id" --format '{{json .HostConfig.SecurityOpt}}')" == '["no-new-privileges:true"]' ]] || return 1
  environment="$(docker_local container inspect "$owner_id" \
    --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
  [[ "$(awk '$0 == "FINANCIAL_ACTIONS_MODE=dry_run" { count += 1 } END { print count + 0 }' <<<"$environment")" == '1' ]] || return 1
  grep -Fxq 'KEMERBET_EXECUTOR_ENABLED=false' <<<"$environment" || return 1
  grep -Fxq 'KEMERBET_FINAL_ACTION_ENABLED=false' <<<"$environment" || return 1
  ! has_enabled_financial_gate "$environment" || return 1
  control_source="$(docker_local container inspect "$owner_id" --format \
    '{{range .Mounts}}{{if eq .Destination "/run/fetanagent-kemerbet-session-control"}}{{.Name}}{{end}}{{end}}')" || return 1
  [[ "$control_source" == "$CONTROL_VOLUME" ]]
}

require_volume_root() {
  local path="$1"
  [[ ! -L "$path" && -d "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a' "$path")" == '10001:10001:700' &&
    -z "$(find -P "$path" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]]
}

require_runtime_boundary() {
  local actual owner_id="$1" control_holders owner_inventory profile_holders
  owner_inventory="$(container_full_ids_for_service owner-control)" || return 1
  [[ "$owner_inventory" == "$owner_id" ]] || return 1
  [[ -z "$(container_full_ids_for_service kemerbet-session-provision)" ]] || return 1
  [[ -z "$(docker_local container ls --all --quiet --filter "id=$COORDINATOR_CONTAINER_ID")" ]] || return 1
  require_owner_contract "$owner_id" || return 1
  [[ "$(docker_local container inspect "$owner_id" \
    --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == 'running|healthy' ]] || return 1
  actual="$(container_semantic_contract_digest "$owner_id")" || return 1
  [[ "$actual" == "$OWNER_SEMANTIC_SHA256" ]] || return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$profile_holders" && "$control_holders" == "$owner_id" ]] || return 1
  require_container_no_chromium "$owner_id" || return 1
  require_no_host_chromium || return 1
  require_financial_gates_disabled
}

claim_and_load_bundle() {
  local admin_gid admin_uid installer_sha
  admin_uid="$(id -u fetanagent-admin)" || return 1
  admin_gid="$(id -g fetanagent-admin)" || return 1
  installer_sha="$(sha256sum -- "$STAGED_INSTALLER" | awk '{print $1}')" || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$STAGED_BUNDLE" "$CLAIM_PARENT" "$CLAIM_INSTALLING" "$CLAIM_ROOT" \
    "$ATTESTATION_RELEASE" "$REPAIR_RELEASE" "$CANONICAL_H14" "$STAGING_PROJECT_REF" \
    "$EXPECTED_DROPLET_ID" "$AUTHORIZATION_SHA256" "$PROVIDED_MANIFEST_SHA256" \
    "$installer_sha" "$admin_uid" "$admin_gid" "$SCRIPT_BASENAME" \
    "$VALIDATOR_BASENAME" "$MANIFEST_BASENAME" "$PREVIOUS_ATTESTATION_RELEASE" \
    "$PREVIOUS_ATTESTATION_SCRIPT_SHA256" "$PREVIOUS_ATTESTATION_SCRIPT_SIZE" \
    "$PREVIOUS_DIFFERENTIAL_VALIDATOR_SHA256" "$PREVIOUS_DIFFERENTIAL_VALIDATOR_SIZE" \
    "$PREVIOUS_BUNDLE_MANIFEST_SHA256" "$PREVIOUS_BUNDLE_MANIFEST_SIZE" \
    "$PREVIOUS_CLAIM_PARENT_DEV_INO" "$PREVIOUS_CLAIM_ROOT_DEV_INO" \
    "$PREVIOUS_ATTESTATION_SCRIPT_DEV_INO" "$PREVIOUS_DIFFERENTIAL_VALIDATOR_DEV_INO" \
    "$PREVIOUS_BUNDLE_MANIFEST_DEV_INO" <<'PY'
import hashlib
import os
import re
import stat
import sys

(source, parent, installing, final, attestation, repair, canonical, project, droplet,
 auth, manifest_sha, installer_sha, admin_uid_text, admin_gid_text, script_name,
 validator_name, manifest_name, previous_attestation, previous_script_sha,
 previous_script_size_text, previous_validator_sha, previous_validator_size_text,
 previous_manifest_sha, previous_manifest_size_text, previous_parent_dev_ino,
 previous_root_dev_ino, previous_script_dev_ino, previous_validator_dev_ino,
 previous_manifest_dev_ino) = sys.argv[1:]
admin_uid = int(admin_uid_text)
admin_gid = int(admin_gid_text)
previous_script_size = int(previous_script_size_text)
previous_validator_size = int(previous_validator_size_text)
previous_manifest_size = int(previous_manifest_size_text)
sha = re.compile(r'[0-9a-f]{64}')
release = re.compile(r'[0-9a-f]{40}')
names = [script_name, validator_name, manifest_name]

def reject():
    raise RuntimeError()

def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def directory(path, owners, mode, entries=None):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid) not in owners
        or stat.S_IMODE(value.st_mode) != mode
        or os.path.realpath(path) != path
    ):
        reject()
    if entries is not None and sorted(os.listdir(path)) != sorted(entries):
        reject()
    return value

def read_file(path, owners, mode, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        data = os.pread(descriptor, maximum + 1, 0)
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid) not in owners
            or stat.S_IMODE(before.st_mode) != mode
            or before.st_nlink != 1
            or before.st_size > maximum
            or len(data) != before.st_size
            or os.path.realpath(path) != path
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                   after.st_nlink, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        ):
            reject()
        return data
    finally:
        os.close(descriptor)

def validate_payloads(values):
    manifest = values[manifest_name]
    if hashlib.sha256(manifest).hexdigest() != manifest_sha:
        reject()
    try:
        lines = manifest.decode('ascii').splitlines()
    except UnicodeDecodeError:
        reject()
    if manifest != ('\n'.join(lines) + '\n').encode('ascii') or len(lines) != 19:
        reject()
    expected_prefix = [
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation-bundle',
        f'attestation_implementation_sha={attestation}',
        f'repair_implementation_sha={repair}',
        f'canonical_h14_sha={canonical}',
        f'staging_project_ref={project}',
        f'staging_droplet_id={droplet}',
        f'authorization_sha256={auth}',
    ]
    if (
        lines[:8] != expected_prefix
        or not lines[8].startswith('terminal_attestation_bridge_sha256=')
        or not lines[9].startswith('terminal_attestation_bridge_size=')
        or not lines[10].startswith('terminal_differential_validator_sha256=')
        or not lines[11].startswith('terminal_differential_validator_size=')
    ):
        reject()
    pairs = []
    for line in lines:
        if line.count('=') != 1:
            reject()
        pairs.append(line.split('=', 1))
    if len({key for key, _ in pairs}) != len(pairs):
        reject()
    parsed = dict(pairs)
    if (
        not release.fullmatch(parsed['attestation_implementation_sha'])
        or not release.fullmatch(parsed['repair_implementation_sha'])
        or not release.fullmatch(parsed['canonical_h14_sha'])
        or not sha.fullmatch(parsed.get('terminal_attestation_bridge_sha256', ''))
        or not sha.fullmatch(parsed.get('terminal_differential_validator_sha256', ''))
        or re.fullmatch(r'[1-9][0-9]{0,7}', parsed.get('terminal_attestation_bridge_size', '')) is None
        or re.fullmatch(r'[1-9][0-9]{0,7}', parsed.get('terminal_differential_validator_size', '')) is None
        or int(parsed['terminal_attestation_bridge_size']) != len(values[script_name])
        or int(parsed['terminal_differential_validator_size']) != len(values[validator_name])
        or lines[12:] != [
            'provider_action_enabled=false',
            'financial_actions_mode=dry_run',
            'kemerbet_executor_enabled=false',
            'kemerbet_final_action_enabled=false',
            'transfer_enabled=false',
            'amount_entry_enabled=false',
            'money_moved=false',
        ]
        or hashlib.sha256(values[script_name]).hexdigest()
           != parsed['terminal_attestation_bridge_sha256']
        or hashlib.sha256(values[validator_name]).hexdigest()
           != parsed['terminal_differential_validator_sha256']
        or parsed['terminal_attestation_bridge_sha256'] != installer_sha
    ):
        reject()
    forbidden = re.compile(
        rb'(password|captcha|otp|player[_ -]?id|receiver[_ -]?(account|identifier)|'
        rb'cookie|session[_ -]?token)', re.I
    )
    if forbidden.search(manifest):
        reject()
    return (
        parsed['terminal_attestation_bridge_sha256'],
        parsed['terminal_attestation_bridge_size'],
        parsed['terminal_differential_validator_sha256'],
        parsed['terminal_differential_validator_size'],
        str(len(manifest)),
    )

def validate(root, owners, file_mode):
    directory(root, owners, 0o700, names)
    values = {
        name: read_file(f'{root}/{name}', owners, file_mode, 2 * 1024 * 1024)
        for name in names
    }
    return (*validate_payloads(values), values)

def immutable_identity(path):
    value = os.lstat(path)
    return (
        value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
        value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns,
    )

def dev_ino(path):
    value = os.lstat(path)
    return f'{value.st_dev}:{value.st_ino}'

def validate_previous_claim():
    previous_root = f'{parent}/{previous_attestation}'
    directory(previous_root, {(0, 0)}, 0o700, names)
    values = {
        name: read_file(f'{previous_root}/{name}', {(0, 0)}, 0o400, 2 * 1024 * 1024)
        for name in names
    }
    if (
        dev_ino(previous_root) != previous_root_dev_ino
        or dev_ino(f'{previous_root}/{script_name}') != previous_script_dev_ino
        or dev_ino(f'{previous_root}/{validator_name}') != previous_validator_dev_ino
        or dev_ino(f'{previous_root}/{manifest_name}') != previous_manifest_dev_ino
        or len(values[script_name]) != previous_script_size
        or hashlib.sha256(values[script_name]).hexdigest() != previous_script_sha
        or len(values[validator_name]) != previous_validator_size
        or hashlib.sha256(values[validator_name]).hexdigest() != previous_validator_sha
        or len(values[manifest_name]) != previous_manifest_size
        or hashlib.sha256(values[manifest_name]).hexdigest() != previous_manifest_sha
    ):
        reject()
    return (
        immutable_identity(previous_root),
        *(immutable_identity(f'{previous_root}/{name}') for name in names),
    )

def snapshot_source():
    descriptor = os.open(
        source,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        before = os.fstat(descriptor)
        named = os.lstat(source)
        if (
            not stat.S_ISDIR(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode))
               != (admin_uid, admin_gid, 0o700)
            or os.path.realpath(source) != source
            or sorted(os.listdir(source)) != sorted(names)
        ):
            reject()
        values = {}
        identities = {}
        for name in names:
            file_descriptor = os.open(
                name,
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=descriptor,
            )
            try:
                file_before = os.fstat(file_descriptor)
                file_named = os.stat(
                    name, dir_fd=descriptor, follow_symlinks=False,
                )
                data = os.pread(file_descriptor, 2 * 1024 * 1024 + 1, 0)
                file_after = os.fstat(file_descriptor)
                if (
                    not stat.S_ISREG(file_before.st_mode)
                    or (file_before.st_dev, file_before.st_ino)
                       != (file_named.st_dev, file_named.st_ino)
                    or (file_before.st_uid, file_before.st_gid,
                        stat.S_IMODE(file_before.st_mode), file_before.st_nlink)
                       != (admin_uid, admin_gid, 0o600, 1)
                    or file_before.st_size > 2 * 1024 * 1024
                    or len(data) != file_before.st_size
                    or (file_before.st_dev, file_before.st_ino, file_before.st_mode,
                        file_before.st_uid, file_before.st_gid, file_before.st_nlink,
                        file_before.st_size, file_before.st_mtime_ns)
                       != (file_after.st_dev, file_after.st_ino, file_after.st_mode,
                           file_after.st_uid, file_after.st_gid, file_after.st_nlink,
                           file_after.st_size, file_after.st_mtime_ns)
                ):
                    reject()
                values[name] = data
                identities[name] = (file_before.st_dev, file_before.st_ino)
            finally:
                os.close(file_descriptor)
        after = os.fstat(descriptor)
        named_after = os.lstat(source)
        if (
            (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
             before.st_gid, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                after.st_gid, after.st_mtime_ns)
            or (after.st_dev, after.st_ino) != (named_after.st_dev, named_after.st_ino)
        ):
            reject()
        return values, identities, (before.st_dev, before.st_ino)
    finally:
        os.close(descriptor)

def copy_claim_file(name, data):
    destination = f'{installing}/{name}'
    if os.path.lexists(destination):
        descriptor = os.open(
            destination, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
        )
        before = os.fstat(descriptor)
        named = os.lstat(destination)
        prefix = os.pread(descriptor, len(data) + 1, 0)
        after_read = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode),
                before.st_nlink) != (0, 0, 0o400, 1)
            or len(prefix) > len(data)
            or prefix != data[:len(prefix)]
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after_read.st_dev, after_read.st_ino, after_read.st_mode,
                   after_read.st_uid, after_read.st_gid, after_read.st_nlink,
                   after_read.st_size, after_read.st_mtime_ns)
        ):
            os.close(descriptor)
            reject()
    else:
        descriptor = os.open(
            destination,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o400,
        )
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, 0o400)
        prefix = b''
    try:
        os.lseek(descriptor, len(prefix), os.SEEK_SET)
        remainder = data[len(prefix):]
        offset = 0
        while offset < len(remainder):
            written = os.write(descriptor, remainder[offset:])
            if written <= 0:
                reject()
            offset += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def consume_source(expected_identities, expected_directory):
    descriptor = os.open(
        source,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        value = os.fstat(descriptor)
        named = os.lstat(source)
        if (
            (value.st_dev, value.st_ino) != expected_directory
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or sorted(os.listdir(source)) != sorted(names)
        ):
            reject()
        for name in names:
            current = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != expected_identities[name]:
                reject()
        for name in names:
            os.unlink(name, dir_fd=descriptor)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.rmdir(source)
    sync_directory('/tmp')

try:
    root_owner = {(0, 0)}
    if (
        not release.fullmatch(previous_attestation)
        or previous_attestation == attestation
        or not sha.fullmatch(previous_script_sha)
        or not sha.fullmatch(previous_validator_sha)
        or not sha.fullmatch(previous_manifest_sha)
        or any(re.fullmatch(r'[0-9]+:[0-9]+', value) is None for value in (
            previous_parent_dev_ino, previous_root_dev_ino, previous_script_dev_ino,
            previous_validator_dev_ino, previous_manifest_dev_ino,
        ))
        or previous_script_size <= 0
        or previous_validator_size <= 0
        or previous_manifest_size <= 0
    ):
        reject()
    if os.path.lexists(final):
        if os.path.lexists(installing):
            reject()
        directory(parent, root_owner, 0o700, [previous_attestation, attestation])
        if dev_ino(parent) != previous_parent_dev_ino:
            reject()
        previous_boundary = validate_previous_claim()
        script_sha, script_size, validator_sha, validator_size, manifest_size, _ = validate(
            final, root_owner, 0o400,
        )
        if validate_previous_claim() != previous_boundary:
            reject()
        # A completed root-owned claim is the only replay authority.  Do not
        # inspect an uploader-controlled leftover: it cannot change or block
        # authorization after the atomic claim has committed.
    else:
        directory(parent, root_owner, 0o700)
        if dev_ino(parent) != previous_parent_dev_ino:
            reject()
        children = os.listdir(parent)
        resuming = os.path.lexists(installing)
        if not resuming:
            if sorted(children) != [previous_attestation]:
                reject()
            previous_boundary = validate_previous_claim()
        else:
            if sorted(children) != sorted([previous_attestation, f'.installing-{attestation}']):
                reject()
            previous_boundary = validate_previous_claim()
        source_values, source_identities, source_directory = snapshot_source()
        validate_payloads(source_values)
        if not resuming:
            os.mkdir(installing, 0o700)
            os.chown(installing, 0, 0)
            os.chmod(installing, 0o700)
            sync_directory(parent)
        directory(
            parent, root_owner, 0o700,
            [previous_attestation, f'.installing-{attestation}'],
        )
        if validate_previous_claim() != previous_boundary:
            reject()
        directory(installing, root_owner, 0o700)
        if any(name not in names for name in os.listdir(installing)):
            reject()
        for name in names:
            copy_claim_file(name, source_values[name])
        sync_directory(installing)
        script_sha, script_size, validator_sha, validator_size, manifest_size, _ = validate(
            installing, root_owner, 0o400,
        )
        if validate_previous_claim() != previous_boundary:
            reject()
        os.rename(installing, final)
        sync_directory(parent)
        directory(parent, root_owner, 0o700, [previous_attestation, attestation])
        if validate_previous_claim() != previous_boundary:
            reject()
        validate(final, root_owner, 0o400)
        consume_source(source_identities, source_directory)
    print(script_sha)
    print(script_size)
    print(validator_sha)
    print(validator_size)
    print(manifest_size)
except Exception:
    raise SystemExit(1)
PY
}

load_exact_h14_and_repair() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$H14_PARENT" "$H14_ROOT" "$REPAIR_PARENT" "$REPAIR_INSTALLING" "$REPAIR_ROOT" \
    "$REPAIR_RELEASE" "$CANONICAL_H14" "$PREDECESSOR_RELEASE" "$H13_HELPER_SHA256" \
    "$H14_HELPER_SHA256" "$AUTHORIZATION_SHA256" <<'PY'
import hashlib
import os
import re
import stat
import sys

(h14_parent, h14_root, repair_parent, repair_installing, repair_final, repair,
 canonical, predecessor, h13_helper, h14_helper, auth) = sys.argv[1:]
sha = re.compile(r'[0-9a-f]{64}')
cid = re.compile(r'[0-9a-f]{64}')
crash_marker = b'fetanagent-kemerbet-session-active-v1\n'

def reject():
    raise RuntimeError()

def directory(path, mode, entries=None):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, mode)
        or os.path.realpath(path) != path
    ):
        reject()
    if entries is not None and sorted(os.listdir(path)) != sorted(entries):
        reject()
    return value

def exact_file(path, mode, maximum=2 * 1024 * 1024):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(path)
        data = os.pread(descriptor, maximum + 1, 0)
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
               != (0, 0, mode, 1)
            or before.st_size > maximum
            or len(data) != before.st_size
            or os.path.realpath(path) != path
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                   after.st_nlink, after.st_size, after.st_mtime_ns)
        ):
            reject()
        return data, before
    finally:
        os.close(descriptor)

def ascii_lines(path, mode, count):
    data, value = exact_file(path, mode)
    lines = data.decode('ascii').splitlines()
    if len(lines) != count or data != ('\n'.join(lines) + '\n').encode('ascii'):
        reject()
    return lines, data, value

def validate_profile_tree(path, expected_dev):
    root_value = os.lstat(path)
    if (
        not stat.S_ISDIR(root_value.st_mode)
        or (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode))
           != (10001, 10001, 0o700)
        or root_value.st_dev != expected_dev
        or os.path.realpath(path) != path
    ):
        reject()
    marker = f'{path}/.fetanagent-unclean-session-generation-v1'
    descriptor = os.open(marker, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        named = os.lstat(marker)
        data = os.pread(descriptor, len(crash_marker) + 1, 0)
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or before.st_dev != expected_dev
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode),
                before.st_nlink, before.st_size)
               != (10001, 10001, 0o600, 1, len(crash_marker))
            or data != crash_marker
            or os.path.realpath(marker) != marker
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                   after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
        ):
            reject()
    finally:
        os.close(descriptor)
    for current, directories, files in os.walk(path, topdown=True, followlinks=False):
        directories.sort()
        files.sort()
        for name in directories + files:
            candidate = os.path.join(current, name)
            value = os.lstat(candidate)
            if (
                value.st_dev != expected_dev
                or (value.st_uid, value.st_gid) != (10001, 10001)
            ):
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

try:
    directory(h14_parent, 0o700, [canonical])
    h14_value = directory(h14_root, 0o700, [
        'claim-stage-consumption-v1',
        'empty-predecessor-checkpoint-adoption-v1',
        'host-retired-v1',
        'intent-v1',
        'owner-runtime-restored-v1',
        'player-stage-consumption-v1',
        'predecessor-helper',
        'quarantined-profile-v1',
        'retired-binding-v3',
        'retired-retryable-failure-v1',
        'runtime-retired-v1',
        'runtime-retirement-intent-v1',
    ])
    directory(repair_parent, 0o700)
    children = os.listdir(repair_parent)
    if children == [f'.installing-{repair}']:
        repair_root = repair_installing
        entries = sorted(os.listdir(repair_root))
        if entries == ['intent-v1']:
            repair_state = 'intent-only'
        elif entries == ['.completed-v1.installing', 'intent-v1']:
            repair_state = 'completion-temp'
        elif entries == ['completed-v1', 'intent-v1']:
            repair_state = 'completed-in-installing'
        else:
            reject()
    elif children == [repair]:
        repair_state = 'final'
        repair_root = repair_final
        if sorted(os.listdir(repair_root)) != ['completed-v1', 'intent-v1']:
            reject()
    else:
        reject()
    directory(repair_root, 0o700)
    repair_intent, repair_intent_data, _ = ascii_lines(
        f'{repair_root}/intent-v1', 0o600, 42,
    )
    if (
        repair_intent[0:7] != [
            'version=1',
            'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair',
            'state=authorized',
            f'repair_implementation_release={repair}',
            f'canonical_h14_recovery_release={canonical}',
            f'authorization_sha256={auth}',
            f'h14_authorized_namespace=.installing-{canonical}',
        ]
        or not all(re.fullmatch(r'[^=]+=[0-9]+', repair_intent[index])
                   for index in (7, 8, 9, 10, 12, 13))
        or not all(sha.fullmatch(repair_intent[index].split('=', 1)[1])
                   for index in (11, 14, 16, 19, 21))
        or not cid.fullmatch(repair_intent[15].split('=', 1)[1])
        or repair_intent[17] != 'coordinator_absent=true'
        or not cid.fullmatch(repair_intent[18].split('=', 1)[1])
        or repair_intent[20] != 'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2'
        or repair_intent[22:] != [
            'mounts_order=full-canonical-json-sorted',
            'config_cmd_order=preserved',
            'config_env_order=preserved',
            'deployment_grant=disabled',
            f'installed_helper_sha256={h13_helper}',
            'owner_state=running',
            'owner_health=healthy',
            'profile_volume_holders=none',
            f'control_volume_holder={repair_intent[18].split("=", 1)[1]}',
            'financial_actions_mode=dry_run',
            'kemerbet_executor_enabled=false',
            'kemerbet_final_action_enabled=false',
            'transfer_enabled=false',
            'amount_entry_enabled=false',
            'internal_kemerbet_execution_runtime_enabled=false',
            'kemerbet_private_live_deposit_pilot_enabled=false',
            'money_moved=false',
            'legacy_contract_digest_compared=false',
            'canonical_h14_evidence_rewritten=false',
            'canonical_h14_release_superseded=false',
        ]
    ):
        reject()
    if (
        int(repair_intent[7].split('=', 1)[1]) != h14_value.st_dev
        or int(repair_intent[8].split('=', 1)[1]) != h14_value.st_ino
    ):
        reject()
    adoption_data, adoption_value = exact_file(
        f'{h14_root}/empty-predecessor-checkpoint-adoption-v1', 0o600,
    )
    runtime_data, runtime_value = exact_file(
        f'{h14_root}/runtime-retirement-intent-v1', 0o600,
    )
    if (
        int(repair_intent[9].split('=', 1)[1]) != adoption_value.st_dev
        or int(repair_intent[10].split('=', 1)[1]) != adoption_value.st_ino
        or repair_intent[11].split('=', 1)[1] != hashlib.sha256(adoption_data).hexdigest()
        or int(repair_intent[12].split('=', 1)[1]) != runtime_value.st_dev
        or int(repair_intent[13].split('=', 1)[1]) != runtime_value.st_ino
        or repair_intent[14].split('=', 1)[1] != hashlib.sha256(runtime_data).hexdigest()
    ):
        reject()
    owner_id = repair_intent[18].split('=', 1)[1]
    coordinator_id = repair_intent[15].split('=', 1)[1]
    semantic_sha = repair_intent[21].split('=', 1)[1]
    runtime_intent, _, _ = ascii_lines(
        f'{h14_root}/runtime-retirement-intent-v1', 0o600, 12,
    )
    restored, restored_data, _ = ascii_lines(
        f'{h14_root}/owner-runtime-restored-v1', 0o600, 11,
    )
    if (
        runtime_intent != [
            'version=1',
            f'recovery_release={canonical}',
            f'runtime_release={predecessor}',
            f'coordinator_container_id={coordinator_id}',
            f'coordinator_contract_sha256={repair_intent[16].split("=", 1)[1]}',
            f'owner_container_id={owner_id}',
            f'owner_contract_sha256={repair_intent[19].split("=", 1)[1]}',
            'financial_actions_mode=dry_run',
            'kemerbet_executor_enabled=false',
            'kemerbet_final_action_enabled=false',
            'transfer_enabled=false',
            'money_moved=false',
        ]
        or restored != [
            'version=1',
            f'recovery_release={canonical}',
            f'runtime_release={predecessor}',
            f'owner_container_id={owner_id}',
            runtime_intent[6],
            'owner_running=true',
            'owner_healthy=true',
            'coordinator_absent=true',
            'transfer_disabled=true',
            'amount_entry_enabled=false',
            'money_moved=false',
        ]
    ):
        reject()
    expected_completed = [
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair',
        'state=completed',
        f'repair_implementation_release={repair}',
        f'canonical_h14_recovery_release={canonical}',
        f'authorization_sha256={auth}',
        f'h14_final_namespace={canonical}',
        f'h14_namespace_device={h14_value.st_dev}',
        f'h14_namespace_inode={h14_value.st_ino}',
        f'owner_container_id={owner_id}',
        'owner_running=true',
        'owner_healthy=true',
        'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2',
        f'owner_semantic_contract_sha256={semantic_sha}',
        f'coordinator_container_id={coordinator_id}',
        'coordinator_absent=true',
        f'successor_helper_sha256={h14_helper}',
        'deployment_grant=active',
        'financial_actions_mode=dry_run',
        'kemerbet_executor_enabled=false',
        'kemerbet_final_action_enabled=false',
        'transfer_enabled=false',
        'amount_entry_enabled=false',
        'money_moved=false',
        f'repair_intent_sha256={hashlib.sha256(repair_intent_data).hexdigest()}',
        f'h14_owner_runtime_restored_sha256={hashlib.sha256(restored_data).hexdigest()}',
        'legacy_contract_digest_compared=false',
        'canonical_h14_evidence_rewritten=false',
        'canonical_h14_release_superseded=false',
    ]
    expected_completed_data = ('\n'.join(expected_completed) + '\n').encode('ascii')
    if repair_state in {'completed-in-installing', 'final'}:
        completed, completed_data, _ = ascii_lines(
            f'{repair_root}/completed-v1', 0o600, 29,
        )
        if completed != expected_completed:
            reject()
        if completed_data != expected_completed_data:
            reject()
    elif repair_state == 'completion-temp':
        partial, _ = exact_file(
            f'{repair_root}/.completed-v1.installing', 0o600,
        )
        if len(partial) > len(expected_completed_data) or not expected_completed_data.startswith(partial):
            reject()
    validate_profile_tree(f'{h14_root}/quarantined-profile-v1', h14_value.st_dev)
    tree = hashlib.sha256()
    total = 0
    for current, directories, files in os.walk(h14_root, topdown=True, followlinks=False):
        directories.sort()
        files.sort()
        for name in directories + files:
            path = os.path.join(current, name)
            value = os.lstat(path)
            relative = os.path.relpath(path, h14_root).replace(os.sep, '/')
            if stat.S_ISDIR(value.st_mode):
                kind, payload_sha, size = 'd', '-', 0
            elif stat.S_ISREG(value.st_mode):
                descriptor = os.open(
                    path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                )
                try:
                    before = os.fstat(descriptor)
                    named = os.lstat(path)
                    payload = bytearray()
                    while True:
                        block = os.read(descriptor, 1024 * 1024)
                        if not block:
                            break
                        payload.extend(block)
                        if len(payload) > 1024 * 1024 * 1024:
                            reject()
                    after = os.fstat(descriptor)
                    if (
                        not stat.S_ISREG(before.st_mode)
                        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
                        or before.st_nlink != 1
                        or len(payload) != before.st_size
                        or os.path.realpath(path) != path
                        or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                            before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
                           != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
                               after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
                    ):
                        reject()
                finally:
                    os.close(descriptor)
                total += len(payload)
                if total > 1024 * 1024 * 1024:
                    reject()
                kind, payload_sha, size = 'f', hashlib.sha256(bytes(payload)).hexdigest(), before.st_size
            else:
                reject()
            tree.update(
                f'{relative}\0{kind}\0{value.st_dev}:{value.st_ino}\0'
                f'{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode)}:{value.st_nlink}:{size}\0'
                f'{payload_sha}\n'.encode('utf-8')
            )
    print(repair_state)
    print(owner_id)
    print(coordinator_id)
    print(semantic_sha)
    print(h14_value.st_dev)
    print(h14_value.st_ino)
    print(tree.hexdigest())
    print(hashlib.sha256(repair_intent_data).hexdigest())
    print(hashlib.sha256(restored_data).hexdigest())
except Exception:
    raise SystemExit(1)
PY
}

require_forward_artifacts_absent() {
  local control_root="$1"
  [[ ! -e "$SEAL_BINDING" && ! -L "$SEAL_BINDING" &&
    ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" &&
    ! -e "$RECHECK_RECEIPT" && ! -L "$RECHECK_RECEIPT" &&
    ! -e "$control_root/$PLAYER_STAGE_NAME" && ! -L "$control_root/$PLAYER_STAGE_NAME" &&
    ! -e "$control_root/$CLAIM_STAGE_NAME" && ! -L "$control_root/$CLAIM_STAGE_NAME" &&
    ! -e "$control_root/$PROFILE_ACK_NAME" && ! -L "$control_root/$PROFILE_ACK_NAME" &&
    ! -e "$control_root/.$PROFILE_ACK_NAME.installing" && ! -L "$control_root/.$PROFILE_ACK_NAME.installing" &&
    ! -e "$OWNER_RECEIPT_ROOT/$FAILED_MARKER_NAME" && ! -L "$OWNER_RECEIPT_ROOT/$FAILED_MARKER_NAME" &&
    ! -e "$OWNER_RECEIPT_ROOT/kemerbet-readiness-cohort-completed-v1" && ! -L "$OWNER_RECEIPT_ROOT/kemerbet-readiness-cohort-completed-v1" &&
    ! -e "$OWNER_RECEIPT_ROOT/.kemerbet-readiness-cohort-completed-v1.installing" && ! -L "$OWNER_RECEIPT_ROOT/.kemerbet-readiness-cohort-completed-v1.installing" &&
    ! -e "$OWNER_RECEIPT_ROOT/kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1" && ! -L "$OWNER_RECEIPT_ROOT/kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1" &&
    ! -e "$OWNER_RECEIPT_ROOT/.kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1.installing" && ! -L "$OWNER_RECEIPT_ROOT/.kemerbet-readiness-cohort-recheck-authorization-spent-failed-terminal-v1.installing" &&
    ! -e "$OWNER_RECEIPT_ROOT/$PROFILE_FINALIZED_NAME" && ! -L "$OWNER_RECEIPT_ROOT/$PROFILE_FINALIZED_NAME" &&
    ! -e "$OWNER_RECEIPT_ROOT/.$PROFILE_FINALIZED_NAME.installing" && ! -L "$OWNER_RECEIPT_ROOT/.$PROFILE_FINALIZED_NAME.installing" &&
    ! -e "$OWNER_RECEIPT_ROOT/.$TERMINAL_MARKER_NAME.installing" && ! -L "$OWNER_RECEIPT_ROOT/.$TERMINAL_MARKER_NAME.installing" &&
    ! -e "$H14_ROOT/terminal-recovery-marker-v1" && ! -L "$H14_ROOT/terminal-recovery-marker-v1" &&
    ! -e "$H14_ROOT/.terminal-recovery-marker-v1.installing" && ! -L "$H14_ROOT/.terminal-recovery-marker-v1.installing" ]] || return 1
  [[ ! -L "$OWNER_RECEIPT_ROOT" && -d "$OWNER_RECEIPT_ROOT" &&
    "$(realpath -- "$OWNER_RECEIPT_ROOT")" == "$OWNER_RECEIPT_ROOT" &&
    "$(stat --format='%U:%G:%a' "$OWNER_RECEIPT_ROOT")" == 'root:root:755' &&
    "$(find -P "$OWNER_RECEIPT_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n')" == "$TERMINAL_MARKER_NAME" &&
    ! -L "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME" &&
    -f "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME" &&
    "$(stat --format='%u:%g:%a:%h:%s' "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME")" == '0:10001:440:1:37' ]]
}

run_differential_validator() {
  local control_root="$1" output profile_root="$2"
  output="$(env -i PATH="$SAFE_PATH" python3 -I "$CLAIM_ROOT/$VALIDATOR_BASENAME" \
    "$H14_PARENT" "$TARGET" "$profile_root" "$control_root" "$SEAL_BINDING" \
    "$FINAL_BINDING" "$RECHECK_RECEIPT" "$OWNER_RECEIPT_ROOT" "$AUTHORIZATION_SHA256" \
    "$PROFILE_ACK_NAME" "$TERMINAL_MARKER_NAME" "$PROFILE_FINALIZED_NAME")" || return 1
  [[ "$output" == 'PASS H14-D000' ]]
}

capture_immutable_boundary() {
  local repair_path
  case "$CURRENT_REPAIR_STATE" in
    intent-only|completion-temp|completed-in-installing) repair_path="$REPAIR_INSTALLING" ;;
    final) repair_path="$REPAIR_ROOT" ;;
    *) return 1 ;;
  esac
  local claim_dev_ino bridge_dev_ino manifest_dev_ino validator_dev_ino
  local profile_dev_ino control_dev_ino receipt_root_dev_ino repair_dev_ino marker_dev_ino marker_sha
  claim_dev_ino="$(stat --format='%d:%i' "$CLAIM_ROOT")" || return 1
  bridge_dev_ino="$(stat --format='%d:%i' "$CLAIM_ROOT/$SCRIPT_BASENAME")" || return 1
  validator_dev_ino="$(stat --format='%d:%i' "$CLAIM_ROOT/$VALIDATOR_BASENAME")" || return 1
  manifest_dev_ino="$(stat --format='%d:%i' "$CLAIM_ROOT/$MANIFEST_BASENAME")" || return 1
  profile_dev_ino="$(stat --format='%d:%i' "$PROFILE_ROOT")" || return 1
  control_dev_ino="$(stat --format='%d:%i' "$CONTROL_ROOT")" || return 1
  receipt_root_dev_ino="$(stat --format='%d:%i' "$OWNER_RECEIPT_ROOT")" || return 1
  repair_dev_ino="$(stat --format='%d:%i' "$repair_path")" || return 1
  marker_dev_ino="$(stat --format='%d:%i' "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME")" || return 1
  marker_sha="$(sha256sum -- "$OWNER_RECEIPT_ROOT/$TERMINAL_MARKER_NAME" | awk '{print $1}')" || return 1
  [[ "$claim_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$bridge_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$validator_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$manifest_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$profile_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$control_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$receipt_root_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$repair_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$marker_dev_ino" =~ ^[0-9]+:[0-9]+$ &&
    "$marker_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -z "${BUNDLE_CLAIM_DEV_INO:-}" ]]; then
    BUNDLE_CLAIM_DEV_INO="$claim_dev_ino"
    BUNDLE_BRIDGE_DEV_INO="$bridge_dev_ino"
    BUNDLE_VALIDATOR_DEV_INO="$validator_dev_ino"
    BUNDLE_MANIFEST_DEV_INO="$manifest_dev_ino"
    PROFILE_ROOT_DEV_INO="$profile_dev_ino"
    CONTROL_ROOT_DEV_INO="$control_dev_ino"
    OWNER_RECEIPT_ROOT_DEV_INO="$receipt_root_dev_ino"
    REPAIR_LEDGER_DEV_INO="$repair_dev_ino"
    TERMINAL_MARKER_DEV_INO="$marker_dev_ino"
    TERMINAL_MARKER_SHA256="$marker_sha"
  else
    [[ "$claim_dev_ino" == "$BUNDLE_CLAIM_DEV_INO" &&
      "$bridge_dev_ino" == "$BUNDLE_BRIDGE_DEV_INO" &&
      "$validator_dev_ino" == "$BUNDLE_VALIDATOR_DEV_INO" &&
      "$manifest_dev_ino" == "$BUNDLE_MANIFEST_DEV_INO" &&
      "$profile_dev_ino" == "$PROFILE_ROOT_DEV_INO" &&
      "$control_dev_ino" == "$CONTROL_ROOT_DEV_INO" &&
      "$receipt_root_dev_ino" == "$OWNER_RECEIPT_ROOT_DEV_INO" &&
      "$repair_dev_ino" == "$REPAIR_LEDGER_DEV_INO" &&
      "$marker_dev_ino" == "$TERMINAL_MARKER_DEV_INO" &&
      "$marker_sha" == "$TERMINAL_MARKER_SHA256" ]] || return 1
  fi
}

capture_sudoers_boundary() {
  local expected_state="$1" path current_dev_ino current_sha
  case "$expected_state" in
    disabled)
      require_disabled_grant_only || return 1
      path="$SUDOERS_DISABLED"
      ;;
    active)
      require_active_grant_only || return 1
      path="$SUDOERS"
      ;;
    *) return 1 ;;
  esac
  current_dev_ino="$(stat --format='%d:%i' "$path")" || return 1
  current_sha="$(sha256sum -- "$path" | awk '{print $1}')" || return 1
  [[ "$current_dev_ino" =~ ^[0-9]+:[0-9]+$ && "$current_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -z "${SUDOERS_DEV_INO:-}" ]]; then
    [[ "$expected_state" == 'disabled' ]] || return 1
    SUDOERS_DEV_INO="$current_dev_ino"
    SUDOERS_SHA256="$current_sha"
  else
    [[ "$current_dev_ino" == "$SUDOERS_DEV_INO" &&
      "$current_sha" == "$SUDOERS_SHA256" ]]
  fi
}

current_grant_state() {
  if require_disabled_grant_only; then
    printf '%s\n' 'disabled'
  elif require_active_grant_only; then
    printf '%s\n' 'active'
  else
    return 1
  fi
}

load_sudoers_binding_from_attestation_intent() {
  local -a binding
  [[ -z "${SUDOERS_DEV_INO:-}" && -z "${SUDOERS_SHA256:-}" ]] || return 1
  mapfile -t binding < <(env -i PATH="$SAFE_PATH" python3 -I - \
    "$ATTESTATION_WORK_ROOT/intent-v1" <<'PY'
import os
import re
import stat
import sys

path = sys.argv[1]
descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    before = os.fstat(descriptor)
    named = os.lstat(path)
    data = os.pread(descriptor, 131073, 0)
    after = os.fstat(descriptor)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
           != (0, 0, 0o600, 1)
        or before.st_size > 131072
        or len(data) != before.st_size
        or os.path.realpath(path) != path
        or (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
            before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
           != (after.st_dev, after.st_ino, after.st_mode, after.st_uid,
               after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
    ):
        raise RuntimeError()
    lines = data.decode('ascii').splitlines()
    if data != ('\n'.join(lines) + '\n').encode('ascii'):
        raise RuntimeError()
    pairs = []
    for line in lines:
        if line.count('=') != 1:
            raise RuntimeError()
        pairs.append(line.split('=', 1))
    if len({key for key, _ in pairs}) != len(pairs):
        raise RuntimeError()
    values = dict(pairs)
    dev_ino = values.get('deployment_grant_dev_ino', '')
    digest = values.get('deployment_grant_sha256', '')
    if (
        values.get('version') != '1'
        or values.get('contract')
           != 'fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation'
        or values.get('state') != 'authorized'
        or values.get('deployment_grant') != 'disabled'
        or re.fullmatch(r'[0-9]+:[0-9]+', dev_ino) is None
        or re.fullmatch(r'[0-9a-f]{64}', digest) is None
    ):
        raise RuntimeError()
    print(dev_ino)
    print(digest)
finally:
    os.close(descriptor)
PY
  ) || return 1
  [[ "${#binding[@]}" -eq 2 && "${binding[0]}" =~ ^[0-9]+:[0-9]+$ &&
    "${binding[1]}" =~ ^[0-9a-f]{64}$ ]] || return 1
  SUDOERS_DEV_INO="${binding[0]}"
  SUDOERS_SHA256="${binding[1]}"
}

require_phase_matrix() {
  local grant_state="$1"
  case "$ATTESTATION_PHASE" in
    absent|empty|intent-temp|intent-only|grant-temp)
      [[ "$CURRENT_REPAIR_STATE" == 'intent-only' && "$grant_state" == 'disabled' ]]
      ;;
    grant-intent)
      case "$grant_state:$CURRENT_REPAIR_STATE" in
        disabled:intent-only|active:intent-only|active:completion-temp|\
        active:completed-in-installing|active:final) ;;
        *) return 1 ;;
      esac
      ;;
    completion-temp|completed-in-installing|final)
      [[ "$CURRENT_REPAIR_STATE" == 'final' && "$grant_state" == 'active' ]]
      ;;
    *) return 1 ;;
  esac
}

publish_exact_record() {
  local path="$1" mode="$2" root
  root="$(dirname "$path")" || return 1
  env -i PATH="$SAFE_PATH" python3 -I - "$path" "$mode" <<'PY'
import os
import stat
import sys

path, mode_text = sys.argv[1:]
mode = int(mode_text, 8)
expected = sys.stdin.buffer.read()
root = os.path.dirname(path)
name = os.path.basename(path)
temporary = f'{root}/.{name}.installing'
if not expected or b'\0' in expected or not expected.endswith(b'\n'):
    raise SystemExit(1)

def sync_directory(directory):
    descriptor = os.open(
        directory,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def exact_file(candidate, accepted_prefix):
    descriptor = os.open(
        candidate,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        before = os.fstat(descriptor)
        named = os.lstat(candidate)
        data = os.pread(descriptor, len(expected) + 1, 0)
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink)
               != (0, 0, mode, 1)
            or before.st_size > len(expected)
            or len(data) != before.st_size
            or (expected.startswith(data) if accepted_prefix else data == expected) is not True
            or os.path.realpath(candidate) != candidate
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
                   after.st_nlink, after.st_size, after.st_mtime_ns)
        ):
            raise SystemExit(1)
        return data
    finally:
        os.close(descriptor)

if os.path.lexists(path):
    if os.path.lexists(temporary):
        raise SystemExit(1)
    exact_file(path, False)
    raise SystemExit(0)
if os.path.lexists(temporary):
    prefix = exact_file(temporary, True)
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
else:
    prefix = b''
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        mode,
    )
    os.fchown(descriptor, 0, 0)
    os.fchmod(descriptor, mode)
try:
    os.lseek(descriptor, len(prefix), os.SEEK_SET)
    remainder = expected[len(prefix):]
    offset = 0
    while offset < len(remainder):
        written = os.write(descriptor, remainder[offset:])
        if written <= 0:
            raise SystemExit(1)
        offset += written
    os.fsync(descriptor)
finally:
    os.close(descriptor)
exact_file(temporary, False)
os.rename(temporary, path)
sync_directory(root)
exact_file(path, False)
PY
}

discover_attestation_ledger() {
  local children entries
  ATTESTATION_STATE='absent'
  ATTESTATION_PHASE='absent'
  ATTESTATION_WORK_ROOT=''
  if [[ ! -e "$ATTESTATION_PARENT" && ! -L "$ATTESTATION_PARENT" ]]; then
    return 0
  fi
  [[ ! -L "$ATTESTATION_PARENT" && -d "$ATTESTATION_PARENT" &&
    "$(realpath -- "$ATTESTATION_PARENT")" == "$ATTESTATION_PARENT" &&
    "$(stat --format='%U:%G:%a' "$ATTESTATION_PARENT")" == 'root:root:700' ]] || return 1
  children="$(find -P "$ATTESTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  case "$children" in
    '') return 0 ;;
    ".installing-$ATTESTATION_RELEASE")
      ATTESTATION_STATE='installing'
      ATTESTATION_WORK_ROOT="$ATTESTATION_INSTALLING"
      ;;
    "$ATTESTATION_RELEASE")
      ATTESTATION_STATE='complete'
      ATTESTATION_WORK_ROOT="$ATTESTATION_ROOT"
      ;;
    *) return 1 ;;
  esac
  [[ ! -L "$ATTESTATION_WORK_ROOT" && -d "$ATTESTATION_WORK_ROOT" &&
    "$(realpath -- "$ATTESTATION_WORK_ROOT")" == "$ATTESTATION_WORK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$ATTESTATION_WORK_ROOT")" == 'root:root:700' ]] || return 1
  entries="$(find -P "$ATTESTATION_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' |
    LC_ALL=C sort)" || return 1
  if [[ "$ATTESTATION_STATE" == 'installing' ]]; then
    case "$entries" in
      '') ATTESTATION_PHASE='empty' ;;
      '.intent-v1.installing') ATTESTATION_PHASE='intent-temp' ;;
      'intent-v1') ATTESTATION_PHASE='intent-only' ;;
      $'.grant-restoration-intent-v1.installing\nintent-v1') ATTESTATION_PHASE='grant-temp' ;;
      $'grant-restoration-intent-v1\nintent-v1') ATTESTATION_PHASE='grant-intent' ;;
      $'.completed-v1.installing\ngrant-restoration-intent-v1\nintent-v1') ATTESTATION_PHASE='completion-temp' ;;
      $'completed-v1\ngrant-restoration-intent-v1\nintent-v1') ATTESTATION_PHASE='completed-in-installing' ;;
      *) return 1 ;;
    esac
  else
    [[ "$entries" == $'completed-v1\ngrant-restoration-intent-v1\nintent-v1' ]] || return 1
    ATTESTATION_PHASE='final'
  fi
}

create_attestation_ledger() {
  if [[ ! -e "$ATTESTATION_PARENT" && ! -L "$ATTESTATION_PARENT" ]]; then
    mkdir --mode=0700 -- "$ATTESTATION_PARENT" || return 1
    chown root:root "$ATTESTATION_PARENT" || return 1
    chmod 0700 "$ATTESTATION_PARENT" || return 1
    sync -f "$(dirname "$ATTESTATION_PARENT")" || return 1
  fi
  discover_attestation_ledger || return 1
  if [[ "$ATTESTATION_STATE" == 'absent' ]]; then
    [[ -z "$(find -P "$ATTESTATION_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" ]] || return 1
    mkdir --mode=0700 -- "$ATTESTATION_INSTALLING" || return 1
    chown root:root "$ATTESTATION_INSTALLING" || return 1
    chmod 0700 "$ATTESTATION_INSTALLING" || return 1
    sync -f "$ATTESTATION_PARENT" || return 1
    discover_attestation_ledger || return 1
  fi
  [[ "$ATTESTATION_STATE" == 'installing' && "$ATTESTATION_PHASE" == 'empty' ]]
}

expected_attestation_intent() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation' \
    'state=authorized' \
    "attestation_implementation_release=$ATTESTATION_RELEASE" \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_recovery_release=$CANONICAL_H14" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "bundle_manifest_sha256=$PROVIDED_MANIFEST_SHA256" \
    "bundle_manifest_size=$BUNDLE_MANIFEST_SIZE" \
    "attestation_bridge_sha256=$ATTESTATION_SCRIPT_SHA256" \
    "attestation_bridge_size=$ATTESTATION_SCRIPT_SIZE" \
    "differential_validator_sha256=$DIFFERENTIAL_VALIDATOR_SHA256" \
    "differential_validator_size=$DIFFERENTIAL_VALIDATOR_SIZE" \
    "bundle_claim_dev_ino=$BUNDLE_CLAIM_DEV_INO" \
    "bundle_bridge_dev_ino=$BUNDLE_BRIDGE_DEV_INO" \
    "bundle_validator_dev_ino=$BUNDLE_VALIDATOR_DEV_INO" \
    "bundle_manifest_dev_ino=$BUNDLE_MANIFEST_DEV_INO" \
    "h14_namespace_device=$H14_NAMESPACE_DEVICE" \
    "h14_namespace_inode=$H14_NAMESPACE_INODE" \
    "h14_evidence_tree_sha256=$H14_EVIDENCE_TREE_SHA256" \
    "repair_intent_sha256=$REPAIR_INTENT_SHA256" \
    "repair_ledger_dev_ino=$REPAIR_LEDGER_DEV_INO" \
    "h14_owner_runtime_restored_sha256=$H14_OWNER_RESTORED_SHA256" \
    "installed_helper_sha256=$H14_HELPER_SHA256" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    'owner_running=true' \
    'owner_healthy=true' \
    'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2' \
    "owner_semantic_contract_sha256=$OWNER_SEMANTIC_SHA256" \
    "coordinator_container_id=$COORDINATOR_CONTAINER_ID" \
    'coordinator_absent=true' \
    'profile_volume_holders=none' \
    "control_volume_holder=$OWNER_CONTAINER_ID" \
    "profile_volume_root_dev_ino=$PROFILE_ROOT_DEV_INO" \
    "control_volume_root_dev_ino=$CONTROL_ROOT_DEV_INO" \
    "owner_receipt_root_dev_ino=$OWNER_RECEIPT_ROOT_DEV_INO" \
    "terminal_marker_dev_ino=$TERMINAL_MARKER_DEV_INO" \
    "terminal_marker_sha256=$TERMINAL_MARKER_SHA256" \
    'terminal_marker_present=true' \
    'final_binding_absent=true' \
    'seal_binding_absent=true' \
    'fresh_stage_pair_absent=true' \
    'profile_finalized_absent=true' \
    'recheck_receipt_absent=true' \
    'deployment_grant=disabled' \
    "deployment_grant_dev_ino=$SUDOERS_DEV_INO" \
    "deployment_grant_sha256=$SUDOERS_SHA256" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'provider_action_enabled=false' \
    'money_moved=false' \
    'canonical_h14_evidence_rewritten=false' \
    'canonical_h14_helper_changed=false'
}

expected_grant_restoration_intent() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation' \
    'state=grant-restoration-authorized' \
    "attestation_implementation_release=$ATTESTATION_RELEASE" \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_recovery_release=$CANONICAL_H14" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "attestation_intent_sha256=$ATTESTATION_INTENT_SHA256" \
    "h14_evidence_tree_sha256=$H14_EVIDENCE_TREE_SHA256" \
    "repair_intent_sha256=$REPAIR_INTENT_SHA256" \
    "expected_repair_completion_sha256=$EXPECTED_REPAIR_COMPLETION_SHA256" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    "owner_semantic_contract_sha256=$OWNER_SEMANTIC_SHA256" \
    'deployment_grant_before_publication=disabled' \
    "deployment_grant_dev_ino=$SUDOERS_DEV_INO" \
    "deployment_grant_sha256=$SUDOERS_SHA256" \
    'restore_exact_disabled_grant_only=true' \
    'financial_actions_mode=dry_run' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'provider_action_enabled=false' \
    'money_moved=false'
}

expected_repair_completed() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair' \
    'state=completed' \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_recovery_release=$CANONICAL_H14" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "h14_final_namespace=$CANONICAL_H14" \
    "h14_namespace_device=$H14_NAMESPACE_DEVICE" \
    "h14_namespace_inode=$H14_NAMESPACE_INODE" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    'owner_running=true' \
    'owner_healthy=true' \
    'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2' \
    "owner_semantic_contract_sha256=$OWNER_SEMANTIC_SHA256" \
    "coordinator_container_id=$COORDINATOR_CONTAINER_ID" \
    'coordinator_absent=true' \
    "successor_helper_sha256=$H14_HELPER_SHA256" \
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

expected_attestation_completed() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-terminal-attestation' \
    'state=completed' \
    "attestation_implementation_release=$ATTESTATION_RELEASE" \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_recovery_release=$CANONICAL_H14" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "bundle_manifest_sha256=$PROVIDED_MANIFEST_SHA256" \
    "bundle_manifest_size=$BUNDLE_MANIFEST_SIZE" \
    "attestation_intent_sha256=$ATTESTATION_INTENT_SHA256" \
    "grant_restoration_intent_sha256=$GRANT_INTENT_SHA256" \
    "repair_intent_sha256=$REPAIR_INTENT_SHA256" \
    "repair_completion_sha256=$REPAIR_COMPLETION_SHA256" \
    "expected_repair_completion_sha256=$EXPECTED_REPAIR_COMPLETION_SHA256" \
    "h14_namespace_device=$H14_NAMESPACE_DEVICE" \
    "h14_namespace_inode=$H14_NAMESPACE_INODE" \
    "h14_evidence_tree_sha256=$H14_EVIDENCE_TREE_SHA256" \
    "installed_helper_sha256=$H14_HELPER_SHA256" \
    "owner_container_id=$OWNER_CONTAINER_ID" \
    'owner_running=true' \
    'owner_healthy=true' \
    "owner_semantic_contract_sha256=$OWNER_SEMANTIC_SHA256" \
    "coordinator_container_id=$COORDINATOR_CONTAINER_ID" \
    'coordinator_absent=true' \
    'profile_volume_holders=none' \
    "control_volume_holder=$OWNER_CONTAINER_ID" \
    'deployment_grant=active' \
    "deployment_grant_dev_ino=$SUDOERS_DEV_INO" \
    "deployment_grant_sha256=$SUDOERS_SHA256" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'provider_action_enabled=false' \
    'money_moved=false' \
    'canonical_h14_evidence_rewritten=false' \
    'canonical_h14_helper_changed=false' \
    'canonical_h14_release_superseded=false'
}

require_record() {
  local expected_function="$1" path="$2"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$path" <("$expected_function")
}

prepare_attestation_hashes() {
  ATTESTATION_INTENT_SHA256="$(sha256sum -- "$ATTESTATION_WORK_ROOT/intent-v1" | awk '{print $1}')" || return 1
  [[ "$ATTESTATION_INTENT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -e "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" &&
    ! -L "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" ]]; then
    GRANT_INTENT_SHA256="$(sha256sum -- "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" | awk '{print $1}')" || return 1
    [[ "$GRANT_INTENT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  fi
  if [[ -e "$REPAIR_ROOT/completed-v1" && ! -L "$REPAIR_ROOT/completed-v1" ]]; then
    REPAIR_COMPLETION_SHA256="$(sha256sum -- "$REPAIR_ROOT/completed-v1" | awk '{print $1}')" || return 1
    [[ "$REPAIR_COMPLETION_SHA256" =~ ^[0-9a-f]{64}$ &&
      "$REPAIR_COMPLETION_SHA256" == "$EXPECTED_REPAIR_COMPLETION_SHA256" ]] || return 1
  fi
}

require_repair_completed() {
  [[ ! -L "$REPAIR_ROOT" && -d "$REPAIR_ROOT" &&
    "$(realpath -- "$REPAIR_ROOT")" == "$REPAIR_ROOT" &&
    "$(stat --format='%U:%G:%a' "$REPAIR_ROOT")" == 'root:root:700' &&
    "$(find -P "$REPAIR_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" == $'completed-v1\nintent-v1' ]] || return 1
  require_record expected_repair_completed "$REPAIR_ROOT/completed-v1"
}

finalize_repair_ledger() {
  if [[ -e "$REPAIR_ROOT" || -L "$REPAIR_ROOT" ]]; then
    require_repair_completed
    return
  fi
  [[ ! -L "$REPAIR_INSTALLING" && -d "$REPAIR_INSTALLING" &&
    "$(realpath -- "$REPAIR_INSTALLING")" == "$REPAIR_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$REPAIR_INSTALLING")" == 'root:root:700' ]] || return 1
  publish_exact_record "$REPAIR_INSTALLING/completed-v1" 0600 < <(expected_repair_completed) || return 1
  require_record expected_repair_completed "$REPAIR_INSTALLING/completed-v1" || return 1
  [[ "$(find -P "$REPAIR_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f\n' |
    LC_ALL=C sort)" == $'completed-v1\nintent-v1' ]] || return 1
  mv -- "$REPAIR_INSTALLING" "$REPAIR_ROOT" || return 1
  sync -f "$REPAIR_PARENT" || return 1
  require_repair_completed
}

finalize_attestation_ledger() {
  publish_exact_record "$ATTESTATION_WORK_ROOT/completed-v1" 0600 < <(expected_attestation_completed) || return 1
  require_record expected_attestation_completed "$ATTESTATION_WORK_ROOT/completed-v1" || return 1
  [[ "$ATTESTATION_STATE" == 'installing' &&
    "$(find -P "$ATTESTATION_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' |
      LC_ALL=C sort)" == $'completed-v1\ngrant-restoration-intent-v1\nintent-v1' &&
    ! -e "$ATTESTATION_ROOT" && ! -L "$ATTESTATION_ROOT" ]] || return 1
  mv -- "$ATTESTATION_INSTALLING" "$ATTESTATION_ROOT" || return 1
  sync -f "$ATTESTATION_PARENT" || return 1
  ATTESTATION_STATE='complete'
  ATTESTATION_PHASE='final'
  ATTESTATION_WORK_ROOT="$ATTESTATION_ROOT"
  require_record expected_attestation_completed "$ATTESTATION_WORK_ROOT/completed-v1"
}

refresh_terminal_state() {
  local -a values
  mapfile -t values < <(load_exact_h14_and_repair) || return 1
  [[ "${#values[@]}" -eq 9 ]] || return 1
  CURRENT_REPAIR_STATE="${values[0]}"
  CURRENT_OWNER_CONTAINER_ID="${values[1]}"
  CURRENT_COORDINATOR_CONTAINER_ID="${values[2]}"
  CURRENT_OWNER_SEMANTIC_SHA256="${values[3]}"
  CURRENT_H14_NAMESPACE_DEVICE="${values[4]}"
  CURRENT_H14_NAMESPACE_INODE="${values[5]}"
  CURRENT_H14_EVIDENCE_TREE_SHA256="${values[6]}"
  CURRENT_REPAIR_INTENT_SHA256="${values[7]}"
  CURRENT_H14_OWNER_RESTORED_SHA256="${values[8]}"
  case "$CURRENT_REPAIR_STATE" in
    intent-only|completion-temp|completed-in-installing|final) ;;
    *) return 1 ;;
  esac
  [[ "$CURRENT_OWNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ &&
    "$CURRENT_COORDINATOR_CONTAINER_ID" =~ ^[0-9a-f]{64}$ &&
    "$CURRENT_OWNER_SEMANTIC_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$CURRENT_H14_NAMESPACE_DEVICE" =~ ^[0-9]+$ &&
    "$CURRENT_H14_NAMESPACE_INODE" =~ ^[0-9]+$ &&
    "$CURRENT_H14_EVIDENCE_TREE_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$CURRENT_REPAIR_INTENT_SHA256" =~ ^[0-9a-f]{64}$ &&
    "$CURRENT_H14_OWNER_RESTORED_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -z "${OWNER_CONTAINER_ID:-}" ]]; then
    OWNER_CONTAINER_ID="$CURRENT_OWNER_CONTAINER_ID"
    COORDINATOR_CONTAINER_ID="$CURRENT_COORDINATOR_CONTAINER_ID"
    OWNER_SEMANTIC_SHA256="$CURRENT_OWNER_SEMANTIC_SHA256"
    H14_NAMESPACE_DEVICE="$CURRENT_H14_NAMESPACE_DEVICE"
    H14_NAMESPACE_INODE="$CURRENT_H14_NAMESPACE_INODE"
    H14_EVIDENCE_TREE_SHA256="$CURRENT_H14_EVIDENCE_TREE_SHA256"
    REPAIR_INTENT_SHA256="$CURRENT_REPAIR_INTENT_SHA256"
    H14_OWNER_RESTORED_SHA256="$CURRENT_H14_OWNER_RESTORED_SHA256"
  else
    [[ "$CURRENT_OWNER_CONTAINER_ID" == "$OWNER_CONTAINER_ID" &&
      "$CURRENT_COORDINATOR_CONTAINER_ID" == "$COORDINATOR_CONTAINER_ID" &&
      "$CURRENT_OWNER_SEMANTIC_SHA256" == "$OWNER_SEMANTIC_SHA256" &&
      "$CURRENT_H14_NAMESPACE_DEVICE" == "$H14_NAMESPACE_DEVICE" &&
      "$CURRENT_H14_NAMESPACE_INODE" == "$H14_NAMESPACE_INODE" &&
      "$CURRENT_H14_EVIDENCE_TREE_SHA256" == "$H14_EVIDENCE_TREE_SHA256" &&
      "$CURRENT_REPAIR_INTENT_SHA256" == "$REPAIR_INTENT_SHA256" &&
      "$CURRENT_H14_OWNER_RESTORED_SHA256" == "$H14_OWNER_RESTORED_SHA256" ]] || return 1
  fi
  require_volume_root "$PROFILE_ROOT" || return 1
  require_volume_root "$CONTROL_ROOT" || return 1
  require_forward_artifacts_absent "$CONTROL_ROOT" || return 1
  capture_immutable_boundary || return 1
  run_differential_validator "$CONTROL_ROOT" "$PROFILE_ROOT" || return 1
  require_runtime_boundary "$OWNER_CONTAINER_ID"
}

acquire_staging_mutation_lock() {
  local lock_status
  coproc H14_ATTESTATION_LOCK_HOLDER {
    exec env -i PATH="$SAFE_PATH" python3 -I /dev/fd/3 \
      "$LOCK_ROOT" "$LOCK" 3<<'PY'
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
        lock_descriptor = os.open(
            'mutation.lock',
            flags | os.O_CREAT | os.O_EXCL,
            0o600,
            dir_fd=root_descriptor,
        )
        created_lock = True
    try:
        if created_lock:
            os.fchown(lock_descriptor, 0, 0)
            os.fchmod(lock_descriptor, 0o600)
            os.fsync(lock_descriptor)
            os.fsync(root_descriptor)
        before = os.fstat(lock_descriptor)
        named = os.stat(
            'mutation.lock', dir_fd=root_descriptor, follow_symlinks=False,
        )
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
        named_after = os.stat(
            'mutation.lock', dir_fd=root_descriptor, follow_symlinks=False,
        )
        if (
            (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
             after.st_nlink, after.st_size, after.st_mtime_ns)
            != (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
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
  LOCK_HOLDER_PROCESS_ID="$H14_ATTESTATION_LOCK_HOLDER_PID"
  LOCK_STATUS_FD="${H14_ATTESTATION_LOCK_HOLDER[0]}"
  LOCK_CONTROL_FD="${H14_ATTESTATION_LOCK_HOLDER[1]}"
  if ! IFS= read -r lock_status <&"$LOCK_STATUS_FD"; then
    exec {LOCK_CONTROL_FD}>&- || true
    wait "$LOCK_HOLDER_PROCESS_ID" || true
    return 1
  fi
  exec {LOCK_STATUS_FD}<&-
  [[ "$lock_status" =~ ^locked:[0-9]+:[0-9]+$ ]]
}

release_staging_mutation_lock() {
  exec {LOCK_CONTROL_FD}>&- || return 1
  wait "$LOCK_HOLDER_PROCESS_ID" || return 1
  unset LOCK_HOLDER_PROCESS_ID LOCK_STATUS_FD LOCK_CONTROL_FD
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
acquire_staging_mutation_lock || die 'the shared hardened staging mutation lock could not be acquired'
trap 'release_staging_mutation_lock || true' EXIT
require_no_other_mutator_processes || die 'another staging helper or recovery mutation is active'
require_helper_exact || die 'the installed canonical c36 H14 helper is not exact'

mapfile -t bundle_values < <(claim_and_load_bundle) ||
  die 'the exact one-use terminal-attestation bundle could not be claimed'
[[ "${#bundle_values[@]}" -eq 5 ]] ||
  die 'the claimed bundle attestation returned an invalid shape'
ATTESTATION_SCRIPT_SHA256="${bundle_values[0]}"
ATTESTATION_SCRIPT_SIZE="${bundle_values[1]}"
DIFFERENTIAL_VALIDATOR_SHA256="${bundle_values[2]}"
DIFFERENTIAL_VALIDATOR_SIZE="${bundle_values[3]}"
BUNDLE_MANIFEST_SIZE="${bundle_values[4]}"
[[ "$ATTESTATION_SCRIPT_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$ATTESTATION_SCRIPT_SIZE" =~ ^[1-9][0-9]{0,7}$ &&
  "$DIFFERENTIAL_VALIDATOR_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$DIFFERENTIAL_VALIDATOR_SIZE" =~ ^[1-9][0-9]{0,7}$ &&
  "$BUNDLE_MANIFEST_SIZE" =~ ^[1-9][0-9]{0,7}$ &&
  "$(sha256sum -- "$STAGED_INSTALLER" | awk '{print $1}')" == "$ATTESTATION_SCRIPT_SHA256" &&
  "$(stat --format='%s' "$STAGED_INSTALLER")" == "$ATTESTATION_SCRIPT_SIZE" &&
  "$(sha256sum -- "$CLAIM_ROOT/$SCRIPT_BASENAME" | awk '{print $1}')" == "$ATTESTATION_SCRIPT_SHA256" &&
  "$(stat --format='%s' "$CLAIM_ROOT/$SCRIPT_BASENAME")" == "$ATTESTATION_SCRIPT_SIZE" &&
  "$(sha256sum -- "$CLAIM_ROOT/$VALIDATOR_BASENAME" | awk '{print $1}')" == "$DIFFERENTIAL_VALIDATOR_SHA256" &&
  "$(stat --format='%s' "$CLAIM_ROOT/$VALIDATOR_BASENAME")" == "$DIFFERENTIAL_VALIDATOR_SIZE" &&
  "$(sha256sum -- "$CLAIM_ROOT/$MANIFEST_BASENAME" | awk '{print $1}')" == "$PROVIDED_MANIFEST_SHA256" &&
  "$(stat --format='%s' "$CLAIM_ROOT/$MANIFEST_BASENAME")" == "$BUNDLE_MANIFEST_SIZE" ]] ||
  die 'a claimed terminal-attestation artifact changed'

PROFILE_ROOT="$(docker_local volume inspect --format '{{.Mountpoint}}' "$PROFILE_VOLUME")" ||
  die 'the KemerBet profile volume mountpoint is unavailable'
CONTROL_ROOT="$(docker_local volume inspect --format '{{.Mountpoint}}' "$CONTROL_VOLUME")" ||
  die 'the KemerBet control volume mountpoint is unavailable'
[[ "$PROFILE_ROOT" == /* && "$CONTROL_ROOT" == /* && "$PROFILE_ROOT" != "$CONTROL_ROOT" ]] ||
  die 'the KemerBet volume mountpoints are ambiguous'

refresh_terminal_state ||
  die 'the independent terminal validator rejected H14, a579, Owner, volume, gate, or forward-artifact state'
discover_attestation_ledger || die 'the terminal-attestation ledger is unsafe'

GRANT_STATE="$(current_grant_state)" ||
  die 'the deployment grant is neither the exact disabled nor exact active inode'
case "$ATTESTATION_PHASE" in
  intent-only|grant-temp|grant-intent|completion-temp|completed-in-installing|final)
    load_sudoers_binding_from_attestation_intent ||
      die 'the durable terminal intent does not bind an exact deployment-grant inode'
    ;;
  absent|empty|intent-temp)
    [[ "$GRANT_STATE" == 'disabled' ]] ||
      die 'an active grant without a durable exact terminal intent is impossible'
    ;;
  *) die 'the terminal-attestation phase is invalid' ;;
esac
capture_sudoers_boundary "$GRANT_STATE" ||
  die 'the deployment grant inode or digest does not match the durable boundary'
EXPECTED_REPAIR_COMPLETION_SHA256="$(expected_repair_completed | sha256sum | awk '{print $1}')" ||
  die 'the exact a579 completion digest could not be derived'
[[ "$EXPECTED_REPAIR_COMPLETION_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the exact a579 completion digest is invalid'
require_phase_matrix "$GRANT_STATE" ||
  die 'the repair, attestation, and deployment-grant phases form an impossible replay state'

if [[ "$ATTESTATION_PHASE" == 'final' ]]; then
  require_record expected_attestation_intent "$ATTESTATION_WORK_ROOT/intent-v1" ||
    die 'the completed attestation intent changed'
  prepare_attestation_hashes || die 'the completed attestation hashes are invalid'
  require_record expected_grant_restoration_intent \
    "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" ||
    die 'the completed grant-restoration intent changed'
  require_repair_completed || die 'the exact a579 completion changed'
  prepare_attestation_hashes || die 'the completed repair digest is invalid'
  require_record expected_attestation_completed "$ATTESTATION_WORK_ROOT/completed-v1" ||
    die 'the completed terminal attestation changed'
  capture_sudoers_boundary active ||
    die 'the active deployment grant changed during terminal replay'
  printf '%s\n' \
    'FetanAgent H14 terminal attestation already valid: canonical evidence and helper preserved; no provider action and no money moved.'
  exit 0
fi

if [[ "$ATTESTATION_PHASE" == 'absent' ]]; then
  create_attestation_ledger ||
    die 'the append-only terminal-attestation ledger could not be created'
fi
[[ "$ATTESTATION_STATE" == 'installing' ]] ||
  die 'the terminal-attestation ledger is in an unreviewed state'

if [[ -e "$ATTESTATION_WORK_ROOT/intent-v1" &&
  ! -L "$ATTESTATION_WORK_ROOT/intent-v1" ]]; then
  require_record expected_attestation_intent "$ATTESTATION_WORK_ROOT/intent-v1" ||
    die 'the durable terminal-attestation intent changed'
else
  case "$ATTESTATION_PHASE" in empty|intent-temp) ;; *)
    die 'the terminal intent is absent in an advanced attestation phase' ;;
  esac
  [[ "$CURRENT_REPAIR_STATE" == 'intent-only' && "$GRANT_STATE" == 'disabled' ]] ||
    die 'terminal intent must precede a579 completion and grant restoration'
  refresh_terminal_state ||
    die 'the terminal state changed before terminal-intent publication'
  capture_sudoers_boundary disabled ||
    die 'the disabled deployment grant changed before terminal-intent publication'
  require_no_other_mutator_processes ||
    die 'another staging mutation appeared before terminal-intent publication'
  require_exact_droplet ||
    die 'the staging Droplet identity changed before terminal-intent publication'
  publish_exact_record "$ATTESTATION_WORK_ROOT/intent-v1" 0600 < <(expected_attestation_intent) ||
    die 'the terminal-attestation intent could not be published durably'
  require_record expected_attestation_intent "$ATTESTATION_WORK_ROOT/intent-v1" ||
    die 'the published terminal-attestation intent is invalid'
  ATTESTATION_PHASE='intent-only'
fi
prepare_attestation_hashes || die 'the terminal-attestation intent digest is invalid'

if [[ -e "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" &&
  ! -L "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" ]]; then
  require_record expected_grant_restoration_intent \
    "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" ||
    die 'the durable grant-restoration intent changed'
else
  case "$ATTESTATION_PHASE" in intent-only|grant-temp) ;; *)
    die 'the grant-restoration intent is absent in an advanced attestation phase' ;;
  esac
  [[ "$CURRENT_REPAIR_STATE" == 'intent-only' && "$GRANT_STATE" == 'disabled' ]] ||
    die 'grant-restoration intent must precede grant activation and a579 completion'
  refresh_terminal_state ||
    die 'the final disabled-grant terminal revalidation failed'
  capture_sudoers_boundary disabled ||
    die 'the disabled deployment grant changed before grant-restoration intent'
  require_no_other_mutator_processes ||
    die 'another staging mutation appeared before grant-restoration intent'
  require_exact_droplet ||
    die 'the staging Droplet identity changed before grant-restoration intent'
  publish_exact_record "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" 0600 \
    < <(expected_grant_restoration_intent) ||
    die 'the exact grant-restoration intent could not be published durably'
  require_record expected_grant_restoration_intent \
    "$ATTESTATION_WORK_ROOT/grant-restoration-intent-v1" ||
    die 'the published grant-restoration intent is invalid'
  ATTESTATION_PHASE='grant-intent'
fi
prepare_attestation_hashes || die 'the grant-restoration intent digest is invalid'

GRANT_STATE="$(current_grant_state)" ||
  die 'the grant state changed after durable grant-restoration intent'
if [[ "$GRANT_STATE" == 'disabled' ]]; then
  [[ "$ATTESTATION_PHASE" == 'grant-intent' && "$CURRENT_REPAIR_STATE" == 'intent-only' ]] ||
    die 'a disabled grant is invalid after repair or attestation completion began'
  capture_sudoers_boundary disabled ||
    die 'the disabled grant inode changed before restoration'
  refresh_terminal_state ||
    die 'the terminal state changed before exact grant restoration'
  capture_sudoers_boundary disabled ||
    die 'the disabled grant inode changed during final revalidation'
  require_no_other_mutator_processes ||
    die 'another staging mutation appeared before exact grant restoration'
  require_exact_droplet ||
    die 'the staging Droplet identity changed before exact grant restoration'
  restore_sudoers || die 'the exact disabled deployment grant could not be restored'
  capture_sudoers_boundary active ||
    die 'the restored active grant did not preserve the bound inode and digest'
else
  capture_sudoers_boundary active ||
    die 'the active deployment grant does not preserve the bound inode and digest'
fi

refresh_terminal_state ||
  die 'the terminal state changed after exact grant restoration'
capture_sudoers_boundary active || die 'the restored deployment grant is not exact'
require_no_other_mutator_processes ||
  die 'another staging mutation appeared before a579 completion'
require_exact_droplet ||
  die 'the staging Droplet identity changed before a579 completion'

finalize_repair_ledger ||
  die 'the exact a579 completed-v1 could not be published and finalized'
refresh_terminal_state ||
  die 'the terminal state changed after a579 completion'
[[ "$CURRENT_REPAIR_STATE" == 'final' ]] ||
  die 'the exact a579 repair ledger did not reach its final namespace'
capture_sudoers_boundary active ||
  die 'the active deployment grant changed after a579 completion'
require_no_other_mutator_processes ||
  die 'another staging mutation appeared before terminal completion'
require_exact_droplet ||
  die 'the staging Droplet identity changed before terminal completion'
require_repair_completed || die 'the exact finalized a579 completion is invalid'
prepare_attestation_hashes || die 'the finalized a579 completion digest is invalid'

finalize_attestation_ledger ||
  die 'the terminal-attestation completion could not be published durably'
refresh_terminal_state ||
  die 'the terminal state changed after terminal-attestation completion'
capture_sudoers_boundary active ||
  die 'the active deployment grant changed after terminal-attestation completion'
require_record expected_attestation_completed "$ATTESTATION_ROOT/completed-v1" ||
  die 'the finalized terminal-attestation completion is invalid'
release_staging_mutation_lock ||
  die 'the shared hardened staging mutation lock could not be released'
trap - EXIT

printf '%s\n' \
  'FetanAgent H14 terminal attestation installed: canonical evidence and helper preserved; Amount and Transfer disabled; no provider action and no money moved.'
