#!/usr/bin/env bash
# One-use, root-console-only promotion from the exact H16 helper to the H17
# continuous-availability component guard. It appends provenance and changes only
# the reviewed root helper. Containers, database roles, KemerBet evidence, and
# every financial/provider control remain unchanged.
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly TARGET='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly FINALIZER='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly CURRENT_RUNTIME_RELEASE='70d46b9642c7d1fd781fd7200289b7a2fff068ec'
readonly CANONICAL_H14_RELEASE='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly PREDECESSOR_HELPER_SHA256='da555f29ac6260e1dff6c969218eb55ea9bd66c8167600e3ecc700118c8ea9e6'
readonly REVIEWED_SUCCESSOR_HELPER_SHA256='77e4822a0827413290fba94747698536b6af5bca3f2f7cdc58975dce390f7c84'
readonly INSTALLED_FINALIZER_SHA256='a52a4db7a46849c75f94d734d005d34360e555ebbe46274b59d5c5d9f8a5917f'
readonly CONFIRMATION='I-UNDERSTAND-THIS-INSTALLS-ONE-H17-CONTINUOUS-AVAILABILITY-HELPER-WITH-NO-MONEY'
readonly EXPECTED_DROPLET_ID='593344964'
readonly EXPECTED_PUBLIC_IPV4='161.35.41.232'
readonly METADATA='http://169.254.169.254/metadata/v1'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly SUDOERS_DISABLED='/etc/sudoers.d/.fetanagent-staging-deploy-helper.kemerbet-continuous-availability-helper-bridge-v17-disabled'
readonly H16_PARENT='/var/lib/fetanagent/kemerbet-security-recovery-preview-bridge-v16'
readonly H17_PARENT='/var/lib/fetanagent/kemerbet-continuous-availability-helper-bridge-v17'
readonly TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly TIMER_PATH="/etc/systemd/system/$TIMER"
readonly SERVICE_PATH="/etc/systemd/system/$SERVICE"
readonly INSTALLING_HELPER='/usr/local/sbin/.fetanagent-staging-deploy-helper.kemerbet-continuous-availability-helper-bridge-v17-installing'
readonly SCRIPT_BASENAME='fetanagent-kemerbet-continuous-availability-helper-bridge-v17.sh'

export PATH="$SAFE_PATH"
umask 077

die() {
  printf 'FetanAgent H17 continuous-availability helper bridge failed closed: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 3 ]] || die 'expected the bridge release, reviewed helper digest, and exact confirmation'
readonly BRIDGE_RELEASE="$1"
readonly SUCCESSOR_HELPER_SHA256="$2"
readonly PROVIDED_CONFIRMATION="$3"
readonly STAGING_ROOT="/root/fetanagent-kemerbet-continuous-availability-helper-bridge-v17-$BRIDGE_RELEASE"
readonly STAGED_INSTALLER="$STAGING_ROOT/$SCRIPT_BASENAME"
readonly STAGED_HELPER="$STAGING_ROOT/fetanagent-staging-deploy-helper.next"
readonly H17_ROOT="$H17_PARENT/$BRIDGE_RELEASE"
readonly H17_INSTALLING="$H17_PARENT/.installing-$BRIDGE_RELEASE"

[[ "$REVIEWED_SUCCESSOR_HELPER_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  die 'the reviewed H17 successor helper digest placeholder has not been finalized'
[[ "$BRIDGE_RELEASE" =~ ^[0-9a-f]{40}$ &&
  "$BRIDGE_RELEASE" != "$CURRENT_RUNTIME_RELEASE" &&
  "$BRIDGE_RELEASE" != "$CANONICAL_H14_RELEASE" ]] ||
  die 'the H17 bridge release must be a distinct full lowercase Git commit SHA'
[[ "$SUCCESSOR_HELPER_SHA256" == "$REVIEWED_SUCCESSOR_HELPER_SHA256" &&
  "$SUCCESSOR_HELPER_SHA256" != "$PREDECESSOR_HELPER_SHA256" ]] ||
  die 'the successor helper digest is not the distinct hard-pinned reviewed H17 artifact'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] ||
  die 'the exact one-use no-money H17 confirmation is required'
[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] ||
  die 'run this installer only in the DigitalOcean root console'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'

for command in awk bash chmod chown cmp curl date dirname docker env find flock id install jq mkdir mv \
  python3 realpath sha256sum sort stat sync systemctl visudo; do
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
  sync -f /etc/sudoers.d || return 1
  require_active_grant_only
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
      "$EXPECTED_DROPLET_ID" &&
    "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
      "$METADATA/interfaces/public/0/ipv4/address")" == "$EXPECTED_PUBLIC_IPV4" ]]
}

require_exact_finalizer_inspection() {
  [[ ! -L "$FINALIZER" && -f "$FINALIZER" &&
    "$(stat --format='%U:%G:%a:%h' "$FINALIZER")" == 'root:root:755:1' &&
    "$(sha256sum -- "$FINALIZER" | awk '{print $1}')" == "$INSTALLED_FINALIZER_SHA256" ]] ||
    return 1
  "$FINALIZER" inspect "$CURRENT_RUNTIME_RELEASE" >/dev/null
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
        "$TARGET"|"$STAGED_HELPER"|"$INSTALLING_HELPER") return 1 ;;
      esac
      [[ "$basename" == "$SCRIPT_BASENAME" ]] && return 1
    done <"$cmdline" || true
  done
}

require_runtime_services() {
  local -a containers=()
  mapfile -t containers < <(docker_local_read_only container ls --all --quiet \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" | sort)
  [[ "${#containers[@]}" -eq 6 ]] || return 1
  docker_local_read_only container inspect "${containers[@]}" | jq -e \
    --arg release "$CURRENT_RUNTIME_RELEASE" '
      (map(.Config.Labels["com.docker.compose.service"]) | sort) as $services |
      $services == ["api", "beta-admission", "bot", "customer-web", "gateway", "owner-control"] and
      all(.[];
        .State.Running == true and
        .Config.Labels["org.opencontainers.image.revision"] == $release and
        (.State.Health == null or .State.Health.Status == "healthy") and
        (if .Config.Labels["com.docker.compose.service"] == "gateway" then true else
          (.Config.Env | index("FINANCIAL_ACTIONS_MODE=dry_run")) != null and
          (.Config.Env | index("KEMERBET_EXECUTOR_ENABLED=false")) != null and
          (.Config.Env | index("KEMERBET_FINAL_ACTION_ENABLED=false")) != null and
          ([.Config.Env[] | select(test("^(FINANCIAL_ACTIONS_MODE|KEMERBET_EXECUTOR_ENABLED|KEMERBET_FINAL_ACTION_ENABLED)="))] | length) == 3
        end)
      )' >/dev/null
}

runtime_boundary_digest() {
  local container service
  for service in api beta-admission bot customer-web gateway owner-control; do
    container="$(docker_local_read_only container ls --all --quiet --no-trunc \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=$service")" || return 1
    [[ "$container" =~ ^[0-9a-f]{64}$ ]] || return 1
    docker_local_read_only container inspect "$container" --format \
      '{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.RestartCount}}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "org.opencontainers.image.revision" }}'
  done | sha256sum | awk '{print $1}'
}

require_expiry_unit_files() {
  local path
  local -a timer_lines=()
  for path in "$SERVICE_PATH" "$TIMER_PATH"; do
    [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
      "$(stat --format='%U:%G:%a:%h' "$path")" == 'root:root:644:1' ]] || return 1
  done
  cmp -s -- "$SERVICE_PATH" <(printf '%s\n' \
    '[Unit]' \
    'Description=Stop FetanAgent staging before disposable database credentials expire' \
    'StartLimitIntervalSec=0' \
    '' \
    '[Service]' \
    'Type=oneshot' \
    'Environment=FETANAGENT_STAGING_EXPIRY_GUARD=1' \
    "ExecStart=$TARGET expiry-stop" \
    'Restart=on-failure' \
    'RestartSec=60' \
    'NoNewPrivileges=true' \
    'PrivateTmp=true' \
    'UMask=0077') || return 1
  mapfile -t timer_lines <"$TIMER_PATH" || return 1
  [[ "${#timer_lines[@]}" -eq 11 &&
    "${timer_lines[0]}" == '[Unit]' &&
    "${timer_lines[1]}" == 'Description=FetanAgent staging disposable-credential expiry guard' &&
    -z "${timer_lines[2]}" && "${timer_lines[3]}" == '[Timer]' &&
    "${timer_lines[4]}" =~ ^OnCalendar=[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\ UTC$ &&
    "${timer_lines[5]}" == 'AccuracySec=1min' &&
    "${timer_lines[6]}" == 'Persistent=true' &&
    "${timer_lines[7]}" == "Unit=$SERVICE" &&
    -z "${timer_lines[8]}" && "${timer_lines[9]}" == '[Install]' &&
    "${timer_lines[10]}" == 'WantedBy=timers.target' ]] || return 1
  date -u -d "${timer_lines[4]#OnCalendar=}" +%s >/dev/null || return 1
}

require_continuous_timer() {
  require_expiry_unit_files || return 1
  [[ "$(systemctl show --property=LoadState --value "$TIMER")" == 'loaded' &&
    "$(systemctl show --property=FragmentPath --value "$TIMER")" == "$TIMER_PATH" &&
    -z "$(systemctl show --property=DropInPaths --value "$TIMER")" &&
    "$(systemctl show --property=ActiveState --value "$TIMER")" == 'inactive' &&
    "$(systemctl show --property=UnitFileState --value "$TIMER")" == 'disabled' &&
    -z "$(systemctl show --property=NextElapseUSecRealtime --value "$TIMER")" &&
    "$(systemctl show --property=LoadState --value "$SERVICE")" == 'loaded' &&
    "$(systemctl show --property=FragmentPath --value "$SERVICE")" == "$SERVICE_PATH" &&
    -z "$(systemctl show --property=DropInPaths --value "$SERVICE")" &&
    "$(systemctl show --property=ActiveState --value "$SERVICE")" == 'inactive' ]]
}

require_continuous_credentials() {
  docker_local_read_only container exec -i -w /workspace/apps/api "$PROJECT_NAME-api-1" \
    node --input-type=module - <<'NODE'
import { loadApiConfig } from '@fetanagent/config/api';
import { createTelegramPlayerActionPoolConfig } from './dist/postgres-telegram-player-action-runtime.js';
import { Pool } from 'pg';

let pool;
try {
  const config = loadApiConfig();
  if (!config.telegramPlayerActionRuntime.enabled ||
      config.telegramPlayerActionRuntime.connection.host !== 'db.spzpiyxheappsfyswewl.supabase.co' ||
      config.telegramPlayerActionRuntime.connection.user !== 'fetanagent_player_actions_runtime') {
    throw new Error('configuration');
  }
  pool = new Pool({
    ...createTelegramPlayerActionPoolConfig(config.telegramPlayerActionRuntime),
    application_name: 'fetanagent-h17-helper-bridge-check',
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  const { rows } = await pool.query(`
    with expected(role_name, connection_limit) as (values
      ('fetanagent_beta_admission_runtime', 1),
      ('fetanagent_customer_web_runtime', 2),
      ('fetanagent_owner_control_runtime', 1),
      ('fetanagent_player_actions_runtime', 2)
    )
    select count(*) = 4 and bool_and(role.rolcanlogin
      and role.rolvaliduntil = 'infinity'::timestamptz
      and role.rolconnlimit = expected.connection_limit
      and not (role.rolinherit or role.rolsuper or role.rolcreatedb or role.rolcreaterole
        or role.rolreplication or role.rolbypassrls))
      and (select count(*) = 2 from pg_roles where
        rolname in ('fetanagent_deposit_executor_runtime', 'fetanagent_trusted_telebirr_verifier_runtime')
        and not rolcanlogin) as ready
    from expected join pg_roles role on role.rolname = expected.role_name
  `);
  if (rows.length !== 1 || rows[0].ready !== true) throw new Error('catalog');
} catch {
  console.error('H17 continuous application availability verification failed.');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end().catch(() => { process.exitCode = 1; });
}
NODE
}

require_continuous_boundary() {
  require_runtime_services && require_continuous_timer && require_continuous_credentials
}

require_helper_boundary() {
  local digest="$1" output
  run_helper_direct verify "$digest" >/dev/null || return 1
  run_helper_direct kemerbet-v3-runtime-bridge-ready "$digest" >/dev/null || return 1
  output="$(run_helper_direct kemerbet-quarantine-recovery-ready \
    "$CANONICAL_H14_RELEASE")" || return 1
  [[ "$output" == \
    'KemerBet H14 recovery state: cohort-prepared; Transfer and Amount disabled.' ]]
}

resolve_h16_release() {
  local entries
  [[ ! -L "$H16_PARENT" && -d "$H16_PARENT" &&
    "$(realpath -- "$H16_PARENT")" == "$H16_PARENT" &&
    "$(stat --format='%U:%G:%a' "$H16_PARENT")" == 'root:root:700' ]] || return 1
  entries="$(find -P "$H16_PARENT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n')" || return 1
  [[ "$entries" =~ ^([0-9a-f]{40}):d$ ]] || return 1
  H16_RELEASE="${BASH_REMATCH[1]}"
  [[ "$H16_RELEASE" != "$BRIDGE_RELEASE" && "$H16_RELEASE" != "$CURRENT_RUNTIME_RELEASE" ]]
}

expected_intent() {
  printf '%s\n' \
    'contract=fetanagent-kemerbet-continuous-availability-helper-bridge-v17' \
    'state=authorized' \
    "bridge_release=$BRIDGE_RELEASE" \
    "runtime_release=$CURRENT_RUNTIME_RELEASE" \
    "h16_bridge_release=$H16_RELEASE" \
    "predecessor_helper_sha256=$PREDECESSOR_HELPER_SHA256" \
    "successor_helper_sha256=$SUCCESSOR_HELPER_SHA256" \
    'continuous_application_availability=true' \
    'expiry_timer_active=false' \
    'expiry_timer_enabled=false' \
    'expiry_timer_next_trigger=false' \
    'financial_actions_mode=dry_run' \
    'kemerbet_executor_enabled=false' \
    'kemerbet_final_action_enabled=false' \
    'transfer_enabled=false' \
    'money_moved=false'
}

expected_completion() {
  local intent_sha256
  intent_sha256="$(expected_intent | sha256sum | awk '{print $1}')"
  expected_intent | awk 'NR == 2 { print "state=availability-helper-installed"; next } { print }'
  printf 'bridge_intent_sha256=%s\n' "$intent_sha256"
}

publish_record_atomically() {
  local root="$1" name="$2" mode="$3" producer="$4"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$root/.$name.installing" "$root/$name" "$mode" 3< <("$producer") <<'PY'
import os
import stat
import sys

temporary, target, mode_text = sys.argv[1:]
mode = int(mode_text, 8)
expected = bytearray()
while len(expected) <= 4096:
    chunk = os.read(3, 4097 - len(expected))
    if not chunk:
        break
    expected.extend(chunk)
expected = bytes(expected)
if not expected or len(expected) > 4096 or not expected.endswith(b'\n'):
    raise SystemExit(1)


def exact(path, prefix):
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
        if (prefix and not expected.startswith(existing)) or (not prefix and existing != expected):
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
else:
    descriptor = os.open(
        temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode
    )
    os.fchmod(descriptor, mode)
    existing = b''
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
os.rename(temporary, target)
directory = os.open(os.path.dirname(target), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.fsync(directory)
finally:
    os.close(directory)
PY
}

copy_predecessor_atomically() {
  local final="$H17_INSTALLING/predecessor-helper"
  local temporary="$H17_INSTALLING/.predecessor-helper.installing"
  if [[ -e "$final" || -L "$final" ]]; then
    [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
    require_helper_file "$final" "$PREDECESSOR_HELPER_SHA256" 400
    return
  fi
  if [[ ! -e "$temporary" && ! -L "$temporary" ]]; then
    install -o root -g root -m 0400 "$TARGET" "$temporary" || return 1
    sync -f "$temporary" || return 1
  fi
  require_helper_file "$temporary" "$PREDECESSOR_HELPER_SHA256" 400 || return 1
  mv -- "$temporary" "$final" || return 1
  sync -f "$H17_INSTALLING" || return 1
  require_helper_file "$final" "$PREDECESSOR_HELPER_SHA256" 400
}

require_exact_record() {
  local root="$1"
  [[ ! -L "$root" && -d "$root" && "$(realpath -- "$root")" == "$root" &&
    "$(stat --format='%U:%G:%a' "$root")" == 'root:root:700' &&
    "$(find -P "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)" == \
      $'completed-v1\nintent-v1\npredecessor-helper' ]] || return 1
  [[ "$(stat --format='%U:%G:%a:%h' "$root/intent-v1")" == 'root:root:600:1' &&
    "$(stat --format='%U:%G:%a:%h' "$root/completed-v1")" == 'root:root:600:1' ]] || return 1
  cmp -s -- "$root/intent-v1" <(expected_intent) || return 1
  cmp -s -- "$root/completed-v1" <(expected_completion) || return 1
  require_helper_file "$root/predecessor-helper" "$PREDECESSOR_HELPER_SHA256" 400
}

classify_namespace() {
  env -i PATH="$SAFE_PATH" python3 -I - "$H17_PARENT" "$BRIDGE_RELEASE" <<'PY'
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

require_installing_inventory() {
  [[ ! -L "$H17_INSTALLING" && -d "$H17_INSTALLING" &&
    "$(realpath -- "$H17_INSTALLING")" == "$H17_INSTALLING" &&
    "$(stat --format='%U:%G:%a' "$H17_INSTALLING")" == 'root:root:700' ]] || return 1
  local entries
  entries="$(find -P "$H17_INSTALLING" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | sort)" ||
    return 1
  while IFS= read -r entry; do
    [[ -z "$entry" || "$entry" =~ ^(\.intent-v1\.installing|intent-v1|\.completed-v1\.installing|completed-v1|\.predecessor-helper\.installing|predecessor-helper):f$ ]] ||
      return 1
  done <<<"$entries"
}

install_successor_atomically() {
  if require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
    [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]
    return
  fi
  require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755 || return 1
  if [[ ! -e "$INSTALLING_HELPER" && ! -L "$INSTALLING_HELPER" ]]; then
    install -o root -g root -m 0755 "$STAGED_HELPER" "$INSTALLING_HELPER" || return 1
    sync -f "$INSTALLING_HELPER" || return 1
  fi
  require_helper_file "$INSTALLING_HELPER" "$SUCCESSOR_HELPER_SHA256" 755 || return 1
  mv -- "$INSTALLING_HELPER" "$TARGET" || return 1
  sync -f /usr/local/sbin || return 1
  require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755
}

open_lock() {
  local fd_identity path_identity
  [[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' &&
    ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] || return 1
  exec 9<>"$LOCK" || return 1
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" || return 1
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" || return 1
  [[ "$fd_identity" == "$path_identity" ]] || return 1
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
      'FetanAgent H17 bridge stopped with the deployment grant disabled. Rerun this exact installer; do not restore the grant or edit evidence manually.' >&2
  fi
  exit "$status"
}

require_exact_droplet || die 'the DigitalOcean Droplet identity is not exact'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the reviewed H17 staging root is absent or unsafe'
[[ ! -L "$STAGED_INSTALLER" && -f "$STAGED_INSTALLER" &&
  "$(realpath -- "$0")" == "$STAGED_INSTALLER" &&
  "$(stat --format='%U:%G:%a:%h' "$STAGED_INSTALLER")" == 'root:root:700:1' ]] ||
  die 'run only the root-owned installer staged at the exact reviewed H17 path'
require_helper_file "$STAGED_HELPER" "$SUCCESSOR_HELPER_SHA256" 600 ||
  die 'the staged H17 successor helper is invalid'
resolve_h16_release || die 'the exact completed H16 namespace is unavailable'

h17_state="$(classify_namespace)" || die 'the H17 namespace shape is invalid'
target_state='invalid'
if require_helper_file "$TARGET" "$PREDECESSOR_HELPER_SHA256" 755; then
  target_state='predecessor'
elif require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755; then
  target_state='successor'
fi
case "$h17_state:$target_state" in
  absent:predecessor|empty-parent:predecessor)
    if require_active_grant_only; then
      :
    elif require_disabled_grant_only; then
      grant_disabled='true'
    else
      die 'the initial deployment grant is neither exact active nor exact disabled'
    fi
    ;;
  interrupted:predecessor|completed:predecessor)
    require_disabled_grant_only || die 'an incomplete H17 promotion must retain its disabled grant'
    grant_disabled='true'
    ;;
  completed:successor)
    if require_active_grant_only; then
      :
    elif require_disabled_grant_only; then
      grant_disabled='true'
    else
      die 'the completed H17 deployment grant is invalid'
    fi
    ;;
  *) die 'the H17 namespace and installed helper do not form a recoverable state' ;;
esac

trap cleanup EXIT
if [[ "$target_state" == 'predecessor' ]]; then
  require_exact_finalizer_inspection || die 'the installed continuous-availability finalizer did not attest the predecessor runtime'
  require_helper_boundary "$PREDECESSOR_HELPER_SHA256" || die 'the predecessor H16 helper boundary is invalid'
else
  require_helper_boundary "$SUCCESSOR_HELPER_SHA256" || die 'the completed H17 helper boundary is invalid'
fi
require_continuous_boundary || die 'the exact continuous no-money runtime boundary is invalid'
runtime_before="$(runtime_boundary_digest)" || die 'the runtime identity digest is unavailable'
[[ "$runtime_before" =~ ^[0-9a-f]{64}$ ]] || die 'the runtime identity digest is invalid'

open_lock || die 'the exact staging mutation lock is unsafe or another mutation is active'
require_no_other_mutator_processes || die 'another helper or H17 installer process is active'
require_exact_droplet || die 'the DigitalOcean Droplet identity changed under lock'
require_continuous_boundary || die 'the continuous runtime changed under lock'
[[ "$(runtime_boundary_digest)" == "$runtime_before" ]] || die 'the runtime identity changed under lock'

if [[ "$grant_disabled" != 'true' ]]; then
  if [[ "$h17_state" == 'completed' && "$target_state" == 'successor' ]]; then
    require_active_grant_only || die 'the completed active grant changed under lock'
  else
    disable_sudoers || die 'the deployment grant could not be disabled safely'
  fi
fi

if [[ "$h17_state" != 'completed' ]]; then
  if [[ "$h17_state" == 'absent' ]]; then
    install -d -o root -g root -m 0700 "$H17_PARENT"
    sync -f "$(dirname -- "$H17_PARENT")"
  fi
  if [[ "$h17_state" == 'absent' || "$h17_state" == 'empty-parent' ]]; then
    install -d -o root -g root -m 0700 "$H17_INSTALLING"
    sync -f "$H17_PARENT"
    h17_state='interrupted'
  fi
  require_installing_inventory || die 'the H17 installing prefix is invalid'
  publish_record_atomically "$H17_INSTALLING" intent-v1 0600 expected_intent ||
    die 'the H17 intent could not be published atomically'
  copy_predecessor_atomically || die 'the predecessor helper archive could not be published atomically'
  publish_record_atomically "$H17_INSTALLING" completed-v1 0600 expected_completion ||
    die 'the H17 completion could not be published atomically'
  require_exact_record "$H17_INSTALLING" || die 'the completed H17 installing record is invalid'
  [[ ! -e "$H17_ROOT" && ! -L "$H17_ROOT" ]] || die 'the final H17 root appeared unexpectedly'
  mv -- "$H17_INSTALLING" "$H17_ROOT"
  sync -f "$H17_PARENT"
  h17_state='completed'
fi
require_exact_record "$H17_ROOT" || die 'the final H17 evidence is invalid'
install_successor_atomically || die 'the H17 helper replacement could not be completed atomically'
target_state='successor'
require_continuous_boundary || die 'the continuous runtime changed during H17 promotion'
[[ "$(runtime_boundary_digest)" == "$runtime_before" ]] ||
  die 'the runtime identity changed during H17 promotion'
close_lock

require_helper_boundary "$SUCCESSOR_HELPER_SHA256" ||
  die 'the installed H17 helper rejected its preserved runtime bridge'
require_continuous_boundary || die 'the continuous runtime changed after H17 helper attestation'
[[ "$(runtime_boundary_digest)" == "$runtime_before" ]] ||
  die 'the runtime identity changed after H17 helper attestation'

open_lock || die 'the mutation lock changed before grant restoration'
require_no_other_mutator_processes || die 'another helper or H17 installer process appeared'
require_exact_record "$H17_ROOT" || die 'the H17 evidence changed before grant restoration'
require_helper_file "$TARGET" "$SUCCESSOR_HELPER_SHA256" 755 ||
  die 'the H17 helper changed before grant restoration'
require_continuous_boundary || die 'the continuous runtime changed before grant restoration'
[[ "$(runtime_boundary_digest)" == "$runtime_before" ]] ||
  die 'the runtime identity changed before grant restoration'
if [[ "$grant_disabled" == 'true' ]]; then
  restore_sudoers || die 'the deployment grant could not be restored safely'
  grant_disabled='false'
else
  require_active_grant_only || die 'the active deployment grant changed'
fi
close_lock
trap - EXIT

printf '%s\n' \
  'KemerBet H17 continuous-availability helper bridge installed or validated: H16 preserved; timer disabled; Transfer disabled; no money moved.'
