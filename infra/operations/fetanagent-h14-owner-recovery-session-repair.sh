#!/usr/bin/env bash
set -euo pipefail

readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
readonly PROJECT_NAME='fetanagent-staging-beta'
readonly OWNER_SERVICE='owner-control'
readonly SESSION_SERVICE='kemerbet-session-provision'
readonly CANONICAL_H14='06459511d9330a0e1d956c42529b81aa9970e7a2'
readonly OWNER_SESSION_REPAIR_PARENT='826aaba79ed3e303452c4a7e04e0f6f90f699898'
readonly STAGING_DROPLET_ID='593344964'
readonly CONFIRMATION='owner-and-kemerbet-session-only-no-provider-action-no-transfer-no-money'
readonly SECRET_ROOT='/srv/fetanagent/secrets/staging'
readonly CANONICAL_COMPOSE="/srv/fetanagent/releases/$CANONICAL_H14/infra/compose.staging-beta.yaml"
readonly MUTATION_LOCK_ROOT='/run/fetanagent-staging-deploy-helper'
readonly MUTATION_LOCK="$MUTATION_LOCK_ROOT/mutation.lock"
readonly LEDGER_PARENT='/var/lib/fetanagent'
readonly LEDGER_ROOT="$LEDGER_PARENT/h14-owner-kemerbet-session-bootstrap-repair"

export PATH="$SAFE_PATH"

die() {
  printf 'FetanAgent H14 Owner/session repair refused: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" == '0' ]] || die 'root is required'
[[ "$#" -eq 7 ]] ||
  die 'pass repair SHA, canonical SHA, repair-parent SHA, staged bundle, manifest SHA-256, helper SHA-256, and exact confirmation'
readonly REPAIR_SHA="$1"
readonly PROVIDED_CANONICAL="$2"
readonly PROVIDED_PARENT="$3"
readonly BUNDLE_ROOT="$4"
readonly PROVIDED_MANIFEST_SHA="$5"
readonly PROVIDED_HELPER_SHA="$6"
readonly PROVIDED_CONFIRMATION="$7"
readonly REPAIR_TAG="${REPAIR_SHA:0:12}"
readonly OWNER_PREDECESSOR_TAG="${OWNER_SESSION_REPAIR_PARENT:0:12}"
readonly SESSION_PREDECESSOR_TAG="${CANONICAL_H14:0:12}"
readonly OWNER_REPAIR_IMAGE="fetanagent-owner-control:$REPAIR_TAG"
readonly SESSION_REPAIR_IMAGE="fetanagent-deposit-executor:$REPAIR_TAG"
readonly OWNER_PREDECESSOR_IMAGE="fetanagent-owner-control:$OWNER_PREDECESSOR_TAG"
readonly SESSION_PREDECESSOR_IMAGE="fetanagent-deposit-executor:$SESSION_PREDECESSOR_TAG"
readonly MANIFEST="$BUNDLE_ROOT/manifest-v1"
readonly OWNER_ARCHIVE="$BUNDLE_ROOT/fetanagent-owner-control-repair.tar"
readonly SESSION_ARCHIVE="$BUNDLE_ROOT/fetanagent-deposit-executor-repair.tar"
readonly STAGED_COMPOSE="$BUNDLE_ROOT/compose.staging-beta.yaml"
readonly INSTALLING_LEDGER="$LEDGER_ROOT/.installing-$REPAIR_SHA"
readonly COMPLETED_LEDGER="$LEDGER_ROOT/completed-$REPAIR_SHA"

[[ "$REPAIR_SHA" =~ ^[0-9a-f]{40}$ && "$REPAIR_SHA" != "$CANONICAL_H14" &&
  "$REPAIR_SHA" != "$OWNER_SESSION_REPAIR_PARENT" ]] || die 'the repair SHA is invalid'
[[ "$PROVIDED_CANONICAL" == "$CANONICAL_H14" ]] || die 'the canonical H14 SHA is not exact'
[[ "$PROVIDED_PARENT" == "$OWNER_SESSION_REPAIR_PARENT" ]] || die 'the repair-parent SHA is not exact'
[[ "$PROVIDED_MANIFEST_SHA" =~ ^[0-9a-f]{64}$ ]] || die 'the manifest digest is invalid'
[[ "$PROVIDED_HELPER_SHA" =~ ^[0-9a-f]{64}$ ]] || die 'the helper digest is invalid'
[[ "$PROVIDED_CONFIRMATION" == "$CONFIRMATION" ]] || die 'the exact no-provider-action confirmation is required'
[[ "$BUNDLE_ROOT" =~ ^/tmp/fetanagent-h14-owner-session-repair-[1-9][0-9]*-[1-9][0-9]*-$REPAIR_SHA$ ]] ||
  die 'the staged bundle path is outside the exact run-bound namespace'

self_path="$(realpath -- "$0")" || die 'the helper path cannot be resolved'
[[ ! -L "$0" && -f "$self_path" && "$(stat --format='%U:%G:%a:%h' "$self_path")" == 'root:root:600:1' ]] ||
  die 'the root helper ownership or mode is unsafe'
[[ "$(sha256sum "$self_path" | awk '{print $1}')" == "$PROVIDED_HELPER_SHA" ]] ||
  die 'the root helper does not match the reviewed PR-head digest'
[[ "$(curl --fail --silent --show-error --noproxy '*' --max-time 3 http://169.254.169.254/metadata/v1/id)" == \
  "$STAGING_DROPLET_ID" ]] || die 'the host is not the exact staging Droplet'

acquire_mutation_lock() {
  local fd_identity path_identity
  command -v flock >/dev/null 2>&1 || die 'flock is unavailable'
  [[ ! -L /run && -d /run && "$(realpath -- /run)" == '/run' &&
    "$(stat --format='%U:%G:%a' /run)" == 'root:root:755' ]] || die 'the runtime directory is unsafe'
  if [[ ! -e "$MUTATION_LOCK_ROOT" && ! -L "$MUTATION_LOCK_ROOT" ]]; then
    (umask 077 && mkdir --mode=0700 -- "$MUTATION_LOCK_ROOT") || die 'the mutation-lock root could not be created'
  fi
  [[ ! -L "$MUTATION_LOCK_ROOT" && -d "$MUTATION_LOCK_ROOT" &&
    "$(realpath -- "$MUTATION_LOCK_ROOT")" == "$MUTATION_LOCK_ROOT" &&
    "$(stat --format='%U:%G:%a' "$MUTATION_LOCK_ROOT")" == 'root:root:700' ]] ||
    die 'the mutation-lock root is unsafe'
  if [[ ! -e "$MUTATION_LOCK" && ! -L "$MUTATION_LOCK" ]]; then
    (set -o noclobber; umask 077; : >"$MUTATION_LOCK") 2>/dev/null || true
  fi
  [[ ! -L "$MUTATION_LOCK" && -f "$MUTATION_LOCK" &&
    "$(realpath -- "$MUTATION_LOCK")" == "$MUTATION_LOCK" &&
    "$(stat --format='%U:%G:%a:%h' "$MUTATION_LOCK")" == 'root:root:600:1' ]] ||
    die 'the mutation lock is unsafe'
  exec 9<>"$MUTATION_LOCK"
  path_identity="$(stat --format='%u:%g:%a:%h:%d:%i' "$MUTATION_LOCK")"
  fd_identity="$(stat -L --format='%u:%g:%a:%h:%d:%i' /proc/self/fd/9)"
  [[ "$fd_identity" == "$path_identity" && "$fd_identity" == '0:0:600:1:'* ]] ||
    die 'the opened mutation lock does not match its root-owned path'
  flock --exclusive --nonblock 9 || die 'another staging mutation is already active'
}

require_bundle() {
  local bundle_uid bundle_gid observed expected
  [[ ! -L "$BUNDLE_ROOT" && -d "$BUNDLE_ROOT" && "$(realpath -- "$BUNDLE_ROOT")" == "$BUNDLE_ROOT" ]] ||
    die 'the staged bundle directory is unsafe'
  bundle_uid="$(stat --format='%u' "$BUNDLE_ROOT")"
  bundle_gid="$(stat --format='%g' "$BUNDLE_ROOT")"
  [[ "$bundle_uid" =~ ^[1-9][0-9]*$ && "$bundle_gid" =~ ^[0-9]+$ &&
    "$(stat --format='%a' "$BUNDLE_ROOT")" == '700' ]] || die 'the staged bundle owner or mode is unsafe'
  expected="compose.staging-beta.yaml:f
fetanagent-deposit-executor-repair.tar:f
fetanagent-owner-control-repair.tar:f
manifest-v1:f"
  observed="$(find -P "$BUNDLE_ROOT" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)"
  [[ "$observed" == "$expected" ]] || die 'the staged bundle file inventory is not exact'
  [[ "$(find -P "$BUNDLE_ROOT" -mindepth 1 -maxdepth 1 -type f -printf '%U:%G:%m:%n\n' | LC_ALL=C sort -u)" == \
    "$bundle_uid:$bundle_gid:600:1" ]] || die 'the staged bundle file ownership or mode is unsafe'
  for file in "$MANIFEST" "$OWNER_ARCHIVE" "$SESSION_ARCHIVE" "$STAGED_COMPOSE"; do
    [[ ! -L "$file" && -f "$file" && "$(realpath -- "$file")" == "$file" ]] ||
      die 'a staged bundle file is unsafe'
  done
  [[ "$(sha256sum "$MANIFEST" | awk '{print $1}')" == "$PROVIDED_MANIFEST_SHA" ]] ||
    die 'the staged manifest digest is not exact'
  [[ ! -L "$CANONICAL_COMPOSE" && -f "$CANONICAL_COMPOSE" ]] || die 'canonical H14 Compose is unavailable'
}

manifest_value() {
  local key="$1" lines
  lines="$(grep -E "^${key}=" "$MANIFEST" || true)"
  [[ "$(grep -Ec "^${key}=" "$MANIFEST" || true)" == '1' ]] || die "manifest key is not singular: $key"
  printf '%s\n' "${lines#*=}"
}

require_manifest() {
  local expected_keys owner_size session_size compose_sha
  LC_ALL=C grep -q $'\r' "$MANIFEST" && die 'the manifest contains carriage returns'
  expected_keys="version
contract
image_archive_encoding
repair_implementation_sha
repair_parent_sha
canonical_h14_sha
staging_project_ref
staging_droplet_id
workflow_run_id
workflow_run_attempt
owner_predecessor_sha
session_predecessor_sha
owner_image_tag
owner_image_config_digest
owner_image_oci_manifest_digest
owner_image_tar_sha256
owner_image_tar_size
executor_image_tag
executor_image_config_digest
executor_image_oci_manifest_digest
executor_image_tar_sha256
executor_image_tar_size
chromium_package_version
canonical_compose_sha256
repair_helper_sha256
repair_helper_size
deployment_order
rollback_order
canonical_release_rewritten
canonical_release_superseded
provider_action_enabled
financial_actions_mode
kemerbet_executor_enabled
kemerbet_final_action_enabled
transfer_enabled
amount_entry_enabled
money_moved"
  [[ "$(cut -d= -f1 "$MANIFEST")" == "$expected_keys" ]] || die 'the staged manifest key order is not exact'
  [[ "$(manifest_value version)" == '1' ]]
  [[ "$(manifest_value contract)" == 'fetanagent-h14-owner-kemerbet-session-bootstrap-repair-bundle' ]]
  [[ "$(manifest_value image_archive_encoding)" == 'oci-docker-save-v1' ]]
  [[ "$(manifest_value repair_implementation_sha)" == "$REPAIR_SHA" ]]
  [[ "$(manifest_value repair_parent_sha)" == "$OWNER_SESSION_REPAIR_PARENT" ]]
  [[ "$(manifest_value canonical_h14_sha)" == "$CANONICAL_H14" ]]
  [[ "$(manifest_value staging_project_ref)" == 'spzpiyxheappsfyswewl' ]]
  [[ "$(manifest_value staging_droplet_id)" == "$STAGING_DROPLET_ID" ]]
  [[ "$(manifest_value workflow_run_id)" =~ ^[1-9][0-9]*$ ]]
  [[ "$(manifest_value workflow_run_attempt)" =~ ^[1-9][0-9]*$ ]]
  [[ "$(manifest_value owner_predecessor_sha)" == "$OWNER_SESSION_REPAIR_PARENT" ]]
  [[ "$(manifest_value session_predecessor_sha)" == "$CANONICAL_H14" ]]
  [[ "$(manifest_value owner_image_tag)" == "$OWNER_REPAIR_IMAGE" ]]
  [[ "$(manifest_value executor_image_tag)" == "$SESSION_REPAIR_IMAGE" ]]
  [[ "$(manifest_value owner_image_config_digest)" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$(manifest_value owner_image_oci_manifest_digest)" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$(manifest_value executor_image_config_digest)" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$(manifest_value executor_image_oci_manifest_digest)" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$(manifest_value owner_image_tar_sha256)" =~ ^[0-9a-f]{64}$ ]]
  [[ "$(manifest_value executor_image_tar_sha256)" =~ ^[0-9a-f]{64}$ ]]
  [[ "$(manifest_value canonical_compose_sha256)" =~ ^[0-9a-f]{64}$ ]]
  [[ "$(manifest_value repair_helper_sha256)" == "$PROVIDED_HELPER_SHA" ]]
  [[ "$(manifest_value chromium_package_version)" =~ ^[0-9][0-9A-Za-z.+:~_-]*$ ]]
  [[ "$(manifest_value deployment_order)" == 'owner-control,kemerbet-session-provision' ]]
  [[ "$(manifest_value rollback_order)" == 'kemerbet-session-provision,owner-control' ]]
  [[ "$(manifest_value canonical_release_rewritten)" == 'false' ]]
  [[ "$(manifest_value canonical_release_superseded)" == 'false' ]]
  [[ "$(manifest_value provider_action_enabled)" == 'false' ]]
  [[ "$(manifest_value financial_actions_mode)" == 'dry_run' ]]
  [[ "$(manifest_value kemerbet_executor_enabled)" == 'false' ]]
  [[ "$(manifest_value kemerbet_final_action_enabled)" == 'false' ]]
  [[ "$(manifest_value transfer_enabled)" == 'false' ]]
  [[ "$(manifest_value amount_entry_enabled)" == 'false' ]]
  [[ "$(manifest_value money_moved)" == 'false' ]]
  owner_size="$(manifest_value owner_image_tar_size)"
  session_size="$(manifest_value executor_image_tar_size)"
  [[ "$owner_size" =~ ^[1-9][0-9]{0,12}$ && "$owner_size" -le 2147483648 ]]
  [[ "$session_size" =~ ^[1-9][0-9]{0,12}$ && "$session_size" -le 2147483648 ]]
  [[ "$(stat --format='%s' "$OWNER_ARCHIVE")" == "$owner_size" ]]
  [[ "$(stat --format='%s' "$SESSION_ARCHIVE")" == "$session_size" ]]
  [[ "$(sha256sum "$OWNER_ARCHIVE" | awk '{print $1}')" == "$(manifest_value owner_image_tar_sha256)" ]]
  [[ "$(sha256sum "$SESSION_ARCHIVE" | awk '{print $1}')" == "$(manifest_value executor_image_tar_sha256)" ]]
  compose_sha="$(manifest_value canonical_compose_sha256)"
  [[ "$(sha256sum "$STAGED_COMPOSE" | awk '{print $1}')" == "$compose_sha" ]]
  [[ "$(sha256sum "$CANONICAL_COMPOSE" | awk '{print $1}')" == "$compose_sha" ]]
  [[ "$(manifest_value repair_helper_size)" == "$(stat --format='%s' "$self_path")" ]]
  require_archive_image_identity \
    "$OWNER_ARCHIVE" "$OWNER_REPAIR_IMAGE" \
    "$(manifest_value owner_image_config_digest)" \
    "$(manifest_value owner_image_oci_manifest_digest)"
  require_archive_image_identity \
    "$SESSION_ARCHIVE" "$SESSION_REPAIR_IMAGE" \
    "$(manifest_value executor_image_config_digest)" \
    "$(manifest_value executor_image_oci_manifest_digest)"
}

for file in owner-database-url publishable-key beta-database-url beta-transport-hmac \
  customer-web-database-url customer-web-publishable-key customer-web-rate-limit-hmac \
  bot-transport-hmac beta-payload-hmac bot-token player-action-database-url \
  api-action-transport-hmac api-action-payload-hmac api-action-capability-hmac \
  api-action-semantic-hmac cbe-deposit-reference-encryption-key \
  cbe-deposit-reference-fingerprint-key deposit-proof-reference-encryption-master \
  deposit-proof-reference-fingerprint-master bot-action-transport-hmac; do
  [[ -f "$SECRET_ROOT/$file" && ! -L "$SECRET_ROOT/$file" ]] || die "required secret file is unavailable: $file"
done
for file in supabase-ca.crt cbe-deposit-reference-key-profile.v1.json deposit-proof-reference-profile.v2.json; do
  [[ -f "$SECRET_ROOT/$file" && ! -L "$SECRET_ROOT/$file" ]] || die "required config file is unavailable: $file"
done

compose_environment_for() {
  local vcs_ref="$1" image_tag="$2" binding_source="$3"
  printf '%s\0' \
    "PATH=$SAFE_PATH" \
    'HOME=/root' \
    'DOCKER_HOST=unix:///var/run/docker.sock' \
    "FETANAGENT_VCS_REF=$vcs_ref" \
    "FETANAGENT_IMAGE_TAG=$image_tag" \
    "FETANAGENT_STAGING_OWNER_CONTROL_DATABASE_URL_FILE=$SECRET_ROOT/owner-database-url" \
    "FETANAGENT_STAGING_OWNER_CONTROL_SUPABASE_PUBLISHABLE_KEY_FILE=$SECRET_ROOT/publishable-key" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_DATABASE_URL_FILE=$SECRET_ROOT/customer-web-database-url" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY_FILE=$SECRET_ROOT/customer-web-publishable-key" \
    "FETANAGENT_STAGING_CUSTOMER_WEB_RATE_LIMIT_HMAC_FILE=$SECRET_ROOT/customer-web-rate-limit-hmac" \
    "FETANAGENT_STAGING_BETA_ADMISSION_DATABASE_URL_FILE=$SECRET_ROOT/beta-database-url" \
    "FETANAGENT_STAGING_BETA_ADMISSION_TRANSPORT_HMAC_FILE=$SECRET_ROOT/beta-transport-hmac" \
    "FETANAGENT_STAGING_BETA_ADMISSION_PAYLOAD_HMAC_FILE=$SECRET_ROOT/beta-payload-hmac" \
    "FETANAGENT_STAGING_PLAYER_ACTION_DATABASE_URL_FILE=$SECRET_ROOT/player-action-database-url" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_TRANSPORT_HMAC_FILE=$SECRET_ROOT/api-action-transport-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_PAYLOAD_HMAC_FILE=$SECRET_ROOT/api-action-payload-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_CAPABILITY_HMAC_FILE=$SECRET_ROOT/api-action-capability-hmac" \
    "FETANAGENT_STAGING_API_PLAYER_ACTION_SEMANTIC_HMAC_FILE=$SECRET_ROOT/api-action-semantic-hmac" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_ENCRYPTION_KEY_FILE=$SECRET_ROOT/cbe-deposit-reference-encryption-key" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_FINGERPRINT_KEY_FILE=$SECRET_ROOT/cbe-deposit-reference-fingerprint-key" \
    "FETANAGENT_STAGING_CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE=$SECRET_ROOT/cbe-deposit-reference-key-profile.v1.json" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_ENCRYPTION_MASTER_FILE=$SECRET_ROOT/deposit-proof-reference-encryption-master" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_FINGERPRINT_MASTER_FILE=$SECRET_ROOT/deposit-proof-reference-fingerprint-master" \
    "FETANAGENT_STAGING_DEPOSIT_PROOF_REFERENCE_PROFILE_FILE=$SECRET_ROOT/deposit-proof-reference-profile.v2.json" \
    "FETANAGENT_STAGING_SUPABASE_CA_CERTIFICATE_FILE=$SECRET_ROOT/supabase-ca.crt" \
    "FETANAGENT_STAGING_BOT_TOKEN_FILE=$SECRET_ROOT/bot-token" \
    "FETANAGENT_STAGING_BOT_TRANSPORT_HMAC_FILE=$SECRET_ROOT/bot-transport-hmac" \
    "FETANAGENT_STAGING_BOT_PLAYER_ACTION_TRANSPORT_HMAC_FILE=$SECRET_ROOT/bot-action-transport-hmac" \
    "FETANAGENT_STAGING_KEMERBET_SESSION_BINDING_FILE=$binding_source"
}

compose_target() {
  local vcs_ref="$1" image_tag="$2" binding_source="$3" profile="$4"
  shift 4
  local -a environment=()
  mapfile -d '' -t environment < <(compose_environment_for "$vcs_ref" "$image_tag" "$binding_source")
  env -i "${environment[@]}" docker compose --env-file /dev/null \
    --project-name "$PROJECT_NAME" --profile "$profile" -f "$CANONICAL_COMPOSE" "$@"
}

container_id_for() {
  local service="$1" ids
  ids="$(docker container ls --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$PROJECT_NAME" \
    --filter "label=com.docker.compose.service=$service")"
  [[ "$ids" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$ids"
}

service_inventory() {
  docker container ls --all --quiet --no-trunc --filter "label=com.docker.compose.project=$PROJECT_NAME" |
    while IFS= read -r container; do
      [[ -n "$container" ]] || continue
      docker container inspect "$container" --format '{{index .Config.Labels "com.docker.compose.service"}}={{.Id}}'
    done | LC_ALL=C sort
}

non_target_inventory() {
  service_inventory | grep -Ev '^(owner-control|kemerbet-session-provision)='
}

project_volume_inventory() {
  docker volume ls --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME" |
    while IFS= read -r volume; do
      [[ -n "$volume" ]] || continue
      docker volume inspect "$volume" --format '{{.Name}}|{{.Driver}}|{{.Scope}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}'
    done | LC_ALL=C sort
}

mount_inventory() {
  docker container inspect "$1" \
    --format '{{range .Mounts}}{{printf "%s|%s|%s|%t\n" .Type .Source .Destination .RW}}{{end}}' | LC_ALL=C sort
}

text_digest() {
  printf '%s' "$1" | sha256sum | awk '{print $1}'
}

require_archive_image_identity() {
  local archive="$1" expected_tag="$2" expected_config_digest="$3" expected_manifest_digest="$4"
  env -i PATH="$SAFE_PATH" python3 -I - \
    "$archive" "$expected_tag" "$expected_config_digest" "$expected_manifest_digest" <<'PY'
import hashlib
import json
import pathlib
import re
import sys
import tarfile

DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
archive_path, expected_tag, expected_config, expected_manifest = sys.argv[1:]


def refuse(message):
    raise SystemExit(message)


def exact_member(archive, members_by_name, name, maximum_size):
    member = members_by_name.get(name)
    if member is None or not member.isfile() or member.size < 1 or member.size > maximum_size:
        refuse("required Docker archive member is missing or unsafe")
    extracted = archive.extractfile(member)
    if extracted is None:
        refuse("required Docker archive member cannot be read")
    return member, extracted.read()


if (
    DIGEST.fullmatch(expected_config) is None
    or DIGEST.fullmatch(expected_manifest) is None
    or expected_config == expected_manifest
):
    refuse("expected Docker archive identities are invalid")

with tarfile.open(archive_path, mode="r:") as archive:
    members = archive.getmembers()
    if not members or len(members) > 4096:
        refuse("invalid Docker archive member count")
    members_by_name = {}
    for member in members:
        target = pathlib.PurePosixPath(member.name)
        if (
            member.name in members_by_name
            or target.is_absolute()
            or ".." in target.parts
            or not (member.isfile() or member.isdir())
        ):
            refuse("unsafe Docker archive member")
        members_by_name[member.name] = member

    _, docker_manifest_bytes = exact_member(archive, members_by_name, "manifest.json", 1048576)
    _, index_bytes = exact_member(archive, members_by_name, "index.json", 1048576)
    docker_manifest = json.loads(docker_manifest_bytes)
    if not isinstance(docker_manifest, list) or len(docker_manifest) != 1:
        refuse("Docker archive manifest is not singular")
    docker_entry = docker_manifest[0]
    if not isinstance(docker_entry, dict):
        refuse("Docker archive manifest entry is invalid")
    expected_config_path = "blobs/sha256/" + expected_config.removeprefix("sha256:")
    docker_layers = docker_entry.get("Layers")
    if (
        docker_entry.get("Config") != expected_config_path
        or docker_entry.get("RepoTags") != [expected_tag]
        or not isinstance(docker_layers, list)
        or not docker_layers
        or any(not isinstance(layer, str) for layer in docker_layers)
    ):
        refuse("Docker archive is not bound to the exact image")

    index = json.loads(index_bytes)
    descriptors = index.get("manifests") if isinstance(index, dict) else None
    if (
        not isinstance(index, dict)
        or index.get("schemaVersion") != 2
        or index.get("mediaType") != "application/vnd.oci.image.index.v1+json"
        or not isinstance(descriptors, list)
        or len(descriptors) != 1
    ):
        refuse("OCI archive index is not singular and exact")
    descriptor = descriptors[0]
    annotations = descriptor.get("annotations") if isinstance(descriptor, dict) else None
    expected_ref = expected_tag.rsplit(":", 1)[1]
    if (
        not isinstance(descriptor, dict)
        or descriptor.get("mediaType") != "application/vnd.oci.image.manifest.v1+json"
        or descriptor.get("digest") != expected_manifest
        or not isinstance(descriptor.get("size"), int)
        or descriptor["size"] < 1
        or descriptor["size"] > 16777216
        or annotations
        != {
            "io.containerd.image.name": "docker.io/library/" + expected_tag,
            "org.opencontainers.image.ref.name": expected_ref,
        }
    ):
        refuse("OCI archive descriptor is invalid")

    manifest_path = "blobs/sha256/" + expected_manifest.removeprefix("sha256:")
    manifest_member, manifest_bytes = exact_member(
        archive, members_by_name, manifest_path, 16777216
    )
    if (
        manifest_member.size != descriptor["size"]
        or hashlib.sha256(manifest_bytes).hexdigest()
        != expected_manifest.removeprefix("sha256:")
    ):
        refuse("OCI image manifest blob is not digest-bound")
    image_manifest = json.loads(manifest_bytes)
    config = image_manifest.get("config") if isinstance(image_manifest, dict) else None
    layers = image_manifest.get("layers") if isinstance(image_manifest, dict) else None
    if (
        not isinstance(image_manifest, dict)
        or image_manifest.get("schemaVersion") != 2
        or image_manifest.get("mediaType") != "application/vnd.oci.image.manifest.v1+json"
        or not isinstance(config, dict)
        or config.get("mediaType") != "application/vnd.oci.image.config.v1+json"
        or config.get("digest") != expected_config
        or not isinstance(config.get("size"), int)
        or config["size"] < 1
        or config["size"] > 16777216
        or not isinstance(layers, list)
        or not layers
        or any(
            not isinstance(layer, dict)
            or DIGEST.fullmatch(layer.get("digest") or "") is None
            for layer in layers
        )
        or docker_layers
        != ["blobs/sha256/" + layer["digest"].removeprefix("sha256:") for layer in layers]
    ):
        refuse("OCI image manifest is not bound to the exact config and layers")

    config_member, config_bytes = exact_member(
        archive, members_by_name, expected_config_path, 16777216
    )
    if (
        config_member.size != config["size"]
        or hashlib.sha256(config_bytes).hexdigest()
        != expected_config.removeprefix("sha256:")
    ):
        refuse("OCI image config blob is not digest-bound")
    parsed_config = json.loads(config_bytes)
    if not isinstance(parsed_config, dict):
        refuse("OCI image config is invalid")
PY
}

require_image_labels() {
  local image="$1" expected_revision="$2" require_repair_labels="$3"
  [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == \
    "$expected_revision" ]] || return 1
  if [[ "$require_repair_labels" == 'true' ]]; then
    [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "com.fetanagent.canonical-release"}}')" == \
      "$CANONICAL_H14" ]] || return 1
    [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "com.fetanagent.repair-parent"}}')" == \
      "$OWNER_SESSION_REPAIR_PARENT" ]] || return 1
    [[ "$(docker image inspect "$image" --format '{{index .Config.Labels "com.fetanagent.provider-action-enabled"}}')" == \
      'false' ]] || return 1
  fi
}

require_runtime_image_identity() {
  local image="$1" config_key="$2" oci_manifest_key="$3" config_id oci_manifest_id statuses
  config_id="$(manifest_value "$config_key")" || return 1
  oci_manifest_id="$(manifest_value "$oci_manifest_key")" || return 1
  set +e
  docker image inspect "$image" |
    env -i PATH="$SAFE_PATH" python3 -I /dev/fd/3 \
      "$image" "$config_id" "$oci_manifest_id" 3<<'PY'
import json
import re
import sys

tag, config_digest, manifest_digest = sys.argv[1:]
digest = re.compile(r"sha256:[0-9a-f]{64}")
images = json.load(sys.stdin)
if (
    digest.fullmatch(config_digest) is None
    or digest.fullmatch(manifest_digest) is None
    or config_digest == manifest_digest
    or not isinstance(images, list)
    or len(images) != 1
    or not isinstance(images[0], dict)
):
    raise SystemExit(1)
image = images[0]
if image.get("RepoTags") != [tag] or image.get("Id") not in {config_digest, manifest_digest}:
    raise SystemExit(1)
descriptor = image.get("Descriptor")
if descriptor is not None and (
    not isinstance(descriptor, dict) or descriptor.get("digest") != manifest_digest
):
    raise SystemExit(1)
repo = tag.rsplit(":", 1)[0]
repo_digests = image.get("RepoDigests")
if repo_digests not in (None, [], [repo + "@" + manifest_digest]):
    raise SystemExit(1)
PY
  statuses="${PIPESTATUS[*]}"
  set -e
  [[ "$statuses" == '0 0' ]]
}

require_container_image_identity() {
  local container="$1" image="$2" config_key="$3" oci_manifest_key="$4" runtime_id
  require_runtime_image_identity "$image" "$config_key" "$oci_manifest_key" || return 1
  runtime_id="$(docker image inspect "$image" --format '{{.Id}}')" || return 1
  [[ "$(docker container inspect "$container" --format '{{.Image}}|{{.Config.Image}}')" == \
    "$runtime_id|$image" ]]
}

require_owner_contract() {
  local container="$1" expected_revision="$2" require_repair_labels="$3" environment
  [[ "$container" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == \
    'running|healthy' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == \
    "$expected_revision" ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.Config.User}}|{{json .Config.Cmd}}')" == \
    '10001:10001|["node","apps/admin/dist/index.js"]' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}')" == \
    'true|["ALL"]|["no-new-privileges:true"]' ]] || return 1
  environment="$(docker container inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
  for expected in 'FINANCIAL_ACTIONS_MODE=dry_run' 'KEMERBET_EXECUTOR_ENABLED=false' \
    'KEMERBET_FINAL_ACTION_ENABLED=false' 'TELEGRAM_BOT_ENABLED=false'; do
    grep -Fxq "$expected" <<<"$environment" || return 1
  done
  if [[ "$require_repair_labels" == 'true' ]]; then
    [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.fetanagent.canonical-release"}}')" == \
      "$CANONICAL_H14" ]] || return 1
    [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.fetanagent.repair-parent"}}')" == \
      "$OWNER_SESSION_REPAIR_PARENT" ]] || return 1
    [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.fetanagent.provider-action-enabled"}}')" == \
      'false' ]] || return 1
  fi
}

require_session_contract() {
  local container="$1" expected_revision="$2" require_repair_labels="$3" environment processes
  [[ "$container" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}')" == \
    'running|healthy' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == \
    "$expected_revision" ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.Config.User}}|{{json .Config.Cmd}}')" == \
    '10001:10001|["node","apps/executor/dist/kemerbet-session-provision-server.js"]' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}')" == \
    'true|["ALL"]|["no-new-privileges:true"]' ]] || return 1
  [[ "$(docker container inspect "$container" --format '{{json .HostConfig.PortBindings}}')" == '{}' ]] || return 1
  environment="$(docker container inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}')" || return 1
  for expected in 'NODE_ENV=production' 'FINANCIAL_ACTIONS_MODE=dry_run' \
    'KEMERBET_NO_TRANSFER_READINESS_SEAL_ENABLED=true' 'KEMERBET_EXECUTOR_ENABLED=false' \
    'KEMERBET_FINAL_ACTION_ENABLED=false' 'KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=false' \
    'INTERNAL_KEMERBET_EXECUTION_RUNTIME_ENABLED=false'; do
    grep -Fxq "$expected" <<<"$environment" || return 1
  done
  ! grep -Eq '(DATABASE|PASSWORD|SECRET|TOKEN|HMAC|SUPABASE|PLAYER|RECEIVER|SELECTOR|IDENTITY)' <<<"$environment" ||
    return 1
  processes="$(docker container top "$container" -eo pid,ppid,comm,args 2>/dev/null)" || return 1
  ! grep -Eqi '(^|[/[:space:]])(chrome|chromium)([[:space:]]|$)|playwright' <<<"$processes" || return 1
  if [[ "$require_repair_labels" == 'true' ]]; then
    [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.fetanagent.canonical-release"}}')" == \
      "$CANONICAL_H14" ]] || return 1
    [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.fetanagent.repair-parent"}}')" == \
      "$OWNER_SESSION_REPAIR_PARENT" ]] || return 1
    [[ "$(docker container inspect "$container" --format '{{index .Config.Labels "com.fetanagent.provider-action-enabled"}}')" == \
      'false' ]] || return 1
  fi
}

require_no_provider_action_runtime() {
  local service
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    service="$(docker container inspect "$container" --format '{{index .Config.Labels "com.docker.compose.service"}}')"
    case "$service" in
      kemerbet-no-transfer-readiness|kemerbet-readiness-browser|kemerbet-readiness-egress-proxy)
        return 1
        ;;
    esac
  done < <(docker container ls --quiet --no-trunc --filter "label=com.docker.compose.project=$PROJECT_NAME")
}

require_owner_session_socket() {
  local owner="$1"
  docker container exec "$owner" node --input-type=module --eval '
    import http from "node:http";
    const request = http.get({
      socketPath: "/run/fetanagent-kemerbet-session-control/session.sock",
      path: "/healthz",
    }, (response) => process.exit(response.statusCode === 200 ? 0 : 21));
    request.on("error", () => process.exit(22));
    request.setTimeout(3000, () => request.destroy());
  ' >/dev/null
}

require_binding_source() {
  local source="$1" metadata recovery_release
  case "$source" in
    /etc/fetanagent/executor-secrets/kemerbet_agent_identity_bindings)
      metadata='0:0:444:1'
      ;;
    /var/lib/fetanagent/kemerbet-readiness-seal-output/kemerbet_agent_identity_bindings)
      metadata='10001:10001:600:1'
      ;;
    /var/lib/fetanagent/kemerbet-quarantine-recovery-v14/*/recovery-identity-authorization-v1)
      recovery_release="${source#/var/lib/fetanagent/kemerbet-quarantine-recovery-v14/}"
      recovery_release="${recovery_release%/recovery-identity-authorization-v1}"
      [[ "$recovery_release" =~ ^[0-9a-f]{40}$ ]] || return 1
      metadata='0:10001:440:1'
      ;;
    *) return 1 ;;
  esac
  [[ ! -L "$source" && -f "$source" && "$(realpath -- "$source")" == "$source" &&
    "$(stat --format='%u:%g:%a:%h' "$source")" == "$metadata" ]]
}

durable_write() {
  local path="$1" content="$2" parent temporary
  parent="$(dirname -- "$path")"
  temporary="$parent/.write.$$.${RANDOM}"
  (umask 077; printf '%s\n' "$content" >"$temporary")
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -- "$temporary" "$path"
  sync -f "$path"
  sync -f "$parent"
}

ledger_value() {
  local file="$1" key="$2" line
  line="$(grep -E "^${key}=" "$file" || true)"
  [[ "$(grep -Ec "^${key}=" "$file" || true)" == '1' ]] || return 1
  printf '%s\n' "${line#*=}"
}

NON_TARGET_DIGEST=''
VOLUME_DIGEST=''
OWNER_MOUNT_DIGEST=''
SESSION_MOUNT_DIGEST=''
BINDING_SOURCE=''
BINDING_DIGEST=''

require_preserved_state() {
  local owner="$1" session="$2"
  [[ "$(text_digest "$(non_target_inventory)")" == "$NON_TARGET_DIGEST" ]] || return 1
  [[ "$(text_digest "$(project_volume_inventory)")" == "$VOLUME_DIGEST" ]] || return 1
  [[ "$(text_digest "$(mount_inventory "$owner")")" == "$OWNER_MOUNT_DIGEST" ]] || return 1
  [[ "$(text_digest "$(mount_inventory "$session")")" == "$SESSION_MOUNT_DIGEST" ]] || return 1
  require_binding_source "$BINDING_SOURCE" || return 1
  [[ "$(sha256sum "$BINDING_SOURCE" | awk '{print $1}')" == "$BINDING_DIGEST" ]] || return 1
}

rollback_to_predecessors() {
  local owner session
  compose_target "$CANONICAL_H14" "$SESSION_PREDECESSOR_TAG" "$BINDING_SOURCE" \
    kemerbet-session-provision up --detach --no-build --no-deps --wait --wait-timeout 90 "$SESSION_SERVICE" || return 1
  session="$(container_id_for "$SESSION_SERVICE")" || return 1
  require_session_contract "$session" "$CANONICAL_H14" false || return 1
  compose_target "$OWNER_SESSION_REPAIR_PARENT" "$OWNER_PREDECESSOR_TAG" "$BINDING_SOURCE" \
    staging-manual up --detach --no-build --no-deps --wait --wait-timeout 90 "$OWNER_SERVICE" || return 1
  owner="$(container_id_for "$OWNER_SERVICE")" || return 1
  require_owner_contract "$owner" "$OWNER_SESSION_REPAIR_PARENT" false || return 1
  require_owner_session_socket "$owner" || return 1
  require_no_provider_action_runtime || return 1
  require_preserved_state "$owner" "$session" || return 1
}

recover_incomplete_ledger() {
  local intent recovery_root owner session outcome
  [[ -e "$INSTALLING_LEDGER" || -L "$INSTALLING_LEDGER" ]] || return 0
  [[ ! -L "$INSTALLING_LEDGER" && -d "$INSTALLING_LEDGER" &&
    "$(realpath -- "$INSTALLING_LEDGER")" == "$INSTALLING_LEDGER" &&
    "$(stat --format='%U:%G:%a' "$INSTALLING_LEDGER")" == 'root:root:700' ]] ||
    die 'the incomplete repair ledger is unsafe'
  intent="$INSTALLING_LEDGER/intent-v1"
  [[ ! -L "$intent" && -f "$intent" && "$(stat --format='%U:%G:%a:%h' "$intent")" == 'root:root:600:1' ]] ||
    die 'the incomplete repair intent is unsafe'
  [[ "$(ledger_value "$intent" repair_implementation_sha)" == "$REPAIR_SHA" ]]
  [[ "$(ledger_value "$intent" manifest_sha256)" == "$PROVIDED_MANIFEST_SHA" ]]
  [[ "$(ledger_value "$intent" owner_predecessor_sha)" == "$OWNER_SESSION_REPAIR_PARENT" ]]
  [[ "$(ledger_value "$intent" session_predecessor_sha)" == "$CANONICAL_H14" ]]
  NON_TARGET_DIGEST="$(ledger_value "$intent" non_target_inventory_sha256)"
  VOLUME_DIGEST="$(ledger_value "$intent" project_volume_inventory_sha256)"
  OWNER_MOUNT_DIGEST="$(ledger_value "$intent" owner_mount_inventory_sha256)"
  SESSION_MOUNT_DIGEST="$(ledger_value "$intent" session_mount_inventory_sha256)"
  BINDING_SOURCE="$(ledger_value "$intent" binding_source)"
  BINDING_DIGEST="$(ledger_value "$intent" binding_sha256)"
  for digest in "$NON_TARGET_DIGEST" "$VOLUME_DIGEST" "$OWNER_MOUNT_DIGEST" \
    "$SESSION_MOUNT_DIGEST" "$BINDING_DIGEST"; do
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die 'the incomplete repair intent contains an invalid digest'
  done
  require_binding_source "$BINDING_SOURCE" || die 'the incomplete repair binding source is unsafe'
  rollback_to_predecessors || die 'the incomplete repair could not roll back session then Owner'
  owner="$(container_id_for "$OWNER_SERVICE")"
  session="$(container_id_for "$SESSION_SERVICE")"
  outcome="version=1
contract=fetanagent-h14-owner-kemerbet-session-bootstrap-repair-outcome
repair_implementation_sha=$REPAIR_SHA
manifest_sha256=$PROVIDED_MANIFEST_SHA
outcome=recovered-and-rolled-back
session_revision=$CANONICAL_H14
owner_revision=$OWNER_SESSION_REPAIR_PARENT
provider_action_enabled=false
transfer_enabled=false
money_moved=false
owner_container_id=$owner
session_container_id=$session"
  durable_write "$INSTALLING_LEDGER/outcome-v1" "$outcome"
  recovery_root="$LEDGER_ROOT/recovered-rollback-$REPAIR_SHA-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  [[ ! -e "$recovery_root" && ! -L "$recovery_root" ]]
  mv -- "$INSTALLING_LEDGER" "$recovery_root"
  sync -f "$LEDGER_ROOT"
}

preflight() {
  local owner session non_targets volumes binding image key oci_key pair
  owner="$(container_id_for "$OWNER_SERVICE")" || die 'exactly one Owner container is required'
  session="$(container_id_for "$SESSION_SERVICE")" || die 'exactly one KemerBet session container is required'
  require_owner_contract "$owner" "$OWNER_SESSION_REPAIR_PARENT" false ||
    die 'the Owner predecessor is not the exact 826aaba runtime'
  require_session_contract "$session" "$CANONICAL_H14" false ||
    die 'the KemerBet session predecessor is not inactive exact canonical H14'
  require_owner_session_socket "$owner" || die 'the Owner cannot reach the inactive KemerBet session coordinator'
  require_no_provider_action_runtime || die 'a KemerBet provider-action transient is active'
  non_targets="$(non_target_inventory)"
  [[ "$(printf '%s\n' "$non_targets" | sed '/^$/d' | wc -l)" == '5' ]]
  [[ "$(printf '%s\n' "$non_targets" | cut -d= -f1)" == "api
beta-admission
bot
customer-web
gateway" ]] || die 'the five non-target services are not exact'
  while IFS='=' read -r service id; do
    [[ -n "$service" && "$id" =~ ^[0-9a-f]{64}$ ]]
    [[ "$(docker container inspect "$id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == \
      "$CANONICAL_H14" ]] || die "non-target service is outside canonical H14: $service"
  done <<<"$non_targets"
  volumes="$(project_volume_inventory)"
  grep -Fq "${PROJECT_NAME}_kemerbet_session_control|" <<<"$volumes" || die 'the session-control volume is absent'
  grep -Fq "${PROJECT_NAME}_kemerbet_sessions|" <<<"$volumes" || die 'the KemerBet profile volume is absent'
  binding="$(docker container inspect "$session" \
    --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/kemerbet_agent_identity_bindings"}}{{.Source}}{{end}}{{end}}')"
  require_binding_source "$binding" || die 'the active KemerBet binding source is unsafe or outside the allowlist'
  NON_TARGET_DIGEST="$(text_digest "$non_targets")"
  VOLUME_DIGEST="$(text_digest "$volumes")"
  OWNER_MOUNT_DIGEST="$(text_digest "$(mount_inventory "$owner")")"
  SESSION_MOUNT_DIGEST="$(text_digest "$(mount_inventory "$session")")"
  BINDING_SOURCE="$binding"
  BINDING_DIGEST="$(sha256sum "$binding" | awk '{print $1}')"
  [[ "$(docker image inspect "$OWNER_PREDECESSOR_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == \
    "$OWNER_SESSION_REPAIR_PARENT" ]] || die 'the exact Owner rollback image is unavailable'
  [[ "$(docker image inspect "$SESSION_PREDECESSOR_IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == \
    "$CANONICAL_H14" ]] || die 'the exact session rollback image is unavailable'
  for pair in \
    "$OWNER_REPAIR_IMAGE|owner_image_config_digest|owner_image_oci_manifest_digest" \
    "$SESSION_REPAIR_IMAGE|executor_image_config_digest|executor_image_oci_manifest_digest"; do
    IFS='|' read -r image key oci_key <<<"$pair"
    if docker image inspect "$image" >/dev/null 2>&1; then
      require_runtime_image_identity "$image" "$key" "$oci_key" ||
        die 'a candidate tag already names a different image'
    fi
  done
}

write_intent() {
  local owner session content
  owner="$(container_id_for "$OWNER_SERVICE")"
  session="$(container_id_for "$SESSION_SERVICE")"
  [[ ! -e "$INSTALLING_LEDGER" && ! -L "$INSTALLING_LEDGER" ]]
  install -d -o root -g root -m 0700 "$INSTALLING_LEDGER"
  content="version=1
contract=fetanagent-h14-owner-kemerbet-session-bootstrap-repair-intent
repair_implementation_sha=$REPAIR_SHA
manifest_sha256=$PROVIDED_MANIFEST_SHA
canonical_h14_sha=$CANONICAL_H14
owner_predecessor_sha=$OWNER_SESSION_REPAIR_PARENT
session_predecessor_sha=$CANONICAL_H14
owner_predecessor_container_id=$owner
session_predecessor_container_id=$session
non_target_inventory_sha256=$NON_TARGET_DIGEST
project_volume_inventory_sha256=$VOLUME_DIGEST
owner_mount_inventory_sha256=$OWNER_MOUNT_DIGEST
session_mount_inventory_sha256=$SESSION_MOUNT_DIGEST
binding_source=$BINDING_SOURCE
binding_sha256=$BINDING_DIGEST
deployment_order=owner-control,kemerbet-session-provision
rollback_order=kemerbet-session-provision,owner-control
provider_action_enabled=false
transfer_enabled=false
money_moved=false"
  durable_write "$INSTALLING_LEDGER/intent-v1" "$content"
}

write_outcome() {
  local outcome="$1" owner="$2" session="$3" content
  content="version=1
contract=fetanagent-h14-owner-kemerbet-session-bootstrap-repair-outcome
repair_implementation_sha=$REPAIR_SHA
manifest_sha256=$PROVIDED_MANIFEST_SHA
outcome=$outcome
owner_revision=$REPAIR_SHA
session_revision=$REPAIR_SHA
deployment_order=owner-control,kemerbet-session-provision
rollback_order=kemerbet-session-provision,owner-control
provider_action_enabled=false
financial_actions_mode=dry_run
kemerbet_executor_enabled=false
kemerbet_final_action_enabled=false
transfer_enabled=false
amount_entry_enabled=false
money_moved=false
owner_container_id=$owner
session_container_id=$session"
  durable_write "$INSTALLING_LEDGER/outcome-v1" "$content"
}

MUTATION_STARTED='false'
rollback_on_failure() {
  local status="$?" rollback_outcome owner='' session=''
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 && "$MUTATION_STARTED" == 'true' ]]; then
    if rollback_to_predecessors; then
      owner="$(container_id_for "$OWNER_SERVICE" || true)"
      session="$(container_id_for "$SESSION_SERVICE" || true)"
      rollback_outcome="version=1
contract=fetanagent-h14-owner-kemerbet-session-bootstrap-repair-outcome
repair_implementation_sha=$REPAIR_SHA
manifest_sha256=$PROVIDED_MANIFEST_SHA
outcome=failed-and-rolled-back
session_revision=$CANONICAL_H14
owner_revision=$OWNER_SESSION_REPAIR_PARENT
rollback_order=kemerbet-session-provision,owner-control
provider_action_enabled=false
transfer_enabled=false
money_moved=false
owner_container_id=$owner
session_container_id=$session"
      durable_write "$INSTALLING_LEDGER/outcome-v1" "$rollback_outcome" || true
    else
      rollback_outcome="version=1
contract=fetanagent-h14-owner-kemerbet-session-bootstrap-repair-outcome
repair_implementation_sha=$REPAIR_SHA
manifest_sha256=$PROVIDED_MANIFEST_SHA
outcome=rollback-failed-manual-recovery-required
rollback_order=kemerbet-session-provision,owner-control
provider_action_enabled=false
transfer_enabled=false
money_moved=false"
      durable_write "$INSTALLING_LEDGER/outcome-v1" "$rollback_outcome" || true
      status=97
    fi
  fi
  exit "$status"
}

deploy_repair() {
  local owner session
  docker load --input "$OWNER_ARCHIVE" >/dev/null
  docker load --input "$SESSION_ARCHIVE" >/dev/null
  require_runtime_image_identity \
    "$OWNER_REPAIR_IMAGE" owner_image_config_digest owner_image_oci_manifest_digest
  require_runtime_image_identity \
    "$SESSION_REPAIR_IMAGE" executor_image_config_digest executor_image_oci_manifest_digest
  require_image_labels "$OWNER_REPAIR_IMAGE" "$REPAIR_SHA" true
  require_image_labels "$SESSION_REPAIR_IMAGE" "$REPAIR_SHA" true
  [[ "$(docker image inspect "$OWNER_REPAIR_IMAGE" --format '{{.Config.User}}|{{json .Config.Cmd}}')" == \
    '10001:10001|["node","apps/admin/dist/index.js"]' ]]
  [[ "$(docker image inspect "$SESSION_REPAIR_IMAGE" --format '{{.Config.User}}|{{json .Config.Cmd}}')" == \
    '10001:10001|["node","apps/executor/dist/index.js"]' ]]
  [[ "$(docker image inspect "$SESSION_REPAIR_IMAGE" \
    --format '{{index .Config.Labels "org.opencontainers.image.chromium-package-version"}}')" == \
    "$(manifest_value chromium_package_version)" ]]

  compose_target "$REPAIR_SHA" "$REPAIR_TAG" "$BINDING_SOURCE" staging-manual \
    up --detach --no-build --no-deps --wait --wait-timeout 90 "$OWNER_SERVICE"
  owner="$(container_id_for "$OWNER_SERVICE")"
  session="$(container_id_for "$SESSION_SERVICE")"
  require_owner_contract "$owner" "$REPAIR_SHA" true
  require_container_image_identity \
    "$owner" "$OWNER_REPAIR_IMAGE" owner_image_config_digest owner_image_oci_manifest_digest
  require_session_contract "$session" "$CANONICAL_H14" false
  require_owner_session_socket "$owner"
  require_no_provider_action_runtime
  require_preserved_state "$owner" "$session"

  compose_target "$REPAIR_SHA" "$REPAIR_TAG" "$BINDING_SOURCE" kemerbet-session-provision \
    up --detach --no-build --no-deps --wait --wait-timeout 90 "$SESSION_SERVICE"
  owner="$(container_id_for "$OWNER_SERVICE")"
  session="$(container_id_for "$SESSION_SERVICE")"
  require_owner_contract "$owner" "$REPAIR_SHA" true
  require_session_contract "$session" "$REPAIR_SHA" true
  require_container_image_identity \
    "$owner" "$OWNER_REPAIR_IMAGE" owner_image_config_digest owner_image_oci_manifest_digest
  require_container_image_identity \
    "$session" "$SESSION_REPAIR_IMAGE" executor_image_config_digest executor_image_oci_manifest_digest
  require_owner_session_socket "$owner"
  require_no_provider_action_runtime
  require_preserved_state "$owner" "$session"
  curl --fail --silent --show-error --noproxy '*' --max-time 5 http://127.0.0.1:3002/readyz >/dev/null
  write_outcome completed "$owner" "$session"
  [[ ! -e "$COMPLETED_LEDGER" && ! -L "$COMPLETED_LEDGER" ]]
  mv -- "$INSTALLING_LEDGER" "$COMPLETED_LEDGER"
  MUTATION_STARTED='false'
  sync -f "$LEDGER_ROOT"
}

acquire_mutation_lock
require_bundle
require_manifest
[[ ! -L "$LEDGER_PARENT" && -d "$LEDGER_PARENT" && "$(realpath -- "$LEDGER_PARENT")" == "$LEDGER_PARENT" &&
  "$(stat --format='%U:%G' "$LEDGER_PARENT")" == 'root:root' ]] || die 'the durable ledger parent is unsafe'
if [[ ! -e "$LEDGER_ROOT" && ! -L "$LEDGER_ROOT" ]]; then
  install -d -o root -g root -m 0700 "$LEDGER_ROOT"
fi
[[ ! -L "$LEDGER_ROOT" && -d "$LEDGER_ROOT" && "$(realpath -- "$LEDGER_ROOT")" == "$LEDGER_ROOT" &&
  "$(stat --format='%U:%G:%a' "$LEDGER_ROOT")" == 'root:root:700' ]] || die 'the durable ledger root is unsafe'
if [[ -e "$COMPLETED_LEDGER" || -L "$COMPLETED_LEDGER" ]]; then
  die 'this exact repair already has a durable terminal ledger'
fi
recover_incomplete_ledger
preflight
write_intent
MUTATION_STARTED='true'
trap rollback_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
deploy_repair
trap - EXIT INT TERM
printf '%s\n' "FetanAgent composite repair deployed: $REPAIR_SHA; Owner then KemerBet session; inactive/no Chromium; Transfer and all provider/financial actions remain disabled; no money moved."
