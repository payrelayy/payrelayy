#!/usr/bin/env bash
# One-time root-console bootstrap for the checksum-bound companion pairing deployment capability.

set -euo pipefail

readonly EXPECTED_HELPER_SHA256='9350241bf8b648c71c97715a1e361afd156d5c1f9b945ec10fb16e42394679a8'
readonly PREVIOUS_HELPER_SHA256='fcc648e741b4d0e5d31f33541a12c4a4ad610f43d4c97626dafb3ce904432795'
readonly SOURCE='/root/fetanagent-companion-device-pairing-helper.sh'
readonly TARGET='/usr/local/sbin/fetanagent-companion-device-pairing-helper'
readonly TARGET_INSTALLING='/usr/local/sbin/.fetanagent-companion-device-pairing-helper.installing'
readonly TARGET_PREVIOUS='/usr/local/sbin/.fetanagent-companion-device-pairing-helper.previous'
readonly SUDOERS='/etc/sudoers.d/fetanagent-companion-device-pairing-helper'
readonly SUDOERS_INSTALLING='/etc/sudoers.d/.fetanagent-companion-device-pairing-helper.installing'
readonly SUDOERS_PREVIOUS='/etc/sudoers.d/.fetanagent-companion-device-pairing-helper.previous'
readonly DEPLOY_USER='fetanagent-admin'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export PATH="$SAFE_PATH"

die() {
  printf 'companion pairing helper installer failed: %s\n' "$1" >&2
  exit 1
}

sudoers_for_digest() {
  local digest="$1"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' \
    "$DEPLOY_USER ALL=(root) NOPASSWD: sha256:$digest $TARGET *"
}

expected_sudoers() {
  sudoers_for_digest "$EXPECTED_HELPER_SHA256"
}

require_installed_state_for_digest() {
  local digest="$1"
  [[ ! -L "$TARGET" && -f "$TARGET" && "$(realpath -- "$TARGET")" == "$TARGET" &&
    "$(stat --format='%U:%G:%a:%h' "$TARGET")" == 'root:root:755:1' &&
    "$(sha256sum "$TARGET" | awk '{print $1}')" == "$digest" ]] || return 1
  [[ ! -L "$SUDOERS" && -f "$SUDOERS" && "$(realpath -- "$SUDOERS")" == "$SUDOERS" &&
    "$(stat --format='%U:%G:%a' "$SUDOERS")" == 'root:root:440' ]] || return 1
  cmp -s -- "$SUDOERS" <(sudoers_for_digest "$digest") || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
}

require_exact_installed_state() {
  require_installed_state_for_digest "$EXPECTED_HELPER_SHA256"
}

require_previous_backup_state() {
  [[ ! -L "$TARGET_PREVIOUS" && -f "$TARGET_PREVIOUS" &&
    "$(stat --format='%U:%G:%a:%h' "$TARGET_PREVIOUS")" == 'root:root:755:1' &&
    "$(sha256sum "$TARGET_PREVIOUS" | awk '{print $1}')" == "$PREVIOUS_HELPER_SHA256" ]] ||
    return 1
  [[ ! -L "$SUDOERS_PREVIOUS" && -f "$SUDOERS_PREVIOUS" &&
    "$(stat --format='%U:%G:%a' "$SUDOERS_PREVIOUS")" == 'root:root:440' ]] || return 1
  cmp -s -- "$SUDOERS_PREVIOUS" <(sudoers_for_digest "$PREVIOUS_HELPER_SHA256") || return 1
  visudo -cf "$SUDOERS_PREVIOUS" >/dev/null || return 1
}

[[ $EUID -eq 0 && -z "${SUDO_USER:-}" ]] ||
  die 'run this installer directly in the authenticated DigitalOcean root console'
[[ "$EXPECTED_HELPER_SHA256" =~ ^[0-9a-f]{64}$ ]] || die 'the embedded helper digest is invalid'
[[ "$PREVIOUS_HELPER_SHA256" =~ ^[0-9a-f]{64}$ &&
  "$PREVIOUS_HELPER_SHA256" != "$EXPECTED_HELPER_SHA256" ]] ||
  die 'the embedded predecessor helper digest is invalid'
[[ ! -L /usr/local/sbin && -d /usr/local/sbin &&
  "$(realpath -- /usr/local/sbin)" == '/usr/local/sbin' ]] ||
  die 'the system helper directory is unsafe'
[[ ! -L /etc/sudoers.d && -d /etc/sudoers.d && "$(realpath -- /etc/sudoers.d)" == '/etc/sudoers.d' ]] ||
  die 'the sudoers fragment directory is unsafe'
id "$DEPLOY_USER" >/dev/null 2>&1 || die 'the dedicated deployment identity does not exist'
[[ ! -L "$SOURCE" && -f "$SOURCE" && "$(realpath -- "$SOURCE")" == "$SOURCE" &&
  "$(stat --format='%U:%G:%a' "$SOURCE")" == 'root:root:600' ]] ||
  die 'the root-staged helper source is absent or unsafe'
[[ "$(sha256sum "$SOURCE" | awk '{print $1}')" == "$EXPECTED_HELPER_SHA256" ]] ||
  die 'the root-staged helper does not match the reviewed digest'
bash -n "$SOURCE" || die 'the reviewed helper does not parse as Bash'

install_mode='fresh'
if [[ -e "$TARGET" || -L "$TARGET" || -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  if require_exact_installed_state; then
    printf '%s\n' 'The exact companion pairing deployment helper is already installed.'
    exit 0
  fi
  require_installed_state_for_digest "$PREVIOUS_HELPER_SHA256" ||
    die 'a conflicting helper or sudoers fragment already exists'
  install_mode='upgrade'
fi
[[ ! -e "$TARGET_INSTALLING" && ! -L "$TARGET_INSTALLING" &&
  ! -e "$SUDOERS_INSTALLING" && ! -L "$SUDOERS_INSTALLING" &&
  ! -e "$TARGET_PREVIOUS" && ! -L "$TARGET_PREVIOUS" &&
  ! -e "$SUDOERS_PREVIOUS" && ! -L "$SUDOERS_PREVIOUS" ]] ||
  die 'an interrupted helper installation remains'

cleanup_failed_install() {
  local status=$?
  trap - EXIT
  set +e
  rm -f -- "$TARGET_INSTALLING" "$SUDOERS_INSTALLING"
  if [[ "$install_mode" == 'upgrade' ]] && require_previous_backup_state; then
    mv -f -- "$TARGET_PREVIOUS" "$TARGET"
    mv -f -- "$SUDOERS_PREVIOUS" "$SUDOERS"
    sync -f /usr/local/sbin
    sync -f /etc/sudoers.d
    require_installed_state_for_digest "$PREVIOUS_HELPER_SHA256" ||
      printf '%s\n' 'The predecessor helper could not be restored automatically.' >&2
  else
    rm -f -- "$TARGET_PREVIOUS" "$SUDOERS_PREVIOUS"
    if [[ -f "$SUDOERS" && ! -L "$SUDOERS" ]] && cmp -s -- "$SUDOERS" <(expected_sudoers); then
      rm -f -- "$SUDOERS"
    fi
    if [[ -f "$TARGET" && ! -L "$TARGET" &&
      "$(sha256sum "$TARGET" | awk '{print $1}')" == "$EXPECTED_HELPER_SHA256" ]]; then
      rm -f -- "$TARGET"
    fi
  fi
  exit "$status"
}
trap cleanup_failed_install EXIT

install -o root -g root -m 0755 "$SOURCE" "$TARGET_INSTALLING"
expected_sudoers >"$SUDOERS_INSTALLING"
chown root:root "$SUDOERS_INSTALLING"
chmod 0440 "$SUDOERS_INSTALLING"
visudo -cf "$SUDOERS_INSTALLING" >/dev/null
if [[ "$install_mode" == 'upgrade' ]]; then
  install -o root -g root -m 0755 "$TARGET" "$TARGET_PREVIOUS"
  install -o root -g root -m 0440 "$SUDOERS" "$SUDOERS_PREVIOUS"
  require_previous_backup_state || die 'the predecessor helper backup failed attestation'
fi
mv -f -- "$TARGET_INSTALLING" "$TARGET"
mv -f -- "$SUDOERS_INSTALLING" "$SUDOERS"
sync -f /usr/local/sbin
sync -f /etc/sudoers.d
require_exact_installed_state || die 'the installed companion deployment capability failed attestation'
trap - EXIT
rm -f -- "$TARGET_PREVIOUS" "$SUDOERS_PREVIOUS"
sync -f /usr/local/sbin
sync -f /etc/sudoers.d

if [[ "$install_mode" == 'upgrade' ]]; then
  printf '%s\n' 'Upgraded the checksum-bound companion pairing deployment helper; no application was started.'
else
  printf '%s\n' 'Installed the checksum-bound companion pairing deployment helper; no application was started.'
fi
