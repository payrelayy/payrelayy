#!/usr/bin/env bash
set -euo pipefail

# Exercise the installed helper's real handoff functions in an isolated root
# container. No production path, network, service, or database is accessible.
helper="$(dirname "$0")/fetanagent-production-deploy-helper-v2.sh"
test_root="$(mktemp -d -p /tmp)"
[[ "$test_root" == /tmp/* ]] || exit 1
trap 'rm -rf -- "$test_root"' EXIT

STATE_ROOT="$test_root/state"
ROUTINE_DEPOSITS_MARKER="$STATE_ROOT/routine-deposits.release"
COMPANION_EXECUTION_V2_MARKER="$STATE_ROOT/companion-execution-v2.release"
CBE_LIVE_PREDECESSOR_SHA='906b5b6a6486a26450d302b9f911feb3e35d30e4'
next_sha='1111111111111111111111111111111111111111'
previous="$test_root/releases/$CBE_LIVE_PREDECESSOR_SHA"
successor="$test_root/releases/$next_sha"
install -d -m 0700 "$STATE_ROOT" "$previous" "$successor"
touch "$previous/material" "$successor/material"
printf '%s\n' "$CBE_LIVE_PREDECESSOR_SHA" |
  install -o root -g root -m 0600 /dev/stdin "$ROUTINE_DEPOSITS_MARKER"

die() { printf 'routine marker handoff test: %s\n' "$*" >&2; exit 1; }
require_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die 'invalid SHA'; }
require_release() {
  require_sha "$1"
  [[ -d "$test_root/releases/$1" ]] || die 'release absent'
  printf '%s\n' "$test_root/releases/$1"
}
release_deployment_mode() { printf 'inert-maintenance\n'; }
validate_routine_deposit_material() { [[ -f "$1/material" ]] || die 'material absent'; }

source <(sed -n '/^routine_deposits_enabled_for_release() {/,/^}/p' "$helper")
source <(sed -n '/^require_routine_marker() {/,/^}/p' "$helper")
source <(sed -n '/^bind_routine_marker() {/,/^}/p' "$helper")
source <(sed -n '/^handoff_routine_marker() {/,/^}/p' "$helper")
source <(sed -n '/^restore_routine_marker_for_rollback() {/,/^}/p' "$helper")
declare -F require_routine_marker bind_routine_marker handoff_routine_marker \
  restore_routine_marker_for_rollback >/dev/null

chmod 0644 "$ROUTINE_DEPOSITS_MARKER"
if (handoff_routine_marker "$next_sha" "$previous" "$successor") 2>/dev/null; then
  die 'an unsafe predecessor marker was accepted'
fi
chmod 0600 "$ROUTINE_DEPOSITS_MARKER"
handoff_routine_marker "$next_sha" "$previous" "$successor"
[[ "$(<"$ROUTINE_DEPOSITS_MARKER")" == "$next_sha" ]] ||
  die 'the successor marker is wrong'
receipt="$STATE_ROOT/pending-$next_sha.routine-marker"
[[ "$(<"$receipt")" == "$CBE_LIVE_PREDECESSOR_SHA" &&
  "$(stat --format='%u:%g:%a:%h' "$receipt")" == '0:0:600:1' ]] ||
  die 'the rollback receipt is wrong'

restore_routine_marker_for_rollback "$next_sha" "$previous"
[[ "$(<"$ROUTINE_DEPOSITS_MARKER")" == "$CBE_LIVE_PREDECESSOR_SHA" &&
  ! -e "$receipt" ]] || die 'the predecessor marker was not restored'

printf '%s\n' "$CBE_LIVE_PREDECESSOR_SHA" |
  install -o root -g root -m 0600 /dev/stdin "$receipt"
restore_routine_marker_for_rollback "$next_sha" "$previous"
[[ ! -e "$receipt" ]] || die 'the pre-swap receipt was not cleared'

printf '%s\n' "$CBE_LIVE_PREDECESSOR_SHA" |
  install -o root -g root -m 0600 /dev/stdin "$receipt"
printf '%s\n' '2222222222222222222222222222222222222222' |
  install -o root -g root -m 0600 /dev/stdin "$ROUTINE_DEPOSITS_MARKER"
if (restore_routine_marker_for_rollback "$next_sha" "$previous") 2>/dev/null; then
  die 'an unrelated marker was overwritten during rollback'
fi
[[ -f "$receipt" ]] || die 'the rejected rollback lost its receipt'
printf 'routine marker handoff and rollback verified\n'
