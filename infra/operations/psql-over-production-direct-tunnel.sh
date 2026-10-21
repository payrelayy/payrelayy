#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "${FETANAGENT_DIRECT_DB_ROUTE:-}" == 'stopped-sms-recovery' ]] || exit 1
[[ "${FETANAGENT_DIRECT_DB_PROJECT_REF:-}" =~ ^[a-z0-9]{20}$ ]] || exit 1
direct_host="db.$FETANAGENT_DIRECT_DB_PROJECT_REF.supabase.co"
[[ "${FETANAGENT_DIRECT_DB_HOST:-}" == "$direct_host" ]] || exit 1
[[ "${FETANAGENT_DIRECT_DB_SSH_HOST:-}" =~ ^[A-Za-z0-9.-]+$ ]] || exit 1
[[ "${PGSSLMODE:-}" == 'verify-full' && -f "${PGSSLROOTCERT:-}" ]] || exit 1
[[ -n "${PGPASSWORD:-}" && "${PGDATABASE:-}" == 'postgres' ]] || exit 1
[[ -f "${FETANAGENT_DIRECT_DB_KEY:-}" && -f "${FETANAGENT_DIRECT_DB_KNOWN_HOSTS:-}" ]] || exit 1
for arg in "$@"; do
  case "$arg" in
    -h|-p|-U|-d|--host|--host=*|--port|--port=*|--username|--username=*|--dbname|--dbname=*) exit 1 ;;
  esac
done
[[ -x /usr/bin/psql ]] || exit 1
[[ -z "$(ss -H -ltn '( sport = :55432 )')" ]] || exit 1

ssh -F /dev/null -i "$FETANAGENT_DIRECT_DB_KEY" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$FETANAGENT_DIRECT_DB_KNOWN_HOSTS" \
  -o ConnectTimeout=8 -o ConnectionAttempts=1 -o ExitOnForwardFailure=yes \
  -N -L "127.0.0.1:55432:$direct_host:5432" \
  "fetanagent-admin@$FETANAGENT_DIRECT_DB_SSH_HOST" 2>/dev/null &
tunnel_pid=$!
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  kill "$tunnel_pid" 2>/dev/null || true
  wait "$tunnel_pid" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  [[ -n "$(ss -H -ltn '( sport = :55432 )')" ]] && break
  kill -0 "$tunnel_pid" 2>/dev/null || exit 2
  sleep 0.2
done
kill -0 "$tunnel_pid" 2>/dev/null || exit 2
[[ -n "$(ss -H -ltn '( sport = :55432 )')" ]] || exit 2

# PGHOST names the certificate identity; PGHOSTADDR routes the TCP connection.
PGHOST="$direct_host" PGHOSTADDR=127.0.0.1 PGPORT=55432 PGUSER=postgres \
  /usr/bin/psql "$@"
