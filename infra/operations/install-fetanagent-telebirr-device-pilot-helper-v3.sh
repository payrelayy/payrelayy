#!/usr/bin/env bash
# One-time root-console rotation for the staging TeleBirr device-pilot helper.
# It changes only the checksum-bound helper executable; it never touches Docker or PostgreSQL.

set -euo pipefail

readonly EXPECTED_HELPER_SHA256='f8a83549ad36992c1921e42cc77ee86f1f5144ec51df9623077835d6ec11a11e'
readonly PREVIOUS_HELPER_SHA256='344462ff1cf9fd445440aca4808bb412dff8fef03bba38092ed05ea0e7db2985'
readonly STAGING_ROOT='/root/fetanagent-telebirr-device-pilot-helper-v3'
readonly SOURCE="$STAGING_ROOT/fetanagent-telebirr-device-pilot-helper.sh"
readonly INSTALLER="$STAGING_ROOT/install-fetanagent-telebirr-device-pilot-helper-v3.sh"
readonly TARGET='/usr/local/sbin/fetanagent-telebirr-device-pilot-helper'
readonly TARGET_INSTALLING='/usr/local/sbin/.fetanagent-telebirr-device-pilot-helper.installing'
readonly TARGET_PREVIOUS='/usr/local/sbin/.fetanagent-telebirr-device-pilot-helper.previous'
readonly SUDOERS='/etc/sudoers.d/fetanagent-telebirr-device-pilot'
readonly MUTATION_ROOT='/run/fetanagent-telebirr-device-pilot-helper'
readonly MUTATION_LOCK="$MUTATION_ROOT/mutation.lock"
readonly DEPLOY_USER='fetanagent-admin'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly EXPECTED_SUDOERS='fetanagent-admin ALL=(root) NOPASSWD: /usr/local/sbin/fetanagent-telebirr-device-pilot-helper *'

export PATH="$SAFE_PATH"

die() {
  printf 'TeleBirr device-pilot helper installer failed: %s\n' "$1" >&2
  exit 1
}

require_helper_digest() {
  local path="$1" digest="$2" mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$mode:1" &&
    "$(sha256sum -- "$path" | awk '{print $1}')" == "$digest" ]]
}

require_sudoers() {
  [[ ! -L "$SUDOERS" && -f "$SUDOERS" && "$(realpath -- "$SUDOERS")" == "$SUDOERS" &&
    "$(stat --format='%U:%G:%a:%h' "$SUDOERS")" == 'root:root:440:1' ]] || return 1
  [[ "$(<"$SUDOERS")" == "$EXPECTED_SUDOERS" ]] || return 1
  visudo -cf "$SUDOERS" >/dev/null
}

acquire_mutation_lock() {
  local path_identity fd_identity
  command -v flock >/dev/null 2>&1 || die 'flock is unavailable'
  if [[ ! -e "$MUTATION_ROOT" && ! -L "$MUTATION_ROOT" ]]; then
    install -d -o root -g root -m 0700 "$MUTATION_ROOT"
  fi
  [[ ! -L "$MUTATION_ROOT" && -d "$MUTATION_ROOT" &&
    "$(realpath -- "$MUTATION_ROOT")" == "$MUTATION_ROOT" &&
    "$(stat --format='%U:%G:%a' "$MUTATION_ROOT")" == 'root:root:700' ]] ||
    die 'the shared mutation-lock directory is unsafe'
  if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$MUTATION_LOCK" && -f "$MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" == 'root:root:600:1' ]] ||
    die 'the shared mutation-lock file is unsafe'
  exec 9<>"$MUTATION_LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
  [[ "$path_identity" == "$fd_identity" ]] || die 'the mutation-lock inode changed'
  flock --exclusive --nonblock 9 || die 'a TeleBirr deployment mutation is active'
}

[[ "$EUID" -eq 0 && -z "${SUDO_USER:-}" ]] ||
  die 'run directly in the authenticated DigitalOcean root console'
for command in awk bash find flock id install mv realpath rm sha256sum sort stat sync visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is unavailable: $command"
done
[[ "$EXPECTED_HELPER_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$PREVIOUS_HELPER_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$EXPECTED_HELPER_SHA256" != "$PREVIOUS_HELPER_SHA256" ]] ||
  die 'an embedded helper digest is invalid'
[[ ! -L "$STAGING_ROOT" && -d "$STAGING_ROOT" &&
  "$(realpath -- "$STAGING_ROOT")" == "$STAGING_ROOT" &&
  "$(stat --format='%U:%G:%a' "$STAGING_ROOT")" == 'root:root:700' ]] ||
  die 'the root staging directory is absent or unsafe'
[[ "$0" == "$INSTALLER" && ! -L "$INSTALLER" && -f "$INSTALLER" &&
  "$(realpath -- "$INSTALLER")" == "$INSTALLER" &&
  "$(stat --format='%U:%G:%a:%h' "$INSTALLER")" == 'root:root:700:1' ]] ||
  die 'the root-staged installer path or metadata is unsafe'
[[ "$(find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | sort)" == \
  $'fetanagent-telebirr-device-pilot-helper.sh:f\ninstall-fetanagent-telebirr-device-pilot-helper-v3.sh:f' ]] ||
  die 'the root staging directory inventory is not exact'
require_helper_digest "$SOURCE" "$EXPECTED_HELPER_SHA256" 600 ||
  die 'the root-staged successor helper is absent or not the reviewed bytes'
bash -n "$SOURCE" || die 'the successor helper does not parse as Bash'
require_sudoers || die 'the existing delegated sudo capability is not exact'
id "$DEPLOY_USER" >/dev/null 2>&1 || die 'the deployment identity is absent'

acquire_mutation_lock
target_state='invalid'
previous_state='invalid'
installing_state='invalid'
if require_helper_digest "$TARGET" "$PREVIOUS_HELPER_SHA256" 755; then
  target_state='predecessor'
elif require_helper_digest "$TARGET" "$EXPECTED_HELPER_SHA256" 755; then
  target_state='successor'
fi
if [[ ! -e "$TARGET_PREVIOUS" && ! -L "$TARGET_PREVIOUS" ]]; then
  previous_state='absent'
elif require_helper_digest "$TARGET_PREVIOUS" "$PREVIOUS_HELPER_SHA256" 755; then
  previous_state='predecessor'
fi
if [[ ! -e "$TARGET_INSTALLING" && ! -L "$TARGET_INSTALLING" ]]; then
  installing_state='absent'
elif require_helper_digest "$TARGET_INSTALLING" "$EXPECTED_HELPER_SHA256" 755; then
  installing_state='successor'
fi

case "$target_state:$previous_state:$installing_state" in
  successor:absent:absent)
    printf '%s\n' 'The exact staging TeleBirr device-pilot helper is already installed.'
    exit 0
    ;;
  successor:predecessor:absent)
    require_sudoers || die 'the sudo capability changed during the interrupted rotation'
    rm -f -- "$TARGET_PREVIOUS"
    sync -f /usr/local/sbin
    printf '%s\n' \
      'Completed the exact interrupted staging TeleBirr device-pilot helper rotation.'
    exit 0
    ;;
  predecessor:absent:absent)
    install -o root -g root -m 0755 "$TARGET" "$TARGET_PREVIOUS"
    require_helper_digest "$TARGET_PREVIOUS" "$PREVIOUS_HELPER_SHA256" 755 ||
      die 'the predecessor backup failed attestation'
    ;;
  predecessor:predecessor:absent) ;;
  predecessor:predecessor:successor) ;;
  *) die 'the helper rotation topology is unknown; preserve every artifact for review' ;;
esac

if [[ "$installing_state" == 'absent' ]]; then
  install -o root -g root -m 0755 "$SOURCE" "$TARGET_INSTALLING"
fi
require_helper_digest "$TARGET_INSTALLING" "$EXPECTED_HELPER_SHA256" 755 ||
  die 'the staged successor failed attestation'

restore_predecessor() {
  local status=$?
  trap - EXIT
  set +e
  if require_helper_digest "$TARGET_PREVIOUS" "$PREVIOUS_HELPER_SHA256" 755; then
    mv -f -- "$TARGET_PREVIOUS" "$TARGET"
    sync -f /usr/local/sbin
  fi
  if require_helper_digest "$TARGET_INSTALLING" "$EXPECTED_HELPER_SHA256" 755; then
    rm -f -- "$TARGET_INSTALLING"
  fi
  exit "$status"
}
trap restore_predecessor EXIT

mv -f -- "$TARGET_INSTALLING" "$TARGET"
sync -f /usr/local/sbin
require_helper_digest "$TARGET" "$EXPECTED_HELPER_SHA256" 755 ||
  die 'the installed successor failed attestation'
require_sudoers || die 'the sudo capability changed during helper rotation'
trap - EXIT
rm -f -- "$TARGET_PREVIOUS"
sync -f /usr/local/sbin

printf '%s\n' \
  'Rotated the staging TeleBirr device-pilot helper; no container, network, database role, or financial control changed.'
