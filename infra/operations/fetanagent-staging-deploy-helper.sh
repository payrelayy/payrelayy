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

require_immutable_config_file() {
  local path="$1"
  [[ ! -L "$path" && -f "$path" ]] || die 'a required immutable config file is absent or symbolic'
  [[ "$(stat --format='%U:%G:%a' "$path")" == 'root:root:444' ]] ||
    die 'an immutable config file does not have the required ownership and mode'
}

stop_project() {
  local containers networks
  containers="$(docker_local container ls --all --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME")"
  if [[ -n "$containers" ]]; then
    # Container identifiers returned by Docker contain only hexadecimal characters and newlines.
    docker_local container rm --force $containers >/dev/null
  fi
  networks="$(docker_local network ls --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME")"
  if [[ -n "$networks" ]]; then
    # Network identifiers returned by Docker contain only hexadecimal characters and newlines.
    docker_local network rm $networks >/dev/null
  fi
  rm -f -- \
    "$SECRET_ROOT/owner-database-url" \
    "$SECRET_ROOT/publishable-key" \
    "$SECRET_ROOT/customer-web-database-url" \
    "$SECRET_ROOT/customer-web-publishable-key" \
    "$SECRET_ROOT/customer-web-rate-limit-hmac" \
    "$SECRET_ROOT/beta-database-url" \
    "$SECRET_ROOT/beta-transport-hmac" \
    "$SECRET_ROOT/bot-transport-hmac" \
    "$SECRET_ROOT/beta-payload-hmac" \
    "$SECRET_ROOT/player-action-database-url" \
    "$SECRET_ROOT/api-action-transport-hmac" \
    "$SECRET_ROOT/api-action-payload-hmac" \
    "$SECRET_ROOT/api-action-capability-hmac" \
    "$SECRET_ROOT/api-action-semantic-hmac" \
    "$SECRET_ROOT/cbe-deposit-reference-encryption-key" \
    "$SECRET_ROOT/cbe-deposit-reference-fingerprint-key" \
    "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json" \
    "$SECRET_ROOT/bot-action-transport-hmac" \
    "$SECRET_ROOT/bot-token" \
    "$SECRET_ROOT/supabase-ca.crt"
}

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

require_exact_fresh_private_runtime() {
  local commit_sha="$1"
  local container_id environment health ids revision service services state
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
        'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host customer-web capability environment is not exact'
      done
    fi
  done

  require_reviewed_owner_port_3002 "$commit_sha"
}

require_exact_fresh_bot_runtime() {
  local commit_sha="$1"
  local container_id environment health ids restart_count revision service services state
  local expected_environment
  local -a expected_services=(api beta-admission bot customer-web owner-control)

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the fresh-host Telegram service inventory could not be inspected'
  [[ "$services" == $'api\nbeta-admission\nbot\ncustomer-web\nowner-control' ]] ||
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
        'INTERNAL_CUSTOMER_WEB_DURABLE_RATE_LIMIT_ENABLED=true'; do
        grep -Fxq "$expected_environment" <<<"$environment" ||
          die 'the fresh-host customer-web capability environment is not exact'
      done
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
      docker_local container logs --tail 80 "$ids" 2>&1 |
        grep -Fq 'Telegram bot started in private beta admission mode.' ||
        die 'the fresh-host Telegram bot did not report its genuine startup contract'
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

  require_reviewed_owner_port_3002 "$commit_sha"
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
  require_exact_fresh_bot_runtime "$commit_sha"
  require_public_network_ready "$FRESH_PUBLIC_IPV4"
}

[[ $EUID -eq 0 ]] || die 'the helper must run as root through sudo'
[[ "${SUDO_USER:-}" == "$EXPECTED_SUDO_USER" ]] || die 'the helper requires the dedicated deployment identity'
[[ "$0" == "$HELPER_PATH" ]] || die 'the helper must run from its root-owned installed path'
[[ ! -L "$HELPER_PATH" && "$(stat --format='%U:%G:%a' "$HELPER_PATH")" == 'root:root:755' ]] ||
  die 'the installed helper ownership or mode is unsafe'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Docker overrides are forbidden'

command="${1:-}"
case "$command" in
  verify)
    [[ $# -eq 2 && "$2" =~ ^[0-9a-f]{64}$ ]] || die 'verify requires one SHA-256 digest'
    [[ "$(sha256sum "$HELPER_PATH" | awk '{print $1}')" == "$2" ]] ||
      die 'the installed helper does not match the reviewed repository helper'
    ;;

  stop)
    [[ $# -eq 1 ]] || die 'stop accepts no additional arguments'
    stop_project
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
      cbe-deposit-reference-fingerprint-key bot-action-transport-hmac; do
      require_service_file "$SECRET_ROOT/$service_file"
    done
    require_immutable_config_file "$SECRET_ROOT/supabase-ca.crt"
    require_immutable_config_file "$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json"

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
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual -f "$compose_file"
    )

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
      FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE="$SECRET_ROOT/supabase-ca.crt"
      FETANAGENT_STAGING_BOT_TOKEN_FILE="$SECRET_ROOT/bot-token"
      FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-transport-hmac"
      FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE="$SECRET_ROOT/bot-action-transport-hmac"
    )
    compose_command=(
      docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null
      --project-name "$PROJECT_NAME" --profile staging-manual -f "$compose_file"
    )
    env -i "${compose_environment[@]}" "${compose_command[@]}" \
      up -d --no-build --no-deps bot
    ;;

  bot-ready)
    [[ $# -eq 2 ]] || die 'bot-ready requires one reviewed main commit'
    require_exact_fresh_bot_runtime "$2"
    ;;

  stop-bot)
    [[ $# -eq 2 ]] || die 'stop-bot requires one reviewed main commit'
    commit_sha="$2"
    [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] ||
      die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
    bot_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=bot')"
    if [[ -n "$bot_container" ]]; then
      [[ "$bot_container" =~ ^[0-9a-f]{12,64}$ ]] ||
        die 'the Telegram bot container inventory is ambiguous'
      docker_local container rm --force "$bot_container" >/dev/null
    fi
    disabled_token="$(mktemp "$SECRET_ROOT/.bot-token-disabled.XXXXXX")"
    printf '%s\n' 'telegram-disabled-until-separate-smoke' >"$disabled_token"
    install -o 10001 -g 10001 -m 0400 "$disabled_token" "$SECRET_ROOT/bot-token"
    rm -f -- "$disabled_token"
    require_fresh_bot_disabled_ready "$commit_sha"
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
      require_exact_fresh_bot_runtime "$commit_sha"
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
    gateway_container="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter 'label=com.docker.compose.service=gateway')"
    if [[ -n "$gateway_container" ]]; then
      [[ "$gateway_container" =~ ^[0-9a-f]{12,64}$ ]] || die 'the gateway container inventory is ambiguous'
      docker_local container rm --force "$gateway_container" >/dev/null
    fi
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
    die 'expected verify, stop, cutover-ready, fresh-host-ready, network-ready, public-edge-ready, fresh-public-edge-ready, discard, install, start, fresh-start, bot-disabled-ready, install-bot-token, start-bot, bot-ready, stop-bot, start-public-edge, start-fresh-public-edge, stop-public-edge, or diagnose-owner-startup'
    ;;
esac
