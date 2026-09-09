#!/usr/bin/env bash

# Sourced by the production verifier workflow. Credentials remain on the ephemeral runner while
# the production VM contributes only its native route to the exact direct Supabase endpoint.
fetanagent_open_production_direct_database_tunnel() {
  if [[ $# -ne 4 ]]; then
    printf 'The production direct-database tunnel requires four arguments.\n' >&2
    return 2
  fi
  local protected="$1" vm_host="$2" database_host="$3" local_port="$4" attempt
  [[ -z "${FETANAGENT_PRODUCTION_DIRECT_DATABASE_TUNNEL_PID:-}" ]] || return 2
  [[ "$protected" == /* && -d "$protected" && ! -L "$protected" ]] || return 2
  [[ -f "$protected/deploy-key" && ! -L "$protected/deploy-key" ]] || return 2
  [[ -f "$protected/known-hosts" && ! -L "$protected/known-hosts" ]] || return 2
  [[ "$(stat -c '%a' "$protected/deploy-key")" == '600' ]] || return 2
  [[ "$(stat -c '%a' "$protected/known-hosts")" == '600' ]] || return 2
  [[ "$vm_host" =~ ^[A-Za-z0-9.-]+$ ]] || return 2
  [[ "$database_host" == 'db.xzztugbgtulptnbpoelr.supabase.co' ]] || return 2
  [[ "$local_port" == '25432' ]] || return 2
  if (exec 3<>"/dev/tcp/127.0.0.1/$local_port") 2>/dev/null; then
    exec 3>&-
    exec 3<&-
    printf 'The fixed production database-tunnel port is occupied.\n' >&2
    return 1
  fi
  local -a ssh_options=(
    -F /dev/null -i "$protected/deploy-key" -o BatchMode=yes -o IdentitiesOnly=yes
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$protected/known-hosts"
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -T
  )
  ssh "${ssh_options[@]}" -N \
    -L "127.0.0.1:$local_port:$database_host:5432" \
    "fetanagent-admin@$vm_host" >/dev/null 2>&1 &
  FETANAGENT_PRODUCTION_DIRECT_DATABASE_TUNNEL_PID=$!
  for attempt in {1..40}; do
    if ! kill -0 "$FETANAGENT_PRODUCTION_DIRECT_DATABASE_TUNNEL_PID" 2>/dev/null; then
      wait "$FETANAGENT_PRODUCTION_DIRECT_DATABASE_TUNNEL_PID" 2>/dev/null || true
      unset FETANAGENT_PRODUCTION_DIRECT_DATABASE_TUNNEL_PID
      return 1
    fi
    if (exec 3<>"/dev/tcp/127.0.0.1/$local_port") 2>/dev/null; then
      exec 3>&-
      exec 3<&-
      return 0
    fi
    sleep 0.25
  done
  fetanagent_close_production_direct_database_tunnel
  return 1
}

fetanagent_close_production_direct_database_tunnel() {
  local pid="${FETANAGENT_PRODUCTION_DIRECT_DATABASE_TUNNEL_PID:-}"
  if [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  unset FETANAGENT_PRODUCTION_DIRECT_DATABASE_TUNNEL_PID
}
