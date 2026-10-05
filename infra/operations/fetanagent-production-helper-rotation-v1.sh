#!/usr/bin/env bash
# One-use, root-only rotation of the production deploy helper introduced by #645.
# This operation changes no application container, database role, or financial switch.
set -euo pipefail
IFS=$'\n\t'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

readonly EXPECTED_DROPLET_ID='593344964'
readonly METADATA_ID='http://169.254.169.254/metadata/v1/id'
readonly SOURCE_COMMIT='7d8c930d5a587967664f05c849ebdb85966c0fd3'
readonly PREDECESSOR_SHA256='d2f537641dacb1f01d8f6a00f4ab295ee145a1cc31bc27fcaa596f9031a04996'
readonly SUCCESSOR_SHA256='7d144ca5c7a3524f5b6c17c9608737d70438c7261c2d44d10e6d597c9a902343'
readonly HELPER='/usr/local/sbin/fetanagent-production-deploy-helper'
readonly SUDOERS='/etc/sudoers.d/fetanagent-production-deploy-helper'
readonly STATE='/var/lib/fetanagent/production-helper-rotation-v1'
readonly HELPER_LOCK='/var/lib/fetanagent/production/helper.lock'
readonly ROUTINE_MARKER='/var/lib/fetanagent/production/routine-deposits.release'
readonly EXECUTION_V2_MARKER='/var/lib/fetanagent/production/companion-execution-v2.release'
readonly STAGED_HELPER='/root/fetanagent-production-helper-rotation-v1-input/fetanagent-production-deploy-helper.next'
readonly PREDECESSOR_ARCHIVE="$STATE/predecessor-helper"
readonly DISABLED_SUDOERS="$STATE/disabled-predecessor-sudoers"
readonly NEXT_HELPER='/usr/local/sbin/.fetanagent-production-deploy-helper.rotation-v1-next'
readonly NEXT_SUDOERS="$STATE/successor-sudoers.next"
readonly INTENT="$STATE/intent-v1"
readonly COMPLETE="$STATE/completed-v1"
readonly CONFIRMATION='ROTATE EXACT PRODUCTION DEPLOY HELPER V1'

die() { printf 'production helper rotation stopped: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" == '0' && "$(id -un)" == 'root' ]] || die 'root identity is required'
[[ -z "${SUDO_USER:-}" && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] ||
  die 'sudo and Docker environment overrides are forbidden'
for command in bash cmp curl cut flock id install mv realpath runuser sha256sum stat sudo visudo; do
  command -v "$command" >/dev/null 2>&1 || die "required command is absent: $command"
done
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 "$METADATA_ID")" == \
  "$EXPECTED_DROPLET_ID" ]] || die 'this is not the reviewed production Droplet'

expected_sudoers() {
  local digest="$1"
  printf 'fetanagent-admin ALL=(root) NOPASSWD: sha256:%s %s *\n' "$digest" "$HELPER"
}

require_file() {
  local path="$1" mode="$2" digest="$3"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h' "$path")" == "0:0:$mode:1" &&
    "$(sha256sum -- "$path" | cut -d ' ' -f 1)" == "$digest" ]] ||
    die "an exact root-owned rotation file is absent or changed: $path"
}

require_sudoers() {
  local path="$1" digest="$2"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h' "$path")" == '0:0:440:1' ]] ||
    die "the exact sudoers file is absent or unsafe: $path"
  cmp -s -- "$path" <(expected_sudoers "$digest") || die 'the sudoers grant differs from its reviewed digest pin'
}

require_state() {
  [[ ! -L "$STATE" && -d "$STATE" && "$(realpath -- "$STATE")" == "$STATE" &&
    "$(stat --format='%u:%g:%a' "$STATE")" == '0:0:700' ]] ||
    die 'the rotation state directory is unsafe'
}

intent_body() {
  printf 'rotation=production-helper-v1\ndroplet_id=%s\nsource_commit=%s\npredecessor_sha256=%s\nsuccessor_sha256=%s\n' \
    "$EXPECTED_DROPLET_ID" "$SOURCE_COMMIT" "$PREDECESSOR_SHA256" "$SUCCESSOR_SHA256"
}

require_record() {
  local path="$1" expected="$2"
  [[ ! -L "$path" && -f "$path" && "$(realpath -- "$path")" == "$path" &&
    "$(stat --format='%u:%g:%a:%h' "$path")" == '0:0:400:1' ]] ||
    die "the rotation record is absent or unsafe: $path"
  cmp -s -- "$path" <("$expected") || die "the rotation record differs: $path"
}

complete_body() {
  intent_body
  printf 'status=complete\n'
}

install_record() {
  local path="$1" body="$2" next="$1.next"
  if [[ ! -e "$next" && ! -L "$next" ]]; then
    "$body" | install -o root -g root -m 0400 /dev/stdin "$next"
  fi
  require_record "$next" "$body"
  mv -T -- "$next" "$path"
  require_record "$path" "$body"
}

require_staged_successor() {
  [[ ! -L "${STAGED_HELPER%/*}" && -d "${STAGED_HELPER%/*}" &&
    "$(realpath -- "${STAGED_HELPER%/*}")" == "${STAGED_HELPER%/*}" &&
    "$(stat --format='%u:%g:%a' "${STAGED_HELPER%/*}")" == '0:0:700' ]] ||
    die 'the root-only staging directory is unsafe'
  require_file "$STAGED_HELPER" 600 "$SUCCESSOR_SHA256"
  bash -n "$STAGED_HELPER" || die 'the successor helper is not valid Bash'
}

require_lock_file() {
  [[ ! -L "$HELPER_LOCK" && -f "$HELPER_LOCK" &&
    "$(realpath -- "$HELPER_LOCK")" == "$HELPER_LOCK" &&
    "$(stat --format='%u:%g:%a:%h' "$HELPER_LOCK")" == '0:0:600:1' ]] ||
    die 'the production helper lock is unsafe'
}

acquire_lock() {
  require_lock_file
  exec 9>>"$HELPER_LOCK"
  flock --nonblock 9 || die 'a production deployment operation is in progress'
}

require_completed_state() {
  require_file "$HELPER" 755 "$SUCCESSOR_SHA256"
  require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"
  require_state
  require_record "$INTENT" intent_body
  require_record "$COMPLETE" complete_body
  require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"
  require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"
  [[ ! -e "$NEXT_HELPER" && ! -L "$NEXT_HELPER" &&
    ! -e "$NEXT_SUDOERS" && ! -L "$NEXT_SUDOERS" &&
    ! -e "$INTENT.next" && ! -L "$INTENT.next" &&
    ! -e "$COMPLETE.next" && ! -L "$COMPLETE.next" ]] ||
    die 'an unexpected partial install remains after completion'
  visudo -cf /etc/sudoers >/dev/null || die 'the installed sudoers configuration is invalid'
  runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256" ||
    die 'the restricted deployment account cannot verify the successor helper'
}

inspect() {
  local installed_sha
  acquire_lock
  installed_sha="$(sha256sum -- "$HELPER" | cut -d ' ' -f 1)"
  case "$installed_sha" in
    "$PREDECESSOR_SHA256")
      require_file "$HELPER" 755 "$PREDECESSOR_SHA256"
      require_sudoers "$SUDOERS" "$PREDECESSOR_SHA256"
      [[ ! -e "$STATE" && ! -L "$STATE" ]] || die 'unexpected partial rotation state'
      visudo -cf /etc/sudoers >/dev/null || die 'the installed sudoers configuration is invalid'
      runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$PREDECESSOR_SHA256" ||
        die 'the restricted deployment account cannot verify the predecessor helper'
      printf 'predecessor-exact; no production runtime changed\n'
      ;;
    "$SUCCESSOR_SHA256")
      require_completed_state
      printf 'successor-exact; rotation complete; no production runtime changed\n'
      ;;
    *) die 'the installed helper has an unknown digest' ;;
  esac
}

rotate() {
  local installed_sha
  [[ $# -eq 1 && "$1" == "$CONFIRMATION" ]] || die 'the exact rotation confirmation is required'
  require_staged_successor
  acquire_lock
  [[ ! -e "$ROUTINE_MARKER" && ! -L "$ROUTINE_MARKER" &&
    ! -e "$EXECUTION_V2_MARKER" && ! -L "$EXECUTION_V2_MARKER" ]] ||
    die 'a money-capable production overlay is selected'
  visudo -cf /etc/sudoers >/dev/null || die 'the installed sudoers configuration is invalid'

  if [[ ! -e "$STATE" && ! -L "$STATE" ]]; then
    require_file "$HELPER" 755 "$PREDECESSOR_SHA256"
    require_sudoers "$SUDOERS" "$PREDECESSOR_SHA256"
    install -d -o root -g root -m 0700 "$STATE"
  fi
  require_state
  if [[ -e "$COMPLETE" || -L "$COMPLETE" ]]; then
    require_completed_state
    printf 'successor-exact; rotation complete; no production runtime changed\n'
    return
  fi
  if [[ ! -e "$INTENT" && ! -L "$INTENT" ]]; then
    install_record "$INTENT" intent_body
  fi
  require_record "$INTENT" intent_body

  if [[ ! -e "$PREDECESSOR_ARCHIVE" && ! -L "$PREDECESSOR_ARCHIVE" ]]; then
    require_file "$HELPER" 755 "$PREDECESSOR_SHA256"
    install -o root -g root -m 0400 "$HELPER" "$PREDECESSOR_ARCHIVE"
  fi
  require_file "$PREDECESSOR_ARCHIVE" 400 "$PREDECESSOR_SHA256"

  if [[ -e "$SUDOERS" || -L "$SUDOERS" ]]; then
    if cmp -s -- "$SUDOERS" <(expected_sudoers "$PREDECESSOR_SHA256"); then
      [[ ! -e "$DISABLED_SUDOERS" && ! -L "$DISABLED_SUDOERS" ]] ||
        die 'a predecessor grant is active despite an archived grant'
      require_sudoers "$SUDOERS" "$PREDECESSOR_SHA256"
      mv -T -- "$SUDOERS" "$DISABLED_SUDOERS"
    else
      require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"
    fi
  fi
  require_sudoers "$DISABLED_SUDOERS" "$PREDECESSOR_SHA256"

  installed_sha="$(sha256sum -- "$HELPER" | cut -d ' ' -f 1)"
  if [[ "$installed_sha" == "$PREDECESSOR_SHA256" ]]; then
    require_file "$HELPER" 755 "$PREDECESSOR_SHA256"
    [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]] || die 'the predecessor grant was not disabled'
    if [[ ! -e "$NEXT_HELPER" && ! -L "$NEXT_HELPER" ]]; then
      install -o root -g root -m 0755 "$STAGED_HELPER" "$NEXT_HELPER"
    fi
    require_file "$NEXT_HELPER" 755 "$SUCCESSOR_SHA256"
    mv -T -- "$NEXT_HELPER" "$HELPER"
  fi
  require_file "$HELPER" 755 "$SUCCESSOR_SHA256"
  "$HELPER" verify "$SUCCESSOR_SHA256"

  if [[ ! -e "$SUDOERS" && ! -L "$SUDOERS" ]]; then
    if [[ ! -e "$NEXT_SUDOERS" && ! -L "$NEXT_SUDOERS" ]]; then
      expected_sudoers "$SUCCESSOR_SHA256" |
        install -o root -g root -m 0440 /dev/stdin "$NEXT_SUDOERS"
    fi
    require_sudoers "$NEXT_SUDOERS" "$SUCCESSOR_SHA256"
    visudo -cf "$NEXT_SUDOERS" >/dev/null || die 'the successor sudoers rule is invalid'
    mv -T -- "$NEXT_SUDOERS" "$SUDOERS"
  fi
  require_sudoers "$SUDOERS" "$SUCCESSOR_SHA256"
  visudo -cf /etc/sudoers >/dev/null || die 'the installed sudoers configuration is invalid'
  runuser -u fetanagent-admin -- sudo -n "$HELPER" verify "$SUCCESSOR_SHA256" ||
    die 'the restricted deployment account could not verify the successor helper'

  if [[ ! -e "$COMPLETE" && ! -L "$COMPLETE" ]]; then
    install_record "$COMPLETE" complete_body
  fi
  require_record "$COMPLETE" complete_body
  printf 'successor-exact; rotation complete; no production runtime changed\n'
}

case "${1:-}" in
  inspect) [[ $# -eq 1 ]] || die 'inspect takes no other argument'; inspect ;;
  rotate) shift; rotate "$@" ;;
  *) die 'use inspect or rotate' ;;
esac
