#!/usr/bin/env bash
# Root-only, in-place removal of the old application-availability deadline.
# No helper replacement, sudo grant, credential change, container restart, or money action.
set -euo pipefail
export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
umask 077

die() { printf '%s\n' "$1" >&2; exit 1; }
[[ $# -eq 2 ]] || die 'Expected inspect or disable-expiry, and the exact deployed release SHA.'
readonly MODE="$1" RELEASE_SHA="$2"
[[ "$MODE" =~ ^(inspect|disable-expiry)$ && "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  die 'The availability operation or release is invalid.'
[[ "$(id -u)" == 0 && -z "${SUDO_USER:-}" ]] || die 'Use the existing trusted root SSH session.'
[[ "$(curl --fail --silent --show-error --max-time 5 http://169.254.169.254/metadata/v1/id)" == 593344964 ]] ||
  die 'This is not the approved staging Droplet.'

readonly PROJECT='fetanagent-staging-beta'
readonly TIMER='fetanagent-staging-runtime-expiry-stop.timer'
readonly SERVICE='fetanagent-staging-runtime-expiry-stop.service'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
readonly HELPER='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly HELPER_SHA='da555f29ac6260e1dff6c969218eb55ea9bd66c8167600e3ecc700118c8ea9e6'

[[ ! -L "$HELPER" && -f "$HELPER" && "$(stat --format='%U:%G:%a:%h' "$HELPER")" == 'root:root:755:1' &&
  "$(sha256sum "$HELPER" | awk '{print $1}')" == "$HELPER_SHA" ]] ||
  die 'The installed staging helper does not match the reviewed boundary.'
[[ ! -L "$LOCK_ROOT" && -d "$LOCK_ROOT" && "$(realpath -- "$LOCK_ROOT")" == "$LOCK_ROOT" &&
  "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' ]] || die 'The mutation lock root is unsafe.'
[[ ! -L "$LOCK" && -f "$LOCK" && "$(realpath -- "$LOCK")" == "$LOCK" &&
  "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] || die 'The mutation lock is unsafe.'
exec 9<>"$LOCK"
lock_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")"
[[ "$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" == "$lock_identity" ]] ||
  die 'The opened mutation lock does not match its root-managed path.'
flock --exclusive --nonblock 9 || die 'Another staging operation is active.'
[[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$lock_identity" ]] ||
  die 'The mutation lock changed while acquiring it.'

verify_services() {
  local container metadata
  mapfile -t containers < <(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | sort)
  [[ "${#containers[@]}" -eq 6 ]] || die 'Exactly six ordinary staging services must exist.'
  docker inspect "${containers[@]}" | jq -e --arg release "$RELEASE_SHA" '
    (map(.Config.Labels["com.docker.compose.service"]) | sort) ==
      ["api", "beta-admission", "bot", "customer-web", "gateway", "owner-control"] and
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
    )' >/dev/null || die 'The installed release is not healthy and financially disabled.'
}

verify_continuous_credentials() {
  # Use the API's existing restricted credentials inside its own container.
  # Neither the database password nor an administrator connection leaves it.
  docker exec -i -w /workspace/apps/api "$PROJECT-api-1" node --input-type=module - <<'NODE'
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
    application_name: 'fetanagent-continuous-availability-check',
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
  console.info('continuous_runtime_credentials=verified');
} catch {
  console.error('Continuous runtime credential verification failed; the shutdown timer was not changed.');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end().catch(() => { process.exitCode = 1; });
}
NODE
}

verify_timer_identity() {
  local unit load_state
  for unit in "$TIMER" "$SERVICE"; do
    load_state="$(systemctl show --property=LoadState --value "$unit")"
    if [[ "$load_state" == 'not-found' ]]; then
      [[ ! -e "/etc/systemd/system/$unit" && ! -L "/etc/systemd/system/$unit" ]] ||
        die 'An unloaded expiry unit still has a filesystem entry.'
      continue
    fi
    [[ "$load_state" == 'loaded' && ! -L "/etc/systemd/system/$unit" &&
      "$(stat --format='%U:%G:%a:%h' "/etc/systemd/system/$unit")" == 'root:root:644:1' &&
      "$(systemctl show --property=FragmentPath --value "$unit")" == "/etc/systemd/system/$unit" &&
      -z "$(systemctl show --property=DropInPaths --value "$unit")" ]] ||
      die 'An expiry unit is not the original root-owned unit.'
  done
  [[ "$(systemctl show --property=ActiveState --value "$SERVICE")" == 'inactive' ]] ||
    die 'The old shutdown service is already active or failed; inspect it before continuing.'
}

disarm_existing_timer() {
  if [[ "$(systemctl show --property=LoadState --value "$TIMER")" == 'loaded' ]]; then
    systemctl disable --now "$TIMER" || die 'The old shutdown timer could not be disabled.'
  fi
  [[ "$(systemctl show --property=ActiveState --value "$TIMER")" == 'inactive' ]] ||
    die 'The old shutdown timer is still active.'
  local unit_state
  unit_state="$(systemctl show --property=UnitFileState --value "$TIMER")"
  [[ "$unit_state" == 'disabled' || "$unit_state" == '' ]] || die 'The old shutdown timer can still start at boot.'
  [[ -z "$(systemctl show --property=NextElapseUSecRealtime --value "$TIMER")" ]] ||
    die 'The old shutdown timer still has a scheduled trigger.'
}

verify_services
before_containers="${containers[*]}"
verify_continuous_credentials
verify_timer_identity
if [[ "$MODE" == 'disable-expiry' ]]; then
  disarm_existing_timer
fi
verify_services
[[ "${containers[*]}" == "$before_containers" ]] || die 'The service identities changed during the operation.'
systemctl show "$TIMER" --property=LoadState --property=ActiveState --property=UnitFileState --property=NextElapseUSecRealtime
printf '%s\n' 'Availability operation verified; no services restarted and financial controls are unchanged.'
