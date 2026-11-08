#!/usr/bin/env bash
set -euo pipefail

# Exercise only the reviewed predecessor exception with synthetic Docker data.
helper="$(dirname "$0")/fetanagent-production-deploy-helper-v2.sh"
CBE_GUARDED_PREDECESSOR_SHA='f1002058b451cba0dfd4f43cb016bb1b1ca0587e'
source <(sed -n '/^predecessor_api_timeout_only() {/,/^}/p' "$helper")
declare -F predecessor_api_timeout_only >/dev/null

probe="fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
fixture_inspection="$(jq -n --arg sha "$CBE_GUARDED_PREDECESSOR_SHA" --arg probe "$probe" '[{
  Config: {
    Labels: {
      "com.docker.compose.project": "fetanagent-production",
      "com.docker.compose.service": "api",
      "org.opencontainers.image.revision": $sha
    },
    Healthcheck: {Timeout: 3000000000, Test: ["CMD", "node", "-e", $probe]}
  },
  State: {Status: "running", Health: {Status: "unhealthy", FailingStreak: 4,
    Log: [range(4) | {ExitCode: -1, Output: "Health check exceeded timeout (3s)"}]
  }}
}]')"
exec_called=0
exec_succeeds=true
docker() {
  case "$1" in
    inspect) [[ "$2" == 'api-fixture' ]]; printf '%s\n' "$fixture_inspection" ;;
    exec) [[ "$2" == 'api-fixture' ]]; exec_called=$((exec_called + 1)); "$exec_succeeds" ;;
    *) return 1 ;;
  esac
}
timeout() { [[ "$1" == '12s' ]]; shift; "$@"; }

predecessor_api_timeout_only "$CBE_GUARDED_PREDECESSOR_SHA" api-fixture
[[ "$exec_called" -eq 1 ]] || exit 1

if predecessor_api_timeout_only '1111111111111111111111111111111111111111' api-fixture; then
  echo 'an unrelated release was accepted' >&2; exit 1
fi
fixture_inspection="$(jq '.[0].State.Health.Log[-1].Output = "database unavailable"' <<<"$fixture_inspection")"
if predecessor_api_timeout_only "$CBE_GUARDED_PREDECESSOR_SHA" api-fixture; then
  echo 'a different health failure was accepted' >&2; exit 1
fi
fixture_inspection="$(jq '.[0].State.Health.Log[-1].Output = "Health check exceeded timeout (3s)"' <<<"$fixture_inspection")"
exec_succeeds=false
if predecessor_api_timeout_only "$CBE_GUARDED_PREDECESSOR_SHA" api-fixture; then
  echo 'a failed fresh readiness request was accepted' >&2; exit 1
fi

printf 'API predecessor timeout exception is bounded to an exact fresh response\n'
