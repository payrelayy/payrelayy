#!/usr/bin/env bash
# Root-console-only, one-service runtime bridge for the exact completed H14
# KemerBet quarantine recovery. It replaces only the historical H13 Owner with
# canonical H14's Owner image so the already-applied claim-bound recovery RPC
# can be used. It never starts a provider browser or coordinator, creates a
# profile or cohort, enters Amount, clicks Transfer, enables a financial gate,
# or moves money.
#
# Exact CLI (the workflow emits the immutable values and path):
#   bash /root/fetanagent-h14-owner-runtime-bridge-<repair-sha>/fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh \
#     <repair-implementation-sha> <canonical-h14-sha> <exact-absent-/tmp-bundle-path> \
#     <manifest-sha256> <quarantine-recovery-authorization-sha256>

set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly OWNER_SERVICE='owner-control'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly PREDECESSOR_RELEASE='306818ca812bd2abce8479396c4eea8383ea00f9'
readonly CANONICAL_H14='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly CANONICAL_TAG='06459511d933'
readonly H14_HELPER_SHA256='c36c2b509ef3f560f934dfaf033e34656f36748f4b82e3c0a3398564f8161f58'
readonly AUTHORIZATION_SHA256='6b242ff02a16e885ea87008e60826c5ee333f3fbfcf30ea0f044ce938568c874'
readonly STAGING_PROJECT_REF='spzpiyxheappsfyswewl'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-disabled'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly H14_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14'
readonly H14_ROOT="$H14_PARENT/$CANONICAL_H14"
readonly REPAIR_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-live-repair'
readonly BRIDGE_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge'
readonly CLAIM_PARENT='/var/lib/fetanagent/kemerbet-quarantine-recovery-v14-owner-runtime-bridge-bundles'
readonly SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly PROFILE_VOLUME="${PROJECT_NAME}_kemerbet_sessions"
readonly CONTROL_VOLUME="${PROJECT_NAME}_kemerbet_session_control"
readonly OWNER_NETWORK="${PROJECT_NAME}_owner_control_service"
readonly OWNER_RECEIPT_ROOT='/var/lib/fetanagent/kemerbet-readiness-cohort-receipts'
readonly FINAL_BINDING='/etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings'
readonly SCRIPT_BASENAME='fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh'
readonly IMAGE_ARCHIVE_NAME='fetanagent-owner-control-canonical-h14.tar'
readonly COMPOSE_NAME='compose.staging-beta.yaml'
readonly MANIFEST_NAME='manifest-v1'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H14 Owner runtime bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 5 ]] || die 'expected repair SHA, canonical H14 SHA, staged bundle path, manifest digest, and authorization digest'
readonly REPAIR_RELEASE="$1"
readonly PROVIDED_CANONICAL_H14="$2"
readonly STAGED_BUNDLE="$3"
readonly PROVIDED_MANIFEST_SHA256="$4"
readonly PROVIDED_AUTHORIZATION_SHA256="$5"
readonly STAGING_ROOT="/root/fetanagent-h14-owner-runtime-bridge-$REPAIR_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly REPAIR_ROOT="$REPAIR_PARENT/$REPAIR_RELEASE"
readonly BRIDGE_INSTALLING="$BRIDGE_PARENT/.installing-$REPAIR_RELEASE"
readonly BRIDGE_ROOT="$BRIDGE_PARENT/$REPAIR_RELEASE"
readonly CLAIM_INSTALLING="$CLAIM_PARENT/.installing-$REPAIR_RELEASE"
readonly CLAIM_ROOT="$CLAIM_PARENT/$REPAIR_RELEASE"
readonly OWNER_IMAGE="fetanagent-owner-control:$CANONICAL_TAG"

[[ "$REPAIR_RELEASE" =~ ^[0-9a-f]{40}$ && "$REPAIR_RELEASE" != "$CANONICAL_H14" &&
  "$REPAIR_RELEASE" != "$PREDECESSOR_RELEASE" ]] ||
  die 'the repair implementation must be one distinct full lowercase commit SHA'
[[ "$PROVIDED_CANONICAL_H14" == "$CANONICAL_H14" ]] ||
  die 'the canonical H14 release is not exact'
[[ "$PROVIDED_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the staged manifest digest is invalid'
[[ "$PROVIDED_AUTHORIZATION_SHA256" == "$AUTHORIZATION_SHA256" ]] ||
  die 'the exact reviewed quarantine-recovery authorization digest is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run only in a fresh DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl dirname docker env find grep head id install \
  mkdir mv python3 realpath sed seq sha256sum sleep sort ss stat sync tail timeout visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done

[[ ! -L "$STAGED_INSTALLER" && -f "$STAGED_INSTALLER" &&
  "$(realpath -- "$0")" == "$STAGED_INSTALLER" &&
  "$(realpath -- "$STAGED_INSTALLER")" == "$STAGED_INSTALLER" &&
  "$(stat --format='%U:%G:%a:%h' "$STAGED_INSTALLER")" == 'root:root:600:1' ]] ||
  die 'run only the root-owned immutable repair script from its exact staging path'

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

require_active_grant_only() {
  [[ ! -L "$SUDOERS" && -f "$SUDOERS" && "$(realpath -- "$SUDOERS")" == "$SUDOERS" &&
    "$(stat --format='%U:%G:%a:%h' "$SUDOERS")" == 'root:root:440:1' ]] || return 1
  cmp -s -- "$SUDOERS" <(expected_sudoers) || return 1
  [[ ! -e "$SUDOERS_DISABLED" && ! -L "$SUDOERS_DISABLED" ]] || return 1
  visudo -cf /etc/sudoers >/dev/null
}

require_helper_exact() {
  [[ ! -L "$TARGET" && -f "$TARGET" && "$(realpath -- "$TARGET")" == "$TARGET" &&
    "$(stat --format='%U:%G:%a:%h' "$TARGET")" == 'root:root:755:1' &&
    "$(sha256sum -- "$TARGET" | awk '{print $1}')" == "$H14_HELPER_SHA256" ]] || return 1
  bash -n "$TARGET" || return 1
  [[ ! -e /usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-installing &&
    ! -L /usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-installing &&
    ! -e /usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-installing.partial &&
    ! -L /usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-quarantine-recovery-v14-installing.partial ]] || return 1
  env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' \
    "$TARGET" verify "$H14_HELPER_SHA256" >/dev/null
}

require_h14_helper_host_retired() {
  local output
  output="$(env -i PATH="$SAFE_PATH" HOME='/root' SUDO_USER='fetanagent-admin' \
    "$TARGET" kemerbet-quarantine-recovery-ready "$CANONICAL_H14")" || return 1
  [[ "$output" == 'KemerBet H14 recovery state: host-retired; Transfer and Amount disabled.' ]]
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
      case "$basename" in
        fetanagent-staging-deploy-helper|fetanagent-kemerbet-quarantine-recovery-v14.sh|\
        fetanagent-kemerbet-quarantine-recovery-v14-live-repair.sh|\
        fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge.sh) return 1 ;;
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
  local container environment gate inventory mode_count service
  [[ ! -e "$FINAL_BINDING" && ! -L "$FINAL_BINDING" ]] || return 1
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    environment="$(docker_local container inspect "$container" \
      --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
    service="$(docker_local container inspect "$container" \
      --format '{{index .Config.Labels "com.docker.compose.service"}}')" || return 1
    [[ "$service" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || return 1
    mode_count="$(awk '$0 == "FINANCIAL_ACTIONS_MODE=dry_run" { count += 1 } END { print count + 0 }' \
      <<<"$environment")" || return 1
    if [[ "$service" == 'gateway' ]]; then
      [[ "$mode_count" == '0' ]] || return 1
    else
      [[ "$mode_count" == '1' ]] || return 1
    fi
    for gate in KEMERBET_EXECUTOR_ENABLED KEMERBET_FINAL_ACTION_ENABLED \
      KEMERBET_TRANSFER_ENABLED KEMERBET_AMOUNT_ENTRY_ENABLED \
      FETANAGENT_INTERNAL_KEMERBET_ENABLED FETANAGENT_PRIVATE_LIVE_MODE; do
      if grep -Eiq "^${gate}=(1|true|yes|on)$" <<<"$environment"; then
        return 1
      fi
    done
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
canonical_mounts = sorted(mounts, key=lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True))
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
    'Mounts': canonical_mounts,
    'Config.Labels': config.get('Labels'),
}
encoded = (json.dumps(contract, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode('ascii')
print(hashlib.sha256(encoded).hexdigest())
PY
}

load_exact_h14_and_mount_repair() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$H14_PARENT" "$H14_ROOT" "$REPAIR_PARENT" "$REPAIR_ROOT" "$REPAIR_RELEASE" \
    "$CANONICAL_H14" "$PREDECESSOR_RELEASE" "$H14_HELPER_SHA256" "$AUTHORIZATION_SHA256" <<'PY'
import hashlib
import os
import re
import stat
import sys

h14_parent, h14_root, repair_parent, repair_root, repair_release, canonical, predecessor, helper_sha, auth_sha = sys.argv[1:]
sha = re.compile(r'[0-9a-f]{64}')
cid = re.compile(r'[0-9a-f]{64}')

def reject():
    raise RuntimeError()

def directory(path, mode, entries=None):
    value = os.lstat(path)
    if not stat.S_ISDIR(value.st_mode) or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, mode) or os.path.realpath(path) != path:
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
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink) != (0, 0, mode, 1)
            or len(data) != before.st_size
            or before.st_size > maximum
            or os.path.realpath(path) != path
            or (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid, before.st_nlink, before.st_size, before.st_mtime_ns)
               != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid, after.st_nlink, after.st_size, after.st_mtime_ns)
        ):
            reject()
        return data
    finally:
        os.close(descriptor)

def ascii_lines(path, mode, count):
    data = exact_file(path, mode)
    lines = data.decode('ascii').splitlines()
    if len(lines) != count or data != ('\n'.join(lines) + '\n').encode('ascii'):
        reject()
    return lines, data

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
    directory(repair_parent, 0o700, [repair_release])
    directory(repair_root, 0o700, ['completed-v1', 'intent-v1'])
    repair_intent, repair_intent_data = ascii_lines(f'{repair_root}/intent-v1', 0o600, 42)
    repair_completed, repair_completed_data = ascii_lines(f'{repair_root}/completed-v1', 0o600, 29)
    if (
        repair_intent[0:7] != [
            'version=1',
            'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair',
            'state=authorized',
            f'repair_implementation_release={repair_release}',
            f'canonical_h14_recovery_release={canonical}',
            f'authorization_sha256={auth_sha}',
            f'h14_authorized_namespace=.installing-{canonical}',
        ]
        or not all(re.fullmatch(r'[^=]+=[0-9]+', repair_intent[index]) for index in (7, 8, 9, 10, 12, 13))
        or not all(sha.fullmatch(repair_intent[index].split('=', 1)[1]) for index in (11, 14, 16, 19, 21))
        or not cid.fullmatch(repair_intent[15].split('=', 1)[1])
        or repair_intent[17] != 'coordinator_absent=true'
        or not cid.fullmatch(repair_intent[18].split('=', 1)[1])
        or repair_intent[20] != 'owner_semantic_contract_algorithm=fetanagent-docker-semantic-contract-v2'
        or repair_intent[22:] != [
            'mounts_order=full-canonical-json-sorted',
            'config_cmd_order=preserved',
            'config_env_order=preserved',
            'deployment_grant=disabled',
            'installed_helper_sha256=3b789c983c415326171c6b4224016d2a04769a0b8c37cb91fc463383f2d141aa',
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
    owner_id = repair_intent[18].split('=', 1)[1]
    coordinator_id = repair_intent[15].split('=', 1)[1]
    semantic_sha = repair_intent[21].split('=', 1)[1]
    if repair_completed != [
        'version=1',
        'contract=fetanagent-kemerbet-quarantine-recovery-v14-live-repair',
        'state=completed',
        f'repair_implementation_release={repair_release}',
        f'canonical_h14_recovery_release={canonical}',
        f'authorization_sha256={auth_sha}',
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
        f'successor_helper_sha256={helper_sha}',
        'deployment_grant=active',
        'financial_actions_mode=dry_run',
        'kemerbet_executor_enabled=false',
        'kemerbet_final_action_enabled=false',
        'transfer_enabled=false',
        'amount_entry_enabled=false',
        'money_moved=false',
        f'repair_intent_sha256={hashlib.sha256(repair_intent_data).hexdigest()}',
        repair_completed[25],
        'legacy_contract_digest_compared=false',
        'canonical_h14_evidence_rewritten=false',
        'canonical_h14_release_superseded=false',
    ] or not repair_completed[25].startswith('h14_owner_runtime_restored_sha256=') or not sha.fullmatch(repair_completed[25].split('=', 1)[1]):
        reject()
    runtime_intent, _ = ascii_lines(f'{h14_root}/runtime-retirement-intent-v1', 0o600, 12)
    restored, restored_data = ascii_lines(f'{h14_root}/owner-runtime-restored-v1', 0o600, 11)
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
        or hashlib.sha256(restored_data).hexdigest() != repair_completed[25].split('=', 1)[1]
    ):
        reject()

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
                kind = 'd'
                payload_sha = '-'
                size = 0
            elif stat.S_ISREG(value.st_mode):
                kind = 'f'
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
                try:
                    before = os.fstat(descriptor)
                    payload = hashlib.sha256()
                    while True:
                        block = os.read(descriptor, 1024 * 1024)
                        if not block:
                            break
                        total += len(block)
                        if total > 1024 * 1024 * 1024:
                            reject()
                        payload.update(block)
                    after = os.fstat(descriptor)
                    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                        reject()
                    payload_sha = payload.hexdigest()
                    size = before.st_size
                finally:
                    os.close(descriptor)
            else:
                reject()
            line = f'{relative}\0{kind}\0{value.st_dev}:{value.st_ino}\0{value.st_uid}:{value.st_gid}:{stat.S_IMODE(value.st_mode)}:{value.st_nlink}:{size}\0{payload_sha}\n'
            tree.update(line.encode('utf-8'))
    print(owner_id)
    print(coordinator_id)
    print(semantic_sha)
    print(h14_value.st_dev)
    print(h14_value.st_ino)
    print(tree.hexdigest())
    print(hashlib.sha256(repair_intent_data).hexdigest())
    print(hashlib.sha256(repair_completed_data).hexdigest())
except Exception:
    raise SystemExit(1)
PY
}

claim_and_load_bundle_manifest() {
  local admin_gid admin_uid script_sha
  admin_uid="$(id -u fetanagent-admin)" || return 1
  admin_gid="$(id -g fetanagent-admin)" || return 1
  script_sha="$(sha256sum -- "$STAGED_INSTALLER" | awk '{print $1}')" || return 1
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$STAGED_BUNDLE" "$CLAIM_PARENT" "$CLAIM_INSTALLING" "$CLAIM_ROOT" \
    "$REPAIR_RELEASE" "$CANONICAL_H14" "$STAGING_PROJECT_REF" "$EXPECTED_DROPLET_ID" \
    "$AUTHORIZATION_SHA256" "$PROVIDED_MANIFEST_SHA256" "$script_sha" "$admin_uid" "$admin_gid" <<'PY'
import hashlib
import os
import re
import stat
import sys

(source, parent, installing, final, repair, canonical, project, droplet, auth,
 manifest_sha, script_sha, admin_uid_text, admin_gid_text) = sys.argv[1:]
admin_uid = int(admin_uid_text)
admin_gid = int(admin_gid_text)
sha = re.compile(r'[0-9a-f]{64}')
image_id_pattern = re.compile(r'sha256:[0-9a-f]{64}')
remote_pattern = re.compile(rf'/tmp/fetanagent-h14-owner-runtime-bridge-([1-9][0-9]*)-([1-9][0-9]*)-{repair}')
names = ['compose.staging-beta.yaml', 'fetanagent-owner-control-canonical-h14.tar', 'manifest-v1']

def reject():
    raise RuntimeError()

def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def exact_descriptor(path, uid, gid, mode, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    before = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        not stat.S_ISREG(before.st_mode)
        or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
        or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink) != (uid, gid, mode, 1)
        or before.st_size > maximum
        or os.path.realpath(path) != path
    ):
        os.close(descriptor)
        reject()
    return descriptor, before

def finish_stable(descriptor, before, path):
    after = os.fstat(descriptor)
    named = os.lstat(path)
    if (
        (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
         before.st_nlink, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
            after.st_nlink, after.st_size, after.st_mtime_ns)
        or (after.st_dev, after.st_ino) != (named.st_dev, named.st_ino)
    ):
        reject()

def read_small(path, uid, gid, mode, maximum):
    descriptor, before = exact_descriptor(path, uid, gid, mode, maximum)
    try:
        data = bytearray()
        while True:
            block = os.read(descriptor, 1024 * 1024)
            if not block:
                break
            data.extend(block)
            if len(data) > maximum:
                reject()
        finish_stable(descriptor, before, path)
        value = bytes(data)
        return value, hashlib.sha256(value).hexdigest()
    finally:
        os.close(descriptor)

def hash_exact(path, uid, gid, mode, maximum, expected_size=None):
    descriptor, before = exact_descriptor(path, uid, gid, mode, maximum)
    try:
        if expected_size is not None and before.st_size != expected_size:
            reject()
        digest = hashlib.sha256()
        total = 0
        while True:
            block = os.read(descriptor, 1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > maximum:
                reject()
            digest.update(block)
        if total != before.st_size:
            reject()
        finish_stable(descriptor, before, path)
        return total, digest.hexdigest()
    finally:
        os.close(descriptor)

def exact_root_small(path, expected, digest):
    data, observed = read_small(path, 0, 0, 0o400, len(expected))
    if data != expected or observed != digest:
        reject()

def copy_small(root, name, data, digest):
    destination = f'{root}/{name}'
    temporary = f'{root}/.{name}.installing'
    if os.path.lexists(destination):
        if os.path.lexists(temporary):
            reject()
        exact_root_small(destination, data, digest)
        return
    if os.path.lexists(temporary):
        descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
        value = os.fstat(descriptor)
        named = os.lstat(temporary)
        prefix = os.pread(descriptor, len(data) + 1, 0)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, 0o400, 1)
            or len(prefix) > len(data)
            or prefix != data[:len(prefix)]
        ):
            os.close(descriptor)
            reject()
    else:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o400)
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
    exact_root_small(temporary, data, digest)
    os.rename(temporary, destination)
    sync_directory(root)
    exact_root_small(destination, data, digest)

def stream_archive(root, source_path, digest, size):
    destination = f'{root}/fetanagent-owner-control-canonical-h14.tar'
    temporary = f'{root}/.fetanagent-owner-control-canonical-h14.tar.installing'
    maximum = 1024 * 1024 * 1024
    source_descriptor, source_before = exact_descriptor(
        source_path, admin_uid, admin_gid, 0o600, maximum,
    )
    try:
        if source_before.st_size != size:
            reject()
        if os.path.lexists(destination):
            if os.path.lexists(temporary):
                reject()
            source_size, source_sha = hash_open_descriptor(
                source_descriptor, source_before, source_path, maximum,
            )
            destination_size, destination_sha = hash_exact(
                destination, 0, 0, 0o400, maximum, size,
            )
            if (source_size, source_sha, destination_size, destination_sha) != (size, digest, size, digest):
                reject()
            return
        if os.path.lexists(temporary):
            output = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
            partial = os.fstat(output)
            named = os.lstat(temporary)
            if (
                not stat.S_ISREG(partial.st_mode)
                or (partial.st_dev, partial.st_ino) != (named.st_dev, named.st_ino)
                or (partial.st_uid, partial.st_gid, stat.S_IMODE(partial.st_mode), partial.st_nlink) != (0, 0, 0o400, 1)
                or partial.st_size > size
                or os.path.realpath(temporary) != temporary
            ):
                os.close(output)
                reject()
        else:
            output = os.open(
                temporary,
                os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o400,
            )
            os.fchown(output, 0, 0)
            os.fchmod(output, 0o400)
            partial = os.fstat(output)
        try:
            running = hashlib.sha256()
            consumed = 0
            while consumed < partial.st_size:
                wanted = min(1024 * 1024, partial.st_size - consumed)
                source_block = os.read(source_descriptor, wanted)
                partial_block = os.pread(output, wanted, consumed)
                if len(source_block) != wanted or partial_block != source_block:
                    reject()
                running.update(source_block)
                consumed += wanted
            os.lseek(output, consumed, os.SEEK_SET)
            while consumed < size:
                block = os.read(source_descriptor, min(1024 * 1024, size - consumed))
                if not block:
                    reject()
                offset = 0
                while offset < len(block):
                    written = os.write(output, block[offset:])
                    if written <= 0:
                        reject()
                    offset += written
                running.update(block)
                consumed += len(block)
            if os.read(source_descriptor, 1) != b'' or consumed != size or running.hexdigest() != digest:
                reject()
            os.fsync(output)
            output_after = os.fstat(output)
            if output_after.st_size != size:
                reject()
            finish_stable(source_descriptor, source_before, source_path)
        finally:
            os.close(output)
        observed_size, observed_sha = hash_exact(temporary, 0, 0, 0o400, maximum, size)
        if (observed_size, observed_sha) != (size, digest):
            reject()
        os.rename(temporary, destination)
        sync_directory(root)
        observed_size, observed_sha = hash_exact(destination, 0, 0, 0o400, maximum, size)
        if (observed_size, observed_sha) != (size, digest):
            reject()
    finally:
        os.close(source_descriptor)

def hash_open_descriptor(descriptor, before, path, maximum):
    os.lseek(descriptor, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    total = 0
    while True:
        block = os.read(descriptor, 1024 * 1024)
        if not block:
            break
        total += len(block)
        if total > maximum:
            reject()
        digest.update(block)
    finish_stable(descriptor, before, path)
    return total, digest.hexdigest()

def exact_root_directory(path, entries):
    value = os.lstat(path)
    if (
        not stat.S_ISDIR(value.st_mode)
        or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(path) != path
        or sorted(os.listdir(path)) != sorted(entries)
    ):
        reject()
    return value

try:
    parent_parent = os.path.dirname(parent)
    if os.path.lexists(parent):
        parent_value = exact_root_directory(parent, os.listdir(parent))
        children = os.listdir(parent)
        if children not in ([], [os.path.basename(installing)], [os.path.basename(final)]):
            reject()
    else:
        children = []
    completed_claim = children == [os.path.basename(final)]
    if completed_claim:
        root = final
        exact_root_directory(root, names)
        manifest_data, observed_manifest_sha = read_small(f'{root}/manifest-v1', 0, 0, 0o400, 8192)
    else:
        run_match = remote_pattern.fullmatch(source)
        if run_match is None:
            reject()
        source_value = os.lstat(source)
        if (
            not stat.S_ISDIR(source_value.st_mode)
            or (source_value.st_uid, source_value.st_gid, stat.S_IMODE(source_value.st_mode)) != (admin_uid, admin_gid, 0o700)
            or os.path.realpath(source) != source
            or sorted(os.listdir(source)) != names
        ):
            reject()
        manifest_data, observed_manifest_sha = read_small(f'{source}/manifest-v1', admin_uid, admin_gid, 0o600, 8192)
    if observed_manifest_sha != manifest_sha:
        reject()
    lines = manifest_data.decode('ascii').splitlines()
    if len(lines) != 19 or manifest_data != ('\n'.join(lines) + '\n').encode('ascii'):
        reject()
    values = dict(line.split('=', 1) for line in lines)
    run_match = remote_pattern.fullmatch(source)
    expected_keys = [
        'version', 'contract', 'repair_implementation_sha', 'canonical_h14_sha',
        'staging_project_ref', 'staging_droplet_id', 'authorization_sha256',
        'workflow_run_id', 'workflow_run_attempt', 'owner_image_tag', 'owner_image_id',
        'owner_image_tar_sha256', 'owner_image_tar_size', 'canonical_compose_sha256',
        'owner_runtime_bridge_script_sha256', 'provider_action_enabled', 'transfer_enabled',
        'amount_entry_enabled', 'money_moved',
    ]
    if (
        [line.split('=', 1)[0] for line in lines] != expected_keys
        or values['version'] != '1'
        or values['contract'] != 'fetanagent-h14-owner-runtime-bridge-bundle'
        or values['repair_implementation_sha'] != repair
        or values['canonical_h14_sha'] != canonical
        or values['staging_project_ref'] != project
        or values['staging_droplet_id'] != droplet
        or values['authorization_sha256'] != auth
        or values['workflow_run_id'] != run_match.group(1)
        or values['workflow_run_attempt'] != run_match.group(2)
        or values['owner_image_tag'] != f'fetanagent-owner-control:{canonical[:12]}'
        or image_id_pattern.fullmatch(values['owner_image_id']) is None
        or sha.fullmatch(values['owner_image_tar_sha256']) is None
        or re.fullmatch(r'[1-9][0-9]{0,11}', values['owner_image_tar_size']) is None
        or int(values['owner_image_tar_size']) > 1024 * 1024 * 1024
        or sha.fullmatch(values['canonical_compose_sha256']) is None
        or values['owner_runtime_bridge_script_sha256'] != script_sha
        or values['provider_action_enabled'] != 'false'
        or values['transfer_enabled'] != 'false'
        or values['amount_entry_enabled'] != 'false'
        or values['money_moved'] != 'false'
    ):
        reject()
    if completed_claim:
        compose_data, compose_sha = read_small(f'{root}/compose.staging-beta.yaml', 0, 0, 0o400, 1024 * 1024)
        archive_size, archive_sha = hash_exact(
            f'{root}/fetanagent-owner-control-canonical-h14.tar', 0, 0, 0o400,
            1024 * 1024 * 1024, int(values['owner_image_tar_size']),
        )
        if compose_sha != values['canonical_compose_sha256'] or archive_sha != values['owner_image_tar_sha256'] or archive_size != int(values['owner_image_tar_size']):
            reject()
    else:
        compose_data, compose_sha = read_small(f'{source}/compose.staging-beta.yaml', admin_uid, admin_gid, 0o600, 1024 * 1024)
        if compose_sha != values['canonical_compose_sha256']:
            reject()

    if not os.path.lexists(parent):
        os.mkdir(parent, 0o700)
        os.chown(parent, 0, 0)
        os.chmod(parent, 0o700)
        sync_directory(parent_parent)
    parent_value = exact_root_directory(parent, os.listdir(parent))
    children = os.listdir(parent)
    if children not in ([], [os.path.basename(installing)], [os.path.basename(final)]):
        reject()
    if children == [os.path.basename(final)]:
        root = final
    else:
        if children == []:
            os.mkdir(installing, 0o700)
            os.chown(installing, 0, 0)
            os.chmod(installing, 0o700)
            sync_directory(parent)
        root = installing
    exact_root_directory(root, os.listdir(root))
    allowed = set(names) | {f'.{name}.installing' for name in names}
    if not set(os.listdir(root)).issubset(allowed):
        reject()
    copy_small(root, 'manifest-v1', manifest_data, observed_manifest_sha)
    copy_small(root, 'compose.staging-beta.yaml', compose_data, compose_sha)
    if not completed_claim:
        stream_archive(
            root,
            f'{source}/fetanagent-owner-control-canonical-h14.tar',
            values['owner_image_tar_sha256'],
            int(values['owner_image_tar_size']),
        )
    if sorted(os.listdir(root)) != names:
        reject()
    if root == installing:
        os.rename(installing, final)
        sync_directory(parent)
        root = final
    exact_root_directory(root, names)
    exact_root_small(f'{root}/manifest-v1', manifest_data, observed_manifest_sha)
    exact_root_small(f'{root}/compose.staging-beta.yaml', compose_data, compose_sha)
    archive_size, archive_sha = hash_exact(
        f'{root}/fetanagent-owner-control-canonical-h14.tar', 0, 0, 0o400,
        1024 * 1024 * 1024, int(values['owner_image_tar_size']),
    )
    if (archive_size, archive_sha) != (int(values['owner_image_tar_size']), values['owner_image_tar_sha256']):
        reject()
    print(values['owner_image_tag'])
    print(values['owner_image_id'])
    print(values['owner_image_tar_sha256'])
    print(values['owner_image_tar_size'])
    print(values['canonical_compose_sha256'])
    print(values['owner_runtime_bridge_script_sha256'])
except Exception:
    raise SystemExit(1)
PY
}

inspect_image_archive() {
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$CLAIM_ROOT/$IMAGE_ARCHIVE_NAME" "$OWNER_IMAGE" "$OWNER_IMAGE_ID" <<'PY'
import json
import pathlib
import sys
import tarfile

path, expected_tag, expected_id = sys.argv[1:]
expected_config = expected_id.removeprefix('sha256:') + '.json'
try:
    with tarfile.open(path, mode='r:') as archive:
        members = archive.getmembers()
        if not members or len(members) > 4096:
            raise RuntimeError()
        total = 0
        for member in members:
            target = pathlib.PurePosixPath(member.name)
            if target.is_absolute() or '..' in target.parts or not (member.isfile() or member.isdir()):
                raise RuntimeError()
            total += member.size
            if total > 2 * 1024 * 1024 * 1024:
                raise RuntimeError()
        stream = archive.extractfile(archive.getmember('manifest.json'))
        if stream is None:
            raise RuntimeError()
        manifest = json.load(stream)
        if (
            not isinstance(manifest, list)
            or len(manifest) != 1
            or manifest[0].get('Config') != expected_config
            or manifest[0].get('RepoTags') != [expected_tag]
            or not isinstance(manifest[0].get('Layers'), list)
            or not manifest[0]['Layers']
        ):
            raise RuntimeError()
except Exception:
    raise SystemExit(1)
PY
}

require_service_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h' "$path")" == '10001:10001:400:1' ]]
}

require_immutable_config_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:444:1' ]]
}

require_all_compose_inputs() {
  local file
  for file in owner-database-url publishable-key beta-database-url beta-transport-hmac \
    customer-web-database-url customer-web-publishable-key customer-web-rate-limit-hmac \
    bot-transport-hmac beta-payload-hmac bot-token player-action-database-url \
    api-action-transport-hmac api-action-payload-hmac api-action-capability-hmac \
    api-action-semantic-hmac cbe-deposit-reference-encryption-key \
    cbe-deposit-reference-fingerprint-key deposit-proof-reference-encryption-master \
    deposit-proof-reference-fingerprint-master bot-action-transport-hmac; do
    require_service_file "$SECRET_ROOT/$file" || return 1
  done
  require_immutable_config_file "$SECRET_ROOT/supabase-ca.crt" || return 1
  require_immutable_config_file "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json" || return 1
  require_immutable_config_file "$SECRET_ROOT/deposit-proof-reference-profile.v2.json"
}

compose_environment=(
  PATH="$SAFE_PATH"
  HOME='/root'
  DOCKER_HOST="$LOCAL_DOCKER_SOCKET"
  FETANAGENT_VCS_REF="$CANONICAL_H14"
  FETANAGENT_IMAGE_TAG="$CANONICAL_TAG"
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
  --project-name "$PROJECT_NAME" --profile staging-manual -f "$CLAIM_ROOT/$COMPOSE_NAME"
)

require_compose_contract_parses() {
  local images
  env -i "${compose_environment[@]}" "${compose_command[@]}" config --quiet || return 1
  images="$(env -i "${compose_environment[@]}" "${compose_command[@]}" config --images)" || return 1
  grep -Fxq "$OWNER_IMAGE" <<<"$images"
}

container_full_ids_for_service() {
  local service="$1" short full inventory
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter "label=com.docker.compose.service=$service")" || return 1
  while IFS= read -r short; do
    [[ -n "$short" ]] || continue
    full="$(docker_local container inspect "$short" --format '{{.Id}}')" || return 1
    [[ "$full" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$full"
  done <<<"$inventory" | LC_ALL=C sort
}

container_full_ids_for_volume() {
  local volume="$1" short full inventory
  inventory="$(docker_local container ls --all --quiet --filter "volume=$volume")" || return 1
  while IFS= read -r short; do
    [[ -n "$short" ]] || continue
    full="$(docker_local container inspect "$short" --format '{{.Id}}')" || return 1
    [[ "$full" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$full"
  done <<<"$inventory" | LC_ALL=C sort
}

require_exact_owner_inventory() {
  local expected="$1" inventory
  inventory="$(container_full_ids_for_service "$OWNER_SERVICE")" || return 1
  [[ "$inventory" == "$expected" ]]
}

require_owner_network() {
  docker_local network inspect "$OWNER_NETWORK" |
    env -i PATH="$SAFE_PATH" python3 -I /dev/fd/3 "$OWNER_NETWORK" "$PROJECT_NAME" 3<<'PY'
import json
import sys

name, project = sys.argv[1:]
try:
    payload = json.load(sys.stdin)
    value = payload[0]
    labels = value['Labels']
    if (
        len(payload) != 1
        or value['Name'] != name
        or value['Driver'] != 'bridge'
        or value['Internal'] is not False
        or value['EnableIPv6'] is not True
        or labels.get('com.docker.compose.project') != project
        or labels.get('com.docker.compose.network') != 'owner_control_service'
    ):
        raise RuntimeError()
except Exception:
    raise SystemExit(1)
PY
}

require_owner_contract() {
  local container_id="$1" expected_release="$2" expected_image_id="$3"
  docker_local container inspect "$container_id" |
    env -i PATH="$SAFE_PATH" python3 -I /dev/fd/3 \
      "$container_id" "$expected_release" "$expected_image_id" "$PROJECT_NAME" "$CONTROL_VOLUME" \
      "$OWNER_NETWORK" "$OWNER_RECEIPT_ROOT" "$SECRET_ROOT" 3<<'PY'
import json
import sys

container_id, release, expected_image_id, project, control_volume, network, receipt_root, secret_root = sys.argv[1:]
try:
    payload = json.load(sys.stdin)
    if not isinstance(payload, list) or len(payload) != 1:
        raise RuntimeError()
    value = payload[0]
    config = value['Config']
    host = value['HostConfig']
    labels = config['Labels']
    if (
        value['Id'] != container_id
        or labels.get('com.docker.compose.project') != project
        or labels.get('com.docker.compose.service') != 'owner-control'
        or labels.get('org.opencontainers.image.revision') != release
        or (expected_image_id != '-' and value['Image'] != expected_image_id)
        or config['User'] != '10001:10001'
        or config['Cmd'] != ['node', 'apps/admin/dist/index.js']
        or host['ReadonlyRootfs'] is not True
        or host['Privileged'] is not False
        or host.get('Init') is not True
        or host.get('PidMode', '') != ''
        or host['NetworkMode'] != network
        or host['RestartPolicy'].get('Name') != 'no'
        or host.get('AutoRemove') is not False
        or host.get('CapAdd') is not None
        or host.get('CapDrop') != ['ALL']
        or host.get('SecurityOpt') != ['no-new-privileges:true']
        or host.get('PidsLimit') != 128
        or host.get('Memory') != 268435456
        or host.get('NanoCpus') != 500000000
        or host.get('PortBindings') != {'3002/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3002'}]}
        or host.get('RestartPolicy') != {'Name': 'no', 'MaximumRetryCount': 0}
        or config.get('StopTimeout') != 15
    ):
        raise RuntimeError()
    environments = config['Env']
    if (
        environments.count('FINANCIAL_ACTIONS_MODE=dry_run') != 1
        or 'KEMERBET_EXECUTOR_ENABLED=false' not in environments
        or 'KEMERBET_FINAL_ACTION_ENABLED=false' not in environments
        or 'INTERNAL_OWNER_CONTROL_RUNTIME_ENABLED=true' not in environments
        or 'TELEGRAM_BOT_ENABLED=false' not in environments
        or 'INTERNAL_TELEGRAM_INGRESS_ENABLED=false' not in environments
    ):
        raise RuntimeError()
    expected_mounts = {
        '/tmp': ('tmpfs', '', True),
        '/run/fetanagent-kemerbet-session-control': ('volume', control_volume, True),
        '/run/fetanagent-kemerbet-readiness-cohort-receipts': ('bind', receipt_root, False),
        '/run/secrets/owner_control_database_url': ('bind', f'{secret_root}/owner-database-url', False),
        '/run/secrets/owner_control_supabase_publishable_key': ('bind', f'{secret_root}/publishable-key', False),
        '/run/secrets/owner_receiver_reference_encryption_master': ('bind', f'{secret_root}/deposit-proof-reference-encryption-master', False),
        '/run/secrets/owner_receiver_reference_fingerprint_master': ('bind', f'{secret_root}/deposit-proof-reference-fingerprint-master', False),
        '/run/configs/supabase_ca_certificate': ('bind', f'{secret_root}/supabase-ca.crt', False),
        '/etc/fetanagent/deposit-proof-reference-profile.v2.json': ('bind', f'{secret_root}/deposit-proof-reference-profile.v2.json', False),
    }
    observed = {}
    for mount in value['Mounts']:
        destination = mount['Destination']
        if destination in observed:
            raise RuntimeError()
        source = mount.get('Name') if mount['Type'] == 'volume' else mount.get('Source', '')
        observed[destination] = (mount['Type'], source, mount['RW'])
    if observed != expected_mounts:
        raise RuntimeError()
    networks = value['NetworkSettings']['Networks']
    if set(networks) != {network}:
        raise RuntimeError()
    ports = value['NetworkSettings']['Ports']
    if value['State']['Running'] and ports != {'3002/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3002'}]}:
        raise RuntimeError()
except Exception:
    raise SystemExit(1)
PY
}

require_owner_image_contract() {
  [[ "$(docker_local image inspect "$OWNER_IMAGE" --format '{{.Id}}')" == "$OWNER_IMAGE_ID" &&
    "$(docker_local image inspect "$OWNER_IMAGE" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$CANONICAL_H14" &&
    "$(docker_local image inspect "$OWNER_IMAGE" --format '{{.Config.User}}')" == '10001:10001' &&
    "$(docker_local image inspect "$OWNER_IMAGE" --format '{{json .Config.Cmd}}')" == '["node","apps/admin/dist/index.js"]' ]]
}

container_runtime_state_digest() {
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
value = payload[0]
state = value.get('State')
if not isinstance(state, dict):
    raise SystemExit(1)
health = state.get('Health')
contract = {
    'version': 'fetanagent-docker-runtime-state-v1',
    'Id': value.get('Id'),
    'RestartCount': value.get('RestartCount'),
    'Status': state.get('Status'),
    'Running': state.get('Running'),
    'Paused': state.get('Paused'),
    'Restarting': state.get('Restarting'),
    'OOMKilled': state.get('OOMKilled'),
    'Dead': state.get('Dead'),
    'ExitCode': state.get('ExitCode'),
    'Error': state.get('Error'),
    'Health.Status': health.get('Status') if isinstance(health, dict) else None,
}
encoded = (json.dumps(contract, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode('ascii')
print(hashlib.sha256(encoded).hexdigest())
PY
}

capture_non_owner_inventory() {
  local container_id inventory semantic service state lines=()
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME")" || return 1
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    container_id="$(docker_local container inspect "$container_id" --format '{{.Id}}')" || return 1
    [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || return 1
    service="$(docker_local container inspect "$container_id" \
      --format '{{index .Config.Labels "com.docker.compose.service"}}')" || return 1
    [[ "$service" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || return 1
    [[ "$service" != 'kemerbet-session-provision' ]] || return 1
    [[ "$service" == "$OWNER_SERVICE" ]] && continue
    semantic="$(container_semantic_contract_digest "$container_id")" || return 1
    state="$(container_runtime_state_digest "$container_id")" || return 1
    [[ "$semantic" =~ ^[0-9a-f]{64}$ && "$state" =~ ^[0-9a-f]{64}$ ]] || return 1
    lines+=("$container_id|$service|$semantic|$state")
  done <<<"$inventory"
  if ((${#lines[@]} > 0)); then
    printf '%s\n' "${lines[@]}" | LC_ALL=C sort
  fi
}

require_non_owner_inventory_unchanged() {
  local current current_count current_sha
  current="$(capture_non_owner_inventory)" || return 1
  if [[ -n "$current" ]]; then
    current_count="$(awk 'END { print NR }' <<<"$current")" || return 1
  else
    current_count='0'
  fi
  current_sha="$(printf '%s' "$current" | sha256sum | awk '{print $1}')" || return 1
  [[ "$current_count" == "$NON_OWNER_INVENTORY_COUNT" && "$current_sha" == "$NON_OWNER_INVENTORY_SHA256" ]]
}

require_runtime_boundary() {
  local owner_id="$1" profile_holders control_holders coordinator_inventory
  coordinator_inventory="$(container_full_ids_for_service kemerbet-session-provision)" || return 1
  profile_holders="$(container_full_ids_for_volume "$PROFILE_VOLUME")" || return 1
  control_holders="$(container_full_ids_for_volume "$CONTROL_VOLUME")" || return 1
  [[ -z "$coordinator_inventory" && -z "$profile_holders" && "$control_holders" == "$owner_id" ]] || return 1
  require_exact_owner_inventory "$owner_id" || return 1
  require_non_owner_inventory_unchanged || return 1
  require_financial_gates_disabled || return 1
  require_no_host_chromium
}

require_migration_through_old_owner() {
  local owner_id="$1" result
  result="$(env -i PATH="$SAFE_PATH" HOME='/root' DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    timeout 30s docker --host "$LOCAL_DOCKER_SOCKET" container exec -i "$owner_id" node - 2>/dev/null <<'JS'
const fs = require('node:fs');
const { Client } = require('pg');

(async () => {
  const connectionString = fs.readFileSync('/run/secrets/owner_control_database_url', 'utf8').trim();
  if (!connectionString) process.exit(1);
  let target;
  try {
    target = new URL(connectionString);
  } catch {
    process.exit(1);
  }
  let username;
  let password;
  let database;
  try {
    username = decodeURIComponent(target.username);
    password = decodeURIComponent(target.password);
    database = decodeURIComponent(target.pathname.slice(1));
  } catch {
    process.exit(1);
  }
  const searchEntries = [...target.searchParams.entries()];
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol)
    || target.hostname !== 'db.spzpiyxheappsfyswewl.supabase.co'
    || target.hostname.includes('xzztugbgtulptnbpoelr')
    || target.port !== '5432'
    || username !== 'fetanagent_owner_control_runtime'
    || password === ''
    || database !== 'postgres'
    || searchEntries.length !== 1
    || searchEntries[0][0] !== 'sslmode'
    || searchEntries[0][1] !== 'verify-full'
    || target.hash !== ''
  ) process.exit(1);
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await client.connect();
    await client.query('begin transaction read only');
    const result = await client.query(`
      select (
        to_regclass('app.private_owner_kemerbet_quarantine_recoveries') is not null
        and to_regclass('app.private_owner_kemerbet_quarantine_recovery_requests') is not null
        and to_regprocedure('app.recover_owner_kemerbet_quarantined_agent_profile(uuid,uuid,uuid)') is not null
        and has_function_privilege(
          current_user,
          'app.recover_owner_kemerbet_quarantined_agent_profile(uuid,uuid,uuid)',
          'EXECUTE'
        )
        and exists (
          select 1
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app'
             and p.proname = 'recover_owner_kemerbet_quarantined_agent_profile'
             and p.pronargs = 3
             and p.prosecdef
        )
      ) as ready
    `);
    await client.query('rollback');
    if (result.rows.length !== 1 || result.rows[0].ready !== true) process.exit(1);
    process.stdout.write('H14_CLAIM_BOUND_MIGRATION_READY');
  } catch {
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
JS
)" || return 1
  [[ "$result" == 'H14_CLAIM_BOUND_MIGRATION_READY' ]]
}

publish_exact_record() {
  local path="$1" mode="$2"
  env -i PATH="$SAFE_PATH" python3 -I /dev/fd/3 "$path" "$mode" 3<<'PY'
import os
import stat
import sys

path, mode_text = sys.argv[1:]
mode = int(mode_text, 8)
expected = sys.stdin.buffer.read()
root = os.path.dirname(path)
name = os.path.basename(path)
temporary = f'{root}/.{name}.installing'

def reject():
    raise RuntimeError()

def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def exact_file(target, prefix=False):
    descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        value = os.fstat(descriptor)
        named = os.lstat(target)
        data = os.pread(descriptor, len(expected) + 1, 0)
        if (
            not stat.S_ISREG(value.st_mode)
            or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)
            or (value.st_uid, value.st_gid, stat.S_IMODE(value.st_mode), value.st_nlink) != (0, 0, mode, 1)
            or len(data) != value.st_size
            or value.st_size > len(expected)
            or (not expected.startswith(data) if prefix else data != expected)
            or os.path.realpath(target) != target
        ):
            reject()
        return data
    finally:
        os.close(descriptor)

try:
    root_value = os.lstat(root)
    if not stat.S_ISDIR(root_value.st_mode) or (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode)) != (0, 0, 0o700) or os.path.realpath(root) != root:
        reject()
    if os.path.lexists(path):
        if os.path.lexists(temporary):
            reject()
        exact_file(path)
        raise SystemExit(0)
    if os.path.lexists(temporary):
        prefix = exact_file(temporary, True)
        descriptor = os.open(temporary, os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    else:
        prefix = b''
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
        os.fchown(descriptor, 0, 0)
        os.fchmod(descriptor, mode)
    try:
        os.lseek(descriptor, len(prefix), os.SEEK_SET)
        remainder = expected[len(prefix):]
        offset = 0
        while offset < len(remainder):
            written = os.write(descriptor, remainder[offset:])
            if written <= 0:
                reject()
            offset += written
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    exact_file(temporary)
    os.rename(temporary, path)
    sync_directory(root)
    exact_file(path)
except Exception:
    raise SystemExit(1)
PY
}

create_or_discover_bridge_ledger() {
  local children root entries
  if [[ ! -e "$BRIDGE_PARENT" && ! -L "$BRIDGE_PARENT" ]]; then
    mkdir --mode=0700 -- "$BRIDGE_PARENT" || return 1
    chown root:root "$BRIDGE_PARENT" || return 1
    chmod 0700 "$BRIDGE_PARENT" || return 1
    sync -f "$(dirname "$BRIDGE_PARENT")" || return 1
  fi
  [[ ! -L "$BRIDGE_PARENT" && -d "$BRIDGE_PARENT" && "$(realpath -- "$BRIDGE_PARENT")" == "$BRIDGE_PARENT" &&
    "$(stat --format='%U:%G:%a' "$BRIDGE_PARENT")" == 'root:root:700' ]] || return 1
  children="$(find -P "$BRIDGE_PARENT" -mindepth 1 -maxdepth 1 -printf '%f\n')" || return 1
  case "$children" in
    '')
      mkdir --mode=0700 -- "$BRIDGE_INSTALLING" || return 1
      chown root:root "$BRIDGE_INSTALLING" || return 1
      chmod 0700 "$BRIDGE_INSTALLING" || return 1
      sync -f "$BRIDGE_PARENT" || return 1
      BRIDGE_STATE='installing'
      BRIDGE_WORK_ROOT="$BRIDGE_INSTALLING"
      ;;
    ".installing-$REPAIR_RELEASE")
      BRIDGE_STATE='installing'
      BRIDGE_WORK_ROOT="$BRIDGE_INSTALLING"
      ;;
    "$REPAIR_RELEASE")
      BRIDGE_STATE='complete'
      BRIDGE_WORK_ROOT="$BRIDGE_ROOT"
      ;;
    *) return 1 ;;
  esac
  [[ ! -L "$BRIDGE_WORK_ROOT" && -d "$BRIDGE_WORK_ROOT" && "$(realpath -- "$BRIDGE_WORK_ROOT")" == "$BRIDGE_WORK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$BRIDGE_WORK_ROOT")" == 'root:root:700' ]] || return 1
  entries="$(find -P "$BRIDGE_WORK_ROOT" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)" || return 1
  if [[ "$BRIDGE_STATE" == 'complete' ]]; then
    [[ "$entries" == $'completed-v1\nintent-v1\nreplacement-owner-v1\nstart-owner-v1' ]] || return 1
  else
    case "$entries" in
      ''|'.intent-v1.installing'|'intent-v1'|$'.replacement-owner-v1.installing\nintent-v1'|\
      $'intent-v1\nreplacement-owner-v1'|$'.start-owner-v1.installing\nintent-v1\nreplacement-owner-v1'|\
      $'intent-v1\nreplacement-owner-v1\nstart-owner-v1'|\
      $'.completed-v1.installing\nintent-v1\nreplacement-owner-v1\nstart-owner-v1'|\
      $'completed-v1\nintent-v1\nreplacement-owner-v1\nstart-owner-v1') ;;
      *) return 1 ;;
    esac
  fi
}

expected_bridge_intent() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge' \
    'state=authorized' \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_release=$CANONICAL_H14" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "bundle_manifest_sha256=$PROVIDED_MANIFEST_SHA256" \
    "owner_image_tag=$OWNER_IMAGE" \
    "owner_image_id=$OWNER_IMAGE_ID" \
    "owner_image_tar_sha256=$OWNER_IMAGE_TAR_SHA256" \
    "canonical_compose_sha256=$CANONICAL_COMPOSE_SHA256" \
    "owner_runtime_bridge_script_sha256=$OWNER_BRIDGE_SCRIPT_SHA256" \
    "h14_namespace_device=$H14_NAMESPACE_DEVICE" \
    "h14_namespace_inode=$H14_NAMESPACE_INODE" \
    "h14_evidence_tree_sha256=$H14_EVIDENCE_TREE_SHA256" \
    "mount_repair_intent_sha256=$MOUNT_REPAIR_INTENT_SHA256" \
    "mount_repair_completion_sha256=$MOUNT_REPAIR_COMPLETION_SHA256" \
    "old_owner_container_id=$OLD_OWNER_CONTAINER_ID" \
    "old_owner_semantic_contract_sha256=$OLD_OWNER_SEMANTIC_SHA256" \
    "retired_coordinator_container_id=$RETIRED_COORDINATOR_CONTAINER_ID" \
    "non_owner_project_container_count=$NON_OWNER_INVENTORY_COUNT" \
    "non_owner_project_inventory_sha256=$NON_OWNER_INVENTORY_SHA256" \
    'migration_attestation=claim-bound-h14-read-only-ready' \
    "installed_helper_sha256=$H14_HELPER_SHA256" \
    "owner_network=$OWNER_NETWORK" \
    'old_owner_state=running-healthy-at-publication' \
    'coordinator_absent=true' \
    'profile_volume_holders=none' \
    "control_volume_holder=$OLD_OWNER_CONTAINER_ID" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'provider_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'money_moved=false'
}

require_bridge_intent() {
  local path="$BRIDGE_WORK_ROOT/intent-v1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$path" <(expected_bridge_intent)
}

expected_replacement_record() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge' \
    'state=replacement-created' \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_release=$CANONICAL_H14" \
    "old_owner_container_id=$OLD_OWNER_CONTAINER_ID" \
    "new_owner_container_id=$NEW_OWNER_CONTAINER_ID" \
    "owner_image_id=$OWNER_IMAGE_ID" \
    "owner_image_tag=$OWNER_IMAGE" \
    "canonical_compose_sha256=$CANONICAL_COMPOSE_SHA256" \
    "bridge_intent_sha256=$BRIDGE_INTENT_SHA256" \
    'new_owner_state=created-never-started-at-publication' \
    "non_owner_project_container_count=$NON_OWNER_INVENTORY_COUNT" \
    "non_owner_project_inventory_sha256=$NON_OWNER_INVENTORY_SHA256" \
    'provider_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'money_moved=false'
}

load_replacement_record() {
  local path="$BRIDGE_WORK_ROOT/replacement-owner-v1" line
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  line="$(sed -n '7p' "$path")" || return 1
  [[ "$line" =~ ^new_owner_container_id=[0-9a-f]{64}$ ]] || return 1
  NEW_OWNER_CONTAINER_ID="${line#new_owner_container_id=}"
  cmp -s -- "$path" <(expected_replacement_record)
}

expected_start_record() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge' \
    'state=start-authorized' \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_release=$CANONICAL_H14" \
    "old_owner_container_id=$OLD_OWNER_CONTAINER_ID" \
    "new_owner_container_id=$NEW_OWNER_CONTAINER_ID" \
    "owner_image_id=$OWNER_IMAGE_ID" \
    "replacement_owner_record_sha256=$REPLACEMENT_RECORD_SHA256" \
    'new_owner_state=created-at-publication' \
    'restart_after_exit_authorized=false' \
    "non_owner_project_container_count=$NON_OWNER_INVENTORY_COUNT" \
    "non_owner_project_inventory_sha256=$NON_OWNER_INVENTORY_SHA256" \
    'provider_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'money_moved=false'
}

require_start_record() {
  local path="$BRIDGE_WORK_ROOT/start-owner-v1"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$path" <(expected_start_record)
}

expected_bridge_completed() {
  printf '%s\n' \
    'version=1' \
    'contract=fetanagent-kemerbet-quarantine-recovery-v14-owner-runtime-bridge' \
    'state=completed' \
    "repair_implementation_release=$REPAIR_RELEASE" \
    "canonical_h14_release=$CANONICAL_H14" \
    "authorization_sha256=$AUTHORIZATION_SHA256" \
    "old_owner_container_id=$OLD_OWNER_CONTAINER_ID" \
    'old_owner_absent=true' \
    "new_owner_container_id=$NEW_OWNER_CONTAINER_ID" \
    "owner_image_id=$OWNER_IMAGE_ID" \
    'new_owner_running=true' \
    'new_owner_healthy=true' \
    'coordinator_absent=true' \
    'profile_volume_holders=none' \
    "control_volume_holder=$NEW_OWNER_CONTAINER_ID" \
    "h14_namespace_device=$H14_NAMESPACE_DEVICE" \
    "h14_namespace_inode=$H14_NAMESPACE_INODE" \
    "h14_evidence_tree_sha256=$H14_EVIDENCE_TREE_SHA256" \
    "installed_helper_sha256=$H14_HELPER_SHA256" \
    'migration_attestation=claim-bound-h14-read-only-ready' \
    "non_owner_project_container_count=$NON_OWNER_INVENTORY_COUNT" \
    "non_owner_project_inventory_sha256=$NON_OWNER_INVENTORY_SHA256" \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'provider_action_enabled=false' \
    'transfer_enabled=false' \
    'amount_entry_enabled=false' \
    'money_moved=false' \
    "bridge_intent_sha256=$BRIDGE_INTENT_SHA256" \
    "replacement_owner_record_sha256=$REPLACEMENT_RECORD_SHA256" \
    "start_owner_record_sha256=$START_RECORD_SHA256" \
    'canonical_h14_evidence_rewritten=false' \
    'canonical_h14_helper_changed=false'
}

prepare_record_digests() {
  BRIDGE_INTENT_SHA256="$(sha256sum -- "$BRIDGE_WORK_ROOT/intent-v1" | awk '{print $1}')" || return 1
  [[ "$BRIDGE_INTENT_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  if [[ -e "$BRIDGE_WORK_ROOT/replacement-owner-v1" && ! -L "$BRIDGE_WORK_ROOT/replacement-owner-v1" ]]; then
    REPLACEMENT_RECORD_SHA256="$(sha256sum -- "$BRIDGE_WORK_ROOT/replacement-owner-v1" | awk '{print $1}')" || return 1
    [[ "$REPLACEMENT_RECORD_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  fi
  if [[ -e "$BRIDGE_WORK_ROOT/start-owner-v1" && ! -L "$BRIDGE_WORK_ROOT/start-owner-v1" ]]; then
    START_RECORD_SHA256="$(sha256sum -- "$BRIDGE_WORK_ROOT/start-owner-v1" | awk '{print $1}')" || return 1
    [[ "$START_RECORD_SHA256" =~ ^[0-9a-f]{64}$ ]] || return 1
  fi
}

require_bridge_completed() {
  local path="$BRIDGE_WORK_ROOT/completed-v1"
  prepare_record_digests || return 1
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$path" <(expected_bridge_completed)
}

acquire_staging_mutation_lock() {
  local lock_status
  coproc H14_BRIDGE_LOCK_HOLDER {
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
root_descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    if created_root:
        os.fchown(root_descriptor, 0, 0)
        os.fchmod(root_descriptor, 0o700)
        os.fsync(root_descriptor)
        parent_descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)
    root_value = os.fstat(root_descriptor)
    root_named = os.lstat(root)
    if (
        not stat.S_ISDIR(root_value.st_mode)
        or (root_value.st_dev, root_value.st_ino) != (root_named.st_dev, root_named.st_ino)
        or (root_value.st_uid, root_value.st_gid, stat.S_IMODE(root_value.st_mode)) != (0, 0, 0o700)
        or os.path.realpath(root) != root
    ):
        raise SystemExit(1)
    flags = os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC
    created_lock = False
    try:
        lock_descriptor = os.open('mutation.lock', flags, dir_fd=root_descriptor)
    except FileNotFoundError:
        try:
            lock_descriptor = os.open(
                'mutation.lock', flags | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=root_descriptor,
            )
            created_lock = True
        except FileExistsError:
            raise SystemExit(1)
    try:
        if created_lock:
            os.fchown(lock_descriptor, 0, 0)
            os.fchmod(lock_descriptor, 0o600)
            os.fsync(lock_descriptor)
            os.fsync(root_descriptor)
        before = os.fstat(lock_descriptor)
        named = os.stat('mutation.lock', dir_fd=root_descriptor, follow_symlinks=False)
        if (
            not stat.S_ISREG(before.st_mode)
            or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)
            or (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode), before.st_nlink) != (0, 0, 0o600, 1)
            or before.st_size != 0
            or os.path.realpath(path) != path
        ):
            raise SystemExit(1)
        try:
            fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(73)
        after = os.fstat(lock_descriptor)
        named_after = os.stat('mutation.lock', dir_fd=root_descriptor, follow_symlinks=False)
        if (
            (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid,
             after.st_nlink, after.st_size, after.st_mtime_ns)
            != (before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid,
                before.st_nlink, before.st_size, before.st_mtime_ns)
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
  LOCK_HOLDER_PROCESS_ID="$H14_BRIDGE_LOCK_HOLDER_PID"
  LOCK_STATUS_FD="${H14_BRIDGE_LOCK_HOLDER[0]}"
  LOCK_CONTROL_FD="${H14_BRIDGE_LOCK_HOLDER[1]}"
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
require_active_grant_only || die 'the exact H14 helper grant is not active'
require_helper_exact || die 'the installed canonical H14 helper is not exact'
require_h14_helper_host_retired || die 'the canonical H14 recovery is not in its exact host-retired state'

mapfile -t h14_values < <(load_exact_h14_and_mount_repair) || die 'the final canonical H14 or completed mount-repair ledger is invalid'
[[ "${#h14_values[@]}" -eq 8 ]] || die 'the H14 evidence attestation returned an invalid shape'
OLD_OWNER_CONTAINER_ID="${h14_values[0]}"
RETIRED_COORDINATOR_CONTAINER_ID="${h14_values[1]}"
OLD_OWNER_SEMANTIC_SHA256="${h14_values[2]}"
H14_NAMESPACE_DEVICE="${h14_values[3]}"
H14_NAMESPACE_INODE="${h14_values[4]}"
H14_EVIDENCE_TREE_SHA256="${h14_values[5]}"
MOUNT_REPAIR_INTENT_SHA256="${h14_values[6]}"
MOUNT_REPAIR_COMPLETION_SHA256="${h14_values[7]}"
[[ "$OLD_OWNER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ && "$RETIRED_COORDINATOR_CONTAINER_ID" =~ ^[0-9a-f]{64}$ &&
  "$OLD_OWNER_SEMANTIC_SHA256" =~ ^[0-9a-f]{64}$ && "$H14_NAMESPACE_DEVICE" =~ ^[0-9]+$ &&
  "$H14_NAMESPACE_INODE" =~ ^[0-9]+$ && "$H14_EVIDENCE_TREE_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the H14 evidence values are malformed'

mapfile -t bundle_values < <(claim_and_load_bundle_manifest) || die 'the staged canonical Owner-only bundle could not be claimed exactly'
[[ "${#bundle_values[@]}" -eq 6 ]] || die 'the claimed bundle manifest returned an invalid shape'
OWNER_IMAGE_TAG="${bundle_values[0]}"
OWNER_IMAGE_ID="${bundle_values[1]}"
OWNER_IMAGE_TAR_SHA256="${bundle_values[2]}"
OWNER_IMAGE_TAR_SIZE="${bundle_values[3]}"
CANONICAL_COMPOSE_SHA256="${bundle_values[4]}"
OWNER_BRIDGE_SCRIPT_SHA256="${bundle_values[5]}"
[[ "$OWNER_IMAGE_TAG" == "$OWNER_IMAGE" && "$OWNER_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ &&
  "$OWNER_IMAGE_TAR_SHA256" =~ ^[0-9a-f]{64}$ && "$OWNER_IMAGE_TAR_SIZE" =~ ^[1-9][0-9]{0,11}$ &&
  "$CANONICAL_COMPOSE_SHA256" =~ ^[0-9a-f]{64}$ && "$OWNER_BRIDGE_SCRIPT_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the claimed bundle values are invalid'
[[ "$(sha256sum -- "$CLAIM_ROOT/$IMAGE_ARCHIVE_NAME" | awk '{print $1}')" == "$OWNER_IMAGE_TAR_SHA256" &&
  "$(stat --format='%s' "$CLAIM_ROOT/$IMAGE_ARCHIVE_NAME")" == "$OWNER_IMAGE_TAR_SIZE" &&
  "$(sha256sum -- "$CLAIM_ROOT/$COMPOSE_NAME" | awk '{print $1}')" == "$CANONICAL_COMPOSE_SHA256" &&
  "$(sha256sum -- "$STAGED_INSTALLER" | awk '{print $1}')" == "$OWNER_BRIDGE_SCRIPT_SHA256" ]] ||
  die 'a claimed bundle artifact changed'
inspect_image_archive || die 'the canonical Owner archive contains anything other than the one reviewed image'
require_all_compose_inputs || die 'the exact existing staging Compose input files are unavailable or unsafe'
require_compose_contract_parses || die 'the canonical H14 Compose contract did not parse with the existing staging inputs'
require_owner_network || die 'the existing Owner-only network is not exact'
require_financial_gates_disabled || die 'a financial, executor, final-action, Amount, or Transfer gate is enabled'
require_no_host_chromium || die 'a host browser process exists before the Owner bridge'

NON_OWNER_INVENTORY="$(capture_non_owner_inventory)" ||
  die 'the unrelated project-service inventory is ambiguous or contains the retired coordinator'
if [[ -n "$NON_OWNER_INVENTORY" ]]; then
  NON_OWNER_INVENTORY_COUNT="$(awk 'END { print NR }' <<<"$NON_OWNER_INVENTORY")" ||
    die 'the unrelated project-service count could not be computed'
else
  NON_OWNER_INVENTORY_COUNT='0'
fi
NON_OWNER_INVENTORY_SHA256="$(printf '%s' "$NON_OWNER_INVENTORY" | sha256sum | awk '{print $1}')" ||
  die 'the unrelated project-service inventory digest could not be computed'
[[ "$NON_OWNER_INVENTORY_COUNT" =~ ^[0-9]+$ && "$NON_OWNER_INVENTORY_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the unrelated project-service inventory attestation is malformed'

create_or_discover_bridge_ledger || die 'the separate Owner-runtime bridge ledger is unsafe'
if [[ -e "$BRIDGE_WORK_ROOT/intent-v1" && ! -L "$BRIDGE_WORK_ROOT/intent-v1" ]]; then
  require_bridge_intent || die 'the durable Owner-runtime bridge intent changed'
else
  [[ "$BRIDGE_STATE" == 'installing' ]] || die 'a complete bridge is missing its intent'
  require_non_owner_inventory_unchanged || die 'an unrelated project service changed before durable intent'
  require_owner_contract "$OLD_OWNER_CONTAINER_ID" "$PREDECESSOR_RELEASE" '-' || die 'the historical H13 Owner contract is not exact'
  [[ "$(docker_local container inspect "$OLD_OWNER_CONTAINER_ID" --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == 'running|healthy' ]] ||
    die 'the exact historical H13 Owner is not running and healthy before durable intent'
  [[ "$(container_semantic_contract_digest "$OLD_OWNER_CONTAINER_ID")" == "$OLD_OWNER_SEMANTIC_SHA256" ]] ||
    die 'the exact historical H13 Owner semantic contract changed'
  [[ -z "$(container_full_ids_for_service kemerbet-session-provision)" ]] || die 'the retired coordinator exists'
  [[ -z "$(docker_local container ls --all --quiet --filter "id=$RETIRED_COORDINATOR_CONTAINER_ID")" ]] || die 'the retired coordinator identity still exists'
  require_runtime_boundary "$OLD_OWNER_CONTAINER_ID" || die 'the pre-bridge Owner/coordinator/volume/gate boundary is not exact'
  require_container_no_chromium "$OLD_OWNER_CONTAINER_ID" || die 'the historical Owner contains a browser process'
  require_migration_through_old_owner "$OLD_OWNER_CONTAINER_ID" ||
    die 'the exact existing Owner could not prove the claim-bound H14 migration read-only'
  publish_exact_record "$BRIDGE_WORK_ROOT/intent-v1" 0600 < <(expected_bridge_intent) ||
    die 'the Owner-runtime bridge intent could not be published durably'
  require_bridge_intent || die 'the published Owner-runtime bridge intent is invalid'
fi
prepare_record_digests || die 'the bridge intent digest is invalid'

if [[ "$BRIDGE_STATE" == 'complete' ]]; then
  load_replacement_record || die 'the completed bridge replacement record is invalid'
  prepare_record_digests || die 'the completed replacement digest is invalid'
  require_start_record || die 'the completed bridge start-intent record is invalid'
  prepare_record_digests || die 'the completed start-intent digest is invalid'
  require_bridge_completed || die 'the completed bridge ledger is invalid'
  if docker_local container inspect "$OLD_OWNER_CONTAINER_ID" >/dev/null 2>&1; then
    die 'the historical Owner reappeared beside completed bridge evidence'
  fi
  require_owner_image_contract || die 'the canonical Owner image changed after bridge completion'
  require_non_owner_inventory_unchanged || die 'an unrelated project service changed after bridge completion'
  require_owner_contract "$NEW_OWNER_CONTAINER_ID" "$CANONICAL_H14" "$OWNER_IMAGE_ID" || die 'the completed canonical Owner contract changed'
  [[ "$(docker_local container inspect "$NEW_OWNER_CONTAINER_ID" --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == 'running|healthy' ]] ||
    die 'the completed canonical Owner is not running and healthy'
  require_container_no_chromium "$NEW_OWNER_CONTAINER_ID" || die 'the completed Owner contains a browser process'
  require_runtime_boundary "$NEW_OWNER_CONTAINER_ID" || die 'the completed Owner/coordinator/volume/gate boundary changed'
  require_owner_network || die 'the completed Owner network contract changed'
  require_h14_helper_host_retired || die 'the canonical H14 host-retired state changed after bridge completion'
  mapfile -t final_h14_values < <(load_exact_h14_and_mount_repair) || die 'the canonical H14 evidence changed after bridge completion'
  [[ "${final_h14_values[3]}" == "$H14_NAMESPACE_DEVICE" && "${final_h14_values[4]}" == "$H14_NAMESPACE_INODE" &&
    "${final_h14_values[5]}" == "$H14_EVIDENCE_TREE_SHA256" ]] || die 'the canonical H14 evidence inode or digest changed'
  printf '%s\n' 'FetanAgent H14 Owner runtime bridge already valid: Owner only; no provider action and no money moved.'
  exit 0
fi

# Intent is durable before the first Docker mutation. Load exactly the one
# canonical Owner image, or accept the already-loaded byte-identical image on
# an interruption resume. Never overwrite a different tag.
if docker_local image inspect "$OWNER_IMAGE" >/dev/null 2>&1; then
  require_owner_image_contract || die 'the canonical Owner tag already names a different image'
else
  docker_local image load --input "$CLAIM_ROOT/$IMAGE_ARCHIVE_NAME" >/dev/null ||
    die 'the one canonical Owner image could not be loaded'
  require_owner_image_contract || die 'the loaded canonical Owner image contract is invalid'
fi
require_non_owner_inventory_unchanged || die 'an unrelated project service changed during the canonical image load'

owner_inventory="$(container_full_ids_for_service "$OWNER_SERVICE")" || die 'the Owner inventory could not be inspected'
if docker_local container inspect "$OLD_OWNER_CONTAINER_ID" >/dev/null 2>&1; then
  [[ "$owner_inventory" == "$OLD_OWNER_CONTAINER_ID" ]] || die 'another Owner exists beside the historical Owner'
  require_owner_contract "$OLD_OWNER_CONTAINER_ID" "$PREDECESSOR_RELEASE" '-' || die 'the historical Owner changed after durable intent'
  [[ "$(container_semantic_contract_digest "$OLD_OWNER_CONTAINER_ID")" == "$OLD_OWNER_SEMANTIC_SHA256" ]] || die 'the historical Owner semantic contract changed after durable intent'
  old_state="$(docker_local container inspect "$OLD_OWNER_CONTAINER_ID" --format '{{.State.Status}}')" || die 'the historical Owner state is unavailable'
  case "$old_state" in
    running)
      require_non_owner_inventory_unchanged || die 'an unrelated project service changed before the historical Owner stop'
      docker_local container stop --time 15 "$OLD_OWNER_CONTAINER_ID" >/dev/null || die 'the exact historical Owner could not be stopped'
      require_non_owner_inventory_unchanged || die 'an unrelated project service changed during the historical Owner stop'
      ;;
    exited) ;;
    *) die 'the historical Owner is in an unreviewed state' ;;
  esac
  [[ "$(docker_local container inspect "$OLD_OWNER_CONTAINER_ID" --format '{{.State.Running}}')" == 'false' ]] || die 'the historical Owner did not stop'
  require_non_owner_inventory_unchanged || die 'an unrelated project service changed before historical Owner removal'
  docker_local container rm "$OLD_OWNER_CONTAINER_ID" >/dev/null || die 'the exact stopped historical Owner could not be removed'
  require_non_owner_inventory_unchanged || die 'an unrelated project service changed during historical Owner removal'
fi
if docker_local container inspect "$OLD_OWNER_CONTAINER_ID" >/dev/null 2>&1; then
  die 'the historical Owner remains after exact removal'
fi
[[ -z "$(container_full_ids_for_service kemerbet-session-provision)" ]] || die 'the retired coordinator reappeared'
[[ -z "$(container_full_ids_for_volume "$PROFILE_VOLUME")" ]] || die 'the profile volume acquired a holder'
[[ -z "$(container_full_ids_for_volume "$CONTROL_VOLUME")" ]] || die 'the control volume did not become holder-free'
[[ "$(ss -ltnH | awk '$4 ~ /:3002$/ {count += 1} END {print count + 0}')" == '0' ]] ||
  die 'TCP port 3002 remains occupied after the exact Owner stop'

if [[ -e "$BRIDGE_WORK_ROOT/replacement-owner-v1" && ! -L "$BRIDGE_WORK_ROOT/replacement-owner-v1" ]]; then
  load_replacement_record || die 'the replacement Owner record is invalid'
else
  owner_inventory="$(container_full_ids_for_service "$OWNER_SERVICE")" || die 'the replacement Owner inventory could not be inspected'
  if [[ -z "$owner_inventory" ]]; then
    require_non_owner_inventory_unchanged || die 'an unrelated project service changed before replacement creation'
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      create --no-build --no-deps "$OWNER_SERVICE" >/dev/null || die 'canonical Compose could not create the Owner-only replacement'
    require_non_owner_inventory_unchanged || die 'an unrelated project service changed during replacement creation'
    owner_inventory="$(container_full_ids_for_service "$OWNER_SERVICE")" || die 'the created Owner inventory could not be inspected'
  fi
  [[ "$owner_inventory" =~ ^[0-9a-f]{64}$ && "$owner_inventory" != "$OLD_OWNER_CONTAINER_ID" ]] ||
    die 'interruption recovery accepts only one exact replacement Owner'
  NEW_OWNER_CONTAINER_ID="$owner_inventory"
  [[ "$(docker_local container inspect "$NEW_OWNER_CONTAINER_ID" --format '{{.State.Status}}')" == 'created' ]] ||
    die 'an unrecorded replacement Owner must be in its exact never-started created state'
  require_owner_contract "$NEW_OWNER_CONTAINER_ID" "$CANONICAL_H14" "$OWNER_IMAGE_ID" ||
    die 'the one stopped replacement Owner is not the exact canonical contract'
  require_non_owner_inventory_unchanged || die 'an unrelated project service changed during replacement creation'
  publish_exact_record "$BRIDGE_WORK_ROOT/replacement-owner-v1" 0600 < <(expected_replacement_record) ||
    die 'the exact replacement Owner identity could not be published durably'
  load_replacement_record || die 'the published replacement Owner record is invalid'
fi
prepare_record_digests || die 'the replacement Owner digest is invalid'

require_owner_contract "$NEW_OWNER_CONTAINER_ID" "$CANONICAL_H14" "$OWNER_IMAGE_ID" || die 'the recorded replacement Owner contract changed'
require_exact_owner_inventory "$NEW_OWNER_CONTAINER_ID" || die 'the replacement Owner inventory is not exactly one recorded container'
if [[ -e "$BRIDGE_WORK_ROOT/start-owner-v1" && ! -L "$BRIDGE_WORK_ROOT/start-owner-v1" ]]; then
  require_start_record || die 'the durable replacement start intent changed'
else
  [[ "$(docker_local container inspect "$NEW_OWNER_CONTAINER_ID" --format '{{.State.Status}}')" == 'created' ]] ||
    die 'a replacement without durable start intent must remain in its never-started created state'
  require_non_owner_inventory_unchanged || die 'an unrelated project service changed before durable replacement start intent'
  publish_exact_record "$BRIDGE_WORK_ROOT/start-owner-v1" 0600 < <(expected_start_record) ||
    die 'the replacement start intent could not be published durably'
  require_start_record || die 'the published replacement start intent is invalid'
fi
prepare_record_digests || die 'the replacement start-intent digest is invalid'
new_state="$(docker_local container inspect "$NEW_OWNER_CONTAINER_ID" --format '{{.State.Status}}')" || die 'the replacement Owner state is unavailable'
case "$new_state" in
  created)
    require_non_owner_inventory_unchanged || die 'an unrelated project service changed before replacement startup'
    docker_local container start "$NEW_OWNER_CONTAINER_ID" >/dev/null || die 'the exact canonical Owner could not be started'
    require_non_owner_inventory_unchanged || die 'an unrelated project service changed during replacement startup'
    ;;
  running)
    [[ "$(docker_local container inspect "$NEW_OWNER_CONTAINER_ID" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == 'healthy' ]] ||
      die 'an interrupted replacement startup may be resumed only after the exact Owner is already healthy'
    ;;
  exited) die 'the replacement Owner exited after its durable start intent; manual review is required' ;;
  *) die 'the recorded replacement Owner is in an unreviewed state' ;;
esac

owner_health=''
for attempt in $(seq 1 30); do
  owner_state="$(docker_local container inspect "$NEW_OWNER_CONTAINER_ID" --format '{{.State.Status}}')" || die 'the canonical Owner disappeared during health wait'
  owner_health="$(docker_local container inspect "$NEW_OWNER_CONTAINER_ID" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}')" || die 'the canonical Owner health is unavailable'
  if [[ "$owner_state" == 'running' && "$owner_health" == 'healthy' ]]; then
    break
  fi
  [[ "$owner_state" == 'running' ]] || die 'the canonical Owner exited before becoming healthy'
  sleep 3
done
[[ "$owner_state" == 'running' && "$owner_health" == 'healthy' ]] || die 'the canonical Owner did not become healthy within the bounded wait'
env -i PATH="$SAFE_PATH" curl --fail --silent --show-error --noproxy '*' --max-time 5 \
  http://127.0.0.1:3002/readyz >/dev/null || die 'the loopback-only Owner readiness endpoint failed'
require_owner_image_contract || die 'the canonical Owner image changed during startup'
require_owner_contract "$NEW_OWNER_CONTAINER_ID" "$CANONICAL_H14" "$OWNER_IMAGE_ID" || die 'the running canonical Owner contract is not exact'
require_container_no_chromium "$NEW_OWNER_CONTAINER_ID" || die 'the canonical Owner contains a browser process'
require_runtime_boundary "$NEW_OWNER_CONTAINER_ID" || die 'the final Owner/coordinator/volume/gate boundary is not exact'
require_owner_network || die 'the final Owner network contract is not exact'
require_active_grant_only || die 'the canonical H14 helper grant changed during the Owner bridge'
require_helper_exact || die 'the canonical H14 helper changed during the Owner bridge'
require_h14_helper_host_retired || die 'the canonical H14 host-retired evidence changed during the Owner bridge'
mapfile -t final_h14_values < <(load_exact_h14_and_mount_repair) || die 'the canonical H14 evidence changed during the Owner bridge'
[[ "${final_h14_values[3]}" == "$H14_NAMESPACE_DEVICE" && "${final_h14_values[4]}" == "$H14_NAMESPACE_INODE" &&
  "${final_h14_values[5]}" == "$H14_EVIDENCE_TREE_SHA256" ]] || die 'the canonical H14 evidence inode or digest changed during the Owner bridge'
require_no_other_mutator_processes || die 'another staging mutation appeared before bridge completion'
require_exact_droplet || die 'the staging Droplet identity changed before bridge completion'

publish_exact_record "$BRIDGE_WORK_ROOT/completed-v1" 0600 < <(expected_bridge_completed) ||
  die 'the Owner-runtime bridge completion could not be published durably'
require_bridge_completed || die 'the published Owner-runtime bridge completion is invalid'
[[ ! -e "$BRIDGE_ROOT" && ! -L "$BRIDGE_ROOT" ]] || die 'the final bridge namespace already exists unexpectedly'
mv -- "$BRIDGE_INSTALLING" "$BRIDGE_ROOT" || die 'the bridge ledger could not be finalized'
sync -f "$BRIDGE_PARENT" || die 'the bridge ledger rename could not be synchronized'
BRIDGE_STATE='complete'
BRIDGE_WORK_ROOT="$BRIDGE_ROOT"
require_start_record || die 'the finalized Owner-runtime bridge start intent is invalid'
require_bridge_completed || die 'the finalized Owner-runtime bridge ledger is invalid'

printf '%s\n' 'FetanAgent H14 Owner runtime bridge installed: Owner only; no provider action and no money moved.'
