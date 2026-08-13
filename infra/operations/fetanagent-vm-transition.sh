#!/usr/bin/env bash
# Root-console-only, fail-closed transition from the sealed legacy staging
# deployment boundary to the FetanAgent staging deployment boundary.
#
# Install this exact reviewed file as /usr/local/sbin/fetanagent-vm-transition
# with root:root ownership and mode 0700. Never grant this script through sudo.

set -euo pipefail

readonly TRANSITION_VERSION='1'
readonly DROPLET_ID='590666364'
readonly PUBLIC_IPV4='178.128.39.89'
readonly TRANSITION_PATH='/usr/local/sbin/fetanagent-vm-transition'
readonly INPUT_ROOT='/root/fetanagent-vm-transition-input'
readonly NEW_HELPER_SOURCE="$INPUT_ROOT/fetanagent-staging-deploy-helper"

readonly LEGACY_BRAND='pay''replayy'
readonly LEGACY_ADMIN="${LEGACY_BRAND}-admin"
readonly LEGACY_HOME="/home/$LEGACY_ADMIN"
readonly LEGACY_HELPER="/usr/local/sbin/${LEGACY_BRAND}-staging-deploy-helper"
readonly LEGACY_HELPER_SHA='4007e616b5d0b8b29b9e8f80de6a86485d60e0fb28ad54028cc2f3b1bb080d69'
readonly LEGACY_PROJECT="${LEGACY_BRAND}-staging-beta"
readonly LEGACY_ROOT="/srv/$LEGACY_BRAND"
readonly LEGACY_SECRET_ROOT="$LEGACY_ROOT/secrets/staging"
readonly LEGACY_SUDOERS="/etc/sudoers.d/${LEGACY_BRAND}-staging-deploy"

readonly NEW_ADMIN='fetanagent-admin'
readonly NEW_HOME='/home/fetanagent-admin'
readonly NEW_HELPER='/usr/local/sbin/fetanagent-staging-deploy-helper'
readonly NEW_HELPER_SHA='e530efcc0781be8d298c0527f1a27bf1b7c97f9e0c9584adc0dd6ced0a7770af'
readonly NEW_PROJECT='fetanagent-staging-beta'
readonly NEW_RELEASE_ROOT='/srv/fetanagent/releases'
readonly NEW_SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly NEW_SUDOERS='/etc/sudoers.d/fetanagent-staging-deploy-helper'
readonly NEW_SSHD_DROPIN='/etc/ssh/sshd_config.d/91-fetanagent-admin.conf'

readonly STATE_ROOT='/var/lib/fetanagent-vm-transition'
readonly PREPARED_MARKER="$STATE_ROOT/prepared-v1"
readonly ACKNOWLEDGED_MARKER="$STATE_ROOT/acknowledged-v1"
readonly LEGACY_STOPPED_MARKER="$STATE_ROOT/legacy-stopped-v1"
readonly RETIRED_MARKER="$STATE_ROOT/retired-v1"
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly METADATA_ROOT='http://169.254.169.254/metadata/v1'

export PATH="$SAFE_PATH"

die() {
  printf 'FetanAgent VM transition failed: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: fetanagent-vm-transition <command> [reviewed-main-commit]

Commands:
  inspect
      Read-only inventory of the fixed Droplet and both deployment boundaries.
  prepare
      Create the separate FetanAgent SSH identity and install its reviewed helper.
  acknowledge <40-lowercase-hex>
      Record the exact reviewed main commit before the one-way maintenance window.
  mark-legacy-stopped <same-commit>
      Prove legacy runtime absence, seal old execution access, then receipt it.
  rollback-prepare
      Safely remove complete or partial FetanAgent preparation before legacy stop.
  retire <same-commit>
      After exact-commit private smoke, finish resumable legacy cleanup and receipt it.
  verify
      Recheck the live contract for the furthest completed phase.

This script is root-console-only. It must never be placed in a sudoers policy.
It never starts or stops an application, changes database roles, opens a firewall,
changes DNS, deletes a release, prunes an image, or publishes the public edge.
USAGE
}

docker_local() {
  env -i \
    PATH="$SAFE_PATH" \
    HOME='/root' \
    DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is unavailable"
}

require_root_console() {
  [[ $EUID -eq 0 ]] || die 'run this script only from the Droplet root console'
  [[ -z "${SUDO_USER:-}" || "${SUDO_USER:-}" == 'root' ]] ||
    die 'do not reach this script through a non-root sudo identity'
  [[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
    die 'Docker host and context overrides are forbidden'
  [[ ! -L "$TRANSITION_PATH" && -f "$TRANSITION_PATH" ]] ||
    die 'the transition script is absent from its fixed installed path or is symbolic'
  [[ "$(readlink -f -- "$0")" == "$TRANSITION_PATH" ]] ||
    die 'run the transition from its fixed installed path'
  [[ "$(stat --format='%U:%G:%a' "$TRANSITION_PATH")" == 'root:root:700' ]] ||
    die 'the transition script must be root:root mode 0700'
}

require_finalized_new_helper_hash() {
  [[ "$NEW_HELPER_SHA" =~ ^[0-9a-f]{64}$ ]] || die 'the new helper digest is malformed'
  [[ "$NEW_HELPER_SHA" != '0000000000000000000000000000000000000000000000000000000000000000' ]] ||
    die 'the new helper digest placeholder has not been finalized'
}

require_exact_droplet() {
  local metadata_id metadata_ipv4
  require_command curl
  metadata_id="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    "$METADATA_ROOT/id")" || die 'the DigitalOcean metadata ID is unavailable'
  metadata_ipv4="$(curl --fail --silent --show-error --noproxy '*' --max-time 3 \
    "$METADATA_ROOT/interfaces/public/0/ipv4/address")" ||
    die 'the DigitalOcean public IPv4 metadata is unavailable'
  [[ "$metadata_id" == "$DROPLET_ID" ]] || die 'this is not the reviewed staging Droplet'
  [[ "$metadata_ipv4" == "$PUBLIC_IPV4" ]] || die 'the Droplet public IPv4 does not match the reviewed target'
}

require_commit() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] || die 'the reviewed main commit must be 40 lowercase hexadecimal characters'
}

require_regular_metadata() {
  local path="$1"
  local metadata="$2"
  [[ ! -L "$path" && -f "$path" ]] || die "$path is absent or symbolic"
  [[ "$(stat --format='%U:%G:%a' "$path")" == "$metadata" ]] ||
    die "$path has unexpected ownership or mode"
}

require_directory_metadata() {
  local path="$1"
  local metadata="$2"
  [[ ! -L "$path" && -d "$path" ]] || die "$path is absent or symbolic"
  [[ "$(stat --format='%U:%G:%a' "$path")" == "$metadata" ]] ||
    die "$path has unexpected ownership or mode"
}

require_state_root_if_present() {
  if [[ -e "$STATE_ROOT" || -L "$STATE_ROOT" ]]; then
    require_directory_metadata "$STATE_ROOT" 'root:root:700'
  fi
}

ensure_state_root() {
  if [[ -e "$STATE_ROOT" || -L "$STATE_ROOT" ]]; then
    require_directory_metadata "$STATE_ROOT" 'root:root:700'
  else
    install -d -o root -g root -m 0700 "$STATE_ROOT"
  fi
}

write_marker() {
  local destination="$1"
  shift
  local temporary

  ensure_state_root
  [[ ! -L "$destination" ]] || die "$destination is symbolic"
  temporary="$(mktemp "$STATE_ROOT/.marker.XXXXXX")"
  printf '%s\n' "$@" >"$temporary"
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$destination"
  require_regular_metadata "$destination" 'root:root:600'
}

require_exact_marker() {
  local marker="$1"
  shift
  local temporary
  require_regular_metadata "$marker" 'root:root:600'
  temporary="$(mktemp)"
  printf '%s\n' "$@" >"$temporary"
  cmp -s -- "$temporary" "$marker" || {
    rm -f -- "$temporary"
    die "$marker does not exactly match its allowed transition receipt schema"
  }
  rm -f -- "$temporary"
}

marker_field() {
  local marker="$1"
  local key="$2"
  local count value
  require_regular_metadata "$marker" 'root:root:600'
  count="$(grep -c "^${key}=" "$marker" || true)"
  [[ "$count" -eq 1 ]] || die "$marker must contain exactly one $key field"
  value="$(sed -n "s/^${key}=//p" "$marker")"
  [[ "$value" != *$'\n'* ]] || die "$marker contains an ambiguous $key field"
  printf '%s' "$value"
}

require_prepared_marker() {
  local authorized_keys_sha new_admin_uid
  authorized_keys_sha="$(marker_field "$PREPARED_MARKER" 'authorized_keys_sha')"
  new_admin_uid="$(marker_field "$PREPARED_MARKER" 'new_admin_uid')"
  [[ "$authorized_keys_sha" =~ ^[0-9a-f]{64}$ ]] || die 'the prepared public-key digest is malformed'
  [[ "$new_admin_uid" =~ ^[0-9]+$ && "$new_admin_uid" -ne 0 ]] ||
    die 'the prepared FetanAgent administrator UID is malformed or unsafe'
  require_exact_marker "$PREPARED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "authorized_keys_sha=$authorized_keys_sha" \
    "new_admin_uid=$new_admin_uid" \
    'prepared=true'
}

prepared_authorized_keys_sha() {
  require_prepared_marker
  marker_field "$PREPARED_MARKER" 'authorized_keys_sha'
}

prepared_new_admin_uid() {
  require_prepared_marker
  marker_field "$PREPARED_MARKER" 'new_admin_uid'
}

require_acknowledged_marker() {
  local commit_sha="$1"
  require_exact_marker "$ACKNOWLEDGED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "acknowledged_commit=$commit_sha" \
    'acknowledged=true'
}

require_legacy_stopped_marker() {
  local commit_sha="$1"
  require_exact_marker "$LEGACY_STOPPED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "acknowledged_commit=$commit_sha" \
    'legacy_stopped=true'
}

require_retired_marker() {
  local commit_sha="$1"
  require_exact_marker "$RETIRED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "acknowledged_commit=$commit_sha" \
    'retired=true'
}

marker_commit() {
  local marker="$1"
  local value
  value="$(marker_field "$marker" 'acknowledged_commit')"
  require_commit "$value"
  printf '%s' "$value"
}

require_legacy_helper() {
  require_regular_metadata "$LEGACY_HELPER" 'root:root:755'
  [[ "$(sha256sum "$LEGACY_HELPER" | awk '{ print $1 }')" == "$LEGACY_HELPER_SHA" ]] ||
    die 'the installed legacy helper does not match the reviewed legacy Git blob'
}

require_new_helper() {
  require_regular_metadata "$NEW_HELPER" 'root:root:755'
  [[ "$(sha256sum "$NEW_HELPER" | awk '{ print $1 }')" == "$NEW_HELPER_SHA" ]] ||
    die 'the installed FetanAgent helper does not match the reviewed LF Git blob'
}

require_new_helper_source() {
  require_regular_metadata "$NEW_HELPER_SOURCE" 'root:root:600'
  [[ "$(sha256sum "$NEW_HELPER_SOURCE" | awk '{ print $1 }')" == "$NEW_HELPER_SHA" ]] ||
    die 'the staged FetanAgent helper does not match the finalized LF Git-blob digest'
}

require_legacy_identity() {
  local entry uid home shell password_status groups
  entry="$(getent passwd "$LEGACY_ADMIN")" || die 'the legacy deployment identity is absent'
  uid="$(cut -d: -f3 <<<"$entry")"
  home="$(cut -d: -f6 <<<"$entry")"
  shell="$(cut -d: -f7 <<<"$entry")"
  [[ "$uid" =~ ^[0-9]+$ && "$uid" -ne 0 ]] || die 'the legacy deployment identity has an unsafe UID'
  [[ "$home" == "$LEGACY_HOME" ]] || die 'the legacy deployment identity has an unexpected home'
  [[ "$shell" != '/usr/sbin/nologin' && "$shell" != '/bin/false' ]] ||
    die 'the legacy deployment identity is already retired before cutover'
  password_status="$(passwd --status "$LEGACY_ADMIN" | awk '{ print $2 }')"
  [[ "$password_status" == 'L' ]] || die 'the legacy deployment identity password is not locked'
  groups="$(id -nG "$LEGACY_ADMIN" | tr ' ' '\n')"
  ! grep -Eq '^(docker|sudo)$' <<<"$groups" ||
    die 'the legacy deployment identity has broad Docker or sudo-group access'
}

require_legacy_identity_for_disable() {
  local entry uid home shell password_status groups
  entry="$(getent passwd "$LEGACY_ADMIN")" || die 'the legacy deployment identity is absent'
  uid="$(cut -d: -f3 <<<"$entry")"
  home="$(cut -d: -f6 <<<"$entry")"
  shell="$(cut -d: -f7 <<<"$entry")"
  [[ "$uid" =~ ^[0-9]+$ && "$uid" -ne 0 ]] || die 'the legacy deployment identity has an unsafe UID'
  [[ "$home" == "$LEGACY_HOME" ]] || die 'the legacy deployment identity has an unexpected home'
  [[ "$shell" == '/bin/bash' || "$shell" == '/usr/sbin/nologin' ]] ||
    die 'the legacy deployment identity has an unexpected shell during boundary disable'
  password_status="$(passwd --status "$LEGACY_ADMIN" | awk '{ print $2 }')"
  [[ "$password_status" == 'L' ]] || die 'the legacy deployment identity password is not locked'
  groups="$(id -nG "$LEGACY_ADMIN" | tr ' ' '\n')"
  ! grep -Eq '^(docker|sudo)$' <<<"$groups" ||
    die 'the legacy deployment identity has broad Docker or sudo-group access'
}

require_legacy_identity_disabled() {
  local legacy_uid legacy_shell legacy_status process_status
  require_legacy_identity_for_disable
  legacy_uid="$(id -u "$LEGACY_ADMIN")"
  legacy_shell="$(getent passwd "$LEGACY_ADMIN" | cut -d: -f7)"
  legacy_status="$(passwd --status "$LEGACY_ADMIN" | awk '{ print $2 }')"
  [[ "$legacy_shell" == '/usr/sbin/nologin' && "$legacy_status" == 'L' ]] ||
    die 'the legacy identity is not locked and noninteractive'
  if pgrep -u "$legacy_uid" >/dev/null 2>&1; then
    die 'a legacy deployment identity process remains after boundary disable'
  else
    process_status="$?"
    [[ "$process_status" -eq 1 ]] || die 'legacy process inventory failed'
  fi
}

require_no_legacy_helper_processes() {
  local process_status
  if pgrep -f -- "$LEGACY_HELPER" >/dev/null 2>&1; then
    die 'an already-authorized legacy helper process is still running; wait for it to finish and retry'
  else
    process_status="$?"
    [[ "$process_status" -eq 1 ]] || die 'legacy helper process inventory failed'
  fi
}

legacy_authorized_keys() {
  printf '%s/.ssh/authorized_keys' "$LEGACY_HOME"
}

require_legacy_authorized_keys() {
  local path uid gid metadata active_key_count
  path="$(legacy_authorized_keys)"
  [[ ! -L "$LEGACY_HOME" && -d "$LEGACY_HOME" ]] || die 'the legacy home is absent or symbolic'
  [[ ! -L "$LEGACY_HOME/.ssh" && -d "$LEGACY_HOME/.ssh" ]] ||
    die 'the legacy SSH directory is absent or symbolic'
  [[ ! -L "$path" && -s "$path" ]] || die 'the legacy authorized_keys file is absent, empty, or symbolic'
  uid="$(id -u "$LEGACY_ADMIN")"
  gid="$(id -g "$LEGACY_ADMIN")"
  metadata="$(stat --format='%u:%g:%a' "$path")"
  [[ "$metadata" == "$uid:$gid:600" || "$metadata" == "0:0:600" ]] ||
    die 'the legacy authorized_keys file has unexpected ownership or mode'
  active_key_count="$(awk '!/^[[:space:]]*($|#)/ { count += 1 } END { print count + 0 }' "$path")"
  [[ "$active_key_count" -eq 1 ]] ||
    die 'the legacy authorized_keys file must contain exactly one non-comment public-key entry'
}

expected_new_sudoers() {
  cat <<'EOF'
Defaults:fetanagent-admin !setenv
fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-staging-deploy-helper *
EOF
}

expected_new_sshd_dropin() {
  cat <<'EOF'
Match User fetanagent-admin
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitEmptyPasswords no
    AllowAgentForwarding no
    AllowStreamLocalForwarding no
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:3002
    GatewayPorts no
    PermitTunnel no
    PermitTTY no
    PermitUserEnvironment no
    X11Forwarding no
EOF
}

require_new_home_contents_safe_to_remove() {
  local entry listing name skeleton
  listing="$(mktemp)"
  find "$NEW_HOME" -mindepth 1 -maxdepth 1 -print0 >"$listing" || {
    rm -f -- "$listing"
    die 'the FetanAgent home inventory failed'
  }
  while IFS= read -r -d '' entry; do
    name="$(basename -- "$entry")"
    if [[ "$name" == '.ssh' ]]; then
      continue
    fi
    skeleton="/etc/skel/$name"
    [[ ! -L "$entry" && -f "$entry" && ! -L "$skeleton" && -f "$skeleton" ]] ||
      die "refusing to remove unexpected FetanAgent home artifact $entry"
    cmp -s -- "$skeleton" "$entry" ||
      die "refusing to remove modified FetanAgent home artifact $entry"
  done <"$listing"
  rm -f -- "$listing"
}

require_new_identity() {
  local entry uid gid home shell password_status groups authorized_keys authorized_keys_sha
  entry="$(getent passwd "$NEW_ADMIN")" || die 'the FetanAgent deployment identity is absent'
  uid="$(cut -d: -f3 <<<"$entry")"
  gid="$(cut -d: -f4 <<<"$entry")"
  home="$(cut -d: -f6 <<<"$entry")"
  shell="$(cut -d: -f7 <<<"$entry")"
  [[ "$uid" =~ ^[0-9]+$ && "$uid" -ne 0 ]] || die 'the FetanAgent deployment identity has an unsafe UID'
  [[ "$home" == "$NEW_HOME" && "$shell" == '/bin/bash' ]] ||
    die 'the FetanAgent deployment identity has an unexpected home or shell'
  [[ "$(getent group "$NEW_ADMIN" | cut -d: -f3)" == "$gid" ]] ||
    die 'the FetanAgent deployment identity does not use its dedicated primary group'
  password_status="$(passwd --status "$NEW_ADMIN" | awk '{ print $2 }')"
  [[ "$password_status" == 'L' ]] || die 'the FetanAgent deployment identity password is not locked'
  groups="$(id -nG "$NEW_ADMIN")"
  [[ "$groups" == "$NEW_ADMIN" ]] || die 'the FetanAgent deployment identity has supplemental groups'
  [[ "$uid" == "$(prepared_new_admin_uid)" ]] ||
    die 'the live FetanAgent administrator UID differs from the prepared receipt'
  require_directory_metadata "$NEW_HOME" "$NEW_ADMIN:$NEW_ADMIN:750"
  require_directory_metadata "$NEW_HOME/.ssh" "$NEW_ADMIN:$NEW_ADMIN:700"
  authorized_keys="$NEW_HOME/.ssh/authorized_keys"
  require_regular_metadata "$authorized_keys" "$NEW_ADMIN:$NEW_ADMIN:600"
  authorized_keys_sha="$(prepared_authorized_keys_sha)"
  [[ "$(sha256sum "$authorized_keys" | awk '{ print $1 }')" == "$authorized_keys_sha" ]] ||
    die 'the FetanAgent authorized_keys file differs from the prepared public-key receipt'
}

require_partial_new_identity() {
  local entry uid gid home shell password_status groups authorized_keys metadata ssh_entry ssh_listing
  entry="$(getent passwd "$NEW_ADMIN")" || die 'the partial FetanAgent deployment identity is absent'
  uid="$(cut -d: -f3 <<<"$entry")"
  gid="$(cut -d: -f4 <<<"$entry")"
  home="$(cut -d: -f6 <<<"$entry")"
  shell="$(cut -d: -f7 <<<"$entry")"
  [[ "$uid" =~ ^[0-9]+$ && "$uid" -ne 0 ]] || die 'the partial FetanAgent identity has an unsafe UID'
  [[ "$home" == "$NEW_HOME" && "$shell" == '/bin/bash' ]] ||
    die 'the partial FetanAgent identity has an unexpected home or shell'
  [[ "$(getent group "$NEW_ADMIN" | cut -d: -f3)" == "$gid" ]] ||
    die 'the partial FetanAgent identity does not use its dedicated primary group'
  password_status="$(passwd --status "$NEW_ADMIN" | awk '{ print $2 }')"
  [[ "$password_status" == 'L' ]] || die 'the partial FetanAgent identity password is not locked'
  groups="$(id -nG "$NEW_ADMIN")"
  [[ "$groups" == "$NEW_ADMIN" ]] || die 'the partial FetanAgent identity has supplemental groups'
  [[ ! -L "$NEW_HOME" && -d "$NEW_HOME" ]] || die 'the partial FetanAgent home is absent or symbolic'
  metadata="$(stat --format='%u:%g:%a' "$NEW_HOME")"
  [[ "$metadata" == "$uid:$gid:750" || "$metadata" == "$uid:$gid:755" ]] ||
    die 'the partial FetanAgent home has unexpected ownership or mode'
  require_new_home_contents_safe_to_remove

  if [[ -e "$NEW_HOME/.ssh" || -L "$NEW_HOME/.ssh" ]]; then
    [[ ! -L "$NEW_HOME/.ssh" && -d "$NEW_HOME/.ssh" ]] ||
      die 'the partial FetanAgent SSH directory is unsafe'
    [[ "$(stat --format='%u:%g:%a' "$NEW_HOME/.ssh")" == "$uid:$gid:700" ]] ||
      die 'the partial FetanAgent SSH directory has unexpected ownership or mode'
    ssh_listing="$(mktemp)"
    find "$NEW_HOME/.ssh" -mindepth 1 -maxdepth 1 -print0 >"$ssh_listing" || {
      rm -f -- "$ssh_listing"
      die 'the partial FetanAgent SSH inventory failed'
    }
    while IFS= read -r -d '' ssh_entry; do
      [[ "$ssh_entry" == "$NEW_HOME/.ssh/authorized_keys" ]] ||
        die "unexpected partial FetanAgent SSH artifact $ssh_entry"
    done <"$ssh_listing"
    rm -f -- "$ssh_listing"
    authorized_keys="$NEW_HOME/.ssh/authorized_keys"
    if [[ -e "$authorized_keys" || -L "$authorized_keys" ]]; then
      require_regular_metadata "$authorized_keys" "$NEW_ADMIN:$NEW_ADMIN:600"
      require_legacy_authorized_keys
      cmp -s -- "$(legacy_authorized_keys)" "$authorized_keys" ||
        die 'the partial FetanAgent authorized_keys file differs from the legacy source key'
    fi
  fi
}

require_exact_new_sudoers() {
  local temporary
  require_regular_metadata "$NEW_SUDOERS" 'root:root:440'
  temporary="$(mktemp)"
  expected_new_sudoers >"$temporary"
  cmp -s -- "$temporary" "$NEW_SUDOERS" || {
    rm -f -- "$temporary"
    die 'the FetanAgent sudoers fragment differs from the fixed transition contract'
  }
  rm -f -- "$temporary"
}

require_exact_new_sshd_dropin() {
  local temporary
  require_regular_metadata "$NEW_SSHD_DROPIN" 'root:root:644'
  temporary="$(mktemp)"
  expected_new_sshd_dropin >"$temporary"
  cmp -s -- "$temporary" "$NEW_SSHD_DROPIN" || {
    rm -f -- "$temporary"
    die 'the FetanAgent sshd fragment differs from the fixed transition contract'
  }
  rm -f -- "$temporary"
}

require_new_access_files() {
  require_new_helper
  require_exact_new_sudoers
  require_exact_new_sshd_dropin
  visudo -cf /etc/sudoers >/dev/null || die 'the installed sudoers policy is invalid'
  sshd -t || die 'the installed sshd policy is invalid'
}

require_prepared_contract() {
  require_prepared_marker
  require_new_identity
  require_new_access_files
}

legacy_sudoers_references() {
  local candidate inventory
  [[ ! -L /etc/sudoers && -f /etc/sudoers ]] || die '/etc/sudoers is absent, non-regular, or symbolic'
  [[ ! -L /etc/sudoers.d && -d /etc/sudoers.d ]] ||
    die '/etc/sudoers.d is absent, non-directory, or symbolic'
  for candidate in /etc/sudoers "$LEGACY_SUDOERS"; do
    [[ -e "$candidate" || -L "$candidate" ]] || continue
    [[ ! -L "$candidate" && -f "$candidate" ]] || die "$candidate is not a safe sudoers file"
    [[ "$candidate" != *$'\n'* ]] || die 'a sudoers path contains a forbidden newline'
    if [[ "$candidate" == "$LEGACY_SUDOERS" ]]; then
      printf '%s\n' "$candidate"
    elif grep -Fq -- "$LEGACY_ADMIN" "$candidate" || grep -Fq -- "$LEGACY_HELPER" "$candidate"; then
      printf '%s\n' "$candidate"
    fi
  done
  inventory="$(mktemp)"
  find /etc/sudoers.d -mindepth 1 -maxdepth 1 -print0 >"$inventory" || {
    rm -f -- "$inventory"
    die 'the sudoers fragment inventory failed'
  }
  while IFS= read -r -d '' candidate; do
    case "$candidate" in
      "$LEGACY_SUDOERS") continue ;;
    esac
    [[ ! -L "$candidate" && -f "$candidate" ]] ||
      { rm -f -- "$inventory"; die "refusing unsafe non-regular sudoers fragment $candidate"; }
    [[ "$candidate" != *$'\n'* ]] ||
      { rm -f -- "$inventory"; die 'a sudoers path contains a forbidden newline'; }
    if grep -Fq -- "$LEGACY_ADMIN" "$candidate" || grep -Fq -- "$LEGACY_HELPER" "$candidate"; then
      printf '%s\n' "$candidate"
    fi
  done <"$inventory"
  rm -f -- "$inventory"
}

expected_legacy_sudoers() {
  cat <<EOF
$LEGACY_ADMIN ALL=(root) NOPASSWD: $LEGACY_HELPER
EOF
}

require_legacy_sudoers_state() {
  local expected_state="$1"
  local count reference references temporary
  count='0'
  temporary="$(mktemp)"
  expected_legacy_sudoers >"$temporary"
  references="$(legacy_sudoers_references)" || {
    rm -f -- "$temporary"
    die 'the legacy sudoers reference inventory failed'
  }
  while IFS= read -r reference; do
    [[ -n "$reference" ]] || continue
    count="$((count + 1))"
    case "$reference" in
      "$LEGACY_SUDOERS") ;;
      *)
        rm -f -- "$temporary"
        die "legacy sudo permission remains in unapproved file $reference"
        ;;
    esac
    require_regular_metadata "$reference" 'root:root:440'
    cmp -s -- "$temporary" "$reference" || {
      rm -f -- "$temporary"
      die "refusing an unexpected legacy sudoers contract in $reference"
    }
  done <<<"$references"
  rm -f -- "$temporary"
  case "$expected_state" in
    present)
      [[ "$count" -eq 1 ]] || die 'the legacy sudo boundary must be exactly one fixed fragment'
      ;;
    present-or-absent)
      [[ "$count" -le 1 ]] || die 'the legacy sudo boundary has duplicate fixed fragments'
      ;;
    absent)
      [[ "$count" -eq 0 ]] || die 'legacy sudo permission remains'
      ;;
    *) die 'internal error: invalid legacy sudoers state' ;;
  esac
  visudo -cf /etc/sudoers >/dev/null || die 'the installed sudoers policy is invalid'
}

require_legacy_sudoers_boundary() {
  require_legacy_sudoers_state present
}

require_legacy_sudoers_boundary_or_absent() {
  require_legacy_sudoers_state present-or-absent
}

require_legacy_sudoers_absent() {
  require_legacy_sudoers_state absent
}

require_legacy_residue_absent() {
  local inventory residue units
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT")" ||
    die 'the legacy container inventory could not be inspected'
  [[ -z "$inventory" ]] || die 'legacy project containers remain'
  inventory="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT")" ||
    die 'the legacy network inventory could not be inspected'
  [[ -z "$inventory" ]] || die 'legacy project networks remain'

  units="$(systemctl list-units --all --full --plain --no-legend --no-pager | awk '{ print $1 }')" ||
    die 'loaded systemd units could not be inspected'
  ! grep -Fiq -- "$LEGACY_BRAND" <<<"$units" || die 'a legacy systemd unit remains loaded'
  units="$(systemctl list-unit-files --full --plain --no-legend --no-pager | awk '{ print $1 }')" ||
    die 'installed systemd unit files could not be inspected'
  ! grep -Fiq -- "$LEGACY_BRAND" <<<"$units" || die 'a legacy systemd unit file remains installed'

  [[ ! -L "$LEGACY_SECRET_ROOT" ]] || die 'the legacy secret root is symbolic'
  if [[ -e "$LEGACY_SECRET_ROOT" ]]; then
    [[ -d "$LEGACY_SECRET_ROOT" ]] || die 'the legacy secret root is not a directory'
    residue="$(find "$LEGACY_SECRET_ROOT" -mindepth 1 -print -quit)" ||
      die 'the legacy secret root could not be inspected'
    [[ -z "$residue" ]] || die 'legacy live secret files remain'
  fi
}

require_port_3002_free() {
  local sockets
  sockets="$(ss -ltnH)" || die 'the TCP listener inventory could not be inspected'
  if awk '$4 ~ /:3002$/ { found = 1 } END { exit !found }' <<<"$sockets"; then
    die 'TCP port 3002 is still in use during the stopped-runtime boundary'
  fi
}

require_legacy_authorized_keys_present_or_absent() {
  local authorized_keys
  authorized_keys="$(legacy_authorized_keys)"
  if [[ -e "$authorized_keys" || -L "$authorized_keys" ]]; then
    require_legacy_authorized_keys
  fi
}

require_legacy_authorized_keys_absent() {
  local authorized_keys
  authorized_keys="$(legacy_authorized_keys)"
  [[ ! -e "$authorized_keys" && ! -L "$authorized_keys" ]] ||
    die 'legacy authorized_keys remains after execution-boundary disable'
}

disable_legacy_execution_boundary() {
  local authorized_keys legacy_uid

  # Validate every removable artifact before the first mutation. Each item may
  # already be absent when resuming an interrupted disable.
  require_legacy_identity_for_disable
  require_legacy_sudoers_boundary_or_absent
  require_legacy_authorized_keys_present_or_absent
  legacy_uid="$(id -u "$LEGACY_ADMIN")"
  authorized_keys="$(legacy_authorized_keys)"

  if [[ -e "$LEGACY_SUDOERS" || -L "$LEGACY_SUDOERS" ]]; then
    require_legacy_sudoers_boundary
    rm -f -- "$LEGACY_SUDOERS"
  fi
  visudo -cf /etc/sudoers >/dev/null ||
    die 'sudoers validation failed while disabling the legacy execution boundary'

  if [[ -e "$authorized_keys" || -L "$authorized_keys" ]]; then
    require_legacy_authorized_keys
    rm -f -- "$authorized_keys"
  fi
  usermod --lock --shell /usr/sbin/nologin "$LEGACY_ADMIN"
  pkill -KILL -u "$legacy_uid" 2>/dev/null || [[ $? -eq 1 ]] ||
    die 'could not terminate legacy deployment sessions'

  require_legacy_execution_boundary_disabled
}

require_legacy_execution_boundary_disabled() {
  require_legacy_sudoers_absent
  require_legacy_authorized_keys_absent
  require_legacy_identity_disabled
  require_no_legacy_helper_processes
}

require_legacy_secret_root_absent() {
  [[ ! -e "$LEGACY_SECRET_ROOT" && ! -L "$LEGACY_SECRET_ROOT" ]] ||
    die 'the legacy live-secret directory remains after retirement'
}

require_new_runtime_healthy() {
  local commit_sha="$1"
  local service ids container_id state health revision services sockets
  local -a expected_services=(api beta-admission bot owner-control)

  services="$({
    docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$NEW_PROJECT" |
      while IFS= read -r container_id; do
        [[ -n "$container_id" ]] || continue
        docker_local container inspect "$container_id" \
          --format '{{ index .Config.Labels "com.docker.compose.service" }}'
      done
  } | sort)" || die 'the FetanAgent project service inventory could not be inspected'
  [[ "$services" == $'api\nbeta-admission\nbot\nowner-control' ]] ||
    die 'the private FetanAgent service set is not exact'

  for service in "${expected_services[@]}"; do
    ids="$(docker_local container ls --all --quiet \
      --filter "label=com.docker.compose.project=$NEW_PROJECT" \
      --filter "label=com.docker.compose.service=$service")" ||
      die "the $service container inventory could not be inspected"
    [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] || die "the $service container inventory is not singular"
    state="$(docker_local container inspect "$ids" --format '{{.State.Status}}')"
    [[ "$state" == 'running' ]] || die "$service is not running"
    revision="$(docker_local container inspect "$ids" \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
    [[ "$revision" == "$commit_sha" ]] || die "$service does not run the acknowledged commit"
    if [[ "$service" != 'bot' ]]; then
      health="$(docker_local container inspect "$ids" --format '{{.State.Health.Status}}')"
      [[ "$health" == 'healthy' ]] || die "$service is not healthy"
    fi
  done

  sockets="$(ss -ltnH)" || die 'the TCP listener inventory could not be inspected'
  awk '$4 == "127.0.0.1:3002" { found = 1 } END { exit !found }' <<<"$sockets" ||
    die 'Owner control is not listening on the required loopback address'
  if awk '$4 ~ /:3002$/ && $4 != "127.0.0.1:3002" { found = 1 } END { exit !found }' <<<"$sockets"; then
    die 'Owner control port 3002 is exposed beyond the required loopback address'
  fi
}

require_no_new_runtime_artifacts() {
  local inventory residue
  inventory="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$NEW_PROJECT")" ||
    die 'the FetanAgent container inventory could not be inspected'
  [[ -z "$inventory" ]] || die 'rollback is forbidden after a FetanAgent container exists'
  inventory="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$NEW_PROJECT")" ||
    die 'the FetanAgent network inventory could not be inspected'
  [[ -z "$inventory" ]] || die 'rollback is forbidden after a FetanAgent network exists'
  for candidate in "$NEW_RELEASE_ROOT" "$NEW_SECRET_ROOT"; do
    [[ ! -L "$candidate" ]] || die "$candidate is symbolic"
    if [[ -e "$candidate" ]]; then
      [[ -d "$candidate" ]] || die "$candidate is not a directory"
      residue="$(find "$candidate" -mindepth 1 -print -quit)"
      [[ -z "$residue" ]] || die "rollback is forbidden because $candidate is not empty"
    fi
  done
}

validate_rollback_prepare_state() {
  local authorized_keys commit_sha
  require_state_root_if_present
  require_no_new_runtime_artifacts
  require_legacy_identity
  require_legacy_authorized_keys
  require_legacy_sudoers_boundary

  if [[ -e "$PREPARED_MARKER" || -L "$PREPARED_MARKER" ]]; then
    require_prepared_contract
    require_new_home_contents_safe_to_remove
    authorized_keys="$NEW_HOME/.ssh/authorized_keys"
    cmp -s -- "$(legacy_authorized_keys)" "$authorized_keys" ||
      die 'the prepared FetanAgent authorized_keys file differs from the legacy source key'
    if [[ -e "$ACKNOWLEDGED_MARKER" || -L "$ACKNOWLEDGED_MARKER" ]]; then
      commit_sha="$(marker_commit "$ACKNOWLEDGED_MARKER")"
      require_acknowledged_marker "$commit_sha"
    fi
  else
    [[ ! -e "$ACKNOWLEDGED_MARKER" && ! -L "$ACKNOWLEDGED_MARKER" ]] ||
      die 'an acknowledgment receipt exists without the prepared receipt'
    if id "$NEW_ADMIN" >/dev/null 2>&1; then
      require_partial_new_identity
    else
      [[ ! -e "$NEW_HOME" && ! -L "$NEW_HOME" ]] ||
        die 'the FetanAgent home exists without its fixed deployment identity'
    fi
    if [[ -e "$NEW_HELPER" || -L "$NEW_HELPER" ]]; then
      require_new_helper
    fi
    if [[ -e "$NEW_SUDOERS" || -L "$NEW_SUDOERS" ]]; then
      require_exact_new_sudoers
    fi
    if [[ -e "$NEW_SSHD_DROPIN" || -L "$NEW_SSHD_DROPIN" ]]; then
      require_exact_new_sshd_dropin
    fi
  fi

  # The staged source is retained by rollback. When any prepared artifact is
  # live, it must independently match the pinned helper before access changes.
  if id "$NEW_ADMIN" >/dev/null 2>&1 ||
    [[ -e "$NEW_HELPER" || -L "$NEW_HELPER" || -e "$NEW_SUDOERS" || -L "$NEW_SUDOERS" ||
       -e "$NEW_SSHD_DROPIN" || -L "$NEW_SSHD_DROPIN" || -e "$PREPARED_MARKER" || -L "$PREPARED_MARKER" ]]; then
    require_new_helper_source
    if [[ -e "$NEW_HELPER" || -L "$NEW_HELPER" ]]; then
      cmp -s -- "$NEW_HELPER_SOURCE" "$NEW_HELPER" ||
        die 'the installed FetanAgent helper differs from its pinned staged source'
    fi
  elif [[ -e "$NEW_HELPER_SOURCE" || -L "$NEW_HELPER_SOURCE" ]]; then
    require_new_helper_source
  fi

  visudo -cf /etc/sudoers >/dev/null || die 'the installed sudoers policy is invalid before rollback'
  sshd -t || die 'the installed sshd policy is invalid before rollback'
}

install_exact_file() {
  local source="$1"
  local destination="$2"
  local mode="$3"
  local temporary
  temporary="$(mktemp "$(dirname "$destination")/.fetanagent-transition.XXXXXX")"
  install -o root -g root -m "$mode" "$source" "$temporary"
  mv -f -- "$temporary" "$destination"
}

reload_sshd() {
  sshd -t || die 'the proposed sshd policy is invalid'
  systemctl reload ssh || die 'the ssh service could not be safely reloaded'
}

inspect_transition() {
  local commit_sha containers networks secret_entries phase
  require_state_root_if_present
  if [[ -e "$RETIRED_MARKER" ]]; then
    commit_sha="$(marker_commit "$ACKNOWLEDGED_MARKER")"
    verify_retired_contract "$commit_sha"
    printf 'transition_version=%s\ndroplet_id=%s\npublic_ipv4=%s\nphase=retired\n' \
      "$TRANSITION_VERSION" "$DROPLET_ID" "$PUBLIC_IPV4"
    printf 'reviewed_commit=%s\nlegacy_access=retired\nfetanagent_runtime=verified\n' "$commit_sha"
    return
  fi

  phase='inspected'
  [[ ! -e "$PREPARED_MARKER" ]] || phase='prepared'
  [[ ! -e "$ACKNOWLEDGED_MARKER" ]] || phase='acknowledged'
  [[ ! -e "$LEGACY_STOPPED_MARKER" ]] || phase='legacy-stopped'
  if [[ "$phase" == 'legacy-stopped' ]]; then
    commit_sha="$(marker_commit "$ACKNOWLEDGED_MARKER")"
    require_prepared_contract
    require_acknowledged_marker "$commit_sha"
    require_legacy_stopped_marker "$commit_sha"
    require_legacy_residue_absent
    require_legacy_execution_boundary_disabled
    if [[ -e "$LEGACY_HELPER" || -L "$LEGACY_HELPER" ]]; then
      require_legacy_helper
    fi
  else
    require_legacy_identity
    require_legacy_helper
    require_legacy_authorized_keys
    require_legacy_sudoers_boundary
    [[ "$phase" == 'inspected' ]] || require_prepared_contract
    if [[ "$phase" == 'acknowledged' ]]; then
      commit_sha="$(marker_commit "$ACKNOWLEDGED_MARKER")"
      require_acknowledged_marker "$commit_sha"
    fi
  fi

  containers="$(docker_local container ls --all --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT" | sed '/^$/d' | wc -l)"
  networks="$(docker_local network ls --quiet \
    --filter "label=com.docker.compose.project=$LEGACY_PROJECT" | sed '/^$/d' | wc -l)"
  secret_entries='0'
  if [[ -e "$LEGACY_SECRET_ROOT" && ! -L "$LEGACY_SECRET_ROOT" && -d "$LEGACY_SECRET_ROOT" ]]; then
    secret_entries="$(find "$LEGACY_SECRET_ROOT" -mindepth 1 -maxdepth 1 -print | wc -l)"
  elif [[ -L "$LEGACY_SECRET_ROOT" ]]; then
    die 'the legacy secret root is symbolic'
  fi

  printf 'transition_version=%s\ndroplet_id=%s\npublic_ipv4=%s\nphase=%s\n' \
    "$TRANSITION_VERSION" "$DROPLET_ID" "$PUBLIC_IPV4" "$phase"
  printf 'legacy_helper=verified\nlegacy_containers=%s\nlegacy_networks=%s\nlegacy_secret_entries=%s\n' \
    "$containers" "$networks" "$secret_entries"
  if id "$NEW_ADMIN" >/dev/null 2>&1; then
    printf 'fetanagent_identity=present\n'
  else
    printf 'fetanagent_identity=absent\n'
  fi
}

prepare_transition() {
  local authorized_keys_sha new_uid new_gid temporary
  if [[ -e "$PREPARED_MARKER" ]]; then
    require_prepared_contract
    printf 'transition_phase=prepared\nresult=already-complete\n'
    return
  fi
  [[ ! -e "$ACKNOWLEDGED_MARKER" && ! -e "$LEGACY_STOPPED_MARKER" && ! -e "$RETIRED_MARKER" ]] ||
    die 'later transition state exists without the prepared receipt'
  ! id "$NEW_ADMIN" >/dev/null 2>&1 ||
    die 'the FetanAgent identity already exists without a prepared receipt; inspect and rollback the partial prepare'
  for candidate in "$NEW_HELPER" "$NEW_SUDOERS" "$NEW_SSHD_DROPIN"; do
    [[ ! -e "$candidate" && ! -L "$candidate" ]] ||
      die "$candidate already exists without a prepared receipt"
  done

  require_legacy_identity
  require_legacy_helper
  require_legacy_authorized_keys
  require_legacy_sudoers_boundary
  require_new_helper_source
  visudo -cf /etc/sudoers >/dev/null || die 'the existing sudoers policy is invalid'
  sshd -t || die 'the existing sshd policy is invalid'

  useradd --create-home --home-dir "$NEW_HOME" --shell /bin/bash --user-group "$NEW_ADMIN"
  passwd --lock "$NEW_ADMIN" >/dev/null
  new_uid="$(id -u "$NEW_ADMIN")"
  new_gid="$(id -g "$NEW_ADMIN")"
  chown "$new_uid:$new_gid" "$NEW_HOME"
  chmod 0750 "$NEW_HOME"
  install -d -o "$new_uid" -g "$new_gid" -m 0700 "$NEW_HOME/.ssh"
  install -o "$new_uid" -g "$new_gid" -m 0600 \
    "$(legacy_authorized_keys)" "$NEW_HOME/.ssh/authorized_keys"
  authorized_keys_sha="$(sha256sum "$NEW_HOME/.ssh/authorized_keys" | awk '{ print $1 }')"

  install_exact_file "$NEW_HELPER_SOURCE" "$NEW_HELPER" 0755
  require_new_helper

  temporary="$(mktemp)"
  expected_new_sudoers >"$temporary"
  visudo -cf "$temporary" >/dev/null || {
    rm -f -- "$temporary"
    die 'the proposed FetanAgent sudoers fragment is invalid'
  }
  install_exact_file "$temporary" "$NEW_SUDOERS" 0440
  rm -f -- "$temporary"
  visudo -cf /etc/sudoers >/dev/null || die 'the combined sudoers policy is invalid; run rollback-prepare from this console'

  temporary="$(mktemp)"
  expected_new_sshd_dropin >"$temporary"
  install_exact_file "$temporary" "$NEW_SSHD_DROPIN" 0644
  rm -f -- "$temporary"
  reload_sshd

  write_marker "$PREPARED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "authorized_keys_sha=$authorized_keys_sha" \
    "new_admin_uid=$new_uid" \
    'prepared=true'
  require_prepared_contract
  printf 'transition_phase=prepared\nresult=pass\nnext=verify-new-ssh-session\n'
}

acknowledge_transition() {
  local commit_sha="$1"
  require_commit "$commit_sha"
  require_prepared_contract
  [[ ! -e "$LEGACY_STOPPED_MARKER" && ! -e "$RETIRED_MARKER" ]] ||
    die 'the transition has already passed the acknowledgment boundary'
  if [[ -e "$ACKNOWLEDGED_MARKER" ]]; then
    require_acknowledged_marker "$commit_sha"
    printf 'transition_phase=acknowledged\nresult=already-complete\n'
    return
  fi
  write_marker "$ACKNOWLEDGED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "acknowledged_commit=$commit_sha" \
    'acknowledged=true'
  require_acknowledged_marker "$commit_sha"
  printf 'transition_phase=acknowledged\nreviewed_commit=%s\nnext=stop-legacy-through-legacy-sudo-boundary\n' "$commit_sha"
}

mark_legacy_stopped() {
  local commit_sha="$1"
  require_commit "$commit_sha"
  require_prepared_contract
  require_acknowledged_marker "$commit_sha"
  [[ ! -e "$RETIRED_MARKER" ]] || die 'the legacy boundary is already retired'
  if [[ -e "$LEGACY_STOPPED_MARKER" ]]; then
    require_legacy_stopped_marker "$commit_sha"
    require_legacy_residue_absent
    require_legacy_execution_boundary_disabled
    printf 'transition_phase=legacy-stopped\nresult=already-complete\n'
    return
  fi
  require_legacy_helper
  require_legacy_residue_absent
  require_port_3002_free
  disable_legacy_execution_boundary
  require_legacy_residue_absent
  require_port_3002_free
  require_legacy_execution_boundary_disabled
  write_marker "$LEGACY_STOPPED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "acknowledged_commit=$commit_sha" \
    'legacy_stopped=true'
  printf 'transition_phase=legacy-stopped\nreviewed_commit=%s\nnext=apply-role-rename-before-fetanagent-deploy\n' "$commit_sha"
}

rollback_prepare() {
  [[ ! -e "$LEGACY_STOPPED_MARKER" && ! -e "$RETIRED_MARKER" ]] ||
    die 'rollback-prepare is forbidden after the legacy-stopped boundary'
  validate_rollback_prepare_state

  # Drop the receipts only after complete prevalidation and before removing
  # access artifacts. An interrupted rollback then resumes through the strict
  # partial-prepare validation path instead of trusting a stale receipt.
  rm -f -- "$ACKNOWLEDGED_MARKER" "$PREPARED_MARKER"

  if [[ -e "$NEW_SSHD_DROPIN" || -L "$NEW_SSHD_DROPIN" ]]; then
    require_exact_new_sshd_dropin
    rm -f -- "$NEW_SSHD_DROPIN"
    reload_sshd
  fi

  if [[ -e "$NEW_SUDOERS" || -L "$NEW_SUDOERS" ]]; then
    require_exact_new_sudoers
    rm -f -- "$NEW_SUDOERS"
    visudo -cf /etc/sudoers >/dev/null || die 'sudoers validation failed after rollback'
  fi

  if [[ -e "$NEW_HELPER" || -L "$NEW_HELPER" ]]; then
    require_new_helper
    rm -f -- "$NEW_HELPER"
  fi

  if id "$NEW_ADMIN" >/dev/null 2>&1; then
    pkill -KILL -u "$(id -u "$NEW_ADMIN")" 2>/dev/null || [[ $? -eq 1 ]] ||
      die 'could not terminate the prepared FetanAgent identity sessions'
    userdel --remove "$NEW_ADMIN"
  fi

  if [[ -d "$STATE_ROOT" && ! -L "$STATE_ROOT" ]]; then
    rmdir -- "$STATE_ROOT" ||
      die 'the transition state directory contains unexpected residue after rollback'
  fi
  printf 'transition_phase=rolled-back\nresult=pass\nlegacy_runtime=untouched\n'
}

retire_legacy_boundary() {
  local commit_sha="$1"
  require_commit "$commit_sha"
  require_prepared_contract
  require_acknowledged_marker "$commit_sha"
  require_legacy_stopped_marker "$commit_sha"
  require_legacy_residue_absent
  require_new_runtime_healthy "$commit_sha"

  if [[ -e "$RETIRED_MARKER" ]]; then
    verify_retired_contract "$commit_sha"
    printf 'transition_phase=retired\nresult=already-complete\n'
    return
  fi

  # This is idempotent and also upgrades a legacy-stopped receipt created by an
  # older transition revision: old execution access is sealed before cleanup.
  disable_legacy_execution_boundary
  if [[ -e "$LEGACY_HELPER" || -L "$LEGACY_HELPER" ]]; then
    require_legacy_helper
  fi
  require_legacy_execution_boundary_disabled
  if [[ -e "$LEGACY_HELPER" || -L "$LEGACY_HELPER" ]]; then
    require_legacy_helper
    rm -f -- "$LEGACY_HELPER"
  fi

  if [[ -d "$LEGACY_SECRET_ROOT" && ! -L "$LEGACY_SECRET_ROOT" ]]; then
    rmdir -- "$LEGACY_SECRET_ROOT"
    rmdir -- "$(dirname "$LEGACY_SECRET_ROOT")" 2>/dev/null || true
  fi

  require_legacy_execution_boundary_disabled
  [[ ! -e "$LEGACY_HELPER" && ! -L "$LEGACY_HELPER" ]] || die 'the legacy helper remains'
  require_legacy_secret_root_absent

  write_marker "$RETIRED_MARKER" \
    "transition_version=$TRANSITION_VERSION" \
    "droplet_id=$DROPLET_ID" \
    "legacy_helper_sha=$LEGACY_HELPER_SHA" \
    "new_helper_sha=$NEW_HELPER_SHA" \
    "acknowledged_commit=$commit_sha" \
    'retired=true'
  printf 'transition_phase=retired\nreviewed_commit=%s\nresult=pass\nlegacy_secrets=removed\nlegacy_releases=retained\n' "$commit_sha"
}

verify_retired_contract() {
  local commit_sha="$1"
  require_retired_marker "$commit_sha"
  require_prepared_contract
  require_acknowledged_marker "$commit_sha"
  require_legacy_stopped_marker "$commit_sha"
  require_legacy_residue_absent
  require_legacy_execution_boundary_disabled
  require_new_runtime_healthy "$commit_sha"
  [[ ! -e "$LEGACY_HELPER" && ! -L "$LEGACY_HELPER" ]] || die 'the legacy helper remains after retirement'
  require_legacy_secret_root_absent
}

verify_transition() {
  local commit_sha phase
  require_state_root_if_present
  phase='inspected'
  if [[ -e "$PREPARED_MARKER" ]]; then
    require_prepared_contract
    phase='prepared'
  fi
  if [[ -e "$ACKNOWLEDGED_MARKER" ]]; then
    commit_sha="$(marker_commit "$ACKNOWLEDGED_MARKER")"
    require_acknowledged_marker "$commit_sha"
    phase='acknowledged'
  fi
  if [[ -e "$LEGACY_STOPPED_MARKER" ]]; then
    [[ -n "${commit_sha:-}" ]] || die 'legacy-stopped exists without acknowledgment'
    require_legacy_stopped_marker "$commit_sha"
    require_legacy_residue_absent
    require_legacy_execution_boundary_disabled
    phase='legacy-stopped'
  fi
  if [[ -e "$RETIRED_MARKER" ]]; then
    [[ -n "${commit_sha:-}" ]] || die 'retired exists without acknowledgment'
    verify_retired_contract "$commit_sha"
    phase='retired'
  fi
  printf 'transition_verification=pass\nphase=%s\n' "$phase"
  [[ -z "${commit_sha:-}" ]] || printf 'reviewed_commit=%s\n' "$commit_sha"
}

main() {
  require_root_console
  require_finalized_new_helper_hash
  require_exact_droplet
  for required in awk basename cmp curl cut docker find flock getent grep id install mktemp passwd pgrep pkill readlink sed sha256sum ss sshd stat systemctl useradd userdel usermod visudo; do
    require_command "$required"
  done

  exec 9>"/run/lock/fetanagent-vm-transition.lock"
  flock --exclusive --nonblock 9 || die 'another VM transition operation is already running'

  local command="${1:-}"
  case "$command" in
    inspect)
      [[ $# -eq 1 ]] || die 'inspect accepts no additional arguments'
      inspect_transition
      ;;
    prepare)
      [[ $# -eq 1 ]] || die 'prepare accepts no additional arguments'
      prepare_transition
      ;;
    acknowledge)
      [[ $# -eq 2 ]] || die 'acknowledge requires the reviewed main commit'
      acknowledge_transition "$2"
      ;;
    mark-legacy-stopped)
      [[ $# -eq 2 ]] || die 'mark-legacy-stopped requires the acknowledged main commit'
      mark_legacy_stopped "$2"
      ;;
    rollback-prepare)
      [[ $# -eq 1 ]] || die 'rollback-prepare accepts no additional arguments'
      rollback_prepare
      ;;
    retire)
      [[ $# -eq 2 ]] || die 'retire requires the acknowledged main commit'
      retire_legacy_boundary "$2"
      ;;
    verify)
      [[ $# -eq 1 ]] || die 'verify accepts no additional arguments'
      verify_transition
      ;;
    -h | --help)
      usage
      ;;
    *)
      usage >&2
      die 'expected inspect, prepare, acknowledge, mark-legacy-stopped, rollback-prepare, retire, or verify'
      ;;
  esac
}

main "$@"
