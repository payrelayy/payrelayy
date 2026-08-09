#!/usr/bin/env bash
# Verifies the PayReplayy inactive VM contract. It must be run as root and
# performs only local, read-only checks. It never starts, pulls, or removes a
# container; reads a secret; or changes the firewall, systemd, or Git state.

set -euo pipefail

readonly DEPLOY_USER='payreplayy-deploy'
readonly DEPLOY_HOME='/srv/payreplayy/deploy'
readonly RELEASE_ROOT='/srv/payreplayy/releases'
readonly REPOSITORY='git@github.com:payrelayy/payrelayy.git'
readonly PROJECT_NAME='payreplayy-inactive'
readonly LOCAL_DOCKER_SOCKET='unix:///var/run/docker.sock'
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export PATH="$SAFE_PATH"

usage() {
  cat <<'USAGE'
Usage:
  verify-inactive-vm.sh --commit <40-lowercase-hex> \
    --release-dir /srv/payreplayy/releases/<commit> \
    --image payreplayy-api:inactive-<short-commit>

The verifier is intentionally fail-closed. It checks a sealed release, the
inactive image and Compose contract, and the SSH-only listener boundary. It
does not start, pull, remove, or modify anything.
USAGE
}

die() {
  printf 'inactive VM verification failed: %s\n' "$1" >&2
  exit 1
}

docker_local() {
  env -i \
    PATH="$SAFE_PATH" \
    HOME='/' \
    DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" "$@"
}

docker_compose_local() {
  env -i \
    PATH="$SAFE_PATH" \
    HOME='/' \
    DOCKER_HOST="$LOCAL_DOCKER_SOCKET" \
    docker --host "$LOCAL_DOCKER_SOCKET" compose --env-file /dev/null "$@"
}

git_release() {
  env -i \
    PATH="$SAFE_PATH" \
    HOME='/' \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_OPTIONAL_LOCKS=0 \
    git -c core.fsmonitor=false -C "$release_dir" "$@"
}

commit=''
release_dir=''
image=''

while (($# > 0)); do
  case "$1" in
    --commit)
      (($# >= 2)) || die '--commit requires a value'
      commit="$2"
      shift 2
      ;;
    --release-dir)
      (($# >= 2)) || die '--release-dir requires a value'
      release_dir="$2"
      shift 2
      ;;
    --image)
      (($# >= 2)) || die '--image requires a value'
      image="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die 'an unknown argument was supplied'
      ;;
  esac
done

[[ $EUID -eq 0 ]] || die 'run this verifier as root'
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'do not run the verifier with a Docker host or context override'
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die 'the reviewed commit must be 40 lowercase hexadecimal characters'
[[ "$release_dir" == "$RELEASE_ROOT/$commit" ]] || die 'the release directory must match the reviewed commit under the release root'
short_commit="${commit:0:7}"
[[ "$image" == "payreplayy-api:inactive-$short_commit" ]] || die 'the image tag must match the reviewed commit prefix'
[[ -d "$release_dir/.git" ]] || die 'the release directory is not a Git worktree'
[[ -f "$release_dir/infra/compose.inactive.yaml" ]] || die 'the inactive Compose contract is absent'

[[ "$(git_release rev-parse HEAD)" == "$commit" ]] || die 'the release does not resolve to the reviewed commit'
[[ "$(git_release remote get-url origin)" == "$REPOSITORY" ]] || die 'the release has an unexpected Git remote'
if git_release symbolic-ref -q --short HEAD >/dev/null; then
  die 'the release HEAD must be detached'
else
  symbolic_ref_status=$?
  [[ $symbolic_ref_status -eq 1 ]] || die 'could not determine whether the release HEAD is detached'
fi
[[ -z "$(git_release status --porcelain)" ]] || die 'the sealed release worktree is not clean'
[[ "$(stat --format='%U:%G:%a' "$release_dir")" == "root:$DEPLOY_USER:750" ]] || die 'the release root ownership or mode is not sealed'
[[ "$(stat --format='%U:%G:%a' "$release_dir/Dockerfile")" == "root:$DEPLOY_USER:640" ]] || die 'the Dockerfile ownership or mode is not sealed'

deploy_shell="$(getent passwd "$DEPLOY_USER" | awk -F: '{print $7}')"
[[ "$deploy_shell" == '/usr/sbin/nologin' ]] || die 'the deploy identity must not have an interactive shell'
[[ "$(passwd --status "$DEPLOY_USER" | awk '{print $2}')" == 'L' ]] || die 'the deploy identity password must be locked'
! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -Eq '^(docker|sudo)$' || die 'the deploy identity must not have Docker or sudo access'
if deploy_sudo_policy="$(sudo -n -l -U "$DEPLOY_USER" 2>&1)"; then
  deploy_sudo_status=0
else
  deploy_sudo_status=$?
fi
[[ $deploy_sudo_status -le 1 ]] || die 'could not inspect the deploy identity sudo policy'
grep -Eq "^User ${DEPLOY_USER} is not allowed to run sudo on .+\.$" <<<"$deploy_sudo_policy" || die 'the deploy identity must not have a sudo policy'
if ! runuser -u "$DEPLOY_USER" -- sh -c 'test ! -r "$1" && test ! -w "$1"' sh /var/run/docker.sock; then
  die 'the deploy identity must not have effective Docker socket access'
fi

for release_ancestor in "$RELEASE_ROOT" "$(dirname "$RELEASE_ROOT")" "$(dirname "$(dirname "$RELEASE_ROOT")")"; do
  [[ -d "$release_ancestor" ]] || die 'a sealed release ancestor is absent'
  if ! runuser -u "$DEPLOY_USER" -- sh -c 'test ! -w "$1"' sh "$release_ancestor"; then
    die 'the deploy identity can replace the sealed release through an ancestor'
  fi
done

deploy_writable_path="$(runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" \
  sh -c 'cd "$HOME"; find "$1" -xdev -writable -print -quit' sh "$release_dir")"
[[ -z "$deploy_writable_path" ]] || die 'the deploy identity can write within the sealed release'

docker_local image inspect "$image" >/dev/null
image_title="$(docker_local image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.title"}}')"
[[ "$image_title" == 'payreplayy-api' ]] || die 'the inactive image is missing the stable PayReplayy identity label'
image_revision="$(docker_local image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$image_revision" == "$commit" ]] || die 'the inactive image revision label does not match the reviewed commit'
image_user="$(docker_local image inspect "$image" --format '{{.Config.User}}')"
[[ "$image_user" == 'payreplayy:payreplayy' ]] || die 'the inactive image must run as the non-root application user'
image_ports="$(docker_local image inspect "$image" --format '{{with index .Config "ExposedPorts"}}{{json .}}{{else}}null{{end}}')"
[[ "$image_ports" == 'null' ]] || die 'the inactive image declares an exposed port'
if ! payreplayy_container_candidates="$(docker_local container ls --all --quiet)"; then
  die 'could not inspect local containers'
fi
while IFS= read -r container_candidate_id; do
  [[ -n "$container_candidate_id" ]] || continue
  container_candidate_image="$(docker_local container inspect "$container_candidate_id" --format '{{.Config.Image}}')"
  candidate_image_id="$(docker_local container inspect "$container_candidate_id" --format '{{.Image}}')"
  candidate_image_title="$(docker_local image inspect "$candidate_image_id" --format '{{index .Config.Labels "org.opencontainers.image.title"}}')"
  if [[ "$container_candidate_image" == payreplayy-api:* || "$candidate_image_title" == 'payreplayy-api' ]]; then
    die 'a PayReplayy container exists'
  fi
done <<<"$payreplayy_container_candidates"

compose_file="$release_dir/infra/compose.inactive.yaml"
[[ ! -L "$compose_file" ]] || die 'the Compose source must not be a symbolic link'
if grep -Eiq '(env_file|label_file|include|extends|secrets|configs|volumes|use_api_socket)' "$compose_file"; then
  die 'the Compose source contains a prohibited external attachment or resolution directive'
else
  compose_source_scan_status=$?
  [[ $compose_source_scan_status -eq 1 ]] || die 'could not safely preflight the Compose source'
fi
compose_config_json="$(docker_compose_local --profile inactive -f "$compose_file" config --format json --no-env-resolution --no-interpolate --no-path-resolution)"
readonly COMPOSE_CONTRACT_CHECK='
import json
import sys

config = json.load(sys.stdin)
project_name = sys.argv[1]
expected_environment = {
    "NODE_ENV": "production",
    "LOG_LEVEL": "info",
    "FINANCIAL_ACTIONS_MODE": "dry_run",
    "API_HOST": "0.0.0.0",
    "API_PORT": "3000",
    "INTERNAL_POSTGRES_RUNTIME_ENABLED": "false",
    "INTERNAL_TELEGRAM_INGRESS_ENABLED": "false",
    "INTERNAL_TELEGRAM_ACTION_CAPABILITY_CONTRACT_ENABLED": "false",
}
expected_service_keys = {
    "build", "cap_drop", "environment", "healthcheck", "init", "networks",
    "pids_limit", "profiles", "read_only", "restart", "security_opt", "tmpfs",
}
healthcheck_script = (
    "fetch(" + chr(39) + "http://127.0.0.1:3000/healthz" + chr(39)
    + ").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
)
expected_healthcheck = {
    "interval": "30s",
    "retries": 3,
    "start_period": "10s",
    "test": [
        "CMD",
        "node",
        "-e",
        healthcheck_script,
    ],
    "timeout": "3s",
}

if not isinstance(config, dict) or set(config) != {"name", "networks", "services"}:
    raise SystemExit(1)
if config.get("name") != project_name:
    raise SystemExit(1)
services = config.get("services")
if not isinstance(services, dict) or set(services) != {"api"}:
    raise SystemExit(1)
api = services["api"]
if not isinstance(api, dict) or not expected_service_keys <= set(api) <= (expected_service_keys | {"command", "entrypoint"}):
    raise SystemExit(1)
if api.get("command") is not None or api.get("entrypoint") is not None:
    raise SystemExit(1)
if api.get("profiles") != ["inactive"]:
    raise SystemExit(1)
if api.get("build") != {
    "context": "..",
    "dockerfile": "Dockerfile",
    "target": "api",
}:
    raise SystemExit(1)
if api.get("environment") != expected_environment:
    raise SystemExit(1)
if api.get("restart") != "no" or api.get("init") is not True:
    raise SystemExit(1)
if api.get("read_only") is not True or api.get("pids_limit") != 128:
    raise SystemExit(1)
if api.get("tmpfs") != ["/tmp:rw,noexec,nosuid,size=64m,mode=1777"]:
    raise SystemExit(1)
if api.get("cap_drop") != ["ALL"]:
    raise SystemExit(1)
if api.get("security_opt") != ["no-new-privileges:true"]:
    raise SystemExit(1)
if api.get("networks") != {"payreplayy_internal": None}:
    raise SystemExit(1)
if api.get("healthcheck") != expected_healthcheck:
    raise SystemExit(1)

networks = config.get("networks")
if not isinstance(networks, dict) or set(networks) != {"payreplayy_internal"}:
    raise SystemExit(1)
network = networks["payreplayy_internal"]
if not isinstance(network, dict) or not {"internal", "name"} <= set(network) <= {"internal", "name", "ipam"}:
    raise SystemExit(1)
if network.get("internal") is not True or network.get("name") != f"{project_name}_payreplayy_internal":
    raise SystemExit(1)
if network.get("ipam", {}) != {}:
    raise SystemExit(1)
'
if ! printf '%s' "$compose_config_json" | env -i PATH="$SAFE_PATH" HOME='/' python3 -I -c "$COMPOSE_CONTRACT_CHECK" "$PROJECT_NAME"; then
  die 'the rendered Compose contract does not exactly match the inactive service boundary'
fi
compose_projects_json="$(docker_local compose ls --all --format json)"
readonly COMPOSE_PROJECTS_CHECK='
import json
import sys

projects = json.load(sys.stdin)
project_name = sys.argv[1]
if not isinstance(projects, list) or not all(isinstance(project, dict) for project in projects):
    raise SystemExit(1)
if any(project.get("Name") == project_name for project in projects):
    raise SystemExit(1)
'
if ! printf '%s' "$compose_projects_json" | env -i PATH="$SAFE_PATH" HOME='/' python3 -I -c "$COMPOSE_PROJECTS_CHECK" "$PROJECT_NAME"; then
  die 'a PayReplayy Compose project exists or the Compose project inventory is malformed'
fi
if systemd_units="$(systemctl list-unit-files --no-legend 'payreplayy*' 2>&1)"; then
  :
else
  systemd_unit_files_status=$?
  [[ $systemd_unit_files_status -eq 1 && -z "$systemd_units" ]] || die 'could not inspect PayReplayy systemd unit files'
  systemd_units=''
fi
[[ -z "$systemd_units" ]] || die 'a PayReplayy systemd unit exists'
if active_systemd_units="$(systemctl list-units --all --no-legend 'payreplayy*' 2>&1)"; then
  :
else
  active_systemd_units_status=$?
  [[ $active_systemd_units_status -eq 1 && -z "$active_systemd_units" ]] || die 'could not inspect active or transient PayReplayy systemd units'
  active_systemd_units=''
fi
[[ -z "$active_systemd_units" ]] || die 'an active or transient PayReplayy systemd unit exists'

if ! non_loopback_tcp_listeners="$(
  ss -ltnH |
    awk '$4 !~ /^127\./ && $4 !~ /^\[::1\]:/ { print $4 }' |
    sort -u
  )"; then
  die 'could not inspect non-loopback TCP listeners'
fi
[[ "$non_loopback_tcp_listeners" == $'0.0.0.0:22\n[::]:22' ]] || die 'only SSH may be a non-loopback TCP listener'

if ! non_loopback_udp_listeners="$(
  ss -lunH |
    awk '$4 !~ /^127\./ && $4 !~ /^\[::1\]:/ { print $4 }' |
    sort -u
  )"; then
  die 'could not inspect non-loopback UDP listeners'
fi
[[ -z "$non_loopback_udp_listeners" ]] || die 'no non-loopback UDP listener is permitted'

ufw_status="$(ufw status verbose)"
grep -Fxq 'Status: active' <<<"$ufw_status" || die 'the UFW firewall must be active'
grep -Fxq 'Default: deny (incoming), allow (outgoing), deny (routed)' <<<"$ufw_status" || die 'the UFW firewall defaults are not fail-closed'
if ! ufw_accepting_rules="$(
  awk '($2 == "ALLOW" || $2 == "LIMIT") && ($3 == "IN" || $3 == "FWD") { print $1 "|" $2 "|" $3 }' <<<"$ufw_status" | sort -u
  )"; then
  die 'could not inspect UFW accepting rules'
fi
[[ "$ufw_accepting_rules" == '22/tcp|ALLOW|IN' ]] || die 'UFW may allow inbound SSH only'

printf 'inactive_vm_verification=pass\nreviewed_commit=%s\nimage=%s\n' "$commit" "$image"
