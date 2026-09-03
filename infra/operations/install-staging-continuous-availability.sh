#!/usr/bin/env bash
# Install one checksum-bound, non-financial deployment capability from reviewed root staging.
set -euo pipefail
export PATH='/usr/sbin:/usr/bin:/sbin:/bin'
umask 077
die() { printf '%s\n' "$1" >&2; exit 1; }
[[ $# -eq 2 && "$(id -u)" == 0 && -z "${SUDO_USER:-}" ]] || die 'Use the trusted root session with the staging directory and reviewed finalizer digest.'
readonly STAGED="$1" EXPECTED_SHA="$2"
readonly TARGET='/usr/local/sbin/fetanagent-staging-continuous-availability'
readonly SUDOERS='/etc/sudoers.d/fetanagent-staging-continuous-availability'
readonly LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly LOCK="$LOCK_ROOT/mutation.lock"
[[ "$STAGED" =~ ^/run/fetanagent-continuity-install-[0-9a-f]{40}$ && "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] ||
  die 'The source directory or reviewed digest is invalid.'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 5 http://169.254.169.254/metadata/v1/id)" == 593344964 ]] ||
  die 'This is not the approved staging Droplet.'
[[ ! -L "$STAGED" && -d "$STAGED" && "$(realpath -- "$STAGED")" == "$STAGED" &&
  "$(stat --format='%U:%G:%a' "$STAGED")" == 'root:root:700' ]] || die 'The reviewed staging directory is unsafe.'
for file in finalizer.sh finalizer.sudoers; do
  [[ ! -L "$STAGED/$file" && -f "$STAGED/$file" &&
    "$(stat --format='%U:%G:%a:%h' "$STAGED/$file")" == 'root:root:600:1' ]] || die 'A reviewed source file is unsafe.'
done
[[ "$(sha256sum "$STAGED/finalizer.sh" | awk '{print $1}')" == "$EXPECTED_SHA" ]] || die 'The finalizer digest does not match the reviewed source.'
bash -n "$STAGED/finalizer.sh"
cmp -s "$STAGED/finalizer.sudoers" <(printf '%s\n' \
  "fetanagent-admin ALL=(root) NOPASSWD: sha256:$EXPECTED_SHA $TARGET disable-expiry *") ||
  die 'The sudo capability is not the single exact checksum-bound finalizer command.'
visudo -cf "$STAGED/finalizer.sudoers" >/dev/null
visudo -c >/dev/null

[[ ! -L "$LOCK_ROOT" && "$(stat --format='%U:%G:%a' "$LOCK_ROOT")" == 'root:root:700' &&
  ! -L "$LOCK" && -f "$LOCK" && "$(stat --format='%U:%G:%a:%h' "$LOCK")" == 'root:root:600:1' ]] ||
  die 'The existing deployment lock is unsafe.'
exec 9<>"$LOCK"
lock_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")"
[[ "$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)" == "$lock_identity" ]] || die 'The opened deployment lock changed.'
flock --exclusive --nonblock 9 || die 'Another deployment operation is active.'
[[ "$(stat --format='%u:%g:%a:%h:%d:%i' "$LOCK")" == "$lock_identity" ]] || die 'The deployment lock changed while acquiring it.'

verify_installed() {
  local path="$1" source="$2" mode="$3"
  [[ ! -L "$path" && -f "$path" && "$(stat --format='%U:%G:%a:%h' "$path")" == "root:root:$mode:1" ]] &&
    cmp -s "$path" "$source"
}
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  verify_installed "$TARGET" "$STAGED/finalizer.sh" 755 || die 'A different finalizer already exists; no files were replaced.'
fi
if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
  verify_installed "$SUDOERS" "$STAGED/finalizer.sudoers" 440 || die 'A different sudo capability already exists; no files were replaced.'
fi
if [[ ! -e "$TARGET" ]]; then install -o root -g root -m 0755 "$STAGED/finalizer.sh" "$TARGET"; fi
verify_installed "$TARGET" "$STAGED/finalizer.sh" 755 || die 'The installed finalizer did not verify.'
if [[ ! -e "$SUDOERS" ]]; then install -o root -g root -m 0440 "$STAGED/finalizer.sudoers" "$SUDOERS"; fi
verify_installed "$SUDOERS" "$STAGED/finalizer.sudoers" 440 || die 'The installed sudo capability did not verify.'
visudo -c >/dev/null
printf '%s\n' 'Installed one checksum-bound disable-expiry capability; no credentials, running services, or legacy helper were changed.'
