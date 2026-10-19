#!/usr/bin/env bash
set -euo pipefail

# Synthetic-only Linux bind-mount rehearsal. No database, provider, or payment route is present.
test "$(uname -s)" = Linux
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
image='docker.io/library/node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066'
scratch="$(mktemp -d)"
cleanup() {
  if test "$(id -u)" -eq 0; then
    rm -rf -- "$scratch"
  else
    sudo rm -rf -- "$scratch"
  fi
}
trap cleanup EXIT
mkdir -m 0755 -- "$scratch/stage" "$scratch/pins"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker pull --quiet "$image" >/dev/null
fi

docker run --rm --pull=never --network none --read-only \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  --security-opt no-new-privileges --pids-limit 32 --memory 256m \
  --user 0:0 --workdir /workspace \
  --mount "type=bind,src=$repo_root,dst=/workspace,readonly" \
  --mount "type=bind,src=$scratch/stage,dst=/var/lib/fetanagent/cbe-birr-receiver-key-custody-v1" \
  --mount "type=bind,src=$scratch/pins,dst=/pins" \
  "$image" node infra/operations/cbe-birr-mounted-custody-smoke.mjs stage

probe() {
  local pins_file="$1"
  docker run --rm --pull=never --network none --read-only \
    --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 256m \
    --user 10001:10001 --workdir /workspace \
    --mount "type=bind,src=$repo_root,dst=/workspace,readonly" \
    --mount "type=bind,src=$scratch/stage/owner-root-profile.v2.json,dst=/etc/fetanagent/owner-cbe-birr-receiver-lookup-profile.v2.json,readonly" \
    --mount "type=bind,src=$scratch/stage/receiver-opening-profile.v1.json,dst=/etc/fetanagent/cbe-birr-worker-receiver-lookup-profile.v1.json,readonly" \
    --mount "type=bind,src=$scratch/stage/receiver-child-key.v1.json,dst=/run/secrets/cbe_birr_worker_receiver_lookup_key.v1.json,readonly" \
    --mount "type=bind,src=$scratch/pins/$pins_file,dst=/run/configs/approved-pins.json,readonly" \
    "$image" node infra/operations/cbe-birr-mounted-custody-smoke.mjs probe
}

probe approved.json
if probe stale.json >/dev/null 2>&1; then
  echo 'A stale receiver revision was accepted.' >&2
  exit 1
fi
if test "$(id -u)" -eq 0; then
  chmod 0444 -- "$scratch/stage/receiver-child-key.v1.json"
else
  sudo chmod 0444 -- "$scratch/stage/receiver-child-key.v1.json"
fi
if probe approved.json >/dev/null 2>&1; then
  echo 'A readable-by-all child key was accepted.' >&2
  exit 1
fi
echo 'Synthetic CBE receiver mount rejects stale pins and unsafe key mode.'
