#!/usr/bin/env bash
# One-time root-console bootstrap for the checksum-bound companion pairing deployment capability.

set -euo pipefail

readonly EXPECTED_HELPER_SHA256='b541bed882ed3a9209caeb9aea9829d4436d508b2975e317c1f9f9323d05d5a3'
readonly SOURCE='/root/fetanagent-companion-device-pairing-helper.sh'
readonly TARGET='/usr/local/sbin/fetanagent-companion-device-pairing-helper'
readonly TARGET_INSTALLING='/usr/local/sbin/.fetanagent-companion-device-pairing-helper.installing'
readonly SUDOERS='/etc/sudoers.d/fetanagent-companion-device-pairing-helper'
readonly SUDOERS_INSTALLING='/etc/sudoers.d/.fetanagent-companion-device-pairing-helper.installing'
readonly DEPLOY_USER='fetanagent-admin'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export PATH="$SAFE_PATH"

die() {
  printf 'companion pairing helper installer failed: %s\n' "$1" >&2
  exit 1
}

expected_sudoers() {
  printf '%s\n' \
    "$DEPLOY_USER ALL=(root) NOPASSWD: sha256:$EXPECTED_HELPER_SHA256 $TARGET *"
}

require_exact_installed_state() {
  [[ ! -L "$TARGET" && -f "$TARGET" && "$(realpath -- "$TARGET")" == "$TARGET" &&
    "$(stat --format='%U:%G:%a' "$TARGET")" == 'root:root:755' &&
    "$(sha256sum "$TARGET" | awk '{print $1}')" == "$EXPECTED_HELPER_SHA256" ]] || return 1
  [[ ! -L "$SUDOERS" && -f "$SUDOERS" && "$(realpath -- "$SUDOERS")" == "$SUDOERS" &&
    "$(stat --format='%U:%G:%a' "$SUDOERS")" == 'root:root:440' ]] || return 1
  cmp -s -- "$SUDOERS" <(expected_sudoers) || return 1
  visudo -cf /etc/sudoers >/dev/null || return 1
}

[[ $EUID -eq 0 && -z "${SUDO_USER:-}" ]] ||
  die 'run this installer directly in the authenticated DigitalOcean root console'
[[ "$EXPECTED_HELPER_SHA256" =~ ^[0-9a-f]{64}$ ]] || die 'the embedded helper digest is invalid'
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

if [[ -e "$TARGET" || -L "$TARGET" || -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  require_exact_installed_state || die 'a conflicting helper or sudoers fragment already exists'
  printf '%s\n' 'The exact companion pairing deployment helper is already installed.'
  exit 0
fi
[[ ! -e "$TARGET_INSTALLING" && ! -L "$TARGET_INSTALLING" &&
  ! -e "$SUDOERS_INSTALLING" && ! -L "$SUDOERS_INSTALLING" ]] ||
  die 'an interrupted helper installation remains'

cleanup_failed_install() {
  local status=$?
  trap - EXIT
  rm -f -- "$TARGET_INSTALLING" "$SUDOERS_INSTALLING"
  if [[ -f "$SUDOERS" && ! -L "$SUDOERS" ]] && cmp -s -- "$SUDOERS" <(expected_sudoers); then
    rm -f -- "$SUDOERS"
  fi
  if [[ -f "$TARGET" && ! -L "$TARGET" &&
    "$(sha256sum "$TARGET" | awk '{print $1}')" == "$EXPECTED_HELPER_SHA256" ]]; then
    rm -f -- "$TARGET"
  fi
  exit "$status"
}
trap cleanup_failed_install EXIT

install -o root -g root -m 0755 "$SOURCE" "$TARGET_INSTALLING"
expected_sudoers >"$SUDOERS_INSTALLING"
chown root:root "$SUDOERS_INSTALLING"
chmod 0440 "$SUDOERS_INSTALLING"
visudo -cf "$SUDOERS_INSTALLING" >/dev/null
mv -- "$TARGET_INSTALLING" "$TARGET"
mv -- "$SUDOERS_INSTALLING" "$SUDOERS"
sync -f /usr/local/sbin
sync -f /etc/sudoers.d
require_exact_installed_state || die 'the installed companion deployment capability failed attestation'

trap - EXIT
printf '%s\n' 'Installed the checksum-bound companion pairing deployment helper; no application was started.'
